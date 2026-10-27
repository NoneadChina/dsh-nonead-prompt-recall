import test from 'node:test';
import assert from 'node:assert/strict';

import { decideNav, draftText } from '../src/core.js';

const HISTORY = ['最新', '中间', '最早'];

test('empty composer + ArrowUp loads the newest prompt and is handled', () => {
  assert.deepEqual(decideNav('ArrowUp', '', HISTORY, -1), { handled: true, index: 0, entry: '最新' });
  assert.deepEqual(decideNav('ArrowUp', '   ', HISTORY, -1), { handled: true, index: 0, entry: '最新' });
});

test('repeated ArrowUp walks older entries', () => {
  assert.deepEqual(decideNav('ArrowUp', '最新', HISTORY, 0), { handled: true, index: 1, entry: '中间' });
  assert.deepEqual(decideNav('ArrowUp', '中间', HISTORY, 1), { handled: true, index: 2, entry: '最早' });
  assert.deepEqual(decideNav('ArrowUp', '最早', HISTORY, 2), { handled: false });
});

test('ArrowDown walks back to the newest, then restores the empty draft', () => {
  assert.deepEqual(decideNav('ArrowDown', '最早', HISTORY, 2), { handled: true, index: 1, entry: '中间' });
  assert.deepEqual(decideNav('ArrowDown', '中间', HISTORY, 1), { handled: true, index: 0, entry: '最新' });
  assert.deepEqual(decideNav('ArrowDown', '最新', HISTORY, 0), { handled: true, index: -1, entry: '' });
  assert.deepEqual(decideNav('ArrowDown', '', HISTORY, -1), { handled: false });
});

test('a hand-edited draft does not continue the walk', () => {
  assert.deepEqual(decideNav('ArrowUp', '我改了几个字', HISTORY, 1), { handled: false });
  assert.deepEqual(decideNav('ArrowDown', '我改了几个字', HISTORY, 1), { handled: false });
});

test('empty history or unknown keys are never handled', () => {
  assert.deepEqual(decideNav('ArrowUp', '', [], -1), { handled: false });
  assert.deepEqual(decideNav('ArrowUp', '', null, -1), { handled: false });
  assert.deepEqual(decideNav('Enter', '', HISTORY, -1), { handled: false });
});

test('multi-line entries compare exactly', () => {
  const history = ['第一行\n第二行', '旧'];
  assert.deepEqual(decideNav('ArrowUp', '第一行\n第二行', history, 0), { handled: true, index: 1, entry: '旧' });
  assert.deepEqual(decideNav('ArrowDown', '旧', history, 1), { handled: true, index: 0, entry: '第一行\n第二行' });
});

test('the effective (composer-normalized) entry drives the walk', () => {
  // The composer stripped an `@file` reference when writing the draft back.
  const history = ['hello @file', 'older'];
  assert.deepEqual(decideNav('ArrowUp', 'hello', history, 0, 'hello'), { handled: true, index: 1, entry: 'older' });
  assert.deepEqual(decideNav('ArrowDown', 'hello', history, 0, 'hello'), { handled: true, index: -1, entry: '' });
  // A draft that does not match the effective entry is left alone.
  assert.deepEqual(decideNav('ArrowUp', 'hello there', history, 0, 'hello'), { handled: false });
});

test('draftText only normalizes line endings', () => {
  assert.equal(draftText('a\r\nb'), 'a\nb');
  assert.equal(draftText('  a  '), '  a  ');
  assert.equal(draftText(undefined), '');
});
