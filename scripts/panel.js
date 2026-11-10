// "Panel Principal" rediseñado.
// Es una página propia (alumnos.php/home/panelPrincipal) dentro de un iframe de la pestaña.
// Como sus botones tienen comportamiento del SII (ventanas de convocatorias, biblioteca),
// los enlaces originales se MUEVEN al nuevo diseño en vez de recrearse: conservan su
// destino y sus manejadores de jQuery. La página original queda oculta por CSS.
(() => {
  if (!/\/home\/panelPrincipal/i.test(location.pathname)) return;
  if (!document.querySelector('.cpanel')) return;
  const ICON = SK_ICON;

  // "Ver vista original": como los enlaces se mueven, la vista original se muestra
  // recargando la página sin el diseño nuevo (bandera en sessionStorage, solo esta pestaña).
  const KEY = 'sk-panel-original';
  const wantsOriginal = () => { try { return sessionStorage.getItem(KEY) === '1'; } catch { return false; } };
  const setOriginal = (on) => {
    try { if (on) sessionStorage.setItem(KEY, '1'); else sessionStorage.removeItem(KEY); } catch { /* sin almacenamiento */ }
    location.reload();
  };

  chrome.storage.sync.get({ enabled: true }, ({ enabled }) => {
    if (!enabled) return;
    if (wantsOriginal()) backButton();
    else build();
  });

  function backButton() {
    const b = document.createElement('button');
    b.type = 'button';
    b.id = 'sk-panel-back';
    b.innerHTML = `${ICON.dashboard}Volver a la vista nueva`;
    b.addEventListener('click', () => setOriginal(false));
    document.body.append(b);
  }

  function build() {
    const panels = [...document.querySelectorAll('.cpanel')];
    const titleOf = (p) => norm(p.querySelector('.header-title')?.textContent);
    const visible = (n) => !n.closest('[style*="display:none"], [style*="display: none"]');

    // ---- Convocatorias / avisos: cada bloque .wrapper con su texto y sus botones
    const notices = [];
    panels.filter((p) => /convocatoria|aviso|notificacion/.test(titleOf(p))).forEach((p) => {
      p.querySelectorAll(':scope > .wrapper, :scope > div > .wrapper').forEach((w) => {
        if (!visible(w)) return;
        const buttons = [...w.querySelectorAll('a')];
        const box = w.querySelector('fieldset') || w;
        const clone = box.cloneNode(true);
        clone.querySelectorAll('a, ul, legend, script').forEach((n) => n.remove());
        const paras = [...clone.querySelectorAll('p, div')].map((n) => clean(n.textContent)).filter(Boolean);
        const text = paras.length ? [...new Set(paras)] : [clean(clone.textContent)].filter(Boolean);
        if (!text.length && !buttons.length) return;
        notices.push({ title: clean(w.querySelector('legend')?.textContent), text, buttons });
      });
    });

    // ---- Accesos (Información importante / Biblioteca)
    const linksOf = (re) => {
      const p = panels.find((x) => re.test(titleOf(x)));
      return p ? [...p.querySelectorAll('a.shorcut-link, .icon > a')].filter(visible) : [];
    };
    const info = linksOf(/informacion/);
    const library = linksOf(/biblioteca/);

    // Claves de las bases de datos (las ventanas #db_content / #db_content2 del SII)
    const profile = parentProfile();
    const dbs = [readDb('db_content', 'EBSCOHost', profile), readDb('db_content2', 'Biblioteca Digital ECEST', profile)].filter(Boolean);
    const dbTriggers = new Set(['db_trigger', 'db_trigger2']);

    const root = document.createElement('div');
    root.id = 'sk-panel';
    const first = (profile.name || '').split(' ')[0];
    const hour = new Date().getHours();
    const hello = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
    const today = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    root.innerHTML = `
      <div class="sk-pp-wrap">
        <section class="sk-pp-hero">
          <div>
            <span class="sk-pp-date">${esc(cap(today))}</span>
            <h1>${esc(hello)}${first ? `, ${esc(cap(first.toLowerCase()))}` : ''}</h1>
            <p>${notices.length
              ? `Tienes <b>${notices.length} convocatoria${notices.length === 1 ? '' : 's'} o aviso${notices.length === 1 ? '' : 's'}</b> por revisar.`
              : 'No hay convocatorias ni avisos activos por ahora.'}</p>
          </div>
          <span class="sk-pp-hero-ic">${ICON.dashboard}</span>
        </section>

        <section class="sk-pp-section">
          <h2>${ICON.megaphone}Convocatorias y avisos</h2>
          <div class="sk-pp-notices" data-pp-notices>
            ${notices.length ? '' : `
            <div class="sk-pp-empty">
              <span>${ICON.ok}</span>
              <div><strong>Todo al día</strong><p>Cuando la universidad publique una convocatoria (reinscripciones, becas, encuestas, transporte…) aparecerá aquí.</p></div>
            </div>`}
          </div>
        </section>

        ${info.length ? `
        <section class="sk-pp-section">
          <h2>${ICON.info}Información importante</h2>
          <div class="sk-pp-sub" data-pp-docs-wrap><h3>Documentos para consultar</h3><div class="sk-pp-docs" data-pp-docs></div></div>
          <div class="sk-pp-sub" data-pp-services-wrap><h3>Trámites y servicios</h3><div class="sk-pp-grid" data-pp-services></div></div>
        </section>` : ''}

        ${library.length ? `
        <section class="sk-pp-section">
          <h2>${ICON.book}Servicios bibliotecarios</h2>
          <div class="sk-pp-grid" data-pp-library></div>
          <div class="sk-pp-libbottom${dbs.length ? '' : ' is-solo'}">
            <figure class="sk-pp-shelf">
              <figcaption><strong>Biblioteca UPQ</strong><span>Libros, revistas y bases de datos, también desde casa.</span></figcaption>
              ${shelfSvg()}
            </figure>
            ${dbs.map((d) => `
              <article class="sk-pp-db">
                <header><span>${ICON.database}</span><div><strong>${esc(d.name)}</strong><small>Datos de acceso</small></div></header>
                <dl>
                  ${d.user ? `<div><dt>Usuario</dt><dd><code>${esc(d.user)}</code>${copyBtn(d.user)}</dd></div>` : ''}
                  ${d.pass ? `<div><dt>Contraseña</dt><dd><code>${esc(d.pass)}</code>${copyBtn(d.pass)}</dd></div>` : ''}
                </dl>
                ${d.hint ? `<p class="sk-pp-hint">${esc(d.hint)}</p>` : ''}
                ${d.href ? `<a class="sk-pp-go" href="${esc(d.href)}" target="_blank" rel="noopener">Ir a ${esc(d.name)}${ICON.external}</a>` : ''}
              </article>`).join('')}
          </div>
        </section>` : ''}

        <p class="sk-pp-foot">Los documentos y enlaces son los publicados por la universidad en el SII.
          <button type="button" data-pp-original>Ver vista original</button></p>
      </div>`;

    // Mover los enlaces originales a su nueva tarjeta
    const noticesBox = root.querySelector('[data-pp-notices]');
    notices.forEach((n) => {
      const card = document.createElement('article');
      card.className = 'sk-pp-notice';
      card.innerHTML = `
        <span class="sk-pp-notice-ic">${ICON.megaphone}</span>
        <div class="sk-pp-notice-body">
          ${n.title ? `<strong>${esc(n.title)}</strong>` : ''}
          ${n.text.map((t) => `<p>${esc(t)}</p>`).join('')}
          <div class="sk-pp-notice-actions"></div>
        </div>`;
      const actions = card.querySelector('.sk-pp-notice-actions');
      n.buttons.forEach((a) => { a.classList.add('sk-pp-action'); actions.append(a); });
      noticesBox.append(card);
    });
    const place = (list, box) => list.forEach((a) => {
      if (dbTriggers.has(a.id) && dbs.length) {
        // Los datos de acceso ya están a la vista: el mosaico lleva directo al sitio.
        const d = dbs.find((x) => (a.id === 'db_trigger' ? /ebsco/i : /ecest/i).test(x.name));
        if (d?.href) {
          const link = document.createElement('a');
          link.href = d.href; link.target = '_blank'; link.rel = 'noopener';
          link.innerHTML = clean(a.textContent);
          a = link;
        }
      }
      box.append(tile(a));
    });
    if (info.length) {
      // Los PDF se muestran como hojas; lo demás como tarjetas de acción.
      const isDoc = (x) => /\.pdf(\?|$)/i.test(x.getAttribute('href') || '');
      const docs = info.filter(isDoc);
      const services = info.filter((x) => !isDoc(x));
      docs.forEach((x) => root.querySelector('[data-pp-docs]').append(tile(x, 'doc')));
      place(services, root.querySelector('[data-pp-services]'));
      if (!docs.length) root.querySelector('[data-pp-docs-wrap]').remove();
      if (!services.length) root.querySelector('[data-pp-services-wrap]').remove();
    }
    if (library.length) place(library, root.querySelector('[data-pp-library]'));

    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-pp-original]')) { setOriginal(true); return; }
      const copy = e.target.closest('[data-copy]');
      if (!copy) return;
      navigator.clipboard?.writeText(copy.dataset.copy).then(() => {
        copy.innerHTML = ICON.check;
        copy.classList.add('is-done');
        setTimeout(() => { copy.innerHTML = ICON.clipboard; copy.classList.remove('is-done'); }, 1500);
      });
    });

    document.body.append(root);
    document.documentElement.classList.add('sk-panel-page');
  }

  // Convierte un enlace original en mosaico, conservando el mismo elemento <a>.
  // Cada acceso lleva su propio color (paleta categórica validada) y una descripción breve.
  function tile(a, variant = 'card') {
    const label = clean(a.querySelector('span')?.textContent || a.textContent || a.title);
    const href = a.getAttribute('href') || '';
    const kind = /\.pdf(\?|$)/i.test(href) ? 'PDF'
      : /^javascript:/i.test(href) || !href ? 'Abrir'
        : /^https?:/i.test(href) && !href.includes(location.host) ? 'Sitio externo' : 'En el SII';
    const m = metaFor(label);
    a.className = `${a.className} sk-pp-tile is-${variant}`.trim();
    a.style.setProperty('--c', m.color);
    a.innerHTML = variant === 'doc' ? `
      <span class="sk-pp-doc-sheet">
        <span class="sk-pp-tile-ic">${ICON[m.icon]}</span>
        <span class="sk-pp-doc-lines"><i></i><i></i><i></i></span>
        <span class="sk-pp-doc-badge">PDF</span>
      </span>
      <span class="sk-pp-tile-text"><strong>${esc(label)}</strong><small>${esc(m.desc || 'Documento')}</small></span>
      <span class="sk-pp-doc-open">Abrir ${ICON.external}</span>` : `
      <span class="sk-pp-tile-ic">${ICON[m.icon]}</span>
      <span class="sk-pp-tile-text"><strong>${esc(label)}</strong><small>${esc(m.desc || kind)}</small></span>
      <span class="sk-pp-tile-go" title="${kind}">${kind === 'PDF' || kind === 'Sitio externo' ? ICON.external : ICON.arrowRight}</span>`;
    if (/^https?:/i.test(href) && !a.target) a.target = '_blank';
    return a;
  }

  // Paleta categórica validada (la misma del horario); el texto siempre va en tinta.
  const C = { blue: '#2a78d6', orange: '#eb6834', green: '#1baf7a', amber: '#eda100', pink: '#e87ba4', leaf: '#008300', violet: '#6250d6' };
  function metaFor(label) {
    const n = norm(label);
    const map = [
      [/calendario/, 'calendar', C.blue, 'Fechas importantes del ciclo escolar'],
      [/cuota|costo/, 'card', C.green, 'Costos de servicios y trámites'],
      [/manual/, 'file', C.violet, 'Guía para usar el SII'],
      [/seguro|imss/, 'shield', C.orange, 'Alta en el seguro médico del IMSS'],
      [/curriculum/, 'idCard', C.pink, 'Tu CV para la bolsa de trabajo'],
      [/servicio social/, 'users', C.amber, 'Registro y seguimiento'],
      [/estancia|estadia/, 'briefcase', C.blue, 'Información y registro de estancias'],
      [/movilidad/, 'globe', C.green, 'Intercambios y programas en otras sedes'],
      [/lineamiento|reglamento/, 'clipboard', C.violet, 'Reglamento y préstamos'],
      [/biblioteca digital/, 'book', C.orange, 'Libros electrónicos'],
      [/base de datos|ebsco/, 'database', C.blue, 'Artículos y revistas académicas'],
      [/catalogo en linea/, 'search', C.leaf, 'Busca libros de la biblioteca'],
      [/agenda/, 'calendarCheck', C.blue, 'Agenda del cuatrimestre'],
      [/acceso/, 'key', C.amber, ''],
    ];
    const hit = map.find(([re]) => re.test(n));
    return hit ? { icon: hit[1], color: hit[2], desc: hit[3] } : { icon: 'file', color: C.blue, desc: '' };
  }

  // Librero ilustrado (decorativo) para la sección de biblioteca.
  function shelfSvg() {
    const colors = ['#1f3a5f', '#a3333d', '#c7a76a', '#2f6b6b', '#64748b', '#e2d6bd', '#2b4c78', '#8a2a33', '#3f6b4f', '#d9c79f', '#1f3a5f', '#b39256'];
    const heights = [118, 96, 132, 104, 124, 88, 140, 110, 100, 126, 92, 116];
    const widths = [22, 18, 26, 20, 24, 16, 26, 20, 18, 22, 16, 24];
    const base = 196;
    let x = 26;
    const books = heights.map((h, i) => {
      const w = widths[i];
      const c = colors[i];
      const band = /^#(e|d)/.test(c) ? 'rgba(31,58,95,.35)' : 'rgba(255,255,255,.55)';
      const lean = i === 5 ? ` transform="rotate(-14 ${x + w} ${base})"` : i === 9 ? ` transform="rotate(8 ${x} ${base})"` : '';
      const out = `<g${lean}><rect x="${x}" y="${base - h}" width="${w}" height="${h}" rx="2.5" fill="${c}"/>
        <rect x="${x + 3}" y="${base - h + 12}" width="${w - 6}" height="2.5" rx="1" fill="${band}"/>
        <rect x="${x + 3}" y="${base - 22}" width="${w - 6}" height="2.5" rx="1" fill="${band}"/>
        ${i % 3 === 0 ? `<rect x="${x + w / 2 - 3}" y="${base - h / 2 - 8}" width="6" height="16" rx="1.5" fill="${band}"/>` : ''}</g>`;
      x += w + (i === 4 ? 10 : i === 5 ? 14 : 2);
      return out;
    }).join('');
    return `<svg viewBox="0 0 440 220" aria-hidden="true" preserveAspectRatio="xMidYMax meet">
      <circle cx="372" cy="70" r="46" fill="#e6edf6"/>
      <g transform="translate(366 ${base - 46})">
        <path d="M6 0c-2-20-18-30-30-30 8 10 14 22 30 30zM6 0c0-22 10-38 24-44-4 14-8 30-24 44zM6 0c6-16 24-22 36-20-10 8-20 16-36 20z" fill="#3f6b4f"/>
        <path d="M-14 0h40l-6 46h-28z" fill="#c9b48a"/>
      </g>
      ${books}
      <rect x="10" y="${base}" width="420" height="10" rx="3" fill="#b39256"/>
      <rect x="18" y="${base + 10}" width="404" height="6" rx="2" fill="#e6d7b5"/>
    </svg>`;
  }

  // Lee usuario/contraseña de las ventanas de acceso del SII.
  function readDb(id, name, profile) {
    const box = document.getElementById(id);
    if (!box) return null;
    const ps = [...box.querySelectorAll('p')];
    const field = (re) => ps.find((p) => re.test(norm(p.textContent)));
    const userP = field(/^usuario/);
    const passP = field(/^contrasena/);
    let user = clean(userP?.querySelector('span')?.textContent);
    let pass = clean(passP?.querySelector('span')?.textContent);
    let hint = '';
    // ECEST: "PQU_TU MATRICULA" sin el cero inicial
    const mat = (profile.matricula || '').replace(/^0+/, '');
    if (/matricula/i.test(user) && mat) { user = user.replace(/tu matricula/i, mat).replace(/\s+/g, ''); hint = 'Se armó con tu matrícula, sin el cero inicial.'; }
    if (/matricula/i.test(pass) && mat) pass = mat;
    if (/matricula/i.test(user) || /matricula/i.test(pass)) hint = clean(userP?.textContent);
    const href = box.querySelector('a[href^="http"]')?.getAttribute('href') || '';
    const note = clean([...box.querySelectorAll('p')].find((p) => /nota/i.test(p.textContent))?.textContent).replace(/^nota:\s*/i, '');
    return { name, user, pass, href, hint: hint || note };
  }

  // Nombre y matrícula desde la columna del perfil de la página que contiene este iframe.
  function parentProfile() {
    try {
      const west = window.parent.document.querySelector('div[region="west"]');
      const get = (re) => {
        const th = [...(west?.querySelectorAll('th') || [])].find((t) => re.test(norm(t.textContent)));
        return clean(th?.nextElementSibling?.textContent);
      };
      return { name: get(/^nombre/), matricula: get(/^matricula/) };
    } catch {
      return {};
    }
  }

  function copyBtn(v) { return `<button type="button" class="sk-pp-copy" data-copy="${esc(v)}" aria-label="Copiar">${ICON.clipboard}</button>`; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function clean(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
  function norm(s) { return clean(s).toLowerCase().normalize('NFD').replace(/\p{M}/gu, ''); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
})();
