// Shared DOM helpers, site chrome (header/footer) and SVG graph drawing.

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

const SVGNS = "http://www.w3.org/2000/svg";
export function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

export function $(sel, root = document) { return root.querySelector(sel); }

// replaceChildren that skips null / undefined / false, so optional pieces can be written inline.
export function fill(el, ...kids) {
  el.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));
  return el;
}

const PAGES = [
  ["index.html", "Overview"],
  ["treenash.html", "Demo 1 · TreeNash (Kearns et al. 2001)"],
  ["influence.html", "Demo 2 · Influence games (Irfan & Ortiz 2011)"],
];

export function chrome(current) {
  const theme = h("button", { class: "theme", type: "button", "aria-label": "Toggle colour theme" }, "Theme");
  theme.addEventListener("click", () => {
    const root = document.documentElement;
    const dark = root.dataset.theme
      ? root.dataset.theme === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("theme", root.dataset.theme); } catch (_) { /* storage may be unavailable */ }
  });
  try {
    const saved = localStorage.getItem("theme");
    if (saved) document.documentElement.dataset.theme = saved;
  } catch (_) { /* ignore */ }
  const header = h("header", { class: "site" },
    h("div", { class: "wrap" },
      h("a", { class: "brand", href: "index.html" }, "Graphical Games · Interactive Companion"),
      h("nav", {}, PAGES.map(([href, label]) => h("a", { href, "aria-current": href === current ? "page" : null }, label))),
      theme));
  document.body.prepend(header);
  document.body.append(h("footer", { class: "site" }, h("div", { class: "wrap", html: FOOTER })));
}

const FOOTER = `
<p><strong>Context.</strong> Made for a CS6208 Advanced Topics in AI group project presentation on Kearns, Littman &amp; Singh (UAI 2001) and Irfan &amp; Ortiz (AAAI 2011). Everything runs locally in your browser; no data is sent anywhere.</p>
<p><strong>Disclaimer.</strong> This site may contain errors or inaccuracies, in the code or in its reading of the papers. It is provided as is, without any warranty; use it at your own risk and check the original papers for anything that matters.</p>
<p><strong>Use of AI.</strong> The code and the explanatory text of this site were written with the assistance of an AI model
(Claude Opus 5.5, Anthropic, via Claude Code). The algorithms were checked against the worked examples in the papers and against brute-force
enumeration (see <a href="index.html#verification">Verification</a>); remaining errors are our own. Please cite the original papers, not this site.</p>`;

// ---- layouts ---------------------------------------------------------------------------------

export function circleLayout(n, w = 420, hgt = 340, r = null) {
  const R = r ?? Math.min(w, hgt) / 2 - 34;
  const pos = {};
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    pos[i] = [w / 2 + R * Math.cos(a), hgt / 2 + R * Math.sin(a)];
  }
  return pos;
}

// Layered tree layout with the root at the bottom (KLS draw "downstream" towards the root).
export function treeLayout(n, ups, root, w = 420, rowH = 80) {
  const depth = new Array(n).fill(0);
  const order = [root];
  for (let k = 0; k < order.length; k++) for (const u of ups[order[k]]) { depth[u] = depth[order[k]] + 1; order.push(u); }
  const maxD = Math.max(...depth);
  // place leaves left to right in DFS order, internal nodes at the mean of their parents
  const x = new Array(n);
  let slot = 0;
  const leaves = order.filter((v) => ups[v].length === 0).length;
  const gap = (w - 60) / Math.max(1, leaves - 1);
  const place = (v) => {
    if (ups[v].length === 0) { x[v] = leaves === 1 ? w / 2 : 30 + gap * slot++; return; }
    ups[v].forEach(place);
    x[v] = ups[v].reduce((acc, u) => acc + x[u], 0) / ups[v].length;
  };
  place(root);
  const pos = {};
  for (let v = 0; v < n; v++) pos[v] = [x[v], 32 + (maxD - depth[v]) * rowH];
  return { pos, height: 64 + maxD * rowH };
}

// ---- graph drawing ---------------------------------------------------------------------------

// spec: { width, height, pos, nodes: [{ id, label, cls, sub, pie, title }], edges: [{ a, b, directed, cls, label, curve }],
//         onNode(id) }
export function drawGraph(svgEl, spec) {
  const { width, height, pos } = spec;
  svgEl.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svgEl.replaceChildren();
  const R = spec.radius ?? 17;
  const defs = s("defs", {});
  for (const id of ["arr", "arrpos", "arrneg", "arract"]) {
    defs.append(s("marker", { id: id + spec.uid, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" },
      s("path", { d: "M0,0 L10,5 L0,10 z", class: "ah " + id })));
  }
  svgEl.append(defs);
  const eg = s("g", {});
  for (const e of spec.edges) {
    const [x1, y1] = pos[e.a], [x2, y2] = pos[e.b];
    const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L;
    const bend = e.curve ?? 0;
    const sx = x1 + ux * R, sy = y1 + uy * R, tx = x2 - ux * (R + (e.directed ? 3 : 0)), ty = y2 - uy * (R + (e.directed ? 3 : 0));
    const mx = (sx + tx) / 2 - uy * bend, my = (sy + ty) / 2 + ux * bend;
    const cls = "edge " + (e.cls || "");
    const markerKind = /active/.test(cls) ? "arract" : /neg/.test(cls) ? "arrneg" : /pos/.test(cls) ? "arrpos" : "arr";
    const path = s("path", { d: `M${sx},${sy} Q${mx},${my} ${tx},${ty}`, class: cls, "marker-end": e.directed ? `url(#${markerKind}${spec.uid})` : null });
    if (e.title) path.append(s("title", {}, e.title));
    eg.append(path);
    if (e.label !== undefined && e.label !== null) {
      const lx = (sx + 2 * mx + tx) / 4 - uy * 9, ly = (sy + 2 * my + ty) / 4 + ux * 9;
      eg.append(s("text", { x: lx, y: ly, class: "wlabel" }, e.label));
    }
  }
  svgEl.append(eg);
  const ng = s("g", {});
  for (const nd of spec.nodes) {
    const [x, y] = pos[nd.id];
    const g = s("g", { class: "node " + (nd.cls || "") + (spec.onNode ? " clickable" : ""), transform: `translate(${x},${y})`, tabindex: spec.onNode ? 0 : null, role: spec.onNode ? "button" : null, "aria-label": nd.title || nd.label });
    g.append(s("circle", { r: R }));
    if (nd.pie !== undefined && nd.pie !== null) {
      // pie: fraction of probability on action 0 (KLS convention), drawn as the grey sector
      const p0 = nd.pie;
      if (p0 > 0 && p0 < 1) {
        const a = 2 * Math.PI * p0;
        const r2 = R - 3;
        g.append(s("path", { class: "pie0", d: `M0,0 L0,${-r2} A${r2},${r2} 0 ${a > Math.PI ? 1 : 0} 1 ${r2 * Math.sin(a)},${-r2 * Math.cos(a)} z` }));
        g.append(s("path", { class: "pie1", d: `M0,0 L${r2 * Math.sin(a)},${-r2 * Math.cos(a)} A${r2},${r2} 0 ${a > Math.PI ? 0 : 1} 1 0,${-r2} z` }));
      } else g.append(s("circle", { r: R - 3, class: p0 >= 1 ? "pie0" : "pie1" }));
    }
    g.append(s("text", {}, nd.label));
    if (nd.sub) g.append(s("text", { y: R + 12, class: "sublabel" }, nd.sub));
    if (nd.title) g.append(s("title", {}, nd.title));
    if (spec.onNode) {
      g.addEventListener("click", () => spec.onNode(nd.id));
      g.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); spec.onNode(nd.id); } });
    }
    ng.append(g);
  }
  svgEl.append(ng);
}

export function fmt(x, d = 3) {
  if (!Number.isFinite(x)) return "∞";
  if (x !== 0 && Math.abs(x) < 1e-3) return x.toExponential(2);
  return (+x.toFixed(d)).toString();
}

export function fidelityTable(rows) {
  const kinds = { paper: ["paper", "From the paper"], slides: ["slides", "From course slides"], ours: ["ours", "Our assumption / choice"], no: ["no", "Not implemented"] };
  return h("div", { class: "fidelity scroll" },
    h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "Aspect"), h("th", {}, "Status"), h("th", {}, "Details and source"))),
      h("tbody", {}, rows.map(([aspect, kind, detail]) =>
        h("tr", {}, h("td", {}, aspect), h("td", {}, h("span", { class: "tag " + kinds[kind][0] }, kinds[kind][1])), h("td", { html: detail }))))));
}
