import { h, $, fill, chrome, drawGraph, circleLayout, treeLayout, fmt, fidelityTable } from "./ui/common.js";
import {
  LIG, fromUndirected, randomLIG, prefAttachLIG, parseLIG, serializeLIG, enumerateBrute, enumerateBacktrack,
  consistent, greedyInfluential, allMinimumInfluential, bestResponseDynamics, potential, theorem7Tables, knapsackStar,
} from "./core/lig.js";
import { TreeGame, treeNashTables, enumerateAll } from "./core/graphical.js";
import { mulberry32 } from "./core/rng.js";

chrome("influence.html");

const FIG1_EDGES = [[0, 1], [1, 2], [1, 3], [2, 4], [3, 4], [4, 5]];
const FIG1_POS = { 0: [210, 32], 1: [210, 100], 2: [130, 170], 3: [290, 170], 4: [210, 240], 5: [210, 308] };

const PRESETS = {
  fig1: {
    label: "IO Figure 1: majority game on 6 nodes",
    make: () => ({ g: fromUndirected(6, FIG1_EDGES, 1, 0), pos: FIG1_POS, height: 340,
      source: "IO Fig. 1. Each node wants to match the majority of its neighbours and is indifferent on ties: w = 1 on both arcs of every edge, b = 0." }),
  },
  slide60: {
    label: "Fig. 1 network, two eager adopters (our slide 60)",
    make: () => {
      const g = fromUndirected(6, FIG1_EDGES, 1, 0);
      g.b[1] = -1.5; g.b[2] = -2.5;
      return { g, pos: FIG1_POS, height: 340, source: "Our presentation, slide 60: the Fig. 1 network with b₂ = −1.5 and b₃ = −2.5 (all weights non-negative, so Thm 4 applies)." };
    },
  },
  anti: {
    label: "Anti-coordination, complete graph (our slide 62)",
    make: () => {
      const arcs = [];
      for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) if (i !== j) arcs.push([j, i, -1]);
      return { g: new LIG(6, new Array(6).fill(0), arcs), pos: circleLayout(6, 420, 330), height: 330,
        source: "Our presentation, slide 62: indiscriminate LIG with δᵢ = −1 and b = 0 on 6 players (Prop. 6 with ρ = −1). Every 3–3 split is a PSNE." };
    },
  },
  random: {
    label: "Random LIG (IO §Experiments)",
    params: true,
    make: (st) => ({ g: randomLIG(st.n, st.p, st.seed), pos: circleLayout(st.n, 420, 400), height: 400,
      source: `IO-style random LIG: n = ${st.n}, each ordered pair an arc w.p. 0.5, weight −1 w.p. p = ${st.p} (else +1), b = 0 (our assumption), seed ${st.seed}.` }),
  },
  pa: {
    label: "Preferential-attachment LIG (IO §Experiments)",
    params: true,
    make: (st) => ({ g: prefAttachLIG(st.n, st.p, st.seed), pos: circleLayout(st.n, 420, 400), height: 400,
      source: `IO-style preferential attachment: triangle seed, each new node links to 3 existing nodes ∝ degree, links bidirectional, each arc −1 w.p. p = ${st.p}, b = 0, seed ${st.seed}.` }),
  },
};

const state = {
  preset: "fig1", n: 12, p: 0.5, seed: 1,
  g: null, pos: null, height: 340, source: "",
  psne: [], enum: null, target: null, S: new Set(), greedySteps: 0, exact: null,
  method: "auto", t7: { n: 7, seed: 3, root: 0 }, exp: { n: 25, graphs: 30, seed: 1 },
};

const bitsOf = (mask, n) => Array.from({ length: n }, (_, i) => (mask >> i) & 1);

// ------------------------------------------------------------------ controls

function select(id, label, options, value, onchange) {
  const sel = h("select", { id }, options.map(([v, t]) => h("option", { value: v, selected: String(v) === String(value) }, t)));
  sel.addEventListener("change", () => onchange(sel.value));
  return h("label", { for: id }, label, sel);
}
function number(id, label, value, attrs, onchange) {
  const inp = h("input", { id, type: "number", value, ...attrs });
  inp.addEventListener("change", () => { const v = Number(inp.value); if (Number.isFinite(v)) onchange(v); });
  return h("label", { for: id }, label, inp);
}

function renderControls() {
  const P = PRESETS[state.preset];
  fill($("#controls"), ...[
    select("preset", "Instance", [...Object.entries(PRESETS).map(([k, p]) => [k, p.label]), ["custom", "Custom (edit as text)"]], state.preset, (v) => {
      state.preset = v;
      if (v === "custom") { $("#editor-box").open = true; renderControls(); return; }
      load();
    }),
    P && P.params ? number("n", "Players n", state.n, { min: 3, max: 25, step: 1 }, (v) => { state.n = Math.max(3, Math.min(25, Math.round(v))); load(); }) : null,
    P && P.params ? number("p", "Flip probability p", state.p, { min: 0, max: 1, step: 0.125 }, (v) => { state.p = Math.min(1, Math.max(0, v)); load(); }) : null,
    P && P.params ? number("seed", "Seed", state.seed, { min: 0, step: 1 }, (v) => { state.seed = Math.round(v); load(); }) : null,
  ].filter(Boolean));
}

function load() {
  const P = PRESETS[state.preset];
  const inst = P.make(state);
  setGame(inst.g, inst.pos, inst.height, inst.source);
}

function setGame(g, pos, height, source) {
  state.g = g;
  state.pos = pos;
  state.height = height;
  state.source = source;
  state.S = new Set();
  state.greedySteps = 0;
  state.exact = null;
  $("#editor").value = serializeLIG(g);
  $("#editor-err").textContent = "";
  enumerate();
  renderControls();
  renderAll();
}

$("#apply").addEventListener("click", () => {
  try {
    const g = parseLIG($("#editor").value);
    if (g.n > 25) throw new Error("Please keep n ≤ 25 for this browser demo.");
    state.preset = "custom";
    const keepFig = g.n === 6 && state.pos && Object.keys(state.pos).length === 6;
    setGame(g, keepFig ? state.pos : circleLayout(g.n, 420, g.n > 8 ? 400 : 340), keepFig ? state.height : g.n > 8 ? 400 : 340, "Custom instance from the text editor.");
  } catch (e) {
    $("#editor-err").textContent = e.message;
  }
});

// ------------------------------------------------------------------ PSNE

function enumerate() {
  const g = state.g;
  let method = state.method === "auto" ? (g.n <= 16 ? "brute" : "backtrack") : state.method;
  if (method === "brute" && g.n > 22) method = "backtrack"; // keep the page responsive
  const t0 = performance.now();
  const r = method === "brute" ? enumerateBrute(g) : enumerateBacktrack(g);
  state.enum = { method, visited: r.visited, ms: performance.now() - t0, order: r.order };
  state.psne = r.psne;
  const all = (1 << g.n) - 1;
  state.target = state.psne.includes(all >>> 0) ? all >>> 0 : state.psne[0] ?? null;
}

function renderPsneControls() {
  const box = $("#psne-controls");
  fill(box, 
    select("method", "Enumeration method", [["auto", "Auto (brute force if n ≤ 16)"], ["brute", "Brute force, Gray code (n ≤ 22)"], ["backtrack", "IO backtracking with pruning"]], state.method, (v) => {
      state.method = v;
      if (v === "brute" && state.g.n > 22) { state.method = "backtrack"; }
      enumerate(); state.S = new Set(); state.greedySteps = 0; state.exact = null; renderAll();
    }),
    h("button", { type: "button", onclick: crossCheck }, "Cross-check with the other method"),
    h("button", { type: "button", onclick: targetMaxAdopters, disabled: !state.psne.length }, "Target: most adopters (g = Σ(xᵢ+1)/2)"),
  );
}

function crossCheck() {
  const g = state.g;
  const other = state.enum.method === "brute" ? "backtrack" : "brute";
  if (other === "brute" && g.n > 22) { $("#psne-summary").append(h("p", { class: "err" }, "Brute force is limited to n ≤ 22.")); return; }
  const t0 = performance.now();
  const r = other === "brute" ? enumerateBrute(g) : enumerateBacktrack(g);
  const same = r.psne.length === state.psne.length && r.psne.every((x, i) => x === state.psne[i]);
  $("#psne-summary").append(h("p", {}, `${other === "brute" ? "Brute force" : "Backtracking"}: ${r.psne.length} PSNE, ${r.visited.toLocaleString()} ${other === "brute" ? "profiles" : "search nodes"}, ${fmt(performance.now() - t0, 1)} ms. `,
    h("span", { class: same ? "ok" : "bad" }, same ? "✓ identical PSNE sets" : "✗ mismatch")));
}

function targetMaxAdopters() {
  const ad = (m) => bitsOf(m, state.g.n).reduce((a, b) => a + b, 0);
  const best = Math.max(...state.psne.map(ad));
  const ties = state.psne.filter((m) => ad(m) === best);
  state.target = ties[0];
  state.S = new Set(); state.greedySteps = 0; state.exact = null;
  renderAll();
  if (ties.length > 1) $("#psne-summary").append(h("p", { class: "small" },
    `${ties.length} PSNE tie for the most adopters (${best}), so X*_g has ${ties.length} elements. Under our reading of IO Def. 2 (whose set notation admits more than one reading), S qualifies if it singles out any one of them. The first is selected; click another row to compare.`));
}

function renderPsneSummary() {
  const g = state.g, e = state.enum;
  fill($("#psne-summary"), h("p", {},
    h("strong", {}, `${state.psne.length} PSNE`), ` out of 2^${g.n} = ${(2 ** g.n).toLocaleString()} joint actions. `,
    `Method: ${e.method === "brute" ? "brute force" : "IO backtracking (order: " + e.order.slice(0, 12).map((i) => g.labels[i]).join(", ") + (g.n > 12 ? ", …" : "") + ")"}; `,
    `${e.visited.toLocaleString()} ${e.method === "brute" ? "profiles checked" : "search nodes"}; ${fmt(e.ms, 1)} ms wall-clock (the first run includes JavaScript warm-up).`),
    state.psne.length === 0 ? h("p", { class: "note warn" }, "This game has no PSNE, so no set can be influential (IO Def. 2 needs a stable target).") : null);
}

function renderPsneTable() {
  const g = state.g;
  const box = $("#psne-table");
  fill(box);
  if (!state.psne.length) return;
  const Sarr = [...state.S];
  const cons = new Set(state.target === null ? [] : consistent(state.psne, state.target, Sarr));
  const CAP = 300;
  let rows = state.psne;
  if (rows.length > CAP) rows = [state.target, ...rows.filter((m) => cons.has(m) && m !== state.target), ...rows.filter((m) => !cons.has(m))].slice(0, CAP);
  const head = h("tr", {}, h("th", {}, "#"), ...Array.from({ length: g.n }, (_, i) =>
    h("th", { class: "cell" + (state.S.has(i) ? " sel" : ""), style: "cursor:pointer;text-align:center", title: "toggle in S", onclick: () => toggleS(i) }, g.labels[i])), h("th", { class: "num" }, "adopters"));
  const body = rows.map((m, k) => {
    const isT = m === state.target;
    const gone = state.S.size > 0 && !cons.has(m);
    return h("tr", { class: "row" + (isT ? " target" : "") + (gone ? " gone" : ""), onclick: () => { state.target = m; state.S = new Set(); state.greedySteps = 0; state.exact = null; renderAll(); } },
      h("td", { class: "num muted" }, isT ? "x*" : String(k + 1)),
      ...bitsOf(m, g.n).map((b, i) => h("td", { class: "cell" + (state.S.has(i) ? " selcol" : "") }, h("span", { class: "dot" + (b ? " plus" : ""), "aria-label": b ? "+1" : "−1" }))),
      h("td", { class: "num" }, String(bitsOf(m, g.n).reduce((a, c) => a + c, 0))));
  });
  box.append(h("table", { class: "psne" }, h("thead", {}, head), h("tbody", {}, body)));
  if (state.psne.length > CAP) box.append(h("p", { class: "small muted", style: "padding:0 8px" }, `Showing ${CAP} of ${state.psne.length} rows (target first, then consistent rows).`));
}

// ------------------------------------------------------------------ influence

function toggleS(i) {
  if (state.S.has(i)) state.S.delete(i); else state.S.add(i);
  state.greedySteps = 0;
  renderAll();
}
$("#clearS").addEventListener("click", () => { state.S = new Set(); state.greedySteps = 0; renderAll(); });

function renderManual() {
  const out = $("#manual-out");
  const g = state.g;
  if (state.target === null) { fill(out, h("p", { class: "muted" }, "No target (no PSNE).")); return; }
  const Sarr = [...state.S].sort((a, b) => a - b);
  const c = consistent(state.psne, state.target, Sarr).length;
  fill(out, h("dl", { class: "kv" },
    h("dt", {}, "S"), h("dd", {}, Sarr.length ? "{" + Sarr.map((i) => g.labels[i]).join(", ") + "}" : "∅"),
    h("dt", {}, "Target actions on S"), h("dd", { class: "mono" }, Sarr.map((i) => `${g.labels[i]}:${(state.target >> i) & 1 ? "+1" : "−1"}`).join("  ") || "—"),
    h("dt", {}, "PSNE consistent with x*_S"), h("dd", {}, `${c} of ${state.psne.length}`),
    h("dt", {}, "Pins down x*?"), h("dd", { class: c === 1 ? "ok" : "bad" }, c === 1 ? "✓ yes: x* is the unique consistent PSNE" : `✗ no: ${c - 1} other PSNE remain`)));
}

function renderGreedy() {
  const out = $("#greedy-out");
  const g = state.g;
  fill(out);
  if (state.target === null) return;
  const res = greedyInfluential(state.psne, state.target, g.n);
  const shown = res.steps.slice(0, state.greedySteps);
  if (!state.greedySteps) {
    out.append(h("p", { class: "small muted" }, `Greedy needs ${res.S.length} step(s) here. Ties go to the lowest player index (IO do not specify a rule).`));
    return;
  }
  let left = state.psne.length;
  out.append(h("ol", { class: "small" }, shown.map((s) => {
    const before = left;
    left = s.remaining.length;
    return h("li", {}, `Pick ${g.labels[s.player]} (target ${(state.target >> s.player) & 1 ? "+1" : "−1"}; degree ${s.degree} of ${before} remaining hyperedges). This removes ${s.removed.length} PSNE; ${left} left.`);
  })));
  if (state.greedySteps >= res.steps.length) out.append(h("p", {}, "Greedy set: ", h("strong", {}, "{" + res.S.map((i) => g.labels[i]).join(", ") + "}"), ` (size ${res.S.length}).`));
}

function greedyAdvance(all) {
  if (state.target === null) return;
  const res = greedyInfluential(state.psne, state.target, state.g.n);
  state.greedySteps = all ? res.steps.length : Math.min(res.steps.length, state.greedySteps + 1);
  state.S = new Set(res.S.slice(0, state.greedySteps));
  renderAll(true);
}
$("#greedy-step").addEventListener("click", () => greedyAdvance(false));
$("#greedy-run").addEventListener("click", () => greedyAdvance(true));
$("#exact").addEventListener("click", () => {
  if (state.target === null) return;
  const t0 = performance.now();
  const r = allMinimumInfluential(state.psne, state.target, state.g.n, { cap: 60, maxChecks: 3e6 });
  state.exact = { ...r, ms: performance.now() - t0, target: state.target };
  renderExact();
});

function renderExact() {
  const out = $("#exact-out");
  const g = state.g;
  fill(out);
  const e = state.exact;
  if (!e || e.target !== state.target) return;
  if (e.size === null) { out.append(h("p", { class: "err" }, "Exact search stopped after 3 million subset checks to keep the page responsive; the optimum for this instance is larger than the browser budget allows.")); return; }
  const gsize = greedyInfluential(state.psne, state.target, g.n).S.length;
  out.append(h("p", {}, `Minimum size: `, h("strong", {}, String(e.size)), `. Greedy size: ${gsize}${gsize === e.size ? " (optimal here)" : ` (optimum + ${gsize - e.size})`}. Exhaustive search over subsets by increasing size, ${fmt(e.ms, 1)} ms.`),
    h("p", { class: "small" }, `${e.truncated ? "At least " : ""}${e.sets.length} optimal set(s): `,
      e.sets.slice(0, 60).map((s, k) => h("button", { type: "button", style: "margin:2px;padding:2px 8px;min-height:26px", onclick: () => { state.S = new Set(s); state.greedySteps = 0; renderAll(true); } },
        "{" + s.map((i) => g.labels[i]).join(",") + "}"))),
    h("p", { class: "small muted" }, "Click a set to load it as S. Optimal sets are often not unique. In IO Fig. 1, {1,6} is one of five optimal sets for “everyone adopts”."));
}

// ------------------------------------------------------------------ special cases

$("#brd").addEventListener("click", () => {
  const g = state.g, out = $("#brd-out");
  if (!g.nonNegative()) { fill(out, h("p", { class: "bad" }, "This instance has negative weights; Thm 4 does not apply. Try the slide 60 or Fig. 1 preset.")); return; }
  const r = bestResponseDynamics(g);
  const show = (m) => bitsOf(m, g.n).map((b) => (b ? "+" : "−")).join("");
  fill(out, h("ol", {}, h("li", {}, h("span", { class: "mono" }, show(0)), " (start: everyone −1)"),
    r.rounds.map((rd) => h("li", {}, h("span", { class: "mono" }, show(rd.mask)), `  ${rd.movers.map((i) => g.labels[i]).join(", ")} switch to +1`))),
    h("p", {}, `Stopped after ${r.rounds.length} round(s) ≤ n = ${g.n}. Final profile is a PSNE: `, h("span", { class: r.isPSNE ? "ok" : "bad" }, r.isPSNE ? "✓" : "✗"),
      ". Influences there: ", h("span", { class: "mono" }, Array.from({ length: g.n }, (_, i) => `f${g.labels[i]}=${fmt(g.f(i, r.final), 2)}`).join("  "))));
  state.target = state.psne.includes(r.final) ? r.final : state.target;
  state.S = new Set();
  renderAll();
});

function renderPotential() {
  const g = state.g, out = $("#potential-out");
  if (!g.symmetric()) { fill(out, h("p", { class: "muted" }, "Current instance is not symmetric; Prop 5 does not apply.")); return; }
  if (state.target === null) { fill(out); return; }
  // verify the potential property on random unilateral deviations from the target
  const rand = mulberry32(7);
  let maxErr = 0;
  for (let t = 0; t < 200; t++) {
    const m = Math.floor(rand() * 2 ** g.n) >>> 0;
    const k = Math.floor(rand() * g.n);
    const m2 = (m ^ (1 << k)) >>> 0;
    const du = g.x(m2, k) * g.f(k, m2) - g.x(m, k) * g.f(k, m);
    maxErr = Math.max(maxErr, Math.abs(potential(g, m2) - potential(g, m) - du));
  }
  const vals = state.psne.map((m) => potential(g, m));
  fill(out, h("p", {}, `Symmetric ✓. Φ(x*) = ${fmt(potential(g, state.target))}; over all PSNE, Φ ranges from ${fmt(Math.min(...vals))} to ${fmt(Math.max(...vals))}. `,
    `Check on 200 random unilateral deviations: max |ΔΦ − Δu_k| = ${fmt(maxErr, 12)} `, h("span", { class: maxErr < 1e-9 ? "ok" : "bad" }, maxErr < 1e-9 ? "✓ exact potential" : "✗")));
}

// Theorem 7 widget
function t7Instance() {
  const { n, seed } = state.t7;
  const rand = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const arcs = [], edges = [];
  for (let v = 1; v < n; v++) {
    const u = Math.floor(rand() * v);
    edges.push([u, v]);
    arcs.push([u, v, pick([-2, -1, 1, 2])], [v, u, pick([-2, -1, 1, 2])]);
  }
  const b = Array.from({ length: n }, () => pick([-1, -0.5, 0, 0.5, 1]));
  return { g: new LIG(n, b, arcs), edges };
}

function renderT7() {
  fill($("#t7-controls"), 
    number("t7n", "Players n", state.t7.n, { min: 2, max: 14, step: 1 }, (v) => { state.t7.n = Math.max(2, Math.min(14, Math.round(v))); state.t7.root = 0; renderT7(); }),
    number("t7s", "Seed", state.t7.seed, { min: 0, step: 1 }, (v) => { state.t7.seed = Math.round(v); renderT7(); }),
    select("t7r", "Root", Array.from({ length: state.t7.n }, (_, i) => [i, String(i + 1)]), state.t7.root, (v) => { state.t7.root = Number(v); renderT7(); }),
  );
  const { g, edges } = t7Instance();
  const root = state.t7.root;
  const io = theorem7Tables(g, root);
  const tg = new TreeGame(g.n, edges, (i, own, act) => {
    let f = -g.b[i];
    for (const [j, w] of g.inArcs[i]) f += w * (act(j) ? 1 : -1);
    return (own ? 1 : -1) * f;
  });
  const gen = treeNashTables(tg, { root });
  const val = ["−1", "+1"];
  let allSame = true, genericChecks = 0;
  const rows = io.order.slice().reverse().map((i) => {
    const j = io.down[i];
    const T = io.tables[i], U = gen.tables[i];
    const cells = [];
    let same = true;
    if (j === -1) for (let a = 0; a < 2; a++) { cells.push(`(${val[a]}):${T[a]}`); if (T[a] !== U[1 - a]) same = false; }
    else for (let ai = 0; ai < 2; ai++) for (let aj = 0; aj < 2; aj++) { cells.push(`(${val[ai]},${val[aj]}):${T[aj * 2 + ai]}`); if (T[aj * 2 + ai] !== U[(1 - aj) * 2 + (1 - ai)]) same = false; }
    allSame &&= same;
    genericChecks += (j === -1 ? 2 : 4) * 2 ** io.ups[i].length;
    return h("tr", {}, h("td", {}, String(i + 1)), h("td", {}, io.ups[i].map((u) => u + 1).join(", ") || "—"), h("td", {}, j === -1 ? "root" : String(j + 1)),
      h("td", { class: "mono small" }, cells.join("  ")), h("td", { class: same ? "ok" : "bad" }, same ? "✓" : "✗"));
  });
  const nIO = enumerateBrute(g).psne.length;
  const nTN = enumerateAll(tg, gen).length;
  const { pos, height } = treeLayout(g.n, io.ups, root, 420, 60);
  const svg = h("div");
  svg.innerHTML = '<svg class="graph" role="img" aria-label="Tree LIG"></svg>';
  drawGraph(svg.firstChild, {
    uid: "t7", width: 420, height, pos, radius: 14,
    nodes: Array.from({ length: g.n }, (_, i) => ({ id: i, label: String(i + 1), sub: `b=${g.b[i]}` })),
    edges: g.arcs().map(([j, i, w]) => ({ a: j, b: i, directed: true, curve: 10, cls: w > 0 ? "pos" : "neg", label: g.n <= 9 ? String(w) : null })),
  });
  fill($("#t7-out"), h("div", { class: "cols" }, svg,
    h("div", {},
      h("p", {}, "Tables: ", h("span", { class: allSame ? "ok" : "bad" }, allSame ? "✓ identical to generic TreeNash at every vertex" : "✗ mismatch"),
        `. Work: IO inequality ${io.ops} parent look-ups vs ${genericChecks} parent-action combinations for generic TreeNash, which is exponential in the number of parents. `,
        `PSNE count: brute force ${nIO}, TreeNash enumeration ${nTN} `, h("span", { class: nIO === nTN ? "ok" : "bad" }, nIO === nTN ? "✓" : "✗")),
      h("div", { class: "scroll" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "i"), h("th", {}, "parents"), h("th", {}, "child j"), h("th", {}, "T(x_i, x_j) from the IO inequality"), h("th", {}, "= generic"))),
        h("tbody", {}, rows))))));
}

// Theorem 8(3) widget
const ks = { a: "2, 3, 5, 7", W: 9 };
function renderKS() {
  const inp = h("input", { id: "ksa", type: "text", value: ks.a, style: "width:14em" });
  inp.addEventListener("change", () => { ks.a = inp.value; renderKS(); });
  fill($("#ks-controls"), h("label", { for: "ksa" }, "Item weights aᵢ (positive integers)", inp),
    number("ksw", "Capacity W", ks.W, { min: 1, step: 1 }, (v) => { ks.W = Math.max(1, Math.round(v)); renderKS(); }));
  const a = ks.a.split(/[,\s]+/).filter(Boolean).map(Number);
  if (!a.length || a.some((x) => !Number.isInteger(x) || x <= 0) || a.length > 16) {
    fill($("#ks-out"), h("p", { class: "err" }, "Enter 1 to 16 positive integers.")); return;
  }
  const r = knapsackStar(a, ks.W);
  fill($("#ks-out"), h("p", {}, `Star with ${a.length} leaves: `, h("strong", {}, `${r.psne} PSNE`), ` (brute force over 2^${a.length + 1} profiles). Knapsack subsets with total weight ≤ ${ks.W}: `, h("strong", {}, String(r.feasible)), ". ",
    h("span", { class: r.psne === r.feasible ? "ok" : "bad" }, r.psne === r.feasible ? "✓ equal, as the reduction requires" : "✗ different")),
    h("p", { class: "small muted" }, "Counting feasible knapsack subsets is #P-complete, so counting PSNE in LIGs is too, even on stars. In contrast, counting PSNE in tree graphical games given in normal form is in P (IO §Hardness). The difference is that LIGs are exponentially more compact."));
}

// ------------------------------------------------------------------ experiment

let worker = null;
function renderExpControls() {
  fill($("#exp-controls"), 
    number("en", "Nodes n", state.exp.n, { min: 6, max: 25, step: 1 }, (v) => { state.exp.n = Math.max(6, Math.min(25, Math.round(v))); }),
    number("eg", "Graphs per p (IO: 100)", state.exp.graphs, { min: 1, max: 100, step: 1 }, (v) => { state.exp.graphs = Math.max(1, Math.min(100, Math.round(v))); }),
    number("es", "Seed", state.exp.seed, { min: 0, step: 1 }, (v) => { state.exp.seed = Math.round(v); }),
    h("button", { type: "button", class: "primary", id: "exp-run", onclick: runExperiment }, "Run"),
    h("button", { type: "button", id: "exp-stop", onclick: stopExperiment, disabled: true }, "Stop"),
  );
}

function stopExperiment() {
  if (worker) worker.terminate();
  worker = null;
  $("#exp-run").disabled = false;
  $("#exp-stop").disabled = true;
  $("#exp-progress").hidden = true;
}

function runExperiment() {
  stopExperiment();
  const ps = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1];
  const results = [];
  const prog = $("#exp-progress");
  prog.hidden = false;
  prog.max = ps.length * state.exp.graphs;
  prog.value = 0;
  $("#exp-run").disabled = true;
  $("#exp-stop").disabled = false;
  worker = new Worker(new URL("./experiment-worker.js", import.meta.url), { type: "module" });
  worker.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === "progress") prog.value = m.done;
    if (m.type === "row") { results.push(m.row); renderExp(results); }
    if (m.type === "done") stopExperiment();
  };
  worker.onerror = (e) => { $("#exp-out").append(h("p", { class: "err" }, "Worker error: " + e.message)); stopExperiment(); };
  worker.postMessage({ n: state.exp.n, graphs: state.exp.graphs, seed: state.exp.seed, ps });
  renderExp(results);
}

function renderExp(results) {
  const pct = (a, b) => (b ? `${fmt((100 * a) / b, 1)}%` : "—");
  fill($("#exp-out"), h("div", { class: "scroll" }, h("table", {},
    h("thead", {}, h("tr", {}, ["p", "graphs", "with ≥1 PSNE", "mean #PSNE (95% CI)", "mean time / graph", "greedy = opt", "≤ opt + 1", "≤ opt + 2", "exact aborted"].map((t, i) => h("th", { class: i ? "num" : "" }, t)))),
    h("tbody", {}, results.map((r) => h("tr", {},
      h("td", {}, fmt(r.p, 3)), h("td", { class: "num" }, String(r.graphs)), h("td", { class: "num" }, String(r.withPSNE)),
      h("td", { class: "num" }, `${fmt(r.mean, 1)} ± ${fmt(r.ci, 1)}`), h("td", { class: "num" }, `${fmt(r.ms, 1)} ms`),
      h("td", { class: "num" }, pct(r.eq, r.compared)), h("td", { class: "num" }, pct(r.le1, r.compared)), h("td", { class: "num" }, pct(r.le2, r.compared)),
      h("td", { class: "num" }, String(r.aborted))))))),
    results.length ? h("p", { class: "small muted" }, "IO's reference values: at p = 1, 87% within optimum + 1 and 99% within + 2; mean #PSNE about 200 at p = 1 (read from Fig. 3). Times are for this browser and are not comparable with IO's CPU times.") : null);
}

// ------------------------------------------------------------------ graph + facts

function renderGraph() {
  const g = state.g;
  const edges = [];
  const seen = new Set();
  for (const [j, i, w] of g.arcs()) {
    if (seen.has(j + "," + i)) continue;
    const back = g.W[i * g.n + j];
    const label = g.n <= 12 ? fmt(w, 2) : null;
    if (back === w) {
      edges.push({ a: j, b: i, directed: false, cls: w > 0 ? "pos" : "neg", label, title: `w = ${w} in both directions` });
      seen.add(i + "," + j);
    } else edges.push({ a: j, b: i, directed: true, curve: back !== 0 ? 12 : 0, cls: w > 0 ? "pos" : "neg", label, title: `w(${g.labels[j]}→${g.labels[i]}) = ${w}` });
    seen.add(j + "," + i);
  }
  drawGraph($("#graph"), {
    uid: "ig", width: 420, height: state.height, pos: state.pos, radius: g.n > 14 ? 13 : 17,
    nodes: Array.from({ length: g.n }, (_, i) => {
      let cls = state.target === null ? "" : (state.target >> i) & 1 ? "plus" : "minus";
      if (state.S.has(i)) cls += " sel";
      return { id: i, label: g.labels[i], cls, sub: g.n <= 12 && g.b[i] !== 0 ? `b=${fmt(g.b[i], 2)}` : null,
        title: `Player ${g.labels[i]}, threshold ${g.b[i]}${state.S.has(i) ? ", in S" : ""}` };
    }),
    edges,
    onNode: (i) => toggleS(i),
  });
  $("#source").textContent = "Source: " + state.source;
}

function renderFacts() {
  const g = state.g;
  const arcs = g.arcs();
  const kv = $("#facts");
  fill(kv);
  const add = (k, v, cls) => kv.append(h("dt", {}, k), h("dd", { class: cls || "" }, v));
  add("Players n", String(g.n));
  add("Arcs (w ≠ 0)", String(arcs.length));
  add("All weights ≥ 0", g.nonNegative() ? "yes → supermodular (Thm 4)" : "no");
  add("Symmetric weights", g.symmetric() ? "yes → potential game (Prop 5)" : "no");
  add("PSNE", `${state.psne.length}`);
  add("Target x*", state.target === null ? "—" : bitsOf(state.target, g.n).map((b) => (b ? "+" : "−")).join(""), "mono");
}

function renderAll(keepGreedy = false) {
  if (!keepGreedy && state.greedySteps && state.target !== null) {
    const res = greedyInfluential(state.psne, state.target, state.g.n);
    const prefix = res.S.slice(0, state.greedySteps);
    if (prefix.length !== state.S.size || !prefix.every((i) => state.S.has(i))) state.greedySteps = 0;
  }
  renderGraph();
  renderFacts();
  renderPsneControls();
  renderPsneSummary();
  renderPsneTable();
  renderManual();
  renderGreedy();
  renderExact();
  renderPotential();
}

// ------------------------------------------------------------------ fidelity

$("#fidelity-out").append(fidelityTable([
  ["Influence games, LIGs, PSNE, most influential set", "paper", "IO Defs. 1–3. Ties f<sub>i</sub> = 0 allow either action; we test x<sub>i</sub>f<sub>i</sub> ≥ −10⁻⁹ to absorb floating-point error."],
  ["Fig. 1 instance and its 6 PSNE; {1,2,3} vs {1,6}", "paper", "Reproduced exactly: {1,2,3} leaves 2 consistent PSNE and {1,6} leaves 1. Our exact search also shows that {1,5}, {2,5}, {2,6} and {3,4} are optimal too."],
  ["Backtracking search", "paper", "IO's node ordering (max out-degree first, then max influence on already selected nodes) and pruning test with γ<sup>±</sup>. Tie-breaking and the order in which the two actions are tried are our choice."],
  ["NashProp inside backtracking", "no", "IO also run NashProp (Ortiz &amp; Kearns 2002) at each search node. We omit it; this affects speed only, not the PSNE found."],
  ["Divide and conquer with vertex separators (IO Property 9)", "no", "Not implemented (it needs METIS-style partitioning)."],
  ["Greedy approximation and hitting-set equivalence (Thm 10)", "paper", "Greedy as stated in IO (least-degree node of the goal hyperedge). Ties go to the lowest index (our choice). The exact optimum comes from brute-force minimum hitting set over subsets by size."],
  ["Thm 4 best-response dynamics", "ours", "IO state the result. Our dynamics start from all −1 and update every willing player simultaneously; other schedules also converge."],
  ["Thm 7 inequality", "ours", "We add “− b<sub>i</sub>” to the inequality in IO's AAAI 2011 proof sketch, which omits the threshold. The best-response condition x<sub>i</sub>f<sub>i</sub> ≥ 0 needs it whenever b<sub>i</sub> ≠ 0; the printed form disagrees with exact TreeNash on most such random instances (see tests). With it, the tables match generic TreeNash on every random instance we tested (see tests)."],
  ["Thm 8(3) reduction", "paper", "Star construction with {0,1} actions exactly as in IO's proof sketch."],
  ["Random and preferential-attachment generators", "ours", "Arc probability, flip probability and degree-proportional attachment follow IO. Thresholds for random LIGs, sampling three distinct targets, independent weights per direction, target choice, tie-breaking and CI method are our assumptions."],
  ["US Senate case study", "no", "Not reproduced: it needs the LIGs learned by Honorio &amp; Ortiz from roll-call data, which we did not have."],
]));

// ------------------------------------------------------------------ init

renderControls();
renderT7();
renderKS();
renderExpControls();
load();
