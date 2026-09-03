import { create } from 'zustand'
import { createTabsSlice, type TabsSlice } from './tabs'
import { createFileTreeSlice, type FileTreeSlice } from './fileTree'

/**
 * Workspace store — composition of independent slices:
 *  - `tabs` (./tabs.ts): the tab state machine (open/close/rename, edit state).
 *  - `fileTree` (./fileTree.ts): tree data, persisted ordering/markers, tree UI state.
 *
 * Slices never write each other's fields, so they stay independently
 * understandable while sharing one store instance for callers.
 */
export type WorkspaceState = TabsSlice & FileTreeSlice

export const useWorkspaceStore = create<WorkspaceState>()((...a) => ({
  ...createTabsSlice(...a),
  ...createFileTreeSlice(...a)
}))

// Re-exports so existing callers keep their import paths stable.
export type { Tab, RevealTarget } from './tabs'
export { tabContent } from './tabs'
export type { FileMarker } from './fileTree'
