import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  HistoryStore,
  normalizeWorkspacePath,
  workspaceKey,
  normalizeEntryText,
  HISTORY_VERSION,
} from '../lib/history-store.js';

test('normalizeWorkspacePath folds separators and trailing slashes', () => {
  assert.equal(normalizeWorkspacePath('D:\\Work\\Demo\\'), normalizeWorkspacePath('D:/Work/Demo'));
  assert.equal(normalizeWorkspacePath('  '), '');
  assert.equal(normalizeWorkspacePath(null), '');
});

test('workspaceKey is stable and distinguishes workspaces', () => {
  const a = workspaceKey('D:\\Work\\Demo');
  const b = workspaceKey('D:/Work/Demo/');
  const c = workspaceKey('D:\\Work\\Other');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{24}$/u);
  assert.equal(workspaceKey(''), '');
});

test('normalizeEntryText trims and rejects empty text', () => {
  assert.equal(normalizeEntryText('  hello  '), 'hello');
  assert.equal(normalizeEntryText('a\r\nb'), 'a\nb');
  assert.equal(normalizeEntryText('   '), '');
  assert.equal(normalizeEntryText(undefined), '');
});

test('append/list persist newest-first and survive a new store instance', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'prompt-recall-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const store = new HistoryStore(root, { now: () => 1000 });
  assert.equal(await store.append('D:\\Work\\Demo', '第一条'), true);
  assert.equal(await store.append('D:\\Work\\Demo', '第二条'), true);
  await store.flush();

  const list = await store.list('D:/Work/Demo');
  assert.deepEqual(list.map((entry) => entry.text), ['第二条', '第一条']);
  assert.deepEqual(list.map((entry) => entry.at), [1000, 1000]);

  const reopened = new HistoryStore(root);
  const again = await reopened.list('D:\\Work\\Demo');
  assert.deepEqual(again.map((entry) => entry.text), ['第二条', '第一条']);

  const file = reopened.filePath('D:\\Work\\Demo');
  const payload = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(payload.version, HISTORY_VERSION);
  assert.equal(payload.cwd, 'D:\\Work\\Demo');
});

test('consecutive duplicates are skipped, non-consecutive repeats are kept', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'prompt-recall-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const store = new HistoryStore(root);
  assert.equal(await store.append('D:\\W', 'A'), true);
  assert.equal(await store.append('D:\\W', 'A'), false);
  assert.equal(await store.append('D:\\W', 'B'), true);
  assert.equal(await store.append('D:\\W', 'A'), true);
  await store.flush();
  assert.deepEqual((await store.list('D:\\W')).map((entry) => entry.text), ['A', 'B', 'A']);
});

test('entries are capped at maxEntries', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'prompt-recall-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const store = new HistoryStore(root, { maxEntries: 3 });
  for (const text of ['1', '2', '3', '4', '5']) await store.append('D:\\W', text);
  await store.flush();
  assert.deepEqual((await store.list('D:\\W')).map((entry) => entry.text), ['5', '4', '3']);
});

test('workspaces are isolated', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'prompt-recall-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const store = new HistoryStore(root);
  await store.append('D:\\A', 'only A');
  await store.append('D:\\B', 'only B');
  await store.flush();

  assert.deepEqual((await store.list('D:\\A')).map((entry) => entry.text), ['only A']);
  assert.deepEqual((await store.list('D:\\B')).map((entry) => entry.text), ['only B']);
  assert.notEqual(store.filePath('D:\\A'), store.filePath('D:\\B'));
});

test('a corrupt history file is quarantined and does not break capture', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'prompt-recall-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const store = new HistoryStore(root);
  const file = store.filePath('D:\\W');
  await mkdir(root, { recursive: true });
  await writeFile(file, '{ not json', 'utf8');

  assert.deepEqual(await store.list('D:\\W'), []);
  assert.equal(await store.append('D:\\W', 'after corruption'), true);
  await store.flush();
  assert.deepEqual((await store.list('D:\\W')).map((entry) => entry.text), ['after corruption']);
});

test('sessionId is preserved with each entry', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'prompt-recall-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const store = new HistoryStore(root);
  await store.append('D:\\W', 'with session', { sessionId: 'session-1', at: 42 });
  await store.flush();
  const [entry] = await store.list('D:\\W');
  assert.equal(entry.sessionId, 'session-1');
  assert.equal(entry.at, 42);
});

test('write failures are reported through onError', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'prompt-recall-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  // Point the store at a regular file: mkdir() then fails on every write.
  const notADir = join(root, 'not-a-directory');
  await writeFile(notADir, 'occupied', 'utf8');

  const contexts = [];
  const store = new HistoryStore(notADir, {
    onError: (_error, context) => contexts.push(context),
  });
  assert.equal(await store.append('D:\\W', 'will not persist'), true);
  await store.flush();
  assert.ok(contexts.includes('persist'), `expected a persist error, got ${contexts.join(',')}`);
});
test('setLimits trims cached entries and retention drops older ones', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'prompt-recall-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const now = 10 * 86_400_000;
  const store = new HistoryStore(root, { now: () => now });
  await store.append('D:\\W', '四天前', { at: now - 4 * 86_400_000 });
  await store.append('D:\\W', '今天', { at: now });
  await store.append('D:\\W', '昨天', { at: now - 86_400_000 });
  assert.equal((await store.list('D:\\W')).length, 3);

  store.setLimits({ retentionDays: 2 });
  assert.deepEqual((await store.list('D:\\W')).map((entry) => entry.text), ['今天', '昨天']);

  store.setLimits({ maxEntries: 1 });
  assert.deepEqual((await store.list('D:\\W')).map((entry) => entry.text), ['今天']);
});

test('clear removes the workspace file and allows a fresh start', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'prompt-recall-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const store = new HistoryStore(root);
  await store.append('D:\\W', 'old');
  await store.flush();
  const file = store.filePath('D:\\W');
  assert.equal(await store.clear('D:\\W'), true);
  assert.deepEqual(await store.list('D:\\W'), []);
  await assert.rejects(readFile(file, 'utf8'), /ENOENT/u);

  assert.equal(await store.append('D:\\W', 'new'), true);
  await store.flush();
  assert.deepEqual((await store.list('D:\\W')).map((entry) => entry.text), ['new']);
});

test('importEntries dedupes exact entries and sorts newest-first', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'prompt-recall-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const store = new HistoryStore(root);
  await store.append('D:\\W', 'existing', { at: 100 });
  const result = await store.importEntries('D:\\W', [
    { text: 'existing', at: 100 },
    { text: 'older', at: 50 },
    { text: 'newer', at: 200 },
    { text: '   ' },
  ]);
  assert.deepEqual(result, { added: 2, skipped: 2 });
  assert.deepEqual(
    (await store.list('D:\\W')).map((entry) => entry.text),
    ['newer', 'existing', 'older'],
  );
});
test('setLimits writes the trimmed file back to disk', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'prompt-recall-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const store = new HistoryStore(root);
  await store.append('D:\\W', 'one', { at: 1 });
  await store.append('D:\\W', 'two', { at: 2 });
  await store.append('D:\\W', 'three', { at: 3 });
  await store.flush();

  store.setLimits({ maxEntries: 1 });
  await store.flush();
  const payload = JSON.parse(await readFile(store.filePath('D:\\W'), 'utf8'));
  assert.equal(payload.entries.length, 1);
  assert.equal(payload.entries[0].text, 'three');
});

test('retention trims on read and persists the pruned file', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'prompt-recall-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const now = 10 * 86_400_000;
  const store = new HistoryStore(root, { now: () => now });
  await store.append('D:\\W', 'stale', { at: now - 3 * 86_400_000 });
  await store.append('D:\\W', 'fresh', { at: now });
  await store.flush();

  store.setLimits({ retentionDays: 1 });
  assert.deepEqual((await store.list('D:\\W')).map((entry) => entry.text), ['fresh']);
  await store.flush();
  const payload = JSON.parse(await readFile(store.filePath('D:\\W'), 'utf8'));
  assert.deepEqual(payload.entries.map((entry) => entry.text), ['fresh']);
});
test('a hand-edited unsorted file is sorted and retention- trimmed on load', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'prompt-recall-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const now = 10 * 86_400_000;
  const cwd = 'D:\\W';
  await writeFile(join(root, `${workspaceKey(cwd)}.json`), JSON.stringify({
    version: 1,
    cwd,
    entries: [
      { text: 'mid', at: now - 86_400_000 },
      { text: 'old', at: now - 5 * 86_400_000 },
      { text: 'new', at: now },
    ],
  }), 'utf8');

  const store = new HistoryStore(root, { now: () => now, retentionDays: 2 });
  assert.deepEqual((await store.list(cwd)).map((entry) => entry.text), ['new', 'mid']);
  await store.flush();
  const payload = JSON.parse(await readFile(store.filePath(cwd), 'utf8'));
  assert.deepEqual(payload.entries.map((entry) => entry.text), ['new', 'mid']);
});
test('imported sessionId metadata is bounded', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'prompt-recall-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const store = new HistoryStore(root);
  await store.importEntries('D:\\W', [{ text: 'bounded', at: 1, sessionId: 'x'.repeat(500) }]);
  const [entry] = await store.list('D:\\W');
  assert.equal(entry.sessionId.length, 200);
});