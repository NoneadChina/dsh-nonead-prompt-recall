/**
 * dsh-nonead-prompt-recall — host half.
 *
 * Captures every human prompt submitted to a DSH session (the `session/event`
 * `user/message` boundary), stores it per workspace, and exposes the newest-first
 * list to the browser half over the Connection RPC channel.
 *
 * Design notes:
 * - Capture is host-side so history survives a closed browser window and works
 *   even when no composer is focused.
 * - Storage is one JSON file per workspace under
 *   `<DSH_HOME>/plugin-data/dsh-nonead-prompt-recall/history/`, written atomically.
 * - The browser half only needs one read endpoint (`history`); it never writes.
 */

import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

import { HistoryStore, MAX_TEXT_CHARS } from './history-store.js';
import { SettingsStore } from './settings.js';
import { createPromptRecallCommand } from './commands.js';
import { buildExportPayload, listExports } from './actions.js';
import { userPromptOf } from './message-text.js';

export const name = 'dsh-nonead-prompt-recall';
export const inject = [];

// Single source of truth: the package version. Reading it through require keeps
// one number (package.json) for the host log, the RPC `ping` and npm metadata.
const requireFromHere = createRequire(import.meta.url);
const pkg = requireFromHere('../package.json');

/** Plugin version, derived from package.json. */
export const PLUGIN_VERSION = typeof pkg?.version === 'string' && pkg.version !== '' ? pkg.version : '0.0.0';

/** RPC channel shared with lib/client.js (host channels are absolute: '/name'). */
export const RPC_CHANNEL = '/dsh-nonead-prompt-recall';

/** Data directory name under `<DSH_HOME>/plugin-data/`. */
export const DATA_DIR_NAME = 'dsh-nonead-prompt-recall';

/**
 * Resolve the DSH home directory the same way the host does.
 * @returns {string} absolute home directory.
 */
export function resolveDshHome() {
  const fromEnv = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : '';
  return fromEnv === '' ? join(homedir(), '.dsh') : fromEnv;
}

/**
 * Workspace directory carried by a Session.
 * @param {unknown} session - Cordis Session object from `session/event`.
 * @returns {string} absolute workspace path ('' when unknown).
 */
export function sessionCwd(session) {
  if (session === null || typeof session !== 'object') return '';
  const header = session.header;
  if (header !== null && typeof header === 'object' && typeof header.cwd === 'string') return header.cwd;
  if (typeof session.cwd === 'string') return session.cwd;
  return '';
}

function rpcFailure(code, message) {
  return { ok: false, error: { code, message } };
}

function rpcSuccess(value) {
  return { ok: true, value };
}

/** A workspace directory coming from the browser must look like an absolute path. */
function isPlausibleCwd(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 4096
    && !/[\u0000-\u001f]/u.test(value)
    && (/^[a-zA-Z]:[\\/]/u.test(value) || /^\\\\/u.test(value) || value.startsWith('/'));
}

/**
 * Cordis plugin body.
 * @param {any} ctx - host plugin context.
 */
export function apply(ctx) {
  const dataDir = join(resolveDshHome(), 'plugin-data', DATA_DIR_NAME);
  const rootDir = join(dataDir, 'history');
  const exportsDir = join(dataDir, 'exports');
  const settingsFile = join(dataDir, 'settings.json');
  const logger = ctx?.logger;

  const warn = (message) => {
    try {
      logger?.warn?.(`[dsh-nonead-prompt-recall] ${message}`);
    } catch {
      /* logging must never break capture */
    }
  };

  const settings = new SettingsStore(settingsFile, {
    onError: (error, context) => {
      warn(`settings ${context} failed: ${error instanceof Error ? error.message : String(error)}`);
    },
  });
  const store = new HistoryStore(rootDir, {
    onError: (error, context) => {
      warn(`history ${context} failed: ${error instanceof Error ? error.message : String(error)}`);
    },
  });

  // Settings load asynchronously; capture uses defaults until it lands. The
  // limits are applied to the store as soon as the file is read.
  void settings.load()
    .then((current) => store.setLimits(current))
    .catch((error) => warn(`settings load failed: ${error instanceof Error ? error.message : String(error)}`));

  try {
    logger?.info?.(`[dsh-nonead-prompt-recall] host ready v${PLUGIN_VERSION} (${rootDir})`);
  } catch {
    /* logging must never break startup */
  }

  // ---- capture -----------------------------------------------------------
  /** Highest processed native seq per session: protects against re-delivery. */
  const lastSeq = new Map();
  try {
    ctx.on(
      'session/event',
      (session, event) => {
        try {
          const text = userPromptOf(event);
          if (text === null) return;
          if (!settings.get().enabled) return;
          const cwd = sessionCwd(session);
          if (cwd === '') return;
          const sessionId = typeof session?.id === 'string' ? session.id : undefined;
          const seq = Number(event?.seq);
          if (Number.isFinite(seq) && sessionId !== undefined) {
            const previous = lastSeq.get(sessionId);
            if (previous !== undefined && seq <= previous) return;
            lastSeq.set(sessionId, seq);
          }
          void store.append(cwd, text.slice(0, MAX_TEXT_CHARS), { sessionId }).catch((error) => {
            warn(`history append failed: ${error instanceof Error ? error.message : String(error)}`);
          });
        } catch (error) {
          warn(`session/event handler failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
      { global: true },
    );
  } catch (error) {
    warn(`could not subscribe to session/event: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Drop per-session bookkeeping when a session is disposed (best effort: the
  // event name is host-internal and older builds may not emit it).
  try {
    ctx.on(
      'session/disposed',
      (session) => {
        const id = session?.id;
        if (typeof id === 'string') lastSeq.delete(id);
      },
      { global: true },
    );
  } catch {
    /* host does not emit session/disposed */
  }

  // ---- read endpoint -----------------------------------------------------
  const resolveCwd = (payload) => {
    if (payload !== null && typeof payload === 'object' && typeof payload.cwd === 'string') {
      const cwd = payload.cwd.trim();
      if (isPlausibleCwd(cwd)) return cwd;
    }
    const sessionId = payload !== null && typeof payload === 'object' && typeof payload.sessionId === 'string'
      ? payload.sessionId
      : '';
    if (sessionId === '') return '';
    try {
      const agents = ctx.get?.('agents');
      const agent = agents?.get?.(sessionId);
      const cwd = sessionCwd(agent?.session);
      if (cwd !== '') return cwd;
    } catch {
      /* registry may be unavailable during startup */
    }
    return '';
  };

  const handler = async (endpoint, payload) => {
    try {
      if (endpoint === 'ping') {
        return rpcSuccess({ version: PLUGIN_VERSION, storage: rootDir });
      }

      if (endpoint === 'settings.get') {
        if (payload !== null && typeof payload === 'object' && typeof payload.cwd === 'string' && payload.cwd.trim() !== '' && !isPlausibleCwd(payload.cwd.trim())) {
          return rpcFailure('prompt-recall/bad-request', 'cwd must be an absolute path');
        }
        const cwd = resolveCwd(payload);
        const entries = cwd === '' ? [] : await store.list(cwd);
        return rpcSuccess({
          version: PLUGIN_VERSION,
          settings: settings.get(),
          cwd,
          entries: entries.length,
          // Preview only: keep the RPC payload small even for very long prompts.
          recent: entries.slice(0, 5).map((entry) => ({
            text: entry.text.length > 300 ? `${entry.text.slice(0, 300)}…` : entry.text,
            at: entry.at,
          })),
          exports: (await listExports({ exportsDir })).slice(0, 50),
          storage: { history: rootDir, settings: settingsFile, exports: exportsDir },
        });
      }

      if (endpoint === 'settings.set') {
        const patch = payload !== null && typeof payload === 'object' ? payload.patch : undefined;
        if (patch === null || typeof patch !== 'object') {
          return rpcFailure('prompt-recall/bad-request', 'patch must be an object');
        }
        const next = await settings.update(patch);
        store.setLimits(next);
        return rpcSuccess({ settings: next });
      }

      if (endpoint === 'history.clear' || endpoint === 'history.export' || endpoint === 'history.importPayload') {
        const cwd = resolveCwd(payload);
        if (cwd === '') return rpcFailure('prompt-recall/bad-request', 'cwd or sessionId is required');
        if (endpoint === 'history.clear') {
          await store.clear(cwd);
          return rpcSuccess({ cleared: true });
        }
        if (endpoint === 'history.export') {
          try {
            return rpcSuccess(await buildExportPayload({ store, cwd }));
          } catch (error) {
            return rpcFailure('prompt-recall/export-failed', error instanceof Error ? error.message : String(error));
          }
        }
        const entries = payload !== null && typeof payload === 'object' ? payload.entries : undefined;
        if (!Array.isArray(entries)) return rpcFailure('prompt-recall/bad-request', 'entries must be an array');
        if (entries.length > 20_000) return rpcFailure('prompt-recall/bad-request', 'too many entries');
        let size = 0;
        try {
          size = JSON.stringify(entries).length;
        } catch {
          return rpcFailure('prompt-recall/bad-request', 'entries are not serializable');
        }
        if (size > 8 * 1024 * 1024) return rpcFailure('prompt-recall/bad-request', 'import payload is too large');
        return rpcSuccess(await store.importEntries(cwd, entries));
      }

      if (endpoint !== 'history') return rpcFailure('prompt-recall/unknown-endpoint', `unknown endpoint: ${String(endpoint)}`);
      const cwd = resolveCwd(payload);
      if (cwd === '') return rpcFailure('prompt-recall/bad-request', 'cwd or sessionId is required');
      const entries = await store.list(cwd);
      return rpcSuccess({ cwd, entries });
    } catch (error) {
      return rpcFailure('prompt-recall/failed', error instanceof Error ? error.message : String(error));
    }
  };

  try {
    ctx.inject(['connection'], (scope) => {
      try {
        const connection = scope?.root?.connection
          ?? (typeof scope?.get === 'function' ? scope.get('connection') : undefined);
        if (connection === null || connection === undefined || typeof connection.rpc?.handle !== 'function') {
          warn('connection.rpc.handle is unavailable; history endpoint not registered');
          return;
        }
        const dispose = connection.rpc.handle(RPC_CHANNEL, handler);
        if (typeof scope?.effect === 'function') {
          scope.effect(() => dispose, 'dsh-nonead-prompt-recall RPC channel');
        }
      } catch (error) {
        warn(`RPC channel registration failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  } catch (error) {
    warn(`could not inject connection: ${error instanceof Error ? error.message : String(error)}`);
  }

  // ---- command surface ---------------------------------------------------
  /** Host UI locale, read from the locale settings entry (falls back to en). */
  const hostLocale = () => {
    try {
      const row = ctx.get?.('settings')?.describe?.({ redactSecrets: true })?.find?.((entry) => entry?.ns === 'locale');
      const value = row?.value?.preference;
      return typeof value === 'string' && value.toLowerCase().startsWith('zh') ? 'zh' : 'en';
    } catch {
      return 'en';
    }
  };

  const commandHandler = createPromptRecallCommand({
    settings,
    store,
    exportsDir,
    version: PLUGIN_VERSION,
    locale: hostLocale,
  });

  try {
    ctx.inject(['commands'], (scope) => {
      try {
        const commands = scope?.commands
          ?? (typeof scope?.get === 'function' ? scope.get('commands') : undefined)
          ?? scope?.root?.commands;
        if (commands === null || commands === undefined || typeof commands.register !== 'function') {
          warn('commands.register is unavailable; /prompt-recall not registered');
          return;
        }
        const zh = hostLocale() === 'zh';
        const registration = commands.register({
          name: 'prompt-recall',
          description: zh ? '管理提示词历史：状态、开关、上限、保留天数、清空、导出/导入' : 'Manage the prompt history: status, on/off, max, keep, clear, export/import',
          input: { hint: 'status | on | off | max <n> | keep <days> | clear confirm | export [dir] | import <file|abs path> | reset' },
          handler: (invocation) => commandHandler(invocation),
        });
        // register() returns a disposer in current hosts; older ones may return a
        // promise of one. Handle both instead of invoking a promise on teardown.
        if (typeof scope?.effect === 'function') {
          if (typeof registration === 'function') {
            scope.effect(() => registration, 'dsh-nonead-prompt-recall command');
          } else if (registration !== null && typeof registration?.then === 'function') {
            void registration.then((dispose) => {
              if (typeof dispose === 'function') scope.effect(() => dispose, 'dsh-nonead-prompt-recall command');
            }).catch((error) => {
              warn(`/prompt-recall registration promise failed: ${error instanceof Error ? error.message : String(error)}`);
            });
          }
        }
      } catch (error) {
        warn(`/prompt-recall registration failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  } catch (error) {
    warn(`could not inject commands: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Flush queued history writes when the plugin is torn down. The disposer must
  // RETURN the promise: cordis only awaits thenable disposer results.
  ctx.effect?.(() => () => store.flush().catch(() => {}), 'dsh-nonead-prompt-recall flush');
}
