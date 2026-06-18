# EasyPrompt

A cross-platform desktop app for writing and managing AI prompts. Built with **Electron + TypeScript + React**.

![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-blue)
![license](https://img.shields.io/badge/license-MIT-green)

## ✨ Features

- **Global hotkey** — summon the window anytime (`Alt+Cmd+P` on macOS, `Alt+Shift+P` on Windows, customizable in Settings). The app hides to the system tray instead of quitting, so it's always one keystroke away.
- **Markdown-first** — prompts are stored as plain `.md` files in a workspace folder of your choice. Nothing is locked in a database.
- **Split live preview** — write on the left with a [CodeMirror 6](https://codemirror.net/) editor, see the rendered preview on the right. Drag the divider to resize.
- **Multi-tab editing** — open several prompts at once and switch between them, VS Code-style.
- **File tree with context menu** — new file / new folder / copy / rename / delete (sent to the OS trash) / reveal in file manager.
- **AI: UI image → prompt** — paste a UI screenshot into the editor; a banner offers to **delete** or **keep** the image, then the configured AI describes it and generates a structured prompt.
- **AI: optimize prompt** — polish your prompt to be clearer and better structured, then choose to **overwrite** the original or **save as a new** file. Core intent is preserved.
- **Multi-model configuration** — add as many models as you like, switch the active one anytime. Built-in presets for **DeepSeek** and **Zhipu GLM**.
- **API keys encrypted at rest** — secrets are encrypted with the OS keychain (`safeStorage`) before being written to disk.
- **Light / Dark / System themes** and **Chinese / English** UI, defaulting to Chinese.

## 🔧 Tech Stack

| Layer | Choice |
|-------|--------|
| Build | electron-vite + electron-builder |
| Main / Preload | Electron, TypeScript, contextBridge |
| Renderer | React 18, Zustand, Tailwind CSS |
| Editor | CodeMirror 6 (`@codemirror/lang-markdown`) |
| Preview | markdown-it + highlight.js |
| i18n | i18next + react-i18next |
| Storage | hand-rolled JSON store + `safeStorage` encryption |
| AI | OpenAI-compatible HTTP client (DeepSeek & Zhipu both supported) |

## 🚀 Getting Started

### Prerequisites

- Node.js 20+
- pnpm 11+

### Install & run (dev)

```bash
pnpm install --config.dangerouslyAllowAllBuilds=true   # allow electron/esbuild postinstall
pnpm dev                                                 # launch with HMR
```

> **Note on pnpm 11**: pnpm gates dependency build scripts. If you see
> `ERR_PNPM_IGNORED_BUILDS`, run the install command above once (or answer the
> `pnpm approve-builds` prompt) to let `electron` and `esbuild` run their
> postinstall steps.

> **Note on `ELECTRON_RUN_AS_NODE`**: if your shell exports this variable, the
> dev script already unsets it (`unset ELECTRON_RUN_AS_NODE`). If electron
> starts but shows no window, check `echo $ELECTRON_RUN_AS_NODE`.

### Build installers

```bash
pnpm build:mac    # produces a .dmg in release/
pnpm build:win    # produces an .exe (NSIS) in release/  (run on Windows)
```

## ⚙️ Configuration

On first launch there's no AI model configured, so all AI buttons are
disabled and show a hint: **"Please configure an AI model in Settings"**.

Open **Settings → AI Models** and either:

1. Click a preset (**DeepSeek V4-Pro** or **Zhipu GLM**) to pre-fill the
   fields, or
2. Click **Add model** to configure any OpenAI-compatible endpoint.

Fill in the **API Key** (obtained from your provider's console), optionally
adjust the text/vision model ids, then click **Set as current**. Use **Test
connection** to verify.

### Default presets

| Provider | Base URL | Text model | Vision model |
|----------|----------|------------|--------------|
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-v4-pro` | `deepseek-v4-pro` |
| Zhipu | `https://open.bigmodel.cn/api/paas/v4` | `glm-5.1` | `glm-5v-turbo` |

> The app never bundles API keys — you must supply your own. The vision
> capability of DeepSeek V4-Pro should be confirmed against the provider's
> live model list; the code is decoupled so presets can be edited freely.

### Where data lives

| What | Path |
|------|------|
| Workspace (your `.md` files) | `~/Documents/EasyPrompt` (configurable) |
| App config (`config.json`, keys encrypted) | OS user-data dir, e.g. `~/Library/Application Support/EasyPrompt` |

## 🗂 Project Structure

```
src/
├─ main/              # Electron main process
│  ├─ index.ts        # app lifecycle, window/tray/shortcut wiring
│  ├─ window.ts       # BrowserWindow (hide-to-tray)
│  ├─ tray.ts         # system tray
│  ├─ shortcut.ts     # globalShortcut
│  ├─ config/store.ts # JSON config + key encryption
│  ├─ services/       # fs + ai (HTTP)
│  └─ ipc/            # typed IPC handlers
├─ preload/           # contextBridge typed API
├─ shared/            # types, presets, i18n resources (shared by all)
└─ renderer/          # React app
   └─ src/
      ├─ components/  # FileTree, EditorPane, PreviewPane, Settings, UI
      ├─ features/    # useOptimizePrompt, useImageToPrompt
      ├─ services/    # ai, fileOps, markdown
      └─ store/       # zustand stores
```

## 📜 License

MIT
