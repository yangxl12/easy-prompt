import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { FileNode } from '@shared/types'
import { resolveWorkspacePath, assertNodeName } from './workspacePath'

const MD_EXT = '.md'

/** Hard cap on a single file write (guards against runaway AI output etc.). */
const MAX_WRITE_BYTES = 16 * 1024 * 1024

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

export async function readFileText(root: string, filePath: string): Promise<string> {
  const p = await resolveMd(root, filePath)
  return fs.readFile(p, 'utf-8')
}

export async function writeFileText(
  root: string,
  filePath: string,
  content: string
): Promise<void> {
  const p = await resolveMd(root, filePath)
  if (Buffer.byteLength(content, 'utf-8') > MAX_WRITE_BYTES) {
    fail('Content exceeds the maximum file size')
  }
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, content, 'utf-8')
}

/** Create a file ensuring a unique name if it collides. Returns final path. */
export async function createFile(root: string, dir: string, name: string): Promise<string> {
  const finalName = toMdName(assertNodeName(name))
  const dirAbs = await resolveWorkspacePath(root, dir)
  const target = safe(root, path.join(path.relative(root, dirAbs), finalName))
  const unique = await uniquePath(target)
  await fs.mkdir(path.dirname(unique), { recursive: true })
  await fs.writeFile(unique, '', 'utf-8')
  return unique
}

/** Create a folder ensuring a unique name. Returns final path. */
export async function createFolder(root: string, dir: string, name: string): Promise<string> {
  const dirAbs = await resolveWorkspacePath(root, dir)
  const target = safe(root, path.join(path.relative(root, dirAbs), assertNodeName(name)))
  const unique = await uniquePath(target)
  await fs.mkdir(unique, { recursive: true })
  return unique
}

/**
 * Create `"<name><suffix>.md"` next to `sourcePath` (unique-named) and return
 * its path. Used by "save optimized result as a new file" — the sibling path
 * must be computed here with node:path so Windows separators are handled
 * correctly (the renderer must not parse OS paths).
 */
export async function createSibling(
  root: string,
  sourcePath: string,
  suffix: string
): Promise<string> {
  const src = await resolveMd(root, sourcePath)
  if (/[\\/]|\.\./.test(suffix)) fail('Invalid suffix')
  const dir = path.dirname(src)
  const base = path.basename(src).replace(/\.md$/i, '')
  const finalName = toMdName(`${base}${suffix}`)
  const target = safe(root, path.join(path.relative(root, dir), finalName))
  const unique = await uniquePath(target)
  await fs.mkdir(path.dirname(unique), { recursive: true })
  await fs.writeFile(unique, '', 'utf-8')
  return unique
}

export async function rename(root: string, oldPath: string, newName: string): Promise<string> {
  // Resolve the source through the workspace policy — never trust a string
  // prefix check (e.g. `C:\ws-other` must not pass as inside `C:\ws`).
  const resolved = await resolveWorkspacePath(root, oldPath)
  const dir = path.dirname(resolved)
  const target = safe(root, path.join(path.relative(root, dir), assertNodeName(newName)))
  if (target === resolved) return resolved
  const unique = await uniquePath(target)
  await fs.rename(resolved, unique)
  return unique
}

export async function remove(root: string, filePath: string): Promise<void> {
  const p = await resolveWorkspacePath(root, filePath)
  // Prefer sending to OS trash so deletes are recoverable.
  const { shell } = await import('electron')
  await shell.trashItem(p)
}

/** Copy a file or folder. Folders are copied recursively. */
export async function copy(root: string, src: string): Promise<string> {
  const srcAbs = await resolveWorkspacePath(root, src)
  const dir = path.dirname(srcAbs)
  const ext = path.extname(srcAbs)
  const base = path.basename(srcAbs, ext)
  const suffix = ext || ''
  const newName = `${base} copy${suffix}`
  const target = safe(root, path.join(path.relative(root, dir), newName))
  const unique = await uniquePath(target)
  await copyRecursive(srcAbs, unique)
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

/** Resolve a path within the workspace and require it to be a `.md` file. */
async function resolveMd(root: string, filePath: string): Promise<string> {
  const p = await resolveWorkspacePath(root, filePath)
  if (!p.toLowerCase().endsWith(MD_EXT)) fail('Only Markdown (.md) files are allowed')
  return p
}

/** Ensure a name carries the `.md` extension. */
function toMdName(name: string): string {
  return name.toLowerCase().endsWith(MD_EXT) ? name : `${name}${MD_EXT}`
}
