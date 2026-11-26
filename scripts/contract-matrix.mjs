#!/usr/bin/env node
/**
 * DSH contract matrix.
 *
 * This plugin has no `@deepseek-ai/*` dependency: it talks to the host through
 * service names, slot names and documented object shapes. `npm test` can only
 * exercise the plugin's own shims against fakes, so a host release that renames
 * a slot or drops a method passes every unit test and still breaks the plugin in
 * the field.
 *
 * This script closes that gap. For each DSH version the plugin claims to support
 * (package.json `engines.dsh`), it pulls the *publisher's own* source packages
 * from the registry and asserts that every contract point the plugin relies on
 * is still present, naming the file and line that proves it.
 *
 * Nothing here is a substitute for running the desktop app. A green matrix means
 * "the symbols this plugin calls still exist under those names"; it does not
 * mean a slot still renders in the same place.
 *
 * Usage:
 *   node scripts/contract-matrix.mjs                 # representative version per line
 *   node scripts/contract-matrix.mjs --all           # every published 0.2.x version
 *   node scripts/contract-matrix.mjs --versions 0.2.3-alpha.2
 *   node scripts/contract-matrix.mjs --offline       # cache only, never fetch
 *   node scripts/contract-matrix.mjs --json          # machine-readable output
 *
 * Exit code: 1 when a required contract is missing on a version the plugin claims
 * to support, 0 otherwise. Optional contracts read as `degraded`, never failing.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const CACHE = join(ROOT, '.tmp', 'compat');
const TARBALLS = join(CACHE, 'tarballs');

/**
 * Versions the plugin claims in `engines.dsh` (`>=0.2.1-rc.1 <0.3.0-0`).
 * `--all` runs this whole list; the default runs the last version of each line
 * plus every pre-release the plugin's own history names (see README).
 */
const ALL_VERSIONS = [
  '0.2.1-rc.1',
  '0.2.1-rc.2',
  '0.2.1-rc.3',
  '0.2.1-rc.4',
  '0.2.1-rc.5',
  '0.2.2-alpha.2',
  '0.2.2-alpha.3',
  '0.2.2-rc.1',
  '0.2.2-rc.2',
  '0.2.2-rc.3',
  '0.2.2-rc.4',
  '0.2.2-rc.5',
  '0.2.3-alpha.1',
  '0.2.3-alpha.2',
];

const DEFAULT_VERSIONS = ['0.2.1-rc.1', '0.2.2-alpha.3', '0.2.2-rc.5', '0.2.3-alpha.2'];

/**
 * Registry packages that carry each contract. Names are the publisher's; when a
 * package is absent from a version the row reads `absent` rather than failed,
 * because the plugin's fallback path is what would actually run there.
 */
const PACKAGES = {
  // Host half: the surfaces lib/index.js registers through.
  commands: '@deepseek-ai/dsh-commands',
  settings: '@deepseek-ai/dsh-settings',
  connection: '@deepseek-ai/dsh-client-connection',
  // Client half.
  slots: '@deepseek-ai/dsh-client-ui-slots',
  locale: '@deepseek-ai/dsh-client-locale',
  conversation: '@deepseek-ai/dsh-client-ui-conversation',
  uiSettings: '@deepseek-ai/dsh-client-ui-settings',
  sessions: '@deepseek-ai/dsh-api-session-controller',
  modules: '@deepseek-ai/dsh-client-modules',
  manifest: '@deepseek-ai/dsh-package-manifest',
  renderer: '@deepseek-ai/dsh-client-ui-renderer',
};

/**
 * Every row is one thing the plugin calls. `required` distinguishes a contract
 * whose absence breaks a user-visible feature from one the plugin degrades
 * around on purpose (the reason is in `fallback`).
 */
const CONTRACTS = [
  {
    id: 'module.meta.stylesheets',
    pkg: 'manifest',
    pattern: /stylesheets\s*\?/,
    required: false,
    says: 'client module meta() may declare stylesheets',
    fallback: 'src/settings.js and src/optimize-button.js still inject a <style data-plugin> element when the host never applies meta().stylesheets.',
  },
  {
    id: 'module.loader.load',
    pkg: 'modules',
    pattern: /\.load\s*\(/,
    required: true,
    says: 'window.__ModuleLoader__.load(registration) accepts the bundle build-client.mjs emits',
  },
  {
    id: 'slots.register',
    pkg: 'slots',
    // Older versions ship only `lib/index.js` (compiled, no type annotations),
    // so the pattern has to accept both `register(options: ErasedOptions, …)`
    // and `register(options, component) {`.
    pattern: /register\s*\(\s*options\s*[,:)]/,
    required: true,
    says: 'slots.register({ name, id, order, label, inject }, Component)',
  },
  {
    // `slots.inject` is the renderer's declaration-epoch hook, not a Slots
    // package member: registry.ts wraps the callback in a nested cordis effect
    // and reruns it whenever the slot is (re)declared. Plugins that gate on
    // `typeof slots.inject` silently skip their surface when it is missing.
    id: 'slots.inject',
    pkg: 'renderer',
    pattern: /slots\.inject\(/,
    required: true,
    says: 'slots.inject(slotName, callback) runs the registration once the slot is declared',
  },
  {
    id: 'locale.register',
    pkg: 'locale',
    pattern: /register\s*\(\s*ns/,
    required: true,
    says: 'locale.register(namespace, dictionaries)',
  },
  {
    id: 'locale.bind',
    pkg: 'locale',
    pattern: /bind\s*\(\s*ns/,
    required: true,
    says: 'locale.bind(namespace) returns the translator',
  },
  {
    id: 'connection.rpc.call',
    pkg: 'connection',
    pattern: /call\s*\(\s*channel/,
    required: true,
    says: 'client rpc.call(channel, endpoint, payload) — the fallback carrier',
  },
  {
    id: 'connection.fetch.register',
    pkg: 'connection',
    pattern: /fetch\s*\.\s*register|register\s*\(\s*route\s*:/,
    required: false,
    says: 'host connection.fetch.register({ path, methods, requestBody, fetch })',
    fallback: 'lib/index.js falls back to connection.rpc.handle on hosts without a fetch carrier (0.2.1-rc.x, early 0.2.2).',
  },
  {
    id: 'connection.rpc.handle',
    pkg: 'connection',
    pattern: /handle\s*\(\s*channel|handle\s*\(/,
    required: false,
    says: 'host connection.rpc.handle(channel, handler) — the legacy carrier',
    fallback: 'lib/index.js prefers connection.fetch.register and only reaches this on hosts that have no fetch carrier.',
  },
  {
    id: 'conversation.slot.input.right',
    pkg: 'conversation',
    pattern: /'conversation\.input\.right'/,
    required: true,
    says: 'the sparkle button mounts into conversation.input.right (a list slot)',
  },
  {
    id: 'conversation.slot.input.activity',
    pkg: 'conversation',
    pattern: /'conversation\.input\.activity'/,
    required: false,
    says: 'the single activity slot the voice button already occupies',
    fallback: 'The button uses conversation.input.right precisely because this slot is a single occupancy.',
  },
  {
    id: 'conversation.input.setDraft',
    pkg: 'conversation',
    pattern: /setDraft\s*\(/,
    required: true,
    says: 'composer setDraft(text) — how ↑ recall and the optimize result land in the box',
  },
  {
    id: 'conversation.input.shell',
    pkg: 'conversation',
    pattern: /shell\s*\(\s*id\s*:/,
    required: false,
    says: 'InputHub.shell(sessionId) resolves one composer without a scope binding',
    fallback: 'src/client.js falls back to input.for(sessions.scope(id)) when shell(id) is absent.',
  },
  {
    id: 'conversation.input.for',
    pkg: 'conversation',
    pattern: /for\s*\(\s*actx\s*:/,
    required: true,
    says: 'InputHub.for(actx) — the scope-bound composer resolver',
  },
  {
    id: 'sessions.scope',
    pkg: 'sessions',
    pattern: /scope\s*\(\s*id\s*[:)]/,
    required: true,
    says: 'sessions.scope(sessionId) returns the AgentContext used for the shell fallback',
  },
  {
    id: 'sessions.list.getSnapshot',
    pkg: 'sessions',
    pattern: /getSnapshot\s*\(/,
    required: true,
    says: 'sessions.list.getSnapshot() enumerates sessions for workspace-qualified history',
  },
  {
    id: 'session.retain.mainView',
    pkg: 'sessions',
    pattern: /mainView/,
    required: false,
    says: 'the mainView reference source marks the session the UI is showing',
    fallback: 'src/client.js degrades to any nonzero retainedBy entry when mainView is absent, so recall still works on hosts that renamed the source.',
  },
  {
    id: 'conversation.draftSnapshot',
    pkg: 'conversation',
    pattern: /draftSnapshot/,
    required: false,
    says: 'shell.draftSnapshot.text is the fastest draft read',
    fallback: 'src/client.js falls through state.getSnapshot().draft, projection.clipboardText and el.textContent.',
  },
  {
    id: 'conversation.clipboardText',
    pkg: 'conversation',
    pattern: /clipboardText/,
    required: false,
    says: 'shell.projection.clipboardText exposes the draft text',
    fallback: 'src/client.js only reaches this after draftSnapshot and state snapshots both come back empty.',
  },
  {
    id: 'conversation.editor.rootElement',
    pkg: 'conversation',
    pattern: /getRootElement/,
    required: false,
    says: 'shell.editor.getRootElement() identifies which composer received the key',
    fallback: 'src/client.js falls back to matching the composer selector when the shell exposes no editor.',
  },
  {
    id: 'session.event.session-event',
    pkg: 'sessions',
    pattern: /'session\/event'/,
    required: true,
    says: 'the host emits session/event(session, event); the plugin captures human prompts from it',
  },
  {
    id: 'session.event.session-disposed',
    pkg: 'sessions',
    pattern: /'session\/disposed'/,
    required: true,
    says: 'session/disposed lets the plugin drop per-session capture state',
  },
  {
    id: 'commands.register',
    pkg: 'commands',
    pattern: /register\s*\(/,
    required: true,
    says: 'commands.register({ name, description, input, handler }) mounts /prompt-recall',
  },
  {
    id: 'settings.describe',
    pkg: 'settings',
    pattern: /describe\s*\(/,
    required: false,
    says: 'settings.describe({ redactSecrets }) reads the host UI locale',
    fallback: 'hostLocale() catches any failure and falls back to English.',
  },
];

function parseArgs(argv) {
  const options = { versions: null, all: false, offline: false, json: false, concurrency: 4 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--all') options.all = true;
    else if (arg === '--offline') options.offline = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--versions') {
      const raw = argv[i + 1];
      if (!raw) throw new Error('--versions needs a comma separated list');
      options.versions = raw.split(',').map((v) => v.trim()).filter(Boolean);
      i += 1;
    } else if (arg === '--concurrency') {
      const raw = Number(argv[i + 1]);
      if (!Number.isInteger(raw) || raw < 1) throw new Error('--concurrency needs a positive integer');
      options.concurrency = raw;
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function registry() {
  return process.env.DSH_COMPAT_REGISTRY ?? 'https://registry.npmmirror.com';
}

function packageDir(version, key) {
  return join(CACHE, version, key);
}

function tarballName(version, key) {
  return `${PACKAGES[key].replace('@deepseek-ai/', 'deepseek-ai-')}-${version}.tgz`;
}

/** Extract `package/` out of a packed tarball into `<cache>/<version>/<key>/`. */
function unpack(tarball, destination) {
  mkdirSync(destination, { recursive: true });
  const result = spawnSync('tar', ['-xzf', tarball, '-C', destination], { stdio: 'pipe' });
  if (result.status !== 0) {
    throw new Error(`tar failed for ${tarball}: ${String(result.stderr ?? '').trim()}`);
  }
}

function fetchPackage(version, key, offline) {
  const destination = packageDir(version, key);
  const source = join(destination, 'package');
  if (existsSync(join(source, 'package.json'))) return { status: 'cached', source };

  if (offline) return { status: 'skipped', source: null, detail: 'not cached and --offline was given' };

  mkdirSync(TARBALLS, { recursive: true });
  const spec = `${PACKAGES[key]}@${version}`;
  // Node refuses to spawn a `.cmd` shim directly on Windows, so npm goes through
  // the shell. One pre-quoted command line keeps Node from warning about
  // shell-mode argument concatenation (DEP0190); every field is a fixed-format
  // package spec or an absolute path this script owns.
  const commandLine = [
    'npm pack',
    spec,
    '--registry',
    registry(),
    '--pack-destination',
    `"${TARBALLS}"`,
    '--silent',
  ].join(' ');
  const packed = spawnSync(commandLine, { stdio: 'pipe', cwd: ROOT, shell: true });
  if (packed.status !== 0) {
    const stderr = String(packed.stderr ?? '').trim().split('\n').slice(-2).join(' ');
    return { status: 'absent', source: null, detail: stderr || `npm pack exited ${packed.status}` };
  }
  const tarball = join(TARBALLS, tarballName(version, key));
  if (!existsSync(tarball)) {
    return { status: 'absent', source: null, detail: 'npm pack produced no tarball under the expected name' };
  }
  unpack(tarball, destination);
  if (!existsSync(join(source, 'package.json'))) {
    return { status: 'absent', source: null, detail: 'tarball has no package/ directory' };
  }
  return { status: 'fetched', source };
}

/** Walk a package tree once and return every text file, so a contract match can name its file. */
function textFiles(source) {
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) continue;
      const size = statSync(full).size;
      if (size > 4 * 1024 * 1024) continue;
      files.push(full);
    }
  };
  walk(source);
  return files;
}

/**
 * Source `.ts` is the publisher's specification; `lib/*.js` is its build. Search
 * source first (it names the signature), then fall back to the build for
 * packages that only ship compiled output.
 */
function searchPackage(source, pattern) {
  const files = textFiles(source);
  const ranked = [
    ...files.filter((file) => /[\\/]src[\\/]/.test(file)),
    ...files.filter((file) => !/[\\/]src[\\/]/.test(file)),
  ];
  for (const file of ranked) {
    const text = readFileSync(file, 'utf8');
    const match = pattern.exec(text);
    if (!match) continue;
    const index = text.lastIndexOf('\n', match.index) + 1;
    const line = (text.slice(0, match.index).match(/\n/g) ?? []).length + 1;
    const end = text.indexOf('\n', match.index);
    return {
      file: relative(source, file).split(sep).join('/'),
      line,
      excerpt: text.slice(index, end === -1 ? match.index + 120 : end).trim().slice(0, 160),
    };
  }
  return null;
}

function evaluate(version, key, contract, offline) {
  const fetched = fetchPackage(version, key, offline);
  // `skipped` is not a verdict: the tarball simply is not cached while
  // --offline forbids fetching. Reporting it as absent would turn a partial
  // cache into a false failure.
  if (fetched.status === 'skipped') {
    return { state: 'skipped', detail: fetched.detail ?? 'not cached' };
  }
  if (fetched.status === 'absent') {
    return { state: 'absent', detail: fetched.detail ?? 'package not available for this version' };
  }
  const hit = searchPackage(fetched.source, contract.pattern);
  if (!hit) return { state: 'missing', detail: `no match for ${String(contract.pattern)}` };
  return { state: 'present', ...hit };
}

async function mapLimit(items, limit, worker) {
  const results = Array.from({ length: items.length });
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(
      'node scripts/contract-matrix.mjs [--all] [--versions a,b] [--offline] [--json] [--concurrency n]\n',
    );
    return 0;
  }

  const versions = options.versions ?? (options.all ? ALL_VERSIONS : DEFAULT_VERSIONS);
  const unknown = versions.filter((version) => !ALL_VERSIONS.includes(version));
  if (unknown.length > 0) {
    process.stderr.write(
      `warning: ${unknown.join(', ')} ${unknown.length === 1 ? 'is' : 'are'} outside the engines range; still checking\n`,
    );
  }

  mkdirSync(CACHE, { recursive: true });

  const jobs = [];
  for (const version of versions) {
    for (const contract of CONTRACTS) jobs.push({ version, contract });
  }

  if (!options.json) {
    process.stderr.write(
      `checking ${CONTRACTS.length} contracts across ${versions.length} DSH version(s); cache ${relative(ROOT, CACHE) || CACHE}\n`,
    );
  }

  let done = 0;
  const rows = await mapLimit(jobs, options.concurrency, async ({ version, contract }) => {
    const outcome = evaluate(version, contract.pkg, contract, options.offline);
    done += 1;
    if (!options.json && done % 10 === 0) {
      process.stderr.write(`  ${done}/${jobs.length}\n`);
    }
    return { version, contract, outcome };
  });

  const byVersion = new Map(versions.map((version) => [version, []]));
  for (const row of rows) byVersion.get(row.version).push(row);

  let failed = 0;
  let degraded = 0;

  // The exit code has to mean the same thing in both output modes.
  if (options.json) {
    for (const row of rows) {
      const state = row.outcome.state;
      if (state !== 'present' && state !== 'skipped' && row.contract.required) failed += 1;
      if (state !== 'present' && state !== 'skipped') degraded += 1;
    }
  }

  if (options.json) {
    const payload = {
      generatedAt: new Date().toISOString(),
      registry: registry(),
      versions: versions.map((version) => ({
        version,
        contracts: byVersion.get(version).map(({ contract, outcome }) => ({
          id: contract.id,
          required: contract.required,
          state: outcome.state,
          file: outcome.file ?? null,
          line: outcome.line ?? null,
          excerpt: outcome.excerpt ?? null,
          detail: outcome.detail ?? null,
        })),
      })),
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    const width = Math.max(...CONTRACTS.map((contract) => contract.id.length));
    process.stdout.write(`\nDSH contract matrix · ${versions.length} version(s) · registry ${registry()}\n\n`);
    process.stdout.write(`${'contract'.padEnd(width)}  ${versions.map((v) => v.padEnd(14)).join('  ')}\n`);
    process.stdout.write(`${'-'.repeat(width)}  ${versions.map(() => '-'.repeat(14)).join('  ')}\n`);
    for (const contract of CONTRACTS) {
      const cells = versions.map((version) => {
        const row = byVersion.get(version).find((entry) => entry.contract.id === contract.id);
        const state = row?.outcome.state ?? 'absent';
        if (state !== 'present' && state !== 'skipped' && contract.required) failed += 1;
        if (state !== 'present' && state !== 'skipped') degraded += 1;
        const marker =
          state === 'present' ? 'ok' : state === 'skipped' ? '--' : state === 'absent' ? 'absent' : 'MISSING';
        return marker.padEnd(14);
      });
      process.stdout.write(`${contract.id.padEnd(width)}  ${cells.join('  ')}\n`);
    }

    const missingRequired = rows.filter(
      (row) => (row.outcome.state === 'missing' || row.outcome.state === 'absent') && row.contract.required,
    );
    const missingOptional = rows.filter(
      (row) => (row.outcome.state === 'missing' || row.outcome.state === 'absent') && !row.contract.required,
    );
    const skipped = rows.filter((row) => row.outcome.state === 'skipped');

    process.stdout.write('\n');
    if (missingRequired.length === 0) {
      process.stdout.write('required contracts: all present on every requested version\n');
    }
    for (const row of missingRequired) {
      process.stdout.write(
        `FAIL  ${row.version}  ${row.contract.id}  (${row.contract.pkg}: ${row.outcome.detail ?? 'missing'})\n`,
      );
    }
    for (const row of missingOptional) {
      process.stdout.write(
        `degraded  ${row.version}  ${row.contract.id} -> ${row.contract.fallback ?? 'no documented fallback'}\n`,
      );
    }
    if (skipped.length > 0) {
      process.stdout.write(
        `skipped  ${skipped.length} check(s) not cached; drop --offline or run \`npm run compat\` once to fill .tmp/compat\n`,
      );
    }

    const fetched = rows.filter((row) => row.outcome.state === 'present').length;
    process.stdout.write(
      `\n${fetched}/${rows.length} contract checks matched · ${failed} required failure(s) · ${degraded} non-present cell(s)\n`,
    );
  }

  return failed > 0 ? 1 : 0;
}

export { ALL_VERSIONS, CONTRACTS, PACKAGES };

// Importable for the structure guard in test/contract-matrix.test.mjs; the CLI
// entry point stays the same.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  run().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
