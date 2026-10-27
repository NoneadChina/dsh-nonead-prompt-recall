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
import { join } from 'node:path';

import { HistoryStore, MAX_TEXT_CHARS } from './history-store.js';
import { userPromptOf } from './message-text.js';

export const name = 'dsh-nonead-prompt-recall';
export const inject = [];

/** Plugin version (kept in sync with package.json by hand — one file, no build). */
export const PLUGIN_VERSION = '0.1.0';

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

/**
 * Cordis plugin body.
 * @param {any} ctx - host plugin context.
 */
export function apply(ctx) {
  const rootDir = join(resolveDshHome(), 'plugin-data', DATA_DIR_NAME, 'history');
  const store = new HistoryStore(rootDir);
  const logger = ctx?.logger;
  try {
    logger?.info?.(`[dsh-nonead-prompt-recall] host ready v${PLUGIN_VERSION} (${rootDir})`);
  } catch {
    /* logging must never break startup */
  }

  const warn = (message) => {
    try {
      logger?.warn?.(`[dsh-nonead-prompt-recall] ${message}`);
    } catch {
      /* logging must never break capture */
    }
  };

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

  // ---- read endpoint -----------------------------------------------------
  const resolveCwd = (payload) => {
    if (payload !== null && typeof payload === 'object' && typeof payload.cwd === 'string') {
      const cwd = payload.cwd.trim();
      if (cwd !== '' && !cwd.includes('\0')) return cwd;
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

  // Flush queued history writes when the plugin is torn down. The disposer must
  // RETURN the promise: cordis only awaits thenable disposer results.
  ctx.effect?.(() => () => store.flush().catch(() => {}), 'dsh-nonead-prompt-recall flush');
}
