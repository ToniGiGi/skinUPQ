// Módulo "Becas" rediseñado.
// La pestaña original (alumnos.php/becas) es una tabla de "Seguimiento a solicitudes de becas".
// Se lee por encabezados y se presenta así: las becas autorizadas como tarjetas tipo
// reconocimiento; las no autorizadas o en proceso como tarjetas sencillas aparte.
// eslint-disable-next-line no-unused-vars
const SK_BECAS = (() => {
  const ICON = SK_ICON;
  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  // ---------------------------------------------------------------- API
  function create({ href, load, student, onOriginal }) {
    const el = document.createElement('div');
    el.id = 'sk-becas';
    el.className = 'sk-view';
    el.hidden = true;
    el._sk = { href, load, student: student || {}, state: 'idle' };
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-bc-original]')) onOriginal();
      if (e.target.closest('[data-bc-retry]')) { el._sk.state = 'idle'; open(el); }
      if (e.target.closest('[data-bc-login]')) window.top.location.reload();
    });
    return el;
  }

  async function open(el) {
    const s = el._sk;
    if (s.state !== 'idle') return;
    s.state = 'loading';
    el.innerHTML = skeleton();
    try {
      const doc = new DOMParser().parseFromString(await s.load(s.href), 'text/html');
      const data = parse(doc);
      if (!data) throw new Error('sin tabla');
      el.innerHTML = render(data, s.student);
      s.state = 'ready';
    } catch (err) {
      s.state = 'error';
      el.innerHTML = errorCard(err);
    }
  }

  // ------------------------------------------------------------- Lectura
  function parse(doc) {
    const t = [...doc.querySelectorAll('table')].find((x) => {
      const h = norm(x.querySelector('thead')?.textContent || x.rows[0]?.textContent);
      return /beca/.test(h) && /estado/.test(h);
    });
    if (!t) return null;
    const headRow = t.querySelector('thead') ? [...t.querySelector('thead').rows].at(-1) : t.rows[0];
    const cols = [...headRow.cells].map((c) => norm(c.textContent));
    const at = (re) => cols.findIndex((c) => re.test(c));
    const i = {
      folio: at(/folio/), periodo: at(/cuatrimestre|periodo/), tipo: at(/tipo/), pct: at(/porcentaje/),
      monto: at(/monto/), renov: at(/renovacion/), estado: at(/estado/), area: at(/area/),
    };
    const rows = [...t.rows].filter((tr) => tr !== headRow && !tr.closest('thead') && tr.cells.length >= cols.length - 1);
    const items = rows.map((tr) => {
      const v = (k) => (i[k] >= 0 ? clean(tr.cells[i[k]]?.textContent) : '');
      const estado = v('estado');
      const st = norm(estado);
      return {
        folio: v('folio'),
        periodo: v('periodo'),
        when: periodInfo(v('periodo')),
        tipo: v('tipo'),
        pct: parseFloat(v('pct')),
        monto: parseFloat(v('monto').replace(/[$,\s]/g, '')),
        renov: v('renov'),
        estado,
        state: /^no\b|rechaz|cancel/.test(st) ? 'denied' : /autoriz|aprob|otorg/.test(st) ? 'granted' : 'pending',
        area: v('area'),
      };
    }).filter((b) => b.tipo || b.folio);
    // Más reciente primero
    items.sort((a, b) => (b.when?.key || 0) - (a.when?.key || 0));
    return { items };
  }

  // "SEPTIEMBRE-DICIEMBRE 2026" -> { label: "Sep – Dic 2026", key, start, end }
  function periodInfo(s) {
    const m = /^([a-z]+)\s*-\s*([a-z]+)\s+(\d{4})$/.exec(norm(s));
    if (!m) return null;
    const a = MONTHS.indexOf(m[1]);
    const b = MONTHS.indexOf(m[2]);
    const y = +m[3];
    if (a < 0 || b < 0) return null;
    return {
      label: `${SHORT[a]} – ${SHORT[b]} ${y}`,
      long: `${cap(MONTHS[a])} – ${cap(MONTHS[b])} ${y}`,
      key: y * 100 + a,
      start: new Date(y, a, 1),
      end: new Date(y, b + 1, 0, 23, 59, 59),
    };
  }

  // ------------------------------------------------------------- Dibujo
  function render(d, student) {
    const granted = d.items.filter((b) => b.state === 'granted');
    const others = d.items.filter((b) => b.state !== 'granted');
    const now = new Date();
    const current = granted.find((b) => b.when && now >= b.when.start && now <= b.when.end);
    const saved = granted.reduce((a, b) => a + (Number.isNaN(b.monto) ? 0 : b.monto), 0);
    const name = titleCase(student.name || '');

    const tile = (label, value, sub = '') => `<div class="sk-bc-tile"><span>${label}</span><strong>${value}</strong>${sub ? `<small>${sub}</small>` : ''}</div>`;

    return `
      <div class="sk-bc-wrap">
        <header class="sk-bc-head">
          <div>
            <h1>Becas</h1>
            <p>Tus reconocimientos y el seguimiento de tus solicitudes de beca.</p>
          </div>
        </header>

        <section class="sk-bc-tiles">
          ${tile('Becas obtenidas', String(granted.length), `de ${d.items.length} solicitud${d.items.length === 1 ? '' : 'es'}`)}
          ${tile('Total de apoyo recibido', saved ? money(saved) : '—', saved ? 'suma de los montos autorizados' : '')}
          ${tile('Beca vigente', current ? `${num(current.pct)}<em> %</em>` : 'Ninguna',
            current ? esc(`${smartType(current.tipo)} · ${current.when.label}`) : 'en el cuatrimestre actual')}
        </section>

        ${granted.length ? `
        <section class="sk-bc-section">
          <h2>${ICON.award}Reconocimientos</h2>
          <div class="sk-bc-grid">${granted.map((b) => certificate(b, name, b === current)).join('')}</div>
        </section>` : `
        <section class="sk-bc-empty">${ICON.award}<div><strong>Aún no tienes becas autorizadas</strong>
          <p>Cuando se autorice una, aparecerá aquí como reconocimiento.</p></div></section>`}

        ${others.length ? `
        <section class="sk-bc-section">
          <h2>${ICON.file}Otras solicitudes</h2>
          <div class="sk-bc-list">${others.map(request).join('')}</div>
        </section>` : ''}

        <p class="sk-bc-foot">
          Información tomada del SII. Las tarjetas son solo una forma de visualizar tus becas; no son un documento oficial.
          <button type="button" data-bc-original>Ver vista original</button>
        </p>
      </div>`;
  }

  function certificate(b, name, isCurrent) {
    const kind = smartType(b.tipo);
    const pct = Number.isNaN(b.pct) ? null : b.pct;
    return `
      <article class="sk-bc-cert${isCurrent ? ' is-current' : ''}">
        <div class="sk-bc-frame">
          ${isCurrent ? '<span class="sk-bc-live">Vigente</span>' : ''}
          <div class="sk-bc-cert-body">
            <span class="sk-bc-eyebrow">Reconocimiento</span>
            <p class="sk-bc-lead">Se otorga a</p>
            <h3>${esc(name || 'Estudiante')}</h3>
            <p class="sk-bc-text">la beca de <b>${esc(kind)}</b>${pct != null ? `, con una exención del <b>${num(pct)}%</b> en su pago,` : ''}
              para el periodo <b>${esc(b.when?.long || titleCase(b.periodo))}</b>.</p>
          </div>
          <div class="sk-bc-medal" aria-hidden="true">
            <div class="sk-bc-rosette"><span>${pct != null ? `${num(pct)}<small>%</small>` : ICON.award}</span></div>
            <i class="sk-bc-tail is-l"></i><i class="sk-bc-tail is-r"></i>
          </div>
          <footer class="sk-bc-meta">
            <div><small>Folio</small><b>${esc(b.folio || '—')}</b></div>
            <div><small>Apoyo</small><b>${Number.isNaN(b.monto) ? '—' : money(b.monto)}</b></div>
            <div><small>Solicitud</small><b>${esc(sentence(b.renov) || '—')}</b></div>
            ${b.area ? `<div><small>Área</small><b>${esc(titleCase(b.area))}</b></div>` : ''}
          </footer>
        </div>
      </article>`;
  }

  function request(b) {
    const label = b.state === 'denied' ? 'No autorizada' : sentence(b.estado) || 'En proceso';
    return `
      <article class="sk-bc-req is-${b.state}">
        <div class="sk-bc-req-ic">${b.state === 'denied' ? ICON.x : ICON.refresh}</div>
        <div class="sk-bc-req-main">
          <strong>${esc(smartType(b.tipo))}</strong>
          <span>${esc([b.when?.label || titleCase(b.periodo), sentence(b.renov), b.folio && `Folio ${b.folio}`].filter(Boolean).join(' · '))}</span>
        </div>
        <span class="sk-bc-badge is-${b.state}">${esc(label)}</span>
      </article>`;
  }

  function errorCard(err) {
    const session = err?.session;
    return `
      <div class="sk-bc-wrap"><div class="sk-bc-error">
        ${session ? ICON.lock : ICON.alert}
        <div><strong>${session ? 'Tu sesión del SII expiró' : 'No se pudo preparar el módulo de becas'}</strong>
        <p>${session ? 'Vuelve a iniciar sesión para ver tus becas.' : 'Puedes intentarlo de nuevo o abrir la vista original del SII.'}</p></div>
        ${session ? '<button type="button" data-bc-login class="is-primary">Iniciar sesión</button>' : `
        <button type="button" data-bc-retry>Reintentar</button>
        <button type="button" data-bc-original class="is-primary">Ver vista original</button>`}
      </div></div>`;
  }

  function skeleton() {
    return `<div class="sk-bc-wrap">
      <div class="sk-bc-skel" style="height:60px"></div>
      <section class="sk-bc-tiles">${'<div class="sk-bc-skel" style="height:110px"></div>'.repeat(3)}</section>
      <div class="sk-bc-grid">${'<div class="sk-bc-skel" style="height:300px"></div>'.repeat(2)}</div>
    </div>`;
  }

  // ----------------------------------------------------------- Utilidades
  // "EXENCIÓN DE PAGO POR EXCELENCIA ACADÉMICA" -> "Excelencia académica"
  function smartType(t) {
    const s = clean(t).replace(/^exenci[oó]n de pago por\s+/i, '');
    return sentence(s) || 'Beca';
  }
  function money(v) { return v.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: v % 1 ? 2 : 0 }); }
  function num(v) { return Number.isInteger(v) ? String(v) : v.toFixed(1); }
  function clean(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
  function norm(s) { return clean(s).toLowerCase().normalize('NFD').replace(/\p{M}/gu, ''); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  // El SII escribe sin acentos algunos valores ("RENOVACION", "RESTITUCION")
  const ACCENTS = { renovacion: 'renovación', restitucion: 'restitución', revision: 'revisión', asignacion: 'asignación', academica: 'académica', exencion: 'exención' };
  function sentence(s) {
    const t = clean(s).toLowerCase().split(' ').map((w) => ACCENTS[w] || w).join(' ');
    return t ? cap(t) : '';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  const SMALL = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'en', 'el', 'a']);
  function titleCase(s) {
    return clean(s).toLowerCase().split(' ').map((w, i) => (i > 0 && SMALL.has(w) ? w : cap(w))).join(' ');
  }

  return { create, open };
})();
