# Release checklist / 发布前检查清单

Run from the repository root on Windows (Node 24) unless noted.

在仓库根目录执行（Windows、Node 24）。

Target version / 目标版本：**v0.8.2**。

## 1. Pre-flight / 预检

```powershell
npm run check                      # build + syntax + all tests
node scripts/build-client.mjs --check
```

Expected: tests all pass, `lib/client.js is up to date`.

## 2. Package contents / 包内容

```powershell
npm pack --dry-run --cache .tmp\npm-cache
```

Expected: **33 files / ~380 KB** unpacked from a clean tree (~148 KB tarball). The tarball must contain exactly these areas — no `src/`, `test/`, `scripts/`,
`.github/`, `.tmp/` or project-memory files:

- `lib/` (host + generated client bundle)
- `assets/icons/` (the four SVG icon sources linked from the design doc)
- `locale/` (`zh.json`, `en.json`, `ja.json`, `es.json`, `fr.json`, `de.json`, `ru.json`, `pt.json`)
- `cordis.patch.yml`
- `README.md`, `README.zh.md`, `CHANGELOG.md`, `LICENSE`, `docs/E2E.md`, `docs/RELEASE.md`

## 3. Extracted-package smoke / 解包冒烟

```powershell
npm pack --cache .tmp\npm-cache
# extract the printed .tgz to .tmp/release-check and run:
node --input-type=module -e "import('file:///<...>/package/lib/index.js').then(m => console.log(m.name, m.PLUGIN_VERSION))"
```

The host entry must expose `name`, `PLUGIN_VERSION`, `RPC_CHANNEL`; the client
bundle must load through `window.__ModuleLoader__` and export `apply`.

## 4. Runtime smoke / 真实运行冒烟

Restart DSH Desktop, refresh, then check:

- log contains `[dsh-nonead-prompt-recall] host ready v0.8.2`;
- the starter does not fall back to recovery mode (`web boot: N entries did not activate` must not appear — the 0.8.2 fix moved the optimize button into the list slot `conversation.input.right`);
- Settings → 提示词历史 shows the history glyph in the nav, the v0.8.2 header/status layout, export / import / clear above the list, and the new **Prompt optimization** card (switch + read-only prompt viewer);
- the sparkle button appears in the composer tool row next to the model selector and rewrites a non-empty draft;
- switch Settings → General → Language across 中文 / English / 日本語 / Español / Français / Deutsch / Русский / Português and confirm the section label, page copy and `/prompt-recall status` follow the selection;
- empty composer + ↑ recalls the newest prompt, ↑ walks older, ↓ walks back;
- `/prompt-recall status` responds;
- 导出 JSON downloads a file; 导入并预览 shows the preview and merges on confirm;
- **提示词优化**：模型选择器右侧的四角星在空草稿时置灰、有文本时可点；点击后原文不动、成功后替换、返回箭头可撤销；含 `@` 引用的草稿改写后 chip 原位保留；助手流式输出期间仍可用；
- 设置页把「提示词优化」关掉后四角星立即消失，重新开启后恢复；
- 查看器展开显示提示词全文、版本、字符数，复制可用且无编辑入口；
- restart DSH and confirm history and settings survive.

See [E2E.md](./E2E.md) for the full manual matrix (keyboard, command, settings,
backup paths, and the 17-step prompt-optimization pass).

## 5. Publish / 发布

The package is public: [dsh-nonead-prompt-recall](https://www.npmjs.com/package/dsh-nonead-prompt-recall). `0.7.0` is the latest published release (eight-language UI, `gitHead` bc51957); `0.8.0` (prompt optimization, README refresh and the 0.7.1 docs patch rolled together) and `0.8.2` (slot-conflict boot fix) are prepared and still have to be published. `0.6.3` added the metadata fix and `0.6.2` was the first version.

包已公开发布：`0.7.0` 是最新已发布版本（八语言界面，`gitHead` bc51957）；`0.8.0`（提示词优化 + README 头部改版 + 0.7.1 文档补丁合并）与 `0.8.2`（插槽冲突导致的启动修复）已就绪、待发布。`0.6.3` 修了元数据，`0.6.2` 是首个版本。

Prerequisite: `npm login`. This account asks for proof-of-presence on every publish (OTP prompt or the browser URL npm prints), so publishing from a terminal the maintainer controls is the reliable path.

前提：已 `npm login`。本账号每次发布都要求 proof-of-presence（OTP 或 npm 打印的浏览器链接），因此由维护者在自己终端执行最稳妥。

```powershell
npm publish --access public
```

Notes / 注意：

- npm 11 may create a `0.0.0-stage` placeholder while the real version waits for approval; inspect with `npm stage list`, finish with `npm stage approve <id>`. The placeholder is never the `latest` tag.
- Read the registry, not the local cache: `npm view dsh-nonead-prompt-recall dist-tags --prefer-online` or `https://registry.npmjs.org/dsh-nonead-prompt-recall/latest`.
- Compare `dist.shasum` with the locally built tarball (`npm pack`) to prove the uploaded file is the one built here.

Then install from the registry:

```powershell
dsh plugin --profile <profile> add dsh-nonead-prompt-recall
```

For a local build, install by directory instead (`file:<absolute path>`).

## 6. Rollback / 回滚

- `npm unpublish dsh-nonead-prompt-recall@<version>` (within the registry window),
  then publish a fixed patch version;
- locally: disable/remove the plugin in the Plugins page and restart DSH.

## Versioning / 版本约定

- Update `package.json` `version` and add a matching `CHANGELOG.md` heading in
  the same commit; keep `README.md`, `README.zh.md` and `docs/E2E.md` version
  references in sync.
- `PLUGIN_VERSION` is read from `package.json`; never edit it separately.
