// Path: tests/setup/indexeddb.setup.js

/**
 * @fileoverview Installs `fake-indexeddb` on `globalThis` for EVERY test file.
 *
 * Until now `vitest.config.js` ran `environment: 'node'` with no IndexedDB at all, so
 * `typeof indexedDB === 'undefined'` and NOT ONE test in this repository executed a line of
 * IndexedDB. Every namespace test used a double, which proves the double.
 *
 * WHY A GLOBAL SETUP AND NOT A PER-FILE `import 'fake-indexeddb/auto'`:
 *
 *   1. The failure mode of forgetting a per-file import is a GREEN TEST THAT PROVES NOTHING.
 *      Without the import, `indexedDB` is undefined, localforage silently resolves to no
 *      usable driver (or to a memory driver), and a test that believes it wrote to storage
 *      passes against something that is not storage. A ritual whose omission is invisible is
 *      the exact class of defect this phase exists to remove, so the instrument is made
 *      unforgettable instead of documented.
 *   2. The cost is measured, not assumed, and it is not zero. Same 205 files / 3777 tests,
 *      three runs each, node v24.13.1 on Windows: no setup file at all 5.32/5.30/5.31 s;
 *      an EMPTY setup file 5.56/5.60/5.86 s; this setup file 5.40/5.76/6.17 s. So roughly
 *      +0.36 s of the +0.47 s is the price of having ANY `setupFiles` entry (vitest
 *      machinery, paid per file), and only ~0.1 s is `fake-indexeddb` itself. Ten percent
 *      of a five-second suite, most of it not even attributable to this import, does not
 *      buy back the silent-green failure mode of item 1.
 *   2b. It changed no existing outcome: the suite reported the identical 3768 passed /
 *      2 failed / 7 todo with and without this file, so nothing in the repository was
 *      quietly depending on `indexedDB` being undefined.
 *   3. Per-FILE isolation is real and was probed, not assumed: vitest runs with
 *      `isolate: true`, so each test file re-executes this setup and re-imports
 *      `fake-indexeddb/auto`, getting its own empty `FDBFactory`. The probe seeded a
 *      database in one file and asserted `indexedDB.databases()` was empty in another,
 *      and it held. The probe was not vacuous: re-run with `--no-isolate` the second file
 *      saw `["PROBE_SHARED_DB"]` and the assertion failed, which is what proves it was
 *      capable of detecting leakage in the first place.
 *
 * WHAT THIS DOES NOT GIVE YOU. `fake-indexeddb` is a single-process implementation. Two
 * "tabs" here are two module registries over ONE factory, never two OS processes: a real
 * `blocked` event across real tabs, a frozen background tab that never runs its
 * `versionchange` handler, and bfcache are all outside its reach. Anything that depends on
 * those is a Playwright question (`tests/e2e-ui/`), not a vitest one.
 */

import 'fake-indexeddb/auto';
