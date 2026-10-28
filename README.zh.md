# dsh-nonead-prompt-recall

[English](README.md) | **简体中文**

DeepSeek Harness 插件：给输入框加上 shell 风格的**提示词历史召回**。

当前版本：**0.6.3**。

- 输入框为空时按 **↑**：载入上一条提交过的提示词；
- 再按 **↑**：继续向前载入更早的一条；
- 按 **↓**：向回走，最后回到当前空白草稿；
- 历史按**工作区**隔离并持久化到磁盘，关闭 DSH Desktop、重启后仍然可用；
- 手动输入内容时 ↑/↓ 恢复普通光标行为，不会误触。

## 目录

- [行为细节](#行为细节) · [安装](#安装) · [验证](#验证) · [设置页面](#设置页面)
- [命令](#命令) · [数据位置](#数据位置) · [架构](#架构) · [本地化](#本地化)
- [开发](#开发) · [文档](#文档) · [兼容性](#兼容性)

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
- 输入框会对草稿做规范化（例如 `@引用` 会被剥离）；再按 ↑/↓ 时按回填后的**实际文本**比较，因此这类提示词也能继续回溯。

## 安装

### 方式 A：从 npm registry 安装（最省事）

包已公开发布在 npm：[dsh-nonead-prompt-recall](https://www.npmjs.com/package/dsh-nonead-prompt-recall)。

- 在 DSH Desktop 的插件页面选择**添加插件**，输入包名：

```
dsh-nonead-prompt-recall
```

- 对不受 Electron 独占的其他 profile，命令行等价：

```powershell
dsh plugin --profile <profile-name> add dsh-nonead-prompt-recall
```

### 方式 B：插件页 + 本地目录（`desktop` profile 也可以走这里）

在 DSH Desktop 的插件页面选择**添加插件**，填入仓库路径（输入框接受本地目录）：

```
D:/MyProgram/GitHub/dsh-nonead-prompt-recall
```

`desktop` profile 由 Electron 应用独占管理，直接对它执行命令行安装会被明确拒绝：

```
error: profile "desktop" is managed exclusively by the Electron application
```

本地目录安装是**链接**（junction）而不是复制：改工作区源码后，客户端半刷新页面即生效，宿主半需重启。

### 方式 C：其他 profile 从本地目录安装（命令行）

```powershell
dsh plugin --profile <profile-name> add "file:D:/MyProgram/GitHub/dsh-nonead-prompt-recall"
```

安装完成后刷新页面（或重启 DSH Desktop），让浏览器端 bundle 生效。

## 验证

1. 在任意工作区发送一条提示词（例如 `测试提示词 1`）；
2. 清空输入框，按 **↑**：输入框应出现 `测试提示词 1`；
3. 再发一条不同的提示词，清空后连按 **↑**：应依次出现最近的提示词；
4. 按 **↓** 逐条回退，最后回到空白；
5. 完全退出并重启 DSH Desktop，再按 **↑**：历史仍在；
6. 打开 **设置 → 提示词历史**，确认左侧导航是历史图标、页头/状态区为新版布局，并能看到导出 / 导入 / 清空操作。

历史文件可直接检查：

```
<DSH_HOME>/plugin-data/dsh-nonead-prompt-recall/history/<workspace-key>.json
```

## 设置页面

打开 **设置 → 提示词历史**（左侧使用历史图标而非通用齿轮），在同一页完成全部管理与配置：

- **页头**：插件图标、版本徽章与刷新按钮；
- **状态区**：捕获状态、条数、当前工作区、存储位置；
- **捕获设置**：启用开关、每工作区上限（1–5000 条）、保留天数（0 = 永久），数字输入带单位与保存校验；
- **历史管理**：导出 / 导入 / 清空放在最近列表**之前**，窗口较矮时也能触达；列表展示当前工作区最近 5 条提示词。

导出会通过浏览器下载带时间戳的 JSON；导入通过文件选择器读取，在页面内解析（上限 8MB / 20000 条）并显示文件名、条数、来源工作区与前 5 条，确认后才合并。

## 命令

`/prompt-recall` 用于管理捕获设置与历史。设置保存在历史文件旁的 `settings.json`。

| 子命令 | 作用 |
| --- | --- |
| `status` / `help` | 查看捕获状态、上限、保留天数与本工作区条数 |
| `on` / `off` | 开关捕获（已有历史保留） |
| `max <n>` | 每工作区保留条数（1–5000） |
| `keep <days>` | 清理超过 N 天的历史（0 = 永久） |
| `clear confirm` | 清空当前工作区历史 |
| `export` | 导出 JSON 到 `plugin-data/<plugin>/exports/` |
| `import <file>` | 合并已导出的文件（精确重复会跳过） |
| `reset` | 恢复默认设置 |

## 数据位置

```
<DSH_HOME>/plugin-data/dsh-nonead-prompt-recall/
├── history/<workspace-key>.json    # 新的在前
├── settings.json                   # 捕获开关、上限、保留天数
└── exports/<workspace-key>-<ts>.json
```

- `workspace-key` = 规范化工作区路径的 SHA-256 前 24 位；
- 文件内容为 `{ version, cwd, updatedAt, entries: [{ text, at, sessionId? }] }`，`entries` 新的在前；
- 写入采用临时文件 + rename 原子替换；损坏文件会被改名为 `*.corrupt-<时间戳>` 后重新开始，不会卡住捕获；
- `exports/` 只服务于 `/prompt-recall export` 命令——设置页只在内存中生成下载，不写宿主文件。

## 架构

```
session/event (user/message, source.kind=user)
        │
        ▼
lib/index.js ── HistoryStore ── per-workspace JSON
        │
        │  connection.rpc.handle('/dsh-nonead-prompt-recall', 'history')
        ▼
lib/client.js (browser) ── conversation.input.shell(id).setDraft(text)
        ▲
        └─ document keydown (capture) on [data-composer-input]
```

- **host 半**：监听 `session/event`，把真人提示词按工作区落盘；通过 Connection RPC 暴露 `/dsh-nonead-prompt-recall`（通道名必须是绝对路径），端点包括 `history`、`ping`、`settings.get/set`、`history.clear/export/importPayload`。`history.export` 只返回内存载荷，不写宿主文件。
- **client 半**：在 `document` 捕获阶段拦截输入框的 ↑/↓，通过 harness 自己的 composer facade 写草稿（不直接改 DOM），因此草稿持久化、发送按钮、Lexical 撤销栈都保持一致。
- 浏览器半以 `window.__ModuleLoader__.load({ id, factory })` 形式打包（DSH client 模块加载器的约定）。

## 本地化

插件页显示的标题与描述通过 `locale/<id>.json` 本地化（语言 id 用 DSH 客户端的小写形式）：

- `locale/en.json` — 英文基线（必需，存在它才会启用本地化元数据）；
- `locale/zh.json` — 简体中文。

每个文件使用 `meta` 命名空间：

```json
{ "meta": { "title": "提示词召回", "description": "…" } }
```

宿主通过包的 `exports` 映射读取这些文件，因此 `"./locale/*": "./locale/*"` 必须保持导出。`package.json` 的 `description` 是不支持本地化的界面（以及 npm）上的纯文本兜底。文档提供英文（`README.md`）与简体中文（`README.zh.md`）两份。

## 开发

```powershell
npm run build:client   # src/*.js -> lib/client.js
npm test               # node:test（沙箱内使用 --test-isolation=none）
npm run check          # 构建 + 语法检查 + 全量测试
node scripts/build-client.mjs --check   # 产物与源码不一致时失败
```

- `src/core.js` 是纯决策函数（可单测）；`src/client.js` 是浏览器集成；`scripts/build-client.mjs` 只做 ESM → ModuleLoader 包裹，无第三方依赖。
- `lib/index.js`、`lib/history-store.js`、`lib/message-text.js` 均为纯 Node，可直接 `node --test`。
- 测试共 65 个，包含插件边界端到端用例（宿主捕获 → RPC → 按键 → `setDraft`）与设置页图标用例；真实窗口的验收清单见 [docs/E2E.md](docs/E2E.md)。
- CI（`.github/workflows/ci.yml`）在 Node 24 上运行 `npm run check` 与产物同步检查。
- `PLUGIN_VERSION` 从 `package.json` 读取：发版时改版本号并补 `CHANGELOG.md`。

## 文档

- [CHANGELOG.md](CHANGELOG.md) — 版本变更记录（中英对照）；
- [docs/E2E.md](docs/E2E.md) — 手动端到端验收矩阵（按键、命令、设置页、备份）；
- [docs/RELEASE.md](docs/RELEASE.md) — 发布前检查、打包与发布/回滚步骤；
- 仓库：<https://github.com/NoneadChina/dsh-nonead-prompt-recall> · 问题反馈：<https://github.com/NoneadChina/dsh-nonead-prompt-recall/issues>。

## 兼容性

- 宿主：DSH 0.2.1-rc.3（Nonead DSH Desktop 2.1.11）实测可用；
- 依赖的宿主内部约定：`[data-composer-input]`、`conversation.input.shell(id).setDraft()`、`sessions.list` 快照的 `cwd` / `retainedBy.mainView`、`session/event` 的 `user/message`。宿主升级后若这些约定变化，需要同步适配（改动集中在 `lib/client.js` 与 `src/client.js`）。
