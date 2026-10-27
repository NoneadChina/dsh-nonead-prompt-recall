import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { exportHistory, importHistory, listExports } from '../lib/actions.js';

const cwd = 'D:\\Work\\Export';

test('exports use unique file names and are listable', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'prompt-recall-exports-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = { list: async () => [{ text: 'hello', at: 1 }] };

  const first = await exportHistory({ store, exportsDir: dir, cwd, now: 1_000 });
  const second = await exportHistory({ store, exportsDir: dir, cwd, now: 1_000 });
  assert.notEqual(first.file, second.file);
  assert.equal(first.count, 1);

  const names = await listExports({ exportsDir: dir });
  assert.deepEqual(names.sort(), [basename(first.file), basename(second.file)].sort());

  const payload = JSON.parse(await readFile(first.file, 'utf8'));
  assert.equal(payload.version, 1);
  assert.equal(payload.cwd, cwd);
  assert.equal(payload.entries[0].text, 'hello');
});

test('import merges a listed export and rejects invalid names', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'prompt-recall-exports-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = {
    list: async () => [{ text: 'hello', at: 1 }],
    importEntries: async (_cwd, entries) => ({ added: entries.length, skipped: 0 }),
  };
  const { file } = await exportHistory({ store, exportsDir: dir, cwd, now: 2_000 });

  const result = await importHistory({ store, exportsDir: dir, cwd, file: basename(file) });
  assert.deepEqual(result, { added: 1, skipped: 0 });

  await assert.rejects(importHistory({ store, exportsDir: dir, cwd, file: 'notes.txt' }), /\.json/u);
  await assert.rejects(importHistory({ store, exportsDir: dir, cwd, file: '../escape.json' }), /ENOENT/u);
});

test('a custom export directory and an absolute import path are supported', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'prompt-recall-exports-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const custom = join(dir, 'custom', 'nested');
  const store = {
    list: async () => [{ text: 'hello', at: 1 }],
    importEntries: async (_cwd, entries) => ({ added: entries.length, skipped: 0 }),
  };

  const { file } = await exportHistory({ store, exportsDir: dir, cwd, dir: custom, now: 3_000 });
  assert.equal(dirname(file), custom);

  const result = await importHistory({ store, exportsDir: dir, cwd, file });
  assert.deepEqual(result, { added: 1, skipped: 0 });

  await assert.rejects(exportHistory({ store, exportsDir: dir, cwd, dir: 'relative' }), /absolute/u);
});