import { useConfigStore } from '../store/config'

/** The active workspace root as an absolute path; empty before config loads. */
export function useWorkspaceRoot(): string {
  return useConfigStore((s) => s.config.app.workspace)
}
