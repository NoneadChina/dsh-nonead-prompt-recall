import test from 'node:test';
import assert from 'node:assert/strict';

import { collectText, userPromptOf } from '../lib/message-text.js';

test('collectText walks text blocks and nested content', () => {
  assert.equal(collectText('plain'), 'plain');
  assert.equal(collectText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]), 'ab');
  assert.equal(collectText([{ type: 'text', text: 'a', content: [{ type: 'text', text: 'nested' }] }]), 'anested');
  assert.equal(collectText([{ type: 'image', attachment: { name: 'x.png' } }]), '');
  assert.equal(collectText(null), '');
});

test('a typed user message yields its prompt', () => {
  const event = {
    type: 'user/message',
    data: {
      message: {
        role: 'user',
        source: { kind: 'user' },
        content: [{ type: 'text', text: '  帮我查一下天气  ' }],
      },
    },
  };
  assert.equal(userPromptOf(event), '帮我查一下天气');
});

test('a flat data.content message is supported', () => {
  const event = { type: 'user/message', data: { content: [{ type: 'text', text: '扁平结构' }], source: { kind: 'user' } } };
  assert.equal(userPromptOf(event), '扁平结构');
});

test('plugin-injected user messages are ignored', () => {
  const event = {
    type: 'user/message',
    data: {
      message: {
        role: 'user',
        source: { kind: 'plugin', plugin: 'memory' },
        content: [{ type: 'text', text: '[记忆注入] 这不是用户输入' }],
      },
    },
  };
  assert.equal(userPromptOf(event), null);
});

test('non-user roles and non-user events are ignored', () => {
  assert.equal(userPromptOf({ type: 'user/message', data: { message: { role: 'assistant', content: 'x' } } }), null);
  assert.equal(userPromptOf({ type: 'assistant/message', data: { message: { content: 'x' } } }), null);
  assert.equal(userPromptOf(null), null);
});

test('empty or attachment-only prompts are ignored', () => {
  assert.equal(userPromptOf({ type: 'user/message', data: { content: [{ type: 'text', text: '   ' }] } }), null);
  assert.equal(userPromptOf({ type: 'user/message', data: { content: [{ type: 'image', attachment: { name: 'a.png' } }] } }), null);
});

test('messages without a source are accepted (older host shape)', () => {
  assert.equal(userPromptOf({ type: 'user/message', data: { message: { role: 'user', content: '旧宿主' } } }), '旧宿主');
});

test('multi-line text keeps internal newlines and trims the edges', () => {
  const event = { type: 'user/message', data: { content: [{ type: 'text', text: '第一行\n第二行\n' }] } };
  assert.equal(userPromptOf(event), '第一行\n第二行');
});
