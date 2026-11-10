// Módulo "LE" (Lenguas Extranjeras / CAAL) rediseñado.
// Contenedor alumnos.php/reservaciones-alumno:
//   - Reservations: lista caal/cargarReservaciones; "Make a Reservation" abre reservar-alumno (iframe);
//     cancelar = POST cancelar_reservacion {cid} (deleteRow en el SII).
//   - CAAL Record (historial) con impresión por formulario POST.
//   - Materials: descargas descagar_material?did=N.
//   - Intensivos: solicitudes de cursos intensivos.
// eslint-disable-next-line no-unused-vars
const SK_LE = (() => {
  const ICON = SK_ICON;

  // ---------------------------------------------------------------- API
  function create({ href, load, level, onOriginal }) {
    const el = document.createElement('div');
    el.id = 'sk-le';
    el.className = 'sk-view';
    el.hidden = true;
    el._sk = { href, load, level: level || '', onOriginal, state: 'idle', data: null, urls: {} };
    el.addEventListener('click', (e) => onClick(el, e));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !el.hidden && el.querySelector('.sk-le-modal')) closeModal(el);
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
      s.urls.reservas = /#reservaciones-container"\s*\)\.load\('([^']+)'/.exec(html)?.[1] || '/alumnos.php/caal/cargarReservaciones';
      s.urls.reservar = /src="(\/alumnos\.php\/reservar-alumno[^"]*)"/.exec(html)?.[1] || '';
      doc.querySelectorAll('div[title][href]').forEach((d) => {
        const t = norm(d.getAttribute('title'));
        if (/caal|record/.test(t)) s.urls.historial = d.getAttribute('href');
        else if (/material/.test(t)) s.urls.materiales = d.getAttribute('href');
        else if (/intensivo/.test(t)) s.urls.intensivos = d.getAttribute('href');
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
    const get = async (u) => {
      if (!u) return { doc: null, ok: false };
      try { return { doc: new DOMParser().parseFromString(await s.load(u), 'text/html'), ok: true }; } catch (err) {
        if (err?.session) throw err;
        return { doc: null, ok: false };
      }
    };
    const [r, h, m, i] = await Promise.all([get(s.urls.reservas), get(s.urls.historial), get(s.urls.materiales), get(s.urls.intensivos)]);
    const hist = table(h);
    const printForm = h.doc?.querySelector('form[action*="imprime"]');
    const assist = /records of assistance:\s*<\/label>\s*(\d+)/i.exec(h.doc?.body.innerHTML || '')?.[1];
    return {
      reservas: table(r),
      historial: { ...hist, assist: assist != null ? +assist : null,
        print: printForm ? { action: printForm.getAttribute('action'), fields: [...printForm.querySelectorAll('input[name]')].map((x) => [x.name, x.value]) } : null },
      materiales: materials(m),
      intensivos: table(i),
    };
  }

  // Tabla genérica: filas como objetos {encabezado normalizado: texto} + acciones de la fila.
  function table({ doc, ok }) {
    const t = doc?.querySelector('table');
    if (!t) return { rows: [], ok };
    const cols = [...(t.querySelector('thead tr')?.cells || [])].map((c) => norm(c.textContent));
    const rows = [...t.rows].filter((tr) => !tr.closest('thead') && tr.cells.length >= cols.length - 1 && !/no (records|se encontraron)/i.test(tr.textContent))
      .map((tr) => {
        const o = {};
        cols.forEach((c, i) => { if (c) o[c] = clean(tr.cells[i]?.textContent); });
        o.cancel = /deleteRow\((\d+)\)/.exec(tr.innerHTML)?.[1] || '';
        return o;
      });
    return { rows, ok };
  }

  function materials({ doc, ok }) {
    const t = doc?.querySelector('table');
    if (!t) return { rows: [], ok };
    const rows = [...t.querySelectorAll('tr')].filter((tr) => !tr.closest('thead') && /downloadDoc\(\d+\)/.test(tr.innerHTML)).map((tr) => {
      const c = [...tr.cells].map((x) => clean(x.textContent));
      return { name: c[0], desc: c[1], type: c[2], date: c[3], id: /downloadDoc\((\d+)\)/.exec(tr.innerHTML)[1] };
    });
    return { rows, ok };
  }

  // ------------------------------------------------------------- Acciones
  function onClick(el, e) {
    const s = el._sk;
    const t = e.target;
    if (t.closest('[data-le-original]')) return s.onOriginal();
    if (t.closest('[data-le-retry]')) { s.state = 'idle'; return open(el); }
    if (t.closest('[data-le-login]')) return window.top.location.reload();
    if (t.closest('[data-le-book]')) return openFrame(el, s.urls.reservar, 'Hacer una reservación en el CAAL');
    if (t.closest('[data-le-print]')) return printRecord(s);
    const cancel = t.closest('[data-le-cancel]');
    if (cancel) return confirmCancel(el, cancel.dataset.leCancel, cancel.dataset.name || '');
    if (t.closest('[data-le-close]') || t.matches('.sk-le-modal')) return closeModal(el);
    const yes = t.closest('[data-le-yes]');
    if (yes) return runCancel(el, yes);
  }

  function printRecord(s) {
    const p = s.data?.historial.print;
    if (!p) return;
    const f = document.createElement('form');
    f.method = 'post'; f.action = p.action; f.target = '_blank'; f.hidden = true;
    p.fields.forEach(([n, v]) => { const i = document.createElement('input'); i.type = 'hidden'; i.name = n; i.value = v; f.append(i); });
    document.body.append(f);
    f.submit();
    f.remove();
  }

  function confirmCancel(el, id, name) {
    modal(el, `
      <div class="sk-le-confirm" role="alertdialog" aria-modal="true">
        <span class="sk-le-confirm-ic">${ICON.alert}</span>
        <strong>¿Cancelar esta reservación?</strong>
        ${name ? `<p>${esc(name)}</p>` : ''}
        <div class="sk-le-confirm-actions">
          <button type="button" class="sk-le-btn" data-le-close>Regresar</button>
          <button type="button" class="sk-le-btn is-primary" data-le-yes data-id="${esc(id)}">Sí, cancelar</button>
        </div>
      </div>`);
  }

  async function runCancel(el, btn) {
    btn.disabled = true;
    btn.textContent = 'Enviando…';
    let msg = 'Se canceló la reservación.';
    let good = true;
    try {
      const res = await fetch('/alumnos.php/cancelar_reservacion', {
        method: 'POST', credentials: 'same-origin', body: new URLSearchParams({ cid: btn.dataset.id }),
        headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      });
      if (res.status === 401) throw Object.assign(new Error('sesion'), { session: true });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (/id="frmLogin"/.test(text)) throw Object.assign(new Error('sesion'), { session: true });
      let r = {};
      try { r = JSON.parse(text); } catch { /* sin JSON */ }
      if (r.type && r.type !== 'OK') { good = false; msg = clean(r.message || r.msg || 'El SII no aceptó la cancelación.'); }
    } catch (err) {
      if (err?.session) { el.innerHTML = errorCard(err); return; }
      good = false;
      msg = 'No se pudo cancelar. Inténtalo de nuevo.';
    }
    closeModal(el, false);
    toast(el, msg, good);
    reload(el);
  }

  async function reload(el) {
    const s = el._sk;
    try { s.data = await loadAll(s); draw(el); } catch (err) { if (err?.session) el.innerHTML = errorCard(err); }
  }

  function openFrame(el, src, title) {
    if (!src) return;
    modal(el, `
      <div class="sk-le-dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <header>
          <span class="sk-le-dialog-ic">${ICON.calendar}</span>
          <div><strong>${esc(title)}</strong><small>Formulario oficial del SII</small></div>
          <button type="button" class="sk-le-x" data-le-close aria-label="Cerrar">${ICON.x}</button>
        </header>
        <iframe src="${esc(src)}" title="${esc(title)}"></iframe>
      </div>`, true);
  }

  function modal(el, inner, reloadOnClose = false) {
    closeModal(el, false);
    const m = document.createElement('div');
    m.className = 'sk-le-modal';
    if (reloadOnClose) m.dataset.reload = '1';
    m.innerHTML = inner;
    el.append(m);
    m.querySelector('button')?.focus();
  }

  function closeModal(el, allowReload = true) {
    const m = el.querySelector('.sk-le-modal');
    if (!m) return;
    const again = m.dataset.reload;
    m.remove();
    if (allowReload && again) reload(el);
  }

  function toast(el, msg, good) {
    el.querySelector('.sk-le-toast')?.remove();
    const t = document.createElement('div');
    t.className = `sk-le-toast${good ? '' : ' is-bad'}`;
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

  const pick = (o, re) => { const k = Object.keys(o).find((x) => re.test(x)); return k ? o[k] : ''; };

  function render(s) {
    const { reservas, historial, materiales, intensivos } = s.data;
    const tile = (label, value, sub, c) => `<div class="sk-le-tile" style="--c:${c}"><span>${label}</span><strong>${value}</strong><small>${sub}</small></div>`;
    return `
      <div class="sk-le-wrap">
        <section class="sk-le-hero">
          <div class="sk-le-hero-text">
            <span>LE · Lenguas Extranjeras</span>
            <h1>Practica inglés en el CAAL</h1>
            <p>El <b>CAAL</b> (Centro de Auto Acceso de Lenguas) es el espacio donde puedes reservar un lugar para practicar por tu cuenta,
              con materiales y equipo. Aquí también ves tu historial, materiales y cursos intensivos.</p>
            <div class="sk-le-hero-actions">
              ${s.urls.reservar ? `<button type="button" class="sk-le-btn is-light" data-le-book>${ICON.calendar}Hacer una reservación</button>` : ''}
              ${s.level ? `<span class="sk-le-level">${ICON.languages}Tu nivel de inglés: <b>${esc(/^d+$/.test(s.level.trim()) ? `Nivel ${s.level.trim()}` : sentence(s.level))}</b></span>` : ''}
            </div>
          </div>
          ${langSvg()}
        </section>

        <section class="sk-le-tiles">
          ${tile('Reservaciones activas', String(reservas.rows.length), reservas.rows.length ? 'pendientes en el CAAL' : 'Ninguna por ahora', '#2a78d6')}
          ${tile('Asistencias al CAAL', historial.assist != null ? String(historial.assist) : String(historial.rows.length), 'registradas en tu historial', '#1baf7a')}
          ${tile('Materiales', String(materiales.rows.length), 'disponibles para descargar', '#eda100')}
          ${tile('Cursos intensivos', String(intensivos.rows.length), intensivos.rows.length ? 'solicitudes registradas' : 'Sin solicitudes', '#6250d6')}
        </section>

        <div class="sk-le-cols">
          <section class="sk-le-card">
            <header class="sk-le-card-head"><h2>${ICON.calendarCheck}Mis reservaciones</h2>
              ${s.urls.reservar ? `<button type="button" class="sk-le-btn is-small is-primary" data-le-book>${ICON.calendar}Reservar</button>` : ''}</header>
            ${reservas.rows.length ? `<ul class="sk-le-res">${reservas.rows.map(resRow).join('')}</ul>`
              : empty(ICON.calendar, 'No tienes reservaciones', 'Reserva un lugar en el CAAL para practicar inglés en el horario que te acomode.', reservas.ok)}
          </section>

          <section class="sk-le-card">
            <header class="sk-le-card-head"><h2>${ICON.refresh}Historial del CAAL</h2>
              ${historial.print ? `<button type="button" class="sk-le-btn is-small" data-le-print>${ICON.printer}Imprimir</button>` : ''}</header>
            ${historial.rows.length ? `<ol class="sk-le-hist">${historial.rows.map(histRow).join('')}</ol>`
              : empty(ICON.languages, 'Sin visitas registradas', 'Cada vez que asistas a una reservación, quedará registrada aquí.', historial.ok)}
          </section>
        </div>

        <section class="sk-le-section">
          <h2>${ICON.book}Materiales de práctica</h2>
          ${materiales.rows.length ? `<div class="sk-le-docs">${materiales.rows.map(docCard).join('')}</div>`
            : `<div class="sk-le-card">${empty(ICON.book, 'Sin materiales', 'Cuando el área de idiomas publique materiales, aparecerán aquí.', materiales.ok)}</div>`}
        </section>

        <section class="sk-le-card">
          <header class="sk-le-card-head"><h2>${ICON.graduation}Cursos intensivos</h2></header>
          ${intensivos.rows.length ? `<ul class="sk-le-int">${intensivos.rows.map(intRow).join('')}</ul>`
            : empty(ICON.graduation, 'Sin solicitudes de intensivos', 'Los intensivos son cursos cortos para avanzar un nivel de inglés. Si solicitas uno, aquí verás su estatus.', intensivos.ok)}
        </section>

        <p class="sk-le-foot">Información tomada del SII. Las reservaciones se hacen con el formulario oficial del sistema.
          <button type="button" data-le-original>Ver vista original</button></p>
      </div>`;
  }

  function empty(icon, title, text, ok) {
    return `<div class="sk-le-empty"><span>${icon}</span><strong>${ok === false ? 'No se pudo cargar esta lista' : title}</strong>
      <p>${ok === false ? 'Intenta de nuevo más tarde o abre la vista original.' : text}</p></div>`;
  }

  function resRow(r) {
    const date = pick(r, /^date|fecha/);
    const d = parseDate(date);
    const room = pick(r, /room|sala/);
    const time = [pick(r, /^start|inicio/), pick(r, /end|fin/)].filter(Boolean).join(' – ');
    const status = pick(r, /estatus|status/);
    const name = [room, date, time].filter(Boolean).join(' · ');
    return `
      <li>
        <div class="sk-le-date">${d ? `<small>${d.toLocaleDateString('es-MX', { month: 'short' }).replace('.', '')}</small><b>${d.getDate()}</b><small>${d.toLocaleDateString('es-MX', { weekday: 'short' }).replace('.', '')}</small>` : '<b>—</b>'}</div>
        <div class="sk-le-main">
          <strong>${esc(room || 'CAAL')}</strong>
          <span>${esc([time && `${time} h`, pick(r, /seat|lugar/) && `Lugar ${pick(r, /seat|lugar/)}`].filter(Boolean).join(' · '))}</span>
          ${pick(r, /sanction/) ? `<em class="sk-le-warn">${ICON.alert}Sanción: ${esc(pick(r, /sanction/))}</em>` : ''}
          ${pick(r, /comment/) ? `<p class="sk-le-note">${esc(pick(r, /comment/))}</p>` : ''}
          <div class="sk-le-actions">
            ${status ? `<span class="sk-le-badge">${esc(sentence(status))}</span>` : ''}
            ${r.cancel ? `<button type="button" class="sk-le-btn is-small is-ghost" data-le-cancel="${esc(r.cancel)}" data-name="${esc(name)}">${ICON.x}Cancelar</button>` : ''}
          </div>
        </div>
      </li>`;
  }

  function histRow(r) {
    const status = pick(r, /^status$|estatus/);
    const n = norm(status);
    const tone = /asist|attend|ok|complet/.test(n) ? 'good' : /falt|no |cancel|absent/.test(n) ? 'bad' : '';
    return `
      <li>
        <span class="sk-le-dot is-${tone || 'none'}"></span>
        <div class="sk-le-main">
          <strong>${esc(pick(r, /room/) || 'CAAL')} · ${esc(shortDate(pick(r, /date/)))}</strong>
          <span>${esc([[pick(r, /start/), pick(r, /end/)].filter(Boolean).join(' – '), pick(r, /seat/) && `Lugar ${pick(r, /seat/)}`, pick(r, /status comments/)].filter(Boolean).join(' · '))}</span>
        </div>
        ${status ? `<span class="sk-le-badge is-${tone}">${esc(sentence(status))}</span>` : ''}
      </li>`;
  }

  function docCard(d) {
    const title = d.name.replace(/\.pdf$/i, '');
    return `
      <a class="sk-le-doc" href="/alumnos.php/descagar_material?did=${esc(d.id)}" download>
        <span class="sk-le-sheet"><b>EN</b><i></i><i></i><i></i><em>PDF</em></span>
        <span class="sk-le-doc-text"><strong>${esc(title)}</strong><small>${esc(d.desc)}</small>
          <small class="sk-le-doc-date">Publicado el ${esc(shortDate(d.date))}</small></span>
        <span class="sk-le-doc-dl">${ICON.download}Descargar</span>
      </a>`;
  }

  function intRow(r) {
    return `
      <li>
        <div class="sk-le-main">
          <strong>${esc(sentence(pick(r, /nivel solicitado/)) ? `Nivel solicitado: ${sentence(pick(r, /nivel solicitado/))}` : 'Curso intensivo')}</strong>
          <span>${esc([pick(r, /periodo/), pick(r, /ciclo/), pick(r, /folio/) && `Folio ${pick(r, /folio/)}`].filter(Boolean).join(' · '))}</span>
          ${pick(r, /motivo/) ? `<p class="sk-le-note">${esc(pick(r, /motivo/))}</p>` : ''}
        </div>
        ${pick(r, /estatus/) ? `<span class="sk-le-badge">${esc(sentence(pick(r, /estatus/)))}</span>` : ''}
      </li>`;
  }

  // Ilustración de idiomas: globos de diálogo y audífonos (decorativa)
  function langSvg() {
    return `<svg class="sk-le-art" viewBox="0 0 260 180" aria-hidden="true">
      <circle cx="140" cy="92" r="70" fill="rgba(255,255,255,.07)"/>
      <path d="M22 26h96a12 12 0 0 1 12 12v30a12 12 0 0 1-12 12H60l-18 16V80H22a12 12 0 0 1-12-12V38a12 12 0 0 1 12-12z" fill="#fff"/>
      <text x="70" y="61" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="20" font-weight="800" fill="#1f3a5f">Hello!</text>
      <path d="M142 96h96a12 12 0 0 1 12 12v30a12 12 0 0 1-12 12h-20v16l-18-16h-58a12 12 0 0 1-12-12v-30a12 12 0 0 1 12-12z" fill="#eda100"/>
      <text x="190" y="131" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="20" font-weight="800" fill="#fff">¡Hola!</text>
      <g transform="translate(166 8)">
        <path d="M10 46V34a26 26 0 0 1 52 0v12" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/>
        <rect x="0" y="38" width="18" height="30" rx="8" fill="#2a78d6"/>
        <rect x="54" y="38" width="18" height="30" rx="8" fill="#2a78d6"/>
      </g>
      <g transform="translate(40 112)">
        <rect width="74" height="50" rx="10" fill="#1baf7a"/>
        <text x="37" y="33" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="18" font-weight="800" fill="#fff">ABC</text>
      </g>
    </svg>`;
  }

  function errorCard(err) {
    const session = err?.session;
    return `
      <div class="sk-le-wrap"><div class="sk-le-card sk-le-error">
        ${session ? ICON.lock : ICON.alert}
        <div><strong>${session ? 'Tu sesión del SII expiró' : 'No se pudo preparar el módulo de idiomas'}</strong>
        <p>${session ? 'Vuelve a iniciar sesión para ver tus reservaciones.' : 'Puedes intentarlo de nuevo o abrir la vista original del SII.'}</p></div>
        ${session ? '<button type="button" class="sk-le-btn is-primary" data-le-login>Iniciar sesión</button>' : `
        <button type="button" class="sk-le-btn" data-le-retry>Reintentar</button>
        <button type="button" class="sk-le-btn is-primary" data-le-original>Ver vista original</button>`}
      </div></div>`;
  }

  function skeleton() {
    return `<div class="sk-le-wrap"><div class="sk-le-skel" style="height:210px"></div>
      <section class="sk-le-tiles">${'<div class="sk-le-skel" style="height:100px"></div>'.repeat(4)}</section>
      <div class="sk-le-cols"><div class="sk-le-skel" style="height:220px"></div><div class="sk-le-skel" style="height:220px"></div></div></div>`;
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
    return d ? d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', '') : (s || '');
  }
  function clean(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
  function norm(s) { return clean(s).toLowerCase().normalize('NFD').replace(/\p{M}/gu, ''); }
  function sentence(s) { const t = clean(s).toLowerCase(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  return { create, open };
})();
