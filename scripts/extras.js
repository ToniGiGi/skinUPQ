(() => {
  const user = document.getElementById('signin_username');
  if (!user) return;

  const CODE = '180925';
  let playing = false;

  const isCode = () => user.value.trim() === CODE && !document.documentElement.classList.contains('skinupq-off');
  const start = () => {
    if (playing) return;
    playing = true;
    play().finally(() => { playing = false; });
  };

  user.addEventListener('input', () => { if (isCode()) start(); });

  // Con Enter o "Entrar" el formulario recargaría la página y cortaría la animación.
  user.form?.addEventListener('submit', (e) => {
    if (!isCode()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    start();
  }, true);

  const CSS = `
    #sk-ad{position:fixed;inset:0;z-index:2147483647;pointer-events:none;overflow:hidden;font-family:Georgia,'Times New Roman',serif}
    #sk-ad .bg{position:absolute;inset:0;background:radial-gradient(circle at 50% 50%,rgba(74,16,52,.55),rgba(10,12,32,.82));opacity:0}
    #sk-ad .stage{position:absolute;left:50%;top:50%;width:0;height:0}
    #sk-ad .balloon{position:absolute;left:-75px;top:-68px;width:150px}
    #sk-ad .sway{transform-origin:50% 30%}
    #sk-ad .heart{display:block;width:150px;height:140px;overflow:visible}
    #sk-ad .string{display:block;width:150px;height:150px;margin-top:-6px;overflow:visible}
    #sk-ad .flash{position:absolute;left:-90px;top:-90px;width:180px;height:180px;border-radius:50%;
      background:radial-gradient(circle,#fff 0,rgba(255,214,231,.9) 30%,rgba(255,105,160,0) 70%);opacity:0}
    #sk-ad .ring{position:absolute;left:-80px;top:-80px;width:160px;height:160px;border-radius:50%;border:3px solid rgba(255,190,215,.9);opacity:0}
    #sk-ad .bit{position:absolute;left:0;top:0;will-change:transform,opacity}
    #sk-ad .word{position:absolute;left:0;top:0;transform:translate(-50%,-50%);display:flex;align-items:center;gap:.28em;
      font-size:clamp(64px,12vw,150px);font-style:italic;font-weight:700;line-height:1;white-space:nowrap;
      filter:drop-shadow(0 0 8px rgba(255,150,190,.9)) drop-shadow(0 0 26px rgba(255,70,140,.65)) drop-shadow(0 0 60px rgba(255,60,130,.35))}
    #sk-ad .ch{display:inline-block;opacity:0;padding:0 .06em;
      background:linear-gradient(110deg,#ffd1e1 0%,#fff 22%,#ff8fb6 40%,#fff6fa 50%,#ff6f9f 62%,#ffe3ee 80%,#fff 100%);
      background-size:250% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;
      animation:sk-ad-shine 2.4s linear infinite}
    #sk-ad .ch.plus{font-size:.55em;font-style:normal}
    @keyframes sk-ad-shine{from{background-position:120% 0}to{background-position:-130% 0}}
  `;

  const HEART = 'M75 132C38 106 6 80 6 47 6 24 23 7 45 7c13 0 24 7 30 18 6-11 17-18 30-18 22 0 39 17 39 40 0 33-32 59-69 85z';
  const MINI_HEART = 'M12 21C6 16.5 2 13 2 8.5 2 5.4 4.4 3 7.4 3c1.9 0 3.6 1 4.6 2.6C13 4 14.7 3 16.6 3 19.6 3 22 5.4 22 8.5 22 13 18 16.5 12 21z';
  const STAR = 'M12 0C12.8 7.2 16.8 11.2 24 12 16.8 12.8 12.8 16.8 12 24 11.2 16.8 7.2 12.8 0 12 7.2 11.2 11.2 7.2 12 0z';

  const rand = (a, b) => a + Math.random() * (b - a);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const svgEl = (w, h, vb, inner) => {
    const d = document.createElement('div');
    d.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${vb}" style="display:block;overflow:visible;width:${w}px;height:${h}px">${inner}</svg>`;
    return d.firstChild;
  };

  async function play() {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const root = document.createElement('div');
    root.id = 'sk-ad';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = `<style>${CSS}</style><div class="bg"></div><div class="stage"></div>`;
    // auth.css oculta todo lo que cuelga de <body> salvo #skinupq-root.
    (document.getElementById('skinupq-root') || document.body).append(root);
    const bg = root.querySelector('.bg');
    const stage = root.querySelector('.stage');

    bg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 600, fill: 'forwards' });

    if (!reduce) await balloon(stage);
    const word = letters(stage, reduce);
    if (!reduce) twinkle(stage, word);

    await wait(reduce ? 3200 : 4200);
    await Promise.all([
      bg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 900, fill: 'forwards' }).finished,
      word.animate([{ opacity: 1, transform: 'translate(-50%,-50%) scale(1)' }, { opacity: 0, transform: 'translate(-50%,-56%) scale(1.06)' }],
        { duration: 900, easing: 'ease-in', fill: 'forwards' }).finished,
    ]);
    root.remove();
  }

  // ---------- Globo: sube, se infla y explota ----------
  async function balloon(stage) {
    const b = document.createElement('div');
    b.className = 'balloon';
    b.innerHTML = `
      <div class="sway">
        <svg class="heart" viewBox="0 0 150 140">
          <defs>
            <radialGradient id="sk-ad-g" cx="38%" cy="32%" r="75%">
              <stop offset="0" stop-color="#ffb3cb"/><stop offset=".45" stop-color="#f0426f"/><stop offset="1" stop-color="#a3123f"/>
            </radialGradient>
          </defs>
          <path d="${HEART}" fill="url(#sk-ad-g)"/>
          <ellipse cx="42" cy="38" rx="17" ry="10" fill="#fff" opacity=".55" transform="rotate(-35 42 38)"/>
          <ellipse cx="58" cy="25" rx="4" ry="3" fill="#fff" opacity=".6"/>
          <path d="M69 131l6 9 6-9z" fill="#b5174a"/>
        </svg>
      </div>
      <svg class="string" viewBox="0 0 150 150">
        <path d="M75 0c-9 18 9 30 0 48s9 30 0 48-9 30 0 54" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="1.6" stroke-linecap="round"/>
      </svg>`;
    stage.append(b);
    const sway = b.querySelector('.sway');
    const heart = b.querySelector('.heart');
    const string = b.querySelector('.string');

    const swing = sway.animate(
      [{ transform: 'rotate(-5deg)' }, { transform: 'rotate(5deg)' }],
      { duration: 1100, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' },
    );
    const from = innerHeight / 2 + 120;
    await b.animate(
      [
        { transform: `translate(0, ${from}px)` },
        { transform: `translate(-14px, ${from * 0.45}px)`, offset: 0.45 },
        { transform: 'translate(10px, 30px)', offset: 0.8 },
        { transform: 'translate(0, 0)' },
      ],
      { duration: 3000, easing: 'cubic-bezier(.25,.75,.35,1)', fill: 'forwards' },
    ).finished;

    // Se detiene y se "infla" un par de veces
    swing.cancel();
    await heart.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(1.08,.95)' },
        { transform: 'scale(.97,1.06)' },
        { transform: 'scale(1.14)' },
        { transform: 'scale(1.1,1.16)' },
      ],
      { duration: 650, easing: 'ease-in-out', fill: 'forwards' },
    ).finished;

    // Explota
    heart.animate([{ transform: 'scale(1.16)', opacity: 1 }, { transform: 'scale(1.6)', opacity: 0 }], { duration: 110, fill: 'forwards' });
    string.animate(
      [{ transform: 'translate(0,0) rotate(0)', opacity: 1 }, { transform: 'translate(18px,260px) rotate(24deg)', opacity: 0 }],
      { duration: 1100, easing: 'cubic-bezier(.5,0,.9,.6)', fill: 'forwards' },
    );
    burst(stage);
    await wait(180);
  }

  function burst(stage) {
    const flash = document.createElement('div');
    flash.className = 'flash';
    const ring = document.createElement('div');
    ring.className = 'ring';
    stage.append(flash, ring);
    flash.animate([{ transform: 'scale(.3)', opacity: 1 }, { transform: 'scale(2.6)', opacity: 0 }], { duration: 650, easing: 'ease-out', fill: 'forwards' });
    ring.animate([{ transform: 'scale(.4)', opacity: 1 }, { transform: 'scale(3.4)', opacity: 0 }], { duration: 900, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });

    const colors = ['#f0426f', '#ff7aa2', '#ffb3cb', '#d81b5a', '#fff'];
    for (let i = 0; i < 34; i++) {
      const kind = i % 3;
      const color = colors[i % colors.length];
      const size = kind === 0 ? rand(14, 26) : kind === 1 ? rand(8, 14) : rand(10, 18);
      const node = kind === 0
        ? svgEl(size, size, '0 0 24 24', `<path d="${MINI_HEART}" fill="${color}"/>`)
        : kind === 1
          ? svgEl(size, size * 0.6, '0 0 10 6', `<rect width="10" height="6" rx="2.5" fill="${color}"/>`)
          : svgEl(size, size, '0 0 24 24', `<path d="${STAR}" fill="#fff6c8"/>`);
      const bit = document.createElement('div');
      bit.className = 'bit';
      bit.append(node);
      stage.append(bit);

      const ang = rand(0, Math.PI * 2);
      const dist = rand(130, 340);
      const x = Math.cos(ang) * dist;
      const y = Math.sin(ang) * dist * 0.85;
      const rot = rand(-260, 260);
      const half = -size / 2;
      bit.animate(
        [
          { transform: `translate(${half}px,${half}px) rotate(0) scale(.4)`, opacity: 1 },
          { transform: `translate(${x * 0.8 + half}px,${y * 0.8 + half}px) rotate(${rot * 0.6}deg) scale(1)`, opacity: 1, offset: 0.35 },
          { transform: `translate(${x + half}px,${y + 160 + half}px) rotate(${rot}deg) scale(.7)`, opacity: 0 },
        ],
        { duration: rand(1300, 2000), easing: 'cubic-bezier(.15,.75,.4,1)', fill: 'forwards' },
      ).finished.then(() => bit.remove());
    }
  }

  // ---------- Letras A + D ----------
  function letters(stage, reduce) {
    const word = document.createElement('div');
    word.className = 'word';
    word.innerHTML = '<span class="ch">A</span><span class="ch plus">+</span><span class="ch">D</span>';
    stage.append(word);
    [...word.children].forEach((ch, i) => {
      ch.animate(
        reduce
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [
              { opacity: 0, transform: 'translateY(30px) scale(.2)', filter: 'blur(10px)' },
              { opacity: 1, transform: 'translateY(-6px) scale(1.18)', filter: 'blur(0)', offset: 0.6 },
              { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0)' },
            ],
        { duration: reduce ? 600 : 750, delay: i * 140, easing: 'cubic-bezier(.3,1.4,.5,1)', fill: 'forwards' },
      );
    });
    return word;
  }

  // Brillos que titilan alrededor de las letras mientras se ven
  function twinkle(stage, word) {
    const box = word.getBoundingClientRect();
    const w = box.width / 2 + 40;
    const h = box.height / 2 + 30;
    for (let i = 0; i < 22; i++) {
      const size = rand(12, 28);
      const bit = document.createElement('div');
      bit.className = 'bit';
      bit.append(svgEl(size, size, '0 0 24 24', `<path d="${STAR}" fill="${i % 3 ? '#fff' : '#ffd6e6'}"/>`));
      stage.append(bit);
      const x = rand(-w, w) - size / 2;
      const y = rand(-h, h) - size / 2;
      bit.style.opacity = '0';
      bit.animate(
        [
          { transform: `translate(${x}px,${y}px) scale(0) rotate(0)`, opacity: 0 },
          { transform: `translate(${x}px,${y}px) scale(1) rotate(45deg)`, opacity: 1, offset: 0.5 },
          { transform: `translate(${x}px,${y}px) scale(0) rotate(90deg)`, opacity: 0 },
        ],
        { duration: rand(900, 1500), delay: 300 + rand(0, 900), iterations: 3, easing: 'ease-in-out' },
      );
    }
  }
})();
