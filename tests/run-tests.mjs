// Verification suite for the algorithms behind the demos.  Run:  node tests/run-tests.mjs
// Every claim made on the website about agreement with the papers is checked here.

import { TreeGame, treeNashTables, enumerateAll, upstream, witnesses, klsTau, ortizTau, pureActionsFromIndices } from "../js/core/graphical.js";
import { irfanThresholdTree, matchingPennies, klsShapedTree, randomTree } from "../js/core/tree-presets.js";
import {
  LIG, fromUndirected, randomLIG, prefAttachLIG, enumerateBrute, enumerateBacktrack, consistent, greedyInfluential,
  exactInfluential, allMinimumInfluential, bestResponseDynamics, potential, theorem7Tables, knapsackStar, parseLIG, serializeLIG,
} from "../js/core/lig.js";
import { mulberry32 } from "../js/core/rng.js";

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log("  ok   " + name); }
  else { failed++; console.log("  FAIL " + name + (detail ? "  -- " + detail : "")); }
}
const key = (arr) => arr.map((a) => a.join("")).sort().join("|");

// ------------------------------------------------------------------ KLS / TreeNash
console.log("TreeNash (Kearns, Littman & Singh 2001)");
{
  const P = irfanThresholdTree();
  const r = treeNashTables(P.game, { root: P.root });
  const L = P.game.labels, idx = (name) => L.indexOf(name);
  // table entries in Irfan's slide format: (own action, child action) -> witness list (parents' actions)
  const table = (name) => {
    const V = idx(name), W = r.orientation.down[V], out = {};
    for (const va of [0, 1]) for (const wa of W === -1 ? [-1] : [0, 1]) {
      const vi = 1 - va, wi = wa === -1 ? -1 : 1 - wa;
      const on = W === -1 ? r.tables[V][vi] : r.tables[V][wi * 2 + vi];
      if (on) out[W === -1 ? `(${va})` : `(${va},${wa})`] = witnesses(P.game, r, V, vi, wi).map((t) => "(" + t.map((s) => 1 - s).join(",") + ")").sort().join(" ");
    }
    return out;
  };
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  check("Irfan slides PDF p. 7: U1 -> V table and witnesses", eq(table("U1"), { "(0,0)": "(0,0)", "(0,1)": "(0,0)", "(1,0)": "(1,1)", "(1,1)": "(1,1)" }), JSON.stringify(table("U1")));
  check("Irfan slides PDF p. 7: V -> W table and witnesses", eq(table("V"), { "(0,0)": "(0,0) (1,0)", "(0,1)": "(0,0)", "(1,0)": "(1,1)", "(1,1)": "(0,1) (1,1)" }), JSON.stringify(table("V")));
  for (const leaf of ["L1", "L2", "L3", "L4"]) check(`Irfan slides PDF p. 7: leaf ${leaf} table {(0,0),(1,1)}`, eq(Object.keys(table(leaf)).sort(), ["(0,0)", "(1,1)"]));
  check("Irfan slides PDF p. 7, root W: W=0 {(0,0)}, W=1 {(0,1),(1,1)} (slide also lists (1,0): see site note)", eq(table("W"), { "(0)": "(0,0)", "(1)": "(0,1) (1,1)" }), JSON.stringify(table("W")));
  const all = enumerateAll(P.game, r).map(pureActionsFromIndices);
  check("Threshold tree: TreeNash enumeration = brute force (5 PSNE)", key(all) === key(P.game.bruteForcePureNE()) && all.length === 5);
  // the three upstream illustrations on pp. 8-9 of Irfan's slide PDF (order L1 L2 U1 L3 V L4 W)
  const asStr = (a) => a.join("");
  check("Irfan slides PDF pp. 8-9: illustrated equilibria 0000011, 0001111, 1111111 are all found", ["0000011", "0001111", "1111111"].every((x) => all.map(asStr).includes(x)));
}
{
  let ok = true;
  for (let s = 1; s <= 60; s++) {
    const n = 2 + (s % 9);
    const P = randomTree(n, s);
    for (const root of [0, n - 1]) {
      const r = treeNashTables(P.game, { root });
      if (key(enumerateAll(P.game, r).map(pureActionsFromIndices)) !== key(P.game.bruteForcePureNE())) ok = false;
    }
  }
  check("Pure TreeNash = brute force on 60 random trees x 2 roots (pure analogue of KLS Thm 1)", ok);
}
{
  const P = matchingPennies();
  const pure = treeNashTables(P.game, { root: P.root });
  check("Matching pennies: pure root table is all zero (no PSNE)", [...pure.tables[P.root]].every((x) => x === 0));
  const ap = treeNashTables(P.game, { root: P.root, N: 10, eps: 0.01 });
  const feas = [...ap.tables[P.root]].map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
  const up = upstream(P.game, ap, feas[0]);
  check("Matching pennies: grid N=10, eps=0.01 recovers (1/2, 1/2) with zero regret", feas.length === 1 && up.strategy.every((p) => p === 0.5) && P.game.regret(up.strategy).worst < 1e-12);
}
{
  let ok = true, worst = 0, cases = 0;
  const games = [klsShapedTree(7), klsShapedTree(11), randomTree(7, 3), randomTree(8, 9), irfanThresholdTree()];
  for (const P of games) for (const eps of [0.05, 0.1, 0.2]) {
    const N = Math.ceil(1 / ortizTau(eps, P.game.maxK()) - 1e-12);
    const r = treeNashTables(P.game, { root: P.root, N, eps });
    const feas = [...r.tables[P.root]].map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
    if (!feas.length) ok = false;
    for (const z of [feas[0], feas[feas.length - 1]]) {
      for (const seed of [null, 1, 2]) {
        const up = upstream(P.game, r, z, { seed });
        const reg = P.game.regret(up.strategy).worst;
        worst = Math.max(worst, reg / eps);
        cases++;
        if (reg > eps + 1e-9) ok = false;
      }
    }
  }
  check(`ApproximateTreeNash with Ortiz grid: root non-empty and every recovered profile is an eps-NE (${cases} cases, max regret/eps = ${worst.toFixed(3)})`, ok);
}
check("KLS Thm 5 tau for eps=0.1, k=4 is 0.1/(64*4*2) = 1.953e-4 (log base 2)", Math.abs(klsTau(0.1, 4) - 0.1 / (64 * 4 * 2)) < 1e-15);
check("Ortiz tau = (1+eps)^(1/k) - 1 >= eps/(2k) for eps <= 1", [1, 2, 4, 8].every((k) => [0.01, 0.1, 0.5, 1].every((e) => ortizTau(e, k) >= e / (2 * k))));

// ------------------------------------------------------------------ IO / influence games
console.log("Influence games (Irfan & Ortiz 2011)");
const FIG1 = [[0, 1], [1, 2], [1, 3], [2, 4], [3, 4], [4, 5]];
const mask = (pm) => [...pm].reduce((m, c, i) => (c === "+" ? m | (1 << i) : m), 0);
{
  const g = fromUndirected(6, FIG1, 1, 0);
  const P = enumerateBrute(g).psne;
  // IO Fig. 1(b), rows read from the figure (players 1..6)
  const paper = ["------", "---+++", "--+-++", "++-+--", "+++---", "++++++"].map(mask).sort((a, b) => a - b);
  check("IO Fig. 1: exactly the 6 PSNE shown in Fig. 1(b)", JSON.stringify(P) === JSON.stringify(paper));
  const all = 63;
  check("IO Fig. 1: S = {1,2,3} leaves 2 consistent PSNE (Fig. 1(c),(d))", consistent(P, all, [0, 1, 2]).length === 2);
  check("IO Fig. 1: S = {1,6} leaves only the target", consistent(P, all, [0, 5]).length === 1);
  const opt = allMinimumInfluential(P, all, 6);
  check("IO Fig. 1: minimum size is 2 and {1,6} is among the optimal sets", opt.size === 2 && opt.sets.some((s) => s.join() === "0,5"), JSON.stringify(opt.sets));
  check("Prop 5: potential Phi(all +1) = 6 = #edges (our slide 61)", potential(g, all) === 6);
}
{
  const m = (arr) => arr.reduce((acc, x, i) => (x === 1 ? acc | (1 << i) : acc), 0);
  const tri = m([1, -1, -1, 1, -1, -1, 1, -1, -1]), rect = m([-1, -1, -1, -1, -1, -1, 1, 1, 1]), hex = m([-1, -1, -1, -1, -1, 1, -1, 1, 1]);
  const gr = greedyInfluential([tri, rect, hex], rect, 9);
  check("IO Fig. 2 hypergraph, target = rectangle: greedy gives {1,6} (our slide 67), optimal size 2", gr.S.join() === "0,5" && exactInfluential([tri, rect, hex], rect, 9).S.length === 2);
}
{
  const g = fromUndirected(6, FIG1, 1, 0);
  g.b[1] = -1.5; g.b[2] = -2.5;
  const r = bestResponseDynamics(g);
  check("Our slide 60: best-response dynamics adopt 3, then 2, then 1, then stop", JSON.stringify(r.rounds.map((x) => x.movers)) === "[[2],[1],[0]]" && r.isPSNE);
  check("Our slide 60: at the end f4 = 0, f5 < 0, f6 < 0, f1 = 1", g.f(3, r.final) === 0 && g.f(4, r.final) < 0 && g.f(5, r.final) < 0 && g.f(0, r.final) === 1);
}
{
  const arcs = [];
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) if (i !== j) arcs.push([j, i, -1]);
  check("Our slide 62: anti-coordination on K6 has 20 PSNE (all 3-3 splits)", enumerateBrute(new LIG(6, new Array(6).fill(0), arcs)).psne.length === 20);
}
{
  let ok = true;
  for (let s = 0; s < 200; s++) { const g = randomLIG(12, (s % 9) / 8, s); if (enumerateBrute(g).psne.join() !== enumerateBacktrack(g).psne.join()) ok = false; }
  for (let s = 0; s < 60; s++) { const g = prefAttachLIG(14, (s % 5) / 4, s); if (enumerateBrute(g).psne.join() !== enumerateBacktrack(g).psne.join()) ok = false; }
  check("Backtracking with IO's pruning = brute force on 260 random / pref.-attachment LIGs", ok);
}
{
  let ok = true;
  const rand = mulberry32(42);
  for (let t = 0; t < 100; t++) {
    const g = randomLIG(10, rand(), t);
    const P = enumerateBrute(g).psne;
    if (!P.length) continue;
    const target = P[Math.floor(rand() * P.length)];
    const gr = greedyInfluential(P, target, 10).S;
    const ex = exactInfluential(P, target, 10).S;
    if (consistent(P, target, gr).length !== 1 || consistent(P, target, ex).length !== 1 || ex.length > gr.length) ok = false;
    const H = P.length;
    if (gr.length > (1 + Math.log(H)) * Math.max(1, ex.length) + 1e-9) ok = false;
  }
  check("Greedy and exact sets always pin down the target; greedy within (1 + ln h) of optimal", ok);
}
{
  const rand = mulberry32(5);
  let bad = 0, badNoB = 0, withB = 0;
  for (let s = 0; s < 300; s++) {
    const n = 2 + Math.floor(rand() * 8);
    const arcs = [], edges = [];
    for (let v = 1; v < n; v++) {
      const u = Math.floor(rand() * v);
      edges.push([u, v]);
      const w = () => [-2, -1, -0.5, 1, 2][Math.floor(rand() * 5)];
      arcs.push([u, v, w()], [v, u, w()]);
    }
    const b = Array.from({ length: n }, () => [-1, -0.5, 0, 0.5, 1][Math.floor(rand() * 5)]);
    const g = new LIG(n, b, arcs);
    const root = Math.floor(rand() * n);
    const tg = new TreeGame(n, edges, (i, own, act) => {
      let f = -g.b[i];
      for (const [j, w] of g.inArcs[i]) f += w * (act(j) ? 1 : -1);
      return (own ? 1 : -1) * f;
    });
    const gen = treeNashTables(tg, { root });
    const cmp = (io) => {
      let c = 0;
      for (let i = 0; i < n; i++) {
        const T = io.tables[i], U = gen.tables[i];
        if (io.down[i] === -1) { for (let a = 0; a < 2; a++) if (T[a] !== U[1 - a]) c++; }
        else for (let aj = 0; aj < 2; aj++) for (let ai = 0; ai < 2; ai++) if (T[aj * 2 + ai] !== U[(1 - aj) * 2 + (1 - ai)]) c++;
      }
      return c;
    };
    bad += cmp(theorem7Tables(g, root));
    if (enumerateBrute(g).psne.length !== enumerateAll(tg, gen).length) bad++;
    // the inequality exactly as printed in IO (no threshold term) = our routine on the same game with b = 0
    if (b.some((x) => x !== 0)) { withB++; if (cmp(theorem7Tables(new LIG(n, new Array(n).fill(0), arcs), root)) > 0) badNoB++; }
  }
  check("Thm 7 inequality (with -b_i) = generic TreeNash tables on 300 random tree LIGs", bad === 0, `${bad} mismatches`);
  check(`Thm 7 inequality as printed (without b_i) disagrees on ${badNoB}/${withB} instances with b != 0 (documents our correction)`, badNoB > 0);
}
{
  const rand = mulberry32(9);
  let ok = true;
  for (let t = 0; t < 60; t++) {
    const m = 1 + Math.floor(rand() * 8);
    const a = Array.from({ length: m }, () => 1 + Math.floor(rand() * 9));
    const W = 1 + Math.floor(rand() * 20);
    const r = knapsackStar(a, W);
    if (r.psne !== r.feasible) ok = false;
  }
  check("Thm 8(3): #PSNE of the star = #feasible knapsack subsets on 60 random instances", ok);
}
{
  const rand = mulberry32(3);
  let maxErr = 0;
  for (let t = 0; t < 50; t++) {
    const n = 3 + Math.floor(rand() * 6);
    const arcs = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (rand() < 0.6) { const w = Math.round((rand() * 4 - 2) * 4) / 4 || 1; arcs.push([i, j, w], [j, i, w]); }
    const g = new LIG(n, Array.from({ length: n }, () => Math.round((rand() * 2 - 1) * 4) / 4), arcs);
    for (let m = 0; m < 1 << n; m++) for (let k = 0; k < n; k++) {
      const m2 = m ^ (1 << k);
      const du = g.x(m2, k) * g.f(k, m2) - g.x(m, k) * g.f(k, m);
      maxErr = Math.max(maxErr, Math.abs(potential(g, m2) - potential(g, m) - du));
    }
  }
  check("Prop 5: Phi is an exact potential on 50 random symmetric LIGs (all deviations)", maxErr < 1e-9, `max error ${maxErr}`);
}
{
  const g = randomLIG(9, 0.4, 77);
  const back = parseLIG(serializeLIG(g));
  check("Text format round-trip preserves the game", enumerateBrute(back).psne.join() === enumerateBrute(g).psne.join() && back.arcs().length === g.arcs().length);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
