import { h, $, fill, chrome, drawGraph, treeLayout, fmt, fidelityTable } from "./ui/common.js";
import { treeNashTables, upstream, enumerateAll, witnesses, klsTau, ortizTau, orient, pureActionsFromIndices } from "./core/graphical.js";
import { irfanThresholdTree, matchingPennies, klsShapedTree, randomTree } from "./core/tree-presets.js";

chrome("treenash.html");

const PRESETS = {
  irfan: { label: "Threshold game of complements (Irfan slides)", make: () => irfanThresholdTree() },
  pennies: { label: "Matching pennies (no pure equilibrium)", make: () => matchingPennies() },
  kls: { label: "KLS Fig. 2 shape, M/O players (our payoffs)", make: () => klsShapedTree(7) },
  random: { label: "Random tree, Uniform[0,1] payoffs", make: () => randomTree(state.n, state.seed) },
};
const MAX_WORK = 4e8;
// "Pure" is a mode (grid {0,1} AND eps = 0), not just N = 1: ApproximateTreeNash with N = 1 and
// eps > 0 also uses the grid {0,1}, but its outputs are eps-equilibria, not pure Nash equilibria.
const isPure = () => state.mode === "pure";

const state = {
  preset: "irfan", mode: "pure", eps: 0.05, tauMode: "ortiz", manualN: 10, n: 7, seed: 1,
  root: null, step: 0, witnessMode: "first", witnessSeed: 1,
  preset_obj: null, game: null, result: null, up: null, error: null,
};

// ---------------------------------------------------------------- controls

function select(id, label, options, value, onchange) {
  const sel = h("select", { id }, options.map(([v, t]) => h("option", { value: v, selected: v === value }, t)));
  sel.addEventListener("change", () => onchange(sel.value));
  return h("label", { for: id }, label, sel);
}
function number(id, label, value, attrs, onchange) {
  const inp = h("input", { id, type: "number", value, ...attrs });
  inp.addEventListener("change", () => { const v = Number(inp.value); if (Number.isFinite(v)) onchange(v); });
  return h("label", { for: id }, label, inp);
}

function renderControls() {
  const c = $("#controls");
  fill(c, ...[
    select("preset", "Game", Object.entries(PRESETS).map(([k, p]) => [k, p.label]), state.preset, (v) => { state.preset = v; state.root = null; rebuild(); }),
    state.preset === "random" ? number("rn", "Players n", state.n, { min: 2, max: 10, step: 1 }, (v) => { state.n = Math.max(2, Math.min(10, Math.round(v))); state.root = null; rebuild(); }) : null,
    state.preset === "random" ? number("rs", "Seed", state.seed, { min: 0, step: 1 }, (v) => { state.seed = Math.round(v); state.root = null; rebuild(); }) : null,
    select("mode", "Variant", [["pure", "Pure-strategy TreeNash (grid {0,1}, ε = 0)"], ["approx", "ApproximateTreeNash (τ-grid, ε-best responses)"]], state.mode, (v) => { state.mode = v; rebuild(); }),
    state.mode === "approx" ? number("eps", "ε", state.eps, { min: 0.01, max: 1, step: 0.01 }, (v) => { state.eps = Math.min(1, Math.max(0.01, v)); rebuild(); }) : null,
    state.mode === "approx" ? select("taumode", "Grid τ = 1/N", [["ortiz", "From Ortiz (2002) bound"], ["manual", "Manual N"]], state.tauMode, (v) => { state.tauMode = v; rebuild(); }) : null,
    state.mode === "approx" && state.tauMode === "manual" ? number("mn", "N", state.manualN, { min: 1, max: 80, step: 1 }, (v) => { state.manualN = Math.max(1, Math.min(80, Math.round(v))); rebuild(); }) : null,
    state.game ? select("root", "Root", state.game.labels.map((l, i) => [String(i), l]), String(state.root), (v) => { state.root = Number(v); rebuild(); }) : null,
  ].filter(Boolean));
}

// ---------------------------------------------------------------- build

function rebuild() {
  state.error = null;
  state.up = null;
  state.step = 0;
  try {
    state.preset_obj = PRESETS[state.preset].make();
  } catch (e) { state.error = e.message; }
  const P = state.preset_obj;
  state.game = P.game;
  if (state.root === null) state.root = P.root;
  const k = state.game.maxK();
  let N = 1, eps = 0;
  if (state.mode === "approx") {
    eps = state.eps;
    N = state.tauMode === "ortiz" ? Math.ceil(1 / ortizTau(eps, k) - 1e-12) : state.manualN;
  }
  const or = orient(state.game, state.root);
  const G = N + 1;
  let work = 0;
  for (let v = 0; v < state.game.n; v++) {
    const m = or.ups[v].length;
    work += Math.pow(G, m + 1) * (G + Math.pow(2, m + 2));
  }
  state.work = work;
  state.N = N;
  state.epsUsed = eps;
  state.result = null;
  if (work > MAX_WORK) {
    state.error = `This grid would need roughly ${work.toExponential(1)} elementary operations, which is too slow for a browser demo. The cost grows like (N + 1)^(parents + 1) at each vertex, so try rooting the tree at a leaf (every vertex then has at most degree − 1 parents), lowering N, or raising ε.`;
  } else {
    const t0 = performance.now();
    state.result = treeNashTables(state.game, { root: state.root, N, eps });
    state.ms = performance.now() - t0;
  }
  renderControls();
  renderBounds();
  renderAll();
}

function renderBounds() {
  const out = $("#bounds");
  fill(out);
  const g = state.game;
  const [lo, hi] = g.payoffRange();
  const k = g.maxK();
  if (state.mode === "pure") {
    out.append(h("p", { class: "small muted" },
      `Pure variant: strategies restricted to {0, 1} and exact best responses (N = 1, ε = 0). Max neighbourhood size k = ${k} (including the player); payoffs in [${fmt(lo)}, ${fmt(hi)}].`),
      h("p", { class: "small muted" }, "This is cheap because each table has only 2 × 2 entries and each vertex checks at most 2^(parents) witness combinations. It is not KLS's exact algorithm for mixed equilibria (§6, unions of rectangles), which can take time exponential in n and is not implemented here. ApproximateTreeNash is more expensive than this pure variant because it searches (N + 1) grid points per player instead of 2."));
  } else {
    const tk = klsTau(state.eps, k), to = ortizTau(state.eps, k), tau = 1 / state.N;
    const guaranteed = tau <= to + 1e-12;
    out.append(h("div", { class: "card" },
      h("dl", { class: "kv" },
        h("dt", {}, "k = max |N_G(i)| (incl. i)"), h("dd", {}, String(k)),
        h("dt", {}, "Payoff range"), h("dd", {}, `[${fmt(lo)}, ${fmt(hi)}] (KLS assume |payoff| ≤ 1; Ortiz's proof implicitly uses payoffs in [0,1])`),
        h("dt", {}, "KLS Thm 5: τ ≤ min(ε/(2^{k+2} k log k), 2/(k log²(k/2)))"), h("dd", {}, `${fmt(tk, 6)}  →  N ≥ ${Number.isFinite(tk) ? Math.ceil(1 / tk).toLocaleString() : "1"} grid steps`),
        h("dt", {}, "Ortiz (2002): τ ≤ (1+ε)^{1/k} − 1"), h("dd", {}, `${fmt(to, 6)}  →  N ≥ ${Math.ceil(1 / to - 1e-12)}`),
        h("dt", {}, "Grid used"), h("dd", {}, `τ = 1/${state.N} = ${fmt(tau, 4)}, ${state.N + 1} points per player, ${((state.N + 1) ** 2).toLocaleString()} entries per table`),
        h("dt", {}, "Existence guarantee"), h("dd", { class: guaranteed ? "ok" : "bad" }, guaranteed
          ? "τ satisfies Ortiz's bound, so an ε-NE lies on the grid and the root table is non-empty."
          : "τ is coarser than Ortiz's bound. The root table may be empty. Any equilibrium that is found is still an ε-NE (checked exactly below)."),
      ),
      h("p", { class: "small muted", style: "margin-bottom:0" },
        "KLS Thm 5 is a sufficient condition and very conservative: KLS's own Fig. 2 was computed with τ = 0.01 and ε = 0.05. We default to Ortiz's refinement because it is also a proven sufficient condition and is feasible in a browser. ",
        "Logs are base 2: KLS's proof of Lemma 2 uses log(k/2) = log k − 1. Either way, every recovered profile is checked by computing its exact regret, so correctness of the output does not rest on the bound.")));
  }
  if (state.error) out.append(h("p", { class: "err" }, state.error));
}

// ---------------------------------------------------------------- rendering

const actLabel = (idx) => String(1 - idx); // N = 1: grid index 0 = Pr[0] = 0 = action 1

function stratLabel(idx) {
  return isPure() ? `a=${actLabel(idx)}` : `p₀=${fmt(idx / state.N, 2)}`;
}

function renderGraph() {
  const g = state.game, r = state.result;
  const or = r ? r.orientation : orient(g, state.root);
  const P = state.preset_obj;
  let pos, height;
  if (P.layout && state.root === P.root) {
    pos = P.layout;
    height = Math.max(...Object.values(pos).map((p) => p[1])) + 40;
  } else ({ pos, height } = treeLayout(g.n, or.ups, state.root, 420, 75));
  const done = new Set(or.leavesFirst.slice(0, state.step));
  const current = state.step < g.n ? or.leavesFirst[state.step] : null;
  const choice = state.up ? state.up.choice : null;
  drawGraph($("#graph"), {
    uid: "tn", width: 420, height: height + 10, pos,
    nodes: Array.from({ length: g.n }, (_, i) => {
      let cls = done.has(i) ? "done" : "";
      if (i === current && r) cls += " active";
      let pie = null, sub = null;
      if (choice) {
        if (isPure()) cls = choice[i] === 0 ? "plus" : "minus";
        else pie = choice[i] / state.N;
        sub = stratLabel(choice[i]);
      }
      return { id: i, label: g.labels[i], cls, pie, sub, title: `${g.labels[i]}${i === state.root ? " (root)" : ""}` };
    }),
    edges: g.edges.map(([a, b]) => {
      const [from, to] = or.down[a] === b ? [a, b] : [b, a];
      return { a: from, b: to, directed: true, cls: from === current ? "active" : "", title: `${g.labels[from]} sends T(w, v) to ${g.labels[to]}` };
    }),
  });
  fill($("#graph-legend"), 
    ...(isPure()
      ? [h("span", { style: "--sw: var(--plus)" }, "plays action 1"), h("span", { style: "--sw: var(--minus)" }, "plays action 0")]
      : [h("span", { style: "--sw: var(--minus)" }, "pie share = Pr[action 0]"), h("span", { style: "--sw: var(--plus)" }, "Pr[action 1]")]),
    h("span", { style: "--sw: var(--accent-soft)" }, "table computed"),
    h("span", { style: "--sw: var(--sel)" }, "current vertex / message"));
  $("#source").textContent = "Source of this game: " + P.source;
}

function renderProgress() {
  const g = state.game, r = state.result;
  const kv = $("#progress");
  fill(kv);
  $("#step").disabled = !r || state.step >= g.n;
  $("#runall").disabled = !r || state.step >= g.n;
  if (!r) return;
  const or = r.orientation;
  const cur = state.step < g.n ? or.leavesFirst[state.step] : null;
  const add = (k, v) => kv.append(h("dt", {}, k), h("dd", {}, v));
  add("Processed", `${state.step} / ${g.n} vertices`);
  if (cur !== null) {
    const W = or.down[cur];
    add("Next", `${g.labels[cur]}: ${or.ups[cur].length ? "parents " + or.ups[cur].map((u) => g.labels[u]).join(", ") : "leaf"}; ${W === -1 ? "root (no child)" : "child " + g.labels[W]}`);
  }
  if (state.step === g.n) {
    add("Witness tuples examined", r.stats.tupleChecks.toLocaleString());
    add("Wall time (full pass)", `${fmt(state.ms, 1)} ms`);
  }
  $("#step").disabled = state.step >= g.n;
  $("#runall").disabled = state.step >= g.n;
}

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function renderTables() {
  const g = state.game, r = state.result;
  const out = $("#tables-out");
  fill(out);
  if (!r) return;
  const or = r.orientation;
  const order = or.leavesFirst.slice(0, state.step);
  if (!order.length) { out.append(h("p", { class: "muted" }, "No tables yet. Process a vertex.")); return; }
  const G = state.N + 1;
  if (isPure()) {
    fill($("#tables-intro"), h("p", {}, "Each table lists the pairs (", h("em", {}, "v"), ", ", h("em", {}, "w"),
      ") = (own action, child's action) with T = 1, followed by every witness: the parents' actions, in the order shown. The format matches Irfan's CSCI 3210 slides."));
    const grid = h("div", { class: "grid2" });
    for (const V of order) {
      const W = or.down[V];
      const U = or.ups[V];
      const rows = [];
      const pairs = W === -1 ? [0, 1].map((v) => [v, -1]) : [[0, 0], [0, 1], [1, 0], [1, 1]];
      for (const [va, wa] of pairs) {
        const vi = 1 - va, wi = wa === -1 ? -1 : 1 - wa;
        const on = W === -1 ? r.tables[V][vi] : r.tables[V][wi * G + vi];
        const wits = on ? witnesses(g, r, V, vi, wi) : [];
        rows.push(h("tr", { class: on ? "" : "muted" },
          h("td", { class: "mono" }, W === -1 ? `(${va})` : `(${va},${wa})`),
          h("td", { class: on ? "ok" : "" }, on ? "1" : "0"),
          h("td", { class: "mono" }, U.length === 0 ? (on ? "{ } (leaf)" : "") : on ? "{" + wits.map((t) => "(" + t.map(actLabel).join(",") + ")").join(", ") + "}" : "")));
      }
      grid.append(h("div", { class: "card" },
        h("strong", {}, W === -1 ? `Root table T(${g.labels[V]})` : `T sent ${g.labels[V]} → ${g.labels[W]}`),
        h("div", { class: "small muted" }, U.length ? `witness order: (${U.map((u) => g.labels[u]).join(", ")})` : "leaf: T(w,v) = 1 iff v is a best response to w"),
        h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, W === -1 ? "(v)" : "(v,w)"), h("th", {}, "T"), h("th", {}, "witnesses"))), h("tbody", {}, rows))));
    }
    out.append(grid);
    return;
  }
  fill($("#tables-intro"), h("p", {}, "Each heat map is a table ", h("em", {}, "T"), "(", h("em", {}, "w"), ",", h("em", {}, "v"),
    `) on the ${G} × ${G} grid. Horizontal axis: the sender's Pr[action 0] (`, h("em", {}, "v"), ", 0 → 1 left to right). Vertical axis: the child's Pr[action 0] (",
    h("em", {}, "w"), ", 0 → 1 bottom to top). Filled cells are 1. After the upstream pass the chosen (", h("em", {}, "w"), ",", h("em", {}, "v"),
    ") cell is outlined. KLS Fig. 2 draws the same kind of picture."));
  const on = cssVar("--accent"), off = cssVar("--surface-2"), sel = cssVar("--sel");
  const grid = h("div", { class: "heatgrid" });
  for (const V of order) {
    const W = or.down[V];
    const rows = W === -1 ? 1 : G;
    const scale = Math.max(2, Math.floor(160 / G));
    const cv = h("canvas", { width: G * scale, height: rows * (W === -1 ? scale * 3 : scale), role: "img",
      "aria-label": W === -1 ? `Root table of ${g.labels[V]}` : `Table sent from ${g.labels[V]} to ${g.labels[W]}` });
    const ctx = cv.getContext("2d");
    const cellH = W === -1 ? scale * 3 : scale;
    let ones = 0;
    for (let wi = 0; wi < rows; wi++)
      for (let vi = 0; vi < G; vi++) {
        const bit = W === -1 ? r.tables[V][vi] : r.tables[V][wi * G + vi];
        ones += bit;
        ctx.fillStyle = bit ? on : off;
        ctx.fillRect(vi * scale, (rows - 1 - wi) * cellH, scale, cellH);
      }
    if (state.up) {
      const vi = state.up.choice[V], wi = W === -1 ? 0 : state.up.choice[W];
      ctx.strokeStyle = sel;
      ctx.lineWidth = Math.max(2, scale / 2);
      ctx.strokeRect(vi * scale - 1, (rows - 1 - wi) * cellH - 1, scale + 2, cellH + 2);
    }
    grid.append(h("figure", { class: "heat" }, cv,
      h("figcaption", {}, W === -1 ? `Root ${g.labels[V]}: T(z), z on the horizontal axis` : `${g.labels[V]} → ${g.labels[W]}`, h("br"),
        `${ones} of ${rows * G} entries are 1`)));
  }
  out.append(grid);
}

function renderUpstreamControls() {
  const g = state.game, r = state.result;
  const box = $("#upstream-controls");
  fill(box);
  if (!r || state.step < g.n) { $("#upstream-log").textContent = "Finish the downstream pass first."; return; }
  const rootT = r.tables[r.orientation.root];
  const feasible = [];
  for (let z = 0; z < rootT.length; z++) if (rootT[z]) feasible.push(z);
  if (!feasible.length) {
    $("#upstream-log").textContent = isPure()
      ? "The root table is all zero. The pure-strategy analogue of KLS Theorem 1 (as taught in Irfan's slides) then implies the game has NO pure-strategy Nash equilibrium. Switch to ApproximateTreeNash to find a mixed ε-equilibrium."
      : "The root table is all zero: there is no ε-Nash equilibrium on this grid. Use a finer grid (larger N) or a larger ε.";
    return;
  }
  if (state.rootChoice === undefined || !feasible.includes(state.rootChoice)) state.rootChoice = feasible[Math.floor(feasible.length / 2)];
  const rootName = g.labels[r.orientation.root];
  box.append(
    select("rootval", `Root ${rootName} plays`, feasible.map((z) => [String(z), isPure() ? `action ${actLabel(z)}` : `Pr[0] = ${fmt(z / state.N, 3)}`]), String(state.rootChoice), (v) => { state.rootChoice = Number(v); }),
    select("witmode", "Witness rule", [["first", "First in grid order"], ["random", "Uniformly random order (seeded)"]], state.witnessMode, (v) => { state.witnessMode = v; }),
    h("button", { class: "primary", type: "button", onclick: () => runUpstream() }, "Recover equilibrium"),
  );
  $("#upstream-log").textContent = `${feasible.length} feasible root value(s). Choose one; KLS leave the choice non-deterministic (§4).`;
}

function runUpstream() {
  const g = state.game, r = state.result;
  state.up = upstream(g, r, state.rootChoice, { seed: state.witnessMode === "random" ? state.witnessSeed++ : null });
  const lines = [`${g.labels[r.orientation.root]} (root) decides to play ${stratLabel(state.rootChoice)}.`];
  for (const t of state.up.trace) lines.push(`${g.labels[t.from]} → ${g.labels[t.to]}: "I play ${stratLabel(t.v)}; you play ${stratLabel(t.u)}."`);
  $("#upstream-log").textContent = lines.join("\n");
  renderAll(false);
}

function renderResult() {
  const g = state.game, r = state.result;
  const out = $("#result-out");
  if (!state.up) { fill(out, h("p", { class: "muted" }, "Run both passes to see the recovered strategy profile.")); return; }
  const p = state.up.strategy;
  const reg = g.regret(p);
  const rows = Array.from({ length: g.n }, (_, i) => {
    const [a0, a1] = g.pureActionPayoffs(i, p);
    const cur = p[i] * a0 + (1 - p[i]) * a1;
    return h("tr", {}, h("td", {}, g.labels[i]), h("td", { class: "num" }, isPure() ? actLabel(state.up.choice[i]) : fmt(p[i], 4)),
      h("td", { class: "num" }, fmt(cur, 4)), h("td", { class: "num" }, fmt(Math.max(a0, a1), 4)), h("td", { class: "num" }, fmt(reg.per[i], 5)));
  });
  const ok = reg.worst <= state.epsUsed + 1e-9;
  fill(out, 
    h("div", { class: "scroll" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "Player"), h("th", { class: "num" }, isPure() ? "action" : "Pr[action 0]"), h("th", { class: "num" }, "expected payoff"),
        h("th", { class: "num" }, "best-response payoff"), h("th", { class: "num" }, "regret"))),
      h("tbody", {}, rows))),
    h("p", {}, "Maximum regret ", h("strong", {}, fmt(reg.worst, 6)), isPure() ? " (must be 0 for a pure NE): " : ` vs ε = ${state.epsUsed}: `,
      h("span", { class: ok ? "ok" : "bad" }, ok ? (isPure() ? "✓ pure Nash equilibrium" : "✓ ε-Nash equilibrium") : "✗ not an equilibrium (please report this)")),
    h("p", { class: "small muted" }, "Regret is computed exactly from the local game matrices: best pure-action payoff minus current expected payoff, given everyone else's recovered strategy."),
  );
  if (isPure()) {
    const all = enumerateAll(g, r).map(pureActionsFromIndices);
    const bf = g.bruteForcePureNE();
    const key = (a) => a.join("");
    const same = all.length === bf.length && all.map(key).sort().join() === bf.map(key).sort().join();
    out.append(h("h3", {}, "Every pure equilibrium represented by the tables"),
      h("p", {}, `Enumerating all root values and all witnesses gives ${all.length} pure NE. Brute force over all 2^${g.n} = ${2 ** g.n} profiles gives ${bf.length}. `,
        h("span", { class: same ? "ok" : "bad" }, same ? "✓ identical sets (pure-strategy analogue of KLS Thm 1)" : "✗ mismatch")),
      h("div", { class: "scroll" }, h("table", {},
        h("thead", {}, h("tr", {}, g.labels.map((l) => h("th", {}, l)))),
        h("tbody", {}, all.slice(0, 64).map((a) => h("tr", {}, a.map((x) => h("td", { class: "mono" }, String(x))))))),
      all.length > 64 ? h("p", { class: "small muted" }, `(first 64 of ${all.length} shown)`) : null));
  }
}

function renderAll(resetUp = true) {
  if (resetUp && state.step < state.game.n) state.up = null;
  renderGraph();
  renderProgress();
  renderTables();
  if (resetUp) renderUpstreamControls();
  renderResult();
}

$("#step").addEventListener("click", () => { if (state.result && state.step < state.game.n) { state.step++; renderAll(); } });
$("#runall").addEventListener("click", () => { if (state.result) { state.step = state.game.n; renderAll(); } });
$("#reset").addEventListener("click", () => { state.step = 0; state.up = null; renderAll(); });

// ---------------------------------------------------------------- fidelity notes

$("#fidelity-out").append(fidelityTable([
  ["Graphical game (G, ℳ), table semantics, witnesses, two passes", "paper", "KLS §3–4 and Fig. 1 (abstract TreeNash). Tables are indexed as T(w, v) with w the child's strategy, as in KLS."],
  ["Pure-strategy variant (grid {0,1})", "slides", "KLS state TreeNash for mixed strategies. Restricting every player to {0,1} gives the pure-strategy TreeNash taught in Irfan's CSCI 3210 slides (\"Graphical Games\", 2018). Here it is the same engine with N = 1 and ε = 0."],
  ["ApproximateTreeNash: τ-grid and ε-best responses", "paper", "KLS §5 and Theorem 5. Strategies live on {0, τ, 2τ, …, 1}, and every best-response test becomes an ε-best-response test."],
  ["Default grid size", "ours", "We use Ortiz's refinement τ ≤ (1+ε)^{1/k} − 1 (L. E. Ortiz, “Approximation Bound Refinement of KLS”, Dec. 2002 note) instead of KLS Theorem 5, which needs τ around 10⁻⁴ for k = 4 and ε = 0.1. KLS assume |payoff| ≤ 1 (their footnote 3); Ortiz's proof implicitly uses payoffs in [0,1]. All presets have payoffs in [0,1], so both apply. KLS Thm 5 is sufficient, not necessary: their own Fig. 2 used τ = 0.01, ε = 0.05."],
  ["Witness lists", "ours", "KLS store witness lists on the downstream pass (Fig. 1, step 2(d)iiA). To save memory we regenerate witnesses on demand during the upstream pass, as KLS suggest for their exact algorithm (§6). The result is the same."],
  ["Root value and witness choice", "ours", "KLS leave both non-deterministic. You pick the root value; witnesses are taken either first in grid order or in a seeded random order."],
  ["Preset payoffs", "ours", "Threshold game: rule and tree from Irfan's slides, encoded as 0/1 payoffs with the same best responses. Matching pennies: standard. M/O tree: shape and player types from KLS Fig. 2, but KLS do not publish its payoffs, so ours are illustrative and the heat maps will differ from theirs. Random: i.i.d. Uniform[0,1] entries."],
  ["Exact algorithm with unions of rectangles (KLS §6)", "no", "Not implemented. Exponential time in the worst case. Littman, Kearns &amp; Singh (NIPS 2001) later give an exact polynomial-time algorithm for a single NE on trees; that is not implemented either."],
  ["Extensions (KLS §7): multiple actions, vertex merging, special equilibria", "no", "Not implemented."],
]));

$("#slide-note").append(
  h("p", {}, h("strong", {}, "Note on the threshold-game preset. "),
    "With the root at W, our tables reproduce pp. 7–9 of Irfan's slide PDF (two slides per page) entry for entry, with one exception. The root table on p. 7 lists witnesses {(0,1), (1,0), (1,1)} for W = 1 (pairs (V, L4)); we find only (0,1) and (1,1). L4 is a leaf whose only neighbour is W (t = ½), so L4 must copy W, and (V, L4) = (1,0) cannot occur when W plays 1. We believe the extra entry is a typo. The upstream illustrations on pp. 8–9 (equilibria 0000011, 0001111 and 1111111 in the order L1 L2 U1 L3 V L4 W) are unaffected; all three are among the five PSNE found here."));

rebuild();
