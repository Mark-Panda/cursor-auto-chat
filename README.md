# Cursor Auto Chat 使用说明

在 **Cursor** 内启动一个本地 HTTP 服务，通过 `POST` 请求打开 Composer / 聊天面板，并尽量自动填入文案、切换到 **Agent** 模式、尝试发送。

**开发与验证基准**：本插件基于 **Cursor 2.6.22** 版本开发；其他版本若内置命令或界面有差异，部分自动化步骤可能需要自行对照调整。

### macOS 用户必读：必须授权「辅助功能」

在 **macOS** 上，若保持默认配置 **`cursorAutoChat.fallbackMacOsPaste: true`**（推荐），扩展会通过 **AppleScript + 系统事件** 模拟 **Cmd+V**，把内容粘进 Composer。  
**系统会要求你为 Cursor 打开「辅助功能」权限**；未授权时常见报错：`osascript 不允许发送按键`、错误码 **1002**，输入框可能填不进去。

**请务必完成：** **系统设置 → 隐私与安全性 → 辅助功能** → 打开列表中的 **Cursor**（没有则点 **+** 添加 `/Applications/Cursor.app`）；若有 **Cursor Helper (Plugin)**，建议一并勾选 → **完全退出 Cursor（Cmd+Q）后重新打开**。  
部分系统还需在 **隐私与安全性 → 自动化** 中允许 Cursor 控制 **系统事件 (System Events)**。  
（逐步操作见下文 **「macOS：合成粘贴与『辅助功能』授权」** 一节。）

---

## 功能概览

| 能力           | 说明                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| 本地 HTTP 接口 | 默认监听 `3777` 端口；可选 **仅前台窗口** 监听（多窗口同端口，见 `serveOnlyWhenFocused`）                   |
| 打开界面       | 优先 **Composer**（`composer.newAgentChat` 等），失败再尝试 VS Code 风格 Chat                               |
| Agent 模式     | 默认在填充前执行 `workbench.action.chat.toggleAgentMode` + `{ mode: 'agent' }`                              |
| 填入内容       | Composer 为 **Lexical**；macOS 默认 **剪贴板 + 模拟 Cmd+V**，**必须先为 Cursor 授权「辅助功能」**（见上文） |
| 发送           | 依次尝试 `composer.submit`、`workbench.action.chat.submit` 等；失败则提示手动回车                           |

---

## 环境要求

- **Cursor 2.6.22**（本插件的开发与验证版本；其他版本通常可安装使用，若 `executeCommand` 或 UI 行为不一致，需按实际 Cursor 版本排查）
- **Node.js**（开发/编译用）
- 调用 `curl` 的机器需能访问扩展所在 Cursor 窗口的 **`localhost:端口`**（本机调试时两者在同一台电脑即可）
- **macOS**：要使用默认的自动填入 Composer，需在系统中为 **Cursor** 授权 **「辅助功能」**（及可能的 **自动化 → System Events**）；否则请将 `cursorAutoChat.fallbackMacOsPaste` 设为 `false` 并接受可能无法自动填入

---

## 安装与运行

### 方式一：开发调试（推荐先这样验证）

1. 在本目录执行：

   ```bash
   npm install
   npm run compile
   ```

2. 用 **Cursor** 打开文件夹 `cursor-auto-chat`。
3. 按 **F5** 启动 **Extension Development Host**（扩展开发宿主）。
4. 在新打开的宿主窗口中，扩展会自动激活，并弹出提示：**服务已运行在端口 xxx**。
5. 在终端执行 `curl`（见下文），目标为 **`http://127.0.0.1:3777`**（若改过端口则用配置中的端口）。

日常改代码可执行 `npm run watch`，再 **F5** 或重载宿主窗口。

### 方式二：打包为 VSIX 并安装到 Cursor

#### 1. 在本仓库打包

首次克隆后先安装依赖（会把 `@vscode/vsce` 装在项目里，无需全局安装）：

```bash
cd cursor-auto-chat
npm install
npm run vsix
```

- **`npm run vsix`**：会先执行 `vscode:prepublish`（即 `npm run compile`），再用官方工具打出 VSIX。
- **产物位置**：项目根目录下的 **`cursor-auto-chat-<版本号>.vsix`**（例如 `cursor-auto-chat-0.0.1.vsix`）。该文件已在 `.gitignore` 中忽略，不会误提交。

等价命令（别名）：`npm run package-extension`。

若你更习惯全局工具，也可：`npm install -g @vscode/vsce`，然后在本目录执行 `npm run compile && vsce package`。

打包时若提示缺少 `LICENSE`，不影响安装使用；需要分发时再在仓库根目录补充许可证文件即可。

#### 2. 在 Cursor 中从 VSIX 安装

任选其一即可：

**A. 扩展视图（最直观）**

1. 打开 Cursor，按 **`Cmd+Shift+X`**（macOS）或 **`Ctrl+Shift+X`**（Windows / Linux）打开 **扩展** 侧边栏。  
2. 点击扩展列表标题栏右侧的 **`⋯`（更多操作）**。  
3. 选择 **「Install from VSIX…」** / **「从 VSIX 安装…」**（界面语言为中文时多为后者）。  
4. 选中上一步生成的 **`.vsix` 文件** → 确认安装。  
5. 若提示重载窗口，选择 **Reload** / **重新加载窗口**；也可按 **`Cmd+Shift+P`** / **`Ctrl+Shift+P`**，执行 **「Developer: Reload Window」** / **「开发人员: 重新加载窗口」**。

**B. 命令面板**

1. **`Cmd+Shift+P`** / **`Ctrl+Shift+P`** 打开命令面板。  
2. 输入并选择 **`Extensions: Install from VSIX...`**（或中文 **「扩展: 从 VSIX 安装...」**）。  
3. 选择生成的 `.vsix` 文件，按提示重载窗口。

**C. 命令行（可选）**

若本机已将 Cursor 加入 PATH（安装时可选「安装 `cursor` 命令」），可尝试：

```bash
cursor --install-extension /绝对路径/cursor-auto-chat-0.0.1.vsix
```

路径请换成你机器上实际的 `.vsix` 路径。若命令不存在，请用上面的 **A / B**。

安装成功后，在扩展列表中搜索 **「Cursor Auto Chat」** 应能看到已启用；HTTP 服务在 Cursor 正常启动扩展后随窗口运行（见上文 `curl` 说明）。

---

## 配置项（设置里搜索 `cursor auto chat`）

| 键名                                  | 类型                           | 默认值  | 说明                                                                                                                                                                                                                                              |
| ------------------------------------- | ------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cursorAutoChat.port`                 | 数字                           | `3777`  | HTTP 监听端口                                                                                                                                                                                                                                     |
| `cursorAutoChat.target`               | `auto` \| `composer` \| `chat` | `auto`  | `auto`：先试 Composer 再试 Chat；`composer` / `chat`：只走对应界面                                                                                                                                                                                |
| `cursorAutoChat.fallbackMacOsPaste`   | 布尔                           | `true`  | **仅 macOS**：合成粘贴（激活 Cursor + Cmd+V）。**依赖系统「辅助功能」授权 Cursor**，否则易报 1002 / 无法填入；关则 Composer 多半不能自动填字                                                                                                      |
| `cursorAutoChat.preferAgentMode`      | 布尔                           | `true`  | Composer 下填充前尝试切到 **Agent**（非 Ask）                                                                                                                                                                                                     |
| `cursorAutoChat.model`                | 字符串                         | `Auto`  | 非 `Auto` 时调用 Cursor 内置 `cursorai.action.switchToModel` 写入 **Composer** 域模型。值须为 Cursor **内部 `modelName`（slug / 配置 id）**，与下拉展示名可能不一致（展示名含空格时常无效）                                                       |
| `cursorAutoChat.serveOnlyWhenFocused` | 布尔                           | `false` | 为 **`true`** 时：仅在本 **Cursor 窗口处于应用前台** 时监听 HTTP；失焦则关闭服务。多窗口可共用同一 `port`，避免端口冲突。**注意**：从外部终端 `curl` 时需让目标 Cursor 窗口在前台，否则可能连接失败；若希望 Cursor 在后台仍常开服务，保持 `false` |

在 **用户级或工作区级** `settings.json` 中示例：

```json
{
  "cursorAutoChat.port": 3777,
  "cursorAutoChat.target": "auto",
  "cursorAutoChat.fallbackMacOsPaste": true,
  "cursorAutoChat.preferAgentMode": true,
  "cursorAutoChat.serveOnlyWhenFocused": true
}
```

本仓库已在两处写入 **`"cursorAutoChat.serveOnlyWhenFocused": true`** 作为示例：

- 仓库根目录 **`.vscode/settings.json`**（用 Cursor **打开整个仓库根** 作为工作区时生效）  
- **`cursor-auto-chat/.vscode/settings.json`**（工作区根 **仅为** `cursor-auto-chat` 时生效，例如 **F5** 调试扩展）  

其它情况请把该项复制到用户级 **`settings.json`**，或放到你当前工作区根下的 **`.vscode/settings.json`**。

---

## HTTP 接口

### `GET /` 或 `GET /health`

健康检查，返回 JSON，例如：

```json
{ "ok": true, "service": "cursor-auto-chat" }
```

### `POST /chat`

**请求头**

- `Content-Type: application/json`

**请求体（JSON）**

| 字段         | 类型   | 必填 | 说明                                                                                                                                                                                   |
| ------------ | ------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `content`    | 字符串 | 是   | 要填入输入框的完整文案（勿为空）                                                                                                                                                       |
| `autoSubmit` | 布尔   | 否   | 填完后是否自动尝试发送（内置 `composer.submit` 等 + macOS 可选模拟回车）。**默认 `true`**（与旧版行为一致）；设为 **`false`** 则只填入、不触发发送，需你在输入框里自行回车或 Cmd+Enter |
| `model`      | 字符串 | 否   | 非空时覆盖 `cursorAutoChat.model`；语义同设置项，须为 Cursor **内部 `modelName`**（见上表），不要用纯 UI 展示字符串                                                                    |

**成功时响应示例（字段随版本可能略增）**

```json
{
  "success": true,
  "message": "Dialog opened and filled",
  "ui": "composer",
  "openCommand": "composer.newAgentChat",
  "preferAgentMode": true,
  "fillMethod": "macOsSyntheticPaste",
  "autoSubmit": true,
  "submitted": false,
  "submitCommand": null,
  "submitFallback": true,
  "submitSkipped": false
}
```

| 字段                                             | 含义                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `ui`                                             | `composer` 或 `chat`，表示主要走的是哪套界面                                          |
| `openCommand`                                    | 实际执行成功的「打开」命令 ID                                                         |
| `autoSubmit`                                     | 本次请求是否启用了「填完后自动发送」                                                  |
| `preferAgentMode`                                | 是否在本次请求中尝试切到 Agent                                                        |
| `fillMethod`                                     | 如 `macOsSyntheticPaste`、`inject:...`、`paste`、`type` 等                            |
| `submitted` / `submitCommand` / `submitFallback` | 尝试自动发送时：是否成功、所用命令；失败时 `submitFallback` 为 `true`，需用户手动发送 |
| `submitSkipped`                                  | 请求体将 `autoSubmit` 设为 `false` 时为 `true`，表示未尝试发送                        |
| `model`                                          | 本次实际采用的模型配置值（请求覆盖或设置项合并后的结果）                              |
| `modelSource`                                    | `request`：来自请求体 `model`；`settings`：来自 `cursorAutoChat.model`                |
| `modelApplied`                                   | 非 `Auto` 且内置切换命令成功时为 `true`                                               |
| `modelApplyCommand`                              | 切换成功时可选，表示命中的命令 ID                                                     |

若 macOS 合成粘贴失败，可能额外包含：

- `composerMacSyntheticPasteError`：错误信息片段  
- `macPasteAccessibilityHint`：权限与设置提示  

**失败时**

- `400`：JSON 非法或缺少 `content`  
- `500`：`error` 字段为错误说明  

---

## 调用示例

```bash
curl -s -X POST http://127.0.0.1:3777/chat \
  -H "Content-Type: application/json" \
  -d '{"content": "请帮我解释一下这段代码的作用"}'

# 只填入、不自动发送（自行在 Composer 里按回车）
curl -s -X POST http://127.0.0.1:3777/chat \
  -H "Content-Type: application/json" \
  -d '{"content": "先预览再发","autoSubmit":false}'

# 本次请求指定模型（覆盖工作区设置；值需与本机 Cursor 支持的 id 一致）
curl -s -X POST http://127.0.0.1:3777/chat \
  -H "Content-Type: application/json" \
  -d '{"content":"说明 main 入口","model":"Claude Sonnet 4.5","autoSubmit":false}'
```

---

## macOS：合成粘贴与「辅助功能」授权

### 为什么必须授权「辅助功能」

Composer 主输入是 **Lexical**，不是普通 `CodeEditor`，`editor.action.clipboardPaste` / `type` 往往无效。  
在 macOS 上扩展默认用 **系统级模拟按键（Cmd+V）** 完成粘贴，这属于 **辅助功能（Accessibility）** 能力：**你必须在系统设置里允许 Cursor 使用辅助功能**，否则 macOS 会拦截，`osascript` 报 **不允许发送按键（1002）**，自动填入失败。

### 授权步骤（建议按顺序做）

1. 打开 **系统设置**（或 **系统偏好设置**）→ **隐私与安全性** → **辅助功能**。  
2. 在列表中 **打开** **Cursor** 开关。  
   - 若列表中没有：点击 **+**，选择 **应用程序** 里的 **Cursor**（一般在 `/Applications/Cursor.app`）。  
3. 若列表中有 **Cursor Helper (Plugin)**（或名称相近的 Cursor 组件），**一并打开**。  
4. 仍在 **隐私与安全性** 下，打开 **自动化**（若存在）：找到 **Cursor**，允许其控制 **系统事件 (System Events)**。  
5. **完全退出 Cursor**（菜单栏 **Cursor → Quit Cursor** 或 **Cmd+Q**），再重新启动（改权限后常需重启才生效）。

### 扩展在授权成功后的行为

1. 把 `content` 写入剪贴板  
2. 用 AppleScript 激活 **Cursor**  
3. 模拟 **Cmd+V**  
4. 等待约 **600ms** 后再恢复剪贴板，避免界面晚读剪贴板而粘到旧内容  

### 若仍报错

- 确认没有只「半退出」：须 **Cmd+Q** 彻底退出后再开。  
- 扩展弹窗里可点 **「打开辅助功能设置」** 快速跳转。  
- 若你**不愿**授予辅助功能：在设置里将 **`cursorAutoChat.fallbackMacOsPaste`** 设为 **`false`**（Composer 下通常**无法**自动填入，需自行粘贴或接受限制）。

---

## 使用建议

1. **尽量打开工作区文件夹**（文件 → 打开文件夹），可减少其它扩展报 `NoWorkspaceUriError` 等噪音；与本扩展 HTTP 服务无直接冲突，但环境更完整。  
2. **curl 必须打到运行扩展的那台机器上的本机端口**；若从另一台电脑访问，需把地址改为那台机器可访问的 IP，并注意防火墙。  
3. **自动发送**依赖 Cursor 内部命令，可能因版本或焦点失败；`submitFallback: true` 时请手动 **回车 / Cmd+Enter**（以你快捷键为准）。  

---

## 已知限制

- Cursor 命令 ID 可能随版本变化；若打开/填充异常，可在 **键盘快捷方式** 中搜索相关命令并核对 ID。  
- 不要使用内部测试命令 `workbench.action.chat.testOpenWithPrompt` 做自动化（本扩展已避免），否则会填入固定英文测试文案。  
- **Windows / Linux** 无本扩展实现的 AppleScript 合成粘贴；Composer 自动填入能力会明显受限（与 macOS 上需 **辅助功能** 授权是两回事）。  

---

## 常见问题

**Q：返回 200 但输入框里没有我的文字？**  
A：先在 **系统设置 → 隐私与安全性 → 辅助功能** 中确认 **Cursor**（及 **Cursor Helper (Plugin)**）已开启；再看调试控制台是否有 **1002 / 不允许发送按键**。未授权辅助功能时合成粘贴会静默失败或报错。另可能是剪贴板恢复过早或焦点不对，可重试或保证 Composer 已打开后再 `curl`。

**Q：界面仍是 Ask 不是 Agent？**  
A：确认 `preferAgentMode` 为 `true`；可改用 `target: "composer"` 并观察 `openCommand` 是否为 `composer.newAgentChat`。若仍不行，可能当前 Cursor 版本下切换命令上下文不满足，需手动点模式或反馈版本号。

**Q：连接被拒绝？**  
A：确认扩展已激活（宿主窗口已开）、端口未被占用、curl 使用正确主机（本机一般为 `127.0.0.1`）。若已开启 **`cursorAutoChat.serveOnlyWhenFocused`**，需先切换到会接收请求的那个 Cursor 窗口（应用前台），再发 `curl`。

**Q：多个 Cursor 窗口提示端口已被占用？**  
A：各窗口默认都会抢同一端口。可将 **`cursorAutoChat.serveOnlyWhenFocused`** 设为 **`true`**（本仓库 `.vscode/settings.json` 已示例），或给不同窗口配置不同 **`cursorAutoChat.port`**。

---

## 项目脚本

| 命令                        | 作用                                               |
| --------------------------- | -------------------------------------------------- |
| `npm install`               | 安装依赖（含打包用的 `@vscode/vsce`）              |
| `npm run compile`           | 编译 TypeScript → `out/`                           |
| `npm run watch`             | 监听编译                                           |
| `npm run vscode:prepublish` | 发布前编译（`vsce package` 会自动调用）            |
| `npm run vsix`              | 编译并打包为根目录下的 `.vsix`（安装到 Cursor 用） |
| `npm run package-extension` | 与 `npm run vsix` 相同                             |

---

## 许可证与声明

本扩展通过未公开的 Cursor / VS Code 命令实现自动化，可能随产品更新而行为变化；仅供个人学习与本地自动化使用。
