# Manual E2E checklist / 手动端到端验收

The automated suite covers the plugin boundary (host capture → RPC → client key
handling → composer facade). The last mile — a real DSH Desktop window — still
needs a human or desktop-automation pass after the host reloads.

自动化测试覆盖插件边界（宿主捕获 → RPC → 客户端按键 → composer facade）；真实
DSH Desktop 窗口这一公里需要宿主重载后由人工或桌面自动化走一遍。

## Preconditions / 前置条件

1. The plugin is installed and enabled (Plugins page shows **Prompt Recall** /
   **提示词召回**), either from the registry (`dsh plugin add dsh-nonead-prompt-recall`)
   or from this checkout through the plugin page's local-directory option.
2. The host was restarted after the last code change, and the page was reloaded (client bundles load at page boot).
3. `<DSH_HOME>/logs/nonead-dsh-desktop.log` contains:
   `[dsh-nonead-prompt-recall] host ready v0.8.2`.

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

## Prompt optimization smoke / 提示词优化冒烟（0.8.0，17 步）

前提：设置 → 提示词历史里「提示词优化」开关为开（默认开），会话里至少有一个可用模型。
Reload the page after a client change; restart the host after a `lib/` change.

| # | Action / 操作 | Expected / 预期 |
| --- | --- | --- |
| O1 | 输入框为空，观察模型选择器右侧 | 四角星可见但**置灰**，`title` 显示「输入内容后可优化」 |
| O2 | 输入「帮我把这段代码改成 async」 | 按钮变为可点，`title` 显示「优化提示词（仅文本）」 |
| O3 | 点击四角星 | 按钮转圈（`aria-busy=true`），**输入框原文不动**；再点一次可取消 |
| O4 | 保持不动，等这次请求返回 | 成功时输入框被替换为改写结果，图标变成返回箭头；toast「已优化，可撤销」 |
| O5 | 点击返回箭头 | 输入框恢复原始草稿（含 `@` 引用 chip），图标回到四角星 |
| O6 | 再次优化，成功后按发送键 | 改写结果被正常发送；撤销入口消失（快照作废） |
| O7 | 优化进行中手动改一个字 | 请求返回时**丢弃结果**、保留你改后的内容，toast「输入已变更，优化结果已丢弃」 |
| O8 | 优化进行中点击取消 | 输入框不动，无报错 toast，图标回四角星 |
| O9 | 输入 `@` 引用一个文件 + 一段文字，点击优化 | 提交给模型的只有文本（引用以 `⟦C1⟧` 遮罩）；返回后 chip 原位保留，文字被改写 |
| O10 | 附件区拖入一张图片 + 一段文字，点击优化 | 按钮可点；图片原样保留，只有文字被改写 |
| O11 | 只放附件、不输入文字 | 按钮置灰，`title` 显示「输入内容后可优化」 |
| O12 | 在输入框放超过 8000 字符的文本 | 按钮置灰，`title` 显示「文本超过 8000 字符」 |
| O13 | 在助手回答**正在流式输出**时点击四角星 | 优化照常进行，不影响回答；「停止生成」不会取消优化 |
| O14 | 设置里把「提示词优化」关掉并保存 | 回到输入框后四角星**消失**（无需刷新页面），再次开启后恢复 |
| Q1 | 设置页展开「模型提示词（只读）」 | 显示提示词全文（等宽、可滚动）、版本 badge、字符数；没有可编辑控件 |
| Q2 | 点击「复制」 | 按钮短暂显示「已复制」，剪贴板内容与查看器一致 |
| Q3 | 检查八种语言（设置 → 通用 → 语言） | 按钮 tooltip、toast、设置卡片与查看器文案都跟随语言，无裸 key |

备注：O3–O8 需要一次真实模型调用；若上游限流或超时，应看到 toast「优化失败，已保留原文」且输入框不变——这同样算通过（失败分支的行为正确）。
