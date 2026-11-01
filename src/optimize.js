/**
 * Pure helpers behind the composer "optimize prompt" action.
 *
 * Everything here is deterministic and DOM-free so it can be unit-tested and
 * then shipped inside the browser bundle unchanged. The only draft shape this
 * module knows is the composer's semantic document:
 *
 *   { text, references: [{ source, ref, offset, length, label, clipboardText,
 *                          appearance?, invalid? }], command?, quotes? }
 *
 * `text` is the clipboard projection (each chip already expanded to its
 * `clipboardText`); every reference identifies its own span inside that text.
 */

/** Maximum editable text length, measured on the unmasked draft. */
export const MAX_INPUT_CHARS = 8000;

/** Short-draft floor for the output budget (see §6.2 of the design doc). */
export const MIN_OUTPUT_CHARS = 60;

/** Absolute ceiling for one rewritten draft. */
export const MAX_OUTPUT_CHARS = 1200;

/** Reference sentinel: `⟦C1⟧`, `⟦C2⟧`, … (U+27E6 / U+27E7 brackets). */
const SENTINEL_PATTERN = /\u27E6C(\d+)\u27E7/gu;

/**
 * @param {unknown} text
 * @returns {boolean} whether the text segment has nothing to optimize.
 */
export function isEmptyText(text) {
  return typeof text !== 'string' || text.trim() === '';
}

/**
 * @param {unknown} text
 * @returns {boolean} whether the text segment exceeds the editable limit.
 */
export function isOverLimit(text) {
  return typeof text === 'string' && text.length > MAX_INPUT_CHARS;
}

/**
 * Output allowance for one input: `max(60, 1.35x)`, capped at 1200.
 * @param {unknown} text
 * @returns {number} characters allowed in the rewritten draft.
 */
export function outputLimitFor(text) {
  const length = typeof text === 'string' ? text.length : 0;
  return Math.min(MAX_OUTPUT_CHARS, Math.max(MIN_OUTPUT_CHARS, Math.ceil(length * 1.35)));
}

/**
 * Normalize a shell draft snapshot into the document shape this module uses.
 * Accepts either `shell.draftSnapshot` or `shell.projection` so a host without
 * the getter still works.
 * @param {unknown} shell
 * @returns {{ text: string, references: Array<object>, quotes: Array<object>, hasCommand: boolean }}
 */
export function draftFromShell(shell) {
  const snapshot = shell?.draftSnapshot;
  const source = snapshot !== null && typeof snapshot === 'object'
    ? snapshot
    : shell?.projection;
  const text = typeof source?.text === 'string'
    ? source.text
    : typeof source?.clipboardText === 'string' ? source.clipboardText : '';
  const references = Array.isArray(source?.references)
    ? source.references
    : Array.isArray(source?.occurrences) ? source.occurrences : [];
  const quotes = Array.isArray(source?.quotes) ? source.quotes : [];
  return {
    text,
    references: references.map(copyReference),
    quotes: quotes.map((quote) => ({ ...quote })),
    hasCommand: source?.command !== undefined && source?.command !== null,
  };
}

/**
 * Copy one reference into an owned plain object (drops editor identities).
 * @param {object} reference
 * @returns {object}
 */
export function copyReference(reference) {
  const copy = {
    source: reference.source,
    ref: reference.ref,
    offset: reference.offset,
    length: reference.length,
    label: reference.label,
    clipboardText: reference.clipboardText,
  };
  if (reference.appearance !== undefined) copy.appearance = reference.appearance;
  if (reference.invalid !== undefined) copy.invalid = reference.invalid;
  return copy;
}

/**
 * Replace every reference span with a numbered sentinel.
 * @param {{ text?: string, references?: Array<object> }} draft
 * @returns {{ ok: true, text: string, count: number, references: Array<object> } | { ok: false, reason: string }}
 */
export function maskDraft(draft) {
  const text = typeof draft?.text === 'string' ? draft.text : '';
  const references = Array.isArray(draft?.references)
    ? [...draft.references].sort((a, b) => a.offset - b.offset)
    : [];

  let cursor = 0;
  let masked = '';
  for (let index = 0; index < references.length; index += 1) {
    const reference = references[index];
    if (!Number.isInteger(reference?.offset) || reference.offset < cursor) {
      return { ok: false, reason: 'overlap' };
    }
    if (!Number.isInteger(reference?.length) || reference.length <= 0) {
      return { ok: false, reason: 'bad-length' };
    }
    const end = reference.offset + reference.length;
    if (end > text.length) return { ok: false, reason: 'out-of-range' };
    const span = text.slice(reference.offset, end);
    if (span !== reference.clipboardText) return { ok: false, reason: 'text-mismatch' };

    masked += text.slice(cursor, reference.offset);
    masked += `\u27E6C${index + 1}\u27E7`;
    cursor = end;
  }
  masked += text.slice(cursor);
  return { ok: true, text: masked, count: references.length, references };
}

/**
 * Validate the model's sentinels and put the original chips back.
 * @param {unknown} maskedText - the model's rewritten text (still masked).
 * @param {{ text?: string, references?: Array<object>, quotes?: Array<object> }} draft - the pre-optimization draft.
 * @returns {{ ok: true, text: string, references: Array<object>, quotes: Array<object> } | { ok: false, reason: string }}
 */
export function unmaskDraft(maskedText, draft) {
  const source = typeof maskedText === 'string' ? maskedText : '';
  const references = Array.isArray(draft?.references)
    ? [...draft.references].sort((a, b) => a.offset - b.offset)
    : [];
  const quotes = Array.isArray(draft?.quotes) ? draft.quotes.map((quote) => ({ ...quote })) : [];

  const matches = [...source.matchAll(SENTINEL_PATTERN)];
  const opens = (source.match(/\u27E6/gu) ?? []).length;
  const closes = (source.match(/\u27E7/gu) ?? []).length;
  if (opens !== closes) return { ok: false, reason: 'malformed-sentinel' };
  if (matches.length !== references.length) {
    return { ok: false, reason: matches.length < references.length ? 'missing-sentinel' : 'extra-sentinel' };
  }

  let text = '';
  let cursor = 0;
  const placed = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    if (Number(match[1]) !== index + 1) return { ok: false, reason: 'sentinel-order' };
    const start = match.index ?? 0;
    text += source.slice(cursor, start);
    const reference = references[index];
    placed.push({ ...copyReference(reference), offset: text.length });
    text += reference.clipboardText;
    cursor = start + match[0].length;
  }
  text += source.slice(cursor);

  if (placed.some((reference) => text.slice(reference.offset, reference.offset + reference.length)
    !== reference.clipboardText)) {
    return { ok: false, reason: 'text-mismatch' };
  }

  return { ok: true, text, references: placed, quotes };
}

/**
 * Build the semantic document accepted by `shell.setDraft`.
 * @param {string} text
 * @param {Array<object>} [references]
 * @param {Array<object>} [quotes]
 * @returns {{ text: string, references: Array<object>, quotes?: Array<object> }}
 */
export function buildDraftDocument(text, references = [], quotes = []) {
  const document = { text: typeof text === 'string' ? text : '', references: references.map(copyReference) };
  if (quotes.length > 0) document.quotes = quotes.map((quote) => ({ ...quote }));
  return document;
}

/**
 * Count sentinels in a string; used by tests and by the client's guard.
 * @param {unknown} text
 * @returns {number}
 */
export function countSentinels(text) {
  if (typeof text !== 'string') return 0;
  return [...text.matchAll(SENTINEL_PATTERN)].length;
}
