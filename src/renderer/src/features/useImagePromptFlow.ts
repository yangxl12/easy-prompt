import { useCallback, useRef, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkspaceStore, tabContent } from '../store/workspace'
import { newDraftPath } from '../services/drafts'
import { useImagePaste } from './useImageToPrompt'

/**
 * Image→prompt workflow orchestration: a single image ingress shared by paste,
 * drop and the file picker, the conversion call, and splicing the generated
 * prompt into the active document.
 *
 * When no tab is open, an image ingress first creates a fresh draft tab so the
 * result has somewhere to land.
 */
export function useImagePromptFlow(): {
  image: ReturnType<typeof useImagePaste>
  /** Image ingress shared by paste + drop + file picker. */
  handleImageFile: (file: File) => void
  /** Convert the captured image and append the generated prompt to the document. */
  handleConvertImage: () => Promise<void>
  /** Clipboard-first image pickup with a native file-picker fallback. */
  pickImage: () => Promise<void>
  /** Backing element for the hidden file picker input. */
  fileInputRef: RefObject<HTMLInputElement>
} {
  const { t } = useTranslation()
  const tabs = useWorkspaceStore((s) => s.tabs)
  const activePath = useWorkspaceStore((s) => s.activePath)
  const openFile = useWorkspaceStore((s) => s.openFile)
  const edit = useWorkspaceStore((s) => s.edit)
  const activeTab = tabs.find((tb) => tb.path === activePath) ?? null
  const content = tabContent(activeTab ?? undefined)
  const image = useImagePaste()

  /**
   * Image ingress shared by paste + drop + file picker. When no tab is open,
   * dropping creates a fresh draft tab first so the result has somewhere to land.
   */
  const handleImageFile = useCallback(
    (file: File): void => {
      if (!activeTab) {
        openFile(newDraftPath(), t('editor.untitled'), '')
      }
      image.onPasteImage(file)
    },
    [activeTab, openFile, image, t]
  )

  const handleConvertImage = useCallback(async (): Promise<void> => {
    if (!activeTab || image.busy) return
    // Capture the data URL BEFORE convert(): convert() does not clear it, but
    // capturing up front keeps this handler robust against any future change.
    const keptDataUrl = image.dataUrl
    const prompt = await image.convert()
    // On failure, DO NOT dismiss — keep the banner + error so the user can see
    // what went wrong and retry. Only clear state on success.
    if (!prompt) return
    let next = prompt
    if (keptDataUrl) {
      // Inline the image before the generated prompt so the doc stays visual.
      next = `![pasted-ui.png](${keptDataUrl})\n\n${prompt}`
    }
    const updated = content ? `${content}\n\n${next}` : next
    edit(activeTab.path, updated)
    image.dismiss()
  }, [activeTab, image, content, edit])

  /**
   * Pick an image: try the system clipboard first (so the common "screenshot
   * then click the button" flow is one click), and fall back to a native file
   * picker when the clipboard has no image or read access is denied. Files are
   * routed through the same `handleImageFile` ingress as paste/drop.
   */
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pickImage = useCallback(async (): Promise<void> => {
    // 1. Try the system clipboard.
    try {
      const items = await navigator.clipboard.read()
      for (const item of items) {
        const imageType = item.types.find((tp) => tp.startsWith('image/'))
        if (imageType) {
          const blob = await item.getType(imageType)
          handleImageFile(new File([blob], 'pasted.png', { type: imageType }))
          return
        }
      }
    } catch {
      // No clipboard image or permission denied — fall through to the picker.
    }
    // 2. Fall back to a native file picker. We trigger it from the ref rather
    // than constructing a fresh <input> each click so we stay uncontrolled.
    fileInputRef.current?.click()
  }, [handleImageFile])

  return { image, handleImageFile, handleConvertImage, pickImage, fileInputRef }
}
