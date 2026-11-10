// Módulo "Desempeño Escolar" rediseñado.
// La pestaña original es un contenedor (alumnos.php/calificaciones) con 4 sub-pestañas:
//   - boleta-calificaciones   (se carga por href) última boleta, promedios oficiales y totales
//   - historial-academico     (se carga por href) todas las materias cursadas con créditos
//   - Materias No Acreditadas (viene dentro del contenedor)
//   - Kardex                  (viene dentro del contenedor) plan de estudios completo
// Se presentan en tres secciones: Resumen, Historial y Plan de estudios.
// eslint-disable-next-line no-unused-vars
const SK_DESEMPENO = (() => {
  const ICON = SK_ICON;

  // ---------------------------------------------------------------- API
  // href: dirección del contenedor; load(url): descarga con la sesión;
  // current: cuatrimestre actual según el perfil (opcional).
  function create({ href, load, current, student, onOriginal }) {
    const el = document.createElement('div');
    el.id = 'sk-des';
    el.className = 'sk-view';
    el.hidden = true;
    el._sk = { href, load, current, student: student || {}, state: 'idle', tab: 'resumen', data: null };
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-de-original]')) onOriginal();
      if (e.target.closest('[data-de-retry]')) { el._sk.state = 'idle'; open(el); }
      if (e.target.closest('[data-de-login]')) window.top.location.reload();
      if (e.target.closest('[data-de-print]')) printKardex(el);
      const tab = e.target.closest('[data-de-tab]');
      if (tab) selectTab(el, tab.dataset.deTab);
    });
    el.addEventListener('input', (e) => {
      if (e.target.matches('[data-de-search]')) filterHistory(el, e.target.value);
    });
    return el;
  }

  async function open(el) {
    const s = el._sk;
    if (s.state !== 'idle') return; // ya cargado o cargando
    s.state = 'loading';
    el.innerHTML = skeleton();
    try {
      const cont = toDoc(await s.load(s.href));
      const hrefs = {};
      cont.querySelectorAll('div[title][href]').forEach((d) => {
        const t = norm(d.getAttribute('title'));
        if (/boleta/.test(t)) hrefs.boleta = d.getAttribute('href');
        else if (/historial/.test(t)) hrefs.historial = d.getAttribute('href');
      });
      const [boleta, hist] = await Promise.all(['boleta', 'historial'].map((k) =>
        (hrefs[k] ? s.load(hrefs[k]).then(toDoc) : Promise.resolve(null))));
      const data = build(cont, boleta, hist, s.current);
      if (!data.history.length && !data.boleta.length && !data.plan.length) throw new Error('sin datos');
      s.data = data;
      el.innerHTML = render(data);
      selectTab(el, s.tab);
      s.state = 'ready';
    } catch (err) {
      s.state = 'error';
      el.innerHTML = errorCard(err);
    }
  }

  function selectTab(el, tab) {
    el._sk.tab = tab;
    el.querySelectorAll('[data-de-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.deTab === tab)));
    el.querySelectorAll('[data-de-panel]').forEach((p) => { p.hidden = p.dataset.dePanel !== tab; });
    el.scrollTop = 0;
  }

  function filterHistory(el, q) {
    const words = norm(q).split(' ').filter(Boolean);
    let shown = 0;
    el.querySelectorAll('.sk-de-cycle').forEach((cy) => {
      let n = 0;
      cy.querySelectorAll('[data-q]').forEach((row) => {
        const ok = words.every((w) => row.dataset.q.includes(w));
        row.hidden = !ok;
        if (ok) n++;
      });
      cy.hidden = n === 0;
      shown += n;
    });
    const empty = el.querySelector('[data-de-noresults]');
    if (empty) empty.hidden = shown > 0;
  }

  // ------------------------------------------------------------- Lectura
  function build(cont, boletaDoc, histDoc, currentHint) {
    const docs = [boletaDoc, histDoc, cont].filter(Boolean);

    // Catálogo de tipos de evaluación (1 = Curso ordinario, 2 = Evaluación final…)
    const catalog = {};
    docs.forEach((d) => d.querySelectorAll('table').forEach((t) => {
      const { cols, body } = table(t);
      if (cols.length !== 2 || !/descripcion/.test(cols[1])) return;
      body.forEach((tr) => { catalog[clean(tr.cells[0]?.textContent)] = clean(tr.cells[1]?.textContent); });
    }));

    const find = (doc, test) => doc && [...doc.querySelectorAll('table')].find((t) => test(table(t).cols));
    const boletaT = find(boletaDoc, (c) => c.some((x) => /unidades/.test(x)));
    const histT = find(histDoc, (c) => c.includes('ciclo') && c.some((x) => /^cred/.test(x)));
    const failPanel = cont.querySelector('#materiasReprobadasContainer') ||
      [...cont.querySelectorAll('div[title]')].find((d) => /no acreditadas/i.test(d.getAttribute('title')));
    const failT = failPanel?.querySelector('table');
    const kardexT = cont.querySelector('#kardexContainer table') ||
      find(cont, (c) => c.includes('cuatrimestre') && c.includes('clave'));

    const history = histT ? subjects(histT, catalog) : [];
    const cycleById = new Map(history.filter((h) => h.id).map((h) => [h.id, h.ciclo]));
    const boleta = boletaT ? subjects(boletaT, catalog).map((b) => ({ ...b, ciclo: b.ciclo || cycleById.get(b.id) || '' })) : [];
    const failed = failT ? subjects(failT, catalog) : [];
    const kardex = kardexT ? subjects(kardexT, catalog) : [];

    // Promedios oficiales por periodo y totales (NC, créditos…)
    const avgT = find(boletaDoc, (c) => c[0] === 'cuatrimestre' && /promedio/.test(c[1] || ''));
    const periods = avgT ? table(avgT).body.map((tr) => ({
      period: clean(tr.cells[0]?.textContent), value: parseFloat(clean(tr.cells[1]?.textContent)),
    })).filter((p) => !Number.isNaN(p.value)) : [];
    const totalTh = avgT && [...avgT.querySelectorAll('th')].find((th) => /promedio total/i.test(th.textContent));
    const total = totalTh ? parseFloat(clean(totalTh.nextElementSibling?.textContent)) : NaN;

    const stats = {};
    boletaDoc?.querySelectorAll('tr').forEach((tr) => {
      const th = tr.querySelector('th');
      const td = th?.nextElementSibling;
      if (td?.tagName === 'TD') stats[norm(th.textContent).replace(/:$/, '')] = parseFloat(clean(td.textContent));
    });
    const stat = (re) => { const k = Object.keys(stats).find((x) => re.test(x)); return k ? stats[k] : NaN; };

    // Plan de estudios (kardex) por cuatrimestre. Las materias sin calificación de
    // cuatrimestres ya cursados son de otra especialidad u optativas no elegidas.
    const graded = kardex.filter((k) => k.grade != null);
    const maxGraded = Math.max(0, ...graded.map((k) => k.cuatri || 0));
    const current = currentHint > maxGraded ? currentHint : maxGraded + 1;
    const semMap = new Map();
    const skipped = [];
    kardex.forEach((k) => {
      if (!k.cuatri || (k.cuatri < current && k.grade == null)) { skipped.push(k); return; }
      if (!semMap.has(k.cuatri)) semMap.set(k.cuatri, []);
      semMap.get(k.cuatri).push(k);
    });
    const plan = [...semMap.entries()].sort((a, b) => a[0] - b[0]).map(([n, list]) => {
      const nums = list.map((x) => x.grade).filter((g) => typeof g === 'number');
      return {
        n, label: ordinal(n), subjects: list,
        state: n < current ? 'done' : n === current ? 'current' : 'upcoming',
        avg: nums.length ? mean(nums) : null,
      };
    });

    return {
      boleta, history, failed, plan, skipped, periods, total, kardex,
      nc: stat(/^nc/), failedTotal: stat(/^total mat\. no acreditadas$/),
      creditsDone: stat(/creditos aprobados/), creditsTaken: stat(/creditos cursados/),
      ncNote: clean(histDoc?.querySelector('p.instrucciones strong')?.textContent),
    };
  }

  // Lee una tabla de materias usando los encabezados (no posiciones fijas).
  function subjects(t, catalog) {
    const { cols, body } = table(t);
    const at = (re) => cols.findIndex((c) => re.test(c));
    const i = {
      fecha: at(/^fecha/), ciclo: at(/^ciclo/), clave: at(/^clave/), materia: at(/^materia/),
      cred: at(/^cred/), cal: at(/^cal/), tipo: at(/^tipo/), estado: at(/^estado/),
      unidades: at(/unidades/), cuatri: at(/^cuatrimestre/), obs: at(/^observ/),
    };
    if (i.materia < 0) return [];
    return body.filter((tr) => tr.cells.length >= cols.length - 1).map((tr) => {
      const cell = (k) => (i[k] >= 0 ? tr.cells[i[k]] : null);
      const txt = (k) => clean(cell(k)?.textContent);
      const raw = txt('cal');
      const num = parseFloat(raw);
      const tipoRaw = txt('tipo');
      const tipo = cell('tipo')?.getAttribute('title') || catalog[tipoRaw] || tipoRaw;
      const estadoCell = cell('estado');
      return {
        id: tr.id || '',
        fecha: txt('fecha'),
        ciclo: txt('ciclo'),
        clave: txt('clave'),
        name: smartCase(txt('materia')),
        raw: txt('materia'),
        cred: parseFloat(txt('cred')),
        grade: raw ? (Number.isNaN(num) ? raw : num) : null,
        tipo: tipo ? sentence(tipo) : '',
        estado: clean(estadoCell?.querySelector('[title]')?.getAttribute('title') || estadoCell?.getAttribute('title') || estadoCell?.textContent),
        unidades: parseFloat(txt('unidades')),
        cuatri: parseInt(txt('cuatri'), 10) || 0,
        obs: txt('obs'),
      };
    }).filter((s) => s.name);
  }

  function table(t) {
    const head = t.querySelector('thead');
    const hr = head ? [...head.rows].at(-1) : null;
    const cols = hr ? [...hr.cells].map((c) => norm(c.textContent)) : [];
    const body = [...t.rows].filter((tr) => !tr.closest('thead') && tr.querySelector('td'));
    return { cols, body };
  }

  // ------------------------------------------------------------- Dibujo
  function render(d) {
    const avg = Number.isNaN(d.total) ? (d.history.length ? mean(nums(d.history)) : null) : d.total;
    const planAll = d.plan.flatMap((s) => s.subjects);
    const planDone = planAll.filter((x) => typeof x.grade === 'number' && x.grade >= 7).length;
    const planPct = planAll.length ? (planDone / planAll.length) * 100 : NaN;
    const failedTotal = Number.isNaN(d.failedTotal) ? d.failed.length : d.failedTotal;
    const creditsPct = d.creditsTaken > 0 ? (d.creditsDone / d.creditsTaken) * 100 : NaN;

    const tile = (label, value, sub, extra = '', cls = '') => `
      <div class="sk-de-tile ${cls}"><span>${label}</span><strong>${value}</strong>${sub ? `<small>${sub}</small>` : ''}${extra}</div>`;

    return `
      <div class="sk-de-wrap">
        <header class="sk-de-head">
          <div>
            <h1>Desempeño escolar</h1>
            <p>Calificaciones, historial y avance en tu plan de estudios.</p>
          </div>
          <nav class="sk-de-tabs" role="tablist">
            <button type="button" role="tab" data-de-tab="resumen">${ICON.dashboard}Resumen</button>
            <button type="button" role="tab" data-de-tab="historial">${ICON.file}Historial<em>${d.history.length}</em></button>
            <button type="button" role="tab" data-de-tab="kardex">${ICON.graduation}Plan de estudios</button>
          </nav>
        </header>

        <section class="sk-de-tiles">
          ${tile('Promedio general', avg != null ? fmt(avg) : '—', Number.isNaN(d.total) ? 'Calculado con tu historial' : 'Oficial del SII',
            avg != null ? bar((avg / 10) * 100) : '', 'is-main')}
          ${tile('Créditos aprobados', Number.isNaN(d.creditsDone) ? '—' : `${num(d.creditsDone)}<em> / ${num(d.creditsTaken)}</em>`,
            Number.isNaN(creditsPct) ? '' : `${creditsPct.toFixed(0)}% de los créditos cursados`, Number.isNaN(creditsPct) ? '' : bar(creditsPct))}
          ${tile('Avance del plan', planAll.length ? `${planDone}<em> / ${planAll.length}</em>` : '—',
            planAll.length ? `materias acreditadas · ${planPct.toFixed(0)}%` : '', planAll.length ? bar(planPct) : '')}
          ${failedTotal > 0
            ? tile('No acreditadas', String(failedTotal), `NC acumuladas: ${Number.isNaN(d.nc) ? '—' : num(d.nc)}`, '', 'is-alert')
            : tile('No acreditadas', `<span class="sk-de-ok">${ICON.check}</span>Ninguna`,
              `NC acumuladas: ${Number.isNaN(d.nc) ? 0 : num(d.nc)}`, '', 'is-good')}
        </section>

        <div data-de-panel="resumen" class="sk-de-panel">${renderResumen(d)}</div>
        <div data-de-panel="historial" class="sk-de-panel" hidden>${renderHistorial(d)}</div>
        <div data-de-panel="kardex" class="sk-de-panel" hidden>${renderKardex(d)}</div>

        <p class="sk-de-foot">
          NP = No presentó (equivale a NC) · NC = No competente · Calificación mínima aprobatoria: 7.0
          <button type="button" data-de-original>Ver vista original</button>
        </p>
      </div>`;
  }

  function renderResumen(d) {
    // Boleta agrupada por periodo (normalmente el último cuatrimestre y, si aplica, la estadía).
    const groups = groupBy(d.boleta, (b) => b.ciclo);
    const boletaCard = d.boleta.length ? `
      <section class="sk-de-card">
        <header class="sk-de-card-head">
          <h2>${ICON.award}Última boleta</h2>
          <p>Calificaciones más recientes registradas en el SII.</p>
        </header>
        ${groups.map(([ciclo, list]) => {
          const n = nums(list);
          return `
          <div class="sk-de-group">
            ${ciclo ? `<div class="sk-de-group-head"><h3>${esc(period(ciclo))}</h3>
              ${n.length > 1 ? `<span>Promedio <b>${fmt(mean(n))}</b></span>` : ''}</div>` : ''}
            <ul class="sk-de-list">${list.map(boletaRow).join('')}</ul>
          </div>`;
        }).join('')}
      </section>` : '';

    const failedCard = d.failed.length ? `
      <section class="sk-de-card sk-de-failed">
        <header class="sk-de-card-head">
          <h2>${ICON.alert}Materias no acreditadas</h2>
          <p>Materias registradas con calificación no aprobatoria.</p>
        </header>
        <ul class="sk-de-list">${d.failed.map((x) => `
          <li>
            <div class="sk-de-subj"><strong>${esc(x.name)}</strong>
              <span>${[period(x.ciclo), x.fecha, x.tipo, x.estado].filter(Boolean).map(esc).join(' · ')}</span></div>
            ${gradeChip(x.grade)}
          </li>`).join('')}</ul>
      </section>` : '';

    return `
      <div class="sk-de-split">
        <div class="sk-de-col">${failedCard}${boletaCard}</div>
        <div class="sk-de-col">${renderPeriods(d)}${renderDistribution(d)}</div>
      </div>`;
  }

  function boletaRow(x) {
    const meta = [x.fecha && `Registrada el ${x.fecha}`, Number.isNaN(x.unidades) ? '' : `${num(x.unidades)}% de unidades aprobadas`]
      .filter(Boolean).join(' · ');
    return `
      <li>
        <div class="sk-de-subj">
          <strong>${esc(x.name)}</strong>
          <span>${esc(meta)}${typeTag(x.tipo)}</span>
        </div>
        ${gradeChip(x.grade, true)}
      </li>`;
  }

  // Promedios oficiales por periodo, con el cambio respecto al anterior.
  function renderPeriods(d) {
    if (!d.periods.length) return '';
    const best = Math.max(...d.periods.map((p) => p.value));
    return `
      <section class="sk-de-card">
        <header class="sk-de-card-head">
          <h2>${ICON.chart}Promedio por cuatrimestre</h2>
          <p>Promedios oficiales de cada periodo.</p>
        </header>
        <ol class="sk-de-periods">
          ${d.periods.map((p, k) => {
            const prev = d.periods[k - 1];
            const delta = prev ? p.value - prev.value : 0;
            const trend = !prev || Math.abs(delta) < 0.005 ? '<i class="is-flat">—</i>'
              : `<i class="${delta > 0 ? 'is-up' : 'is-down'}">${delta > 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(2)}</i>`;
            return `<li${p.value === best ? ' class="is-best"' : ''}>
              <span>${esc(period(p.period))}${p.value === best ? '<em>Mejor</em>' : ''}</span>
              ${trend}<b class="${gradeClass(p.value)}">${fmt(p.value)}</b></li>`;
          }).join('')}
        </ol>
        ${Number.isNaN(d.total) ? '' : `<div class="sk-de-total"><span>Promedio total</span><b>${fmt(d.total)}</b></div>`}
      </section>`;
  }

  // Cuántas veces has sacado cada calificación (barras desde cero, una sola serie).
  function renderDistribution(d) {
    const n = nums(d.history);
    if (!n.length) return '';
    const buckets = [
      { label: '10', test: (v) => v >= 9.5 },
      { label: '9', test: (v) => v >= 8.5 && v < 9.5 },
      { label: '8', test: (v) => v >= 7.5 && v < 8.5 },
      { label: '7', test: (v) => v >= 7 && v < 7.5 },
      { label: '< 7', test: (v) => v < 7 },
    ].map((b) => ({ ...b, count: n.filter(b.test).length }));
    const text = d.history.filter((h) => typeof h.grade === 'string').length; // NP / NC
    buckets[4].count += text;
    const max = Math.max(...buckets.map((b) => b.count), 1);
    const total = n.length + text;
    return `
      <section class="sk-de-card">
        <header class="sk-de-card-head">
          <h2>${ICON.award}Tus calificaciones</h2>
          <p>Cuántas veces has obtenido cada calificación en ${total} materias.</p>
        </header>
        <ul class="sk-de-dist">
          ${buckets.filter((b) => b.count || b.label !== '< 7').map((b) => `
            <li title="${b.count} materia${b.count === 1 ? '' : 's'} con ${b.label}">
              <span>${b.label}</span>
              <div>${b.count ? `<i style="width:${((b.count / max) * 100).toFixed(1)}%"></i>` : ""}</div>
              <b>${b.count}</b><small>${((b.count / total) * 100).toFixed(0)}%</small>
            </li>`).join('')}
        </ul>
      </section>`;
  }

  function renderHistorial(d) {
    if (!d.history.length) return '<div class="sk-de-card sk-de-empty">No hay materias en el historial académico.</div>';
    const groups = groupBy(d.history, (h) => h.ciclo);
    const credits = d.history.reduce((a, h) => a + (Number.isNaN(h.cred) ? 0 : h.cred), 0);
    return `
      <div class="sk-de-toolbar">
        <label class="sk-de-search">${ICON.search}
          <input type="search" data-de-search placeholder="Buscar materia, clave o tipo de evaluación…" autocomplete="off" /></label>
        <span>${d.history.length} materias · ${num(Number.isNaN(d.creditsDone) ? Math.round(credits) : d.creditsDone)} créditos${d.ncNote ? ` · NC acumuladas: ${esc(d.ncNote)}` : ''}</span>
      </div>
      <p class="sk-de-card sk-de-empty" data-de-noresults hidden>No hay materias que coincidan con la búsqueda.</p>
      ${groups.map(([ciclo, list]) => {
        const n = nums(list);
        const cr = list.reduce((a, h) => a + (Number.isNaN(h.cred) ? 0 : h.cred), 0);
        return `
        <section class="sk-de-card sk-de-cycle">
          <header class="sk-de-cycle-head">
            <div><h2>${esc(period(ciclo) || 'Sin periodo')}</h2>
              <span>${list.length} materia${list.length === 1 ? '' : 's'} · ${num(cr)} créditos</span></div>
            ${n.length ? `<div class="sk-de-avg ${gradeClass(mean(n))}"><strong>${fmt(mean(n))}</strong><small>promedio</small></div>` : ''}
          </header>
          <div class="sk-de-rows">
            <div class="sk-de-row is-head"><span>Materia</span><span>Fecha</span><span>Créditos</span><span>Calificación</span></div>
            ${list.map((h) => `
              <div class="sk-de-row" data-q="${esc(norm([h.name, h.clave, h.tipo, h.estado].join(' ')))}">
                <div class="sk-de-subj"><strong>${esc(h.name)}</strong>
                  <span>${h.clave ? `<code>${esc(h.clave)}</code>` : ''}${typeTag(h.tipo)}${h.estado ? `<em class="sk-de-tag is-warn">${esc(h.estado)}</em>` : ''}</span></div>
                <span class="sk-de-cell" data-label="Fecha">${esc(h.fecha || '—')}</span>
                <span class="sk-de-cell" data-label="Créditos">${Number.isNaN(h.cred) ? '—' : num(h.cred)}</span>
                <span class="sk-de-cell is-grade">${gradeChip(h.grade)}</span>
              </div>`).join('')}
          </div>
        </section>`;
      }).join('')}`;
  }

  const STATE_LABEL = { done: 'Concluido', current: 'En curso', upcoming: 'Por cursar' };

  function renderKardex(d) {
    if (!d.plan.length) return '<div class="sk-de-card sk-de-empty">No se encontró el kardex.</div>';
    return `
      <div class="sk-de-toolbar">
        <span>${d.plan.filter((s) => s.state === 'done').length} de ${d.plan.length} cuatrimestres concluidos</span>
        <button type="button" class="sk-de-printbtn" data-de-print>${ICON.printer}Imprimir kardex</button>
      </div>
      <div class="sk-de-steps">
        ${d.plan.map((s) => `<span class="is-${s.state}" title="${esc(`${s.label} · ${STATE_LABEL[s.state]}`)}">${s.n}</span>`).join('')}
      </div>
      <div class="sk-de-plan">
        ${d.plan.map((s) => `
          <article class="sk-de-sem is-${s.state}">
            <header>
              <div><h3>${esc(s.label)}</h3><span class="sk-de-badge is-${s.state}">${STATE_LABEL[s.state]}</span></div>
              <div class="sk-de-avg ${s.avg != null ? gradeClass(s.avg) : 'is-none'}"><strong>${s.avg != null ? fmt(s.avg) : '—'}</strong><small>promedio</small></div>
            </header>
            <ul>${s.subjects.map((x) => `
              <li class="${x.grade == null ? 'is-pending' : ''}">
                <div class="sk-de-subj"><span>${esc(x.name)}</span>${x.clave ? `<code>${esc(x.clave)}</code>` : ''}${typeTag(x.tipo)}</div>
                ${gradeChip(x.grade)}
              </li>`).join('')}</ul>
          </article>`).join('')}
      </div>
      ${d.skipped.length ? `
      <details class="sk-de-card sk-de-skipped">
        <summary>${ICON.info}<span><strong>${d.skipped.length} materias del plan que no cursaste</strong>
          Son de otras especialidades u optativas que no elegiste; no cuentan para tu avance.</span>${ICON.chevronDown}</summary>
        <ul>${d.skipped.map((x) => `<li><span>${esc(x.name)}</span><small>${x.cuatri ? esc(ordinal(x.cuatri)) : 'Sin cuatrimestre'}</small></li>`).join('')}</ul>
      </details>` : ''}`;
  }

  function errorCard(err) {
    const session = err?.session;
    return `
      <div class="sk-de-wrap"><div class="sk-de-card sk-de-error">
        ${session ? ICON.lock : ICON.alert}
        <div><strong>${session ? 'Tu sesión del SII expiró' : 'No se pudo preparar el desempeño escolar'}</strong>
        <p>${session ? 'Vuelve a iniciar sesión para ver tus calificaciones.' : 'Puedes intentarlo de nuevo o abrir la vista original del SII.'}</p></div>
        ${session ? '<button type="button" data-de-login class="is-primary">Iniciar sesión</button>' : `
        <button type="button" data-de-retry>Reintentar</button>
        <button type="button" data-de-original class="is-primary">Ver vista original</button>`}
      </div></div>`;
  }

  function skeleton() {
    return `<div class="sk-de-wrap">
      <div class="sk-de-skel" style="height:64px"></div>
      <section class="sk-de-tiles">${'<div class="sk-de-skel"></div>'.repeat(4)}</section>
      <div class="sk-de-split"><div class="sk-de-skel" style="height:420px"></div><div class="sk-de-skel" style="height:420px"></div></div>
    </div>`;
  }

  // ------------------------------------------------------- Kardex imprimible
  // Mismo acomodo que el kardex que entrega Servicios Estudiantiles (datos del alumno y
  // tabla completa del plan), pero marcado como copia de consulta: sin firma, sello ni
  // logotipos institucionales. Se imprime el propio documento del iframe; desempeno.css
  // oculta todo lo demás con @media print.
  function printKardex(el) {
    const d = el._sk.data;
    const st = el._sk.student;
    if (!d) return;
    // Fecha y créditos salen del historial (el kardex del SII no los trae).
    const byName = new Map();
    d.history.forEach((h) => { const k = norm(h.raw); if (!byName.has(k)) byName.set(k, h); });
    const carrera = (d.kardex.map((k) => /^estad[ií]a\s+((?:ingenier|licenciatura).*)$/i.exec(k.raw)?.[1]).find(Boolean)) || st.carrera || '';
    const last = d.periods.length ? d.periods.at(-1).period : d.history[0]?.ciclo || '';
    const today = new Date().toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const cell = (v) => esc(v == null || Number.isNaN(v) ? '' : String(v));

    const rows = d.kardex.map((k, i) => {
      const h = byName.get(norm(k.raw));
      const cred = Number.isNaN(k.cred) ? h?.cred : k.cred;
      return `<tr>
        <td class="c">${i + 1}</td><td class="c n">${cell(h?.fecha || k.fecha)}</td><td class="n">${cell(k.clave)}</td>
        <td>${cell(k.raw.toUpperCase())}</td><td>${cell(cred)}</td><td class="c">${cell(k.cuatri || '')}</td>
        <td class="c">${cell(k.grade)}</td><td>${cell(k.grade != null && k.tipo ? k.tipo.toUpperCase() : '')}</td></tr>`;
    }).join('');

    let box = document.getElementById('sk-print');
    if (!box) { box = document.createElement('div'); box.id = 'sk-print'; document.body.append(box); }
    box.innerHTML = `
      <div class="kx-ribbon">Copia de consulta personal · sin validez oficial</div>
      <header class="kx-head">
        <h1>Universidad Politécnica de Querétaro</h1>
        <h2>Kardex</h2>
      </header>
      <section class="kx-id">
        <div class="kx-photo">${st.photo ? `<img src="${esc(st.photo)}" alt="">` : ''}</div>
        <table class="kx-data">
          <tr><th>Matrícula</th><th>Nombre del alumno</th><th>Promedio</th><th>Créditos</th></tr>
          <tr><td>${cell(st.matricula)}</td><td>${cell(st.name)}</td>
            <td>${Number.isNaN(d.total) ? '' : fmt(d.total)}</td><td>${cell(d.creditsDone)}</td></tr>
          <tr><th>Generación</th><th>Carrera</th><th colspan="2">Último periodo cursado</th></tr>
          <tr><td>${cell(st.generacion)}</td><td>${cell(carrera.toUpperCase())}</td><td colspan="2">${cell(last)}</td></tr>
        </table>
      </section>
      <table class="kx-table">
        <thead><tr><th>#</th><th>Fecha</th><th>Clave</th><th>Materia</th><th>Créditos</th>
          <th>Cuatrimestre</th><th>Calificación</th><th>Tipo evaluación</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <footer class="kx-foot">
        Generado el ${esc(today)} con la información del Sistema Integral de Información.
        Este documento es solo para consulta y no sustituye al kardex oficial; para trámites
        solicítalo en la Dirección de Servicios Estudiantiles.
      </footer>`;

    const title = document.title;
    document.title = `Kardex ${st.matricula || ''} (consulta)`.trim();
    const done = () => { document.title = title; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    const img = box.querySelector('img');
    const go = () => window.print();
    if (img && !img.complete) { img.addEventListener('load', go, { once: true }); img.addEventListener('error', go, { once: true }); } else go();
  }

  // ----------------------------------------------------------- Piezas
  function gradeChip(g, big = false) {
    const cls = typeof g === 'number' ? gradeClass(g) : g ? 'g-low' : 'is-none';
    return `<span class="sk-de-grade${big ? ' is-big' : ''} ${cls}">${g == null ? '—' : esc(String(g))}</span>`;
  }
  // Solo se marca cuando no es un curso ordinario (evaluación final, colocación, extraordinario…)
  function typeTag(t) {
    if (!t || /^curso ordinario$/i.test(t)) return '';
    const warn = /extraordinario|regularizaci|especial/i.test(t);
    return `<em class="sk-de-tag${warn ? ' is-warn' : ''}" title="Tipo de evaluación">${esc(t)}</em>`;
  }
  function bar(pct) {
    return `<div class="sk-de-bar"><i style="width:${Math.max(0, Math.min(100, pct)).toFixed(1)}%"></i></div>`;
  }

  // ----------------------------------------------------------- Utilidades
  function toDoc(html) { return new DOMParser().parseFromString(html, 'text/html'); }
  function nums(list) { return list.map((x) => x.grade).filter((g) => typeof g === 'number'); }
  function mean(a) { return a.reduce((x, y) => x + y, 0) / a.length; }
  function groupBy(list, key) {
    const m = new Map();
    list.forEach((x) => { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); });
    return [...m.entries()];
  }
  function gradeClass(v) {
    if (v >= 9.5) return 'g-10';
    if (v >= 8.5) return 'g-9';
    if (v >= 7.5) return 'g-8';
    if (v >= 7) return 'g-7';
    return 'g-low';
  }
  function fmt(v) { return Number(v).toFixed(2); }
  function num(v) { return Number.isInteger(v) ? String(v) : Number(v).toFixed(2).replace(/0$/, ''); }
  function ordinal(n) { return n ? `${n}${n === 1 || n === 3 ? '.er' : '.º'} cuatrimestre` : ''; }
  const MONTHS = { enero: 'Ene', febrero: 'Feb', marzo: 'Mar', abril: 'Abr', mayo: 'May', junio: 'Jun', julio: 'Jul',
    agosto: 'Ago', septiembre: 'Sep', octubre: 'Oct', noviembre: 'Nov', diciembre: 'Dic' };
  // "SEPTIEMBRE - DICIEMBRE 2024" -> "Sep – Dic 2024"
  function period(s) {
    const m = /^([a-z]+)\s*-\s*([a-z]+)\s+(\d{4})$/.exec(norm(s));
    return m && MONTHS[m[1]] && MONTHS[m[2]] ? `${MONTHS[m[1]]} – ${MONTHS[m[2]]} ${m[3]}` : clean(s);
  }
  function clean(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
  function norm(s) { return clean(s).toLowerCase().normalize('NFD').replace(/\p{M}/gu, ''); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  const ACCENTS = { evaluacion: 'evaluación', colocacion: 'colocación', regularizacion: 'regularización', titulo: 'título' };
  // "EVALUACION FINAL CURSO ORDINARIO" -> "Evaluación final curso ordinario"
  function sentence(s) {
    const t = clean(s).toLowerCase().split(' ').map((w) => ACCENTS[w] || w).join(' ');
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  const KEEP_UPPER = /^(?:i{1,3}|iv|v|vi{0,3}|ix|x|tsu|ti)$/i;
  // Materias: "FUNDAMENTOS DE PROGRAMACIÓN" -> "Fundamentos de programación", "INGLES II" -> "Inglés II"
  function smartCase(s) {
    const words = clean(s).toLowerCase().split(' ').filter(Boolean);
    return words.map((w, i) => {
      if (KEEP_UPPER.test(w)) return w.toUpperCase();
      if (w === 'ingles') return i === 0 ? 'Inglés' : 'inglés';
      return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w;
    }).join(' ');
  }

  return { create, open };
})();
