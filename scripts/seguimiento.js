// Módulo "Seguimiento Cuatrimestral" rediseñado, con el horario como protagonista.
// La pestaña original es un contenedor (alumnos.php/inscripcion) con 3 sub-pestañas que cargan:
//   - horario-materias?iid=…   materias + horario semanal (cada clase trae "[HH:MM - HH:MM]")
//   - carga-academica?iid=…    parciales, finales, tutor y aviso de reinscripción
//   - seguimiento-cuatrimestral historial de cuatrimestres cursados
// Se descargan las tres y se presentan como: ahora/siguiente clase, horario semanal real
// (cada bloque del tamaño de su duración), calificaciones del periodo e historial.
// eslint-disable-next-line no-unused-vars
const SK_SEGUIMIENTO = (() => {
  const ICON = SK_ICON;
  // Paleta categórica validada (dataviz): orden fijo, uno por materia. Solo se usa como
  // acento; el texto siempre va en tinta normal y cada bloque lleva su nombre escrito.
  const COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
  const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const DAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

  // ---------------------------------------------------------------- API
  // href: dirección de la pestaña original (contenedor); load(url): descarga con la sesión.
  function create({ href, load, onOriginal }) {
    const el = document.createElement('div');
    el.id = 'sk-seg';
    el.className = 'sk-view';
    el.hidden = true;
    el._sk = { href, load, state: 'idle', timer: 0, data: null };
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-sg-original]')) onOriginal();
      if (e.target.closest('[data-sg-retry]')) { el._sk.state = 'idle'; open(el); }
      if (e.target.closest('[data-sg-login]')) window.top.location.reload();
      const copy = e.target.closest('[data-copy]');
      if (copy) {
        navigator.clipboard?.writeText(copy.dataset.copy).then(() => {
          copy.innerHTML = ICON.check;
          setTimeout(() => { copy.innerHTML = ICON.clipboard; }, 1500);
        });
      }
      const block = e.target.closest('[data-subj]');
      if (block && !e.target.closest('.sk-sg-subj')) focusSubject(el, block.dataset.subj);
    });
    return el;
  }

  async function open(el) {
    const s = el._sk;
    if (s.state === 'ready') return tick(el);
    if (s.state === 'loading') return;
    s.state = 'loading';
    el.innerHTML = skeleton();
    try {
      // 1) contenedor -> direcciones de las sub-pestañas
      const doc = toDoc(await s.load(s.href));
      const hrefs = {};
      doc.querySelectorAll('div[title][href]').forEach((d) => {
        const t = norm(d.getAttribute('title'));
        if (/horario/.test(t)) hrefs.horario = d.getAttribute('href');
        else if (/carga/.test(t)) hrefs.carga = d.getAttribute('href');
        else if (/cuatrimestre/.test(t)) hrefs.historial = d.getAttribute('href');
      });
      if (!hrefs.horario && !hrefs.carga) throw new Error('sin sub-pestañas');
      // 2) las tres en paralelo; si alguna falla, se muestra lo demás
      const [h, c, hi] = await Promise.all(['horario', 'carga', 'historial'].map((k) =>
        (hrefs[k] ? s.load(hrefs[k]).then(toDoc).catch(() => null) : Promise.resolve(null))));
      const data = build(h, c, hi);
      if (!data.subjects.length) throw new Error('sin materias');
      s.data = data;
      el.innerHTML = render(data);
      wireSchedule(el);
      s.state = 'ready';
      tick(el);
      clearInterval(s.timer);
      // Cada segundo: contador. Cada minuto: agenda, línea de "ahora" y estado de la tarjeta.
      s.timer = setInterval(() => {
        if (el.hidden) return;
        if (new Date().getSeconds() === 0) tick(el);
        else countdown(el);
      }, 1000);
    } catch (err) {
      s.state = 'error';
      el.innerHTML = err?.session ? `
        <div class="sk-sg-wrap"><div class="sk-sg-card sk-sg-error">
          ${ICON.lock}
          <div><strong>Tu sesión del SII expiró</strong>
          <p>Vuelve a iniciar sesión para ver tu información.</p></div>
          <button type="button" class="is-primary" data-sg-login>Iniciar sesión</button>
        </div></div>` : `
        <div class="sk-sg-wrap"><div class="sk-sg-card sk-sg-error">
          ${ICON.alert}
          <div><strong>No se pudo preparar el seguimiento cuatrimestral</strong>
          <p>Puedes intentarlo de nuevo o abrir la vista original del SII.</p></div>
          <button type="button" data-sg-retry>Reintentar</button>
          <button type="button" data-sg-original class="is-primary">Ver vista original</button>
        </div></div>`;
    }
  }

  // ------------------------------------------------------------- Lectura
  function build(horarioDoc, cargaDoc, histDoc) {
    const subjects = [];
    const byKey = new Map();
    const add = (name, extra) => {
      const key = norm(name);
      if (!key) return null;
      let s = byKey.get(key);
      if (!s) {
        s = { key, name: smartCase(name), clave: '', aula: '', grupo: '', prof: '', grades: {}, sessions: [] };
        byKey.set(key, s);
        subjects.push(s);
      }
      Object.entries(extra || {}).forEach(([k, v]) => { if (v && !s[k]) s[k] = v; });
      return s;
    };

    let period = '';
    let tutor = '';
    let tutorMail = '';
    let notice = null;

    // Carga académica: materias + parciales/finales + tutor + aviso
    if (cargaDoc) {
      const h4 = clean(cargaDoc.querySelector('h4')?.textContent);
      h4.split('|').map(clean).forEach((part) => {
        const [k, ...v] = part.split(':');
        const val = clean(v.join(':'));
        if (/carga/i.test(k)) period = val;
        else if (/tutor/i.test(k)) tutor = val;
        else if (/correo/i.test(k)) tutorMail = val.toLowerCase();
      });
      cargaDoc.querySelectorAll('#tblMaterias tr, table.grid tr').forEach((tr) => {
        if (tr.closest('thead') || tr.cells.length < 13) return;
        const c = [...tr.cells].map((td) => clean(td.textContent));
        const s = add(c[2], { clave: c[1], aula: c[3], grupo: c[4], prof: titleCase(c[5]) });
        if (s) s.grades = { P1: c[6], P2: c[7], P3: c[8], PF1: c[9], PF2: c[10], PF3: c[11], final: c[12] };
      });
      const box = cargaDoc.querySelector('.notice');
      if (box) {
        notice = {
          title: clean(box.querySelector('legend')?.textContent) || 'Aviso',
          text: clean(box.querySelector('p')?.textContent),
          reasons: [...box.querySelectorAll('li')].map((li) => clean(li.textContent)).filter(Boolean),
        };
      }
    }

    // Horario: materias (aula/profesor) + sesiones por día
    if (horarioDoc) {
      if (!period) period = clean(horarioDoc.querySelector('h4')?.textContent).replace(/^.*?:\s*/, '');
      horarioDoc.querySelectorAll('#tblMaterias tr').forEach((tr) => {
        if (tr.closest('thead') || tr.cells.length < 6) return;
        const c = [...tr.cells].map((td) => clean(td.textContent));
        add(c[2], { clave: c[1], aula: c[3], grupo: c[4], prof: titleCase(c[5]) });
      });
      const grid = horarioDoc.querySelector('table.horario');
      if (grid) {
        const rows = [...grid.querySelectorAll('tr')];
        const days = [...rows[0].querySelectorAll('th')].slice(1).map((th) => dayIndex(th.textContent));
        rows.slice(1).forEach((tr) => {
          [...tr.querySelectorAll('td')].forEach((td, i) => {
            const range = /\[\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*\]/.exec(td.textContent);
            if (!range) return;
            const name = clean(td.cloneNode(true).childNodes[0]?.textContent || td.textContent.split('[')[0]);
            const s = add(name);
            if (!s) return;
            s.sessions.push({
              day: days[i],
              start: +range[1] * 60 + +range[2],
              end: +range[3] * 60 + +range[4],
            });
          });
        });
      }
    }

    subjects.forEach((s, i) => {
      s.color = COLORS[i % COLORS.length];
      s.sessions.sort((a, b) => a.day - b.day || a.start - b.start);
      s.minutes = s.sessions.reduce((n, x) => n + (x.end - x.start), 0);
    });

    // Historial de cuatrimestres
    const history = [];
    histDoc?.querySelectorAll('#tblCuatrimestres tr, table.grid tr').forEach((tr) => {
      if (tr.closest('thead') || tr.cells.length < 10) return;
      const c = [...tr.cells];
      const t = (i) => clean(c[i].textContent);
      history.push({
        period: titleCase(t(2)),
        type: clean(c[3].getAttribute('title')) || t(3),
        grupo: t(5),
        number: t(6),
        subjects: t(7),
        avg: parseFloat(t(8)),
        status: clean(c[9].getAttribute('title')) || t(9),
      });
    });
    const current = history.find((h) => norm(h.period).replace(/\s/g, '') === norm(period).replace(/\s/g, '')) || history.at(-1);

    return { subjects, period: titleCase(period), tutor: titleCase(tutor), tutorMail, notice, history, current };
  }

  // ------------------------------------------------------------- Dibujo
  function render(d) {
    const sessions = d.subjects.flatMap((s) => s.sessions);
    const weekMin = sessions.reduce((n, x) => n + (x.end - x.start), 0);
    const graded = d.subjects.map((s) => ({ s, avg: partialAvg(s) })).filter((x) => x.avg != null);
    const periodAvg = graded.length ? graded.reduce((a, x) => a + x.avg, 0) / graded.length : null;
    const captured = d.subjects.reduce((n, s) => n + ['P1', 'P2', 'P3'].filter((k) => s.grades[k]).length, 0);
    const lowest = graded.length ? graded.reduce((a, b) => (b.avg < a.avg ? b : a)) : null;

    return `
      <div class="sk-sg-wrap">
        <header class="sk-sg-head">
          <div>
            <span class="sk-sg-eyebrow">Periodo actual</span>
            <h1>${esc(d.period || 'Cuatrimestre actual')}</h1>
            <p>${[
              d.current?.number && `${esc(d.current.number)}.º cuatrimestre`,
              d.current?.grupo && `Grupo ${esc(d.current.grupo)}`,
              `${d.subjects.length} materias`,
              weekMin && `${hours(weekMin)} de clase por semana`,
            ].filter(Boolean).join(' · ')}</p>
          </div>
          ${d.tutor ? `
          <div class="sk-sg-tutor">
            <span class="sk-sg-tutor-ic">${ICON.user}</span>
            <div><small>Tutor(a)</small><strong>${esc(d.tutor)}</strong>
              ${d.tutorMail ? `<span class="sk-sg-mail">${esc(d.tutorMail)}<button type="button" class="sk-sg-icon" data-copy="${esc(d.tutorMail)}" aria-label="Copiar correo">${ICON.clipboard}</button></span>` : ''}
            </div>
          </div>` : ''}
        </header>

        <section class="sk-sg-today">
          <div class="sk-sg-now" data-now></div>
          <div class="sk-sg-agenda">
            <h3 data-agenda-title>Hoy</h3>
            <ol data-agenda></ol>
          </div>
        </section>

        <section class="sk-sg-card sk-sg-schedule">
          <header>
            <h2>${ICON.calendar}Horario semanal</h2>
            <p>Cada bloque ocupa el tiempo real de la clase. Toca uno para ver la materia.</p>
          </header>
          ${scheduleGrid(d.subjects)}
        </section>

        <section class="sk-sg-section">
          <div class="sk-sg-section-head">
            <h2>Calificaciones del periodo</h2>
            <span>${periodAvg != null ? `Promedio parcial actual <b>${fmt(periodAvg)}</b> · ` : ''}${captured} de ${d.subjects.length * 3} parciales capturados</span>
          </div>
          <div class="sk-sg-subjects">
            ${d.subjects.map((s, i) => subjectCard(s, i, lowest && lowest.s === s && lowest.avg < 8)).join('')}
          </div>
        </section>

        ${d.notice ? `
        <section class="sk-sg-card sk-sg-notice">
          ${ICON.alert}
          <div>
            <strong>${esc(d.notice.title.replace(/[¡!]/g, '') || 'Aviso')} · Reinscripción</strong>
            <p>${esc(d.notice.text)}</p>
            ${d.notice.reasons.length
              ? `<ul>${d.notice.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`
              : '<p class="sk-sg-muted">El SII no indicó los motivos. Si necesitas reinscribirte, consulta con Servicios Escolares o con tu tutor(a).</p>'}
          </div>
        </section>` : ''}

        ${d.history.length ? `
        <section class="sk-sg-card sk-sg-history">
          <header><h2>${ICON.graduation}Cuatrimestres cursados</h2></header>
          <div class="sk-sg-table">
            <table>
              <thead><tr><th>Periodo</th><th>Cuatrimestre</th><th>Grupo</th><th>Inscripción</th><th>Materias</th><th>Promedio</th><th>Estatus</th></tr></thead>
              <tbody>
                ${d.history.map((h) => `
                  <tr${h === d.current ? ' class="is-current"' : ''}>
                    <td>${esc(h.period)}</td>
                    <td>${esc(h.number)}.º</td>
                    <td>${esc(h.grupo)}</td>
                    <td>${esc(titleCase(h.type))}</td>
                    <td>${esc(h.subjects)}</td>
                    <td>${h === d.current && !h.avg ? '<span class="sk-sg-pill is-current">En curso</span>' : `<b>${fmt(h.avg)}</b>`}</td>
                    <td><span class="sk-sg-pill">${esc(titleCase(h.status))}</span></td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </section>` : ''}

        <p class="sk-sg-foot">
          Información tomada del SII.
          <button type="button" data-sg-original>Ver vista original</button>
        </p>
      </div>`;
  }

  // Horario: columnas Lun–Vie (+ Sáb solo si hay clases), filas por hora.
  const PPM = 1.15; // píxeles por minuto (~69 px por hora)
  function scheduleGrid(subjects) {
    const all = subjects.flatMap((s, i) => s.sessions.map((x) => ({ ...x, s, i })));
    if (!all.length) return '<p class="sk-sg-muted sk-sg-empty">El SII no tiene horario registrado para este periodo.</p>';
    const days = [1, 2, 3, 4, 5];
    if (all.some((x) => x.day === 6)) days.push(6);
    if (all.some((x) => x.day === 0)) days.push(0);
    const from = Math.floor(Math.min(...all.map((x) => x.start)) / 60) * 60;
    const to = Math.ceil(Math.max(...all.map((x) => x.end)) / 60) * 60;
    const height = (to - from) * PPM;
    const hoursList = [];
    for (let m = from; m <= to; m += 60) hoursList.push(m);

    return `
      <div class="sk-sg-week" style="--cols:${days.length}" data-from="${from}" data-to="${to}">
        <div class="sk-sg-week-head">
          <span></span>
          ${days.map((d) => `<span class="sk-sg-day" data-day="${d}"><b>${DAY_SHORT[d]}</b><small>${DAYS[d]}</small></span>`).join('')}
        </div>
        <div class="sk-sg-week-body" style="height:${height}px">
          <div class="sk-sg-hours">
            ${hoursList.map((m) => `<span style="top:${(m - from) * PPM}px">${clock(m)}</span>`).join('')}
          </div>
          ${days.map((d) => `
            <div class="sk-sg-col" data-day="${d}">
              ${hoursList.map((m) => `<i class="sk-sg-line" style="top:${(m - from) * PPM}px"></i>`).join('')}
              ${all.filter((x) => x.day === d).map((x) => {
                const h = (x.end - x.start) * PPM;
                return `
                <button type="button" class="sk-sg-block${h < 70 ? ' is-short' : ''}" data-subj="${x.i}"
                  style="top:${(x.start - from) * PPM}px;height:${h - 3}px;--c:${x.s.color}"
                  data-tip="${esc(x.s.name)}|${clock(x.start)} – ${clock(x.end)}|${esc(x.s.aula ? `Aula ${x.s.aula}` : '')}|${esc(x.s.prof)}">
                  <strong>${esc(x.s.name)}</strong>
                  <span>${clock(x.start)} – ${clock(x.end)}${x.s.aula ? ` · ${esc(x.s.aula)}` : ''}</span>
                </button>`;
              }).join('')}
            </div>`).join('')}
          <div class="sk-sg-nowline" hidden><span></span></div>
        </div>
        <div class="sk-sg-tip" role="tooltip"></div>
      </div>`;
  }

  function subjectCard(s, i, warn) {
    const avg = partialAvg(s);
    const cell = (k, label) => {
      const v = s.grades[k];
      const n = parseFloat(v);
      return `<div class="sk-sg-grade${v ? '' : ' is-empty'}${!Number.isNaN(n) && n < 8 ? ' is-low' : ''}"><small>${label}</small><b>${v ? esc(trim0(v)) : '—'}</b></div>`;
    };
    const hasFinals = ['PF1', 'PF2', 'PF3'].some((k) => s.grades[k]);
    const days = groupSessions(s.sessions);
    return `
      <article class="sk-sg-subj" id="sk-sg-subj-${i}" style="--c:${s.color}">
        <header>
          <div>
            <h3>${esc(s.name)}</h3>
            <p>${esc(s.prof || 'Profesor por asignar')}</p>
          </div>
          ${s.grades.final ? `<div class="sk-sg-final"><small>Final</small><b>${esc(trim0(s.grades.final))}</b></div>`
            : avg != null ? `<div class="sk-sg-final is-partial"><small>Actual</small><b>${fmt(avg)}</b></div>` : ''}
        </header>
        <div class="sk-sg-meta">
          ${s.aula ? `<span>${ICON.dashboard}Aula ${esc(s.aula)}</span>` : ''}
          ${s.grupo ? `<span>${ICON.user}${esc(s.grupo)}</span>` : ''}
          ${s.minutes ? `<span>${ICON.calendar}${hours(s.minutes)}/semana</span>` : ''}
          ${s.clave ? `<span class="sk-sg-clave">${esc(s.clave)}</span>` : ''}
        </div>
        ${days.length ? `<div class="sk-sg-when">${days.map((g) => `<span><b>${g.days}</b> ${g.time}</span>`).join('')}</div>` : ''}
        <div class="sk-sg-grades">
          ${cell('P1', '1.er parcial')}${cell('P2', '2.º parcial')}${cell('P3', '3.er parcial')}
          ${hasFinals ? `${cell('PF1', 'Final 1')}${cell('PF2', 'Final 2')}${cell('PF3', 'Final 3')}` : ''}
        </div>
        ${warn ? '<p class="sk-sg-warn">Es tu calificación más baja del periodo.</p>' : ''}
      </article>`;
  }

  // "Lun, Mié 17:20 – 19:00" agrupando días con el mismo horario
  function groupSessions(sessions) {
    const map = new Map();
    sessions.forEach((x) => {
      const key = `${clock(x.start)} – ${clock(x.end)}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(DAY_SHORT[x.day]);
    });
    return [...map].map(([time, ds]) => ({ time, days: ds.join(', ') }));
  }

  // ------------------------------------------------------------- Interacción
  function wireSchedule(el) {
    const week = el.querySelector('.sk-sg-week');
    if (!week) return;
    const tip = week.querySelector('.sk-sg-tip');
    week.querySelectorAll('.sk-sg-block').forEach((b) => {
      b.addEventListener('pointerenter', () => {
        const [name, time, aula, prof] = b.dataset.tip.split('|');
        tip.innerHTML = `<strong>${name}</strong><span>${time}${aula ? ` · ${aula}` : ''}</span>${prof ? `<span>${prof}</span>` : ''}`;
        const wr = week.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        tip.style.left = `${br.left - wr.left + br.width / 2}px`;
        tip.style.top = `${br.top - wr.top}px`;
        tip.classList.add('is-visible');
      });
      b.addEventListener('pointerleave', () => tip.classList.remove('is-visible'));
    });
  }

  function focusSubject(el, i) {
    const card = el.querySelector(`#sk-sg-subj-${i}`);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.remove('is-flash');
    void card.offsetWidth;
    card.classList.add('is-flash');
  }

  // Contador: se actualiza cada segundo. Al llegar a cero recalcula todo (la clase empezó o terminó).
  function countdown(el) {
    const c = el._sk.countdown;
    const box = el.querySelector('[data-digits]');
    if (!c || !box) return;
    const now = Date.now();
    let left = Math.max(0, Math.round((c.target - now) / 1000));
    if (left === 0) {
      if (!c.done) { c.done = true; setTimeout(() => tick(el), 1000); }
      return;
    }
    const d = Math.floor(left / 86400); left -= d * 86400;
    const h = Math.floor(left / 3600); left -= h * 3600;
    const m = Math.floor(left / 60);
    const s = left - m * 60;
    const seg = (v, u) => `<span><b>${String(v).padStart(2, '0')}</b><i>${u}</i></span>`;
    box.innerHTML = d > 0 ? seg(d, d === 1 ? 'día' : 'días') + seg(h, 'h') + seg(m, 'min')
      : h > 0 ? seg(h, 'h') + seg(m, 'min') + seg(s, 's') : seg(m, 'min') + seg(s, 's');
    const bar = el.querySelector('[data-progress]');
    if (bar && c.start) bar.style.width = `${Math.min(100, ((now - c.start) / (c.target - c.start)) * 100).toFixed(2)}%`;
  }

  // Actualiza "ahora / siguiente", la agenda de hoy y la línea de la hora actual.
  function tick(el) {
    const d = el._sk.data;
    if (!d) return;
    const now = new Date();
    const today = now.getDay();
    const mins = now.getHours() * 60 + now.getMinutes();
    const all = d.subjects.flatMap((s) => s.sessions.map((x) => ({ ...x, s })));
    const todays = all.filter((x) => x.day === today).sort((a, b) => a.start - b.start);
    const current = todays.find((x) => x.start <= mins && mins < x.end);
    const nextToday = todays.find((x) => x.start > mins);

    let next = null;
    let inDays = 0;
    if (!current && !nextToday) {
      for (let k = 1; k <= 7 && !next; k++) {
        const day = (today + k) % 7;
        next = all.filter((x) => x.day === day).sort((a, b) => a.start - b.start)[0] || null;
        inDays = k;
      }
    }

    // Tarjeta principal: información a la izquierda y contador grande a la derecha.
    // La tarjeta toma el color de la materia (el mismo de su bloque en el horario).
    const nowBox = el.querySelector('[data-now]');
    const where = (x) => [x.s.aula && `Aula ${esc(x.s.aula)}`, x.s.prof && esc(x.s.prof)].filter(Boolean).join(' · ');
    const at = (dayOffset, minute) => {
      const t = new Date(now);
      t.setDate(t.getDate() + dayOffset);
      t.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
      return t;
    };
    const card = (x, label, live, timeLine, target, countLabel) => {
      nowBox.style.setProperty('--c', x.s.color);
      nowBox.classList.add('has-subject');
      el._sk.countdown = { target: target.getTime(), start: live ? at(0, x.start).getTime() : 0 };
      nowBox.innerHTML = `
        <div class="sk-sg-now-info">
          <span class="sk-sg-now-label${live ? ' is-live' : ''}">${live ? '<i></i>' : ''}${label}</span>
          <h2>${esc(x.s.name)}</h2>
          <p>${where(x)}</p>
          <p class="sk-sg-now-time">${timeLine}</p>
          ${live ? '<div class="sk-sg-progress"><i data-progress></i></div>' : ''}
        </div>
        <div class="sk-sg-count" aria-live="off">
          <small>${countLabel}</small>
          <div class="sk-sg-digits" data-digits></div>
        </div>`;
    };

    if (current) {
      card(current, 'En clase ahora', true, `${clock(current.start)} – ${clock(current.end)}`, at(0, current.end), 'Termina en');
    } else if (nextToday) {
      card(nextToday, 'Siguiente clase', false, `<b>Hoy a las ${clock(nextToday.start)}</b> · ${clock(nextToday.start)} – ${clock(nextToday.end)}`,
        at(0, nextToday.start), 'Empieza en');
    } else if (next) {
      const when = inDays === 1 ? 'Mañana' : `El ${DAYS[next.day].toLowerCase()}`;
      card(next, todays.length ? 'Terminaste por hoy' : 'Hoy no tienes clases', false,
        `<b>${when} a las ${clock(next.start)}</b>`, at(inDays, next.start), 'Tu siguiente clase en');
    } else {
      el._sk.countdown = null;
      nowBox.classList.remove('has-subject');
      nowBox.innerHTML = '<div class="sk-sg-now-info"><span class="sk-sg-now-label">Sin clases registradas</span><h2>No hay horario para este periodo</h2></div>';
    }
    countdown(el);

    // Agenda del día (o del siguiente día con clases)
    const agendaDay = todays.length ? today : next?.day;
    const list = all.filter((x) => x.day === agendaDay).sort((a, b) => a.start - b.start);
    let agendaTitle = 'Agenda';
    if (agendaDay === today) agendaTitle = `Hoy, ${DAYS[today].toLowerCase()}`;
    else if (agendaDay != null) agendaTitle = inDays === 1 ? `Mañana, ${DAYS[agendaDay].toLowerCase()}` : DAYS[agendaDay];
    el.querySelector('[data-agenda-title]').textContent = agendaTitle;
    el.querySelector('[data-agenda]').innerHTML = list.length ? list.map((x) => {
      const st = agendaDay !== today ? '' : x.end <= mins ? 'is-past' : x.start <= mins ? 'is-now' : '';
      return `<li class="${st}" style="--c:${x.s.color}">
        <time>${clock(x.start)}<small>${clock(x.end)}</small></time>
        <div><strong>${esc(x.s.name)}</strong><span>${x.s.aula ? `Aula ${esc(x.s.aula)}` : ''}</span></div>
      </li>`;
    }).join('') : '<li class="sk-sg-muted">Sin clases.</li>';

    // Día actual y línea de "ahora" en el horario
    const week = el.querySelector('.sk-sg-week');
    if (week) {
      week.querySelectorAll('[data-day]').forEach((n) => n.classList.toggle('is-today', +n.dataset.day === today));
      const from = +week.dataset.from;
      const to = +week.dataset.to;
      const line = week.querySelector('.sk-sg-nowline');
      const col = week.querySelector(`.sk-sg-col[data-day="${today}"]`);
      if (col && mins >= from && mins <= to) {
        line.hidden = false;
        line.style.top = `${(mins - from) * PPM}px`;
        line.style.left = `${col.offsetLeft}px`;
        line.style.width = `${col.offsetWidth}px`;
      } else {
        line.hidden = true;
      }
    }
  }

  function skeleton() {
    return `<div class="sk-sg-wrap">
      <div class="sk-sg-skel" style="height:90px"></div>
      <div class="sk-sg-skel" style="height:150px"></div>
      <div class="sk-sg-skel" style="height:520px"></div>
    </div>`;
  }

  // ----------------------------------------------------------- Utilidades
  function partialAvg(s) {
    const v = ['P1', 'P2', 'P3'].map((k) => parseFloat(s.grades[k])).filter((n) => !Number.isNaN(n));
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  }
  function toDoc(html) { return new DOMParser().parseFromString(html, 'text/html'); }
  function dayIndex(text) {
    const t = norm(text);
    const i = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'].findIndex((d) => t.startsWith(d));
    return i < 0 ? -1 : i;
  }
  function clock(m) { return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
  function hours(m) { const h = Math.floor(m / 60); const r = m % 60; return r ? `${h} h ${r} min` : `${h} h`; }
  function duration(m) { return m < 60 ? `${m} min` : hours(m); }
  function fmt(v) { return Number(v).toFixed(2); }
  function trim0(v) { const n = parseFloat(v); return Number.isNaN(n) ? v : fmt(n); }
  function clean(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
  function norm(s) { return clean(s).toLowerCase().normalize('NFD').replace(/\p{M}/gu, ''); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  const SMALL = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'en', 'el', 'a', 'para', 'por', 'con']);
  const KEEP_UPPER = /^(?:i{1,3}|iv|v|vi{0,3}|ix|x|tsu|ti)$/i;
  function titleCase(s) {
    return clean(s).toLowerCase().split(' ').map((w, i) => {
      if (KEEP_UPPER.test(w)) return w.toUpperCase();
      if (i > 0 && SMALL.has(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  }
  function smartCase(s) {
    return clean(s).toLowerCase().split(' ').map((w, i) => {
      if (KEEP_UPPER.test(w)) return w.toUpperCase();
      if (w === 'ingles') return i === 0 ? 'Inglés' : 'inglés';
      return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w;
    }).join(' ');
  }

  return { create, open };
})();
