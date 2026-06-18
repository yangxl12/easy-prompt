import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'

/**
 * Shared markdown-it instance with code highlighting.
 * Configured for GitHub-flavoured markdown + safe output.
 */
const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: false,
  highlight(str, lang): string {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang }).value}</code></pre>`
      } catch {
        /* fall through */
      }
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`
  }
})

// Open links in a new window (handled by the preload open-external logic).
const defaultLinkOpen =
  md.renderer.rules.link_open ||
  function (tokens, idx, options, _env, self): string {
    return self.renderToken(tokens, idx, options)
  }
md.renderer.rules.link_open = function (tokens, idx, options, env, self): string {
  const aIndex = tokens[idx].attrIndex('target')
  if (aIndex < 0) {
    tokens[idx].attrPush(['target', '_blank'])
    tokens[idx].attrPush(['rel', 'noopener noreferrer'])
  } else {
    tokens[idx].attrs![aIndex][1] = '_blank'
  }
  return defaultLinkOpen(tokens, idx, options, env, self)
}

export function renderMarkdown(source: string): string {
  return md.render(source)
}

/** Highlight.js CSS theme tokens injected once into the preview. */
export const HIGHLIGHT_CSS = `
.hljs { display: block; overflow-x: auto; padding: 0.85em; border-radius: 6px; }
`

export default md
