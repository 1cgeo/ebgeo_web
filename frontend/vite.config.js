// vite.config.js
import { defineConfig } from 'vite';
import legacy from '@vitejs/plugin-legacy';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * O commit curto do HEAD, ou string vazia.
 *
 * POR QUE O COMMIT E NÃO SÓ A VERSÃO: `__APP_VERSION__` vem do `version` do `package.json` e muda
 * uma vez por lançamento, então dez builds seguidos se dizem `1.0.0`. A pergunta que um relato de
 * erro precisa responder é "de QUAL build veio isto", e entre dois builds da mesma versão só o
 * commit responde. Ele é lido no momento de montar a configuração, uma vez, porque um `execSync`
 * por chunk custaria um processo por arquivo emitido.
 *
 * O `try/catch` NÃO É ZELO: build a partir de um tarball, de uma imagem de container sem o `.git`,
 * ou numa máquina sem `git` no PATH são os três casos normais em que o comando não existe ou
 * falha. O desfecho é um carimbo sem hash (`1.0.0`), nunca um build que não acontece: o `stderr`
 * vai para `ignore` para que o "not a git repository" não polua a saída de quem só quer compilar.
 * @returns {string}
 */
function commitDoBuild() {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

const APP_VERSION = process.env.npm_package_version || '1.0.0';
const APP_HASH = commitDoBuild();
/** `versao+hash`, e só `versao` quando o hash não existe. O teto de 100 é o da coluna da rota. */
const APP_RELEASE = (APP_HASH ? `${APP_VERSION}+${APP_HASH}` : APP_VERSION).slice(0, 100);
const APP_BUILT_AT = new Date().toISOString();

/**
 * Escreve `release.json` na raiz do `dist/`.
 *
 * PARA QUE ELE SERVE: o `release` viaja dentro do bundle (via `define`), o que responde "de qual
 * build veio este relato". Este arquivo responde a pergunta INVERSA, que é a que se faz olhando o
 * servidor: "o que está publicado agora?". Sem ele, descobrir isso exige abrir um JS minificado e
 * procurar a string.
 *
 * ESCRITO POR `writeBundle` E `fs`, NÃO POR `emitFile` EM `generateBundle`. A primeira versão fazia
 * o segundo, o teste unitário com um `emitFile` espião ficava verde, e o `npm run build` real
 * terminava sem o arquivo: o Rolldown (Vite 8) não materializa asset emitido nesse ponto. O
 * `writeBundle` roda depois de o bundler ter escrito o `dist/`, recebe o diretório de saída e a
 * escrita é a nossa, então o que o teste prova é o que o build faz.
 *
 * A GUARDA DE UMA VEZ SÓ é necessária, e não defensiva: o `@vitejs/plugin-legacy` faz os hooks de
 * saída rodarem mais de uma vez por build (a passada moderna e a legada). `APP_BUILT_AT` é congelado
 * no topo pela mesma razão: duas leituras do relógio dariam dois conteúdos para o mesmo nome.
 *
 * NADA DE `deploy/` AQUI. Este plugin escreve dentro do `dist/`, que é saída de build; a publicação
 * é outro assunto e outro dono.
 * @returns {Object} Um plugin de Vite.
 */
function pluginReleaseJson() {
  let escrito = false;
  return {
    name: 'ebgeo-release-json',
    writeBundle(opcoes) {
      if (escrito) return;
      escrito = true;
      const dir = opcoes?.dir || resolve(__dirname, 'dist');
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, 'release.json'), `${JSON.stringify({
        release: APP_RELEASE,
        version: APP_VERSION,
        hash: APP_HASH,
        builtAt: APP_BUILT_AT,
      }, null, 2)}\n`);
    },
  };
}

export default defineConfig(({ mode: _mode }) => ({
  // ===== ROOT E ESTRUTURA =====
  root: '.',
  publicDir: 'public',
  // base: _mode === 'production' ? '/cms/' : '/',

  // ===== BUILD CONFIGURATION =====
  build: {
    outDir: 'dist',
    assetsDir: 'assets',

    // Minification
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: false,
        drop_debugger: false,
        passes: 2
      },
      mangle: {
        safari10: true
      },
      format: {
        comments: false
      }
    },

    // Code splitting
    rollupOptions: {
      // Multi-page: the map is `index.html`; "Seus atlas" (`atlas.html`), Administração
      // (`admin.html`) and Calibração 360 (`calibracao.html`) are pages of their own, each with its
      // own entry module and CSS manifest. None loads the map bundle — see the codeSplitting note
      // below for what enforces that.
      //
      // `calibracao.html` veio do ebgeo_360, onde era estático solto servido pelo próprio Fastify.
      // Aqui ela é a QUARTA entrada do bundler: passa pelo chunking declarado abaixo e vira alvo do
      // ESLint e do Stylelint da casa, como qualquer outra página.
      input: {
        main: resolve(__dirname, 'index.html'),
        atlas: resolve(__dirname, 'atlas.html'),
        admin: resolve(__dirname, 'admin.html'),
        calibracao: resolve(__dirname, 'calibracao.html')
      },
      output: {
        // Chunks by functionality (path-based matching)
        // IMPORTANT: Order matters! More specific rules must come first.
        // Chunks are organized to avoid circular dependencies:
        //   core (store, state, events, utilities, layers, terrain, baselayers, catalog,
        //         modals, toolbar, tool_manager, mode, briefing, ui, config, snapping,
        //         map/animation, grid, coordinates)
        //   -> ui-components (sidebar, features_tab, user_data, attribute_table, search,
        //                     bottom-controls, base-layer-selector, context-menu, vector_info, processing)
        //   -> tools (draw, military, analysis, selection)
        //   -> lazy (cesium-integration, street-view, first-person-3d, import-export)
        // Unmapped (falls to main entry bundle): keyboard, map/map.manager, map/drag-rotate,
        //   first_person_3d_tool/index.js (the barrel, on purpose - see its rule below)
        //
        // `codeSplitting.groups`, NOT the deprecated `manualChunks`. The two are NOT equivalent
        // once there is more than one html entry: under the Rollup-compat shim a group becomes one
        // chunk regardless of who imports it, so `admin.html` — which shares ~50 kB of leaves with
        // the map (api-client, config, session-context, toast, event-cleanup…) — preloaded the
        // whole 829 kB chunk those leaves happened to land in. Measured, not theorised.
        //
        // `entriesAware: true` subdivides every group by WHICH ENTRIES reach each module, so the
        // part shared by both pages becomes its own chunk and the map-only remainder stays behind.
        // Measured on this tree: admin eager payload 900 kB → 78 kB, and the MAP's eager payload
        // dropped 3.96 MB → 3.30 MB as well (code reachable only through dynamic imports stopped
        // riding along in eagerly-preloaded chunks).
        //
        // This also removed the need for an explicit "shared leaves" list: entry-awareness derives
        // the same split from the real import graph, which cannot drift out of date.
        //
        // Naming caveat: a subdivided chunk keeps the name of ONE of the groups merged into it, so
        // the admin page loads files named `analysis-tools-*` / `cesium-integration-*` that contain
        // neither. The names are labels, not contents — check the sourcemap before believing one.
        codeSplitting: {
          groups: [{
            entriesAware: true,
            name(id) {
          // ===== MAPLIBRE (npm, since 2026-09-04): THERE IS NO RULE HERE, AND THAT IS MEASURED =====
          //
          // The obvious move when the library stopped being a `<script>` vendor was a group of its
          // own. It was written, built and thrown away, because it changed NOTHING measurable, and
          // an inert rule is worse than no rule: it looks like it is doing something.
          //
          // What was measured on 2026-09-04, three builds of this tree:
          //   - `entriesAware` already emits MapLibre as ONE chunk shared by `index.html` and
          //     `calibracao.html`, the only two entries that reach it (981 kB, plus three tiny
          //     modules also reachable from both). No group is needed to get that.
          //   - `name(id)` IS called for node_modules ids (probed: they arrive as
          //     `<root>/node_modules/maplibre-gl/dist/maplibre-gl.mjs`, forward slashes), and
          //     returning `'maplibre'` for them produced a byte-identical `dist/`: same chunk,
          //     same content hash.
          //   - The emitted name never carried it either. Chunk names here are
          //     `<group>~<entry>~<entry>` (probed: `calibration~main~calibracao`), so Rolldown
          //     collapses group subdivisions that share an entry set and keeps ONE label. The
          //     MapLibre chunk therefore ships as `calibration-*`, which is exactly the case the
          //     "Naming caveat" above already describes: names are labels, not contents.
          //
          // The worker is a separate matter and it IS emitted on its own, without any rule:
          // `?worker&url` in `src/js/map/maplibre.js` produces `assets/maplibre-gl-worker-*.js`
          // (635 kB), fetched at map boot by `setWorkerUrl` and referenced by no HTML.

          // ===== STATICALLY-IMPORTED SERVICES (must resolve before lazy chunks) =====

          // keyboard-service-3d is statically imported by sig.js (entry point)
          // and depends on modals + store (both in core). Despite living under
          // 3d_models_viewer_tool/services/, it is NOT lazy-loaded.
          // Assigning it to cesium-integration creates a core <-> cesium-integration
          // circular chunk on Linux where Rollup strictly respects manualChunks.
          // Placing it in core follows the same pattern as keyboard-service-briefing.
          if (id.includes('3d_models_viewer_tool/services/keyboard-service-3d')) {
            return 'core';
          }

          // Same rationale as keyboard-service-3d above, for the first-person 3D tool.
          // These four modules live under first_person_3d_tool/ but are NOT lazy:
          //   - scene-config.service.js is statically imported by
          //     add_3d_models_viewer_control.js (reached from the entry),
          //     catalog/catalog.service.js and config.helpers.js (both core), and
          //     search/feature-search.control.js + search/search-bar.search-providers.js
          //     (ui-components). Letting it fall into the lazy first-person-3d chunk
          //     makes core/ui-components statically depend on a lazy chunk, which is the
          //     circular pair that produces the TDZ "Cannot access X before
          //     initialization" at runtime.
          //   - walk/voxel-collision.js and walk/constants.js are pulled in statically BY
          //     scene-config.service.js, so they have to sit wherever it sits.
          //   - services/keyboard-service-fp.js is statically imported by map_sig.js
          //     (entry), exactly like keyboard-service-3d.
          // None of them touches @manycore/aholo-viewer: the engine is imported only by
          // first_person_viewer.js and walk/walk-mode.js, both of which stay lazy below.
          if (id.includes('first_person_3d_tool/scene-config.service') ||
              id.includes('first_person_3d_tool/walk/voxel-collision') ||
              id.includes('first_person_3d_tool/walk/constants') ||
              id.includes('first_person_3d_tool/services/keyboard-service-fp')) {
            return 'core';
          }

          // ===== CALIBRAÇÃO 360 (calibracao.html) =====
          // Só esta página alcança estes módulos, e ela não alcança nada do mapa. Sem o grupo
          // próprio eles cairiam no bundle da entrada e se misturariam com o que `entriesAware`
          // já separa por outro critério; com ele, o payload da calibração tem um nome.
          //
          // `src/vendor/three/` NÃO entra aqui de propósito: o Three.js também é importado pelo
          // `street_view_tool` do mapa, e reivindicá-lo para este grupo o tiraria de onde ele está
          // hoje — mexer no chunking do mapa não é trabalho desta página.
          if (id.includes('src/js/calibration/')) {
            return 'calibration';
          }

          // ===== LAZY LOADED CHUNKS (independentes) =====

          // 3D code split (lazy load via dynamic import)
          // NOTE: Only map_3d.js, tools/* and services/cesium-compat.js are lazy-loaded.
          // add_3d_models_viewer_control.js is statically imported,
          // so it stays in main bundle.
          // Panels (marker-panel-3d, measurement-panel-3d, viewshed-panel-3d)
          // use dynamic imports to avoid conflicts.
          if (id.includes('3d_models_viewer_tool/map_3d') ||
              id.includes('3d_models_viewer_tool/tools/') ||
              id.includes('3d_models_viewer_tool/services/')) {
            return 'cesium-integration';
          }
          // Street view (Three.js - lazy load)
          if (id.includes('street_view_tool')) {
            return 'street-view';
          }
          // First-person 3D viewer (@manycore/aholo-viewer Gaussian splatting - lazy load).
          //
          // MATCHED BY EXPLICIT SUBPATH, never by the folder, so `first_person_3d_tool/index.js`
          // stays out. That barrel is a STATIC import of src/js/index.js (cleanupFirstPersonFeatures
          // on beforeunload); left unmapped it falls into the entry bundle, where its
          // `await import()` wrappers belong, and everything matched HERE is then reachable only
          // through a dynamic import.
          //
          // Honest note on the hazard, because it was measured instead of assumed: matching the
          // whole folder does NOT leak the engine into the eager payload of this tree.
          // `entriesAware` subdivides the group, so the barrel comes out as its own ~20 kB
          // preloaded subchunk while the ~1.9 MB engine subchunk stays lazy (index.html eager
          // payload 2486.2 kB with the folder match, 2485.3 kB with these subpaths). The claim
          // that a folder match drags 1.9 MB into the initial bundle holds for a SINGLE-entry
          // build, not for this one. The subpaths are kept anyway: they state what belongs here,
          // instead of relying on a subdivision heuristic to undo a wrong match.
          //
          // The four statically-imported modules of this tool are pinned to core further up.
          //
          // SIZE WARNING IS EXPECTED AND ACCEPTED. This chunk is ~1.9 MB minified against a
          // chunkSizeWarningLimit of 1200, so `npm run build` emits the "chunks are larger
          // than" notice for it. Roughly half of that is base64 WASM inside the engine (zstd,
          // Draco, Basis transcoder) which does not minify and cannot be split. Raising the
          // limit to silence it would disarm the alarm for every other chunk, present and
          // future, so the warning stays and this comment is the record of why.
          if (id.includes('first_person_3d_tool/first_person_viewer') ||
              id.includes('first_person_3d_tool/components/') ||
              id.includes('first_person_3d_tool/tools/') ||
              id.includes('first_person_3d_tool/walk/walk-mode') ||
              // pointer-lock is imported ONLY by first_person_viewer (lazy) and depends
              // only on core (@utils/event-cleanup), so it belongs here and creates no
              // chunk cycle. It is listed for the reason the comment above gives for the
              // other subpaths — to STATE what belongs to this group — and NOT because
              // leaving it out would break anything: measured on a clean dist, with this
              // clause replaced by `false`, the file still lands in first-person-3d,
              // because `entriesAware` subdivides by entry and its only importer is lazy.
              // The first version of this comment claimed the opposite.
              id.includes('first_person_3d_tool/walk/pointer-lock')) {
            return 'first-person-3d';
          }
          // Import/export tools
          // export-utils.js is shared between import_export (import-export chunk)
          // and briefing/export (core chunk). Placing it in core breaks the cycle.
          if (id.includes('import_export/export-utils')) {
            return 'core';
          }
          if (id.includes('import_export')) {
            return 'import-export';
          }

          // ===== TOOL CHUNKS =====

          // Military tools (large bundle)
          if (id.includes('military_tools')) {
            return 'military-tools';
          }
          // Analysis tools (LOS and visibility)
          if (id.includes('analysis_tools')) {
             return 'analysis-tools';
          }
          // point-marker-symbols.js is a leaf module (symbol definitions +
          // canvas helpers, zero draw_tools imports). It lives under draw_tools/
          // but is consumed by tool_manager/helpers/marker-symbol-picker (core).
          // Routing it to core breaks the draw-tools <-> core cycle.
          if (id.includes('draw_tools/point_tool/point-marker-symbols')) {
            return 'core';
          }
          // point-custom-icons.js is also a leaf module (custom-icon runtime
          // helpers; imports only @utils/store/events — all core, zero draw_tools
          // imports). It is consumed by core modules (tool_manager/clipboard_manager,
          // tool_manager/helpers/marker-symbol-picker, layers/layer_setup), so it
          // must live in core too — otherwise core statically depends on the
          // draw-tools chunk and recreates the draw-tools <-> core cycle (TDZ
          // "Cannot access 'X' before initialization" at runtime).
          if (id.includes('draw_tools/point_tool/point-custom-icons')) {
            return 'core';
          }
          // drawing-touch-helpers.js is a shared leaf module (touch finish/remove
          // helpers; imports only utilities/pointer-utils — core). Although it lives
          // under draw_tools/, it is consumed by military-tools (arrow/boundary) and
          // by temporal/trajectory-tool. Leaving it in the draw-tools chunk creates a
          // military-tools -> draw-tools edge (and a temporal -> draw-tools edge),
          // which feed the import-export -> ui-components -> military-tools ->
          // draw-tools cycle. Routing it to core removes those cross-tool edges.
          if (id.includes('draw_tools/drawing-touch-helpers')) {
            return 'core';
          }
          // Drawing tools
          if (id.includes('draw_tools')) {
            return 'draw-tools';
          }
          // Selection tools
          if (id.includes('selection_tools')) {
            return 'selection-tools';
          }
          // Azimuth Distance tool (utility tool)
          if (id.includes('azimuth_distance_tool')) {
            return 'draw-tools';
          }
          // Measurement tools (ephemeral distance/area/angle)
          // In core because layer_setup.js (core) imports setupMeasurementLayers
          if (id.includes('measurement_tool')) {
            return 'core';
          }
          // Temporal module (timeline, trajectory, model, derivation).
          // Mutually entangled with core's store layer: store/feature.operations
          // and store/temporal.operations import temporal.utils/temporal.constants,
          // while temporal depends only on core (store/utils/events/layers/
          // tool_manager + drawing-touch-helpers, now also core). It is consumed by
          // draw-tools, military-tools, import-export, ui-components and 3D/360.
          // Without an explicit rule, Rollup scatters temporal modules across those
          // chunks, landing shared ones in import-export and creating a phantom
          // draw-tools -> import-export edge. Pinning it to core makes placement
          // deterministic and cycle-free.
          if (id.includes('src/js/temporal/')) {
            return 'core';
          }

          // ===== PHONE UI (standalone, depends on core + ui-components) =====
          if (id.includes('/phone/')) {
            return 'phone-ui';
          }

          // ===== UI COMPONENTS (depends on core) =====
          // Includes: sidebar, features_tab, user_data, attribute_table, search, bottom-controls, base-layer-selector, context-menu

          // Features tab, user data and attribute table
          if (id.includes('src/js/features_tab/') ||
              id.includes('src/js/user_data/') ||
              id.includes('src/js/attribute_table/')) {
            return 'ui-components';
          }
          // UI components (sidebar, processing, etc. - toolbar is in core, NOT here)
          if (id.includes('src/js/sidebar/') ||
              id.includes('src/js/processing/') ||
              id.includes('src/js/bottom-controls/') ||
              id.includes('src/js/base-layer-selector/') ||
              id.includes('src/js/context-menu/')) {
            return 'ui-components';
          }
          // Search and vector info
          if (id.includes('src/js/search/') || id.includes('src/js/vector_info/')) {
            return 'ui-components';
          }

          // ===== CORE CHUNK (foundation for everything) =====
          // Includes: store, state, events, utilities, layers, terrain, baselayers,
          //           toolbar, modals, catalog, tool_manager, mode, briefing,
          //           config, snapping, map/animation.service
          //
          // utilities is here because toolbar, modals, and cesium-integration depend on it
          // toolbar/modals/catalog are here because:
          //   - store/settings.operations imports from catalog/catalog.constants
          //   - modals/shortcuts.modal imports from toolbar/toolbar.constants
          //   - catalog/catalog.modal imports from modals/modal.base
          // tool_manager is here because:
          //   - Contains shared managers (selection, ui, clipboard, etc.)
          //   - Base for all drawing tools
          // mode is here because:
          //   - ApplicationModeManager is used across the entire application
          // briefing is here because:
          //   - Keyboard service is loaded alongside other services

          // Application config (leaf module with zero imports).
          // Consumed by core (store, baselayers, layers, terrain, catalog,
          // coordinates, briefing) AND ui-components (search, sidebar,
          // features_tab, bottom-controls, base-layer-selector, vector_info).
          // Must live in core; otherwise it lands in the main entry chunk and
          // creates main <-> core / main <-> ui-components circular deps.
          // endsWith avoids false matches on unrelated *config* filenames.
          if (id.endsWith('src/js/config.js') ||
              id.endsWith('src/js/config-loader.js') ||
              id.endsWith('src/js/config.helpers.js')) {
            return 'core';
          }

          // Map animation service (leaf module with zero imports).
          // Consumed by core (briefing/transition_service) and ui-components
          // (context-menu). Same rationale as config.js above.
          if (id.includes('src/js/map/animation')) {
            return 'core';
          }

          // Snapping service (leaf module with zero imports).
          // Consumed by draw-tools and analysis-tools. Without this rule,
          // it lands in main and creates main <-> draw-tools / main <->
          // analysis-tools circular deps.
          if (id.includes('src/js/snapping/')) {
            return 'core';
          }

          // Utilities (base for toolbar, modals, and also used by cesium-integration)
          // MUST come before any other chunk that depends on it
          if (id.includes('src/js/utilities/')) {
            return 'core';
          }
          // Tool manager (base for all tools)
          if (id.includes('src/js/tool_manager/')) {
            return 'core';
          }
          // Store and state management
          if (id.includes('src/js/store/') || id.includes('src/js/state/')) {
            return 'core';
          }
          // Events
          if (id.includes('src/js/events/')) {
            return 'core';
          }
          // Application mode management
          if (id.includes('src/js/mode/')) {
            return 'core';
          }
          // Briefing infrastructure (keyboard service, etc.)
          if (id.includes('src/js/briefing/')) {
            return 'core';
          }
          // Layers and baselayers (depend on store)
          if (id.includes('src/js/layers/') || id.includes('src/js/baselayers/')) {
            return 'core';
          }
          // Terrain (depends on store and layers)
          if (id.includes('src/js/terrain/')) {
            return 'core';
          }
          // Toolbar (depended on by modals/shortcuts.modal)
          if (id.includes('src/js/toolbar/')) {
            return 'core';
          }
          // Modals (depends on toolbar, depended on by catalog)
          if (id.includes('src/js/modals/')) {
            return 'core';
          }
          // Catalog (depends on modals, depended on by store/settings.operations)
          if (id.includes('src/js/catalog/')) {
            return 'core';
          }
          // UI base components
          if (id.includes('src/js/ui/')) {
            return 'core';
          }
          // Map utilities (grid, coordinates)
          if (id.includes('src/js/grid/') ||
              id.includes('src/js/coordinates/')) {
            return 'core';
          }
            }
          }]
        },
        // Output file names
        entryFileNames: 'assets/[name]-[hash].js',
        // `entriesAware` names a subdivided chunk after the group PLUS every entry that reaches it
        // (`analysis-tools~main~admin~map_3d~…`), which produces unreadable 120-char filenames.
        // Keep the group name only — the content hash still keeps each subgroup a distinct file.
        chunkFileNames: (chunk) => `assets/${String(chunk.name || 'chunk').split('~')[0]}-[hash].js`,
        assetFileNames: 'assets/[name]-[hash].[ext]'
      },
      // External vendors (not bundled)
      // Specific regex to exclude only the Cesium vendor,
      // not project files like cesium3d.operations.js
      external: [
        // Exact match of 'cesium' module (import 'cesium')
        /^cesium$/i,
        // Match cesium subpaths (import 'cesium/Source/...')
        /^cesium\//i,
        // Match local Cesium vendor paths
        /vendors\/cesium/i,
        // Match node_modules paths (if cesium installed via npm)
        /node_modules\/cesium/i
      ]
    },

    // Source maps: 'hidden' generates maps without exposing them publicly
    sourcemap: 'hidden',

    // Maximum chunk size before warning.
    // core sits at ~1105 kB minified (~340 kB gzip) by design: it is the shared
    // foundation chunk (store, tool_manager, briefing, modals, catalog, temporal, ...)
    // and cannot be split further without circular chunk dependencies. The temporal
    // module lives here because it is mutually entangled with the store layer
    // (store/feature.operations + store/temporal.operations import temporal helpers),
    // so it cannot be hoisted to a separate chunk without a core <-> temporal cycle.
    //
    // `first-person-3d` sits ~1.9 MB minified and DOES trip this warning, deliberately: see
    // the note on its rule above. It is loaded only by dynamic import, so it never touches
    // the eager payload of any page. Do not raise the limit to hide it.
    chunkSizeWarningLimit: 1200
  },

  // ===== DEVELOPMENT SERVER =====
  server: {
    port: 3000,
    open: true,
    cors: true,

    // API proxy (if needed). Target is env-overridable so the Playwright browser-E2E
    // run can point the same-origin `/api` proxy at its throwaway backend (:3912)
    // instead of the dev backend (:8080); local `npm run dev` keeps the :8080 default.
    proxy: {
      '/api': {
        target: process.env.EBGEO_DEV_API_TARGET || 'http://localhost:8080',
        changeOrigin: true,
        ws: true
      }
    }
  },

  // Sem bloco `preview`: `vite preview` serve o dist/ SEM o proxy de `/api` acima,
  // e como o boot e fail-fast em GET /api/config a app so mostrava "EBGeo
  // indisponivel". Era modo quebrado, nao modo de producao. Sao dois modos, so:
  // `npm run dev` (stack completo) e `npm run build` + `npm run deploy`.

  // ===== MODULE RESOLUTION =====
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@js': resolve(__dirname, 'src/js'),
      '@css': resolve(__dirname, 'src/css'),
      '@store': resolve(__dirname, 'src/js/store'),
      '@state': resolve(__dirname, 'src/js/state'),
      '@utils': resolve(__dirname, 'src/js/utilities'),
      '@tools': resolve(__dirname, 'src/js/tool_manager'),
      '@toolbar': resolve(__dirname, 'src/js/toolbar'),
      '@modals': resolve(__dirname, 'src/js/modals'),
      '@sidebar': resolve(__dirname, 'src/js/sidebar'),
      '@layers': resolve(__dirname, 'src/js/layers'),
      '@catalog': resolve(__dirname, 'src/js/catalog'),
      '@ui': resolve(__dirname, 'src/js/ui'),
      '@events': resolve(__dirname, 'src/js/events')
    }
  },

  // ===== CSS =====
  css: {
    devSourcemap: true
  },

  // ===== OPTIMIZATIONS =====
  optimizeDeps: {
    // Exclude global vendors (loaded via script tags).
    //
    // `maplibre-gl` LEFT this list on 2026-09-04. It stopped being a global vendor: the 6.x has no
    // UMD build, so it comes from npm through `src/js/map/maplibre.js` and is a normal graph
    // dependency of two entries. Keeping it excluded would mean asking dev to serve it unbundled
    // while the build bundles it, two different module identities for the same library, which is
    // exactly the class of trap `bench/README.md` records under the `?t=` of the HMR.
    exclude: [
      '@turf/turf',
      'milsymbol',
      'cesium'
    ]
  },

  // ===== PLUGINS =====
  plugins: [
    // Legacy browser support
    legacy({
      targets: ['defaults', 'not IE 11'],
      additionalLegacyPolyfills: ['regenerator-runtime/runtime'],
      // Do not include polyfills in modern bundle
      modernPolyfills: false
    }),
    pluginReleaseJson()
  ],

  // ===== GLOBAL DEFINITIONS =====
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    // O COMMIT, não o `release` inteiro: quem soma os dois é `versaoDoBuild()`
    // (`src/js/session/erro-telemetria.js`), que já lê `__APP_VERSION__` e precisa continuar
    // funcionando quando o hash não existe. Vazio é o valor honesto de "build sem git".
    __APP_RELEASE__: JSON.stringify(APP_HASH),
    __BUILD_TIME__: JSON.stringify(APP_BUILT_AT)
  },

    // ===== ESBUILD OPTIONS =====
    esbuild: {
        // Mantém nomes de classes/funções para debug
        keepNames: true,
        // Legaliza comentários de licença
        legalComments: 'none'
    }
}));
