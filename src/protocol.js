/** Shared client-side protocol constants (kept in sync with lib/index.js). */

/** Host RPC channel (absolute path). Legacy carriers register this prefix. */
export const CHANNEL = '/dsh-nonead-prompt-recall';

/**
 * Exact Fetch route on DSH's shared `/api` channel.
 *
 * DSH 0.2.2-alpha.3 stopped letting a plugin mount its own RPC channel: the
 * service registers routes through `owner.webServer`, and that owner is the
 * service's own fiber, so every third-party `connection.rpc.handle` call throws
 * `cannot get property "webServer" without inject`. The same host exposes
 * `connection.fetch.register`, which needs no `webServer`, so the host mounts
 * this exact path and the browser posts to it directly.
 */
export const FETCH_PATH = '/api/dsh-nonead-prompt-recall';

/** The composer's contenteditable marker owned by the host UI. */
export const COMPOSER_SELECTOR = '[data-composer-input]';

/** DSH settings slot that renders plugin sections in the settings dialog. */
export const SETTINGS_SECTION = 'settings.section';

/** RPC endpoint that rewrites one draft (0.8.0 prompt optimization). */
export const ENDPOINT_OPTIMIZE = 'optimize';

/**
 * Call one host endpoint over whichever carrier this DSH build exposes.
 *
 * Tries the shared `/api` fetch route first (current DSH), then the legacy
 * channel `connection.rpc.call` (0.2.1-rc.x / early 0.2.2). A 404/405, a
 * missing global `fetch`, or a transport-level TypeError all mean "this host
 * has no fetch route", so the legacy call is used instead.
 *
 * @param {any} connection - DSH connection service (may be undefined).
 * @param {string} endpoint - endpoint name, e.g. `settings.get`.
 * @param {any} payload - JSON payload.
 * @returns {Promise<{ok: true, value: any} | {ok: false, error: {code: string, message: string}}>}
 */
export async function callChannel(connection, endpoint, payload) {
  const doFetch = typeof globalThis.fetch === 'function' ? globalThis.fetch : null;
  if (doFetch !== null) {
    let response = null;
    try {
      response = await doFetch(FETCH_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint, payload }),
      });
    } catch {
      response = null; // no route / offline: fall back to the legacy channel
    }
    if (response !== null && response.status !== 404 && response.status !== 405) {
      if (!response.ok) throw new Error(`transport failure for ${FETCH_PATH}: HTTP ${response.status}`);
      const parsed = await response.json();
      if (parsed !== null && typeof parsed === 'object') return parsed;
      throw new Error(`invalid response for ${FETCH_PATH}`);
    }
  }
  if (connection === null || connection === undefined || typeof connection.rpc?.call !== 'function') {
    throw new Error('connection unavailable');
  }
  return connection.rpc.call(CHANNEL, endpoint, payload);
}
