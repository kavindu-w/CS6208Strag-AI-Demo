// Example tree games for the TreeNash demo. Each preset says where it comes from;
// payoffs are all in [0, 1], which satisfies KLS (|payoff| <= 1) and the [0, 1] range Ortiz's proof implicitly uses.

import { TreeGame } from "./graphical.js";
import { mulberry32 } from "./rng.js";

// Threshold game of complements, from M. T. Irfan's CSCI 3210 slides ("Graphical Games", 2018),
// "Illustration of TreeNash algorithm": t_i = |N_i| / 2 with N_i the neighbours of i (excluding i).
// Slide rule: i plays 1 iff at least t_i neighbours play 1. We encode it as the 0/1 payoff
// u_i(1) = 1[#ones >= t_i], u_i(0) = 1[#ones < t_i]; this has exactly the slide's best responses.
export function irfanThresholdTree() {
  const labels = ["L1", "L2", "U1", "L3", "V", "L4", "W"];
  const edges = [[0, 2], [1, 2], [2, 4], [3, 4], [4, 6], [5, 6]];
  const deg = new Array(7).fill(0);
  for (const [a, b] of edges) { deg[a]++; deg[b]++; }
  const nbrs = Array.from({ length: 7 }, () => []);
  for (const [a, b] of edges) { nbrs[a].push(b); nbrs[b].push(a); }
  const game = new TreeGame(7, edges, (i, own, act) => {
    const ones = nbrs[i].reduce((s, j) => s + act(j), 0);
    const t = deg[i] / 2;
    return own === 1 ? (ones >= t ? 1 : 0) : ones < t ? 1 : 0;
  }, labels);
  return {
    game,
    root: 6,
    layout: { 0: [60, 40], 1: [160, 40], 2: [110, 120], 3: [230, 120], 4: [170, 200], 5: [300, 200], 6: [235, 280] },
    source: "Irfan, CSCI 3210 slides, 'Illustration of TreeNash algorithm' (threshold game of complements, t_i = |N_i|/2).",
  };
}

// Two-player matching pennies on a single edge: the textbook game with no pure equilibrium
// and a unique mixed equilibrium (1/2, 1/2). Included to contrast pure and approximate TreeNash.
export function matchingPennies() {
  const game = new TreeGame(2, [[0, 1]], (i, own, act) => {
    const other = act(1 - i);
    const match = own === other;
    return i === 0 ? (match ? 1 : 0) : match ? 0 : 1;
  }, ["Matcher", "Mismatcher"]);
  return {
    game,
    root: 1,
    layout: { 0: [110, 80], 1: [110, 220] },
    source: "Matching pennies (standard). Matcher wants equal actions, Mismatcher wants different actions.",
  };
}

// Same tree shape and M/O player types as KLS Figure 2. KLS omit the exact payoffs, so these are OUR
// OWN payoffs in the spirit of their caption: an M player is rewarded for matching its downstream
// neighbour, an O player for opposing it, and the reward strength s depends on its parents' actions
// and a per-player constant. Matching (resp. opposing) earns s, the other action earns 1 - s.
export function klsShapedTree(seed = 7) {
  const rand = mulberry32(seed);
  const labels = ["0 (M)", "1 (O)", "2 (M)", "3 (O)", "4 (M)", "5 (O)", "6 (M)", "7 (M)"];
  const type = ["M", "O", "M", "O", "M", "O", "M", "M"];
  const edges = [[0, 4], [1, 4], [2, 5], [3, 5], [4, 6], [5, 6], [6, 7]];
  const down = { 0: 4, 1: 4, 2: 5, 3: 5, 4: 6, 5: 6, 6: 7, 7: 6 }; // vertex 7 (root) "matches" vertex 6
  const ups = { 0: [], 1: [], 2: [], 3: [], 4: [0, 1], 5: [2, 3], 6: [4, 5], 7: [] };
  // s_i = c_i + d_i * (fraction of parents playing 1 - 1/2); c_i > 1/2 is a baseline bias towards the
  // "good" action, and d_i (either sign) lets the parents strengthen or reverse it.
  const c = Array.from({ length: 8 }, () => 0.55 + 0.3 * rand());
  const d = c.map((ci) => (2 * rand() - 1) * 2 * Math.min(ci, 1 - ci) * 0.95);
  const game = new TreeGame(8, edges, (i, own, act) => {
    const P = ups[i];
    const frac = P.length ? P.reduce((s, j) => s + act(j), 0) / P.length : 0.5;
    const s = c[i] + d[i] * (frac - 0.5); // stays in [0, 1]
    const same = own === act(down[i]);
    const good = type[i] === "M" ? same : !same;
    return good ? s : 1 - s;
  }, labels);
  return {
    game,
    root: 7,
    layout: { 0: [40, 30], 1: [130, 30], 2: [260, 30], 3: [350, 30], 4: [85, 110], 5: [305, 110], 6: [195, 190], 7: [195, 275] },
    source: "Tree shape and M/O types from KLS Figure 2; payoffs are our own construction (KLS do not publish theirs).",
  };
}

// Random tree with maximum degree <= maxDeg and i.i.d. Uniform[0,1] local payoffs.
export function randomTree(n = 7, seed = 1, maxDeg = 3) {
  const rand = mulberry32(seed);
  const edges = [];
  const deg = new Array(n).fill(0);
  for (let v = 1; v < n; v++) {
    const cands = [];
    for (let u = 0; u < v; u++) if (deg[u] < maxDeg) cands.push(u);
    const u = cands[Math.floor(rand() * cands.length)];
    edges.push([u, v]);
    deg[u]++; deg[v]++;
  }
  const nbrs = Array.from({ length: n }, () => []);
  for (const [a, b] of edges) { nbrs[a].push(b); nbrs[b].push(a); }
  for (const l of nbrs) l.sort((x, y) => x - y);
  // draw M_i entry by entry in a fixed order, so the seed fully determines the game
  const vals = nbrs.map((nb) => Array.from({ length: 1 << (nb.length + 1) }, () => rand()));
  const game = new TreeGame(n, edges, (i, own, act) => {
    let idx = own;
    nbrs[i].forEach((j, t) => (idx |= act(j) << (1 + t)));
    return vals[i][idx];
  });
  return {
    game,
    root: 0,
    layout: null,
    source: `Random tree (n = ${n}, max degree ${maxDeg}, seed ${seed}); every local payoff i.i.d. Uniform[0,1].`,
  };
}
