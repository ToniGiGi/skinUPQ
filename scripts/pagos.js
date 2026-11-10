// Módulo "Pagos" rediseñado.
// La pestaña original (alumnos.php/pagos) trae inline "Pagos Realizados" y carga aparte con
// jQuery: pagos-en-proceso, documentos-en-proceso y controlpagos/pagosEnAdeudos.
// "Solicitar Servicio" / "Solicitar Documento" solo abren en una ventana el formulario oficial
// del SII (solicitar-referencia / solicitar-referencia-documentos) y al cerrarla recargan la
// lista. Aquí se hace lo mismo con una ventana propia: el formulario y el cobro no se tocan.
// eslint-disable-next-line no-unused-vars
const SK_PAGOS = (() => {
  const ICON = SK_ICON;
  const DEFAULTS = {
    proceso: '/alumnos.php/pagos-en-proceso',
    documentos: '/alumnos.php/documentos-en-proceso',
    adeudos: '/alumnos.php/controlpagos/pagosEnAdeudos',
    solicitar: '/alumnos.php/solicitar-referencia',
    solicitarDoc: '/alumnos.php/solicitar-referencia-documentos',
  };

  // ---------------------------------------------------------------- API
  function create({ href, load, onOriginal }) {
    const el = document.createElement('div');
    el.id = 'sk-pagos';
    el.className = 'sk-view';
    el.hidden = true;
    el._sk = { href, load, state: 'idle', urls: { ...DEFAULTS }, data: null, query: '' };
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-pg-original]')) onOriginal();
      if (e.target.closest('[data-pg-retry]')) { el._sk.state = 'idle'; open(el); }
      if (e.target.closest('[data-pg-login]')) window.top.location.reload();
      const req = e.target.closest('[data-pg-request]');
      if (req) openForm(el, req.dataset.pgRequest);
      if (e.target.closest('[data-pg-close]') || e.target.matches('.sk-pg-modal')) closeForm(el);
      const copy = e.target.closest('[data-copy]');
      if (copy) {
        navigator.clipboard?.writeText(copy.dataset.copy).then(() => {
          copy.innerHTML = ICON.check;
          copy.classList.add('is-done');
          setTimeout(() => { copy.innerHTML = ICON.clipboard; copy.classList.remove('is-done'); }, 1500);
        });
      }
    });
    el.addEventListener('input', (e) => {
      if (e.target.matches('[data-pg-search]')) { el._sk.query = e.target.value; filter(el); }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !el.hidden && el.querySelector('.sk-pg-modal')) closeForm(el);
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
      const doc = toDoc(html);
      // Direcciones reales tomadas del propio script de la página (por si cambian).
      const find = (re) => re.exec(html)?.[1];
      s.urls.proceso = find(/#pagos-container"\)\.load\("([^"]+)"/) || s.urls.proceso;
      s.urls.adeudos = find(/#adeudos-container"\)\.load\("([^"]+)"/) || s.urls.adeudos;
      s.urls.documentos = find(/#documentos-container"\)\.load\("([^"]+)"/) || s.urls.documentos;
      s.urls.solicitar = find(/src="(\/alumnos\.php\/solicitar-referencia)"/) || s.urls.solicitar;
      s.urls.solicitarDoc = find(/src="(\/alumnos\.php\/solicitar-referencia-documentos)"/) || s.urls.solicitarDoc;
      s.canRequest = /cmdReferencia"/.test(html);
      s.canRequestDoc = /cmdReferenciaDocumentos"/.test(html);

      const paidT = [...doc.querySelectorAll('table')].find((t) => /clave referencia/.test(norm(t.querySelector('thead')?.textContent)));
      const paid = paidT ? readTable(paidT) : { rows: [], total: NaN };
      const pending = await loadPending(s);
      s.data = { paid, pending };
      el.innerHTML = render(s);
      s.state = 'ready';
    } catch (err) {
      s.state = 'error';
      el.innerHTML = errorCard(err);
    }
  }

  async function loadPending(s) {
    const get = (u) => s.load(u).then((h) => readTable(toDoc(h).querySelector('table'))).catch((err) => {
      if (err?.session) throw err;
      return { rows: [], total: NaN, failed: true };
    });
    const [proceso, documentos, adeudos] = await Promise.all([get(s.urls.proceso), get(s.urls.documentos), get(s.urls.adeudos)]);
    return { proceso, documentos, adeudos };
  }

  // Al cerrar el formulario se recargan los pendientes (igual que hace el SII).
  async function refreshPending(el) {
    const s = el._sk;
    const box = el.querySelector('[data-pg-pending]');
    if (!box || !s.data) return;
    box.classList.add('is-busy');
    try {
      s.data.pending = await loadPending(s);
      box.outerHTML = renderPending(s);
      const tiles = el.querySelector('[data-pg-tiles]');
      if (tiles) tiles.outerHTML = renderTiles(s);
    } catch (err) {
      if (err?.session) el.innerHTML = errorCard(err);
      else box.classList.remove('is-busy');
    }
  }

  // ------------------------------------------------- Formulario oficial
  function openForm(el, kind) {
    const s = el._sk;
    closeForm(el, false);
    const doc = kind === 'documento';
    const modal = document.createElement('div');
    modal.className = 'sk-pg-modal';
    modal.innerHTML = `
      <div class="sk-pg-dialog" role="dialog" aria-modal="true" aria-label="${doc ? 'Solicitar documento' : 'Solicitar servicio'}">
        <header>
          <span class="sk-pg-dialog-ic">${doc ? ICON.file : ICON.card}</span>
          <div><strong>${doc ? 'Solicitar documento' : 'Solicitar servicio'}</strong>
            <small>Formulario oficial del SII para generar tu referencia bancaria</small></div>
          <button type="button" class="sk-pg-x" data-pg-close aria-label="Cerrar">${ICON.x}</button>
        </header>
        <iframe src="${esc(doc ? s.urls.solicitarDoc : s.urls.solicitar)}" title="Formulario del SII"></iframe>
      </div>`;
    modal.dataset.kind = kind;
    el.append(modal);
    modal.querySelector('.sk-pg-x').focus();
  }

  function closeForm(el, refresh = true) {
    const modal = el.querySelector('.sk-pg-modal');
    if (!modal) return;
    modal.remove();
    if (refresh) refreshPending(el);
  }

  // ------------------------------------------------------------- Lectura
  // Tabla genérica del SII -> filas con columnas identificadas por encabezado.
  function readTable(t) {
    if (!t) return { rows: [], total: NaN };
    const head = t.querySelector('thead');
    const hr = head ? [...head.rows].at(-1) : t.rows[0];
    const cols = [...hr.cells].map((c) => norm(c.textContent));
    const labels = [...hr.cells].map((c) => clean(c.textContent));
    const body = [...t.rows].filter((tr) => tr !== hr && !tr.closest('thead'));
    let total = NaN;
    const rows = [];
    body.forEach((tr) => {
      const cells = [...tr.cells];
      const text = norm(tr.textContent);
      if (/^total\b/.test(norm(cells.find((c) => clean(c.textContent))?.textContent)) || /\btotal:/.test(text)) {
        total = amount(cells.at(-1)?.textContent) || amount([...cells].reverse().find((c) => /\$/.test(c.textContent))?.textContent);
        return;
      }
      if (cells.length < cols.length - 1 || /no se encontraron/.test(text)) return;
      const cell = (re) => { const i = cols.findIndex((c) => re.test(c)); return i >= 0 ? cells[i] : null; };
      const txt = (re) => clean(cell(re)?.textContent);
      // Enlaces de la fila (p. ej. ficha de pago): solo los que llevan a una dirección real.
      const links = [...tr.querySelectorAll('a[href]')]
        .map((a) => ({ href: a.getAttribute('href'), text: clean(a.textContent || a.getAttribute('title')) }))
        .filter((a) => a.href && !/^(javascript:|#)/i.test(a.href));
      const hasScriptLinks = !!tr.querySelector('a[href^="javascript"], a[onclick], button, input[type="button"]');
      const known = [/^#$/, /fecha/, /concepto|motivo|descripcion|documento|servicio/, /monto|importe|total/, /estatus|estado/, /referencia/, /tipo pago/, /cie/, /recibo/, /vencimiento/];
      const extra = labels.map((l, i) => ({ label: l, value: clean(cells[i]?.textContent) }))
        .filter((x, i) => x.label && x.value && !known.some((re) => re.test(cols[i])));
      rows.push({
        fecha: txt(/^fecha( pago| emision)?$|^fecha$/) || txt(/fecha/),
        vence: txt(/vencimiento/),
        concepto: txt(/concepto|motivo|descripcion|documento|servicio/) || extra.shift()?.value || '',
        monto: amount(cell(/monto|importe|total/)?.textContent),
        estatus: txt(/estatus|estado/),
        referencia: txt(/referencia/),
        tipo: txt(/tipo pago/),
        cie: txt(/cie/),
        recibo: txt(/recibo/),
        extra, links, hasScriptLinks,
      });
    });
    return { rows, total };
  }

  // ------------------------------------------------------------- Dibujo
  function render(s) {
    return `
      <div class="sk-pg-wrap">
        <header class="sk-pg-head">
          <div>
            <h1>Pagos</h1>
            <p>Genera referencias, revisa lo que tienes pendiente y consulta tu historial de pagos.</p>
          </div>
          <div class="sk-pg-actions">
            ${s.canRequestDoc ? `<button type="button" class="sk-pg-btn" data-pg-request="documento">${ICON.file}Solicitar documento</button>` : ''}
            ${s.canRequest ? `<button type="button" class="sk-pg-btn is-primary" data-pg-request="servicio">${ICON.card}Solicitar servicio</button>` : ''}
          </div>
        </header>
        ${renderTiles(s)}
        ${renderPending(s)}
        ${renderHistory(s)}
        <p class="sk-pg-foot">
          Información tomada del SII. Los formularios para solicitar servicios y documentos son los oficiales del sistema.
          <button type="button" data-pg-original>Ver vista original</button>
        </p>
      </div>`;
  }

  function renderTiles(s) {
    const { paid, pending } = s.data;
    const rows = paid.rows;
    const total = Number.isNaN(paid.total) ? rows.reduce((a, r) => a + (r.monto || 0), 0) : paid.total;
    const last = [...rows].sort((a, b) => dateKey(b.fecha) - dateKey(a.fecha))[0];
    const pend = pending.proceso.rows.length + pending.documentos.rows.length;
    const owe = pending.adeudos.rows;
    const oweTotal = owe.reduce((a, r) => a + (r.monto || 0), 0);
    const tile = (label, value, sub, cls = '') => `<div class="sk-pg-tile ${cls}"><span>${label}</span><strong>${value}</strong><small>${sub}</small></div>`;
    return `
      <section class="sk-pg-tiles" data-pg-tiles>
        ${tile('Total pagado', money(total), `${rows.length} pago${rows.length === 1 ? '' : 's'} registrados`)}
        ${tile('Último pago', last ? money(last.monto) : '—', last ? esc(`${shortDate(last.fecha)} · ${short(concept(last.concepto, last.fecha).title)}`) : 'Sin pagos registrados')}
        ${tile('En proceso', String(pend), pend ? 'referencias por pagar' : 'Ninguna referencia pendiente', pend ? 'is-warn' : '')}
        ${owe.length
          ? tile('Adeudos', money(oweTotal), `${owe.length} adeudo${owe.length === 1 ? '' : 's'} registrado${owe.length === 1 ? '' : 's'}`, 'is-alert')
          : tile('Adeudos', `<span class="sk-pg-ok">${ICON.check}</span>Al corriente`, 'No tienes adeudos', 'is-good')}
      </section>`;
  }

  function renderPending(s) {
    const { proceso, documentos, adeudos } = s.data.pending;
    const failed = [proceso, documentos, adeudos].some((x) => x.failed);
    const group = (title, icon, list, kind) => (list.rows.length ? `
      <div class="sk-pg-pgroup">
        <h3>${icon}${title}<em>${list.rows.length}</em></h3>
        <ul class="sk-pg-plist">${list.rows.map((r) => pendingRow(r, kind)).join('')}</ul>
      </div>` : '');
    const body = group('Adeudos', ICON.alert, adeudos, 'owe') + group('Pagos en proceso', ICON.card, proceso, 'process')
      + group('Documentos en proceso', ICON.file, documentos, 'process');
    return `
      <section class="sk-pg-card sk-pg-pending" data-pg-pending>
        <header class="sk-pg-card-head">
          <h2>${ICON.clipboard}Pendientes</h2>
          <p>Referencias generadas que aún no se pagan y adeudos con la universidad.</p>
        </header>
        ${body || `
        <div class="sk-pg-clear">
          <span>${ICON.ok}</span>
          <div><strong>Estás al corriente</strong>
            <p>No tienes pagos en proceso, documentos por pagar ni adeudos.${failed ? ' (Algunas listas no se pudieron revisar.)' : ''}</p></div>
        </div>`}
      </section>`;
  }

  function pendingRow(r, kind) {
    const c = concept(r.concepto);
    const due = parseDate(r.vence);
    const days = due ? Math.ceil((due - startOfDay(new Date())) / 86400000) : null;
    const dueText = due == null ? '' : days < 0 ? `Venció el ${shortDate(r.vence)}` : days === 0 ? 'Vence hoy'
      : `Vence el ${shortDate(r.vence)} · en ${days} día${days === 1 ? '' : 's'}`;
    const meta = [r.fecha && `Emitida el ${shortDate(r.fecha)}`, ...r.extra.map((x) => `${sentence(x.label)}: ${x.value}`)].filter(Boolean);
    return `
      <li class="is-${kind}${days != null && days < 0 ? ' is-late' : days != null && days <= 3 ? ' is-soon' : ''}">
        <span class="sk-pg-ic">${ICON[c.icon]}</span>
        <div class="sk-pg-main">
          <strong>${esc(c.title)}</strong>
          <span>${esc(meta.join(' · '))}</span>
          ${dueText ? `<em class="sk-pg-due">${esc(dueText)}</em>` : ''}
        </div>
        <div class="sk-pg-side">
          ${r.monto != null ? `<b>${money(r.monto)}</b>` : ''}
          ${r.estatus ? `<span class="sk-pg-badge">${esc(sentence(r.estatus))}</span>` : ''}
          ${r.links.map((a) => `<a class="sk-pg-btn is-small" href="${esc(a.href)}" target="_blank" rel="noopener">${ICON.file}${esc(a.text || 'Abrir')}</a>`).join('')}
          ${r.hasScriptLinks && !r.links.length ? '<button type="button" class="sk-pg-btn is-small" data-pg-original>Ver opciones</button>' : ''}
        </div>
      </li>`;
  }

  function renderHistory(s) {
    const rows = [...s.data.paid.rows].sort((a, b) => dateKey(b.fecha) - dateKey(a.fecha));
    if (!rows.length) return '';
    // Pagado por año (barras desde cero, una sola serie)
    const years = new Map();
    rows.forEach((r) => { const y = dateYear(r.fecha); if (y) years.set(y, (years.get(y) || 0) + (r.monto || 0)); });
    const ys = [...years.entries()].sort((a, b) => a[0] - b[0]);
    const max = Math.max(...ys.map((y) => y[1]), 1);
    const groups = new Map();
    rows.forEach((r) => { const y = dateYear(r.fecha) || 'Sin fecha'; if (!groups.has(y)) groups.set(y, []); groups.get(y).push(r); });

    return `
      <section class="sk-pg-split">
        <div class="sk-pg-card sk-pg-history">
          <header class="sk-pg-card-head is-row">
            <div><h2>${ICON.calendarCheck}Historial de pagos</h2>
              <p>${rows.length} pagos realizados.</p></div>
            <label class="sk-pg-search">${ICON.search}
              <input type="search" data-pg-search placeholder="Buscar concepto o referencia…" autocomplete="off"></label>
          </header>
          ${[...groups.entries()].map(([y, list]) => `
            <div class="sk-pg-year" data-pg-year>
              <div class="sk-pg-year-head"><h3>${esc(String(y))}</h3><span>${money(list.reduce((a, r) => a + (r.monto || 0), 0))}</span></div>
              <ul class="sk-pg-hlist">${list.map(historyRow).join('')}</ul>
            </div>`).join('')}
          <p class="sk-pg-none" data-pg-none hidden>No hay pagos que coincidan con la búsqueda.</p>
        </div>
        <aside class="sk-pg-card sk-pg-years">
          <header class="sk-pg-card-head"><h2>${ICON.chart}Pagado por año</h2><p>Suma de los pagos de cada año.</p></header>
          <ul class="sk-pg-bars">
            ${ys.map(([y, v]) => `<li><span>${y}</span><div><i style="width:${((v / max) * 100).toFixed(1)}%"></i></div><b>${money(v)}</b></li>`).join('')}
          </ul>
          ${Number.isNaN(s.data.paid.total) ? '' : `<div class="sk-pg-total"><span>Total</span><b>${money(s.data.paid.total)}</b></div>`}
        </aside>
      </section>`;
  }

  function historyRow(r) {
    const c = concept(r.concepto, r.fecha);
    const q = norm([r.concepto, r.referencia, r.tipo, r.fecha, r.cie].join(' '));
    const valid = (v) => v && v !== '0';
    return `
      <li data-q="${esc(q)}">
        <details>
          <summary>
            <span class="sk-pg-ic">${ICON[c.icon]}</span>
            <div class="sk-pg-main">
              <strong>${esc(c.title)}</strong>
              <span>${esc([shortDate(r.fecha), payType(r.tipo)].filter(Boolean).join(' · '))}${c.tags.map((t) => `<em class="sk-pg-tag">${esc(t)}</em>`).join('')}</span>
            </div>
            <b class="sk-pg-amount">${r.monto != null ? money(r.monto) : '—'}</b>
            <span class="sk-pg-chev">${ICON.chevronDown}</span>
          </summary>
          <dl class="sk-pg-detail">
            <div><dt>Concepto completo</dt><dd>${esc(sentenceKeep(r.concepto))}</dd></div>
            ${r.referencia ? `<div><dt>Clave de referencia</dt><dd class="is-mono">${esc(r.referencia)}
              <button type="button" class="sk-pg-copy" data-copy="${esc(r.referencia)}" aria-label="Copiar referencia">${ICON.clipboard}</button></dd></div>` : ''}
            ${valid(r.cie) ? `<div><dt>Guía CIE</dt><dd class="is-mono">${esc(r.cie)}</dd></div>` : ''}
            ${valid(r.recibo) ? `<div><dt>No. de recibo</dt><dd class="is-mono">${esc(r.recibo)}</dd></div>` : ''}
            ${r.tipo ? `<div><dt>Forma de pago</dt><dd>${esc(sentence(r.tipo))}</dd></div>` : ''}
          </dl>
        </details>
      </li>`;
  }

  function filter(el) {
    const words = norm(el._sk.query).split(' ').filter(Boolean);
    let shown = 0;
    el.querySelectorAll('[data-pg-year]').forEach((y) => {
      let n = 0;
      y.querySelectorAll('[data-q]').forEach((li) => {
        const ok = words.every((w) => li.dataset.q.includes(w));
        li.hidden = !ok;
        if (ok) n++;
      });
      y.hidden = !n;
      shown += n;
    });
    const none = el.querySelector('[data-pg-none]');
    if (none) none.hidden = shown > 0;
  }

  function errorCard(err) {
    const session = err?.session;
    return `
      <div class="sk-pg-wrap"><div class="sk-pg-card sk-pg-error">
        ${session ? ICON.lock : ICON.alert}
        <div><strong>${session ? 'Tu sesión del SII expiró' : 'No se pudo preparar el módulo de pagos'}</strong>
        <p>${session ? 'Vuelve a iniciar sesión para ver tus pagos.' : 'Puedes intentarlo de nuevo o abrir la vista original del SII.'}</p></div>
        ${session ? '<button type="button" data-pg-login class="sk-pg-btn is-primary">Iniciar sesión</button>' : `
        <button type="button" class="sk-pg-btn" data-pg-retry>Reintentar</button>
        <button type="button" class="sk-pg-btn is-primary" data-pg-original>Ver vista original</button>`}
      </div></div>`;
  }

  function skeleton() {
    return `<div class="sk-pg-wrap">
      <div class="sk-pg-skel" style="height:60px"></div>
      <section class="sk-pg-tiles">${'<div class="sk-pg-skel" style="height:108px"></div>'.repeat(4)}</section>
      <div class="sk-pg-skel" style="height:140px"></div>
      <div class="sk-pg-skel" style="height:360px"></div>
    </div>`;
  }

  // ----------------------------------------------------------- Conceptos
  // "REINSCRIPCION 4 PAGOS MENSUALES LICENCIATURA SEPTIEMBRE-DICIEMBRE 2025 - PAGO 2 DE 4"
  //   -> título "Reinscripción Sep – Dic 2025", etiquetas ["Pago 2 de 4"]
  function concept(raw, fecha) {
    const n = norm(raw);
    const tags = [];
    const part = /pago (\d+) de (\d+)/.exec(n);
    if (part) tags.push(`Pago ${part[1]} de ${part[2]}`);
    const beca = /beca del (\d+)\s*%/.exec(n);
    if (beca) tags.push(`Beca ${beca[1]}%`);
    const per = /(enero|mayo|septiembre)\s*-\s*(abril|agosto|diciembre)(?:\s+(\d{4}))?/.exec(n);
    // Si el concepto no trae año, se toma el de la fecha de pago.
    const year = per?.[3] || dateYear(fecha) || '';
    const perText = per ? `${SHORT[per[1]]} – ${SHORT[per[2]]}${year ? ` ${year}` : ''}` : '';
    let icon = 'card';
    let title = '';
    if (/^reinscripcion/.test(n)) { icon = 'graduation'; title = `Reinscripción ${perText}`; }
    else if (/^inscripcion/.test(n)) { icon = 'graduation'; title = `Inscripción${/nuevo ingreso/.test(n) ? ' de nuevo ingreso' : ''} ${perText}`; }
    else if (/admision|seleccion/.test(n)) { icon = 'idCard'; title = 'Proceso de selección y admisión'; }
    else if (/movilidad|transporte/.test(n)) { icon = 'compass'; title = sentenceKeep(raw).replace(/^Cuota de recuperacion/i, 'Cuota de recuperación'); }
    else if (/kardex|constancia|certificado|historial|credencial|titulo|boleta|carta/.test(n)) { icon = 'file'; title = sentenceKeep(raw); }
    else title = sentenceKeep(raw);
    return { icon, title: clean(title) || 'Pago', tags };
  }
  const SHORT = { enero: 'Ene', abril: 'Abr', mayo: 'May', agosto: 'Ago', septiembre: 'Sep', diciembre: 'Dic' };
  function payType(t) {
    const n = norm(t);
    if (/sucursal|ventanilla|banco/.test(n)) return 'En sucursal';
    if (/tarjeta de credito/.test(n)) return 'Tarjeta de crédito';
    if (/tarjeta de debito/.test(n)) return 'Tarjeta de débito';
    if (/transferencia|spei/.test(n)) return 'Transferencia';
    return sentence(t);
  }

  // ----------------------------------------------------------- Utilidades
  function toDoc(html) { return new DOMParser().parseFromString(html, 'text/html'); }
  function amount(s) {
    const v = parseFloat(String(s || '').replace(/[^\d.-]/g, ''));
    return Number.isNaN(v) ? null : v;
  }
  function money(v) {
    if (v == null || Number.isNaN(v)) return '—';
    return v.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
  }
  function parseDate(s) {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s || '') || null;
    if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
    return iso ? new Date(+iso[1], +iso[2] - 1, +iso[3]) : null;
  }
  function dateKey(s) { return parseDate(s)?.getTime() || 0; }
  function dateYear(s) { return parseDate(s)?.getFullYear() || null; }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function shortDate(s) {
    const d = parseDate(s);
    return d ? d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', '') : clean(s);
  }
  function short(s) { return s.length > 34 ? `${s.slice(0, 32)}…` : s; }
  function clean(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
  function norm(s) { return clean(s).toLowerCase().normalize('NFD').replace(/\p{M}/gu, ''); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  const ACCENTS = { reinscripcion: 'reinscripción', inscripcion: 'inscripción', seleccion: 'selección', admision: 'admisión',
    recuperacion: 'recuperación', reposicion: 'reposición', credito: 'crédito', debito: 'débito', informacion: 'información' };
  function sentence(s) {
    const t = clean(s).toLowerCase().split(' ').map((w) => ACCENTS[w] || w).join(' ');
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  // Como sentence() pero conserva mayúsculas de meses y siglas cortas
  function sentenceKeep(s) {
    return sentence(s).replace(/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/g,
      (m) => m.charAt(0).toUpperCase() + m.slice(1));
  }

  return { create, open };
})();
