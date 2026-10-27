/**
 * Pure navigation decisions for the composer history.
 *
 * History is newest-first: index 0 is the last submitted prompt, index 1 the one
 * before it, and so on. `index === -1` means "not currently browsing history".
 *
 * The composer is not a plain textarea: `setDraft` may normalize the text it is
 * given (reference placeholders are stripped, newlines are split into
 * paragraphs). `decideNav` therefore compares the live draft against the
 * *effective* entry that the composer produced (`entry`), not against the raw
 * stored string, so walking further back still works after such normalization.
 *
 * Kept free of DOM/DSH imports so it can be unit-tested directly.
 */

/**
 * Normalize a draft for comparisons (line endings only; no trimming).
 * @param {string} value
 * @returns {string}
 */
export function draftText(value) {
  return typeof value === 'string' ? value.replace(/\r\n/gu, '\n') : '';
}

/**
 * Decide what an ↑/↓ press should do.
 * @param {'ArrowUp'|'ArrowDown'} key
 * @param {string} text - current composer text.
 * @param {readonly string[]} history - newest-first prompts.
 * @param {number} index - currently shown history index (-1 when not browsing).
 * @param {string} [entry] - effective text of `history[index]` as the composer
 * normalized it; defaults to `history[index]`.
 * @returns {{handled: false} | {handled: true, index: number, entry: string}}
 */
export function decideNav(key, text, history, index, entry) {
  if (!Array.isArray(history) || history.length === 0) return { handled: false };
  const current = draftText(text);

  const browsing = Number.isInteger(index) && index >= 0 && index < history.length;
  const expected = browsing ? draftText(entry !== undefined ? entry : history[index]) : '';

  if (key === 'ArrowUp') {
    if (current.trim() === '') {
      return { handled: true, index: 0, entry: history[0] };
    }
    if (browsing && current === expected && index + 1 < history.length) {
      return { handled: true, index: index + 1, entry: history[index + 1] };
    }
    return { handled: false };
  }

  if (key === 'ArrowDown') {
    if (browsing && current === expected) {
      const next = index - 1;
      return { handled: true, index: next, entry: next >= 0 ? history[next] : '' };
    }
    return { handled: false };
  }

  return { handled: false };
}
