// Path: js/session/origens-de-erro.js

/**
 * @fileoverview DE QUAL PORTA O ERRO ENTROU. Onze valores, e nada mais.
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
 * As onze portas por onde um erro chega à telemetria.
 *
 * `NAO_TRATADO` e `REJEICAO` são os dois automáticos do navegador (`error` e
 * `unhandledrejection`) e continuam sendo o padrão de quem não diz nada; os outros oito do
 * CLIENTE são relatos deliberados, feitos por quem sabe algo que o navegador não sabe.
 *
 * A DÉCIMA PRIMEIRA NÃO É DO CLIENTE, e ela é a única do vocabulário com essa propriedade: ver
 * {@link ORIGENS_DO_CLIENTE}.
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
    /**
     * O SERVIDOR foi quem originou o relato, e não o navegador.
     *
     * ELA É A ÚNICA DO VOCABULÁRIO QUE O CLIENTE NUNCA ENVIA, e por isso ela é a ÚLTIMA da lista:
     * o vocabulário é ordenado e espelhado no outro pacote e no CHECK da coluna, então valor novo
     * entra no fim, nunca no meio. Quem a escreve é o backend, ao registrar na mesma tabela um
     * defeito que ele mesmo viu. Do lado do cliente ela só existe para que o vocabulário seja UM
     * (um segundo enum "quase igual" diverge do primeiro no primeiro dia); mandá-la daqui seria o
     * navegador se passando por servidor num relatório que ninguém confere. Ver
     * {@link ORIGENS_DO_CLIENTE}.
     */
    SERVIDOR: 'servidor',
});

/**
 * As onze, na ordem em que foram declaradas.
 *
 * É a lista do VOCABULÁRIO, que o espelho compara com a do backend e com o CHECK da coluna. Para
 * decidir o que este cliente pode ENVIAR, use {@link ORIGENS_DO_CLIENTE}, que é menor.
 */
export const ORIGENS_DE_ERRO = Object.freeze(Object.values(OrigemDeErro));

/**
 * As DEZ que o cliente pode enviar: o vocabulário menos {@link OrigemDeErro.SERVIDOR}.
 *
 * É esta lista que a fiação usa para RECUSAR uma origem antes do envio, e ela recusa por dois
 * motivos diferentes que dão no mesmo lugar: uma origem INVENTADA custaria o relato INTEIRO num
 * 422 (mesmo argumento do `atlasId` que não é UUID), e a origem `servidor` seria o navegador
 * mentindo sobre a procedência de um fato. Os dois viram {@link OrigemDeErro.NAO_TRATADO}, que é
 * a verdade sobre um relato cuja porta não se sabe nomear.
 *
 * DERIVADA, e não escrita à mão: uma segunda lista de dez valores ao lado de uma de onze é a
 * cópia que envelhece na próxima origem que alguém acrescentar.
 */
export const ORIGENS_DO_CLIENTE = Object.freeze(
    ORIGENS_DE_ERRO.filter((origem) => origem !== OrigemDeErro.SERVIDOR),
);

/**
 * Se uma origem existe no vocabulário. Ela NÃO responde "o cliente pode mandar isto": para essa
 * pergunta existe {@link origemDoCliente}.
 * @param {*} origem
 * @returns {boolean}
 */
export function origemValida(origem) {
    return typeof origem === 'string' && ORIGENS_DE_ERRO.includes(origem);
}

/**
 * Se uma origem é uma das que ESTE cliente pode enviar.
 * @param {*} origem
 * @returns {boolean}
 */
export function origemDoCliente(origem) {
    return typeof origem === 'string' && ORIGENS_DO_CLIENTE.includes(origem);
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
