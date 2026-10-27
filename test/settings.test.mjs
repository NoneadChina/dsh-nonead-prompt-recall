import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_SETTINGS,
  MAX_ENTRIES_LIMIT,
  MAX_RETENTION_DAYS,
  SettingsStore,
  normalizeSettings,
} from '../lib/settings.js';

test('normalizeSettings clamps and fills defaults', () => {
  assert.deepEqual(normalizeSettings(undefined), { ...DEFAULT_SETTINGS });
  assert.deepEqual(normalizeSettings({ enabled: false, maxEntries: 0, retentionDays: -5 }), {
    enabled: false,
    maxEntries: 1,
    retentionDays: 0,
  });
  assert.deepEqual(normalizeSettings({ enabled: 'yes', maxEntries: 999999, retentionDays: 999999 }), {
    enabled: true,
    maxEntries: MAX_ENTRIES_LIMIT,
    retentionDays: MAX_RETENTION_DAYS,
  });
  assert.deepEqual(normalizeSettings({ maxEntries: '42', retentionDays: '7' }), {
    enabled: true,
    maxEntries: 42,
    retentionDays: 7,
  });
});

test('settings persist across instances', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'prompt-recall-settings-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'settings.json');

  const store = new SettingsStore(file, { now: () => 1000 });
  assert.deepEqual(await store.load(), { ...DEFAULT_SETTINGS });
  const updated = await store.update({ maxEntries: 20, retentionDays: 30 });
  assert.equal(updated.maxEntries, 20);
  assert.equal(updated.retentionDays, 30);
  await store.flush();

  const reopened = new SettingsStore(file);
  const loaded = await reopened.load();
  assert.equal(loaded.maxEntries, 20);
  assert.equal(loaded.retentionDays, 30);
  assert.equal(loaded.enabled, true);

  const payload = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(payload.version, 1);
  assert.equal(payload.maxEntries, 20);
});

test('a corrupt settings file falls back to defaults and is quarantined', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'prompt-recall-settings-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'settings.json');
  await writeFile(file, '{ not json', 'utf8');

  const store = new SettingsStore(file);
  assert.deepEqual(await store.load(), { ...DEFAULT_SETTINGS });
  const entries = await import('node:fs/promises').then((fs) => fs.readdir(dir));
  assert.ok(entries.some((name) => name.includes('.corrupt-')), 'corrupt file was quarantined');
});

test('update surfaces a write failure instead of pretending success', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'prompt-recall-settings-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  // A regular file where the settings directory should be makes mkdir/write fail.
  const blocked = join(dir, 'blocked');
  await writeFile(blocked, 'not a directory', 'utf8');
  const errors = [];
  const store = new SettingsStore(join(blocked, 'settings.json'), {
    onError: (_error, context) => errors.push(context),
  });

  await assert.rejects(store.update({ maxEntries: 10 }));
  assert.ok(errors.includes('persist'), `reported persist error, got ${errors.join(',')}`);
  // The in-memory value is still updated so the next save retries with it.
  assert.equal(store.get().maxEntries, 10);
});