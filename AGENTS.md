# EasyPrompt — AI 辅助说明

跨平台桌面 AI Prompt 编辑器，用 **Electron + TypeScript + React** 构建。Markdown 文件存本地，不做数据库锁定。

## 技术栈

| 层 | 选型 |
|---|---|
| 框架 | Electron 33 + electron-vite + electron-builder |
| 主进程/预加载 | TypeScript, contextBridge |
| 渲染进程 | React 18, Zustand 5, Tailwind CSS 3 |
| 编辑器 | CodeMirror 6 (`@codemirror/lang-markdown`) |
| 预览 | markdown-it + highlight.js |
| 国际化 | i18next + react-i18next |
| 存储 | 手写 JSON 文件 + `safeStorage` 加密 API Key |
| AI 调用 | OpenAI 兼容 HTTP 客户端（支持 DeepSeek / 智谱 / 自定义） |

## 架构：三进程模型

```
┌─────────────────────────────────────────────────┐
│  主进程 (src/main/)                              │
│  - 窗口/托盘/全局快捷键生命周期                    │
│  - IPC handler（config / fs / ai）               │
│  - JSON 配置文件读写 + safeStorage 加密            │
│  - AI HTTP 请求（含 SSE 流式）                    │
└───────────┬─────────────────────────────────────┘
            │ contextBridge
┌───────────▼─────────────────────────────────────┐
│  预加载 (src/preload/index.ts)                   │
│  - window.api 类型化 API 桥接                    │
│  - 渲染进程只能访问 api，拿不到 Node 能力          │
└───────────┬─────────────────────────────────────┘
            │ window.api
┌───────────▼─────────────────────────────────────┐
│  渲染进程 (src/renderer/)                        │
│  - React SPA，Zustand 管理状态                   │
│  - 通过 window.api 调用主进程能力                 │
└─────────────────────────────────────────────────┘
```

## 目录结构速查

```
src/
├─ main/
│  ├─ index.ts            # app 启动、单实例锁、CSP、菜单
│  ├─ window.ts           # BrowserWindow 创建/隐藏到托盘
│  ├─ tray.ts             # 系统托盘
│  ├─ shortcut.ts         # 全局快捷键注册
│  ├─ config/store.ts     # JSON 配置读写 + 密钥加密
│  ├─ services/
│  │  ├─ ai.ts            # OpenAI 兼容客户端（流式 + 非流式）
│  │  └─ fs.ts            # 文件树读取、CRUD、回收站删除
│  └─ ipc/index.ts        # 所有 IPC handler 注册
├─ preload/index.ts       # contextBridge 暴露 window.api
├─ shared/                # 主进程 & 渲染进程共享
│  ├─ types.ts            # 所有 TS 类型 + IPC channel 常量
│  ├─ presets.ts          # AI 模型预设（DeepSeek / 智谱）
│  ├─ i18n/               # 中英文翻译资源
│  └─ defaults.ts         # 默认配置值
└─ renderer/src/
   ├─ main.tsx            # React 入口
   ├─ App.tsx             # 顶层路由（欢迎页 → 工作区）
   ├─ components/
   │  ├─ Workspace.tsx    # 主工作区（编辑器 + 预览 + AI 按钮）
   │  ├─ EditorPane/      # CodeMirror 编辑器、标签页、分栏
   │  ├─ PreviewPane/     # Markdown 渲染预览
   │  ├─ FileTree/        # 文件树 + 右键菜单
   │  ├─ Sidebar.tsx      # 左侧栏（文件树 + AI 按钮容器）
   │  ├─ SettingsDialog.tsx # 设置弹窗（主题/语言/AI模型/快捷键）
   │  ├─ TitleBar.tsx     # 自定义标题栏
   │  └─ ui/              # 通用 UI 组件（Button, ContextMenu, icons）
   ├─ features/
   │  ├─ useOptimizePrompt.ts  # "优化 Prompt" AI 交互逻辑
   │  └─ useImageToPrompt.ts   # "截图转 Prompt" AI 交互逻辑
   ├─ services/
   │  ├─ ai.ts            # AI 调用封装（调 window.api.callAI）
   │  ├─ fileOps.ts       # 文件操作封装（调 window.api.*）
   │  └─ markdown.ts      # markdown-it 渲染器配置
   └─ store/
      ├─ config.ts        # 配置 Zustand store（主题/语言/AI）
      └─ workspace.ts     # 工作区 Zustand store（文件树/标签页）
```

## 关键数据流

### 配置读写
```
渲染进程: store/config.ts → window.api.patchConfig()
  → preload IPC invoke
    → main/ipc: patchConfig() → main/config/store.ts (JSON + 加密)
      → broadcastConfig() 广播到所有窗口
```

### 文件操作
```
渲染进程: services/fileOps.ts → window.api.readFile/writeFile/...
  → preload IPC invoke
    → main/services/fs.ts → Node fs 操作工作区目录
```

### AI 调用
```
渲染进程: features/useXxx.ts → services/ai.ts → window.api.callAI(req)
  → preload IPC invoke
    → main/services/ai.ts → fetch() OpenAI 兼容 API
      ← SSE 流式: ipcMain → event.sender.send('ai:stream-chunk')
      ← 非流式: 直接返回 AICallResult
```

## 开发命令

```bash
pnpm install --config.dangerouslyAllowAllBuilds=true  # electron 需要编译原生模块
pnpm dev                                              # 启动开发（HMR）
pnpm build:mac                                        # 打包 macOS .dmg
pnpm build:win                                        # 打包 Windows .exe
pnpm typecheck                                        # 类型检查
```

## 几个注意点

- **开发模式**下 `userData` 重定向到 `.dev-data/`，避免与正式版配置冲突。
- **macOS Edit 菜单**必须有标准角色（undo/redo/cut/copy/paste/selectAll），否则 Cmd+C/V 等快捷键在输入框中无效。
- **工作区**默认是 `~/Documents/EasyPrompt`，可配置。文件变更通过 1.5s 轮询检测（非 chokidar）。
- **API Key** 存在 config JSON 里但在主进程用 `safeStorage.encryptString()` 加密后才落盘，渲染进程拿到的明文是从主进程解密后返回的。
- **Draft 标签页**：直接拖拽 .md 文件到编辑器空白区域会创建内存标签页（路径前缀 `draft://`），需手动保存为真实文件。
- **流式 AI 响应**：通过 `streamId` 关联请求和响应，`ai:stream-chunk` 事件推送增量文本，`done: true` 表示结束。
