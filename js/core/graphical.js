// Tree graphical games and the TreeNash family of algorithms
// (Kearns, Littman & Singh, UAI 2001 -- "KLS").
//
// Conventions follow KLS Section 3:
//   * two actions per player, labelled 0 and 1;
//   * a mixed strategy p_i is the probability that player i plays action 0;
//   * player i's local game matrix is indexed by the actions of N_G(i), which includes i.
//
// One table engine covers both variants used on the site:
//   * N = 1, eps = 0  -> strategies restricted to {0, 1}: exact pure-strategy TreeNash;
//   * N > 1, eps > 0  -> ApproximateTreeNash on the tau-grid {0, 1/N, ..., 1} with eps-best responses.

import { mulberry32 } from "./rng.js";

const TOL = 1e-12;

export class TreeGame {
  // edges: [[a, b], ...] undirected; payoff(i, own, nbrAction) -> number, where nbrAction(j) gives j's action.
  constructor(n, edges, payoff, labels) {
    this.n = n;
    this.edges = edges.map((e) => [e[0], e[1]]);
    this.labels = labels || Array.from({ length: n }, (_, i) => String(i + 1));
    this.nbrs = Array.from({ length: n }, () => []);
    for (const [a, b] of edges) {
      this.nbrs[a].push(b);
      this.nbrs[b].push(a);
    }
    for (const l of this.nbrs) l.sort((x, y) => x - y);
    if (edges.length !== n - 1 || !this.isConnected()) {
      throw new Error("TreeNash needs a tree: connected with n - 1 edges.");
    }
    // Local game matrix M_i: bit 0 = own action, bit (1 + t) = action of nbrs[i][t].
    this.tables = this.nbrs.map((nb, i) => {
      const size = 1 << (nb.length + 1);
      const t = new Float64Array(size);
      for (let idx = 0; idx < size; idx++) {
        const own = idx & 1;
        t[idx] = payoff(i, own, (j) => (idx >> (1 + nb.indexOf(j))) & 1);
      }
      return t;
    });
  }

  isConnected() {
    const seen = new Array(this.n).fill(false);
    const stack = [0];
    seen[0] = true;
    while (stack.length) {
      const v = stack.pop();
      for (const u of this.nbrs[v]) if (!seen[u]) { seen[u] = true; stack.push(u); }
    }
    return seen.every(Boolean);
  }

  // Largest neighbourhood size k = |N_G(i)| (including i), as in KLS.
  maxK() {
    return Math.max(...this.nbrs.map((nb) => nb.length + 1));
  }

  payoffRange() {
    let lo = Infinity, hi = -Infinity;
    for (const t of this.tables) for (const x of t) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
    return [lo, hi];
  }

  // Expected payoff to i for each pure own action, given mixed strategies p (Pr[action 0]) of the others.
  pureActionPayoffs(i, p) {
    const nb = this.nbrs[i];
    const t = this.tables[i];
    const out = [0, 0];
    for (let combo = 0; combo < 1 << nb.length; combo++) {
      let prob = 1;
      for (let s = 0; s < nb.length; s++) {
        const a = (combo >> s) & 1;
        prob *= a === 0 ? p[nb[s]] : 1 - p[nb[s]];
      }
      if (prob === 0) continue;
      out[0] += prob * t[combo << 1];
      out[1] += prob * t[(combo << 1) | 1];
    }
    return out;
  }

  // max over i of (best-response payoff - current payoff); 0 at an exact Nash equilibrium.
  regret(p) {
    let worst = 0;
    const per = [];
    for (let i = 0; i < this.n; i++) {
      const [a0, a1] = this.pureActionPayoffs(i, p);
      const r = Math.max(a0, a1) - (p[i] * a0 + (1 - p[i]) * a1);
      per.push(r);
      worst = Math.max(worst, r);
    }
    return { worst, per };
  }

  // All pure Nash equilibria by brute force over {0,1}^n (only for validating TreeNash on small trees).
  bruteForcePureNE(limit = 1 << 20) {
    if (this.n > 20) throw new Error("brute force limited to n <= 20");
    const res = [];
    for (let m = 0; m < 1 << this.n; m++) {
      const p = Array.from({ length: this.n }, (_, i) => ((m >> i) & 1 ? 0 : 1)); // action 1 <=> Pr[0] = 0
      if (this.regret(p).worst <= TOL) {
        res.push(p.map((x) => (x === 1 ? 0 : 1)));
        if (res.length >= limit) break;
      }
    }
    return res;
  }
}

// Orient the tree at `root`: down[v] is v's KLS "child" (towards the root), ups[v] its "parents".
export function orient(game, root) {
  const down = new Array(game.n).fill(-1);
  const ups = Array.from({ length: game.n }, () => []);
  const order = []; // pre-order from root
  const stack = [root];
  const seen = new Array(game.n).fill(false);
  seen[root] = true;
  while (stack.length) {
    const v = stack.pop();
    order.push(v);
    for (const u of game.nbrs[v]) {
      if (!seen[u]) { seen[u] = true; down[u] = v; ups[v].push(u); stack.push(u); }
    }
  }
  for (const l of ups) l.sort((a, b) => a - b);
  return { root, down, ups, leavesFirst: order.slice().reverse(), rootFirst: order };
}

// --- discretisation bounds -------------------------------------------------------------

// KLS Theorem 5: tau <= min( eps / (2^{k+2} k log k), 2 / (k log^2(k/2)) ).
// The log is base 2: KLS's Lemma 2 proof uses log(k/2) = log k - 1.
export function klsTau(eps, k) {
  const l = Math.log2(k), l2 = Math.log2(k / 2);
  const a = l > 0 ? eps / (Math.pow(2, k + 2) * k * l) : Infinity;
  const b = l2 > 0 ? 2 / (k * l2 * l2) : Infinity;
  return Math.min(a, b);
}

// Ortiz (2002), "Approximation Bound Refinement of KLS": tau <= (1 + eps)^{1/k} - 1, k = |N_G(i)|;
// his proof implicitly uses payoffs in [0,1] (KLS assume |payoff| <= 1).
export function ortizTau(eps, k) {
  return Math.pow(1 + eps, 1 / k) - 1;
}

// --- the TreeNash table engine ------------------------------------------------------------

// Returns tables with KLS semantics. For V with child W:
//   T_V[w * G + v] = 1  iff  there is an (eps-)Nash equilibrium of the game upstream of V
//   (inclusive) in which V plays grid point v, given that W plays grid point w.
// The root R gets a one-dimensional table T_R[r].
export function treeNashTables(game, { root = 0, N = 1, eps = 0 } = {}) {
  const G = N + 1;
  const grid = Array.from({ length: G }, (_, s) => s / N);
  const or = orient(game, root);
  const tables = new Array(game.n);
  const stats = { tupleChecks: 0, entries: 0 };

  for (const V of or.leavesFirst) {
    const W = or.down[V];
    const U = or.ups[V];
    const table = new Uint8Array(W === -1 ? G : G * G);
    forEachV: for (let vi = 0; vi < G; vi++) {
      const lists = U.map((u) => feasibleParentPoints(tables[u], vi, G));
      if (lists.some((l) => l.length === 0)) continue;
      let filled = 0;
      const target = W === -1 ? 1 : G;
      for (const tuple of cartesian(lists)) {
        stats.tupleChecks++;
        const P = parentAveraged(game, V, W, U, tuple.map((s) => grid[s]));
        const v = grid[vi];
        if (W === -1) {
          if (isEpsBR(v, P[0][0], P[1][0], eps)) { table[vi] = 1; continue forEachV; }
        } else {
          for (let wi = 0; wi < G; wi++) {
            if (table[wi * G + vi]) continue;
            const w = grid[wi];
            const a0 = w * P[0][0] + (1 - w) * P[0][1];
            const a1 = w * P[1][0] + (1 - w) * P[1][1];
            if (isEpsBR(v, a0, a1, eps)) { table[wi * G + vi] = 1; filled++; }
          }
          if (filled === target) continue forEachV;
        }
      }
    }
    stats.entries += table.length;
    tables[V] = table;
  }
  return { tables, orientation: or, grid, N, eps, stats };
}

function isEpsBR(v, a0, a1, eps) {
  return v * a0 + (1 - v) * a1 >= Math.max(a0, a1) - eps - TOL;
}

function feasibleParentPoints(parentTable, vi, G) {
  const out = [];
  for (let ui = 0; ui < G; ui++) if (parentTable[vi * G + ui]) out.push(ui);
  return out;
}

function* cartesian(lists) {
  const k = lists.length;
  const idx = new Array(k).fill(0);
  if (k === 0) { yield []; return; }
  while (true) {
    yield idx.map((x, j) => lists[j][x]);
    let j = k - 1;
    while (j >= 0 && ++idx[j] === lists[j].length) { idx[j] = 0; j--; }
    if (j < 0) return;
  }
}

// P[a][b] = E_{parents ~ u}[ M_V(own = a, child = b, parents) ]  (b ignored when V is the root).
function parentAveraged(game, V, W, U, u) {
  const nb = game.nbrs[V];
  const t = game.tables[V];
  const posW = W === -1 ? -1 : nb.indexOf(W);
  const posU = U.map((x) => nb.indexOf(x));
  const P = [[0, 0], [0, 0]];
  for (let combo = 0; combo < 1 << U.length; combo++) {
    let prob = 1, base = 0;
    for (let s = 0; s < U.length; s++) {
      const a = (combo >> s) & 1;
      prob *= a === 0 ? u[s] : 1 - u[s];
      base |= a << (1 + posU[s]);
    }
    if (prob === 0) continue;
    for (let b = 0; b < (W === -1 ? 1 : 2); b++) {
      const idx = base | (W === -1 ? 0 : b << (1 + posW));
      P[0][b] += prob * t[idx];
      P[1][b] += prob * t[idx | 1];
    }
  }
  return P;
}

// --- upstream pass ---------------------------------------------------------------------

// Witnesses are regenerated on demand instead of stored (as KLS suggest for the exact
// algorithm in their Section 6): any parent tuple with T(v, u_i) = 1 for all i and v an
// (eps-)best response to (u, w) is a valid witness.
export function findWitness(game, result, V, vi, wi, rand) {
  const all = witnesses(game, result, V, vi, wi, rand, 1);
  return all.length ? all[0] : null;
}

// Up to `limit` witnesses for T(w, v) = 1 at vertex V (grid indices); wi = -1 for the root.
export function witnesses(game, result, V, vi, wi, rand = null, limit = Infinity) {
  const { tables, orientation: or, grid, eps, N } = result;
  const G = N + 1;
  const U = or.ups[V];
  const W = or.down[V];
  const lists = U.map((u) => {
    const l = feasibleParentPoints(tables[u], vi, G);
    if (rand) shuffle(l, rand);
    return l;
  });
  const out = [];
  for (const tuple of cartesian(lists)) {
    const P = parentAveraged(game, V, W, U, tuple.map((s) => grid[s]));
    let a0 = P[0][0], a1 = P[1][0];
    if (W !== -1) {
      const w = grid[wi];
      a0 = w * P[0][0] + (1 - w) * P[0][1];
      a1 = w * P[1][0] + (1 - w) * P[1][1];
    }
    if (isEpsBR(grid[vi], a0, a1, eps)) {
      out.push(tuple);
      if (out.length >= limit) break;
    }
  }
  return out;
}

function shuffle(a, rand) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

// Upstream pass from root grid point rootIdx. Returns grid indices per player and the trace of messages.
export function upstream(game, result, rootIdx, { seed = null } = {}) {
  const or = result.orientation;
  const rand = seed === null ? null : mulberry32(seed);
  const choice = new Array(game.n).fill(-1);
  const trace = [];
  if (!result.tables[or.root][rootIdx]) return null;
  choice[or.root] = rootIdx;
  for (const V of or.rootFirst) {
    const W = or.down[V];
    const wit = findWitness(game, result, V, choice[V], W === -1 ? -1 : choice[W], rand);
    if (wit === null) return null; // cannot happen if tables are consistent
    or.ups[V].forEach((U, s) => {
      choice[U] = wit[s];
      trace.push({ from: V, to: U, v: choice[V], u: wit[s] });
    });
  }
  return { choice, strategy: choice.map((s) => result.grid[s]), trace };
}

// Every equilibrium represented by the tables (all witness choices). Pure case only.
export function enumerateAll(game, result, limit = 5000) {
  const or = result.orientation;
  const G = result.N + 1;
  const out = [];
  const choice = new Array(game.n).fill(-1);
  const order = or.rootFirst;
  const rec = (pos) => {
    if (out.length >= limit) return;
    if (pos === order.length) { out.push(choice.slice()); return; }
    const V = order[pos];
    const W = or.down[V];
    if (choice[V] === -1) throw new Error("ordering bug");
    const U = or.ups[V];
    const lists = U.map((u) => feasibleParentPoints(result.tables[u], choice[V], G));
    for (const tuple of cartesian(lists)) {
      const P = parentAveraged(game, V, W, U, tuple.map((s) => result.grid[s]));
      let a0 = P[0][0], a1 = P[1][0];
      if (W !== -1) {
        const w = result.grid[choice[W]];
        a0 = w * P[0][0] + (1 - w) * P[0][1];
        a1 = w * P[1][0] + (1 - w) * P[1][1];
      }
      if (!isEpsBR(result.grid[choice[V]], a0, a1, result.eps)) continue;
      U.forEach((u, s) => (choice[u] = tuple[s]));
      rec(pos + 1);
      U.forEach((u) => (choice[u] = -1));
    }
  };
  for (let r = 0; r < G; r++) {
    if (!result.tables[or.root][r]) continue;
    choice[or.root] = r;
    rec(0);
  }
  return out;
}

// With N = 1 the grid is {0, 1} = Pr[action 0], so grid index 0 means action 1 and index 1 means action 0.
export function pureActionsFromIndices(choice) {
  return choice.map((s) => 1 - s);
}
