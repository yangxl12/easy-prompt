/**
 * Pure helper functions for optimistic FileNode tree mutations.
 * These avoid a full readTree() IPC round-trip after every create/rename/delete
 * by updating the in-memory tree directly. The polling watcher will eventually
 * sync, so any drift is self-correcting within 1.5 s.
 */

import type { FileNode } from '@shared/types'

/**
 * Insert a new child node under `parentPath` into the tree, keeping the
 * sort order (folders first, then alphabetically with numeric awareness).
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
    children.sort(cmpNode)
    return { ...node, children }
  })
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
    path: node.path.replace(oldPrefix, newPrefix)
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
 */export function removeNodeFromTree(
  tree: FileNode,
  nodePath: string
): FileNode | null {
  // If the root itself is being removed, return null.
  if (tree.path === nodePath) return null
  return mapNode(tree, (node) => {
    if (node.kind !== 'folder' || !node.children) return node
    const filtered = node.children.filter(
      (child) => child.path !== nodePath && !child.path.startsWith(nodePath + '/')
    )
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

/** Comparator: folders first, then alphanumeric. */
function cmpNode(a: FileNode, b: FileNode): number {
  if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
  return a.name.localeCompare(b.name, undefined, { numeric: true })
}
