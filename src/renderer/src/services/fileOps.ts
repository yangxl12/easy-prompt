/**
 * Thin convenience wrappers around `window.api` for common file operations.
 * Keeps components free of repetitive try/catch and path handling.
 */

import type { FileNode } from '@shared/types'

export function readFileSync(path: string): Promise<string> {
  return window.api.readFile(path)
}

export async function writeFile(path: string, content: string): Promise<void> {
  await window.api.writeFile(path, content)
}

export async function createFile(dir: string, name: string): Promise<string> {
  return window.api.createFile(dir, name)
}

export async function createFolder(dir: string, name: string): Promise<string> {
  return window.api.createFolder(dir, name)
}

export async function renameNode(path: string, newName: string): Promise<string> {
  return window.api.rename(path, newName)
}

export async function deleteNode(path: string): Promise<void> {
  await window.api.remove(path)
}

export async function copyNode(path: string): Promise<string> {
  return window.api.copy(path)
}

export async function showInFolder(path: string): Promise<void> {
  await window.api.showInFolder(path)
}

export function readTree(): Promise<FileNode> {
  return window.api.readTree()
}

/** Subscribe to workspace tree changes. Returns an unsubscribe fn. */
export function watchTree(cb: (tree: FileNode) => void): () => void {
  return window.api.watchWorkspace(cb)
}
