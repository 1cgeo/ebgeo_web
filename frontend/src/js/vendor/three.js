// Path: js/vendor/three.js

/**
 * @module vendor/three
 * @description Ponto único de carga do Three.js (0.164.0), vindo do npm.
 *
 * Até 2026-09-14 o Three.js era um SNAPSHOT versionado em `frontend/src/vendor/three/`, e o que
 * ele declarava era `REVISION = '164dev'`: um estado de desenvolvimento do upstream entre a r163 e
 * a r164, sem release publicada que batesse por hash. O custo disso não era peso nem
 * comportamento, era o CANAL: sem versão publicada, não há banco de avisos a que perguntar, e a
 * conferência de um aviso futuro seria refazer o diff de 52 mil linhas na mão. A decisão está
 * registrada como V1 de 2026-09-14 em `docs/decisions/decisions-2026.md`, e a forma é a mesma que
 * o MapLibre ganhou em 2026-09-04 (`frontend/src/js/map/maplibre.js`), que é o modelo deste
 * arquivo.
 *
 * Quatro cuidados, cada um com a razão medida nesta árvore:
 *
 * 1. **A troca não perdeu um único símbolo, e isso foi medido, não suposto.** O snapshot 164dev e
 *    a r164 publicada exportam exatamente os MESMOS 413 nomes (comparados os dois conjuntos de
 *    exportação: zero só num lado, zero só no outro). Os 21 símbolos que os quatro consumidores
 *    deste repositório usam existem nos dois, e as quatro constantes que os testes fixam por valor
 *    (`RepeatWrapping` 1000, `ClampToEdgeWrapping` 1001, `LinearFilter` 1006, `SRGBColorSpace`
 *    `'srgb'`) são as mesmas. O delta de 540 linhas entre os dois é trabalho INTERNO do upstream.
 *
 * 2. **Namespace, nunca default.** O pacote não exporta default (medido: `'default' in m === false`
 *    sobre `await import('three')`), exatamente como o MapLibre 6.x. Por isso aqui é
 *    `export * from 'three'` e os consumidores continuam escrevendo `import * as THREE from`, que
 *    é a forma que eles já usavam com o snapshot: a migração não tocou uma linha de uso.
 *
 * 3. **Quem consome, e por que o ponto único importa mesmo com só quatro deles.** São o
 *    visualizador 360 do mapa (`street_view_tool/street_view_viewer.js`), o carregador de tiles
 *    (`street_view_tool/tile-loader.js`, que é cópia declarada do `ebgeo_360`) e as DUAS montagens
 *    do estúdio de calibração (`calibration/viewer.js` e `calibration/preview-viewer.js`). Duas
 *    páginas diferentes, dois grupos de chunk diferentes: o especificador espalhado por quatro
 *    arquivos é quatro lugares para a próxima troca de versão esquecer um. Mais seis `vi.mock` em
 *    `frontend/tests/unit/`, que apontam para ESTE caminho e não mais para o snapshot.
 *
 * 4. **Não há regra de chunk para ele, e a ausência é deliberada.** O `vite.config.js` mantinha um
 *    comentário dizendo que `src/vendor/three/` ficava FORA do grupo `calibration` de propósito,
 *    porque o `street_view_tool` do mapa também o importa. A propriedade continua valendo e agora
 *    ela se sustenta sozinha: nem este arquivo nem `node_modules/three/` casam com
 *    `id.includes('src/js/calibration/')`, então `entriesAware` subdivide o grupo pelo conjunto de
 *    entradas que alcança cada módulo, e a biblioteca sai num chunk compartilhado pelas duas
 *    páginas, como sempre saiu. É o mesmo caso do MapLibre, cujo bloco do `vite.config.js` explica
 *    por que uma regra própria ali não mudaria um byte.
 */

export * from 'three';
