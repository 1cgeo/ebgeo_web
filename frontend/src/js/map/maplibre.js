// Path: js/map/maplibre.js

/**
 * @module map/maplibre
 * @description Ponto único de carga do MapLibre GL JS (6.7.0), vindo do npm.
 *
 * Até a 5.18 o MapLibre entrava como script clássico global (`public/vendors/maplibre-gl.js`,
 * bundle UMD) e DUAS páginas o carregavam por `<script>`: `index.html`, que é o mapa, e
 * `calibracao.html`, que desenha o mapa de projeto e o minimapa. A 6.x acabou com o UMD: o pacote
 * só distribui ES modules (`package.json` sem `main`, com `exports["."].import` apontando
 * `dist/maplibre-gl.mjs`), então a biblioteca passa a entrar pelo grafo de módulos do Vite, e este
 * arquivo é o único lugar do repositório que a importa. As duas páginas o alcançam cada uma pelo
 * seu entry (`index.js` e `calibration/calibracao-page.js`), e a cópia em `public/vendors/` foi
 * APAGADA, não deixada ao lado.
 *
 * Três cuidados, cada um com a razão medida nesta árvore:
 *
 * 1. **Namespace, nunca default.** O bundle da 6.x exporta 85 nomes e NENHUM default (medido:
 *    `Object.keys(await import('maplibre-gl')).length === 85`, `'default' in m === false`).
 *    `import maplibregl from 'maplibre-gl'` devolveria `undefined`, e o guia oficial de migração
 *    v5 -> v6 manda trocar pelo namespace.
 *
 * 2. **`setWorkerUrl` é obrigatório sob bundler.** Sem ele a 6.x resolve o worker por
 *    `new URL('./maplibre-gl-worker.mjs', import.meta.url)`. Dentro do grafo do Vite esse
 *    `import.meta.url` aponta o módulo pré-empacotado em `node_modules/.vite/deps/`, onde o
 *    arquivo do worker não existe, e o mapa sobe SEM TILE NENHUM, calado. O guia de instalação da
 *    própria biblioteca traz a receita do Vite: importar o worker por `?worker&url` e passar a URL.
 *
 * 3. **O global continua.** Vinte e seis arquivos de `src/js/` usam `maplibregl.Map`,
 *    `maplibregl.Marker`, `maplibregl.Popup`, `maplibregl.LngLatBounds`,
 *    `maplibregl.NavigationControl`, `maplibregl.ScaleControl` e `maplibregl.addProtocol` pelo
 *    global, e os sete nomes existem na 6.7 (conferidos um a um contra o módulo instalado). Manter
 *    `window.maplibregl` deixa a migração numa única troca de carga, sem tocar nesses arquivos. O
 *    passo seguinte, opcional, é trocar cada um por `import { Map } from 'maplibre-gl'` e apagar a
 *    linha do `window`.
 *
 * Este módulo TEM de ser o PRIMEIRO import do entry de cada página que usa mapa: o corpo dele roda
 * antes dos demais e é o que publica o global. Um import mais abaixo continuaria funcionando por
 * acidente (o hoisting de ESM avalia as dependências antes do corpo do importador), mas a ordem
 * entre irmãos é a ordem textual, e basta um irmão que toque `maplibregl` no corpo do módulo, e
 * não dentro de uma função, para o acidente virar erro.
 */

import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

maplibregl.setWorkerUrl(workerUrl);

// Global de compatibilidade (ver nota 3 acima).
window.maplibregl = maplibregl;

export default maplibregl;
export { maplibregl };
