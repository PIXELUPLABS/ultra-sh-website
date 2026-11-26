/*
  Beam Loop: WebGL2 recreations of two looping clips, as two patterns.

  Pattern 'tunnel' (default): the 1.8 s "light tunnel"
  - Rows of short bars (mirrored on both axes) sit on layers that fly toward the vanishing point.
    Layers are one depth unit apart, so the loop is seamless every 1.8 s.
  - Bar spacing widens outward (x = tan(delta * U) / delta), which gives the fanned look.
  - Each pixel gathers the bars' light along the line between it and the centre, so every bar
    trails a soft radial beam outward. This part is analytic, so it stays sharp at any size.
  - A two-radius bloom, a tone curve, the clip's measured cyan colour ramp and 30 fps film grain finish it.

  Pattern 'glitch': the 1.83 s "glitch blocks" screen
  - The clip is a 143 x 143 grid of cells; every lit cell is drawn as a vertical stripe, so blocks read
    as striped panels. Each of its 55 frames (30 fps) was traced into a cell map, stored in
    glitch-frames.js (load that script first, or the pattern shows only its background).
  - The shader redraws the stripes with the clip's measured stripe profile (deep stripes in bright
    blocks, flat dim blocks), so it is sharp at any size, then applies the clip's own colour ramp.
  - On frames wider than square (1920 x 1080), the clip fills the height and the wall of blocks
    continues to both sides with strips cut from other moments of the same clip; the corner
    readout moves to the frame's bottom-right corner. glitchExpand: false keeps the square.

  Pattern 'gel': glowing gel lanes, brought to life from a still (load gel-data.js first)
  - 13 soft-edged lanes; each lane's glow was traced into ~120 components (bands, halos, white-hot
    cores, the lane's own glow), each with its own hue from green to yellow. At time 0 the frame is the
    still (fitted to its width); then bands drift down their lanes (some twice as fast), breathe and
    flare, a scan light passes down, and a bloom spills light into the gaps. 40 s seamless loop.
  - gelMotion ('migrate' | 'flow' | 'still'), gelLanes (more repeat the lanes, fewer zoom in), gelGlow,
    gelSharp (1 = each band gets a crisp, saber-like core line inside its glow; 0 = soft, as the still),
    gelPulse, gelScan, gelRuler.
  - Tech effects: gelHud (a scanner line that locks onto bright bands as it passes, with brackets and a live
    size readout and measured spans between locks in one lane; a scope trace of the lanes' glow riding on
    the scanner; a tracking crosshair that
    hops between bands; an info panel; a minimap of the whole gel with the window in view; ruler numbers;
    lane numbers with level meters; a scrolling data column; viewfinder corners; a measurement
    grid and a status line) and gelGlitch (brief digital glitch bursts). All follow the loop exactly.
  - gelEther: ethereal glow: floating light motes and soft bokeh, long faint light streaks from the
    brightest cores, and a wide, slowly breathing aura.

  Usage
    const beams = createBeamLoop(canvas, { size: [1920, 1080], pattern: 'glitch', color: '#ff5a1f', speed: 1.5 });
    beams.start();
    beams.set({ pattern: 'tunnel', color: '#4ad295', speed: 0.75, paused: false });   // change live
  -> { start(), stop(), set(opts), renderAt(seconds), time(), params }

  Colour: color = null keeps the clip's measured colours; any '#rrggbb' builds the same ramp in that hue
  (dark tint -> full colour -> white-hot highlights). background = null derives the backdrop from the
  colour; a '#rrggbb' sets it and blends into the dark tones.
  Speed: 1 = the clip's own speed; 2 = twice as fast. The tunnel's film grain keeps its own 30 fps.
*/
(function (global) {
  const DEFAULTS = {
    period: 1.8,      // seconds per loop
    n: 2.5898,        // depth -> scale power: scale = sref * (depth / dref)^-n
    d0: 0.4674,       // depth phase offset
    dref: 1.444,      // reference depth
    sref: 23.6913,    // px (in a 500 px frame) per pattern unit at dref
    h: 1.5433,        // bar inner end (pattern units; bar pitch at the centre = 1)
    L: 1.0658,        // bar height
    w: 0.5219,        // bar width (fraction of pitch)
    c: 0.5545,        // bar offset: bar i is centred at U = i + c
    delta: 0.1443,    // spacing warp
    nb: 30,           // bars per side (cap)
    bf: 0.5245,       // outer bars dim as cos(delta * U)^bf
    fadeA: 0.7265,    // nearest layer fades in from this depth ...
    fadeW: 0.3805,    // ... over this much depth
    fog: -1.2625,     // layer brightness ~ depth^-fog
    dens: 0.6748,     // beam reach (fraction of the radius toward the centre)
    mu: 0.8962,       // beam fall-off
    win: 1.0,         // beam end: 0 hard, 1 linear fade
    gainR: 23.34,     // beam gain
    bloom: 0.327,     // bloom gain
    bloomR: 46.4764,  // bloom radius (px in a 500 px frame)
    bloom2: 0.2974,   // second bloom gain
    bloomR2: 56.5671, // second bloom radius
    floor: 0.1197,    // background level
    grain: 1.0,       // film grain amount
    pattern: 'tunnel', // 'tunnel', 'glitch', 'hero', 'glyph', 'quad' or 'gel'
    // gel lanes
    gelMotion: 'migrate',   // 'migrate' = bands drift down, some faster; 'flow' = whole lanes drift; 'still' = glow only
    gelLanes: 13,           // lanes across the frame (13 = as traced; more repeat them, fewer zoom in)
    gelGlow: 1,             // bloom strength (0 - 2)
    gelSharp: 1,            // 0 = soft bands, as in the still; 1 = each band has a crisp saber-like core line in its glow
    gelEther: 1,            // ethereal glow (0 - 2): floating light motes, long soft light streaks, a wide breathing aura
    gelPulse: true,         // bands breathe and now and then flare
    gelScan: true,          // a soft light passes down the frame
    gelRuler: true,         // the scale at the right
    gelHud: true,           // tech overlay: scanner line, lock-on brackets with size readouts, lane numbers, grid, status
    gelGlitch: true,        // tech: brief digital glitch bursts (slices jump, red / blue split) a few times per loop
    gelScanAmt: 0.55, gelEdgeIn: 8, gelEdgeOut: 3.5,               // scan light gain; lane edge softness (traced px)
    gelBloom: 0, gelBloomR: 10, gelBloom2: 0.2, gelBloomR2: 60,     // bloom gains and radii (traced px), fitted to the still
    // light processes (quadtree)
    quadLabel: 'LIGHT PROCESSES', // corner label ('' hides it)
    quadSmooth: true,       // zoom smoothly between the GIF's frames (false = hold each frame, like the GIF)
    quadHud: true,          // tech overlay: grid coordinates, cell callouts, readouts, leaf-depth chart, status line
    quadFx: true,           // processing: a few cells fill and flicker (solid or hatched)
    quadGlitch: true,       // brief digital glitch bursts (slices jump, red / blue split)
    // glyph field
    glyphGlow: false,       // bloom around the glyphs
    glyphGlowMode: 'hover', // 'hover' = only where the field is heated, 'all' = every glyph
    glyphGlowAmt: 1.2,      // glow intensity (0.2 - 2.5)
    glyphGlowRad: 26,       // glow radius (6 - 64)
    glyphHud: true,         // rulers, labels, scanner readout, telemetry
    glyphCursor: 'bracket', // 'bracket' (snapped cell brackets), 'crosshair' (full-frame hairlines), 'reticle'
                            // (3 x 3-cell target), 'block' (blinking terminal block), 'trail' (cells light up
                            // behind it), 'lens' (2.5 x loupe), 'dot', or 'system' (the OS arrow)
    glyphReadout: true,     // the cell's data beside the cursor
    glyphSeed: 0x30a5,      // layout of blocks, noise and dots (the same seed always gives the same field)
    // [Ultra.sh additions]
    glyphScale: 1,          // logical height = 1080 * scale; > 1 fits more (smaller) cells into the same canvas
    glyphFloor: null,       // (col, row, cols, rows, rand) => minimum density level 0-10 for that cell
    glyphHover: 1,          // [Ultra.sh] pointer heat radius, × the original; kept to scale with glyphScale
                            // (e.g. keep dense glyphs along a shape's outline); evaluated on each field reset
    glyphGlowNear: 0.55,    // [Ultra.sh] weight of the tight half-res halo in the bloom; it sits right on the
                            // glyph edges and softens them, so a low value keeps glyphs crisp (the wide glow stays)
    maxDpr: 2,              // [Ultra.sh] highest device-pixel ratio the backing store follows
    reduceMotion: false,    // glyph field: no scanner, glitches or drift; changes settle at once
    interactive: true,      // listen for the pointer on the canvas (the glyph field reacts to it)
    heroFit: 'contain', // hero: 'contain' shows the whole 2880 x 1248 clip, 'cover' fills the frame (crops the sides)
    // glitch pattern, fitted to its clip
    glitchExpand: true, // on frames wider than square, continue the block wall to the sides
    glitchSharp: 1.327, // steepness of block edges between rows
    glitchEdge: 0.294,  // stripe half-width (fraction of the 3.495 px pitch)
    glitchSoft: 0.092,  // stripe edge softness
    glitchGlow: 0.547,  // level between stripes as a share of the local glow
    glitchNbr: 1,       // weight falloff of neighbouring columns in the glow estimate
    glitchNbrY: 1,      // weight falloff of neighbouring rows in the glow estimate
    glitchD0: 0,        // below this level cells are flat glow ...
    glitchD1: 35.3,     // ... and above this fully striped
    color: null,      // beam colour '#rrggbb'; null = the clip's measured cyan
    background: null, // backdrop colour '#rrggbb'; null = derived from the beam colour
    highlight: 1,     // with a colour: 1 = white-hot highlights like the clips, 0 = flat duotone up to the pure colour
    contrast: 1.8,    // flat duotone only: how much the darks deepen (1 = linear)
    speed: 1,         // playback speed (1 = the clip's 1.8 s loop)
    paused: false,    // hold the current frame (grain keeps moving)
    maxPixels: 1600,  // cap on the canvas backing store's shorter side (when size is not set)
    size: null        // fixed frame size in pixels, e.g. [1920, 1080]; the clip's framing fits the height
                      // and the scene extends to the sides
  };

  // blue level -> [R, G, B], measured from the source clip
  const RAMP = [
    [0, 4, 12, 0], [19, 7, 18, 19], [26, 13, 24, 26], [34, 16, 31, 34], [44, 15, 39, 44], [54, 15, 46, 54],
    [65, 15, 54, 65], [74, 15, 61, 74], [84, 15, 69, 84], [95, 15, 77, 95], [104, 15, 85, 104],
    [115, 15, 94, 115], [124, 15, 102, 124], [135, 16, 111, 135], [144, 16, 119, 144], [155, 16, 129, 155],
    [165, 16, 138, 165], [175, 15, 148, 175], [185, 16, 158, 185], [195, 16, 169, 195], [205, 18, 181, 205],
    [215, 23, 192, 215], [225, 35, 203, 225], [234, 56, 214, 234], [244, 89, 224, 244], [255, 160, 241, 255]
  ];
  // how much the top of the ramp blends toward white (fitted to the clip's highlights)
  const WHITE = [[0, 0], [0.78, 0], [0.8, 0.02], [0.88, 0.09], [0.92, 0.18], [0.957, 0.32], [1, 0.6]];
  function whiteMix(x) {
    for (let k = 1; k < WHITE.length; k++) {
      if (x <= WHITE[k][0]) { const a = WHITE[k - 1], b = WHITE[k]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); }
    }
    return WHITE[WHITE.length - 1][1];
  }
  function parseHex(s) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(s || '').trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  // glitch pattern: green-channel level -> [R, G, B], measured from its clip
  const RAMP2 = [
    [0, 1, 1, 1], [9, 5, 9, 12], [17, 7, 17, 23], [25, 10, 25, 36], [33, 12, 33, 51], [41, 15, 41, 65],
    [49, 17, 49, 77], [57, 17, 57, 88], [65, 17, 65, 95], [73, 17, 73, 102], [81, 21, 81, 109],
    [89, 26, 89, 117], [97, 31, 97, 125], [106, 35, 106, 132], [114, 41, 114, 140], [122, 49, 122, 148],
    [130, 55, 130, 155], [138, 62, 138, 162], [146, 69, 146, 169], [154, 75, 154, 177], [162, 81, 162, 183],
    [169, 91, 169, 194], [177, 100, 177, 203], [185, 108, 185, 211], [193, 114, 193, 219], [202, 123, 202, 225],
    [210, 130, 210, 232], [218, 138, 218, 240], [226, 145, 226, 246], [234, 154, 234, 251], [242, 169, 242, 254],
    [249, 175, 249, 255], [255, 178, 255, 255]
  ];
  const RAMP2_CMIN = 0.167;   // least-saturated channel ratio in the ramp's mid tones (its pure hue)
  function lookup(table, i) {
    let k = 0; while (k < table.length - 2 && table[k + 1][0] < i) k++;
    const a = table[k], b = table[k + 1], f = Math.max(0, Math.min(1, (i - a[0]) / (b[0] - a[0])));
    return [0, 1, 2].map(c => a[c + 1] + (b[c + 1] - a[c + 1]) * f);
  }
  // level 0..255 -> [R, G, B]
  // hl scales the white-hot highlights: 1 = like the clips, 0 = flat duotone (black up to the pure colour).
  // The flat duotone also deepens the darks (contrast curve), so the colour sits on black like a two-tone design.
  const duoGamma = (hl, contrast) => 1 + ((contrast == null ? 1.8 : contrast) - 1) * (1 - hl);
  function rampAt(i, base, pattern, hl, contrast) {
    if (hl === undefined) hl = 1;
    const gm = duoGamma(hl, contrast);
    if (pattern === 'glitch') {
      const m0 = lookup(RAMP2, i);
      if (!base) return m0;
      // keep the measured ramp's brightness and how far it whitens, swap the hue
      const V = Math.max(m0[0], m0[1], m0[2]) / 255, mn = Math.min(m0[0], m0[1], m0[2]) / Math.max(1, m0[0], m0[1], m0[2]);
      const w = hl * Math.max(0, Math.min(1, (mn - RAMP2_CMIN) / (1 - RAMP2_CMIN)));
      const m = Math.max(base[0], base[1], base[2], 1);
      return base.map(c => 255 * Math.pow(V, gm) * (c / m + (1 - c / m) * w));
    }
    if (!base) return lookup(RAMP, i);
    const x = i / 255, m = Math.max(base[0], base[1], base[2], 1), w = hl * whiteMix(x);
    return base.map(c => 255 * Math.pow(x, gm) * (c / m + (1 - c / m) * w));
  }
  function buildLut(color, background, floor, pattern, hl, contrast) {
    const base = parseHex(color), bg = parseHex(background);
    const rampAt0 = (i, b) => rampAt(i, b, pattern, hl, contrast);
    const atFloor = rampAt0(Math.round(floor * 255), base);
    const data = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      let rgb = rampAt0(i, base);
      if (bg) {
        // swap the dark end of the ramp for the chosen backdrop, fading out toward the mid tones
        let k = Math.max(0, Math.min(1, 1 - (i / 255 - floor) / 0.35)); k *= k;
        rgb = rgb.map((c, j) => c + (bg[j] - atFloor[j]) * k);
      }
      for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.max(0, Math.min(255, Math.round(rgb[c])));
      data[i * 4 + 3] = 255;
    }
    return data;
  }

  const VS = `#version 300 es
layout(location = 0) in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

  const FS_FIELD = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform float uUnit, uTime;
uniform float uPeriod, uN, uD0, uDref, uSref, uH, uL, uW, uDelta, uNb, uBf, uFadeA, uFadeW, uFog;
uniform float uDens, uMu, uWin, uC;
out vec4 o;

float field(vec2 q){
  float rays = 0.0;
  float ph = fract(uTime / uPeriod);
  float kmin = 1.0 - uDens;
  // keep the horizontal axis lit like the rows just beside it (the clip has no dark line there)
  q = max(q, vec2(1e-3, 1.5));
  float umax = 1.5707 / uDelta;
  for (int k = 0; k < 14; k++) {
    float D = float(k) + ph + uD0;                  // depth of this layer now
    float s = uSref * pow(D / uDref, -uN);           // its scale
    float ka = max(kmin, uH * s / q.y);              // part of the gather segment inside the row
    float kb = min(1.0, (uH + uL) * s / q.y);
    if (ka >= kb) continue;
    float e0 = clamp((D - uFadeA) / uFadeW, 0.0, 1.0) * pow(D / uDref, -uFog);
    float uLo = atan(uDelta * q.x * ka / s) / uDelta, uHi = atan(uDelta * q.x * kb / s) / uDelta;
    float i0 = max(0.0, floor(uLo - uC - 0.5 * uW));
    float kx = s / (uDelta * q.x);
    for (int j = 0; j < 24; j++) {
      float i = i0 + float(j);
      float c0 = i + uC - 0.5 * uW, c1 = i + uC + 0.5 * uW;
      if (c0 > uHi || i >= uNb || c0 >= umax) break;
      float k0 = max(ka, kx * tan(uDelta * c0));
      float k1 = c1 >= umax ? kb : min(kb, kx * tan(uDelta * c1));
      if (k0 >= k1) continue;
      float A1 = exp(uMu * (k1 - 1.0)), A0 = exp(uMu * (k0 - 1.0));
      float I = (A1 * ((k1 - kmin) - 1.0 / uMu) - A0 * ((k0 - kmin) - 1.0 / uMu)) / (1.0 - kmin);
      rays += e0 * pow(cos(uDelta * (i + uC)), uBf) * mix(A1 - A0, I, uWin);
    }
  }
  return rays;
}

void main(){
  vec2 c = (gl_FragCoord.xy - 0.5 * uRes) * uUnit;   // pixels of a 500 px frame
  o = vec4(field(abs(c)), 0.0, 0.0, 1.0);
}`;

  const FS_BLUR = `#version 300 es
precision highp float;
uniform vec2 uRes, uDir; uniform float uSigma;
uniform sampler2D uSrc;
out vec4 o;
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float acc = 0.0, wsum = 0.0;
  for (int i = -8; i <= 8; i++) {
    float w = exp(-4.5 * float(i * i) / 64.0);
    acc += w * texture(uSrc, uv + uDir * (float(i) * uSigma / 3.0) / uRes).r; wsum += w;
  }
  o = vec4(acc / wsum, 0.0, 0.0, 1.0);
}`;

  const FS_OUT = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform float uGrainT, uGainR, uBloom, uBloom2, uFloor, uGrain, uCell;
uniform sampler2D uF, uB1, uB2, uLut;
out vec4 o;
float hash(vec3 p){ p = fract(p * vec3(443.897, 441.423, 437.195)); p += dot(p, p.yzx + 19.19); return fract((p.x + p.y) * p.z); }
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float F = uGainR * texture(uF, uv).r + uBloom * texture(uB1, uv).r + uBloom2 * texture(uB2, uv).r;
  float v = uFloor + (1.0 - uFloor) * (1.0 - exp(-F));
  float fr = floor(uGrainT * 30.0 + 0.001);
  vec2 gp = floor(gl_FragCoord.xy / uCell);
  float n = (hash(vec3(gp, fr)) + hash(vec3(gp + 17.0, fr + 3.0)) + hash(vec3(gp + 41.0, fr + 7.0)) - 1.5) * 2.0;
  v += uGrain * n * (0.015 + 0.025 * smoothstep(0.0, 0.5, v));
  v = clamp(v, 0.0, 1.0);
  o = vec4(texture(uLut, vec2(v * (255.0 / 256.0) + 0.5 / 256.0, 0.5)).rgb, 1.0);
}`;

  // ---- glitch pattern: redraw traced cells as vertical stripes
  // cell grid in the clip's 500 px frame: pitch 3.495 px, first stripe centre x = 1.857, first row centre y = 3.29
  const FS_GLITCH = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform float uUnit, uAA, uGrain, uGrainT, uCell;
uniform ivec2 uTile, uTileM2, uTileM1, uTileP1, uTileP2;   // this frame, and the frames used for side strips
uniform float uExpand;          // 1 = wider than square: extend the block wall sideways
uniform vec4 uHudRect;          // static readout: x, y, w, h in the clip's pixels
uniform sampler2D uAtlas, uLut, uHud;
out vec4 o;
const float P = 3.495, X0 = 1.857, Y0 = 3.29;
// Cell k (column, may run past the clip's 143) and j (row). The clip's blocks sit in columns 11-131.
// For wide frames, columns outside the clip are filled with 122-column strips (columns 10-131)
// cut from frames 19 apart, so the wall continues with the clip's own blocks and timing.
float cellAt(int k, int j){
  if (j < 0 || j > 142) return 0.0;
  ivec2 tile = uTile;
  if (uExpand > 0.5) {
    int b = int(floor(float(k - 10) / 122.0));
    if (b < -2 || b > 2) return 0.0;
    k -= 122 * b;
    tile = b == -2 ? uTileM2 : b == -1 ? uTileM1 : b == 1 ? uTileP1 : b == 2 ? uTileP2 : uTile;
  } else if (k < 0 || k > 142) return 0.0;
  return texelFetch(uAtlas, tile + ivec2(k, j), 0).r * 255.0;
}
// a column's level at row coordinate v, interpolated between row centres (uSharp > 1 makes the
// step between rows steeper, like the clip's crisp block edges)
uniform float uSharp;
float column(int k, float v){
  float j0 = floor(v);
  float f = clamp((v - j0 - 0.5) * uSharp + 0.5, 0.0, 1.0);
  return mix(cellAt(k, int(j0)), cellAt(k, int(j0) + 1), f);
}
uniform float uEdge, uSoft, uGlowK, uNbr, uNbrY, uD0, uD1;
// glow level around column k: weighted mean of the cells nearby (7 columns x 5 rows)
float glowAt(int k, float v){
  float acc = 0.0, wsum = 0.0;
  for (int dk = -3; dk <= 3; dk++) {
    float wk = pow(uNbr, abs(float(dk)));
    for (int dj = -2; dj <= 2; dj++) {
      float w = wk * pow(uNbrY, abs(float(dj)));
      acc += w * column(k + dk, v + float(dj)); wsum += w;
    }
  }
  return acc / wsum;
}
float hash(vec3 p){ p = fract(p * vec3(443.897, 441.423, 437.195)); p += dot(p, p.yzx + 19.19); return fract((p.x + p.y) * p.z); }
void main(){
  vec2 c = (gl_FragCoord.xy - 0.5 * uRes) * uUnit;
  vec2 s = vec2(250.0 + c.x, 250.0 - c.y);          // the clip's pixel coordinates
  float u = (s.x - X0) / P, v = (s.y - Y0) / P;
  float kf = floor(u + 0.5), ph = u - kf, a = abs(ph);
  int k = int(kf), k2 = k + (ph >= 0.0 ? 1 : -1);
  float Lk = column(k, v);
  float B = mix(Lk, column(k2, v), smoothstep(0.0, 1.0, a));   // flat level (dim glow areas have no stripes)
  // bright cells are near-square stripes (~57% lit); the gap between stripes shows the local glow
  float S = smoothstep(uEdge + uSoft, uEdge - uSoft, a);
  S = mix(uEdge * 2.0, S, uAA);                                   // fade to the duty cycle when stripes get too fine
  float O = min(B, uGlowK * glowAt(k, v));
  float striped = S * Lk + (1.0 - S) * O;
  float val = mix(B, striped, smoothstep(uD0, uD1, Lk)) / 255.0;
  // the readout in the bottom-right corner never changes and no block reaches it: draw it as captured
  vec2 hp = (s - uHudRect.xy) / uHudRect.zw;
  if (uHudRect.z > 0.0 && all(greaterThanEqual(hp, vec2(0.0))) && all(lessThan(hp, vec2(1.0)))) val = texture(uHud, hp).r;
  if (uGrain > 0.0) {
    vec2 gp = floor(gl_FragCoord.xy / uCell); float fr = floor(uGrainT * 30.0 + 0.001);
    float n = (hash(vec3(gp, fr)) + hash(vec3(gp + 17.0, fr + 3.0)) + hash(vec3(gp + 41.0, fr + 7.0)) - 1.5) * 2.0;
    val += uGrain * n * (0.006 + 0.02 * smoothstep(0.0, 0.5, val));
  }
  val = clamp(val, 0.0, 1.0);
  o = vec4(texture(uLut, vec2(val * (255.0 / 256.0) + 0.5 / 256.0, 0.5)).rgb, 1.0);
}`;
  const GLITCH_FLOOR = 0.004;   // the glitch clip's background level

  // ---- hero pattern: the clip itself (hero-video.js), framed, recoloured and backed here
  const FS_HERO = `#version 300 es
precision highp float;
uniform vec2 uRes, uVid; uniform float uScale;
uniform float uRecolor;         // 0 = the clip's own colours
uniform vec2 uRefDir, uTgtDir;  // YIQ chroma directions: the clip's average tint, and the chosen colour
uniform float uSat;             // saturation relative to the clip
uniform vec3 uTgt;              // the chosen colour (0..1)
uniform float uHighlight;       // 1 = keep the clip's tones, 0 = flat duotone: black up to the pure colour
uniform float uDuoGamma;        // flat duotone contrast curve
uniform vec3 uBg;               // backdrop added under the dark tones (0 = the clip's black)
uniform sampler2D uVideo;
out vec4 o;
void main(){
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uScale;          // clip pixels from the centre
  vec2 uv = vec2(p.x / uVid.x + 0.5, 0.5 - p.y / uVid.y);
  vec3 c = vec3(0.0);
  if (all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)))) c = texture(uVideo, uv).rgb;
  if (uRecolor > 0.5) {
    // YIQ: keep brightness; map each hue's offset from the clip's tint onto the chosen colour.
    // Hues opposite the tint (the warm hot bars) fold onto it too, so highlights stay in the family.
    float y = dot(c, vec3(0.299, 0.587, 0.114));
    vec2 iq = vec2(dot(c, vec3(0.595716, -0.274453, -0.321263)), dot(c, vec3(0.211456, -0.522591, 0.311135)));
    float par = abs(dot(iq, uRefDir)), perp = dot(iq, vec2(-uRefDir.y, uRefDir.x));
    iq = uSat * (par * uTgtDir + perp * vec2(-uTgtDir.y, uTgtDir.x));
    vec3 toned = vec3(y + 0.9563 * iq.x + 0.621 * iq.y, y - 0.2721 * iq.x - 0.6474 * iq.y, y - 1.107 * iq.x + 1.7046 * iq.y);
    vec3 duo = uTgt * pow(clamp(y / 0.62, 0.0, 1.0), uDuoGamma);   // the clip's brightest stripes (luma ~0.6+) reach the full colour
    c = mix(duo, toned, uHighlight);
  }
  c = clamp(c, 0.0, 1.0);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c += uBg * (1.0 - smoothstep(0.0, 0.3, l));
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;
  // the clip's average tint in YIQ (measured: angle -141.9 deg, chroma/luma 0.352) and how to reach `color`
  const HERO_REF_ANGLE = -141.9 * Math.PI / 180, HERO_REF_SAT = 0.352;
  function heroRecolor(color) {
    const c = parseHex(color);
    if (!c) return null;
    const [r, g, b] = c.map((v) => v / 255);
    const Y = 0.299 * r + 0.587 * g + 0.114 * b, I = 0.595716 * r - 0.274453 * g - 0.321263 * b, Q = 0.211456 * r - 0.522591 * g + 0.311135 * b;
    const chroma = Math.hypot(I, Q), a = chroma > 1e-4 ? Math.atan2(Q, I) : HERO_REF_ANGLE;
    return { ref: [Math.cos(HERO_REF_ANGLE), Math.sin(HERO_REF_ANGLE)], tgt: [Math.cos(a), Math.sin(a)],
             sat: Math.min(1.4, (chroma / Math.max(Y, 1e-3)) / HERO_REF_SAT) };
  }
  // one blob URL for the embedded clip, shared by every renderer on the page
  function heroUrl() {
    const D = global.BEAM_LOOP_HERO;
    if (!D) return null;
    if (!D._url) {
      const bin = atob(D.data), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      D._url = URL.createObjectURL(new Blob([bytes], { type: D.type || 'video/mp4' }));
    }
    return D._url;
  }

  // ---- glyph pattern: the GLYPH_FIELD hover matrix (ported from glyph-field-original.html)
  // Glyphs climb a density ladder (dot > slash > plus > x > square > ring > target > blob > solid) where
  // drifting noise, the pointer, click ripples and a scanner add heat. Drawn with Canvas 2D in white on
  // black, then coloured by the shader, so every colour option applies. Changes from the original so it
  // can be exported and looped: one seeded random source (the same layout every time), fixed 60 Hz
  // simulation steps (the same motion at any frame rate), and a 34 s idle cycle (ghost cursor, noise
  // drift and scanner all repeat), so a one-loop export is seamless.
  const GLYPH_LOOP = 34, GLYPH_COLOR = '#d0ef0e';
  const GLYPH_CURSORS = ['bracket', 'crosshair', 'reticle', 'block', 'trail', 'lens', 'dot', 'system'];
  function mulberry32(a) {
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let q = Math.imul(a ^ a >>> 15, 1 | a); q = q + Math.imul(q ^ q >>> 7, 61 | q) ^ q; return ((q ^ q >>> 14) >>> 0) / 4294967296; };
  }
  function createGlyphField(seedValue, getFloor, getHover) {
    const CELL = 40, h = CELL / 2, MAX = 10, STEP = 1 / 60, FG = '#fff', BG = '#000';
    let H = 1080, floorLv = null;   // [Ultra.sh] logical height follows glyphScale; per-cell density floor
    const NAMES = ['NULL', 'DOT', 'SLSH', 'PLUS', 'XS', 'X', 'SQR', 'RING', 'TGT', 'BLOB', 'FILL'];
    const MONO = '500 12px ui-monospace,SFMono-Regular,Menlo,monospace';
    const pad = (n, l) => String(Math.max(0, Math.round(n))).padStart(l, '0');
    const hex = (n) => '0x' + n.toString(16).toUpperCase().padStart(3, '0');
    const SEED = '0x' + (seedValue & 0xffff).toString(16).toUpperCase().padStart(4, '0');
    let W = 0, COLS = 0, ROWS = 0, N = 0;
    let Pm, blocks, val, heat, solid, seed, rowShift, rowTTL, ripples, t = 0, mm, activeCount = 0, scanY = -999, hist = [];
    // row glitches and edge flicker come from a hash of the step's place in the 34 s cycle (not a running
    // random stream), so the loop repeats exactly
    const LOOP_STEPS = GLYPH_LOOP * 60;
    const stepNo = () => ((Math.round(t / STEP) % LOOP_STEPS) + LOOP_STEPS) % LOOP_STEPS;
    function h3(a, b, c) {
      let x = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 1274126177) + seedValue) | 0;
      x = Math.imul(x ^ (x >>> 13), 1274126177); x ^= x >>> 16;
      return (x >>> 0) / 4294967296;
    }

    // value noise (as the original)
    const hashN = (x, y) => Pm[(Pm[x & 255] + y) & 511] / 255;
    const sm = (q) => q * q * (3 - 2 * q);
    function noise(x, y) {
      const xi = Math.floor(x), yi = Math.floor(y), xf = sm(x - xi), yf = sm(y - yi);
      const a = hashN(xi, yi), b = hashN(xi + 1, yi), c = hashN(xi, yi + 1), d = hashN(xi + 1, yi + 1);
      return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
    }
    const fbm = (x, y) => noise(x, y) * .62 + noise(x * 2.1, y * 2.1) * .28 + noise(x * 4.3, y * 4.3) * .1;

    // the 34 s cycle: ghost cursor (the original's 0.37 / 0.53 rad/s, rounded to whole cycles), noise drift
    // (the original's speed and starting direction, on a closed path) and four scanner sweeps
    const OM = 2 * Math.PI / GLYPH_LOOP;
    const idlePos = (tt) => [W * (.5 + .32 * Math.sin(tt * 2 * OM)), H * (.5 + .28 * Math.sin(tt * 3 * OM + 1))];
    function drift(tt) {
      const rho = 0.0466 / OM, s = Math.sin(OM * tt), c = 1 - Math.cos(OM * tt);
      return [rho * (s * 0.857 + c * 0.514), rho * (-s * 0.514 + c * 0.857)];
    }
    const scanAt = (tt) => ((((tt * 4 / GLYPH_LOOP) % 1) + 1) % 1) * (H + 240) - 120;

    function reset(width, t0, lh) {
      H = lh || 1080;
      W = width; COLS = Math.ceil(W / CELL); ROWS = Math.ceil(H / CELL); N = COLS * ROWS;
      const rnd = mulberry32(seedValue);
      Pm = new Uint8Array(512); const p = [...Array(256).keys()];
      for (let i = 255; i > 0; i--) { const j = rnd() * (i + 1) | 0; [p[i], p[j]] = [p[j], p[i]]; }
      for (let i = 0; i < 512; i++) Pm[i] = p[i & 255];
      const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
      blocks = [];
      for (let i = 0; i < 6; i++) { const w = ri(2, 7), bh = ri(2, 5); blocks.push({ x: ri(0, COLS - w), y: ri(0, ROWS - bh), w, h: bh }); }
      val = new Float32Array(N); heat = new Float32Array(N); solid = new Uint8Array(N); seed = new Float32Array(N);
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        solid[i] = blocks.some((b) => c >= b.x && c < b.x + b.w && r >= b.y && r < b.y + b.h) ? 1 : 0;
        seed[i] = rnd();
      }
      // [Ultra.sh] per-cell density floor
      floorLv = new Float32Array(N);
      const ff = getFloor && getFloor();
      if (typeof ff === 'function') {
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
          const i = r * COLS + c; floorLv[i] = Math.min(MAX, Math.max(0, +ff(c, r, COLS, ROWS, seed[i]) || 0));
        }
      }
      rowShift = new Float32Array(ROWS); rowTTL = new Float32Array(ROWS); ripples = []; hist = [];
      mm = { px: -999, py: -999, speed: 0 };
      // start 2 s early so the first frame already shows a settled field
      t = t0 - 2;
      for (let k = 0; k < 120; k++) step({ in: false }, false);
    }

    function step(input, reduce) {
      const dt = STEP; t += dt;
      let ax = input.x, ay = input.y;
      if (!input.in) [ax, ay] = idlePos(t);
      const vx = ax - mm.px, vy = ay - mm.py; mm.speed += (Math.hypot(vx, vy) - mm.speed) * .15; mm.px = ax; mm.py = ay;
      // [Ultra.sh] the pointer's heat radius grows with the logical frame (smaller cells) and glyphHover,
      // so the hover reads at the same on-screen size as in the original tool
      const hk = input.in ? (H / 1080) * ((getHover && getHover()) || 1) : 1;
      const R = (150 + Math.min(mm.speed, 60) * 2.2) * hk, strength = input.in ? 1 : .45;
      for (const q of ripples) q.r += 900 * dt;
      while (ripples.length && ripples[0].r > 2400) ripples.shift();
      scanY = reduce ? -999 : scanAt(t);
      for (let r = 0; r < ROWS; r++) if (rowTTL[r] > 0) { rowTTL[r] -= dt; if (rowTTL[r] <= 0) rowShift[r] = 0; }
      const sn = stepNo();
      if (!reduce && h3(sn, 1, 0) < dt * 1.1) {
        const r = h3(sn, 2, 0) * ROWS | 0;
        rowShift[r] = (h3(sn, 3, 0) < .5 ? -1 : 1) * (1 + (h3(sn, 4, 0) * 3 | 0)) * CELL; rowTTL[r] = .08 + h3(sn, 5, 0) * .12;
      }
      const [dx, dy] = reduce ? [0, 0] : drift(t);
      let count = 0;
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c, cx = c * CELL + h, cy = r * CELL + h;
        const sd = Math.abs(cy - scanY); if (sd < CELL * 1.5) heat[i] = Math.max(heat[i], .32 * (1 - sd / (CELL * 1.5)));
        if (heat[i] > .05) count++;
        let base = solid[i] ? MAX : Math.max(0, (fbm(c * .075 + dx, r * .075 + dy) - .3) * 16);
        if (!solid[i] && floorLv && floorLv[i] > base) base = floorLv[i];   // [Ultra.sh] density floor
        if (base < 1.2 && seed[i] > .86) base = 1;   // scattered dots in the voids
        const d0 = Math.hypot(cx - ax, cy - ay);
        if (d0 < R) { const f = 1 - d0 / R; heat[i] = Math.max(heat[i], f * f * (3 - 2 * f) * strength); }
        for (const q of ripples) { const d = Math.abs(Math.hypot(cx - q.x, cy - q.y) - q.r); if (d < 70) heat[i] = Math.max(heat[i], (1 - d / 70) * Math.max(0, 1 - q.r / 2400)); }
        heat[i] *= reduce ? .85 : .955;
        // solids "crack open" under the cursor, everything else densifies
        const target = solid[i] ? MAX - heat[i] * 7 : base + heat[i] * (MAX + 1 - base * .4);
        val[i] += (target - val[i]) * (reduce ? 1 : .18);
      }
      activeCount = count;
      hist.push(count); if (hist.length > 90) hist.shift();
    }

    // advance to time tt (seconds); a jump back or far ahead restarts from a settled field
    function stepTo(tt, input, reduce, width, lh) {
      lh = lh || 1080;
      if (width !== W || lh !== H || !val || tt < t - 1e-6 || tt - t > 5) reset(width, tt, lh);
      while (t + STEP <= tt + 1e-6) step(input, reduce);
    }
    function ripple(x, y) { ripples.push({ x, y, r: 0 }); }

    // ---- drawing (logical 1080 px tall space; s = device pixels per logical pixel)
    let ctx = null;
    function line(a, b, c, d, w) { ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke(); }
    function ring(x, y, r, w) { ctx.lineWidth = w; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke(); }
    function rr(x, y, w, hh, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, hh, r); else ctx.rect(x, y, w, hh); }
    function blob(cx, cy) {   // four-lobed cross with a punched centre
      ctx.beginPath();
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { ctx.moveTo(cx + dx * 7 + 5, cy + dy * 7); ctx.arc(cx + dx * 7, cy + dy * 7, 5.5, 0, 7); }
      ctx.fill(); ctx.fillRect(cx - 6, cy - 6, 12, 12);
      const fs = ctx.fillStyle; ctx.fillStyle = BG; ctx.beginPath(); ctx.arc(cx, cy, 3.2, 0, 7); ctx.fill(); ctx.fillStyle = fs;
    }
    // [Ultra.sh] crisp glyphs at small cells: SC = device px per logical px. Glyph centres and line ends sit on
    // the device-pixel grid, strokes are whole device pixels (at least 1), odd-width straight strokes are
    // offset half a pixel; without this a 2-unit stroke at 16px cells is 0.8 px wide and smears.
    let SC = 1, TK = 1;   // TK: text scale for the cursor's tags and readout (set per frame, 1 for the HUD)
    const snap = (v) => Math.round(v * SC) / SC;
    const lwPx = (w) => Math.max(1, Math.round(w * SC)) / SC;
    const halfIfOdd = (w) => (Math.round(w * SC) % 2 ? 0.5 / SC : 0);
    function glyph(L, x, y) {
      const cx = snap(x + h), cy = snap(y + h);
      switch (L) {
        case 1: { const d = Math.max(2, Math.round(4 * SC)) / SC; ctx.fillRect(snap(cx - d / 2), snap(cy - d / 2), d, d); break; }
        case 2: line(snap(cx - 6), snap(cy - 6), snap(cx + 6), snap(cy + 6), lwPx(2)); break;
        case 3: { const w = lwPx(2.4), o = halfIfOdd(w); line(snap(cx - 8), cy + o, snap(cx + 8), cy + o, w); line(cx + o, snap(cy - 8), cx + o, snap(cy + 8), w); break; }
        case 4: { const w = lwPx(2.4); line(snap(cx - 7), snap(cy - 7), snap(cx + 7), snap(cy + 7), w); line(snap(cx + 7), snap(cy - 7), snap(cx - 7), snap(cy + 7), w); break; }
        case 5: { const w = lwPx(5); line(snap(cx - 11), snap(cy - 11), snap(cx + 11), snap(cy + 11), w); line(snap(cx + 11), snap(cy - 11), snap(cx - 11), snap(cy + 11), w); break; }
        case 6: { const w = lwPx(5), o = halfIfOdd(w); ctx.lineWidth = w; rr(snap(cx - 11) + o, snap(cy - 11) + o, snap(22), snap(22), 4); ctx.stroke(); break; }
        case 7: ring(cx, cy, 12, lwPx(4)); ctx.beginPath(); ctx.arc(cx, cy, 4.5, 0, 7); ctx.fill(); break;
        case 8: { const w = lwPx(3.4); ring(cx, cy, 13, w); ring(cx, cy, 6.5, w); break; }
        case 9: blob(cx, cy); break;
        case 10: ctx.fillRect(x, y, CELL + .5, CELL + .5); break;
      }
    }
    const monoK = () => (TK === 1 ? MONO : `500 ${(12 * TK).toFixed(2)}px ui-monospace,SFMono-Regular,Menlo,monospace`);
    function tag(s, x, y, inv, align) {
      ctx.font = monoK(); ctx.textBaseline = 'middle'; const w = ctx.measureText(s).width + 10 * TK;
      if (align === 'r') x -= w; if (align === 'c') x -= w / 2;
      ctx.fillStyle = inv ? FG : BG; ctx.fillRect(x, y - 9 * TK, w, 18 * TK);
      ctx.fillStyle = inv ? BG : FG; ctx.fillText(s, x + 5 * TK, y + .5); return w;
    }
    function hud(pointer, fps, style) {
      ctx.save(); ctx.fillStyle = FG; ctx.strokeStyle = FG; ctx.lineWidth = 1;
      for (let c = 0; c <= COLS; c++) { const x = c * CELL, L = c % 5 ? 5 : 12; ctx.fillRect(x, 0, 1, L); ctx.fillRect(x, H - L, 1, L); }
      for (let r = 0; r <= ROWS; r++) { const y = r * CELL, L = r % 5 ? 5 : 12; ctx.fillRect(0, y, L, 1); ctx.fillRect(W - L, y, L, 1); }
      for (let c = 5; c < COLS; c += 5) tag(pad(c, 2), c * CELL + 3, 22);
      for (let r = 5; r < ROWS; r += 5) tag(pad(r, 2), 16, r * CELL + 12);
      const k = 30, o = 14; ctx.lineWidth = 2; ctx.beginPath();
      for (const [ux, uy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const X = ux ? W - o : o, Y = uy ? H - o : o, dx = ux ? -1 : 1, dy = uy ? -1 : 1; ctx.moveTo(X + dx * k, Y); ctx.lineTo(X, Y); ctx.lineTo(X, Y + dy * k); }
      ctx.stroke(); ctx.lineWidth = 1;
      tag(`GLYPH_FIELD // ${Math.round(W)}×${H} // ${COLS}×${ROWS} @ ${CELL}PX`, 52, 52, true);
      const tt = Math.max(0, t), sec = tt | 0, fr = ((tt % 1) * 60) | 0;
      tag(`T+${pad(sec / 3600, 2)}:${pad((sec / 60) % 60, 2)}:${pad(sec % 60, 2)}:${pad(fr, 2)}`, W - 52, 52, true, 'r');
      tag(`${pad(fps, 2)} FPS  SEED ${SEED}`, W - 52, 74, false, 'r');
      blocks.forEach((b, j) => tag(`B${pad(j, 2)} ${b.w}×${b.h}`, b.x * CELL + 6, b.y * CELL + 15, true));
      if (scanY > -100 && scanY < H + 100) { ctx.globalAlpha = .8; ctx.fillRect(0, scanY, W, 1); ctx.globalAlpha = 1; tag(`SCAN Y${pad(Math.max(0, scanY), 4)}`, W - 52, scanY, true, 'r'); }
      ctx.setLineDash([4, 6]);
      ripples.forEach((q, j) => {
        const a = Math.max(0, 1 - q.r / 2400); ctx.globalAlpha = a * .7; ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 7); ctx.stroke();
        ctx.globalAlpha = a; if (q.x + q.r < W - 60) tag(`PING ${pad(j, 2)} R${pad(q.r, 4)}`, q.x + q.r + 8, q.y);
      });
      ctx.globalAlpha = 1;
      // dashed guides through the pointer's cell (the crosshair, dot and system cursors go without)
      if (pointer.in && !['crosshair', 'dot', 'system'].includes(style)) {
        const cx = Math.floor(pointer.x / CELL) * CELL + h, cy = Math.floor(pointer.y / CELL) * CELL + h;
        ctx.globalAlpha = .45; ctx.beginPath(); ctx.moveTo(cx, 30); ctx.lineTo(cx, H - 30); ctx.moveTo(30, cy); ctx.lineTo(W - 30, cy); ctx.stroke(); ctx.globalAlpha = 1;
        tag(`X${pad(pointer.x, 4)}`, cx, H - 30, true, 'c'); tag(`Y${pad(pointer.y, 4)}`, W - 30, cy, true, 'r');
      }
      ctx.setLineDash([]);
      const load = activeCount / (COLS * ROWS), SEG = 16, sw = 9, sg = 4, mw = SEG * (sw + sg) - sg, mx = W - 52 - mw, my = H - 96;
      ctx.fillStyle = BG; ctx.fillRect(mx - 6, my - 6, mw + 12, sw + 12);
      ctx.fillStyle = FG; ctx.strokeStyle = FG;
      for (let j = 0; j < SEG; j++) { const x = mx + j * (sw + sg); if (j < Math.round(load * SEG)) ctx.fillRect(x, my, sw, sw); else ctx.strokeRect(x + .5, my + .5, sw - 1, sw - 1); }
      const w2 = tag(`LOAD ${(load * 100).toFixed(1).padStart(4, '0')}%`, W - 52, H - 62, true, 'r');
      tag(`ACTIVE ${pad(activeCount, 4)}/${COLS * ROWS}`, W - 52 - w2 - 6, H - 62, false, 'r');
      ctx.restore();
    }
    // glow buffers (device pixels)
    const mkc = () => document.createElement('canvas');
    const src = mkc(), b1 = mkc(), b2 = mkc();
    function bloom(main, source, dw, dh, s, o) {
      const sz = (c, w, hh) => { if (c.width !== w || c.height !== hh) { c.width = w; c.height = hh; } return c.getContext('2d'); };
      const b1x = sz(b1, Math.max(1, dw / 2 | 0), Math.max(1, dh / 2 | 0)), b2x = sz(b2, Math.max(1, dw / 8 | 0), Math.max(1, dh / 8 | 0));
      b1x.clearRect(0, 0, b1.width, b1.height); b2x.clearRect(0, 0, b2.width, b2.height);
      if ('filter' in b1x) b1x.filter = `blur(${o.glowRad / 4 * s}px)`;
      b1x.drawImage(source, 0, 0, b1.width, b1.height);
      if ('filter' in b2x) b2x.filter = `blur(${o.glowRad / 6 * s}px)`;
      b2x.drawImage(source, 0, 0, b2.width, b2.height);
      main.save(); main.setTransform(1, 0, 0, 1, 0, 0); main.globalCompositeOperation = 'lighter'; main.imageSmoothingEnabled = true;
      main.globalAlpha = Math.min(1, o.glowAmt * (o.glowNear == null ? .55 : o.glowNear)); main.drawImage(b1, 0, 0, dw, dh);
      main.globalAlpha = Math.min(1, o.glowAmt * .45); main.drawImage(b2, 0, 0, dw, dh);
      if (o.glowAmt > 1) { main.globalAlpha = (o.glowAmt - 1) * .4; main.drawImage(b2, 0, 0, dw, dh); }
      main.restore();
    }

    // o: { glow, glowMode, glowAmt, glowRad, hud, fps, pointer, speed }
    function draw(main, s, o) {
      const dw = main.canvas.width, dh = main.canvas.height, pointer = o.pointer;
      const hoverGlow = o.glow && o.glowMode === 'hover';
      let sctx = null;
      if (hoverGlow) {
        if (src.width !== dw || src.height !== dh) { src.width = dw; src.height = dh; }
        sctx = src.getContext('2d'); sctx.setTransform(1, 0, 0, 1, 0, 0); sctx.clearRect(0, 0, dw, dh);
        sctx.setTransform(s, 0, 0, s, 0, 0); sctx.fillStyle = FG; sctx.strokeStyle = FG; sctx.lineCap = 'square';
      }
      ctx = main; main.setTransform(s, 0, 0, s, 0, 0); SC = s; TK = 1;
      main.fillStyle = BG; main.fillRect(0, 0, W, H);
      main.fillStyle = FG; main.strokeStyle = FG; main.lineCap = 'square';
      const sn = stepNo();
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c, x = c * CELL + rowShift[r], y = r * CELL;
        let L = Math.round(Math.min(MAX, Math.max(0, val[i])));
        // flicker at the edge of the hot zone
        if (heat[i] > .08 && heat[i] < .35 && h3(sn, i, 6) < .04) L = Math.max(1, L - 1 - (h3(sn, i, 7) * 3 | 0));
        if (L) {
          glyph(L, x, y);
          if (sctx && heat[i] > .03) { ctx = sctx; sctx.globalAlpha = Math.min(1, heat[i] * 1.8); glyph(L, x, y); ctx = main; }
        }
      }
      if (o.glow) bloom(main, hoverGlow ? src : main.canvas, dw, dh, s, o);
      main.setTransform(s, 0, 0, s, 0, 0);
      const style = GLYPH_CURSORS.includes(o.cursor) ? o.cursor : 'bracket';
      if (o.hud) hud(pointer, o.fps, style);
      if (pointer.in) { TK = o.textK || 1; drawCursor(main, s, style, o.readout !== false, pointer); TK = 1; }
      else trail.length = 0;
    }
    // ---- cursors (o.cursor): drawn in the field's own pixels; 'system' leaves the OS arrow instead
    const trail = [];   // recent cells under the pointer, for the 'trail' cursor (real time, not the loop)
    function corners(x0, y0, w, hh, k, lw) {
      ctx.lineWidth = lw; ctx.beginPath();
      for (const [ux, uy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const X = x0 + ux * w, Y = y0 + uy * hh, dx = ux ? -1 : 1, dy = uy ? -1 : 1;
        ctx.moveTo(X + dx * k, Y); ctx.lineTo(X, Y); ctx.lineTo(X, Y + dy * k);
      }
      ctx.stroke();
    }
    // the cell's data in a box beside the area (ax, ay, span), joined by a leader
    function readout(sx, sy, ax, ay, span) {
      const c = sx / CELL, r = sy / CELL, i = r * COLS + c, L = Math.round(Math.min(MAX, Math.max(0, val[i] || 0)));
      const lines = [`C${pad(c, 2)} R${pad(r, 2)}`, `${hex(Math.max(0, i))} ${NAMES[L]}`, `HEAT ${(heat[i] || 0).toFixed(2)}`, `VEL  ${mm.speed.toFixed(1).padStart(4, '0')}`];
      ctx.font = monoK(); ctx.textBaseline = 'top';
      const bw = 132 * TK, bh = (lines.length * 17 + 12) * TK;
      let tx = ax + span + 16, ty = ay + span + 12; if (tx + bw > W - 30) tx = ax - bw - 16; if (ty + bh > H - 30) ty = ay - bh - 12;
      ctx.fillStyle = BG; ctx.fillRect(tx, ty, bw, bh); ctx.strokeStyle = FG; ctx.lineWidth = 1; ctx.strokeRect(tx + .5, ty + .5, bw - 1, bh - 1);
      ctx.fillStyle = FG; ctx.fillRect(tx, ty, 3 * TK, bh);
      lines.forEach((sline, j) => ctx.fillText(sline, tx + 12 * TK, ty + 7 * TK + j * 17 * TK));
      ctx.beginPath(); ctx.moveTo(sx + h, sy + h); ctx.lineTo(tx < ax ? tx + bw : tx, ty < ay ? ty + bh : ty); ctx.stroke();
    }
    function drawCursor(main, s, style, showReadout, p) {
      if (style === 'system') return;
      const sx = Math.floor(p.x / CELL) * CELL, sy = Math.floor(p.y / CELL) * CELL, now = performance.now() / 1000;
      // the field heats up into solid blocks right under the pointer, so cursor shapes invert what is
      // beneath them (dark on solid, bright on empty); labels and readouts draw normally on their own boxes
      const inv = () => { ctx.globalCompositeOperation = 'difference'; ctx.fillStyle = FG; ctx.strokeStyle = FG; };
      const norm = () => { ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = FG; ctx.strokeStyle = FG; };
      ctx.save(); ctx.fillStyle = FG; ctx.strokeStyle = FG;
      if (style === 'bracket') {
        // the original: the cell under the pointer cleared, corner brackets, a centre dot
        ctx.fillStyle = BG; ctx.fillRect(sx, sy, CELL, CELL); ctx.fillStyle = FG;
        corners(sx - 4, sy - 4, CELL + 8, CELL + 8, 10, 3);
        ctx.fillRect(sx + h - 3, sy + h - 3, 6, 6);
        if (showReadout) readout(sx, sy, sx, sy, CELL);
      } else if (style === 'crosshair') {
        // full-frame hairlines through the exact pointer, a gap at the centre, coordinates on the edges
        // [Ultra.sh] hairlines one device pixel wide and on the pixel grid, so they stay sharp at small cells
        const g = 12, X = snap(p.x), Y = snap(p.y), hp = 1 / SC;
        inv();
        ctx.fillRect(30, Y, Math.max(0, X - g - 30), hp); ctx.fillRect(X + g, Y, Math.max(0, W - 30 - X - g), hp);
        ctx.fillRect(X, 30, hp, Math.max(0, Y - g - 30)); ctx.fillRect(X, Y + g, hp, Math.max(0, H - 30 - Y - g));
        ctx.lineWidth = lwPx(1.5); ctx.strokeRect(snap(X - 5) + halfIfOdd(ctx.lineWidth), snap(Y - 5) + halfIfOdd(ctx.lineWidth), snap(11), snap(11));
        norm();
        tag(`X${pad(p.x, 4)}`, p.x, H - 30, true, 'c'); tag(`Y${pad(p.y, 4)}`, W - 30, p.y, true, 'r');
        if (showReadout) tag(`C${pad(sx / CELL, 2)} R${pad(sy / CELL, 2)}`, p.x + 16, p.y - 16, false);
      } else if (style === 'reticle') {
        // a 3 x 3-cell target that breathes, ticks pointing in, the centre cell outlined
        const b = 3 * Math.sin(now * 4), x0 = sx - CELL - b, y0 = sy - CELL - b, w = 3 * CELL + 2 * b;
        inv();
        corners(x0, y0, w, w, 16, 3);
        ctx.lineWidth = 2; ctx.beginPath();
        ctx.moveTo(sx + h, y0 + 2); ctx.lineTo(sx + h, y0 + 11); ctx.moveTo(sx + h, y0 + w - 2); ctx.lineTo(sx + h, y0 + w - 11);
        ctx.moveTo(x0 + 2, sy + h); ctx.lineTo(x0 + 11, sy + h); ctx.moveTo(x0 + w - 2, sy + h); ctx.lineTo(x0 + w - 11, sy + h); ctx.stroke();
        ctx.lineWidth = 1.5; ctx.strokeRect(sx + 1, sy + 1, CELL - 2, CELL - 2);
        ctx.fillRect(sx + h - 3, sy + h - 3, 6, 6);
        norm();
        if (showReadout) readout(sx, sy, x0, y0, w);
      } else if (style === 'block') {
        // a terminal-style block that blinks, with its cell address
        inv();
        if ((now * 1.6) % 1 < 0.62) ctx.fillRect(sx, sy, CELL, CELL); else { ctx.lineWidth = 3; ctx.strokeRect(sx + 1.5, sy + 1.5, CELL - 3, CELL - 3); }
        ctx.fillRect(sx, sy + CELL + 4, CELL, 4);
        norm();
        tag(`C${pad(sx / CELL, 2)}·R${pad(sy / CELL, 2)}`, sx + CELL + 10, sy + h, true);
        if (showReadout) readout(sx, sy, sx, sy + 26, CELL);
      } else if (style === 'trail') {
        // the cells it passed light up and fade (0.7 s), the current one bracketed
        const last = trail[trail.length - 1];
        if (!last || last.x !== sx || last.y !== sy) {
          for (let j = trail.length - 1; j >= 0; j--) if (trail[j].x === sx && trail[j].y === sy) trail.splice(j, 1);   // one entry per cell
          trail.push({ x: sx, y: sy, t: now });
        }
        while (trail.length && now - trail[0].t > 0.7) trail.shift();
        inv();
        for (const q of trail) { ctx.globalAlpha = Math.max(0, 1 - (now - q.t) / 0.7) * 0.9; ctx.fillRect(q.x + 3, q.y + 3, CELL - 6, CELL - 6); }
        ctx.globalAlpha = 1;
        norm(); ctx.fillStyle = BG; ctx.fillRect(sx, sy, CELL, CELL); ctx.fillStyle = FG;   // the current cell: cleared and bracketed
        corners(sx - 4, sy - 4, CELL + 8, CELL + 8, 9, 2.5); ctx.fillRect(sx + h - 3, sy + h - 3, 6, 6);
        if (showReadout) readout(sx, sy, sx, sy, CELL);
      } else if (style === 'lens') {
        // a loupe: the field around the pointer magnified 2.5 x in a box beside it, tied to the sampled area
        const LS = 220, M = 2.5, R = LS / 2 / M;
        let lx = p.x + 40, ly = p.y - LS - 40;
        if (lx + LS > W - 30) lx = p.x - LS - 40; if (ly < 30) ly = p.y + 40;
        main.save(); main.setTransform(1, 0, 0, 1, 0, 0); main.imageSmoothingEnabled = false;
        main.drawImage(main.canvas, Math.round((p.x - R) * s), Math.round((p.y - R) * s), Math.round(2 * R * s), Math.round(2 * R * s),
                       Math.round(lx * s), Math.round(ly * s), Math.round(LS * s), Math.round(LS * s));
        main.restore();
        inv();
        ctx.lineWidth = 1.5; ctx.setLineDash([3, 4]); ctx.strokeRect(p.x - R + 0.5, p.y - R + 0.5, 2 * R, 2 * R); ctx.setLineDash([]);
        ctx.lineWidth = 1; ctx.globalAlpha = 0.6; ctx.beginPath();
        ctx.moveTo(p.x - R, p.y - R); ctx.lineTo(lx, ly); ctx.moveTo(p.x + R, p.y - R); ctx.lineTo(lx + LS, ly);
        ctx.moveTo(p.x - R, p.y + R); ctx.lineTo(lx, ly + LS); ctx.moveTo(p.x + R, p.y + R); ctx.lineTo(lx + LS, ly + LS); ctx.stroke();
        ctx.globalAlpha = 1; ctx.lineWidth = 3; ctx.strokeRect(lx - 1.5, ly - 1.5, LS + 3, LS + 3);
        ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(lx + LS / 2, ly + LS / 2 - 12); ctx.lineTo(lx + LS / 2, ly + LS / 2 + 12);
        ctx.moveTo(lx + LS / 2 - 12, ly + LS / 2); ctx.lineTo(lx + LS / 2 + 12, ly + LS / 2); ctx.stroke();
        norm();
        tag(`LENS ×${M}` + (showReadout ? `  C${pad(sx / CELL, 2)} R${pad(sy / CELL, 2)}` : ''), lx, ly + LS + 14, true);
      } else if (style === 'dot') {
        // minimal: a solid dot and a faint halo, no snapping
        inv();
        ctx.globalAlpha = 0.5; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, 14, 0, 7); ctx.stroke();
        ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, 7); ctx.fill();
        norm();
        if (showReadout) tag(`C${pad(sx / CELL, 2)} R${pad(sy / CELL, 2)}`, p.x + 18, p.y + 18, false);
      }
      ctx.restore();
    }
    return { stepTo, draw, ripple, logicalHeight: H };
  }

  // ---- quad pattern: "LIGHT PROCESSES", a zooming quadtree (traced from its 540 x 540, 10 fps, 80-frame GIF).
  // Black cells with 1 px white gaps: light areas split down to tiny cells (a pale mesh), dark areas stay as big
  // squares. The whole grid zooms in from the top-left corner (the big boxes come forward fast, the small
  // boxes behind them barely move), its top cell growing from 68.34 px to 135 px over the 8 s loop; as cells
  // grow, a smaller size appears once it reaches 2 px, so the last frame flows back into the first.
  // Every frame's tree is in quad-frames.js (load it first); the zoom between frames can run smoothly.
  // Tech effects (each can be turned off): quadFx = cells fill and flicker as if being processed;
  // quadHud = grid coordinates on the top cells, a name and size printed inside every big box, callouts
  // that lock onto real tree cells with live leaf data, a readout panel, a leaf-depth chart and a status
  // line; quadGlitch = two brief glitch bursts per loop.
  const QUAD_REF = 540, QUAD_GROW = 0.8436;   // top cell growth per GIF frame (px in the 540 px frame)
  // a frame's tree as a map of each smallest cell's leaf depth (value = depth * 32)
  function decodeQuadFrame(fr) {
    const [s, dmax, b64] = fr, nTop = Math.ceil(QUAD_REF / s), N = nTop << dmax, D = new Uint8Array(N * N);
    const bin = atob(b64), bit = (k) => (bin.charCodeAt(k >> 3) >> (7 - (k & 7))) & 1;
    let p = 0;
    const dec = (dep, i, j) => {
      const n = 1 << (dmax - dep);
      if (dep === dmax || !bit(p++)) { for (let y = j * n; y < (j + 1) * n; y++) D.fill(dep * 32, y * N + i * n, y * N + (i + 1) * n); return; }
      dec(dep + 1, i * 2, j * 2); dec(dep + 1, i * 2 + 1, j * 2); dec(dep + 1, i * 2, j * 2 + 1); dec(dep + 1, i * 2 + 1, j * 2 + 1);
    };
    for (let j = 0; j < nTop; j++) for (let i = 0; i < nTop; i++) dec(0, i, j);
    return { D, N, nTop, dmax, s };
  }
  // tech effects for the quadtree: glitch bursts at fixed moments of the 8 s loop, timed cell callouts
  const QUAD_GLITCH = [{ at: 2.6, len: 0.16, amt: 0.9 }, { at: 6.3, len: 0.08, amt: 0.55 }];
  const QUAD_CALLOUTS = 11, QUAD_CALLOUT_LIFE = 1.6;   // about three callouts open at a time
  // the overlay, in white (and black chips) on a transparent canvas; the shader draws white in the
  // foreground colour and black in the background colour
  function drawQuadHud(x, o) {
    const { W, H, uk } = o, lw = Math.max(1, Math.round(uk)), t = o.tau * o.loop;
    const mono = (px, wt) => (wt || 600) + ' ' + (Math.round(px * uk * 10) / 10) + 'px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
    const chip = (txt, cx, cy, align, alpha) => {
      const tw = x.measureText(txt).width, bx = align === 'right' ? cx - tw - 8 * uk : align === 'center' ? cx - tw / 2 - 4 * uk : cx;
      x.globalAlpha = 0.85 * alpha; x.fillStyle = '#000'; x.fillRect(Math.round(bx), Math.round(cy - 7.5 * uk), Math.round(tw + 8 * uk), Math.round(15 * uk));
      x.globalAlpha = alpha; x.fillStyle = '#fff'; x.textAlign = 'left'; x.textBaseline = 'middle'; x.fillText(txt, bx + 4 * uk, cy + 0.5 * uk);
    };
    x.clearRect(0, 0, W, H);
    x.lineWidth = lw; x.strokeStyle = '#fff'; x.fillStyle = '#fff';
    // grid coordinates: the top-level cells' columns (letters) and rows (numbers), riding the zoom
    x.font = mono(10);
    x.globalAlpha = 0.9; x.beginPath();
    for (let i = 0; o.off + i * o.sTop < W; i++) { const gx = Math.round(o.off + i * o.sTop) + 0.5; x.moveTo(gx, 0); x.lineTo(gx, 7 * uk); }
    for (let j = 0; o.off + j * o.sTop < H; j++) { const gy = Math.round(o.off + j * o.sTop) + 0.5; x.moveTo(0, gy); x.lineTo(7 * uk, gy); }
    x.stroke();
    for (let i = 0; o.off + (i + 0.5) * o.sTop < W - 20 * uk; i++) chip(String.fromCharCode(65 + (i % 26)), o.off + (i + 0.5) * o.sTop, 14 * uk, 'center', 0.9);
    for (let j = 0; o.off + (j + 0.5) * o.sTop < H - 40 * uk; j++) if (j > 0 || o.sTop > 60 * uk) chip(String(j + 1), 12 * uk, o.off + (j + 0.5) * o.sTop, 'left', 0.9);
    // inside every big box: its name, and on larger ones its live size, depth and an id, plus corner marks
    x.textAlign = 'left'; x.textBaseline = 'top';
    for (const b of o.boxes) {
      const a = Math.min(1, (b.size - o.minBox) / (24 * uk));   // fades in as the box grows big enough
      if (a <= 0) continue;
      const px = Math.round(b.x) + 6 * uk, py = Math.round(b.y) + (b.y < 30 * uk ? 26 * uk : 6 * uk);
      x.font = mono(b.size > 150 * uk ? 11.5 : 10); x.globalAlpha = 0.9 * a; x.fillStyle = '#fff';
      x.fillText(b.name, px, py);
      if (b.size > 92 * uk) {
        x.font = mono(9, 500); x.globalAlpha = 0.6 * a;
        x.fillText(Math.round(b.size) + ' px · D' + b.d, px, py + 14 * uk);
        if (b.size > 150 * uk) x.fillText('0x' + (b.id & 0xffff).toString(16).toUpperCase().padStart(4, '0'), px, py + 26 * uk);
        // corner marks, bottom right
        const ex = Math.round(b.x + b.size) - 6 * uk - 0.5, ey = Math.round(b.y + b.size) - 6 * uk - 0.5, cl = 7 * uk;
        x.globalAlpha = 0.55 * a; x.beginPath(); x.moveTo(ex - cl, ey); x.lineTo(ex, ey); x.lineTo(ex, ey - cl); x.stroke();
      }
    }
    // cell callouts: brackets lock onto a cell and a readout types in (its size, depth and what it holds)
    for (const C of o.callouts) {
      const a = C.age, alpha = Math.min(1, a / 0.1) * Math.min(1, Math.max(0, (QUAD_CALLOUT_LIFE - a) / 0.25));
      const grow = 1 + 0.25 * Math.pow(1 - Math.min(1, a / 0.2), 2), m = 4 * uk;
      const cx = C.x + C.size / 2, cy = C.y + C.size / 2, hs = (C.size / 2 + m) * grow;
      const x0 = Math.round(cx - hs) + 0.5, x1 = Math.round(cx + hs) - 0.5, y0 = Math.round(cy - hs) + 0.5, y1 = Math.round(cy + hs) - 0.5, c = Math.min(14 * uk, hs * 0.5);
      x.globalAlpha = alpha * (a < 0.25 && Math.floor(a * 30) % 2 ? 0.35 : 1); x.lineWidth = Math.max(1, 2 * uk); x.beginPath();
      x.moveTo(x0, y0 + c); x.lineTo(x0, y0); x.lineTo(x0 + c, y0); x.moveTo(x1 - c, y0); x.lineTo(x1, y0); x.lineTo(x1, y0 + c);
      x.moveTo(x1, y1 - c); x.lineTo(x1, y1); x.lineTo(x1 - c, y1); x.moveTo(x0 + c, y1); x.lineTo(x0, y1); x.lineTo(x0, y1 - c);
      x.stroke(); x.lineWidth = lw;
      x.beginPath(); x.moveTo(cx - 5 * uk, cy); x.lineTo(cx + 5 * uk, cy); x.moveTo(cx, cy - 5 * uk); x.lineTo(cx, cy + 5 * uk); x.stroke();
      if (a < 0.18) continue;
      const lines = [C.name, Math.round(C.size) + ' px · D' + C.d, C.info];
      x.font = mono(10.5); x.textAlign = 'left'; x.textBaseline = 'top';
      const tw = Math.max(...lines.map((l) => x.measureText(l).width)), bw = tw + 14 * uk, bh = (lines.length * 14 + 8) * uk;
      const bx = Math.min(W - bw - 6 * uk, x1 + 8 * uk), by = Math.max(24 * uk, Math.min(H - bh - 30 * uk, y0));
      x.globalAlpha = 0.85 * alpha; x.fillStyle = '#000'; x.fillRect(Math.round(bx), Math.round(by), Math.round(bw), Math.round(bh));
      x.globalAlpha = alpha; x.fillStyle = '#fff'; x.strokeRect(Math.round(bx) + 0.5, Math.round(by) + 0.5, Math.round(bw) - 1, Math.round(bh) - 1);
      x.fillRect(Math.round(bx), Math.round(by), Math.round(3 * uk), Math.round(bh));
      let chars = Math.floor((a - 0.18) / 0.012);
      lines.forEach((ln, r) => { if (chars > 0) x.fillText(ln.slice(0, chars), bx + 9 * uk, by + (5 + r * 14) * uk); chars -= ln.length; });
    }
    // readout panel, top right, with a flickering bit row
    {
      const rows = ['QTREE ▸ LIGHT·PROC' + (Math.floor(t * 2) % 2 ? '  ●' : ''), 'FRAME ' + pad2(o.f + 1) + ' / ' + o.nFrames,
                    'ZOOM ×' + o.zoom.toFixed(3), 'LEAVES ' + o.leaves.toLocaleString('en-US'), 'DEPTH 0–' + o.dmax + '   MIN ' + Math.max(1, Math.round(o.minPx)) + ' px'];
      x.font = mono(10.5);
      const pw = Math.max(...rows.map((r) => x.measureText(r).width)) + 18 * uk, ph = (rows.length * 14 + 22) * uk, px = W - pw - 12 * uk, py = 40 * uk;
      x.globalAlpha = 0.85; x.fillStyle = '#000'; x.fillRect(Math.round(px), Math.round(py), Math.round(pw), Math.round(ph));
      x.globalAlpha = 0.9; x.fillStyle = '#fff'; x.strokeRect(Math.round(px) + 0.5, Math.round(py) + 0.5, Math.round(pw) - 1, Math.round(ph) - 1);
      x.fillRect(Math.round(px), Math.round(py), Math.round(pw), Math.max(1, Math.round(2 * uk)));
      x.textAlign = 'left'; x.textBaseline = 'top';
      rows.forEach((r, j) => { x.globalAlpha = j ? 0.85 : 1; x.fillText(r, px + 9 * uk, py + (7 + j * 14) * uk); });
      const st = Math.floor(t * 10);
      for (let b = 0; b < Math.floor((pw - 18 * uk) / (7 * uk)); b++) {
        x.globalAlpha = ((Math.imul(st * 64 + b + 3, 2654435761) >>> 0) & 3) === 0 ? 1 : 0.2;
        x.fillRect(Math.round(px + 9 * uk + b * 7 * uk), Math.round(py + ph - 11 * uk), Math.round(4 * uk), Math.round(4 * uk));
      }
    }
    // leaf-depth chart and status line, bottom left
    {
      const bw = 16 * uk, gap = 6 * uk, chH = 56 * uk, n = o.counts.length, pw = n * (bw + gap) + 16 * uk, ph = chH + 40 * uk;
      const px = 12 * uk, py = H - 36 * uk - ph, mx = Math.max(...o.counts.map((v) => Math.log(1 + v)));
      x.globalAlpha = 0.85; x.fillStyle = '#000'; x.fillRect(Math.round(px), Math.round(py), Math.round(pw), Math.round(ph));
      x.globalAlpha = 0.9; x.fillStyle = '#fff'; x.strokeRect(Math.round(px) + 0.5, Math.round(py) + 0.5, Math.round(pw) - 1, Math.round(ph) - 1);
      x.font = mono(9); x.textAlign = 'left'; x.textBaseline = 'top'; x.fillText('LEAF DEPTH', px + 8 * uk, py + 5 * uk);
      x.textAlign = 'center';
      o.counts.forEach((v, d) => {
        const h = Math.max(1, chH * 0.8 * Math.log(1 + v) / (mx || 1)), bx = px + 8 * uk + d * (bw + gap), base = py + ph - 14 * uk;
        x.globalAlpha = 0.25; x.fillRect(Math.round(bx), Math.round(base - chH * 0.8), Math.round(bw), Math.round(chH * 0.8));
        x.globalAlpha = 0.95; x.fillRect(Math.round(bx), Math.round(base - h), Math.round(bw), Math.round(h));
        x.textBaseline = 'top'; x.fillText(String(d), bx + bw / 2, base + 2 * uk);
      });
      const status = 'QTREE  ▸ FR ' + pad2(o.f + 1) + '/' + o.nFrames + '  ▸ ZOOM ×' + o.zoom.toFixed(3) + '  ▸ LEAVES ' + o.leaves
        + '  ▸ TAGGED ' + o.tagged + '  ▸ CALL ' + pad2(o.callouts.length);
      x.font = mono(10.5); chip(status, px, H - 20 * uk, 'left', 0.95);
    }
    x.globalAlpha = 1;
  }
  // each pixel finds its smallest-cell slot, reads the leaf depth there, and draws that cell black with its
  // gap on the left and top. Lines sit at floor(k * size + offset), as measured in the GIF.
  const FS_QUAD = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform float uS, uOff, uGap, uDmax, uCols;   // uS: top cell now (device px); uCols: top cells shown from this frame
uniform float uCols2;                                              // whole top cells available in the side frame
uniform sampler2D uLeaf, uLeaf2, uLabel;                           // this frame's leaf depths, and another frame's (for the sides)
uniform vec4 uLabelRect;
uniform vec3 uFg, uBg;
// tech effects: processing fills (uFx), glitch bursts, the overlay (drawn on a 2D canvas)
uniform float uFx, uT, uUnitK, uGlitch, uGSeed, uHudOn;
uniform sampler2D uHud;
out vec4 o;
float hash3(vec3 p){ p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
float gh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hatch(vec2 px){ return mod(px.x + px.y, 6.0 * uUnitK) < 1.6 * uUnitK ? 0.9 : 0.0; }
// how much of the foreground colour this pixel shows (0 = background, 1 = foreground)
float level(vec2 px){
  vec2 rel = px + 1.0 - uOff;
  int per = int(exp2(uDmax) + 0.5), nc = int(uCols + 0.5);
  ivec2 fc = ivec2(floor(rel / (uS / float(per))));
  // beyond the GIF's square (wider frames), continue with whole top cells from another moment of the GIF
  ivec2 top = fc / per;
  float lv;
  if (top.x >= nc) {
    int n2 = int(uCols2 + 0.5);
    ivec2 f2 = ivec2(((top.x - nc) % n2) * per + (fc.x - top.x * per), (top.y % n2) * per + (fc.y - top.y * per));
    lv = texelFetch(uLeaf2, f2, 0).r;
  } else {
    if (top.y >= nc) fc.y = (top.y % nc) * per + (fc.y - top.y * per);
    lv = texelFetch(uLeaf, fc, 0).r;
  }
  float dep = floor(lv * 255.0 / 32.0 + 0.5);
  float size = uS / exp2(dep);
  vec2 c0 = floor(floor(rel / size) * size + uOff);
  float w = (px.x - c0.x < uGap || px.y - c0.y < uGap) ? 1.0 : 0.0;
  if (uFx > 0.5 && w < 0.5) {
    // the cell's index at its own depth stays the same while the grid zooms, so effects stick to cells
    vec2 ci = floor(rel / size);
    float id = hash3(vec3(ci, dep + (top.x >= nc ? 17.0 : 0.0)));
    // processing: in each 1/6 s slot a few mid-size cells fill, solid or hatched
    if (size > 5.0 * uUnitK && size < 70.0 * uUnitK) {
      float slot = floor(uT * 6.0 + id * 5.0);
      if (hash3(vec3(ci + 0.37, dep + slot * 3.17)) > 0.985) w = id < 0.45 ? 0.82 : hatch(px);
    }
  }
  vec2 lp = (px - uLabelRect.xy) / uLabelRect.zw;
  if (uLabelRect.z > 0.0 && all(greaterThanEqual(lp, vec2(0.0))) && all(lessThan(lp, vec2(1.0)))) { vec4 L = texture(uLabel, lp); w = mix(w, L.r, L.a); }
  return w;
}
void main(){
  vec2 px = vec2(gl_FragCoord.x - 0.5, uRes.y - gl_FragCoord.y - 0.5);   // pixel index from the top-left
  // glitch bursts: horizontal slices jump sideways, split into red / blue
  float dx = 0.0, split = 0.0;
  if (uGlitch > 0.0) {
    float sh = mix(4.0, 40.0, gh(vec2(uGSeed, 3.1))) * uUnitK;
    float sl = floor((px.y + gh(vec2(uGSeed, 5.7)) * sh) / sh);
    if (gh(vec2(sl, uGSeed)) < 0.4 * uGlitch) { dx = floor((gh(vec2(sl, uGSeed + 7.0)) - 0.5) * 140.0 * uUnitK * uGlitch); split = floor(4.0 * uUnitK * uGlitch + 0.5); }
  }
  vec2 q = vec2(max(0.0, px.x + dx), px.y);
  float wg = level(q), wr = wg, wb = wg;
  if (split > 0.0) { wr = level(q + vec2(split, 0.0)); wb = level(max(q - vec2(split, 0.0), vec2(0.0))); }
  vec3 c = vec3(mix(uBg.r, uFg.r, wr), mix(uBg.g, uFg.g, wg), mix(uBg.b, uFg.b, wb));
  if (uHudOn > 0.5) {   // overlay: white = foreground colour, black chips = background colour
    vec4 h = texture(uHud, (q + 0.5) / uRes);
    c = mix(c, mix(uBg, uFg, h.r), h.a);
  }
  o = vec4(c, 1.0);
}`;

  // colours the white-on-black glyph canvas: background where it is black, the chosen colour where it is white
  const FS_GLYPH = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform vec3 uCol, uBg;
uniform sampler2D uTex;
out vec4 o;
void main(){
  float l = texture(uTex, vec2(gl_FragCoord.x / uRes.x, 1.0 - gl_FragCoord.y / uRes.y)).r;
  o = vec4(mix(uBg, uCol, l), 1.0);
}`;

  // ---- gel pattern: glowing gel lanes (traced from a 1472 x 1840 still; data in gel-data.js).
  // Each lane is a vertical strip with soft edges; along it, its glow is a sum of traced components
  // (bands, their halos, white-hot cores and the lane's own glow), each with its own hue between green
  // and yellow, tone-mapped like film: 1 - exp(-exposure), so the brightest bands burn toward white.
  // Bands drift down the lanes (some faster than others), breathe and now and then flare; a soft scan
  // light passes down the frame; a bloom spills light into the gaps. All of it repeats exactly every
  // GEL_LOOP seconds: every band wraps a whole number of times.
  const GEL_LOOP = 40;   // s; the lanes drift one image height (1840 px) per loop, some bands two
  const GEL_COLOR = '#90cb29';   // the middle lane's colour (Original)
  const GEL_NARROW = 0.45;       // with a chosen colour, how much of the lanes' hue spread to take away
  // colour maths on exposure colours (relative exposure per channel), via YIQ
  const YIQ = [0.299, 0.587, 0.114, 0.595716, -0.274453, -0.321263, 0.211456, -0.522591, 0.311135];   // row-major
  const YIQ_INV = [1, 0.9563, 0.621, 1, -0.2721, -0.6474, 1, -1.107, 1.7046];
  const mul3 = (A, B) => A.map((_, k) => { const r = (k / 3) | 0, c = k % 3; return A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]; });
  const app3 = (A, v) => [0, 1, 2].map((r) => A[r * 3] * v[0] + A[r * 3 + 1] * v[1] + A[r * 3 + 2] * v[2]);
  const hueOf = (c) => { const q = app3(YIQ, c); return Math.atan2(q[2], q[1]); };
  const exposureOf = (rgb) => { const e = rgb.map((v) => -Math.log(1 - Math.min(0.985, Math.max(0.004, v / 255)))), m = Math.max(...e); return e.map((v) => v / m); };
  const gelRgb = (D, rho) => [rho, 1, Math.max(0.03, D.beta[0] + D.beta[1] * rho)];
  const gelRhoAt = (D, f) => { const L = D.lanes, i = Math.max(0, Math.min(L.length - 2, Math.floor(f))), k = f - i; return L[i][3] + (L[i + 1][3] - L[i][3]) * k; };
  // a chosen colour: one linear map of exposure colours taking the middle lane's colour to it (hue turned,
  // chroma and luma scaled in YIQ), so the bands' green-to-yellow spread follows around the new hue
  function gelRecolor(D, color) {
    const tc = parseHex(color);
    if (!tc) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const ref = app3(YIQ, gelRgb(D, gelRhoAt(D, (D.lanes.length - 1) / 2))), t = app3(YIQ, exposureOf(tc));
    const rC = Math.hypot(ref[1], ref[2]), tC = Math.hypot(t[1], t[2]);
    const th = (tC > 1e-4 ? Math.atan2(t[2], t[1]) : 0) - Math.atan2(ref[2], ref[1]), kC = tC / rC, kY = t[0] / ref[0];
    const S = [kY, 0, 0, 0, kC * Math.cos(th), -kC * Math.sin(th), 0, kC * Math.sin(th), kC * Math.cos(th)];
    return mul3(YIQ_INV, mul3(S, YIQ));
  }
  // per shown lane: each band's motion (fast or not, swells per loop, swell phase, flare time or -1), from a
  // seeded generator so the shader and the tech overlay agree exactly; row 127 is the lane's own glow
  function gelBandRow(code) {
    const rnd = mulberry32((code * 7919 + 0x51ed) >>> 0), row = new Float32Array(128 * 4);
    for (let b = 0; b < 128; b++) {
      const r1 = rnd(), r2 = rnd(), r3 = rnd(), r4 = rnd(), r5 = rnd(), glow = b === 127;
      row.set([!glow && r1 < 0.35 ? 1 : 0, 2 + Math.floor(r2 * 4), r3 * 6.2832, !glow && r4 < 0.25 ? 0.05 + 0.9 * r5 : -1], b * 4);
    }
    return row;
  }
  // tech effects: glitch bursts at fixed moments of the loop (none near its start, so it loops cleanly)
  const GEL_GLITCH = (() => {
    const r = mulberry32(0x61e7), out = [];
    for (let k = 0; k < 6; k++) {
      const micro = k % 3 === 2;
      out.push({ at: (k + 0.15 + 0.7 * r()) / 6 * GEL_LOOP, len: micro ? 0.08 : 0.14 + 0.22 * r(), amt: micro ? 0.55 : 0.8 + 0.2 * r() });
    }
    return out;
  })();
  const GEL_MOTES = 70;   // floating light motes (ethereal glow)
  const GEL_LOCK_E = 1.0, GEL_LOCK_LIFE = 2.4;   // bands this bright (traced energy) get locked as the scanner passes
  const gelPick = (code, b) => ((Math.imul(code * 131 + b + 1, 2654435761) >>> 0) % 1000) / 1000;
  const pad2 = (v) => String(v).padStart(2, '0');
  // a band's place as a fragment size, like reading it off a ladder: top 20 kb, bottom 50 bp
  function bpLabel(f) {
    const bp = Math.pow(10, 4.3 - 2.6 * f);
    return bp >= 1000 ? (bp / 1000).toFixed(bp >= 10000 ? 1 : 2) + ' kb' : Math.round(bp) + ' bp';
  }
  // which bands the scanner has just passed (it locks them for GEL_LOCK_LIFE s); a pure function of time
  function gelLocks(o) {
    const T = GEL_LOOP, Q = T / 4, t = o.tau * T, vS = o.travel / Q, ys0 = -4 * o.scanW, pass = Math.floor(t / Q), locks = [];
    o.lanes.forEach((l, i) => {
      for (const bd of o.bands[l.src]) {
        if (bd.E < GEL_LOCK_E || gelPick(l.code, bd.b) > 0.6) continue;
        const wraps = o.flow + o.migrate * o.rows[i][bd.b * 4], vB = wraps * o.P / T * o.s;
        for (const p of [pass, pass - 1]) {
          const ts = p * Q, y0 = ((((bd.y + l.off + wraps * o.P * ts / T) % o.P) + o.P) % o.P) * o.s;
          for (const Yc of [y0, y0 - o.P * o.s]) {
            const dt = (Yc - ys0) / (vS - vB), age = t - (ts + dt);
            if (dt < 0 || dt > Q || age < 0 || age > GEL_LOCK_LIFE) continue;
            const yHit = Yc + vB * dt, y = Yc + vB * (t - ts);
            if (yHit < 0 || yHit > o.H || y > o.H + 40) continue;
            locks.push({ i, l, bd, y, age, f: ((((bd.y + l.off + wraps * o.P * t / T) % o.P) + o.P) % o.P) / o.P });
          }
        }
      }
    });
    return locks;
  }
  // bands flaring right now (the flare times are in the band table): counted in the overlay's status line
  function gelFlares(o) {
    const T = GEL_LOOP, out = [];
    o.lanes.forEach((l, i) => {
      for (const bd of o.bands[l.src]) {
        const ft = o.rows[i][bd.b * 4 + 3];
        if (ft < 0) continue;
        const dt = ((((o.tau - ft + 0.5) % 1) + 1) % 1 - 0.5) * T;   // s from the flare's peak
        if (Math.abs(dt) > 0.9) continue;
        const wraps = o.flow + o.migrate * o.rows[i][bd.b * 4];
        const pos = ((((bd.y + l.off + wraps * o.P * o.tau) % o.P) + o.P) % o.P);
        for (const y of [pos * o.s, (pos - o.P) * o.s]) {
          if (y > -20 && y < o.H + 20) out.push({ i, l, bd, y, dt, gain: 1 + 1.8 * Math.exp(-(dt / T) * (dt / T) / 2.88e-4) });
        }
      }
    });
    return out;
  }
  // ---- overlay targets (all chosen from the loop phase alone, so they repeat exactly)
  const GEL_HOPS = 16;
  const ghash = (n) => (Math.imul((n | 0) + 0x9e37, 2654435761) ^ Math.imul(n | 0, 40503)) >>> 0;
  const bpOf = (f) => Math.pow(10, 4.3 - 2.6 * f);
  // a band's height in the frame at loop phase tau (its first copy from the top; may be below the frame)
  function gelBandY(o, i, bd, tau) {
    const wraps = o.flow + o.migrate * o.rows[i][bd.b * 4];
    return ((((bd.y + o.lanes[i].off + wraps * o.P * tau) % o.P) + o.P) % o.P) * o.s;
  }
  // a bright band between heights y0 and y1 at phase tau, picked by seed (null if there is none)
  function gelPickBand(o, tau, y0, y1, seed, minE) {
    const c = [];
    o.lanes.forEach((l, i) => {
      for (const bd of o.bands[l.src]) if (bd.E >= minE) { const y = gelBandY(o, i, bd, tau); if (y >= y0 && y <= y1) c.push({ i, bd }); }
    });
    return c.length ? c[ghash(seed) % c.length] : null;
  }
  // a tracking crosshair that hops to a new band GEL_HOPS times per loop, gliding between them
  function gelCursor(o) {
    const hop = o.tau * GEL_HOPS, j = Math.floor(hop), u = (hop - j) * GEL_LOOP / GEL_HOPS;
    const at = (jj) => {
      const m = ((jj % GEL_HOPS) + GEL_HOPS) % GEL_HOPS, p = gelPickBand(o, m / GEL_HOPS, 0.12 * o.H, 0.8 * o.H, m * 17 + 101, 0.5);
      return p ? { x: (o.lanes[p.i].x0 + o.lanes[p.i].x1) / 2 * o.s, y: gelBandY(o, p.i, p.bd, o.tau), i: p.i } : null;
    };
    const a = at(j - 1), b = at(j);
    if (!b) return null;
    const e = a ? Math.min(1, u / 0.8) : 1, ee = e * e * (3 - 2 * e);
    return { x: a ? a.x + (b.x - a.x) * ee : b.x, y: a ? a.y + (b.y - a.y) * ee : b.y, i: b.i, settled: e >= 1, u };
  }
  // the overlay, in white (and black chips) on a transparent canvas; the shader tints it
  function drawGelHud(x, o) {
    const { W, H, s, k } = o, lw = Math.max(1, Math.round(k)), t = o.tau * GEL_LOOP;
    const mono = (px, wt) => (wt || 500) + ' ' + (Math.round(px * k * 10) / 10) + 'px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
    const left = o.lanes[0].x0 * s, right = o.rulerX;
    x.clearRect(0, 0, W, H);
    x.fillStyle = '#fff'; x.strokeStyle = '#fff'; x.lineWidth = lw;
    // measurement grid: faint dashed lines across the lanes at the ruler's long ticks
    x.globalAlpha = 0.1; x.setLineDash([2 * k, 6 * k]);
    for (let y = o.rulerTop; y <= o.rulerBottom + 0.5; y += o.step * 5) {
      const yy = Math.round(y) + 0.5; x.beginPath(); x.moveTo(left, yy); x.lineTo(right - 14 * k, yy); x.stroke();
    }
    x.setLineDash([]);
    // ruler numbers (mm) beside its long ticks
    x.globalAlpha = 0.5; x.font = mono(8.5, 500); x.textAlign = 'right'; x.textBaseline = 'middle';
    for (let q = 0, y = o.rulerTop; y <= o.rulerBottom + 0.5; q++, y += o.step * 5) x.fillText(String(q * 5), right - 15 * k, Math.round(y));
    const lv = (e) => Math.max(0, Math.min(1, Math.log(1 + 3 * Math.max(0, e)) / Math.log(13)));   // glow -> 0..1 level
    // lane numbers along the top, with a level meter under each (its glow on the scan line)
    x.globalAlpha = 0.7; x.font = mono(11.5, 600); x.textAlign = 'center'; x.textBaseline = 'top';
    o.lanes.forEach((l, i) => {
      const cx = (l.x0 + l.x1) / 2 * s, mw = (l.x1 - l.x0) * s * 0.7, my = Math.round(24 * k);
      x.globalAlpha = 0.7; x.fillText(pad2(i + 1), cx, 7 * k);
      x.globalAlpha = 0.18; x.fillRect(Math.round(cx - mw / 2), my, Math.round(mw), Math.max(2, Math.round(3 * k)));
      x.globalAlpha = 0.8; x.fillRect(Math.round(cx - mw / 2), my, Math.round(mw * lv(o.scanE[i])), Math.max(2, Math.round(3 * k)));
    });
    // viewfinder corners, and a blinking run light
    x.globalAlpha = 0.55; x.beginPath();
    const ci = 8 * k, cl = 22 * k;
    for (const [cx, cy, dx, dy] of [[ci, ci, 1, 1], [W - ci, ci, -1, 1], [ci, H - ci, 1, -1], [W - ci, H - ci, -1, -1]]) {
      const px = Math.round(cx) + 0.5 * dx, py = Math.round(cy) + 0.5 * dy;
      x.moveTo(px, py + cl * dy); x.lineTo(px, py); x.lineTo(px + cl * dx, py);
    }
    x.stroke();
    if (Math.floor(t * 2) % 2 === 0) { x.globalAlpha = 0.9; x.beginPath(); x.arc(left / 2, 40 * k, 3 * k, 0, 6.2832); x.fill(); }
    // a data column scrolling up the left margin (80 lines per loop, so it repeats exactly)
    const sy = o.scanY, lh = 14 * k, top0 = 54 * k, bot0 = H - 40 * k, scroll = o.tau * 80 * lh;
    x.font = mono(8.5, 500); x.textAlign = 'right'; x.textBaseline = 'middle';
    for (let r = 0; r * lh < bot0 - top0 + lh; r++) {
      const j = Math.floor(scroll / lh) + r, y = top0 + r * lh - (scroll % lh);
      if (y < top0 || y > bot0 || (o.scanOn && Math.abs(y - sy) < 12 * k)) continue;
      const hsh = Math.imul(j + 7, 2654435761) >>> 0;
      x.globalAlpha = hsh % 9 === 0 ? 0.75 : 0.3;
      x.fillText(((hsh >>> 12) & 0xffff).toString(16).toUpperCase().padStart(4, '0'), left - 7 * k, y);
    }
    // the scanner: a sharp line with a soft trail, its height in the left margin, a notch at the ruler
    if (o.scanOn && sy > -90 * k && sy < H + 2) {
      const g = x.createLinearGradient(0, sy - 90 * k, 0, sy);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,0.16)');
      x.globalAlpha = 1; x.fillStyle = g; x.fillRect(left, sy - 90 * k, right - left, 90 * k);
      x.fillStyle = '#fff'; x.globalAlpha = 0.75; x.fillRect(left, Math.round(sy), right - left, lw);
      x.globalAlpha = 0.9; x.font = mono(10.5, 600); x.textAlign = 'right'; x.textBaseline = 'middle';
      x.fillText(String(Math.max(0, Math.round(sy / s))).padStart(4, '0'), left - 5 * k, sy);
      x.beginPath(); x.moveTo(right - 1 * k, sy); x.lineTo(right - 8 * k, sy - 4 * k); x.lineTo(right - 8 * k, sy + 4 * k); x.closePath(); x.fill();
      // scope trace riding on the scanner: each lane's glow along the scan line, peak marked
      const amp = 56 * k, base = Math.round(sy) - 3 * k, pts = [[left, base]];
      let pk = 0;
      o.lanes.forEach((l, i) => {
        const x0 = l.x0 * s, x1 = l.x1 * s, ed = Math.min(8 * k, (x1 - x0) / 4), yv = base - amp * lv(o.scanE[i]);
        pts.push([x0, base], [x0 + ed, yv], [x1 - ed, yv], [x1, base]);
        if (o.scanE[i] > o.scanE[pk]) pk = i;
      });
      pts.push([right - 14 * k, base]);
      x.beginPath(); pts.forEach(([px, py], j) => (j ? x.lineTo(px, py) : x.moveTo(px, py)));
      x.globalAlpha = 0.85; x.stroke();
      x.lineTo(right - 14 * k, base); x.closePath(); x.globalAlpha = 0.07; x.fill();
      const pl = o.lanes[pk], pxc = (pl.x0 + pl.x1) / 2 * s, pyc = base - amp * lv(o.scanE[pk]);
      x.globalAlpha = 0.9; x.beginPath(); x.moveTo(pxc, pyc - 3 * k); x.lineTo(pxc - 4 * k, pyc - 9 * k); x.lineTo(pxc + 4 * k, pyc - 9 * k); x.closePath(); x.fill();
      x.font = mono(10, 600); x.textAlign = 'center'; x.textBaseline = 'bottom';
      x.fillText('PK L' + pad2(pk + 1) + ' ' + o.scanE[pk].toFixed(2), pxc, pyc - 11 * k);
    }
    // lock-on brackets around the bands the scanner just passed, with a live size readout
    x.textAlign = 'left'; x.textBaseline = 'bottom'; x.font = mono(11, 600);
    for (const L of o.locks) {
      const a = L.age, appear = Math.min(1, a / 0.22), fade = Math.min(1, Math.max(0, (GEL_LOCK_LIFE - a) / 0.5));
      let alpha = Math.min(1, a / 0.05) * fade;
      if (a < 0.3 && Math.floor(a * 24) % 2) alpha *= 0.3;   // blinks while acquiring
      const grow = 1 + 0.7 * (1 - appear) * (1 - appear);
      const cx = (L.l.x0 + L.l.x1) / 2 * s, hw = ((L.l.x1 - L.l.x0) / 2 * s + 5 * k) * grow, hh = Math.max(8 * k, L.bd.h * s / 2 + 5 * k) * grow;
      const x0 = Math.round(cx - hw) + 0.5, x1 = Math.round(cx + hw) - 0.5, y0 = Math.round(L.y - hh) + 0.5, y1 = Math.round(L.y + hh) - 0.5;
      const c = Math.min(10 * k, hw * 0.45, hh);
      x.globalAlpha = 0.95 * alpha; x.beginPath();
      x.moveTo(x0, y0 + c); x.lineTo(x0, y0); x.lineTo(x0 + c, y0);
      x.moveTo(x1 - c, y0); x.lineTo(x1, y0); x.lineTo(x1, y0 + c);
      x.moveTo(x1, y1 - c); x.lineTo(x1, y1); x.lineTo(x1 - c, y1);
      x.moveTo(x0 + c, y1); x.lineTo(x0, y1); x.lineTo(x0, y1 - c);
      x.moveTo(x0 - 4 * k, Math.round(L.y) + 0.5); x.lineTo(x0 + 2 * k, Math.round(L.y) + 0.5);   // centre ticks
      x.moveTo(x1 + 4 * k, Math.round(L.y) + 0.5); x.lineTo(x1 - 2 * k, Math.round(L.y) + 0.5);
      x.stroke();
      const txt = a < 0.35 ? 'LOCK' : 'L' + pad2(L.i + 1) + ' ' + bpLabel(L.f), tw = x.measureText(txt).width;
      const ty = y0 - 3 * k < 17 * k ? y1 + 17 * k : y0 - 3 * k;
      x.globalAlpha = 0.55 * alpha; x.fillStyle = '#000'; x.fillRect(x0 - 0.5, ty - 14 * k, tw + 8 * k, 15 * k);
      x.globalAlpha = alpha; x.fillStyle = '#fff'; x.fillText(txt, x0 + 3.5 * k, ty - 1 * k);
    }
    const chip = (txt, cx, cy, align, alpha) => {   // a small label on a dark chip
      const tw = x.measureText(txt).width, bx = align === 'right' ? cx - tw - 8 * k : align === 'center' ? cx - tw / 2 - 4 * k : cx;
      x.globalAlpha = 0.6 * alpha; x.fillStyle = '#000'; x.fillRect(Math.round(bx), Math.round(cy - 7.5 * k), Math.round(tw + 8 * k), Math.round(15 * k));
      x.globalAlpha = alpha; x.fillStyle = '#fff'; x.textAlign = 'left'; x.textBaseline = 'middle'; x.fillText(txt, bx + 4 * k, cy + 0.5 * k);
    };
    // dimension lines: two locks in one lane get a measured span between them
    const lockAlpha = (L) => Math.min(1, L.age / 0.4) * Math.min(1, Math.max(0, (GEL_LOCK_LIFE - L.age) / 0.5));
    const byLane = new Map();
    for (const L of o.locks) { if (!byLane.has(L.i)) byLane.set(L.i, []); byLane.get(L.i).push(L); }
    x.font = mono(10, 600);
    byLane.forEach((arr) => {
      if (arr.length < 2) return;
      arr.sort((p, q) => p.y - q.y);
      const A = arr[0], B = arr[1], al = Math.min(lockAlpha(A), lockAlpha(B));
      if (B.y - A.y < 34 * k || al <= 0) return;
      const dx = Math.round(A.l.x1 * s + 11 * k) + 0.5, ya = Math.round(A.y), yb = Math.round(B.y), ah = 4 * k;
      x.globalAlpha = 0.85 * al; x.beginPath();
      x.moveTo(dx - 4 * k, ya + 0.5); x.lineTo(dx + 4 * k, ya + 0.5); x.moveTo(dx - 4 * k, yb + 0.5); x.lineTo(dx + 4 * k, yb + 0.5);
      x.moveTo(dx, ya + ah); x.lineTo(dx, yb - ah); x.stroke();
      x.beginPath(); x.moveTo(dx, ya); x.lineTo(dx - ah * 0.7, ya + ah * 1.6); x.lineTo(dx + ah * 0.7, ya + ah * 1.6); x.closePath();
      x.moveTo(dx, yb); x.lineTo(dx - ah * 0.7, yb - ah * 1.6); x.lineTo(dx + ah * 0.7, yb - ah * 1.6); x.closePath(); x.fill();
      const d = Math.abs(bpOf(A.f) - bpOf(B.f));
      chip('Δ ' + (d >= 1000 ? (d / 1000).toFixed(2) + ' kb' : Math.round(d) + ' bp'), dx + 6 * k, (ya + yb) / 2, 'left', al);
    });
    // tracking crosshair: dashed lines through a band, a square reticle, its coordinates on the edges
    const cur = o.cursor;
    if (cur && cur.y > -10 && cur.y < H + 10) {
      const cx = Math.round(cur.x) + 0.5, cy = Math.round(cur.y) + 0.5, q = 7 * k;
      x.globalAlpha = 0.24; x.setLineDash([4 * k, 5 * k]); x.beginPath();
      x.moveTo(cx, 34 * k); x.lineTo(cx, cy - q - 4 * k); x.moveTo(cx, cy + q + 4 * k); x.lineTo(cx, H - 34 * k);
      x.moveTo(left, cy); x.lineTo(cx - q - 4 * k, cy); x.moveTo(cx + q + 4 * k, cy); x.lineTo(right - 14 * k, cy);
      x.stroke(); x.setLineDash([]);
      x.globalAlpha = 0.95; x.strokeRect(cx - q, cy - q, 2 * q, 2 * q);
      x.beginPath();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { x.moveTo(cx + dx * (q + 2 * k), cy + dy * (q + 2 * k)); x.lineTo(cx + dx * (q + 7 * k), cy + dy * (q + 7 * k)); }
      x.stroke();
      x.fillRect(cx - 1.5 * k, cy - 1.5 * k, 3 * k, 3 * k);
      x.font = mono(10, 600);
      chip('X ' + String(Math.round(cur.x / s)).padStart(4, '0'), cx, 40 * k, 'center', 0.9);
      chip('Y ' + String(Math.max(0, Math.round(cur.y / s))).padStart(4, '0'), right - 30 * k, cy, 'right', 0.9);
      chip(cur.settled ? 'TRK L' + pad2(cur.i + 1) : 'SEEK', cx + q + 6 * k, cy - q - 9 * k, 'left', cur.settled ? 0.95 : 0.6 + 0.3 * (Math.floor(t * 12) % 2));
    }
    // info panel, top right: instrument readouts and a flickering bit row
    {
      const pw = 184 * k, ph = 86 * k, px = right - 18 * k - pw, py = 40 * k, frame = Math.floor(o.tau * 1200);
      x.globalAlpha = 0.55; x.fillStyle = '#000'; x.fillRect(Math.round(px), Math.round(py), Math.round(pw), Math.round(ph));
      x.globalAlpha = 0.45; x.strokeRect(Math.round(px) + 0.5, Math.round(py) + 0.5, Math.round(pw) - 1, Math.round(ph) - 1);
      x.globalAlpha = 0.9; x.fillStyle = '#fff'; x.fillRect(Math.round(px), Math.round(py), Math.round(pw), Math.max(1, Math.round(2 * k)));
      x.font = mono(10, 600); x.textAlign = 'left'; x.textBaseline = 'top';
      const rows = ['GEL·SCAN v2.4' + (Math.floor(t * 2) % 2 ? '   ● REC' : ''), 'EXP 1/60 s   GAIN 2.4 dB',
                    'TEMP ' + (21.4 + 0.2 * Math.sin(6.2832 * 3 * o.tau)).toFixed(1) + ' °C   pH 8.3', 'FR ' + String(frame).padStart(4, '0') + ' / 1200'];
      rows.forEach((r, j) => { x.globalAlpha = j ? 0.8 : 0.95; x.fillText(r, px + 8 * k, py + (8 + j * 14) * k); });
      const bs = 4 * k, bstep = 7 * k, step8 = Math.floor(t * 8);
      for (let b = 0; b < Math.floor((pw - 16 * k) / bstep); b++) {
        x.globalAlpha = (ghash(step8 * 64 + b) & 3) === 0 ? 0.9 : 0.18;
        x.fillRect(Math.round(px + 8 * k + b * bstep), Math.round(py + ph - 12 * k), Math.round(bs), Math.round(bs));
      }
    }
    // minimap, bottom right: the whole gel strip with the window now in view
    if (o.mini) {
      const mw = o.mini.width, mh = o.mini.height, mx = Math.round(right - 18 * k - mw), my = Math.round(H - 34 * k - mh);
      x.globalAlpha = 0.6; x.fillStyle = '#000'; x.fillRect(mx - 4 * k, my - 18 * k, mw + 8 * k, mh + 22 * k);
      x.globalAlpha = 0.85; x.drawImage(o.mini, mx, my);
      x.globalAlpha = 0.4; x.strokeRect(mx - 0.5, my - 0.5, mw + 1, mh + 1);
      x.globalAlpha = 0.8; x.fillStyle = '#fff'; x.font = mono(9, 600); x.textAlign = 'left'; x.textBaseline = 'bottom';
      x.fillText('MAP ▸ ' + o.lanes.length + ' LANES', mx, my - 4 * k);
      const top = ((((-o.flow * o.P * o.tau) % o.P) + o.P) % o.P) / o.P * mh, wh = Math.min(mh, (H / s) / o.P * mh);
      x.globalAlpha = 0.95; x.lineWidth = Math.max(1, 1.5 * k);
      const box = (y0, h) => { x.strokeRect(mx + 0.5, Math.round(my + y0) + 0.5, mw - 1, Math.max(1, Math.round(h) - 1)); };
      if (top + wh <= mh) box(top, wh); else { box(top, mh - top); box(0, top + wh - mh); }
      x.lineWidth = lw;
      if (o.scanOn && sy >= 0 && sy <= H) { x.globalAlpha = 0.9; x.fillRect(mx, Math.round(my + ((top + sy / s / o.P * mh) % mh)), mw, Math.max(1, Math.round(k))); }
    }
    // status line along the bottom
    const volts = (120 + 0.4 * Math.sin(6.2832 * 7 * o.tau)).toFixed(1);
    const status = 'RUN 04  ▸ ' + volts + ' V  ▸ λ 520 nm  ▸ ' + o.lanes.length + ' LANES  ▸ SCAN ' + (Math.floor(o.tau * 4) + 1) + '/4  ▸ LOCK ' + pad2(o.locks.length)
      + '  ▸ FLARE ' + pad2(o.flares.filter((F) => Math.abs(F.dt) < 0.5).length) + (o.cursor ? '  ▸ TRK L' + pad2(o.cursor.i + 1) : '');
    x.font = mono(11.5, 600); x.textAlign = 'left'; x.textBaseline = 'bottom';
    const sw = x.measureText(status).width;
    x.globalAlpha = 0.55; x.fillStyle = '#000'; x.fillRect(left, H - 27 * k, sw + 14 * k, 20 * k);
    x.globalAlpha = 0.9; x.fillStyle = '#fff'; x.fillText(status, left + 7 * k, H - 11 * k);
    x.globalAlpha = 1;
  }
  // the glow along each shown lane, one texel per frame row: components move, breathe and flare here
  const FS_GEL_PROF = `#version 300 es
precision highp float;
uniform sampler2D uComp;                 // traced components: (y, sigma, energy, band + 256 * hue byte); a row per traced lane
uniform sampler2D uBandP;                // per shown lane and band: (fast, swells per loop, swell phase, flare time or -1)
uniform vec4 uLane[48];                  // shown lane: (traced lane + 13 * repeat, y offset, base hue, base energy)
uniform float uMax, uScale, uTau, uP, uFlow, uMigrate, uPulse, uFlare, uEnc;
uniform float uSharp, uEdgeW;            // saber look: 0 = soft (as the still) .. 1 = a crisp core line in each band; edge width (traced px)
out vec4 o;                              // r: glow (green exposure), g: glow * hue (red exposure), b: white light
void main(){
  int L = int(gl_FragCoord.x);
  float y = gl_FragCoord.y / uScale;     // texture row = frame row from the top; y in traced px
  vec4 ln = uLane[L];
  int src = int(mod(ln.x + 0.5, 13.0));
  vec3 sum = vec3(ln.w, ln.w * ln.z, 0.0);
  for (int k = 0; k < 256; k++) {
    if (float(k) >= uMax) break;
    vec4 c = texelFetch(uComp, ivec2(k, src), 0);
    if (c.z <= 0.0) break;
    float cw = c.w; bool core = cw > 65535.5;   // a band's core (its strongest component, or a white-hot line)
    if (core) cw -= 65536.0;
    float hq = floor(cw / 256.0), code = cw - 256.0 * hq, rho = hq / 255.0 * 1.3;
    bool white = code > 127.5;           // a white-hot core (moves and pulses with its band)
    float band = code - (white ? 128.0 : 0.0);
    // the band's own motion (the same table drives the HUD's lock-on brackets, so they track exactly)
    vec4 bp = texelFetch(uBandP, ivec2(int(band + 0.5), L), 0);
    float wraps = uFlow + uMigrate * bp.x;
    float d = y - (c.x + ln.y + wraps * uP * uTau);
    d -= uP * floor(d / uP + 0.5);
    if (abs(d) > 5.0 * c.y) continue;
    float a = c.z;
    // breathing: 2-5 slow swells per loop, at the traced level when the loop starts
    a *= 1.0 + uPulse * 0.16 * (sin(6.2832 * bp.y * uTau + bp.z) - sin(bp.z));
    // flares: about one band in four flashes once per loop
    if (bp.w >= 0.0) { float dt = fract(uTau - bp.w + 0.5) - 0.5; a *= 1.0 + uFlare * 1.8 * exp(-dt * dt / 2.88e-4); }
    float v = a * exp(-0.5 * d * d / (c.y * c.y));
    if (core && uSharp > 0.0) {
      // saber: a hard-edged, anti-aliased core line (the band's half-glow width, at most ~12 px at 1080p)
      // inside what is left of its soft glow
      float hw = max(min(1.1774 * c.y, 4.5), 0.6 * uEdgeW);
      float bar = 1.0 - smoothstep(hw - 0.5 * uEdgeW, hw + 0.5 * uEdgeW, abs(d));
      v = v * (1.0 - 0.4 * uSharp) + a * uSharp * 1.3 * bar;
    }
    if (white) sum.z += v; else sum.xy += v * vec2(1.0, rho);
  }
  o = vec4(sum / uEnc, 1.0);
}`;
  // the lanes: each pixel takes the glow of the lanes around it (soft edges), in each band's own hue
  const FS_GEL = `#version 300 es
precision highp float;
uniform sampler2D uProf;
uniform vec4 uEdge[48];                  // shown lane: (left, right in traced px, hue turn, unused)
uniform vec4 uCol[48];                   // shown lane: its overall colour (white cores take it when flat)
uniform mat3 uM;                         // recolour map (identity for the traced colours)
uniform vec2 uBeta;                      // blue exposure = (beta.x + beta.y * hue) * glow
uniform float uN, uScale, uRows, uSigIn, uSigOut, uEnc, uScan, uScanY, uScanW;
uniform float uWhite;                    // 1: white cores glow white; 0: in the lane's colour (flat)
out vec4 o;
const mat3 TOYIQ = mat3(0.299, 0.595716, 0.211456, 0.587, -0.274453, -0.522591, 0.114, -0.321263, 0.311135);
const mat3 FROMYIQ = mat3(1.0, 1.0, 1.0, 0.9563, -0.2721, -1.107, 0.621, -0.6474, 1.7046);
float lg(float z){ return 1.0 / (1.0 + exp(-1.702 * z)); }
void main(){
  float x = gl_FragCoord.x / uScale;
  float ys = uRows - gl_FragCoord.y;     // frame px from the top
  int row = int(ys);
  int i0 = int(floor((x - 35.5) / 108.8));
  vec3 E = vec3(0.0); float M = 0.0;
  for (int j = i0 - 1; j <= i0 + 1; j++) {
    if (j < 0 || float(j) >= uN) continue;
    vec4 e = uEdge[j];
    float uL = x - e.x, uR = e.y - x;
    float m = lg(uL / (uL > 0.0 ? uSigIn : uSigOut)) * lg(uR / (uR > 0.0 ? uSigIn : uSigOut));
    if (m < 1e-4) continue;
    vec3 p = texelFetch(uProf, ivec2(j, row), 0).rgb * uEnc;
    vec3 c = vec3(p.y, p.x, max(0.03 * p.x, uBeta.x * p.x + uBeta.y * p.y));
    if (e.z != 0.0) {                    // lanes moved along the gradient (more or fewer lanes): turn the hue
      vec3 q = TOYIQ * c; float cs = cos(e.z), sn = sin(e.z);
      c = FROMYIQ * vec3(q.x, cs * q.y - sn * q.z, sn * q.y + cs * q.z);
    }
    c = max(uM * c, vec3(0.0));
    E += m * (c + p.z * mix(uCol[j].rgb, vec3(1.0), uWhite)); M += m;
  }
  float sd = (ys - uScanY) / uScanW;
  E *= 1.0 + uScan * exp(-0.5 * sd * sd);
  o = vec4(E / uEnc, min(M, 1.0));
}`;
  // 4 x 4 box average (to a quarter-size target) before the bloom blurs, so thin bands do not shimmer
  const FS_DOWN4 = `#version 300 es
precision highp float;
uniform sampler2D uSrc; uniform vec2 uSrcRes;
out vec4 o;
void main(){
  vec2 c = gl_FragCoord.xy * 4.0;        // this texel's 4 x 4 block centre, in source px
  vec4 a = vec4(0.0);
  for (int i = 0; i < 4; i++) { vec2 d = vec2(i % 2 == 0 ? -1.0 : 1.0, i < 2 ? -1.0 : 1.0); a += texture(uSrc, (c + d) / uSrcRes); }
  o = a * 0.25;
}`;
  const FS_BLUR4 = `#version 300 es
precision highp float;
uniform vec2 uRes, uDir; uniform float uSigma, uThr;   // uThr: only light above this level (for the streaks)
uniform sampler2D uSrc;
out vec4 o;
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 acc = vec4(0.0); float wsum = 0.0;
  for (int i = -8; i <= 8; i++) {
    float w = exp(-4.5 * float(i * i) / 64.0);
    acc += w * max(texture(uSrc, uv + uDir * (float(i) * uSigma / 3.0) / uRes) - vec4(uThr), vec4(0.0)); wsum += w;
  }
  o = acc / wsum;
}`;
  // ethereal glow: floating light motes, drawn as soft points into the glow (so they bloom like the bands).
  // Everything comes from the point's index and the loop phase, so the drift repeats exactly.
  const VS_MOTES = `#version 300 es
precision highp float;
uniform float uTau, uK, uAmt;
uniform vec3 uColA, uColB;               // tint across the frame (the outer lanes' colours)
out vec3 vC;
float h(float n){ return fract(sin(n * 91.3458 + 12.71) * 47453.5453); }
void main(){
  float i = float(gl_VertexID);
  float r1 = h(i), r2 = h(i + 0.31), r3 = h(i + 0.57), r4 = h(i + 0.83), r5 = h(i + 1.19), r6 = h(i + 1.61);
  bool big = r6 < 0.2;                   // some are large, dim, out-of-focus discs
  float y = fract(r2 + (1.0 + floor(r3 * 2.0)) * uTau);   // rises 1 or 2 frame heights per loop
  float x = r1 + 0.014 * sin(6.2832 * (2.0 + floor(r4 * 4.0)) * uTau + r5 * 6.2832);
  float tw = 0.55 + 0.45 * sin(6.2832 * (3.0 + floor(r5 * 6.0)) * uTau + r4 * 6.2832);   // twinkle
  float fade = smoothstep(0.0, 0.1, y) * (1.0 - smoothstep(0.8, 1.0, y));
  vC = mix(uColA, uColB, clamp(x, 0.0, 1.0)) * (big ? 0.32 : 1.8) * tw * fade * uAmt;
  gl_Position = vec4(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = (big ? 18.0 + 18.0 * r4 : 3.5 + 7.0 * r4) * uK;
}`;
  const FS_MOTES = `#version 300 es
precision highp float;
uniform float uEnc;
in vec3 vC; out vec4 o;
void main(){
  vec2 p = gl_PointCoord * 2.0 - 1.0; float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  o = vec4(vC * max(exp(-r2 * 4.0) - 0.018, 0.0) / uEnc, 0.0);
}`;
  // glow + bloom, film tone curve (or flat colour), the ruler, the backdrop
  const FS_GEL_OUT = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform sampler2D uF, uB1, uB2;
uniform float uK1, uK2, uEnc, uHl, uRulerOn, uLevel, uTickW, uStep, uMinor, uLong;
uniform float uFlatK, uFlatMax;          // flat: exposure colour -> shown colour, so the brightest is the chosen colour
uniform vec4 uRule;                      // ruler line: x, width, top, bottom (frame px from the top-left)
uniform vec3 uBg;
uniform sampler2D uHud;                  // tech overlay (drawn on a 2D canvas, top row first)
uniform float uHudOn; uniform vec3 uHudCol;
uniform float uGlitch, uGSeed, uUnitK;   // glitch burst: strength now, its current random seed, px scale
uniform sampler2D uStreakT, uAuraT;      // ethereal glow: long horizontal light streaks from the brightest cores, a wide aura
uniform float uStreak, uAura;
out vec4 o;
float cover(float p, float a, float b){ return clamp(min(p + 1.0, b) - max(p, a), 0.0, 1.0); }
float gh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 energy(vec2 uv){
  vec4 f = texture(uF, uv);
  vec3 B = (uK1 * texture(uB1, uv).rgb + uK2 * texture(uB2, uv).rgb) * uEnc;
  vec3 X = (uStreak * texture(uStreakT, uv).rgb + uAura * texture(uAuraT, uv).rgb) * uEnc;
  return f.rgb * uEnc + B * (1.0 - 0.8 * f.a) + X;   // the traced lanes already hold their own halo; the gaps take the spill
}
void main(){
  // glitch bursts: horizontal slices jump sideways and split into red / blue for a few frames
  float dx = 0.0, split = 0.0, lift = 0.0;
  if (uGlitch > 0.0) {
    float top = uRes.y - gl_FragCoord.y;
    float sh = mix(4.0, 44.0, gh(vec2(uGSeed, 3.1))) * uUnitK;
    float sl = floor((top + gh(vec2(uGSeed, 5.7)) * sh) / sh);
    if (gh(vec2(sl, uGSeed)) < 0.38 * uGlitch) {
      dx = floor((gh(vec2(sl, uGSeed + 7.0)) - 0.5) * 2.0 * 90.0 * uUnitK * uGlitch);
      split = floor(5.0 * uUnitK * uGlitch + 0.5); lift = 0.25 * gh(vec2(sl, uGSeed + 13.0));
    }
  }
  vec2 px = gl_FragCoord.xy + vec2(dx, 0.0), uv = px / uRes;
  vec3 E = energy(uv);
  if (split > 0.0) { E.r = energy(uv + vec2(split, 0.0) / uRes).r; E.b = energy(uv - vec2(split, 0.0) / uRes).b; }
  E *= 1.0 + lift;
  float m = max(max(E.r, E.g), max(E.b, 1e-5));
  vec3 flat_ = (1.0 - exp(-uFlatK * E / m)) / (1.0 - exp(-uFlatK)) * uFlatMax * (1.0 - exp(-m));
  vec3 c = mix(flat_, 1.0 - exp(-E), uHl);
  if (uRulerOn > 0.5) {
    vec2 p = vec2(px.x - 0.5, uRes.y - gl_FragCoord.y - 0.5);
    float r = cover(p.x, uRule.x, uRule.x + uRule.y) * cover(p.y, uRule.z, uRule.w);
    float k = floor((p.y + 0.5 - uRule.z) / uStep + 0.5), yc = uRule.z + k * uStep;
    if (k >= 0.0 && yc <= uRule.w) {
      float len = mod(k, 5.0) < 0.5 ? uLong : uMinor;
      r = max(r, cover(p.x, uRule.x - len, uRule.x) * cover(p.y, yc - 0.5 * uTickW, yc + 0.5 * uTickW));
    }
    c = mix(c, vec3(uLevel), r);
  }
  if (uHudOn > 0.5) {
    vec4 h = texture(uHud, vec2(uv.x, 1.0 - gl_FragCoord.y / uRes.y));
    if (split > 0.0) {                   // a ghost of the overlay, split off with the slice
      vec4 g = texture(uHud, vec2(uv.x + 2.0 * split / uRes.x, 1.0 - gl_FragCoord.y / uRes.y));
      if (g.a * 0.6 > h.a) h = vec4(g.rgb, g.a * 0.6);
    }
    c = mix(c, h.rgb * uHudCol, h.a);
  }
  c = 1.0 - (1.0 - uBg) * (1.0 - c);
  // a little dither so the long soft glows do not band in 8-bit output
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  o = vec4(clamp(c + (n - 0.5) / 255.0, 0.0, 1.0), 1.0);
}`;

  function createBeamLoop(canvas, opts) {
    const P = Object.assign({}, DEFAULTS, opts || {});
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: !!P.preserveDrawingBuffer });
    if (!gl) return null;
    const hasFloat = !!gl.getExtension('EXT_color_buffer_float');
    const mk = (fs, vs) => {
      const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
      const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs || VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name] = gl.getUniformLocation(p, a.name); }
      return { p, u };
    };
    const progField = mk(FS_FIELD), progBlur = mk(FS_BLUR), progOut = mk(FS_OUT), progGlitch = mk(FS_GLITCH), progHero = mk(FS_HERO), progGlyph = mk(FS_GLYPH);
    const progQuad = mk(FS_QUAD);
    const progGelProf = mk(FS_GEL_PROF), progGel = mk(FS_GEL), progDown4 = mk(FS_DOWN4), progBlur4 = mk(FS_BLUR4), progGelOut = mk(FS_GEL_OUT);
    const progMotes = mk(FS_MOTES, VS_MOTES);
    const isGel = () => P.pattern === 'gel';
    const isQuad = () => P.pattern === 'quad';
    const isGlitch = () => P.pattern === 'glitch';
    const isHero = () => P.pattern === 'hero';
    const isGlyph = () => P.pattern === 'glyph';

    // glyph field: simulated and drawn on a 2D canvas, uploaded, then coloured
    let glyph = null, fpsEst = 60;
    const pointer = { x: -999, y: -999, in: false };
    function ensureGlyph() {
      if (!glyph) {
        const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        glyph = { field: createGlyphField(P.glyphSeed >>> 0, () => P.glyphFloor, () => P.glyphHover), cv: document.createElement('canvas'), ctx: null, tex };
      }
      return glyph;
    }
    // pointer: hover heats the field, a click sends a ripple (only while the glyph pattern shows)
    function toLogical(e) {
      const r = canvas.getBoundingClientRect(), lh = 1080 * (P.glyphScale || 1), lw = W && H ? lh * W / H : lh * 16 / 9;
      return [(e.clientX - r.left) * lw / r.width, (e.clientY - r.top) * lh / r.height];
    }
    if (P.interactive !== false) {
      canvas.addEventListener('pointermove', (e) => { if (!isGlyph()) return; [pointer.x, pointer.y] = toLogical(e); pointer.in = true; });
      canvas.addEventListener('pointerleave', () => { pointer.in = false; });
      canvas.addEventListener('pointerdown', (e) => { if (!isGlyph()) return; const [x, y] = toLogical(e); ensureGlyph().field.ripple(x, y); });
    }
    const lutFloor = () => (isGlitch() ? GLITCH_FLOOR : P.floor);
    const lutData = () => buildLut(P.color, P.background, lutFloor(), P.pattern, P.highlight, P.contrast);
    const vaoMain = gl.createVertexArray(), vaoNone = gl.createVertexArray();   // vaoNone: for the motes (no attributes)
    gl.bindVertexArray(vaoMain);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const lut = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, lut);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lutData());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // glitch frames: decoded from glitch-frames.js the first time the pattern is drawn
    let glitch = null, glitchTex = null, hudTex = null, glitchLoading = false;
    let glitchReady = null, resolveGlitch = null, rejectGlitch = null;
    function ensureGlitch() {
      if (glitchTex || glitchLoading || !global.BEAM_LOOP_GLITCH) return;
      glitchLoading = true;
      const data = global.BEAM_LOOP_GLITCH, img = new Image();
      img.onload = () => {
        glitchTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, glitchTex);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        if (data.hud) {
          hudTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, hudTex);
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, data.hud.w, data.hud.h, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(data.hud.data));
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        }
        glitch = data;
        if (resolveGlitch) resolveGlitch();
        if (!raf) renderAt(lastT, lastG);
      };
      img.onerror = () => { glitchLoading = false; if (rejectGlitch) rejectGlitch(new Error('glitch frames could not be decoded')); };
      img.src = data.atlas;
    }
    // hero clip: a muted, looping <video> whose frames are uploaded as a texture
    let hero = null, heroReady = null;
    function ensureHero() {
      if (hero) return heroReady;
      const url = heroUrl();
      if (!url) return Promise.reject(new Error('load hero-video.js first'));
      const v = document.createElement('video');
      v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto'; v.setAttribute('playsinline', '');
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
      hero = { video: v, tex, dirty: true, loaded: false };
      if ('requestVideoFrameCallback' in v) { const cb = () => { hero.dirty = true; v.requestVideoFrameCallback(cb); }; v.requestVideoFrameCallback(cb); }
      heroReady = new Promise((res, rej) => {
        v.addEventListener('loadeddata', () => { hero.loaded = true; hero.dirty = true; res(); if (!raf) renderAt(lastT, lastG); }, { once: true });
        v.addEventListener('error', () => rej(new Error('this browser cannot play the hero clip (AV1 video)')), { once: true });
      });
      heroReady.catch(() => {});
      v.src = url;
      return heroReady;
    }
    // live playback follows speed and pause; other patterns keep the clip paused
    function syncHero(running) {
      if (!hero) return;
      const v = hero.video;
      if (running && isHero() && !P.paused) {
        const rate = Math.max(0.0625, Math.min(16, P.speed || 1));
        if (Math.abs(v.playbackRate - rate) > 1e-3) v.playbackRate = rate;
        if (v.paused) v.play().catch(() => {});
      } else if (!v.paused) v.pause();
    }
    // export / compare: show the clip at animation time t (seconds), frame-exact
    function prepareFrame(t) {
      if (!isHero()) return whenReady();
      return ensureHero().then(() => new Promise((res) => {
        const v = hero.video, d = v.duration || (global.BEAM_LOOP_HERO && global.BEAM_LOOP_HERO.duration) || 1;
        const target = (((t % d) + d) % d) + 1e-3;
        if (!v.paused) v.pause();
        if (Math.abs(v.currentTime - target) < 5e-4 && v.readyState >= 2) { hero.dirty = true; return res(); }
        v.addEventListener('seeked', () => { hero.dirty = true; res(); }, { once: true });
        v.currentTime = target;
      }));
    }
    // resolves once the current pattern can draw (the glitch pattern needs its frames decoded)
    function whenReady() {
      if (isHero()) return ensureHero();
      if (isQuad()) return global.BEAM_LOOP_QUAD ? Promise.resolve() : Promise.reject(new Error('load quad-frames.js first'));
      if (isGel()) return global.BEAM_LOOP_GEL ? Promise.resolve() : Promise.reject(new Error('load gel-data.js first'));
      if (!isGlitch() || glitch) return Promise.resolve();
      if (!global.BEAM_LOOP_GLITCH) return Promise.reject(new Error('load glitch-frames.js first'));
      if (!glitchReady) glitchReady = new Promise((res, rej) => { resolveGlitch = res; rejectGlitch = rej; });
      ensureGlitch();
      return glitchReady;
    }
    const quadLoop = () => { const d = global.BEAM_LOOP_QUAD; return d ? d.frames.length / (d.fps || 10) : 8; };
    const periodOf = () => (isGel() ? GEL_LOOP : isQuad() ? quadLoop() : isGlyph() ? GLYPH_LOOP : isHero() ? ((global.BEAM_LOOP_HERO && global.BEAM_LOOP_HERO.duration) || 9.375)
      : isGlitch() ? (global.BEAM_LOOP_GLITCH ? global.BEAM_LOOP_GLITCH.sequence.length / 30 : 55 / 30) : P.period);

    // half-float targets where the GPU can render to them; 8-bit otherwise
    const fmt = hasFloat ? [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT] : [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE];
    function target(w, h) {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, fmt[0], w, h, 0, fmt[1], fmt[2], null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      return { t, f, w, h };
    }

    let W = 0, H = 0, T = null;
    function fit() {
      let w, h;
      if (P.size) {
        // fixed frame (e.g. [1920, 1080]); CSS scales the canvas to fit the page
        w = P.size[0]; h = P.size[1];
      } else {
        const r = canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, P.maxDpr || 2);   // [Ultra.sh] maxDpr
        w = Math.max(1, Math.round(r.width * dpr)); h = Math.max(1, Math.round(r.height * dpr));
        const k = Math.min(1, P.maxPixels / Math.min(w, h)); w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k));
      }
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      if (w === W && h === H) return;
      if (T) Object.values(T).forEach(x => { gl.deleteTexture(x.t); gl.deleteFramebuffer(x.f); });
      W = w; H = h;
      const q = (d) => [Math.max(1, Math.round(w / d)), Math.max(1, Math.round(h / d))];
      T = { field: target(w, h), b1a: target(...q(4)), b1b: target(...q(4)), b2a: target(...q(8)), b2b: target(...q(8)) };
    }
    const unit = () => 500 / Math.min(W, H);
    function blur(src, tmp, dst, sigmaPx) {
      gl.useProgram(progBlur.p); const u = progBlur.u;
      gl.uniform1i(u.uSrc, 0); gl.uniform1f(u.uSigma, Math.max(0.3, sigmaPx / unit() * (tmp.w / W)));
      gl.bindFramebuffer(gl.FRAMEBUFFER, tmp.f); gl.viewport(0, 0, tmp.w, tmp.h);
      gl.bindTexture(gl.TEXTURE_2D, src.t); gl.uniform2f(u.uRes, tmp.w, tmp.h); gl.uniform2f(u.uDir, 1, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.f); gl.viewport(0, 0, dst.w, dst.h);
      gl.bindTexture(gl.TEXTURE_2D, tmp.t); gl.uniform2f(u.uRes, dst.w, dst.h); gl.uniform2f(u.uDir, 0, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    let lastT = 0, lastG = 0;
    function renderGlitch(t, grainT) {
      ensureGlitch();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
      if (!glitch) {   // frames not loaded yet: just the backdrop
        const c = lutData().slice(Math.round(GLITCH_FLOOR * 255) * 4);
        gl.clearColor(c[0] / 255, c[1] / 255, c[2] / 255, 1); gl.clear(gl.COLOR_BUFFER_BIT); return;
      }
      const seq = glitch.sequence, n = seq.length;
      const f = ((Math.floor(t * glitch.fps + 1e-4) % n) + n) % n;
      gl.useProgram(progGlitch.p); const u = progGlitch.u;
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, glitchTex); gl.uniform1i(u.uAtlas, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, lut); gl.uniform1i(u.uLut, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, hudTex); gl.uniform1i(u.uHud, 2);
      // wider than square (e.g. 1920 x 1080): extend the wall sideways, readout to the frame's corner
      const expand = P.glitchExpand !== false && W > H * 1.02;
      const rightEdge = 250 + 0.5 * W * unit();   // the frame's right edge in the clip's pixels
      const hud = glitch.hud;
      const hudX = hud ? hud.x + (expand ? rightEdge - 500 : 0) : 0;
      gl.uniform4f(u.uHudRect, hudX, hud ? hud.y : 0, hud && hudTex ? hud.w : 0, hud ? hud.h : 1);
      gl.uniform2f(u.uRes, W, H); gl.uniform1f(u.uUnit, unit());
      const at = (frame) => { const i = seq[((frame % n) + n) % n]; return [(i % glitch.cols) * glitch.cell, Math.floor(i / glitch.cols) * glitch.cell]; };
      gl.uniform2i(u.uTile, ...at(f));
      gl.uniform1f(u.uExpand, expand ? 1 : 0);
      gl.uniform2i(u.uTileM1, ...at(f - 19)); gl.uniform2i(u.uTileP1, ...at(f + 19));
      gl.uniform2i(u.uTileM2, ...at(f - 38)); gl.uniform2i(u.uTileP2, ...at(f + 38));
      // stripes are 3.495 clip px apart; below ~3 screen px per stripe, blend them toward their average
      gl.uniform1f(u.uAA, Math.max(0, Math.min(1, (3.495 / unit() - 1.5) / 1.5)));
      gl.uniform1f(u.uSharp, P.glitchSharp);
      gl.uniform1f(u.uEdge, P.glitchEdge); gl.uniform1f(u.uSoft, P.glitchSoft); gl.uniform1f(u.uGlowK, P.glitchGlow);
      gl.uniform1f(u.uNbr, P.glitchNbr); gl.uniform1f(u.uNbrY, P.glitchNbrY); gl.uniform1f(u.uD0, P.glitchD0); gl.uniform1f(u.uD1, P.glitchD1);
      gl.uniform1f(u.uGrain, P.glitchGrain || 0); gl.uniform1f(u.uGrainT, grainT % 1000);
      gl.uniform1f(u.uCell, Math.max(1, Math.round(Math.min(W, H) / 540)));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0);
    }
    // light processes: the current frame's leaf-depth map (re-decoded when the GIF frame changes) and the label
    let quad = null;
    function ensureQuad() {
      if (!quad) {
        const mkTex = (filter) => {
          const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          return t;
        };
        quad = { leafTex: mkTex(gl.NEAREST), leafTex2: mkTex(gl.NEAREST), labelTex: mkTex(gl.LINEAR), labelKey: '', frame: -1, frame2: -1, cur: null, side: null,
                 hudTex: mkTex(gl.LINEAR), hudCv: null, hudCtx: null, counts: null, sel: {} };
      }
      // the label, white with a black outline, set in a condensed sans like the reference
      const text = P.quadLabel == null ? 'LIGHT PROCESSES' : String(P.quadLabel), key = text + '|' + W + 'x' + H;
      if (quad.labelKey !== key) {
        quad.labelKey = key; quad.labelRect = [0, 0, 0, 0];
        if (text) {
          const s = H / QUAD_REF, fs = 13 * s, pad = Math.ceil(3 * s);
          const c = document.createElement('canvas'), x = c.getContext('2d');
          const font = '700 ' + fs + 'px "Roboto Condensed","Arial Narrow","Helvetica Neue",Arial,sans-serif';
          x.font = font; const tw = x.measureText(text).width, fitW = 76 * s * text.length / 15, sx = Math.min(1, fitW / tw);
          c.width = Math.ceil(tw * sx + pad * 2); c.height = Math.ceil(fs * 1.25 + pad * 2);
          x.font = font; x.textBaseline = 'alphabetic'; x.setTransform(sx, 0, 0, 1, pad, 0);
          const base = pad + fs * 0.95;
          x.lineJoin = 'round'; x.lineWidth = Math.max(1.5, 2.2 * s) / sx; x.strokeStyle = '#000'; x.strokeText(text, 0, base);
          x.fillStyle = '#fff'; x.fillText(text, 0, base);
          gl.bindTexture(gl.TEXTURE_2D, quad.labelTex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
          // right edge 14 px and baseline 11 px from the frame's corner (as in the reference, scaled)
          quad.labelRect = [W - 14 * s - c.width + pad, H - 11 * s - base, c.width, c.height];
        }
      }
      return quad;
    }
    function renderQuad(t) {
      const q = ensureQuad(), data = global.BEAM_LOOP_QUAD;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
      if (!data) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); return; }   // frames not loaded yet
      const frames = data.frames, n = frames.length, fps = data.fps || 10, loop = n / fps;
      const tt = ((t % loop) + loop) % loop, pos = tt * fps, f = Math.min(n - 1, Math.floor(pos + 1e-6));
      const upload = (tex, m) => {
        gl.bindTexture(gl.TEXTURE_2D, tex); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, m.N, m.N, 0, gl.RED, gl.UNSIGNED_BYTE, m.D);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      };
      if (q.frame !== f) {
        q.cur = decodeQuadFrame(frames[f]); q.frame = f; upload(q.leafTex, q.cur);
        // leaves per depth in this frame's tree (for the overlay's chart)
        const slots = new Array(q.cur.dmax + 1).fill(0);
        for (let i = 0; i < q.cur.D.length; i++) slots[q.cur.D[i] >> 5]++;
        q.counts = slots.map((v, d) => Math.round(v / Math.pow(4, q.cur.dmax - d)));
      }
      // wider frames: the sides come from a frame half a loop away with the same smallest cell size
      const deep = frames.findIndex((fr) => fr[1] > frames[0][1]), split = deep < 0 ? n : deep;
      const g = f < split ? (f + Math.floor(split / 2)) % split : split + ((f - split + Math.floor((n - split) / 2)) % (n - split));
      if (q.frame2 !== g) { q.side = decodeQuadFrame(frames[g]); q.frame2 = g; upload(q.leafTex2, q.side); }
      const wide = W > H * 1.02;
      // the zoom: smooth between GIF frames (default), or held for each frame like the GIF itself
      const smooth = P.quadSmooth !== false;
      const sRef = q.cur.s + (smooth ? (pos - f) * QUAD_GROW : 0);
      const k = H / (data.ref || QUAD_REF);   // device px per GIF px; the GIF's square fills the height, anchored top-left
      gl.useProgram(progQuad.p); const u = progQuad.u;
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, q.leafTex); gl.uniform1i(u.uLeaf, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, q.labelTex); gl.uniform1i(u.uLabel, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, q.leafTex2); gl.uniform1i(u.uLeaf2, 2);
      gl.uniform2f(u.uRes, W, H); gl.uniform1f(u.uS, sRef * k); gl.uniform1f(u.uOff, (data.offset == null ? 0.5 : data.offset) * k);
      gl.uniform1f(u.uGap, Math.max(1, Math.round(k))); gl.uniform1f(u.uDmax, q.cur.dmax);
      // square frames show every traced column (as the GIF); wider ones keep only the fully visible ones
      // and continue with whole top cells from the side frame
      const full = (m) => Math.max(1, Math.floor(QUAD_REF / m.s + 1e-6));
      gl.uniform1f(u.uCols, wide ? full(q.cur) : q.cur.nTop); gl.uniform1f(u.uCols2, full(q.side));
      gl.uniform4f(u.uLabelRect, ...q.labelRect);
      const fg = parseHex(P.color) || [255, 255, 255], bg = parseHex(P.background) || [0, 0, 0];
      gl.uniform3f(u.uFg, fg[0] / 255, fg[1] / 255, fg[2] / 255); gl.uniform3f(u.uBg, bg[0] / 255, bg[1] / 255, bg[2] / 255);
      // tech effects: processing fills, glitch bursts, the overlay
      const uk = Math.min(W / 1920, H / 1080), fxOn = P.quadFx !== false, offPx = (data.offset == null ? 0.5 : data.offset) * k;
      gl.uniform1f(u.uFx, fxOn ? 1 : 0); gl.uniform1f(u.uT, tt); gl.uniform1f(u.uUnitK, k);
      let gAmt = 0, gSeed = 0;
      if (P.quadGlitch !== false) for (const b of QUAD_GLITCH) if (Math.abs(tt - b.at) < b.len / 2) { gAmt = b.amt; gSeed = Math.floor(tt * 20) + b.at; }
      gl.uniform1f(u.uGlitch, gAmt); gl.uniform1f(u.uGSeed, gSeed);
      const hudOn = P.quadHud !== false;
      gl.uniform1f(u.uHudOn, hudOn ? 1 : 0);
      if (hudOn) {
        if (!q.hudCv) q.hudCv = document.createElement('canvas');
        if (q.hudCv.width !== W || q.hudCv.height !== H || !q.hudCtx) { q.hudCv.width = W; q.hudCv.height = H; q.hudCtx = q.hudCv.getContext('2d'); }
        // callouts: each picks its cell once (from its start time alone), then follows the zoom
        const sTopAt = (time) => { const p = time * fps, ff = Math.min(n - 1, Math.floor(p)); return (frames[ff][0] + (smooth ? (p - ff) * QUAD_GROW : 0)) * k; };
        const callouts = [], gap = (loop - 0.5 - QUAD_CALLOUT_LIFE) / (QUAD_CALLOUTS - 1);
        for (let c = 0; c < QUAD_CALLOUTS; c++) {
          const start = 0.25 + c * gap, age = tt - start;
          if (age < 0 || age > QUAD_CALLOUT_LIFE) continue;
          const key = c + ':' + W + 'x' + H + ':' + smooth;
          if (!(key in q.sel)) {
            const d = 1 + (ghash(c * 7 + 3) % 2), sS = sTopAt(start), sE = sTopAt(start + QUAD_CALLOUT_LIFE);
            const ncE = Math.max(1, Math.floor(QUAD_REF / frames[Math.min(n - 1, Math.floor((start + QUAD_CALLOUT_LIFE) * fps))][0]));
            // only cells that really are nodes of the tree when the callout opens (split at least to depth d)
            const tS = decodeQuadFrame(frames[Math.min(n - 1, Math.floor(start * fps))]), spanS = (1 << tS.dmax) >> d;
            const isNode = (i, j) => {
              if ((i + 1) * spanS > tS.N || (j + 1) * spanS > tS.N) return false;
              for (let y = j * spanS; y < (j + 1) * spanS; y += Math.max(1, spanS >> 2)) for (let xx = i * spanS; xx < (i + 1) * spanS; xx += Math.max(1, spanS >> 2)) if ((tS.D[y * tS.N + xx] >> 5) < d) return false;
              return true;
            };
            const cand = [];
            for (let j = 0; j < (ncE << d); j++) for (let i = 0; i < (ncE << d); i++) {
              const zS = sS / (1 << d), zE = sE / (1 << d);
              if (offPx + i * zS < 60 * uk || offPx + j * zS < 50 * uk) continue;
              if (offPx + (i + 1) * zE > W - 320 * uk || offPx + (j + 1) * zE > H - 180 * uk) continue;
              if (isNode(i, j)) cand.push([i, j]);
            }
            q.sel[key] = cand.length ? { d, i: cand[ghash(c * 13 + 5) % cand.length][0], j: cand[ghash(c * 13 + 5) % cand.length][1] } : null;
          }
          const sl = q.sel[key];
          if (!sl) continue;
          const size = sRef * k / (1 << sl.d), cur = q.cur, per = 1 << cur.dmax, span2 = per >> sl.d;
          // what the cell holds in this frame: one leaf, or how many and how deep
          let leaves = 0, maxD = 0, minD = 99;
          if ((sl.i + 1) * span2 <= cur.N && (sl.j + 1) * span2 <= cur.N) {
            for (let y = sl.j * span2; y < (sl.j + 1) * span2; y++) for (let xx = sl.i * span2; xx < (sl.i + 1) * span2; xx++) {
              const dd = cur.D[y * cur.N + xx] >> 5; leaves += 1 / Math.pow(4, cur.dmax - dd); maxD = Math.max(maxD, dd); minD = Math.min(minD, dd);
            }
          }
          leaves = Math.round(leaves);
          const info = minD < sl.d ? 'MERGED → D' + minD : leaves <= 1 ? 'LEAF · SOLID' : 'SPLIT ×' + leaves + ' → D' + maxD;
          let path = ''; for (let l = sl.d - 1; l >= 0; l--) path += String(((sl.i >> l) & 1) + 2 * ((sl.j >> l) & 1));
          callouts.push({ age, d: sl.d, size, x: offPx + sl.i * size, y: offPx + sl.j * size,
                          name: 'CELL ' + String.fromCharCode(65 + ((sl.i >> sl.d) % 26)) + ((sl.j >> sl.d) + 1) + '.' + path,
                          info });
        }
        // every big box (a leaf at least minBox px across) gets its name and numbers printed inside
        const boxes = [], minBox = 54 * uk, sTop = sRef * k, ncX = wide ? full(q.cur) : q.cur.nTop, n2 = full(q.side);
        for (let ty = 0; offPx + ty * sTop < H; ty++) for (let tx = 0; offPx + tx * sTop < W; tx++) {
          const m = tx >= ncX ? q.side : q.cur, sx = tx >= ncX ? (tx - ncX) % n2 : tx, sy = tx >= ncX ? ty % n2 : (ty >= ncX ? ty % ncX : ty);
          if (sx >= m.nTop || sy >= m.nTop) continue;
          const per = 1 << m.dmax;
          const rec = (d, i, j, path) => {
            const size = sTop / (1 << d);
            if (size < minBox) return;
            const dep = m.D[(sy * per + j * (per >> d)) * m.N + sx * per + i * (per >> d)] >> 5;
            if (dep === d) {
              const bx = offPx + tx * sTop + i * size, by = offPx + ty * sTop + j * size;
              if (bx < W && by < H) boxes.push({ x: bx, y: by, size, d, name: String.fromCharCode(65 + (tx % 26)) + (ty + 1) + (path ? '.' + path : ''), id: ghash(tx * 977 + ty * 131 + d * 17 + i * 7 + j) });
              return;
            }
            for (let c = 0; c < 4; c++) rec(d + 1, i * 2 + (c & 1), j * 2 + (c >> 1), path + c);
          };
          rec(0, 0, 0, '');
        }
        const leavesAll = q.counts.reduce((a, b) => a + b, 0);
        drawQuadHud(q.hudCtx, { W, H, uk, loop, tau: tt / loop, off: offPx, sTop: sRef * k, f, nFrames: n, zoom: sRef / frames[0][0], leaves: leavesAll,
                                counts: q.counts, dmax: q.cur.dmax, minPx: sRef * k / (1 << q.cur.dmax), callouts, fxOn, boxes, minBox, tagged: boxes.length });
        gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, q.hudTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, q.hudCv);
        gl.uniform1i(u.uHud, 3);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0);
    }
    // gel lanes: the traced components as a float texture (decoded once), then per frame: the glow along
    // each lane (one texel per frame row), the lanes themselves, a two-size bloom, and the final colours
    let gel = null;
    const gelEnc = hasFloat ? 1 : 8;   // 8-bit fallback targets hold energy / 8
    function ensureGel() {
      const D = global.BEAM_LOOP_GEL;
      if (!D) return null;
      if (!gel) {
        const bin = atob(D.comps), maxN = Math.max(...D.counts), nl = D.counts.length;
        const data = new Float32Array(maxN * nl * 4);
        let o = 0;
        D.counts.forEach((n, li) => {
          for (let k = 0; k < n; k++, o += 6) {
            const b = (i) => bin.charCodeAt(o + i);
            data.set([((b(0) << 8) | b(1)) / 2, Math.pow(64, b(2) / 255), 0.01 * Math.pow(1000, b(3) / 255), b(4) + 256 * b(5)], (li * maxN + k) * 4);
          }
          // mark the cores (+ 65536): each band's strongest component, and the thin white-hot lines;
          // with gelSharp they draw as crisp saber lines
          const best = new Map();
          for (let k = 0; k < n; k++) {
            const i = (li * maxN + k) * 4, code = data[i + 3] % 256, band = code & 127;
            if (code >= 128) { if (data[i + 1] <= 8) data[i + 3] += 65536; continue; }
            if (band === 127 || data[i + 1] > 25) continue;
            if (!best.has(band) || data[best.get(band) + 2] < data[i + 2]) best.set(band, i);
          }
          best.forEach((i) => { data[i + 3] += 65536; });
        });
        const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, maxN, nl, 0, gl.RGBA, gl.FLOAT, data);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        // each band's core, for the overlay's lock-ons: centre, peak energy and height (half-glow), traced px
        const bands = D.counts.map((n, li) => {
          const by = new Map();
          for (let k = 0; k < n; k++) {
            const i = (li * maxN + k) * 4, code = data[i + 3] % 256, b = code & 127;
            if (b === 127) continue;
            if (!by.has(b)) by.set(b, []);
            by.get(b).push([data[i], data[i + 1], data[i + 2]]);
          }
          const out = [];
          by.forEach((cs, b) => {
            const core = cs.filter((c) => c[1] <= 25).sort((p, q) => q[2] - p[2])[0] || cs[0];
            const at = (y) => cs.reduce((sum, c) => sum + c[2] * Math.exp(-0.5 * ((y - c[0]) / c[1]) ** 2), 0);
            const E = at(core[0]); let up = 0, dn = 0;
            while (up < 80 && at(core[0] - up) > E / 2) up++;
            while (dn < 80 && at(core[0] + dn) > E / 2) dn++;
            out.push({ b, y: core[0], E, h: up + dn });
          });
          return out;
        });
        const mkTex = (filter) => {
          const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          return t;
        };
        gel = { D, tex, maxN, data, prof: null, bands, bandTex: mkTex(gl.NEAREST), bandKey: '', rows: [], hudTex: mkTex(gl.LINEAR), hudCv: null, hudCtx: null, ex: null };
      }
      return gel;
    }
    // a lane's glow (green-channel energy, white included) at traced height y, as the shader draws it
    // (soft profile): feeds the overlay's scope trace and level meters
    function gelLaneEnergy(g, i, src, off, y, tau, flow, migrate, pulse) {
      const D = g.D, P0 = D.height, row = g.rows[i], base = g.maxN * src * 4;
      let e = D.lanes[src][2];
      for (let k = 0; k < D.counts[src]; k++) {
        const j = base + k * 4, sg = g.data[j + 1], b = (g.data[j + 3] % 256) & 127;
        const wraps = flow + migrate * row[b * 4];
        let d = y - (g.data[j] + off + wraps * P0 * tau); d -= P0 * Math.round(d / P0);
        if (Math.abs(d) > 4 * sg) continue;
        let a = g.data[j + 2] * (1 + pulse * 0.16 * (Math.sin(6.2832 * row[b * 4 + 1] * tau + row[b * 4 + 2]) - Math.sin(row[b * 4 + 2])));
        if (row[b * 4 + 3] >= 0) { const dt = ((tau - row[b * 4 + 3] + 1.5) % 1) - 0.5; a *= 1 + pulse * 1.8 * Math.exp(-dt * dt / 2.88e-4); }
        e += a * Math.exp(-0.5 * d * d / (sg * sg));
      }
      return e;
    }
    function blurH(src, dst, sigma, thr) {   // one horizontal pass (light streaks); thr: only light above it
      gl.useProgram(progBlur4.p); const u = progBlur4.u;
      gl.uniform1i(u.uSrc, 0); gl.uniform1f(u.uSigma, Math.max(0.3, sigma)); gl.uniform1f(u.uThr, thr || 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.f); gl.viewport(0, 0, dst.w, dst.h);
      gl.bindTexture(gl.TEXTURE_2D, src.t); gl.uniform2f(u.uRes, dst.w, dst.h); gl.uniform2f(u.uDir, 1, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    function blur4(src, tmp, dst, sigma) {   // sigma in the destination's px
      gl.useProgram(progBlur4.p); const u = progBlur4.u;
      gl.uniform1i(u.uSrc, 0); gl.uniform1f(u.uSigma, Math.max(0.3, sigma)); gl.uniform1f(u.uThr, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, tmp.f); gl.viewport(0, 0, tmp.w, tmp.h);
      gl.bindTexture(gl.TEXTURE_2D, src.t); gl.uniform2f(u.uRes, tmp.w, tmp.h); gl.uniform2f(u.uDir, 1, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.f); gl.viewport(0, 0, dst.w, dst.h);
      gl.bindTexture(gl.TEXTURE_2D, tmp.t); gl.uniform2f(u.uRes, dst.w, dst.h); gl.uniform2f(u.uDir, 0, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    function renderGel(t) {
      const g = ensureGel(), bg = parseHex(P.background) || [0, 0, 0];
      gl.activeTexture(gl.TEXTURE0);
      if (!g) {   // data not loaded yet: the backdrop
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
        gl.clearColor(bg[0] / 255, bg[1] / 255, bg[2] / 255, 1); gl.clear(gl.COLOR_BUFFER_BIT); return;
      }
      const D = g.D, nl = D.lanes.length, R = D.ruler;
      const n = Math.max(1, Math.min(48, Math.round(P.gelLanes || nl)));
      // the traced lanes repeat every D.repeat px; the frame's width holds the lanes, the ruler and the margin
      const edge = (i) => { const l = D.lanes[i % nl], r = Math.floor(i / nl) * D.repeat; return [l[0] + r, l[1] + r]; };
      const right = edge(n - 1)[1], s = W / (right + D.margin);
      if (!g.prof || g.prof.w !== n || g.prof.h !== H) {
        if (g.prof) { gl.deleteTexture(g.prof.t); gl.deleteFramebuffer(g.prof.f); }
        g.prof = target(n, H);
      }
      const tau = (((t / GEL_LOOP) % 1) + 1) % 1, mode = P.gelMotion || 'migrate';
      const lanes = new Float32Array(48 * 4), edges = new Float32Array(48 * 4), cols = new Float32Array(48 * 4);
      const M = gelRecolor(D, P.color), custom = !!parseHex(P.color);
      const midHue = hueOf(gelRgb(D, gelRhoAt(D, (nl - 1) / 2)));
      for (let i = 0; i < n; i++) {
        const src = i % nl, rep = Math.floor(i / nl), l = D.lanes[src];
        // repeated lanes start from another height, so neighbours never match
        lanes.set([src + nl * rep, (rep * D.height * 0.381966) % D.height, l[3], l[2]], i * 4);
        // the green-to-yellow spread always runs across the whole frame: turn each lane's hues to its place;
        // with a chosen colour the spread narrows to about half, so that colour leads
        const f = n > 1 ? (i / (n - 1)) * (nl - 1) : (nl - 1) / 2, rho = gelRhoAt(D, f), h = hueOf(gelRgb(D, rho));
        const turn = h - hueOf(gelRgb(D, l[3])) - (custom ? GEL_NARROW * (h - midHue) : 0);
        const e = edge(i); edges.set([e[0], e[1], Math.abs(turn) < 1e-6 ? 0 : turn, 0], i * 4);
        const q = app3(YIQ, gelRgb(D, rho)), a = custom ? -GEL_NARROW * (h - midHue) : 0;
        const turned = app3(YIQ_INV, [q[0], Math.cos(a) * q[1] - Math.sin(a) * q[2], Math.sin(a) * q[1] + Math.cos(a) * q[2]]);
        const c = app3(M, turned).map((v) => Math.max(0.01, v)), cm = Math.max(...c);
        cols.set([c[0] / cm, c[1] / cm, c[2] / cm, 0], i * 4);
      }
      // each shown lane's band motions (rebuilt when the lane count changes)
      if (g.bandKey !== String(n)) {
        g.bandKey = String(n); g.rows = [];
        const all = new Float32Array(128 * n * 4);
        for (let i = 0; i < n; i++) { const row = gelBandRow(i % nl + nl * Math.floor(i / nl)); g.rows.push(row); all.set(row, i * 512); }
        gl.bindTexture(gl.TEXTURE_2D, g.bandTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 128, n, 0, gl.RGBA, gl.FLOAT, all);
      }
      // 1. glow along each lane
      gl.bindFramebuffer(gl.FRAMEBUFFER, g.prof.f); gl.viewport(0, 0, n, H);
      gl.useProgram(progGelProf.p); let u = progGelProf.u;
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, g.bandTex); gl.uniform1i(u.uBandP, 1);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, g.tex); gl.uniform1i(u.uComp, 0);
      gl.uniform4fv(u['uLane[0]'], lanes);
      gl.uniform1f(u.uMax, g.maxN); gl.uniform1f(u.uScale, s); gl.uniform1f(u.uTau, tau); gl.uniform1f(u.uP, D.height);
      const flow = mode === 'still' ? 0 : 1, migrate = mode === 'migrate' ? 1 : 0;
      gl.uniform1f(u.uFlow, flow); gl.uniform1f(u.uMigrate, migrate);
      gl.uniform1f(u.uPulse, P.gelPulse === false ? 0 : 1); gl.uniform1f(u.uFlare, P.gelPulse === false ? 0 : 1);
      const sharp = Math.max(0, Math.min(1, P.gelSharp == null ? 1 : P.gelSharp));
      gl.uniform1f(u.uSharp, sharp); gl.uniform1f(u.uEdgeW, 1.1 / s);   // ~1 px edges: crisp but anti-aliased
      gl.uniform1f(u.uEnc, gelEnc);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // 2. the lanes, with the scan light (4 passes per loop)
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.field.f); gl.viewport(0, 0, W, H);
      gl.useProgram(progGel.p); u = progGel.u;
      gl.bindTexture(gl.TEXTURE_2D, g.prof.t); gl.uniform1i(u.uProf, 0);
      gl.uniform4fv(u['uEdge[0]'], edges); gl.uniform4fv(u['uCol[0]'], cols);
      gl.uniformMatrix3fv(u.uM, false, [M[0], M[3], M[6], M[1], M[4], M[7], M[2], M[5], M[8]]);   // column-major
      gl.uniform2f(u.uBeta, D.beta[0], D.beta[1]);
      gl.uniform1f(u.uN, n); gl.uniform1f(u.uScale, s); gl.uniform1f(u.uRows, H);
      // sharper lanes: crisp blade ends instead of the still's soft lane edges
      gl.uniform1f(u.uSigIn, P.gelEdgeIn + (2.2 - P.gelEdgeIn) * sharp); gl.uniform1f(u.uSigOut, P.gelEdgeOut + (1.1 - P.gelEdgeOut) * sharp);
      gl.uniform1f(u.uEnc, gelEnc);
      const hl = P.color ? Math.max(0, Math.min(1, P.highlight == null ? 1 : P.highlight)) : 1;
      gl.uniform1f(u.uWhite, hl);
      const scanW = 70 * s, travel = H + 8 * scanW, scanY = ((tau * 4) % 1) * travel - 4 * scanW;
      gl.uniform1f(u.uScan, P.gelScan === false ? 0 : P.gelScanAmt);
      gl.uniform1f(u.uScanY, scanY); gl.uniform1f(u.uScanW, scanW);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // 2b. ethereal glow: floating light motes, added to the glow so they bloom too
      const ether = Math.max(0, P.gelEther == null ? 1 : P.gelEther), k = Math.min(W / 1920, H / 1080);
      if (ether > 0) {
        gl.useProgram(progMotes.p); u = progMotes.u;
        gl.uniform1f(u.uTau, tau); gl.uniform1f(u.uK, k); gl.uniform1f(u.uAmt, Math.min(1.5, ether)); gl.uniform1f(u.uEnc, gelEnc);
        gl.uniform3f(u.uColA, cols[0], cols[1], cols[2]); gl.uniform3f(u.uColB, cols[(n - 1) * 4], cols[(n - 1) * 4 + 1], cols[(n - 1) * 4 + 2]);
        gl.bindVertexArray(vaoNone);
        gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);   // add light, keep the lane mask
        gl.drawArrays(gl.POINTS, 0, GEL_MOTES);
        gl.disable(gl.BLEND); gl.bindVertexArray(vaoMain);
      }
      // 3. bloom: a 4 x 4 average, then a tight and a wide blur
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.b1b.f); gl.viewport(0, 0, T.b1b.w, T.b1b.h);
      gl.useProgram(progDown4.p); u = progDown4.u;
      gl.bindTexture(gl.TEXTURE_2D, T.field.t); gl.uniform1i(u.uSrc, 0); gl.uniform2f(u.uSrcRes, W, H);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // ethereal glow: long horizontal streaks from the brightest light (two passes, so they stay smooth)
      if (!g.ex || g.ex.w !== W || g.ex.h !== H) {
        if (g.ex) ['s1', 's2', 'a1', 'a2'].forEach((key) => { gl.deleteTexture(g.ex[key].t); gl.deleteFramebuffer(g.ex[key].f); });
        g.ex = { w: W, h: H, s1: target(T.b1b.w, T.b1b.h), s2: target(T.b1b.w, T.b1b.h), a1: target(T.b2b.w, T.b2b.h), a2: target(T.b2b.w, T.b2b.h) };
      }
      if (ether > 0) {
        blurH(T.b1b, g.ex.s1, 30 * s * T.b1b.w / W, 1.8 / gelEnc);
        blurH(g.ex.s1, g.ex.s2, 120 * s * T.b1b.w / W, 0);
      }
      blur4(T.b1b, T.b1a, T.b1b, P.gelBloomR * s * T.b1b.w / W);
      blur4(T.b1b, T.b2a, T.b2b, P.gelBloomR2 * s * T.b2b.w / W);
      // ethereal glow: a very wide, slowly breathing aura
      if (ether > 0) blur4(T.b2b, g.ex.a1, g.ex.a2, 220 * s * T.b2b.w / W);
      // 4. out
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
      gl.useProgram(progGelOut.p); u = progGelOut.u;
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.field.t); gl.uniform1i(u.uF, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, T.b1b.t); gl.uniform1i(u.uB1, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, T.b2b.t); gl.uniform1i(u.uB2, 2);
      const glow = Math.max(0, P.gelGlow == null ? 1 : P.gelGlow);
      // glow 1 = the still's own spill; more adds a tight halo around the bright bands as well
      // (sharp cores get a tight halo too, like a saber's glow)
      gl.uniform2f(u.uRes, W, H); gl.uniform1f(u.uK1, P.gelBloom * glow + 0.15 * Math.max(0, glow - 1) + 0.16 * sharp * glow); gl.uniform1f(u.uK2, P.gelBloom2 * glow);
      gl.uniform1f(u.uEnc, gelEnc);
      gl.uniform1f(u.uHl, hl);
      const tc = parseHex(P.color), tmax = tc ? Math.max(...tc, 1) / 255 : 1;
      gl.uniform1f(u.uFlatK, -Math.log(1 - Math.min(0.985, Math.max(0.05, tmax)))); gl.uniform1f(u.uFlatMax, tmax);
      gl.uniform1f(u.uRulerOn, P.gelRuler === false ? 0 : 1); gl.uniform1f(u.uLevel, R.level);
      gl.uniform4f(u.uRule, (right + R.x) * s, Math.max(1, R.w * s), R.top * s, H - R.bottom * s);
      gl.uniform1f(u.uStep, R.step * s); gl.uniform1f(u.uMinor, R.minor * s); gl.uniform1f(u.uLong, R.long * s); gl.uniform1f(u.uTickW, Math.max(1, s));
      gl.uniform3f(u.uBg, bg[0] / 255, bg[1] / 255, bg[2] / 255);
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, g.ex.s2.t); gl.uniform1i(u.uStreakT, 4);
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, g.ex.a2.t); gl.uniform1i(u.uAuraT, 5);
      gl.uniform1f(u.uStreak, 0.22 * ether); gl.uniform1f(u.uAura, 0.14 * ether * (1 + 0.3 * Math.sin(6.2832 * 2 * tau)));
      // tech effects: the overlay (scanner, lock-ons, lane numbers, grid, status line) and glitch bursts
      const hudOn = P.gelHud !== false;
      if (hudOn) {
        if (!g.hudCv) { g.hudCv = document.createElement('canvas'); }
        if (g.hudCv.width !== W || g.hudCv.height !== H || !g.hudCtx) { g.hudCv.width = W; g.hudCv.height = H; g.hudCtx = g.hudCv.getContext('2d'); }
        const shown = []; for (let i = 0; i < n; i++) { const e = edge(i); shown.push({ x0: e[0], x1: e[1], src: i % nl, code: i % nl + nl * Math.floor(i / nl), off: lanes[i * 4 + 1] }); }
        const o = { W, H, s, k, tau, lanes: shown, bands: g.bands, rows: g.rows, P: D.height, flow, migrate, travel, scanW, scanY,
                    scanOn: P.gelScan !== false, rulerX: (right + R.x) * s, rulerTop: R.top * s, rulerBottom: H - R.bottom * s, step: R.step * s };
        o.locks = gelLocks(o);
        // the scanner's reading: each lane's glow on the scan line (for the scope trace and level meters)
        const pulse = P.gelPulse === false ? 0 : 1;
        o.scanE = shown.map((l, i) => gelLaneEnergy(g, i, l.src, l.off, Math.max(0, scanY) / s, tau, flow, migrate, pulse));
        o.flares = gelFlares(o);
        o.cursor = gelCursor(o);
        // minimap of the whole gel strip (the traced still, in the overlay's white), made once per size
        const mKey = n + ':' + Math.round(k * 100);
        if (!g.mini || g.mini.key !== mKey) {
          const mw = Math.round(104 * k), mh = Math.round(140 * k), cv = document.createElement('canvas'); cv.width = mw; cv.height = mh;
          const mx = cv.getContext('2d'), sx = mw / (right - shown[0].x0 + 4);
          shown.forEach((l, i) => {
            const x0 = Math.round((l.x0 - shown[0].x0 + 2) * sx), x1 = Math.max(x0 + 1, Math.round((l.x1 - shown[0].x0 + 2) * sx));
            for (let r = 0; r < mh; r++) {
              const e = gelLaneEnergy(g, i, l.src, l.off, (r + 0.5) / mh * D.height, 0, 0, 0, 0);
              mx.fillStyle = 'rgba(255,255,255,' + (1 - Math.exp(-0.9 * e)).toFixed(3) + ')'; mx.fillRect(x0, r, x1 - x0, 1);
            }
          });
          g.mini = cv; g.mini.key = mKey;
        }
        o.mini = g.mini;
        drawGelHud(g.hudCtx, o);
        gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, g.hudTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, g.hudCv);
        gl.uniform1i(u.uHud, 3);
        // tint: a pale version of the lanes' colour (the chosen colour itself when flat)
        const base = parseHex(P.color) || parseHex(GEL_COLOR), w = hl ? 0.6 : 0;
        gl.uniform3f(u.uHudCol, ...base.map((v) => (v + (255 - v) * w) / 255));
      }
      gl.uniform1f(u.uHudOn, hudOn ? 1 : 0);
      let gAmt = 0, gSeed = 0;
      if (P.gelGlitch !== false) {
        const tt = tau * GEL_LOOP;
        for (const b of GEL_GLITCH) if (Math.abs(tt - b.at) < b.len / 2) { gAmt = b.amt; gSeed = (Math.floor(tt * 20) % 997) + b.at; }
      }
      gl.uniform1f(u.uGlitch, gAmt); gl.uniform1f(u.uGSeed, gSeed); gl.uniform1f(u.uUnitK, Math.max(0.5, k));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0);
    }
    function renderGlyph(t) {
      const g = ensureGlyph();
      if (g.cv.width !== W || g.cv.height !== H || !g.ctx) { g.cv.width = W; g.cv.height = H; g.ctx = g.cv.getContext('2d'); }
      const LH = 1080 * (P.glyphScale || 1), s = H / LH, lw = LH * W / H;   // [Ultra.sh] glyphScale
      g.field.stepTo(t, pointer, !!P.reduceMotion, lw, LH);
      // [Ultra.sh] the cursor's tags and readout read at 8 CSS px at most (and never larger than 80% of a cell)
      const cssPerUnit = s * ((canvas.clientWidth || W) / W), textPx = Math.min(P.glyphTextPx || 8, 32 * cssPerUnit);
      g.field.draw(g.ctx, s, {
        glow: !!P.glyphGlow, glowMode: P.glyphGlowMode, glowAmt: P.glyphGlowAmt, glowRad: P.glyphGlowRad, glowNear: P.glyphGlowNear,
        hud: P.glyphHud !== false, fps: fpsEst, pointer, cursor: P.glyphCursor, readout: P.glyphReadout !== false,
        textK: textPx / (12 * cssPerUnit)
      });
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, g.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, g.cv);
      gl.useProgram(progGlyph.p); const u = progGlyph.u;
      gl.uniform1i(u.uTex, 0); gl.uniform2f(u.uRes, W, H);
      const col = parseHex(P.color) || parseHex(GLYPH_COLOR), bg = parseHex(P.background) || [0, 0, 0];
      gl.uniform3f(u.uCol, col[0] / 255, col[1] / 255, col[2] / 255); gl.uniform3f(u.uBg, bg[0] / 255, bg[1] / 255, bg[2] / 255);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    function renderHero() {
      if (global.BEAM_LOOP_HERO) ensureHero();   // until hero-video.js arrives, draw the black backdrop
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
      const v = hero && hero.video;
      // upload when a new frame may be showing (a frame callback fired, a seek finished, or the clock moved)
      if (hero && hero.loaded && v.readyState >= 2 && (hero.dirty || v.currentTime !== hero.lastTime)) {
        gl.bindTexture(gl.TEXTURE_2D, hero.tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
        hero.vw = v.videoWidth; hero.vh = v.videoHeight; hero.lastTime = v.currentTime; hero.dirty = false;
      }
      const D = global.BEAM_LOOP_HERO || {}, vw = (hero && hero.vw) || D.width || 2880, vh = (hero && hero.vh) || D.height || 1248;
      // fit the whole clip in the frame (its black surround blends into the frame); 'cover' fills instead
      const scale = P.heroFit === 'cover' ? Math.max(W / vw, H / vh) : Math.min(W / vw, H / vh);
      gl.useProgram(progHero.p); const u = progHero.u;
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, hero ? hero.tex : null); gl.uniform1i(u.uVideo, 0);
      gl.uniform2f(u.uRes, W, H); gl.uniform2f(u.uVid, vw, vh); gl.uniform1f(u.uScale, scale);
      const rc = heroRecolor(P.color);
      gl.uniform1f(u.uRecolor, rc ? 1 : 0);
      if (rc) {
        gl.uniform2f(u.uRefDir, rc.ref[0], rc.ref[1]); gl.uniform2f(u.uTgtDir, rc.tgt[0], rc.tgt[1]); gl.uniform1f(u.uSat, rc.sat);
        const tc = parseHex(P.color); gl.uniform3f(u.uTgt, tc[0] / 255, tc[1] / 255, tc[2] / 255);
        const hl = Math.max(0, Math.min(1, P.highlight == null ? 1 : P.highlight));
        gl.uniform1f(u.uHighlight, hl); gl.uniform1f(u.uDuoGamma, duoGamma(hl, P.contrast));
      }
      const bg = parseHex(P.background) || [0, 0, 0];
      gl.uniform3f(u.uBg, bg[0] / 255, bg[1] / 255, bg[2] / 255);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    function renderAt(t, grainT) {
      if (grainT === undefined) grainT = t;
      lastT = t; lastG = grainT;
      fit();
      // the glyph field draws its own cursor
      if (P.interactive !== false) { canvas.style.cursor = isGlyph() ? (P.glyphCursor === 'system' ? 'default' : 'none') : ''; canvas.style.touchAction = isGlyph() ? 'none' : ''; }
      if (isGel()) return renderGel(t);
      if (isQuad()) return renderQuad(t);
      if (isGlyph()) return renderGlyph(t);
      if (isHero()) return renderHero();
      if (isGlitch()) return renderGlitch(t, grainT);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.field.f); gl.viewport(0, 0, W, H);
      gl.useProgram(progField.p); let u = progField.u;
      const set = (n, v) => { if (u[n]) gl.uniform1f(u[n], v); };
      gl.uniform2f(u.uRes, W, H); set('uUnit', unit()); set('uTime', t);
      set('uPeriod', P.period); set('uN', P.n); set('uD0', P.d0); set('uDref', P.dref); set('uSref', P.sref);
      set('uH', P.h); set('uL', P.L); set('uW', P.w); set('uDelta', Math.max(1e-4, P.delta)); set('uNb', P.nb); set('uBf', P.bf);
      set('uFadeA', P.fadeA); set('uFadeW', Math.max(1e-3, P.fadeW)); set('uFog', P.fog);
      set('uC', P.c); set('uDens', P.dens); set('uMu', Math.max(0.02, P.mu)); set('uWin', P.win);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      blur(T.field, T.b1a, T.b1b, P.bloomR);
      blur(T.field, T.b2a, T.b2b, P.bloomR2);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
      gl.useProgram(progOut.p); u = progOut.u;
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.field.t); gl.uniform1i(u.uF, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, T.b1b.t); gl.uniform1i(u.uB1, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, T.b2b.t); gl.uniform1i(u.uB2, 2);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, lut); gl.uniform1i(u.uLut, 3);
      gl.uniform2f(u.uRes, W, H); gl.uniform1f(u.uGrainT, grainT % 1000);
      gl.uniform1f(u.uGainR, P.gainR); gl.uniform1f(u.uBloom, P.bloom * P.gainR); gl.uniform1f(u.uBloom2, P.bloom2 * P.gainR);
      gl.uniform1f(u.uFloor, P.floor); gl.uniform1f(u.uGrain, P.grain);
      // grain cell in whole pixels, scaled like the clip's grain (1 px in its 500 px frame -> 2 px at 1080)
      gl.uniform1f(u.uCell, Math.max(1, Math.round(Math.min(W, H) / 540)));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0);
    }

    // animation clock: advances by speed x real time, so speed changes never jump; wrapped every
    // 1000 loops to keep shader floats precise (the loop itself is seamless)
    let raf = 0, prev = 0, animT = 0;
    const loop = (now) => {
      const dt = prev ? Math.min(0.25, (now - prev) / 1000) : 0; prev = now;   // cap: no jump after a long stall
      if (dt > 0) fpsEst += (1 / Math.max(dt, 1e-3) - fpsEst) * .05;   // shown in the glyph field's readout
      if (!P.paused) animT = (animT + dt * Math.max(0, P.speed)) % (periodOf() * 1000);
      if (isHero() && hero && hero.loaded) animT = hero.video.currentTime;   // the clip keeps its own time
      syncHero(true);
      renderAt(animT, now / 1000);
      raf = requestAnimationFrame(loop);
    };
    function set(o) {
      Object.assign(P, o || {});
      if (o && ('color' in o || 'background' in o || 'pattern' in o || 'highlight' in o || 'contrast' in o)) {
        gl.bindTexture(gl.TEXTURE_2D, lut);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lutData());
      }
      if (o && 'pattern' in o) {   // start the newly chosen clip from its first frame
        animT = 0;
        if (hero && isHero()) { hero.video.currentTime = 0; hero.dirty = true; }
      }
      syncHero(!!raf);
      if (!raf) renderAt(lastT, lastG);   // stopped (e.g. reduced motion): show the change at once
    }
    // the frame on screen as an image (re-drawn first, so it works without preserveDrawingBuffer)
    function snapshot(type) {
      renderAt(lastT, lastG);
      return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('snapshot failed'))), type || 'image/png'));
    }
    return {
      params: P,
      canvas,
      renderAt,
      set,
      whenReady,
      prepareFrame,        // await before renderAt(t) when drawing exact frames (export, comparisons, stills)
      snapshot,
      time: () => animT,   // current animation time in seconds (loops every period)
      video: () => (hero ? hero.video : null),   // the hero clip's <video>, once created
      period: periodOf,    // current pattern's loop length in seconds at speed 1
      start() { if (!raf) { prev = 0; raf = requestAnimationFrame(loop); } },
      stop() { cancelAnimationFrame(raf); raf = 0; syncHero(false); },
      destroy() {
        cancelAnimationFrame(raf); raf = 0;
        if (hero) { hero.video.pause(); hero.video.removeAttribute('src'); hero.video.load(); }
        const x = gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext();
      }
    };
  }
  global.createBeamLoop = createBeamLoop;
})(window);
