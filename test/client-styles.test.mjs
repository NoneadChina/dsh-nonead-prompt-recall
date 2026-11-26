/**
 * The client bundle publishes its three stylesheets through the module `meta()`
 * hook, which DSH 0.2.2+ installs itself. These tests pin that contract: the
 * paths, the text handed to the host, its verbatim agreement with the source
 * constants, and the manual-injection fallback older hosts still take.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = await readFile(join(ROOT, 'lib/client.js'), 'utf8');

/** Path -> source constant, in the order the bundle declares them. */
const STYLE_SOURCES = [
  ['src/optimize-button.css', 'src/optimize-button.js', 'OPT_CSS'],
  ['src/settings.css', 'src/settings.js', 'CSS'],
  ['src/settings-polish.css', 'src/settings.js', 'POLISH_CSS'],
];

/** Run the bundle and hand back whatever it registers with the loader. */
function registration() {
  let entry;
  const window = { __ModuleLoader__: { load(value) { entry = value; } } };
  vm.runInNewContext(SOURCE, { window, console }, { filename: 'lib/client.js' });
  return entry;
}

/** Pull one `const NAME = \`...\`;` block out of a source file. */
async function cssConstant(file, name) {
  const source = await readFile(join(ROOT, file), 'utf8');
  const match = source.match(new RegExp('const ' + name + ' = `([\\s\\S]*?)`;', 'u'));
  assert.ok(match !== null, `${name} is still a template literal in ${file}`);
  return match[1];
}

test('the module meta() offers one stylesheet per source block', () => {
  const entry = registration();
  assert.equal(typeof entry.meta, 'function', 'the loader receives a meta factory');
  const meta = entry.meta();
  assert.deepEqual(Object.keys(meta.stylesheets), STYLE_SOURCES.map(([path]) => path));
  for (const [path] of STYLE_SOURCES) {
    const descriptor = meta.stylesheets[path];
    assert.equal(typeof descriptor.text, 'function', `${path}: text() is a function`);
    const text = descriptor.text({ asset: (reference) => reference });
    assert.equal(typeof text, 'string');
    assert.ok(text.trim().length > 0, `${path}: text() is non-empty`);
  }
});

test('the published text matches the source constants verbatim', async () => {
  const { stylesheets } = registration().meta();
  for (const [path, file, name] of STYLE_SOURCES) {
    const expected = await cssConstant(file, name);
    assert.equal(stylesheets[path].text({ asset: (reference) => reference }), expected, path);
  }
});

test('the sheets carry the selectors each surface relies on', () => {
  const { stylesheets } = registration().meta();
  assert.match(stylesheets['src/optimize-button.css'].text({ asset: (r) => r }), /\.dsh-pr-opt-btn\{/u);
  assert.match(stylesheets['src/settings.css'].text({ asset: (r) => r }), /\.dsh-pr-root\{/u);
  assert.match(stylesheets['src/settings-polish.css'].text({ asset: (r) => r }), /\.dsh-pr-logo\{/u);
});

/**
 * Minimal DOM + shell context: enough for `apply()` to reach both style helpers
 * without a React runtime.
 * @param {() => object | null} querySelector
 */
function applyWith(querySelector) {
  const styles = [];
  const document = {
    addEventListener() {},
    removeEventListener() {},
    getElementById(id) { return styles.find((style) => style.id === id) ?? null; },
    createElement(tag) { return { tag, id: '', textContent: '', setAttribute() {} }; },
    head: { appendChild(style) { styles.push(style); } },
    body: {},
    querySelector,
    querySelectorAll() { return []; },
  };
  const Class = class { observe() {} disconnect() {} };
  let exported;
  const window = { __ModuleLoader__: { load({ factory }) { exported = factory(() => ({})); } } };
  vm.runInNewContext(SOURCE, {
    window,
    document,
    MutationObserver: Class,
    requestAnimationFrame: (fn) => { fn(); return 1; },
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout,
    console,
  }, { filename: 'lib/client.js' });

  const ctx = {
    slots: { inject(_name, callback) { callback(); }, register() { return () => {}; } },
    locale: { register() {}, bind: () => (key) => key },
    get: () => 'connection',
    sessions: {},
    effect(fn) { fn(); },
  };
  exported.apply(ctx);
  return styles;
}

test('an older host without the marker still gets the styles injected', () => {
  const styles = applyWith(() => null);
  assert.ok(styles.length > 0, 'the fallback injects');
  assert.ok(styles.every((style) => style.textContent.trim().length > 0), 'with content');
});

test('a host that installed the sheets itself gets no duplicate', () => {
  const installed = { tag: 'style', dataset: { plugin: 'dsh-nonead-prompt-recall' } };
  const styles = applyWith(() => installed);
  assert.equal(styles.length, 0, 'manual injection stays out of the way');
});
