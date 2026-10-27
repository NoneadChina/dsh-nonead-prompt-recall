/**
 * dsh-nonead-prompt-recall — browser half.
 *
 * Wires the composer (`[data-composer-input]`) to a per-workspace prompt history:
 * - an empty composer + ↑ loads the newest prompt, ↑ again walks older;
 * - ↓ walks back toward the newest entry and finally restores the empty draft;
 * - typing resets the walk, so ↑/↓ behave normally for any hand-written draft.
 *
 * The text is written through the harness's own composer facade
 * (`conversation.input.shell(sessionId).setDraft`), not through DOM pokes, so the
 * Lexical editor, draft persistence and the send button stay consistent.
 *
 * This file is the authoring source: `scripts/build-client.mjs` wraps it (and
 * `core.js`) into the `window.__ModuleLoader__` bundle at `lib/client.js`.
 */

import { decideNav, draftText } from './core.js';
import { CHANNEL, COMPOSER_SELECTOR } from './protocol.js';
import { registerSettingsSection } from './settings.js';

export const name = 'dsh-nonead-prompt-recall';
export const inject = ['sessions', 'slots', 'locale', 'connection'];

/** How long programmatic draft writes suppress the input-reset listener. */
const PROGRAMMATIC_GRACE_MS = 250;

/** Text fields the harness uses to expose the semantic draft. */
function projectionText(shell) {
  try {
    const projection = shell?.projection;
    if (projection !== null && typeof projection === 'object' && typeof projection.clipboardText === 'string') {
      return projection.clipboardText;
    }
  } catch {
    /* facade shapes drift; fall through to the DOM */
  }
  return null;
}

/**
 * Mount the keyboard bridge.
 * @param {any} ctx - client plugin context (`sessions` injected).
 */
export function apply(ctx) {
  const doc = typeof document === 'undefined' ? undefined : document;
  if (doc === undefined || doc === null) return;

  /**
   * Navigation state for the composer currently being driven.
   * `entry` is the *effective* text after the composer normalized it, which is
   * what the next ↑/↓ must compare against.
   */
  const state = { el: null, index: -1, entry: '', list: null, sessionId: '', shell: null };
  /** Number of ↑ presses waiting for a first history fetch. */
  let pendingUp = 0;
  /** Bumped to invalidate an in-flight fetch (new press, typing, focus move). */
  let fetchSeq = 0;
  let programmaticUntil = 0;

  const service = (key) => {
    try {
      return ctx.get(key);
    } catch {
      return undefined;
    }
  };

  const listSnapshot = () => {
    try {
      return service('sessions')?.list?.getSnapshot?.();
    } catch {
      return undefined;
    }
  };

  /** Main-view sessions, most recently updated first. */
  const candidateSessionIds = () => {
    const snapshot = listSnapshot();
    const byId = snapshot?.byId;
    if (byId === null || typeof byId !== 'object') return [];
    const ids = Array.isArray(snapshot.ids) && snapshot.ids.length > 0 ? snapshot.ids : Object.keys(byId);
    return ids
      .filter((id) => {
        const row = byId[id];
        return row !== null && typeof row === 'object'
          && row.retainedBy !== null && typeof row.retainedBy === 'object'
          && Number(row.retainedBy.mainView) > 0;
      })
      .sort((a, b) => (Number(byId[b]?.updatedAt) || 0) - (Number(byId[a]?.updatedAt) || 0));
  };

  const cwdOf = (sessionId) => {
    const row = listSnapshot()?.byId?.[sessionId];
    return typeof row?.cwd === 'string' ? row.cwd : '';
  };

  /**
   * Resolve one session's composer facade.
   * `shell(id)` is the id-addressed route; `for(sessionScope)` is the older
   * scope-addressed route kept as a fallback for host versions without it.
   */
  const shellOf = (input, sessionId) => {
    if (typeof input.shell === 'function') {
      try {
        return input.shell(sessionId);
      } catch {
        /* fall through to the scope route */
      }
    }
    if (typeof input.for === 'function') {
      try {
        const scope = service('sessions')?.scope?.(sessionId);
        if (scope !== undefined) return input.for(scope);
      } catch {
        /* no retained scope */
      }
    }
    return null;
  };

  /**
   * Resolve the composer facade whose editor owns `el`.
   * @param {HTMLElement} el - focused composer contenteditable.
   * @returns {{shell: any, sessionId: string, cwd: string} | null}
   */
  const resolveComposer = (el) => {
    const input = service('conversation')?.input;
    if (input === null || input === undefined) return null;
    for (const sessionId of candidateSessionIds()) {
      const shell = shellOf(input, sessionId);
      if (shell === null || shell === undefined) continue;
      let root;
      try {
        root = shell.editor?.getRootElement?.();
      } catch {
        root = undefined;
      }
      if (root === el || (root && typeof root.contains === 'function' && root.contains(el))) {
        return { shell, sessionId, cwd: cwdOf(sessionId) };
      }
    }
    return null;
  };

  const textOf = (el, shell) => {
    const projected = projectionText(shell);
    if (projected !== null) return projected;
    return typeof el?.textContent === 'string' ? el.textContent : '';
  };

  /**
   * Write one draft through the composer facade and remember the text the
   * composer actually produced (it may strip reference placeholders).
   * @returns {string} the effective draft text.
   */
  const writeDraft = (el, shell, entry, index) => {
    programmaticUntil = Date.now() + PROGRAMMATIC_GRACE_MS;
    try {
      shell.setDraft(entry);
    } catch {
      try {
        shell.actions?.setDraft?.(entry);
      } catch {
        /* composer is gone; nothing else to try */
      }
    }
    try {
      shell.focus?.();
    } catch {
      /* focus is best-effort */
    }
    const effective = textOf(el, shell);
    state.entry = effective;
    state.index = index;
    state.shell = shell;
    return effective;
  };

  const fetchHistory = async ({ sessionId, cwd }) => {
    const connection = service('connection');
    if (connection === null || connection === undefined || typeof connection.rpc?.call !== 'function') return null;
    try {
      const result = await connection.rpc.call(CHANNEL, 'history', cwd !== '' ? { cwd } : { sessionId });
      if (result === null || typeof result !== 'object' || result.ok !== true) return null;
      const entries = result.value?.entries;
      if (!Array.isArray(entries)) return null;
      const texts = [];
      for (const entry of entries) {
        const text = typeof entry === 'string' ? entry : entry?.text;
        if (typeof text === 'string' && text.trim() !== '') texts.push(text);
      }
      return texts;
    } catch {
      return null;
    }
  };

  const onKeyDown = (event) => {
    if (event === null || event === undefined || event.defaultPrevented === true || event.isComposing === true) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const key = event.key;
    if (key !== 'ArrowUp' && key !== 'ArrowDown') return;

    const el = event.target;
    if (el === null || typeof el?.matches !== 'function' || !el.matches(COMPOSER_SELECTOR)) return;

    const resolved = resolveComposer(el);
    if (resolved === null) return;
    const text = textOf(el, resolved.shell);

    // First ↑ in an empty composer: fetch the newest list, then fill.
    // Every press before the list arrives counts, so two quick ↑ presses land
    // two entries back instead of collapsing into one. The default caret move
    // inside an empty composer is harmless, so the event is not swallowed.
    if (key === 'ArrowUp' && text.trim() === '') {
      pendingUp += 1;
      const steps = pendingUp;
      const token = ++fetchSeq;
      void fetchHistory(resolved).then((list) => {
        if (token !== fetchSeq) return; // superseded by a newer press or by typing
        if (state.el !== null && state.el !== el) return; // focus moved to another composer
        if (draftText(textOf(el, resolved.shell)).trim() !== '') {
          pendingUp = 0;
          return; // user typed meanwhile
        }
        pendingUp = 0;
        if (list === null || list.length === 0) return;
        const target = Math.min(steps, list.length) - 1;
        state.el = el;
        state.sessionId = resolved.sessionId;
        state.list = list;
        writeDraft(el, resolved.shell, list[target], target);
      });
      return;
    }

    if (state.el !== el || state.sessionId !== resolved.sessionId || !Array.isArray(state.list)) return;
    const decision = decideNav(key, text, state.list, state.index, state.entry);
    if (decision.handled !== true) return;

    event.preventDefault();
    if (typeof event.stopPropagation === 'function') event.stopPropagation();

    pendingUp = 0;
    writeDraft(el, resolved.shell, decision.entry, decision.index);
  };

  const onInput = (event) => {
    if (Date.now() < programmaticUntil) return;
    const el = event?.target;
    if (el === null || typeof el?.matches !== 'function' || !el.matches(COMPOSER_SELECTOR)) return;

    // Real typing means a pending first-↑ fetch must not overwrite it — even
    // before the first fetch resolved and `state.el` was recorded.
    pendingUp = 0;
    fetchSeq += 1;
    if (state.el !== el) return;
    if (state.index < 0 && state.entry === '') return; // not browsing history

    const shell = state.shell ?? resolveComposer(el)?.shell;
    if (draftText(textOf(el, shell)) !== draftText(state.entry)) {
      state.index = -1;
      state.entry = '';
    }
  };

  const onFocusIn = (event) => {
    const el = event?.target;
    if (el === null || typeof el?.matches !== 'function' || !el.matches(COMPOSER_SELECTOR)) return;
    if (state.el !== el) {
      pendingUp = 0;
      fetchSeq += 1;
      state.el = el;
      state.index = -1;
      state.entry = '';
      state.list = null;
      state.sessionId = '';
      state.shell = null;
    }
  };

  doc.addEventListener('keydown', onKeyDown, true);
  doc.addEventListener('input', onInput, true);
  doc.addEventListener('focusin', onFocusIn, true);

  // Settings page (settings.section slot). Optional: headless/test contexts
  // without a slots service simply skip it.
  try {
    registerSettingsSection(ctx);
  } catch {
    /* the keyboard bridge must keep working even if the settings page fails */
  }

  const dispose = () => {
    doc.removeEventListener('keydown', onKeyDown, true);
    doc.removeEventListener('input', onInput, true);
    doc.removeEventListener('focusin', onFocusIn, true);
  };

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => dispose, 'dsh-nonead-prompt-recall keyboard bridge');
    return undefined;
  }
  return dispose;
}
