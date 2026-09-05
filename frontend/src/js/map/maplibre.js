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
 * 3. **O global continua, e a aplicação NÃO o lê mais.** Até 2026-09-05 a aplicação inteira
 *    alcançava a biblioteca por `window.maplibregl`: vinte arquivos de `src/js/`, vinte e nove
 *    sítios. Hoje cada um deles importa `{ maplibregl }` daqui, e quem voltar ao global é
 *    reprovado pela regra `ebgeo/no-maplibre-global` (`frontend/eslint-rules/`), que também pega
 *    `window.maplibregl`, `globalThis.maplibregl` e `self.maplibregl`, formas que o
 *    `no-restricted-globals` do ESLint não alcança e que um `grep` por `maplibregl.` também não vê
 *    quando vêm com `?.`.
 *
 *    **Quem ainda lê o global, e por quê**, que é a razão de a linha continuar aqui:
 *      - `frontend/bench/` (`desempenho-terreno.mjs`, `ferramentas.mjs`), que dirige uma página já
 *        construída pelo CDP e não importa módulo nenhum dela;
 *      - os specs de Playwright em `frontend/tests/e2e-ui/`, cujo `page.evaluate` roda dentro da
 *        página depois do boot e não tem grafo de import próprio;
 *      - a página de calibração pelo mesmo caminho de spec.
 *    Os três são de FORA do bundle. Nenhum arquivo de `src/js/` está nessa lista, e a régua é o
 *    que mantém assim.
 *
 * 4. **A escrita do global é guardada por `typeof window`.** A suíte roda em `environment: 'node'`
 *    (`vitest.config.js`), onde não existe `window`; e desde que a aplicação importa este arquivo,
 *    qualquer teste de um dos vinte módulos o carrega junto. Sem a guarda, todos eles morreriam
 *    num `ReferenceError: window is not defined` ANTES do primeiro caso, o que é uma falha de
 *    ambiente disfarçada de falha de código.
 *
 * Este módulo continua sendo o PRIMEIRO import do entry de cada página que usa mapa, e agora por
 * um motivo menor: o global de compatibilidade e o CSS do pacote são efeitos do corpo dele. A
 * aplicação em si já não depende dessa ordem, porque um import não pode estar fora de ordem.
 */

import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

maplibregl.setWorkerUrl(workerUrl);

// Global de compatibilidade para a bancada e os specs de navegador (notas 3 e 4 acima).
if (typeof window !== 'undefined') window.maplibregl = maplibregl;

export default maplibregl;
export { maplibregl };
