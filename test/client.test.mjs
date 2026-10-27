import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

execFileSync(process.execPath, [join(ROOT, 'scripts', 'build-client.mjs')], { stdio: 'ignore' });

class FakeElement {
  constructor() {
    this.textContent = '';
    this.isComposer = true;
    this.children = [];
    this.focused = false;
  }

  matches(selector) {
    return selector === '[data-composer-input]' && this.isComposer === true;
  }

  contains(other) {
    return other === this || this.children.includes(other);
  }

  focus() {
    this.focused = true;
  }
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
    const list = this.listeners.get(type);
    if (list === undefined) return;
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

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeShell(el, calls, options = {}) {
  const transform = options.transform ?? ((text) => text);
  return {
    editor: { getRootElement: () => el },
    get projection() {
      return { clipboardText: el.textContent };
    },
    setDraft(text) {
      const effective = transform(text);
      el.textContent = effective;
      calls.push(effective);
    },
    focus() {
      el.focused = true;
    },
  };
}

function makeCtx({ el, shell, entries, call }) {
  const sessions = {
    list: {
      getSnapshot: () => ({
        ids: ['s1'],
        byId: {
          s1: { cwd: 'D:/Work/Demo', retainedBy: { mainView: 1 }, updatedAt: 10 },
        },
      }),
    },
  };
  const conversation = { input: { shell: (id) => { if (id !== 's1') throw new Error('unknown'); return shell; } } };
  const defaultCall = async (channel, endpoint, payload) => {
    assert.equal(channel, '/dsh-nonead-prompt-recall');
    assert.equal(endpoint, 'history');
    assert.equal(payload.cwd, 'D:/Work/Demo');
    return { ok: true, value: { entries: entries.map((text) => ({ text, at: 1 })) } };
  };
  const connection = { rpc: { call: call ?? defaultCall } };
  const ctx = {
    get(key) {
      if (key === 'sessions') return sessions;
      if (key === 'conversation') return conversation;
      if (key === 'connection') return connection;
      return undefined;
    },
    effect(fn) {
      fn();
    },
  };
  return { ctx };
}

/** Import the generated bundle once and capture its exports. */
let bundleExports = null;
async function loadBundle() {
  if (bundleExports !== null) return bundleExports;
  let loaded;
  globalThis.window = {
    __ModuleLoader__: {
      load({ id, factory }) {
        assert.equal(id, 'dsh-nonead-prompt-recall');
        loaded = factory(() => ({}));
      },
    },
  };
  await import(pathToFileURL(join(ROOT, 'lib', 'client.js')).href);
  assert.equal(typeof loaded?.apply, 'function');
  assert.equal(loaded.name, 'dsh-nonead-prompt-recall');
  bundleExports = loaded;
  return loaded;
}

test('↑ recalls history newest-first, ↓ walks back, typed drafts are untouched', async () => {
  const doc = new FakeDocument();
  globalThis.document = doc;
  const bundle = await loadBundle();

  const el = new FakeElement();
  const calls = [];
  const shell = makeShell(el, calls);
  const { ctx } = makeCtx({ el, shell, entries: ['最新', '中间', '最早'] });
  bundle.apply(ctx);
  doc.emit('focusin', { target: el });

  // Empty composer + ↑: fetch, then fill the newest entry.
  const first = keyEvent('ArrowUp', el);
  doc.emit('keydown', first);
  assert.equal(first.defaultPrevented, false, 'empty composer keeps the harmless default caret move');
  await tick();
  assert.equal(el.textContent, '最新');
  assert.deepEqual(calls, ['最新']);

  // ↑ again: older.
  const second = keyEvent('ArrowUp', el);
  doc.emit('keydown', second);
  assert.equal(second.defaultPrevented, true);
  assert.equal(el.textContent, '中间');

  // ↑ at the oldest: the last step is handled, then no further entry exists.
  const third = keyEvent('ArrowUp', el);
  doc.emit('keydown', third);
  assert.equal(third.defaultPrevented, true);
  assert.equal(el.textContent, '最早');
  const fourth = keyEvent('ArrowUp', el);
  doc.emit('keydown', fourth);
  assert.equal(fourth.defaultPrevented, false);
  assert.equal(el.textContent, '最早');

  // ↓ walks back toward the newest, then clears the draft.
  doc.emit('keydown', keyEvent('ArrowDown', el));
  assert.equal(el.textContent, '中间');
  doc.emit('keydown', keyEvent('ArrowDown', el));
  assert.equal(el.textContent, '最新');
  doc.emit('keydown', keyEvent('ArrowDown', el));
  assert.equal(el.textContent, '');
  assert.deepEqual(calls, ['最新', '中间', '最早', '中间', '最新', '']);

  // Hand-written text: neither direction is intercepted.
  el.textContent = '我自己写的';
  doc.emit('input', { target: el });
  const up = keyEvent('ArrowUp', el);
  doc.emit('keydown', up);
  assert.equal(up.defaultPrevented, false);
  assert.equal(el.textContent, '我自己写的');
  const down = keyEvent('ArrowDown', el);
  doc.emit('keydown', down);
  assert.equal(down.defaultPrevented, false);
});

test('two quick ↑ presses before the fetch resolves walk two entries', async () => {
  const doc = new FakeDocument();
  globalThis.document = doc;
  const bundle = await loadBundle();

  const el = new FakeElement();
  const calls = [];
  const shell = makeShell(el, calls);
  const { ctx } = makeCtx({ el, shell, entries: ['最新', '中间', '最早'] });
  bundle.apply(ctx);
  doc.emit('focusin', { target: el });

  doc.emit('keydown', keyEvent('ArrowUp', el));
  doc.emit('keydown', keyEvent('ArrowUp', el));
  await tick();

  assert.equal(el.textContent, '中间');
  assert.deepEqual(calls, ['中间']);
});

test('typing while the first fetch is in flight cancels the fill', async () => {
  const doc = new FakeDocument();
  globalThis.document = doc;
  const bundle = await loadBundle();

  const el = new FakeElement();
  const calls = [];
  const shell = makeShell(el, calls);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const { ctx } = makeCtx({
    el,
    shell,
    entries: ['最新'],
    call: async () => {
      await gate;
      return { ok: true, value: { entries: [{ text: '最新', at: 1 }] } };
    },
  });
  bundle.apply(ctx);
  doc.emit('focusin', { target: el });

  doc.emit('keydown', keyEvent('ArrowUp', el));
  el.textContent = 'typed while loading';
  doc.emit('input', { target: el });
  release();
  await tick();

  assert.deepEqual(calls, []);
  assert.equal(el.textContent, 'typed while loading');
});

test('a composer-normalized draft still walks further back', async () => {
  const doc = new FakeDocument();
  globalThis.document = doc;
  const bundle = await loadBundle();

  const el = new FakeElement();
  const calls = [];
  // Simulate `setDraft` stripping an `@reference` token, like the real composer.
  const shell = makeShell(el, calls, { transform: (text) => text.replace(/ @\w+/gu, '') });
  const { ctx } = makeCtx({ el, shell, entries: ['hello @file', 'older'] });
  bundle.apply(ctx);
  doc.emit('focusin', { target: el });

  doc.emit('keydown', keyEvent('ArrowUp', el));
  await tick();
  assert.equal(el.textContent, 'hello');

  const second = keyEvent('ArrowUp', el);
  doc.emit('keydown', second);
  assert.equal(second.defaultPrevented, true);
  assert.equal(el.textContent, 'older');
  assert.deepEqual(calls, ['hello', 'older']);
});

test('non-composer targets and plain modifiers are ignored', async () => {
  const doc = new FakeDocument();
  globalThis.document = doc;
  const bundle = await loadBundle();

  const el = new FakeElement();
  const calls = [];
  const shell = makeShell(el, calls);
  const { ctx } = makeCtx({ el, shell, entries: ['一条'] });
  bundle.apply(ctx);

  const outside = new FakeElement();
  outside.isComposer = false;
  doc.emit('keydown', keyEvent('ArrowUp', outside));
  await tick();
  assert.deepEqual(calls, []);

  const withCtrl = keyEvent('ArrowUp', el);
  withCtrl.ctrlKey = true;
  doc.emit('keydown', withCtrl);
  await tick();
  assert.deepEqual(calls, []);
});

test('an empty history leaves the composer alone', async () => {
  const doc = new FakeDocument();
  globalThis.document = doc;
  const bundle = await loadBundle();

  const el = new FakeElement();
  const calls = [];
  const shell = makeShell(el, calls);
  const { ctx } = makeCtx({ el, shell, entries: [] });
  bundle.apply(ctx);
  doc.emit('focusin', { target: el });

  const event = keyEvent('ArrowUp', el);
  doc.emit('keydown', event);
  await tick();
  assert.deepEqual(calls, []);
  assert.equal(event.defaultPrevented, false);
});
