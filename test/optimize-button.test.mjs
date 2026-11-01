import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTIVITY_SLOT,
  draftBlocker,
  registerOptimizeButton,
  resolveOptimizeOutcome,
} from '../src/optimize-button.js';

const DRAFT = { text: '帮我把这段代码改成 async', references: [], quotes: [], hasCommand: false };

/** One chip-bearing draft: text carries the chip's clipboard projection. */
const CHIP_DRAFT = {
  text: '@src/app.ts 把这个文件里的回调改成 async',
  references: [{
    source: 'file',
    ref: 'src/app.ts',
    offset: 0,
    length: 11,
    label: 'app.ts',
    clipboardText: '@src/app.ts',
  }],
  quotes: [],
  hasCommand: false,
};

test('draftBlocker mirrors the composer disable rules', () => {
  assert.equal(draftBlocker(DRAFT), null);
  assert.equal(draftBlocker({ ...DRAFT, text: '  ' }), 'empty');
  assert.equal(draftBlocker({ ...DRAFT, text: 'x'.repeat(8001) }), 'over-limit');
  assert.equal(draftBlocker({ ...DRAFT, hasCommand: true }), 'command');
  assert.equal(draftBlocker(DRAFT, { locked: true }), 'locked');
  // Attachments are not part of the text segment: whitespace-only text is empty.
  assert.equal(draftBlocker({ text: '\n\t ', references: [] }), 'empty');
});

test('a successful rewrite replaces the draft and keeps references untouched', () => {
  const outcome = resolveOptimizeOutcome(
    { ok: true, value: { status: 'ok', text: '把这段代码改写成 async/await 形式。', masked: false } },
    { before: CHIP_DRAFT, current: { text: CHIP_DRAFT.text }, maskedCount: 0 },
  );
  assert.equal(outcome.action, 'write');
  assert.equal(outcome.text, '把这段代码改写成 async/await 形式。');
  assert.equal(outcome.references.length, 1);
});

test('a masked rewrite puts the chips back at their new offsets', () => {
  const outcome = resolveOptimizeOutcome(
    { ok: true, value: { status: 'ok', text: '请阅读 ⟦C1⟧ 并把这个文件里的回调改成 async/await。', masked: true } },
    { before: CHIP_DRAFT, current: { text: CHIP_DRAFT.text }, maskedCount: 1 },
  );
  assert.equal(outcome.action, 'write');
  assert.equal(outcome.text, '请阅读 @src/app.ts 并把这个文件里的回调改成 async/await。');
  assert.equal(outcome.references[0].offset, '请阅读 '.length);
  assert.equal(outcome.references[0].clipboardText, '@src/app.ts');
});

test('damaged sentinels discard the result instead of writing a wrong draft', () => {
  for (const text of ['请阅读 ⟦C2⟧ 并改写。', '请阅读 并改写。', '请阅读 ⟦C1⟧ 与 ⟦C1⟧ 并改写。']) {
    const outcome = resolveOptimizeOutcome(
      { ok: true, value: { status: 'ok', text, masked: true } },
      { before: CHIP_DRAFT, current: { text: CHIP_DRAFT.text }, maskedCount: 1 },
    );
    assert.deepEqual(outcome, { action: 'toast', key: 'chipMismatch' });
  }
});

test('model-side "no change" and "no output" are toasts, not writes', () => {
  assert.deepEqual(
    resolveOptimizeOutcome(
      { ok: true, value: { status: 'unchanged', text: '帮我把这段代码改成 async', masked: false } },
      { before: DRAFT, current: { text: DRAFT.text }, maskedCount: 0 },
    ),
    { action: 'toast', key: 'unchanged' },
  );
  assert.deepEqual(
    resolveOptimizeOutcome(
      { ok: true, value: { status: 'empty', text: '', masked: false } },
      { before: DRAFT, current: { text: DRAFT.text }, maskedCount: 0 },
    ),
    { action: 'toast', key: 'emptyResult' },
  );
  assert.deepEqual(
    resolveOptimizeOutcome(
      { ok: true, value: { status: 'ok', text: '   ', masked: false } },
      { before: DRAFT, current: { text: DRAFT.text }, maskedCount: 0 },
    ),
    { action: 'toast', key: 'emptyResult' },
  );
});

test('a draft edited while optimizing wins over the model result', () => {
  const outcome = resolveOptimizeOutcome(
    { ok: true, value: { status: 'ok', text: '把这段代码改写成 async/await 形式。', masked: false } },
    { before: DRAFT, current: { text: '帮我把这段代码改成 async，再补测试' }, maskedCount: 0 },
  );
  assert.deepEqual(outcome, { action: 'toast', key: 'changed' });
});

test('host failures map to the documented UI actions', () => {
  const context = { before: DRAFT, current: { text: DRAFT.text }, maskedCount: 0 };
  const cases = [
    ['prompt-recall/optimize-failed', { action: 'toast', key: 'failed' }],
    ['prompt-recall/optimize-timeout', { action: 'toast', key: 'failed' }],
    ['prompt-recall/optimize-upstream', { action: 'toast', key: 'failed' }],
    ['prompt-recall/optimize-bad-request', { action: 'toast', key: 'failed' }],
    ['prompt-recall/optimize-no-model', { action: 'toast', key: 'noModel' }],
    ['prompt-recall/optimize-chip-mismatch', { action: 'toast', key: 'chipMismatch' }],
    ['prompt-recall/optimize-aborted', { action: 'silent' }],
    ['prompt-recall/optimize-busy', { action: 'silent' }],
    ['prompt-recall/optimize-disabled', { action: 'silent' }],
  ];
  for (const [code, expected] of cases) {
    assert.deepEqual(resolveOptimizeOutcome({ ok: false, error: { code } }, context), expected, code);
  }
  assert.deepEqual(resolveOptimizeOutcome(null, context), { action: 'toast', key: 'failed' });
});

test('registration targets the activity slot and injects the composer services', () => {
  const registrations = [];
  const conversation = { input: {} };
  const connection = { rpc: { call() {} } };
  const ctx = {
    slots: {
      inject(slot, reader) {
        assert.equal(slot, ACTIVITY_SLOT);
        reader();
      },
      register(spec, component) {
        registrations.push({ spec, component });
        return () => {};
      },
    },
    get(key) {
      if (key === 'conversation') return conversation;
      if (key === 'connection') return connection;
      return undefined;
    },
    logger: { warn() {} },
  };

  assert.equal(registerOptimizeButton(ctx), true);
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].spec.name, ACTIVITY_SLOT);
  assert.equal(typeof registrations[0].component, 'function');
  const injected = registrations[0].spec.inject();
  assert.equal(injected.conversation, conversation);
  assert.equal(injected.connection, connection);
});

test('a context without a slots service simply skips the button', () => {
  assert.equal(registerOptimizeButton({}), false);
  assert.equal(registerOptimizeButton(null), false);
});
