# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/).

本文件记录所有值得注意的改动，格式参考 Keep a Changelog，版本号遵循语义化版本。

## [0.6.3] - 2026-10-28

### Added / 新增

- `repository`, `homepage` and `bugs` metadata, so the npm page links back to GitHub and accepts issue reports.
- 补充 `repository`、`homepage`、`bugs` 元数据，npm 页面可跳回 GitHub 仓库并接受 Issue。

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
