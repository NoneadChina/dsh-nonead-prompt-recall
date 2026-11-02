# dsh-nonead-prompt-recall

[English](./README.md) · **简体中文**

[![npm version](https://img.shields.io/npm/v/dsh-nonead-prompt-recall.svg?logo=npm&logoColor=white&label=npm)](https://www.npmjs.com/package/dsh-nonead-prompt-recall) [![npm downloads](https://img.shields.io/npm/dm/dsh-nonead-prompt-recall.svg?logo=npm&logoColor=white&label=downloads)](https://www.npmjs.com/package/dsh-nonead-prompt-recall) [![CI](https://img.shields.io/github/actions/workflow/status/NoneadChina/dsh-nonead-prompt-recall/ci.yml?branch=main&label=CI&logo=github)](https://github.com/NoneadChina/dsh-nonead-prompt-recall/actions) [![tag](https://img.shields.io/github/v/tag/NoneadChina/dsh-nonead-prompt-recall?label=tag&logo=git&logoColor=white)](https://github.com/NoneadChina/dsh-nonead-prompt-recall/tags) [![stars](https://img.shields.io/github/stars/NoneadChina/dsh-nonead-prompt-recall?logo=github)](https://github.com/NoneadChina/dsh-nonead-prompt-recall/stargazers) [![license](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

[![node](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org) [![dsh](https://img.shields.io/badge/dsh-%3E%3D0.2.1--rc.1-4B6BFB)](./docs/RELEASE.md) [![tests](https://img.shields.io/badge/tests-122%20passing-brightgreen)](./test) [![languages](https://img.shields.io/badge/languages-8-8A2BE2)](./locale) [![platform](https://img.shields.io/badge/platform-DSH%20web-2F6FEB)](./package.json)

DeepSeek Harness 插件的两个输入框增强：shell 风格的**提示词历史召回** 与 一键**提示词优化**。

当前版本：**0.8.4**。

**历史召回**

- 输入框为空时按 **↑**：载入上一条提交过的提示词；
- 再按 **↑**：继续向前载入更早的一条；
- 按 **↓**：向回走，最后回到当前空白草稿；
- 历史按**工作区**隔离并持久化到磁盘，关闭 DSH Desktop、重启后仍然可用；
- 手动输入内容时 ↑/↓ 恢复普通光标行为，不会误触。

**提示词优化**

- 输入框工具行里、模型选择器**右侧**的四角星，用当前会话模型改写草稿；
- 请求期间原文保持可见，只有成功才替换一次，失败/取消/期间改过草稿则一个字都不动；
- 结果留在输入框里等你自己发送：插件不代发、不提前清空草稿、也不写任何提示词历史；
- `@` 引用原样保留（引用内容不进入模型），附件与图片既不禁用也不参与改写；
- 改写成功后图标变成返回箭头，点一次即可还原原文（含引用）。

## 目录

- [行为细节](#行为细节) · [安装](#安装) · [验证](#验证) · [设置页面](#设置页面) · [提示词优化](#提示词优化)
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

> 安装本插件绝不能把 DSH 打进恢复模式。若启动日志出现 `web boot: N entry did not activate`，说明有客户端的插槽被别的插件顶掉——见[兼容性](#兼容性)里本插件使用的插槽，以及为什么不用单占用者的 `conversation.input.activity`。

## 验证

历史：

1. 在任意工作区发送一条提示词（例如 `测试提示词 1`）；
2. 清空输入框，按 **↑**：输入框应出现 `测试提示词 1`；
3. 再发一条不同的提示词，清空后连按 **↑**：应依次出现最近的提示词；
4. 按 **↓** 逐条回退，最后回到空白；
5. 完全退出并重启 DSH Desktop，再按 **↑**：历史仍在。

优化：

6. 输入 `帮我把这段代码改成 async`，点四角星：图标变成**原地旋转的圆弧**，草稿保持可见；改写成功后图标变成返回箭头；
7. 点返回箭头还原原文；再改写一次并直接按发送：改写结果被正常发送，撤销入口消失；
8. 输入一段带 `@引用` 的草稿再优化：引用 chip 原位保留，只有文字被改写；
9. 打开 **设置 → 提示词历史 → 提示词优化**：卡片里有启用开关与只读提示词查看器；**开关点击即生效**（四角星立即消失/恢复，不用刷新页面）。

历史文件可直接检查：

```
<DSH_HOME>/plugin-data/dsh-nonead-prompt-recall/history/<workspace-key>.json
```

## 设置页面

打开 **设置 → 提示词历史**（左侧使用历史图标而非通用齿轮）。页面铺满设置面板的内容列、整体滚动：状态条与历史卡通栏，**捕获设置** 与 **提示词优化** 并排，面板变窄时自动叠为单列。

- **页头**：插件图标、版本徽章与刷新按钮；
- **状态区**：捕获状态、条数、当前工作区、存储位置；
- **捕获设置**：启用开关、每工作区上限（1–5000 条）、保留天数（0 = 永久），数字输入带单位与保存校验；
- **提示词优化**：四角星的启用开关（点击即保存）与内置模型提示词的可折叠只读查看器——版本号、字符数、复制按钮，没有编辑框、也没有「恢复默认」；
- **历史管理**：导出 / 导入 / 清空放在最近列表**之前**，窗口较矮时也能触达；列表展示当前工作区最近 5 条提示词。

导出会通过浏览器下载带时间戳的 JSON；导入通过文件选择器读取，在页面内解析（上限 8MB / 20000 条）并显示文件名、条数、来源工作区与前 5 条，确认后才合并。

## 提示词优化

0.8.0 起，输入框工具行里、模型选择器**右侧**多了一个四角星按钮（DSH 把该 slot 的锚渲染在这个位置，按钮用 `order` 微调到选择器右侧，因此不会和自带的语音输入控件争位）。

**状态机**

| 状态 | 图标 | 点击的作用 |
| --- | --- | --- |
| ready（草稿有文字） | 四角星 | 发起一次辅助请求，开始优化 |
| optimizing | 原地自转的圆弧 | 取消；草稿不动 |
| done（改写已落盘） | 返回箭头 | 还原原文（含引用） |
| idle（空 / 命令草稿 / 超长） | 灰色四角星 | 无动作，tooltip 说明原因 |

**它怎么对待你的草稿**

- 请求只带草稿文本：不碰对话记录、不写提示词历史、不碰设置文件，也绝不代你发送。
- 请求期间草稿保持可见；只有成功才替换，且只替换一次。失败、超时、取消、或期间你自己改了草稿，输入框一律保持原样。
- `@` 引用会先遮罩成 `⟦C1⟧` 形式的哨兵，只有模型按原顺序保留全部哨兵时，才把引用 chip 写回新位置；引用内容不会进入模型，结构被改坏的响应直接作废、不写草稿。
- 附件与图片既不禁用也不参与改写；只有文本段为空或超过 **8000 字符**时才禁用按钮。
- 与回答互不阻塞：优化是一次独立的辅助调用，助手正在输出时照常可用；「停止生成」不会取消优化，取消优化也不会停止回答。
- 预算：20 秒截止；模型调用输出上限 800 tokens；提示词里要求 `max(60, 1.35 × 输入)` 字符且不超过 1200；同一会话同时只允许一次请求。

**反馈**

| 情况 | 你会看到 |
| --- | --- |
| 改写成功 | 图标变返回箭头，`aria-live` 播报「已优化，可撤销」 |
| 模型判定原文已足够清楚 | toast「这段已经足够清楚，未做改动」，草稿不动 |
| 模型没有返回内容 | toast「模型没有返回内容」，草稿不动 |
| 期间你改了草稿 | toast「输入已变更，优化结果已丢弃」，保留你的输入 |
| 引用结构发生变化 | toast「引用结构已变化，本次优化取消」 |
| 当前会话没有可用模型 | toast「当前会话没有可用模型」 |
| 失败 / 超时 / 上游错误 | toast「优化失败，已保留原文」 |
| 你自己取消 | 静默，不提示也不写草稿 |

**设置**

**设置 → 提示词历史 → 提示词优化** 可整体关闭按钮（直接不渲染，而不是变灰），并只读查看内置 system 提示词：版本号、字符数、复制按钮。开关**点击即保存**，不需要页面级保存按钮，输入框立即跟随。提示词本身由插件随版本维护——按设计不提供编辑器。

**隐私**

草稿只发给当前会话的模型，不发往别处。插件日志只记录稳定错误码、不记录提示词文本；优化不产生对话消息，也不产生历史条目。

## 命令

`/prompt-recall` 用于管理捕获设置与历史。设置保存在历史文件旁的 `settings.json`。提示词优化目前只有界面入口：没有子命令，开关在设置页里。

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
├── settings.json                   # 捕获开关、上限、保留天数、优化开关
└── exports/<workspace-key>-<ts>.json
```

- `workspace-key` = 规范化工作区路径的 SHA-256 前 24 位；
- 文件内容为 `{ version, cwd, updatedAt, entries: [{ text, at, sessionId? }] }`，`entries` 新的在前；
- 写入采用临时文件 + rename 原子替换；损坏文件会被改名为 `*.corrupt-<时间戳>` 后重新开始，不会卡住捕获；
- `exports/` 只服务于 `/prompt-recall export` 命令——设置页只在内存中生成下载，不写宿主文件；
- 提示词优化在这里**什么都不写**：不存草稿副本、不存结果、不存撤销数据（撤销快照只在页面内存里，刷新即失效）。

`settings.json` 在与捕获设置并列的位置带一个优化配置块：

```json
{
  "enabled": true,
  "maxEntries": 500,
  "retentionDays": 0,
  "optimize": { "enabled": true, "maxChars": 8000 }
}
```

## 架构

```
session/event (user/message, source.kind=user)
        │
        ▼
lib/index.js ── HistoryStore ── per-workspace JSON
        │
        │  connection.rpc.handle('/dsh-nonead-prompt-recall')
        │    ├── history / settings.* / history.*      （历史与设置）
        │    ├── optimize        → lib/optimize-host.js → ctx.llm.stream(...)
        │    └── optimize.prompt → 内置提示词 + 版本
        ▼
lib/client.js (browser)
        ├── conversation.input.shell(id).setDraft(draft)   （历史召回与撤销）
        └── conversation.input.right slot → src/optimize-button.js → optimize RPC
        ▲
        └─ document keydown (capture) on [data-composer-input]
```

- **host 半**：监听 `session/event`，把真人提示词按工作区落盘；通过 Connection RPC 暴露 `/dsh-nonead-prompt-recall`（通道名必须是绝对路径）。端点包括 `history`、`ping`、`settings.get/set`、`history.clear/export/importPayload`、`optimize`、`optimize.prompt`。`history.export` 只返回内存载荷，不写宿主文件。
- **优化的宿主路径**（`lib/optimize-host.js`）：校验载荷（设置开关、文本长度、`sessionId`、同一会话同时只允许一次请求）→ 解析 route（客户端带来的 provider/model 优先，否则用会话最近一条 `request/context`）→ 一次 `ctx.llm.stream` 调用（20 秒截止）→ 清洗并分类输出 → 校验引用哨兵后才返回。失败映射为稳定的 `prompt-recall/optimize-*` 错误码，模型返回的错误文本既不回传也不落日志。
- **client 半**：在 `document` 捕获阶段拦截输入框的 ↑/↓，通过 harness 自己的 composer facade 写草稿（不直接改 DOM），因此草稿持久化、发送按钮、Lexical 撤销栈都保持一致。优化按钮是独立模块（`src/optimize-button.js`），注册进输入框的**列表型** slot，自带状态机与 toast。
- 浏览器半以 `window.__ModuleLoader__.load({ id, factory })` 形式打包（DSH client 模块加载器的约定）；bundle 内所有源码共享一个作用域，因此模块级标识符都带模块前缀。

## 本地化

插件跟随桌面程序的语言：**设置 → 通用 → 语言** 里选中的语言（持久化为 `locale.preference`）决定设置页、输入框按钮、`/prompt-recall` 命令输出以及插件页标题/描述。覆盖 DSH 内置的全部八种语言：

| id | 语言 | 文件 |
| --- | --- | --- |
| `zh` | 简体中文 | `locale/zh.json` |
| `en` | English | `locale/en.json` |
| `ja` | 日本語 | `locale/ja.json` |
| `es` | Español | `locale/es.json` |
| `fr` | Français | `locale/fr.json` |
| `de` | Deutsch | `locale/de.json` |
| `ru` | Русский | `locale/ru.json` |
| `pt` | Português (Brasil) | `locale/pt.json` |

插件页的标题与描述来自 `locale/<id>.json`（小写 id，与 DSH 客户端语言一致）；设置页通过 `ctx.locale.register(ns, DICTS)` 注册字典（`src/i18n.js`），命令面由 `lib/i18n.js` 翻译。优化的 24 条文案放在 `src/i18n-optimize.js`（键名统一 `opt*` 前缀），加载时合并进同一份字典，因此设置卡片与输入框按钮永远同一种语言。两者都以 `zh` 与 `en` 为基线，缺翻译时回退到 `en`，再回退到 key 本身。`normalizeLocale()` 把 `zh-CN`、`pt-BR`、`en_US` 这类宿主值归一到八个 id，无法识别时返回 `en`。

每个元数据文件使用 `meta` 命名空间：

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

- `src/core.js` 是召回导航的纯决策函数，`src/optimize.js` 是优化的纯函数（空/超长判定、`⟦Cn⟧` 遮罩与还原、草稿文档拼装），都可以直接单测。
- `src/client.js` 是浏览器集成（键盘桥、设置页、slot 注册），`src/optimize-button.js` 是输入框按钮与状态机；`scripts/build-client.mjs` 只做 ESM → ModuleLoader 的拼接（顺序 `protocol → i18n-optimize → i18n → core → optimize → settings → optimize-button → client`），无第三方依赖。
- `lib/index.js`、`lib/history-store.js`、`lib/message-text.js`、`lib/optimize-host.js`、`lib/optimize-prompt.js` 均为纯 Node，可直接 `node --test`。
- 测试共 **122** 项，包含插件边界端到端用例（宿主捕获 → RPC → 按键 → `setDraft`）、假 `llm` 的宿主 RPC 分支、哨兵遮罩/还原、客户端禁用与结果映射、八语言键集、设置持久化与设置页图标用例；真实窗口的验收清单见 [docs/E2E.md](docs/E2E.md)。
- CI（`.github/workflows/ci.yml`）在 Node 24 上运行 `npm run check` 与产物同步检查。
- `PLUGIN_VERSION` 从 `package.json` 读取：发版时改版本号并补 `CHANGELOG.md`。

## 文档

- [CHANGELOG.md](CHANGELOG.md) — 版本变更记录（中英对照）；
- [docs/PROMPT-OPTIMIZE.md](docs/PROMPT-OPTIMIZE.md) — 优化的设计文档：交互规格、RPC 契约、错误码、遮罩规则与模型提示词；
- [docs/E2E.md](docs/E2E.md) — 手动端到端验收矩阵（按键、命令、设置页、备份、提示词优化）；
- [docs/RELEASE.md](docs/RELEASE.md) — 发布前检查、打包与发布/回滚步骤；
- 仓库：<https://github.com/NoneadChina/dsh-nonead-prompt-recall> · 问题反馈：<https://github.com/NoneadChina/dsh-nonead-prompt-recall/issues>。

## 兼容性

- 宿主：DSH 0.2.1-rc.3（Nonead DSH Desktop 2.1.11）实测可用；
- 依赖的宿主约定：`[data-composer-input]`、`conversation.input.shell(id).setDraft()`、`sessions.list` 快照的 `cwd` / `retainedBy.mainView`、`session/event` 的 `user/message`、`conversation.input.right` 这个**列表型** slot（经 `ctx.slots.inject` + `ctx.slots.register` 注册）、`ctx.get('llm').stream(...)` 及其终止 `finish` 块、`Session.requestContext()` 取最近一次 route、以及插件 RPC 通道上的 `settings.get/set`。
- **刻意不用** `conversation.input.activity`：DSH 把它声明为单占用者 slot，并已在其中挂载自带语音输入按钮。再注册一个占用者会把它顶掉，整个启动报 `web boot: 1 entry did not activate`，DSH 直接进恢复模式。新增控件请用 `conversation.input.right` 这类列表槽。
- 宿主升级后若这些约定变化，需要同步适配，改动集中在 `lib/index.js`、`lib/optimize-host.js`、`src/client.js`、`src/optimize-button.js`。
