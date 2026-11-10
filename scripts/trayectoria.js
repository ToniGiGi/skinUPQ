// Módulo "Trayectoria Escolar" rediseñado.
// Descarga la misma página que usa la pestaña original (alumno_informacion_general), la
// interpreta y la presenta como tablero: resumen, gráfica de promedio por cuatrimestre,
// historial oficial y tarjetas por cuatrimestre. Si no se puede interpretar, se muestra
// la vista original del SII.
// eslint-disable-next-line no-unused-vars
const SK_TRAYECTORIA = (() => {
  const ICON = SK_ICON;

  // ---------------------------------------------------------------- API
  function create({ load, onOriginal }) {
    const el = document.createElement('div');
    el.id = 'sk-tray';
    el.className = 'sk-view';
    el.hidden = true;
    el._sk = { load, onOriginal, state: 'idle' };
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-tr-original]')) onOriginal();
      if (e.target.closest('[data-tr-retry]')) { el._sk.state = 'idle'; open(el); }
      if (e.target.closest('[data-tr-login]')) window.top.location.reload();
    });
    return el;
  }

  async function open(el) {
    const s = el._sk;
    if (s.state !== 'idle') return; // ya cargado o cargando
    s.state = 'loading';
    el.innerHTML = skeleton();
    try {
      const data = parse(await s.load());
      if (!data.cycles.length) throw new Error('sin cuatrimestres');
      el.innerHTML = render(data);
      wireChart(el, data);
      s.state = 'ready';
    } catch (err) {
      s.state = 'error';
      el.innerHTML = err?.session ? `
        <div class="sk-tr-wrap"><div class="sk-tr-card sk-tr-error">
          ${ICON.lock}
          <div><strong>Tu sesión del SII expiró</strong>
          <p>Vuelve a iniciar sesión para ver tu información.</p></div>
          <button type="button" class="is-primary" data-tr-login>Iniciar sesión</button>
        </div></div>` : `
        <div class="sk-tr-wrap"><div class="sk-tr-card sk-tr-error">
          ${ICON.alert}
          <div><strong>No se pudo preparar la trayectoria</strong>
          <p>Puedes intentarlo de nuevo o abrir la vista original del SII.</p></div>
          <button type="button" data-tr-retry>Reintentar</button>
          <button type="button" data-tr-original class="is-primary">Ver vista original</button>
        </div></div>`;
    }
  }

  // ------------------------------------------------------------- Lectura
  function parse(source) {
    const doc = new DOMParser().parseFromString(source, 'text/html');
    const legendOf = (fs) => clean(fs.querySelector('legend')?.textContent);

    const cycles = [];
    doc.querySelectorAll('fieldset').forEach((fs) => {
      const title = legendOf(fs);
      if (!/ciclo/i.test(title)) return;
      const semesters = [...fs.querySelectorAll('table.grid')].map(parseSemester).filter(Boolean);
      if (semesters.length) cycles.push({ title, semesters });
    });

    const info = {};
    doc.querySelectorAll('table.admintable th').forEach((th) => {
      const td = th.nextElementSibling;
      if (td && td.tagName === 'TD') info[norm(th.textContent).replace(/:$/, '')] = clean(td.textContent);
    });

    const section = (re) => [...doc.querySelectorAll('fieldset')].find((fs) => re.test(legendOf(fs)));
    const bodyRows = (fs) => (fs ? [...fs.querySelectorAll('tr')].filter((tr) => tr.querySelector('td'))
      .map((tr) => [...tr.cells].map((c) => clean(c.textContent))) : []);

    const histFs = section(/historial de promedios/i);
    const history = bodyRows(histFs).filter((r) => r.length >= 2)
      .map(([period, value]) => ({ period: titleCase(period), value: parseFloat(value) }))
      .filter((h) => !Number.isNaN(h.value));
    const totalTh = histFs && [...histFs.querySelectorAll('th')].find((th) => /promedio total/i.test(th.textContent));
    const total = totalTh ? parseFloat(clean(totalTh.nextElementSibling?.textContent)) : NaN;

    const stays = bodyRows(section(/estancias/i)).filter((r) => r.length >= 6)
      .map((r) => ({ course: r[1], company: r[2], project: r[3], period: titleCase(r[4]), status: r[5] }));

    // Estado de cada cuatrimestre: concluido / en curso / por cursar.
    const all = cycles.flatMap((c) => c.semesters);
    all.forEach((s) => {
      const graded = s.subjects.filter((x) => x.grade !== null).length;
      s.state = graded === s.subjects.length ? 'done' : graded > 0 ? 'current' : 'upcoming';
    });
    if (!all.some((s) => s.state === 'current')) {
      const next = all.find((s) => s.state === 'upcoming');
      if (next && all.some((s) => s.state === 'done')) next.state = 'current';
    }
    // Estadías: se enlaza con su registro en "Estancias y Estadía" (empresa, proyecto).
    all.forEach((s) => {
      if (s.subjects.length === 1 && /estad[ií]a/i.test(s.subjects[0].name)) {
        const key = /tsu/i.test(s.subjects[0].name) ? /tsu/i : /ingenier|licenciatura/i;
        s.stay = stays.find((st) => key.test(st.course)) || null;
      }
    });

    return { cycles, info, history, total, stays };
  }

  function parseSemester(table) {
    const head = clean(table.querySelector('thead th')?.textContent);
    if (!/cuatrimestre/i.test(head)) return null;
    const subjects = [...table.querySelectorAll('tr')]
      .filter((tr) => !tr.closest('thead') && tr.cells.length >= 5)
      .map((tr) => {
        const c = [...tr.cells].map((td) => clean(td.textContent));
        const raw = c[2];
        const value = parseFloat(raw);
        const numeric = !Number.isNaN(value);
        const cls = tr.className || '';
        let state = 'pending';
        if (raw) {
          if (/no.?acredit|reprob/i.test(cls)) state = 'failed';
          else if (/acredit/i.test(cls)) state = 'passed';
          else state = numeric && value >= 7 ? 'passed' : 'failed';
        }
        return {
          name: smartCase(c[1]),
          grade: raw ? (numeric ? value : raw) : null,
          type: c[3],
          attempts: parseInt(c[4], 10) || 0,
          state,
        };
      });
    const nums = subjects.map((s) => s.grade).filter((g) => typeof g === 'number');
    return {
      n: parseInt(head, 10) || 0,
      label: ordinal(parseInt(head, 10)) || head,
      subjects,
      avg: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null,
    };
  }

  // ------------------------------------------------------------- Dibujo
  function render(d) {
    const all = d.cycles.flatMap((c) => c.semesters);
    const subjects = all.flatMap((s) => s.subjects);
    const passed = subjects.filter((s) => s.state === 'passed').length;
    const failed = subjects.filter((s) => s.state === 'failed').length;
    const graded = subjects.filter((s) => typeof s.grade === 'number');
    const computedAvg = graded.length ? graded.reduce((a, s) => a + s.grade, 0) / graded.length : null;
    const avg = Number.isNaN(d.total) ? computedAvg : d.total;

    const creditsTotal = parseFloat(d.info['creditos carrera']);
    const creditsDone = parseFloat(d.info['creditos aprobados']);
    const creditsPct = creditsTotal > 0 ? (creditsDone / creditsTotal) * 100 : NaN;
    const current = all.find((s) => s.state === 'current');
    const doneCount = all.filter((s) => s.state === 'done').length;

    const bar = (pct) => `<div class="sk-tr-bar"><i style="width:${Math.max(0, Math.min(100, pct)).toFixed(1)}%"></i></div>`;
    const tile = (label, value, extra = '', sub = '') => `
      <div class="sk-tr-tile"><span>${label}</span><strong>${value}</strong>${sub ? `<small>${sub}</small>` : ''}${extra}</div>`;

    return `
      <div class="sk-tr-wrap">
        <section class="sk-tr-tiles">
          ${tile('Promedio general', avg != null ? fmt(avg) : '—', avg != null ? bar((avg / 10) * 100) : '', Number.isNaN(d.total) ? 'Calculado' : 'Oficial del SII')}
          ${tile('Créditos aprobados', Number.isNaN(creditsDone) ? '—' : `${creditsDone}<em> / ${creditsTotal || '—'}</em>`,
            Number.isNaN(creditsPct) ? '' : bar(creditsPct), Number.isNaN(creditsPct) ? '' : `${creditsPct.toFixed(1)}% de la carrera`)}
          ${tile('Materias acreditadas', `${passed}<em> / ${subjects.length}</em>`, bar((passed / Math.max(1, subjects.length)) * 100),
            failed ? `${failed} no acreditada${failed > 1 ? 's' : ''}` : 'Ninguna no acreditada')}
          ${tile('Avance', current ? `${current.label}` : `${doneCount} de ${all.length}`,
            `<div class="sk-tr-steps">${all.map((s) => `<i class="is-${s.state}" title="${esc(s.label)}"></i>`).join('')}</div>`,
            current ? `En curso · ${doneCount} de ${all.length} concluidos` : 'cuatrimestres concluidos')}
        </section>

        <section class="sk-tr-card sk-tr-chartcard">
          <div class="sk-tr-chart">
            <header>
              <h2>${ICON.chart}Promedio por cuatrimestre</h2>
              <p>Promedio de las calificaciones de cada cuatrimestre${avg != null ? ` · la línea punteada es tu promedio general (${fmt(avg)})` : ''}.</p>
            </header>
            <div class="sk-tr-plot"></div>
          </div>
          ${d.history.length ? `
          <aside class="sk-tr-history">
            <h3>Historial oficial</h3>
            <p>Promedios registrados por el SII en cada periodo.</p>
            <ol>
              ${d.history.map((h) => `<li><span>${esc(h.period)}</span><b>${fmt(h.value)}</b></li>`).join('')}
            </ol>
            ${Number.isNaN(d.total) ? '' : `<div class="sk-tr-history-total"><span>Promedio total</span><b>${fmt(d.total)}</b></div>`}
          </aside>` : ''}
        </section>

        ${d.cycles.map((c) => {
          const nums = c.semesters.flatMap((s) => s.subjects).map((s) => s.grade).filter((g) => typeof g === 'number');
          const cAvg = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
          return `
          <section class="sk-tr-cycle">
            <div class="sk-tr-cycle-head">
              <h2>${esc(c.title)}</h2>
              <span>${c.semesters.length} cuatrimestre${c.semesters.length > 1 ? 's' : ''}${cAvg != null ? ` · promedio ${fmt(cAvg)}` : ''}</span>
            </div>
            <div class="sk-tr-grid">${c.semesters.map(semesterCard).join('')}</div>
          </section>`;
        }).join('')}

        <p class="sk-tr-foot">
          Información tomada del SII. Los promedios por cuatrimestre se calculan con las calificaciones de cada materia
          y pueden diferir del oficial si el SII pondera por créditos.
          <button type="button" data-tr-original>Ver vista original</button>
        </p>
      </div>`;
  }

  const STATE_LABEL = { done: 'Concluido', current: 'En curso', upcoming: 'Por cursar' };

  function semesterCard(s) {
    const head = `
      <header>
        <div>
          <h3>${esc(s.label)}</h3>
          <span class="sk-tr-badge is-${s.state}">${STATE_LABEL[s.state]}</span>
        </div>
        <div class="sk-tr-avg ${s.avg != null ? gradeClass(s.avg) : 'is-none'}">
          <strong>${s.avg != null ? fmt(s.avg) : '—'}</strong><small>promedio</small>
        </div>
      </header>`;

    // Estadía: una sola "materia" con la calificación del periodo; se muestra la empresa.
    if (s.subjects.length === 1 && /estad[ií]a/i.test(s.subjects[0].name)) {
      const x = s.subjects[0];
      const st = s.stay;
      return `
        <article class="sk-tr-sem is-${s.state} is-stay">
          ${head}
          <div class="sk-tr-stay">
            <div class="sk-tr-stay-title">${ICON.briefcase}<div><strong>${esc(x.name)}</strong>
              <span>${st ? esc(titleCase(st.status)) : STATE_LABEL[s.state]}${st?.period ? ` · ${esc(st.period)}` : ''}</span></div></div>
            ${st?.company ? `<p class="sk-tr-company"><small>Empresa</small>${esc(titleCase(st.company))}</p>` : ''}
            ${st?.project ? `<details><summary>Ver proyecto</summary><p>${esc(st.project)}</p></details>` : ''}
          </div>
        </article>`;
    }

    return `
      <article class="sk-tr-sem is-${s.state}">
        ${head}
        <ul>
          ${s.subjects.map((x) => `
            <li class="is-${x.state}">
              <div class="sk-tr-subj">
                <span>${esc(x.name)}</span>
                ${x.attempts > 1 ? `<em class="sk-tr-tag is-warn" title="Número de intentos">${x.attempts}.º intento</em>` : ''}
                ${x.type && x.type !== '1' ? `<em class="sk-tr-tag" title="Tipo de evaluación registrado en el SII">Eval. tipo ${esc(x.type)}</em>` : ''}
              </div>
              <span class="sk-tr-grade ${typeof x.grade === 'number' ? gradeClass(x.grade) : x.state === 'failed' ? 'g-low' : 'is-none'}">${x.grade == null ? '—' : esc(String(x.grade))}</span>
            </li>`).join('')}
        </ul>
        <footer>${s.subjects.length} materia${s.subjects.length > 1 ? 's' : ''}${s.state === 'current'
          ? ` · ${s.subjects.filter((x) => x.grade != null).length} calificada${s.subjects.filter((x) => x.grade != null).length === 1 ? '' : 's'}` : ''}</footer>
      </article>`;
  }

  // Gráfica de línea: una sola serie (promedio por cuatrimestre), eje Y acotado porque es
  // una línea (no barras), referencia punteada con el promedio general y tooltip por punto.
  function wireChart(root, d) {
    const host = root.querySelector('.sk-tr-plot');
    const all = d.cycles.flatMap((c) => c.semesters);
    const pts = all.map((s, i) => ({ s, i })).filter((p) => p.s.avg != null);
    if (!pts.length) { host.innerHTML = '<p class="sk-tr-empty">Aún no hay calificaciones.</p>'; return; }

    const W = 640, H = 230, L = 40, R = 18, T = 24, B = 34;
    const graded = all.flatMap((s) => s.subjects).filter((x) => typeof x.grade === 'number');
    const general = Number.isNaN(d.total) ? graded.reduce((a, x) => a + x.grade, 0) / graded.length : d.total;
    const min = Math.min(...pts.map((p) => p.s.avg), general);
    const lo = Math.max(0, Math.floor((min - 0.25) * 2) / 2);
    const hi = 10;
    const x = (i) => L + (all.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (all.length - 1));
    const y = (v) => T + ((hi - v) / (hi - lo)) * (H - T - B);

    const ticks = [];
    for (let v = lo; v <= hi + 1e-9; v += 0.5) ticks.push(v);
    const line = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.s.avg).toFixed(1)}`).join(' ');
    const area = `${line} L${x(pts.at(-1).i).toFixed(1)},${y(lo)} L${x(pts[0].i).toFixed(1)},${y(lo)} Z`;
    const maxP = pts.reduce((a, b) => (b.s.avg > a.s.avg ? b : a));
    const minP = pts.reduce((a, b) => (b.s.avg < a.s.avg ? b : a));
    const labeled = new Set([maxP, minP, pts.at(-1)]); // etiquetas selectivas

    host.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Promedio por cuatrimestre">
        <defs>
          <linearGradient id="sk-tr-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stop-color="#2b4c78" stop-opacity=".16"/>
            <stop offset="1" stop-color="#2b4c78" stop-opacity="0"/>
          </linearGradient>
        </defs>
        ${ticks.map((v) => `
          <line class="sk-tr-gridline" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>
          <text class="sk-tr-axis" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v % 1 ? v.toFixed(1) : v}</text>`).join('')}
        ${all.map((s, i) => `<text class="sk-tr-axis${s.avg == null ? ' is-muted' : ''}" x="${x(i)}" y="${H - 10}" text-anchor="middle">${s.n || i + 1}.º</text>`).join('')}
        <line class="sk-tr-ref" x1="${L}" x2="${W - R}" y1="${y(general)}" y2="${y(general)}"/>
        <path class="sk-tr-area" d="${area}" fill="url(#sk-tr-fill)"/>
        <path class="sk-tr-line" d="${line}"/>
        ${pts.map((p) => `
          <circle class="sk-tr-dot" cx="${x(p.i)}" cy="${y(p.s.avg)}" r="4.5"/>
          ${labeled.has(p) ? `<text class="sk-tr-val" x="${x(p.i)}" y="${y(p.s.avg) - 11}" text-anchor="middle">${fmt(p.s.avg)}</text>` : ''}
          <circle class="sk-tr-hit" data-i="${p.i}" cx="${x(p.i)}" cy="${y(p.s.avg)}" r="18"/>`).join('')}
      </svg>
      <div class="sk-tr-tip" role="tooltip"></div>`;

    const tip = host.querySelector('.sk-tr-tip');
    const svgEl = host.querySelector('svg');
    host.querySelectorAll('.sk-tr-hit').forEach((c) => {
      const s = all[+c.dataset.i];
      const showTip = () => {
        const box = svgEl.getBoundingClientRect();
        const k = box.width / W;
        tip.innerHTML = `<strong>${esc(s.label)}</strong><span>Promedio <b>${fmt(s.avg)}</b></span>
          <span>${s.subjects.filter((x2) => x2.grade != null).length} materias calificadas</span>`;
        tip.style.left = `${+c.getAttribute('cx') * k}px`;
        tip.style.top = `${+c.getAttribute('cy') * k}px`;
        tip.classList.add('is-visible');
        host.querySelectorAll('.sk-tr-dot')[pts.findIndex((p) => p.s === s)]?.classList.add('is-hover');
      };
      const hide = () => {
        tip.classList.remove('is-visible');
        host.querySelectorAll('.sk-tr-dot.is-hover').forEach((n) => n.classList.remove('is-hover'));
      };
      c.addEventListener('pointerenter', showTip);
      c.addEventListener('pointerleave', hide);
    });
  }

  function skeleton() {
    return `<div class="sk-tr-wrap sk-tr-loading">
      <section class="sk-tr-tiles">${'<div class="sk-tr-tile sk-skel"></div>'.repeat(4)}</section>
      <section class="sk-tr-card sk-skel" style="height:280px"></section>
      <div class="sk-tr-grid">${'<div class="sk-tr-sem sk-skel" style="height:320px"></div>'.repeat(3)}</div>
    </div>`;
  }

  // ----------------------------------------------------------- Utilidades
  function gradeClass(v) {
    if (v >= 9.5) return 'g-10';
    if (v >= 8.5) return 'g-9';
    if (v >= 7.5) return 'g-8';
    if (v >= 7) return 'g-7';
    return 'g-low';
  }
  // 10 -> "10", 9.5 -> "9.5", 9.714 -> "9.71"
  // Promedios siempre con 2 decimales (9.00, 9.67, 10.00) para que se lean parejos.
  function fmt(v) { return Number(v).toFixed(2); }
  function ordinal(n) {
    if (!n) return '';
    const suf = n === 1 || n === 3 ? '.er' : '.º';
    return `${n}${suf} cuatrimestre`;
  }
  function clean(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
  function norm(s) { return clean(s).toLowerCase().normalize('NFD').replace(/\p{M}/gu, ''); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  const SMALL = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'en', 'el', 'a', 'para', 'por', 'con', 'o', 'u']);
  const KEEP_UPPER = /^(?:i{1,3}|iv|v|vi{0,3}|ix|x|tsu|ti|sa|cv)$/i;
  function titleCase(s) {
    return clean(s).toLowerCase().split(' ').map((w, i) => {
      if (KEEP_UPPER.test(w.replace(/[.,]/g, ''))) return w.toUpperCase();
      if (i > 0 && SMALL.has(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  }
  // Materias: "FUNDAMENTOS DE PROGRAMACIÓN" -> "Fundamentos de programación", "INGLES II" -> "Inglés II"
  function smartCase(s) {
    const words = clean(s).toLowerCase().split(' ');
    return words.map((w, i) => {
      if (KEEP_UPPER.test(w)) return w.toUpperCase();
      if (w === 'ingles') return i === 0 ? 'Inglés' : 'inglés';
      return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w;
    }).join(' ');
  }

  return { create, open };
})();
