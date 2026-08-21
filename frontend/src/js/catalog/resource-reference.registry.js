// Path: js/catalog/resource-reference.registry.js

/**
 * @fileoverview O INVENTÁRIO das superfícies em que um id de recurso de catálogo viaja
 * DENTRO de um atlas. Uma linha por superfície, e é a única lista.
 *
 * POR QUE UM REGISTRO, E NÃO UMA BUSCA. Um recurso privado sai por muitas portas, e o
 * predicado numa consulta não protege as outras (a lição que o censo de superfícies já
 * codificou nos dois pacotes). Aqui a pergunta é a de dentro do atlas: quando o atlas
 * SAI do servidor (`.ebgeo`, "Salvar como local") ou é COPIADO para outro dono (clone,
 * import), quais campos carregam a identidade de um recurso? A resposta estava espalhada
 * por cinco arquivos de store, uma tabela de banco e um serviço de clone, e cada campo
 * novo (tilesetId, photoName, modelId, photoId) nasceu depois da poda de DEFINIÇÃO que
 * fechou a camada de catálogo, sem que ninguém percebesse que a lista tinha crescido.
 *
 * ZERO IMPORTS, e é contrato, não estilo — o mesmo de `feature-type.registry.js` e de
 * `resource-scope.js`. Duas consequências que se perdem se alguém acrescentar um import:
 * o arquivo deixa de ser carregável em node puro (o teste de espelho importa ESTA cópia e
 * a de backend no mesmo processo) e passa a arrastar barrel para dentro de `@catalog`.
 *
 * A PERGUNTA QUE ACHOU A FAMÍLIA QUE FALTAVA, e ela vale mais que a lista: "que COLUNAS
 * de banco, além destas, aceitam um id de catálogo?". A primeira versão deste registro
 * varreu o cliente por NOME DE CAMPO e por isso não enxergou `atlas.settings`, cujas seis
 * listas (`basemaps`, `default_basemap`, `available_*`) falam outro vocabulário e viajam
 * verbatim no clone. Um inventário que se declara completo e é cobrado por um varredor
 * cego a uma família inteira é a forma nova do defeito que este arquivo existe para
 * fechar. Ao acrescentar superfície, faça as DUAS perguntas.
 *
 * ESTE ARQUIVO NÃO PODA NADA. Ele declara ONDE e O QUE FAZER; quem executa é
 * `private-reference-pruner.js` (saída, no cliente) e o serviço de clone/import (no
 * servidor). Quem cobra que a lista continue completa é
 * `frontend/tests/unit/referencias-de-recurso-censo.test.js`, e quem cobra que as duas
 * cópias concordem é `frontend/tests/unit/referencias-de-recurso-espelho.test.js`.
 *
 * O ESPELHO DE BACKEND é `backend/src/modules/atlas/resource-reference.registry.js`, com
 * os MESMOS ids e a coluna de cada superfície do lado do servidor. O precedente é
 * `catalog-layer.ref.js`, que já vive em duas cópias com um teste que importa as duas.
 */

/**
 * Os cinco grupos do catálogo, no vocabulário do CLIENTE (o mesmo de
 * `isPrivateResource` e do payload aditivo). O servidor fala o vocabulário de
 * `RESOURCE_TYPES`, e o espelho é quem traduz.
 * @readonly @enum {string}
 */
export const RESOURCE_REF_GROUP = Object.freeze({
    BASEMAPS: 'basemaps',
    TILESETS: 'tilesets',
    DATA_LAYERS: 'dataLayers',
    ANALYSIS_LAYERS: 'analysisLayers',
    VIEWS_360: 'views360',
});

/**
 * O que fazer com a referência quando ela não sobrevive à poda.
 *
 * `ZERA_E_REBAIXA` existe porque um slide é PROSA escrita à mão: apagá-lo perderia o
 * texto, e o que precisa sair é só a referência morta mais o modo que a exige.
 * `REMOVE_ENTRADA` é o oposto e pela razão simétrica: uma câmera 3D, um marcador 3D e uma
 * orientação de foto não têm conteúdo próprio nenhum fora da coisa a que se prendem.
 * @readonly @enum {string}
 */
export const REF_ACTION = Object.freeze({
    /** Volta ao valor padrão da coluna/campo. */
    PADRAO: 'padrao',
    /** Remove a entrada inteira (item de array ou chave de objeto). */
    REMOVE_ENTRADA: 'remove-entrada',
    /** Zera o campo e rebaixa o modo do slide para 2D. */
    ZERA_E_REBAIXA: 'zera-e-rebaixa',
    /**
     * Filtra uma LISTA de ids, mantendo só os que sobrevivem.
     *
     * A armadilha desta ação, e é ela que a faz merecer um valor próprio em vez de reusar
     * `REMOVE_ENTRADA`: nas listas de `atlas.settings` a lista VAZIA significa "sem
     * restrição" (`intersectAvailability`, `frontend/src/js/store/sync/atlas-settings.service.js`).
     * Podar uma lista de dois ids até zero ALARGA o atlas em vez de estreitá-lo. Quem
     * executa a ação é obrigado a tratar o caso "ficou vazia e não era vazia".
     */
    FILTRA_LISTA: 'filtra-lista',
    /** Não é referência de recurso: está aqui para que a ausência fique declarada. */
    NAO_REFERENCIA: 'nao-referencia',
});

/**
 * O basemap para o qual um mapa volta quando o dele não sobrevive.
 *
 * É o `DEFAULT NOT NULL` da coluna `maps.base_layer` e o padrão do seletor de camada
 * base; escolher outro valor aqui faria a cópia nascer com um basemap que a coluna
 * aceita e a interface não oferece.
 */
export const DEFAULT_BASE_LAYER = 'carta-topografica';

/**
 * @typedef {Object} ResourceRefSurface
 * @property {string} id - Identidade estável da superfície. É a chave do espelho.
 * @property {string[]} grupos - Grupos de catálogo que a superfície pode referenciar.
 * @property {string} documento - Onde o id mora no documento (store/`.ebgeo`).
 * @property {string} campo - O nome do campo (ou 'chave' quando é a chave do objeto).
 * @property {string} banco - Tabela e coluna correspondentes no servidor.
 * @property {string} acao - Um `REF_ACTION`.
 * @property {string} motivo - Por que a ação é essa, e não outra.
 * @property {boolean} [soServidor] - A superfície existe SÓ do lado do servidor: o id não
 *   viaja no documento do cliente nem no `.ebgeo`, então quem a poda é o clone/import e o
 *   cliente não tem o que fazer. Declarada aqui mesmo assim porque o inventário é da
 *   PERGUNTA ("onde mora um id de recurso dentro de um atlas"), não do executor.
 */

/** @type {ReadonlyArray<ResourceRefSurface>} */
export const RESOURCE_REF_SURFACES = Object.freeze([
    Object.freeze({
        id: 'mapa.baseLayer',
        grupos: [RESOURCE_REF_GROUP.BASEMAPS],
        documento: 'maps[mapa]',
        campo: 'baseLayer',
        banco: 'maps.base_layer',
        acao: REF_ACTION.PADRAO,
        motivo: 'A coluna é NOT NULL com padrão, e um mapa sem camada de base não desenha: '
            + 'remover não é opção, e deixar o id do basemap privado seria justamente a '
            + 'identidade que a poda existe para tirar. Volta ao padrão do deploy.',
    }),
    Object.freeze({
        id: 'mapa.catalogLayers',
        grupos: [
            RESOURCE_REF_GROUP.DATA_LAYERS,
            RESOURCE_REF_GROUP.ANALYSIS_LAYERS,
            RESOURCE_REF_GROUP.TILESETS,
        ],
        documento: 'maps[mapa]',
        campo: 'catalogLayers',
        banco: 'catalog_layers.data',
        acao: REF_ACTION.REMOVE_ENTRADA,
        motivo: 'A entrada é referência mais estado por atlas (visível, opacidade) e nada '
            + 'mais desde que a DEFINIÇÃO deixou de viajar: sem o recurso por trás ela não '
            + 'desenha nada e só carrega o id. O grupo depende do `type` da entrada, então '
            + 'esta é a única superfície com TRÊS grupos. O terceiro é `model_3d`, e ele '
            + 'esteve de fora por um motivo que se verificou FALSO: a interface atual não '
            + 'cunha camada de catálogo desse tipo, mas DOCUMENTO ANTIGO carrega, e '
            + '`resolveCatalogLayerDefinition` o resolve contra `config.tilesets` até hoje. '
            + 'Documento antigo é exatamente a população para a qual a poda existe.',
    }),
    Object.freeze({
        id: 'cesium3d.cameraPositions',
        grupos: [RESOURCE_REF_GROUP.TILESETS],
        documento: 'cesium3d[mapa]',
        campo: 'chave',
        banco: 'cesium3d_data.tileset_id',
        acao: REF_ACTION.REMOVE_ENTRADA,
        motivo: 'Única superfície em que o id do recurso é a CHAVE do objeto e não um campo '
            + 'de valor (o campo homônimo existe dentro, e os dois têm de sair juntos). Uma '
            + 'câmera guardada é a posição para olhar UM modelo: sem ele não significa nada.',
    }),
    Object.freeze({
        id: 'cesium3d.markers',
        grupos: [RESOURCE_REF_GROUP.TILESETS],
        documento: 'cesium3d[mapa]',
        campo: 'tilesetId',
        banco: 'cesium3d_data.tileset_id',
        acao: REF_ACTION.REMOVE_ENTRADA,
        motivo: 'Marcador 3D é ancorado num modelo e só é desenhado enquanto aquele modelo '
            + 'está carregado; sem ele a linha fica órfã no documento e o id do recurso '
            + 'privado viaja junto sem nada para mostrar.',
    }),
    Object.freeze({
        id: 'cesium3d.measurements',
        grupos: [RESOURCE_REF_GROUP.TILESETS],
        documento: 'cesium3d[mapa]',
        campo: 'tilesetId',
        banco: 'cesium3d_data.tileset_id',
        acao: REF_ACTION.REMOVE_ENTRADA,
        motivo: 'Medição 3D é feita SOBRE a malha do modelo: os pontos dela são posições na '
            + 'superfície dele. Entra separada do marcador porque é outro coletor do mesmo '
            + 'documento, e uma correção num não alcança o outro.',
    }),
    Object.freeze({
        id: 'cesium3d.viewsheds',
        grupos: [RESOURCE_REF_GROUP.TILESETS],
        documento: 'cesium3d[mapa]',
        campo: 'tilesetId',
        banco: 'cesium3d_data.tileset_id',
        acao: REF_ACTION.REMOVE_ENTRADA,
        motivo: 'Bacia de visada calculada contra a geometria do modelo. Mesmo motivo do '
            + 'coletor anterior, e mesma razão para ter linha própria: são quatro coletores '
            + 'no mesmo documento e nenhum deriva do outro.',
    }),
    Object.freeze({
        id: 'sv360.orientations',
        grupos: [RESOURCE_REF_GROUP.VIEWS_360],
        documento: 'streetview360[mapa]',
        campo: 'chave',
        banco: 'streetview360_data.photo_name',
        acao: REF_ACTION.REMOVE_ENTRADA,
        motivo: 'A referência é o NOME DA FOTO, e a foto pertence a um projeto 360 — o que '
            + 'faz desta a única família em que o cliente não sabe classificar localmente '
            + '(ver `podarDocumentoSv360`). A chave do objeto é o nome, e o campo homônimo '
            + 'dentro dela repete o mesmo valor.',
    }),
    Object.freeze({
        id: 'sv360.markers',
        grupos: [RESOURCE_REF_GROUP.VIEWS_360],
        documento: 'streetview360[mapa]',
        campo: 'photoName',
        banco: 'streetview360_data.photo_name',
        acao: REF_ACTION.REMOVE_ENTRADA,
        motivo: 'Marcador 360 é posicionado por azimute e inclinação DENTRO de uma foto: '
            + 'fora dela não tem onde ser desenhado, e o nome da foto identifica o projeto '
            + 'ao qual ela pertence.',
    }),
    Object.freeze({
        id: 'briefing.slide.modelId',
        grupos: [RESOURCE_REF_GROUP.TILESETS],
        documento: 'briefings[].slides[]',
        campo: 'modelId',
        banco: 'slides.model_id',
        acao: REF_ACTION.ZERA_E_REBAIXA,
        motivo: 'Slide carrega título e prosa escritos à mão: apagá-lo perde texto que não '
            + 'está em lugar nenhum. O que sai é a referência e o MODO que a exige, senão o '
            + 'apresentador tenta abrir um visualizador 3D sem modelo.',
    }),
    Object.freeze({
        id: 'briefing.slide.photoId',
        grupos: [RESOURCE_REF_GROUP.VIEWS_360],
        documento: 'briefings[].slides[]',
        campo: 'photoId',
        banco: 'slides.photo_id',
        acao: REF_ACTION.ZERA_E_REBAIXA,
        motivo: 'Gêmeo do anterior para o modo 360, e igualmente rebaixado em vez de '
            + 'apagado. O campo aceita id de projeto, slug, nome de projeto e id da foto de '
            + 'entrada, e é por isso que a resolução do servidor tenta as quatro formas.',
    }),
    Object.freeze({
        id: 'settings.basemaps',
        grupos: [RESOURCE_REF_GROUP.BASEMAPS],
        documento: '(não viaja no documento do cliente)',
        campo: 'basemaps',
        banco: 'atlas.settings',
        acao: REF_ACTION.FILTRA_LISTA,
        soServidor: true,
        motivo: 'Allowlist por atlas: o overlay que estreita o catálogo do deploy. Vazia '
            + 'significa SEM restrição, então uma lista podada até zero devolve o conjunto '
            + 'inteiro do deploy — e aqui isso é aceito de propósito, pelo mesmo motivo de '
            + '`mapa.baseLayer`: um mapa sem camada de base não desenha. Não há vazamento no '
            + 'alargamento; o vazamento era o id do basemap restrito viajar na cópia.',
    }),
    Object.freeze({
        id: 'settings.default_basemap',
        grupos: [RESOURCE_REF_GROUP.BASEMAPS],
        documento: '(não viaja no documento do cliente)',
        campo: 'default_basemap',
        banco: 'atlas.settings',
        acao: REF_ACTION.PADRAO,
        soServidor: true,
        motivo: 'O padrão aqui é `null`, que é o valor do documento DEFAULT da coluna '
            + '(`003_atlas.sql`) e o que a validação de `atlasSettingsSchema` aceita sem '
            + 'exigir pertinência à lista. Zerar é obrigatório quando o id sai da lista: '
            + '`default_basemap` fora de `basemaps` reprova no Joi da própria rota.',
    }),
    Object.freeze({
        id: 'settings.available_data_layers',
        grupos: [RESOURCE_REF_GROUP.DATA_LAYERS],
        documento: '(não viaja no documento do cliente)',
        campo: 'available_data_layers',
        banco: 'atlas.settings',
        acao: REF_ACTION.FILTRA_LISTA,
        soServidor: true,
        motivo: 'Mesma allowlist, para as camadas de dados. Lista vazia é SEM restrição, '
            + 'então quando ela é podada até zero quem executa desliga a categoria '
            + '(`features.data_layers = false`) em vez de escrever `[]`: escrever a lista '
            + 'vazia entregaria à cópia mais catálogo do que a origem tinha.',
    }),
    Object.freeze({
        id: 'settings.available_analysis_layers',
        grupos: [RESOURCE_REF_GROUP.ANALYSIS_LAYERS],
        documento: '(não viaja no documento do cliente)',
        campo: 'available_analysis_layers',
        banco: 'atlas.settings',
        acao: REF_ACTION.FILTRA_LISTA,
        soServidor: true,
        motivo: 'Gêmea da anterior para as camadas de análise, e a categoria que ela desliga '
            + 'ao esvaziar é `features.analysis_layers`.',
    }),
    Object.freeze({
        id: 'settings.available_3d_models',
        grupos: [RESOURCE_REF_GROUP.TILESETS],
        documento: '(não viaja no documento do cliente)',
        campo: 'available_3d_models',
        banco: 'atlas.settings',
        acao: REF_ACTION.FILTRA_LISTA,
        soServidor: true,
        motivo: 'A allowlist de modelos 3D, lida por `intersectAvailability` e aplicada sobre '
            + '`config.tilesets`. Ao esvaziar, desliga `features.map_3d`.',
    }),
    Object.freeze({
        id: 'settings.available_360_views',
        grupos: [RESOURCE_REF_GROUP.VIEWS_360],
        documento: '(não viaja no documento do cliente)',
        campo: 'available_360_views',
        banco: 'atlas.settings',
        acao: REF_ACTION.FILTRA_LISTA,
        soServidor: true,
        motivo: 'A allowlist de projetos 360, que no cliente vira `_atlas360Allowlist` (e ali '
            + 'lista vazia também vale SEM restrição). Ao esvaziar, desliga '
            + '`features.panoramic_images`. Repare que aqui a referência é o ID DO PROJETO, '
            + 'não o nome da foto: é a única superfície de 360 que o servidor classifica '
            + 'sem tradução, e por isso ela NÃO cai na saída 3 do dono.',
    }),
    Object.freeze({
        id: 'mapa.analysisLayers',
        grupos: [],
        documento: 'maps[mapa]',
        campo: 'analysisLayers',
        banco: 'maps.analysis_layers',
        acao: REF_ACTION.NAO_REFERENCIA,
        motivo: 'FALSO POSITIVO DECLARADO, e ele está aqui para não ser redescoberto: o '
            + 'nome colide com o grupo de catálogo homônimo, mas o campo é do domínio de '
            + 'GRADE (canal legado do sync) e o exportador o escreve literalmente vazio. '
            + 'Classificá-lo como referência apagaria configuração de grade sem motivo.',
    }),
]);

/**
 * Os nomes de campo que denunciam uma referência de recurso no código.
 *
 * É a lista que o censo usa para varrer o repositório, e ela é DELIBERADAMENTE mais larga
 * que a soma dos campos acima: `baseLayer` e `catalogLayers` aparecem em dezenas de
 * sítios de runtime que não são superfície de persistência nenhuma, e é justamente essa
 * largura que faz o censo perguntar "e este aqui, o que é?" em vez de só confirmar o que
 * já sabíamos.
 */
export const REFERENCE_FIELD_NAMES = Object.freeze([
    'tilesetId',
    'photoName',
    'modelId',
    'photoId',
    'baseLayer',
    'catalogLayers',
    'default_basemap',
    'available_data_layers',
    'available_analysis_layers',
    'available_3d_models',
    'available_360_views',
]);

/**
 * O NOME QUE FICOU DE FORA, e ele fica declarado para não ser redescoberto: `basemaps`.
 *
 * A superfície `settings.basemaps` existe e é podada, mas a palavra crua aparece em 17
 * arquivos de `src/js` (o seletor de camada base, o overlay, o painel, a configuração do
 * deploy): varrê-la produziria dezenas de entradas de censo cuja classe é sempre a mesma e
 * cuja contagem muda a cada edição de interface, e um guarda ruidoso é um guarda que
 * alguém desliga. O par que a cobre no censo é o de `default_basemap` no mesmo arquivo,
 * que é onde as duas listas são podadas lado a lado.
 */
export const CAMPO_NAO_VARRIDO = Object.freeze(['basemaps']);

/**
 * A superfície de um id, ou undefined.
 * @param {string} id
 * @returns {ResourceRefSurface|undefined}
 */
export function resourceRefSurface(id) {
    return RESOURCE_REF_SURFACES.find((s) => s.id === id);
}

/**
 * Os ids das superfícies que a poda PRECISA tocar (todas menos as declaradas
 * não-referência), na ordem do registro.
 * @returns {string[]}
 */
export function prunableSurfaceIds() {
    return RESOURCE_REF_SURFACES
        .filter((s) => s.acao !== REF_ACTION.NAO_REFERENCIA && s.soServidor !== true)
        .map((s) => s.id);
}

/**
 * As superfícies que existem SÓ do lado do servidor.
 *
 * Elas são referência de recurso como as outras, mas o id nunca chega ao documento do
 * cliente (`atlas.settings` vem no snapshot, é aplicado sobre o `config` em MEMÓRIA e não é
 * persistido em store nenhum nem escrito no `.ebgeo`). Por isso saem de
 * `prunableSurfaceIds`, que é o que o censo do cliente cobra: exigir podador de cliente
 * para elas seria exigir que alguém podasse um campo que não existe daquele lado, e a
 * saída barata para esse pedido é apagar a linha do registro — que é o defeito que este
 * arquivo existe para impedir. Quem as cobra é o clone/import, com teste próprio no
 * backend.
 * @returns {string[]}
 */
export function serverOnlySurfaceIds() {
    return RESOURCE_REF_SURFACES.filter((s) => s.soServidor === true).map((s) => s.id);
}
