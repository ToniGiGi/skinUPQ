// Módulo "Orientación Educativa" rediseñado.
// Contenedor alumnos.php/tutorias_proceso:
//   - Solicitudes: lista cargada de tutorias/tutoriasProceso + botón "Solicitar Atención"
//     (iframe solicitud-sesion-individual).
//   - Sesiones Programadas (tutorias_programadas) e Historial (historial-tutorias).
// Las acciones de cada fila usan lo mismo que el SII: cancelar solicitud / confirmar asistencia /
// cancelar sesión (POST con {cid}), comentar y motivo de cancelación (formularios oficiales en ventana).
// eslint-disable-next-line no-unused-vars
const SK_ORIENTACION = (() => {
  const ICON = SK_ICON;
  const POSTS = {
    deleteRow: { url: '/alumnos.php/cancelar_solicitud', q: '¿Cancelar esta solicitud de atención?', btn: 'Sí, cancelar solicitud', ok: 'Se canceló la solicitud.', tone: 'bad' },
    confirmarRow: { url: '/alumnos.php/confirmar_asistencia', q: '¿Confirmas tu asistencia a esta sesión?', btn: 'Sí, asistiré', ok: 'Se confirmó tu asistencia.', tone: 'good' },
    cancelarRow: { url: '/alumnos.php/cancelar_sesion', q: '¿Cancelar esta sesión programada?', btn: 'Sí, cancelar sesión', ok: 'Se canceló la sesión.', tone: 'bad' },
  };
  const FRAMES = {
    comentarRow: (id) => ({ src: `/alumnos.php/comentar_solicitud?pID=${id}`, title: 'Comentar la atención recibida', label: 'Comentar atención', icon: 'send' }),
    motivoCancelacionRow: (id) => ({ src: `/alumnos.php/cancelar-sesion-motivo?sid=${id}`, title: 'Motivo de la cancelación', label: 'Ver motivo', icon: 'info' }),
  };

  // ---------------------------------------------------------------- API
  function create({ href, load, onOriginal }) {
    const el = document.createElement('div');
    el.id = 'sk-orient';
    el.className = 'sk-view';
    el.hidden = true;
    el._sk = { href, load, onOriginal, state: 'idle', data: null, urls: {} };
    el.addEventListener('click', (e) => onClick(el, e));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !el.hidden && el.querySelector('.sk-or-modal')) closeModal(el);
    });
    return el;
  }

  async function open(el) {
    const s = el._sk;
    if (s.state !== 'idle') return;
    s.state = 'loading';
    el.innerHTML = skeleton();
    try {
      const html = await s.load(s.href);
      const doc = new DOMParser().parseFromString(html, 'text/html');
      s.urls.solicitudes = /#Tutorias-container"\s*\)\.load\('([^']+)'/.exec(html)?.[1] || '/alumnos.php/tutorias/tutoriasProceso';
      s.urls.solicitar = /src=\s*"(\/alumnos\.php\/solicitud-sesion-individual[^"]*)"/.exec(html)?.[1] || '';
      doc.querySelectorAll('div[title][href]').forEach((d) => {
        const t = norm(d.getAttribute('title'));
        if (/programad/.test(t)) s.urls.programadas = d.getAttribute('href');
        else if (/historial/.test(t)) s.urls.historial = d.getAttribute('href');
      });
      s.data = await loadAll(s);
      draw(el);
      s.state = 'ready';
    } catch (err) {
      s.state = 'error';
      el.innerHTML = errorCard(err);
    }
  }

  async function loadAll(s) {
    const [solicitudes, programadas, historial] = await Promise.all(
      [s.urls.solicitudes, s.urls.programadas, s.urls.historial].map((u) => loadTable(s, u)));
    return { solicitudes, programadas, historial };
  }

  async function loadTable(s, url) {
    if (!url) return { rows: [], ok: false };
    try {
      const t = new DOMParser().parseFromString(await s.load(url), 'text/html').querySelector('table');
      if (!t) return { rows: [], ok: true };
      const cols = [...(t.querySelector('thead tr')?.cells || [])].map((c) => norm(c.textContent));
      const at = (re) => cols.findIndex((c) => re.test(c));
      const i = {
        folio: at(/^folio/), evento: at(/evento|proceso/), modo: at(/modo/), estado: at(/^estado/),
        fecha: at(/fecha/), hora: at(/^hora/), atiende: at(/atender|atendio/), compromisos: at(/compromiso/),
        coe: at(/comentario oe/), cal: at(/comentario alumno/),
      };
      const rows = [...t.rows].filter((tr) => !tr.closest('thead') && tr.cells.length >= cols.length - 1 && !/no se encontraron/i.test(tr.textContent))
        .map((tr) => {
          const v = (k) => (i[k] >= 0 ? clean(tr.cells[i[k]]?.textContent) : '');
          // Acciones que el SII pone en la fila (onclick="deleteRow(123)", etc.)
          const actions = [...tr.querySelectorAll('[onclick], a[href^="javascript"]')]
            .map((n) => /(\w+)\((\d+)\)/.exec(n.getAttribute('onclick') || n.getAttribute('href') || ''))
            .filter((m) => m && (POSTS[m[1]] || FRAMES[m[1]]))
            .map((m) => ({ fn: m[1], id: m[2] }));
          const links = [...tr.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).filter((h) => h && !/^(javascript|#)/i.test(h));
          return { folio: v('folio'), evento: v('evento'), modo: v('modo'), estado: v('estado'), fecha: v('fecha'), hora: v('hora'),
            atiende: v('atiende'), compromisos: v('compromisos'), coe: v('coe'), cal: v('cal'), actions, links };
        });
      return { rows, ok: true };
    } catch (err) {
      if (err?.session) throw err;
      return { rows: [], ok: false };
    }
  }

  // ------------------------------------------------------------- Acciones
  function onClick(el, e) {
    const s = el._sk;
    const t = e.target;
    if (t.closest('[data-or-original]')) return s.onOriginal();
    if (t.closest('[data-or-retry]')) { s.state = 'idle'; return open(el); }
    if (t.closest('[data-or-login]')) return window.top.location.reload();
    if (t.closest('[data-or-request]')) {
      return openFrame(el, s.urls.solicitar, 'Solicitar atención', 'Formulario oficial de Orientación Educativa');
    }
    const act = t.closest('[data-or-act]');
    if (act) {
      const { fn, id } = act.dataset;
      if (FRAMES[fn]) { const f = FRAMES[fn](id); return openFrame(el, f.src, f.title, 'Página oficial del SII'); }
      if (POSTS[fn]) return confirm(el, fn, id, act.dataset.name || '');
    }
    if (t.closest('[data-or-close]') || t.matches('.sk-or-modal')) return closeModal(el);
    const yes = t.closest('[data-or-yes]');
    if (yes) return run(el, yes);
  }

  function confirm(el, fn, id, name) {
    const a = POSTS[fn];
    modal(el, `
      <div class="sk-or-confirm" role="alertdialog" aria-modal="true">
        <span class="sk-or-confirm-ic is-${a.tone}">${a.tone === 'good' ? ICON.calendarCheck : ICON.alert}</span>
        <strong>${esc(a.q)}</strong>
        ${name ? `<p>${esc(name)}</p>` : ''}
        <div class="sk-or-confirm-actions">
          <button type="button" class="sk-or-btn" data-or-close>Regresar</button>
          <button type="button" class="sk-or-btn is-primary" data-or-yes data-fn="${fn}" data-id="${esc(id)}">${esc(a.btn)}</button>
        </div>
      </div>`);
  }

  async function run(el, btn) {
    const a = POSTS[btn.dataset.fn];
    btn.disabled = true;
    btn.textContent = 'Enviando…';
    let msg = a.ok;
    let good = true;
    try {
      const text = await post(a.url, new URLSearchParams({ cid: btn.dataset.id }));
      let r = {};
      try { r = JSON.parse(text); } catch { /* sin JSON */ }
      if (r.type && r.type !== 'OK') { good = false; msg = clean(r.message || r.msg || 'El SII no aceptó la solicitud.'); }
      else if (r.message || r.msg) msg = clean(r.message || r.msg);
    } catch (err) {
      if (err?.session) { el.innerHTML = errorCard(err); return; }
      good = false;
      msg = 'No se pudo completar la solicitud. Inténtalo de nuevo.';
    }
    closeModal(el, false);
    toast(el, msg, good);
    reload(el);
  }

  async function post(url, body) {
    const res = await fetch(url, {
      method: 'POST', credentials: 'same-origin', body,
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    });
    if (res.status === 401) throw Object.assign(new Error('sesion'), { session: true });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const cs = /charset=([\w-]+)/i.exec(res.headers.get('content-type') || '')?.[1] || 'utf-8';
    const text = new TextDecoder(cs).decode(await res.arrayBuffer());
    if (/id="frmLogin"/.test(text)) throw Object.assign(new Error('sesion'), { session: true });
    return text;
  }

  async function reload(el) {
    const s = el._sk;
    try {
      s.data = await loadAll(s);
      draw(el);
    } catch (err) {
      if (err?.session) el.innerHTML = errorCard(err);
    }
  }

  function openFrame(el, src, title, sub) {
    if (!src) return;
    modal(el, `
      <div class="sk-or-dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <header>
          <span class="sk-or-dialog-ic">${ICON.compass}</span>
          <div><strong>${esc(title)}</strong><small>${esc(sub)}</small></div>
          <button type="button" class="sk-or-x" data-or-close aria-label="Cerrar">${ICON.x}</button>
        </header>
        <iframe src="${esc(src)}" title="${esc(title)}"></iframe>
      </div>`, true);
  }

  function modal(el, inner, reloadOnClose = false) {
    closeModal(el, false);
    const m = document.createElement('div');
    m.className = 'sk-or-modal';
    if (reloadOnClose) m.dataset.reload = '1';
    m.innerHTML = inner;
    el.append(m);
    m.querySelector('button')?.focus();
  }

  function closeModal(el, allowReload = true) {
    const m = el.querySelector('.sk-or-modal');
    if (!m) return;
    const again = m.dataset.reload;
    m.remove();
    // Igual que el SII al cerrar sus ventanas: volver a cargar las listas.
    if (allowReload && again) reload(el);
  }

  function toast(el, msg, good) {
    el.querySelector('.sk-or-toast')?.remove();
    const t = document.createElement('div');
    t.className = `sk-or-toast${good ? '' : ' is-bad'}`;
    t.setAttribute('role', 'status');
    t.innerHTML = `${good ? ICON.check : ICON.alert}<span>${esc(msg)}</span>`;
    el.append(t);
    setTimeout(() => t.remove(), 4200);
  }

  // ------------------------------------------------------------- Dibujo
  function draw(el) {
    const top = el.scrollTop;
    el.innerHTML = render(el._sk);
    el.scrollTop = top;
  }

  function render(s) {
    const { solicitudes, programadas, historial } = s.data;
    return `
      <div class="sk-or-wrap">
        <section class="sk-or-hero">
          <div class="sk-or-hero-text">
            <span>Orientación educativa</span>
            <h1>¿Necesitas hablar con alguien?</h1>
            <p>El área de Orientación Educativa te acompaña en temas académicos, personales o vocacionales. Solicita una sesión y te contactarán para programarla.</p>
            ${s.urls.solicitar ? `<button type="button" class="sk-or-btn is-light" data-or-request>${ICON.send}Solicitar atención</button>` : ''}
          </div>
          ${talkSvg()}
        </section>

        <section class="sk-or-steps" aria-label="Cómo funciona">
          ${[
            ['1', 'Solicita atención', 'Cuéntanos brevemente el motivo con el botón “Solicitar atención”.', '#2a78d6'],
            ['2', 'Se programa tu sesión', 'Orientación te asigna fecha, hora y quién te atenderá.', '#eda100'],
            ['3', 'Confirma y asiste', 'Confirma tu asistencia aquí; al terminar puedes comentar la atención.', '#1baf7a'],
          ].map(([n, t, d, c]) => `<div class="sk-or-step" style="--c:${c}"><b>${n}</b><div><strong>${t}</strong><span>${d}</span></div></div>`).join('')}
        </section>

        <div class="sk-or-cols">
          <section class="sk-or-card">
            <header class="sk-or-card-head"><h2>${ICON.calendar}Próximas sesiones<em>${programadas.rows.length}</em></h2></header>
            ${programadas.rows.length ? `<ul class="sk-or-sessions">${programadas.rows.map(sessionRow).join('')}</ul>`
              : empty(ICON.calendarCheck, 'Sin sesiones programadas', 'Cuando Orientación programe tu sesión, aparecerá aquí con fecha, hora y quién te atenderá.', programadas.ok)}
          </section>

          <section class="sk-or-card">
            <header class="sk-or-card-head"><h2>${ICON.clipboard}Mis solicitudes<em>${solicitudes.rows.length}</em></h2></header>
            ${solicitudes.rows.length ? `<ul class="sk-or-requests">${solicitudes.rows.map(requestRow).join('')}</ul>`
              : empty(ICON.send, 'No tienes solicitudes', 'Si necesitas apoyo, usa “Solicitar atención”. Tus solicitudes y su estado se verán aquí.', solicitudes.ok)}
          </section>
        </div>

        <section class="sk-or-card">
          <header class="sk-or-card-head"><h2>${ICON.refresh}Historial de sesiones<em>${historial.rows.length}</em></h2></header>
          ${historial.rows.length ? `<ol class="sk-or-history">${historial.rows.map(historyRow).join('')}</ol>`
            : empty(ICON.compass, 'Aún no tienes sesiones', 'Las sesiones a las que asistas quedarán registradas aquí con sus compromisos.', historial.ok)}
        </section>

        <p class="sk-or-foot">Información tomada del SII. Las solicitudes y comentarios se hacen con los formularios oficiales del sistema.
          <button type="button" data-or-original>Ver vista original</button></p>
      </div>`;
  }

  function empty(icon, title, text, ok) {
    return `<div class="sk-or-empty"><span>${icon}</span><strong>${ok === false ? 'No se pudo cargar esta lista' : title}</strong>
      <p>${ok === false ? 'Intenta de nuevo más tarde o abre la vista original.' : text}</p></div>`;
  }

  function actionButtons(r) {
    const name = [r.evento, r.folio && `Folio ${r.folio}`].filter(Boolean).join(' · ');
    return r.actions.map((a) => {
      if (FRAMES[a.fn]) {
        const f = FRAMES[a.fn](a.id);
        return `<button type="button" class="sk-or-btn is-small" data-or-act data-fn="${a.fn}" data-id="${esc(a.id)}">${ICON[f.icon]}${f.label}</button>`;
      }
      const label = { deleteRow: 'Cancelar solicitud', confirmarRow: 'Confirmar asistencia', cancelarRow: 'Cancelar sesión' }[a.fn];
      const cls = a.fn === 'confirmarRow' ? 'is-primary' : 'is-ghost';
      return `<button type="button" class="sk-or-btn is-small ${cls}" data-or-act data-fn="${a.fn}" data-id="${esc(a.id)}" data-name="${esc(name)}">${a.fn === 'confirmarRow' ? ICON.check : ICON.x}${label}</button>`;
    }).join('') + r.links.map((h) => `<a class="sk-or-btn is-small" href="${esc(h)}" target="_blank" rel="noopener">${ICON.file}Abrir</a>`).join('');
  }

  function badge(estado) {
    const n = norm(estado);
    const tone = /cancel|rechaz|no asist/.test(n) ? 'bad' : /atendid|conclu|realizad|confirmad|asisti/.test(n) ? 'good' : /program/.test(n) ? 'info' : 'warn';
    return estado ? `<span class="sk-or-badge is-${tone}">${esc(sentence(estado))}</span>` : '';
  }

  function sessionRow(r) {
    const d = parseDate(r.fecha);
    return `
      <li>
        <div class="sk-or-date">${d ? `<small>${d.toLocaleDateString('es-MX', { month: 'short' }).replace('.', '')}</small><b>${d.getDate()}</b><small>${d.toLocaleDateString('es-MX', { weekday: 'short' }).replace('.', '')}</small>` : `<b>—</b>`}</div>
        <div class="sk-or-main">
          <strong>${esc(sentence(r.evento) || 'Sesión de orientación')}</strong>
          <span>${esc([r.hora && `${r.hora} h`, r.atiende && `Te atiende ${titleCase(r.atiende)}`, r.modo && sentence(r.modo)].filter(Boolean).join(' · '))}</span>
          <div class="sk-or-row-actions">${badge(r.estado)}${actionButtons(r)}</div>
        </div>
      </li>`;
  }

  function requestRow(r) {
    return `
      <li>
        <div class="sk-or-main">
          <div class="sk-or-row-top"><strong>${esc(sentence(r.evento) || 'Solicitud de atención')}</strong>${badge(r.estado)}</div>
          <span>${esc([r.folio && `Folio ${r.folio}`, r.fecha && `Solicitada el ${shortDate(r.fecha)}`, r.modo && sentence(r.modo)].filter(Boolean).join(' · '))}</span>
          ${r.coe ? `<p class="sk-or-comment is-oe"><b>Orientación:</b> ${esc(r.coe)}</p>` : ''}
          ${r.cal ? `<p class="sk-or-comment"><b>Tu comentario:</b> ${esc(r.cal)}</p>` : ''}
          ${r.actions.length || r.links.length ? `<div class="sk-or-row-actions">${actionButtons(r)}</div>` : ''}
        </div>
      </li>`;
  }

  function historyRow(r) {
    return `
      <li>
        <span class="sk-or-dot"></span>
        <div class="sk-or-main">
          <div class="sk-or-row-top"><strong>${esc(sentence(r.evento) || 'Sesión')}</strong>${badge(r.estado)}</div>
          <span>${esc([r.fecha && shortDate(r.fecha), r.hora && `${r.hora} h`, r.atiende && `Atendió ${titleCase(r.atiende)}`, r.folio && `Folio ${r.folio}`].filter(Boolean).join(' · '))}</span>
          ${r.compromisos ? `<p class="sk-or-comment"><b>Compromisos:</b> ${esc(r.compromisos)}</p>` : ''}
          ${r.actions.length ? `<div class="sk-or-row-actions">${actionButtons(r)}</div>` : ''}
        </div>
      </li>`;
  }

  // Ilustración: conversación con brújula (decorativa)
  function talkSvg() {
    return `<svg class="sk-or-art" viewBox="0 0 260 180" aria-hidden="true">
      <circle cx="196" cy="58" r="44" fill="rgba(255,255,255,.08)"/>
      <path d="M30 40h120a14 14 0 0 1 14 14v46a14 14 0 0 1-14 14H74l-22 20v-20H30a14 14 0 0 1-14-14V54a14 14 0 0 1 14-14z" fill="#fff"/>
      <rect x="36" y="60" width="96" height="7" rx="3.5" fill="#cbd5e1"/>
      <rect x="36" y="74" width="74" height="7" rx="3.5" fill="#e2e8f0"/>
      <rect x="36" y="88" width="84" height="7" rx="3.5" fill="#e2e8f0"/>
      <path d="M128 92h92a14 14 0 0 1 14 14v34a14 14 0 0 1-14 14h-14v18l-20-18h-58a14 14 0 0 1-14-14v-34a14 14 0 0 1 14-14z" fill="#2a78d6"/>
      <path d="M170 136s-16-9-16-19a8 8 0 0 1 16-2 8 8 0 0 1 16 2c0 10-16 19-16 19z" fill="#fff"/>
      <g transform="translate(196 58)">
        <circle r="30" fill="#eda100"/><circle r="24" fill="#fff"/>
        <path d="M0-18 6 0 0 18-6 0z" fill="#d94b55"/><path d="M0 0 6 0 0 18-6 0z" fill="#1f3a5f"/>
        <circle r="3" fill="#fff"/>
      </g>
    </svg>`;
  }

  function errorCard(err) {
    const session = err?.session;
    return `
      <div class="sk-or-wrap"><div class="sk-or-card sk-or-error">
        ${session ? ICON.lock : ICON.alert}
        <div><strong>${session ? 'Tu sesión del SII expiró' : 'No se pudo preparar Orientación Educativa'}</strong>
        <p>${session ? 'Vuelve a iniciar sesión para ver tus solicitudes.' : 'Puedes intentarlo de nuevo o abrir la vista original del SII.'}</p></div>
        ${session ? '<button type="button" class="sk-or-btn is-primary" data-or-login>Iniciar sesión</button>' : `
        <button type="button" class="sk-or-btn" data-or-retry>Reintentar</button>
        <button type="button" class="sk-or-btn is-primary" data-or-original>Ver vista original</button>`}
      </div></div>`;
  }

  function skeleton() {
    return `<div class="sk-or-wrap"><div class="sk-or-skel" style="height:200px"></div>
      <div class="sk-or-skel" style="height:86px"></div>
      <div class="sk-or-cols"><div class="sk-or-skel" style="height:220px"></div><div class="sk-or-skel" style="height:220px"></div></div></div>`;
  }

  // ----------------------------------------------------------- Utilidades
  function parseDate(s) {
    const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s || '');
    if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
    const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
    return iso ? new Date(+iso[1], +iso[2] - 1, +iso[3]) : null;
  }
  function shortDate(s) {
    const d = parseDate(s);
    return d ? d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', '') : s;
  }
  function clean(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
  function norm(s) { return clean(s).toLowerCase().normalize('NFD').replace(/\p{M}/gu, ''); }
  function sentence(s) { const t = clean(s).toLowerCase(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; }
  const SMALL = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e']);
  function titleCase(s) {
    return clean(s).toLowerCase().split(' ').map((w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  return { create, open };
})();
