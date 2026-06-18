import { useConfigStore } from '../store/config'

/**
 * The absolute path to the workspace root, from the loaded config.
 * Returns empty string until config is hydrated.
 */
export function useWorkspaceRoot(): string {
  return useConfigStore((s) => s.config.app.workspace)
}
