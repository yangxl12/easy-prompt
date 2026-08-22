import { useCallback, useMemo, useState } from 'react'
import { imageToPrompt } from '../services/ai'
import { useConfigStore } from '../store/config'

/**
 * Detects image pastes inside the CodeMirror editor. The editor calls
 * `onPasteImage(file)` (wired via a CodeMirror DOM-event handler so we run
 * *before* CodeMirror's own paste handling). We then expose the captured data
 * URL so the UI can show the "convert UI image to prompt" banner.
 *
 * The pasted image is NOT inserted into the editor — we intercept the paste so
 * we can offer the AI conversion affordance first.
 *
 * Large screenshots are downsampled before being captured, so the data URL we
 * send over IPC + HTTP stays small (the original resolution is rarely needed
 * for a UI description and a multi-MB base64 string would risk stalling IPC).
 */
export interface ImageState {
  /** Captured image data URL, or null when nothing relevant is pasted. */
  dataUrl: string | null
  busy: boolean
  error: string | null
}

/** Downscale an image file into a compact JPEG data URL. */
async function shrinkImage(file: File, maxSize = 1600, quality = 0.85): Promise<string> {
  // Downsample via an offscreen <img> + <canvas>. Wrapped in a Promise because
  // image decode is callback-based.
  const bitmap = await loadImage(file)
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  ctx.drawImage(bitmap, 0, 0, w, h)
  return canvas.toDataURL('image/jpeg', quality)
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = (): void => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = (): void => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to decode pasted image'))
    }
    img.src = url
  })
}

export function useImagePaste(): ImageState & {
  /** Captured image size in KB (rounded), for the banner's "约 320KB" hint. */
  sizeKB: number
  /** Hand a pasted image File from the editor's paste handler. */
  onPasteImage: (file: File) => void
  dismiss: () => void
  convert: () => Promise<string | null>
  /** Re-run conversion against the already-captured dataUrl. Keeps error/dataUrl so the banner survives a failure. */
  retry: () => Promise<string | null>
} {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onPasteImage = useCallback((file: File): void => {
    void shrinkImage(file)
      .then((url) => {
        setDataUrl(url)
        setError(null)
      })
      .catch((err: Error) => {
        setError(err.message)
      })
  }, [])

  const dismiss = useCallback((): void => {
    setDataUrl(null)
    setError(null)
  }, [])

  const convert = useCallback(async (): Promise<string | null> => {
    if (!dataUrl) return null
    setBusy(true)
    setError(null)
    try {
      // Fresh config snapshot — the active model may have changed since the
      // image was captured.
      const config = useConfigStore.getState().config
      const prompt = await imageToPrompt(config, dataUrl)
      return prompt
    } catch (err) {
      setError((err as Error).message)
      return null
    } finally {
      setBusy(false)
    }
  }, [dataUrl])

  const retry = useCallback(async (): Promise<string | null> => {
    // Same as convert, but kept separate so callers can express intent
    // ("retry this failed conversion") without re-binding dataUrl closures.
    return convert()
  }, [convert])

  // Approx decoded size in KB for the banner hint. data URLs are roughly
  // "data:image/jpeg;base64,<b64>" — decoded ≈ b64chars * 0.75.
  const sizeKB = useMemo(() => {
    if (!dataUrl) return 0
    const comma = dataUrl.indexOf(',')
    const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
    return Math.ceil((b64.length * 0.75) / 1024)
  }, [dataUrl])

  return { dataUrl, sizeKB, busy, error, onPasteImage, dismiss, convert, retry }
}
