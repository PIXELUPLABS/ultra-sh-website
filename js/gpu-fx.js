/* Section 2 GPU: spinning fans and a glow, in the manner of the problem-card illustrations.
   - Fans: each fan's nine blades (pieces 26–34 and 36–44) are re-drawn as live paths in one overlay
     under its hub, and turn in the plane of the shroud: the fan face is a circle seen in isometric
     (an ellipse, height/width ≈ 0.584), so a turn by θ is scale(1,k)·rotate(θ)·scale(1,1/k) about the
     hub. The map is applied to the blade outlines' points every frame (not as an SVG/CSS transform),
     so the strokes keep their weight.
   - Glow (CSS, while the figure is on screen): the heatsink fins light up one after another and the
     lime heat pipes breathe, like the fin chase and chip pulse on the problem cards. */
(() => {
  const fig = document.querySelector('[data-gpu]');
  if (!fig) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const NS = 'http://www.w3.org/2000/svg';
  const OX = 320, OY = 98, K = 0.584, TAU = Math.PI * 2;

  // the figure "plays" (glow on, fans turning) while it is on screen
  let onScreen = false;
  new IntersectionObserver(([en]) => {
    onScreen = en.isIntersecting;
    fig.classList.toggle('is-playing', onScreen && !reduce);
    if (onScreen) kick();
  }, { threshold: 0.15 }).observe(fig);

  /* Hover tilt (mouse / pen only): near the drawing it turns a few degrees toward the cursor, as a 3D
     object would, and its layers part in depth (shroud nearest, base furthest), so they slide past one
     another as it turns. It eases in, follows the cursor with a little lag, and settles flat when the
     cursor moves away. Hit-testing uses the figure's own box (not the tilted parts), so it never jitters. */
  const tiltEl = fig.querySelector('.gpu__tilt');
  const section = fig.closest('[data-gpu-section]') || fig.parentElement;
  if (tiltEl && !reduce) {
    const Z = { base: -3, plate: -1.2, fins: 0.6, pipes: 2.2, shroud: 4.6, callouts: 1.6 };   // rem toward the viewer
    const MAX_Y = 11, MAX_X = 8;                                                                 // deg
    const depths = [...fig.querySelectorAll('[data-depth]')];
    const cur = { x: 0, y: 0, s: 0 }, tgt = { x: 0, y: 0, s: 0 };
    const clamp = (v) => Math.max(-1, Math.min(1, v));
    let traf = 0, tlast = 0, px = null, py = null;
    const apply = () => {
      if (cur.s < 0.001 && Math.abs(cur.x) < 0.001 && Math.abs(cur.y) < 0.001) {
        tiltEl.style.transform = '';                    // at rest: no 3D layers, the art renders as drawn
        depths.forEach((d) => { d.style.transform = ''; });
        return;
      }
      tiltEl.style.transform = `rotateX(${(-cur.y * MAX_X).toFixed(3)}deg) rotateY(${(cur.x * MAX_Y).toFixed(3)}deg)`;
      depths.forEach((d) => { d.style.transform = `translateZ(${((Z[d.dataset.depth] || 0) * cur.s).toFixed(3)}rem)`; });
    };
    const step = (now) => {
      const dt = Math.min(0.05, (now - tlast) / 1000); tlast = now;
      const k = 1 - Math.exp(-dt * 7);                  // ~0.11 a frame at 60 Hz
      let moving = false;
      ['x', 'y', 's'].forEach((p) => {
        cur[p] += (tgt[p] - cur[p]) * k;
        if (Math.abs(tgt[p] - cur[p]) > 0.0005) moving = true; else cur[p] = tgt[p];
      });
      apply();
      traf = moving ? requestAnimationFrame(step) : 0;
    };
    const run = () => { if (!traf) { tlast = performance.now(); traf = requestAnimationFrame(step); } };
    const aim = () => {
      if (px === null) return;
      const r = fig.getBoundingClientRect();
      const padX = r.width * 0.35, padY = r.height * 0.15;
      const near = px > r.left - padX && px < r.right + padX && py > r.top - padY && py < r.bottom + padY;
      if (near) {
        tgt.x = clamp((px - (r.left + r.width / 2)) / (r.width / 2 + padX));
        tgt.y = clamp((py - (r.top + r.height / 2)) / (r.height / 2 + padY));
        tgt.s = 1;
      } else { tgt.x = tgt.y = tgt.s = 0; }
      run();
    };
    section.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      px = e.clientX; py = e.clientY; aim();
    }, { passive: true });
    section.addEventListener('pointerleave', () => { px = py = null; tgt.x = tgt.y = tgt.s = 0; run(); });
    // the page can scroll under a still cursor (the section is pinned while it plays): re-aim then too
    window.addEventListener('scroll', aim, { passive: true });
  }

  // absolute path data (M L H V C Q Z) → segments of absolute points
  function parsePath(d) {
    const tk = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [];
    const segs = []; let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0;
    const num = () => parseFloat(tk[i++]);
    while (i < tk.length) {
      if (/[A-Za-z]/.test(tk[i])) cmd = tk[i++];
      if (cmd === 'M') { x = num(); y = num(); sx = x; sy = y; segs.push(['M', [x, y]]); cmd = 'L'; }
      else if (cmd === 'L') { x = num(); y = num(); segs.push(['L', [x, y]]); }
      else if (cmd === 'H') { x = num(); segs.push(['L', [x, y]]); }
      else if (cmd === 'V') { y = num(); segs.push(['L', [x, y]]); }
      else if (cmd === 'C') { const a = [num(), num()], b = [num(), num()]; x = num(); y = num(); segs.push(['C', a, b, [x, y]]); }
      else if (cmd === 'Q') { const a = [num(), num()]; x = num(); y = num(); segs.push(['Q', a, [x, y]]); }
      else if (cmd === 'Z' || cmd === 'z') { segs.push(['Z']); x = sx; y = sy; if (i < tk.length && !/[A-Za-z]/.test(tk[i])) return null; }
      else return null;
    }
    return segs;
  }
  // CSS inset shorthand of % values → [top, right, bottom, left] as fractions
  const insets = (s) => {
    const v = (s || '').trim().split(/\s+/).filter(Boolean).map((p) => (p.endsWith('%') ? parseFloat(p) / 100 : 0));
    if (!v.length) return [0, 0, 0, 0];
    const [t, r = t, b = t, l = r] = v;
    return [t, r, b, l];
  };
  const svgCache = {};
  const loadSvg = (src) => (svgCache[src] ||= fetch(src).then((r) => (r.ok ? r.text() : Promise.reject(r.status))).then((txt) => {
    const t = document.createElement('div'); t.innerHTML = txt.trim(); return t.querySelector('svg');
  }));

  const shroud = fig.querySelector('[data-layer="shroud"]');
  if (!shroud) return;
  const spans = [...shroud.querySelectorAll('.pc[data-piece]')];
  const hubs = spans.filter((s) => s.dataset.piece === '35');
  const pick = (a, b) => spans.filter((s) => +s.dataset.piece >= a && +s.dataset.piece <= b);
  const FANS = [{ blades: pick(26, 34), hub: hubs[0], dir: 1 }, { blades: pick(36, 44), hub: hubs[1], dir: 1 }];

  const fans = [];
  FANS.forEach(({ blades, hub, dir }) => {
    if (!blades.length || !hub) return;
    const [hx, hy, hw, hh] = hub.dataset.box.split(',').map(Number);
    const c = [hx + hw / 2 - OX, hy + hh / 2 - OY];
    Promise.all(blades.map((s) => {
      const img = s.querySelector('img');
      return loadSvg(img.getAttribute('src')).then((src) => ({ s, src }));
    })).then((list) => {
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'gpu__fanfx');
      svg.setAttribute('viewBox', '0 0 419 544');
      svg.setAttribute('aria-hidden', 'true');
      const paths = [];
      list.forEach(({ s, src }) => {
        const [x, y, w, h] = s.dataset.box.split(',').map(Number);
        const [t, r, b, l] = insets(s.dataset.bleed);
        const vb = src.viewBox.baseVal;
        const bx = x - OX - l * w, by = y - OY - t * h;
        const sx = (w * (1 + l + r)) / (vb.width || w), sy = (h * (1 + t + b)) / (vb.height || h);
        src.querySelectorAll('path').forEach((p) => {
          if (p.closest('clipPath, defs, mask')) return;
          const segs = parsePath(p.getAttribute('d') || '');
          if (!segs) return;
          const pts = segs.map((sg) => (sg[0] === 'Z' ? sg : [sg[0], ...sg.slice(1).map(([u, v]) => [bx + u * sx, by + v * sy])]));
          const el = document.createElementNS(NS, 'path');
          ['fill', 'fill-opacity', 'stroke', 'stroke-linejoin', 'stroke-opacity'].forEach((a) => p.hasAttribute(a) && el.setAttribute(a, p.getAttribute(a)));
          if (p.hasAttribute('stroke-width')) el.setAttribute('stroke-width', (+p.getAttribute('stroke-width') * sx).toFixed(3));
          svg.appendChild(el);
          paths.push({ el, segs: pts });
        });
      });
      hub.before(svg);
      blades.forEach((s) => { s.style.visibility = 'hidden'; });
      const fan = { c, paths, dir };
      fans.push(fan);
      draw(fan, angle);
    }).catch(() => {});
  });

  // p → c + M·R(θ)·M⁻¹·(p − c), M = diag(1, K)
  function draw(fan, theta) {
    const [cx, cy] = fan.c, ct = Math.cos(theta * fan.dir), st = Math.sin(theta * fan.dir);
    const m = ([x, y]) => {
      const dx = x - cx, dy = (y - cy) / K;
      return `${(cx + ct * dx - st * dy).toFixed(2)} ${(cy + K * (st * dx + ct * dy)).toFixed(2)}`;
    };
    fan.paths.forEach(({ el, segs }) => el.setAttribute('d', segs.map((sg) => (sg[0] === 'Z' ? 'Z' : sg[0] + sg.slice(1).map(m).join(' '))).join('')));
  }

  const SPEED = 3;   // rad/s, like the problem cards' fans
  let raf = 0, last = 0, t0 = 0, angle = 0;
  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    angle = (angle + SPEED * Math.min(1, (now - t0) / 1200) * dt) % TAU;
    fans.forEach((f) => draw(f, angle));
    raf = onScreen ? requestAnimationFrame(tick) : 0;
  }
  function kick() {
    if (reduce || raf) return;
    last = t0 = performance.now();
    raf = requestAnimationFrame(tick);
  }
})();
