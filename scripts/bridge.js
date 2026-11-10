// Puente con EasyUI. Corre en el "mundo principal" de la página (manifest: "world": "MAIN")
// porque necesita el jQuery del SII; los scripts de la extensión no pueden verlo.
// No construye interfaz: solo ajusta el layout y obedece órdenes de app.js mediante eventos.
// Únicamente actúa si app.js marcó <html> con .sk-app-shell o .sk-app-home (skin activa).
(() => {
  const html = document.documentElement;
  const emit = (type, detail = {}) =>
    document.dispatchEvent(new CustomEvent(`skinupq:${type}`, { detail: JSON.stringify(detail) }));

  let tries = 0;
  const timer = setInterval(() => {
    if (++tries > 300) return clearInterval(timer); // se rinde a los ~15 s
    const $ = window.jQuery;
    if (!$ || !$.fn || !$.fn.layout || !$.data(document.body, 'layout')) return;

    if (html.classList.contains('sk-app-shell')) {
      clearInterval(timer);
      shell($);
    } else if (html.classList.contains('sk-app-home')) {
      const tabs = $('.tabs-container').first();
      if (!tabs.length || !$.data(tabs[0], 'tabs')) return;
      clearInterval(timer);
      home($, tabs);
    }
  }, 50);

  // EasyUI recalcula el layout con panel('options'), así que basta con cambiar las medidas ahí.
  function setRegion($, region, prop, value) {
    const p = $('body').layout('panel', region);
    if (p && p.length) p.panel('options')[prop] = value;
  }

  // Página exterior: encabezado de 64 px (lo cubre la barra nueva) y sin pie de página.
  function shell($) {
    setRegion($, 'north', 'height', 64);
    setRegion($, 'south', 'height', 0);
    $('body').layout('resize');
    emit('ready');
  }

  // Página interior (home/home): sin columna izquierda y con la tira de pestañas a 0 px
  // (CSS en app.css). La navegación la hace la barra superior.
  function home($, tabs) {
    setRegion($, 'west', 'width', 0);
    const fit = () => {
      $('body').layout('resize');
      tabs.tabs('resize');
    };
    fit();
    // El iframe cambia de alto cuando la página exterior reduce su encabezado (y al
    // redimensionar la ventana). EasyUI ajusta el layout, pero no las pestañas.
    let pending;
    $(window).resize(() => {
      clearTimeout(pending);
      pending = setTimeout(fit, 30);
    });

    const opts = tabs.tabs('options');
    const prev = opts.onSelect;
    opts.onSelect = function (title) {
      if (prev) prev.apply(this, arguments);
      emit('selected', { title });
    };

    const modules = tabs.tabs('tabs').map((p) => {
      const o = p.panel('options');
      return { title: o.title, href: o.href || '' };
    });
    const sel = tabs.tabs('getSelected');
    emit('modules', { modules, selected: sel ? sel.panel('options').title : '' });

    document.addEventListener('skinupq:cmd', (e) => {
      const cmd = JSON.parse(e.detail || '{}');
      if (cmd.type === 'select' && tabs.tabs('exists', cmd.title)) tabs.tabs('select', cmd.title);
      if (cmd.type === 'resize') fit();
    });
  }
})();
