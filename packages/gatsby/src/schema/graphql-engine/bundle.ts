import * as path from "path"
const rollup = require(`rollup`)
import replace from "@rollup/plugin-replace"
import * as fs from "fs-extra"

import resolve from "@rollup/plugin-node-resolve"
import babel from "@rollup/plugin-babel"
import commonjs from "@rollup/plugin-commonjs"
import json from "@rollup/plugin-json"
import { visualizer } from "rollup-plugin-visualizer"
import autoExternal from "rollup-plugin-auto-external"
import internal from "rollup-plugin-internal"

import { builtinModules } from "module"

const outputOptions = {
  // core output options
  // dir,
  file: path.join(process.cwd(), `.cache`, `query-engine.js`),
  format: `cjs`, // required
  // globals,
  // name,
  // plugins,

  // advanced output options
  // assetFileNames,
  // banner,
  // chunkFileNames,
  // compact,
  // entryFileNames,
  // extend,
  // externalLiveBindings,
  // footer,
  // hoistTransitiveImports,
  // inlineDynamicImports,
  // interop,
  // intro,
  // manualChunks,
  // minifyInternalExports,
  // outro,
  // paths,
  // preserveModules,
  // preserveModulesRoot,
  // sourcemap,
  // sourcemapExcludeSources,
  // sourcemapFile,
  // sourcemapPathTransform,
  // validate,

  // danger zone
  // amd,
  // esModule,
  // exports,
  // freeze,
  // indent,
  // namespaceToStringTag,
  // noConflict,
  // preferConst,
  // sanitizeFileName,
  // strict,
  // systemNullSetters,
}

const extensions = [`.mjs`, `.js`, `.json`, `.node`, `.ts`, `.tsx`]

const allowedPackages = [
  `gatsby`, // def want to bundle whatever `gatsby` internals we use

  `@babel/runtime`, // for transpiled packages

  // for reporter
  `gatsby-cli`,
  `convert-hrtime`,
  `progress`,
  `yurnalist`,
  `pretty-error`,
  `chalk`,
  `ansi-styles`,
  `renderkid`, // dep of pretty-error
  `css-select`, // dep of renderkid
  `is-ci`, // shimmed
  `source-map`,
  `supports-color`,

  // for jobs
  `p-defer`,

  // graphql eco
  `graphql`,
  `graphql-compose`,
  `graphql-type-json`,

  `lodash`, // everywhere
  `bluebird`, // everywhere
  `gatsby-worker`, // shimmed
  `cache-manager`, // shimmed as we use LMDB anyway and that wouldn't be used
  `lru-cache`, // shimmed
  `webpack-merge`, // shimmed
  `invariant`, // used by gatsby somewhere - seems small
  `moment`, // ... used by gatsby for Date related resolvers :S
  `true-case-path`, // shimmed
  `fs-extra`, // everywhere, tho we probably shouldn't need this at all (maybe refactor could get rid of this)
  `graceful-fs`, // dep of fs-extra

  // schema building uses redux, query execution uses it - bundling for now, but would be nice to untangle it at some point
  `redux`,
  `redux-thunk`,

  `@babel/code-frame`, // used in couple places ...
  `@babel/highlight`, // dep of @babel/code-grame
  `@babel/helper-validator-identifier`, // dep of @babel/highlight

  `uuid`, // use to generate uuid for activities and jobs

  // used for node,page,config validation (that could be skipped/shimmed as it won't be used), but also to validate structured error (maybe we could just shim there to always pass validation without doing validation)
  // below `joi` are its deps
  `joi`,
  "@hapi/hoek",
  "@hapi/topo",
  "@sideway/address",
  "@sideway/formula",
  "@sideway/pinpoint",

  "opentracing", // shimmed
  `glob`,
]

const skipDedupe = [`joi`]

const forSureExternals = [
  `lmdb-store`, // native bindings - maybe we can bundle it and make it work given same env, but for now marked as external so would need to be installed at location where queryEngine would be executed
  // `joi`,

  // https://github.com/rollup/rollup/issues/1507#issuecomment-340550539
  "readable-stream",
  "readable-stream/transform",

  ...builtinModules,
]

export async function createGraphqlEngineBundle(): Promise<any> {
  const schemaSnapshotString = await fs.readFile(
    process.cwd() + `/.cache/schema.gql`,
    `utf-8`
  )

  const unknownExternalImports = new Set<string>()

  const inputOptions = {
    // core input options
    // external: [`lmdb-store`, `yoga-layout-prebuilt`, `gatsby-cli`],
    external: id => {
      if (id.includes(`?commonjs-dynamic-register`)) {
        console.log(`dynamic "${id}`)
        return false
      }

      const match = id.match(/node_modules\/(.+)$/)
      if (match && Array.isArray(match) && match.length >= 2) {
        const pkgName = match[1]
        // if (forSureExternals.includes(pkgName)) {
        //   return true
        // }
        for (const external of forSureExternals) {
          if (id.includes(`node_modules/${external}/`)) {
            // console.log(`marking ${id} as internal (because "${allowed}")`)
            return true
          }
        }

        // if (allowedPackages.includes(pkgName)) {
        //   return false
        // }
        for (const allowed of allowedPackages) {
          if (id.includes(`node_modules/${allowed}/`)) {
            // console.log(`marking ${id} as internal (because "${allowed}")`)
            return false
          }
        }

        // console.log(`marking ${id} as external`)
        unknownExternalImports.add(pkgName)
        return false
      }

      // console.log(`marking ${id} as internal`)
      return false
    },
    input: path.join(__dirname, `entry.js`), // conditionally required
    plugins: [
      replace({
        values: {
          SCHEMA_SNAPSHOT: JSON.stringify(schemaSnapshotString),
          "process.env.GATSBY_EXPERIMENTAL_LMDB_STORE": "true",
          "process.env.GATSBY_LOGGER": JSON.stringify("yurnalist"),

          // https://github.com/rollup/rollup/issues/1507#issuecomment-340550539
          "require('readable-stream/transform')": "require('stream').Transform",
          'require("readable-stream/transform")': 'require("stream").Transform',
          "readable-stream": "stream",

          // silly glob - https://github.com/isaacs/node-glob/pull/438
          "var Glob = require('./glob.js').Glob": "",

          // require.resolve is not touched - I'm not sure how to handle it yet :/ but for demo we shouldn't need this code to function, just not to crash
          "require.resolve": "",
          "process.env.GATSBY_SKIP_WRITING_SCHEMA_TO_FILE": "true",
        },
        preventAssignment: true,
        // FIXME - replace plugin by default will not replace if we try to access something nested
        // (for example `process.env.GATSBY_LOGGER.includes('yurnalist')`). This pretty much disable
        // delimiters but it rather should be set to something correct
        // ref: https://github.com/rollup/plugins/tree/master/packages/replace#word-boundaries
        delimiters: [``, ``],
      }),
      {
        name: `null-and-shim-loader`,
        resolveId(source, importer): any {
          if (
            source === `babel-runtime/helpers/asyncToGenerator` &&
            importer &&
            importer.includes(`node_modules/yurnalist`)
          ) {
            return `null`
          }

          // if (source === `joi`) {
          //   console.log(
          //     `----------\bJOI IS SETTING TO joi/lib/index.js\n---------`
          //   )
          //   return `joi/lib/index.js`
          // } else if (source.includes(`joi`)) {
          //   console.log(`[[[`, { source, importer })
          // }

          return null
        },
        load(id): any {
          if (id === `null`) {
            return { code: `` }
          }

          if (
            id === `electron` ||
            id === `electron?commonjs-external` ||
            id.includes(`electron`)
          ) {
            console.log(`--- null-loading "${id}"`)
            return { code: `export default null` }
          }

          if (id.includes(`/loggers/ink/index.js`)) {
            return {
              code: `export function initializeINKLogger() {}; export default { initializeINKLogger }`,
            }
          }

          if (id.includes(`gatsby-worker`)) {
            return {
              code: `export function getMessenger() { return null }; export default { getMessenger }`,
            }
          }

          if (id.includes(`is-ci`)) {
            return {
              code: `export default true`,
            }
          }

          if (id.includes(`cache-manager`)) {
            return {
              code: `export default true`,
            }
          }

          if (id.includes(`lru-cache`)) {
            return {
              code: `export default class LRUCache {}`,
            }
          }

          if (id.includes(`webpack-merge`)) {
            return {
              code: `export default true`,
            }
          }

          if (id.includes(`true-case-path`)) {
            return {
              code: `export const trueCasePathSync = true; export default { trueCasePathSync } `,
            }
          }

          if (id.includes(`opentracing`)) {
            return {
              code: `export function globalTracer() { return { startSpan() { return { finish() {} } } } } ; export default {globalTracer}`,
            }
          }

          if (id.includes(`show-analytics-notification`)) {
            return {
              code: `export function showAnalyticsNotification() {} ; export default {showAnalyticsNotification}`,
            }
          }

          return null
        },
      },
      json({ namedExports: false }),
      // {
      //   name: `graphql-test`,
      //   resolveId(source, importer) {
      //     if (importer && importer.includes(`graphqlVersion`)) {
      //       debugger
      //     }

      //     console.log({ source, importer })

      //     if (source === `../graphql`) {
      //       debugger
      //     }
      //   },
      // },
      resolve({
        // extensions,
        preferBuiltins: true,
        dedupe: allowedPackages.filter(
          pkgName => !skipDedupe.includes(pkgName)
        ),
      }),
      commonjs({
        extensions,
        transformMixedEsModules: true,
        requireReturnsDefault: id => {
          if (id && id.includes(`ci-info/vendors.json`)) {
            return true
          }
          return false
        },
        dynamicRequireTargets: [
          `**/node_modules/joi/lib/**/*.js`, // https://github.com/rollup/plugins/issues/731
        ],
      }),
      visualizer(),
    ],

    // advanced input options
    // cache,
    // onwarn,
    // onwarn({ loc, frame, message }) {
    //   if (loc) {
    //     console.warn(`${loc.file} (${loc.line}:${loc.column}) ${message}`)
    //     if (frame) console.warn(frame)
    //   } else {
    //     console.warn(message)
    //   }
    // },
    // preserveEntrySignatures,
    // strictDeprecations,

    // danger zone
    // acorn,
    // acornInjectPlugins,
    // context,
    // moduleContext,
    // preserveSymlinks,
    // shimMissingExports,
    // treeshake,

    // experimental
    // experimentalCacheExpiry,
    // perf,
  }

  const bundle = await rollup.rollup(inputOptions)

  const modulesMap = bundle.cache.modules.reduce((acc, o) => {
    acc[o.id] = o
    return acc
  }, {})

  for (const mod of bundle.cache.modules) {
    mod.depModules = {}
    for (const dep of mod.dependencies) {
      const depModule = modulesMap[dep]

      if (!depModule) {
        // throw new Error(`"${dep}" is not in module map`)
        continue
      }

      mod.depModules[dep] = depModule

      if (!depModule.dependants) {
        depModule.dependants = []
        depModule.dependantModules = {}
      }

      depModule.dependants.push(mod.id)
      depModule.dependantModules[mod.id] = mod
    }
  }

  const { output } = await bundle.write(outputOptions)

  console.log({
    imports: output[0].imports,
    unknownExternalImports: Array.from(unknownExternalImports).sort(),
  })
  debugger
  return { modulesMap, modules: output[0].modules }
}
