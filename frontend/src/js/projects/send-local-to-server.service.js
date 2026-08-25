// Path: js/projects/send-local-to-server.service.js

/**
 * @fileoverview "Enviar ao servidor" no cartão de atlas LOCAL de `atlas.html`: transforma um slot
 * local num atlas NOVO do servidor, sem montar o slot e sem apagar coisa alguma.
 *
 * O CAMINHO QUE JÁ EXISTIA É O DO MAPA (`account/account.control.js` → `saveLocalToServer` →
 * `import_export/save-local-atlas.service.js`), e ele não serve aqui por duas razões, nenhuma
 * cosmética:
 *
 *   1. ELE LÊ O STORE MONTADO. `exportService.buildExportDataObject` alcança o barril `@store` e,
 *      em parte, a memória (`getMapGroups` lê `memoryStore.groups[map]`), o que só existe depois de
 *      um MOUNT. `atlas.html` boota sem MapLibre, sem store e sem `initServices()` — é o primeiro
 *      parágrafo de `projects-page.js` — e o cartão clicado nem sempre é o slot montado.
 *   2. ELE É PARA O ATLAS ATIVO. No mapa, o store local É o atlas que sobe, então o wipe que vem
 *      depois é a troca de atlas. Aqui não há atlas ativo nenhum, e apagar o slot de origem seria
 *      destruir, sem pedir, o cartão que a pessoa mandou COPIAR para o servidor.
 *
 * O MODELO É `projects/import-ebgeo.service.js`, o vizinho que já faz este mesmo trajeto sem store:
 * um `.ebgeo` vira atlas de servidor por `buildServerImportPayload` (pura) mais duas rotas,
 * `POST /atlas/import` e `POST /atlas/:id/images/bulk`. A única peça que faltava era a FONTE: lá
 * ela é um ZIP, aqui é um namespace de IndexedDB.
 *
 * E A FONTE SE LÊ SEM MONTAR, por `getStoreFor(storeId, scope)` com o escopo do slot passado
 * EXPLICITAMENTE. É o mesmo mecanismo de `copyAtlasDatabases` (`atlas-namespace.js`), que
 * `duplicateLocalAtlas` usa para copiar banco a banco entre dois slots: ler namespace alheio já é
 * precedente desta casa. O que este módulo NÃO faz, e a lista importa:
 *
 *   - não chama `activateScope`, então não toma o LOCK DE MONTAGEM daquele namespace nem escreve o
 *     ponteiro de montagem desta aba. Uma aba de mapa aberta no mesmo atlas continua sozinha nele,
 *     e um envio que falhe no meio não deixa a tela de escolha segurando um atlas;
 *   - não escreve NADA no slot de origem: todas as chamadas aqui são `getItem`/`iterate`;
 *   - não apaga o slot, não move o ponteiro de atlas local corrente, não mexe no registro.
 *
 * O PREÇO, DITO POR EXTENSO: `buildLocalAtlasExportData` é uma SEGUNDA LEITURA do formato de disco,
 * ao lado de `store/repositories/local.repository.js`. Um prefixo de chave que mude lá e não mude
 * aqui vira seção que sobe vazia, em silêncio. Foi aceito porque a alternativa (montar o slot)
 * arrasta a store inteira para uma página que existe justamente por não a ter, e porque a leitura
 * é rasa: as chaves estão asseridas uma a uma em
 * `tests/unit/enviar-atlas-local-ao-servidor.test.js`, contra IndexedDB de verdade.
 */

import {
    StoreName,
    getStoreFor,
} from '@store/atlas-namespace.js';
import { ATLAS_SCHEMA_VERSION } from '@store/atlas/atlas.entity.js';
// DIRETO DO ARQUIVO, e nao pelo barril `@store`: o barril arrasta a store inteira, e este modulo
// existe justamente por a pagina de escolha nao a ter. `repository.utils.js` nao importa nada.
import { getDefaultLayer } from '@store/repository.utils.js';
import { buildServerImportPayload } from '@js/import_export/local-atlas-to-server.js';
import { buildImageUploads, uploadImagesInChunks } from '@js/import_export/atlas-image-upload.js';
import { generateUUID } from '@utils/uuid.js';

/**
 * As chaves de disco que este leitor usa, num lugar só.
 *
 * ESCRITAS AQUI E NÃO ESPALHADAS PELO CÓDIGO porque é este o ponto de drift contra
 * `local.repository.js`: um prefixo que mude lá tem de mudar numa linha só aqui. O teste NÃO lê
 * esta tabela, e não é descuido: ele semeia os literais à mão, porque um teste que derivasse as
 * chaves daqui faria instrumento e sujeito concordarem por construção, e a tabela passaria a ser o
 * que ela mesma disser que é.
 *
 * A ASSIMETRIA É REAL E NÃO É ENGANO: `layers_`, `gridStyle_`, `map_notes_` e `color_usage_` são
 * indexadas pela CHAVE do mapa (que num atlas sincronizado é o UUID), enquanto `temporal_` é
 * indexada pelo NOME. Uniformizá-las aqui leria a gaveta errada.
 */
const KEY = Object.freeze({
    atlasRecord: 'current_atlas',
    layers: (mapKey) => `layers_${mapKey}`,
    cesium3d: (mapKey) => `cesium3d_${mapKey}`,
    streetview360: (mapKey) => `streetview360_${mapKey}`,
    mapNotes: (mapKey) => `map_notes_${mapKey}`,
    gridStyle: (mapKey) => `gridStyle_${mapKey}`,
    colorUsage: (mapKey) => `color_usage_${mapKey}`,
    temporal: (mapName) => `temporal_${mapName}`,
    customIcons: 'custom_icons',
    mapOrder: 'mapOrder',
    currentMap: 'lastActiveMap',
});

/** Lê uma chave, devolvendo `null` no lugar de estourar por gaveta que nem existe. */
async function ler(storeId, scope, key) {
    try {
        return await getStoreFor(storeId, scope).getItem(key);
    } catch {
        // Banco ausente é o estado normal de uma seção que o atlas nunca usou: localforage cria a
        // base na primeira leitura e devolve `null`. Só um erro REAL cai aqui, e uma seção
        // opcional ilegível não pode derrubar o envio das outras nove.
        return null;
    }
}

/** Escreve `valor` em `destino[chave]` só quando ele carrega conteúdo. */
function porSecao(destino, chave, valor) {
    if (valor == null) return;
    if (Array.isArray(valor) ? valor.length === 0 : Object.keys(valor).length === 0) return;
    destino[chave] = valor;
}

/**
 * Monta, a partir de um namespace de atlas local, o MESMO objeto que o exportador `.ebgeo` produz
 * (`ExportImportService.buildExportDataObject`), que é a entrada de `buildServerImportPayload`.
 *
 * O NOME DO MAPA VEM DO VALOR, NUNCA DA CHAVE. A chave de `ebgeo_maps` é o UUID num atlas
 * sincronizado e o NOME num atlas local anônimo (`repositories/index.js` decide isso na criação),
 * então derivar o nome da chave acertaria só metade dos casos. `saveMap` garante `data.name` nos
 * dois (`local.repository.js`), e é dele que o nome sai.
 *
 * O QUE ELE DELIBERADAMENTE NÃO FAZ: não passa por `optimizeMapData` nem pela poda de referência
 * privada de catálogo. A primeira só normaliza feição, e `buildFeatures` normaliza de novo do
 * outro lado; a segunda é refeita dentro de `buildServerImportPayload`
 * (`pruneCatalogLayerDefinitions`), que é o ponto por onde este payload passa obrigatoriamente.
 *
 * @param {{kind: string, atlasId: string, dbSuffix: string}} scope - Escopo do slot, de
 *   `scopeOfLocalAtlas(entry)`.
 * @returns {Promise<Object>} O objeto de exportação. `maps` vazio significa atlas sem mapa.
 */
export async function buildLocalAtlasExportData(scope) {
    if (!scope) throw new Error('buildLocalAtlasExportData: scope is required');

    const atlasRecord = await ler(StoreName.ATLAS, scope, KEY.atlasRecord);

    // `iterate` em vez de `keys()` mais N `getItem`: uma passada por banco, que é o que
    // `copyAtlasDatabases` faz pelo mesmo motivo.
    const mapEntries = [];
    await getStoreFor(StoreName.MAPS, scope).iterate((value, key) => {
        if (value) mapEntries.push([key, value]);
    });

    const data = {
        version: ATLAS_SCHEMA_VERSION,
        currentMap: null,
        mapOrder: [],
        maps: {},
        colorUsage: {}, mapNotes: {}, groups: {}, layers: {},
        cesium3d: {}, streetview360: {}, temporal: {}, gridStyle: {},
        briefings: [],
    };

    const nomePorChave = new Map();
    for (const [mapKey, mapData] of mapEntries) {
        const mapName = String(mapData?.name || mapKey);
        nomePorChave.set(mapKey, mapName);
        data.maps[mapName] = {
            baseLayer: mapData?.baseLayer || 'carta-topografica',
            analysisLayers: mapData?.analysisLayers || {},
            features: mapData?.features || {},
            catalogLayers: mapData?.catalogLayers,
            zoom: mapData?.zoom ?? null,
            center_lat: mapData?.center_lat ?? null,
            center_long: mapData?.center_long ?? null,
            bearing: mapData?.bearing ?? 0,
            pitch: mapData?.pitch ?? 0,
        };
    }

    for (const [mapKey, mapName] of nomePorChave) {
        // A CAMADA PADRAO SE SINTETIZA QUANDO NAO FOI GRAVADA, e esta linha e a metade que
        // faltava. Ela nasceu de um defeito medido em 2026-08-25, no banco do chefe: todo atlas
        // enviado por este caminho tinha ZERO camadas e 100% das feicoes orfas, enquanto os
        // enviados pelo menu do mapa tinham camada e nenhuma orfa.
        //
        // POR QUE O IRMAO DO MAPA NAO ERRAVA: ele le pelo REPOSITORIO, e `LocalRepository.getLayers`
        // devolve `[getDefaultLayer()]` quando a chave nao existe. Um atlas local que so usou a
        // camada padrao NUNCA grava `layers_`, porque essa camada e sintetizada na leitura e nunca
        // persistida. Este leitor e cru, entao a secao subia vazia.
        //
        // O ESTRAGO ERA MUDO E TOTAL: sem camada no servidor, `buildLayers` devolve lista vazia, o
        // atlas nasce sem nenhuma, e o `layerId` cunhado para cada feicao nao nomeia coisa alguma.
        // O filtro do mapa esconde todas, e a aba de feicoes, que nao filtra, lista todas. A
        // pessoa ve um atlas cheio na lista e um mapa vazio.
        //
        // OS DOIS LADOS PASSAM PELO MESMO `layerIdFor`, e e isso que faz o remendo casar:
        // `buildFeatures` mapeia `props.layerId || 'default'` e `buildLayers` mapeia `l.id`, que
        // aqui tambem e `'default'`. O mesmo mapeador cunha o mesmo UUID para os dois.
        //
        // O CABECALHO DESTE MODULO JA AVISAVA que ser um SEGUNDO leitor do formato de disco custa
        // esta classe de divergencia. Custou. Se `LocalRepository.getLayers` mudar a sintese, esta
        // linha tem de mudar junto.
        const camadas = await ler(StoreName.LAYERS, scope, KEY.layers(mapKey));
        porSecao(data.layers, mapName,
            Array.isArray(camadas) && camadas.length > 0 ? camadas : [getDefaultLayer()]);
        porSecao(data.groups, mapName, await ler(StoreName.GROUPS, scope, mapKey));
        porSecao(data.cesium3d, mapName,
            await ler(StoreName.CESIUM3D, scope, KEY.cesium3d(mapKey)));
        porSecao(data.streetview360, mapName,
            await ler(StoreName.STREETVIEW360, scope, KEY.streetview360(mapKey)));
        porSecao(data.mapNotes, mapName,
            await ler(StoreName.SETTINGS, scope, KEY.mapNotes(mapKey)));
        porSecao(data.gridStyle, mapName,
            await ler(StoreName.SETTINGS, scope, KEY.gridStyle(mapKey)));
        porSecao(data.temporal, mapName,
            await ler(StoreName.SETTINGS, scope, KEY.temporal(mapName)));
        // AS DUAS VARIANTES, e a legada por último: `color_usage_` é gravada sob a chave RESOLVIDA,
        // então um atlas migrado para UUID pode ter resíduo ainda sob o nome.
        porSecao(data.colorUsage, mapName,
            await ler(StoreName.SETTINGS, scope, KEY.colorUsage(mapKey))
            ?? await ler(StoreName.SETTINGS, scope, KEY.colorUsage(mapName)));
    }

    const briefings = [];
    try {
        await getStoreFor(StoreName.BRIEFINGS, scope).iterate((value) => {
            if (value) briefings.push(value);
        });
    } catch {
        // Mesma escolha do exportador do mapa: um briefing ilegível custa os briefings, nunca o
        // atlas inteiro.
    }
    if (briefings.length > 0) {
        briefings.sort((a, b) => (b?.updatedAt ?? 0) - (a?.updatedAt ?? 0));
        data.briefings = briefings;
    }

    const customIcons = await ler(StoreName.SETTINGS, scope, KEY.customIcons);
    if (Array.isArray(customIcons) && customIcons.length > 0) data.customIcons = customIcons;

    // A ORDEM VEM DO SETTING, e o registro do atlas é o segundo lugar a perguntar; sem nenhum dos
    // dois, a ordem de leitura dos mapas é melhor do que ordem nenhuma. Toda entrada é traduzida de
    // CHAVE para NOME, porque `mapOrder` guarda a chave e o payload é indexado por nome.
    const ordemCrua = await ler(StoreName.SETTINGS, scope, KEY.mapOrder)
        ?? atlasRecord?.mapOrder
        ?? mapEntries.map(([k]) => k);
    const nomesConhecidos = new Set(Object.keys(data.maps));
    data.mapOrder = (Array.isArray(ordemCrua) ? ordemCrua : [])
        .map((k) => nomePorChave.get(k) ?? k)
        .filter((n) => nomesConhecidos.has(n));
    for (const nome of nomesConhecidos) {
        if (!data.mapOrder.includes(nome)) data.mapOrder.push(nome);
    }

    const atual = await ler(StoreName.SETTINGS, scope, KEY.currentMap);
    data.currentMap = nomesConhecidos.has(atual)
        ? atual
        : (nomePorChave.get(atlasRecord?.lastActiveMapId) ?? data.mapOrder[0] ?? null);

    return data;
}

/**
 * Envia um atlas LOCAL ao servidor como atlas NOVO. Não destrutivo: o slot de origem sai desta
 * função exatamente como entrou.
 *
 * A ORDEM É A DO IRMÃO DO MAPA, e ela não é arbitrária: o atlas sobe PRIMEIRO com as referências de
 * imagem apontando para os ids LOCAIS, e os blobs sobem DEPOIS preservando esses ids, porque o
 * servidor guarda o id que o cliente mandou. Inverter obrigaria a reescrever toda referência já
 * gravada.
 *
 * UMA IMAGEM QUE NÃO SOBE NÃO DERRUBA O ENVIO, e é por isso que o retorno traz `imageStats`: o
 * atlas existe no servidor de qualquer forma, e a frase que a tela diz muda com esse número
 * (`sendToServerNotice`).
 *
 * @param {{id: string, name: string, dbSuffix: string}} entry - A entrada do registro local, de
 *   `listLocalAtlases()`. O `dbSuffix` é o que endereça os bancos, então uma entrada sem ele
 *   endereçaria os bancos legados de outro slot.
 * @param {Object} deps
 * @param {Object} deps.apiClient - O ApiClient (`importAtlas` + `bulkUploadImages`).
 * @param {Function} deps.scopeOf - Constrói o escopo do slot (`scopeOfLocalAtlas`), injetado para
 *   que o teste possa endereçar um namespace sem carregar o registro inteiro.
 * @param {string} [deps.name] - Nome do atlas no servidor. Sem ele, o nome do slot.
 * @returns {Promise<{atlasId: string, name: string, stats: Object, imageStats: Object}>}
 * @throws {Error} Quando o slot não tem mapa nenhum, ou o servidor recusa a importação. Nos dois
 *   casos nada foi criado no servidor e nada foi tocado neste navegador.
 */
export async function sendLocalAtlasToServer(entry, { apiClient, scopeOf, name } = {}) {
    if (!entry?.id) throw new Error('sendLocalAtlasToServer: entry with an id is required');
    const scope = scopeOf(entry);
    const atlasName = String(name || entry.name || 'Atlas').trim();

    const exportData = await buildLocalAtlasExportData(scope);
    if (Object.keys(exportData.maps).length === 0) {
        // A RECUSA VEM ANTES DA REDE, e com a frase pronta: criar um atlas vazio no servidor para
        // depois explicá-lo é o defeito que esta linha evita.
        throw new Error('Este atlas local não tem nenhum mapa para enviar ao servidor.');
    }

    // O BLOB GANHA ID NOVO A CADA ENVIO, pela mesma razao da porta irma
    // (`import_export/save-local-atlas.service.js`), e as duas precisam faze-lo.
    //
    // `images.id` e chave primaria GLOBAL. Feicao, camada e grupo tambem sao, mas ali o conserto
    // vive no SERVIDOR, que recunha o que ja esta ocupado no momento do import. Com o blob esse
    // conserto NAO ALCANCA: ele sobe DEPOIS, entao um id recunhado la deixaria a referencia ja
    // gravada na feicao apontando para o nada. Cunhar ANTES de montar o payload resolve por
    // construcao, e nada precisa voltar do servidor.
    //
    // O SINTOMA SEM ISTO E MUDO: o reenvio de um atlas COM IMAGEM entra, e a imagem some. Foi
    // apontado em 2026-08-25 como a metade que faltava do conserto da colisao de id.
    //
    // DUAS PASSADAS da funcao PURA, e a leitura cara do IndexedDB continua sendo uma so: a
    // primeira serve para descobrir QUAIS blobs o atlas cita. A segunda reescreve, pelo
    // `imageIdMap`, todas as referencias de uma vez.
    const sondagem = buildServerImportPayload(exportData, { name: atlasName });
    const imageIdMap = Object.fromEntries(sondagem.imageIds.map((id) => [id, generateUUID()]));
    const built = buildServerImportPayload(exportData, { name: atlasName, imageIdMap });
    const atlas = await apiClient.importAtlas(built.payload);

    // O BLOB SE LE PELO ID LOCAL E SOBE PELO NOVO. `built.imageIds` continua sendo a lista de ids
    // LOCAIS que o atlas cita, e nao a recunhada: quem carrega a troca e o `imageIdMap`, que a
    // segunda passada ja aplicou as REFERENCIAS dentro do payload. Ler pelo id novo devolveria
    // vazio, e o envio subiria sem imagem nenhuma, calado.
    const encontradas = [];
    for (const id of built.imageIds) {
        const blob = await ler(StoreName.IMAGES, scope, id);
        if (blob) encontradas.push([imageIdMap[id] ?? id, blob]);
    }
    const { uploads, skipped } = await buildImageUploads(encontradas);
    const { failed } = await uploadImagesInChunks(apiClient, atlas.id, uploads);

    return {
        atlasId: atlas.id,
        name: atlasName,
        stats: built.stats,
        imageStats: {
            total: built.imageIds.length,
            uploaded: uploads.length - failed.length,
            skipped: skipped.length,
            failed: failed.length,
        },
    };
}
