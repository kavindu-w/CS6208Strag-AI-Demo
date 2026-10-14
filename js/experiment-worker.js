// Background replication of IO's random-LIG experiment (see influence.html, section 6).
import { randomLIG, enumerateBacktrack, greedyInfluential, exactInfluential } from "./core/lig.js";
import { mulberry32 } from "./core/rng.js";

self.onmessage = (ev) => {
  const { n, graphs, seed, ps } = ev.data;
  const pick = mulberry32(seed ^ 0x9e3779b9);
  let done = 0;
  ps.forEach((p, pi) => {
    const counts = [];
    let ms = 0, compared = 0, eq = 0, le1 = 0, le2 = 0, aborted = 0;
    for (let k = 0; k < graphs; k++) {
      const g = randomLIG(n, p, (seed * 1000003 + pi * 10007 + k) >>> 0);
      const t0 = performance.now();
      const { psne } = enumerateBacktrack(g);
      ms += performance.now() - t0;
      counts.push(psne.length);
      if (psne.length > 0) {
        const target = psne[Math.floor(pick() * psne.length)];
        const greedy = greedyInfluential(psne, target, n).S.length;
        const ex = exactInfluential(psne, target, n, { maxChecks: 2e7 });
        if (ex.S === null) aborted++;
        else {
          compared++;
          const d = greedy - ex.S.length;
          if (d === 0) eq++;
          if (d <= 1) le1++;
          if (d <= 2) le2++;
        }
      }
      done++;
      self.postMessage({ type: "progress", done });
    }
    const m = counts.length;
    const mean = counts.reduce((a, b) => a + b, 0) / m;
    const sd = m > 1 ? Math.sqrt(counts.reduce((a, b) => a + (b - mean) ** 2, 0) / (m - 1)) : 0;
    self.postMessage({ type: "row", row: {
      p, graphs: m, withPSNE: counts.filter((c) => c > 0).length, mean, ci: (1.96 * sd) / Math.sqrt(m), ms: ms / m,
      compared, eq, le1, le2, aborted,
    } });
  });
  self.postMessage({ type: "done" });
};
