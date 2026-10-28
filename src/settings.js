/**
 * Settings-page section for dsh-nonead-prompt-recall.
 *
 * Registers a row in the DSH settings dialog navigation (slot
 * `settings.section`) and renders a designed management page: capture status,
 * settings form, recent prompts, export / import / clear.
 *
 * Written without JSX so `scripts/build-client.mjs` can keep wrapping plain
 * source into the ModuleLoader bundle. `require` is the factory-provided
 * module resolver.
 */

import { CHANNEL, SETTINGS_SECTION } from './protocol.js';
import { DICTS } from './i18n.js';

const NS = 'nonead-prompt-recall';
const STYLE_ID = 'dsh-nonead-prompt-recall-settings';

const CSS = `
.dsh-pr-root{display:flex;flex-direction:column;gap:16px;max-width:760px;max-height:56vh;overflow-y:auto;padding:2px 6px 28px 2px;font-size:13px;line-height:1.55;color:var(--dsw-alias-label-primary)}
.dsh-pr-head{display:flex;flex-direction:column;gap:4px}
.dsh-pr-headrow{display:flex;align-items:center;justify-content:space-between;gap:12px}
.dsh-pr-title{display:flex;align-items:center;gap:8px;font-size:18px;font-weight:600;margin:0}
.dsh-pr-badge{font-size:11px;font-weight:500;padding:1px 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary)}
.dsh-pr-sub{margin:0;color:var(--dsw-alias-label-secondary)}
.dsh-pr-card{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:14px 16px}
.dsh-pr-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px}
.dsh-pr-k{font-size:12px;color:var(--dsw-alias-label-tertiary);margin-bottom:4px}
.dsh-pr-v{font-weight:600;display:flex;align-items:center;gap:6px;min-width:0}
.dsh-pr-v code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;font-weight:400;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-pr-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);flex:none}
.dsh-pr-dot.is-on{background:var(--dsw-alias-state-success-primary)}
.dsh-pr-pill{font-size:12px;padding:0 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.dsh-pr-section-title{display:flex;align-items:baseline;gap:10px;margin:2px 0 10px}
.dsh-pr-section-title b{font-size:14px;font-weight:600}
.dsh-pr-section-title span{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dsh-pr-row{display:flex;justify-content:space-between;align-items:center;gap:18px;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l2)}
.dsh-pr-row:first-of-type{border-top:0;padding-top:0}
.dsh-pr-rowtext{min-width:0}
.dsh-pr-label{font-weight:500}
.dsh-pr-hint{font-size:12px;color:var(--dsw-alias-label-tertiary);margin-top:2px}
.dsh-pr-input{width:104px;padding:6px 9px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;text-align:right}
.dsh-pr-switch{position:relative;width:42px;height:24px;border-radius:999px;border:0;background:var(--dsw-alias-state-idle-primary);cursor:pointer;flex:none;transition:background .18s ease}
.dsh-pr-switch.is-on{background:var(--dsw-alias-state-success-primary)}
.dsh-pr-knob{position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:var(--dsw-alias-switch-thumb);box-shadow:var(--dsw-shadow-lv1);transition:transform .18s ease}
.dsh-pr-switch.is-on .dsh-pr-knob{transform:translateX(18px)}
.dsh-pr-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px}
.dsh-pr-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:inherit;border-radius:8px;padding:6px 12px;font:inherit;font-size:12px;cursor:pointer}
.dsh-pr-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.dsh-pr-btn:disabled{opacity:.5;cursor:not-allowed}
.dsh-pr-btn-primary{border-color:transparent;background:var(--dsw-alias-button-info-fill);color:var(--dsw-alias-label-primary-foreground)}
.dsh-pr-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-info-hover)}
.dsh-pr-btn-danger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 35%,transparent)}
.dsh-pr-btn-danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}
.dsh-pr-note{font-size:12px;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:6px}
.dsh-pr-note.is-error{color:var(--dsw-alias-state-error-primary)}
.dsh-pr-note.is-ok{color:var(--dsw-alias-state-success-primary)}
.dsh-pr-list{margin-top:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden}
.dsh-pr-item{display:flex;gap:12px;padding:8px 12px;border-top:1px solid var(--dsw-alias-border-l2);align-items:baseline}
.dsh-pr-item:first-child{border-top:0}
.dsh-pr-time{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.dsh-pr-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-pr-empty{color:var(--dsw-alias-label-tertiary);padding:10px 2px}
.dsh-pr-preview{margin-top:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px;background:var(--dsw-alias-bg-layer-2)}
.dsh-pr-preview-title{font-weight:600;margin-bottom:4px}
.dsh-pr-callout{border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px;color:var(--dsw-alias-label-secondary);font-size:12px}
`;

// Visual polish layer (overrides the base rules above) plus the settings-nav
// icon: DSH gives external sections only a generic gear and exposes no icon
// field, so the row is marked by label and the gear is replaced with a CSS mask.
const POLISH_CSS = `
.dsh-pr-root{gap:18px;max-width:800px;padding:4px 10px 32px 2px;scrollbar-gutter:stable}
.dsh-pr-root::-webkit-scrollbar{width:8px}
.dsh-pr-root::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2);border-radius:8px}
.dsh-pr-head{gap:8px;padding-bottom:2px}
.dsh-pr-headrow{align-items:flex-start}
.dsh-pr-identity{display:flex;align-items:center;gap:12px;min-width:0}
.dsh-pr-logo{width:40px;height:40px;border-radius:13px;display:flex;align-items:center;justify-content:center;flex:none;color:var(--dsw-alias-link);background:linear-gradient(135deg,color-mix(in srgb,var(--dsw-alias-link) 16%,transparent),color-mix(in srgb,var(--dsw-alias-link) 5%,transparent));border:1px solid color-mix(in srgb,var(--dsw-alias-link) 18%,transparent)}
.dsh-pr-logo::before{content:'';width:21px;height:21px;background:currentColor;-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 12a9 9 0 1 0 3-6.7L3 8'/%3E%3Cpath d='M3 3v5h5'/%3E%3Cpath d='M12 7v5l3 2'/%3E%3C/svg%3E") center/contain no-repeat;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 12a9 9 0 1 0 3-6.7L3 8'/%3E%3Cpath d='M3 3v5h5'/%3E%3Cpath d='M12 7v5l3 2'/%3E%3C/svg%3E") center/contain no-repeat}
.dsh-pr-title{font-size:19px;font-weight:650;letter-spacing:-.01em}
.dsh-pr-badge{border-color:color-mix(in srgb,var(--dsw-alias-link) 22%,transparent);color:var(--dsw-alias-link);background:color-mix(in srgb,var(--dsw-alias-link) 8%,transparent)}
.dsh-pr-sub{font-size:12px;margin-top:3px}
.dsh-pr-card{border-radius:14px;padding:16px 18px;box-shadow:var(--dsw-shadow-lv1)}
.dsh-pr-grid{grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:18px}
.dsh-pr-stat{display:flex;flex-direction:column;gap:5px;min-width:0}
.dsh-pr-k{font-size:11px;letter-spacing:.04em;margin:0}
.dsh-pr-v{font-size:14px;font-weight:600;min-width:0}
.dsh-pr-section-title{margin:0 0 4px;align-items:center}
.dsh-pr-section-title b{font-size:14px}
.dsh-pr-section-title span{font-size:11px}
.dsh-pr-row{padding:12px 0;border-top:1px dashed var(--dsw-alias-border-l2)}
.dsh-pr-row:first-of-type{border-top:0;padding-top:0}
.dsh-pr-label{font-size:13px;font-weight:550}
.dsh-pr-field{display:flex;align-items:center;gap:8px;flex:none}
.dsh-pr-unit{font-size:12px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.dsh-pr-input{width:86px;padding:6px 10px;border-radius:9px;transition:border-color .15s,box-shadow .15s}
.dsh-pr-input:focus{outline:none;border-color:var(--dsw-alias-link);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-link) 18%,transparent)}
.dsh-pr-actions{gap:8px;padding-top:12px;margin-top:12px;border-top:1px dashed var(--dsw-alias-border-l2)}
.dsh-pr-btn{height:30px;padding:0 12px;border-radius:9px;font-weight:500;transition:background .15s,border-color .15s}
.dsh-pr-btn:focus-visible{outline:2px solid var(--dsw-alias-link);outline-offset:1px}
.dsh-pr-btn-primary{box-shadow:var(--dsw-shadow-lv1)}
.dsh-pr-list{border-radius:11px;background:var(--dsw-alias-bg-layer-1)}
.dsh-pr-item{padding:9px 12px}
.dsh-pr-item:hover{background:var(--dsw-alias-bg-layer-2)}
.dsh-pr-time{width:118px;font-size:11px;white-space:nowrap}
.dsh-pr-preview{border-left:3px solid var(--dsw-alias-link);border-radius:11px}
.dsh-pr-callout{border-radius:11px;background:var(--dsw-alias-bg-layer-2)}
.dsh-pr-kbd{display:inline-block;min-width:16px;padding:0 4px;margin:0 2px;border:1px solid var(--dsw-alias-border-l2);border-bottom-width:2px;border-radius:5px;background:var(--dsw-alias-bg-layer-2);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:16px;text-align:center;color:var(--dsw-alias-label-secondary)}
[data-dsh-prompt-recall-nav] svg{display:none}
[data-dsh-prompt-recall-nav]::before{content:'';flex:none;width:16px;height:16px;background:currentColor;-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 12a9 9 0 1 0 3-6.7L3 8'/%3E%3Cpath d='M3 3v5h5'/%3E%3Cpath d='M12 7v5l3 2'/%3E%3C/svg%3E") center/16px 16px no-repeat;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 12a9 9 0 1 0 3-6.7L3 8'/%3E%3Cpath d='M3 3v5h5'/%3E%3Cpath d='M12 7v5l3 2'/%3E%3C/svg%3E") center/16px 16px no-repeat}
`;

function fallbackT(key, params) {
  const template = DICTS.zh[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/gu, (match, name) => (name in params ? String(params[name]) : match));
}

function h(type, props, ...children) {
  return useReact().createElement(type, props, ...children);
}

let cachedReact;
function useReact() {
  if (cachedReact === undefined) cachedReact = require('react');
  return cachedReact;
}

function ensureStyle() {
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
  if (typeof document.createElement !== 'function' || typeof document.head?.appendChild !== 'function') return;
  if (document.getElementById(STYLE_ID) !== null) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `${CSS}\n${POLISH_CSS}`;
  document.head.appendChild(style);
}

const NAV_MARKER = 'data-dsh-prompt-recall-nav';

/**
 * DSH only renders a generic gear for external settings sections and exposes no
 * icon field, so mark our nav row by its localized label and let POLISH_CSS
 * swap the gear for a history glyph. The marker owns nothing shell-side.
 * @param {() => string} label - current localized section label.
 * @returns {() => void} disposer.
 */
function registerSettingsNavIcon(label) {
  if (typeof document === 'undefined' || typeof MutationObserver !== 'function') return () => {};
  let frame = null;
  let disposed = false;
  const sync = () => {
    frame = null;
    if (disposed) return;
    const current = typeof label === 'function' ? label().trim() : '';
    if (current === '') return;
    const buttons = document.querySelectorAll('[role="dialog"] nav button, [role="dialog"] button');
    for (const button of buttons) {
      if (button.textContent !== null && button.textContent.trim() === current) button.setAttribute(NAV_MARKER, '');
      else if (button.hasAttribute(NAV_MARKER)) button.removeAttribute(NAV_MARKER);
    }
  };
  const schedule = () => {
    if (disposed || frame !== null) return;
    frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(sync) : setTimeout(sync, 16);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  schedule();
  return () => {
    disposed = true;
    observer.disconnect();
    if (frame !== null) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      else clearTimeout(frame);
    }
    for (const node of document.querySelectorAll(`[${NAV_MARKER}]`)) node.removeAttribute(NAV_MARKER);
  };
}

function currentCwd(sessions) {
  try {
    const snapshot = sessions?.list?.getSnapshot?.();
    const byId = snapshot?.byId;
    if (byId === null || typeof byId !== 'object') return '';
    const ids = Array.isArray(snapshot.ids) && snapshot.ids.length > 0 ? snapshot.ids : Object.keys(byId);
    const main = ids
      .filter((id) => Number(byId[id]?.retainedBy?.mainView ?? 0) > 0)
      .sort((a, b) => (Number(byId[b]?.updatedAt) || 0) - (Number(byId[a]?.updatedAt) || 0));
    return main.length > 0 && typeof byId[main[0]]?.cwd === 'string' ? byId[main[0]].cwd : '';
  } catch {
    return '';
  }
}

function formatTime(at) {
  if (!(Number(at) > 0)) return '—';
  try {
    return new Date(Number(at)).toLocaleString();
  } catch {
    return '—';
  }
}

function shortPath(path) {
  const value = typeof path === 'string' ? path : '';
  if (value.length <= 58) return value;
  return `${value.slice(0, 26)}…${value.slice(-28)}`;
}

function SettingsSection(props) {
  const React = useReact();
  const t = typeof props.t === 'function' ? props.t : fallbackT;
  const { connection, sessions } = props;
  const [view, setView] = React.useState(null);
  const [form, setForm] = React.useState(null);
  const [busy, setBusy] = React.useState('');
  const [note, setNote] = React.useState(null);
  const [confirmClear, setConfirmClear] = React.useState(false);
  const [preview, setPreview] = React.useState(null);
  const fileInput = React.useRef(null);

  const cwd = React.useRef('');
  const call = React.useCallback(async (endpoint, payload) => {
    if (connection === null || connection === undefined || typeof connection.rpc?.call !== 'function') {
      throw new Error('connection unavailable');
    }
    const result = await connection.rpc.call(CHANNEL, endpoint, payload);
    if (result === null || typeof result !== 'object' || result.ok !== true) {
      throw new Error(result?.error?.message ?? 'rpc failed');
    }
    return result.value;
  }, [connection]);

  const load = React.useCallback(async () => {
    const workspace = currentCwd(sessions);
    cwd.current = workspace;
    try {
      const value = await call('settings.get', workspace === '' ? {} : { cwd: workspace });
      setView(value);
      setForm(value.settings);
    } catch (error) {
      setNote({ tone: 'error', text: t('failed', { message: error instanceof Error ? error.message : String(error) }) });
    }
  }, [call, sessions, t]);

  React.useEffect(() => {
    void load();
  }, []);

  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const run = async (key, action, success) => {
    setBusy(key);
    setNote(null);
    try {
      await action();
      if (success !== undefined) setNote({ tone: 'ok', text: success });
      await load();
    } catch (error) {
      setNote({ tone: 'error', text: t('failed', { message: error instanceof Error ? error.message : String(error) }) });
    } finally {
      setBusy('');
    }
  };

  const save = () => run('save', async () => {
    const value = await call('settings.set', {
      patch: {
        enabled: form.enabled === true,
        maxEntries: Number(form.maxEntries),
        retentionDays: Number(form.retentionDays),
      },
    });
    setView((current) => (current === null ? current : { ...current, settings: value.settings }));
    setForm(value.settings);
  }, t('saved'));

  // Same download primitive the host backup page uses: Blob + <a download>.
  const download = (filename, content) => {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 2_000);
  };

  const exportNow = () => run('export', async () => {
    const value = await call('history.export', { cwd: cwd.current });
    download(value.filename, value.content);
    setNote({ tone: 'ok', text: t('exported', { count: value.count, file: value.filename }) });
  });

  const chooseFile = () => {
    setNote(null);
    fileInput.current?.click?.();
  };

  const onFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setNote({ tone: 'error', text: t('importTooLarge') });
      return;
    }
    try {
      const parsed = JSON.parse(await file.text());
      const entries = Array.isArray(parsed?.entries) ? parsed.entries : Array.isArray(parsed) ? parsed : null;
      if (entries === null) throw new Error('bad format');
      setPreview({
        filename: file.name,
        entries,
        cwd: typeof parsed?.cwd === 'string' ? parsed.cwd : '',
        exportedAt: typeof parsed?.exportedAt === 'number' ? parsed.exportedAt : 0,
      });
      setNote(null);
    } catch {
      setPreview(null);
      setNote({ tone: 'error', text: t('importInvalid') });
    }
  };

  const importNow = () => run('import', async () => {
    if (preview === null) return;
    const value = await call('history.importPayload', { cwd: cwd.current, entries: preview.entries });
    setPreview(null);
    setNote({ tone: 'ok', text: t('imported', { added: value.added, skipped: value.skipped }) });
  });

  const clearNow = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    void run('clear', async () => {
      await call('history.clear', { cwd: cwd.current });
    }, t('cleared'));
  };

  if (view === null || form === null) {
    return h('div', { className: 'dsh-pr-root' }, h('div', { className: 'dsh-pr-empty' }, t('loading')));
  }

  const dirty = JSON.stringify({
    enabled: form.enabled,
    maxEntries: String(form.maxEntries),
    retentionDays: String(form.retentionDays),
  }) !== JSON.stringify({
    enabled: view.settings.enabled,
    maxEntries: String(view.settings.maxEntries),
    retentionDays: String(view.settings.retentionDays),
  });
  const maxValue = Number(form.maxEntries);
  const keepValue = Number(form.retentionDays);
  const valid = Number.isInteger(maxValue) && maxValue >= 1 && maxValue <= 5000
    && Number.isInteger(keepValue) && keepValue >= 0 && keepValue <= 3650;
  const workspace = cwd.current;
  const hasWorkspace = workspace !== '';
  const recent = Array.isArray(view.recent) ? view.recent : [];

  return h('div', { className: 'dsh-pr-root' },
    h('header', { className: 'dsh-pr-head' },
      h('div', { className: 'dsh-pr-headrow' },
        h('div', { className: 'dsh-pr-identity' },
          h('span', { className: 'dsh-pr-logo', 'aria-hidden': 'true' }),
          h('div', null,
            h('h2', { className: 'dsh-pr-title' }, t('title'), h('span', { className: 'dsh-pr-badge' }, `v${view.version}`)),
            h('p', { className: 'dsh-pr-sub' }, t('subtitle')))),
        h('button', { type: 'button', className: 'dsh-pr-btn', disabled: busy === 'refresh', onClick: () => run('refresh', async () => {}) }, t('refresh'))),
    ),
    h('section', { className: 'dsh-pr-card' },
      h('div', { className: 'dsh-pr-grid' },
        h('div', { className: 'dsh-pr-stat' },
          h('div', { className: 'dsh-pr-k' }, t('capture')),
          h('div', { className: 'dsh-pr-v' },
            h('span', { className: `dsh-pr-dot${view.settings.enabled ? ' is-on' : ''}` }),
            h('span', null, view.settings.enabled ? t('on') : t('off')))),
        h('div', { className: 'dsh-pr-stat' },
          h('div', { className: 'dsh-pr-k' }, t('entryCount')),
          h('div', { className: 'dsh-pr-v' }, hasWorkspace ? `${view.entries} ${t('entries')}` : '—')),
        h('div', { className: 'dsh-pr-stat' },
          h('div', { className: 'dsh-pr-k' }, t('workspace')),
          h('div', { className: 'dsh-pr-v' }, h('code', { title: workspace }, shortPath(workspace) || '—'))),
        h('div', { className: 'dsh-pr-stat' },
          h('div', { className: 'dsh-pr-k' }, t('storage')),
          h('div', { className: 'dsh-pr-v' }, h('code', { title: view.storage?.history ?? '' }, shortPath(view.storage?.history)))),
      ),
    ),
    h('section', { className: 'dsh-pr-card' },
      h('div', { className: 'dsh-pr-section-title' }, h('b', null, t('settingsTitle')), h('span', null, t('settingsHint'))),
      h('div', { className: 'dsh-pr-row' },
        h('div', { className: 'dsh-pr-rowtext' },
          h('div', { className: 'dsh-pr-label' }, t('enable')),
          h('div', { className: 'dsh-pr-hint' }, t('enableHint'))),
        h('button', {
          type: 'button',
          role: 'switch',
          'aria-checked': form.enabled === true,
          className: `dsh-pr-switch${form.enabled === true ? ' is-on' : ''}`,
          onClick: () => setField('enabled', form.enabled !== true),
        }, h('span', { className: 'dsh-pr-knob' }))),
      h('div', { className: 'dsh-pr-row' },
        h('div', { className: 'dsh-pr-rowtext' },
          h('div', { className: 'dsh-pr-label' }, t('max')),
          h('div', { className: 'dsh-pr-hint' }, t('maxHint'))),
        h('div', { className: 'dsh-pr-field' },
          h('input', {
            className: 'dsh-pr-input', type: 'number', min: 1, max: 5000, step: 1, 'aria-label': t('max'),
            value: form.maxEntries, onChange: (event) => setField('maxEntries', event.target.value),
          }),
          h('span', { className: 'dsh-pr-unit' }, t('entries')))),
      h('div', { className: 'dsh-pr-row' },
        h('div', { className: 'dsh-pr-rowtext' },
          h('div', { className: 'dsh-pr-label' }, t('keep')),
          h('div', { className: 'dsh-pr-hint' }, t('keepHint'))),
        h('div', { className: 'dsh-pr-field' },
          h('input', {
            className: 'dsh-pr-input', type: 'number', min: 0, max: 3650, step: 1, 'aria-label': t('keep'),
            value: form.retentionDays, onChange: (event) => setField('retentionDays', event.target.value),
          }),
          h('span', { className: 'dsh-pr-unit' }, t('days')))),
      h('div', { className: 'dsh-pr-actions' },
        h('button', { type: 'button', className: 'dsh-pr-btn dsh-pr-btn-primary', disabled: !dirty || !valid || busy === 'save', onClick: save }, busy === 'save' ? '…' : t('save')),
        h('span', { className: 'dsh-pr-note' + (valid ? '' : ' is-error') }, valid ? (dirty ? t('dirty') : t('saved')) : t('invalid'))),
    ),
    h('section', { className: 'dsh-pr-card' },
      h('div', { className: 'dsh-pr-section-title' }, h('b', null, t('historyTitle')), h('span', null, t('historyHint'))),
      hasWorkspace ? null : h('div', { className: 'dsh-pr-callout' }, t('noWorkspace')),
      h('input', {
        ref: fileInput,
        type: 'file',
        accept: 'application/json,.json',
        style: { display: 'none' },
        onChange: onFile,
      }),
      h('div', { className: 'dsh-pr-actions' },
        h('button', { type: 'button', className: 'dsh-pr-btn', disabled: !hasWorkspace || busy === 'export', onClick: exportNow }, busy === 'export' ? '…' : t('export')),
        h('button', { type: 'button', className: 'dsh-pr-btn dsh-pr-btn-primary', disabled: !hasWorkspace, onClick: chooseFile }, t('import')),
        confirmClear
          ? h('span', { className: 'dsh-pr-actions', style: { marginTop: 0 } },
              h('button', { type: 'button', className: 'dsh-pr-btn dsh-pr-btn-danger', disabled: busy === 'clear', onClick: clearNow }, t('clearConfirm')),
              h('button', { type: 'button', className: 'dsh-pr-btn', onClick: () => setConfirmClear(false) }, t('cancel')))
          : h('button', { type: 'button', className: 'dsh-pr-btn dsh-pr-btn-danger', disabled: !hasWorkspace || busy === 'clear', onClick: clearNow }, t('clear')),
      ),
      preview === null ? null : h('div', { className: 'dsh-pr-preview' },
        h('div', { className: 'dsh-pr-preview-title' }, t('previewTitle')),
        h('div', { className: 'dsh-pr-hint' }, t('previewMeta', {
          file: preview.filename,
          count: preview.entries.length,
          cwd: preview.cwd === '' ? '—' : preview.cwd,
        })),
        h('div', { className: 'dsh-pr-list' }, ...preview.entries.slice(0, 5).map((entry, index) => h('div', { className: 'dsh-pr-item', key: `${index}-${entry?.at}` },
          h('span', { className: 'dsh-pr-time' }, formatTime(entry?.at)),
          h('span', { className: 'dsh-pr-text', title: String(entry?.text ?? '') }, String(entry?.text ?? '')),
        ))),
        h('div', { className: 'dsh-pr-actions' },
          h('button', { type: 'button', className: 'dsh-pr-btn dsh-pr-btn-primary', disabled: busy === 'import', onClick: importNow }, busy === 'import' ? '…' : t('confirmImport')),
          h('button', { type: 'button', className: 'dsh-pr-btn', onClick: () => setPreview(null) }, t('cancel')))),
      h('div', { className: 'dsh-pr-label' }, t('recent')),
      recent.length === 0
        ? h('div', { className: 'dsh-pr-empty' }, t('empty'))
        : h('div', { className: 'dsh-pr-list' }, ...recent.map((item, index) => h('div', { className: 'dsh-pr-item', key: `${index}-${item.at}` },
          h('span', { className: 'dsh-pr-time' }, formatTime(item.at)),
          h('span', { className: 'dsh-pr-text', title: item.text }, item.text),
        ))),
    ),
    note === null ? null : h('div', { className: `dsh-pr-note${note.tone === 'error' ? ' is-error' : ' is-ok'}`, role: 'status' }, note.text),
  );
}

/**
 * Register the settings section.
 * @param {any} ctx - client plugin context.
 * @returns {boolean} whether the section was registered.
 */
export function registerSettingsSection(ctx) {
  const slots = ctx?.slots;
  if (slots === null || slots === undefined || typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
    return false;
  }
  const locale = ctx.locale;
  if (locale !== null && locale !== undefined && typeof locale.register === 'function') {
    try {
      locale.register(NS, DICTS);
    } catch {
      /* dictionary already registered by an earlier load */
    }
  }
  const t = typeof locale?.bind === 'function' ? locale.bind(NS) : fallbackT;
  ensureStyle();
  try {
    const disposeIcon = registerSettingsNavIcon(() => t('nav'));
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => disposeIcon, 'dsh-nonead-prompt-recall settings nav icon');
    }
  } catch {
    /* the section still renders without the custom nav glyph */
  }
  try {
    slots.inject(SETTINGS_SECTION, () => slots.register({
      name: SETTINGS_SECTION,
      id: 'dsh-nonead-prompt-recall',
      order: 120,
      label: () => t('nav'),
      inject: () => ({
        t,
        connection: ctx.get('connection'),
        sessions: ctx.sessions,
      }),
    }, SettingsSection));
    return true;
  } catch (error) {
    try {
      const message = error instanceof Error ? error.message : String(error);
      ctx.logger?.warn?.(`[dsh-nonead-prompt-recall] settings section registration failed: ${message}`);
    } catch {
      /* logging must never break the keyboard bridge */
    }
    return false;
  }
}
