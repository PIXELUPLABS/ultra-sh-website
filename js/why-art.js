/* "Why Ultra" server drawing: one part of the server per point, lifted out and lit as you read it.
   - Point 1 (Hosts): the three CPU coolers rise; their fins light up one after another and the top face
     pulses, like the chip and heatsink on the problem cards.
   - Point 2 (VMs): the RAM sticks slide up out of their slots one by one, bank by bank, and a light runs
     along them.
   - Point 3 (People): the six fans rise one after another and spin faster; the footprint each leaves on
     the board lights up lime and glows (the blades stay grey).
   A lifted cooler or fan leaves a dashed lime outline where it sat, with guides down its corners (the
   "exploded drawing" of the problem cards), and each point's part gets a 14px callout pointing left.
   main.js sends 'why:parts' with the three parts' 0–1 lift as the section scrolls; before anything
   arrives (no motion) the drawing stays as designed.
   Fans: every rotor's blades turn in the plane of its fan face, all the time (faster when lit). The face
   is an ellipse (a circle seen in isometric); the blades are re-drawn through ellipse · rotation ·
   ellipse⁻¹ about its centre, point by point, so the 1px strokes keep their weight. */
(() => {
  const art = document.querySelector('[data-art]');
  if (!art) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const NS = 'http://www.w3.org/2000/svg';
  const W = 2012, H = 986;                       // the drawing's frame, in Figma px ("units")
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const smooth = (t) => t * t * (3 - 2 * t);
  // item k of K starts a little after item k-1: S is the share of the run spent waiting for the last one
  const stagger = (p, k, K, S) => smooth(clamp01((p - (K > 1 ? k / (K - 1) : 0) * S) / (1 - S)));

  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const a in attrs) e.setAttribute(a, attrs[a]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const cache = {};
  const load = (src) => (cache[src] ||= fetch(src).then((r) => (r.ok ? r.text() : Promise.reject(r.status))).then((txt) => {
    const t = document.createElement('div'); t.innerHTML = txt.trim();
    const svg = t.querySelector('svg'); if (!svg) throw new Error('no svg');
    return svg;
  }));
  const inline = (span) => {
    const img = span.querySelector('img');
    if (!img) return Promise.reject();
    return load(img.getAttribute('src')).then((src) => {
      const svg = src.cloneNode(true);
      svg.removeAttribute('style'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
      img.replaceWith(svg);
      return svg;
    });
  };
  // CSS inset shorthand of % values → [top, right, bottom, left] as fractions
  const insets = (s) => {
    const v = (s || '').trim().split(/\s+/).filter(Boolean).map((p) => (p.endsWith('%') ? parseFloat(p) / 100 : 0));
    if (!v.length) return [0, 0, 0, 0];
    const [t, r = t, b = t, l = r] = v;
    return [t, r, b, l];
  };
  // a piece's box in frame units, and the box its svg is drawn in (the box grown by the bleed)
  const geom = (span) => {
    const [t, r, b, l] = insets(span.style.inset);
    const box = { x: l * W, y: t * H, w: (1 - l - r) * W, h: (1 - t - b) * H };
    const wrap = span.querySelector('.pc__b');
    const [bt, br, bb, bl] = insets(wrap && wrap.style.inset);
    return { box, svgBox: { x: box.x + bl * box.w, y: box.y + bt * box.h, w: box.w * (1 - bl - br), h: box.h * (1 - bt - bb) } };
  };
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
  const endPoints = (segs) => segs.filter((s) => s[0] !== 'Z').map((s) => s[s.length - 1]);

  /* ---------- the three parts ---------- */
  const RISE = { cpu: 50, ram: 56, fan: 40 };        // frame units each part lifts
  const ORDER = ['cpu', 'ram', 'fan'];                // point 1, 2, 3
  const parts = { cpu: [], ram: [], fan: [] };        // [index] → { spans, ghost, sticks }
  art.querySelectorAll('[data-part]').forEach((s) => {
    const list = parts[s.dataset.part];
    const i = +s.dataset.i;
    (list[i] ||= { spans: [] }).spans.push(s);
  });
  const lift = [0, 0, 0];

  // a lifted piece moves on `translate` in % of its own height, so it stays right at every size
  const raise = (span, units) => {
    const h = (span.__h ||= geom(span).box.h);
    span.style.translate = units ? `0 ${(-units / h * 100).toFixed(3)}%` : '';
  };

  // ghost: the outline the piece leaves where it sat (dashed lime), with guides down its three bottom
  // corners. withBase (fans): also its footprint on the board, the top face dropped by the box's height,
  // which lights up (css .why-base) while the part is lit
  function addGhost(item, rise, name, withBase) {
    const span = item.spans[0];
    const img = span.querySelector('img'); if (!img) return;
    load(img.getAttribute('src')).then((src) => {
      const svg = src.cloneNode(true);
      svg.removeAttribute('style'); svg.setAttribute('aria-hidden', 'true');
      const pts = []; let top = null, topMaxY = 0;
      svg.querySelectorAll('path').forEach((p) => {
        const segs = parsePath(p.getAttribute('d') || '');
        if (segs) {
          const ep = endPoints(segs);
          pts.push(...ep);
          if (/^#18181b$/i.test(p.getAttribute('fill') || '')) { top = p.getAttribute('d'); topMaxY = Math.max(...ep.map((q) => q[1])); }
        }
        p.setAttribute('fill', 'none');
        p.setAttribute('class', 'why-ghost__line');
        ['stroke', 'stroke-width', 'stroke-opacity'].forEach((a) => p.removeAttribute(a));
      });
      if (!pts.length) return;
      if (withBase && top) {
        const drop = Math.max(...pts.map((q) => q[1])) - topMaxY;
        const base = el('path', { d: top, transform: `translate(0 ${drop.toFixed(2)})`, class: 'why-base' });
        const first = svg.querySelector('path');
        first.parentNode.insertBefore(base, first);
      }
      const minX = Math.min(...pts.map((q) => q[0])), maxX = Math.max(...pts.map((q) => q[0]));
      const low = (sel) => sel.reduce((a, q) => (q[1] > a[1] ? q : a));
      const corners = [low(pts.filter((q) => q[0] < minX + 0.6)), low(pts.filter((q) => q[0] > maxX - 0.6)), low(pts)];
      const { svgBox } = geom(span);
      const k = svgBox.h / svg.viewBox.baseVal.height;          // frame units per svg unit
      const guides = corners.map(([x, y]) => ({ y, line: el('line', { x1: x, x2: x, y1: y, y2: y, class: 'why-guide' }, svg) }));
      const ghost = document.createElement('span');
      ghost.className = 'pc why-ghost';
      ghost.style.inset = span.style.inset;
      ghost.style.setProperty('--k', span.style.getPropertyValue('--k'));
      if (lit[name]) ghost.classList.add('is-lit');
      const wrap = span.querySelector('.pc__b');
      if (wrap) { const w = wrap.cloneNode(false); w.appendChild(svg); ghost.appendChild(w); } else ghost.appendChild(svg);
      span.before(ghost);
      item.ghost = { el: ghost, guides, rise: rise / k };
      paint();
    }).catch(() => {});
  }

  // CPU coolers: the fins overlay is split into its eleven fin lines (they light up in turn); the top
  // face is tagged (it pulses)
  parts.cpu.forEach((item) => {
    if (!item) return;
    addGhost(item, RISE.cpu, 'cpu', false);
    item.spans.forEach((span) => inline(span).then((svg) => {
      svg.querySelectorAll('path').forEach((p) => {
        if (/^#e2f663$/i.test(p.getAttribute('fill') || '')) p.classList.add('why-top');
        if (p.getAttribute('fill')) return;
        const d = p.getAttribute('d') || '';
        const subs = d.split(/(?=M)/).filter((s) => s.trim());
        if (subs.length < 4) return;
        subs.forEach((sd, j) => {
          const f = p.cloneNode(false);
          f.setAttribute('d', sd);
          f.classList.add('why-fin');
          f.style.setProperty('--j', j);
          p.before(f);
        });
        p.remove();
      });
    }).catch(() => {}));
  });

  // RAM: each bank's sticks (runs of three faces, or a nested group) become groups that slide up in turn
  parts.ram.forEach((item) => {
    if (!item) return;
    const span = item.spans[0];
    inline(span).then((svg) => {
      const root = svg.querySelector('g') || svg;
      const sticks = []; let run = [];
      const flush = () => { if (!run.length) return; const g = el('g'); run[0].before(g); run.forEach((n) => g.appendChild(n)); sticks.push(g); run = []; };
      [...root.children].forEach((n) => {
        if (n.tagName.toLowerCase() === 'g') { flush(); sticks.push(n); return; }
        run.push(n);
        if (run.length === 3) flush();
      });
      flush();
      sticks.forEach((g, j) => { g.classList.add('ram-stick'); g.style.setProperty('--j', j); });
      item.sticks = sticks;
      item.k = geom(span).svgBox.h / svg.viewBox.baseVal.height;
      paint();
    }).catch(() => {});
  });

  parts.fan.forEach((item) => { if (item) addGhost(item, RISE.fan, 'fan', true); });

  /* ---------- callouts: one per point, 14px, pointing left into the black beside the text ----------
     In frame units at the part's resting place; each rides up with its part. A white 1px line from a
     lime node on the part to a lime node further left, the label beyond it. They draw in once the part
     is up and fold away as it settles. */
  const CALLOUTS = [
    // nodes on the middle of each part's front face (cooler: y 204–352 at x 850; RAM bank: 232–312 at
    // x 745), not its top edge: the top of the drawing is what a wide window crops, under the nav
    // room: how far (units) the node may slide down and still be on that face (see placeRow)
    { part: 'cpu', i: 0, text: 'AMD EPYC 4005', at: [850, 270], to: 600, room: 60 },
    { part: 'ram', i: 0, text: '0 GB shared RAM', at: [745, 272], to: 572, room: 36 },
    // its label ends left of the chassis' top-left edge, which crosses the label's height near x 480
    { part: 'fan', i: 0, text: 'Fans · watched 24/7', at: [566, 332], to: 450, room: 20 },
  ];
  const pct = (v, of) => `${((v / of) * 100).toFixed(4)}%`;
  const callouts = CALLOUTS.map((c, n) => {
    const co = document.createElement('div');
    co.className = 'why-co';
    co.setAttribute('aria-hidden', 'true');
    const [x, y] = c.at;
    // the lines are 1px elements (crisp at every size): a drop straight down from the part's node (only
    // when the label row has to sit lower, see placeRow), then the line out to the left
    const drop = document.createElement('i');
    drop.className = 'why-co__drop';
    Object.assign(drop.style, { left: pct(x, W), top: pct(y, H), height: '0%' });
    co.appendChild(drop);
    const line = document.createElement('i');
    line.className = 'why-co__line';
    Object.assign(line.style, { left: pct(c.to, W), width: pct(x - c.to, W), top: pct(y, H) });
    co.appendChild(line);
    const node = (cx, cls) => {
      const s = document.createElement('i');
      s.className = `why-co__node ${cls}`;
      s.style.left = pct(cx, W); s.style.top = pct(y, H);
      co.appendChild(s);
      return s;
    };
    const near = node(x, 'why-co__node--near');
    const far = node(c.to, 'why-co__node--far');
    const tag = document.createElement('span');
    tag.className = 'why-co__tag';
    tag.style.left = pct(c.to - 10, W); tag.style.top = pct(y, H);
    tag.textContent = c.text;
    co.appendChild(tag);
    art.appendChild(co);
    return { ...c, n, co, tag, near, row: [line, far, tag], drop, on: false };
  });
  /* Keep each callout clear of the sticky nav. The section is held centred on screen, so a window wider
     than the design (16:9 and up) crops the top of the drawing, and labels lifted with their parts can
     land under the nav. Only then: the node slides down its part (up to `room` units, still on the same
     face), and if the label still needs to go lower, the row drops below the nav with a short leader
     down from the node. Measured when a callout opens (the drawing is held still then) and on resize;
     at the design's 16:10 nothing moves. */
  const nav = document.querySelector('.nav');
  const placeRow = (c) => {
    const r = art.getBoundingClientRect(), k = r.width / W;
    if (!k) return;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
    const navH = nav ? nav.offsetHeight : 0;
    // frame y (at rest) that lands at window y `px` once the part is up
    const at = (px) => (px - r.top) / k + RISE[c.part];
    const y = c.at[1];
    const nodeY = y + Math.max(0, Math.min(c.room || 0, at(navH + 1.2 * rem) - y));
    const rowY = Math.max(nodeY, Math.min(nodeY + 160, at(navH + Math.max(24, 2.4 * rem))));
    c.near.style.top = pct(nodeY, H);
    c.drop.style.top = pct(nodeY, H);
    c.drop.style.height = pct(rowY - nodeY, H);
    c.row.forEach((e) => { e.style.top = pct(rowY, H); });
    c.co.classList.toggle('has-drop', rowY - nodeY > 0.5);
  };
  // the drawing's scale against its 2012-unit frame (css sizes the labels with it on tablet / phone) and
  // the room each label has left of its far node before the section's edge (it wraps beyond that)
  const sizeCallouts = () => {
    const w = art.offsetWidth; if (!w) return;
    art.style.setProperty('--art-k', (w / W).toFixed(4));
    callouts.forEach((c) => {
      const room = art.offsetLeft + ((c.to - 10) / W) * w - 8;
      c.tag.style.setProperty('--tag-max', `${Math.max(40, Math.round(room))}px`);
      if (c.on) placeRow(c);
    });
  };
  sizeCallouts();
  new ResizeObserver(sizeCallouts).observe(art);
  const showCallout = (c, on) => {
    if (c.on === on) return;
    c.on = on;
    if (on) placeRow(c);
    c.co.classList.toggle('is-on', on);
    if (!window.gsap) return;
    gsap.killTweensOf(c.tag);
    if (on && window.ScrambleTextPlugin && !reduce) {
      gsap.to(c.tag, { delay: 0.5, duration: 0.8, ease: 'none', scrambleText: { text: c.text, chars: 'ULTRASH', speed: 1.2 } });
    } else c.tag.textContent = c.text;
  };

  /* ---------- paint: lift every part to its point's progress ---------- */
  const lit = { cpu: false, ram: false, fan: false };
  function paint() {
    ORDER.forEach((name, pi) => {
      const p = lift[pi], list = parts[name].filter(Boolean), K = list.length;
      // lit: the glow (CSS) runs while the part is up; a little hysteresis so it never flickers
      const on = lit[name] ? p > 0.35 : p > 0.6;
      if (on !== lit[name]) {
        lit[name] = on;
        list.forEach((it) => {
          it.spans.forEach((s) => s.classList.toggle('is-lit', on));
          if (it.ghost) it.ghost.el.classList.toggle('is-lit', on);
        });
      }
      list.forEach((it, k) => {
        if (name === 'ram') {
          const bp = stagger(p, k, K, 0.3);
          it.p = bp;
          if (it.sticks) {
            const n = it.sticks.length;
            it.sticks.forEach((g, j) => {
              const e = stagger(bp, j, n, 0.55);
              g.setAttribute('transform', e > 0.001 ? `translate(0 ${(-RISE.ram * e / it.k).toFixed(2)})` : '');
            });
          }
          return;
        }
        const e = stagger(p, k, K, name === 'fan' ? 0.45 : 0.25);
        it.p = e;
        it.spans.forEach((s) => raise(s, RISE[name] * e));
        if (it.ghost) {
          it.ghost.el.style.opacity = e.toFixed(3);
          it.ghost.guides.forEach(({ y, line }) => line.setAttribute('y1', (y - it.ghost.rise * e).toFixed(2)));
        }
      });
    });
    callouts.forEach((c) => {
      const it = parts[c.part][c.i]; const e = it ? it.p || 0 : 0;
      c.co.style.translate = e > 0.001 ? `0 ${(-(RISE[c.part] * e) / H * 100).toFixed(3)}%` : '';
      showCallout(c, c.on ? e > 0.7 : e > 0.94);
    });
  }
  const take = (d) => { if (!d) return; for (let i = 0; i < 3; i++) lift[i] = clamp01(+d[i] || 0); paint(); };
  document.addEventListener('why:parts', (e) => take(e.detail));
  take(window.__whyParts);

  /* ---------- fans ---------- */
  // least-squares ellipse through the rim's points: centre, half-axes and tilt
  function fitEllipse(pts) {
    const M = Array.from({ length: 5 }, () => new Array(6).fill(0));
    pts.forEach(([x, y]) => {
      const v = [x * x, x * y, y * y, x, y];
      for (let r = 0; r < 5; r++) { for (let c = 0; c < 5; c++) M[r][c] += v[r] * v[c]; M[r][5] += v[r]; }
    });
    for (let c = 0; c < 5; c++) {
      let p = c; for (let r = c + 1; r < 5; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < 5; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k < 6; k++) M[r][k] -= f * M[c][k]; }
    }
    const [a, b, c, d, e] = M.map((row, r) => row[5] / row[r]);
    const den = 4 * a * c - b * b;
    const cx = (b * e - 2 * c * d) / den, cy = (b * d - 2 * a * e) / den;
    const F0 = (d * cx + e * cy) / 2 - 1;
    const phi = 0.5 * Math.atan2(b, a - c), co = Math.cos(phi), si = Math.sin(phi);
    const A = a * co * co + b * co * si + c * si * si, C = a * si * si - b * co * si + c * co * co;
    return { cx, cy, rx: Math.sqrt(-F0 / A), ry: Math.sqrt(-F0 / C), phi };
  }
  const fans = [];
  art.querySelectorAll('[data-rotor]').forEach((span) => {
    inline(span).then((svg) => {
      const paths = [...svg.querySelectorAll('path')];
      if (paths.length < 2) return;
      const rim = parsePath(paths[0].getAttribute('d') || '');
      // the blades: the stroke-only paths (the rim and the hub are filled)
      const blades = paths.slice(1).filter((p) => !p.getAttribute('fill') || p.getAttribute('fill') === 'none')
        .map((p) => ({ p, segs: parsePath(p.getAttribute('d') || '') })).filter((s) => s.segs);
      if (!rim || !blades.length) return;
      const E = fitEllipse(endPoints(rim));
      if (!isFinite(E.rx) || !isFinite(E.ry)) return;
      fans.push({ E, blades, angle: 0, i: +span.dataset.i });
    }).catch(() => {});
  });
  const drawFan = (f, theta) => {
    const { cx, cy, rx, ry, phi } = f.E, cp = Math.cos(phi), sp = Math.sin(phi), ct = Math.cos(theta), st = Math.sin(theta);
    // p → centre + E·R(θ)·E⁻¹·(p − centre), with E = R(φ)·diag(rx, ry)
    const m = ([x, y]) => {
      const dx = x - cx, dy = y - cy;
      let u = (cp * dx + sp * dy) / rx, v = (-sp * dx + cp * dy) / ry;      // E⁻¹
      const u2 = ct * u - st * v, v2 = st * u + ct * v;                     // R(θ)
      u = u2 * rx; v = v2 * ry;                                             // diag
      return `${(cx + cp * u - sp * v).toFixed(2)} ${(cy + sp * u + cp * v).toFixed(2)}`;   // R(φ)
    };
    f.blades.forEach(({ p, segs }) => p.setAttribute('d', segs.map((sg) => (sg[0] === 'Z' ? 'Z' : sg[0] + sg.slice(1).map(m).join(' '))).join('')));
  };

  let onScreen = false;
  new IntersectionObserver(([en]) => {
    onScreen = en.isIntersecting;
    art.classList.toggle('is-playing', onScreen && !reduce);
    if (onScreen) kick();
  }).observe(art);
  if (reduce) return;

  const SPEED = 3;    // rad/s, as the problem card's fan; up to 2.6× that while the fans are lit
  let raf = 0, last = 0, t0 = 0, boost = 0;
  const tick = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const ramp = Math.min(1, (now - t0) / 1200);
    boost += ((lit.fan ? 1 : 0) - boost) * Math.min(1, dt * 3);          // eases into and out of the faster spin
    fans.forEach((f) => {
      const it = parts.fan[f.i];
      const up = it ? it.p || 0 : 0;
      f.angle = (f.angle + SPEED * ramp * (1 + 1.6 * boost * (0.4 + 0.6 * up)) * dt) % (Math.PI * 2);
      drawFan(f, f.angle);
    });
    raf = onScreen ? requestAnimationFrame(tick) : 0;
  };
  function kick() {
    if (reduce || raf) return;
    last = t0 = performance.now();
    raf = requestAnimationFrame(tick);
  }
})();
