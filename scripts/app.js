// Interfaz del sistema por dentro (después de iniciar sesión).
//
// El SII tiene dos capas:
//   - Exterior  /alumnos.php/           → encabezado + <iframe id="main-frame">
//   - Interior  /alumnos.php/home/home  → columna del perfil + pestañas EasyUI (los módulos)
//
// Este script corre en ambas. En la exterior dibuja la barra superior (título, módulos,
// notificaciones y usuario). En la interior convierte la columna del perfil en el módulo
// "Perfil", descarga las notificaciones y obedece a la barra. Se comunican con postMessage.
// Los cambios de layout de EasyUI los hace bridge.js (mundo principal de la página).
(() => {
  const ICON = SK_ICON;
  const ORIGIN = location.origin;
  const NOTIF_TITLE = 'Notificaciones';
  const PROFILE = 'Perfil';
  const DEFAULT_MODULE = 'Panel Principal';

  const MODULE_ICONS = [
    [/^perfil$/i, 'user'],
    [/panel principal/i, 'dashboard'],
    [/trayectoria/i, 'graduation'],
    [/informaci[oó]n personal/i, 'idCard'],
    [/desempe[nñ]o/i, 'chart'],
    [/beca/i, 'award'],
    [/pago/i, 'card'],
    [/seguimiento cuatrimestral|inscrip/i, 'calendarCheck'],
    [/^le$|lengua|idioma/i, 'languages'],
    [/bolsa de trabajo|vacante/i, 'briefcase'],
    [/orientaci[oó]n/i, 'compass'],
    [/m[eé]dic/i, 'stethoscope'],
  ];
  const iconFor = (title) => (MODULE_ICONS.find(([re]) => re.test(title)) || [, 'dot'])[1];

  const isShell = !!document.querySelector('#header .titulos') && !!document.querySelector('iframe#main-frame[src*="home/home"]');
  const isHome = !!document.querySelector('div[region="west"] .admintable') && !!document.querySelector('.easyui-tabs');
  if (!isShell && !isHome) return;

  chrome.storage.sync.get({ enabled: true }, ({ enabled }) => {
    if (!enabled) return;
    if (isShell) initShell();
    else initHome();
  });

  // =====================================================================
  //  EXTERIOR: barra superior
  // =====================================================================
  function initShell() {
    const frame = document.getElementById('main-frame');
    const send = (msg) => frame.contentWindow?.postMessage({ skinupq: 1, ...msg }, ORIGIN);

    const fullName = titleCase(document.querySelector('#header .username span')?.textContent || '');
    const logoutHref = document.querySelector('#header .logout-element a')?.getAttribute('href') || '/alumnos.php/signout';

    const state = { modules: [], active: '', profile: null, notif: { status: 'loading' } };

    const bar = el('header', { id: 'sk-appbar' });
    bar.innerHTML = `
      <div class="sk-ab-left">
        <img class="sk-ab-logo" src="${chrome.runtime.getURL('assets/upqlogonegro.png')}" alt="UPQ" />
        <div class="sk-ab-titles">
          <span class="sk-ab-eyebrow">Sistema Integral de Información</span>
          <strong class="sk-ab-module">&nbsp;</strong>
        </div>
      </div>
      <nav class="sk-ab-nav" aria-label="Módulos"></nav>
      <div class="sk-ab-right">
        <div class="sk-pop">
          <button type="button" class="sk-ab-btn sk-bell" aria-label="Notificaciones" aria-haspopup="true" aria-expanded="false">
            ${ICON.bell}<span class="sk-count" hidden></span>
          </button>
          <div class="sk-menu sk-notif" role="dialog" aria-label="Notificaciones" hidden></div>
        </div>
        <div class="sk-pop">
          <button type="button" class="sk-user" aria-haspopup="true" aria-expanded="false">
            <span class="sk-avatar">${initials(fullName)}</span>
            <span class="sk-user-name">${escapeHtml(shortName(fullName))}</span>
            <span class="sk-chev">${ICON.chevronDown}</span>
          </button>
          <div class="sk-menu sk-usermenu" role="menu" hidden>
            <div class="sk-um-head">
              <span class="sk-avatar sk-avatar-lg">${initials(fullName)}</span>
              <div><strong>${escapeHtml(fullName)}</strong><span class="sk-um-sub">Alumno</span></div>
            </div>
            <button type="button" class="sk-um-item" data-go="${PROFILE}" role="menuitem">${ICON.user}<span>Mi perfil</span></button>
            <a class="sk-um-item sk-um-danger" href="${escapeHtml(logoutHref)}" role="menuitem">${ICON.logout}<span>Cerrar sesión</span></a>
          </div>
        </div>
      </div>`;
    document.body.append(bar);
    document.documentElement.classList.add('sk-app-shell'); // bridge.js reduce el encabezado a 64 px

    const nav = bar.querySelector('.sk-ab-nav');
    const moduleLabel = bar.querySelector('.sk-ab-module');
    const bell = bar.querySelector('.sk-bell');
    const count = bar.querySelector('.sk-count');
    const notifMenu = bar.querySelector('.sk-notif');
    const userBtn = bar.querySelector('.sk-user');
    const userMenu = bar.querySelector('.sk-usermenu');

    // ---- Menús desplegables ----
    const pops = [[bell, notifMenu], [userBtn, userMenu]];
    const closeAll = (except) => pops.forEach(([b, m]) => {
      if (m === except) return;
      m.hidden = true;
      b.setAttribute('aria-expanded', 'false');
    });
    pops.forEach(([b, m]) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = m.hidden;
      closeAll(m);
      m.hidden = !open;
      b.setAttribute('aria-expanded', String(open));
    }));
    document.addEventListener('click', (e) => { if (!e.target.closest('.sk-pop')) closeAll(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });
    window.addEventListener('blur', () => closeAll()); // clic dentro del iframe

    bar.addEventListener('click', (e) => {
      const go = e.target.closest('[data-go]');
      if (!go) return;
      select(go.dataset.go);
      closeAll();
    });

    // ---- Efecto "dock": el ícono bajo el cursor crece y sus vecinos un poco menos ----
    // La posición se mide en "unidades de ícono" (índice + fracción dentro del botón), no en
    // píxeles: así el efecto no tiembla mientras los botones cambian de ancho.
    // Cada botón recibe --m (0 a 1) y el CSS decide cuánto crece.
    const tip = el('div', { class: 'sk-tip', role: 'tooltip' });
    bar.append(tip);
    let pos = null;      // posición del cursor sobre la barra, en unidades de ícono
    let current = null;  // botón bajo el cursor (o con foco)
    let raf = 0;

    const buttons = () => [...nav.querySelectorAll('.sk-nav-btn')];
    const placeTip = () => {
      if (!current) return;
      const r = current.getBoundingClientRect();
      tip.style.left = `${r.left + r.width / 2}px`;
      tip.style.top = `${r.bottom + 10}px`;
    };
    const paint = () => {
      raf = 0;
      buttons().forEach((b, j) => {
        let m = 0;
        if (pos !== null) {
          const u = Math.abs(j - pos);
          if (u < 2) m = (1 + Math.cos((Math.PI * u) / 2)) / 2; // 1 en el centro, 0 a 2 íconos
        }
        b.style.setProperty('--m', m.toFixed(3));
      });
      placeTip();
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(paint); };

    const hoverAt = (b, fraction = 0.5) => {
      pos = buttons().indexOf(b) + fraction - 0.5;
      if (current !== b) {
        current = b;
        tip.textContent = b.dataset.tip;
      }
      tip.classList.add('is-visible');
      schedule();
    };
    const release = () => {
      pos = null;
      current = null;
      tip.classList.remove('is-visible');
      schedule();
    };

    nav.addEventListener('pointermove', (e) => {
      const b = e.target.closest('.sk-nav-btn');
      if (!b) return; // en el hueco entre íconos se conserva la última posición
      const r = b.getBoundingClientRect();
      hoverAt(b, Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
    });
    nav.addEventListener('pointerleave', release);
    nav.addEventListener('focusin', (e) => { const b = e.target.closest('.sk-nav-btn'); if (b) hoverAt(b); });
    nav.addEventListener('focusout', release);
    nav.addEventListener('scroll', placeTip);
    // El tooltip acompaña al ícono mientras termina de crecer.
    nav.addEventListener('transitionend', (e) => { if (e.target === current) placeTip(); });

    // ---- Navegación ----
    function select(title) {
      setActive(title);
      send({ type: 'select', title });
      try { sessionStorage.setItem('sk-module', title); } catch { /* sin almacenamiento */ }
    }

    function renderNav() {
      const list = [PROFILE, ...state.modules.map((m) => m.title).filter((t) => t !== NOTIF_TITLE)];
      nav.innerHTML = '';
      list.forEach((title) => {
        const b = el('button', { type: 'button', class: 'sk-nav-btn', 'data-go': title, 'data-tip': title, 'aria-label': title });
        b.innerHTML = ICON[iconFor(title)];
        nav.append(b);
      });
      setActive(state.active);
    }

    function setActive(title) {
      state.active = title;
      moduleLabel.textContent = title || ' ';
      document.title = title ? `${title} · SII UPQ` : 'SII UPQ';
      nav.querySelectorAll('.sk-nav-btn').forEach((b) => {
        const on = b.dataset.go === title;
        b.classList.toggle('is-active', on);
        if (on) b.setAttribute('aria-current', 'page');
        else b.removeAttribute('aria-current');
      });
    }

    // ---- Notificaciones ----
    function renderNotif() {
      const n = state.notif;
      const total = n.status === 'ok' ? n.total : 0;
      count.hidden = !total;
      count.textContent = total > 9 ? '9+' : String(total);
      bell.classList.toggle('has-items', total > 0);
      bell.setAttribute('aria-label', total ? `Notificaciones (${total} pendientes)` : 'Notificaciones');

      const head = `
        <div class="sk-nt-head">
          <strong>Notificaciones</strong>
          <button type="button" class="sk-icon-btn sk-nt-refresh" aria-label="Actualizar">${ICON.refresh}</button>
        </div>`;
      let body = '';
      if (n.status === 'loading') {
        body = '<div class="sk-nt-state"><span class="sk-spinner"></span><p>Revisando avisos…</p></div>';
      } else if (n.status === 'error') {
        body = `<div class="sk-nt-state">${ICON.alert}<p>No se pudieron cargar las notificaciones.</p></div>`;
      } else {
        if (!total) {
          body += `<div class="sk-nt-state sk-nt-clear">${ICON.ok}<p><strong>Todo en orden</strong>No tienes adeudos ni avisos pendientes.</p></div>`;
        }
        body += n.sections.map((s) => `
          <section class="sk-nt-section">
            <div class="sk-nt-stitle">
              <span>${escapeHtml(s.title)}</span>
              <span class="sk-nt-pill ${s.items.length ? 'is-warn' : 'is-ok'}">${s.items.length ? s.items.length : 'Sin registros'}</span>
            </div>
            ${s.items.map((it) => `
              <div class="sk-nt-item">
                <span class="sk-nt-dot"></span>
                <div>
                  <strong>${escapeHtml(it.main)}</strong>
                  ${it.meta.length ? `<p>${it.meta.map(([k, v]) => `<span>${escapeHtml(k)}: <b>${escapeHtml(v)}</b></span>`).join('')}</p>` : ''}
                </div>
              </div>`).join('')}
          </section>`).join('');
      }
      const foot = `<button type="button" class="sk-nt-foot" data-go="${NOTIF_TITLE}">Ver detalle en el sistema ${ICON.arrowRight}</button>`;
      notifMenu.innerHTML = head + `<div class="sk-nt-body">${body}</div>` + foot;
      notifMenu.querySelector('.sk-nt-refresh').addEventListener('click', (e) => {
        e.stopPropagation();
        state.notif = { status: 'loading' };
        renderNotif();
        send({ type: 'refreshNotifications' });
      });
    }

    function renderProfile() {
      const p = state.profile;
      if (!p) return;
      bar.querySelectorAll('.sk-avatar').forEach((a) => {
        if (!p.photo) return;
        a.innerHTML = '';
        const img = el('img', { src: p.photo, alt: '' });
        img.addEventListener('error', () => { a.textContent = initials(fullName); }, { once: true });
        a.append(img);
      });
      if (p.matricula) bar.querySelector('.sk-um-sub').textContent = `Matrícula ${p.matricula}`;
    }

    // ---- Mensajes desde la página interior ----
    window.addEventListener('message', (e) => {
      if (e.origin !== ORIGIN || e.source !== frame.contentWindow || !e.data?.skinupq) return;
      const m = e.data;
      if (m.type === 'modules') {
        state.modules = m.modules;
        renderNav();
        let saved = '';
        try { saved = sessionStorage.getItem('sk-module') || ''; } catch { /* nada */ }
        const valid = (t) => t === PROFILE || state.modules.some((x) => x.title === t);
        select(valid(saved) ? saved : valid(DEFAULT_MODULE) ? DEFAULT_MODULE : m.selected);
      } else if (m.type === 'active') {
        setActive(m.title);
      } else if (m.type === 'profile') {
        state.profile = m.profile;
        renderProfile();
      } else if (m.type === 'notifications') {
        state.notif = m.notif;
        renderNotif();
      }
    });

    // Si el iframe ya cargó antes que este script, pedirle su estado; también tras recargas.
    frame.addEventListener('load', () => send({ type: 'hello' }));
    send({ type: 'hello' });
    renderNotif();
  }

  // =====================================================================
  //  INTERIOR: módulo Perfil, notificaciones y control de pestañas
  // =====================================================================
  function initHome() {
    const toTop = (msg) => window.parent.postMessage({ skinupq: 1, ...msg }, ORIGIN);
    const cmd = (detail) => document.dispatchEvent(new CustomEvent('skinupq:cmd', { detail: JSON.stringify(detail) }));

    const profile = readProfile();
    const profileView = buildProfileView(profile);
    document.body.append(profileView);

    // Módulos con pantalla propia (rediseñada). Los demás muestran la pestaña original del SII.
    // title -> { el, open() }   open() se llama cada vez que se muestra (carga perezosa).
    const views = new Map([[PROFILE, { el: profileView, open() {} }]]);
    let showingCustom = false;

    let modules = null;
    let active = '';
    let notif = { status: 'loading' };

    function show(title, { original = false } = {}) {
      active = title;
      const custom = !original && views.get(title);
      views.forEach((v) => { v.el.hidden = v !== custom; });
      showingCustom = !!custom;
      if (custom) custom.open();
      else cmd({ type: 'select', title });
      toTop({ type: 'active', title });
    }

    document.addEventListener('skinupq:modules', (e) => {
      const d = JSON.parse(e.detail);
      modules = d.modules;
      registerCustomViews();
      toTop({ type: 'modules', modules, selected: d.selected });
      loadNotifications();
    });
    document.addEventListener('skinupq:selected', (e) => {
      // Mientras se ve una pantalla propia, la pestaña de EasyUI de fondo no debe cerrarla.
      if (showingCustom) return;
      active = JSON.parse(e.detail).title;
      toTop({ type: 'active', title: active });
    });

    function registerCustomViews() {
      const tray = modules.find((m) => /trayectoria/i.test(m.title) && m.href);
      if (tray && !views.has(tray.title)) {
        const el = SK_TRAYECTORIA.create({
          load: () => fetchSii(tray.href),
          onOriginal: () => show(tray.title, { original: true }),
        });
        document.body.append(el);
        views.set(tray.title, { el, open: () => SK_TRAYECTORIA.open(el) });
      }
      const seg = modules.find((m) => /seguimiento cuatrimestral/i.test(m.title) && m.href);
      if (seg && !views.has(seg.title)) {
        const el = SK_SEGUIMIENTO.create({
          href: seg.href,
          load: fetchSii,
          onOriginal: () => show(seg.title, { original: true }),
        });
        document.body.append(el);
        views.set(seg.title, { el, open: () => SK_SEGUIMIENTO.open(el) });
      }
      const bec = modules.find((m) => /^becas$/i.test(m.title) && m.href);
      if (bec && !views.has(bec.title)) {
        const el = SK_BECAS.create({
          href: bec.href,
          load: fetchSii,
          student: { name: profile.name },
          onOriginal: () => show(bec.title, { original: true }),
        });
        document.body.append(el);
        views.set(bec.title, { el, open: () => SK_BECAS.open(el) });
      }
      const pag = modules.find((m) => /^pagos$/i.test(m.title) && m.href);
      if (pag && !views.has(pag.title)) {
        const el = SK_PAGOS.create({ href: pag.href, load: fetchSii, onOriginal: () => show(pag.title, { original: true }) });
        document.body.append(el);
        views.set(pag.title, { el, open: () => SK_PAGOS.open(el) });
      }
      const bol = modules.find((m) => /bolsa de trabajo/i.test(m.title) && m.href);
      if (bol && !views.has(bol.title)) {
        const el = SK_BOLSA.create({
          href: bol.href,
          load: fetchSii,
          student: { name: profile.get('nombre'), photo: profile.photo },
          onOriginal: () => show(bol.title, { original: true }),
        });
        document.body.append(el);
        views.set(bol.title, { el, open: () => SK_BOLSA.open(el) });
      }
      const med = modules.find((m) => /m.dic/i.test(m.title) && m.href);
      if (med && !views.has(med.title)) {
        const el = SK_MEDICO.create({ href: med.href, load: fetchSii, onOriginal: () => show(med.title, { original: true }) });
        document.body.append(el);
        views.set(med.title, { el, open: () => SK_MEDICO.open(el) });
      }
      const ori = modules.find((m) => /orientaci.n/i.test(m.title) && m.href);
      if (ori && !views.has(ori.title)) {
        const el = SK_ORIENTACION.create({ href: ori.href, load: fetchSii, onOriginal: () => show(ori.title, { original: true }) });
        document.body.append(el);
        views.set(ori.title, { el, open: () => SK_ORIENTACION.open(el) });
      }
      const le = modules.find((m) => /^le$|lenguas|idioma/i.test(m.title) && m.href);
      if (le && !views.has(le.title)) {
        const el = SK_LE.create({
          href: le.href,
          load: fetchSii,
          level: profile.get('nivel ingles'),
          onOriginal: () => show(le.title, { original: true }),
        });
        document.body.append(el);
        views.set(le.title, { el, open: () => SK_LE.open(el) });
      }
      const per = modules.find((m) => /informaci.n personal/i.test(m.title));
      if (per && document.getElementById('dvPersonaContent') && !views.has(per.title)) {
        const el = SK_PERSONAL.create({ onOriginal: () => show(per.title, { original: true }) });
        document.body.append(el);
        views.set(per.title, { el, open: () => SK_PERSONAL.open(el) });
      }
      const des = modules.find((m) => /desempe/i.test(m.title) && m.href);
      if (des && !views.has(des.title)) {
        const el = SK_DESEMPENO.create({
          href: des.href,
          load: fetchSii,
          current: parseInt(profile.get('ultimo cuatrimestre'), 10) || 0,
          student: {
            name: profile.get('nombre'), matricula: profile.matricula, photo: profile.photo,
            carrera: profile.get('carrera'), generacion: profile.get('generacion'),
          },
          onOriginal: () => show(des.title, { original: true }),
        });
        document.body.append(el);
        views.set(des.title, { el, open: () => SK_DESEMPENO.open(el) });
      }
    }

    window.addEventListener('message', (e) => {
      if (e.origin !== ORIGIN || e.source !== window.parent || !e.data?.skinupq) return;
      const m = e.data;
      if (m.type === 'select') {
        show(m.title);
      } else if (m.type === 'hello') {
        toTop({ type: 'profile', profile: { photo: profile.photo, name: profile.name, matricula: profile.matricula } });
        if (modules) toTop({ type: 'modules', modules, selected: active });
        toTop({ type: 'notifications', notif });
      } else if (m.type === 'refreshNotifications') {
        loadNotifications();
      }
    });

    // Activar después de registrar los listeners: bridge.js espera esta clase para actuar.
    document.documentElement.classList.add('sk-app-home');
    toTop({ type: 'profile', profile: { photo: profile.photo, name: profile.name, matricula: profile.matricula } });

    async function loadNotifications() {
      const href = modules?.find((m) => m.title === NOTIF_TITLE)?.href;
      if (!href) {
        notif = { status: 'ok', total: 0, sections: [] };
        return toTop({ type: 'notifications', notif });
      }
      notif = { status: 'loading' };
      toTop({ type: 'notifications', notif });
      try {
        const sections = parseNotifications(await fetchSii(href));
        notif = { status: 'ok', sections, total: sections.reduce((n, s) => n + s.items.length, 0) };
      } catch {
        notif = { status: 'error' };
      }
      toTop({ type: 'notifications', notif });
    }
  }

  // Descarga una página del SII con la sesión actual. El SII responde en iso-8859-1
  // y fetch().text() siempre asume UTF-8, así que se decodifica a mano.
  async function fetchSii(href) {
    // Mismo encabezado que manda jQuery al cargar las pestañas; sin él el SII responde 401.
    const res = await fetch(href, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    // 401 o la página de login = la sesión del SII expiró.
    if (res.status === 401) throw Object.assign(new Error('sesion'), { session: true });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const charset = /charset=([\w-]+)/i.exec(res.headers.get('content-type') || '')?.[1] || 'iso-8859-1';
    const text = new TextDecoder(charset).decode(await res.arrayBuffer());
    if (/id="frmLogin"/.test(text)) throw Object.assign(new Error('sesion'), { session: true });
    return text;
  }

  // ---------- Perfil: datos de la columna izquierda original ----------
  function readProfile() {
    const west = document.querySelector('div[region="west"]');
    const fields = [];
    west.querySelectorAll('th').forEach((th) => {
      const td = th.nextElementSibling;
      if (!td || td.tagName !== 'TD') return;
      const label = clean(th.textContent).replace(/:$/, '');
      fields.push({ key: normalize(label), label, value: clean(td.textContent) });
    });
    const get = (k) => fields.find((f) => f.key === k)?.value || '';
    return {
      fields,
      get,
      photo: west.querySelector('.foto img')?.src || '',
      name: titleCase(get('nombre')),
      matricula: get('matricula'),
    };
  }

  function buildProfileView(p) {
    const used = new Set();
    const val = (key) => { used.add(key); return p.get(key); };
    const row = (label, key, opts = {}) => {
      const v = val(key);
      return `<div class="sk-pf-row"><dt>${label}</dt><dd${v ? '' : ' class="is-empty"'}>${
        v ? (opts.render ? opts.render(v) : escapeHtml(opts.title ? titleCase(v) : v)) : 'Sin registro'}</dd></div>`;
    };

    const status = val('estatus actual');
    const avg = parseFloat(val('promedio general')) || 0;
    const stat = (label, key, extra = '') => {
      const v = val(key);
      return `<div class="sk-pf-stat"><span>${label}</span><strong>${escapeHtml(v || '—')}</strong>${extra}</div>`;
    };

    const view = el('div', { id: 'sk-profile', hidden: '' });
    view.innerHTML = `
      <div class="sk-pf-wrap">
        <section class="sk-pf-hero">
          <div class="sk-pf-cover">
            <img class="sk-pf-cover-img" alt="" hidden />
            <div class="sk-cover-tools">
              <button type="button" class="sk-cover-btn" aria-haspopup="true" aria-expanded="false">${ICON.camera}<span>Editar portada</span></button>
              <div class="sk-cover-menu" role="menu" hidden>
                <button type="button" role="menuitem" data-cover="upload">${ICON.upload}<span>Subir imagen</span></button>
                <button type="button" role="menuitem" data-cover="campus">${ICON.image}<span>Usar foto del campus</span></button>
                <button type="button" role="menuitem" data-cover="move">${ICON.move}<span>Acomodar posición</span></button>
                <button type="button" role="menuitem" data-cover="remove" class="is-danger">${ICON.trash}<span>Quitar portada</span></button>
              </div>
            </div>
            <div class="sk-cover-edit" hidden>
              <span>${ICON.move}Arrastra la imagen para acomodarla</span>
              <button type="button" data-cover="cancel">Cancelar</button>
              <button type="button" data-cover="save" class="is-primary">Guardar</button>
            </div>
            <input type="file" accept="image/*" class="sk-cover-file" hidden />
          </div>
          <!-- Foto circular y tarjeta con el nombre, montadas sobre el borde de la portada -->
          <div class="sk-pf-identity">
            <div class="sk-pf-photo">
              ${p.photo ? `<img src="${escapeHtml(p.photo)}" alt="Foto de ${escapeHtml(p.name)}" />` : ''}
              ${status ? `<span class="sk-pf-dot${/activo/i.test(status) ? ' is-ok' : ''}" title="Estatus: ${escapeHtml(titleCase(status))}"></span>` : ''}
            </div>
            <div class="sk-pf-namecard">
              <h1>${escapeHtml(p.name || 'Alumno')}</h1>
              <p class="sk-pf-role">${escapeHtml(val('carrera') || 'Alumno')}</p>
              <div class="sk-pf-chips">
                ${status ? `<span class="sk-pf-status${/activo/i.test(status) ? ' is-ok' : ''}">${escapeHtml(titleCase(status))}</span>` : ''}
                ${[['Matrícula', 'matricula'], ['Grupo', 'grupo'], ['Generación', 'generacion'], ['Cuatrimestre', 'ultimo cuatrimestre']]
                  .map(([l, k]) => { const v = val(k); return v ? `<span><small>${l}</small>${escapeHtml(v)}</span>` : ''; }).join('')}
              </div>
            </div>
          </div>
        </section>

        <section class="sk-pf-stats">
          ${stat('Promedio general', 'promedio general', `<div class="sk-pf-bar"><i style="width:${Math.min(100, avg * 10)}%"></i></div>`)}
          ${stat('Créditos aprobados', 'creditos aprobados')}
          ${stat('Materias aprobadas', 'materias aprobadas')}
          ${stat('No acreditadas', 'materias no acreditadas')}
          ${stat('Nivel de inglés', 'nivel ingles')}
        </section>

        <div class="sk-pf-grid">
          <section class="sk-pf-card">
            <h2>${ICON.graduation}Formación académica</h2>
            <dl>
              ${row('Carrera', 'carrera', { title: true })}
              ${row('TSU', 'tsu')}
              ${row('Estatus TSU', 'estatus tsu', { title: true })}
              ${row('Bloque presencial', 'bloque presencial')}
            </dl>
          </section>
          <section class="sk-pf-card">
            <h2>${ICON.user}Tutoría</h2>
            <dl>
              ${row('Tutor(a)', 'tutores', { title: true })}
              ${row('Correo', 'correo tutor', { render: (v) => `<span class="sk-pf-copy">${escapeHtml(v)}<button type="button" class="sk-icon-btn" data-copy="${escapeHtml(v)}" aria-label="Copiar correo">${ICON.clipboard}</button></span>` })}
            </dl>
          </section>
          <section class="sk-pf-card">
            <h2>${ICON.idCard}Datos administrativos</h2>
            <dl>
              ${row('NSS', 'nss', { render: (v) => `<span class="sk-pf-secret" data-value="${escapeHtml(v)}"><span>${escapeHtml(mask(v))}</span><button type="button" class="sk-icon-btn" aria-label="Mostrar NSS">${ICON.eye}</button></span>` })}
              ${row('Servicio social', 'servicio social')}
              ${row('Estatus actual', 'estatus actual', { title: true })}
            </dl>
          </section>
          <section class="sk-pf-card sk-pf-extra" hidden>
            <h2>${ICON.file}Otros datos</h2>
            <dl></dl>
          </section>
        </div>
      </div>`;

    // Cualquier dato nuevo que agregue el SII se muestra en "Otros datos" en lugar de perderse.
    ['nombre'].forEach((k) => used.add(k));
    const extra = p.fields.filter((f) => !used.has(f.key));
    if (extra.length) {
      const box = view.querySelector('.sk-pf-extra');
      box.hidden = false;
      box.querySelector('dl').innerHTML = extra.map((f) =>
        `<div class="sk-pf-row"><dt>${escapeHtml(f.label)}</dt><dd${f.value ? '' : ' class="is-empty"'}>${escapeHtml(f.value || 'Sin registro')}</dd></div>`).join('');
    }

    view.addEventListener('click', (e) => {
      const copy = e.target.closest('[data-copy]');
      if (copy) {
        navigator.clipboard?.writeText(copy.dataset.copy).then(() => {
          copy.innerHTML = ICON.check;
          setTimeout(() => { copy.innerHTML = ICON.clipboard; }, 1500);
        });
      }
      const secret = e.target.closest('.sk-pf-secret button');
      if (secret) {
        const box = secret.parentElement;
        const shown = box.classList.toggle('is-shown');
        box.firstElementChild.textContent = shown ? box.dataset.value : mask(box.dataset.value);
        secret.innerHTML = shown ? ICON.eyeOff : ICON.eye;
        secret.setAttribute('aria-label', shown ? 'Ocultar NSS' : 'Mostrar NSS');
      }
    });
    view.querySelector('.sk-pf-photo img')?.addEventListener('error', (e) => e.target.remove(), { once: true });
    setupCover(view.querySelector('.sk-pf-cover'), p.matricula || 'alumno');
    return view;
  }

  // ---------- Portada del perfil (solo en este navegador) ----------
  // Se guarda en chrome.storage.local de la extensión, por matrícula. Nunca se envía al SII.
  // La imagen se reduce antes de guardarla para ocupar poco espacio.
  function setupCover(cover, matricula) {
    const KEY = `cover:${matricula}`;
    const img = cover.querySelector('.sk-pf-cover-img');
    const btn = cover.querySelector('.sk-cover-btn');
    const menu = cover.querySelector('.sk-cover-menu');
    const editBar = cover.querySelector('.sk-cover-edit');
    const file = cover.querySelector('.sk-cover-file');
    const moveItem = menu.querySelector('[data-cover="move"]');
    const removeItem = menu.querySelector('[data-cover="remove"]');

    let saved = null; // { src, pos }  src: data URL o "campus"
    let editPos = 50;

    const srcOf = (s) => (s === 'campus' ? chrome.runtime.getURL('assets/campus.jpg') : s);
    const show = (data) => {
      const has = !!data?.src;
      cover.classList.toggle('has-image', has);
      img.hidden = !has;
      if (has) {
        img.src = srcOf(data.src);
        img.style.objectPosition = `center ${data.pos ?? 50}%`;
      } else {
        img.removeAttribute('src');
      }
      moveItem.hidden = !has;
      removeItem.hidden = !has;
    };
    const store = (data) => {
      saved = data;
      if (data) chrome.storage.local.set({ [KEY]: data });
      else chrome.storage.local.remove(KEY);
      show(data);
    };

    chrome.storage.local.get({ [KEY]: null }, (r) => { saved = r[KEY]; show(saved); });

    // Menú
    const toggleMenu = (open) => {
      menu.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
    };
    btn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(menu.hidden); });
    document.addEventListener('click', (e) => { if (!e.target.closest('.sk-cover-tools')) toggleMenu(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { toggleMenu(false); if (!editBar.hidden) endEdit(false); } });

    cover.addEventListener('click', (e) => {
      const action = e.target.closest('[data-cover]')?.dataset.cover;
      if (!action) return;
      toggleMenu(false);
      if (action === 'upload') file.click();
      if (action === 'campus') store({ src: 'campus', pos: 45 }); // 45%: centra el letrero UPQ
      if (action === 'remove') store(null);
      if (action === 'move') startEdit();
      if (action === 'save') endEdit(true);
      if (action === 'cancel') endEdit(false);
    });

    file.addEventListener('change', async () => {
      const f = file.files[0];
      file.value = '';
      if (!f || !f.type.startsWith('image/')) return;
      cover.classList.add('is-busy');
      try {
        store({ src: await shrink(f), pos: 50 });
        startEdit(); // recién subida: invitar a acomodarla
      } catch {
        cover.classList.add('has-error');
        setTimeout(() => cover.classList.remove('has-error'), 2500);
      } finally {
        cover.classList.remove('is-busy');
      }
    });

    // Acomodar: arrastrar en vertical cambia object-position (0% arriba, 100% abajo).
    let drag = null;
    function startEdit() {
      if (!saved?.src) return;
      editPos = saved.pos ?? 50;
      cover.classList.add('is-editing');
      editBar.hidden = false;
    }
    function endEdit(keep) {
      cover.classList.remove('is-editing');
      editBar.hidden = true;
      if (keep) store({ ...saved, pos: Math.round(editPos) });
      else show(saved);
    }
    cover.addEventListener('pointerdown', (e) => {
      if (!cover.classList.contains('is-editing') || e.target.closest('button')) return;
      const rendered = cover.clientWidth * (img.naturalHeight / img.naturalWidth);
      const overflow = rendered - cover.clientHeight;
      if (overflow <= 0) return;
      drag = { y: e.clientY, start: editPos, overflow };
      cover.setPointerCapture(e.pointerId);
      cover.classList.add('is-dragging');
    });
    cover.addEventListener('pointermove', (e) => {
      if (!drag) return;
      editPos = Math.min(100, Math.max(0, drag.start - ((e.clientY - drag.y) / drag.overflow) * 100));
      img.style.objectPosition = `center ${editPos}%`;
    });
    const stop = () => { drag = null; cover.classList.remove('is-dragging'); };
    cover.addEventListener('pointerup', stop);
    cover.addEventListener('pointercancel', stop);
  }

  // Reduce la imagen a máx. 1920 px de ancho y la convierte en JPEG.
  function shrink(fileObj) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(fileObj);
      const im = new Image();
      im.onload = () => {
        const scale = Math.min(1, 1920 / im.naturalWidth);
        const c = document.createElement('canvas');
        c.width = Math.round(im.naturalWidth * scale);
        c.height = Math.round(im.naturalHeight * scale);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        let q = 0.85;
        let out = c.toDataURL('image/jpeg', q);
        while (out.length > 1_500_000 && q > 0.4) out = c.toDataURL('image/jpeg', (q -= 0.15));
        resolve(out);
      };
      im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('imagen inválida')); };
      im.src = url;
    });
  }

  // ---------- Notificaciones: se lee el HTML del módulo original ----------
  // No conocemos el marcado exacto, así que se interpreta de forma tolerante:
  // cada tabla es una sección; su título es el encabezado más cercano antes de ella.
  function parseNotifications(source) {
    const doc = new DOMParser().parseFromString(source, 'text/html');
    return [...doc.querySelectorAll('table')].map((table) => {
      const headers = [...(table.querySelector('tr') || document.createElement('tr')).children]
        .filter((c) => c.tagName === 'TH').map((c) => clean(c.textContent));
      const items = [...table.querySelectorAll('tr')]
        .filter((tr) => tr.querySelector('td'))
        .map((tr) => [...tr.querySelectorAll('td')].map((td) => clean(td.textContent)))
        .filter((cells) => cells.some(Boolean) && !cells.some((c) => /no se encontraron/i.test(c)))
        .map((cells) => toItem(headers, cells));
      return { title: findTitle(table) || 'Aviso', items };
    });
  }

  function toItem(headers, cells) {
    const cols = cells.map((v, i) => [headers[i] || '', v]).filter(([h, v]) => v && h !== '#');
    const mainIdx = Math.max(0, cols.findIndex(([h]) => /concepto|motivo|descrip/i.test(h)));
    const [, main] = cols[mainIdx] || ['', cells.join(' ')];
    const meta = cols.filter((_, i) => i !== mainIdx).map(([h, v]) => [titleCase(h) || 'Dato', v]);
    return { main, meta };
  }

  function findTitle(table) {
    for (let node = table; node && node.tagName !== 'BODY'; node = node.parentElement) {
      for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
        const h = sib.matches('h1,h2,h3,h4,h5,h6,legend,strong,b,.titulo,.title')
          ? sib : sib.querySelector('h1,h2,h3,h4,h5,h6,legend,strong,b');
        const t = h && clean(h.textContent);
        if (t && t.length < 90) return t.replace(/:$/, '');
      }
    }
    return '';
  }

  // ---------- Utilidades ----------
  function clean(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
  function normalize(s) { return clean(s).toLowerCase().normalize('NFD').replace(/\p{M}/gu, ''); }
  function titleCase(s) {
    const small = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'en', 'el', 'a']);
    return clean(s).toLowerCase().split(' ').map((w, i) =>
      (i > 0 && small.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }
  function shortName(full) { return full.split(' ').slice(0, 1).join(' '); }
  function initials(full) {
    const p = full.split(' ').filter(Boolean);
    return escapeHtml(((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?');
  }
  function mask(v) { return v.length > 4 ? '•'.repeat(v.length - 4) + v.slice(-4) : v; }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  function el(tag, attrs = {}, text) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    return n;
  }
})();
