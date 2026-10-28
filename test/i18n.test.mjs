import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DICTS, LOCALES } from '../src/i18n.js';
import {
  COMMAND_DESCRIPTIONS,
  COMMAND_DICTS,
  SUPPORTED_LOCALES,
  normalizeLocale,
  translateCommand,
} from '../lib/i18n.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const ZERO_WIDTH = /[\u200b\ufeff]/u;

function placeholders(template) {
  return [...template.matchAll(/\{(\w+)\}/gu)].map((match) => match[1]).sort();
}

test('the eight DSH languages are declared once, in both halves', () => {
  const expected = ['zh', 'en', 'ja', 'es', 'fr', 'de', 'ru', 'pt'];
  assert.deepEqual(LOCALES, expected);
  assert.deepEqual(SUPPORTED_LOCALES, expected);
  assert.deepEqual(Object.keys(DICTS), expected);
  assert.deepEqual(Object.keys(COMMAND_DICTS), expected);
  assert.deepEqual(Object.keys(COMMAND_DESCRIPTIONS), expected);
});

test('every settings dictionary carries the same keys with the en placeholders', () => {
  const enKeys = Object.keys(DICTS.en).sort();
  const enPlaceholders = Object.fromEntries(enKeys.map((key) => [key, placeholders(DICTS.en[key])]));
  for (const locale of LOCALES) {
    assert.deepEqual(Object.keys(DICTS[locale]).sort(), enKeys, `${locale}: key set`);
    for (const key of enKeys) {
      const value = DICTS[locale][key];
      assert.equal(typeof value, 'string', `${locale}.${key}: string`);
      assert.ok(value.trim().length > 0, `${locale}.${key}: non-empty`);
      assert.equal(ZERO_WIDTH.test(value), false, `${locale}.${key}: no zero-width characters`);
      assert.deepEqual(placeholders(value), enPlaceholders[key], `${locale}.${key}: placeholders`);
    }
  }
});

test('every command dictionary carries the same keys with the en placeholders', () => {
  const enKeys = Object.keys(COMMAND_DICTS.en).sort();
  const enPlaceholders = Object.fromEntries(enKeys.map((key) => [key, placeholders(COMMAND_DICTS.en[key])]));
  for (const locale of SUPPORTED_LOCALES) {
    assert.deepEqual(Object.keys(COMMAND_DICTS[locale]).sort(), enKeys, `${locale}: key set`);
    for (const key of enKeys) {
      const value = COMMAND_DICTS[locale][key];
      assert.equal(typeof value, 'string', `${locale}.${key}: string`);
      assert.ok(value.trim().length > 0, `${locale}.${key}: non-empty`);
      assert.equal(ZERO_WIDTH.test(value), false, `${locale}.${key}: no zero-width characters`);
      assert.deepEqual(placeholders(value), enPlaceholders[key], `${locale}.${key}: placeholders`);
    }
    assert.ok(COMMAND_DESCRIPTIONS[locale].trim().length > 0, `${locale}: description`);
    assert.equal(ZERO_WIDTH.test(COMMAND_DESCRIPTIONS[locale]), false, `${locale}: description has no zero-width characters`);
  }
});

test('translations actually differ per language', () => {
  const titles = new Set(LOCALES.map((locale) => DICTS[locale].nav));
  assert.equal(titles.size, LOCALES.length, 'every locale has its own nav label');
});

test('host locale values normalize to the supported ids', () => {
  assert.equal(normalizeLocale('zh'), 'zh');
  assert.equal(normalizeLocale('zh-CN'), 'zh');
  assert.equal(normalizeLocale('pt-BR'), 'pt');
  assert.equal(normalizeLocale('pt_PT'), 'pt');
  assert.equal(normalizeLocale('en_US'), 'en');
  assert.equal(normalizeLocale('ja-JP'), 'ja');
  assert.equal(normalizeLocale('fr-CA'), 'fr');
  assert.equal(normalizeLocale('de'), 'de');
  assert.equal(normalizeLocale('ru-RU'), 'ru');
  assert.equal(normalizeLocale('es-419'), 'es');
  assert.equal(normalizeLocale('xx-YY'), 'en');
  assert.equal(normalizeLocale(undefined), 'en');
  assert.equal(normalizeLocale(null), 'en');
});

test('command output is translated and interpolates placeholders', () => {
  assert.equal(translateCommand('en', 'maxSet', { value: 120 }), 'max entries set to 120');
  assert.equal(translateCommand('zh', 'maxSet', { value: 120 }), '每工作区上限已设为 120');
  assert.equal(translateCommand('ja', 'maxSet', { value: 120 }), '上限を 120 に設定しました');
  assert.equal(translateCommand('pt-BR', 'maxSet', { value: 120 }), 'máximo de entradas definido como 120');
  assert.equal(translateCommand('de', 'unknown', { verb: 'nope' }), 'unbekanntes Unterkommando: nope');
  assert.equal(translateCommand('fr', 'usage').includes('status'), true);
  assert.notEqual(translateCommand('ru', 'cleared'), translateCommand('en', 'cleared'));
});

test('unknown locales and keys fall back to en, then the key', () => {
  assert.equal(translateCommand('xx', 'cleared'), COMMAND_DICTS.en.cleared);
  assert.equal(translateCommand('en', 'notAKey'), 'notAKey');
  assert.equal(translateCommand('en', 'maxSet', {}), 'max entries set to {value}');
});

test('READMEs cross-link each other', async () => {
  const en = await readFile(join(ROOT, 'README.md'), 'utf8');
  const zh = await readFile(join(ROOT, 'README.zh.md'), 'utf8');
  assert.match(en, /README\.zh\.md/u);
  assert.match(zh, /README\.md/u);
});
