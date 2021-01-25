const fs = require("fs-extra")
const path = require("path")
const cluster = require("cluster")
const { EventEmitter } = require("events")
const http = require("http")
const os = require(`os`)
const { performance } = require("perf_hooks")
const _ = require(`lodash`)
const avro = require("avsc")
const setupFunctionDir = require(`./setup-function-dir`)
const redis = require("redis")
const { promisify } = require("util")
const client = redis.createClient()
const getAsync = promisify(client.get).bind(client)
const setAsync = promisify(client.set).bind(client)

const avroSchemas = new Map()
let avroType

const yargs = require("yargs/yargs")
const { hideBin } = require("yargs/helpers")
const argv = yargs(hideBin(process.argv))
  .default(`directory`, () => os.tmpdir())
  .default(`numWorkers`, () => os.cpus().length - 1)
  .default(`socketPort`, () => 6899)
  .default(`httpPort`, () => 6898).argv

const options = {
  directory: argv.directory,
  numWorkers: argv.numWorkers,
  socketPort: argv.socketPort,
  httpPort: argv.httpPort,
}

const functionDir = path.join(options.directory, `.cache`, `worker-tasks`)
const filesDir = path.join(options.directory, `.cache`, `files`)

const tasks = {}

if (cluster.isMaster) {
  console.log(`worker-server`, options)

  const controls = {}

  // Setup directories
  fs.ensureDirSync(functionDir)
  fs.ensureDirSync(filesDir)

  const io = require("socket.io")(options.socketPort)
  controls.destroy = () => {
    console.log(`DESTROY`)
    io.close()
  }

  let socket
  console.log(`master pid ${process.pid}`)

  function broadcastToWorkers(msg) {
    for (const id in cluster.workers) {
      cluster.workers[id].send(msg)
    }
  }

  io.on("connection", sock => {
    console.log(`connection`)
    socket = sock
    socket.emit(`serverReady`)
    // sock.on(`*`, (type, action) => {
    socket.on(`file`, async file => {
      // Make path
      const localPath = path.join(filesDir, file.digest)
      await fs.writeFile(localPath, file.fileBlob)

      const fileObject = { ...file, localPath } //, fileBlob };
      delete fileObject.fileBlob
      broadcastToWorkers({ type: file.digest, action: fileObject })
    })

    socket.on(`setupTask`, async task => {
      const { funcPath } = await setupFunctionDir({
        task,
        functionDir,
        emit: emitObj => {
          broadcastToWorkers({ type: emitObj.msg })
        },
      })

      task.funcPath = funcPath

      // Process files
      if (task.files && !_.isEmpty(task.files)) {
        await Promise.all(
          _.toPairs(task.files).map(async ([name, file]) => {
            const localPath = path.join(filesDir, file.digest)
            await fs.writeFile(localPath, file.fileBlob)

            const fileObject = { ...file, localPath } //, fileBlob };
            delete fileObject.fileBlob
            task.files[name] = fileObject
          })
        )
      }

      broadcastToWorkers({ type: `newTask`, action: task })
      // tasks[task.digest] = task
      socket.emit(`task-setup-${task.digest}`)
    })
  })

  // Count requests
  function messageHandler(msg) {
    if (msg.cmd) {
      if (msg.cmd === `emit`) {
        socket.emit(msg.emit, msg.args)
      }
      if (msg.cmd === `broadcast`) {
        broadcastToWorkers({ type: msg.msg })
      }
    }
  }

  // Start workers and listen for messages containing notifyRequest
  for (let i = 0; i < options.numWorkers; i++) {
    cluster.fork()
  }

  for (const id in cluster.workers) {
    cluster.workers[id].on("message", messageHandler)
  }
} else {
  const parentMessages = new EventEmitter()
  process.on(`message`, msg => parentMessages.emit(msg.type, msg.action))

  parentMessages.on(`newTask`, task => {
    tasks[task.digest] = task
  })

  // Workers can share any TCP connection
  // In this case it is an HTTP server
  http
    .createServer((req, res) => {
      let data
      req.on(`data`, chunk => {
        if (!data) {
          data = chunk
        } else if (chunk) {
          data += chunk
        }
      })
      req.on(`end`, async chunk => {
        if (req.url === `/schema`) {
          // Store the schema
          const schema = JSON.parse(data)
          const dataType = avro.parse(JSON.parse(schema.schema))
          // console.log({ dataType })
          avroSchemas.set(schema.digest, dataType)
          avroType = dataType
          process.send({ cmd: `broadcast`, msg: schema })
          res.writeHead(200)
          res.end(`ok`)
        } else {
          const taskDef = tasks[req.url.slice(1)]
          const avroType = avro.Type.forSchema(taskDef.argsSchema)
          const tasksArgs = avroType.fromBuffer(data)
          const results = await Promise.all(
            tasksArgs.map(args => runTask(taskDef, args))
          )

          if (taskDef.returnOnlyErrors) {
            // TODO actually set errors haha
            res.writeHead(200)
            res.end(`ok`)
          } else {
            res.writeHead(200)
            res.end(JSON.stringify(results))
          }
        }
      })
    })
    .listen(options.httpPort)

  console.log(`Worker ${process.pid} started`)

  const runTask = async (task, args) => {
    return actuallyRunTask({
      funcPath: task.funcPath,
      args: args.args,
      files: task.files,
      id: args.id,
      cache: { set: setAsync, get: getAsync },
    })
  }

  const actuallyRunTask = async ({ funcPath, args, files, id, cache }) => {
    let taskRunner = require(funcPath)
    if (taskRunner.default) {
      taskRunner = taskRunner.default
    }

    // Copy the trace Id to make sure task functions can't change it.
    const copyOfTraceId = (` ` + id).slice(1)
    const start = performance.now()
    const result = await Promise.resolve(
      taskRunner(args, { id: copyOfTraceId, files, cache })
    )
    const end = performance.now()

    return {
      result,
      id,
      executionTime: end - start,
    }
  }
}