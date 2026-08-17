/**
 * Pure helper functions for optimistic FileNode tree mutations.
 * These avoid a full readTree() IPC round-trip after every create/rename/delete
 * by updating the in-memory tree directly. The polling watcher will eventually
 * sync, so any drift is self-correcting within 1.5 s.
 */

import type { FileNode } from '@shared/types'

/**
 * Insert a new child node under `parentPath` into the tree. New nodes are
 * appended; the workspace store applies the persisted sibling order when the
 * watcher sends a fresh tree.
 * Returns a new tree; the original is not mutated.
 */
export function insertNode(
  tree: FileNode,
  parentPath: string,
  newNode: FileNode
): FileNode {
  return mapNode(tree, (node) => {
    if (node.path !== parentPath || node.kind !== 'folder') return node
    const children = [...(node.children ?? [])]
    children.push(newNode)
    return { ...node, children }
  })
}

/** A persisted sibling order, keyed by the containing folder path. */
export type TreeOrder = Record<string, string[]>

/** Apply persisted sibling order while keeping folders above files. */
export function applyTreeOrder(tree: FileNode, order: TreeOrder): FileNode {
  const apply = (node: FileNode): FileNode => {
    if (node.kind !== 'folder' || !node.children) return node

    const orderForFolder = order[node.path] ?? []
    const rank = new Map(orderForFolder.map((path, index) => [path, index]))
    const children = node.children
      .map((child, index) => ({ child, index }))
      .sort((a, b) => {
        if (a.child.kind !== b.child.kind) return a.child.kind === 'folder' ? -1 : 1
        const aRank = rank.get(a.child.path)
        const bRank = rank.get(b.child.path)
        if (aRank !== undefined && bRank !== undefined) return aRank - bRank
        if (aRank !== undefined) return -1
        if (bRank !== undefined) return 1
        return a.index - b.index
      })
      .map(({ child }) => apply(child))

    return { ...node, children }
  }

  return apply(tree)
}

/**
 * Merge a fresh filesystem tree into the known order. Existing children keep
 * their positions; paths not seen before are appended in the watcher order.
 */
export function mergeTreeOrder(
  previous: FileNode | null,
  next: FileNode,
  knownOrder: TreeOrder
): TreeOrder {
  const merged: TreeOrder = { ...knownOrder }

  const visit = (previousNode: FileNode | null, nextNode: FileNode): void => {
    if (nextNode.kind !== 'folder') return
    const nextChildren = nextNode.children ?? []
    const nextPaths = new Set(nextChildren.map((child) => child.path))
    const previousPaths = previousNode?.children?.map((child) => child.path) ?? []
    const existing = merged[nextNode.path] ?? previousPaths
    const kept = existing.filter((path) => nextPaths.has(path))
    const appended = nextChildren
      .map((child) => child.path)
      .filter((path) => !kept.includes(path))
    merged[nextNode.path] = [...kept, ...appended]

    for (const child of nextChildren) {
      const previousChild = previousNode?.children?.find((item) => item.path === child.path) ?? null
      visit(previousChild, child)
    }
  }

  visit(previous, next)
  return merged
}

/** Reorder two direct siblings. Returns null when the target is not a sibling. */
export function moveNodeInTree(
  tree: FileNode,
  sourcePath: string,
  targetPath: string,
  before: boolean
): FileNode | null {
  let moved = false

  const moveIn = (node: FileNode): FileNode => {
    if (node.kind !== 'folder' || !node.children || moved) return node
    const sourceIndex = node.children.findIndex((child) => child.path === sourcePath)
    const targetIndex = node.children.findIndex((child) => child.path === targetPath)
    if (sourceIndex === -1 || targetIndex === -1 || sourcePath === targetPath) {
      return { ...node, children: node.children.map(moveIn) }
    }

    const children = [...node.children]
    const [source] = children.splice(sourceIndex, 1)
    const nextTargetIndex = children.findIndex((child) => child.path === targetPath)
    const insertionIndex = before ? nextTargetIndex : nextTargetIndex + 1
    children.splice(insertionIndex, 0, source)

    // Preserve the folder-first invariant while keeping the requested order
    // inside each kind.
    const folders = children.filter((child) => child.kind === 'folder')
    const files = children.filter((child) => child.kind === 'file')
    moved = true
    return { ...node, children: [...folders, ...files] }
  }

  const result = moveIn(tree)
  return moved ? result : null
}

/** Return the containing folder path for a direct child. */
export function findParentPath(tree: FileNode, childPath: string): string | null {
  if (tree.kind !== 'folder') return null
  if (tree.children?.some((child) => child.path === childPath)) return tree.path
  for (const child of tree.children ?? []) {
    const parent = findParentPath(child, childPath)
    if (parent) return parent
  }
  return null
}

/**
 * Rename a node at `oldPath` to `newPath` / `newName`.
 * Returns a new tree; the original is not mutated.
 */
export function renameNodeInTree(
  tree: FileNode,
  oldPath: string,
  newPath: string,
  newName: string
): FileNode {
  return mapNode(tree, (node) => {
    if (node.path !== oldPath) return node
    const updated: FileNode = { ...node, path: newPath, name: newName }
    // If it's a folder, rename all descendant paths too.
    if (updated.kind === 'folder' && updated.children) {
      updated.children = updated.children.map((child) =>
        renameDescendant(child, oldPath, newPath)
      )
    }
    return updated
  })
}

/** Rename paths for all descendants after a folder rename. */
function renameDescendant(
  node: FileNode,
  oldPrefix: string,
  newPrefix: string
): FileNode {
  const renamed: FileNode = {
    ...node,
    path: newPrefix + node.path.slice(oldPrefix.length)
  }
  if (renamed.kind === 'folder' && renamed.children) {
    renamed.children = renamed.children.map((child) =>
      renameDescendant(child, oldPrefix, newPrefix)
    )
  }
  return renamed
}

/**
 * Remove the node at `nodePath` and all its descendants from the tree.
 * Returns a new tree; the original is not mutated.
 */
export function removeNodeFromTree(
  tree: FileNode,
  nodePath: string
): FileNode | null {
  // If the root itself is being removed, return null.
  if (tree.path === nodePath) return null
  return mapNode(tree, (node) => {
    if (node.kind !== 'folder' || !node.children) return node
    const filtered = node.children.filter((child) => !isPathWithin(nodePath, child.path))
    if (filtered.length === node.children.length) return node
    return { ...node, children: filtered }
  })
}

/* ------------------------------------------------------------------ */
/*  Internals                                                          */
/* ------------------------------------------------------------------ */

/** Find a node by exact path, or null if it's not in the tree. */
export function findNode(tree: FileNode, path: string): FileNode | null {
  if (tree.path === path) return tree
  for (const child of tree.children ?? []) {
    const found = findNode(child, path)
    if (found) return found
  }
  return null
}

/** Apply a transformation to every node in the tree, returning the new tree. */
function mapNode(
  node: FileNode,
  fn: (n: FileNode) => FileNode
): FileNode {
  const mapped = fn(node)
  if (mapped.kind === 'folder' && mapped.children) {
    const children = mapped.children.map((child) => mapNode(child, fn))
    if (children !== mapped.children) {
      return { ...mapped, children }
    }
  }
  return mapped
}

function isPathWithin(parentPath: string, childPath: string): boolean {
  if (childPath === parentPath) return true
  const separator = parentPath.includes('\\') ? '\\' : '/'
  const prefix = parentPath.endsWith(separator) ? parentPath : `${parentPath}${separator}`
  return childPath.startsWith(prefix)
}
