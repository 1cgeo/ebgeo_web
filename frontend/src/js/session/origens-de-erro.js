// Path: js/session/origens-de-erro.js

/**
 * @fileoverview DE QUAL PORTA O ERRO ENTROU. Dez valores, e nada mais.
 *
 * ZERO IMPORTS por contrato, como os outros módulos de decisão da telemetria: ele é lido pelas
 * QUATRO páginas (três delas bootam sem a store), pelo painel de falha de camada, pelo cliente de
 * WebSocket e pelos dois visualizadores lazy. Um import a mais aqui é peso em todos eles.
 *
 * A ORIGEM É ETIQUETA, NUNCA PARTE DA ASSINATURA, e essa é a decisão inteira deste arquivo. O
 * mesmo defeito costuma entrar por duas portas ao mesmo tempo (um `TypeError` dentro de um
 * `catch` que também chama `console.error`; uma promessa que rejeita e cujo erro o `catch` de
 * cima relata à mão), e se a origem entrasse na chave de agrupamento o servidor veria DOIS grupos
 * para UM defeito, com metade das ocorrências em cada, que é a divergência que ninguém percebe
 * olhando um gráfico. Somando a origem à chave, a contagem do cliente também deixaria de casar
 * com a do servidor. Ela é o que se filtra DEPOIS de agrupar, não o que separa antes.
 *
 * O QUE ELE NÃO CONTÉM: a razão humana do erro. Origem é a porta ("o boot", "o socket", "o
 * console"), não a causa; a causa viaja em `contexto.causa`, com teto próprio.
 */

/**
 * As dez portas por onde um erro chega à telemetria.
 *
 * `NAO_TRATADO` e `REJEICAO` são os dois automáticos do navegador (`error` e
 * `unhandledrejection`) e continuam sendo o padrão de quem não diz nada; os outros oito são
 * relatos deliberados, feitos por quem sabe algo que o navegador não sabe.
 */
export const OrigemDeErro = Object.freeze({
    /** O boot da página falhou (o `catch` de `initApp`). */
    BOOT: 'boot',
    /** `window.addEventListener('error')`: exceção que ninguém pegou. */
    NAO_TRATADO: 'nao-tratado',
    /** `unhandledrejection`: promessa rejeitada que ninguém pegou. */
    REJEICAO: 'rejeicao',
    /** Alguém chamou `console.error` e engoliu o erro. */
    CONSOLE: 'console',
    /** Falha de persistência ou de fila do store. */
    STORE: 'store',
    /** O socket de colaboração caiu, recusou ou trouxe um erro do servidor. */
    WS: 'ws',
    /** Uma superfície do mapa não desenhou (tile, basemap, camada de dados). */
    MAPLIBRE: 'maplibre',
    /** Um modelo 3D não carregou (motor Cesium). */
    CESIUM: 'cesium',
    /** Uma foto 360 não carregou (motor Three.js). */
    SV360: 'sv360',
    /** A tela de indisponibilidade foi ao ar: não sobrou o que renderizar. */
    INDISPONIVEL: 'indisponivel',
});

/**
 * As dez, na ordem em que foram declaradas.
 *
 * É a lista que o cliente usa para RECUSAR uma origem inventada antes do envio: a rota valida o
 * vocabulário, e um valor fora dele custaria o relato INTEIRO num 422 por causa do campo mais
 * dispensável dele. Mesmo argumento do `atlasId` que não é UUID.
 */
export const ORIGENS_DE_ERRO = Object.freeze(Object.values(OrigemDeErro));

/**
 * Se uma origem existe no vocabulário.
 * @param {*} origem
 * @returns {boolean}
 */
export function origemValida(origem) {
    return typeof origem === 'string' && ORIGENS_DE_ERRO.includes(origem);
}

/**
 * QUAL ORIGEM CADA SUPERFÍCIE DO PAINEL DE FALHA CARREGA.
 *
 * A tabela mora aqui, e o relato sai de UM ponto só (`LayerFailureNotice.report`), por uma razão
 * medida: o 3D e o 360 relatam ATRAVÉS daquele painel (`createLoaderFailureSurface` termina em
 * `report(kind, id, status)` do painel), então um segundo relato dentro de
 * `3d_models_viewer_tool/model3d-failure.js` ou de `street_view_tool/photo360-failure.js`
 * mandaria DOIS relatos pela MESMA falha, com duas assinaturas diferentes, gastando em dobro o
 * teto de vinte envios por sessão. Aqui o painel pergunta a que porta o `kind` pertence e manda
 * um só.
 *
 * AS CHAVES SÃO STRINGS REPETIDAS, de propósito, e o guarda é um teste que importa OS DOIS LADOS
 * (`frontend/tests/unit/origens-de-erro.test.js`, contra `MODEL_3D_SURFACE` e
 * `PHOTO_360_SURFACE`): fazer este arquivo importar aqueles dois módulos custaria o contrato de
 * zero imports, e fazer aqueles dois importarem a chave daqui inverteria a posse (a chave da
 * superfície é propriedade de quem desenha a superfície, não do vocabulário da telemetria).
 */
export const ORIGEM_POR_SUPERFICIE = Object.freeze({
    /** `MODEL_3D_SURFACE`, de `3d_models_viewer_tool/model3d-failure.js`. */
    modelo3d: OrigemDeErro.CESIUM,
    /** `PHOTO_360_SURFACE`, de `street_view_tool/photo360-failure.js`. */
    foto360: OrigemDeErro.SV360,
});

/**
 * A origem de uma superfície do painel de falha.
 *
 * `Object.hasOwn` e não `TABELA[kind] ?? padrão`: a chave vem de quem registrou a superfície, e
 * `toString` devolveria a função herdada do protótipo (a mesma armadilha já paga em `PAGINAS` e
 * em `ARRIVAL_NOTICES`).
 * @param {*} kind - A chave da superfície.
 * @returns {string} Uma {@link OrigemDeErro}; `MAPLIBRE` para toda superfície do próprio mapa.
 */
export function origemDeSuperficie(kind) {
    if (typeof kind === 'string' && Object.hasOwn(ORIGEM_POR_SUPERFICIE, kind)) {
        return ORIGEM_POR_SUPERFICIE[kind];
    }
    return OrigemDeErro.MAPLIBRE;
}
