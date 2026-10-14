# Graphical games: interactive companion

Static website with two in-browser demos, made for a CS6208 Advanced Topics in AI group project presentation:

1. **TreeNash**: Kearns, Littman & Singh, *Graphical Models for Game Theory*, UAI 2001 (`treenash.html`).
2. **Influence games**: Irfan & Ortiz, *A Game-Theoretic Approach to Influence in Networks*, AAAI 2011 (`influence.html`).

The pages are plain HTML, CSS and ES modules. They have no build step and no external requests. Each page has a table marking every modelling choice as *from the paper*, *from course slides*, *our assumption*, or *not implemented*.

## Run locally

ES modules do not load over `file://`, so serve the folder:

```sh
python3 -m http.server 8000
# open http://localhost:8000/
```

## Tests

```sh
node tests/run-tests.mjs
```

The suite checks the algorithms against the papers' worked examples (IO Fig. 1 and 2, Irfan's TreeNash slides, our slides 60–62 and 67) and against brute-force enumeration on random instances. See the *Verification* section of `index.html`.

## Layout

```
index.html            overview, conventions, verification, references, AI disclosure
treenash.html         Demo 1
influence.html        Demo 2
css/style.css
js/core/              algorithms (graphical.js, lig.js, tree-presets.js, rng.js), usable from Node
js/ui/common.js       DOM/SVG helpers and site chrome
js/*-page.js          page logic
js/experiment-worker.js  background replication of the random-LIG experiment
tests/run-tests.mjs
```

## Disclaimer

This site may be wrong or inaccurate. It is provided as is, without any warranty; use it at your own risk and rely on the original papers.

## Use of AI

The code, tests and text were produced with the assistance of Claude Opus 5.5 (Anthropic) via Claude Code. Please cite the original papers.
