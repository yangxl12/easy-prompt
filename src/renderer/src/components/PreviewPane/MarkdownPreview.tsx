import { useMemo } from 'react'
import { renderMarkdown, HIGHLIGHT_CSS } from '../../services/markdown'

interface MarkdownPreviewProps {
  source: string
}

/**
 * Rendered Markdown preview. Uses dangerouslySetInnerHTML on markdown-it output
 * (we configured the parser with html:false, so user HTML cannot be injected).
 */
export default function MarkdownPreview({ source }: MarkdownPreviewProps): JSX.Element {
  const html = useMemo(() => renderMarkdown(source), [source])

  return (
    <div className="preview-pane h-full overflow-auto px-8 py-6 selectable">
      <style>{PREVIEW_CSS}</style>
      <style>{HIGHLIGHT_CSS}</style>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}

/** Prose styling scoped to .preview-pane. Theme-aware via CSS variables. */
const PREVIEW_CSS = `
.preview-pane { color: rgb(var(--color-text)); font-size: 14px; line-height: 1.7; }
.preview-pane h1, .preview-pane h2, .preview-pane h3, .preview-pane h4 {
  font-weight: 600; line-height: 1.3; margin: 1.4em 0 0.6em;
}
.preview-pane h1 { font-size: 1.6em; border-bottom: 1px solid rgb(var(--color-border)); padding-bottom: 0.3em; }
.preview-pane h2 { font-size: 1.35em; border-bottom: 1px solid rgb(var(--color-border)); padding-bottom: 0.25em; }
.preview-pane h3 { font-size: 1.15em; }
.preview-pane p { margin: 0.7em 0; }
.preview-pane a { color: rgb(var(--color-accent)); text-decoration: none; }
.preview-pane a:hover { text-decoration: underline; }
.preview-pane ul, .preview-pane ol { margin: 0.6em 0; padding-left: 1.6em; }
.preview-pane li { margin: 0.25em 0; }
.preview-pane blockquote {
  margin: 0.8em 0; padding: 0.2em 1em; border-left: 3px solid rgb(var(--color-accent));
  color: rgb(var(--color-text-muted)); background: rgb(var(--color-bg-subtle) / 0.4);
  border-radius: 0 4px 4px 0;
}
.preview-pane code {
  font-family: theme('fontFamily.mono'); font-size: 0.88em;
  background: rgb(var(--color-bg-subtle)); padding: 0.15em 0.4em; border-radius: 4px;
}
.preview-pane pre code { background: none; padding: 0; }
.preview-pane pre {
  background: rgb(var(--color-bg-subtle)); border: 1px solid rgb(var(--color-border));
  border-radius: 6px; margin: 0.9em 0;
}
.preview-pane table {
  border-collapse: collapse; margin: 0.9em 0; width: 100%;
  font-size: 0.92em;
}
.preview-pane th, .preview-pane td {
  border: 1px solid rgb(var(--color-border)); padding: 0.4em 0.7em; text-align: left;
}
.preview-pane th { background: rgb(var(--color-bg-subtle)); font-weight: 600; }
.preview-pane hr { border: none; border-top: 1px solid rgb(var(--color-border)); margin: 1.4em 0; }
.preview-pane img { max-width: 100%; border-radius: 6px; }
`
