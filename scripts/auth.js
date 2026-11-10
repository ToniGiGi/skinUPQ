// Rediseño de las pantallas públicas: inicio de sesión, recuperar contraseña y
// actualizar contraseña (temporal o expirada).
// IMPORTANTE: no se crean formularios nuevos. Se MUEVE el <form> original
// (con su token CSRF, action, nombres de campos y listeners) dentro de la nueva interfaz,
// así que lo que llega al servidor es exactamente lo mismo que antes.
(() => {
  const form = document.getElementById('frmLogin') || document.getElementById('frmRenew');
  if (!form || document.getElementById('skinupq-root')) return;

  const SIGNIN_URL = '/alumnos.php/signin';
  const MAIL_DOMAIN = 'upq.edu.mx';
  const asset = (p) => chrome.runtime.getURL(`assets/${p}`);

  const ICON = SK_ICON; // definido en scripts/icons.js

  const FEATURES = {
    login: [
      { icon: 'chart', title: 'Calificaciones', text: 'Revisa tus parciales y finales al momento.' },
      { icon: 'calendar', title: 'Horario', text: 'Tus clases y aulas del cuatrimestre.' },
      { icon: 'file', title: 'Kardex', text: 'Tu historial académico completo.' },
      { icon: 'clipboard', title: 'Trámites', text: 'Reinscripción, pagos y constancias.' },
    ],
    recover: [
      { icon: 'mail', title: 'Correo institucional', text: `La clave llega a tu cuenta @${MAIL_DOMAIN}.` },
      { icon: 'shield', title: 'Acceso seguro', text: 'Solo tú puedes restablecer tu contraseña.' },
      { icon: 'key', title: 'Nueva contraseña', text: 'Usa la clave del correo para crear una nueva.' },
    ],
    renew: [
      { icon: 'key', title: 'Contraseña única', text: 'No la compartas ni la reutilices de otras cuentas.' },
      { icon: 'shield', title: 'Más segura', text: 'Combina letras y números para hacerla fuerte.' },
      { icon: 'lock', title: 'Solo tú', text: 'Nadie de la universidad te la pedirá nunca.' },
    ],
  };

  const PAGES = {
    login: {
      detect: () => form.querySelector('#signin_username'),
      hero: 'Tu trayectoria.<br />Tu universidad,<br /><span>en un solo lugar.</span>',
      lead: 'Consulta calificaciones, horario, kardex y trámites escolares desde el Sitio del Alumno.',
      mobile: 'Tu universidad, <span>en un solo lugar.</span>',
      build: buildLogin,
    },
    recover: {
      detect: () => form.querySelector('#password_recovery_email'),
      hero: 'Recupera tu acceso.<br />Sin filas,<br /><span>sin complicaciones.</span>',
      lead: 'Te enviamos una clave de recuperación a tu correo institucional para que vuelvas a entrar en minutos.',
      mobile: 'Recupera tu acceso, <span>sin complicaciones.</span>',
      help: false, // vista estática: sin bloque de ayuda para que quepa en pantalla
      build: buildRecover,
    },
    renew: {
      detect: () => document.getElementById('password_renew_new_password'),
      hero: 'Un nuevo comienzo.<br />Tu cuenta,<br /><span>más segura.</span>',
      lead: 'Crea una contraseña que solo tú conozcas para proteger tu información escolar.',
      mobile: 'Tu cuenta, <span>más segura.</span>',
      help: false,
      build: buildRenew,
    },
  };

  const page = Object.keys(PAGES).find((k) => PAGES[k].detect());
  if (!page) {
    // Estructura desconocida: no tocar nada y volver a mostrar la página original.
    document.documentElement.classList.add('skinupq-nologin');
    return;
  }

  chrome.storage.sync.get({ enabled: true }, ({ enabled }) => {
    if (!enabled) return;
    // Se leen antes de mover nada, mientras el marcado original sigue intacto.
    const ctx = { messages: collectMessages(), phone: readPhone() };
    const root = shell(PAGES[page], ctx);
    PAGES[page].build(root, ctx);
    document.body.append(root);
    startCarousel(root.querySelector('.sk-feature'), root.querySelector('.sk-dots'), FEATURES[page]);
  });

  // ---------- Estructura común: panel con foto + tarjeta ----------
  function shell(cfg, ctx) {
    const root = el('div', { id: 'skinupq-root', class: `sk-login sk-page-${page}` });
    root.style.setProperty('--sk-photo', `url("${asset('campus.jpg')}")`);
    root.innerHTML = `
      <aside class="sk-hero">
        <div class="sk-hero-content">
          <img class="sk-hero-logo" src="${asset('upqlogoblanco.png')}" alt="UPQ" />
          <div class="sk-hero-copy">
            <h1>${cfg.hero}</h1>
            <p>${cfg.lead}</p>
          </div>
          <div class="sk-feature" aria-live="polite"></div>
          <div class="sk-dots" role="tablist" aria-label="Funciones"></div>
          <p class="sk-tagline">${ICON.shield}<span>Universidad Politécnica de Querétaro</span></p>
        </div>
      </aside>
      <main class="sk-panel">
        <div class="sk-mobile-head">
          <h1>${cfg.mobile}</h1>
          <p>Sitio del Alumno · SII</p>
        </div>
        <div class="sk-card">
          <div class="sk-card-body"></div>
          <p class="sk-copy">© ${new Date().getFullYear()} Universidad Politécnica de Querétaro</p>
        </div>
        ${cfg.help === false ? '' : `<div class="sk-help">
          ¿Necesitas ayuda? Servicios Estudiantiles · servicios.estudiantiles@${MAIL_DOMAIN}${ctx.phone ? ` · ${ctx.phone}` : ''}
        </div>`}
      </main>`;

    // Si un logo no carga, usar texto.
    root.querySelectorAll('.sk-hero-logo').forEach((img) => {
      img.addEventListener('error', () => img.replaceWith(el('span', { class: 'sk-wordmark' }, 'UPQ')), { once: true });
    });
    return root;
  }

  function brand() {
    const b = el('div', { class: 'sk-brand' });
    b.innerHTML = `<img src="${asset('upqlogonegro.png')}" alt="UPQ" /><p>Sistema Integral de Información</p>`;
    b.querySelector('img').addEventListener('error', (e) => e.target.replaceWith(el('span', { class: 'sk-wordmark' }, 'UPQ')), { once: true });
    return b;
  }

  // ---------- Inicio de sesión ----------
  function buildLogin(root, { messages }) {
    const body = root.querySelector('.sk-card-body');
    const user = form.querySelector('#signin_username');
    const pass = form.querySelector('#signin_password');
    const submit = form.querySelector('input[type="submit"]');
    const recover = form.querySelector('a[href*="password-recover"]');

    const welcome = el('div', { class: 'sk-welcome' });
    welcome.innerHTML = '<h2>Bienvenido de nuevo</h2><p>Inicia sesión con tu matrícula para continuar</p>';

    prepInput(user, 'Matrícula', 'username');
    prepInput(pass, 'Contraseña', 'current-password');

    // Recordarme: guarda solo la matrícula, en el almacenamiento de la extensión.
    const remember = el('input', { type: 'checkbox', id: 'sk-remember', class: 'sk-check' });
    const rememberLabel = el('label', { class: 'sk-remember', for: 'sk-remember' });
    rememberLabel.append(remember, el('span', {}, 'Recordarme'));

    const options = el('div', { class: 'sk-options' });
    options.append(rememberLabel);
    if (recover) {
      recover.className = 'sk-link';
      recover.textContent = '¿Olvidaste tu contraseña?';
      options.append(recover);
    }

    const fields = el('div', { class: 'sk-fields' });
    fields.append(field(user, ICON.user), field(pass, ICON.lock, eyeButton(pass)), options);

    const submitWrap = submitButton(submit, ICON.login);
    replaceOldFields(fields);
    if (messages.length) form.append(alertBox(messages));
    form.append(submitWrap);

    form.addEventListener('submit', () => {
      chrome.storage.local[remember.checked ? 'set' : 'remove'](
        remember.checked ? { rememberedUser: user.value.trim() } : 'rememberedUser',
      );
      submitWrap.classList.add('is-loading');
    });

    chrome.storage.local.get({ rememberedUser: '' }, ({ rememberedUser }) => {
      if (rememberedUser && !user.value) {
        user.value = rememberedUser;
        remember.checked = true;
        pass.focus();
      }
    });

    body.append(brand(), welcome, form);
    requestAnimationFrame(() => (messages.length && user.value ? pass : user).focus());
  }

  // ---------- Recuperar contraseña ----------
  function buildRecover(root, { messages }) {
    const body = root.querySelector('.sk-card-body');
    const email = form.querySelector('#password_recovery_email');
    const submit = form.querySelector('input[type="submit"]');
    backLink(root);

    const head = el('div', { class: 'sk-welcome sk-welcome-icon' });
    head.innerHTML = `
      <span class="sk-badge">${ICON.key}</span>
      <h2>¿Olvidaste tu contraseña?</h2>
      <p>Escribe tu matrícula o correo institucional y te enviaremos una clave para restablecerla.</p>`;

    prepInput(email, `matricula@${MAIL_DOMAIN}`, 'email');
    email.type = 'text'; // se deja "text" para aceptar solo la matrícula
    email.inputMode = 'email';
    email.setAttribute('aria-describedby', 'sk-email-hint');

    // Ayuda en vivo: si escriben solo la matrícula, se completa el dominio al enviar.
    const hint = el('p', { class: 'sk-hint', id: 'sk-email-hint' });
    const setHint = (html, tone = '') => {
      hint.innerHTML = html;
      hint.dataset.tone = tone;
    };
    const defaultHint = () => setHint(`Basta con tu matrícula; agregamos <b>@${MAIL_DOMAIN}</b>.`);
    const resolve = () => {
      const v = email.value.trim().toLowerCase();
      if (!v) return '';
      return v.includes('@') ? v : `${v}@${MAIL_DOMAIN}`;
    };
    const valid = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

    email.addEventListener('input', () => {
      email.closest('.sk-input').classList.remove('is-invalid');
      const v = email.value.trim();
      if (!v) return defaultHint();
      if (!v.includes('@')) return setHint(`Se enviará a <b>${escapeHtml(resolve())}</b>`, 'ok');
      if (!v.toLowerCase().endsWith(`@${MAIL_DOMAIN}`)) {
        return setHint(`Usa tu correo institucional <b>@${MAIL_DOMAIN}</b>.`, 'warn');
      }
      setHint('');
    });
    defaultHint();

    const fields = el('div', { class: 'sk-fields' });
    fields.append(field(email, ICON.mail), hint);

    const submitWrap = submitButton(submit, ICON.send);
    replaceOldFields(fields);
    if (messages.length) form.append(alertBox(messages));
    form.append(submitWrap);

    form.addEventListener('submit', (e) => {
      const v = resolve();
      if (!valid(v)) {
        e.preventDefault();
        email.closest('.sk-input').classList.add('is-invalid');
        setHint('Escribe tu matrícula o un correo válido.', 'error');
        email.focus();
        return;
      }
      email.value = v;
      submitWrap.classList.add('is-loading');
    });

    // Pasos: qué esperar después de enviar.
    const steps = el('ol', { class: 'sk-steps' });
    steps.innerHTML = `
      <li><span>1</span><div><strong>Envía tu correo</strong><p>Te mandamos una clave de recuperación.</p></div></li>
      <li><span>2</span><div><strong>Revisa tu bandeja</strong><p>Puede tardar hasta 5 minutos. Revisa también <b>spam</b> o correo no deseado.</p></div></li>
      <li><span>3</span><div><strong>Crea una nueva contraseña</strong><p>Usa la clave para entrar y cambiarla.</p></div></li>`;

    body.append(head, form, steps);

    // Si el alumno ya usó "Recordarme" en el login, prellenar su matrícula.
    chrome.storage.local.get({ rememberedUser: '' }, ({ rememberedUser }) => {
      if (rememberedUser && !email.value) {
        email.value = rememberedUser;
        email.dispatchEvent(new Event('input'));
      }
      requestAnimationFrame(() => email.focus());
    });
  }

  // ---------- Actualizar contraseña (temporal o expirada) ----------
  function buildRenew(root, { messages }) {
    const body = root.querySelector('.sk-card-body');
    const $ = (id) => document.getElementById(`password_renew_${id}`);
    const user = $('username');
    const old = $('old_password');
    const pass = $('new_password');
    const confirm = $('confirm_password');
    const submit = form.querySelector('input[type="submit"]');
    backLink(root);

    const head = el('div', { class: 'sk-welcome sk-welcome-icon' });
    head.innerHTML = `
      <span class="sk-badge">${ICON.lockKey}</span>
      <h2>Crea una nueva contraseña</h2>
      <p>Tu contraseña actual es temporal o ya expiró. Por seguridad, define una nueva para continuar.</p>`;

    prepInput(user, 'Matrícula', 'username');
    prepInput(old, 'Contraseña actual o temporal', 'current-password');
    prepInput(pass, 'Nueva contraseña', 'new-password');
    prepInput(confirm, 'Confirma la nueva contraseña', 'new-password');

    // Medidor de seguridad + requisitos en vivo.
    const meter = el('div', { class: 'sk-meter', 'aria-live': 'polite' });
    meter.innerHTML = `
      <div class="sk-meter-bar"><i></i><i></i><i></i><i></i></div>
      <span class="sk-meter-label"></span>`;
    const RULES = [
      { id: 'len', text: '8 caracteres o más', test: (v) => v.length >= 8 },
      { id: 'mix', text: 'Letras y números', test: (v) => /[a-zñáéíóú]/i.test(v) && /\d/.test(v) },
      { id: 'diff', text: 'Distinta a la actual', test: (v) => !!v && v !== old.value },
    ];
    const rules = el('ul', { class: 'sk-rules' });
    RULES.forEach((r) => {
      const li = el('li', { 'data-rule': r.id });
      li.innerHTML = `<span class="sk-rule-icon">${ICON.check}</span>${r.text}`;
      rules.append(li);
    });
    const symbolHint = el('p', { class: 'sk-hint', 'data-tone': 'warn', hidden: '' });
    symbolHint.textContent = 'El SII pide caracteres alfanuméricos; evita símbolos y espacios.';

    const match = el('span', { class: 'sk-match', 'aria-hidden': 'true' });

    const strength = (v) => {
      if (!v) return 0;
      let n = 0;
      if (v.length >= 8) n++;
      if (v.length >= 12) n++;
      if (/[a-z]/i.test(v) && /\d/.test(v)) n++;
      if (/[a-zñ]/.test(v) && /[A-ZÑ]/.test(v)) n++;
      return Math.max(1, n);
    };
    const LEVELS = ['', 'Débil', 'Regular', 'Buena', 'Fuerte'];

    const clientError = el('div', { class: 'sk-alert sk-alert-error', role: 'alert', hidden: '' });

    function update() {
      const v = pass.value;
      const lvl = strength(v);
      meter.dataset.level = String(lvl);
      meter.querySelector('.sk-meter-label').textContent = v ? `Seguridad: ${LEVELS[lvl]}` : 'Seguridad de la contraseña';
      RULES.forEach((r) => rules.querySelector(`[data-rule="${r.id}"]`).classList.toggle('is-ok', r.test(v)));
      symbolHint.hidden = !/[^a-z0-9ñáéíóú]/i.test(v);

      const c = confirm.value;
      match.dataset.state = !c ? '' : c === v ? 'ok' : 'bad';
      match.innerHTML = !c ? '' : c === v ? ICON.check : ICON.x;
      match.title = !c ? '' : c === v ? 'Las contraseñas coinciden' : 'Las contraseñas no coinciden';
    }
    [user, old, pass, confirm].forEach((i) => i.addEventListener('input', () => {
      i.closest('.sk-input')?.classList.remove('is-invalid');
      clientError.hidden = true;
      update();
    }));

    const fields = el('div', { class: 'sk-fields' });
    fields.append(
      el('p', { class: 'sk-section' }, 'Cuenta actual'),
      field(user, ICON.user),
      field(old, ICON.lock, eyeButton(old)),
      el('p', { class: 'sk-section' }, 'Nueva contraseña'),
      field(pass, ICON.key, eyeButton(pass)),
      meter,
      rules,
      symbolHint,
      field(confirm, ICON.key, match, eyeButton(confirm)),
    );

    const submitWrap = submitButton(submit, ICON.check);
    replaceOldFields(fields);
    // El aviso "tu contraseña es temporal o expiró" ya lo dice el encabezado; se muestran solo los demás.
    const extra = messages.filter((m) => !/temporal|expir/i.test(m.text));
    if (extra.length) form.append(alertBox(extra));
    form.append(clientError, submitWrap);

    form.addEventListener('submit', (e) => {
      const problems = [];
      const mark = (input) => input.closest('.sk-input').classList.add('is-invalid');
      if (!user.value.trim()) { problems.push('Escribe tu matrícula.'); mark(user); }
      if (!old.value) { problems.push('Escribe tu contraseña actual o temporal.'); mark(old); }
      const failed = RULES.filter((r) => !r.test(pass.value));
      if (failed.length) {
        problems.push(`La nueva contraseña necesita: ${failed.map((r) => r.text.toLowerCase()).join(', ')}.`);
        mark(pass);
      }
      if (confirm.value !== pass.value) { problems.push('Las contraseñas no coinciden.'); mark(confirm); }
      if (problems.length) {
        e.preventDefault();
        clientError.innerHTML = ICON.alert;
        clientError.append(el('p', {}, problems[0]));
        clientError.hidden = false;
        form.querySelector('.is-invalid input')?.focus();
        return;
      }
      submitWrap.classList.add('is-loading');
    });

    body.append(head, form);
    update();

    chrome.storage.local.get({ rememberedUser: '' }, ({ rememberedUser }) => {
      if (rememberedUser && !user.value) user.value = rememberedUser;
      requestAnimationFrame(() => [user, old, pass].find((i) => !i.value)?.focus());
    });
  }

  // ---------- Piezas compartidas ----------
  // "Volver" arriba de la tarjeta, como navegación secundaria.
  function backLink(root) {
    const href = document.querySelector(`a[href$="${SIGNIN_URL}"]`)?.getAttribute('href') || SIGNIN_URL;
    const back = el('a', { class: 'sk-back', href });
    back.innerHTML = `${ICON.back}<span>Volver a iniciar sesión</span>`;
    root.querySelector('.sk-panel').insertBefore(back, root.querySelector('.sk-card'));
  }

  function eyeButton(input) {
    const eye = el('button', { type: 'button', class: 'sk-eye', 'aria-label': 'Mostrar contraseña' });
    eye.innerHTML = ICON.eye;
    eye.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      eye.innerHTML = show ? ICON.eyeOff : ICON.eye;
      eye.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
      input.focus();
    });
    return eye;
  }
  function prepInput(input, placeholder, autocomplete) {
    input.placeholder = placeholder;
    input.autocomplete = autocomplete;
    input.spellcheck = false;
    input.setAttribute('autocapitalize', 'none');
    input.setAttribute('aria-label', placeholder);
    input.classList.remove('w-150');
  }

  // El submit real es un <input>, así que el ícono va en un contenedor encima.
  // No se cambia su value ni se deshabilita: ambos viajan al servidor.
  function submitButton(submit, icon) {
    submit.className = 'sk-submit';
    const wrap = el('span', { class: 'sk-submit-wrap' });
    const ic = el('span', { class: 'sk-submit-icon' });
    ic.innerHTML = icon;
    wrap.append(submit, ic);
    return wrap;
  }

  // Los campos visibles ya se movieron a `fields`; del marcado viejo solo se conservan
  // los <input type="hidden"> (CSRF, tipo de usuario), que son hijos directos del form.
  function replaceOldFields(fields) {
    [...form.children].forEach((c) => {
      if (!(c.tagName === 'INPUT' && c.type === 'hidden')) c.remove();
    });
    form.classList.remove('fondo');
    form.append(fields);
  }

  function alertBox(messages) {
    const box = el('div', { class: 'sk-alerts' });
    messages.forEach(({ text, tone }) => {
      const a = el('div', { class: `sk-alert sk-alert-${tone}`, role: tone === 'error' ? 'alert' : 'status' });
      a.innerHTML = tone === 'success' ? ICON.ok : ICON.alert;
      a.append(el('p', {}, text));
      box.append(a);
    });
    return box;
  }

  function field(input, icon, ...extras) {
    const wrap = el('div', { class: 'sk-input' });
    const ic = el('span', { class: 'sk-input-icon' });
    ic.innerHTML = icon;
    wrap.append(ic, input, ...extras);
    return wrap;
  }

  function startCarousel(box, dots, items) {
    let i = 0;
    let timer;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

    items.forEach((f, n) => {
      const d = el('button', { type: 'button', class: 'sk-dot', role: 'tab', 'aria-label': f.title });
      d.addEventListener('click', () => { show(n); restart(); });
      dots.append(d);
    });

    function show(n) {
      i = n;
      const f = items[n];
      box.classList.remove('is-in');
      box.innerHTML = `
        <span class="sk-feature-icon">${ICON[f.icon]}</span>
        <span class="sk-feature-text"><strong>${f.title}</strong><span>${f.text}</span></span>`;
      void box.offsetWidth; // reinicia la animación de entrada
      box.classList.add('is-in');
      [...dots.children].forEach((d, k) => d.setAttribute('aria-selected', String(k === n)));
    }
    function restart() {
      clearInterval(timer);
      if (!reduce) timer = setInterval(() => show((i + 1) % items.length), 4500);
    }
    show(0);
    restart();
  }

  // Mensajes del servidor (credenciales incorrectas, correo enviado, etc.).
  // No conocemos el marcado exacto, así que buscamos patrones comunes de Symfony 1.x.
  function collectMessages() {
    const sel = '.error_list li, .error, .flash_error, .msg-error, .alert, .warning, .flash_notice, .notice, .success, .flash_success';
    const scope = document.getElementById('main-panel') || document.body;
    const seen = new Set();
    return [...scope.querySelectorAll(sel)]
      .map((n) => ({
        text: n.textContent.trim(),
        tone: messageTone(n),
      }))
      .filter(({ text }) => text && !seen.has(text) && seen.add(text));
  }

  // Ej.: "notice icon-32-error" es un aviso, no un éxito; lo de error manda sobre lo demás.
  function messageTone(n) {
    const c = n.className;
    if (n.closest('.error_list') || /\berror\b|flash_error|msg-error/.test(c)) return 'error';
    if (/warning|icon-32-(error|warning)/.test(c)) return 'warn';
    if (/notice|success/.test(c)) return 'success';
    return 'error';
  }

  // El teléfono de contacto cambia según la página, así que se lee del HTML original.
  function readPhone() {
    const raw = [...document.querySelectorAll('#main-panel span')]
      .map((s) => s.textContent.trim())
      .find((t) => /\(\d{3}\)/.test(t));
    return raw ? raw.replace(/\.$/, '').replace(/\((\d{3})\)-?(\d{3})(\d{4})/, '($1) $2 $3') : '';
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function el(tag, attrs = {}, text) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    return n;
  }
})();
