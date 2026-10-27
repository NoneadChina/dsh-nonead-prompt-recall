# dsh-nonead-prompt-recall

DeepSeek Harness 插件：给输入框加上 shell 风格的**提示词历史召回**。

- 输入框为空时按 **↑**：载入上一条提交过的提示词；
- 再按 **↑**：继续向前载入更早的一条；
- 按 **↓**：向回走，最后回到当前空白草稿；
- 历史按**工作区**隔离并持久化到磁盘，关闭 DSH Desktop、重启后仍然可用；
- 手动输入内容时 ↑/↓ 恢复普通光标行为，不会误触。

## 行为细节

| 场景 | ↑ | ↓ |
| --- | --- | --- |
| 输入框为空 | 载入历史第 1 条（最新） | 不拦截 |
| 正在浏览历史（未编辑） | 载入更早一条 | 载入更新一条 / 回到空白 |
| 手动输入/编辑过 | 不拦截，正常移动光标 | 不拦截 |
| 历史为空 | 不拦截 | 不拦截 |

- 连续两次提交完全相同的提示词只保留一条（避免连按 ↑ 一直停在同一条）。
- 单条提示词最长保存 32000 字符；每个工作区最多 500 条。
- 只记录**真人输入**：插件注入、续接仪式、工具调用等来源不会进入历史。

## 安装

### 方式 A：插件页安装（`desktop` profile 只能走这里）

在 DSH Desktop 的插件页面选择**安装 → 本地目录**，填入：

```
D:/MyProgram/GitLab/dsh-nonead-prompt-recall
```

`desktop` profile 由 Electron 应用独占管理，命令行安装会被明确拒绝：

```
error: profile "desktop" is managed exclusively by the Electron application
```

安装完成后刷新页面（或重启 DSH Desktop），让浏览器端 bundle 生效。

### 方式 B：其他 profile（命令行）

```powershell
dsh plugin --profile <profile-name> add "file:D:/MyProgram/GitLab/dsh-nonead-prompt-recall"
```

## 验证

1. 在任意工作区发送一条提示词（例如 `测试提示词 1`）；
2. 清空输入框，按 **↑**：输入框应出现 `测试提示词 1`；
3. 再发一条不同的提示词，清空后连按 **↑**：应依次出现最近的提示词；
4. 按 **↓** 逐条回退，最后回到空白；
5. 完全退出并重启 DSH Desktop，再按 **↑**：历史仍在。

历史文件可直接检查：

```
<DSH_HOME>/plugin-data/dsh-nonead-prompt-recall/history/<workspace-key>.json
```

## 数据位置

```
<DSH_HOME>/plugin-data/dsh-nonead-prompt-recall/history/<workspace-key>.json
```

- `workspace-key` = 规范化工作区路径的 SHA-256 前 24 位；
- 文件内容为 `{ version, cwd, updatedAt, entries: [{ text, at, sessionId? }] }`，`entries` 新的在前；
- 写入采用临时文件 + rename 原子替换；损坏文件会被改名为 `*.corrupt-<时间戳>` 后重新开始，不会卡住捕获。

## 架构

```
session/event (user/message, source.kind=user)
        │
        ▼
lib/index.js ── HistoryStore ── per-workspace JSON
        │
        │  connection.rpc.handle('dsh-nonead-prompt-recall', 'history')
        ▼
lib/client.js (browser) ── conversation.input.shell(id).setDraft(text)
        ▲
        └─ document keydown (capture) on [data-composer-input]
```

- **host 半**：监听 `session/event`，把真人提示词按工作区落盘；通过 Connection RPC 暴露只读的 `history` 端点。
- **client 半**：在 `document` 捕获阶段拦截输入框的 ↑/↓，通过 harness 自己的 composer facade 写草稿（不直接改 DOM），因此草稿持久化、发送按钮、Lexical 撤销栈都保持一致。
- 浏览器半以 `window.__ModuleLoader__.load({ id, factory })` 形式打包（DSH client 模块加载器的约定）。

## 开发

```powershell
npm run build:client   # src/*.js -> lib/client.js
npm test               # node:test（沙箱内使用 --test-isolation=none）
npm run check
```

- `src/core.js` 是纯决策函数（可单测）；`src/client.js` 是浏览器集成；`scripts/build-client.mjs` 只做 ESM → ModuleLoader 包裹，无第三方依赖。
- `lib/index.js`、`lib/history-store.js`、`lib/message-text.js` 均为纯 Node，可直接 `node --test`。

## 兼容性

- 宿主：DSH 0.2.1-rc.3（Nonead DSH Desktop 2.1.11）实测可用；
- 依赖的宿主内部约定：`[data-composer-input]`、`conversation.input.shell(id).setDraft()`、`sessions.list` 快照的 `cwd` / `retainedBy.mainView`、`session/event` 的 `user/message`。宿主升级后若这些约定变化，需要同步适配（改动集中在 `lib/client.js` 与 `src/client.js`）。
