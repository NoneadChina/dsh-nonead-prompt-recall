/**
 * Host half of the composer "optimize prompt" action (0.8.0).
 *
 * One RPC request in, one rewritten draft out. This module owns validation, the
 * route lookup, the independent model call, the 20 s deadline and the stable
 * error codes; it never touches the draft, the history store or a session turn.
 *
 * Privacy: the draft text is sent to the model and nowhere else. Nothing here
 * logs prompt content, and the reported failure message is a stable code.
 *
 * Pure Node apart from `./optimize-prompt.js`, so it can be unit-tested with a
 * fake `llm` service.
 */

import { buildOptimizeMessages, classifyOptimizeResult } from './optimize-prompt.js';

/** Whole-request deadline (§6.2): fixed in v1, independent of any running turn. */
export const OPTIMIZE_TIMEOUT_MS = 20_000;

/** Output cap handed to the adapter; the cleaner enforces the character bound. */
export const OPTIMIZE_MAX_TOKENS = 800;

/** Upper bound for `chipCount`, matching what one composer draft can hold. */
export const MAX_CHIP_COUNT = 64;

/** Stable failure codes shared with the browser half (§5.1). */
export const OPTIMIZE_CODES = Object.freeze({
  disabled: 'prompt-recall/optimize-disabled',
  badRequest: 'prompt-recall/optimize-bad-request',
  noModel: 'prompt-recall/optimize-no-model',
  timeout: 'prompt-recall/optimize-timeout',
  aborted: 'prompt-recall/optimize-aborted',
  chipMismatch: 'prompt-recall/optimize-chip-mismatch',
  upstream: 'prompt-recall/optimize-upstream',
  busy: 'prompt-recall/optimize-busy',
});

/** Reference sentinels the client masks `@` chips into (`⟦C1⟧`). */
const SENTINEL_RE = /⟦C(\d+)⟧/gu;

/** Provider/model/session identifiers: no whitespace or control characters. */
const IDENTITY_RE = /^[^\s\u0000-\u001f]{1,200}$/u;

/**
 * Failure envelope for the `optimize` endpoint.
 *
 * Same DSH contract as the channel's `rpcFailure`: an `ok: false` result is
 * rejected outright when `error.details` is not an object, and the client then
 * reports `connection: invalid server-response failure` instead of this
 * message. Keep `details` present even when there is nothing to add.
 */
function failure(code, message, details = {}) {
  return { ok: false, error: { code, message, details } };
}

function success(value) {
  return { ok: true, value };
}

/**
 * Ordered sentinel numbers in one string.
 * @param {string} text
 * @returns {string[]} e.g. ['1', '2'] for `⟦C1⟧ … ⟦C2⟧`.
 */
export function sentinelSequence(text) {
  if (typeof text !== 'string' || text === '') return [];
  return [...text.matchAll(SENTINEL_RE)].map((match) => match[1]);
}

/**
 * Validate the RPC payload without touching the model.
 * @param {unknown} payload
 * @param {number} settingsLimit - `settings.optimize.maxChars`.
 * @returns {{ok: true, value: {text: string, masked: boolean, chipCount: number,
 *   sessionId: string}} | {ok: false, error: {code: string, message: string}}}
 */
export function parseOptimizePayload(payload, settingsLimit) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return failure(OPTIMIZE_CODES.badRequest, 'payload must be an object');
  }
  const text = payload.text;
  if (typeof text !== 'string') return failure(OPTIMIZE_CODES.badRequest, 'text must be a string');
  if (text.trim() === '') return failure(OPTIMIZE_CODES.badRequest, 'text is empty');

  const limit = Number.isSafeInteger(settingsLimit) && settingsLimit > 0 ? settingsLimit : 8000;
  if (text.length > limit) return failure(OPTIMIZE_CODES.badRequest, `text exceeds ${limit} characters`);

  const sessionId = payload.sessionId;
  if (sessionId !== undefined && (typeof sessionId !== 'string' || !IDENTITY_RE.test(sessionId))) {
    return failure(OPTIMIZE_CODES.badRequest, 'invalid sessionId');
  }

  const masked = payload.masked === true;
  const chipCount = payload.chipCount === undefined ? 0 : payload.chipCount;
  if (!Number.isSafeInteger(chipCount) || chipCount < 0 || chipCount > MAX_CHIP_COUNT) {
    return failure(OPTIMIZE_CODES.badRequest, 'invalid chipCount');
  }
  if (masked && sentinelSequence(text).length !== chipCount) {
    return failure(OPTIMIZE_CODES.badRequest, 'masked text does not match chipCount');
  }

  return success({ text, masked, chipCount, sessionId: sessionId ?? '' });
}

/**
 * Resolve the provider/model pair for one optimization.
 *
 * Order: the explicit pair the browser sent (current composer selection), then
 * the session's latest logged `request/context` route, then a stable no-model
 * failure. The settings override is v2-only and deliberately not read here.
 * @param {unknown} payload
 * @param {{requestContext?: () => unknown} | null} session
 * @returns {{ok: true, value: {provider: string, model: string}} | {ok: false, error: {code: string, message: string}}}
 */
export function resolveOptimizeRoute(payload, session) {
  const source = payload !== null && typeof payload === 'object' ? payload : {};
  const provider = typeof source.provider === 'string' ? source.provider.trim() : '';
  const model = typeof source.model === 'string' ? source.model.trim() : '';
  if (IDENTITY_RE.test(provider) && IDENTITY_RE.test(model)) return success({ provider, model });

  let context;
  try {
    context = typeof session?.requestContext === 'function' ? session.requestContext() : undefined;
  } catch {
    context = undefined;
  }
  const logged = context !== null && typeof context === 'object' ? context : {};
  const loggedRoute = logged.route !== null && typeof logged.route === 'object' ? logged.route : logged;
  const contextProvider = typeof loggedRoute.provider === 'string' ? loggedRoute.provider.trim() : '';
  const contextModel = typeof loggedRoute.model === 'string' ? loggedRoute.model.trim() : '';
  if (IDENTITY_RE.test(contextProvider) && IDENTITY_RE.test(contextModel)) {
    return success({ provider: contextProvider, model: contextModel });
  }

  return failure(OPTIMIZE_CODES.noModel, 'no provider/model route is available for this session');
}

/**
 * Map one terminal stream outcome to a stable error code.
 * @param {{kind?: string, failure?: {code?: string}} | undefined} finish
 * @param {unknown} error - a thrown producer error, if any.
 * @param {boolean} timedOut
 * @param {boolean} cancelled
 * @returns {{ok: false, error: {code: string, message: string}} | undefined}
 */
function terminalFailure(finish, error, timedOut, cancelled) {
  if (timedOut) return failure(OPTIMIZE_CODES.timeout, 'optimization timed out');
  if (cancelled) return failure(OPTIMIZE_CODES.aborted, 'optimization was cancelled');

  let terminal = finish;
  if (terminal === undefined && error !== null && typeof error === 'object') {
    terminal = { kind: 'error', failure: { code: typeof error.code === 'string' ? error.code : 'UNKNOWN' } };
  }
  if (terminal === undefined) return undefined;
  const kind = typeof terminal.kind === 'string' ? terminal.kind : 'stop';
  if (kind === 'error' || kind === 'aborted') {
    const code = typeof terminal.failure?.code === 'string' ? terminal.failure.code : 'UNKNOWN';
    if (kind === 'aborted' || code === 'ABORTED' || code === 'CANCELLED') {
      return failure(OPTIMIZE_CODES.aborted, 'optimization was cancelled');
    }
    if (code === 'NO_ADAPTER') return failure(OPTIMIZE_CODES.noModel, 'no adapter for the selected route');
    return failure(OPTIMIZE_CODES.upstream, code);
  }
  return undefined;
}

/**
 * Stream one optimization and classify the result.
 * @param {object} request
 * @param {any} request.llm - host LLM service (`ctx.get('llm')`).
 * @param {string} request.text - masked draft text.
 * @param {boolean} request.masked
 * @param {number} request.chipCount
 * @param {{provider: string, model: string}} request.route
 * @param {number} request.timeoutMs
 * @param {AbortSignal} [request.signal] - caller cancellation.
 * @returns {Promise<object>} RPC result.
 */
export async function requestOptimize({ llm, text, masked, chipCount, route, timeoutMs, signal }) {
  if (llm === null || llm === undefined || typeof llm.stream !== 'function') {
    return failure(OPTIMIZE_CODES.upstream, 'language model service is unavailable');
  }

  const built = buildOptimizeMessages(text);
  const system = built[0]?.content?.[0]?.text ?? '';
  const messages = built.slice(1);

  const controller = new AbortController();
  let timedOut = false;
  let cancelled = signal?.aborted === true;
  const onAbort = () => {
    cancelled = true;
    controller.abort();
  };
  if (signal !== undefined && typeof signal.addEventListener === 'function') {
    signal.addEventListener('abort', onAbort, { once: true });
  }
  const startedAt = Date.now();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let accumulated = '';
  let finish;
  let thrown;
  try {
    const stream = llm.stream({
      provider: route.provider,
      model: route.model,
      messages,
      system,
      maxTokens: OPTIMIZE_MAX_TOKENS,
      signal: controller.signal,
    });
    for await (const chunk of stream) {
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') accumulated += chunk.text;
      else if (chunk?.type === 'finish') finish = chunk.reason ?? chunk;
    }
  } catch (error) {
    thrown = error;
  } finally {
    clearTimeout(timer);
    if (signal !== undefined && typeof signal.removeEventListener === 'function') {
      signal.removeEventListener('abort', onAbort);
    }
  }

  const failed = terminalFailure(finish, thrown, timedOut, cancelled);
  if (failed !== undefined) return failed;

  const elapsedMs = Date.now() - startedAt;
  const result = classifyOptimizeResult(accumulated, text);
  if (result.status === 'empty') {
    return success({ status: 'empty', text: '', masked, model: route.model, elapsedMs });
  }
  if (result.status === 'unchanged') {
    return success({ status: 'unchanged', text: result.text, masked, model: route.model, elapsedMs });
  }
  if (masked) {
    const expected = sentinelSequence(text).join('|');
    const actual = sentinelSequence(result.text).join('|');
    if (expected !== actual) {
      return failure(OPTIMIZE_CODES.chipMismatch, 'reference sentinels were not preserved');
    }
  }
  return success({ status: 'ok', text: result.text, masked, model: route.model, elapsedMs });
}

/**
 * Full RPC-side flow: gate → validate → one-per-session → route → stream.
 * @param {unknown} payload - RPC payload.
 * @param {object} deps
 * @param {any} deps.settings - normalized settings snapshot.
 * @param {any} deps.llm - host LLM service.
 * @param {{requestContext?: () => unknown} | null} [deps.session] - owning session.
 * @param {Map<string, AbortController>} [deps.busy] - per-session in-flight registry.
 * @param {number} [deps.timeoutMs]
 * @param {(message: string) => void} [deps.log]
 * @returns {Promise<object>} RPC result.
 */
export async function optimizeDraft(payload, deps = {}) {
  if (deps.settings?.optimize?.enabled === false) {
    return failure(OPTIMIZE_CODES.disabled, 'prompt optimization is disabled');
  }

  const parsed = parseOptimizePayload(payload, deps.settings?.optimize?.maxChars);
  if (!parsed.ok) return parsed;
  const request = parsed.value;

  const key = request.sessionId;
  const busy = deps.busy;
  if (busy instanceof Map && key !== '' && busy.has(key)) {
    return failure(OPTIMIZE_CODES.busy, 'an optimization is already running for this session');
  }

  const route = resolveOptimizeRoute(payload, deps.session);
  if (!route.ok) return route;

  const controller = new AbortController();
  if (busy instanceof Map && key !== '') busy.set(key, controller);
  try {
    const result = await requestOptimize({
      llm: deps.llm,
      text: request.text,
      masked: request.masked,
      chipCount: request.chipCount,
      route: route.value,
      timeoutMs: Number.isSafeInteger(deps.timeoutMs) && deps.timeoutMs > 0 ? deps.timeoutMs : OPTIMIZE_TIMEOUT_MS,
      signal: controller.signal,
    });
    if (!result.ok && typeof deps.log === 'function') deps.log(`optimize failed: ${result.error.code}`);
    return result;
  } finally {
    if (busy instanceof Map && key !== '') busy.delete(key);
  }
}
