# EasyPrompt 开发指南

EasyPrompt 是一个本地优先的桌面 Prompt 编辑器。技术栈为 Electron 33、TypeScript、React 18、Zustand 5、Tailwind CSS 3 和 CodeMirror 6。用户内容直接保存为工作区中的 Markdown 文件，不使用数据库。

## Agent 工作约束

- 先读相关调用链再修改，优先做范围小、可验证的修复；不要顺手重构无关代码。
- Windows 上执行 PowerShell 必须使用：
  ```powershell
  & 'C:\Users\BYS\AppData\Local\Programs\PowerShell\7\pwsh.exe' -NoProfile -Command '你的脚本内容'
  ```
  禁止调用 `powershell.exe`。
- 使用 `pnpm` 和 `package.json` 中已有脚本，不要自行切换包管理器。
- 不要编辑或提交 `node_modules/`、`out/`、`release/`、`.dev-data/` 等生成内容。
- 修改界面文案时同步更新 `src/shared/i18n/zh-CN.json` 与 `en-US.json`。
- 修改 IPC 时必须同步检查：`src/shared/types.ts` -> `src/main/ipc/`（`register.ts` 注册入口，handler 按域在 `config.ts`/`fs.ts`/`ai.ts`）-> `src/preload/index.ts` -> 渲染进程调用方。渲染进程不得直接使用 Node/Electron API。

## 快速理解项目

建议按以下顺序阅读：

1. `src/shared/types.ts`：领域类型和 IPC channel 的唯一来源。
2. `src/preload/index.ts`：渲染进程可用的全部 `window.api` 能力。
3. `src/main/ipc/`：跨进程编排、副作用入口和事件推送（`register.ts` 组合 `config.ts`/`fs.ts`/`ai.ts`）。
4. `src/main/services/fs.ts`、`ai.ts`、`config/store.ts`：文件、AI、配置的真实实现。
5. `src/renderer/src/store/`：配置和工作区状态模型。
6. `src/renderer/src/components/Workspace.tsx`、`Sidebar.tsx`：主要交互编排。

```text
Renderer (React/Zustand)
  -> window.api
Preload (contextBridge)
  -> ipcRenderer
Main IPC
  -> config / fs / ai services
  -> local files, safeStorage, provider HTTP API
```

## 目录职责

```text
src/main/
  index.ts             启动、单实例、CSP、菜单、退出策略
  window.ts            BrowserWindow、显隐和导航保护
  tray.ts              托盘及其国际化菜单
  shortcut.ts          全局唤起快捷键
  config/store.ts      config.json、缓存、密钥处理、原子写入
  services/fs.ts       Markdown 文件树和 CRUD
  services/ai.ts       OpenAI 兼容请求、SSE 解析
  ipc/register.ts      IPC 注册入口（组合各域）
  ipc/config.ts        配置 handler 与 config:changed 广播
  ipc/fs.ts            文件系统 handler 与 1.5s 工作区轮询
  ipc/ai.ts            AI 调用、流式 chunk 与取消 handler
  ipc/index.ts         薄 re-export（保持 './ipc' 引用稳定）
src/preload/index.ts   类型化 contextBridge
src/shared/            跨进程类型、默认值、模型预设、语言资源
src/renderer/src/
  components/          工作区、编辑器、文件树、设置、预览和通用 UI（布局编排）
  features/            业务编排 hooks：Prompt 优化、图片转 Prompt、保存流、
                       关闭确认、选区 AI、文件树变更（useFileTreeActions）
  hooks/               可读取 store 的通用 hooks（useWorkspaceRoot）
  services/            纯函数层：window.api 封装、Markdown、树操作、drafts、
                       localPrefs、AI 客户端（config 由调用方注入）
  store/               Zustand：config + workspace（tabs/fileTree 切片组合）
```

### 渲染层依赖方向（防回退规则）

依赖必须单向：`components → features/hooks → services / store → window.api`。

- `services/` 是纯函数层，**禁止 import 任何 store**；需要的依赖（如 AI config）一律由调用方显式传参。
- `features/` 与 `hooks/` 是业务编排层，可以读写 store 与调用 services。
- `store/tabs.ts`（标签状态机）与 `store/fileTree.ts`（树 + 持久化 UI 偏好）是独立切片，互不写对方的字段；`store/workspace.ts` 只做切片组合与 re-export。
- 文件树的创建/重命名/删除（磁盘操作 + 标签同步 + 乐观树更新）统一走 `features/useFileTreeActions.ts`，不要在组件里重新内联这套编排。

## 必须保持的行为契约

### 配置与密钥

- 正式配置位于 `app.getPath('userData')/config.json`；开发环境在项目内 `.dev-data/`，不能与正式数据混用。
- 首次启动的 `workspace` 为空，由用户选择目录。切换工作区只更新配置指向，不迁移旧目录文件。
- Node 默认配置在 `src/shared/defaults.node.ts`；渲染器占位默认值在 `src/shared/defaults.ts`。后者不能引入 `node:*` 或访问 `process`。
- `getConfigForRenderer()` 只返回掩码 API Key；真实密钥只能通过主进程内部接口读取。保存带 `••••` 的掩码值时必须保留原密钥。
- `safeStorage` 可用时密钥加密落盘；当前实现不可用或加密失败时会退回原值，不能把它描述为无条件加密。
- 配置变更可能还需要重注册全局快捷键、重建托盘菜单并广播 `config:changed`，不要只写 JSON。

### 文件与工作区

- 文件系统副作用属于主进程；渲染器通过 `services/fileOps.ts` 调用 `window.api`。
- 文件树只展示 `.md` 文件并忽略点文件；目录优先、名称按数字感知排序。
- 删除使用系统回收站。新建、复制和重命名通过追加 ` 2`、` 3` 等避免覆盖同名目标。
- 文件树每 1.5 秒轮询，同时在渲染器做乐观更新；修复时要同时考虑“立即 UI 状态”和“下一次轮询校正”。
- 所有文件路径都可能是 Windows 绝对路径。不要用只支持 `/` 的 `split`、前缀判断或字符串替换处理层级；路径安全和工作区越界校验应放在主进程。
- 重命名/删除文件夹时，同步更新或关闭其下已打开的标签页，并保持当前标签选择有效。

### 标签页、编辑与保存

- `workspace.ts` 中 `path` 是标签唯一键；`savedContent` 表示磁盘版本，`dirtyContent !== null` 表示未保存编辑，显示内容始终取 `dirtyContent ?? savedContent`。
- 写盘成功后才能 `markClean()`。AI 覆盖内容时必须先 `edit()` 再 `markClean()`，顺序不可颠倒。
- 自动保存仅对真实文件生效，在最后编辑 1.5 秒后写入；只读标签不可修改。
- `draft://` 标签只存在内存中，不得传给文件系统 API。当前 `Ctrl/Cmd+S` 只提示用户，尚无 Save As 流程。
- 关闭脏标签必须保留“保存 / 丢弃 / 取消”语义；窗口关闭还会通过 `beforeunload` 检查未保存内容。
- CodeMirror 是受控编辑器，但每个标签保持独立实例。修改快捷键、焦点、选择区或右键菜单时，要验证标签切换、重命名输入框和只读预览。

### AI 调用

- 模型配置统一走 OpenAI 兼容的 `/chat/completions`；文本模型与视觉模型 ID 分开，视觉 ID 为空时可回退到文本模型 ID。
- 文本优化使用流式请求。`streamId` 关联增量事件、最终事件、invoke 结果和取消请求；结束或异常后必须清理监听器与 `AbortController`。
- 取消属于正常终止状态，不应作为普通错误展示。流式结果必须防止并发 chunk 覆盖和重复落盘。
- 图片粘贴、拖放和选择文件共用入口；渲染器先压缩为最长边 1600px 的 JPEG，主进程仍执行 4MB 限制。DeepSeek provider 当前明确拒绝视觉请求。
- AI 结果写回前重新确认目标标签/选择区，避免异步返回后覆盖用户已切换或继续编辑的内容。

### Electron 生命周期

- 开发环境会重定向 `userData/sessionData`、关闭窗口即退出，并允许 Vite HMR；生产环境启用 CSP，关闭可见窗口通常隐藏到托盘。
- `electron.vite.config.ts` 固定渲染端口为 `5174` 且 `strictPort: true`。端口被占用时不要让 Electron 误连其他 Vite 页面。
- 项目为 ESM，但 main/preload 构建必须输出 `.cjs`，对应 `package.json#main` 和 BrowserWindow preload 路径。
- macOS 应用菜单必须保留标准 Edit roles，否则输入框和编辑器的 Cmd+C/V/X/A 等操作会失效。
- 保留单实例锁、Windows `AppUserModelId` 的 ready 前设置、外链系统浏览器打开及 `will-navigate` 防护。

## 开发与验证

```bash
pnpm install --config.dangerouslyAllowAllBuilds=true
pnpm dev
pnpm typecheck
pnpm build
pnpm build:win
pnpm build:mac
```

仓库目前没有自动化测试套件，也没有 ESLint/Prettier 脚本。每次修改至少执行：

1. `pnpm typecheck`。
2. `git diff --check`。
3. 涉及 main/preload、构建配置或打包路径时执行 `pnpm build`。
4. UI/交互修改用 `pnpm dev` 做针对性手工回归；优先覆盖被修改流程及相邻状态（空工作区、真实文件、脏标签、只读、AI 失败/取消）。

完成前检查 diff，确认没有生成文件、调试日志、无关格式化或只更新单一语言。
