# Release checklist / 发布前检查清单

Run from the repository root on Windows (Node 24) unless noted.

在仓库根目录执行（Windows、Node 24）。

Target version / 目标版本：**v0.6.1**。

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

Expected: **17 files / ~40 KB** unpacked from a clean tree. The tarball must contain exactly these areas — no `src/`, `test/`, `scripts/`,
`.github/`, `.tmp/` or project-memory files:

- `lib/` (host + generated client bundle)
- `locale/` (`en.json`, `zh.json`)
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

- log contains `[dsh-nonead-prompt-recall] host ready v0.6.1`;
- Settings → 提示词历史 shows the history glyph in the nav, the v0.6.1 header/status layout, and export / import / clear above the list;
- empty composer + ↑ recalls the newest prompt, ↑ walks older, ↓ walks back;
- `/prompt-recall status` responds;
- 导出 JSON downloads a file; 导入并预览 shows the preview and merges on confirm;
- restart DSH and confirm history and settings survive.

See [E2E.md](./E2E.md) for the full manual matrix (keyboard, command, settings,
backup paths).

## 5. Publish (when the repository is ready) / 发布

Prerequisite: `npm login` and a free package name (unscoped public package).

前提：已 `npm login`，且包名可用（无 scope 的公开包）。

```powershell
npm publish --access public
```

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
