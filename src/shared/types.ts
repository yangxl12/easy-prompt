/**
 * Shared domain types — the single source of truth for the whole app.
 * Imported by main, preload, and renderer.
 */

/* ---------- AI configuration ---------- */

/** AI provider presets shipped with the app. */
export type AIProvider = 'deepseek' | 'zhipu' | 'openai-compatible'

/** A single model configuration the user can edit / switch between. */
export interface AIModelConfig {
  /** Stable unique id (uuid-ish). */
  id: string
  /** Display name shown in settings, e.g. "DeepSeek (主力)". */
  name: string
  provider: AIProvider
  /** OpenAI-compatible base URL, e.g. https://api.deepseek.com/v1 */
  baseURL: string
  /** Bearer token. Encrypted at rest in main process. */
  apiKey: string
  /** Model id used for text tasks (optimize prompt). */
  textModel: string
  /** Model id used for vision tasks (image -> prompt). May equal textModel. */
  visionModel: string
}

export interface AISettings {
  models: AIModelConfig[]
  /** Which model in `models` is active. Empty string = none. */
  currentModelId: string
}

/* ---------- App / general settings ---------- */

export type ThemeMode = 'light' | 'dark' | 'system'
export type Language = 'zh-CN' | 'en-US'

/** Default action when AI optimize completes. */
export type OptimizeDefaultAction = 'overwrite' | 'keep' | 'ask'

export interface AppSettings {
  theme: ThemeMode
  language: Language
  /** Absolute path to the folder where prompts are stored. */
  workspace: string
  /** Global accelerator for summoning the window. */
  shortcut: string
  /** Auto-save edits after a short debounce. When off, Ctrl+S saves manually. */
  autoSave: boolean
  /** Default behavior when "Optimize prompt" completes. 'ask' shows a dialog. */
  optimizeDefaultAction: OptimizeDefaultAction
  /** Whether to show the Markdown preview pane alongside the editor. */
  showPreview: boolean
  /** Whether the file sidebar is collapsed. */
  sidebarCollapsed: boolean
  /** Whether to show the "Optimize entire file" button in the toolbar. */
  showOptimizeWholeFile: boolean
}

/** The whole persisted config blob. */
export interface AppConfig {
  app: AppSettings
  ai: AISettings
  /** schema version for future migrations. */
  schemaVersion: number
}

/**
 * A config patch accepted by `patchConfig`. One level deeper than
 * `Partial<AppConfig>` so callers can update e.g. just `app.theme`.
 */
export interface AppConfigPatch {
  app?: Partial<AppSettings>
  ai?: AISettings
  schemaVersion?: number
}

/* ---------- File system ---------- */

export type FileNodeKind = 'file' | 'folder'

export interface FileNode {
  /** Absolute path. */
  path: string
  name: string
  kind: FileNodeKind
  /** Only present for folders, sorted: folders first then files. */
  children?: FileNode[]
}

/* ---------- Workspace-wide content search ---------- */

/** Options for a workspace search. Mirrors the panel's toggles. */
export interface SearchOptions {
  /** The needle: plain text or a regex source when `useRegex` is set. */
  query: string
  caseSensitive?: boolean
  /** Match only whole words (CJK-aware: neighbours must not be word chars). */
  wholeWord?: boolean
  /** Treat `query` as a JavaScript regex source. */
  useRegex?: boolean
}

/** A single hit inside a file. */
export interface SearchMatch {
  /** 1-based line number. */
  line: number
  /** 0-based column of the match start, measured in code units. */
  column: number
  /** Length of the matched text in code units. */
  length: number
  /** The full line text (truncated for very long lines). */
  lineText: string
}

/** All hits inside one file, plus a display name for the renderer. */
export interface SearchFileResult {
  /** Absolute path — used to open the file. */
  path: string
  /** File name (last segment). */
  name: string
  matches: SearchMatch[]
}

/** Result of one search run, correlated back by `searchId`. */
export interface SearchResult {
  /** Echoes the id supplied by the caller; stale responses can be dropped. */
  searchId: string
  files: SearchFileResult[]
  totalMatches: number
  /** Number of files scanned (for the status line). */
  scannedFiles: number
  /** True when a cap was hit and the result set is partial. */
  truncated: boolean
  /** True when the run was superseded/cancelled by a newer search. */
  cancelled: boolean
}

/* ---------- IPC contracts ---------- */

/** AI task discriminator. Vision uses image_url content, text is pure chat. */
export type AITask = 'text' | 'vision'

export interface AICallRequest {
  /** id of the model to use (must exist in settings.ai.models). */
  modelId: string
  task: AITask
  /** System instruction. */
  systemPrompt: string
  /** Plain text user content (for text task). */
  userText?: string
  /** Data-URL image(s), e.g. "data:image/png;base64,...." (for vision task). */
  images?: string[]
  /** When true, stream tokens back via the `ai:stream-chunk` event. Default false. */
  stream?: boolean
  /**
   * Client-generated id used to correlate streamed chunks with this request.
   * Required when `stream` is true; main echoes it back on every chunk.
   */
  streamId?: string
}

/** Payload for the `ai:stream-chunk` webContents event during a streamed call. */
export interface AIStreamChunk {
  /** The id of the in-flight streamed call (matches the call's request id). */
  id: string
  /** Delta text produced since the last chunk. */
  delta: string
  /** True on the final chunk, after which no more chunks arrive. */
  done: boolean
  /** Set when the call errored; present only on the final chunk. */
  error?: string
}

export interface AICallResult {
  content: string
  /** Present only when the call was streamed; lets the renderer match it. */
  streamId?: string
}

/** Error shape returned over IPC (Error cannot be cloned directly). */
export interface IPCError {
  message: string
}

/* ---------- IPC channel names (shared constants) ---------- */
export const IPC = {
  // settings / config
  CONFIG_GET: 'config:get',
  CONFIG_SET: 'config:set',
  CONFIG_SET_PARTIAL: 'config:set-partial',
  // fs
  FS_READ_TREE: 'fs:read-tree',
  FS_READ_FILE: 'fs:read-file',
  FS_WRITE_FILE: 'fs:write-file',
  FS_CREATE_FILE: 'fs:create-file',
  FS_CREATE_FOLDER: 'fs:create-folder',
  FS_RENAME: 'fs:rename',
  FS_DELETE: 'fs:delete',
  FS_COPY: 'fs:copy',
  FS_DELETE_MULTI: 'fs:delete-multi',
  FS_CREATE_SIBLING: 'fs:create-sibling',
  FS_SHOW_IN_FOLDER: 'fs:show-in-folder',
  FS_WATCH: 'fs:watch',
  FS_WATCH_STOP: 'fs:watch-stop',
  FS_SEARCH: 'fs:search',
  FS_SEARCH_CANCEL: 'fs:search-cancel',
  // ai
  AI_CALL: 'ai:call',
  AI_TEST: 'ai:test',
  AI_STREAM_CHUNK: 'ai:stream-chunk',
  AI_CANCEL: 'ai:cancel',
  // workspace
  CONFIG_SELECT_WORKSPACE: 'config:select-workspace',
  CONFIG_CHANGE_WORKSPACE: 'config:change-workspace'
} as const

/**
 * Default accelerator per platform.
 *
 * NOTE: this is a function (not a top-level constant) so the file stays safe to
 * import from the renderer, where `process` is undefined. Callers in the main
 * process pass `process.platform`; the renderer reads the stored config value
 * instead and never needs to compute this.
 */
export function defaultShortcut(_platform: NodeJS.Platform): string {
  return 'Shift+P'
}
