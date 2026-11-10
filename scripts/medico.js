// Módulo "Seguimiento Médico" rediseñado.
// La pestaña original (seguimiento-medico) es una tabla th/td y un botón "Actualizar" que abre
// en una ventana el formulario oficial (home/ActualizaSeguimientoMedico/...); al cerrarla el SII
// vuelve a cargar los datos. Aquí se hace lo mismo con una ventana propia.
// eslint-disable-next-line no-unused-vars
const SK_MEDICO = (() => {
  const ICON = SK_ICON;
  // Compatibilidad de glóbulos rojos (información médica general, no viene del SII).
  const BLOOD = {
    'O-': { give: ['Todos los tipos'], take: ['O-'] },
    'O+': { give: ['O+', 'A+', 'B+', 'AB+'], take: ['O+', 'O-'] },
    'A-': { give: ['A-', 'A+', 'AB-', 'AB+'], take: ['A-', 'O-'] },
    'A+': { give: ['A+', 'AB+'], take: ['A+', 'A-', 'O+', 'O-'] },
    'B-': { give: ['B-', 'B+', 'AB-', 'AB+'], take: ['B-', 'O-'] },
    'B+': { give: ['B+', 'AB+'], take: ['B+', 'B-', 'O+', 'O-'] },
    'AB-': { give: ['AB-', 'AB+'], take: ['AB-', 'A-', 'B-', 'O-'] },
    'AB+': { give: ['AB+'], take: ['Todos los tipos'] },
  };
  const CONDITIONS = [
    [/enfermedad/, 'Enfermedades', 'stethoscope'],
    [/visual/, 'Discapacidad visual', 'eye'],
    [/auditiva/, 'Discapacidad auditiva', 'bell'],
    [/motriz/, 'Discapacidad motriz', 'users'],
  ];

  // ---------------------------------------------------------------- API
  function create({ href, load, onOriginal }) {
    const el = document.createElement('div');
    el.id = 'sk-medico';
    el.className = 'sk-view';
    el.hidden = true;
    el._sk = { href, load, onOriginal, state: 'idle', showNss: false, data: null };
    el.addEventListener('click', (e) => {
      const s = el._sk;
      const t = e.target;
      if (t.closest('[data-md-original]')) return onOriginal();
      if (t.closest('[data-md-retry]')) { s.state = 'idle'; return open(el); }
      if (t.closest('[data-md-login]')) return window.top.location.reload();
      if (t.closest('[data-md-nss]')) { s.showNss = !s.showNss; return draw(el); }
      if (t.closest('[data-md-update]')) return openForm(el);
      if (t.closest('[data-md-close]') || t.matches('.sk-md-modal')) return closeForm(el);
      const copy = t.closest('[data-copy]');
      if (copy) {
        navigator.clipboard?.writeText(copy.dataset.copy).then(() => {
          copy.innerHTML = ICON.check;
          copy.classList.add('is-done');
          setTimeout(() => { copy.innerHTML = ICON.clipboard; copy.classList.remove('is-done'); }, 1500);
        });
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !el.hidden && el.querySelector('.sk-md-modal')) closeForm(el);
    });
    return el;
  }

  async function open(el) {
    const s = el._sk;
    if (s.state === 'ready') { s.showNss = false; return draw(el); }
    if (s.state === 'loading') return;
    s.state = 'loading';
    el.innerHTML = skeleton();
    try {
      s.data = parse(await s.load(s.href));
      if (!s.data.fields.length) throw new Error('sin datos');
      s.state = 'ready';
      draw(el);
    } catch (err) {
      s.state = 'error';
      el.innerHTML = errorCard(err);
    }
  }

  function parse(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const fields = [];
    doc.querySelectorAll('th').forEach((th) => {
      const td = th.nextElementSibling;
      if (td?.tagName !== 'TD') return;
      const label = clean(th.textContent).replace(/:$/, '');
      fields.push({ key: norm(label), label, value: clean(td.textContent) });
    });
    const update = /src="([^"]*ActualizaSeguimientoMedico[^"]*)"/i.exec(html)?.[1] || '';
    return { fields, update };
  }

  async function refresh(el) {
    const s = el._sk;
    try {
      s.data = parse(await s.load(s.href));
      draw(el);
    } catch (err) {
      if (err?.session) el.innerHTML = errorCard(err);
    }
  }

  // ------------------------------------------------- Formulario oficial
  function openForm(el) {
    const url = el._sk.data?.update;
    if (!url) return;
    closeForm(el, false);
    const m = document.createElement('div');
    m.className = 'sk-md-modal';
    m.innerHTML = `
      <div class="sk-md-dialog" role="dialog" aria-modal="true" aria-label="Actualizar datos médicos">
        <header>
          <span class="sk-md-dialog-ic">${ICON.stethoscope}</span>
          <div><strong>Actualizar datos médicos</strong><small>Formulario oficial del SII</small></div>
          <button type="button" class="sk-md-x" data-md-close aria-label="Cerrar">${ICON.x}</button>
        </header>
        <iframe src="${esc(url)}" title="Actualizar datos médicos"></iframe>
      </div>`;
    el.append(m);
    m.querySelector('.sk-md-x').focus();
  }

  function closeForm(el, reload = true) {
    const m = el.querySelector('.sk-md-modal');
    if (!m) return;
    m.remove();
    if (reload) refresh(el);
  }

  // ------------------------------------------------------------- Dibujo
  function draw(el) {
    const top = el.scrollTop;
    el.innerHTML = render(el._sk);
    el.scrollTop = top;
  }

  function render(s) {
    const f = s.data.fields;
    const get = (re) => f.find((x) => re.test(x.key))?.value || '';
    const empty = (v) => !v || /^sin registro$|^ninguna?$|^no$/i.test(v);
    const nss = get(/^nss/);
    const insurance = get(/estatus seguro/);
    const active = /activo|vigente/i.test(insurance);
    const blood = bloodType(get(/sangre/));
    const comp = blood && BLOOD[blood];
    const used = new Set();
    const conditions = CONDITIONS.map(([re, label, icon]) => {
      const x = f.find((y) => re.test(y.key));
      if (x) used.add(x.key);
      return x ? { label, icon, value: x.value } : null;
    }).filter(Boolean);
    const others = f.filter((x) => !used.has(x.key) && !/^nss|estatus seguro|sangre/.test(x.key));
    const registered = conditions.filter((c) => !empty(c.value));
    const masked = nss ? `${'•'.repeat(Math.max(0, nss.length - 4))}${nss.slice(-4)}` : '';

    return `
      <div class="sk-md-wrap">
        <section class="sk-md-hero">
          <div class="sk-md-hero-text">
            <span>Seguimiento médico</span>
            <h1>Tu salud y tu seguro</h1>
            <p>Mantén estos datos al día: ayudan al servicio médico de la universidad en caso de emergencia.</p>
            ${s.data.update ? `<button type="button" class="sk-md-btn is-light" data-md-update>${ICON.pencil}Actualizar datos médicos</button>` : ''}
          </div>
          ${kitSvg()}
        </section>

        <div class="sk-md-grid">
          <section class="sk-md-card sk-md-insurance${active ? '' : ' is-off'}">
            <header><span class="sk-md-ic">${ICON.shield}</span><div><h2>Seguro facultativo</h2><small>IMSS</small></div>
              <span class="sk-md-status">${active ? ICON.check : ICON.alert}${esc(sentence(insurance) || 'Sin estatus')}</span></header>
            <div class="sk-md-nss">
              <small>Número de Seguridad Social (NSS)</small>
              <div class="sk-md-nss-row">
                <code>${nss ? esc(s.showNss ? groupNss(nss) : masked) : 'Sin registro'}</code>
                ${nss ? `
                <button type="button" class="sk-md-icon" data-md-nss aria-pressed="${s.showNss}" title="${s.showNss ? 'Ocultar' : 'Mostrar'} NSS">${s.showNss ? ICON.eyeOff : ICON.eye}</button>
                <button type="button" class="sk-md-icon" data-copy="${esc(nss)}" title="Copiar NSS">${ICON.clipboard}</button>` : ''}
              </div>
            </div>
            <p class="sk-md-note">${active
              ? 'Tu seguro está activo: puedes atenderte en tu Unidad de Medicina Familiar del IMSS.'
              : 'Tu seguro no aparece activo. Revisa el trámite de seguro facultativo en el Panel Principal.'}</p>
          </section>

          <section class="sk-md-card sk-md-blood">
            <header><span class="sk-md-ic is-red">${dropSvg()}</span><div><h2>Tipo de sangre</h2><small>Compatibilidad para transfusión</small></div></header>
            <div class="sk-md-blood-main">
              <div class="sk-md-drop">${dropSvg(true)}<b>${esc(blood || '—')}</b></div>
              ${comp ? `
              <dl>
                <div><dt>Puedes donar a</dt><dd>${comp.give.map((x) => `<span>${esc(x)}</span>`).join('')}</dd></div>
                <div><dt>Puedes recibir de</dt><dd>${comp.take.map((x) => `<span>${esc(x)}</span>`).join('')}</dd></div>
              </dl>` : '<p class="sk-md-note">Sin tipo de sangre registrado.</p>'}
            </div>
            ${comp ? '<p class="sk-md-fine">Compatibilidad general de glóbulos rojos; el personal médico siempre la confirma.</p>' : ''}
          </section>

          <section class="sk-md-card sk-md-conditions">
            <header><span class="sk-md-ic">${ICON.clipboard}</span><div><h2>Condiciones de salud</h2>
              <small>${registered.length ? `${registered.length} registrada${registered.length === 1 ? '' : 's'}` : 'Ninguna registrada'}</small></div></header>
            <ul>
              ${conditions.map((c) => `
                <li class="${empty(c.value) ? 'is-none' : 'is-on'}">
                  <span class="sk-md-cic">${ICON[c.icon]}</span>
                  <div><strong>${esc(c.label)}</strong><span>${empty(c.value) ? 'Sin registro' : esc(sentence(c.value))}</span></div>
                  ${empty(c.value) ? `<i>${ICON.check}</i>` : ''}
                </li>`).join('')}
              ${others.map((o) => `
                <li class="${empty(o.value) ? 'is-none' : 'is-on'}">
                  <span class="sk-md-cic">${ICON.file}</span>
                  <div><strong>${esc(sentence(o.label))}</strong><span>${esc(o.value || 'Sin registro')}</span></div>
                </li>`).join('')}
            </ul>
          </section>
        </div>

        <p class="sk-md-foot">Información tomada del SII. Para corregir algo usa “Actualizar datos médicos”: se abre el formulario oficial del sistema.
          <button type="button" data-md-original>Ver vista original</button></p>
      </div>`;
  }

  // Botiquín con medicinas (decorativo)
  function kitSvg() {
    return `<svg class="sk-md-kit" viewBox="0 0 260 180" aria-hidden="true">
      <ellipse cx="130" cy="168" rx="104" ry="8" fill="rgba(0,0,0,.2)"/>
      <path d="M100 42a10 10 0 0 1 10-10h40a10 10 0 0 1 10 10v10h-10v-8a2 2 0 0 0-2-2h-36a2 2 0 0 0-2 2v8h-10z" fill="#e8edf3"/>
      <rect x="44" y="50" width="172" height="112" rx="16" fill="#f8fafc"/>
      <rect x="44" y="50" width="172" height="26" rx="13" fill="#e2e8f0"/>
      <rect x="44" y="64" width="172" height="12" fill="#e2e8f0"/>
      <rect x="110" y="88" width="40" height="64" rx="6" fill="#d94b55"/>
      <rect x="98" y="100" width="64" height="40" rx="6" fill="#d94b55"/>
      <rect x="44" y="76" width="172" height="3" fill="#cbd5e1"/>
      <g transform="translate(196 92)">
        <rect x="0" y="12" width="40" height="62" rx="8" fill="#eda100"/>
        <rect x="4" y="0" width="32" height="16" rx="4" fill="#fff"/>
        <rect x="6" y="30" width="28" height="26" rx="4" fill="#fff" opacity=".9"/>
        <rect x="11" y="36" width="18" height="3" rx="1.5" fill="#cbd5e1"/>
        <rect x="11" y="43" width="12" height="3" rx="1.5" fill="#e2e8f0"/>
      </g>
      <g transform="translate(18 128) rotate(-28)">
        <rect width="46" height="18" rx="9" fill="#fff"/>
        <rect width="23" height="18" rx="9" fill="#2a78d6"/>
        <rect x="14" width="9" height="18" fill="#2a78d6"/>
      </g>
      <g transform="translate(60 150) rotate(16)">
        <rect width="34" height="13" rx="6.5" fill="#1baf7a"/>
        <rect x="17" width="17" height="13" rx="6.5" fill="#fff"/>
        <rect x="17" width="6" height="13" fill="#fff"/>
      </g>
      <circle cx="176" cy="160" r="9" fill="#fff"/><path d="M170 160h12" stroke="#e2e8f0" stroke-width="2"/>
      <g transform="translate(150 18) rotate(30)">
        <rect width="52" height="16" rx="5" fill="#f3d6b5"/>
        <rect x="18" y="2" width="16" height="12" rx="2" fill="#e8c39b"/>
        <circle cx="22" cy="6" r="1" fill="#c99d6d"/><circle cx="30" cy="6" r="1" fill="#c99d6d"/>
        <circle cx="22" cy="10" r="1" fill="#c99d6d"/><circle cx="30" cy="10" r="1" fill="#c99d6d"/>
      </g>
    </svg>`;
  }

  function dropSvg(big = false) {
    return big
      ? '<svg viewBox="0 0 100 120" aria-hidden="true"><path d="M50 4C50 4 12 52 12 78a38 38 0 0 0 76 0C88 52 50 4 50 4Z" fill="#d94b55"/><path d="M30 80a20 20 0 0 0 12 18" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="5" stroke-linecap="round"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.7S5 10.3 5 15a7 7 0 0 0 14 0c0-4.7-7-12.3-7-12.3Z"/></svg>';
  }

  function errorCard(err) {
    const session = err?.session;
    return `
      <div class="sk-md-wrap"><div class="sk-md-card sk-md-error">
        ${session ? ICON.lock : ICON.alert}
        <div><strong>${session ? 'Tu sesión del SII expiró' : 'No se pudo preparar el seguimiento médico'}</strong>
        <p>${session ? 'Vuelve a iniciar sesión para ver tu información médica.' : 'Puedes intentarlo de nuevo o abrir la vista original del SII.'}</p></div>
        ${session ? '<button type="button" class="sk-md-btn is-primary" data-md-login>Iniciar sesión</button>' : `
        <button type="button" class="sk-md-btn" data-md-retry>Reintentar</button>
        <button type="button" class="sk-md-btn is-primary" data-md-original>Ver vista original</button>`}
      </div></div>`;
  }

  function skeleton() {
    return `<div class="sk-md-wrap"><div class="sk-md-skel" style="height:200px"></div>
      <div class="sk-md-grid">${'<div class="sk-md-skel" style="height:260px"></div>'.repeat(3)}</div></div>`;
  }

  // "O(+)" -> "O+"
  function bloodType(v) {
    const m = /^(AB|A|B|O)\s*\(?\s*([+-])/i.exec(clean(v).replace(/positivo/i, '+').replace(/negativo/i, '-'));
    return m ? `${m[1].toUpperCase()}${m[2]}` : '';
  }
  function groupNss(v) { return v.replace(/^(\d{2})(\d{2})(\d{2})(\d{4})(\d)$/, '$1 $2 $3 $4 $5'); }
  function clean(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
  function norm(s) { return clean(s).toLowerCase().normalize('NFD').replace(/\p{M}/gu, ''); }
  function sentence(s) { const t = clean(s).toLowerCase(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  return { create, open };
})();
