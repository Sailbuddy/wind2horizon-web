// floatingTools.js
// Minimal-invasives Floating Tool Dock + Slide-In Panel (DOM-only)
// i18n-clean: expects "texts" object injected from floatingTools.i18n.js
//
// CHANGE (Bora UX):
// - Bora Floating Icon opens the REAL Bora overlay (PanelHost via callback)
// - No Bora buttons inside this floating panel
// - No "Bora-Warner" intermediate UI anymore

const DEBUG_FLOATINGTOOLS = true; // <- bei Bedarf auf false setzen

function ensureStyles() {
  const id = 'w2h-floatingtools-styles';
  if (document.getElementById(id)) return;

  const css = `
  .w2h-floatdock{
    position:absolute; right:14px; bottom:135px;
    display:flex; flex-direction:column; gap:10px;
    z-index: 50;
    pointer-events:auto;
  }
  .w2h-fbtn{
    width:44px; height:44px; border-radius:14px;
    border:1px solid rgba(0,0,0,.12);
    background:rgba(255,255,255,.202);
    box-shadow:0 10px 24px rgba(0,0,0,.25);
    display:flex; align-items:center; justify-content:center;
    cursor:pointer;
    -webkit-tap-highlight-color: transparent;
    user-select:none;
  }
  .w2h-fbtn:active{transform:translateY(1px)}
  .w2h-fbtn[data-active="1"]{outline:2px solid rgba(59,130,246,.55)}

  .w2h-panel{
    position:absolute; top:12px; right:12px; bottom:12px;
    width:min(380px, 92vw);
    background:rgba(255,255,255,.96);
    border:1px solid rgba(0,0,0,.10);
    border-radius:18px;
    box-shadow:0 10px 30px rgba(0,0,0,.22);
    z-index: 60;
    transform:translateX(110%);
    transition:transform .18s ease;
    pointer-events:auto;
  }
  .w2h-panel[data-open="1"]{transform:translateX(0)}
  .w2h-panel-header{
    display:flex; align-items:center; justify-content:space-between;
    padding:12px 12px 8px 14px;
    border-bottom:1px solid rgba(0,0,0,.08)
  }
  .w2h-panel-title{font-weight:700;font-size:14px;letter-spacing:.2px}
  .w2h-x{
    width:34px; height:34px; border-radius:12px;
    border:1px solid rgba(0,0,0,.10);
    background:rgba(255,255,255,.95);
    cursor:pointer
  }
  .w2h-panel-body{padding:12px 14px;overflow:auto;max-height:calc(100% - 56px)}
  .w2h-tool-section{display:flex;flex-direction:column;gap:12px}
  .w2h-tool-text{margin:0;font-size:13px;line-height:1.35;opacity:.9}
  .w2h-tool-actions{display:flex;gap:10px;flex-wrap:wrap}
  .w2h-btn{
    display:inline-flex;align-items:center;justify-content:center;gap:8px;
    padding:10px 12px;border-radius:12px;
    border:1px solid rgba(0,0,0,.12);
    background:rgba(59,130,246,.10);
    cursor:pointer;text-decoration:none;color:inherit;font-size:13px
  }
  .w2h-btn-secondary{background:rgba(0,0,0,.04)}
  .w2h-tool-list{display:flex;flex-direction:column;gap:8px}
  .w2h-row{display:flex;gap:10px;align-items:flex-start;font-size:13px}
  `;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
}

function resolveEl(elOrSelector) {
  if (!elOrSelector) return null;
  if (typeof elOrSelector === 'string') return document.querySelector(elOrSelector);
  return elOrSelector;
}

/**
 * Builds default tools using injected i18n texts.
 * CHANGE:
 * - Bora is now a pure ACTION tool: click icon -> actions.onOpenBoraOverlay()
 * - no Bora panel render / no Bora buttons
 */
function buildDefaultTools({ texts }) {
  const tx = texts || {};
  const safe = (k, fallback) => (typeof tx[k] === 'string' && tx[k].trim() ? tx[k] : fallback);

  return [
    {
      id: 'bora',
      icon: '🌬️',
      kind: 'action',
      label: safe('bora', 'Bora'),
      title: safe('boraTitle', 'Wind2Horizon'),
    },
    {
      id: 'seewetter',
      icon: '🌊',
      kind: 'action',
      label: safe('seaWeather', 'Sea'),
      title: safe('seaWeatherTitle', 'Wind2Horizon'),
      actionKey: 'openSeaWeather', // ✅ nur Kennung, kein actions-Aufruf hier
    },
  

    {
      id: 'notfall',
      icon: '🚨',
      kind: 'panel',
      label: safe('emergency', 'SOS'),
      title: safe('emergencyTitle', 'Wind2Horizon'),
      render: () => `
        <div class="w2h-tool-section">
          <p class="w2h-tool-text">${safe('emergencyHint', '')}</p>
          <div class="w2h-tool-list">
            <div class="w2h-row"><span>📞</span><span>${safe('coastRadio', '')}</span></div>
            <div class="w2h-row"><span>📡</span><span>${safe('vhf16', '')}</span></div>
            <div class="w2h-row"><span>🛰️</span><span>${safe('navtex', '')}</span></div>
          </div>
          <div class="w2h-tool-actions">
            <a class="w2h-btn"
               href="https://www.plovput.hr/en/radio-service/coast-radio-stations"
               target="_blank" rel="noreferrer">
              ${safe('openContacts', '')}
            </a>
            <a class="w2h-btn w2h-btn-secondary"
               href="https://www.plovput.hr/en/radio-service/navtex-system/navtex-messages?MessageType=Q"
               target="_blank" rel="noreferrer">
              ${safe('openNavtex', '')}
            </a>
          </div>
        </div>
      `,
    },
  ];
}

export function initFloatingTools(options = {}) {
  const {
    mapContainer = '#map',
    langCode = 'de',
    texts = null,
    tools = null,
    actions = {}, // callbacks: onOpenBoraOverlay, onAction(actionKey)
  } = options;

  ensureStyles();

  const host = resolveEl(mapContainer);
  if (!host) {
    console.warn('[w2h] floatingTools: mapContainer not found:', mapContainer);
    return { destroy() {}, open() {}, close() {} };
  }

  if (!texts) {
    console.warn('[w2h] floatingTools: "texts" missing. Provide translations from floatingTools.i18n.js');
  }

  // Ensure host is positioning context
  const computedPos = window.getComputedStyle(host).position;
  if (computedPos === 'static') host.style.position = 'relative';

  const resolvedTools =
    Array.isArray(tools) && tools.length ? tools : buildDefaultTools({ texts, langCode });

  if (DEBUG_FLOATINGTOOLS) {
    console.log('[w2h] floatingTools init', { langCode, hasTexts: !!texts, tools: resolvedTools.map(t => t.id) });
  }

  const dock = document.createElement('div');
  dock.className = 'w2h-floatdock';
  dock.setAttribute('data-w2h', 'floatdock');

  const panel = document.createElement('div');
  panel.className = 'w2h-panel';
  panel.setAttribute('data-open', '0');
  panel.setAttribute('data-w2h', 'toolpanel');

  panel.innerHTML = `
    <div class="w2h-panel-header">
      <div class="w2h-panel-title">Wind2Horizon</div>
      <button class="w2h-x" type="button" aria-label="Close">✕</button>
    </div>
    <div class="w2h-panel-body"></div>
  `;

  const body = panel.querySelector('.w2h-panel-body');
  const titleEl = panel.querySelector('.w2h-panel-title');
  const closeBtn = panel.querySelector('.w2h-x');

  let activeToolId = null;

  function setOpen(open) {
    panel.setAttribute('data-open', open ? '1' : '0');
    if (!open) {
      activeToolId = null;
      Array.from(dock.querySelectorAll('.w2h-fbtn')).forEach((b) => b.setAttribute('data-active', '0'));
    }
  }

  function bindPanelActions() {
    body.querySelectorAll('[data-action]').forEach((el) => {
      el.addEventListener('click', () => {
        const action = el.getAttribute('data-action');
        actions.onAction?.(action);
      });
    });
  }

  function openTool(tool) {
    activeToolId = tool.id;
    titleEl.textContent = tool.title || 'Wind2Horizon';
    body.innerHTML = typeof tool.render === 'function' ? tool.render({ langCode, texts }) : (tool.render || '');

    setOpen(true);

    Array.from(dock.querySelectorAll('.w2h-fbtn')).forEach((b) => {
      b.setAttribute('data-active', b.getAttribute('data-tool') === tool.id ? '1' : '0');
    });

    bindPanelActions();
  }

  // Build buttons
  resolvedTools.forEach((tool) => {
    const btn = document.createElement('div');
    btn.className = 'w2h-fbtn';
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.setAttribute('data-tool', tool.id);
    btn.setAttribute('data-active', '0');

    const label = tool.label || tool.id;
    btn.title = label;
    btn.setAttribute('aria-label', label);

    btn.textContent = tool.icon ?? '•';

    function handleActivate() {
      const isOpen = panel.getAttribute('data-open') === '1';

      if (DEBUG_FLOATINGTOOLS) {
        console.log('[w2h] floatingTools click', { toolId: tool.id, kind: tool.kind, isOpen, activeToolId });
      }

      // Bora => open real overlay via callback only
      if (tool.id === 'bora') {
        if (DEBUG_FLOATINGTOOLS) console.log('[w2h] BORA BUTTON CLICKED -> actions.onOpenBoraOverlay()');
        setOpen(false);
        actions.onOpenBoraOverlay?.();
        actions.onAction?.('bora-open-overlay');
        return;
      }

      // Seewetter => open real overlay via callback only
      if (tool.id === 'seewetter') {
        if (DEBUG_FLOATINGTOOLS) console.log('[w2h] SEEWETTER BUTTON CLICKED -> actions.openSeaWeather()');
        setOpen(false);
        actions.openSeaWeather?.();
        actions.onAction?.('seewetter-open-overlay');
        return;
      }


      // If same panel-tool active -> toggle close
      if (tool.kind === 'panel' && activeToolId === tool.id && isOpen) {
        setOpen(false);
        return;
      }

      // Normal tool kinds
      if (tool.kind === 'panel') openTool(tool);

      if (tool.kind === 'link' && tool.href) {
        window.open(tool.href, '_blank', 'noreferrer');
      }

      if (tool.kind === 'action' && typeof tool.onClick === 'function') {
        tool.onClick({ langCode, texts });
      }
    }

    btn.addEventListener('click', handleActivate);
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleActivate();
      }
    });

    dock.appendChild(btn);
  });

  // Close behavior
  const onWinKeyDown = (e) => {
    if (e.key === 'Escape') setOpen(false);
  };
  window.addEventListener('keydown', onWinKeyDown);

  closeBtn.addEventListener('click', () => setOpen(false));

  // Click outside closes (only within host)
  const onHostClick = (e) => {
    if (panel.getAttribute('data-open') !== '1') return;
    const target = e.target;
    if (panel.contains(target)) return;
    if (dock.contains(target)) return;
    setOpen(false);
  };
  host.addEventListener('click', onHostClick);

  host.appendChild(dock);
  host.appendChild(panel);

  return {
    destroy() {
      window.removeEventListener('keydown', onWinKeyDown);
      host.removeEventListener('click', onHostClick);
      dock.remove();
      panel.remove();
    },
    open(toolId) {
      const tool = resolvedTools.find((tl) => tl.id === toolId);
      if (!tool) return;

      // Bora should never open the floating panel
      if (tool.id === 'bora') {
        setOpen(false);
        actions.onOpenBoraOverlay?.();
        actions.onAction?.('bora-open-overlay');
        return;
      }

      openTool(tool);
    },
    close() {
      setOpen(false);
    },
  };
}
