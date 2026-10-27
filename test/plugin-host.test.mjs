import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PLUGIN_VERSION } from '../lib/index.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Minimal Cordis host context capturing the pieces apply() registers. */
function makeHost() {
  const listeners = new Map();
  let rpc = null;
  const commands = [];
  const ctx = {
    logger: { info() {}, warn() {} },
    on(type, handler, options) {
      listeners.set(type, { handler, options });
    },
    inject(services, callback) {
      const scope = {
        root: {},
        effect() {},
        get() {
          return undefined;
        },
      };
      if (services.includes('connection')) {
        scope.root.connection = {
          rpc: {
            handle(channel, handler) {
              rpc = { channel, handler };
              return () => {};
            },
          },
        };
      }
      if (services.includes('commands')) {
        const service = {
          register(spec) {
            commands.push(spec);
            return () => {};
          },
        };
        scope.commands = service;
        scope.root.commands = service;
      }
      callback(scope);
    },
    get() {
      return undefined;
    },
    effect() {},
  };
  return {
    ctx,
    commands,
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

async function waitForCount(handler, cwd, count) {
  for (let i = 0; i < 100; i += 1) {
    const result = await handler('history', { cwd });
    if (result.ok && result.value.entries.length >= count) return result.value.entries;
    await sleep(10);
  }
  throw new Error(`history never reached ${count} entries`);
}

function userEvent(seq, text) {
  return {
    seq,
    type: 'user/message',
    data: { message: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] } },
  };
}

test('host captures real prompts and serves them over RPC', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'prompt-recall-home-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    await sleep(75);
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const { apply } = await import('../lib/index.js');
  const host = makeHost();
  apply(host.ctx);

  const { channel, handler } = host.rpc();
  assert.equal(channel, '/dsh-nonead-prompt-recall');

  const session = { id: 'session-1', header: { cwd: 'D:\\Work\\Demo' } };
  host.emit('session/event', session, userEvent(1, '第一条'));
  host.emit('session/event', session, userEvent(2, '第二条'));
  // Plugin-injected message: must not enter history.
  host.emit('session/event', session, {
    seq: 3,
    type: 'user/message',
    data: { message: { role: 'user', source: { kind: 'plugin', plugin: 'x' }, content: [{ type: 'text', text: '注入' }] } },
  });
  // Redelivered older event: must not be appended again.
  host.emit('session/event', session, userEvent(2, '第二条（重投）'));
  await sleep(20);

  const entries = await waitForCount(handler, 'D:\\Work\\Demo', 2);
  assert.deepEqual(entries.map((entry) => entry.text), ['第二条', '第一条']);

  const other = await handler('history', { cwd: 'D:\\Other' });
  assert.equal(other.ok, true);
  assert.deepEqual(other.value.entries, []);

  const ping = await handler('ping', {});
  assert.equal(ping.ok, true);
  assert.equal(ping.value.version, PLUGIN_VERSION);
});

test('host rejects unknown endpoints and missing workspace identity', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'prompt-recall-home-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    await sleep(75);
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

  // The browser may only name absolute workspace paths.
  for (const cwd of ['relative/path', 'C:', 'C:foo', 'C:\\' + 'a'.repeat(5000), 'C:\\bad\npath']) {
    const result = await handler('history', { cwd });
    assert.equal(result.ok, false, `cwd ${JSON.stringify(cwd.slice(0, 24))} must be rejected`);
    assert.match(result.error.code, /bad-request/u);
  }

  const absolute = await handler('history', { cwd: 'D:\\Work\\Demo' });
  assert.equal(absolute.ok, true);
});

test('the /prompt-recall command toggles capture, clears and round-trips an export', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'prompt-recall-cmd-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    await sleep(75);
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const cwd = 'D:\\Work\\Cmd';
  const { apply } = await import('../lib/index.js');
  const host = makeHost();
  apply(host.ctx);
  assert.equal(host.commands.length, 1, '/prompt-recall registered');
  const command = host.commands[0];
  assert.equal(command.name, 'prompt-recall');
  const { handler } = host.rpc();
  const session = { id: 'session-cmd', header: { cwd } };
  const invoke = (rawInput) => command.handler({ rawInput, agent: { session }, signal: { aborted: false } });

  // switch capture off: prompts are not recorded
  const off = await invoke('off');
  assert.equal(off.kind, 'success');
  host.emit('session/event', session, userEvent(1, '被关闭期间'));
  await sleep(30);
  assert.deepEqual((await handler('history', { cwd })).value.entries, []);

  // switch capture on: recorded again
  const on = await invoke('on');
  assert.equal(on.kind, 'success');
  host.emit('session/event', session, userEvent(2, '开启后第一条'));
  await waitForCount(handler, cwd, 1);

  // status reflects the settings
  const status = await invoke('status');
  assert.equal(status.kind, 'success');
  assert.match(status.text, /capture: on/u);
  assert.match(status.text, /entries here: 1/u);

  // max / keep validation
  assert.equal((await invoke('max 0')).kind, 'error');
  assert.equal((await invoke('max 50')).kind, 'success');
  assert.equal((await invoke('keep -1')).kind, 'error');

  // export writes a file, import merges it back after a clear
  const exported = await invoke('export');
  assert.equal(exported.kind, 'success', exported.text);
  const files = await readdir(join(home, 'plugin-data', 'dsh-nonead-prompt-recall', 'exports'));
  assert.equal(files.length, 1);
  assert.match(files[0], /\.json$/u);

  const cleared = await invoke('clear confirm');
  assert.equal(cleared.kind, 'success');
  assert.deepEqual((await handler('history', { cwd })).value.entries, []);

  const imported = await invoke(`import ${files[0]}`);
  assert.equal(imported.kind, 'success', imported.text);
  const restored = await waitForCount(handler, cwd, 1);
  assert.equal(restored[0].text, '开启后第一条');

  // clear refuses without `confirm`
  const refused = await invoke('clear');
  assert.equal(refused.kind, 'error');
});

test('the /prompt-recall command rejects traversal and invalid import files', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'prompt-recall-cmd-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    await sleep(75);
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const cwd = 'D:\\Work\\Cmd';
  const { apply } = await import('../lib/index.js');
  const host = makeHost();
  apply(host.ctx);
  const command = host.commands[0];
  const invoke = (rawInput) => command.handler({
    rawInput,
    agent: { session: { id: 's', header: { cwd } } },
    signal: { aborted: false },
  });

  const traversal = await invoke('import ../../settings.json');
  assert.equal(traversal.kind, 'error');
  assert.match(traversal.text, /import failed/u);

  const nonJson = await invoke('import notes.txt');
  assert.equal(nonJson.kind, 'error');

  const exportWithNoWorkspace = await command.handler({
    rawInput: 'export',
    agent: { session: { id: 's', header: {} } },
    signal: { aborted: false },
  });
  assert.equal(exportWithNoWorkspace.kind, 'error');
});

test('settings RPC serves status, saves settings and round-trips history actions', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'prompt-recall-rpc-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    await sleep(75);
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const cwd = 'D:\\Work\\Rpc';
  const { apply } = await import('../lib/index.js');
  const host = makeHost();
  apply(host.ctx);
  const { handler } = host.rpc();

  const initial = await handler('settings.get', { cwd });
  assert.equal(initial.ok, true);
  assert.equal(initial.value.settings.enabled, true);
  assert.equal(initial.value.settings.maxEntries, 500);
  assert.equal(initial.value.entries, 0);
  assert.deepEqual(initial.value.exports, []);
  assert.equal(typeof initial.value.storage.history, 'string');

  const saved = await handler('settings.set', { patch: { maxEntries: 2, retentionDays: 7 } });
  assert.equal(saved.ok, true);
  assert.equal(saved.value.settings.maxEntries, 2);
  assert.equal(saved.value.settings.retentionDays, 7);

  const invalid = await handler('settings.set', {});
  assert.equal(invalid.ok, false);
  assert.match(invalid.error.code, /bad-request/u);

  const session = { id: 'session-rpc', header: { cwd } };
  host.emit('session/event', session, userEvent(1, '一'));
  host.emit('session/event', session, userEvent(2, '二'));
  host.emit('session/event', session, userEvent(3, '三'));
  await waitForCount(handler, cwd, 2);

  const view = await handler('settings.get', { cwd });
  assert.equal(view.value.entries, 2, 'maxEntries trims to 2');
  assert.equal(view.value.recent.length, 2);

  const exported = await handler('history.export', { cwd });
  assert.equal(exported.ok, true);
  assert.equal(exported.value.count, 2);
  assert.match(exported.value.filename, /\.json$/u);
  const payload = JSON.parse(exported.value.content);
  assert.equal(payload.entries.length, 2);
  assert.equal(payload.cwd, cwd);

  const cleared = await handler('history.clear', { cwd });
  assert.equal(cleared.ok, true);
  assert.deepEqual((await handler('history', { cwd })).value.entries, []);

  const imported = await handler('history.importPayload', { cwd, entries: payload.entries });
  assert.equal(imported.ok, true);
  assert.equal(imported.value.added, 2);

  const badEntries = await handler('history.importPayload', { cwd, entries: 'nope' });
  assert.equal(badEntries.ok, false);
  assert.match(badEntries.error.code, /bad-request/u);
});
test('settings.get rejects a non-absolute cwd', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'prompt-recall-rpc-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    await sleep(75);
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const { apply } = await import('../lib/index.js');
  const host = makeHost();
  apply(host.ctx);
  const { handler } = host.rpc();

  const bad = await handler('settings.get', { cwd: 'relative/path' });
  assert.equal(bad.ok, false);
  assert.match(bad.error.code, /bad-request/u);

  const good = await handler('settings.get', { cwd: 'D:\\Work' });
  assert.equal(good.ok, true);
  assert.equal(good.value.entries, 0);
});
test('RPC export returns a browser-download payload', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'prompt-recall-rpc-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    await sleep(75);
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const cwd = 'D:\\Work\\ExportRpc';
  const { apply } = await import('../lib/index.js');
  const host = makeHost();
  apply(host.ctx);
  const { handler } = host.rpc();
  const session = { id: 'session-export', header: { cwd } };
  host.emit('session/event', session, userEvent(1, '浏览器下载'));
  await waitForCount(handler, cwd, 1);

  const exported = await handler('history.export', { cwd });
  assert.equal(exported.ok, true, exported.error?.message);
  assert.match(exported.value.filename, /^prompt-recall-.+\.json$/u);
  const payload = JSON.parse(exported.value.content);
  assert.equal(payload.entries[0].text, '浏览器下载');

  await handler('history.clear', { cwd });
  const imported = await handler('history.importPayload', { cwd, entries: payload.entries });
  assert.equal(imported.ok, true, imported.error?.message);
  assert.equal(imported.value.added, 1);

  const bad = await handler('history.importPayload', { cwd, entries: 'nope' });
  assert.equal(bad.ok, false);
  assert.match(bad.error.code, /bad-request/u);
});