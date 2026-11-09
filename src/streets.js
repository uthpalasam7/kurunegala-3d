// Turns mapped roads into a drivable network, traffic-light junctions, sidewalks and zebra crossings.
import { mulberry } from './world.js';

function pointInLake(world, x, z) {
  for (const lake of world.lakes) {
    let inside = false;
    const p = lake.p;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [ax, az] = p[i], [bx, bz] = p[j];
      if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

function rockAt(world, x, z) {
  const i = Math.round((x + world.half) / world.cell), j = Math.round((z + world.half) / world.cell);
  return world.rock[j * world.N + i] || 0;
}

/** Point and unit tangent along a link, measured from where the link starts. */
export function sampleLink(link, s, out) {
  const { edge, dir } = link;
  const d = Math.max(0, Math.min(edge.len, dir > 0 ? s : edge.len - s));
  const { cum, pts } = edge;
  let lo = 0, hi = cum.length - 2;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid - 1; }
  const [ax, az] = pts[lo], [bx, bz] = pts[lo + 1], span = cum[lo + 1] - cum[lo] || 1, t = (d - cum[lo]) / span;
  out.x = ax + (bx - ax) * t; out.z = az + (bz - az) * t;
  out.tx = (bx - ax) / span * dir; out.tz = (bz - az) / span * dir;
  return out;
}

function buildNetwork(world) {
  const skip = new Set(['track', 'path', 'footway', 'steps']);
  const clock = world.landmarks.clock;
  const roads = world.roads.filter(r => r.w >= 5 && !skip.has(r.c));
  const key = ([x, z]) => `${x},${z}`;
  const uses = new Map();
  for (const r of roads) r.p.forEach((pt, i) => {
    uses.set(key(pt), (uses.get(key(pt)) || 0) + ((i === 0 || i === r.p.length - 1) ? 2 : 1));
  });

  const limit = world.half - 34;
  const drivable = (pts) => pts.every(([x, z], i) => {
    if (Math.abs(x) > limit || Math.abs(z) > limit) return false;
    if (rockAt(world, x, z) > 45 || world.heightAt(x, z) > clock.y + 42) return false; // Nothing drives up the rocks.
    if (!i) return true;
    const [px, pz] = pts[i - 1], mx = (x + px) / 2, mz = (z + pz) / 2;
    return rockAt(world, mx, mz) <= 45 && !pointInLake(world, mx, mz);
  });

  const nodes = new Map(), edges = [], links = [];
  const node = (pt) => {
    const k = key(pt);
    if (!nodes.has(k)) nodes.set(k, { x: pt[0], z: pt[1], in: [], out: [], edges: new Set() });
    return nodes.get(k);
  };
  function addEdge(pts, r) {
    if (pts.length < 2 || (!r.temple && !drivable(pts))) return;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const len = cum[cum.length - 1];
    if (len < 1) return;
    const a = node(pts[0]), b = node(pts[pts.length - 1]);
    if (a === b) return;
    const edge = { id: edges.length, pts, cum, len, w: r.w, c: r.c, oneway: !!r.o, temple: !!r.temple };
    edges.push(edge);
    const add = (from, to, dir) => {
      const link = { id: links.length, edge, dir, from, to, len, nexts: [], prevs: [], alive: true, vehicles: [], signal: null };
      links.push(link); from.out.push(link); to.in.push(link);
      from.edges.add(edge); to.edges.add(edge);
    };
    add(a, b, 1);
    if (!r.o) add(b, a, -1);
  }
  for (const r of roads) {
    let start = 0;
    for (let i = 1; i < r.p.length; i++) {
      if (i === r.p.length - 1 || uses.get(key(r.p[i])) > 1) { addEdge(r.p.slice(start, i + 1), r); start = i; }
    }
  }

  for (const pts of world.templeLoop || []) addEdge(pts, { w: 5, c: 'temple', o: 1, temple: true });

  // A turn is legal only if it isn't a U-turn or hairpin.
  const a = {}, b = {};
  for (const n of nodes.values()) for (const inL of n.in) {
    sampleLink(inL, inL.len, a);
    for (const outL of n.out) {
      if (outL.edge === inL.edge) continue;
      sampleLink(outL, 0, b);
      if (a.tx * b.tx + a.tz * b.tz >= -.25) { inL.nexts.push(outL); outL.prevs.push(inL); }
    }
  }

  // Removing every link that leads nowhere means no vehicle ever needs to turn around.
  for (let changed = true; changed;) {
    changed = false;
    for (const l of links) {
      if (!l.alive) continue;
      l.nexts = l.nexts.filter(n => n.alive);
      l.prevs = l.prevs.filter(n => n.alive);
      if (!l.nexts.length || !l.prevs.length) { l.alive = false; changed = true; }
    }
  }

  // Keep the largest connected network.
  const live = links.filter(l => l.alive);
  const seen = new Set();
  let best = [];
  for (const start of live) {
    if (seen.has(start)) continue;
    const group = [], stack = [start];
    seen.add(start);
    while (stack.length) {
      const l = stack.pop();
      group.push(l);
      for (const n of [...l.nexts, ...l.prevs]) if (!seen.has(n)) { seen.add(n); stack.push(n); }
    }
    if (group.length > best.length) best = group;
  }
  const kept = new Set(best);
  for (const l of links) {
    l.alive = kept.has(l);
    l.nexts = l.nexts.filter(n => kept.has(n));
    l.prevs = l.prevs.filter(n => kept.has(n));
  }
  return { links: best, nodes: [...nodes.values()] };
}

function buildSignals(network, world) {
  const clock = world.landmarks.clock;
  const rand = mulberry(515);
  const major = (n) => [...n.edges].filter(e => e.w >= 7).length;
  const candidates = network.nodes.filter(n =>
    (n.in.some(l => l.alive) || n.out.some(l => l.alive)) && n.edges.size >= 3 && major(n) >= 2 &&
    ![...n.edges].some(e => e.c.startsWith('motorway')) && Math.hypot(n.x - clock.x, n.z - clock.z) < 2000);

  // Dual carriageways make one real junction out of several mapped points, so group them.
  const parent = new Map(candidates.map(n => [n, n]));
  const find = (n) => { while (parent.get(n) !== n) n = parent.get(n); return n; };
  for (let i = 0; i < candidates.length; i++) for (let j = 0; j < i; j++) {
    if (Math.hypot(candidates[i].x - candidates[j].x, candidates[i].z - candidates[j].z) < 42) parent.set(find(candidates[i]), find(candidates[j]));
  }
  const groups = new Map();
  for (const n of candidates) { const r = find(n); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(n); }

  const signals = [], p = {};
  for (const members of groups.values()) {
    const inside = new Set(members);
    const approaches = members.flatMap(n => n.in.filter(l => l.alive && !inside.has(l.from)));
    if (approaches.filter(l => l.edge.w >= 7).length < 3) continue; // Only where main roads meet.
    const bearing = (l) => { sampleLink(l, l.len, p); return Math.atan2(p.tx, p.tz); };
    const axis = bearing([...approaches].sort((a, b) => b.edge.w - a.edge.w)[0]);
    const green = 13 + rand() * 7;
    const signal = { green, amber: 3, clear: 2, offset: rand() * 40, approaches: [], node: members };
    for (const link of approaches) {
      const folded = Math.abs(Math.sin(bearing(link) - axis));
      const stopS = link.len > 22 ? link.len - 12 : Math.max(1.5, link.len - 6);
      const approach = { link, phase: folded < .71 ? 0 : 1, stopS, state: null };
      link.signal = { signal, approach };
      signal.approaches.push(approach);
      sampleLink(link, stopS, p);
      Object.assign(approach, { x: p.x, z: p.z, tx: p.tx, tz: p.tz, w: link.edge.w, oneway: link.edge.oneway });
    }
    for (const n of members) n.signal = signal;
    signals.push(signal);
  }
  return signals;
}

/** Evens out the land along each road, so the tarmac runs smoothly instead of copying every bump in the terrain. */
export function flattenRoads(world) {
  const { N, half, cell, heights } = world;
  const protect = new Uint8Array(N * N);
  const guard = (x, z, reach) => {
    const r = Math.ceil(reach / cell), ci = Math.round((x + half) / cell), cj = Math.round((z + half) / cell);
    for (let j = Math.max(0, cj - r); j <= Math.min(N - 1, cj + r); j++) for (let i = Math.max(0, ci - r); i <= Math.min(N - 1, ci + r); i++) protect[j * N + i] = 1;
  };
  for (const r of world.roads) if (r.temple) { r.p.forEach(([x, z]) => guard(x, z, 30)); guard(...r.p[r.p.length - 1], 72); } // That road and car park have their own engineered surface.

  const CORE = cell * 1.45, FADE = cell * 1.5, STEP = 4, RADIUS = 12, PASSES = 3; // CORE reaches every land point around the road.
  const nearest = new Map();
  for (const r of world.roads) {
    if (r.temple || r.w < 4 || ['footway', 'path', 'steps', 'track'].includes(r.c)) continue;
    const pts = [];
    for (let i = 1; i < r.p.length; i++) {
      const [ax, az] = r.p[i - 1], [bx, bz] = r.p[i], len = Math.hypot(bx - ax, bz - az);
      for (let d = 0; d < len; d += STEP) pts.push([ax + (bx - ax) * d / len, az + (bz - az) * d / len]);
    }
    if (pts.length < 2) continue;
    let ys = pts.map(([x, z]) => world.heightAt(x, z));
    for (let p = 0; p < PASSES; p++) ys = ys.map((_, i) => {
      let sum = 0, count = 0;
      for (let k = Math.max(0, i - RADIUS); k <= Math.min(ys.length - 1, i + RADIUS); k++) { sum += ys[k]; count++; }
      return sum / count;
    });
    const reach = r.w / 2 + CORE + FADE;
    pts.forEach(([x, z], p) => {
      for (let j = Math.max(0, Math.floor((z - reach + half) / cell)); j <= Math.min(N - 1, Math.ceil((z + reach + half) / cell)); j++) {
        for (let i = Math.max(0, Math.floor((x - reach + half) / cell)); i <= Math.min(N - 1, Math.ceil((x + reach + half) / cell)); i++) {
          const k = j * N + i;
          if (protect[k]) continue;
          const d = Math.max(0, Math.hypot(-half + i * cell - x, -half + j * cell - z) - r.w / 2), best = nearest.get(k);
          if (d < CORE + FADE && (!best || d < best.d)) nearest.set(k, { d, y: ys[p] });
        }
      }
    });
  }
  for (const [k, { d, y }] of nearest) {
    if (heights[k] < y - 3) continue; // Low ground such as the lake bed is left alone, so shorelines don't move.
    heights[k] += (y - heights[k]) * (1 - Math.max(0, (d - CORE) / FADE));
  }
  // Relax the road land against its neighbours, which also evens out where roads of different heights meet.
  const core = [...nearest].filter(([k, { d, y }]) => d < CORE && heights[k] >= y - 3 && k > N && k < N * N - N - 1).map(([k]) => k);
  for (let pass = 0; pass < 4; pass++) {
    const next = core.map(k => heights[k] * .4 + (heights[k - 1] + heights[k + 1] + heights[k - N] + heights[k + N]) * .15);
    core.forEach((k, i) => { heights[k] = next[i]; });
  }
}

function buildSidewalks(world) {
  const clock = world.landmarks.clock;
  const AREA = 1500, SIZE = AREA * 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const X = (x) => x - clock.x + AREA, Z = (z) => z - clock.z + AREA;
  ctx.fillStyle = ctx.strokeStyle = '#fff';
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const r of world.roads) {
    if (r.w < 3.5) continue;
    ctx.beginPath();
    r.p.forEach(([x, z], i) => ctx[i ? 'lineTo' : 'moveTo'](X(x), Z(z)));
    ctx.lineWidth = r.w + .7;
    ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(X(clock.x), Z(clock.z), 10, 0, 7); ctx.fill();

  // Small pockets of land completely enclosed by roads are traffic islands, not places to walk.
  const roadMask = ctx.getImageData(0, 0, SIZE, SIZE).data, ISLAND_AREA = 1200;
  const island = new Uint8Array(SIZE * SIZE), seen = new Uint8Array(SIZE * SIZE), stack = new Int32Array(SIZE * SIZE);
  for (let start = 0; start < SIZE * SIZE; start++) {
    if (seen[start] || roadMask[start * 4 + 3] > 60) continue;
    let top = 0, count = 0, edge = false;
    const cells = [];
    stack[top++] = start; seen[start] = 1;
    while (top) {
      const c = stack[--top], x = c % SIZE, y = (c - x) / SIZE;
      count++;
      if (count <= ISLAND_AREA) cells.push(c);
      if (!x || !y || x === SIZE - 1 || y === SIZE - 1) edge = true;
      for (const n of [x ? c - 1 : -1, x < SIZE - 1 ? c + 1 : -1, y ? c - SIZE : -1, y < SIZE - 1 ? c + SIZE : -1]) {
        if (n >= 0 && !seen[n] && roadMask[n * 4 + 3] <= 60) { seen[n] = 1; stack[top++] = n; }
      }
    }
    if (!edge && count <= ISLAND_AREA) for (const c of cells) island[c] = 1;
  }
  for (const list of [world.buildings.map(b => { const p = []; for (let i = 0; i < b.p.length; i += 2) p.push([b.p[i], b.p[i + 1]]); return p; }), world.lakes.map(l => l.p)]) {
    for (const p of list) { ctx.beginPath(); p.forEach(([x, z], i) => ctx[i ? 'lineTo' : 'moveTo'](X(x), Z(z))); ctx.closePath(); ctx.fill(); }
  }
  const px = ctx.getImageData(0, 0, SIZE, SIZE).data;
  const blocked = (x, z) => {
    const i = X(x) | 0, j = Z(z) | 0;
    if (i < 0 || j < 0 || i >= SIZE || j >= SIZE) return true;
    return island[j * SIZE + i] || px[(j * SIZE + i) * 4 + 3] > 60 || rockAt(world, x, z) > 45;
  };

  const sidewalks = [];
  function finish(points, road, side, previous) {
    if (points.length < 7) return previous;
    const cum = [0];
    for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    const seg = { pts: points, cum, len: cum[cum.length - 1], w: road.w, temple: !!road.temple, crossings: [], hopStart: null, hopEnd: null };
    sidewalks.push(seg);
    if (previous) {
      const [ex, ez] = previous.pts[previous.pts.length - 1], [sx, sz] = points[0];
      const gap = Math.hypot(sx - ex, sz - ez);
      if (gap > 1 && gap < 15) { previous.hopEnd = { seg, s: 0, x0: ex, z0: ez, x1: sx, z1: sz }; seg.hopStart = { seg: previous, s: previous.len, x0: sx, z0: sz, x1: ex, z1: ez }; }
    }
    return seg;
  }

  for (const r of world.roads) {
    if (r.w < 5 || r.c.startsWith('motorway') || r.c === 'track') continue;
    if (!r.p.some(([x, z]) => Math.hypot(x - clock.x, z - clock.z) < AREA - 40)) continue;
    const samples = [];
    for (let i = 1; i < r.p.length; i++) {
      const [ax, az] = r.p[i - 1], [bx, bz] = r.p[i], len = Math.hypot(bx - ax, bz - az);
      if (len < .01) continue;
      const tx = (bx - ax) / len, tz = (bz - az) / len;
      for (let d = 0; d < len; d += 2) samples.push([ax + tx * d, az + tz * d, tx, tz]);
    }
    for (const side of [1, -1]) {
      let current = [], last = null;
      for (const [x, z, tx, tz] of samples) {
        const nx = tz * side, nz = -tx * side;
        const off = [r.w / 2 + 1.4, r.w / 2 + 2.3, r.w / 2 + 1].find(o => !blocked(x + nx * o, z + nz * o));
        if (off === undefined) { last = finish(current, r, side, last); current = []; continue; }
        const px2 = x + nx * off, pz2 = z + nz * off;
        const prev = current[current.length - 1];
        if (prev && Math.hypot(prev[0] - px2, prev[1] - pz2) > 5) { last = finish(current, r, side, last); current = []; }
        current.push([px2, pz2]);
      }
      finish(current, r, side, last);
    }
  }
  return sidewalks;
}

function buildCrossings(network, signals, sidewalks, world) {
  const clock = world.landmarks.clock;
  const rand = mulberry(303);
  const CELL = 6, hash = new Map();
  sidewalks.forEach(seg => seg.pts.forEach(([x, z], i) => {
    const k = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
    if (!hash.has(k)) hash.set(k, []);
    hash.get(k).push({ seg, s: seg.cum[i], x, z });
  }));
  const nearest = (x, z) => {
    let best = null, bestD = 3.4;
    const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const p of hash.get(`${ci + i},${cj + j}`) || []) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  };

  const crossings = [], used = new Set(), p = {};
  function place(link, s) {
    sampleLink(link, s, p);
    if (crossings.some(c => Math.hypot(c.x - p.x, c.z - p.z) < 30)) return;
    const half = link.edge.w / 2 + 1.4, nx = p.tz, nz = -p.tx;
    const a = nearest(p.x + nx * half, p.z + nz * half), b = nearest(p.x - nx * half, p.z - nz * half);
    if (!a || !b || a.seg === b.seg) return;
    const c = { x: p.x, z: p.z, tx: p.tx, tz: p.tz, w: link.edge.w, a, b };
    crossings.push(c);
    a.seg.crossings.push({ s: a.s, x0: a.x, z0: a.z, x1: b.x, z1: b.z, seg: b.seg, toS: b.s });
    b.seg.crossings.push({ s: b.s, x0: b.x, z0: b.z, x1: a.x, z1: a.z, seg: a.seg, toS: a.s });
  }
  for (const signal of signals) for (const { link } of signal.approaches) {
    if (link.len > 24) { place(link, link.len - 8); used.add(link.edge); }
  }
  for (const link of network.links) {
    if (link.edge.w < 8 || link.len < 45 || used.has(link.edge)) continue;
    used.add(link.edge);
    sampleLink(link, link.len / 2, p);
    if (Math.hypot(p.x - clock.x, p.z - clock.z) < 1000 && rand() < .5) place(link, link.len / 2);
  }
  for (const seg of sidewalks) seg.crossings.sort((x, y) => x.s - y.s);
  return crossings;
}

export function buildStreets(world) {
  const network = buildNetwork(world);
  const signals = buildSignals(network, world);
  const sidewalks = buildSidewalks(world);
  const crossings = buildCrossings(network, signals, sidewalks, world);
  return { ...network, signals, sidewalks, crossings };
}
