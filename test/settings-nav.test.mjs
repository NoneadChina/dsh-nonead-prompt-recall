import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = await readFile(join(ROOT, 'lib/client.js'), 'utf8');

class FakeButton {
  constructor(label) {
    this.textContent = label;
    this.attributes = new Map();
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  hasAttribute(name) { return this.attributes.has(name); }
}

test('the settings nav row gets the history-icon marker', async () => {
  const navButton = new FakeButton('提示词历史');
  const otherButton = new FakeButton('通用设置');
  const styles = [];
  const document = {
    listeners: new Map(),
    addEventListener(type, fn) { this.listeners.set(type, fn); },
    removeEventListener() {},
    getElementById(id) { return styles.find((style) => style.id === id) ?? null; },
    createElement(tag) { return { tag, id: '', textContent: '' }; },
    head: { appendChild(style) { styles.push(style); } },
    body: {},
    querySelectorAll(selector) {
      if (selector.includes('nav button')) return [navButton, otherButton];
      if (selector.startsWith('[data-dsh-prompt-recall-nav]')) return [navButton].filter((button) => button.hasAttribute('data-dsh-prompt-recall-nav'));
      return [];
    },
  };
  class MutationObserver {
    constructor() {}
    observe() {}
    disconnect() {}
  }
  let exported;
  const window = { __ModuleLoader__: { load({ factory }) { exported = factory(() => ({})); } } };
  vm.runInNewContext(SOURCE, {
    window,
    document,
    MutationObserver,
    requestAnimationFrame: (fn) => { fn(); return 1; },
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout,
    console,
  }, { filename: 'lib/client.js' });

  const slots = {
    inject(_name, callback) { callback(); },
    register() { return () => {}; },
  };
  const registered = [];
  const ctx = {
    slots,
    locale: {
      register(ns, dicts) { registered.push({ ns, dicts }); },
      bind: () => (key) => (key === 'nav' ? '提示词历史' : key),
    },
    get: () => 'connection',
    sessions: {},
    effect(fn) { fn(); },
  };
  exported.apply(ctx);

  assert.equal(registered.length, 1, 'the namespace is registered once');
  assert.equal(registered[0].ns, 'nonead-prompt-recall');
  assert.deepEqual(
    Object.keys(registered[0].dicts).sort(),
    ['de', 'en', 'es', 'fr', 'ja', 'pt', 'ru', 'zh'],
    'all eight DSH languages are registered',
  );
  for (const [locale, dict] of Object.entries(registered[0].dicts)) {
    assert.equal(typeof dict.nav, 'string', `${locale}: nav`);
    assert.ok(dict.nav.trim().length > 0, `${locale}: nav is non-empty`);
  }

  assert.equal(navButton.hasAttribute('data-dsh-prompt-recall-nav'), true);
  assert.equal(otherButton.hasAttribute('data-dsh-prompt-recall-nav'), false);
  const css = styles[0]?.textContent ?? '';
  assert.match(css, /\[data-dsh-prompt-recall-nav\] svg\{display:none\}/u);
  assert.match(css, /\[data-dsh-prompt-recall-nav\]::before/u);
  assert.match(css, /stroke-width='2'/u);
});
