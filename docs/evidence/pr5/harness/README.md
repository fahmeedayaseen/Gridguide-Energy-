# Evidence harnesses

Used to produce the browser and SQL-parity evidence in `../`. Not part of the app or CI.

**Browser suites** — render the real `EntGeothermal` component against an in-browser mock API built on the real calculation libraries:

```bash
cp app/platform/GridGuidePlatform.jsx platform.jsx && echo 'export { EntGeothermal };' >> platform.jsx
cp lib/geothermal-metrics.mjs metrics.mjs; cp lib/energy-water-portfolio.mjs portfolio.mjs; cp lib/energy-water-meters.mjs meters.mjs
esbuild harness.jsx  --bundle --jsx=automatic --alias:papaparse=./papaparse-stub.js --outfile=bundle.js
esbuild harness2.jsx --bundle --jsx=automatic --alias:papaparse=./papaparse-stub.js --outfile=bundle2.js
node run.mjs    # suite 1 (needs playwright + an index.html loading bundle.js)
node run2.mjs   # suite 2 (index2.html loading bundle2.js)
```

**SQL parity** — `node sqlcheck.mjs lib/geothermal-metrics.mjs` (and `TIERS=1 …`) against a Postgres database with an `EnterpriseSustainabilityReading` table; compares the SQL aggregation with the in-memory calculation on random data.
