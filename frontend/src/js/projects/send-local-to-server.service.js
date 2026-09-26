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
 * The source is read from its explicit namespace, without mounting it. Like the ZIP importer,
 * it prepares metadata and image bytes privately on the server before a single publication.
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
// existe justamente por a pagina de escolha nao a ter. O utilitario depende so de funcoes puras.
import { getDefaultLayer, ensureCoordinationLines, storedMapName } from '@store/repository.utils.js';
// Quanto ha dentro de um escopo, por um leitor que NAO passa por este arquivo: e o denominador do
// aviso, e ele so serve para isso se for independente do numerador. Do ARQUIVO, como os vizinhos.
import { countAtlasContents } from '@store/atlas-contents.js';
import { buildServerImportPayload } from '@js/import_export/local-atlas-to-server.js';
import { tamanhoDoEnvio } from './server-send-phrases.js';
import { buildImageUploads } from '@js/import_export/atlas-image-upload.js';
import { generateUUID } from '@utils/uuid.js';
import { classifyMissingImages, missingImagesUploadConfirm, uploadCancelledError } from '../import_export/ebgeo-missing-images.js';

/**
 * As chaves de disco que este leitor usa, num lugar só.
 *
 * ESCRITAS AQUI E NÃO ESPALHADAS PELO CÓDIGO porque é este o ponto de drift contra
 * `local.repository.js`: um prefixo que mude lá tem de mudar numa linha só aqui. O teste NÃO lê
 * esta tabela, e não é descuido: ele semeia os literais à mão, porque um teste que derivasse as
 * chaves daqui faria instrumento e sujeito concordarem por construção, e a tabela passaria a ser o
 * que ela mesma disser que é.
 *
 * A ASSIMETRIA É REAL E NÃO É ENGANO: `layers_`, `gridStyle_` e `map_notes_` são
 * indexadas pela CHAVE do mapa (que num atlas sincronizado é o UUID), enquanto `temporal_` é
 * indexada pelo NOME. Uniformizá-las aqui leria a gaveta errada.
 */
const KEY = Object.freeze({
    atlasRecord: 'current_atlas',
    layers: (mapKey) => `layers_${mapKey}`,
    cesium3d: (mapKey) => `cesium3d_${mapKey}`,
    streetview360: (mapKey) => `streetview360_${mapKey}`,
    comments: (mapKey) => `comments_${mapKey}`,
    mapNotes: (mapKey) => `map_notes_${mapKey}`,
    gridStyle: (mapKey) => `gridStyle_${mapKey}`,
    temporal: (mapName) => `temporal_${mapName}`,
    mapLocked: (mapName) => `mapLocked_${mapName}`,
    mapBadgeColors: 'mapBadgeColors',
    customIcons: 'custom_icons',
    mapOrder: 'mapOrder',
    currentMap: 'lastActiveMap',
});

/** Lê uma chave, devolvendo `null` no lugar de estourar por gaveta que nem existe. */
async function ler(storeId, scope, key) {
    return getStoreFor(storeId, scope).getItem(key);
}

/** Escreve `valor` em `destino[chave]` só quando ele carrega conteúdo. */
function porSecao(destino, chave, valor) {
    if (valor == null) return;
    if (Array.isArray(valor) ? valor.length === 0 : Object.keys(valor).length === 0) return;
    destino[chave] = valor;
}

/**
 * O NOME DE UM MAPA DE ATLAS LOCAL, e a regra mudou em 2026-09-07 por uma perda medida.
 *
 * A CHAVE VENCE QUANDO ELA NÃO É UM IDENTIFICADOR. Num atlas local anônimo a chave de
 * `ebgeo_maps` É o nome, escrita por `createMapCompat` (`store/repositories/index.js`), e ela é a
 * fonte de verdade; a chave só deixa de sê-lo quando a criação rodou com a sincronização ligada e
 * gravou o mapa sob o UUID dele. `isValidId` é o teste de "isto é um identificador gerado" desta
 * casa, e cobre as duas formas que circulam (UUID v4 e o id legado `<epoch>-<aleatório>`).
 *
 * O PORQUÊ, MEDIDO. A linha anterior do produto grava TODO mapa novo com a chave certa e
 * `data.name = 'Novo Mapa'`: a guarda dela (`if (!newMapData.name)`) nunca dispara, porque
 * `getEmptyMapData()` já devolve esse nome. O campo era cosmético e inerte enquanto ninguém o
 * lia, e este leitor foi o PRIMEIRO consumidor a preferi-lo à chave. Resultado no navegador, em
 * 2026-09-07, sobre o acervo herdado de uma instalação real: treze dos catorze mapas colidiam
 * numa entrada só de `data.maps`, vencia o último iterado, e o servidor recebia 2 mapas de 14 e
 * 33 feições de 805 com aviso VERDE. Nenhuma migração repara o registro que já está no disco.
 *
 * A REGRA NÃO ACERTA TUDO SOZINHA, e é por isso que ela vem em par com {@link exigirNomesUnicos}:
 * dois mapas UUID-keyed com o mesmo `data.name` continuam colidindo, e ali a resposta é RECUSAR.
 *
 * @param {string} mapKey - A chave do registro em `ebgeo_maps`.
 * @param {Object} [mapData] - O documento do mapa.
 * @returns {string}
 */
function nomeDoMapa(mapKey, mapData) {
    return storedMapName(mapKey, mapData);
}

/**
 * O nome do mapa é a CHAVE PRIMÁRIA do documento de exportação (`data.maps`, `data.layers`,
 * `data.groups` e as outras sete seções são indexadas por ele), então dois registros no mesmo
 * nome são um mapa perdido. Esta função é a recusa.
 *
 * RECUSAR EM VEZ DE DESAMBIGUAR, e a escolha é deliberada. Renomear "Alfa" para "Alfa (2)" no
 * caminho do envio inventaria, dentro de um envio, um nome que não existe no acervo e que a
 * pessoa não reconheceria de volta; sobrescrever é o defeito que se está fechando. Uma recusa
 * nomeada, ANTES da rede, deixa o acervo intacto e diz o gesto que resolve.
 *
 * @param {Map<string, string>} nomePorChave - Chave do registro para o nome resolvido.
 * @throws {Error} Com `code = 'NOME_DE_MAPA_REPETIDO'` e `stage = 'leitura'`.
 */
function exigirNomesUnicos(nomePorChave) {
    /** @type {Map<string, string[]>} */
    const chavesPorNome = new Map();
    for (const [chave, nome] of nomePorChave) {
        if (!chavesPorNome.has(nome)) chavesPorNome.set(nome, []);
        chavesPorNome.get(nome).push(chave);
    }

    const repetidos = [...chavesPorNome.entries()].filter(([, chaves]) => chaves.length > 1);
    if (repetidos.length === 0) return;

    // TODAS AS CHAVES DE TODOS OS NOMES REPETIDOS, e não só o primeiro par: a pessoa vai ao mapa
    // renomear, e uma lista truncada a faria voltar aqui uma vez por colisão.
    const detalhe = repetidos
        .map(([nome, chaves]) => `"${nome}" (${chaves.map((c) => `"${c}"`).join(', ')})`)
        .join('; ');
    const erro = new Error(
        'Este atlas local tem mapas com o mesmo nome, e um sobrescreveria o outro no servidor: '
        + `${detalhe}. Nada foi enviado. Abra o atlas, renomeie os mapas repetidos e envie de novo.`
    );
    erro.code = 'NOME_DE_MAPA_REPETIDO';
    erro.stage = 'leitura';
    throw erro;
}

/**
 * Monta, a partir de um namespace de atlas local, o MESMO objeto que o exportador `.ebgeo` produz
 * (`ExportImportService.buildExportDataObject`), que é a entrada de `buildServerImportPayload`.
 *
 * O NOME DO MAPA VEM DA CHAVE QUANDO ELA NÃO É UM IDENTIFICADOR, e do valor quando é. A chave de
 * `ebgeo_maps` é o UUID num atlas sincronizado e o NOME num atlas local anônimo
 * (`repositories/index.js` decide isso na criação), então nenhum dos dois campos responde sozinho.
 * A regra inteira, com o defeito medido que a mudou em 2026-09-07, está em {@link nomeDoMapa}; a
 * colisão que ela não alcança está em {@link exigirNomesUnicos}, e RECUSA o documento.
 *
 * O QUE ELE DELIBERADAMENTE NÃO FAZ: não passa por `optimizeMapData` nem pela poda de referência
 * privada de catálogo. A primeira só normaliza feição, e `buildFeatures` normaliza de novo do
 * outro lado; a segunda é refeita dentro de `buildServerImportPayload`
 * (`pruneCatalogLayerDefinitions`), que é o ponto por onde este payload passa obrigatoriamente.
 *
 * O QUE ELE PASSOU A FAZER EM 2026-09-07: `ensureCoordinationLines`, a normalização de LEITURA da
 * coleção de feições. Ela não é da mesma natureza das duas acima, e é por isso que a exceção vale:
 * as duas seriam refeitas adiante, e esta não é refeita por ninguém. Um balde que só a linha
 * anterior do produto conhece chega ao mapeador do servidor sem nome que ele reconheça, e o que
 * ele faz com o desconhecido é DESCARTAR. Ver a linha, que traz o número medido.
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
        maps: Object.create(null),
        mapNotes: Object.create(null), groups: Object.create(null), layers: Object.create(null),
        cesium3d: Object.create(null), streetview360: Object.create(null),
        temporal: Object.create(null), gridStyle: Object.create(null), comments: Object.create(null),
        // The lock and the badge colours travel too (owner's decision of 2026-09-26), keyed by
        // NAME like `temporal`: the same shape `buildExportDataObject` produces.
        mapLocks: Object.create(null),
        briefings: [],
    };

    // O NOME SAI DA REGRA, e a unicidade É CONFERIDA ANTES DE ESCREVER a primeira seção: escrever
    // e conferir depois deixaria `data.maps` com um mapa a menos no caminho de erro, e um caminho
    // de erro que passa por um documento mutilado é o que se está fechando.
    const nomePorChave = new Map(
        mapEntries.map(([mapKey, mapData]) => [mapKey, nomeDoMapa(mapKey, mapData)])
    );
    exigirNomesUnicos(nomePorChave);

    for (const [mapKey, mapData] of mapEntries) {
        const mapName = nomePorChave.get(mapKey);
        data.maps[mapName] = {
            baseLayer: mapData?.baseLayer || 'carta-topografica',
            analysisLayers: mapData?.analysisLayers || {},
            // A COLEÇÃO PASSA PELA NORMALIZAÇÃO DE LEITURA, e este leitor era o único dos quatro
            // caminhos de entrada de um mapa que não passava.
            //
            // O QUE ELE PERDIA: a Linha de Barreiras é da 2.2, e a migração 2.2 para 2.3 da outra
            // linha do produto acrescentou `coordination_lines` VAZIO sem mover nada, então as
            // feições continuam em `barrier_lines` no disco de quem veio de lá. Aqui elas saíam
            // CRUAS, e `buildFeatures` resolve o tipo por `BUCKET_TO_SOURCE[balde] || props.source`:
            // `barrier_lines` não está na tabela e `'barrier_line'` não está entre os tipos que o
            // servidor aceita, então cada uma delas caía em `stats.droppedFeatures`. No mapa elas
            // apenas não desenhavam; no envio elas não CHEGAVAM.
            //
            // `ensureCoordinationLines` devolve `null` quando não há o que fazer, e é isso que
            // mantém o custo em zero para todo mapa que já está na forma corrente.
            features: ensureCoordinationLines(mapData?.features) ?? mapData?.features ?? {},
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
        porSecao(data.comments, mapName,
            await ler(StoreName.COMMENTS, scope, KEY.comments(mapKey)));
        porSecao(data.mapNotes, mapName,
            await ler(StoreName.SETTINGS, scope, KEY.mapNotes(mapKey)));
        porSecao(data.gridStyle, mapName,
            await ler(StoreName.SETTINGS, scope, KEY.gridStyle(mapKey)));
        porSecao(data.temporal, mapName,
            await ler(StoreName.SETTINGS, scope, KEY.temporal(mapName)));
        if (await ler(StoreName.SETTINGS, scope, KEY.mapLocked(mapName)) === true) data.mapLocks[mapName] = true;
        // A CONTAGEM DE CORES NÃO É LIDA (2026-09-21): ela deixou de viajar ao servidor, porque é
        // derivada das feições e cada cliente a recalcula (`performInitialColorAnalysis`). Eram duas
        // leituras de disco por mapa para montar uma seção que o payload descartava.
    }

    const briefings = [];
    await getStoreFor(StoreName.BRIEFINGS, scope).iterate(value => {
        if (value) briefings.push(value);
    });
    if (briefings.length > 0) {
        briefings.sort((a, b) => (b?.updatedAt ?? 0) - (a?.updatedAt ?? 0));
        data.briefings = briefings;
    }

    const customIcons = await ler(StoreName.SETTINGS, scope, KEY.customIcons);
    if (Array.isArray(customIcons) && customIcons.length > 0) data.customIcons = customIcons;

    const cores = await ler(StoreName.SETTINGS, scope, KEY.mapBadgeColors);
    if (cores && typeof cores === 'object') {
        const doDocumento = Object.fromEntries(Object.entries(cores)
            .filter(([nome, cor]) => Object.hasOwn(data.maps, nome) && typeof cor === 'string' && cor));
        if (Object.keys(doDocumento).length > 0) data.mapBadgeColors = doDocumento;
    }

    // A ORDEM VEM DO SETTING, e o registro do atlas é o segundo lugar a perguntar; sem nenhum dos
    // dois, a ordem de leitura dos mapas é melhor do que ordem nenhuma. Toda entrada é traduzida de
    // CHAVE para NOME, porque `mapOrder` guarda a chave e o payload é indexado por nome.
    const ordemCrua = await ler(StoreName.SETTINGS, scope, KEY.mapOrder)
        ?? atlasRecord?.mapOrder
        ?? mapEntries.map(([k]) => k);
    const nomesConhecidos = new Set(Object.keys(data.maps));
    // SEM REPETIÇÃO, PRESERVANDO A ORDEM (B3-12, 2026-09-07). A lista traduzida subia com o mesmo
    // nome treze vezes, o servidor a gravava verbatim e a aba Mapas do atlas novo desenhava
    // catorze cartões para dois mapas: a tela mostrava o número CERTO de mapas e escondia a
    // perda. A colisão de nome não é mais possível aqui (`exigirNomesUnicos` recusou antes), mas
    // a repetição continua sendo: o setting é escrito por outro caminho e pode citar a mesma
    // chave duas vezes, ou citar a chave E o nome do mesmo mapa.
    const vistos = new Set();
    data.mapOrder = [];
    for (const bruta of (Array.isArray(ordemCrua) ? ordemCrua : [])) {
        const nome = nomePorChave.get(bruta) ?? bruta;
        if (!nomesConhecidos.has(nome) || vistos.has(nome)) continue;
        vistos.add(nome);
        data.mapOrder.push(nome);
    }
    for (const nome of nomesConhecidos) {
        if (!vistos.has(nome)) {
            vistos.add(nome);
            data.mapOrder.push(nome);
        }
    }

    // O MAPA CORRENTE PASSA PELA MESMA TABELA, e não por uma segunda regra: `lastActiveMap` guarda
    // ora o nome, ora a CHAVE (as duas coisas coincidem num atlas anônimo e divergem num
    // sincronizado), e traduzir num lugar e não no outro é como o mapa corrente virava um nome que
    // o payload não tem.
    const atual = await ler(StoreName.SETTINGS, scope, KEY.currentMap);
    data.currentMap = nomesConhecidos.has(atual)
        ? atual
        : (nomePorChave.get(atual)
            ?? nomePorChave.get(atlasRecord?.lastActiveMapId)
            ?? data.mapOrder[0] ?? null);

    return data;
}

/**
 * O QUE O PAYLOAD LEVA, seção a seção, contado no objeto que vai subir.
 *
 * CONTADO DO PAYLOAD, e não somado das seções do documento de exportação, porque é o payload que
 * viaja: entre um e outro passam `buildFeatures` (que DESCARTA feição sem `source` válido) e o
 * achatamento de 3D e 360, e um contador que lesse o documento anunciaria à pessoa números que
 * ninguém enviou. `stats` continua vindo de `buildServerImportPayload` e não é substituído: ele
 * carrega `droppedFeatures`, que este contador não tem como saber.
 *
 * @param {Object} payload - O `payload` de `buildServerImportPayload`.
 * @param {number} imagens - Quantos blobs o payload CITA (`imageIds.length`).
 * @returns {{maps: number, features: number, layers: number, groups: number, briefings: number,
 *   slides: number, cesium3d: number, streetview360: number, images: number}}
 */
function contarPayload(payload, imagens) {
    const mapas = payload?.maps ?? [];
    const briefings = payload?.briefings ?? [];
    const soma = (lista, f) => lista.reduce((total, item) => total + f(item), 0);
    return {
        maps: mapas.length,
        features: soma(mapas, (m) => (m.features?.length ?? 0)),
        layers: soma(mapas, (m) => (m.layers?.length ?? 0)),
        groups: soma(mapas, (m) => (m.groups?.length ?? 0)),
        briefings: briefings.length,
        slides: soma(briefings, (b) => (b.slides?.length ?? 0)),
        cesium3d: soma(mapas, (m) => (m.cesium3dData?.length ?? 0)),
        streetview360: soma(mapas, (m) => (m.streetview360Data?.length ?? 0)),
        images: imagens,
    };
}

/**
 * Copies a local atlas to the server. Every source section and image must be readable;
 * the server exposes the atlas only after atomic publication. Source data is read-only.
 * @param {Object} entry - Local registry entry.
 * @param {Object} deps - API client, explicit scopeOf resolver, optional display name, and
 *   `confirmMissingImages(question)`: resolves true to publish without the pictures that have no
 *   file. Absent or false, nothing is published and the error carries `cancelled: true`.
 * @returns {Promise<Object>} Confirmed atlas, counts and server conversion summary.
 */
export async function sendLocalAtlasToServer(entry, { apiClient, scopeOf, name, confirmMissingImages } = {}) {
    if (!entry?.id) throw new Error('sendLocalAtlasToServer: entry with an id is required');
    const scope = scopeOf(entry);
    const atlasName = String(name || entry.name || 'Atlas').trim();

    const exportData = await buildLocalAtlasExportData(scope);
    if (Object.keys(exportData.maps).length === 0) {
        // A RECUSA VEM ANTES DA REDE, e com a frase pronta: criar um atlas vazio no servidor para
        // depois explicá-lo é o defeito que esta linha evita.
        throw comEtapa(
            new Error('Este atlas local não tem nenhum mapa para enviar ao servidor.'),
            'leitura'
        );
    }

    // Assign independent blob identities before rewriting all references. The atomic
    // transport preserves the original manifest on retries after a lost response.
    const sondagem = buildServerImportPayload(exportData, { name: atlasName });
    const imageIdMap = Object.fromEntries(sondagem.imageIds.map((id) => [id, generateUUID()]));
    const built = buildServerImportPayload(exportData, { name: atlasName, imageIdMap });

    const found = [];
    const missing = [];
    for (const id of built.imageIds) {
        // An INLINE photo goes up as a blob from here on, and its bytes are in the document, not
        // in the store (phase 2c, `buildServerImportPayload`).
        const blob = built.inlineImages.get(id) ?? await getStoreFor(StoreName.IMAGES, scope).getItem(id);
        // A MISSING ORIGINAL IS A QUESTION, NOT A REFUSAL (2026-09-21). It used to throw here, and
        // one picture with no file made the whole atlas unpublishable, forever, without saying
        // which picture. See `missingImagesUploadConfirm`.
        if (!blob) { missing.push(id); continue; }
        found.push([imageIdMap[id], blob]);
    }
    const { uploads, skipped } = await buildImageUploads(found);
    if (skipped.length || built.stats.droppedFeatures) throw comEtapa(new Error('Algumas imagens ou feições não puderam ser convertidas para o servidor. Nada foi enviado.'), 'leitura');
    const question = missingImagesUploadConfirm(classifyMissingImages(missing, exportData), { from: 'disco', exportData });
    if (question && !(await confirmMissingImages?.(question))) throw uploadCancelledError();
    const local = await countAtlasContents(scope);
    let atlas;
    try {
        atlas = await apiClient.importAtlas(built.payload, {
            images: uploads,
            source: { exportData, name: atlasName },
            missingImageIds: missing.map((id) => imageIdMap[id]),
        });
    } catch (error) {
        // Medido só no 413, que é quando a frase precisa dizer o tamanho: serializar o documento
        // inteiro de novo não é de graça num atlas que acabou de ser recusado por ser grande.
        if (error?.status === 413) error.tamanhoDoEnvio = tamanhoDoEnvio(built.payload);
        throw comEtapa(error, 'preparation');
    }

    return {
        atlasId: atlas.id,
        name: atlasName,
        stats: built.stats,
        imageStats: {
            total: built.imageIds.length,
            uploaded: uploads.length,
            skipped: skipped.length,
            failed: 0,
            // Published WITHOUT, by the person's decision. Not `skipped`: nothing failed.
            missing: missing.length,
        },
        // O QUE SUBIU, contra O QUE O SLOT TEM: os dois lados do aviso, e nenhum deles se deduz do
        // outro.
        sent: contarPayload(built.payload, built.imageIds.length),
        // O DENOMINADOR VEM DE UM LEITOR INDEPENDENTE, e essa independência é a régua inteira.
        //
        // A primeira versão desta linha contava o próprio `exportData`, e o controle negativo de
        // 2026-09-07 mostrou por que isso não vale nada: com o leitor de nomes quebrado, o
        // documento tinha 2 mapas e 33 feições, então o numerador e o denominador saíam do MESMO
        // defeito, concordavam, e o toast saía VERDE anunciando "2 mapas, 33 feições" sobre um
        // acervo de 14 e 805. Uma comparação entre duas medidas que compartilham o erro não é
        // comparação. `countAtlasContents` lê o disco por outro módulo e outro caminho de código
        // (`iterate` cru sobre `ebgeo_maps`, sem resolver nome nenhum), e por isso pode discordar.
        local,
        // A RESPOSTA DO SERVIDOR, INTEIRA. `prunedResourceRefs` é o que ele descartou e
        // `remappedIds` quantos ids do payload já estavam ocupados e foram recunhados (que não é
        // perda: é o servidor fazendo o certo, e por isso não vira frase).
        summary: atlas?.summary ?? null,
    };
}

/**
 * Carimba a ETAPA num erro e o devolve para ser relançado.
 *
 * ANOTA O ERRO ORIGINAL EM VEZ DE EMBRULHÁ-LO, de propósito: a pilha e o `status` do `ApiError`
 * são o que diz por que a rota falhou, e um `new Error(mensagem)` os perderia justamente no
 * caminho em que alguém vai investigar. Um `stage` que já venha preenchido não é sobrescrito, para
 * que a recusa de leitura atravesse os `catch` de fora com a etapa dela.
 *
 * @param {*} error
 * @param {'leitura'|'import'|'images'} stage
 * @param {string} [atlasId] - O atlas que JÁ existe no servidor, quando existe.
 * @returns {*} O mesmo erro, carimbado.
 */
function comEtapa(error, stage, atlasId = null) {
    const alvo = error instanceof Error ? error : new Error(String(error?.message ?? error));
    if (!alvo.stage) alvo.stage = stage;
    if (atlasId && !alvo.atlasId) alvo.atlasId = atlasId;
    return alvo;
}
