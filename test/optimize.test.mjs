import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_INPUT_CHARS,
  MAX_OUTPUT_CHARS,
  MIN_OUTPUT_CHARS,
  buildDraftDocument,
  copyReference,
  countSentinels,
  draftFromShell,
  isEmptyText,
  isOverLimit,
  maskDraft,
  outputLimitFor,
  unmaskDraft,
} from '../src/optimize.js';

/**
 * Build a semantic draft whose references cover the given chip strings.
 * @param {string} text
 * @param {string[]} chips
 */
function draftWith(text, chips) {
  let from = 0;
  const references = chips.map((chip) => {
    const at = text.indexOf(chip, from);
    assert.notEqual(at, -1, `chip ${chip} is missing from the fixture`);
    from = at + chip.length;
    return {
      source: 'file',
      ref: chip.slice(1),
      offset: at,
      length: chip.length,
      label: chip.slice(1),
      clipboardText: chip,
    };
  });
  return { text, references };
}

test('isEmptyText treats blank drafts as empty', () => {
  assert.equal(isEmptyText(''), true);
  assert.equal(isEmptyText('   '), true);
  assert.equal(isEmptyText('\n\t\n'), true);
  assert.equal(isEmptyText(undefined), true);
  assert.equal(isEmptyText('hi'), false);
});

test('isOverLimit uses the 8000-character boundary', () => {
  assert.equal(isOverLimit('a'.repeat(MAX_INPUT_CHARS)), false);
  assert.equal(isOverLimit('a'.repeat(MAX_INPUT_CHARS + 1)), true);
  assert.equal(isOverLimit(undefined), false);
});

test('outputLimitFor keeps the 60-character floor and the 1200 cap', () => {
  assert.equal(outputLimitFor(''), MIN_OUTPUT_CHARS);
  assert.equal(outputLimitFor('翻译'), MIN_OUTPUT_CHARS);
  assert.equal(outputLimitFor('a'.repeat(100)), 135);
  assert.equal(outputLimitFor('a'.repeat(2000)), MAX_OUTPUT_CHARS);
});

test('draftFromShell prefers draftSnapshot and falls back to projection', () => {
  const snapshot = {
    text: '看看 @a.ts',
    references: [{ source: 'file', ref: 'a.ts', offset: 3, length: 5, label: 'a.ts', clipboardText: '@a.ts' }],
  };
  const fromSnapshot = draftFromShell({ draftSnapshot: snapshot });
  assert.equal(fromSnapshot.text, '看看 @a.ts');
  assert.equal(fromSnapshot.references.length, 1);
  assert.equal(fromSnapshot.hasCommand, false);

  const fromProjection = draftFromShell({
    projection: {
      clipboardText: '看看 @a.ts',
      occurrences: [{ occurrenceId: 1, ...snapshot.references[0] }],
    },
  });
  assert.equal(fromProjection.text, '看看 @a.ts');
  assert.equal(fromProjection.references[0].ref, 'a.ts');

  const command = draftFromShell({ draftSnapshot: { text: '/clear', references: [], command: { token: '/clear' } } });
  assert.equal(command.hasCommand, true);
});

test('maskDraft replaces every chip with an ordered sentinel', () => {
  const draft = draftWith('请参考 @a.ts 的实现，再对照 @b.ts', ['@a.ts', '@b.ts']);
  const masked = maskDraft(draft);
  assert.equal(masked.ok, true);
  assert.equal(masked.count, 2);
  assert.equal(masked.text, '请参考 ⟦C1⟧ 的实现，再对照 ⟦C2⟧');
  assert.equal(countSentinels(masked.text), 2);
});

test('maskDraft rejects inconsistent references', () => {
  const base = draftWith('看看 @a.ts', ['@a.ts']);
  const overlap = maskDraft({
    text: '@a.ts@a.ts',
    references: [
      { ...base.references[0], offset: 0 },
      { ...base.references[0], offset: 2 },
    ],
  });
  assert.deepEqual(overlap, { ok: false, reason: 'overlap' });

  const outOfRange = maskDraft({
    text: '看看 @a.ts',
    references: [{ ...base.references[0], offset: 3, length: 99 }],
  });
  assert.deepEqual(outOfRange, { ok: false, reason: 'out-of-range' });

  const mismatch = maskDraft({
    text: '看看 @a.ts',
    references: [{ ...base.references[0], clipboardText: '@b.ts', length: 5 }],
  });
  assert.deepEqual(mismatch, { ok: false, reason: 'text-mismatch' });

  const badLength = maskDraft({
    text: '看看 @a.ts',
    references: [{ ...base.references[0], offset: 3, length: 0 }],
  });
  assert.deepEqual(badLength, { ok: false, reason: 'bad-length' });
});

test('unmaskDraft restores chips at their rewritten positions', () => {
  const draft = draftWith('请参考 @a.ts 的实现，再对照 @b.ts', ['@a.ts', '@b.ts']);
  const restored = unmaskDraft('请参考 ⟦C1⟧ 的实现，再比对 ⟦C2⟧ 的行为', draft);
  assert.equal(restored.ok, true);
  assert.equal(restored.text, '请参考 @a.ts 的实现，再比对 @b.ts 的行为');
  assert.equal(restored.references.length, 2);
  assert.equal(restored.references[0].offset, 4);
  assert.equal(restored.text.slice(restored.references[0].offset, restored.references[0].offset + 5), '@a.ts');
  const second = restored.references[1];
  assert.equal(restored.text.slice(second.offset, second.offset + second.length), '@b.ts');
});

test('unmaskDraft rejects damaged sentinels', () => {
  const draft = draftWith('请参考 @a.ts 的实现，再对照 @b.ts', ['@a.ts', '@b.ts']);
  assert.equal(unmaskDraft('请参考 的实现，再对照 ⟦C2⟧', draft).reason, 'missing-sentinel');
  assert.equal(unmaskDraft('请参考 ⟦C2⟧ 的实现，再对照 ⟦C1⟧', draft).reason, 'sentinel-order');
  assert.equal(unmaskDraft('请参考 ⟦C1⟧⟦C1⟧ 的实现，再对照 ⟦C2⟧', draft).reason, 'extra-sentinel');
  assert.equal(unmaskDraft('请参考 ⟦C1⟧ 的实现，再对照 ⟦C1⟧', draft).reason, 'sentinel-order');
  assert.equal(unmaskDraft('请参考 ⟦C1 的实现，再对照 @b.ts', draft).reason, 'malformed-sentinel');
  assert.equal(unmaskDraft('请参考 ⟦C1 ⟧ 的实现', draft).reason, 'missing-sentinel');
});

test('unmaskDraft is a no-op when the draft has no chips', () => {
  const restored = unmaskDraft('把这句话改写一下', { text: '把这句话改写一下', references: [] });
  assert.equal(restored.ok, true);
  assert.equal(restored.text, '把这句话改写一下');
  assert.deepEqual(restored.references, []);
});

test('buildDraftDocument produces an owned semantic document', () => {
  const references = [{
    source: 'file', ref: 'a.ts', offset: 4, length: 5, label: 'a.ts', clipboardText: '@a.ts',
  }];
  const quotes = [{ offset: 0, length: 2, text: '引用' }];
  const document = buildDraftDocument('请参考 @a.ts', references, quotes);
  assert.deepEqual(document.references, references);
  assert.deepEqual(document.quotes, quotes);
  document.references[0].offset = 99;
  assert.equal(references[0].offset, 4, 'the document owns its references');

  const withoutQuotes = buildDraftDocument('纯文本');
  assert.deepEqual(withoutQuotes, { text: '纯文本', references: [] });
});

test('copyReference keeps optional fields only when present', () => {
  const full = copyReference({
    source: 'session', ref: 's_1', offset: 0, length: 4, label: '会话', clipboardText: '@会话',
    appearance: 'session', invalid: true, occurrenceId: 7,
  });
  assert.deepEqual(full, {
    source: 'session', ref: 's_1', offset: 0, length: 4, label: '会话', clipboardText: '@会话',
    appearance: 'session', invalid: true,
  });

  const minimal = copyReference({
    source: 'file', ref: 'a.ts', offset: 0, length: 5, label: 'a.ts', clipboardText: '@a.ts',
  });
  assert.deepEqual(minimal, {
    source: 'file', ref: 'a.ts', offset: 0, length: 5, label: 'a.ts', clipboardText: '@a.ts',
  });
});
