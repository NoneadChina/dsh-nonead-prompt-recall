# DSH compatibility matrix

This plugin ships as a client module and a host half, and it imports nothing
from `@deepseek-ai/*`. That independence is good for size and bad for safety:
when a DSH release renames a slot, drops a facade method or moves a service,
`npm test` stays green (it exercises our own shims) while the plugin silently
breaks inside the real host.

`scripts/contract-matrix.mjs` closes that gap. For every DSH version the
package claims to support (`engines.dsh` = `>=0.2.1-rc.1 <0.3.0-0`), it
downloads the **publisher's own package** from the registry and asserts that
each contract this plugin depends on is still there, naming the file and line
that proves it.

本插件不 import 任何 `@deepseek-ai/*`，单测只能测自己的 shim；宿主一旦改名或删方法，
单测照绿而现场照样坏。`scripts/contract-matrix.mjs` 补上这一环：对 `engines.dsh`
声称的每个版本，拉发布者自己的包，逐条断言本插件依赖的契约仍然存在，并指出证据所在文件与行。

## Running it / 怎么跑

```bash
npm run compat            # 14 claimed versions, uses the cache when present
npm run compat:offline    # cache only, no network
node scripts/contract-matrix.mjs --versions 0.2.3-alpha.2 --json
```

The run downloads into `.tmp/compat/<version>/<package>/` and keeps the
tarballs in `.tmp/compat/tarballs/`; both live under the git-ignored `.tmp/`.
Exit code is `1` when a **required** contract is missing on a claimed version.
`optional` contracts only downgrade a version to `degraded`, because the plugin
has a documented fallback for them. `--offline` prints `--` for cells whose
tarball is not cached and never counts them as failures, so a partially filled
cache cannot fake a regression; a package that the registry genuinely does not
publish for that version reads `absent` and does fail when required.

跑一次会把包解到 `.tmp/compat/`（git 已忽略）。`required` 契约缺失时退出码为 `1`；
`optional` 只记 `degraded`（有文档化回退）。`--offline` 对未缓存的格子打印 `--`、
不计失败——半满的缓存不会伪装成回归；而 registry 上确实没有该版本的包会记 `absent`，
required 时照样失败。

## Result / 实测结果

Checked 2026-11-26 against all 14 claimed versions (24 contracts × 14 = 336
cells): **310 present, 0 required failures, 26 non-present cells** — and every
one of those 26 is one of the two contracts below, which both have a shipped
fallback.

2026-11-26 对 14 个声称版本全跑（24 条契约 × 14 = 336 格）：**310 格命中、0 条
required 失败、26 格缺失**；26 格全部是下面两条，且两条都有已实现的回退。

| DSH version | `module.meta.stylesheets` | `session.retain.mainView` | other 22 contracts |
| --- | --- | --- | --- |
| 0.2.1-rc.1 … 0.2.1-rc.5 | absent | absent | present |
| 0.2.2-alpha.2, 0.2.2-alpha.3 | absent | absent | present |
| 0.2.2-rc.1 … 0.2.2-rc.5 | absent | absent | present |
| 0.2.3-alpha.1, 0.2.3-alpha.2 | **present** | absent | present |

### `module.meta.stylesheets` — added in 0.2.3-alpha.1

Grep across `@deepseek-ai/dsh-package-manifest` shows no `stylesheets` key at
all before 0.2.3-alpha.1; the module handed to `__ModuleLoader__.load` there is
just `{ id, factory }`. So the bundle's `meta()` factory is ignored on 0.2.1 and
0.2.2, and both `src/settings.js` and `src/optimize-button.js` still append a
`<style data-plugin="dsh-nonead-prompt-recall">` node themselves. On 0.2.3+ the
renderer installs the sheets and tags them, so both helpers return early when
they find that node — exactly one copy of every rule on every host.

旧宿主根本没有 `stylesheets` 这个键，模块就是 `{ id, factory }`，`meta()` 被忽略，
因此两个 helper 仍手动注入 `<style data-plugin>`；0.2.3+ 由 renderer 安装并打标，
两个 helper 发现该节点就直接返回，任何宿主上都只有一份样式。

### `session.retain.mainView` — a runtime label, never a published contract

None of the 14 versions declares this key: `retainedBy` is typed
`Partial<Record<SessionReferenceSource, number>>` and the shipped client
sources never name `mainView` (the base map only has `controllerOperation` and
`gateway`; `draft` is merged in by the conversation package). The **running**
app does write it — `(info?.retainedBy.mainView ?? 0) > 0` appears in the
0.2.3-alpha.2 bundle — so it is a real signal with no published guarantee.

`src/client.js` therefore treats it as a hint, not a contract:

- finite and `> 0` → retained (the host is showing it);
- key present and finite `0`/negative → **not** retained (honour the host's own
  verdict rather than guessing);
- key absent or non-numeric → fall back to "any retained source is non-zero",
  so a host that renames the label still gets recall instead of an empty
  candidate list.

14 个版本都没声明这个键，但运行中的应用确实会写它，所以它是"真实信号、但非发布契约"。
降级规则：有限且 > 0 视为保留；显式 0/负数尊重宿主判定、排除；键缺失或非数值时退回
"任一 retainedBy 计数非零"，改名宿主也不会退化成空候选。

## Maintaining the matrix / 维护

Add a `CONTRACTS` entry whenever the plugin starts calling a new host API, and
prefer a pattern that matches both the TypeScript and the compiled JavaScript
form — older versions ship only `lib/*.js` with no type annotations (a
`register(options:` pattern misses `register(options, component) {` and reports
a false failure). `slots.inject` lives in
`@deepseek-ai/dsh-client-ui-renderer`, not in the slots package, so that entry
points at `renderer`.

新增宿主 API 调用时补一条 `CONTRACTS`；正则要同时接受 TS 与编译产物两种形态
（旧版本只发 `lib/*.js`、没有类型注解）。`slots.inject` 的真身在
`dsh-client-ui-renderer`，不在 slots 包。
