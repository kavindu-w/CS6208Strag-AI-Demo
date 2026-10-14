// Linear influence games (LIGs) and the most-influential-nodes problem
// (Irfan & Ortiz, AAAI 2011 -- "IO").
//
// Conventions follow IO Definitions 1-3:
//   * actions x_i in {-1, +1};
//   * f_i(x_{-i}) = sum_{j != i} w_ji x_j - b_i, where w_ji is the influence of j on i (arc j -> i);
//   * payoff u_i = x_i f_i(x_{-i});  best response: +1 if f_i > 0, -1 if f_i < 0, either if f_i = 0.
// So x is a PSNE iff x_i f_i(x_{-i}) >= 0 for every i.
//
// Joint actions are stored as bitmasks: bit i set  <=>  x_i = +1  (requires n <= 30).

import { mulberry32 } from "./rng.js";

export const TOL = 1e-9; // tolerance for the tie f_i = 0 with non-integer weights

export class LIG {
  // arcs: [[j, i, w_ji], ...] (0-based); b: thresholds
  constructor(n, b, arcs, labels) {
    if (n > 30) throw new Error("this demo supports n <= 30");
    this.n = n;
    this.b = Float64Array.from(b);
    this.labels = labels || Array.from({ length: n }, (_, i) => String(i + 1));
    this.W = new Float64Array(n * n); // W[j * n + i] = w_ji
    for (const [j, i, w] of arcs) {
      if (i === j) throw new Error("self-loops are not part of an LIG");
      this.W[j * n + i] += w;
    }
    this.inArcs = Array.from({ length: n }, () => []);
    this.outArcs = Array.from({ length: n }, () => []);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const w = this.W[j * n + i];
        if (w !== 0) { this.inArcs[i].push([j, w]); this.outArcs[j].push([i, w]); }
      }
  }

  arcs() {
    const out = [];
    for (let j = 0; j < this.n; j++) for (const [i, w] of this.outArcs[j]) out.push([j, i, w]);
    return out;
  }

  x(mask, i) { return (mask >> i) & 1 ? 1 : -1; }

  f(i, mask) {
    let s = -this.b[i];
    for (const [j, w] of this.inArcs[i]) s += w * this.x(mask, j);
    return s;
  }

  isPSNE(mask) {
    for (let i = 0; i < this.n; i++) if (this.x(mask, i) * this.f(i, mask) < -TOL) return false;
    return true;
  }

  nonNegative() { return this.arcs().every(([, , w]) => w >= 0); }
  symmetric() {
    for (let j = 0; j < this.n; j++)
      for (let i = 0; i < this.n; i++) if (Math.abs(this.W[j * this.n + i] - this.W[i * this.n + j]) > TOL) return false;
    return true;
  }
}

// ---- PSNE enumeration ---------------------------------------------------------------------

// Exhaustive search in Gray-code order: each step flips one player and updates f in O(out-degree).
export function enumerateBrute(g, limit = Infinity) {
  const n = g.n;
  if (n > 26) throw new Error("brute force limited to n <= 26");
  const f = new Float64Array(n);
  let mask = 0;
  for (let i = 0; i < n; i++) f[i] = g.f(i, mask);
  const out = [];
  const check = () => {
    for (let i = 0; i < n; i++) if (((mask >> i) & 1 ? 1 : -1) * f[i] < -TOL) return false;
    return true;
  };
  if (check()) out.push(mask);
  const total = 2 ** n;
  for (let t = 1; t < total && out.length < limit; t++) {
    const k = 31 - Math.clz32(t & -t); // index of lowest set bit
    const before = (mask >> k) & 1 ? 1 : -1;
    mask ^= 1 << k;
    const delta = -2 * before;
    for (const [i, w] of g.outArcs[k]) f[i] += w * delta;
    if (check()) out.push(mask >>> 0);
  }
  out.sort((a, b) => a - b);
  return { psne: out, visited: total };
}

// IO's backtracking search ("Heuristics for Computing and Counting Equilibria"):
//   * first node: maximum out-degree;
//   * next node: the one with maximum influence |w| on any already-selected node
//     (ties -> larger out-degree -> lower index: our choice, unspecified in IO);
//   * prune when an assigned player j can never be best-responding:
//     (gamma-_j > b_j and x_j = -1) or (gamma+_j < b_j and x_j = +1), where
//     gamma+-_j = sum_{assigned k != j} x_k w_kj +- sum_{unassigned k} |w_kj|.
// IO additionally run NashProp at every node; that step is NOT implemented here.
export function backtrackOrder(g) {
  const n = g.n;
  const outdeg = g.outArcs.map((a) => a.length);
  const order = [];
  const chosen = new Array(n).fill(false);
  let first = 0;
  for (let i = 1; i < n; i++) if (outdeg[i] > outdeg[first]) first = i;
  order.push(first);
  chosen[first] = true;
  while (order.length < n) {
    let best = -1, bestInf = -1;
    for (let i = 0; i < n; i++) {
      if (chosen[i]) continue;
      let inf = 0;
      for (const [j, w] of g.outArcs[i]) if (chosen[j]) inf = Math.max(inf, Math.abs(w));
      if (inf > bestInf || (inf === bestInf && outdeg[i] > outdeg[best])) { best = i; bestInf = inf; }
    }
    order.push(best);
    chosen[best] = true;
  }
  return order;
}

export function enumerateBacktrack(g, { fixed = null, limit = Infinity } = {}) {
  // fixed: optional Map player -> +1/-1 (used to count PSNE extending a partial assignment)
  const n = g.n;
  const order = backtrackOrder(g);
  const assigned = new Int8Array(n); // 0 = unassigned
  const S = new Float64Array(n); // sum over assigned k of x_k w_kj
  const R = new Float64Array(n); // sum over unassigned k of |w_kj|
  for (let i = 0; i < n; i++) for (const [j, w] of g.inArcs[i]) R[i] += Math.abs(w);
  const out = [];
  let nodes = 0;

  const violates = (j) => {
    const lo = S[j] - R[j], hi = S[j] + R[j];
    return (assigned[j] === -1 && lo > g.b[j] + TOL) || (assigned[j] === 1 && hi < g.b[j] - TOL);
  };

  const rec = (pos, mask) => {
    if (out.length >= limit) return;
    if (pos === n) { out.push(mask >>> 0); return; }
    const k = order[pos];
    const values = fixed && fixed.has(k) ? [fixed.get(k)] : [1, -1];
    for (const x of values) {
      nodes++;
      assigned[k] = x;
      for (const [j, w] of g.outArcs[k]) { S[j] += x * w; R[j] -= Math.abs(w); }
      let ok = !violates(k);
      if (ok) for (const [j] of g.outArcs[k]) if (assigned[j] !== 0 && violates(j)) { ok = false; break; }
      if (ok) rec(pos + 1, x === 1 ? mask | (1 << k) : mask);
      for (const [j, w] of g.outArcs[k]) { S[j] -= x * w; R[j] += Math.abs(w); }
      assigned[k] = 0;
    }
  };
  rec(0, 0);
  out.sort((a, b) => a - b);
  return { psne: out, visited: nodes, order };
}

// ---- Theorem 4: best-response dynamics for non-negative influences --------------------------

// Start from everyone playing -1; in each round every player with f_i > 0 who plays -1 switches
// to +1 (simultaneously). With w >= 0 nobody ever wants to switch back, so this stops within n
// rounds at a PSNE.
export function bestResponseDynamics(g) {
  let mask = 0;
  const rounds = [];
  for (let r = 0; r <= g.n; r++) {
    const movers = [];
    for (let i = 0; i < g.n; i++) if (!((mask >> i) & 1) && g.f(i, mask) > TOL) movers.push(i);
    if (!movers.length) break;
    for (const i of movers) mask |= 1 << i;
    rounds.push({ movers, mask: mask >>> 0 });
  }
  return { rounds, final: mask >>> 0, isPSNE: g.isPSNE(mask) };
}

// ---- Proposition 5: symmetric weights give an exact potential --------------------------------

// Phi(x) = sum_t x_t ( sum_{i != t} x_i w_it / 2 - b_t ). With w_ij = w_ji, a unilateral change by
// player k changes Phi by exactly the change in u_k (verified in tests/run-tests.mjs).
export function potential(g, mask) {
  let phi = 0;
  for (let t = 0; t < g.n; t++) {
    let s = 0;
    for (const [i, w] of g.inArcs[t]) s += g.x(mask, i) * w;
    phi += g.x(mask, t) * (s / 2 - g.b[t]);
  }
  return phi;
}

// ---- most influential nodes ---------------------------------------------------------------

export function consistent(psne, target, S) {
  // PSNE that agree with target on every player in S (S: array of player indices)
  let m = 0;
  for (const i of S) m |= 1 << i;
  return psne.filter((y) => ((y ^ target) & m) === 0);
}

// IO's greedy approximation: "select the least-degree node v of the goal hyperedge, remove the
// hyperedges that do not contain v, ... until the goal hyperedge becomes the last remaining".
// Degree = number of remaining hyperedges (PSNE, including the target) sharing the target's
// action for that player. Ties are broken by lowest player index (our choice).
export function greedyInfluential(psne, target, n) {
  let remaining = psne.slice();
  const S = [];
  const steps = [];
  while (remaining.length > 1) {
    let best = -1, bestDeg = Infinity;
    for (let i = 0; i < n; i++) {
      if (S.includes(i)) continue;
      const bit = (target >> i) & 1;
      const deg = remaining.reduce((c, y) => c + (((y >> i) & 1) === bit ? 1 : 0), 0);
      if (deg < bestDeg) { bestDeg = deg; best = i; }
    }
    const bit = (target >> best) & 1;
    const removed = remaining.filter((y) => ((y >> best) & 1) !== bit);
    remaining = remaining.filter((y) => ((y >> best) & 1) === bit);
    S.push(best);
    steps.push({ player: best, degree: bestDeg, removed, remaining: remaining.slice() });
  }
  return { S, steps };
}

// Exact optimum via the minimum-hitting-set view (IO Theorem 10): S works iff for every other
// PSNE y, S contains a player where y differs from the target. Enumerates subsets by size.
export function exactInfluential(psne, target, n, { maxChecks = 5e7 } = {}) {
  const D = psne.filter((y) => y !== target).map((y) => (y ^ target) >>> 0);
  if (D.length === 0) return { S: [], checks: 0 };
  let checks = 0;
  for (let s = 1; s <= n; s++) {
    // Gosper's hack over all n-bit masks with s bits set
    let m = (1 << s) - 1;
    const limit = n === 31 ? 2 ** 31 : 1 << n;
    while (m < limit && m > 0) {
      checks++;
      if (checks > maxChecks) return { S: null, checks, aborted: true };
      let ok = true;
      for (let t = 0; t < D.length; t++) if ((D[t] & m) === 0) { ok = false; break; }
      if (ok) return { S: bits(m, n), checks };
      const c = m & -m, r = m + c;
      m = (((r ^ m) >>> 2) / c) | r;
    }
  }
  return { S: null, checks };
}

// Every minimum-size influential set for `target` (stops after `cap` sets).
export function allMinimumInfluential(psne, target, n, { cap = 200, maxChecks = 5e7 } = {}) {
  const best = exactInfluential(psne, target, n, { maxChecks });
  if (!best.S) return { sets: [], size: null, aborted: !!best.aborted };
  const s = best.S.length;
  if (s === 0) return { sets: [[]], size: 0 };
  const D = psne.filter((y) => y !== target).map((y) => (y ^ target) >>> 0);
  const sets = [];
  let m = (1 << s) - 1;
  let checks = 0;
  while (m < 1 << n && m > 0 && sets.length < cap) {
    if (++checks > maxChecks) return { sets, size: s, truncated: true };
    if (D.every((d) => (d & m) !== 0)) sets.push(bits(m, n));
    const c = m & -m, r = m + c;
    m = (((r ^ m) >>> 2) / c) | r;
  }
  return { sets, size: s, truncated: sets.length >= cap };
}

function bits(m, n) {
  const out = [];
  for (let i = 0; i < n; i++) if ((m >> i) & 1) out.push(i);
  return out;
}

// ---- Theorem 7: TreeNash for LIGs on trees in O(nd) ---------------------------------------

// For an LIG whose (undirected) influence graph is a tree, compute IO's downstream tables directly:
// for node i with child j and each (x_i, x_j), split the parents into Pa1 (exactly one feasible
// action x̂_k given x_i) and Pa2 (both feasible). Then T_ij(x_j, x_i) = 1 iff
//   x_i ( x_j w_ji + sum_{Pa1} x̂_k w_ki - b_i ) + sum_{Pa2} |w_ti| >= 0
// (and no parent has zero feasible actions). IO's AAAI 2011 proof sketch prints the inequality without "- b_i" (and with
// (2·1[x_i w_ti > 0] - 1) w_ti, which equals |w_ti| after multiplying by x_i); the threshold term is
// needed for the best-response condition x_i f_i >= 0 and is included here, as in our slide 63.
// Tables are indexed [xj][xi] with action index 0 <-> -1 and 1 <-> +1.
export function theorem7Tables(g, root) {
  const n = g.n;
  const nb = Array.from({ length: n }, () => new Set());
  for (const [j, i] of g.arcs()) { nb[i].add(j); nb[j].add(i); }
  let edges = 0;
  for (const s of nb) edges += s.size;
  if (edges / 2 !== n - 1) throw new Error("Theorem 7 needs the underlying undirected graph to be a tree");
  const down = new Array(n).fill(-1);
  const ups = Array.from({ length: n }, () => []);
  const order = [];
  const seen = new Array(n).fill(false);
  const stack = [root];
  seen[root] = true;
  while (stack.length) {
    const v = stack.pop();
    order.push(v);
    for (const u of nb[v]) if (!seen[u]) { seen[u] = true; down[u] = v; ups[v].push(u); stack.push(u); }
  }
  const w = (j, i) => g.W[j * n + i];
  const val = [-1, 1];
  const tables = new Array(n);
  let ops = 0;
  for (const i of order.slice().reverse()) {
    const j = down[i];
    const T = new Uint8Array(j === -1 ? 2 : 4);
    for (let ai = 0; ai < 2; ai++) {
      const xi = val[ai];
      let sum1 = 0, sumAbs = 0, dead = false;
      for (const k of ups[i]) {
        ops++;
        const tk = tables[k]; // tk[ai * 2 + ak] : child i plays ai, k plays ak
        const f0 = tk[ai * 2 + 0], f1 = tk[ai * 2 + 1];
        if (!f0 && !f1) { dead = true; break; }
        if (f0 && f1) sumAbs += Math.abs(w(k, i));
        else sum1 += val[f1 ? 1 : 0] * w(k, i);
      }
      if (dead) continue;
      if (j === -1) {
        T[ai] = xi * (sum1 - g.b[i]) + sumAbs >= -TOL ? 1 : 0;
      } else {
        for (let aj = 0; aj < 2; aj++) {
          ops++;
          T[aj * 2 + ai] = xi * (val[aj] * w(j, i) + sum1 - g.b[i]) + sumAbs >= -TOL ? 1 : 0;
        }
      }
    }
    tables[i] = T;
  }
  return { tables, down, ups, order, ops };
}

// ---- Theorem 8(3): counting PSNE is #P-complete even on stars ----------------------------------

// IO's reduction from #KNAPSACK uses actions {0, 1}: centre v0 has threshold -W, every leaf
// threshold 1; arc v0 -> leaf has weight 1 and leaf i -> v0 has weight -a_i. Best responses with
// {0,1} actions: play 1 if f > 0, 0 if f < 0, either if f = 0. Returns both counts.
export function knapsackStar(a, Wcap) {
  const m = a.length;
  if (m > 20) throw new Error("keep the star small (<= 20 leaves)");
  let psne = 0, feasible = 0;
  for (let mask = 0; mask < 1 << (m + 1); mask++) {
    const x0 = mask & 1;
    const leaf = (i) => (mask >> (i + 1)) & 1;
    let ok = true;
    // centre: f0 = sum_i (-a_i) x_i - (-W)
    let f0 = Wcap;
    for (let i = 0; i < m; i++) f0 -= a[i] * leaf(i);
    if ((x0 === 1 && f0 < 0) || (x0 === 0 && f0 > 0)) ok = false;
    for (let i = 0; ok && i < m; i++) {
      const fi = 1 * x0 - 1;
      if ((leaf(i) === 1 && fi < 0) || (leaf(i) === 0 && fi > 0)) ok = false;
    }
    if (ok) psne++;
  }
  for (let s = 0; s < 1 << m; s++) {
    let tot = 0;
    for (let i = 0; i < m; i++) if ((s >> i) & 1) tot += a[i];
    if (tot <= Wcap) feasible++;
  }
  return { psne, feasible };
}

// ---- instance generators -------------------------------------------------------------------

export function fromUndirected(n, edges, weight = 1, b = 0, labels) {
  const arcs = [];
  for (const [u, v] of edges) { arcs.push([u, v, weight]); arcs.push([v, u, weight]); }
  return new LIG(n, new Array(n).fill(b), arcs, labels);
}

// IO "Random Influence Games": each ordered pair is an arc independently w.p. 0.5; weight -1 with
// flip probability p, else +1. IO do not state thresholds for this family; we use b_i = 0.
export function randomLIG(n, p, seed, { arcProb = 0.5, b = 0 } = {}) {
  const rand = mulberry32(seed);
  const arcs = [];
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      if (i === j) continue;
      if (rand() < arcProb) arcs.push([j, i, rand() < p ? -1 : 1]);
    }
  return new LIG(n, new Array(n).fill(b), arcs);
}

// IO "Preferential-Attachment LIGs": start from a triangle, each new node links to three existing
// nodes with probability proportional to degree; links are made bidirectional and each arc gets
// weight -1 w.p. p, else +1; thresholds 0. Assumptions (unspecified in IO): the three targets are
// distinct (sampled without replacement), and the two arcs of a link are weighted independently.
export function prefAttachLIG(n, p, seed) {
  const rand = mulberry32(seed);
  const edges = [[0, 1], [1, 2], [0, 2]];
  const deg = [2, 2, 2];
  for (let v = 3; v < n; v++) {
    const targets = new Set();
    while (targets.size < Math.min(3, v)) {
      const pool = [];
      let tot = 0;
      for (let u = 0; u < v; u++) if (!targets.has(u)) { pool.push(u); tot += deg[u]; }
      let r = rand() * tot;
      for (const u of pool) { r -= deg[u]; if (r <= 0) { targets.add(u); break; } }
      if (r > 0) targets.add(pool[pool.length - 1]);
    }
    deg.push(0);
    for (const u of targets) { edges.push([u, v]); deg[u]++; deg[v]++; }
  }
  const arcs = [];
  for (const [u, v] of edges) {
    arcs.push([u, v, rand() < p ? -1 : 1]);
    arcs.push([v, u, rand() < p ? -1 : 1]);
  }
  return new LIG(n, new Array(n).fill(0), arcs);
}

// ---- text format used by the editor ---------------------------------------------------------

// Lines (1-based ids, '#' starts a comment):
//   node <id> <threshold> [label]
//   arc  <from> <to> <weight>      w_{from,to}: influence of <from> on <to>
//   edge <u> <v> <weight>          shorthand for two arcs with the same weight
export function parseLIG(text) {
  const nodes = new Map();
  const arcs = [];
  text.split("\n").forEach((raw, ln) => {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) return;
    const t = line.split(/\s+/);
    const num = (s) => {
      const v = Number(s);
      if (!Number.isFinite(v)) throw new Error(`line ${ln + 1}: '${s}' is not a number`);
      return v;
    };
    if (t[0] === "node") nodes.set(num(t[1]), { b: num(t[2] ?? 0), label: t.slice(3).join(" ") || t[1] });
    else if (t[0] === "arc") arcs.push([num(t[1]), num(t[2]), num(t[3])]);
    else if (t[0] === "edge") { arcs.push([num(t[1]), num(t[2]), num(t[3])]); arcs.push([num(t[2]), num(t[1]), num(t[3])]); }
    else throw new Error(`line ${ln + 1}: unknown keyword '${t[0]}'`);
  });
  for (const [j, i] of arcs) for (const id of [j, i]) if (!nodes.has(id)) nodes.set(id, { b: 0, label: String(id) });
  const ids = [...nodes.keys()].sort((a, b) => a - b);
  const index = new Map(ids.map((id, k) => [id, k]));
  return new LIG(
    ids.length,
    ids.map((id) => nodes.get(id).b),
    arcs.map(([j, i, w]) => [index.get(j), index.get(i), w]),
    ids.map((id) => nodes.get(id).label),
  );
}

export function serializeLIG(g) {
  const lines = ["# node <id> <threshold b_i> [label]"];
  for (let i = 0; i < g.n; i++) lines.push(`node ${i + 1} ${g.b[i]}${g.labels[i] !== String(i + 1) ? " " + g.labels[i] : ""}`);
  lines.push("# arc <from j> <to i> <w_ji>   (influence of j on i)");
  const done = new Set();
  for (const [j, i, w] of g.arcs()) {
    if (done.has(j + "," + i)) continue;
    if (g.W[i * g.n + j] === w) {
      lines.push(`edge ${j + 1} ${i + 1} ${w}`);
      done.add(i + "," + j);
    } else lines.push(`arc ${j + 1} ${i + 1} ${w}`);
    done.add(j + "," + i);
  }
  return lines.join("\n");
}
