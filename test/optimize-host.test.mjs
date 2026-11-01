import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_CHIP_COUNT,
  OPTIMIZE_CODES,
  OPTIMIZE_TIMEOUT_MS,
  optimizeDraft,
  parseOptimizePayload,
  requestOptimize,
  resolveOptimizeRoute,
  sentinelSequence,
} from '../lib/optimize-host.js';

const SETTINGS = Object.freeze({
  enabled: true,
  maxEntries: 500,
  retentionDays: 0,
  optimize: Object.freeze({ enabled: true, maxChars: 8000 }),
});

/** Minimal host LLM stand-in: records the request and replays canned chunks. */
function fakeLlm(chunks, options = {}) {
  const calls = [];
  return {
    calls,
    stream(request) {
      calls.push(request);
      if (options.throwSync) throw options.throwSync;
      return (async function* replay() {
        if (options.waitMs !== undefined) {
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, options.waitMs);
            request.signal?.addEventListener('abort', () => {
              clearTimeout(timer);
              resolve();
            }, { once: true });
          });
        }
        for (const chunk of chunks) yield chunk;
      })();
    },
  };
}

/** A stream that never produces anything until its signal aborts. */
function hangingLlm() {
  return {
    stream(request) {
      return (async function* hang() {
        await new Promise((resolve) => {
          request.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED' } } };
      })();
    },
  };
}

function textChunks(text) {
  return [
    { type: 'text-delta', index: 0, text },
    { type: 'finish', reason: { kind: 'stop' } },
  ];
}

function basePayload(overrides = {}) {
  return { sessionId: 'session-1', text: '帮我把这段代码改成 async', masked: false, chipCount: 0, ...overrides };
}

function deps(overrides = {}) {
  return { settings: SETTINGS, llm: fakeLlm(textChunks('把下面这段代码改写成 async/await 形式，保持行为不变。')), session: undefined, busy: new Map(), ...overrides };
}

test('optimizeDraft rewrites a draft and reports the model plus timing', async () => {
  const llm = fakeLlm(textChunks('把下面这段代码改写成 async/await 形式，保持行为不变。'));
  const result = await optimizeDraft(basePayload({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }), deps({ llm }));

  assert.equal(result.ok, true);
  assert.equal(result.value.status, 'ok');
  assert.equal(result.value.text, '把下面这段代码改写成 async/await 形式，保持行为不变。');
  assert.equal(result.value.masked, false);
  assert.equal(result.value.model, 'deepseek-v4-flash');
  assert.ok(Number.isInteger(result.value.elapsedMs));
  assert.equal(llm.calls.length, 1);
  assert.equal(llm.calls[0].provider, 'deepseek-official');
  assert.equal(llm.calls[0].model, 'deepseek-v4-flash');
  assert.equal(llm.calls[0].maxTokens, 800);
  assert.match(llm.calls[0].system, /You are a prompt editor/u);
  assert.match(llm.calls[0].messages[0].content[0].text, /^<draft>\n帮我把这段代码改成 async\n<\/draft>$/u);
});

test('optimizeDraft refuses when the feature is disabled in settings', async () => {
  const result = await optimizeDraft(basePayload({ provider: 'p', model: 'm' }), deps({
    settings: { ...SETTINGS, optimize: { enabled: false, maxChars: 8000 } },
  }));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, OPTIMIZE_CODES.disabled);
});

test('optimizeDraft rejects empty, oversized and malformed payloads', async () => {
  const target = deps({ settings: { ...SETTINGS, optimize: { enabled: true, maxChars: 500 } } });

  const empty = await optimizeDraft(basePayload({ text: '   ', provider: 'p', model: 'm' }), target);
  assert.equal(empty.error.code, OPTIMIZE_CODES.badRequest);

  const oversized = await optimizeDraft(basePayload({ text: 'x'.repeat(501), provider: 'p', model: 'm' }), target);
  assert.equal(oversized.error.code, OPTIMIZE_CODES.badRequest);

  const badSession = await optimizeDraft(basePayload({ sessionId: 'bad id\n', provider: 'p', model: 'm' }), target);
  assert.equal(badSession.error.code, OPTIMIZE_CODES.badRequest);

  const notObject = await optimizeDraft('nope', target);
  assert.equal(notObject.error.code, OPTIMIZE_CODES.badRequest);
});

test('optimizeDraft rejects a masked draft whose sentinel count disagrees with chipCount', async () => {
  const result = await optimizeDraft(basePayload({
    text: '对比 ⟦C1⟧ 和 ⟦C2⟧',
    masked: true,
    chipCount: 1,
    provider: 'p',
    model: 'm',
  }), deps());
  assert.equal(result.ok, false);
  assert.equal(result.error.code, OPTIMIZE_CODES.badRequest);
});

test('optimizeDraft falls back to the session request context route', async () => {
  const llm = fakeLlm(textChunks('请把这段代码改写成 async/await 形式。'));
  const session = { requestContext: () => ({ provider: 'deepseek-official', model: 'deepseek-v4' }) };
  const result = await optimizeDraft(basePayload(), deps({ llm, session }));

  assert.equal(result.ok, true);
  assert.equal(llm.calls[0].provider, 'deepseek-official');
  assert.equal(llm.calls[0].model, 'deepseek-v4');
});

test('optimizeDraft reports optimize-no-model when no route exists anywhere', async () => {
  const result = await optimizeDraft(basePayload(), deps({ session: { requestContext: () => undefined } }));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, OPTIMIZE_CODES.noModel);

  const viaRouteWrapper = await optimizeDraft(basePayload(), deps({
    session: { requestContext: () => ({ route: { provider: 'p2', model: 'm2' } }) },
  }));
  assert.equal(viaRouteWrapper.ok, true);
});

test('a stream that does not settle in time fails with optimize-timeout', async () => {
  const result = await optimizeDraft(basePayload({ provider: 'p', model: 'm' }), deps({
    llm: hangingLlm(),
    timeoutMs: 25,
  }));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, OPTIMIZE_CODES.timeout);
});

test('terminal stream failures map to stable codes without leaking model text', async () => {
  const rated = await optimizeDraft(basePayload({ provider: 'p', model: 'm' }), deps({
    llm: fakeLlm([{ type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: 'secret upstream text' } } }]),
  }));
  assert.equal(rated.error.code, OPTIMIZE_CODES.upstream);
  assert.equal(rated.error.message, 'RATE_LIMIT');

  const aborted = await optimizeDraft(basePayload({ provider: 'p', model: 'm' }), deps({
    llm: fakeLlm([{ type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED' } } }]),
  }));
  assert.equal(aborted.error.code, OPTIMIZE_CODES.aborted);

  const noAdapter = await optimizeDraft(basePayload({ provider: 'p', model: 'm' }), deps({
    llm: fakeLlm([{ type: 'finish', reason: { kind: 'error', failure: { code: 'NO_ADAPTER' } } }]),
  }));
  assert.equal(noAdapter.error.code, OPTIMIZE_CODES.noModel);

  const thrown = await optimizeDraft(basePayload({ provider: 'p', model: 'm' }), deps({
    llm: fakeLlm([], { throwSync: Object.assign(new Error('boom'), { code: 'AUTH' }) }),
  }));
  assert.equal(thrown.error.code, OPTIMIZE_CODES.upstream);
  assert.equal(thrown.error.message, 'AUTH');
});

test('a missing llm service is an upstream failure, not a crash', async () => {
  const result = await optimizeDraft(basePayload({ provider: 'p', model: 'm' }), deps({ llm: undefined }));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, OPTIMIZE_CODES.upstream);
});

test('unchanged and empty outputs are successes with a status, not errors', async () => {
  const unchanged = await optimizeDraft(basePayload({ provider: 'p', model: 'm' }), deps({
    llm: fakeLlm(textChunks('帮我把这段代码改成 async')),
  }));
  assert.equal(unchanged.ok, true);
  assert.equal(unchanged.value.status, 'unchanged');

  const empty = await optimizeDraft(basePayload({ provider: 'p', model: 'm' }), deps({
    llm: fakeLlm(textChunks('   \n  ')),
  }));
  assert.equal(empty.ok, true);
  assert.equal(empty.value.status, 'empty');
});

test('masked drafts keep every sentinel in place or fail with optimize-chip-mismatch', async () => {
  const draft = '对比 ⟦C1⟧ 与 ⟦C2⟧ 的差异';
  const kept = await optimizeDraft(basePayload({ text: draft, masked: true, chipCount: 2, provider: 'p', model: 'm' }), deps({
    llm: fakeLlm(textChunks('比较 ⟦C1⟧ 与 ⟦C2⟧ 之间的差异。')),
  }));
  assert.equal(kept.ok, true);
  assert.equal(kept.value.masked, true);

  const dropped = await optimizeDraft(basePayload({ text: draft, masked: true, chipCount: 2, provider: 'p', model: 'm' }), deps({
    llm: fakeLlm(textChunks('比较 ⟦C1⟧ 与它们之间的差异。')),
  }));
  assert.equal(dropped.ok, false);
  assert.equal(dropped.error.code, OPTIMIZE_CODES.chipMismatch);

  const reordered = await optimizeDraft(basePayload({ text: draft, masked: true, chipCount: 2, provider: 'p', model: 'm' }), deps({
    llm: fakeLlm(textChunks('比较 ⟦C2⟧ 与 ⟦C1⟧ 之间的差异。')),
  }));
  assert.equal(reordered.ok, false);
  assert.equal(reordered.error.code, OPTIMIZE_CODES.chipMismatch);
});

test('a second concurrent optimization for the same session is rejected as busy', async () => {
  const busy = new Map();
  const llm = fakeLlm(textChunks('把这段代码改写成 async/await 形式。'), { waitMs: 40 });

  const first = optimizeDraft(basePayload({ provider: 'p', model: 'm' }), deps({ llm, busy }));
  const second = await optimizeDraft(basePayload({ provider: 'p', model: 'm' }), deps({ llm, busy }));
  assert.equal(second.ok, false);
  assert.equal(second.error.code, OPTIMIZE_CODES.busy);

  const settled = await first;
  assert.equal(settled.ok, true);
  assert.equal(busy.size, 0);
});

test('model output is cleaned before it is returned', async () => {
  const result = await optimizeDraft(basePayload({ provider: 'p', model: 'm' }), deps({
    llm: fakeLlm(textChunks('```text\n优化后：把这段代码改写成 async/await 形式。\n```')),
  }));
  assert.equal(result.ok, true);
  assert.equal(result.value.text, '把这段代码改写成 async/await 形式。');
});

test('payload validation accepts a plain draft and rejects a chip count out of range', () => {
  assert.equal(parseOptimizePayload({ text: 'hi' }, 8000).ok, true);
  const tooMany = parseOptimizePayload({ text: 'hi', chipCount: MAX_CHIP_COUNT + 1 }, 8000);
  assert.equal(tooMany.ok, false);
  const negative = parseOptimizePayload({ text: 'hi', chipCount: -1 }, 8000);
  assert.equal(negative.ok, false);
});

test('route resolution prefers the explicit pair over the session context', () => {
  const session = { requestContext: () => ({ provider: 'from-session', model: 'm-session' }) };
  assert.deepEqual(resolveOptimizeRoute({ provider: 'explicit', model: 'm-explicit' }, session).value, {
    provider: 'explicit',
    model: 'm-explicit',
  });
  assert.deepEqual(resolveOptimizeRoute({}, session).value, { provider: 'from-session', model: 'm-session' });
  assert.equal(resolveOptimizeRoute({ provider: 'only-provider' }, session).value.provider, 'from-session');
});

test('sentinel helpers and constants expose the documented contract', () => {
  assert.deepEqual(sentinelSequence('a ⟦C1⟧ b ⟦C3⟧'), ['1', '3']);
  assert.deepEqual(sentinelSequence(''), []);
  assert.equal(OPTIMIZE_TIMEOUT_MS, 20_000);
  assert.equal(OPTIMIZE_CODES.chipMismatch, 'prompt-recall/optimize-chip-mismatch');
});

test('requestOptimize aborts a caller-cancelled request as optimize-aborted', async () => {
  const controller = new AbortController();
  const pending = requestOptimize({
    llm: hangingLlm(),
    text: '帮我把这段代码改成 async',
    masked: false,
    chipCount: 0,
    route: { provider: 'p', model: 'm' },
    timeoutMs: OPTIMIZE_TIMEOUT_MS,
    signal: controller.signal,
  });
  controller.abort();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.error.code, OPTIMIZE_CODES.aborted);
});
