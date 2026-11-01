# dsh-nonead-prompt-recall

**English** · [简体中文](./README.zh.md)

[![npm version](https://img.shields.io/npm/v/dsh-nonead-prompt-recall.svg?logo=npm&logoColor=white&label=npm)](https://www.npmjs.com/package/dsh-nonead-prompt-recall) [![npm downloads](https://img.shields.io/npm/dm/dsh-nonead-prompt-recall.svg?logo=npm&logoColor=white&label=downloads)](https://www.npmjs.com/package/dsh-nonead-prompt-recall) [![CI](https://img.shields.io/github/actions/workflow/status/NoneadChina/dsh-nonead-prompt-recall/ci.yml?branch=main&label=CI&logo=github)](https://github.com/NoneadChina/dsh-nonead-prompt-recall/actions) [![tag](https://img.shields.io/github/v/tag/NoneadChina/dsh-nonead-prompt-recall?label=tag&logo=git&logoColor=white)](https://github.com/NoneadChina/dsh-nonead-prompt-recall/tags) [![stars](https://img.shields.io/github/stars/NoneadChina/dsh-nonead-prompt-recall?logo=github)](https://github.com/NoneadChina/dsh-nonead-prompt-recall/stargazers) [![license](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

[![node](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org) [![dsh](https://img.shields.io/badge/dsh-%3E%3D0.2.1--rc.1-4B6BFB)](./docs/RELEASE.md) [![tests](https://img.shields.io/badge/tests-122%20passing-brightgreen)](./test) [![languages](https://img.shields.io/badge/languages-8-8A2BE2)](./locale) [![platform](https://img.shields.io/badge/platform-DSH%20web-2F6FEB)](./package.json)

Two composer features for DeepSeek Harness: shell-style **prompt history recall** and one-click **prompt optimization**.

Current version: **0.8.2**.

**History recall**

- Press **↑** in an empty composer to load the last prompt you sent;
- press **↑** again to walk further back;
- press **↓** to walk forward and finally return to the empty draft;
- history is isolated **per workspace**, persisted on disk, and survives a DSH Desktop restart;
- once you type or edit, ↑/↓ behave like normal caret movement.

**Prompt optimization**

- A sparkle button in the composer tool row (right of the model selector) rewrites the draft with the session's model;
- the original stays visible while the request runs, only a successful rewrite replaces it — and only once;
- the result waits in the composer: the plugin never sends, never clears the draft early, and never writes to your history;
- `@` references are kept (their content never reaches the model), attachments and images neither block nor take part;
- the icon turns into an undo arrow after a successful rewrite; one click restores the original draft.

## Contents

- [Behavior](#behavior) · [Install](#install) · [Verify](#verify) · [Settings page](#settings-page) · [Prompt optimization](#prompt-optimization)
- [Commands](#commands) · [Data layout](#data-layout) · [Architecture](#architecture) · [Localization](#localization)
- [Development](#development) · [Documentation](#documentation) · [Compatibility](#compatibility)

## Behavior

| Situation | ↑ | ↓ |
| --- | --- | --- |
| Empty composer | load history #1 (newest) | not intercepted |
| Browsing history (unedited) | load an older prompt | load a newer prompt / return to the empty draft |
| Hand-typed or edited draft | not intercepted, normal caret movement | not intercepted |
| Empty history | not intercepted | not intercepted |

- Two consecutive identical submissions are stored once (so holding ↑ does not get stuck on one entry).
- One prompt is capped at 32,000 characters; one workspace keeps at most 500 entries.
- Only **human input** is recorded: plugin injections, continuation rituals and tool-sourced messages never enter the history.
- The composer may normalize a draft (for example `@reference` targets are stripped); the next ↑/↓ compares against the *effective* text, so walking back keeps working after such a fill.

## Install

### Option A: from the npm registry (simplest)

The package is public on npm: [dsh-nonead-prompt-recall](https://www.npmjs.com/package/dsh-nonead-prompt-recall).

- In DSH Desktop, open the Plugins page, choose **Add plugin**, and enter the package name:

```
dsh-nonead-prompt-recall
```

- For any profile that the Electron app does not own, the CLI is equivalent:

```powershell
dsh plugin --profile <profile-name> add dsh-nonead-prompt-recall
```

### Option B: plugin page with a local checkout (the `desktop` profile can also use this)

In DSH Desktop open the Plugins page, choose **Add plugin**, and enter the repository path (the box accepts a local directory):

```
D:/MyProgram/GitHub/dsh-nonead-prompt-recall
```

The `desktop` profile is owned exclusively by the Electron app; direct CLI installs against it are rejected:

```
error: profile "desktop" is managed exclusively by the Electron application
```

A local-directory install is linked (junction), not copied: edits in the checkout take effect after a page refresh (client half) or a host restart (host half).

### Option C: other profiles from a local checkout (CLI)

```powershell
dsh plugin --profile <profile-name> add "file:D:/MyProgram/GitHub/dsh-nonead-prompt-recall"
```

Refresh the page (or restart DSH Desktop) afterwards so the browser bundle loads.

> Installing this plugin must never send DSH into recovery mode. If the starter logs `web boot: N entry did not activate`, a client slot was taken over by another plugin — see [Compatibility](#compatibility) for the slot this plugin uses and why.

## Verify

History:

1. Send a prompt in any workspace (for example `test prompt 1`);
2. clear the composer and press **↑** — `test prompt 1` should appear;
3. send another prompt, clear, then press **↑** twice — the recent prompts should appear in order;
4. press **↓** to walk back to the empty draft;
5. quit and restart DSH Desktop, then press **↑** again — the history is still there.

Optimization:

6. Type `帮我把这段代码改成 async`, then click the sparkle button — the icon spins in place, the draft stays visible, and after the rewrite the icon becomes an undo arrow;
7. click the undo arrow — the original draft is restored; click it, rewrite again, then press Send — the rewritten text is sent and the undo entry disappears;
8. type a draft containing an `@reference` plus some text and optimize — the reference chip stays in place, only the text is rewritten;
9. open **Settings → 提示词历史 → 提示词优化** — the card shows the enable switch and a read-only prompt viewer; toggling the switch takes effect immediately (the button disappears/reappears without a page refresh).

The history file can be inspected directly:

```
<DSH_HOME>/plugin-data/dsh-nonead-prompt-recall/history/<workspace-key>.json
```

## Settings page

Open **Settings → 提示词历史** (the row is localized; an English UI reads **Prompt History**). The row uses a history glyph instead of the generic gear, and the page is one scrollable surface:

- **Header** — plugin icon, version badge and a refresh button;
- **Status** — capture state, entry count, current workspace and storage path;
- **Capture settings** — enable switch, per-workspace cap (1–5000 entries), retention days (0 = forever), with unit-suffixed inputs and Save / validation feedback;
- **Prompt optimization** — enable switch for the composer button (saved on click) and a collapsible, read-only viewer for the built-in model prompt: version badge, character count, copy button, no editor and no "restore default";
- **History** — export / import / clear sit above the recent list, so they stay reachable in a short window; the list shows the five newest prompts for the current workspace.

Export downloads a timestamped JSON file through the browser. Import opens a file picker, parses the JSON in the page (8MB / 20,000-entry limits) and shows the file name, entry count, source workspace and the first five prompts before you confirm the merge.

## Prompt optimization

Since 0.8.0 a sparkle button sits in the composer tool row, immediately **to the right of the model selector** (DSH renders that slot's outlet there; the button is nudged into place with `order`, so it never competes with DSH's own voice-input control).

**State machine**

| State | Icon | Click does |
| --- | --- | --- |
| ready (draft has text) | sparkle | send one auxiliary request and start optimizing |
| optimizing | spinning arc, turning in place | cancel — the draft is untouched |
| done (rewrite landed) | undo arrow | restore the original draft (references included) |
| idle (empty / command draft / over limit) | greyed sparkle | nothing; the tooltip says why |

**What it does with your draft**

- The request carries the draft text only. The transcript, the prompt history and the settings file are never touched, and nothing is sent for you.
- While the request runs the draft stays visible; the rewrite replaces it only on success, exactly once. A failure, a timeout, a cancellation, or an edit you made meanwhile leaves your input exactly as it was.
- `@` references are masked as `⟦C1⟧`-style sentinels before the call and re-inserted at their new positions only if the model kept every sentinel in order. Their content never reaches the model, and a damaged response is discarded rather than written.
- Attachments and images neither block nor take part in the rewrite; the button is disabled only when the text segment is empty or longer than **8,000 characters**.
- Turns do not collide: optimization is an independent auxiliary call, so it works while an answer is streaming, "Stop generating" does not cancel it, and cancelling it never stops the answer.
- Limits: a 20-second deadline, an 800-output-token cap on the model call, a prompt rule asking for `max(60, 1.35 × input)` characters (never more than 1,200), and one in-flight request per session.

**Feedback**

| Situation | What you see |
| --- | --- |
| Rewrite landed | icon becomes the undo arrow; a polite live region announces it |
| Model judged the draft already clear | toast "Already clear enough; nothing changed", draft untouched |
| Model returned nothing | toast "The model returned nothing", draft untouched |
| You edited the draft meanwhile | toast "Input changed; result discarded", your edit wins |
| Reference structure changed | toast "Reference structure changed; optimization cancelled" |
| No model / adapter in this session | toast "No model available in this session" |
| Failure, timeout, upstream error | toast "Optimization failed; original kept" |
| You cancelled it | silence — no toast, no write |

**Settings**

**Settings → 提示词历史 → Prompt optimization** turns the button off entirely (hidden, not just disabled) and shows the built-in system prompt read-only: version badge, character count and a copy button. The switch saves on click; no page-level Save is needed, and the composer picks up the change immediately. The prompt itself is maintained by the plugin and ships with the version — there is no editor, by design.

**Privacy**

The draft goes to the session's model and nowhere else. The plugin logs stable error codes only — never your prompt text — and optimization produces no transcript message and no history entry.

## Commands

`/prompt-recall` manages capture settings and the stored history. Settings persist
in `settings.json` next to the history files. Prompt optimization is UI-only today: it has no subcommand, and its switch lives in the settings page.

| Subcommand | Effect |
| --- | --- |
| `status` / `help` | show capture state, caps, retention and the entry count of this workspace |
| `on` / `off` | toggle capture (existing history is kept) |
| `max <n>` | entries kept per workspace (1–5000) |
| `keep <days>` | drop entries older than N days (0 = forever) |
| `clear confirm` | delete this workspace's history |
| `export` | write a JSON export under `plugin-data/<plugin>/exports/` |
| `import <file>` | merge an exported file back (exact duplicates skipped) |
| `reset` | restore the default settings |

## Data layout

```
<DSH_HOME>/plugin-data/dsh-nonead-prompt-recall/
├── history/<workspace-key>.json    # newest-first entries
├── settings.json                   # capture toggle, caps, retention, optimization switch
└── exports/<workspace-key>-<ts>.json
```

- `workspace-key` = the first 24 hex characters of the SHA-256 of the normalized workspace path;
- the file is `{ version, cwd, updatedAt, entries: [{ text, at, sessionId? }] }` with newest entries first;
- writes use a temporary file + atomic rename; a corrupt file is renamed to `*.corrupt-<timestamp>` and capture restarts from an empty list;
- `exports/` is only used by the `/prompt-recall export` command — the settings page downloads the payload in memory and never writes it;
- prompt optimization writes **nothing** here: no draft copy, no result, no undo state (the undo snapshot lives in page memory and disappears on reload).

`settings.json` carries the optimization block next to the capture settings:

```json
{
  "enabled": true,
  "maxEntries": 500,
  "retentionDays": 0,
  "optimize": { "enabled": true, "maxChars": 8000 }
}
```

## Architecture

```
session/event (user/message, source.kind=user)
        │
        ▼
lib/index.js ── HistoryStore ── per-workspace JSON
        │
        │  connection.rpc.handle('/dsh-nonead-prompt-recall')
        │    ├── history / settings.* / history.*      (history + settings)
        │    ├── optimize        → lib/optimize-host.js → ctx.llm.stream(...)
        │    └── optimize.prompt → built-in prompt + version
        ▼
lib/client.js (browser)
        ├── conversation.input.shell(id).setDraft(draft)   (history recall + undo)
        └── conversation.input.right slot → src/optimize-button.js → optimize RPC
        ▲
        └─ document keydown (capture) on [data-composer-input]
```

- **host half**: listens to `session/event`, persists human prompts per workspace, and exposes `/dsh-nonead-prompt-recall` over Connection RPC (the channel name must be an absolute path). Endpoints: `history`, `ping`, `settings.get`, `settings.set`, `history.clear`, `history.export`, `history.importPayload`, `optimize`, `optimize.prompt`; `history.export` returns an in-memory payload and never writes a host file.
- **optimization host path** (`lib/optimize-host.js`): validates the payload (setting, text length, `sessionId`, reserved for one in-flight request per session), resolves the route (the pair the browser sends, otherwise the session's latest logged `request/context`), streams one `ctx.llm.stream` call with a 20-second deadline, cleans and classifies the output, and verifies the reference sentinels before returning. Failures map to stable `prompt-recall/optimize-*` codes; the model's error text is never echoed back or logged.
- **client half**: intercepts ↑/↓ on `[data-composer-input]` in the document capture phase and writes the draft through the harness's own composer facade (never by poking the DOM), so draft persistence, the send button and Lexical's undo stack stay consistent. The optimize button is a separate module (`src/optimize-button.js`) registered into the composer's **list** slot and owning its own state machine and toast.
- the browser half is bundled as `window.__ModuleLoader__.load({ id, factory })`, the contract of DSH's client module loader; the bundle is a single shared scope, so module-level identifiers are namespaced.

## Localization

The plugin follows the desktop app's language: whatever language is selected in **Settings → General → Language** (persisted as `locale.preference`) drives the settings page, the composer button, the `/prompt-recall` command output and the Plugins-page title/description. All eight languages DSH ships are covered:

| id | language | files |
| --- | --- | --- |
| `zh` | 简体中文 | `locale/zh.json` |
| `en` | English | `locale/en.json` |
| `ja` | 日本語 | `locale/ja.json` |
| `es` | Español | `locale/es.json` |
| `fr` | Français | `locale/fr.json` |
| `de` | Deutsch | `locale/de.json` |
| `ru` | Русский | `locale/ru.json` |
| `pt` | Português (Brasil) | `locale/pt.json` |

Display metadata on the Plugins page comes from `locale/<id>.json` (lowercase ids, matching DSH's client locales); the settings page registers its dictionaries through `ctx.locale.register(ns, DICTS)` (`src/i18n.js`), and the command surface translates from `lib/i18n.js`. The 24 optimization strings live in `src/i18n-optimize.js` (keys prefixed `opt*`) and are merged into the same registered dictionary, so the settings card and the composer button always speak the same language. Both halves require the `zh` and `en` baselines and fall back to `en`, then to the key itself, for a missing translation. `normalizeLocale()` maps host values such as `zh-CN`, `pt-BR` or `en_US` onto the eight ids and returns `en` for anything unknown.

Each metadata file uses the `meta` namespace:

```json
{ "meta": { "title": "Prompt Recall", "description": "…" } }
```

The host resolves these files through the package `exports` map, so `"./locale/*": "./locale/*"` must stay exported. `package.json`'s `description` is the plain-string fallback for surfaces without locale data (and for npm). Documentation ships in English (`README.md`) and Simplified Chinese (`README.zh.md`).

## Development

```powershell
npm run build:client   # src/*.js -> lib/client.js
npm test               # node:test (uses --test-isolation=none inside the Windows sandbox)
npm run check          # build + syntax check + the whole suite
node scripts/build-client.mjs --check   # fail when lib/client.js is stale
```

- `src/core.js` holds the pure navigation decisions and `src/optimize.js` the pure optimization helpers (empty/limit checks, `⟦Cn⟧` masking and unmasking, draft document assembly) — both unit-testable.
- `src/client.js` is the browser integration (keyboard bridge, settings page, slot registration); `src/optimize-button.js` is the composer button and its state machine; `scripts/build-client.mjs` only strips ESM syntax and concatenates `protocol → i18n-optimize → i18n → core → optimize → settings → optimize-button → client` for the ModuleLoader (no third-party dependency).
- `lib/index.js`, `lib/history-store.js`, `lib/message-text.js`, `lib/optimize-host.js` and `lib/optimize-prompt.js` are plain Node modules and can be tested with `node --test`.
- The suite (122 tests) includes a plugin-boundary end-to-end test (host capture → RPC → key handling → `setDraft`), host-RPC branch tests with a fake `llm`, sentinel masking/unmasking, the client's disable rules and outcome mapping, dictionary key-set checks, settings persistence, and a settings-nav icon test; the real-window checklist is in [docs/E2E.md](docs/E2E.md).
- CI (`.github/workflows/ci.yml`) runs `npm run check` plus the bundle-sync guard on Node 24.
- `PLUGIN_VERSION` is read from `package.json`: bump the version there and add a `CHANGELOG.md` entry when releasing.

## Documentation

- [CHANGELOG.md](CHANGELOG.md) — release history (bilingual);
- [docs/PROMPT-OPTIMIZE.md](docs/PROMPT-OPTIMIZE.md) — the optimization design: UX spec, RPC contract, error codes, masking rules, model prompt;
- [docs/E2E.md](docs/E2E.md) — manual end-to-end matrix (keyboard, commands, settings, backup, and the prompt-optimization pass);
- [docs/RELEASE.md](docs/RELEASE.md) — pre-release checklist, packaging and publish/rollback steps;
- repository: <https://github.com/NoneadChina/dsh-nonead-prompt-recall> · issues: <https://github.com/NoneadChina/dsh-nonead-prompt-recall/issues>.

## Compatibility

- Host: DSH 0.2.1-rc.3 (Nonead DSH Desktop 2.1.11), verified;
- Host contracts relied upon: `[data-composer-input]`, `conversation.input.shell(id).setDraft()`, the `cwd` / `retainedBy.mainView` fields of the `sessions.list` snapshot, `session/event`'s `user/message`, the `conversation.input.right` **list** slot (registered through `ctx.slots.inject` + `ctx.slots.register`), `ctx.get('llm').stream(...)` with its terminal `finish` chunk, `Session.requestContext()` for the last logged route, and `settings.get` / `settings.set` over the plugin's RPC channel.
- `conversation.input.activity` is deliberately **not** used: DSH declares it as a single-occupant slot and already mounts its voice-input button there. Registering a second occupant evicts it and the whole starter fails with `web boot: 1 entry did not activate`, which drops DSH into recovery mode. Keep new controls in list slots such as `conversation.input.right`.
- If a future host changes these contracts, adapt `lib/index.js`, `lib/optimize-host.js`, `src/client.js` and `src/optimize-button.js` (the changes are concentrated there).
