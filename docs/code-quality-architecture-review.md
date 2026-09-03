# EasyPrompt 代码质量与架构评审报告

> 评审日期：2026-08-22  
> 评审基线：`fae4610`（`main`）  
> 评审方式：静态代码审阅、调用链核对、类型检查、生产构建、仓库卫生检查；未进行 GUI 手工回归和真实 AI Provider 联调。

## 1. 结论摘要

EasyPrompt 已经形成了清晰的 Electron 分层骨架：Renderer 不直接接触 Node/Electron API，IPC 按领域拆分，渲染层进一步区分了 components、features、services 和 Zustand store；文件树操作、AI 调用、密钥遮罩、流式取消等关键能力也都有明确归属。以当前约 7,000 行源码的规模看，整体架构方向是合理的，代码可读性也高于同阶段常见桌面应用。

但目前尚不适合把“本地文件安全”和“编辑内容不会丢失”视为已完成的可靠性承诺。最主要的问题不是编译质量，而是运行时边界和异步状态一致性：多个文件 IPC 可以访问工作区外路径；自动保存可能把尚未写盘的新编辑标记为已保存；批量关标签、删除文件和草稿关闭会绕过完整的脏内容保护；AI 返回后会基于过期内容或当前选区回写。另有一个明确的 Windows 路径缺陷，会破坏“优化后另存为新文件”。

综合判断：

| 维度 | 评分（10 分制） | 判断 |
|---|---:|---|
| 架构边界 | 7.5 | 主体分层清晰，局部契约未真正落到所有入口 |
| 可读性与可维护性 | 7.0 | 命名、注释较好；少数组件和状态流程仍偏大 |
| 正确性与数据一致性 | 5.5 | 存在保存竞态、脏内容绕过和 Windows 路径问题 |
| 安全性 | 5.0 | Electron 基础隔离存在，但 IPC 文件边界和外链协议需加固 |
| 测试与工程保障 | 3.0 | 类型检查、构建可用；无自动化测试、lint 和 CI |
| 性能与可扩展性 | 6.0 | 当前规模可用；全树轮询和前端包体会随数据增长放大 |
| **综合** | **6.2** | **架构基础良好，但应先补可靠性护栏再扩功能** |

建议先完成第 6 节中的 P1 项，再继续增加文件能力或 AI 写回场景。

## 2. 评审范围与验证结果

本次沿以下主链路审阅：

```text
Shared types / defaults
  -> Preload contextBridge
  -> Main IPC handlers
  -> config / fs / ai services
  -> Renderer services / Zustand stores / feature hooks
  -> Workspace / Sidebar / Editor / Settings UI
```

验证结果：

| 检查项 | 结果 | 备注 |
|---|---|---|
| `pnpm typecheck` | 通过 | Node 与 Web 两套 TypeScript 检查均通过 |
| `pnpm build` | 通过 | main、preload 均输出 `.cjs`；renderer 成功构建 |
| `git diff --check` | 通过 | 评审前工作区干净 |
| 自动化测试 | 不存在 | 未发现 `*.test.*`、`*.spec.*` 或 `__tests__` |
| lint / format | 不存在 | `package.json` 未提供 ESLint/Prettier 脚本 |
| CI | 不存在 | 未发现仓库 CI 工作流 |

构建过程中 renderer 主入口产物约 **3,191.56 kB（未压缩）**，并产生大量语言支持 chunk。主要诱因是一次性引入完整 `highlight.js` 和 `@codemirror/language-data`（`src/renderer/src/services/markdown.ts:2`、`src/renderer/src/components/EditorPane/CodeEditor.tsx:6`）。

## 3. 当前架构评价

### 3.1 做得好的部分

1. **跨进程职责基本正确。** Renderer 通过 preload 暴露的窄 API 访问主进程，`contextIsolation: true`、`nodeIntegration: false` 已启用（`src/main/window.ts:68-71`）。文件系统和 Provider HTTP 调用都留在主进程。

2. **IPC 已按领域拆分。** `register.ts` 只组合 config、fs、ai 三组 handler，避免单文件继续膨胀；shared types、preload、main handler 和 renderer 调用之间大体可追踪。

3. **渲染层依赖方向健康。** `services/` 没有反向读取 Zustand store；AI service 通过显式传入 `AppConfig` 做依赖注入。文件树的创建、重命名、删除也集中在 `useFileTreeActions`，没有散落到多个组件重复实现。

4. **标签状态模型表达清楚。** `savedContent`、`dirtyContent` 和 `dirtyContent ?? savedContent` 的语义统一，标签切换时保留独立 CodeMirror 实例和撤销历史，属于合理的桌面编辑器取舍。

5. **AI 流式调用的基础闭环完整。** Renderer 先订阅再发起请求；`streamId` 关联 chunk、结束、取消；主进程在 `finally` 清理 `AbortController`；增量 UI 使用函数式状态更新，避免 chunk 相互覆盖。

6. **配置密钥最小暴露。** Renderer 只能拿到掩码 key，主进程内部才解密真实 key；提交带 `••••` 的值时会保留已存密钥（`src/main/config/store.ts:92-162`）。

7. **Electron 生命周期考虑较完整。** 单实例、开发/生产数据隔离、固定 Vite 端口、macOS Edit roles、外部导航拦截、Windows ready 前设置 AppUserModelId、main/preload CJS 输出等均已覆盖。

### 3.2 架构上的主要缺口

当前架构图在“类型化 IPC”处给人较强安全感，但 TypeScript 只约束受控调用方，不能验证运行时 IPC 参数。Preload 暴露给 Renderer 的函数仍处于潜在不可信边界；一旦 Renderer 因依赖、预览内容或未来功能出现注入，主进程 handler 必须自行完成路径、类型、大小和协议校验。现有实现没有把这一边界贯彻到底。

另一个缺口是“持久化成功”没有被建模为带版本的状态转换。现在 `markClean(path)` 会直接吸收调用时的最新 dirty 内容，而不是确认“刚才实际写入的那一版内容”，因此 store 的简洁 API 反而隐藏了异步写盘竞态。

## 4. 主要发现

### P1-1：文件 IPC 未统一限制在当前工作区，存在越界读写/删除能力

**证据**

- `FS_READ_FILE`、`FS_WRITE_FILE`、`FS_DELETE`、`FS_DELETE_MULTI`、`FS_COPY`、`FS_SHOW_IN_FOLDER` 直接使用 Renderer 传入路径（`src/main/ipc/fs.ts:19-62`）。
- `readFileText`、`writeFileText`、`remove` 的 service API 本身也不接收 workspace root（`src/main/services/fs.ts:51-91`）。
- `rename` 用 `oldPath.startsWith(root)` 判断来源路径（`src/main/services/fs.ts:79`），会把类似 `C:\workspace-other` 误判为 `C:\workspace` 的子路径。
- `safe()` 只覆盖了部分目标路径，未覆盖所有来源路径，也未处理符号链接/目录联接后的真实路径。

**影响**

Renderer 可以要求主进程读取、覆盖、创建目录或移入回收站中的任意可访问路径。这突破了“内容只在工作区 Markdown 文件内”的核心信任边界，严重度高于普通输入校验缺失。

**建议**

- 在主进程建立唯一的 `resolveWorkspacePath(root, candidate, options)`，使用 `path.resolve` + `path.relative` 做边界判断，必要时用 `realpath` 防止 symlink/junction 逃逸。
- 每个读、写、删、复制、重命名、reveal handler 都先读取当前 workspace，再校验源和目标；禁止空 workspace。
- 文件读写明确限制为 `.md`；目录操作单独声明允许范围。
- 对所有 IPC 参数增加运行时 schema 校验，并设置字符串长度、数组数量、图片总大小等上限。
- 增加覆盖 Windows 大小写、盘符、UNC、`..`、相邻前缀目录和 symlink/junction 的单元测试。

### P1-2：自动保存/手动保存存在“旧内容写盘、新内容被标记为已保存”的竞态

**证据**

`useSaveFlows` 先从标签快照取 `toWrite`，等待 IPC 写盘，然后调用无版本参数的 `markClean(path)`（`src/renderer/src/features/useSaveFlows.ts:29-35`、`64-66`）。而 `markClean` 会把调用时最新的 `dirtyContent` 复制到 `savedContent` 并清空 dirty（`src/renderer/src/store/tabs.ts:100-104`）。

典型时序：

```text
捕获内容 A -> 开始写盘 A -> 用户继续输入得到 B
             -> A 写盘完成 -> markClean 读取当前 B -> UI 认为 B 已保存
```

最终磁盘是 A，界面是 B 且无脏标记；关闭应用后 B 丢失。手动保存和“保存后关闭”也有同类风险。

**建议**

- 将 API 改为 `commitSaved(path, persistedContent)`。
- 写盘成功后始终把 `savedContent` 更新为 `persistedContent`；仅当当前 `dirtyContent === persistedContent` 时清空 dirty，否则保留更新后的 dirty。
- 为每个真实文件维护串行写队列或 revision，避免多个自动/手动保存乱序完成。
- 保存失败必须进入可见错误状态；当前定时器中的 `void performAutoSave()` 会形成未处理 rejection（`src/renderer/src/features/useSaveFlows.ts:45`）。

### P1-3：部分关闭/删除流程绕过脏内容保护，草稿“保存并关闭”会调用文件 API

**证据**

- 单标签关闭会走 `useTabCloseConfirm`，但 TabBar 的“关闭右侧”和“关闭其他”直接调用 store（`src/renderer/src/components/EditorPane/TabBar.tsx:68-78`），不会逐个确认或批量确认脏标签。
- 文件树删除后直接 `dropTabsUnder`，不会先处理被删除节点下的脏标签（`src/renderer/src/features/useFileTreeActions.ts:86-91`）。
- `useTabCloseConfirm` 没有识别 `draft://`，用户对脏草稿选择“保存并关闭”时会执行 `writeFile(tab.path, ...)`（`src/renderer/src/features/useTabCloseConfirm.ts:35-43`）。
- `dropTabsUnder` 使用裸 `startsWith(prefix)`（`src/renderer/src/store/tabs.ts:131-139`），删除 `C:\ws\foo` 也可能关闭 `C:\ws\foobar.md`。

**影响**

批量操作、文件删除和草稿关闭可能无提示丢失内存编辑；路径前缀误判还可能关闭不相关标签。

**建议**

- 建立统一的 close transaction：输入待关闭 path 集合，先归一化子树边界，汇总 dirty tabs，再一次性提供“全部保存 / 全部丢弃 / 取消”。
- 删除文件/文件夹必须复用同一事务，确认完成后才执行回收站操作。
- 草稿只允许“丢弃 / 取消”，或实现真正的 Save As；绝不能把 `draft://` 传到 IPC。
- 使用统一的跨平台 `isPathWithin(parent, child)`，禁止裸 `startsWith`。

### P1-4：AI 异步回写未校验文档版本和原始选区，可能覆盖等待期间的编辑

**证据**

- 整篇优化保存了 `original`，但 overwrite 时没有确认目标标签仍存在、内容仍等于 original，就直接写盘覆盖（`src/renderer/src/features/useOptimizePrompt.ts:50-72`、`99-110`）。
- 图片转换在 `await image.convert()` 后，用调用前捕获的 `content` 拼接并 `edit`，会覆盖同一标签等待期间的新输入（`src/renderer/src/features/useImagePromptFlow.ts:50-64`）。
- 选区 AI 只捕获了选中文本，没有捕获 `{from, to}` 和文档 revision；完成时 `replaceSelection` 读取“当前选区”（`src/renderer/src/features/useSelectionAi.ts:68-92`、`src/renderer/src/components/EditorPane/CodeEditor.tsx:439-448`）。用户移动光标或修改文本后，结果会落到错误位置。

**建议**

- 标签维护单调递增 revision；AI 请求记录 `tabPath + revision`。
- 整篇/图片写回前要求 revision 未变化，否则提示“文档已修改”，提供复制结果、另存或查看差异。
- 选区请求记录 `from/to/selectedText/revision`；使用 CodeMirror `ChangeDesc.mapPos` 映射位置，或在 revision 变化时拒绝自动替换。
- 所有 AI 写回先确认标签仍存在且不是只读。

### P1-5：“优化后另存为”使用 `/` 处理路径，在 Windows 上不可靠

**证据**

`useOptimizePrompt.resolve('keep')` 通过 `includes('/')`、`lastIndexOf('/')`、`split('/')` 取目录和文件名（`src/renderer/src/features/useOptimizePrompt.ts:112-120`）。Windows 绝对路径使用 `\`，因此目录会错误回退到 workspace root，basename 可能变成完整绝对路径文本，最终创建失败或位置错误。

**建议**

- 不在 Renderer 解析 OS 路径。
- 增加语义化 IPC，例如 `createSiblingFile(sourcePath, suffix)`，由主进程使用 `node:path` 生成目标路径并做工作区校验。
- 若暂时保留 Renderer 逻辑，至少使用已经存在的跨分隔符 helper；但安全边界仍应留在主进程。

### P2-1：文件树轮询会重复全量遍历，且 watcher 生命周期不是 sender 级

`src/main/ipc/fs.ts:66-86` 使用单个模块级 `watcherTimer`，每次订阅都会新建 interval 并覆盖引用；重复订阅可能泄漏旧 timer，一个窗口停止监听也可能影响另一个窗口。每 1.5 秒无条件递归 `stat/readdir` 整棵树并发送完整对象，慢扫描还可能重叠；Renderer 每次收到后又合并顺序并写 localStorage。

建议将 timer 以 `webContents.id` 为键管理，在 destroyed 时清理；tick 加 in-flight 锁；比较目录快照后只在变化时推送。工作区规模增长后优先切换到原生 watcher/chokidar + 降频全量校正的混合方案。

### P2-2：外部文件内容变化没有同步到已打开标签

当前 watcher 只返回树结构，文件节点不含 mtime/hash，Sidebar 只 `setTree(next)`。外部编辑同名 Markdown 时，打开标签的 `savedContent` 不会更新；之后 EasyPrompt 保存可能覆盖外部改动。对于“本地优先、Markdown 即数据源”的产品，这是需要明确处理的一致性场景。

建议文件节点携带 mtime/size 或独立发送 change event。干净标签可自动 reload；脏标签应提示冲突并提供覆盖、重新载入或合并选择。

### P2-3：配置持久化的迁移与失败一致性不足

- `schemaVersion` 已存在，但 `loadFromDisk` 只做顶层浅合并（`src/main/config/store.ts:61-70`）。旧版缺少新增 `app` 字段时，不会自动补齐默认字段。
- `setConfig` / `patchConfig` 在写盘成功前就更新 `cached`（`src/main/config/store.ts:130-152`）；若写盘失败，当前进程看到的是新配置，重启后却回到旧配置。
- `CONFIG_SET` 不会像 partial patch 一样重注册快捷键、重建托盘或广播配置（`src/main/ipc/config.ts:21-48`），两个写入口的副作用契约不一致。

建议引入显式 schema 校验与逐版本 migration；先写临时文件并成功替换，再提交内存 cache；把“持久化 + 运行时副作用 + 广播”收敛到一个 application service。

### P2-4：Electron 安全基线仍可收紧

- `sandbox: false`（`src/main/window.ts:70`）降低了 Renderer 被攻破后的隔离强度。
- `setWindowOpenHandler` 对任意 `details.url` 调用 `shell.openExternal`（`src/main/window.ts:95-98`）。Markdown 链接来自用户文件，应只允许明确的 `https:`/`http:`，其他协议默认拒绝。
- 生产 CSP 的 `connect-src 'self' https:` 和 `img-src ... https:` 范围较宽；当前网络请求由主进程负责，可进一步按实际能力收窄。
- 主进程永久转发 Renderer console（`src/main/window.ts:108-110`），生产环境可能把用户内容或未来敏感日志写入系统日志。

启用 sandbox 前应做一次 preload 兼容验证；外链协议白名单和 IPC 路径校验应优先实施。

### P2-5：工程保障不足以覆盖当前风险类型

仓库没有自动化测试、lint 和 CI。现有 `typecheck` 与 `build` 能发现类型和打包错误，但无法发现路径越界、保存竞态、脏标签丢失、SSE 边界、配置迁移等行为问题。

建议首先加入 Vitest：

- 纯函数：`treeOps`、路径包含判断、配置 migration、SSE parser。
- Zustand：编辑 -> 保存中继续输入 -> 保存完成、重命名/删除子树、批量关闭。
- Main service：临时工作区中的 CRUD、越界路径、同名策略、symlink/junction。
- IPC：参数 schema、取消清理、重复 watcher 订阅。

CI 至少执行 `pnpm install --frozen-lockfile`、`pnpm typecheck`、测试、`pnpm build` 和 `git diff --check`。

### P3：可维护性、性能和文档一致性

1. `SettingsDialog.tsx` 611 行、`CodeEditor.tsx` 491 行、`TabBar.tsx` 433 行、`Workspace.tsx` 428 行。业务 hook 拆分方向正确，但设置表单、快捷键录制、模型卡片，以及 CodeMirror extension/commands 仍可按稳定职责继续拆分。

2. 完整 `highlight.js` 与 CodeMirror 全语言数据使 renderer 包明显偏大。Markdown 编辑器通常只需少量 fenced-code language；可以按语言动态注册，或采用 core build + 白名单。

3. shared `IPC` 并不是所有 channel 的唯一来源：`config:changed`、`fs:watch-stop`、`tray:new-prompt`、`tray:open-settings` 仍以字符串散落在 preload/main（例如 `src/preload/index.ts:35-89`）。建议全部纳入共享常量与事件 payload 类型。

4. README 与实现有漂移：README 声称默认 workspace 是 `~/Documents/EasyPrompt`、API key 一定加密、默认快捷键为平台组合；实际首次 workspace 为空，safeStorage 不可用时回退明文，`defaultShortcut()` 固定返回 `Shift+P`。preload 对 `changeWorkspace` 的注释还写着“migrate files”，但主进程明确不迁移（`src/preload/index.ts:73-75`）。

5. i18n 两份资源各 151 个键且键集合一致，这是好现象；但仍存在 `Loading…`、`Untitled`、`New model`、folder picker 标题等面向用户的硬编码字符串。应统一移入资源文件。

6. `package.json` 的 `typecheck` 使用 `npm run` 嵌套执行，导致在 pnpm 项目中产生多条 npm 配置警告（`package.json:12-14`）。改为 `pnpm run typecheck:node && pnpm run typecheck:web`，并补 `packageManager`、`engines` 可提升环境可复现性。

## 5. 推荐的目标架构调整

不建议大规模重写。基于现有结构，小步增加三层可靠性边界即可：

```text
Renderer feature transaction
  - 捕获 tabPath / revision / selection
  - 统一 dirty close / save result / conflict UX
        |
        v
Typed + runtime-validated IPC
  - 所有 channel 和 payload 共享定义
  - 参数长度、类型、数量校验
        |
        v
Main application services
  - WorkspacePathPolicy：所有路径规范化与越界防护
  - ConfigCoordinator：写盘、cache、副作用、广播原子编排
  - WorkspaceWatcher：sender 级生命周期、变更检测、冲突事件
```

现有 `services/fs.ts`、`config/store.ts`、feature hooks 和 Zustand slices 可以保留；重点是让关键状态转换显式携带“写入内容/版本”，并让每个主进程入口先经过同一策略对象。

## 6. 分阶段改进路线

### P1：先消除数据与安全风险

1. 封装并测试 workspace 路径策略，覆盖所有 FS IPC；同时加入运行时参数校验。
2. 重做保存提交语义，加入 persistedContent/revision 和单文件写队列。
3. 统一单个、批量、删除触发的脏标签关闭事务；正确处理 draft。
4. 为整篇、图片、选区 AI 增加 revision/selection 校验。
5. 将“优化后另存”移到主进程做 sibling path 计算，修复 Windows。

### P2：补一致性与自动化保障

1. 增加针对上述 P1 场景的单元/集成测试并接入 CI。
2. 重构 watcher 生命周期，加入变更比较和外部内容冲突处理。
3. 增加配置 schema validation/migration，统一 config 写入副作用。
4. 白名单外部协议，评估启用 Electron sandbox，限制生产日志。

### P3：维护性与体验优化

1. 拆分四个超大组件，保持 components 只负责布局和交互绑定。
2. 按需加载 Markdown 高亮语言，控制 renderer 包体。
3. 收敛全部 IPC/event channel，清理硬编码文案和 README 漂移。
4. 增加 lint/format、`packageManager`、`engines` 和贡献检查说明。

## 7. 验收标准建议

完成 P1 后，至少应能自动证明以下行为：

- 任意 IPC 都不能读写、复制、重命名、删除或 reveal 工作区外路径。
- 保存 A 的过程中继续输入 B，A 落盘后 B 仍显示为 dirty，下一次保存后磁盘才变为 B。
- 关闭右侧/其他、删除文件夹、退出应用时，所有 dirty 文件和草稿都保留“保存/丢弃/取消”语义。
- AI 返回前切换标签、继续输入或移动选区，不会覆盖新内容或错误位置。
- Windows 路径、UNC 路径和包含相邻前缀的目录均通过路径测试。
- 重复启动/停止 watcher 不残留 timer，慢扫描不会重叠。
- 从旧 schema 配置启动后，新字段具备默认值且真实 API key 不丢失。

## 8. 最终判断

EasyPrompt 的问题不是“需要推倒重来”，而是当前抽象更多解决了代码组织，还没有完整解决可靠性。分层、命名、功能编排和 Electron 生命周期基础都值得保留；接下来应把投入集中到工作区安全策略、版本化保存、统一关闭事务和异步 AI 回写校验。完成这些后，整体质量可以从当前的可用原型提升到更可信的本地编辑器基线。
