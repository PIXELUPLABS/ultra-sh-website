/* Ultra.sh — interactions & scroll motion
   Lenis smooth scroll + GSAP (ScrollTrigger, ScrambleText, SplitText).
   Text effects mirror webisoft.com's implementation:
     hover  → scrambleText { chars: brand letters, speed 1.2 }, 0.8s, ease none
     appear → text blank until in view, scrambleText { speed 1 }, 1.2s, power2.out, "top 80%"
     prose  → SplitText chars, colour scrubbed from a dim base as the paragraph scrolls */
(() => {
  const root = document.documentElement;
  const mqDesktop = window.matchMedia('(min-width: 901px)');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasGSAP = !!(window.gsap && window.ScrollTrigger);
  const hasScramble = hasGSAP && !!window.ScrambleTextPlugin;
  const motion = hasGSAP && !reduceMotion;

  /* ---------- a refresh starts at the top (the browser would otherwise restore the old scroll
     position, mid-way through the scroll animations); a #link still lands on its section ---------- */
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  if (!location.hash) window.scrollTo(0, 0);
  window.addEventListener('pagehide', () => { if (!location.hash) window.scrollTo(0, 0); });

  /* ---------- fluid scale: 1rem = viewport / 144 on desktop ---------- */
  const setScale = () => {
    root.style.fontSize = mqDesktop.matches ? root.clientWidth / 144 + 'px' : '';
  };
  setScale();
  const remPx = () => parseFloat(getComputedStyle(root).fontSize);

  /* ---------- live glyph fields (Beam Loop, from Outbound.dev/beam-loop) in the hero + CTA ----------
     Same defaults as the Beam Loop tool's "Glyph field": HUD, bracket cursor, cell readout, hover heat,
     click ripples. Rendering only runs while the field is on screen; pointer input is enabled for
     mouse/trackpad only so it never blocks touch scrolling. Without WebGL2 the static art stays. */
  /* Denser, larger glyphs along the hero field's left side and top edges so the stepped shape reads,
     kept loose rather than ruled: the band's depth wanders, about a quarter of its cells are knocked
     out, and the top band thins out towards the right. Matches the CSS clip (a block 21.51% wide at
     the top-left, full width from 21.19% down). Returns a minimum density level per cell. */
  const outlineFloor = (cv) => {
    const r = cv.getBoundingClientRect();
    const host = cv.closest('section');
    const vb = host ? Math.min(1, Math.max(0.2, (host.getBoundingClientRect().bottom - r.top) / r.height)) : 1;
    const hash = (a) => { const s = Math.sin(a) * 43758.5453; return s - Math.floor(s); };
    return (c, row, cols, rows, rand) => {
      const x = c + 0.5, y = row + 0.5, BX = 0.2151 * cols, SY = 0.2119 * rows, R = cols, B = vb * rows;
      if (y >= B || (y < SY && x >= BX)) return 0;           // outside the visible shape
      const seg = (ax, ay, bx, by) => {
        const dx = bx - ax, dy = by - ay;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
        return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
      };
      // left side, top of the top-left block, and the step's top edge (thinning towards the right)
      const d = Math.min(seg(0, 0, 0, B), seg(0, 0, BX, 0), seg(BX, SY, R, SY) * (1 + 1.1 * (x / R)));
      const wander = 0.6 + 0.8 * (0.5 + 0.5 * Math.sin(c * 0.55 + row * 0.31) * Math.cos(c * 0.21 - row * 0.67));
      let level = 9.2 - (2.5 / wander) * d - rand * 1.8;
      const knock = hash(c * 12.9898 + row * 78.233);
      if (knock < 0.26) level -= 3 + knock * 14;             // drop ~1 in 4 cells so the band breaks up
      return level;
    };
  };

  if (window.createBeamLoop) {
    // any mouse or trackpad counts, so touch-screen laptops get the hover too (touch still scrolls: see CSS)
    const finePointer = window.matchMedia('(any-pointer: fine)').matches;
    const startField = (cv) => {
      let field = null;
      try {
        // data-glyph-interactive="false" (CTA): idle motion only, no hover heat, cursor or ripples
        const interactive = finePointer && cv.dataset.glyphInteractive !== 'false';
        // data-glyph-cell (rem): on-screen cell size; the library fits more rows by raising glyphScale.
        // data-glyph-cell-tab / -phone: a different cell on tablets (601–900px wide) / phones (≤600px)
        const tab = window.matchMedia('(min-width: 601px) and (max-width: 900px)').matches;
        const phone = window.matchMedia('(max-width: 600px)').matches;
        const cellRem = parseFloat((tab && cv.dataset.glyphCellTab) || (phone && cv.dataset.glyphCellPhone) || cv.dataset.glyphCell || '0');
        const rows = cellRem ? cv.getBoundingClientRect().height / (cellRem * remPx()) : 27;
        const opts = {
          // full device resolution up to a 2400 px short side (sharp glyphs on large and high-DPI screens)
          // up to 3× density: the page is sized in vw, so zooming in raises the pixel ratio without enlarging the
          // field; following it keeps the glyphs pin-sharp instead of upscaling a 2× canvas
          pattern: 'glyph', maxPixels: 3000, maxDpr: 3, reduceMotion, interactive,
          color: cv.dataset.glyphColor || null,   // glyph colour sampled from the original artwork
          glyphScale: Math.max(1, (rows * 40) / 1080),
          glyphGlow: true,                 // bloom where the field is heated (cursor, idle sweep, scanner)
          glyphGlowRad: 14, glyphGlowAmt: 0.72,   // a tighter, softer bloom than the tool's default (26 / 1.2)
          glyphGlowNear: 0.12,             // almost none of the tight halo that blurred glyph edges; the wide glow stays
          glyphCursor: cv.dataset.glyphCursor || 'crosshair',   // hero: full-frame hairlines; GPU side: the OS arrow
          glyphTextPx: 8,                  // the cursor's coordinate tags and readout: 8px at most
          // hover heat spot size (× the tool's, at the tool's on-screen scale): compact in the hero, smaller on the GPU side
          glyphHover: parseFloat(cv.dataset.glyphHover || '0.95'),
        };
        if ('glyphOutline' in cv.dataset) opts.glyphFloor = outlineFloor(cv);
        field = createBeamLoop(cv, opts);
      } catch (err) { field = null; }
      if (!field) return;
      field.renderAt(0);
      cv.closest('[data-glyph-host]').classList.add('is-live');
      if (reduceMotion) return;                      // a still frame only
      new IntersectionObserver(([entry]) => (entry.isIntersecting ? field.start() : field.stop()), { rootMargin: '120px' }).observe(cv);
    };
    document.querySelectorAll('[data-glyph-field]').forEach((cv) => {
      if (cv.offsetWidth && cv.offsetHeight) { startField(cv); return; }
      // hidden in this layout (the GPU side below 900px): start it once it gets a size, e.g. after the
      // window is widened, instead of leaving the static art in place for the rest of the visit
      let started = false;
      const check = () => {
        if (started || !cv.offsetWidth || !cv.offsetHeight) return;
        started = true; ro.disconnect(); window.removeEventListener('resize', check);
        startField(cv);
      };
      const ro = new ResizeObserver(check);   // a layout change that reveals it…
      ro.observe(cv);
      window.addEventListener('resize', check);   // …or simply the window crossing 900px
    });
  }

  if (hasGSAP) {
    gsap.registerPlugin(ScrollTrigger);
    if (window.ScrambleTextPlugin) gsap.registerPlugin(ScrambleTextPlugin);
    if (window.SplitText) gsap.registerPlugin(SplitText);
  }
  if (!motion) root.classList.add('no-motion');

  /* =========================================================
     Scramble text — same settings as webisoft
     ========================================================= */
  const CHARS = 'ULTRASH';               // webisoft scrambles with its own brand letters ("WEBISOFT")
  const HOVER = { speed: 1.2, duration: 0.8 };
  const APPEAR = { speed: 1, duration: 1.2 };
  const original = (el) => (el.dataset.originalText ??= el.textContent);

  const scrambleIn = (el, delay = 0) => {
    if (!hasScramble || reduceMotion) { el.textContent = original(el); return; }
    gsap.to(el, {
      scrambleText: { chars: CHARS, text: original(el), speed: APPEAR.speed },
      duration: APPEAR.duration, delay, ease: 'power2.out',
    });
  };

  /* hover: buttons, nav links, footer links, partner names */
  if (hasScramble && !reduceMotion) {
    gsap.matchMedia().add('(pointer: fine) and (min-width: 700px)', () => {
      document.querySelectorAll('[data-scramble-hover]').forEach((host) => {
        const targets = [...host.querySelectorAll('[data-scramble-hover-text]')];
        if (!targets.length) return;
        targets.forEach(original);
        const run = () => targets.forEach((t, i) => {
          gsap.killTweensOf(t);
          gsap.to(t, {
            scrambleText: { chars: CHARS, text: original(t), speed: HOVER.speed },
            duration: HOVER.duration, delay: i * 0.1, ease: 'none',
          });
        });
        host.addEventListener('mouseenter', run);
        host.addEventListener('focus', run);
      });
    });
  }

  /* appear: small labels start blank and decode in when they scroll into view */
  const appearEls = [...document.querySelectorAll('[data-scramble-text]')];
  if (hasScramble && !reduceMotion) appearEls.forEach((el) => { original(el); el.textContent = ' '; });

  /* ---------- word splitting (headline reveals) ---------- */
  function splitWords(el) {
    const walk = (node) => {
      [...node.childNodes].forEach((n) => {
        if (n.nodeType === 3) {
          const frag = document.createDocumentFragment();
          n.nodeValue.split(/(\s+)/).forEach((part) => {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
            const w = document.createElement('span');
            w.className = 'w';
            const i = document.createElement('span');
            i.className = 'w__i';
            i.textContent = part;
            w.appendChild(i);
            frag.appendChild(w);
          });
          n.replaceWith(frag);
        } else if (n.nodeType === 1 && n.tagName !== 'BR' && !n.classList.contains('ind')) {
          walk(n);
        }
      });
    };
    walk(el);
    return [...el.querySelectorAll('.w__i')];
  }

  /* ---------- partner cards: liquid lime wave on hover ----------
     A small canvas under the tiles is filled pixel-by-pixel at 1/3 resolution and upscaled by the
     browser (bilinear), which keeps every edge soft. Per column the lime "surface" sits low in the card
     and swells into a crest under the cursor; layered sine ripples keep it moving like water, and soft
     vertical streaks echo the Figma glow. Cursor position and per-card intensity are eased every frame,
     so the crest glides between cards and fades in/out instead of snapping. */
  const waveRow = document.querySelector('[data-wave-row]');
  if (waveRow) {
    const cv = waveRow.querySelector('[data-wave]');
    const ctx = cv.getContext('2d');
    const tiles = [...waveRow.querySelectorAll('[data-glow-tile]')];
    const RES = 1 / 3;
    const level = tiles.map(() => 0);
    const target = tiles.map(() => 0);
    const m = { x: 0, y: 0, tx: 0, ty: 0, fresh: true };
    let W = 0, H = 0, img = null, rects = [], raf = 0, last = 0;

    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

    const size = () => {
      const cw = waveRow.clientWidth, ch = waveRow.clientHeight;
      W = Math.max(1, Math.round(cw * RES));
      H = Math.max(1, Math.round(ch * RES));
      cv.width = W; cv.height = H;
      img = ctx.createImageData(W, H);
      const sx = W / cw, sy = H / ch;
      rects = tiles.map((t) => ({
        x0: Math.ceil(t.offsetLeft * sx), x1: Math.floor((t.offsetLeft + t.offsetWidth) * sx),
        y0: Math.ceil(t.offsetTop * sy), y1: Math.floor((t.offsetTop + t.offsetHeight) * sy), sx,
      }));
      paint(last / 1000);
    };

    const paint = (time) => {
      if (!img) return;
      const data = img.data;
      data.fill(0);
      const t = reduceMotion ? 0 : time;
      rects.forEach((r, k) => {
        const I = level[k];
        if (I < 0.003) return;
        const tw = r.x1 - r.x0, th = r.y1 - r.y0;
        const mx = m.x * r.sx, my = m.y * r.sx;
        const cy = clamp((my - r.y0) / th, 0, 1);
        const crest = clamp(1.12 - cy, 0.52, 0.97);      // crest reaches up towards the cursor
        const base = 0.4, F = 0.3 * th, sig = 0.3 * tw;
        for (let x = r.x0; x < r.x1; x++) {
          const u = (x + 0.5) / r.sx;                     // css-px coordinate → stable ripple phase
          const dx = (x + 0.5 - mx) / sig;
          const g = Math.exp(-0.5 * dx * dx);
          const streak = 0.5 + 0.5 * Math.sin(u * 0.075 + 1.7 * Math.sin(u * 0.011 + t * 0.35));
          const ripple = 0.045 * Math.sin(u * 0.018 + t * 1.7)
            + 0.03 * Math.sin(u * 0.041 - t * 1.25 + 1.3)
            + 0.02 * Math.sin(u * 0.007 + t * 0.6);
          const S = (base + (crest - base) * g + ripple * (0.6 + 0.4 * g) + 0.03 * (streak - 0.5)) * th;
          const sh = 0.8 + 0.2 * streak;
          for (let y = r.y0; y < r.y1; y++) {
            const d = r.y1 - (y + 0.5);                   // height above the card bottom
            const edge = smooth(S - F, S + 0.5 * F, d);   // 0 = deep in the wave, 1 = above it
            const a = (1 - edge) * sh * I;                // runs flush to the card base, no gap
            if (a <= 0.002) continue;
            const i = (y * W + x) * 4;
            data[i] = 200 + 30 * edge;
            data[i + 1] = 244 + 4 * edge;
            data[i + 2] = 8 + 90 * edge;
            data[i + 3] = a * 242;
          }
        }
      });
      ctx.putImageData(img, 0, 0);
    };

    const tick = (now) => {
      const dt = Math.min(0.05, (now - (last || now)) / 1000);
      last = now;
      const kPos = 1 - Math.exp(-dt * 4.5), kLvl = 1 - Math.exp(-dt * 5);
      m.x += (m.tx - m.x) * kPos;
      m.y += (m.ty - m.y) * kPos;
      let busy = Math.abs(m.tx - m.x) > 0.3 || Math.abs(m.ty - m.y) > 0.3;
      level.forEach((v, k) => {
        level[k] = v + (target[k] - v) * kLvl;
        if (Math.abs(target[k] - level[k]) > 0.002 || target[k] > 0) busy = true;
      });
      paint(now / 1000);
      raf = busy ? requestAnimationFrame(tick) : 0;
    };
    const wake = () => { if (!raf) { last = 0; raf = requestAnimationFrame(tick); } };

    const local = (e) => {
      const r = waveRow.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (waveRow.clientWidth / r.width), y: (e.clientY - r.top) * (waveRow.clientHeight / r.height) };
    };
    tiles.forEach((tile, k) => {
      tile.addEventListener('pointerenter', (e) => {
        if (e.pointerType === 'touch') return;
        const p = local(e);
        m.tx = p.x; m.ty = p.y;
        if (m.fresh) { m.x = p.x; m.y = p.y; m.fresh = false; }   // first entry: start under the cursor
        target.fill(0); target[k] = 1;
        wake();
      });
    });
    waveRow.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      const p = local(e); m.tx = p.x; m.ty = p.y; wake();
    });
    waveRow.addEventListener('pointerleave', () => { target.fill(0); m.fresh = true; wake(); });

    size();
    window.addEventListener('resize', size);
    document.fonts && document.fonts.ready.then(size);
  }

  /* ---------- GPU side pattern: a soft lime glow that trails the cursor ----------
     The partner wave's recipe on a smaller scale: a canvas at 1/4 resolution, upscaled by the browser so
     every edge stays soft, holds one glow blob in the partner lime. Its rim wobbles with slow ripples so
     it moves like liquid; position and strength are eased every frame, so it glides after the cursor and
     fades in and out. Kept faint, under the pattern's top fade, so it reads as a glow, not a fill. */
  document.querySelectorAll('[data-side-glow]').forEach((host) => {
    const cv = host.querySelector('.side-glow');
    if (!cv || !cv.getContext || reduceMotion || !window.matchMedia('(any-pointer: fine)').matches) return;
    const ctx = cv.getContext('2d');
    const RES = 1 / 4, PEAK = 0.28;
    const m = { x: 0, y: 0, tx: 0, ty: 0, a: 0, ta: 0 };
    let W = 0, H = 0, img = null, raf = 0, last = 0;
    const size = () => {
      W = Math.max(1, Math.round(host.clientWidth * RES)); H = Math.max(1, Math.round(host.clientHeight * RES));
      cv.width = W; cv.height = H; img = ctx.createImageData(W, H);
    };
    const paint = (t) => {
      const data = img.data; data.fill(0);
      if (m.a > 0.003) {
        const R0 = remPx() * 6 * RES, mx = m.x * RES, my = m.y * RES;
        const y0 = Math.max(0, Math.floor(my - R0 * 2.6)), y1 = Math.min(H, Math.ceil(my + R0 * 2.6));
        for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) {
          const dx = x + 0.5 - mx, dy = y + 0.5 - my, th = Math.atan2(dy, dx);
          const R = R0 * (1 + 0.1 * Math.sin(3 * th + t * 1.3) + 0.06 * Math.sin(5 * th - t * 0.9) + 0.05 * Math.sin(t * 0.7));
          const q = Math.hypot(dx, dy) / R;
          const a = m.a * PEAK * Math.exp(-0.5 * q * q * 2.2);
          if (a <= 0.002) continue;
          const e = Math.min(1, q / 1.6), i = (y * W + x) * 4;
          data[i] = 200 + 30 * e; data[i + 1] = 244 + 4 * e; data[i + 2] = 8 + 90 * e; data[i + 3] = a * 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    };
    const tick = (now) => {
      const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
      const kPos = 1 - Math.exp(-dt * 4.5), kLvl = 1 - Math.exp(-dt * 4);
      m.x += (m.tx - m.x) * kPos; m.y += (m.ty - m.y) * kPos; m.a += (m.ta - m.a) * kLvl;
      paint(now / 1000);
      raf = m.ta > 0 || m.a > 0.003 ? requestAnimationFrame(tick) : 0;   // keeps rippling while hovered
      if (!raf) paint(0);
    };
    const wake = () => { if (!raf) { last = 0; raf = requestAnimationFrame(tick); } };
    host.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      const r = host.getBoundingClientRect();
      m.tx = (e.clientX - r.left) * (host.clientWidth / r.width); m.ty = (e.clientY - r.top) * (host.clientHeight / r.height);
      if (m.a < 0.02) { m.x = m.tx; m.y = m.ty; }   // start under the cursor
      m.ta = 1; wake();
    });
    host.addEventListener('pointerleave', () => { m.ta = 0; wake(); });
    size();
    window.addEventListener('resize', size);
  });

  /* ---------- calculator: what a month of VM time costs on Ultra vs other providers ----------
     Follows boat.dev's pricing calculator (its prices and multiples stand in until Ultra's own):
     VM hours = sessions × session length, capped at peak VMs running all month (730 h); Ultra's month
     = those hours × the size's hourly rate, with a $20 plan minimum. Every other provider costs its
     multiple of Ultra's month; the annual saving is against Cloudflare. */
  const calc = document.querySelector('[data-calc]');
  if (calc) {
    const SIZES = [
      { name: 'Small', vcpu: 2, ram: 4, rate: 0.018 },
      { name: 'Default', vcpu: 4, ram: 8, rate: 0.036 },
      { name: 'Large', vcpu: 8, ram: 16, rate: 0.072 },
      { name: 'XLarge', vcpu: 16, ram: 32, rate: 0.2 },
    ];
    const SESSIONS = [1, 10, 100, 1000, 10000, 100000, 1000000];
    const LENGTHS = [[0.5, '30 min'], [1, '1 h'], [4, '4 h'], [8, '8 h'], [24, '24 h'], [240, '10 d'], [720, '30 d']];
    const PEAKS = [10, 50, 100, 250, 500, 1000, 2000];
    const PLAN_MIN = 20, MONTH_H = 730, SAVING_VS = 3.35;   // Cloudflare's multiple
    const short = (n) => (n >= 1e6 ? n / 1e6 + 'M' : n >= 1000 ? n / 1000 + 'k' : String(n));
    const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
    const cents = (n) => '$' + (n < 10 ? n.toFixed(2) : Math.round(n).toLocaleString('en-US'));
    const state = { sessions: 3, length: 0, peak: 1, size: 0 };
    const outs = {
      sessions: (v) => `${short(SESSIONS[v])} session${SESSIONS[v] === 1 ? '' : 's'}`,
      length: (v) => LENGTHS[v][1],
      peak: (v) => `${short(PEAKS[v])} VMs`,
      size: (v) => `${SIZES[v].vcpu} vCPU · ${SIZES[v].ram} GB`,
    };
    const costs = [...calc.querySelectorAll('[data-cost]')].map((el) => ({ el, k: parseFloat(el.dataset.cost) }));
    const maxK = Math.max(...costs.map((c) => c.k));
    const ultraBar = calc.querySelector('[data-ultra-bar]');
    const out = {};
    calc.querySelectorAll('[data-out]').forEach((el) => (out[el.dataset.out] = el));
    const rows = [...calc.querySelectorAll('[data-plan]')];

    const shown = { ultra: 0, saving: 0 };
    const paint = () => {
      costs.forEach(({ el, k }) => { el.textContent = `${money(shown.ultra * k)}/mo`; });
      out.saving.textContent = money(shown.saving);
      out.ultraMo.textContent = `${money(shown.ultra)}/mo`;
    };
    const update = (instant) => {
      const size = SIZES[state.size], n = SESSIONS[state.sessions], [len, lenLabel] = LENGTHS[state.length], peak = PEAKS[state.peak];
      const capped = n * len > peak * MONTH_H;
      const cost = (capped ? peak * MONTH_H : n * len) * size.rate;
      const ultra = Math.max(PLAN_MIN, cost);
      const rate = `$${size.rate.toFixed(3)}/h`;
      out.formula.textContent = (capped
        ? `${peak.toLocaleString('en-US')} VMs × ${MONTH_H} h × ${rate} = ${cents(cost)}`
        : `${n.toLocaleString('en-US')} × ${lenLabel} × ${rate} = ${cents(cost)}`) + (cost < PLAN_MIN ? ` · $${PLAN_MIN} plan minimum` : '');
      out.fleet.textContent = capped ? `${short(peak)} VMs all month on ${size.name}` : `${short(n)} × ${lenLabel} on ${size.name}`;
      rows.forEach((r) => r.classList.toggle('is-on', +r.dataset.plan === state.size));
      if (ultraBar) ultraBar.style.setProperty('--b', (1 / maxK).toFixed(4));
      const next = { ultra, saving: ultra * (SAVING_VS - 1) * 12 };
      if (motion && !instant) gsap.to(shown, { ...next, duration: 0.6, ease: 'power3.out', overwrite: true, onUpdate: paint });
      else { Object.assign(shown, next); paint(); }
    };
    /* sliders: the drawn playhead (--p) is kept apart from the value. While dragging it follows the
       pointer 1:1 and the value snaps to the nearest stop underneath; on release, a click or a key it
       eases onto the stop. The native range input stays for keyboard and screen readers. */
    const sliders = {};
    calc.querySelectorAll('[data-slider]').forEach((wrap) => {
      const key = wrap.dataset.slider;
      const input = wrap.querySelector('input');
      const ctl = wrap.querySelector('.slider__ctl');
      const track = wrap.querySelector('.slider__track');
      const outEl = wrap.querySelector('.slider__out');
      const lbls = [...wrap.querySelectorAll('.slider__lbls i')];
      const min = +input.min, max = +input.max;
      const pOf = (v) => (v - min) / (max - min);
      const setW = () => ctl.style.setProperty('--wh', `${track.getBoundingClientRect().width.toFixed(2)}px`);
      setW();
      window.addEventListener('resize', setW);
      const view = { p: pOf(+input.value) };
      const draw = () => ctl.style.setProperty('--p', view.p.toFixed(4));
      const settle = (p, dur = 0.45) => {
        if (motion) gsap.to(view, { p, duration: dur, ease: 'power3.out', overwrite: true, onUpdate: draw });
        else { view.p = p; draw(); }
      };
      const commit = (v) => {
        input.value = v; state[key] = v;
        const text = outs[key](v);
        outEl.textContent = text;
        input.setAttribute('aria-valuetext', text);
        // the scale label nearest the value reads in full black
        const p = pOf(v);
        let best = null, bd = Infinity;
        lbls.forEach((l) => { const d = Math.abs(parseFloat(l.style.getPropertyValue('--x')) - p); if (d < bd) { bd = d; best = l; } });
        lbls.forEach((l) => l.classList.toggle('is-on', l === best));
      };
      const sync = (instant) => {
        commit(+input.value);
        if (instant === true) { if (motion) gsap.killTweensOf(view); view.p = pOf(+input.value); draw(); }
        else settle(pOf(+input.value));
      };
      sliders[key] = { input, sync };
      sync(true);
      input.addEventListener('input', () => { sync(); update(); });   // keyboard

      const pAt = (e) => { const r = track.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
      const snapTo = (p) => {
        const v = Math.round(min + p * (max - min));
        if (v !== +input.value) { commit(v); update(); }
      };
      let drag = null;
      ctl.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        drag = { id: e.pointerId, moved: false };
        try { ctl.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
        input.focus({ preventScroll: true });
        wrap.classList.add('is-active');
        const p = pAt(e);
        snapTo(p);
        settle(p, 0.25);                        // the head slides to where you pressed
      });
      ctl.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        drag.moved = true;
        if (motion) gsap.killTweensOf(view);
        view.p = pAt(e); draw();                // follows the pointer exactly
        snapTo(view.p);
      });
      const end = (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        drag = null;
        wrap.classList.remove('is-active');
        settle(pOf(+input.value));              // eases onto the stop the value landed on
      };
      ctl.addEventListener('pointerup', end);
      ctl.addEventListener('pointercancel', end);
    });
    // a plan row picks that size
    rows.forEach((r) => r.addEventListener('click', () => {
      const s = sliders.size; if (!s) return;
      s.input.value = r.dataset.plan; s.sync(); update();
    }));
    update(true);
  }

  /* ---------- cpu performance: fans roll out to each provider's score ----------
     Each bar's fill grows to its share (--to) with the fan handle riding its end, and the score counts up.
     The fan moves on a transform (sub-pixel, no layout) and turns as if rolling on a 7rem wheel: slow
     enough that its 11 blades never strobe (a 2.5rem wheel spun ~5 turns a second at the start and
     flickered). Plays when the chart comes into view; Replay winds every bar back, then runs again. */
  const perf = document.querySelector('[data-perf]');
  if (perf) {
    const rowsP = [...perf.querySelectorAll('.prow')].map((row) => {
      const val = row.querySelector('.prow__val'), fan = row.querySelector('.prow__fan');
      fan.style.left = '0px';
      return {
        row, val, fan, fill: row.querySelector('.prow__fill'),
        // fan's left edge from the fill end, as a share of the fan's width (desktop: -1.5rem / -2.43rem of 5rem;
        // the fan is smaller on tablets and phones, so the offset follows its size)
        offK: row.classList.contains('prow--ultra') ? -0.486 : -0.3, offPx: 0,
        to: parseFloat(row.style.getPropertyValue('--to')) || 0, end: parseFloat(val.dataset.val) || 0, k: 1,
      };
    });
    const bar = perf.querySelector('.prow__bar');
    let bw = 0, roll = 1;
    const measure = () => {
      bw = bar ? bar.getBoundingClientRect().width : 0;
      const fw = rowsP.length ? rowsP[0].fan.offsetWidth : 0;
      rowsP.forEach((r) => { r.offPx = r.offK * fw; });
      roll = Math.max(1, fw * 1.4);   // the wheel it rolls on: 7rem for the 5rem desktop fan
    };
    const setRow = (r, k) => {                     // k: 0 → 1 of the way to the final score
      r.k = k;
      const x = r.to * k * bw;
      r.fill.style.width = `${x.toFixed(2)}px`;
      r.fan.style.transform = `translate3d(${(x + r.offPx).toFixed(2)}px,0,0) rotate(${((x / roll) * 57.2958).toFixed(2)}deg)`;
      r.val.textContent = `${(r.end * k).toFixed(2)}/s`;
    };
    measure();
    rowsP.forEach((r) => setRow(r, motion ? 0 : 1));
    window.addEventListener('resize', () => { measure(); rowsP.forEach((r) => setRow(r, r.k)); });

    let tl = null;
    const play = () => {
      measure();
      if (!motion) { rowsP.forEach((r) => setRow(r, 1)); return; }
      if (tl) tl.kill();
      tl = gsap.timeline();
      const from = rowsP.map((r) => r.k);
      const rewind = from.some((k) => k > 0.002);
      if (rewind) {
        // replay: every bar eases back to zero together first. 0.9s keeps the fans under ~14° a frame
        // (their blades sit 33° apart), so they visibly roll back instead of flickering
        const o = { t: 1 };
        tl.to(o, { t: 0, duration: 0.9, ease: 'power1.inOut', onUpdate: () => rowsP.forEach((r, i) => setRow(r, from[i] * o.t)) });
      }
      const at = rewind ? 1 : 0;
      rowsP.forEach((r, i) => {
        const o = { k: 0 };
        tl.to(o, { k: 1, duration: 1.9, ease: 'power2.out', onUpdate: () => setRow(r, o.k) }, at + i * 0.06);
      });
    };
    if (motion) ScrollTrigger.create({ trigger: perf.querySelector('.perf__chart'), start: 'top 75%', once: true, onEnter: play });
    const replay = perf.querySelector('[data-perf-replay]');
    if (replay) replay.addEventListener('click', play);
  }
  /* ---------- stats: hover glow (Figma 2112:3178) ----------
     A faint grey glyph field shows through a soft spot that eases after the cursor: heavy glyphs (×, ▢,
     ◎, ⌘…) near its centre, light ones (dots, slashes) further out, like the live fields elsewhere on the
     page. The two glyph tiles are drawn once here as SVG (seeded, so they never change); mouse/pen only. */
  const statGrid = document.querySelector('.stats__grid');
  if (statGrid && window.matchMedia('(hover: hover)').matches) {
    let seed = 7;
    const rnd = () => {   // mulberry32
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const G = {   // one glyph in a 20×20 cell at (x, y)
      dot: (x, y) => `<rect x="${x + 9}" y="${y + 9}" width="2" height="2" fill="#fff" stroke="none"/>`,
      slash: (x, y) => `<path d="M${x + 6} ${y + 14}L${x + 14} ${y + 6}"/>`,
      plus: (x, y) => `<path d="M${x + 10} ${y + 5}V${y + 15}M${x + 5} ${y + 10}H${x + 15}"/>`,
      cross: (x, y) => `<path d="M${x + 5.5} ${y + 5.5}L${x + 14.5} ${y + 14.5}M${x + 14.5} ${y + 5.5}L${x + 5.5} ${y + 14.5}"/>`,
      square: (x, y) => `<rect x="${x + 5}" y="${y + 5}" width="10" height="10" rx="2"/>`,
      ring: (x, y) => `<circle cx="${x + 10}" cy="${y + 10}" r="5"/>`,
      target: (x, y) => `<circle cx="${x + 10}" cy="${y + 10}" r="5"/><circle cx="${x + 10}" cy="${y + 10}" r="1.6" fill="#fff" stroke="none"/>`,
      quad: (x, y) => [[7, 7], [13, 7], [7, 13], [13, 13]].map(([a, b]) => `<circle cx="${x + a}" cy="${y + b}" r="2.2"/>`).join(''),
    };
    const tile = (kinds, empty) => {
      let s = '';
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          if (rnd() < empty) continue;
          s += G[kinds[Math.floor(rnd() * kinds.length)]](c * 20, r * 20);
        }
      }
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round">${s}</svg>`;
      return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    };
    statGrid.style.setProperty('--glyph-heavy', tile(['cross', 'square', 'ring', 'target', 'quad', 'plus'], 0.12));
    statGrid.style.setProperty('--glyph-light', tile(['dot', 'dot', 'slash', 'slash', 'plus'], 0.25));

    statGrid.querySelectorAll('.stat').forEach((cell) => {
      const glow = document.createElement('span');
      glow.className = 'stat__glow';
      glow.setAttribute('aria-hidden', 'true');
      glow.innerHTML = '<i class="stat__glow-tint"></i><i class="stat__glow-light"></i><i class="stat__glow-heavy"></i>';
      cell.prepend(glow);
      let tx = 0, ty = 0, x = 0, y = 0, raf = 0;
      const step = () => {
        x += (tx - x) * 0.16; y += (ty - y) * 0.16;
        glow.style.setProperty('--mx', `${x.toFixed(1)}px`);
        glow.style.setProperty('--my', `${y.toFixed(1)}px`);
        raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.3 ? requestAnimationFrame(step) : 0;
      };
      const aim = (e, snap) => {
        if (e.pointerType === 'touch') return;
        const r = cell.getBoundingClientRect();
        tx = e.clientX - r.left; ty = e.clientY - r.top;
        if (snap) { x = tx; y = ty; }
        if (!raf) raf = requestAnimationFrame(step);
      };
      cell.addEventListener('pointerenter', (e) => aim(e, true));
      cell.addEventListener('pointermove', (e) => aim(e, false));
    });
  }

  /* ---------- sticky stacking cards: only when the viewport fits a card ---------- */
  const pcards = document.querySelector('.pcards');
  const setStacking = () => {
    if (!pcards) return;
    const fits = mqDesktop.matches && window.innerHeight >= remPx() * (54 + 8.8 * 2);
    pcards.classList.toggle('is-stacking', fits);
  };
  setStacking();

  /* ---------- smooth scroll + nav ---------- */
  const nav = document.querySelector('[data-nav]');
  let lenis = null;
  let lastY = 0;
  const onScrollNav = (y) => {
    nav.classList.toggle('is-hidden', y > lastY && y > 240);
    lastY = y;
  };

  if (motion && window.Lenis) {
    lenis = new Lenis({ duration: 1.15, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), smoothWheel: true });
    lenis.on('scroll', (e) => { ScrollTrigger.update(); onScrollNav(e.scroll); });
    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
  } else {
    window.addEventListener('scroll', () => onScrollNav(window.scrollY), { passive: true });
  }

  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      const target = id === '#top' ? 0 : document.querySelector(id);
      if (target === null) return;
      e.preventDefault();
      if (lenis) lenis.scrollTo(target, { offset: 0, duration: 1.4 });
      else if (target === 0) window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
      else target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
    });
  });

  window.addEventListener('resize', () => { setScale(); setStacking(); });

  const reveal = () => root.classList.remove('is-loading');

  if (!motion) {
    appearEls.forEach((el) => { if (el.dataset.originalText) el.textContent = el.dataset.originalText; });
    reveal();
    return;
  }

  /* =========================================================
     GSAP motion
     ========================================================= */
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const EXPO = 'expo.out';
  const hero = $('[data-hero]');
  const ctaSection = $('.cta');

  /* --- appear scramble for every small label (hero + GPU callouts are sequenced separately) ---
     siblings inside one parent decode 0.2s apart, like webisoft's grid labels */
  const delayFor = (el) => {
    const sibs = [...el.parentElement.children].filter((n) => n.hasAttribute('data-scramble-text'));
    return Math.max(0, sibs.indexOf(el)) * 0.2;
  };
  appearEls
    .filter((el) => !hero.contains(el) && !el.classList.contains('gpu__lbl'))
    .forEach((el) => {
      const inFooter = !!el.closest('.footer');
      ScrollTrigger.create({
        // the footer is sticky, so time its labels off the CTA sheet sliding away
        trigger: inFooter ? ctaSection : el,
        start: inFooter ? 'bottom 35%' : 'top 80%',
        once: true,
        onEnter: () => scrambleIn(el, delayFor(el)),
      });
    });

  /* --- hero intro (on load). Lines, pattern, coords and CTA stay put; no scroll parallax --- */
  const intro = gsap.timeline({ paused: true, defaults: { ease: EXPO } });
  intro
    .from('[data-hero-mark]', { yPercent: 105, duration: 1.4 }, 0.1)   // ULTRA.SH rises out of its mask
    .from('[data-hero-bar]', { scaleY: 0, duration: 1.2, ease: 'expo.inOut' }, 0.15)
    .add(() => $$('[data-scramble-text]', hero).forEach((el) => scrambleIn(el, delayFor(el))), 0.5);

  /* --- hero coordinates: a tour of the regions. Every 3.2s they decode to the next one, latitude
         first, longitude a beat after it. Only while the hero is on screen. --- */
  const coordEls = $$('.hero__coords p', hero);
  if (coordEls.length === 2) {
    const REGIONS = [
      ['1°17′N', '103°50′E'],    // Singapore
      ['52°22′N', '4°54′E'],     // Amsterdam
      ['51°30′N', '0°07′W'],     // London
      ['40°42′N', '74°00′W'],    // New York
      ['34°03′N', '118°14′W'],   // Los Angeles
    ];
    let region = 0, call = null, heroOn = true;
    const nextRegion = () => {
      region = (region + 1) % REGIONS.length;
      coordEls.forEach((p, j) => {
        const text = REGIONS[region][j];
        if (!hasScramble) { p.textContent = text; return; }
        gsap.to(p, { scrambleText: { chars: '0123456789', text, speed: 1 }, duration: 0.9, delay: j * 0.18, ease: 'power2.out' });
      });
      call = heroOn ? gsap.delayedCall(3.2, nextRegion) : null;
    };
    new IntersectionObserver(([en]) => {
      heroOn = en.isIntersecting;
      if (heroOn && !call) call = gsap.delayedCall(3.2, nextRegion);
      else if (!heroOn && call) { call.kill(); call = null; }
    }).observe(hero);
  }

  /* --- split-word headline reveals --- */
  $$('[data-split]').filter((el) => !el.classList.contains('gpu__title')).forEach((el) => {   // section 2's title runs with its pin
    const words = splitWords(el);
    const inFooter = !!el.closest('.footer');
    gsap.from(words, {
      yPercent: 115, duration: 1.2, ease: EXPO, stagger: 0.035,
      scrollTrigger: inFooter
        ? { trigger: ctaSection, start: 'bottom 75%', toggleActions: 'play none none reverse' }
        : { trigger: el, start: 'top 88%', toggleActions: 'play none none reverse' },
    });
  });

  /* --- generic fade-up --- */
  $$('[data-reveal]').filter((el) => !hero.contains(el)).forEach((el) => {
    gsap.from(el, {
      y: 30, opacity: 0, duration: 1.1, ease: EXPO,
      scrollTrigger: { trigger: el, start: 'top 92%', toggleActions: 'play none none reverse' },
    });
  });

  /* --- stats cells stagger --- */
  gsap.from('.stat', {
    opacity: 0, y: 40, duration: 1.1, ease: EXPO, stagger: { each: 0.08, grid: [2, 3], from: 'start' },
    scrollTrigger: { trigger: '.stats__grid', start: 'top 80%', toggleActions: 'play none none reverse' },
  });

  /* --- section 2: the statement, then the GPU ---
     Desktop: the section holds while you scroll. First the title rises in word by word; on the next
     scroll the GPU assembles (its layers fly together, scrubbed with the scroll) and its callouts draw;
     then it tilts a little as you keep scrolling, and the page moves on. Phones: no hold; the title
     rises in and the callouts draw as the drawing comes into view. */
  const gpuSection = $('[data-gpu-section]');
  const gpuFig = $('[data-gpu]');
  if (gpuSection && gpuFig) {
    const gpuTitle = $('.gpu__title');
    const titleWords = gpuTitle ? splitWords(gpuTitle) : [];
    const spread = { base: -3, plate: 1.5, fins: 3, pipes: 5, shroud: 9 };

    let calls = false;
    const callouts = (on, delay = 0) => {
      if (on === calls) return;
      calls = on;
      const co = $$('.callout', gpuFig), lb = $$('.gpu__lbl', gpuFig);
      gsap.killTweensOf(co);
      if (!on) { gsap.set(co, { scaleY: 0 }); lb.forEach((l) => { gsap.killTweensOf(l); if (hasScramble) l.textContent = ' '; }); return; }
      gsap.fromTo(co, { scaleY: 0 }, { scaleY: 1, duration: 0.7, ease: 'expo.inOut', stagger: 0.08, delay });
      lb.forEach((l, i) => { gsap.killTweensOf(l); scrambleIn(l, delay + 0.35 + i * 0.15); });
    };
    gsap.set($$('.callout', gpuFig), { scaleY: 0 });

    const mmGpu = gsap.matchMedia();
    mmGpu.add('(min-width: 901px)', () => {
      // timeline units: 0–1 title, 1–2 the GPU assembles, 2–2.9 the slow tilt, 2.9–3.8 it rests, finished,
      // for a beat (about a second of scrolling) before the page moves on
      const tl = gsap.timeline({ defaults: { ease: 'none' } });
      tl.from(titleWords, { yPercent: 115, duration: 0.5, stagger: 0.5 / Math.max(1, titleWords.length), ease: 'power2.out' }, 0);
      tl.fromTo(gpuFig, { scale: 0.86, rotate: -4, autoAlpha: 0 }, { scale: 1, rotate: 0, autoAlpha: 1, duration: 1, ease: 'power2.out' }, 1);
      Object.entries(spread).forEach(([layer, v]) => {
        tl.fromTo(`[data-layer="${layer}"]`, { y: () => remPx() * v * 2.2 }, { y: 0, duration: 1, ease: 'power2.out' }, 1);
      });
      tl.fromTo(gpuFig, { rotate: 0, y: 0 }, { rotate: 1.8, y: () => -remPx() * 1.2, duration: 0.9, immediateRender: false }, 2);
      tl.to({}, { duration: 0.9 }, 2.9);   // the hold
      tl.eventCallback('onUpdate', () => callouts(tl.time() >= 1.85, 0.05));
      ScrollTrigger.create({
        trigger: gpuSection,
        // a section taller than the window holds with its bottom (the figure's labels) in view
        start: () => (gpuSection.offsetHeight > window.innerHeight ? 'bottom bottom' : 'top top'),
        end: () => `+=${Math.round(window.innerHeight * 2.5)}`,   // 1.9 windows for 0–2.9, +0.6 for the hold
        // scrub 1: the timeline eases after the scroll for about a second instead of tracking each pixel
        pin: true, scrub: 1, animation: tl, invalidateOnRefresh: true,
        refreshPriority: 2,   // highest on the page: its added height is measured before everything below
      });
      return () => { callouts(false); gsap.set([gpuFig, ...titleWords], { clearProps: 'all' }); };
    });
    mmGpu.add('(max-width: 900px)', () => {
      gsap.from(titleWords, { yPercent: 115, duration: 1.2, ease: EXPO, stagger: 0.035, scrollTrigger: { trigger: gpuTitle, start: 'top 88%', toggleActions: 'play none none reverse' } });
      ScrollTrigger.create({ trigger: gpuFig, start: 'top 75%', onEnter: () => callouts(true), onLeaveBack: () => callouts(false) });
      // a short hold once the whole drawing is in view (its callouts drawn), before the page moves on
      ScrollTrigger.create({
        trigger: gpuSection, start: 'bottom bottom', end: () => `+=${Math.round(window.innerHeight * 0.6)}`,
        pin: true, anticipatePin: 1, invalidateOnRefresh: true, refreshPriority: 2,
      });
      return () => callouts(false);
    });
  }
  /* --- problem: as the next card slides over, the covered card closes down to its header row
         (label + title stay crisp; illustration and body copy fade away), art floats --- */
  const cards = $$('.pcard');
  cards.forEach((card, i) => {
    const next = cards[i + 1];
    if (next) {
      const body = [$('.pcard__art', card), $('.pcard__foot', card)];
      const paint = (self) => {
        const p = pcards.classList.contains('is-stacking') ? self.progress : 0;
        const o = Math.min(1, Math.max(0, (1 - p) / 0.35)).toFixed(3);   // fades over the last third of the cover
        body.forEach((el) => { el.style.opacity = o; });
      };
      ScrollTrigger.create({
        trigger: next, start: 'top bottom', end: () => `top ${remPx() * 8.8 * (i + 1)}px`,
        invalidateOnRefresh: true, onUpdate: paint, onRefresh: paint,
      });
    }
    gsap.fromTo($('[data-float]', card), { y: () => remPx() * 4 }, {
      y: () => -remPx() * 4, ease: 'none',
      scrollTrigger: { trigger: card, start: 'top bottom', end: 'bottom top', scrub: 1 },
    });
  });

  /* --- why ultra: three points. On desktop the section pins while you scroll through them (on tablets
         and phones its content stays on screen, sticky): each paragraph lights up char by char (webisoft
         "fadein"), the lime light in the bars below moves to the point being read, the point's part of the
         server lifts out, and once the third is lit the page scrolls on. --- */
  const whyBox = $('[data-why]');
  if (whyBox) {
    const whyTexts = $$('[data-why-text]', whyBox);
    const whyBars = $$('.why__bars i', whyBox);
    const charsOf = whyTexts.map((t) => {
      if (!window.SplitText) return [t];
      const s = new SplitText(t, { type: 'words, chars', wordsClass: 'wd', charsClass: 'ch', tag: 'span' });
      gsap.set([s.words, s.chars], { display: 'inline' });
      return s.chars;
    });
    // the drawing's part for each point (coolers, RAM, fans), 0 → 1 as it lifts out and lights up;
    // js/why-art.js draws it
    const ram = { 0: 0, 1: 0, 2: 0 };
    const sendRam = () => {
      const d = [ram[0], ram[1], ram[2]];
      window.__whyParts = d;
      document.dispatchEvent(new CustomEvent('why:parts', { detail: d }));
    };
    // the three points over one another, switching as the timeline runs (desktop: in the pinned section;
    // tablets and phones: in the sticky stage). Returns the timeline and an undo for the layout
    const stack = $('.why__texts', whyBox);
    const pointsTimeline = () => {
      stack.classList.add('is-stacked');
      gsap.set(whyTexts.slice(1), { autoAlpha: 0, y: 8 });
      gsap.set(whyBars, { scaleX: 0, transformOrigin: 'left center' });
      Object.assign(ram, { 0: 0, 1: 0, 2: 0 });
      // every step has explicit start and end values (fromTo): a tween that took its start from the
      // element's current state re-read it on each layout refresh, and a refresh mid-section recorded lit
      // letters as the starting colour, so a point began white (or dimmed as you scrolled)
      const tl = gsap.timeline({ defaults: { ease: 'none' }, onUpdate: sendRam });
      const later = { immediateRender: false };
      whyTexts.forEach((t, i) => {
        if (i > 0) {
          // switch points as one soft crossfade: the read one drifts up and fades as the next drifts in
          // under it, the light leaves its bar to the right, its part settles back into the server, all on
          // gentle sine curves that overlap, so nothing starts or stops abruptly
          tl.fromTo(whyTexts[i - 1], { autoAlpha: 1, y: 0 }, { autoAlpha: 0, y: -8, duration: 0.5, ease: 'sine.inOut', ...later })
            .fromTo(whyBars[i - 1], { scaleX: 1, transformOrigin: 'right center' }, { scaleX: 0, duration: 0.5, ease: 'sine.inOut', ...later }, '<')
            .fromTo(ram, { [i - 1]: 1 }, { [i - 1]: 0, duration: 0.6, ease: 'sine.inOut', ...later }, '<')
            .fromTo(t, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: 'sine.inOut', ...later }, '<0.15');
        }
        tl.fromTo(whyBars[i], { scaleX: 0, transformOrigin: 'left center' }, { scaleX: 1, duration: 1, ease: 'sine.inOut' })
          .fromTo(charsOf[i], { color: '#4a4a4a' }, { color: '#ffffff', duration: 0.25, stagger: { amount: 0.75 } }, '<')
          .fromTo(ram, { [i]: 0 }, { [i]: 1, duration: 0.75, ease: 'sine.inOut', ...later }, '<');   // this point's part lifts out and lights up
        tl.to({}, { duration: 0.35 });   // rest on the fully lit point for a moment
      });
      sendRam();
      return { tl, undo: () => { stack.classList.remove('is-stacked'); gsap.set([...whyTexts, ...whyBars], { clearProps: 'all' }); } };
    };
    const mmWhy = gsap.matchMedia();
    mmWhy.add('(min-width: 901px)', () => {
      const { tl, undo } = pointsTimeline();
      ScrollTrigger.create({
        // held with the window centred on the section, which CSS makes at least a window plus both
        // cream notches tall: so while it holds, only black shows, no cut at the top or bottom
        trigger: '.why',
        start: () => `top+=${Math.max(0, Math.round(($('.why').offsetHeight - window.innerHeight) / 2))} top`,
        end: () => `+=${Math.round(window.innerHeight * 2.4)}`,
        // (no invalidateOnRefresh: the timeline's values are all fixed; only start / end are re-measured)
        pin: true, scrub: 1, animation: tl,
        refreshPriority: 1,   // the pin adds page height: measure it before the triggers further down
      });
      return undo;
    });
    // tablets / phones: the heading, points and drawing stay on screen (sticky, css .why--switch) for 2.2
    // screens of scrolling while the same timeline runs: the points switch in place, their parts lift in turn
    mmWhy.add('(max-width: 900px) and (min-height: 560px)', () => {
      const why = $('.why'), stage = $('.why__stage');
      why.classList.add('why--switch');
      const { tl, undo } = pointsTimeline();
      // the stage sticks with its top on the screen's top edge. On a screen shorter than it, the drawing
      // shrinks just enough for the whole block to fit (its width is --aw × the column; CSS keeps its
      // margins in proportion: the drawing's laid-out height is 0.4537 × its width); a last resort, if
      // even a much smaller drawing won't do, sticks the stage a little higher
      const fit = () => {
        why.style.removeProperty('--aw');
        const over = stage.offsetHeight - window.innerHeight;
        if (over > 0) {
          const art = $('.why__art', why), col = stage.clientWidth;
          const aw0 = art.offsetWidth / col, aw = Math.max(1.3, aw0 - over / 0.4537 / col);
          why.style.setProperty('--aw', aw.toFixed(3));
        }
        stage.style.top = `${-Math.max(0, Math.round(stage.offsetHeight - window.innerHeight))}px`;
      };
      const over = () => Math.max(0, Math.round(stage.offsetHeight - window.innerHeight));
      // runs exactly while the stage is stuck: from it reaching its sticky place until it meets the end of
      // the section's content box
      const held = () => Math.max(1, why.clientHeight - parseFloat(getComputedStyle(why).paddingBottom) - stage.offsetHeight);
      ScrollTrigger.create({
        trigger: why,
        start: () => { fit(); return `top+=${over()} top`; },
        end: () => `+=${Math.round(held())}`,
        scrub: 1, animation: tl,
      });
      return () => { why.classList.remove('why--switch'); why.style.removeProperty('--aw'); stage.style.top = ''; undo(); };
    });
    // a short landscape phone can't hold the block on screen: the points stay stacked, each lighting up
    // as it scrolls through, and the drawing's parts lift in turn as it passes
    mmWhy.add('(max-width: 900px) and (max-height: 559px)', () => {
      whyTexts.forEach((t, i) => {
        const tl = gsap.timeline({ paused: true })
          .fromTo(charsOf[i], { color: '#4a4a4a' }, { color: '#ffffff', stagger: 0.02, ease: 'none' })
          .fromTo(whyBars[i], { scaleX: 0 }, { scaleX: 1, ease: 'none', duration: charsOf[i].length * 0.02 }, 0);
        ScrollTrigger.create({ trigger: t, start: 'top bottom', end: 'bottom 85%', scrub: 0.8, animation: tl });
      });
      // the drawing sits below the points here: as it scrolls through, its three parts lift out in turn
      // (each settles as the next one rises; the last stays up)
      const c01 = (v) => Math.max(0, Math.min(1, v));
      ScrollTrigger.create({
        trigger: '.why__art', start: 'top 85%', end: 'bottom 40%', scrub: 0.8,
        onUpdate: (self) => {
          const s = self.progress * 3;
          [0, 1, 2].forEach((i) => { ram[i] = Math.min(c01((s - i) / 0.4), i < 2 ? 1 - c01((s - i - 1) / 0.4) : 1); });
          sendRam();
        },
      });
      Object.assign(ram, { 0: 0, 1: 0, 2: 0 }); sendRam();
      return () => gsap.set(whyBars, { clearProps: 'all' });
    });
  }
  /* --- start --- */
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    reveal();
    ScrollTrigger.refresh();
    intro.play(0);
  };
  (document.fonts ? Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]) : Promise.resolve()).then(start);
  window.addEventListener('load', () => ScrollTrigger.refresh());
})();
