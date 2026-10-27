import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('package metadata is release-ready', async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));

  assert.match(pkg.version, /^\d+\.\d+\.\d+$/u, 'semver version');
  assert.equal(pkg.license, 'MIT');
  for (const file of ['CHANGELOG.md', 'LICENSE', 'README.md', 'README.zh.md']) {
    assert.ok(pkg.files.includes(file), `files includes ${file}`);
  }
  assert.equal(pkg.exports['./package.json'], './package.json');
});

test('CHANGELOG documents the current version', async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  const changelog = await readFile(join(ROOT, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, new RegExp(`^## \\[${pkg.version.replace(/\./gu, '\\.')}\\]`, 'mu'));
});

test('LICENSE is MIT', async () => {
  const license = await readFile(join(ROOT, 'LICENSE'), 'utf8');
  assert.match(license, /^MIT License/mu);
  assert.match(license, /Suzhou Nonead Robot Technology/u);
});

test('CI runs the check suite and the bundle sync guard', async () => {
  const workflow = await readFile(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(workflow, /npm run check/u);
  assert.match(workflow, /build-client\.mjs --check/u);
});

test('the manual E2E checklist exists', async () => {
  const doc = await readFile(join(ROOT, 'docs', 'E2E.md'), 'utf8');
  assert.match(doc, /host ready/u);
  assert.match(doc, /history file|History file/u);
});
