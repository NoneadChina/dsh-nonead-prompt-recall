/**
 * Pure navigation decisions for the composer history.
 *
 * History is newest-first: index 0 is the last submitted prompt, index 1 the one
 * before it, and so on. `index === -1` means "not currently browsing history".
 *
 * Kept free of DOM/DSH imports so it can be unit-tested directly.
 */

/**
 * Compare two drafts in the way the composer produces them.
 * @param {string} value
 * @returns {string}
 */
function same(value) {
  return typeof value === 'string' ? value.replace(/\r\n/gu, '\n') : '';
}

/**
 * Decide what an ↑/↓ press should do.
 * @param {'ArrowUp'|'ArrowDown'} key
 * @param {string} text - current composer text.
 * @param {readonly string[]} history - newest-first prompts.
 * @param {number} index - currently shown history index (-1 when not browsing).
 * @returns {{handled: false} | {handled: true, index: number, entry: string}}
 */
export function decideNav(key, text, history, index) {
  if (!Array.isArray(history) || history.length === 0) return { handled: false };
  const current = same(text);

  if (key === 'ArrowUp') {
    if (current.trim() === '') {
      return { handled: true, index: 0, entry: history[0] };
    }
    if (
      Number.isInteger(index)
      && index >= 0
      && index < history.length
      && current === same(history[index])
      && index + 1 < history.length
    ) {
      return { handled: true, index: index + 1, entry: history[index + 1] };
    }
    return { handled: false };
  }

  if (key === 'ArrowDown') {
    if (
      Number.isInteger(index)
      && index >= 0
      && index < history.length
      && current === same(history[index])
    ) {
      const next = index - 1;
      return { handled: true, index: next, entry: next >= 0 ? history[next] : '' };
    }
    return { handled: false };
  }

  return { handled: false };
}
