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

/** Minimal Cordis host context capturing the event handler and RPC channel. */
function makeHost() {
  const listeners = new Map();
  let rpcHandler = null;
  const ctx = {
    logger: { info() {}, warn() {} },
    on(type, handler) {
      listeners.set(type, handler);
    },
    inject(services, callback) {
      assert.deepEqual(services, ['connection']);
      callback({
        root: {
          connection: {
            rpc: {
              handle(channel, handler) {
                assert.equal(channel, '/dsh-nonead-prompt-recall');
                rpcHandler = handler;
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
      const handler = listeners.get(type);
      assert.ok(handler, `no listener for ${type}`);
      handler(session, event);
    },
    rpc() {
      assert.ok(rpcHandler, 'RPC channel was not registered');
      return rpcHandler;
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
  const host = makeHost();
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
        sectionSpec = spec;
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
