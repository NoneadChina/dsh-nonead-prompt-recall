# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/).

本文件记录所有值得注意的改动，格式参考 Keep a Changelog，版本号遵循语义化版本。

## [0.8.2] - 2026-11-01

### Fixed / 修复

- **Boot failure after install**: the optimize button registered into `conversation.input.activity`, which DSH declares as a **single-occupant** slot and already mounts its voice-input button in. Registering a second occupant evicted it, left its client entry stuck in `loading`, and made the whole starter fail with `web boot: 1 entry did not activate` — DSH then dropped into recovery mode. The button now registers into the list slot `conversation.input.right` (compact controls before the submit action), which accepts a second cell safely.
- **安装后无法启动**：优化按钮原先注册进 `conversation.input.activity`，而该 slot 在 DSH 中是**单占用者**、并已被自带语音输入按钮占用；注册第二个占用者会顶掉它，使其客户端 entry 停在 `loading`，整个启动因此报 `web boot: 1 entry did not activate` 并进入恢复模式。现在改注册到列表型 slot `conversation.input.right`（提交按钮前的紧凑控件），可安全容纳第二个占用者。
- The style tag is now injected on the button's first render instead of during `apply()`, so plugin activation no longer writes to the document head while DSH is still settling the client roster.
- 样式表改在按钮首次渲染时注入，不再于 `apply()` 期间写 document head，插件激活不再打扰 DSH 结算客户端 roster。
- **Settings switch did nothing until Save**: flipping "Prompt optimization" only edited the page's local form, so leaving the page discarded it — the star stayed visible and reopening Settings showed the switch back on. The switch now writes `settings.set` on click (only the `optimize` block, so an unfinished edit elsewhere survives) and notifies the composer button immediately.
- **设置开关要按保存才生效**：「提示词优化」开关原先只改页面本地表单，离开页面即丢弃——四角星照旧显示、重进设置页开关又变回开。现在点击开关立即写入 `settings.set`（只提交 `optimize` 块，不覆盖其它未保存的编辑），并即时通知输入框按钮刷新。

### Changed / 变更

- The sparkle button now sits to the right of the model selector in the composer tool row. DSH renders that slot's outlet before the selector and gives every outlet anchor an inline `display:contents`, so the reorder is applied to the button itself (`order:1`) rather than to the anchor; it also no longer competes with DSH's voice-input button.
- 四角星按钮现在位于输入框工具行里、模型选择器**右侧**。DSH 会把该 slot 的锚渲染在选择器之前、且给每个锚内联 `display:contents`，因此重排发生在按钮自身（`order:1`）而不是锚上；它也不再与 DSH 自带的语音输入按钮争用同一插槽。
- While an optimization runs the button now shows a spinning arc, so a click has visible feedback for the whole request; the undo arrow still appears only after a successful rewrite. The rotation is driven by an in-SVG `<animateTransform>` (SMIL) instead of a CSS `animation`, because a `prefers-reduced-motion` media query or a stale injected `<style>` silently froze the CSS version. A click that cannot start (no composer shell or RPC) now reports a failure toast instead of doing nothing.
- 优化进行中按钮显示**旋转圆弧**，整段请求期间都有可见反馈；撤销箭头仍在改写成功后才会出现。旋转由 SVG 内置的 `<animateTransform>`（SMIL）驱动，而不是 CSS `animation`——此前 `prefers-reduced-motion` 媒体查询或页面里的旧 `<style>` 都会让 CSS 版本静默停转。点击无法开始（取不到输入框或 RPC）时改为弹出失败提示，不再静默无反应。

## [0.8.0] - 2026-11-01

### Added / 新增

- **Prompt optimization**: a sparkle button sits between the model selector and Send (`conversation.input.activity`). Clicking it rewrites the composer draft with the session model; the original stays visible while the request runs, a successful rewrite replaces it exactly once, and nothing is sent for you — the result waits in the composer.
- **提示词优化**：模型选择器与发送键之间新增四角星按钮（`conversation.input.activity` 插槽）。点击后用当前会话模型改写输入框草稿；请求期间原文保持可见，成功才替换一次，绝不代你发送，结果停在输入框等你自己按发送。
- `@` reference chips are masked as `⟦C1⟧` sentinels so their content never reaches the model; the response is validated (count and order) and the chips are re-inserted at their new offsets, or the whole result is discarded with a toast.
- `@` 引用以 `⟦C1⟧` 哨兵遮罩后不进入模型输入；响应按数量与顺序校验，通过才把 chip 写回新位置，否则整次结果作废并提示。
- Attachments and images neither block the action nor participate in the rewrite; the button is disabled only when the text segment is empty or longer than 8000 characters.
- 附件与图片既不禁用也不参与改写；只有文本段为空或超过 8000 字符时才禁用按钮。
- Undo: after a successful rewrite the icon becomes an undo arrow and restores the original draft (references included) once; editing or sending discards the snapshot.
- 撤销：改写成功后图标变为返回箭头，可一次性还原原文（含引用）；编辑或发送即作废快照。
- New read-only RPC `optimize.prompt` serves the built-in model prompt with its version and character count.
- 新增只读 RPC `optimize.prompt`，返回内置模型提示词、版本号与字符数。

### Changed / 变更

- Settings → 提示词历史 gains a **Prompt optimization** card: an enable switch (default on) and a read-only prompt viewer (version badge, character count, copy). Saving re-reads the setting in the composer without a page refresh.
- 设置 → 提示词历史新增「提示词优化」卡片：启用开关（默认开）与只读提示词查看器（版本、字符数、复制）；保存后输入框无需刷新即生效。
- The optimization runs as an independent auxiliary model call: it does not join the conversation turn queue, so it stays available while an answer is streaming, and cancelling one never stops the other.
- 优化是一次独立的辅助模型调用，不进会话回合队列：助手正在输出时照常可用，取消优化不会停止回答。
- Optimization copy ships in all eight languages (`src/i18n-optimize.js`, 24 keys) and is merged into the settings dictionary.
- 优化相关文案覆盖八语言（`src/i18n-optimize.js`，24 个键），合并进设置页字典。

### Tests / 测试

- 122 tests (0.7.0 had 75): host RPC branches with a fake LLM, sentinel masking/unmasking, client disable rules and outcome mapping, dictionary key-set merge, and optimize settings persistence.
- 测试 122 项（0.7.0 为 75）：假 LLM 的宿主 RPC 分支、哨兵遮罩/还原、客户端禁用与结果映射、字典键集合并、优化设置持久化。

## [0.7.1] - 2026-11-01

### Changed / 变更

- README header refresh: the language switch line sits directly under the title, followed by two badge rows — npm version / downloads / CI / tag / stars / license, then node / dsh / tests / languages / platform — in the same style as the project's other DSH plugins.
- README 头部改版：语言切换行紧贴标题，其下两行徽章（npm 版本/下载量、CI、tag、stars、license；node、dsh、tests、languages、platform），与本项目其他 DSH 插件保持一致。
- `docs/RELEASE.md` now records the real publish state (0.7.0 released, 0.7.1 prepared).
- `docs/RELEASE.md` 的发布状态改为记录真实状态（0.7.0 已发布、0.7.1 待发布）。

### Notes / 说明

- Docs-only patch: no runtime, storage or behaviour change.
- 仅文档改动，不涉及运行时、存储或行为变化。

## [0.7.0] - 2026-10-29

### Added / 新增

- Full UI localization for the eight languages DSH ships — Simplified Chinese, English, Japanese, Spanish, French, German, Russian and Brazilian Portuguese. The settings page, the `/prompt-recall` output and the plugin title/description follow the desktop app language (Settings → General → Language, persisted as `locale.preference`).
- 界面完整支持 DSH 内置的八种语言（简体中文、英文、日语、西班牙语、法语、德语、俄语、巴西葡萄牙语）：设置页、`/prompt-recall` 输出与插件标题/描述都跟随桌面程序语言（设置 → 通用 → 语言，持久化为 `locale.preference`）。
- `src/i18n.js` registers the settings dictionaries through `ctx.locale.register`; `lib/i18n.js` renders command text, normalizing `zh-CN` / `pt-BR` / `en_US` to `zh` / `pt` / `en` and falling back to `en`.
- 新增 `src/i18n.js`（经 `ctx.locale.register` 注册设置页字典）与 `lib/i18n.js`（归一 `zh-CN` / `pt-BR` / `en_US`，缺翻译回退 `en`）。
- New `locale/{ja,es,fr,de,ru,pt}.json` metadata files complete the eight-language Plugins-page set.
- 新增 `locale/{ja,es,fr,de,ru,pt}.json` 元数据，凑齐插件页的八种语言。

### Changed / 变更

- `/prompt-recall` messages are table-driven instead of hard-coded zh/en string pairs, so every message follows the active language.
- `/prompt-recall` 的消息改为查表渲染，不再写死 zh/en 双语字符串，所有消息都随当前语言。

### Tests / 测试

- New `test/i18n.test.mjs` checks key parity, placeholder parity and zero-width characters across all eight languages; the host test asserts the command follows the language preference (75 tests total).
- 新增 `test/i18n.test.mjs` 校验八种语言的键集、占位符一致性与零宽字符；宿主测试断言命令随语言偏好切换（共 75 项）。

## [0.6.3] - 2026-10-28

### Added / 新增

- `repository`, `homepage` and `bugs` metadata, so the npm page links back to GitHub and accepts issue reports.
- 补充 `repository`、`homepage`、`bugs` 元数据，npm 页面可跳回 GitHub 仓库并接受 Issue。

### Changed / 变更

- Install docs now lead with the npm registry (`dsh plugin add dsh-nonead-prompt-recall`), keep the plugin-page local-directory path for the `desktop` profile, and use the current checkout path (`D:/MyProgram/GitHub/...`).
- 安装文档改为优先 npm registry 安装，保留 `desktop` profile 的插件页本地目录方式，并把示例路径改为当前仓库位置（`D:/MyProgram/GitHub/...`）。
- `docs/RELEASE.md` documents the real publish state, the proof-of-presence / `0.0.0-stage` placeholder behaviour and the registry-readback checks.

## [0.6.2] - 2026-10-28

### Fixed / 修复

- Dark-theme parity for the settings page: it referenced theme variables DSH never defines (`--dsw-alias-bg-l1`, `--dsw-alias-bg-l2`, `--dsw-alias-brand-primary-hover`), so every surface fell back to hard-coded light colors and rendered as a white card on a dark dialog.
- 设置页深色模式适配：原样式引用了 DSH 未定义的变量（`--dsw-alias-bg-l1`、`--dsw-alias-bg-l2`、`--dsw-alias-brand-primary-hover`），深色下全部回退到写死的浅色值，卡片在深色对话框中呈白底。
- Surfaces now use real design tokens (`--dsw-alias-bg-layer-1/2`, `--dsw-alias-border-l2`, `--dsw-alias-button-info-fill/-hover`, `--dsw-alias-label-primary-foreground`, `--dsw-alias-state-*`, `--dsw-alias-switch-thumb`, `--dsw-alias-scrollbar-bg-l2`, `--dsw-shadow-lv1`), and brand tints are derived with `color-mix()` so one rule set serves both themes.
- 表面改用真实设计 token（`--dsw-alias-bg-layer-1/2`、`--dsw-alias-border-l2`、`--dsw-alias-button-info-fill/-hover`、`--dsw-alias-label-primary-foreground`、`--dsw-alias-state-*`、`--dsw-alias-switch-thumb`、`--dsw-alias-scrollbar-bg-l2`、`--dsw-shadow-lv1`），品牌色浅底由 `color-mix()` 派生，一套规则同时服务明暗两色。
- Hard-coded colors removed from the status dot, switch, danger button, success/error notes, badge, logo gradient, card shadow and focus ring; light fallbacks on token references were dropped so a missing variable can no longer silently revert to a light value.
- 移除状态点、开关、危险按钮、成功/错误提示、徽章、logo 渐变、卡片阴影与焦点环中的硬编码颜色，并去掉 token 的浅色回退值，避免变量缺失时静默退回浅色。

## [0.6.1] - 2026-10-27

### Added / 新增

- A dedicated history glyph for the settings nav row (replaces DSH's generic gear): the row is marked by its localized label and the gear is swapped with a CSS-masked history icon.
- 设置左侧「提示词历史」改用历史图标（时钟+回溯箭头），替换 DSH 默认齿轮：按本地化标签标记该行，再用 CSS mask 换图标。
- `engines.dsh` compatibility range and a `docs/RELEASE.md` pre-release checklist.
- 增加 `engines.dsh` 兼容范围与 `docs/RELEASE.md` 发布前检查清单。

### Changed / 变更

- Settings page visual refresh: identity header with logo/version, four stat tiles, unit-suffixed inputs, primary import action, toolbar above the list, focus rings and hover states, and an internal 56vh scroll area.
- 设置页视觉重构：带图标与版本的页头、四块状态卡、带单位的数字输入、导入主按钮、操作栏前置到列表之前、焦点环与悬停态、内部 56vh 滚动。

### Fixed / 修复

- `history.importPayload` rejects a payload larger than 8MB and caps imported `sessionId` metadata at 200 characters.
- `history.importPayload` 拒绝超过 8MB 的载荷，导入的 `sessionId` 元数据截断到 200 字符。
- Removed the unused `history.import` RPC (arbitrary host file read) now that the settings page imports via payload; the command keeps host-side file import.
- 移除已无用的 `history.import` RPC（任意宿主文件读取）；命令面仍保留宿主侧文件导入。

## [0.6.0] - 2026-10-27

### Changed / 变更

- Settings-page export/import now use the same browser primitives as the marketplace backup page: export returns an in-memory payload and downloads it via a Blob + `<a download>`; import uses a hidden `<input type="file">`, parses the file client-side and shows a preview before merging.
- 设置页导出/导入改用插件市场备份页同款浏览器机制：导出返回内存载荷并经 Blob + `<a download>` 下载；导入用隐藏 `<input type="file">`，客户端解析后先预览再合并。
- Import preview shows the file name, entry count and source workspace, with explicit 确认导入 / 取消 actions.
- 导入预览显示文件名、条数、来源工作区，并提供「确认导入 / 取消」。
- `/prompt-recall export [dir]` and `import <file>` keep working for the command surface (host-side files).
- 命令面 `/prompt-recall export [dir]` 与 `import <file>` 仍保留（宿主侧文件）。

### Removed / 移除

- The old settings export/import row (path input + browse + import) and its `dialog.pick` RPC / `exportDir` setting.
- 移除旧的设置页导出/导入行（路径输入 + 浏览 + 导入）及其 `dialog.pick` RPC / `exportDir` 设置。

## [0.5.0] - 2026-10-27

### Added / 新增

- User-selectable export directory and import file in the settings page: native Electron directory/file picker when available, plus a paste-an-absolute-path fallback.
- 设置页支持自选导出目录与导入文件：可用系统选择器（Electron）或直接粘贴绝对路径。
- `dialog.pick` RPC with a structured `unsupported` result, so non-Electron hosts degrade to the text field instead of failing.
- `dialog.pick` RPC：非 Electron 宿主返回 `unsupported`，界面自动退化为路径输入框。
- `exportDir` is persisted in `settings.json` and remembered after a successful export.
- `exportDir` 持久化到 `settings.json`，导出成功后自动记住。

### Changed / 变更

- `/prompt-recall export [dir]` and `/prompt-recall import <file|absolute path>` accept custom locations too.
- `/prompt-recall export [dir]` 与 `import <file|绝对路径>` 同步支持自定义位置。

## [0.4.1] - 2026-10-27

### Fixed / 修复

- Trimming (max entries / retention) is now written back to disk and expired entries are pruned on read, so limits survive a restart and exports match the UI.
- 上限/保留天数的裁剪现在会回写磁盘，并在读取时清理过期条目：重启后不会「复活」旧条目，导出内容与界面一致。
- Settings write failures are reported to the caller and the host log instead of being swallowed as a successful save.
- 设置写盘失败不再被吞成「已保存」，调用方与宿主日志都能看到错误。
- `/prompt-recall` command registration handles hosts whose `register()` returns a promise of a disposer.
- `/prompt-recall` 命令注册兼容 `register()` 返回 disposer Promise 的宿主。
- `settings.get` rejects a non-absolute `cwd` instead of silently returning an empty workspace.
- `settings.get` 对非绝对路径 `cwd` 返回错误，不再静默当作空工作区。

### Changed / 变更

- The settings page validates the numeric ranges, disables Save while invalid, adds a Refresh button and aria labels.
- 设置页增加数值校验（非法时禁用保存）、刷新按钮与无障碍标签。

## [0.4.0] - 2026-10-27

### Added / 新增

- A dedicated settings page in the DSH settings dialog (`settings.section` slot), named **提示词历史 / Prompt History**, with a designed single-page layout.
- 设置对话框左侧新增独立页面「提示词历史」，单页完成全部管理与配置。
- Page contents: capture status, workspace entry count, storage path, capture switch, per-workspace cap, retention days, recent prompts, export / import / clear.
- 页面包含：捕获状态、工作区条数、存储位置、捕获开关、条数上限、保留天数、最近提示词、导出/导入/清空。
- Settings-page RPC endpoints (`settings.get`, `settings.set`, `history.clear`, `history.export`, `history.import`) shared with the command surface.
- 设置页 RPC 端点与命令面共用同一套动作。

## [0.3.0] - 2026-10-27

### Added / 新增

- `/prompt-recall` command: `status`, `on`/`off`, `max <n>`, `keep <days>`, `clear confirm`, `export`, `import <file>`, `reset`.
- `/prompt-recall` 命令：状态、开关、上限、保留天数、清空确认、导出、导入、恢复默认。
- Persistent settings (`plugin-data/<plugin>/settings.json`): capture toggle, per-workspace entry cap, retention days.
- 持久化设置：捕获开关、每工作区条数上限、保留天数。
- Workspace clear and JSON export/import under `plugin-data/<plugin>/exports/`.
- 工作区清空与 JSON 导出/导入（`plugin-data/<plugin>/exports/`）。
- Import dedupes exact entries (timestamp + text) and rejects path traversal.
- 导入按「时间戳 + 文本」精确去重，并拒绝路径穿越。

## [0.2.0] - 2026-10-27

### Added / 新增

- English + Simplified Chinese plugin metadata (`locale/en.json`, `locale/zh.json`) and bilingual docs (`README.md`, `README.zh.md`).
- 中英双语插件元数据与文档。
- `node scripts/build-client.mjs --check` verifies the generated bundle is in sync with `src/`.
- 构建脚本新增 `--check`，校验产物与源码同步。
- Plugin-boundary end-to-end test: capture a prompt in the host, then recall it through the client keyboard bridge.
- 插件边界端到端测试：宿主捕获提示词，客户端按键召回。

### Fixed / 修复

- Recalling a prompt that the composer normalizes (e.g. strips `@reference` placeholders) no longer stops the walk; comparisons use the effective text.
- 引用类提示词被 composer 规范化后，继续按 ↑ 不再中断。
- Two quick ↑ presses before the first history fetch resolves now advance two entries instead of one.
- 首次拉取历史期间连按 ↑ 不再丢步。
- An in-flight fetch can no longer overwrite text the user typed and cleared.
- 在途历史请求不再覆盖用户新输入。
- Host rejects non-absolute `cwd` values from the browser.
- 宿主拒绝非绝对路径的 `cwd`。
- History write/quarantine failures are reported through `onError` instead of being swallowed.
- 历史写入/损坏隔离失败不再静默，经 `onError` 上报。

### Changed / 变更

- `PLUGIN_VERSION` is derived from `package.json` (single source of truth).
- `PLUGIN_VERSION` 改为从 `package.json` 读取，消除手抄漂移。
- RPC channel is the absolute path `/dsh-nonead-prompt-recall` (bare names are rejected by the host).
- RPC 通道改为绝对路径 `/dsh-nonead-prompt-recall`。
- License is now MIT.
- 许可证改为 MIT。

## [0.1.0] - 2026-10-27

### Added / 新增

- Initial release: ↑/↓ prompt history recall in the composer, per-workspace persistence, atomic JSON storage.
- 首个版本：输入框 ↑/↓ 提示词历史召回，按工作区持久化，原子写入。
