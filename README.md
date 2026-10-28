# dsh-nonead-prompt-recall

**English** | [简体中文](README.zh.md)

A DeepSeek Harness plugin that gives the composer shell-style **prompt history recall**.

Current version: **0.6.3**.

- Press **↑** in an empty composer to load the last prompt you sent;
- press **↑** again to walk further back;
- press **↓** to walk forward and finally return to the empty draft;
- history is isolated **per workspace**, persisted on disk, and survives a DSH Desktop restart;
- once you type or edit, ↑/↓ behave like normal caret movement.

## Contents

- [Behavior](#behavior) · [Install](#install) · [Verify](#verify) · [Settings page](#settings-page)
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

## Verify

1. Send a prompt in any workspace (for example `test prompt 1`);
2. clear the composer and press **↑** — `test prompt 1` should appear;
3. send another prompt, clear, then press **↑** twice — the recent prompts should appear in order;
4. press **↓** to walk back to the empty draft;
5. quit and restart DSH Desktop, then press **↑** again — the history is still there;
6. open **Settings → 提示词历史** and confirm the history icon in the left navigation, the new header/status layout, and the export / import / clear actions.

The history file can be inspected directly:

```
<DSH_HOME>/plugin-data/dsh-nonead-prompt-recall/history/<workspace-key>.json
```

## Settings page

Open **Settings → 提示词历史** (the row is localized; an English UI reads **Prompt History**). The row uses a history glyph instead of the generic gear, and the page is one scrollable surface:

- **Header** — plugin icon, version badge and a refresh button;
- **Status** — capture state, entry count, current workspace and storage path;
- **Capture settings** — enable switch, per-workspace cap (1–5000 entries), retention days (0 = forever), with unit-suffixed inputs and Save / validation feedback;
- **History** — export / import / clear sit above the recent list, so they stay reachable in a short window; the list shows the five newest prompts for the current workspace.

Export downloads a timestamped JSON file through the browser. Import opens a file picker, parses the JSON in the page (8MB / 20,000-entry limits) and shows the file name, entry count, source workspace and the first five prompts before you confirm the merge.

## Commands

`/prompt-recall` manages capture settings and the stored history. Settings persist
in `settings.json` next to the history files.

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
├── settings.json                   # capture toggle, caps, retention
└── exports/<workspace-key>-<ts>.json
```

- `workspace-key` = the first 24 hex characters of the SHA-256 of the normalized workspace path;
- the file is `{ version, cwd, updatedAt, entries: [{ text, at, sessionId? }] }` with newest entries first;
- writes use a temporary file + atomic rename; a corrupt file is renamed to `*.corrupt-<timestamp>` and capture restarts from an empty list;
- `exports/` is only used by the `/prompt-recall export` command — the settings page downloads the payload in memory and never writes it.

## Architecture

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

- **host half**: listens to `session/event`, persists human prompts per workspace, and exposes `/dsh-nonead-prompt-recall` over Connection RPC (the channel name must be an absolute path). Endpoints: `history`, `ping`, `settings.get`, `settings.set`, `history.clear`, `history.export`, `history.importPayload`; `history.export` returns an in-memory payload and never writes a host file.
- **client half**: intercepts ↑/↓ on `[data-composer-input]` in the document capture phase and writes the draft through the harness's own composer facade (never by poking the DOM), so draft persistence, the send button and Lexical's undo stack stay consistent.
- the browser half is bundled as `window.__ModuleLoader__.load({ id, factory })`, the contract of DSH's client module loader.

## Localization

Display metadata on the Plugins page is localized through `locale/<id>.json` (language ids are lowercase, matching DSH's client locales):

- `locale/en.json` — English anchor (required; its presence enables localized metadata);
- `locale/zh.json` — Simplified Chinese.

Each file uses the `meta` namespace:

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

- `src/core.js` holds the pure navigation decisions (unit-testable); `src/client.js` is the browser integration; `scripts/build-client.mjs` only strips ESM syntax and wraps it for the ModuleLoader (no third-party dependency).
- `lib/index.js`, `lib/history-store.js` and `lib/message-text.js` are plain Node modules and can be tested with `node --test`.
- The suite (65 tests) includes a plugin-boundary end-to-end test (host capture → RPC → key handling → `setDraft`) and a settings-nav icon test; the real-window checklist is in [docs/E2E.md](docs/E2E.md).
- CI (`.github/workflows/ci.yml`) runs `npm run check` plus the bundle-sync guard on Node 24.
- `PLUGIN_VERSION` is read from `package.json`: bump the version there and add a `CHANGELOG.md` entry when releasing.

## Documentation

- [CHANGELOG.md](CHANGELOG.md) — release history (bilingual);
- [docs/E2E.md](docs/E2E.md) — manual end-to-end matrix (keyboard, commands, settings, backup);
- [docs/RELEASE.md](docs/RELEASE.md) — pre-release checklist, packaging and publish/rollback steps;
- repository: <https://github.com/NoneadChina/dsh-nonead-prompt-recall> · issues: <https://github.com/NoneadChina/dsh-nonead-prompt-recall/issues>.

## Compatibility

- Host: DSH 0.2.1-rc.3 (Nonead DSH Desktop 2.1.11), verified;
- Host contracts relied upon: `[data-composer-input]`, `conversation.input.shell(id).setDraft()`, the `cwd` / `retainedBy.mainView` fields of the `sessions.list` snapshot, and `session/event`'s `user/message`. If a future host changes them, adapt `lib/client.js` and `src/client.js` (the changes are concentrated there).
