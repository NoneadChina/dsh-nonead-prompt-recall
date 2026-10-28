import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SUPPORTED = ['de.json', 'en.json', 'es.json', 'fr.json', 'ja.json', 'pt.json', 'ru.json', 'zh.json'];

async function readJson(relative) {
  return JSON.parse(await readFile(join(ROOT, relative), 'utf8'));
}

test('package.json exposes locale resources and both READMEs', async () => {
  const pkg = await readJson('package.json');
  assert.equal(pkg.exports['./locale/*'], './locale/*');
  assert.ok(pkg.files.includes('locale'));
  assert.ok(pkg.files.includes('README.md'));
  assert.ok(pkg.files.includes('README.zh.md'));
});

test('locale files use the DSH meta namespace with title and description', async () => {
  const dir = join(ROOT, 'locale');
  const files = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort();
  assert.deepEqual(files, SUPPORTED);

  for (const file of files) {
    assert.match(file.slice(0, -5), /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/u, `${file}: lowercase language id`);
    const parsed = await readJson(join('locale', file));
    assert.equal(typeof parsed.meta, 'object', `${file}: meta namespace`);
    assert.equal(typeof parsed.meta.title, 'string', `${file}: meta.title`);
    assert.ok(parsed.meta.title.trim().length > 0, `${file}: meta.title is non-empty`);
    assert.equal(typeof parsed.meta.description, 'string', `${file}: meta.description`);
    assert.ok(parsed.meta.description.trim().length > 0, `${file}: meta.description is non-empty`);
    assert.equal(parsed.title, undefined, `${file}: no top-level title (DSH reads meta.*)`);
    assert.equal(parsed.description, undefined, `${file}: no top-level description (DSH reads meta.*)`);
    assert.equal(/[\u200b\ufeff]/u.test(`${parsed.meta.title}${parsed.meta.description}`), false, `${file}: no zero-width characters`);
  }
});

test('English and Chinese locale files describe the same entry', async () => {
  const en = await readJson('locale/en.json');
  const zh = await readJson('locale/zh.json');
  assert.notEqual(en.meta.title, zh.meta.title);
  assert.notEqual(en.meta.description, zh.meta.description);
});

test('every locale file has its own title', async () => {
  const titles = new Set();
  for (const file of SUPPORTED) {
    const parsed = await readJson(join('locale', file));
    titles.add(parsed.meta.title);
  }
  assert.equal(titles.size, SUPPORTED.length, 'one distinct title per language');
});

test('READMEs cross-link each other', async () => {
  const en = await readFile(join(ROOT, 'README.md'), 'utf8');
  const zh = await readFile(join(ROOT, 'README.zh.md'), 'utf8');
  assert.match(en, /README\.zh\.md/u);
  assert.match(zh, /README\.md/u);
  assert.match(en, /## Localization/u);
  assert.match(zh, /## 本地化/u);
});
