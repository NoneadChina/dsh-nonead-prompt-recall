import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Minimal Cordis host context capturing the pieces apply() registers. */
function makeHost() {
  const listeners = new Map();
  let rpc = null;
  const ctx = {
    logger: { warn() {} },
    on(type, handler, options) {
      listeners.set(type, { handler, options });
    },
    inject(services, cb) {
      assert.deepEqual(services, ['connection']);
      cb({
        root: {
          connection: {
            rpc: {
              handle(channel, handler) {
                rpc = { channel, handler };
                return () => {};
              },
            },
          },
        },
        effect() {},
        get() {
          return undefined;
        },
      });
    },
    get() {
      return undefined;
    },
    effect() {},
  };
  return {
    ctx,
    emit(type, session, event) {
      const entry = listeners.get(type);
      assert.ok(entry, `no listener for ${type}`);
      entry.handler(session, event);
    },
    rpc() {
      assert.ok(rpc, 'RPC channel was not registered');
      return rpc;
    },
  };
}

test('host captures real prompts and serves them over RPC', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'prompt-recall-home-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    await new Promise((resolve) => setTimeout(resolve, 75));
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const { apply } = await import('../lib/index.js');
  const host = makeHost();
  apply(host.ctx);

  const { channel, handler } = host.rpc();
  assert.equal(channel, '/dsh-nonead-prompt-recall');

  const session = { id: 'session-1', header: { cwd: 'D:\\Work\\Demo' } };
  host.emit('session/event', session, {
    seq: 1,
    type: 'user/message',
    data: { message: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '第一条' }] } },
  });
  host.emit('session/event', session, {
    seq: 2,
    type: 'user/message',
    data: { message: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '第二条' }] } },
  });
  // Plugin-injected message: must not enter history.
  host.emit('session/event', session, {
    seq: 3,
    type: 'user/message',
    data: { message: { role: 'user', source: { kind: 'plugin', plugin: 'x' }, content: [{ type: 'text', text: '注入' }] } },
  });
  // Redelivered older event: must not be appended again.
  host.emit('session/event', session, {
    seq: 2,
    type: 'user/message',
    data: { message: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '第二条（重投）' }] } },
  });
  await tick();

  const result = await handler('history', { cwd: 'D:\\Work\\Demo' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.entries.map((entry) => entry.text), ['第二条', '第一条']);

  const other = await handler('history', { cwd: 'D:\\Other' });
  assert.equal(other.ok, true);
  assert.deepEqual(other.value.entries, []);

  const ping = await handler('ping', {});
  assert.equal(ping.ok, true);
  assert.equal(ping.value.version, '0.1.0');
});

test('host rejects unknown endpoints and missing workspace identity', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'prompt-recall-home-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    await new Promise((resolve) => setTimeout(resolve, 75));
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const { apply } = await import('../lib/index.js');
  const host = makeHost();
  apply(host.ctx);
  const { handler } = host.rpc();

  const missing = await handler('history', {});
  assert.equal(missing.ok, false);
  assert.match(missing.error.code, /bad-request/u);

  const unknown = await handler('nope', { cwd: 'D:\\W' });
  assert.equal(unknown.ok, false);
  assert.match(unknown.error.code, /unknown-endpoint/u);
});
