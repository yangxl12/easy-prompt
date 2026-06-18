import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { FileNode } from '@shared/types'

const MD_EXT = '.md'

/** Throw a typed error with a message string we can send over IPC. */
function fail(message: string): never {
  throw new Error(message)
}

/** Ensure a path resolves inside the workspace root (prevents escape). */
function safe(base: string, target: string): string {
  const resolved = path.resolve(base, target)
  const rel = path.relative(base, resolved)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    fail('Path is outside the workspace')
  }
  return resolved
}

/** Read the workspace tree, sorted (folders first, then by name). */
export async function readTree(root: string): Promise<FileNode> {
  const rootName = path.basename(root) || root
  return walk(root, rootName)
}

async function walk(absPath: string, name: string): Promise<FileNode> {
  const stat = await fs.stat(absPath)
  if (stat.isFile()) {
    return { path: absPath, name, kind: 'file' }
  }
  const entries = await fs.readdir(absPath, { withFileTypes: true })
  const children: FileNode[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue // hide dotfiles
    const childAbs = path.join(absPath, entry.name)
    if (entry.isDirectory()) {
      children.push(await walk(childAbs, entry.name))
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(MD_EXT)) {
      children.push({ path: childAbs, name: entry.name, kind: 'file' })
    }
  }
  children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { numeric: true })
  })
  return { path: absPath, name, kind: 'folder', children }
}

export async function readFileText(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf-8')
}

export async function writeFileText(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, 'utf-8')
}

/** Create a file ensuring a unique name if it collides. Returns final path. */
export async function createFile(root: string, dir: string, name: string): Promise<string> {
  const finalName = name.toLowerCase().endsWith(MD_EXT) ? name : `${name}${MD_EXT}`
  const target = safe(root, path.join(path.relative(root, dir), finalName))
  const unique = await uniquePath(target)
  await fs.mkdir(path.dirname(unique), { recursive: true })
  await fs.writeFile(unique, '', 'utf-8')
  return unique
}

/** Create a folder ensuring a unique name. Returns final path. */
export async function createFolder(root: string, dir: string, name: string): Promise<string> {
  const target = safe(root, path.join(path.relative(root, dir), name))
  const unique = await uniquePath(target)
  await fs.mkdir(unique, { recursive: true })
  return unique
}

export async function rename(root: string, oldPath: string, newName: string): Promise<string> {
  const resolved = oldPath.startsWith(root) ? oldPath : path.join(root, oldPath)
  const dir = path.dirname(resolved)
  const target = safe(root, path.join(path.relative(root, dir), newName))
  if (target === resolved) return resolved
  const unique = await uniquePath(target)
  await fs.rename(resolved, unique)
  return unique
}

export async function remove(filePath: string): Promise<void> {
  // Prefer sending to OS trash so deletes are recoverable.
  const { shell } = await import('electron')
  await shell.trashItem(filePath)
}

/** Copy a file or folder. Folders are copied recursively. */
export async function copy(root: string, src: string): Promise<string> {
  const dir = path.dirname(src)
  const ext = path.extname(src)
  const base = path.basename(src, ext)
  const suffix = ext || ''
  const newName = `${base} copy${suffix}`
  const target = safe(root, path.join(path.relative(root, dir), newName))
  const unique = await uniquePath(target)
  await copyRecursive(src, unique)
  return unique
}

async function copyRecursive(src: string, dest: string): Promise<void> {
  const stat = await fs.stat(src)
  if (stat.isDirectory()) {
    await fs.mkdir(dest, { recursive: true })
    const entries = await fs.readdir(src, { withFileTypes: true })
    for (const entry of entries) {
      await copyRecursive(path.join(src, entry.name), path.join(dest, entry.name))
    }
  } else {
    await fs.copyFile(src, dest)
  }
}

/** Append " 2", " 3"... until a free path is found. */
async function uniquePath(p: string): Promise<string> {
  let candidate = p
  let i = 2
  const ext = path.extname(p)
  const base = path.join(path.dirname(p), path.basename(p, ext))
  while (await exists(candidate)) {
    candidate = `${base} ${i}${ext}`
    i++
  }
  return candidate
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/** Resolve a possibly-relative path against the workspace root. */
export function resolveInWorkspace(root: string, p: string): string {
  if (path.isAbsolute(p)) return p
  return path.join(root, p)
}
