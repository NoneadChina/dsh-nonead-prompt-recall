/**
 * Extract the human-authored prompt text from a `session/event` event.
 *
 * `user/message` carries several origins (typed input, plugin injections,
 * continuation rituals). Only `source.kind === 'user'` (or a missing source, for
 * older hosts) is a prompt the user typed and would expect to recall.
 */

/**
 * Collect text parts from a message content array.
 * @param {unknown} content - message content (string, block array or object).
 * @param {number} [depth] - recursion guard.
 * @returns {string} concatenated text.
 */
export function collectText(content, depth = 0) {
  if (content === null || content === undefined || depth > 8) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    let out = '';
    for (const part of content) out += collectText(part, depth + 1);
    return out;
  }
  if (typeof content !== 'object') return '';

  let out = '';
  const kind = typeof content.type === 'string' ? content.type : undefined;
  if (typeof content.text === 'string' && (kind === undefined || kind === 'text')) out += content.text;
  else if (typeof content.input_text === 'string') out += content.input_text;
  if (content.content !== undefined) out += collectText(content.content, depth + 1);
  return out;
}

/**
 * The user-typed prompt carried by one event, if this event is one.
 * @param {{type?: string, data?: unknown} | null | undefined} event - session event.
 * @returns {string | null} trimmed prompt text, or null when the event is not a
 * human user message / carries no text.
 */
export function userPromptOf(event) {
  if (event === null || typeof event !== 'object') return null;
  if (event.type !== undefined && event.type !== 'user/message') return null;

  const data = event.data;
  if (data === null || typeof data !== 'object') return null;

  const message = data.message !== null && typeof data.message === 'object' ? data.message : data;
  const source = message.source !== undefined ? message.source : data.source;
  const kind = typeof source === 'string'
    ? source
    : source !== null && typeof source === 'object' && typeof source.kind === 'string'
      ? source.kind
      : undefined;
  if (kind !== undefined && kind !== '' && kind !== 'user') return null;

  if (typeof message.role === 'string' && message.role !== 'user') return null;

  const content = message.content !== undefined ? message.content : data.content;
  const text = collectText(content).replace(/\r\n/gu, '\n').trim();
  return text === '' ? null : text;
}
