import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { apply as hostApply, PLUGIN_VERSION } from '../lib/index.js';
import { workspaceKey } from '../lib/history-store.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class FakeElement {
  constructor() {
    this.textContent = '';
    this.isComposer = true;
  }

  matches(selector) {
    return selector === '[data-composer-input]' && this.isComposer === true;
  }

  contains(other) {
    return other === this;
  }

  focus() {}
}

class FakeDocument {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const list = this.listeners.get(type) ?? [];
    if (!list.includes(listener)) list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(type, listener) {
    const list = this.listeners.get(type) ?? [];
    const index = list.indexOf(listener);
    if (index >= 0) list.splice(index, 1);
  }

  emit(type, event) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}

function keyEvent(key, target) {
  return {
    key,
    target,
    defaultPrevented: false,
    isComposing: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {},
  };
}

/**
 * Minimal Cordis host context.
 * @param {{mode?: 'legacy' | 'current' | 'broken'}} [options]
 *   - `current` (default): DSH >= 0.2.2-alpha.3 — `connection.rpc.handle` throws
 *     `cannot get property "webServer" without inject`, and the host exposes
 *     `connection.fetch.register` for an exact `/api/...` route.
 *   - `legacy`: 0.2.1-rc.x / early 0.2.2 — `rpc.handle` works, no fetch API.
 *   - `broken`: neither carrier works; activation must still return promptly.
 */
function makeHost(options = {}) {
  const { mode = 'current' } = options;
  const listeners = new Map();
  let rpcHandler = null;
  let fetchRoute = null;
  const ctx = {
    logger: { info() {}, warn() {} },
    on(type, handler) {
      listeners.set(type, handler);
    },
    inject(services, callback) {
      // Only `connection` is modelled here; `commands` and friends stay absent.
      if (!services.includes('connection')) return;
      const connection = { rpc: {} };
      if (mode === 'legacy') {
        connection.rpc.handle = (channel, handler) => {
          assert.equal(channel, '/dsh-nonead-prompt-recall');
          rpcHandler = handler;
          return () => {};
        };
      } else {
        connection.rpc.handle = () => {
          throw new Error('cannot get property "webServer" without inject');
        };
      }
      if (mode === 'current') {
        connection.fetch = {
          register(route) {
            assert.equal(route.path, '/api/dsh-nonead-prompt-recall');
            assert.deepEqual([...route.methods], ['POST']);
            fetchRoute = route;
            return () => {};
          },
        };
      }
      callback({
        root: { connection },
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
      const handler = listeners.get(type);
      assert.ok(handler, `no listener for ${type}`);
      handler(session, event);
    },
    rpc() {
      assert.ok(rpcHandler, 'RPC channel was not registered');
      return rpcHandler;
    },
    fetchRoute() {
      assert.ok(fetchRoute, 'fetch route was not registered');
      return fetchRoute;
    },
    /** Drive one request through the registered `/api` fetch route. */
    async callFetch(endpoint, payload) {
      const route = this.fetchRoute();
      const request = new Request(`http://localhost${route.path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint, payload }),
      });
      const response = await route.fetch(request);
      assert.equal(response.status, 200);
      return response.json();
    },
  };
}

/** Load the generated browser bundle in a fresh VM context (no ESM cache). */
async function loadClientBundle(document) {
  const source = await readFile(join(ROOT, 'lib', 'client.js'), 'utf8');
  let exported;
  const window = {
    __ModuleLoader__: {
      load({ factory }) {
        exported = factory(() => ({}));
      },
    },
  };
  vm.runInNewContext(source, { window, document, console }, { filename: 'lib/client.js' });
  assert.equal(typeof exported?.apply, 'function');
  return exported;
}

test('end to end: a submitted prompt is captured and recalled through the composer facade', async (t) => {
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'build-client.mjs')], { stdio: 'ignore' });

  const home = await mkdtemp(join(tmpdir(), 'prompt-recall-e2e-'));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(async () => {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await sleep(75);
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const cwd = 'D:/E2E/Workspace';
  const host = makeHost({ mode: 'legacy' });
  hostApply(host.ctx);
  const rpc = host.rpc();

  // The client's RPC bridge calls the real host handler.
  const el = new FakeElement();
  const shell = {
    editor: { getRootElement: () => el },
    get projection() {
      return { clipboardText: el.textContent };
    },
    setDraft(text) {
      el.textContent = text;
    },
    focus() {},
  };
  const document = new FakeDocument();
  let sectionSpec = null;
  const clientCtx = {
    sessions: { list: { getSnapshot: () => ({ ids: ['s1'], byId: { s1: { cwd, retainedBy: { mainView: 1 }, updatedAt: 1 } } }) } },
    slots: {
      inject(_name, callback) {
        callback();
      },
      register(spec) {
        if (spec?.name === 'settings.section') sectionSpec = spec;
        return () => {};
      },
    },
    locale: {
      register() {},
      bind() {
        return (key) => key;
      },
    },
    get(key) {
      if (key === 'sessions') {
        return {
          list: {
            getSnapshot: () => ({
              ids: ['s1'],
              byId: { s1: { cwd, retainedBy: { mainView: 1 }, updatedAt: 1 } },
            }),
          },
        };
      }
      if (key === 'conversation') return { input: { shell: () => shell } };
      if (key === 'connection') {
        return { rpc: { call: (_channel, endpoint, payload) => rpc(endpoint, payload) } };
      }
      return undefined;
    },
    effect(fn) {
      fn();
    },
  };

  const client = await loadClientBundle(document);
  client.apply(clientCtx);
  assert.equal(sectionSpec?.name, 'settings.section');
  assert.equal(sectionSpec.id, 'dsh-nonead-prompt-recall');
  const sectionProps = sectionSpec.inject();
  assert.equal(typeof sectionProps.t, 'function');
  assert.equal(sectionProps.sessions !== undefined, true);
  document.emit('focusin', { target: el });

  const session = { id: 's1', header: { cwd } };
  const submit = (seq, text) => {
    host.emit('session/event', session, {
      seq,
      type: 'user/message',
      data: { message: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] } },
    });
  };

  const waitForEntries = async (count) => {
    for (let i = 0; i < 100; i += 1) {
      const result = await rpc('history', { cwd });
      if (result.ok && result.value.entries.length >= count) return result.value.entries;
      await sleep(10);
    }
    throw new Error(`history never reached ${count} entries`);
  };

  submit(1, '端到端第一条');
  submit(2, '端到端第二条');
  await waitForEntries(2);

  // Empty composer + ↑ → newest prompt comes back through the facade.
  document.emit('keydown', keyEvent('ArrowUp', el));
  await sleep(20);
  assert.equal(el.textContent, '端到端第二条');

  // ↑ again → older.
  document.emit('keydown', keyEvent('ArrowUp', el));
  assert.equal(el.textContent, '端到端第一条');

  // ↓ walks back to the newest, then to empty; a fresh ↑ fetches again.
  document.emit('keydown', keyEvent('ArrowDown', el));
  assert.equal(el.textContent, '端到端第二条');
  document.emit('keydown', keyEvent('ArrowDown', el));
  assert.equal(el.textContent, '');
  document.emit('keydown', keyEvent('ArrowUp', el));
  await sleep(20);
  assert.equal(el.textContent, '端到端第二条');

  // The history really reached the on-disk file.
  const file = join(home, 'plugin-data', 'dsh-nonead-prompt-recall', 'history', `${workspaceKey(cwd)}.json`);
  let payload = null;
  for (let i = 0; i < 50; i += 1) {
    try {
      payload = JSON.parse(await readFile(file, 'utf8'));
      if (payload.entries?.length >= 2) break;
    } catch {
      /* not written yet */
    }
    await sleep(10);
  }
  assert.ok(payload && payload.entries.length >= 2, 'history file contains the captured prompts');
  assert.equal(payload.entries[0].text, '端到端第二条');

  // Version is single-sourced from package.json.
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(PLUGIN_VERSION, pkg.version);
});

test('the RPC channel also registers on hosts older than the webServer contract', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'prompt-recall-legacy-'));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(async () => {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await sleep(75);
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  // Legacy fibre: `connection.rpc.handle` succeeds without `webServer`. The host
  // must still expose the channel, otherwise every release before the contract
  // change would lose history recall and the settings page.
  const host = makeHost({ mode: 'legacy' });
  hostApply(host.ctx);
  const rpc = host.rpc();
  const ping = await rpc('ping', {});
  assert.equal(ping.ok, true);
});

test('a host whose rpc.handle always rejects cannot stall activation', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'prompt-recall-stall-'));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(async () => {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await sleep(75);
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  // Regression guard for the 0.8.5 startup stall: an unconditional webServer
  // retry inside the catch recursed forever during apply(), keeping the desktop
  // starter busy past its 60 s watchdog until DSH safe mode disabled the plugin.
  const warnings = [];
  const host = makeHost({ mode: 'broken' });
  host.ctx.logger.warn = (message) => { warnings.push(String(message)); };

  const started = Date.now();
  hostApply(host.ctx);
  assert.ok(Date.now() - started < 2_000, 'apply() returned instead of retrying forever');
  assert.throws(() => host.rpc(), /RPC channel was not registered/u);
  assert.ok(
    warnings.some((line) => /fetch\.register is unavailable/u.test(line)),
    `expected a no-carrier warning, got: ${warnings.join(' | ')}`,
  );
});

test('the current host serves the settings endpoints over the /api fetch route', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'prompt-recall-fetch-'));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(async () => {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await sleep(75);
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  // DSH >= 0.2.2-alpha.3 rejects every plugin `rpc.handle` call, so the plugin
  // must fall back to `connection.fetch.register` — otherwise the browser's
  // settings page dies with `transport failure …: HTTP 404`.
  const host = makeHost({ mode: 'current' });
  hostApply(host.ctx);
  assert.throws(() => host.rpc(), /RPC channel was not registered/u);

  const ping = await host.callFetch('ping', {});
  assert.equal(ping.ok, true);

  const settings = await host.callFetch('settings.get', {});
  assert.equal(settings.ok, true, `settings.get failed: ${JSON.stringify(settings)}`);
  assert.equal(typeof settings.value?.settings, 'object');
});
