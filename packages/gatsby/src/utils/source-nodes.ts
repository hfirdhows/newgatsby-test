import report from "gatsby-cli/lib/reporter"
import { Span } from "opentracing"
import { sourceNodesApiRunner } from "./source-nodes-api-runner"
import { store, emitter } from "../redux"
import { getDataStore, getNode } from "../datastore"
import { actions } from "../redux/actions"
import { IGatsbyState, IGatsbyNode } from "../redux/types"
import type { GatsbyIterable } from "../datastore/common/iterable"

const { deleteNode } = actions

/**
 * Finds the name of all plugins which implement Gatsby APIs that
 * may create nodes, but which have not actually created any nodes.
 */
function discoverPluginsWithoutNodes(
  storeState: IGatsbyState,
  nodes: GatsbyIterable<IGatsbyNode>
): Array<string> {
  // Find out which plugins own already created nodes
  const nodeOwnerSet = new Set([`default-site-plugin`])
  nodes.forEach(node => nodeOwnerSet.add(node.internal.owner))

  return storeState.flattenedPlugins
    .filter(
      plugin =>
        // "Can generate nodes"
        plugin.nodeAPIs.includes(`sourceNodes`) &&
        // "Has not generated nodes"
        !nodeOwnerSet.has(plugin.name)
    )
    .map(plugin => plugin.name)
}

/**
 * Warn about plugins that should have created nodes but didn't.
 */
function warnForPluginsWithoutNodes(
  state: IGatsbyState,
  nodes: GatsbyIterable<IGatsbyNode>
): void {
  const pluginsWithNoNodes = discoverPluginsWithoutNodes(state, nodes)

  pluginsWithNoNodes.map(name =>
    report.warn(
      `The ${name} plugin has generated no Gatsby nodes. Do you need it? This could also suggest the plugin is misconfigured.`
    )
  )
}

/**
 * Return the set of nodes for which its root node has not been touched
 */
function getStaleNodes(
  state: IGatsbyState,
  nodes: GatsbyIterable<IGatsbyNode>
): GatsbyIterable<IGatsbyNode> {
  return nodes.filter(node => {
    let rootNode = node
    let next: IGatsbyNode | undefined = undefined

    let whileCount = 0
    do {
      next = rootNode.parent ? getNode(rootNode.parent) : undefined
      if (next) {
        rootNode = next
      }
    } while (next && ++whileCount < 101)

    if (whileCount > 100) {
      console.log(
        `It looks like you have a node that's set its parent as itself`,
        rootNode
      )
    }

    return !state.nodesTouched.has(rootNode.id)
  })
}

/**
 * Find all stale nodes and delete them
 */
function deleteStaleNodes(
  state: IGatsbyState,
  nodes: GatsbyIterable<IGatsbyNode>
): void {
  const staleNodes = getStaleNodes(state, nodes)

  staleNodes.forEach(node => store.dispatch(deleteNode(node)))
}

let isInitialSourcing = true
let sourcingCount = 0

const changedNodes = {
  deleted: new Map(),
  created: new Map(),
  updated: new Map(),
}

emitter.on(`DELETE_NODE`, action => {
  if (action.payload?.id) {
    changedNodes.deleted.set(action.payload.id, { node: action.payload })
  }
})

emitter.on(`CREATE_NODE`, action => {
  // If this node was deleted before being recreated, remove it from the deleted node list
  changedNodes.deleted.delete(action.payload.id)

  if (action.oldNode?.id) {
    changedNodes.updated.set(action.payload.id, {
      oldNode: action.oldNode,
      node: action.payload,
    })
  } else {
    changedNodes.created.set(action.payload.id, { node: action.payload })
  }
})

export default async ({
  webhookBody,
  pluginName,
  parentSpan,
  deferNodeMutation = false,
}: {
  webhookBody: unknown
  pluginName?: string
  parentSpan?: Span
  deferNodeMutation?: boolean
}): Promise<void> => {
  changedNodes.deleted.clear()
  changedNodes.created.clear()
  changedNodes.updated.clear()

  const traceId = isInitialSourcing
    ? `initial-sourceNodes`
    : `sourceNodes #${sourcingCount}`
  await sourceNodesApiRunner({
    traceId,
    deferNodeMutation,
    parentSpan,
    webhookBody,
    pluginName,
  })

  await getDataStore().ready()

  console.log({ changedNodes })

  store.dispatch({
    type: `SET_CHANGED_NODES`,
    payload: changedNodes,
  })

  // We only warn for plugins w/o nodes and delete stale nodes on the first sourcing.
  if (isInitialSourcing) {
    const state = store.getState()
    const nodes = getDataStore().iterateNodes()

    warnForPluginsWithoutNodes(state, nodes)

    deleteStaleNodes(state, nodes)
    isInitialSourcing = false
  }

  store.dispatch(actions.apiFinished({ apiName: `sourceNodes` }))

  sourcingCount += 1
}
