// Path: js/map/maplibre.js

/**
 * @module map/maplibre
 * @description Ponto unico de carga do MapLibre GL JS (6.7.0), vindo do npm.
 *
 * Ate a 5.18 o MapLibre entrava como script classico global
 * (`public/vendors/maplibre-gl.js`, bundle UMD) e o `index.html` o carregava
 * antes do entry. A 6.x acabou com o UMD: o pacote so distribui ES modules
 * (`package.json` sem `main`, com `exports["."].import` apontando
 * `dist/maplibre-gl.mjs`), entao a biblioteca passa a entrar pelo grafo de
 * modulos do Vite.
 *
 * Tres cuidados, todos com razao registrada:
 *
 * 1. **Namespace, nunca default.** O bundle da 6.x exporta so NOMEADOS: nao ha
 *    um unico `export default` em `dist/maplibre-gl.mjs`. `import maplibregl
 *    from 'maplibre-gl'` devolveria `undefined`, e o guia oficial de migracao
 *    manda trocar pelo namespace.
 *
 * 2. **`setWorkerUrl` e obrigatorio sob bundler.** Sem ele, a 6.x resolve o
 *    worker por `new URL('./maplibre-gl-worker.mjs', import.meta.url)`. Dentro
 *    do grafo do Vite esse `import.meta.url` aponta o modulo pre-empacotado em
 *    `node_modules/.vite/deps/`, onde o arquivo do worker nao existe, e o mapa
 *    sobe sem tile nenhum. O guia de instalacao da propria biblioteca traz a
 *    receita do Vite: importar o worker com `?worker&url` e passar a URL.
 *
 * 3. **O global continua.** Trinta arquivos do app usam `maplibregl.Map`,
 *    `maplibregl.Marker`, `maplibregl.Popup`, `maplibregl.LngLatBounds` e
 *    `maplibregl.addProtocol` pelo global. Manter `window.maplibregl` deixa a
 *    migracao numa unica troca de carga, sem tocar nesses arquivos. O passo
 *    seguinte, opcional, e trocar cada um por `import { Map } from
 *    'maplibre-gl'` e apagar a linha do `window`.
 *
 * Este modulo TEM de ser o primeiro import de `src/js/index.js`: o corpo dele
 * roda antes dos demais e e o que publica o global.
 */

import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

maplibregl.setWorkerUrl(workerUrl);

// Global de compatibilidade (ver nota 3 acima), guardado por `typeof window`.
// A suite roda em `environment: 'node'` (`vitest.config.js`), onde nao existe
// `window`; desde 2026-09-05 `terrain/terrain-elevation.js` importa este arquivo
// para pegar o `LngLat`, entao qualquer teste que o alcance carrega este corpo.
// Sem a guarda o arquivo inteiro morre num `ReferenceError: window is not
// defined` ANTES do primeiro caso (medido no lote M1), que e falha de ambiente
// disfarcada de falha de codigo.
if (typeof window !== 'undefined') window.maplibregl = maplibregl;

export default maplibregl;
export { maplibregl };
