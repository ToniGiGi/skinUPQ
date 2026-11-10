// Módulo "Información Personal" rediseñado.
// La pestaña original carga sus datos con jQuery en #dvPersonaContent (home/datosPersonales)
// y #dvDomicilioContent (home/direccionPersona). Aquí se leen de ese mismo DOM y se
// vuelven a dibujar cada vez que cambian. "Actualizar" usa los botones originales del SII
// (#cmdUpdatePersonales / #cmdUpdateDomicilio), que abren su propio formulario y, al
// cerrarlo, recargan los datos; así guardar sigue funcionando exactamente igual.
// eslint-disable-next-line no-unused-vars
const SK_PERSONAL = (() => {
  const ICON = SK_ICON;

  // Agrupación de los campos conocidos (clave normalizada). Lo que no esté aquí va a "Otros datos".
  const GROUPS = [
    { id: 'id', title: 'Identidad', icon: 'user', keys: ['nombre', 'apellido paterno', 'apellido materno', 'fecha de nacimiento', 'sexo', 'edo. civil', 'tipo de sangre'] },
    { id: 'contact', title: 'Contacto', icon: 'phone', keys: ['tel. celular', 'telefono local', 'otro', 'correo electronico personal'] },
    { id: 'docs', title: 'Documentos', icon: 'idCard', keys: ['curp', 'rfc'] },
    { id: 'origin', title: 'Lugar de nacimiento', icon: 'globe', keys: ['nacionalidad', 'edo. nacionalidad', 'mpio. nacionalidad'] },
    { id: 'family', title: 'Familia', icon: 'users', keys: ['nombre del padre', 'nombre de la madre'] },
  ];
  const ADDRESS_KEYS = ['direccion', 'colonia', 'codigo postal', 'ciudad/localidad', 'municipio o delegacion', 'delegacion municipal', 'entidad federativa'];
  const LABELS = {
    'edo. civil': 'Estado civil', 'tel. celular': 'Celular', 'telefono local': 'Teléfono local', otro: 'Otro teléfono',
    'correo electronico personal': 'Correo personal', 'edo. nacionalidad': 'Estado', 'mpio. nacionalidad': 'Municipio',
    curp: 'CURP', rfc: 'RFC', 'ciudad/localidad': 'Ciudad / localidad', 'municipio o delegacion': 'Municipio o delegación',
    'delegacion municipal': 'Delegación municipal',
  };
  // Se muestran tal cual (sin pasar a "Tipo Título")
  const RAW = new Set(['curp', 'rfc', 'correo electronico personal', 'tipo de sangre']);
  const PHONES = new Set(['tel. celular', 'telefono local', 'otro']);
  const OPTIONAL = new Set(['otro']);
  const COPY = new Set(['curp', 'rfc', 'correo electronico personal', 'tel. celular', 'telefono local', 'otro']);

  // ---------------------------------------------------------------- API
  function create({ onOriginal }) {
    const el = document.createElement('div');
    el.id = 'sk-pers';
    el.className = 'sk-view';
    el.hidden = true;
    el._sk = { wired: false, onOriginal, hideChips: false };
    // Preferencia del ojito (edad, sexo, estado civil, sangre): solo en este navegador.
    try {
      chrome.storage.local.get({ 'ps-hide-chips': false }, (r) => {
        el._sk.hideChips = !!r['ps-hide-chips'];
        if (el.querySelector('.sk-ps-wrap')) draw(el);
      });
    } catch { /* sin almacenamiento */ }
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-ps-original]')) onOriginal();
      if (e.target.closest('[data-ps-chips]')) {
        el._sk.hideChips = !el._sk.hideChips;
        try { chrome.storage.local.set({ 'ps-hide-chips': el._sk.hideChips }); } catch { /* nada */ }
        draw(el);
        return;
      }
      const edit = e.target.closest('[data-ps-edit]');
      if (edit) document.getElementById(edit.dataset.psEdit)?.click();
      const copy = e.target.closest('[data-copy]');
      if (copy) {
        navigator.clipboard?.writeText(copy.dataset.copy).then(() => {
          copy.innerHTML = ICON.check;
          copy.classList.add('is-done');
          setTimeout(() => { copy.innerHTML = ICON.clipboard; copy.classList.remove('is-done'); }, 1500);
        });
      }
    });
    return el;
  }

  function open(el) {
    const s = el._sk;
    if (!s.wired) {
      s.wired = true;
      // El SII vuelve a cargar los datos al cerrar su formulario: se redibuja solo.
      let t = 0;
      const again = () => { clearTimeout(t); t = setTimeout(() => draw(el), 120); };
      ['dvPersonaContent', 'dvDomicilioContent'].forEach((id) => {
        const box = document.getElementById(id);
        if (box) new MutationObserver(again).observe(box, { childList: true, subtree: true, characterData: true });
      });
    }
    draw(el);
  }

  function draw(el) {
    const person = read('dvPersonaContent');
    const address = read('dvDomicilioContent');
    if (!person.length && !address.length) {
      // Todavía cargando (o la sesión expiró): esqueleto; el observador redibuja al llegar.
      if (!el.querySelector('.sk-ps-wrap')) el.innerHTML = skeleton();
      return;
    }
    const top = el.scrollTop;
    el.innerHTML = render(person, address, el._sk.hideChips);
    el.scrollTop = top;
  }

  // ------------------------------------------------------------- Lectura
  function read(id) {
    const box = document.getElementById(id);
    if (!box) return [];
    const out = [];
    box.querySelectorAll('th').forEach((th) => {
      const td = th.nextElementSibling;
      if (!td || td.tagName !== 'TD') return;
      const label = clean(th.textContent).replace(/:$/, '');
      if (!label) return;
      out.push({ key: norm(label), label, value: clean(td.textContent) });
    });
    return out;
  }

  // ------------------------------------------------------------- Dibujo
  function render(person, address, hideChips = false) {
    const P = new Map(person.map((f) => [f.key, f]));
    const A = new Map(address.map((f) => [f.key, f]));
    const pv = (k) => P.get(k)?.value || '';
    const av = (k) => A.get(k)?.value || '';

    const fullName = titleCase([pv('nombre'), pv('apellido paterno'), pv('apellido materno')].filter(Boolean).join(' '));
    const birth = parseDate(pv('fecha de nacimiento'));
    const age = birth ? ageOf(birth) : null;
    const total = person.length + address.length;
    // "Otro teléfono" es opcional: no cuenta como faltante.
    const missing = [...person, ...address].filter((f) => !f.value && !OPTIONAL.has(f.key));

    const chips = [
      age != null && `${age} años`,
      pv('sexo') && titleCase(pv('sexo')),
      pv('edo. civil') && sentence(pv('edo. civil')),
      pv('tipo de sangre') && `Sangre ${pv('tipo de sangre')}`,
    ].filter(Boolean);

    const used = new Set();
    const groupCards = GROUPS.map((g) => {
      const rows = g.keys.filter((k) => P.has(k)).map((k) => { used.add(k); return row(P.get(k)); });
      if (!rows.length) return '';
      return card(g.title, ICON[g.icon], `<dl>${rows.join('')}</dl>`);
    }).join('');
    const others = person.filter((f) => !used.has(f.key));

    // Domicilio en una sola línea legible + desglose.
    const line1 = titleCase(av('direccion'));
    const line2 = [av('colonia') && `Col. ${titleCase(av('colonia'))}`, av('codigo postal') && `C.P. ${av('codigo postal')}`].filter(Boolean).join(', ');
    const place = [...new Set([av('ciudad/localidad'), av('municipio o delegacion') || av('delegacion municipal'), av('entidad federativa')]
      .filter(Boolean).map(titleCase))].join(', ');
    const addrText = [line1, line2, place].filter(Boolean).join(', ');
    const addrRows = [...ADDRESS_KEYS.filter((k) => A.has(k)).map((k) => A.get(k)), ...address.filter((f) => !ADDRESS_KEYS.includes(f.key))];
    const canEditPerson = !!document.getElementById('cmdUpdatePersonales');
    const canEditAddress = !!document.getElementById('cmdUpdateDomicilio');
    const editBtn = (id, label) => `<button type="button" class="sk-ps-edit" data-ps-edit="${id}">${ICON.pencil}${label}</button>`;

    return `
      <div class="sk-ps-wrap">
        <section class="sk-ps-hero">
          <div class="sk-ps-hero-main">
            <span class="sk-ps-eyebrow">Información personal</span>
            <h1>${esc(fullName || 'Sin nombre registrado')}</h1>
            ${chips.length ? `<div class="sk-ps-chips${hideChips ? ' is-hidden' : ''}">
              ${chips.map((c) => `<span>${hideChips ? '•'.repeat(Math.min(8, Math.max(4, c.length - 4))) : esc(c)}</span>`).join('')}
              <button type="button" class="sk-ps-eye" data-ps-chips aria-pressed="${hideChips}"
                title="${hideChips ? 'Mostrar datos' : 'Ocultar datos'}" aria-label="${hideChips ? 'Mostrar edad, sexo, estado civil y tipo de sangre' : 'Ocultar edad, sexo, estado civil y tipo de sangre'}">
                ${hideChips ? ICON.eyeOff : ICON.eye}</button>
            </div>` : ''}
          </div>
          <div class="sk-ps-quick">
            ${quick(ICON.phone, 'Celular', pv('tel. celular') && phone(pv('tel. celular')), pv('tel. celular'))}
            ${quick(ICON.mail, 'Correo personal', pv('correo electronico personal'), pv('correo electronico personal'))}
          </div>
          ${canEditPerson ? `<div class="sk-ps-hero-actions">${editBtn('cmdUpdatePersonales', 'Actualizar datos')}</div>` : ''}
        </section>

        ${total ? `
        <section class="sk-ps-status${missing.length ? ' is-warn' : ''}">
          ${missing.length ? ICON.alert : ICON.ok}
          <div>
            <strong>${missing.length ? `Te faltan ${missing.length} dato${missing.length === 1 ? '' : 's'} por registrar` : 'Tus datos están completos'}</strong>
            <span>${missing.length ? `Falta: ${esc(missing.map((f) => labelOf(f)).join(', '))}.` : `${total} de ${total} campos registrados.`}
              Mantenerlos al día ayuda a que la universidad pueda contactarte.</span>
          </div>
          <div class="sk-ps-meter" title="${total - missing.length} de ${total} campos"><i style="width:${(((total - missing.length) / total) * 100).toFixed(0)}%"></i></div>
        </section>` : ''}

        <div class="sk-ps-grid">
          ${groupCards}
          ${others.length ? card('Otros datos', ICON.file, `<dl>${others.map(row).join('')}</dl>`) : ''}
        </div>

        ${address.length ? `
        <section class="sk-ps-card sk-ps-address">
          <header>
            <h2>${ICON.mapPin}Domicilio</h2>
            ${canEditAddress ? editBtn('cmdUpdateDomicilio', 'Actualizar domicilio') : ''}
          </header>
          <div class="sk-ps-address-body">
            <div class="sk-ps-address-line">
              <span class="sk-ps-pin">${ICON.mapPin}</span>
              <div><strong>${esc(addrText || 'Sin domicilio registrado')}</strong>
                ${addrText ? `<button type="button" class="sk-ps-link" data-copy="${esc(addrText)}">${ICON.clipboard}</button>` : ''}</div>
            </div>
            <dl class="sk-ps-cols">${addrRows.map(row).join('')}</dl>
          </div>
        </section>` : ''}

        <p class="sk-ps-foot">
          Información tomada del SII. Para corregir algo usa “Actualizar”: se abre el formulario oficial del sistema.
          <button type="button" data-ps-original>Ver vista original</button>
        </p>
      </div>`;
  }

  function card(title, icon, body) {
    return `<section class="sk-ps-card"><header><h2>${icon}${esc(title)}</h2></header>${body}</section>`;
  }

  function row(f) {
    const v = f.value;
    let shown = v;
    if (!v) shown = '';
    else if (PHONES.has(f.key)) shown = phone(v);
    else if (f.key === 'fecha de nacimiento') {
      const d = parseDate(v);
      shown = d ? d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }) : v;
    } else if (!RAW.has(f.key) && isShouting(v)) shown = titleCase(v);
    const copy = v && COPY.has(f.key)
      ? `<button type="button" class="sk-ps-copy" data-copy="${esc(v)}" aria-label="Copiar">${ICON.clipboard}</button>` : '';
    return `<div class="sk-ps-row"><dt>${esc(labelOf(f))}</dt>
      <dd${v ? '' : ' class="is-empty"'}>${v ? `<span${RAW.has(f.key) || PHONES.has(f.key) ? ' class="is-mono"' : ''}>${esc(shown)}</span>${copy}` : 'Sin registro'}</dd></div>`;
  }

  function quick(icon, label, shown, raw) {
    return `<div class="sk-ps-q">
      <span class="sk-ps-q-ic">${icon}</span>
      <div><small>${label}</small><strong${shown ? '' : ' class="is-empty"'}>${esc(shown || 'Sin registro')}</strong></div>
      ${raw ? `<button type="button" class="sk-ps-copy" data-copy="${esc(raw)}" aria-label="Copiar ${label.toLowerCase()}">${ICON.clipboard}</button>` : ''}
    </div>`;
  }

  function skeleton() {
    return `<div class="sk-ps-wrap">
      <div class="sk-ps-skel" style="height:170px"></div>
      <div class="sk-ps-grid">${'<div class="sk-ps-skel" style="height:220px"></div>'.repeat(3)}</div>
    </div>`;
  }

  // ----------------------------------------------------------- Utilidades
  // Texto capturado casi todo en mayúsculas ("AV. DE LA LUZ No. 120")
  function isShouting(v) {
    const letters = v.replace(/[^\p{L}]/gu, '');
    return letters.length > 1 && letters.replace(/\p{Lu}/gu, '').length / letters.length < 0.2;
  }
  function labelOf(f) { return LABELS[f.key] || sentence(f.label); }
  function phone(v) {
    const d = v.replace(/\D/g, '');
    return d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : v;
  }
  function parseDate(s) {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s || '');
    return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
  }
  function ageOf(b) {
    const n = new Date();
    let a = n.getFullYear() - b.getFullYear();
    if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
    return a >= 0 && a < 120 ? a : null;
  }
  function clean(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
  function norm(s) { return clean(s).toLowerCase().normalize('NFD').replace(/\p{M}/gu, ''); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  function sentence(s) {
    const t = clean(s).toLowerCase();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  const SMALL = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'en', 'el', 'a', 'no.']);
  function titleCase(s) {
    return clean(s).toLowerCase().split(' ').map((w, i) => {
      if (i > 0 && SMALL.has(w)) return w === 'no.' ? 'No.' : w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  }

  return { create, open };
})();
