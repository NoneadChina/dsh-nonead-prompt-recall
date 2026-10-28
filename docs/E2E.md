# Manual E2E checklist / 手动端到端验收

The automated suite covers the plugin boundary (host capture → RPC → client key
handling → composer facade). The last mile — a real DSH Desktop window — still
needs a human or desktop-automation pass after the host reloads.

自动化测试覆盖插件边界（宿主捕获 → RPC → 客户端按键 → composer facade）；真实
DSH Desktop 窗口这一公里需要宿主重载后由人工或桌面自动化走一遍。

## Preconditions / 前置条件

1. The plugin is installed and enabled (Plugins page shows **Prompt Recall** /
   **提示词召回**).
2. The host was restarted after the last code change, and the page was reloaded (client bundles load at page boot).
3. `<DSH_HOME>/logs/nonead-dsh-desktop.log` contains:
   `[dsh-nonead-prompt-recall] host ready v0.6.3`.

## Steps / 步骤

| # | Action / 操作 | Expected / 预期 |
| --- | --- | --- |
| 1 | Send `E2E 第一条` in a workspace | message appears in the conversation |
| 2 | Clear the composer, press **↑** | `E2E 第一条` is filled in |
| 3 | Send `E2E 第二条`, clear, press **↑** | `E2E 第二条` is filled in |
| 4 | Press **↑** again | `E2E 第一条` (older entry) |
| 5 | Press **↓** twice | `E2E 第二条`, then an empty draft |
| 6 | Press **↑** twice quickly before the fetch resolves | lands two entries back |
| 7 | Quit and restart DSH Desktop, clear, press **↑** | history survived |
| 8 | Type a draft manually, press **↑** | text is untouched (normal caret move) |

## Evidence / 取证

- History file: `<DSH_HOME>/plugin-data/dsh-nonead-prompt-recall/history/<workspace-key>.json`
- Logs: `[dsh-nonead-prompt-recall] …` lines in
  `<DSH_HOME>/logs/nonead-dsh-desktop.log`

Record failures with the exact step number, the visible composer text, and the
matching log lines.

## Command smoke / 命令冒烟

| # | Action / 操作 | Expected / 预期 |
| --- | --- | --- |
| C1 | `/prompt-recall status` | capture state, caps, retention and the entry count |
| C2 | `/prompt-recall max 100` | `max entries set to 100` |
| C3 | `/prompt-recall export` | a path under `plugin-data/<plugin>/exports/` |
| C4 | `/prompt-recall clear confirm` | history for this workspace is empty afterwards |
| C5 | `/prompt-recall import <file>` | entries restored, duplicates skipped |

## Settings page smoke / 设置页冒烟

| # | Action / 操作 | Expected / 预期 |
| --- | --- | --- |
| S1 | Open Settings → 提示词历史 | the row uses the history glyph (not a gear); the page shows the header, status tiles, capture settings and history |
| S2 | Turn capture off, click 保存设置 | the status pill switches to 已关闭 |
| S3 | Set the cap to 100, save | the saved hint appears and the entry count obeys the cap |
| S4 | Click 导出 JSON | the browser downloads `prompt-recall-<key>-<timestamp>.json` |
| S5 | Click 清空 → 确认清空 | the recent list becomes empty |
| S6 | Make the window shorter | the page scrolls internally; export / import / clear stay reachable above the list |

## Backup export / import preview / 备份导出与导入预览

| # | Action / 操作 | Expected / 预期 |
| --- | --- | --- |
| L1 | Click 导出 JSON | the browser downloads `prompt-recall-<key>-<timestamp>.json` |
| L2 | Click 导入并预览, choose that file | a preview shows the file name, entry count and source workspace |
| L3 | Click 确认导入 | entries merge into the current workspace; duplicates are skipped |
| L4 | Choose an invalid/oversized file | an error is shown and no history changes |
| L5 | Click 取消 in the preview | nothing is imported |
