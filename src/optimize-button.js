/**
 * Composer "optimize prompt" button — the browser half of 0.8.0.
 *
 * Mounted into the harness's `conversation.input.right` slot: a *list* slot of
 * compact controls that renders next to the model selector. The obvious
 * neighbour, `conversation.input.activity`, is a **single-occupant** slot that
 * DSH ships the voice-input button in — registering there evicts that occupant,
 * leaves its entry stuck in `loading`, and fails the whole web boot with
 * "1 entry did not activate". A list slot accepts a second cell safely.
 *
 * The component owns one per-session state machine:
 *
 *   ready ──click──▶ optimizing（draft untouched）──success──▶ done（undo）
 *     ▲                   │ failure / cancel / draft changed
 *     └───────────────────┘
 *
 * Only a successful rewrite writes through `shell.setDraft()`, and the result is
 * never sent automatically: it stays in the composer for the user to send.
 *
 * Everything that can be decided without React lives in exported pure helpers so
 * `test/optimize-button.test.mjs` can cover the state transitions directly.
 */

import { CHANNEL, ENDPOINT_OPTIMIZE } from './protocol.js';
import { buildDraftDocument, draftFromShell, isEmptyText, isOverLimit, maskDraft, unmaskDraft } from './optimize.js';
import { DICTS } from './i18n.js';

/**
 * Slot the button occupies. This must stay a `list` slot: `conversation.input
 * .activity` is single-occupant and already owned by DSH's voice-input button.
 */
export const ACTIVITY_SLOT = 'conversation.input.right';

const OPT_STYLE_ID = 'dsh-nonead-prompt-recall-optimize';
const OPT_SETTINGS_EVENT = 'dsh-nonead-prompt-recall:settings';

/**
 * Local strings for the two languages this stage ships; the i18n stage moves
 * them into `src/i18n.js` with the other six languages.
 */
/** Sparkle path and undo arrow from docs/icons (16 px grid, stroke 1.25). */
const SPARKLE_PATH = 'M8 1.6 9.7 6.3 14.4 8 9.7 9.7 8 14.4 6.3 9.7 1.6 8 6.3 6.3Z';
const UNDO_PATHS = ['M12.8 11.6c0-3.3-2.6-5.2-6.2-5.2H3.4', 'M6.2 3.6 3.2 6.4l3 2.8'];
/** Three-quarter arc; spinning it is the "working" state. */
const SPINNER_PATH = 'M8 2.4a5.6 5.6 0 1 1-5.6 5.6';

/** Suggested size from §3.1: 28 px desktop, 32 px on coarse pointers. */
const OPT_CSS = `
.dsh-pr-opt{position:relative;display:inline-flex;align-items:center;justify-content:center;order:1}
.dsh-pr-opt-btn{width:28px;height:28px;min-width:28px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background .16s ease,color .16s ease}
.dsh-pr-opt-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-pr-opt-btn:focus-visible{outline:2px solid var(--dsw-alias-border-focus);outline-offset:1px}
.dsh-pr-opt-btn:disabled{color:var(--dsw-alias-label-disable);cursor:not-allowed}
@media (pointer:coarse){.dsh-pr-opt-btn{width:32px;height:32px;min-width:32px}}
.dsh-pr-opt-svg{width:16px;height:16px;display:block;overflow:visible;transform-box:view-box;transform-origin:50% 50%}
/* Rotate with CSS, not SMIL. Chromium ignores the centre in an
 * animateTransform rotate and pivots about the origin instead, so the arc
 * visibly orbits the icon. transform-box:view-box + transform-origin:50% 50%
 * pins the pivot to the viewBox centre (8 8). The animation is deliberately
 * not disabled under prefers-reduced-motion: it only appears after an explicit
 * click and is the sole feedback that work started. */
.dsh-pr-opt-btn[data-mode="optimizing"] .dsh-pr-opt-svg{animation:dsh-pr-opt-spin .9s linear infinite}
@keyframes dsh-pr-opt-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
.dsh-pr-opt-toast{position:fixed;z-index:2147483000;max-width:280px;padding:6px 10px;border-radius:8px;font-size:12px;line-height:1.4;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);box-shadow:var(--dsw-shadow-lv2);pointer-events:none;transform:translate(-50%,-100%)}
/* DSH wraps every slot outlet in an anchor whose inline style is
 * display:contents, so the anchor never becomes a flex item and an order
 * on it is ignored. This span.dsh-pr-opt is the flex item itself: order:1
 * moves it after the model-selector cell in the same toolbar row. */
`;

function ensureOptimizeStyle() {
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
  const existing = document.getElementById(OPT_STYLE_ID);
  if (existing !== null) {
    // Refresh in place: a long-lived page may still hold an older copy of these
    // rules, and an id-only "already injected" check would keep it forever.
    if (existing.textContent !== OPT_CSS) existing.textContent = OPT_CSS;
    return;
  }
  const style = document.createElement('style');
  style.id = OPT_STYLE_ID;
  style.textContent = OPT_CSS;
  document.head?.appendChild(style);
}

/** Two-letter language for the local string table. */
/**
 * Why the button cannot start an optimization right now.
 * @param {{text: string, hasCommand: boolean}} draft
 * @param {{locked?: boolean}} context
 * @returns {'locked'|'command'|'empty'|'over-limit'|null}
 */
export function draftBlocker(draft, context = {}) {
  if (context.locked === true) return 'locked';
  if (draft?.hasCommand === true) return 'command';
  if (isEmptyText(draft?.text)) return 'empty';
  if (isOverLimit(draft?.text)) return 'over-limit';
  return null;
}

/**
 * Translate one RPC envelope into the next UI action.
 *
 * `write` means "replace the draft with this document"; `toast` carries a copy
 * key; `silent` keeps the draft untouched and shows nothing (cancelled/disabled).
 * @param {{ok?: boolean, value?: object, error?: {code?: string}} | null} result
 * @param {{before: {text: string, references?: Array<object>, quotes?: Array<object>},
 *   current: {text: string}, maskedCount: number}} context
 * @returns {{action: 'write', text: string, references: Array<object>, quotes: Array<object>}
 *   | {action: 'toast', key: string} | {action: 'silent'}}
 */
export function resolveOptimizeOutcome(result, context) {
  if (result === null || typeof result !== 'object' || result.ok !== true) {
    const code = typeof result?.error?.code === 'string' ? result.error.code : '';
    return errorAction(code);
  }
  const value = result.value !== null && typeof result.value === 'object' ? result.value : {};
  if (value.status === 'unchanged') return { action: 'toast', key: 'unchanged' };
  if (value.status === 'empty') return { action: 'toast', key: 'emptyResult' };
  if (typeof value.text !== 'string' || value.text.trim() === '') return { action: 'toast', key: 'emptyResult' };

  if (typeof context?.current?.text === 'string' && context.current.text !== context.before.text) {
    return { action: 'toast', key: 'changed' };
  }

  if (context.maskedCount > 0) {
    const restored = unmaskDraft(value.text, context.before);
    if (restored.ok !== true) return { action: 'toast', key: 'chipMismatch' };
    return { action: 'write', text: restored.text, references: restored.references, quotes: restored.quotes };
  }
  return {
    action: 'write',
    text: value.text,
    references: Array.isArray(context?.before?.references) ? context.before.references : [],
    quotes: Array.isArray(context?.before?.quotes) ? context.before.quotes : [],
  };
}

/** Map a stable host error code to the UI action. */
function errorAction(code) {
  if (code === 'prompt-recall/optimize-aborted' || code === 'prompt-recall/optimize-busy') return { action: 'silent' };
  if (code === 'prompt-recall/optimize-disabled') return { action: 'silent' };
  if (code === 'prompt-recall/optimize-no-model') return { action: 'toast', key: 'noModel' };
  if (code === 'prompt-recall/optimize-chip-mismatch') return { action: 'toast', key: 'chipMismatch' };
  return { action: 'toast', key: 'failed' };
}

/** Semantic outcome keys (§3.4) mapped to their dictionary keys. */
const TOAST_KEY = {
  failed: 'optFailed',
  unchanged: 'optUnchanged',
  emptyResult: 'optEmptyResult',
  changed: 'optChanged',
  noModel: 'optNoModel',
  chipMismatch: 'optChipMismatch',
};

/** One undo snapshot per session, memory only (lost on reload by design). */
const snapshots = new Map();
const MAX_SESSIONS = 20;

function rememberSnapshot(sessionId, snapshot) {
  snapshots.delete(sessionId);
  snapshots.set(sessionId, { ...snapshot, at: Date.now() });
  while (snapshots.size > MAX_SESSIONS) {
    const oldest = snapshots.keys().next().value;
    snapshots.delete(oldest);
  }
}

/**
 * Register the button into its (list) composer slot.
 * @param {any} ctx - client plugin context.
 * @returns {boolean} whether the registration was attempted successfully.
 */
export function registerOptimizeButton(ctx) {
  const slots = ctx?.slots;
  if (slots === null || slots === undefined || typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
    return false;
  }
  try {
    slots.inject(ACTIVITY_SLOT, () => slots.register({
      name: ACTIVITY_SLOT,
      id: 'dsh-nonead-prompt-recall-optimize',
      order: 20,
      inject: () => ({
        conversation: safeGet(ctx, 'conversation'),
        connection: safeGet(ctx, 'connection'),
        t: resolveTranslate(ctx),
      }),
    }, OptimizeButton));
    return true;
  } catch (error) {
    try {
      const message = error instanceof Error ? error.message : String(error);
      ctx?.logger?.warn?.(`[dsh-nonead-prompt-recall] optimize button registration failed: ${message}`);
    } catch {
      /* logging must never break the composer */
    }
    return false;
  }
}

/**
 * Bind the shared dictionary for this namespace, falling back to English when
 * the locale service is unavailable (headless/test contexts).
 * @param {any} ctx
 * @returns {(key: string, params?: object) => string}
 */
function resolveTranslate(ctx) {
  try {
    const locale = ctx?.locale;
    if (locale !== null && locale !== undefined && typeof locale.bind === 'function') return locale.bind('nonead-prompt-recall');
  } catch {
    /* fall through to the built-in dictionary */
  }
  return (key) => DICTS.en?.[key] ?? key;
}

function safeGet(ctx, key) {
  try {
    return ctx?.get?.(key);
  } catch {
    return undefined;
  }
}

function shellFor(conversation, sessionId) {
  try {
    return conversation?.input?.shell?.(sessionId) ?? null;
  } catch {
    return null;
  }
}

function writeDocument(shell, document) {
  try {
    shell.setDraft(document);
    return true;
  } catch {
    try {
      shell?.actions?.setDraft?.(document.text);
      return true;
    } catch {
      return false;
    }
  }
}

/** Transient toast anchored above the button (the slot owns its own feedback). */
let toastTimer = 0;

function showToastAt(element, text) {
  if (typeof document === 'undefined' || element === null || element === undefined) return;
  let node = document.getElementById('dsh-pr-opt-toast');
  if (node === null) {
    node = document.createElement('div');
    node.id = 'dsh-pr-opt-toast';
    node.className = 'dsh-pr-opt-toast';
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    document.body?.appendChild(node);
  }
  const rect = element.getBoundingClientRect?.();
  if (rect !== undefined && rect !== null) {
    node.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
    node.style.top = `${Math.round(rect.top - 8)}px`;
  }
  node.textContent = text;
  node.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.style.display = 'none';
    node.textContent = '';
  }, 2600);
}

/**
 * The button itself. Props come from the slot owner (session scope) plus the
 * injected services; `locked` mirrors the composer's disabled state.
 */
function OptimizeButton(props) {
  const React = require('react');
  // The style tag belongs to first render, not registration: apply() must stay
  // free of DOM writes while DSH is still settling the client roster.
  ensureOptimizeStyle();
  const conversation = props?.conversation;
  const connection = props?.connection;
  const sessionId = typeof props?.sessionId === 'string' ? props.sessionId : '';
  const locked = props?.locked === true;

  const t = typeof props?.t === 'function' ? props.t : (key) => DICTS.en?.[key] ?? key;

  const [enabled, setEnabled] = React.useState(null);
  const [mode, setMode] = React.useState('ready');
  const [draft, setDraft] = React.useState({ text: '', references: [], quotes: [], hasCommand: false });
  const buttonRef = React.useRef(null);
  const runRef = React.useRef(0);

  const shell = shellFor(conversation, sessionId);

  const readDraft = React.useCallback(() => {
    const current = shellFor(conversation, sessionId);
    const next = current === null ? { text: '', references: [], quotes: [], hasCommand: false } : draftFromShell(current);
    setDraft((previous) => (previous.text === next.text && previous.references.length === next.references.length
      ? previous
      : next));
    return next;
  }, [conversation, sessionId]);

  // Settings gate: hidden while unknown, hidden when the feature is off.
  React.useEffect(() => {
    let alive = true;
    const load = () => {
      try {
        const rpc = connection?.rpc;
        if (typeof rpc?.call !== 'function') {
          setEnabled(true);
          return;
        }
        void Promise.resolve(rpc.call(CHANNEL, 'settings.get', sessionId === '' ? {} : { sessionId }))
          .then((result) => {
            if (!alive) return;
            setEnabled(result?.value?.settings?.optimize?.enabled !== false);
          })
          .catch(() => {
            if (alive) setEnabled(true);
          });
      } catch {
        setEnabled(true);
      }
    };
    load();
    const onSettings = () => load();
    if (typeof window !== 'undefined') window.addEventListener(OPT_SETTINGS_EVENT, onSettings);
    return () => {
      alive = false;
      if (typeof window !== 'undefined') window.removeEventListener(OPT_SETTINGS_EVENT, onSettings);
    };
  }, [connection, sessionId]);

  // Keep the derived draft fresh: user typing, history recall and sends all
  // change the composer without notifying this component.
  React.useEffect(() => {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined;
    readDraft();
    const onInput = (event) => {
      const target = event?.target;
      if (target !== null && typeof target?.matches === 'function' && target.matches('[data-composer-input]')) readDraft();
    };
    document.addEventListener('input', onInput, true);
    const interval = setInterval(readDraft, 800);
    return () => {
      document.removeEventListener('input', onInput, true);
      clearInterval(interval);
    };
  }, [readDraft]);

  // A `done` snapshot survives only while the draft still holds the rewrite:
  // editing (or sending) drops the undo and returns the button to `ready`.
  React.useEffect(() => {
    if (mode !== 'done') return;
    const saved = snapshots.get(sessionId);
    if (saved === undefined) {
      setMode('ready');
      return;
    }
    if (draft.text === saved.after.text) return;
    snapshots.delete(sessionId);
    setMode('ready');
  }, [draft, mode, sessionId]);

  const snapshot = snapshots.get(sessionId);
  const blocker = draftBlocker(draft, { locked });
  const busy = mode === 'optimizing';
  const undoable = mode === 'done' && snapshot !== undefined;

  const label = busy ? t('optTooltipCancel')
    : undoable ? t('optTooltipUndo')
      : blocker === 'empty' ? t('optTooltipEmpty')
        : blocker === 'over-limit' ? t('optTooltipTooLong')
          : blocker === 'command' ? t('optTooltipCommand')
            : t('optTooltipReady');

  const disabled = enabled === false || (!busy && !undoable && (locked || blocker !== null));

  const cancel = () => {
    runRef.current += 1;
    setMode('ready');
  };

  const undo = () => {
    const shellNow = shellFor(conversation, sessionId);
    const saved = snapshots.get(sessionId);
    if (shellNow !== null && saved !== undefined) {
      writeDocument(shellNow, buildDraftDocument(saved.before.text, saved.before.references, saved.before.quotes));
      shellNow.focus?.();
    }
    snapshots.delete(sessionId);
    setMode('ready');
    readDraft();
  };

  const start = async () => {
    const shellNow = shellFor(conversation, sessionId);
    const rpc = connection?.rpc;
    if (shellNow === null || typeof rpc?.call !== 'function') {
      // Never fail silently: a click that does nothing reads as a broken button.
      showToastAt(buttonRef.current, t(TOAST_KEY.failed));
      return;
    }

    const current = draftFromShell(shellNow);
    if (draftBlocker(current, { locked }) !== null) return;
    const masked = maskDraft(current);
    if (masked.ok !== true) {
      showToastAt(buttonRef.current, t(TOAST_KEY.chipMismatch));
      return;
    }

    const before = { text: current.text, references: current.references, quotes: current.quotes };
    const token = runRef.current + 1;
    runRef.current = token;
    setMode('optimizing');

    let result;
    try {
      result = await rpc.call(CHANNEL, ENDPOINT_OPTIMIZE, {
        sessionId,
        text: masked.text,
        masked: masked.count > 0,
        chipCount: masked.count,
        maxChars: 8000,
      });
    } catch {
      if (token === runRef.current) {
        setMode('ready');
        showToastAt(buttonRef.current, t(TOAST_KEY.failed));
      }
      return;
    }
    if (token !== runRef.current) return; // cancelled or superseded

    const latest = shellFor(conversation, sessionId);
    const currentDraft = latest === null ? { text: '' } : draftFromShell(latest);
    const outcome = resolveOptimizeOutcome(result, { before, current: currentDraft, maskedCount: masked.count });

    if (outcome.action === 'silent') {
      setMode('ready');
      return;
    }
    if (outcome.action === 'toast') {
      setMode('ready');
      showToastAt(buttonRef.current, t(TOAST_KEY[outcome.key] ?? outcome.key));
      return;
    }
    if (latest === null || writeDocument(latest, buildDraftDocument(
      outcome.text,
      outcome.references,
      outcome.quotes,
    )) !== true) {
      setMode('ready');
      showToastAt(buttonRef.current, t(TOAST_KEY.failed));
      return;
    }
    latest.focus?.();
    rememberSnapshot(sessionId, { before, after: { text: outcome.text, references: outcome.references, quotes: outcome.quotes } });
    setMode('done');
    showToastAt(buttonRef.current, t('optDone'));
    readDraft();
  };

  const onClick = () => {
    if (busy) {
      cancel();
      return;
    }
    if (undoable) {
      undo();
      return;
    }
    void start();
  };

  if (enabled !== true) return null;

  const icon = busy
    ? React.createElement('svg', {
      className: 'dsh-pr-opt-svg dsh-pr-opt-spinner',
      viewBox: '0 0 16 16',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.6,
      strokeLinecap: 'round',
      'aria-hidden': 'true',
    },
    // Rotation comes from the stylesheet (viewBox-centred CSS animation).
    // Chromium ignores the pivot in an <animateTransform type="rotate"> and
    // orbits the arc about the origin, so no SMIL here.
    React.createElement('path', { d: SPINNER_PATH }))
    : undoable
      ? React.createElement('svg', {
        className: 'dsh-pr-opt-svg',
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.25,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
      }, ...UNDO_PATHS.map((d, index) => React.createElement('path', { key: index, d })))
      : React.createElement('svg', {
        className: 'dsh-pr-opt-svg',
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.25,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
      }, React.createElement('path', { d: SPARKLE_PATH }));

  return React.createElement('span', { className: 'dsh-pr-opt' },
    React.createElement('button', {
      ref: buttonRef,
      type: 'button',
      className: 'dsh-pr-opt-btn',
      'data-mode': busy ? 'optimizing' : undoable ? 'done' : 'ready',
      'aria-label': label,
      'aria-busy': busy ? 'true' : 'false',
      'aria-disabled': disabled ? 'true' : 'false',
      title: label,
      disabled,
      onClick,
    }, icon));
}
