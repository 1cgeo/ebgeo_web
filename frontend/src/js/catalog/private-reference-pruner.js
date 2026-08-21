// Path: js/catalog/private-reference-pruner.js

/**
 * @fileoverview A PODA DE SAÍDA: tirar de um atlas toda referência a recurso de catálogo
 * que não seja comprovadamente PÚBLICO, antes que ele deixe o servidor.
 *
 * A REGRA É KEEP-LIST, E ESSA É A DECISÃO INTEIRA. Sobrevive só o que resolve para
 * `public`; `private` e `unknown` saem juntos. A tentação é a inversa ("é privado? sai"),
 * e ela vaza: `isPrivateResource` só conhece o privado que ESTE cliente enxerga, então uma
 * referência escrita por um par que enxergava o recurso — e que chegou aqui por sync —
 * responde "não é privado" e viajaria no arquivo. Fora do servidor não há ponto de
 * imposição: o `.ebgeo` circula por e-mail e pendrive, e quem o abrir do outro lado não
 * tem contra o que checar. Por isso a poda vale INCONDICIONALMENTE, inclusive quando quem
 * exporta é o dono do atlas, e inclusive no `.ebgeo` de atlas local.
 *
 * ISTO É DIFERENTE DA PODA DE CLONE, e a diferença é o motivo de existirem duas. O clone
 * FICA no servidor, onde o predicado continua valendo: lá a poda é POR DESTINATÁRIO
 * (o que o novo dono já podia ver, ele continua vendo) e é o SQL quem decide. Aqui não há
 * destinatário conhecido.
 *
 * FUNÇÕES PURAS. Nenhuma toca rede, store, `config` ou relógio: elas recebem o documento e
 * um `resolver` síncrono e devolvem cópia podada mais relatório. Quem constrói o resolver
 * é `resource-reference.resolver.js`, e é lá que mora a leitura do `config` e a recusa de
 * rodar sem a soma de recursos privados.
 *
 * O INVENTÁRIO das superfícies é `resource-reference.registry.js`, e ele é a lista que a
 * fixture dourada de `poda-de-referencia-privada.test.js` é obrigada a esgotar.
 */

import { catalogLayerReferenceId } from './catalog-layer.ref.js';
import { DEFAULT_BASE_LAYER, RESOURCE_REF_GROUP } from './resource-reference.registry.js';

/**
 * O veredito de um resolver. `unknown` e `private` levam ao MESMO destino (sair), e
 * ainda assim são valores distintos: o relatório conta os dois separados, porque
 * "perdi porque é privado" e "perdi porque não sei o que é" são notícias diferentes
 * para quem exporta.
 * @readonly @enum {string}
 */
export const RefVerdict = Object.freeze({
    PUBLIC: 'public',
    PRIVATE: 'private',
    UNKNOWN: 'unknown',
});

/**
 * O grupo de catálogo de uma entrada de `catalogLayers`, pelo `type` dela.
 *
 * O QUE FICA DE FORA É TÃO DELIBERADO QUANTO O QUE ENTRA: `hillshade` não tem linha em
 * catálogo nenhum (é estático, injetado pelo deploy), então não há id de recurso ali para
 * esconder e a entrada fica.
 *
 * `model_3d` ENTRA, e esta linha corrige uma exclusão que se apoiava num fato meio certo.
 * A interface atual não cunha camada de catálogo desse tipo — isso continua verdade —, mas
 * DOCUMENTO ANTIGO carrega, e `resolveCatalogLayerDefinition` (`catalog-layer.ref.js`) o
 * resolve contra `config.tilesets` até hoje, com o comentário "old documents carry them"
 * escrito ao lado. Documento antigo é exatamente a população para a qual uma poda de
 * fronteira existe: a decisão de migração da F11 foi NÃO varrer os documentos guardados,
 * então a garantia é de saída. A referência de uma entrada `model_3d` mora em
 * `originalId`/`config.id` (o tipo não cunha prefixo), e é o que `catalogLayerReferenceId`
 * já devolve.
 *
 * A ASSIMETRIA COM O SERVIDOR foi fechada junto, e não aceita: `atlas-resource-prune.js`
 * ganhou o mesmo ramo, lendo os mesmos dois carriers. Deixar a exceção só de um lado faria
 * as duas podas discordarem sobre o mesmo documento, que era o receio escrito aqui antes.
 */
const GRUPO_POR_TIPO_DE_CAMADA = Object.freeze({
    analysis_layer: RESOURCE_REF_GROUP.ANALYSIS_LAYERS,
    data_layer: RESOURCE_REF_GROUP.DATA_LAYERS,
    model_3d: RESOURCE_REF_GROUP.TILESETS,
});

/** @returns {{porSuperficie: Object<string, number>, nomeados: Array, total: number}} */
export function relatorioVazio() {
    return { porSuperficie: {}, nomeados: [], total: 0 };
}

/**
 * Registra uma perda no relatório.
 * @param {Object} relatorio
 * @param {string} superficie - Um id de `RESOURCE_REF_SURFACES`.
 * @param {string} grupo
 * @param {string} id
 * @param {string} veredito
 */
function anotar(relatorio, superficie, grupo, id, veredito) {
    relatorio.porSuperficie[superficie] = (relatorio.porSuperficie[superficie] || 0) + 1;
    relatorio.total += 1;
    relatorio.nomeados.push({ superficie, grupo, id, veredito });
}

/** Soma o segundo relatório no primeiro (mutando o primeiro). @returns {Object} */
export function somarRelatorios(alvo, outro) {
    for (const [k, v] of Object.entries(outro.porSuperficie)) {
        alvo.porSuperficie[k] = (alvo.porSuperficie[k] || 0) + v;
    }
    alvo.nomeados.push(...outro.nomeados);
    alvo.total += outro.total;
    return alvo;
}

/** @private Um resolver ausente reprova tudo: falhar FECHADO é o padrão desta camada. */
function vereditoDe(resolver, grupo, id) {
    if (id == null || id === '') return RefVerdict.UNKNOWN;
    if (typeof resolver !== 'function') return RefVerdict.UNKNOWN;
    const v = resolver(grupo, String(id));
    return v === RefVerdict.PUBLIC ? RefVerdict.PUBLIC
        : (v === RefVerdict.PRIVATE ? RefVerdict.PRIVATE : RefVerdict.UNKNOWN);
}

/**
 * Poda o documento de UM mapa: a camada de base e as camadas de catálogo.
 *
 * O basemap volta ao PADRÃO em vez de sair: a coluna do servidor é `NOT NULL` com padrão e
 * um mapa sem camada de base não desenha nada.
 *
 * @param {Object} mapa - Documento do mapa (`maps[nome]` do `.ebgeo` ou do store).
 * @param {Function} resolver - `(grupo, id) => RefVerdict`.
 * @returns {{documento: Object, relatorio: Object}}
 */
export function podarDocumentoDeMapa(mapa, resolver) {
    const relatorio = relatorioVazio();
    if (!mapa || typeof mapa !== 'object') return { documento: mapa, relatorio };

    const documento = { ...mapa };

    if (typeof documento.baseLayer === 'string' && documento.baseLayer !== '') {
        const veredito = vereditoDe(resolver, RESOURCE_REF_GROUP.BASEMAPS, documento.baseLayer);
        if (veredito !== RefVerdict.PUBLIC) {
            anotar(relatorio, 'mapa.baseLayer', RESOURCE_REF_GROUP.BASEMAPS, documento.baseLayer, veredito);
            documento.baseLayer = DEFAULT_BASE_LAYER;
        }
    }

    if (Array.isArray(documento.catalogLayers)) {
        documento.catalogLayers = documento.catalogLayers.filter((camada) => {
            const grupo = GRUPO_POR_TIPO_DE_CAMADA[camada?.type];
            // Sem grupo não é referência de recurso (hillshade, forma legada sem `type`):
            // nada a esconder e nada a resolver, então a entrada fica.
            if (!grupo) return true;
            const id = catalogLayerReferenceId(camada);
            // Entrada que se DIZ camada de catálogo e não carrega referência nenhuma (nem
            // prefixo, nem `originalId`, nem `config.id`): não há id para esconder, e o
            // servidor a mantém (`ResourcePruner.manterCatalogLayer` devolve `true` quando
            // `catalogLayerRef` dá null). Podá-la aqui faria as duas podas discordarem sobre
            // o mesmo documento, no sentido caro: o `.ebgeo` perderia uma entrada que o
            // clone preserva, e a perda seria de dado do usuário sem ganho de sigilo.
            if (id == null || id === '') return true;
            const veredito = vereditoDe(resolver, grupo, id);
            if (veredito === RefVerdict.PUBLIC) return true;
            anotar(relatorio, 'mapa.catalogLayers', grupo, id, veredito);
            return false;
        });
    }

    return { documento, relatorio };
}

/** @private Filtra um array de itens por `campo`, anotando as perdas. */
function filtrarPorCampo(itens, campo, superficie, grupo, resolver, relatorio) {
    if (!Array.isArray(itens)) return itens;
    return itens.filter((item) => {
        const id = item?.[campo];
        // Item SEM referência nenhuma não é assunto desta poda: uma medição 3D solta e um
        // marcador sem foto continuam sendo dado do usuário.
        if (id == null || id === '') return true;
        const veredito = vereditoDe(resolver, grupo, id);
        if (veredito === RefVerdict.PUBLIC) return true;
        anotar(relatorio, superficie, grupo, id, veredito);
        return false;
    });
}

/** @private Filtra as CHAVES de um objeto indexado pelo id do recurso. */
function filtrarPorChave(objeto, superficie, grupo, resolver, relatorio) {
    if (!objeto || typeof objeto !== 'object') return objeto;
    const saida = {};
    for (const [chave, valor] of Object.entries(objeto)) {
        const veredito = vereditoDe(resolver, grupo, chave);
        if (veredito === RefVerdict.PUBLIC) {
            saida[chave] = valor;
            continue;
        }
        anotar(relatorio, superficie, grupo, chave, veredito);
    }
    return saida;
}

/**
 * Poda o documento 3D de um mapa: os QUATRO coletores.
 *
 * `cameraPositions` é o único caso em que o id do recurso é a CHAVE do objeto, e o campo
 * homônimo mora dentro do valor: os dois saem juntos porque a entrada inteira sai.
 *
 * @param {Object} doc - `{cameraPositions, markers, measurements, viewsheds}`.
 * @param {Function} resolver
 * @returns {{documento: Object, relatorio: Object}}
 */
export function podarDocumentoCesium3d(doc, resolver) {
    const relatorio = relatorioVazio();
    if (!doc || typeof doc !== 'object') return { documento: doc, relatorio };

    const g = RESOURCE_REF_GROUP.TILESETS;
    const documento = {
        ...doc,
        cameraPositions: filtrarPorChave(doc.cameraPositions, 'cesium3d.cameraPositions', g, resolver, relatorio),
        markers: filtrarPorCampo(doc.markers, 'tilesetId', 'cesium3d.markers', g, resolver, relatorio),
        measurements: filtrarPorCampo(doc.measurements, 'tilesetId', 'cesium3d.measurements', g, resolver, relatorio),
        viewsheds: filtrarPorCampo(doc.viewsheds, 'tilesetId', 'cesium3d.viewsheds', g, resolver, relatorio),
    };
    return { documento, relatorio };
}

/**
 * Poda o documento 360 de um mapa: orientações (chaveadas pelo nome da foto) e marcadores.
 *
 * A REFERÊNCIA AQUI É O NOME DA FOTO, não o id do projeto, e é o que torna esta família
 * diferente das outras quatro: o cliente não guarda o projeto ao lado da referência e não
 * tem, localmente, o mapa foto -> projeto. O ponto de desenho foi decidido pela saída 3 do
 * dono (podar toda referência não classificável, com aviso), e não pela 1: carregar o id
 * do projeto junto da referência resolveria o dado NOVO e deixaria todo documento já
 * escrito sem classificação, o que é exatamente a migração de dado que a saída 1 exigia
 * não ter. A saída 2 (resolver por rede na exportação) foi recusada pelo dono, e com
 * razão: ela degrada FECHADO, então uma exportação grande apagaria 360 PÚBLICO por acidente
 * de rede — a perda cara, e silenciosa, no caminho irreversível.
 *
 * Consequência aceita e declarada: hoje o resolver responde `unknown` para toda referência
 * 360, então o 360 sai INTEIRO de todo `.ebgeo` e de toda cópia local, público inclusive, e
 * o aviso ao usuário diz isso com essas palavras.
 *
 * @param {Object} doc - `{orientations, markers}`.
 * @param {Function} resolver
 * @returns {{documento: Object, relatorio: Object}}
 */
export function podarDocumentoSv360(doc, resolver) {
    const relatorio = relatorioVazio();
    if (!doc || typeof doc !== 'object') return { documento: doc, relatorio };

    const g = RESOURCE_REF_GROUP.VIEWS_360;
    const documento = {
        ...doc,
        orientations: filtrarPorChave(doc.orientations, 'sv360.orientations', g, resolver, relatorio),
        markers: filtrarPorCampo(doc.markers, 'photoName', 'sv360.markers', g, resolver, relatorio),
    };
    return { documento, relatorio };
}

/**
 * Poda um briefing: as duas referências de slide.
 *
 * O slide é REBAIXADO, nunca removido: título e prosa são escritos à mão e não existem em
 * lugar nenhum além dali. O que sai é a referência e o MODO que a exige — um slide `3d`
 * sem modelo abriria um visualizador vazio na apresentação.
 *
 * @param {Object} briefing
 * @param {Function} resolver
 * @returns {{documento: Object, relatorio: Object}}
 */
export function podarBriefing(briefing, resolver) {
    const relatorio = relatorioVazio();
    if (!briefing || typeof briefing !== 'object' || !Array.isArray(briefing.slides)) {
        return { documento: briefing, relatorio };
    }

    const slides = briefing.slides.map((slide) => {
        let saida = slide;
        const trocar = (patch) => { saida = { ...saida, ...patch }; };

        if (saida?.modelId) {
            const v = vereditoDe(resolver, RESOURCE_REF_GROUP.TILESETS, saida.modelId);
            if (v !== RefVerdict.PUBLIC) {
                anotar(relatorio, 'briefing.slide.modelId', RESOURCE_REF_GROUP.TILESETS, saida.modelId, v);
                trocar({ modelId: null, mode: saida.mode === '3d' ? '2d' : saida.mode });
            }
        }
        if (saida?.photoId) {
            const v = vereditoDe(resolver, RESOURCE_REF_GROUP.VIEWS_360, saida.photoId);
            if (v !== RefVerdict.PUBLIC) {
                anotar(relatorio, 'briefing.slide.photoId', RESOURCE_REF_GROUP.VIEWS_360, saida.photoId, v);
                trocar({ photoId: null, mode: saida.mode === '360' ? '2d' : saida.mode });
            }
        }
        return saida;
    });

    return { documento: { ...briefing, slides }, relatorio };
}

/**
 * Poda o objeto de exportação INTEIRO (o `data.json` do `.ebgeo`).
 *
 * Compõe as quatro famílias sobre as chaves do documento de exportação. Não muta a
 * entrada: devolve cópia rasa com as sub-árvores tocadas substituídas.
 *
 * @param {Object} data - O objeto de exportação.
 * @param {Function} resolver
 * @returns {{documento: Object, relatorio: Object}}
 */
export function podarDocumentoDeExportacao(data, resolver) {
    const relatorio = relatorioVazio();
    if (!data || typeof data !== 'object') return { documento: data, relatorio };

    const documento = { ...data };

    const porMapa = (chave, podar) => {
        const origem = documento[chave];
        if (!origem || typeof origem !== 'object') return;
        const saida = {};
        for (const [mapa, doc] of Object.entries(origem)) {
            const r = podar(doc, resolver);
            saida[mapa] = r.documento;
            somarRelatorios(relatorio, r.relatorio);
        }
        documento[chave] = saida;
    };

    porMapa('maps', podarDocumentoDeMapa);
    porMapa('cesium3d', podarDocumentoCesium3d);
    porMapa('streetview360', podarDocumentoSv360);

    if (Array.isArray(documento.briefings)) {
        documento.briefings = documento.briefings.map((b) => {
            const r = podarBriefing(b, resolver);
            somarRelatorios(relatorio, r.relatorio);
            return r.documento;
        });
    }

    return { documento, relatorio };
}
