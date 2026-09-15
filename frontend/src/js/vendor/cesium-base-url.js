// Path: js/vendor/cesium-base-url.js

/**
 * @module vendor/cesium-base-url
 * @description O endereço por onde o Cesium busca, em runtime, os ativos que ele NÃO empacota, e
 * o ÚNICO lugar do repositório onde essa string existe.
 *
 * O Cesium é a única biblioteca deste produto que não cabe inteira num bundle. Quatro diretórios
 * ficam de fora por desenho dela, e cada um é buscado por URL depois do boot do visualizador 3D:
 * `Workers/` (os workers de decodificação de terreno e de malha, que são arquivos próprios porque
 * `new Worker(url)` precisa de uma URL), `Assets/` (as texturas de estrela, a imagem de céu e as
 * tabelas do IAU), `ThirdParty/` (os decodificadores Draco e Basis, `.wasm` inclusive) e
 * `Widgets/` (a folha que o `InfoBox` injeta no próprio iframe). Quem resolve todos eles é
 * `buildModuleUrl`, e ele lê `window.CESIUM_BASE_URL`.
 *
 * DUAS COISAS QUE NÃO SE ADIVINHAM:
 *
 * 1. **Este módulo existe SEPARADO por causa da ordem de avaliação, não por organização.** O
 *    `import` é içado: escrever `window.CESIUM_BASE_URL = ...` no corpo de
 *    `frontend/src/js/vendor/cesium.js`, acima do `import * as CesiumNS from 'cesium'`, poria a
 *    atribuição DEPOIS de todo o grafo do Cesium ter sido avaliado, porque o corpo de um módulo só
 *    roda quando as dependências dele já rodaram. Um módulo importado ANTES, por outro lado,
 *    avalia antes, e é por isso que a primeira linha daquele arquivo é o import deste. O
 *    `buildModuleUrl` memoiza a base na primeira leitura; chegar depois dela é chegar tarde, e o
 *    desfecho é uma base errada que ninguém vê até um worker responder 404.
 *
 * 2. **O `vite.config.js` IMPORTA esta constante**, e é o que impede a string de existir em dois
 *    lugares. O plugin `ebgeo-cesium` de lá copia os quatro diretórios de
 *    `node_modules/cesium/Build/Cesium/` para este mesmo prefixo (em dev, por middleware; no
 *    build, para dentro do `dist/`). Se as duas pontas divergirem, o visualizador 3D sobe com a
 *    cena vazia e nenhum erro: é o modo de falha que esta linha existe para impedir. Importar
 *    daqui é seguro em node porque este módulo é folha, de zero imports, e a escrita do global é
 *    guardada por `typeof window`.
 *
 * O prefixo continua sendo `/vendors/cesium/`, o mesmo de quando a biblioteca era um `<script>`
 * de `frontend/public/vendors/cesium/`: o que mudou foi a origem dos bytes (npm, versão exata),
 * não o endereço. **Aquela pasta deixou de existir em 2026-09-15** (decisão D15 apagou o último
 * arquivo dela, o viewshed ofuscado), então hoje TUDO o que responde sob este prefixo vem do
 * plugin, e nada do `publicDir`. O prefixo se mantém por ser o endereço que o produto já usava, e
 * não por haver um arquivo versionado ali.
 */

/** O prefixo de URL dos ativos estáticos do Cesium. Com barra final: `buildModuleUrl` concatena. */
export const CESIUM_BASE_URL = '/vendors/cesium/';

if (typeof window !== 'undefined') window.CESIUM_BASE_URL = CESIUM_BASE_URL;
