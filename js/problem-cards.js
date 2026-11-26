/* Problem cards (P/001–P/003): illustration motion after the "ultra-unwatched-card" reference.
   - Playing (whenever the card is in view, no hover needed): the top part lifts a little (ease-out-back)
     with its guide lines stretching, and per card the fan spins, data pulses along the traces, the
     heatsink fins light in sequence, port lamps / DIMM LEDs blink, a scan light sweeps the board and the
     failed DIMM is pulled from its slot.
   - Callouts (only while the card is hovered or focused): straight horizontal leaders to the left or right
     in the Figma style (6px lime nodes, white 1px line, Plex Mono label). The near node pops, the line
     draws out, the end node pops and the label scrambles in; all reverse on hover-out.
   The Figma SVGs are inlined at runtime so their parts can move; the <img> stays as the fallback. */
(() => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const NS = 'http://www.w3.org/2000/svg';
  const LIME = '#D0EF0E', LIME_TOP = '#E2F663';
  const TAU = Math.PI * 2;

  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const easeOutBack = (t) => { const k = 1.5; return 1 + (k + 1) * Math.pow(t - 1, 3) + k * Math.pow(t - 1, 2); };
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  /* Parts by Figma layer ("Vector N"). Callouts in the drawing's units (1 unit = 0.1rem, origin = its
     top-left): a node on the part at `at`, a horizontal line to x = `to` (left or right of it), the label
     beyond the end node. A `lifted` callout rides up with its part. */
  const CARDS = {
    1: {
      lift: { ids: [1440, 1441, ...range(1443, 1461)], rise: 16, guides: [1438, 1439, 1462] },
      fan: { ring: 1443, hub: 1444, blades: range(1445, 1455) },
      flow: range(1416, 1422),
      chip: [1435],
      callouts: [
        { text: 'Fan', at: [212, 92], to: 306, lifted: true, d: 0 },
        { text: 'Shared CPU', at: [150, 180], to: -30, d: 160 },
      ],
    },
    2: {
      lift: { ids: range(171, 179), rise: 16, guides: [169, 170, 180] },
      fins: range(174, 179),
      lamps: [154, 158, 162, 166],
      flow: [148, 149, 150],
      chip: [146],
      scan: { grid: 144, top: 141 },
      callouts: [
        { text: 'Heatsink', at: [222, 42], to: 306, lifted: true, d: 0 },
        { text: 'Network ports', at: [252, 178], to: 8, d: 160 },
      ],
    },
    3: {
      lift: { ids: range(209, 213), rise: 22 },
      leds: [203, 208, 218],
      chip: [210],
      scan: { grid: 192, top: 189 },
      callouts: [
        { text: 'Failed DIMM', at: [58, 40], to: -30, lifted: true, d: 0 },
        { text: 'DIMM slots', at: [224, 186.6], to: 330, d: 160 },
      ],
    },
  };

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  const byNum = (svg, n) => svg.querySelector(`[id="Vector ${n}"]`);
  // wrap layers in a <g> placed where the first one was (they are consecutive, so paint order holds)
  function wrap(svg, nums, cls) {
    const nodes = nums.map((n) => byNum(svg, n)).filter(Boolean);
    if (!nodes.length) return null;
    const g = el('g', { class: cls });
    nodes[0].parentNode.insertBefore(g, nodes[0]);
    nodes.forEach((n) => g.appendChild(n));
    return g;
  }
  const copyOf = (src, attrs) => el('path', { d: src.getAttribute('d'), ...attrs });

  /* Absolute path data (M L H V C Q Z, as Figma exports it) → segments of absolute points, so a blade
     can be re-drawn rotated without transforming its stroke. Returns null for anything else. */
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

  function buildCallouts(pill, svg, list) {
    const vb = svg.viewBox.baseVal;
    return list.map((c) => {
      const [x, y] = c.at, side = c.to > x ? 'right' : 'left';
      const co = document.createElement('div');
      co.className = 'pco';
      co.setAttribute('aria-hidden', 'true');
      co.style.setProperty('--d', `${c.d}ms`);
      const s = el('svg', { class: 'pco__svg', viewBox: `0 0 ${vb.width} ${vb.height}`, fill: 'none' }, co);
      el('path', { class: 'pco__line', d: `M${x} ${y}H${c.to}`, pathLength: 1 }, s);
      el('rect', { class: 'pco__node pco__node--near', x: x - 3, y: y - 3, width: 6, height: 6 }, s);
      el('rect', { class: 'pco__node pco__node--far', x: c.to - 3, y: y - 3, width: 6, height: 6 }, s);
      const tag = document.createElement('span');
      tag.className = `pco__tag pco__tag--${side}`;
      tag.style.left = `${(c.to + (side === 'right' ? 12 : -12)) / 10}rem`;
      tag.style.top = `${y / 10}rem`;
      tag.textContent = c.text;
      co.appendChild(tag);
      pill.appendChild(co);
      return { co, lifted: !!c.lifted, tag, text: c.text, delay: (c.d + 520) / 1000 };
    });
  }

  function setup(pill, svgText) {
    const n = +pill.dataset.pill, cfg = CARDS[n];
    const card = pill.closest('.pcard');
    const tmp = document.createElement('div');
    tmp.innerHTML = svgText.trim();
    const svg = tmp.querySelector('svg');
    const img = pill.querySelector('img');
    if (!cfg || !card || !svg || !img) return;
    svg.removeAttribute('style');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.classList.add('pill__svg');
    pill.replaceChild(svg, img);
    pill.setAttribute('role', 'img');
    pill.setAttribute('aria-label', img.alt);

    // ---- parts ----
    const rise = cfg.lift ? cfg.lift.rise : 0;
    const lift = cfg.lift ? wrap(svg, cfg.lift.ids, 'part-lift') : null;
    /* guides (dashed lines from the board up to the lifted part): rather than stretching them (which
       stretches the dashes too), a copy rides up with the part and shows only above the original's top,
       so the line simply gets longer with the same dash rhythm */
    const vbox = svg.viewBox.baseVal;
    const guides = ((cfg.lift && cfg.lift.guides) || []).map((num, k) => {
      const p = byNum(svg, num); if (!p) return null;
      const b = p.getBBox(), id = `pguide${n}-${k}`;
      const defs = svg.querySelector('defs') || svg.insertBefore(el('defs', {}), svg.firstChild);
      const cp = el('clipPath', { id, clipPathUnits: 'userSpaceOnUse' }, defs);
      el('rect', { x: -vbox.width, y: -vbox.height, width: vbox.width * 3, height: vbox.height + b.y + 0.5 }, cp);
      const holder = el('g', { 'clip-path': `url(#${id})` });
      p.parentNode.insertBefore(holder, p.nextSibling);
      const copy = p.cloneNode(true); copy.removeAttribute('id'); holder.appendChild(copy);
      return { copy };
    }).filter(Boolean);
    /* fan: the blades turn in the plane of the cover. The ring is an axis-aligned ellipse, so a turn by θ
       is scale(1,k)·rotate(θ)·scale(1,1/k) about its centre. That map is applied to the blade outlines'
       points (not as an SVG transform), so their 1px strokes keep their weight at every angle. */
    let fan = null;
    if (cfg.fan) {
      const rb = byNum(svg, cfg.fan.ring).getBBox();
      const blades = cfg.fan.blades.map((num) => byNum(svg, num)).filter(Boolean)
        .map((p) => ({ p, segs: parsePath(p.getAttribute('d')) })).filter((b) => b.segs);
      fan = { blades, cx: rb.x + rb.width / 2, cy: rb.y + rb.height / 2, k: rb.height / rb.width };
      /* the hub isn't quite concentric with the ring in the drawing, so turning blades would cut into it:
         draw the hub over the blades, filled with the cover's top colour, so their roots tuck under it */
      const hub = byNum(svg, cfg.fan.hub), lastBlade = blades.length && blades[blades.length - 1].p;
      if (hub && lastBlade) { hub.setAttribute('fill', '#18181B'); lastBlade.after(hub); }
    }
    (cfg.chip || []).forEach((num) => byNum(svg, num)?.classList.add('chip'));
    (cfg.leds || []).forEach((num) => byNum(svg, num)?.classList.add('led'));
    (cfg.lamps || []).forEach((num) => {          // port outlines get a lit face that blinks
      const src = byNum(svg, num); if (!src) return;
      src.parentNode.insertBefore(copyOf(src, { fill: LIME_TOP, class: 'lamp' }), src);
    });
    (cfg.fins || []).forEach((num, k) => {        // heatsink fins light up one after another
      const src = byNum(svg, num); if (!src) return;
      const f = copyOf(src, { stroke: LIME, 'stroke-width': 1.2, fill: 'none', 'stroke-linejoin': 'round', class: 'fin-light' });
      f.style.setProperty('--k', k);
      src.parentNode.insertBefore(f, src.nextSibling);
    });
    (cfg.flow || []).forEach((num) => {           // data pulses along the traces
      const src = byNum(svg, num); if (!src) return;
      src.parentNode.insertBefore(copyOf(src, { stroke: LIME_TOP, 'stroke-width': 1.5, 'stroke-linecap': 'round',
        'stroke-dasharray': '6 26', fill: 'none', class: 'flow' }), src.nextSibling);
    });
    svg.querySelectorAll('.lamp, .led').forEach((l) => {
      l.style.setProperty('--d', (0.7 + Math.random() * 1.3).toFixed(2) + 's');
      l.style.setProperty('--o', (-Math.random() * 2).toFixed(2) + 's');
    });
    let scan = null;
    if (cfg.scan) {                               // a light band sweeping along the board
      const grid = byNum(svg, cfg.scan.grid), top = byNum(svg, cfg.scan.top);
      const vb = svg.viewBox.baseVal, uid = `pscan${n}`;
      const defs = el('defs', {});
      svg.insertBefore(defs, svg.firstChild);
      const grad = el('linearGradient', { id: uid + 'g', gradientUnits: 'userSpaceOnUse' }, defs);
      [[0, 0], [0.5, 1], [1, 0]].forEach(([o, a]) => el('stop', { offset: o, 'stop-color': '#fff', 'stop-opacity': a }, grad));
      const mask = el('mask', { id: uid + 'm', maskUnits: 'userSpaceOnUse', x: -50, y: -50, width: vb.width + 100, height: vb.height + 100 }, defs);
      el('rect', { x: -50, y: -50, width: vb.width + 100, height: vb.height + 100, fill: `url(#${uid}g)` }, mask);
      const g = el('g', { class: 'scan', mask: `url(#${uid}m)` });
      grid.parentNode.insertBefore(g, grid.nextSibling);
      g.appendChild(copyOf(top, { fill: LIME_TOP, 'fill-opacity': 0.12 }));
      g.appendChild(copyOf(grid, { stroke: LIME_TOP, 'stroke-opacity': 0.9, 'stroke-width': 0.9, fill: 'none' }));
      const b = top.getBBox();                    // sweep down-right along the board's long axis
      const s0 = [b.x - 30, b.y + b.height * 0.2], s1 = [b.x + b.width + 30, b.y + b.height * 0.8];
      const span = [s1[0] - s0[0], s1[1] - s0[1]], w = 0.16;
      scan = (u) => {
        const cx = s0[0] + span[0] * u, cy = s0[1] + span[1] * u;
        grad.setAttribute('x1', (cx - span[0] * w).toFixed(2)); grad.setAttribute('y1', (cy - span[1] * w).toFixed(2));
        grad.setAttribute('x2', (cx + span[0] * w).toFixed(2)); grad.setAttribute('y2', (cy + span[1] * w).toFixed(2));
      };
      scan(-1);
    }

    const tags = buildCallouts(pill, svg, cfg.callouts || []);
    const riders = tags.filter((t) => t.lifted).map((t) => t.co);

    // ---- pose: e = 0 at the Figma drawing, 1 = raised by `rise` ----
    const pose = (e) => {
      if (!lift) return;
      const up = rise * e;
      lift.setAttribute('transform', `translate(0 ${(-up).toFixed(2)})`);
      guides.forEach(({ copy }) => { copy.setAttribute('transform', `translate(0 ${(-up).toFixed(2)})`); });
      riders.forEach((co) => { co.style.translate = `0 ${(-up / 10).toFixed(3)}rem`; });
    };
    const spinFan = (angle) => {
      if (!fan) return;
      const { cx, cy, k } = fan, c = Math.cos(angle), s = Math.sin(angle);
      const m = ([x, y]) => {
        const dx = x - cx, dy = y - cy;
        return `${(cx + c * dx - (s / k) * dy).toFixed(2)} ${(cy + k * s * dx + c * dy).toFixed(2)}`;
      };
      fan.blades.forEach(({ p, segs }) => {
        p.setAttribute('d', segs.map((sg) => (sg[0] === 'Z' ? 'Z' : sg[0] + sg.slice(1).map(m).join(' '))).join(''));
      });
    };

    pill.classList.add('is-live');

    // ---- keep the callout labels inside the card. Where a label would run past the card's edge (narrow
    //      screens), the drawing slides sideways just enough; if the set is wider than the card, it is
    //      centred. Measured with the labels where they sit when shown, and again on resize ----
    const art = pill.closest('.pcard__art') || pill.parentElement;
    const fit = () => {
      pill.style.translate = '';
      const z = parseFloat(getComputedStyle(pill).zoom) || 1;
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) * z;
      const pr = pill.getBoundingClientRect(), ar = art.getBoundingClientRect();
      let lo = pr.left, hi = pr.right;
      tags.forEach(({ tag }) => {
        const x = pr.left + parseFloat(tag.style.left) * rem, w = tag.getBoundingClientRect().width;
        if (tag.classList.contains('pco__tag--right')) hi = Math.max(hi, x + w); else lo = Math.min(lo, x - w);
      });
      const L = ar.left + 6, R = ar.right - 6;
      const dx = hi - lo > R - L ? (L + R - lo - hi) / 2 : lo < L ? L - lo : hi > R ? R - hi : 0;
      if (Math.abs(dx) > 0.5) pill.style.translate = `${(dx / z).toFixed(1)}px 0`;
    };
    fit();
    window.addEventListener('resize', fit);
    if (document.fonts) document.fonts.ready.then(fit);

    // ---- callouts: hover / focus only ----
    const showCallouts = () => {
      if (card.classList.contains('is-hover')) return;
      card.classList.add('is-hover');
      if (reduce || !window.gsap || !window.ScrambleTextPlugin) return;
      tags.forEach(({ tag, text, delay }) => {
        gsap.killTweensOf(tag);
        gsap.to(tag, { delay, duration: 0.8, ease: 'none', scrambleText: { text, chars: 'ULTRASH', speed: 1.2 } });
      });
    };
    const hideCallouts = () => {
      card.classList.remove('is-hover');
      tags.forEach(({ tag, text }) => { if (window.gsap) gsap.killTweensOf(tag); tag.textContent = text; });
    };
    // any mouse, trackpad or pen hovering the card (not gated on the primary pointer, so touch-screen
    // laptops work too); on touch, a tap on the drawing toggles them
    card.addEventListener('pointerenter', (ev) => { if (ev.pointerType !== 'touch') showCallouts(); });
    card.addEventListener('pointerleave', (ev) => { if (ev.pointerType !== 'touch') hideCallouts(); });
    pill.addEventListener('click', (ev) => {
      if (ev.pointerType ? ev.pointerType !== 'touch' : canHover) return;
      if (card.classList.contains('is-hover')) hideCallouts(); else showCallouts();
    });
    card.addEventListener('focusin', showCallouts);
    card.addEventListener('focusout', (ev) => { if (!card.contains(ev.relatedTarget)) hideCallouts(); });

    if (reduce) return;   // reduced motion: the drawing stays as designed, nothing plays

    // ---- play while in view (one rAF loop for the lift, fan and scan; CSS runs the lights) ----
    const FAN_SPEED = 3;   // rad/s: about half a turn a second, slow enough to read every blade
    let raf = 0, playing = false, t0 = 0, last = 0, e = 0, eFrom = 0, angle = 0;
    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const t = now - t0;
      e = eFrom + (1 - eFrom) * easeOutBack(clamp01((t - 60) / 750));
      pose(e);
      if (fan) { angle = (angle + FAN_SPEED * easeInOut(Math.min(1, t / 1200)) * dt) % TAU; spinFan(angle); }
      if (scan) scan((t % 2600) / 2600);
      raf = requestAnimationFrame(tick);
    };
    const play = () => {
      if (playing) return;
      playing = true; card.classList.add('is-playing');
      t0 = last = performance.now(); eFrom = e;
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {            // only once the card is fully off screen, so snapping back is never seen
      if (!playing) return;
      playing = false; card.classList.remove('is-playing');
      cancelAnimationFrame(raf); raf = 0;
      e = 0; pose(0);
      if (scan) scan(-1);
    };
    new IntersectionObserver(([en]) => {
      if (en.intersectionRatio >= 0.4) play();
      else if (!en.isIntersecting) stop();
    }, { threshold: [0, 0.4] }).observe(pill);
  }

  document.querySelectorAll('[data-pill]').forEach((pill) => {
    const src = pill.querySelector('img')?.getAttribute('src');
    if (!src) return;
    fetch(src).then((r) => (r.ok ? r.text() : Promise.reject(r.status))).then((txt) => setup(pill, txt)).catch(() => {});
  });
})();
