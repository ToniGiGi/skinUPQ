// Módulo "Bolsa de Trabajo" rediseñado.
// Contenedor alumnos.php/vacantes:
//   - Curriculum UPQ (curriculum-nuevo): datos del CV + botones que abren páginas oficiales
//     (actualizar / ver / subir) o envían el formulario de impresión.
//   - Ofertas de Empleo: datagrid que pide las vacantes por POST a /alumnos.php/vacantes y
//     sub-pestañas vacantes-de-interes, vacantes-postulaciones, historico-postulaciones.
// Las acciones que cambian algo (me interesa, no me interesa, quitar postulación) mandan
// exactamente la misma petición que el SII, siempre con confirmación. Postularme y el detalle
// abren los formularios oficiales del SII en una ventana.
// eslint-disable-next-line no-unused-vars
const SK_BOLSA = (() => {
  const ICON = SK_ICON;
  const COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6'];
  const PAGE = 100;

  // ---------------------------------------------------------------- API
  function create({ href, load, student, onOriginal }) {
    const el = document.createElement('div');
    el.id = 'sk-bolsa';
    el.className = 'sk-view';
    el.hidden = true;
    el._sk = { href, load, student: student || {}, onOriginal, state: 'idle', tab: 'cv', sub: 'disponibles', query: '', data: null };
    el.addEventListener('click', (e) => onClick(el, e));
    el.addEventListener('input', (e) => {
      if (e.target.matches('[data-bt-search]')) { el._sk.query = e.target.value; renderOffers(el); }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !el.hidden && el.querySelector('.sk-bt-modal')) closeModal(el);
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
      const hrefs = {};
      doc.querySelectorAll('div[title][href]').forEach((d) => {
        const t = norm(d.getAttribute('title'));
        const h = d.getAttribute('href');
        if (/curriculum/.test(t)) hrefs.cv = h;
        else if (/interes/.test(t)) hrefs.interes = h;
        else if (/postulaciones/.test(t)) hrefs.postulaciones = h;
        else if (/historico/.test(t)) hrefs.historico = h;
      });
      const form = doc.querySelector('#frmvacantesFilter');
      s.vacantesUrl = doc.querySelector('#vacantes-grid')?.getAttribute('url') || '/alumnos.php/vacantes';
      s.filter = form ? [...form.querySelectorAll('input[name], select[name]')].map((i) => [i.name, i.value || (i.tagName === 'SELECT' ? '0' : '')]) : [];
      s.hrefs = hrefs;

      const cvHtml = hrefs.cv ? await s.load(hrefs.cv) : '';
      const [interes, postulaciones, historico, vacantes] = await Promise.all([
        loadList(s, hrefs.interes), loadList(s, hrefs.postulaciones), loadList(s, hrefs.historico), loadVacantes(s, 1),
      ]);
      s.data = { cv: parseCv(cvHtml), interes, postulaciones, historico, vacantes };
      el.innerHTML = render(s);
      select(el, s.tab);
      renderOffers(el);
      s.state = 'ready';
    } catch (err) {
      s.state = 'error';
      el.innerHTML = errorCard(err);
    }
  }

  // ------------------------------------------------------------- Lectura
  function parseCv(html) {
    if (!html) return null;
    const doc = toDoc(html);
    const info = {};
    doc.querySelectorAll('table.admintable th').forEach((th) => {
      const td = th.nextElementSibling;
      if (td?.tagName === 'TD') info[norm(th.textContent).replace(/:$/, '')] = clean(td.textContent);
    });
    const list = (id) => {
      const t = doc.getElementById(id);
      if (!t) return [];
      const cols = [...(t.querySelector('thead tr')?.cells || [])].map((c) => clean(c.textContent));
      return [...t.rows].filter((tr) => !tr.closest('thead') && tr.cells.length >= cols.length - 1 && !/no se encontraron/i.test(tr.textContent))
        .map((tr) => Object.fromEntries(cols.map((c, i) => [norm(c), clean(tr.cells[i]?.textContent)])));
    };
    // Acciones: direcciones tomadas del propio script de la página.
    const actions = {};
    const script = [...doc.querySelectorAll('script')].map((x) => x.textContent).join('\n') || html;
    const re = /\$\("#(\w+)"\)\.click\(function[\s\S]*?(?=\$\("#\w+"\)\.click|\$\("#modalWindow"\)\.window\(\{\s*width)/g;
    let m;
    while ((m = re.exec(script))) {
      const src = /src="([^"]+)"/.exec(m[0])?.[1];
      if (src) actions[m[1]] = src.replace(/'\s*\+\s*([^+']+?)\s*\+\s*'/g, (_, v) => v.trim());
    }
    const printForm = doc.querySelector('form[id*="Curriculum"]');
    const printId = /var id = (\d+)/.exec(script)?.[1] || '';
    const exists = (id) => !!doc.getElementById(id);
    return {
      info,
      formacion: list('CargarFormacion'),
      herramientas: list('CargarHerramientas'),
      experiencia: list('CargarExperiencia'),
      actions: {
        update: exists('cmdActualizarCurriculumNuevo') ? actions.cmdActualizarCurriculumNuevo : '',
        create: exists('cmdAgregarCurriculum') ? actions.cmdAgregarCurriculum : '',
        view: exists('cmdVerCurriculum') ? actions.cmdVerCurriculum : '',
        upload: exists('cmdSubirCurriculum') ? actions.cmdSubirCurriculum : '',
        print: printForm && printId ? { action: printForm.getAttribute('action'), vid: printId } : null,
      },
    };
  }

  // Tablas de interés / postulaciones / histórico
  async function loadList(s, href) {
    if (!href) return { rows: [], ok: false };
    try {
      const t = toDoc(await s.load(href)).querySelector('table');
      if (!t) return { rows: [], ok: true };
      const cols = [...t.querySelector('thead tr').cells].map((c) => norm(c.textContent));
      const at = (re) => cols.findIndex((c) => re.test(c));
      const i = { tipo: at(/tipo/), empresa: at(/empresa/), titulo: at(/titulo/), intro: at(/introduccion/), salario: at(/salario/),
        vigencia: at(/vigencia/), registro: at(/registro/), estatus: at(/estatus/), obs: at(/observ/) };
      const rows = [...t.rows].filter((tr) => !tr.closest('thead') && tr.cells.length >= cols.length - 1).map((tr) => {
        const v = (k) => (i[k] >= 0 ? clean(tr.cells[i[k]]?.textContent) : '');
        const detail = tr.querySelector('a[href*="vacante_detalle"]')?.getAttribute('href') || '';
        const vid = /vacante_detalle\/(\d+)/.exec(detail)?.[1] || /Row\((\d+)\)/.exec(tr.innerHTML)?.[1] || tr.id;
        return { vid, detail, tipo: v('tipo'), empresa: v('empresa'), titulo: v('titulo'), intro: v('intro'), salario: v('salario'),
          vigencia: v('vigencia'), registro: v('registro'), estatus: v('estatus'), obs: v('obs') };
      });
      return { rows, ok: true };
    } catch (err) {
      if (err?.session) throw err;
      return { rows: [], ok: false };
    }
  }

  // Vacantes disponibles: misma consulta que hace el datagrid del SII (POST con el filtro vacío).
  async function loadVacantes(s, page, prev) {
    try {
      const body = new URLSearchParams(s.filter);
      body.set('page', String(page));
      body.set('rows', String(PAGE));
      const text = await post(s.vacantesUrl, body);
      const json = JSON.parse(text);
      const rows = (json.rows || []).map((r) => ({
        vid: String(r.id), tipo: clean(r.tipo_oferta_desc), empresa: clean(r.denominacion), titulo: clean(r.titulo),
        intro: clean(r.introduccion), salario: clean(String(r.salario ?? '')), vigencia: clean(r.fecha_vigencia),
      }));
      return { rows: [...(prev?.rows || []), ...rows], total: +json.total || rows.length, page, ok: true };
    } catch (err) {
      if (err?.session) throw err;
      return { rows: prev?.rows || [], total: prev?.total || 0, page, ok: false };
    }
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

  // ------------------------------------------------------------- Acciones
  function onClick(el, e) {
    const s = el._sk;
    const t = e.target;
    if (t.closest('[data-bt-original]')) return s.onOriginal?.();
    if (t.closest('[data-bt-retry]')) { s.state = 'idle'; return open(el); }
    if (t.closest('[data-bt-login]')) return window.top.location.reload();
    const tab = t.closest('[data-bt-tab]');
    if (tab) return select(el, tab.dataset.btTab);
    const sub = t.closest('[data-bt-sub]');
    if (sub) { s.sub = sub.dataset.btSub; return renderOffers(el); }
    const frame = t.closest('[data-bt-frame]');
    if (frame) return openFrame(el, frame.dataset.btFrame, frame.dataset.btTitle || '', frame.dataset.btReload);
    if (t.closest('[data-bt-print]')) return printCv(s);
    if (t.closest('[data-bt-more]')) return more(el);
    const act = t.closest('[data-bt-act]');
    if (act) return confirmAction(el, act.dataset.btAct, act.dataset.vid, act.dataset.name || '');
    if (t.closest('[data-bt-close]') || t.matches('.sk-bt-modal')) return closeModal(el);
    const yes = t.closest('[data-bt-yes]');
    if (yes) return runAction(el, yes);
    const exp = t.closest('[data-bt-expand]');
    if (exp) exp.closest('.sk-bt-job').classList.toggle('is-open');
  }

  function printCv(s) {
    const p = s.data?.cv?.actions.print;
    if (!p) return;
    // Igual que el SII: formulario POST con el id del CV, en una pestaña nueva.
    const f = document.createElement('form');
    f.method = 'post'; f.action = p.action; f.target = '_blank'; f.hidden = true;
    const i = document.createElement('input');
    i.type = 'hidden'; i.name = 'vid'; i.value = p.vid;
    f.append(i);
    document.body.append(f);
    f.submit();
    f.remove();
  }

  async function more(el) {
    const s = el._sk;
    const btn = el.querySelector('[data-bt-more]');
    if (btn) { btn.disabled = true; btn.textContent = 'Cargando…'; }
    s.data.vacantes = await loadVacantes(s, s.data.vacantes.page + 1, s.data.vacantes);
    renderOffers(el);
  }

  const ACTIONS = {
    like: { url: '/alumnos.php/me-vacante-interes', q: '¿Agregar esta vacante a tus vacantes de interés?', ok: 'Se agregó a tus vacantes de interés.', btn: 'Sí, me interesa' },
    unlike: { url: '/alumnos.php/no-me-vacante-interes', q: '¿Quitar esta vacante de tus vacantes de interés?', ok: 'Se quitó de tus vacantes de interés.', btn: 'Sí, quitar' },
    unapply: { url: '/alumnos.php/quitar-postulacion', q: '¿Quitar tu postulación a esta vacante? La empresa ya no la verá.', ok: 'Se quitó tu postulación.', btn: 'Sí, quitar postulación' },
  };

  function confirmAction(el, kind, vid, name) {
    const a = ACTIONS[kind];
    if (!a) return;
    modal(el, `
      <div class="sk-bt-confirm" role="alertdialog" aria-modal="true">
        <span class="sk-bt-confirm-ic is-${kind}">${kind === 'like' ? ICON.heart : ICON.alert}</span>
        <strong>${esc(a.q)}</strong>
        ${name ? `<p>${esc(name)}</p>` : ''}
        <div class="sk-bt-confirm-actions">
          <button type="button" class="sk-bt-btn" data-bt-close>Cancelar</button>
          <button type="button" class="sk-bt-btn is-primary" data-bt-yes data-kind="${kind}" data-vid="${esc(vid)}">${esc(a.btn)}</button>
        </div>
      </div>`);
  }

  async function runAction(el, btn) {
    const a = ACTIONS[btn.dataset.kind];
    btn.disabled = true;
    btn.textContent = 'Enviando…';
    let msg = a.ok;
    let good = true;
    try {
      const text = await post(a.url, new URLSearchParams({ vid: btn.dataset.vid }));
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
    await reloadLists(el);
  }

  async function reloadLists(el) {
    const s = el._sk;
    const [interes, postulaciones, historico] = await Promise.all([
      loadList(s, s.hrefs.interes), loadList(s, s.hrefs.postulaciones), loadList(s, s.hrefs.historico),
    ]).catch((err) => { if (err?.session) el.innerHTML = errorCard(err); return []; });
    if (!interes) return;
    Object.assign(s.data, { interes, postulaciones, historico });
    renderOffers(el);
  }

  function openFrame(el, src, title, reload) {
    modal(el, `
      <div class="sk-bt-dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <header>
          <span class="sk-bt-dialog-ic">${ICON.briefcase}</span>
          <div><strong>${esc(title)}</strong><small>Página oficial del SII</small></div>
          <button type="button" class="sk-bt-x" data-bt-close aria-label="Cerrar">${ICON.x}</button>
        </header>
        <iframe src="${esc(src)}" title="${esc(title)}"></iframe>
      </div>`, reload);
  }

  function modal(el, inner, reload) {
    closeModal(el, false);
    const m = document.createElement('div');
    m.className = 'sk-bt-modal';
    if (reload) m.dataset.reload = reload;
    m.innerHTML = inner;
    el.append(m);
    m.querySelector('button')?.focus();
  }

  function closeModal(el, allowReload = true) {
    const m = el.querySelector('.sk-bt-modal');
    if (!m) return;
    const reload = m.dataset.reload;
    m.remove();
    if (!allowReload || !reload) return;
    // Igual que el SII al cerrar sus ventanas: volver a leer lo que pudo cambiar.
    if (reload === 'all') { el._sk.state = 'idle'; open(el); } else reloadLists(el);
  }

  function toast(el, msg, good) {
    el.querySelector('.sk-bt-toast')?.remove();
    const t = document.createElement('div');
    t.className = `sk-bt-toast${good ? '' : ' is-bad'}`;
    t.setAttribute('role', 'status');
    t.innerHTML = `${good ? ICON.check : ICON.alert}<span>${esc(msg)}</span>`;
    el.append(t);
    setTimeout(() => t.remove(), 4200);
  }

  function select(el, tab) {
    el._sk.tab = tab;
    el.querySelectorAll('[data-bt-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.btTab === tab)));
    el.querySelectorAll('[data-bt-panel]').forEach((p) => { p.hidden = p.dataset.btPanel !== tab; });
  }

  // ------------------------------------------------------------- Dibujo
  function render(s) {
    const d = s.data;
    return `
      <div class="sk-bt-wrap">
        <header class="sk-bt-head">
          <div><h1>Bolsa de trabajo</h1><p>Tu currículum y las ofertas de empleo publicadas para la comunidad UPQ.</p></div>
          <nav class="sk-bt-tabs" role="tablist">
            <button type="button" role="tab" data-bt-tab="cv">${ICON.idCard}Mi currículum</button>
            <button type="button" role="tab" data-bt-tab="ofertas">${ICON.briefcase}Ofertas de empleo<em>${d.vacantes.ok ? d.vacantes.total : ''}</em></button>
          </nav>
        </header>
        <div data-bt-panel="cv">${renderCv(s)}</div>
        <div data-bt-panel="ofertas" hidden><div data-bt-offers></div></div>
        <p class="sk-bt-foot">Información tomada del SII. Los formularios para actualizar tu CV y postularte son los oficiales del sistema.
          <button type="button" data-bt-original>Ver vista original</button></p>
      </div>`;
  }

  function renderCv(s) {
    const cv = s.data.cv;
    const st = s.student;
    if (!cv) return '<div class="sk-bt-card sk-bt-empty">No se pudo leer tu currículum.</div>';
    const i = cv.info;
    const get = (re) => { const k = Object.keys(i).find((x) => re.test(x)); return k ? i[k] : ''; };
    const updated = get(/ultima actualizacion/);
    const status = get(/^estatus/);
    const tools = cv.herramientas.flatMap((h) => (h.descripcion || '').split(/[,;]/)).map(clean).filter(Boolean);
    const salary = parseFloat(get(/expectativa/).replace(/[^\d.]/g, ''));
    const a = cv.actions;
    const tips = [
      !cv.formacion.length && 'Agrega tu formación académica (por ejemplo, tu TSU).',
      !cv.experiencia.length && 'Agrega experiencia: estadías, proyectos o prácticas cuentan.',
      !tools.length && 'Agrega herramientas y tecnologías que dominas.',
    ].filter(Boolean);
    const days = updated ? Math.floor((Date.now() - new Date(updated.replace(' ', 'T'))) / 86400000) : null;

    const row = (label, value) => `<div class="sk-bt-cv-row"><dt>${label}</dt><dd${value ? '' : ' class="is-empty"'}>${esc(value || 'Sin registro')}</dd></div>`;
    const section = (title, body) => `<section class="sk-bt-cv-sec"><h3>${title}</h3>${body}</section>`;

    return `
      <div class="sk-bt-cvlayout">
        <article class="sk-bt-paper" aria-label="Vista previa de tu currículum">
          <div class="sk-bt-paper-top">
            ${st.photo ? `<img src="${esc(st.photo)}" alt="">` : `<span class="sk-bt-paper-photo">${ICON.user}</span>`}
            <div>
              <h2>${esc(titleCase(st.name || ''))}</h2>
              <p class="sk-bt-role">${esc(get(/profesion/) || 'Profesión sin registrar')}</p>
              ${get(/descripcion/) ? `<p class="sk-bt-tagline">${esc(get(/descripcion/))}</p>` : ''}
            </div>
            <span class="sk-bt-stamp${/activo/i.test(status) ? '' : ' is-off'}">${esc(sentence(status) || 'Sin estatus')}</span>
          </div>
          <div class="sk-bt-paper-body">
            <div class="sk-bt-paper-main">
              ${section('Perfil', `<dl>
                ${row('Situación laboral', get(/situacion/))}
                ${row('Experiencia', get(/experiencia/))}
                ${row('Nivel de inglés', get(/ingles/))}
                ${row('Expectativa salarial', Number.isNaN(salary) ? get(/expectativa/) : `${money(salary)} al mes`)}
              </dl>`)}
              ${section('Formación académica', cv.formacion.length
                ? `<ul class="sk-bt-timeline">${cv.formacion.map((f) => `<li><strong>${esc(f.programa || '')}</strong><span>${esc(f.institucion || '')}</span></li>`).join('')}</ul>`
                : '<p class="sk-bt-none">Sin registros</p>')}
              ${section('Experiencia laboral', cv.experiencia.length
                ? `<ul class="sk-bt-timeline">${cv.experiencia.map((x) => `<li><strong>${esc(x.puesto || '')}${x.empresa ? ` · ${esc(x.empresa)}` : ''}</strong>
                    <span>${esc([x['fecha inicio'], x['fecha fin']].filter(Boolean).join(' – '))}</span>${x.actividades ? `<p>${esc(x.actividades)}</p>` : ''}</li>`).join('')}</ul>`
                : '<p class="sk-bt-none">Sin registros</p>')}
            </div>
            <aside class="sk-bt-paper-side">
              ${section('Herramientas', tools.length ? `<div class="sk-bt-chips">${tools.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : '<p class="sk-bt-none">Sin registros</p>')}
              ${section('Pasatiempos', `<p class="sk-bt-text">${esc(get(/pasatiempos/) || 'Sin registro')}</p>`)}
            </aside>
          </div>
        </article>

        <aside class="sk-bt-cvside">
          <section class="sk-bt-card sk-bt-actions">
            <h2>${ICON.idCard}Tu CV en la bolsa</h2>
            <p class="sk-bt-updated">${updated ? `Actualizado ${days != null && days >= 0 ? (days === 0 ? 'hoy' : days === 1 ? 'ayer' : `hace ${days} días`) : ''}<small>${esc(updated)}</small>` : 'Sin actualizar'}</p>
            ${a.update || a.create ? `<button type="button" class="sk-bt-btn is-primary is-wide" data-bt-frame="${esc(a.update || a.create)}" data-bt-title="${a.update ? 'Actualizar currículum UPQ' : 'Registrar currículum UPQ'}" data-bt-reload="all">${ICON.pencil}${a.update ? 'Actualizar currículum' : 'Registrar currículum'}</button>` : ''}
            <div class="sk-bt-actgrid">
              ${a.print ? `<button type="button" class="sk-bt-act" data-bt-print>${ICON.printer}<span>Imprimir CV</span></button>` : ''}
              ${a.view ? `<button type="button" class="sk-bt-act" data-bt-frame="${esc(a.view)}" data-bt-title="CV subido">${ICON.file}<span>Ver CV subido</span></button>` : ''}
              ${a.upload ? `<button type="button" class="sk-bt-act" data-bt-frame="${esc(a.upload)}" data-bt-title="Subir CV">${ICON.upload}<span>Subir CV (PDF)</span></button>` : ''}
            </div>
          </section>
          ${tips.length ? `
          <section class="sk-bt-card sk-bt-tips">
            <h2>${ICON.info}Mejora tu CV</h2>
            <ul>${tips.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
          </section>` : ''}
        </aside>
      </div>`;
  }

  function renderOffers(el) {
    const s = el._sk;
    const box = el.querySelector('[data-bt-offers]');
    if (!box || !s.data) return;
    const d = s.data;
    const focus = document.activeElement?.matches?.('[data-bt-search]');
    const words = norm(s.query).split(' ').filter(Boolean);
    const match = (r) => words.every((w) => norm([r.titulo, r.empresa, r.intro, r.tipo].join(' ')).includes(w));
    const liked = new Set(d.interes.rows.map((r) => r.vid));
    const applied = new Set(d.postulaciones.rows.map((r) => r.vid));
    const subs = [
      ['disponibles', 'Disponibles', d.vacantes.total || d.vacantes.rows.length],
      ['interes', 'Me interesan', d.interes.rows.length],
      ['postulaciones', 'Postulaciones', d.postulaciones.rows.length],
      ['historico', 'Histórico', d.historico.rows.length],
    ];
    const lists = { disponibles: d.vacantes, interes: d.interes, postulaciones: d.postulaciones, historico: d.historico };
    const cur = lists[s.sub];
    const rows = cur.rows.filter(match);

    let body;
    if (!cur.ok && !cur.rows.length) {
      body = `<div class="sk-bt-card sk-bt-empty">${ICON.alert}<p>No se pudo cargar esta lista.</p><button type="button" class="sk-bt-btn" data-bt-original>Ver en la vista original</button></div>`;
    } else if (!rows.length) {
      body = `<div class="sk-bt-card sk-bt-empty">${ICON.briefcase}<p>${s.query ? 'No hay vacantes que coincidan con la búsqueda.' : {
        disponibles: 'No hay vacantes disponibles por ahora.', interes: 'Aún no marcas vacantes como de tu interés.',
        postulaciones: 'No tienes postulaciones activas.', historico: 'Sin historial de postulaciones.' }[s.sub]}</p></div>`;
    } else if (s.sub === 'historico') {
      body = `<ol class="sk-bt-history">${rows.map(historyRow).join('')}</ol>`;
    } else {
      body = `<div class="sk-bt-jobs">${rows.map((r) => jobCard(r, s.sub, liked.has(r.vid), applied.has(r.vid))).join('')}</div>
        ${s.sub === 'disponibles' && d.vacantes.rows.length < d.vacantes.total
          ? `<div class="sk-bt-more"><button type="button" class="sk-bt-btn" data-bt-more>Cargar más vacantes (${d.vacantes.rows.length} de ${d.vacantes.total})</button></div>` : ''}`;
    }

    box.innerHTML = `
      <section class="sk-bt-hero">
        <div class="sk-bt-hero-text">
          <span>Ofertas de empleo</span>
          <h2>${d.vacantes.ok ? `${d.vacantes.total} vacante${d.vacantes.total === 1 ? '' : 's'} publicada${d.vacantes.total === 1 ? '' : 's'}` : 'Vacantes para la comunidad UPQ'}</h2>
          <p>${d.postulaciones.rows.length ? `Tienes <b>${d.postulaciones.rows.length} ${d.postulaciones.rows.length === 1 ? 'postulación' : 'postulaciones'}</b> activa${d.postulaciones.rows.length === 1 ? '' : 's'}.` : 'Aún no te postulas a ninguna vacante.'}
            ${d.interes.rows.length ? ` ${d.interes.rows.length} marcada${d.interes.rows.length === 1 ? '' : 's'} como de tu interés.` : ''}</p>
        </div>
        ${briefcaseSvg()}
      </section>
      <div class="sk-bt-toolbar">
        <div class="sk-bt-subs" role="tablist">
          ${subs.map(([k, label, n]) => `<button type="button" role="tab" data-bt-sub="${k}" aria-selected="${s.sub === k}">${label}<em>${n}</em></button>`).join('')}
        </div>
        <label class="sk-bt-search">${ICON.search}
          <input type="search" data-bt-search placeholder="Buscar puesto, empresa o palabra clave…" value="${esc(s.query)}" autocomplete="off"></label>
      </div>
      ${body}`;
    if (focus) {
      const input = box.querySelector('[data-bt-search]');
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  function jobCard(r, sub, liked, applied) {
    const c = COLORS[hash(r.empresa) % COLORS.length];
    const vig = parseDate(r.vigencia);
    const days = vig ? Math.ceil((vig - startOfDay(new Date())) / 86400000) : null;
    const vigText = days == null ? '' : days < 0 ? 'Vigencia terminada' : days === 0 ? 'Vence hoy' : `Vigente ${days} día${days === 1 ? '' : 's'} más`;
    const salary = parseFloat(String(r.salario).replace(/[^\d.]/g, ''));
    const detail = r.detail || `/alumnos.php/vacante_detalle/${r.vid}`;
    const name = `${r.titulo} · ${titleCase(r.empresa)}`;
    const long = r.intro.length > 220;
    return `
      <article class="sk-bt-job" style="--c:${c}">
        <header>
          <span class="sk-bt-logo">${esc(initials(r.empresa))}</span>
          <div class="sk-bt-job-title">
            <h3>${esc(r.titulo || 'Vacante')}</h3>
            <span>${esc(titleCase(r.empresa))}</span>
          </div>
          ${applied ? '<span class="sk-bt-badge is-applied">Postulado</span>' : liked ? '<span class="sk-bt-badge is-liked">Te interesa</span>' : ''}
        </header>
        <div class="sk-bt-job-meta">
          ${r.tipo ? `<span>${ICON.briefcase}${esc(r.tipo)}</span>` : ''}
          <span>${ICON.card}${Number.isNaN(salary) || !salary ? 'Salario no especificado' : `${money(salary)} al mes`}</span>
          ${vigText ? `<span class="${days != null && days <= 3 ? 'is-soon' : ''}">${ICON.calendar}${esc(vigText)}</span>` : ''}
        </div>
        ${r.intro ? `<p class="sk-bt-intro${long ? ' is-long' : ''}">${esc(r.intro)}</p>${long ? '<button type="button" class="sk-bt-link" data-bt-expand>Ver más</button>' : ''}` : ''}
        <footer>
          <button type="button" class="sk-bt-btn" data-bt-frame="${esc(detail)}" data-bt-title="Detalle de la vacante">${ICON.eye}Ver detalle</button>
          ${sub === 'disponibles' && !applied ? `<button type="button" class="sk-bt-btn is-primary" data-bt-frame="/alumnos.php/postularme_vacante?vid=${esc(r.vid)}" data-bt-title="Postularme a ${esc(r.titulo)}" data-bt-reload="lists">${ICON.send}Postularme</button>` : ''}
          ${sub === 'disponibles' && !liked ? `<button type="button" class="sk-bt-icon" data-bt-act="like" data-vid="${esc(r.vid)}" data-name="${esc(name)}" title="Me interesa" aria-label="Me interesa">${ICON.heart}</button>` : ''}
          ${sub === 'interes' ? `<button type="button" class="sk-bt-btn is-ghost" data-bt-act="unlike" data-vid="${esc(r.vid)}" data-name="${esc(name)}">${ICON.x}Ya no me interesa</button>` : ''}
          ${sub === 'postulaciones' ? `<button type="button" class="sk-bt-btn is-ghost" data-bt-act="unapply" data-vid="${esc(r.vid)}" data-name="${esc(name)}">${ICON.x}Quitar postulación</button>` : ''}
        </footer>
      </article>`;
  }

  function historyRow(r) {
    const d = parseDate(r.registro);
    const valid = d && d.getFullYear() > 1970;
    return `
      <li>
        <span class="sk-bt-dot${/postulad/i.test(r.estatus) ? ' is-on' : ''}"></span>
        <div class="sk-bt-history-main">
          <strong>${esc(r.titulo || 'Vacante')} · ${esc(titleCase(r.empresa))}</strong>
          <span>${esc([valid ? `Registrada el ${shortDate(d)}` : 'Sin fecha de registro', r.tipo, r.obs].filter(Boolean).join(' · '))}</span>
        </div>
        ${r.estatus ? `<span class="sk-bt-badge is-applied">${esc(sentence(r.estatus))}</span>` : '<span class="sk-bt-badge">Sin estatus</span>'}
        <button type="button" class="sk-bt-link" data-bt-frame="${esc(r.detail || `/alumnos.php/vacante_detalle/${r.vid}`)}" data-bt-title="Detalle de la vacante">Ver detalle</button>
      </li>`;
  }

  // Maletín ilustrado (decorativo)
  function briefcaseSvg() {
    return `<svg class="sk-bt-case" viewBox="0 0 220 150" aria-hidden="true">
      <ellipse cx="110" cy="138" rx="86" ry="8" fill="rgba(0,0,0,.18)"/>
      <path d="M84 30a10 10 0 0 1 10-10h32a10 10 0 0 1 10 10v12h-10V31a2 2 0 0 0-2-2H96a2 2 0 0 0-2 2v11H84z" fill="#c7a76a"/>
      <rect x="28" y="40" width="164" height="94" rx="14" fill="#c7a76a"/>
      <rect x="28" y="40" width="164" height="46" rx="14" fill="#d8bd86"/>
      <rect x="28" y="72" width="164" height="14" fill="#d8bd86"/>
      <rect x="28" y="84" width="164" height="4" fill="#a88849"/>
      <rect x="98" y="76" width="24" height="20" rx="4" fill="#1f3a5f"/>
      <rect x="106" y="83" width="8" height="6" rx="2" fill="#e6d7b5"/>
      <rect x="44" y="40" width="8" height="94" fill="rgba(122,95,44,.25)"/>
      <rect x="168" y="40" width="8" height="94" fill="rgba(122,95,44,.25)"/>
      <g transform="translate(150 6) rotate(12)">
        <rect width="46" height="58" rx="5" fill="#fff"/>
        <rect x="8" y="9" width="14" height="14" rx="7" fill="#e6edf6"/>
        <rect x="26" y="11" width="14" height="3" rx="1.5" fill="#cbd5e1"/>
        <rect x="26" y="17" width="10" height="3" rx="1.5" fill="#e2e8f0"/>
        <rect x="8" y="30" width="30" height="3" rx="1.5" fill="#cbd5e1"/>
        <rect x="8" y="37" width="24" height="3" rx="1.5" fill="#e2e8f0"/>
        <rect x="8" y="44" width="28" height="3" rx="1.5" fill="#e2e8f0"/>
      </g>
    </svg>`;
  }

  function errorCard(err) {
    const session = err?.session;
    return `
      <div class="sk-bt-wrap"><div class="sk-bt-card sk-bt-error">
        ${session ? ICON.lock : ICON.alert}
        <div><strong>${session ? 'Tu sesión del SII expiró' : 'No se pudo preparar la bolsa de trabajo'}</strong>
        <p>${session ? 'Vuelve a iniciar sesión para ver tu currículum y las vacantes.' : 'Puedes intentarlo de nuevo o abrir la vista original del SII.'}</p></div>
        ${session ? '<button type="button" class="sk-bt-btn is-primary" data-bt-login>Iniciar sesión</button>' : `
        <button type="button" class="sk-bt-btn" data-bt-retry>Reintentar</button>
        <button type="button" class="sk-bt-btn is-primary" data-bt-original>Ver vista original</button>`}
      </div></div>`;
  }

  function skeleton() {
    return `<div class="sk-bt-wrap">
      <div class="sk-bt-skel" style="height:60px"></div>
      <div class="sk-bt-cvlayout"><div class="sk-bt-skel" style="height:520px"></div><div class="sk-bt-skel" style="height:260px"></div></div>
    </div>`;
  }

  // ----------------------------------------------------------- Utilidades
  function toDoc(html) { return new DOMParser().parseFromString(html, 'text/html'); }
  function hash(s) { let h = 0; for (const ch of norm(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; }
  function initials(s) {
    const w = clean(s).replace(/(^|\s)(s\.?\s?a\.?|s\.?\s?c\.?|de|c\.?\s?v\.?|s\.? de r\.?\s?l\.?|sapi|sas)(?=\s|,|$)/gi, ' ')
      .replace(/[.,]/g, ' ').split(/\s+/).filter((x) => /[a-z0-9]/i.test(x));
    if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
    return ((w[0]?.[0] || '?') + (w[1]?.[0] || '')).toUpperCase();
  }

  function money(v) { return v.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }); }
  function parseDate(s) {
    const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s || '');
    if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
    const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
    return iso ? new Date(+iso[1], +iso[2] - 1, +iso[3]) : null;
  }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function shortDate(d) { return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', ''); }
  function clean(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
  function norm(s) { return clean(s).toLowerCase().normalize('NFD').replace(/\p{M}/gu, ''); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  function sentence(s) { const t = clean(s).toLowerCase(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; }
  const SMALL = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'en', 'el', 'a']);
  const KEEP = /^(s\.?a\.?|s\.?c\.?|c\.?v\.?|r\.?l\.?|sapi|sas|sc|it|ti|upq|dss|mx|abb|ibm)[.,]?$/i;
  function titleCase(s) {
    return clean(s).toLowerCase().split(' ').map((w, i) => {
      if (KEEP.test(w)) return w.toUpperCase();
      if (i > 0 && SMALL.has(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  }

  return { create, open };
})();
