// Path: js/store/migration/ebgeo-de-recuperacao.js

/**
 * @fileoverview The `.ebgeo` this computer can still produce when the store never booted.
 *
 * ===========================================================================================
 * WHY IT CANNOT BE THE ORDINARY EXPORTER
 * ===========================================================================================
 * `ExportImportService.buildExportDataObject` reads the `@store` barrel, and the SYNCHRONOUS
 * getters of that barrel read `memoryStore`, which is hydrated one map at a time by
 * `setCurrentMap`. The recovery screen is drawn from `runLegacyUpgradeGate`, which runs BEFORE
 * `activateBootAtlasScope` and before `initServices()`: there is no active scope, no hydrated
 * memory and no map. Calling the exporter there does not fail, which is the dangerous part: it
 * answers with an empty atlas. Three of the four pages that draw this screen must also never
 * pull the `@store` barrel at all.
 *
 * So this module reads the DATABASES of one scope directly, the same way `inventoryScope` does,
 * and assembles the document the importer expects.
 *
 * ===========================================================================================
 * THE ADDRESS OF A SIDE RECORD IS TRIED, NEVER DERIVED
 * ===========================================================================================
 * The side stores of a map (`color_usage_`, `map_notes_`, `layers_`, `gridStyle_`, `temporal_`,
 * the groups document, the 3D and 360 documents, the comments) are keyed by what
 * `LocalRepository._resolveMapKey` resolved at the time of the write, and that has been the map
 * NAME, the map UUID and the key of the map document at different points in the product's life
 * (see `local.repository.js`: `color_usage` migrated from name to id, while `temporal_` and
 * `mapLocked_` are still name-keyed on purpose). Re-deriving that rule here would be a second
 * implementation of it, and a recovery artifact is the last place that may quietly disagree with
 * the store. So every address the map is known by is TRIED, in order, and the first one that
 * answers wins. It is tolerant by design: this file exists for an acervo that is already in
 * trouble.
 *
 * ===========================================================================================
 * ONE ACERVO OR NOTHING
 * ===========================================================================================
 * A `.ebgeo` is ONE atlas. When this computer holds more than one acervo that is not a copy of
 * another, there is no honest single file to hand over, and the caller falls back to the raw
 * recovery copy, which carries all of them. `listarAcervosDeRecuperacao` is what decides, and it
 * deliberately does NOT count the transition's own destination while it is uncommitted (it is a
 * partial copy of the origin, which is counted) nor the legacy origin once the transition is
 * settled and the origin has not changed since (it is the pre-update copy of an atlas that is
 * already in the registry).
 *
 * THE EXTENSION TABLE IS A DECLARED DUPLICATE of `ExportImportService.getBlobExtension`. The
 * importer derives the MIME of each image FROM the extension in the archive, so writing every
 * blob as `.png` would corrupt a JPEG on the way back in. Importing that method would drag the
 * whole service, which is exactly what this module exists to avoid; five lines of table is the
 * declared price, and `tests/integration/ebgeo-de-recuperacao.test.js` pins the round trip.
 */

import JSZip from 'jszip';
import {
    ATLAS_RECORD_KEY, StoreName, getStoreFor, listAtlasStores, localScope, readLocalAtlasRegistry
} from '../atlas-namespace.js';
import { legacyScope } from './migration-scope.js';
import { ATLAS_SCHEMA_VERSION } from '../atlas/atlas.entity.js';
import { inventoryScope, legacyHasChanged } from './legacy-transition.js';
import { MigrationRecoveryError, readLegacyTransition, transitionIsSettled } from './transition-state.js';
import { xorMask } from '../../import_export/ebgeo-file-gate.js';
import { storedMapName } from '../repository.utils.js';

/** Magic prefix the ordinary exporter writes in front of the masked ZIP. */
const MASK_HEADER = 'EBGXOR';

/** Settings keys that carry a per-map document, by the section they feed in the `.ebgeo`. */
const SECOES_DE_SETTINGS = Object.freeze([
    ['colorUsage', 'color_usage_'],
    ['mapNotes', 'map_notes_'],
    ['gridStyle', 'gridStyle_'],
    ['temporal', 'temporal_']
]);

/** Per-map documents that live in a store of their own, by section. */
const SECOES_DE_LOJA = Object.freeze([
    ['layers', StoreName.LAYERS, 'layers_'],
    ['groups', StoreName.GROUPS, ''],
    ['cesium3d', StoreName.CESIUM3D, 'cesium3d_'],
    ['streetview360', StoreName.STREETVIEW360, 'streetview360_'],
    ['comments', StoreName.COMMENTS, 'comments_']
]);

/**
 * @param {Blob} blob - Image blob as the store holds it.
 * @returns {string} Extension the importer will read the MIME back from.
 */
function extensaoDoBlob(blob) {
    const mime = String(blob?.type || 'image/png').split(';')[0].trim().toLowerCase();
    if (mime === 'image/svg+xml') return 'svg';
    if (mime === 'image/jpeg') return 'jpg';
    if (mime === 'image/webp') return 'webp';
    return 'png';
}

/**
 * How many records a scope holds, WITHOUT fingerprinting any of them.
 *
 * `inventoryScope` hashes every value, which is what the transition needs and this does not: the
 * count here feeds a decision and a sentence, and on an acervo with megabytes of image blobs the
 * hashing is the whole cost.
 *
 * @param {Object} scope - Scope built by `localScope()`.
 * @returns {Promise<number>} Total keys across the atlas databases of that scope.
 */
export async function contarRegistros(scope) {
    const totais = await Promise.all(listAtlasStores(scope).map(({ store }) => store.length()));
    return totais.reduce((soma, n) => soma + n, 0);
}

/**
 * The acervos on this origin that are not a copy of another one.
 *
 * @returns {Promise<Array<{ scope: Object, label: string, registros: number }>>} One entry per
 *   acervo that holds records, in the order the person would think of them.
 */
export async function listarAcervosDeRecuperacao() {
    const acervos = [];
    const origem = legacyScope();

    let substituida = false;
    try {
        const state = await readLegacyTransition();
        substituida = Boolean(state) && transitionIsSettled(state) && !(await legacyHasChanged(state));
    } catch {
        // An unreadable journal cannot say the origin was superseded, so it is counted. Counting
        // one acervo too many costs the raw copy; counting one too few would hand over a `.ebgeo`
        // that silently leaves work behind.
        substituida = false;
    }
    if (!substituida) {
        const registros = await contarRegistros(origem);
        if (registros > 0) acervos.push({ scope: origem, label: 'Dados da versão antiga', registros });
    }

    for (const entry of await readLocalAtlasRegistry()) {
        if (typeof entry?.dbSuffix !== 'string') continue;
        const scope = localScope(entry.id, entry.dbSuffix);
        const registros = await contarRegistros(scope);
        if (registros > 0) acervos.push({ scope, label: entry.name || 'Meu Atlas', registros });
    }
    return acervos;
}

/**
 * Every address one map is known by, most specific first.
 * @param {string} chave - Key of the map document.
 * @param {Object} doc - The map document.
 * @returns {string[]} Distinct addresses to try.
 */
function enderecosDoMapa(chave, doc) {
    return [...new Set([chave, doc?.id, doc?.name].filter(v => typeof v === 'string' && v))];
}

/**
 * @param {import('localforage')} store - Store to read.
 * @param {string} prefixo - Key prefix of the section.
 * @param {string[]} enderecos - Addresses to try, in order.
 * @returns {Promise<*>} The first value found, or null.
 */
async function primeiroQueResponde(store, prefixo, enderecos) {
    for (const endereco of enderecos) {
        const valor = await store.getItem(`${prefixo}${endereco}`);
        if (valor !== null && valor !== undefined) return valor;
    }
    return null;
}

/**
 * @param {*} valor - Section value read from disk.
 * @returns {boolean} Whether it carries anything worth writing into the file.
 */
function temConteudo(valor) {
    if (valor === null || valor === undefined) return false;
    if (Array.isArray(valor)) return valor.length > 0;
    if (typeof valor === 'object') return Object.keys(valor).length > 0;
    return true;
}

/**
 * Builds the in-memory `.ebgeo` document of ONE scope, reading only its databases.
 *
 * @param {Object} scope - Scope built by `localScope()`.
 * @returns {Promise<{ data: Object, imagens: Map<string, Blob> }>} The document and the blobs it
 *   references, already narrowed to the ids the document actually names.
 */
export async function montarDocumentoEbgeo(scope) {
    const settings = getStoreFor(StoreName.SETTINGS, scope);
    const atlas = await getStoreFor(StoreName.ATLAS, scope).getItem(ATLAS_RECORD_KEY);

    const mapas = [];
    await getStoreFor(StoreName.MAPS, scope).iterate((doc, chave) => {
        if (doc && typeof doc === 'object') mapas.push([chave, doc]);
    });

    const data = {
        version: ATLAS_SCHEMA_VERSION,
        currentMap: null,
        mapOrder: [],
        maps: Object.create(null), colorUsage: Object.create(null), mapNotes: Object.create(null),
        groups: Object.create(null), layers: Object.create(null), cesium3d: Object.create(null),
        streetview360: Object.create(null), temporal: Object.create(null), gridStyle: Object.create(null),
        comments: Object.create(null), briefings: []
    };

    const nomePorEndereco = new Map();
    for (const [chave, doc] of mapas) {
        const nome = storedMapName(chave, doc);
        if (Object.hasOwn(data.maps, nome)) {
            throw new MigrationRecoveryError('mapas_ambiguos', 'Há mapas diferentes com o mesmo nome.');
        }
        nomePorEndereco.set(chave, nome);
        if (typeof doc.id === 'string') nomePorEndereco.set(doc.id, nome);
        const enderecos = enderecosDoMapa(chave, doc);
        // The map document IS the per-map block of the file, minus the bookkeeping the importer
        // mints again on the way in (`id`, `name`, `sync`).
        const bloco = { hillshadeEnabled: true, analysisLayers: {}, ...doc };
        delete bloco.id;
        delete bloco.name;
        delete bloco.sync;
        data.maps[nome] = bloco;

        for (const [secao, prefixo] of SECOES_DE_SETTINGS) {
            const valor = await primeiroQueResponde(settings, prefixo, enderecos);
            if (temConteudo(valor)) data[secao][nome] = valor;
        }
        for (const [secao, loja, prefixo] of SECOES_DE_LOJA) {
            const valor = await primeiroQueResponde(getStoreFor(loja, scope), prefixo, enderecos);
            if (temConteudo(valor)) data[secao][nome] = valor;
        }
    }

    const traduzir = endereco => nomePorEndereco.get(endereco) ?? endereco;
    const ordem = Array.isArray(atlas?.mapOrder)
        ? [...new Set(atlas.mapOrder.filter(item => typeof item === 'string').map(traduzir)
            .filter(nome => Object.hasOwn(data.maps, nome)))] : [];
    const nomes = Object.keys(data.maps);
    data.mapOrder = [...ordem, ...nomes.filter(nome => !ordem.includes(nome))];
    const apontado = traduzir(atlas?.lastActiveMapId ?? await settings.getItem('lastActiveMap'));
    data.currentMap = data.maps[apontado] ? apontado : (data.mapOrder[0] ?? null);

    const briefings = [];
    await getStoreFor(StoreName.BRIEFINGS, scope).iterate((valor) => {
        if (valor && typeof valor === 'object') briefings.push(valor);
    });
    if (briefings.length > 0) data.briefings = briefings;

    const icones = await settings.getItem('custom_icons');
    if (Array.isArray(icones) && icones.length > 0) data.customIcons = icones;

    return { data, imagens: await colherImagens(scope, data) };
}

/**
 * The image blobs the document names, and only those.
 *
 * Derived from the document ALREADY BUILT, never gathered in the same pass that builds it: the
 * ordinary exporter learned that lesson once (`collectUsedImageIds`), and two copies of the
 * "which ids matter" rule is how an export stops carrying its own pictures.
 *
 * @param {Object} scope - Scope built by `localScope()`.
 * @param {Object} data - The document.
 * @returns {Promise<Map<string, Blob>>} Blob by image id.
 */
async function colherImagens(scope, data) {
    const usados = new Set();
    for (const mapa of Object.values(data.maps)) {
        for (const lista of Object.values(mapa?.features || {})) {
            if (!Array.isArray(lista)) continue;
            for (const feicao of lista) {
                if (feicao?.properties?.id) usados.add(feicao.properties.id);
            }
        }
    }
    for (const icone of data.customIcons || []) {
        if (icone?.id) usados.add(icone.id);
    }
    const imagens = new Map();
    const loja = getStoreFor(StoreName.IMAGES, scope);
    for (const id of usados) {
        const blob = await loja.getItem(id);
        if (blob instanceof Blob) imagens.set(id, blob);
    }
    return imagens;
}

/**
 * Writes the document and its blobs as the bytes of a `.ebgeo` file.
 *
 * @param {Object} data - The document.
 * @param {Map<string, Blob>} imagens - Blobs by image id.
 * @returns {Promise<Blob>} The masked archive, byte-compatible with the ordinary exporter.
 */
async function escreverArquivoEbgeo(data, imagens) {
    const zip = new JSZip();
    const compressao = { compression: 'DEFLATE', compressionOptions: { level: 9 } };
    zip.file('data.json', JSON.stringify(data), compressao);
    for (const [id, blob] of imagens) {
        zip.file(`images/${id}.${extensaoDoBlob(blob)}`, blob, compressao);
    }
    const bruto = new Uint8Array(await (await zip.generateAsync({ type: 'blob', ...compressao })).arrayBuffer());
    const mascarado = xorMask(bruto);
    const cabecalho = new TextEncoder().encode(MASK_HEADER);
    const final = new Uint8Array(cabecalho.length + mascarado.length);
    final.set(cabecalho, 0);
    final.set(mascarado, cabecalho.length);
    return new Blob([final], { type: 'application/vnd.ebgeo' });
}

/**
 * The `.ebgeo` of the one acervo this computer holds.
 *
 * @returns {Promise<{ blob: Blob, nome: string, acervo: string, registros: number }>}
 * @throws {MigrationRecoveryError} `sem_acervo` when nothing readable is here, `varios_acervos`
 *   when a single file could not carry everything. Both are answers, not defects: the caller
 *   falls back to the raw copy and SAYS which of the two it handed over.
 */
export async function construirEbgeoDeRecuperacao() {
    const acervos = await listarAcervosDeRecuperacao();
    if (acervos.length === 0) {
        throw new MigrationRecoveryError('sem_acervo', 'Não há um acervo legível neste computador.');
    }
    if (acervos.length > 1) {
        throw new MigrationRecoveryError('varios_acervos', 'Há mais de um acervo neste computador.');
    }
    const [acervo] = acervos;
    const antes = await inventoryScope(acervo.scope);
    const { data, imagens } = await montarDocumentoEbgeo(acervo.scope);
    const blob = await escreverArquivoEbgeo(data, imagens);
    if (JSON.stringify(antes) !== JSON.stringify(await inventoryScope(acervo.scope))) {
        throw new MigrationRecoveryError('source_changed', 'Os dados mudaram durante a cópia. Feche as outras janelas e tente novamente.');
    }
    return {
        blob,
        nome: `ebgeo-${new Date().toISOString().slice(0, 10)}.ebgeo`,
        acervo: acervo.label,
        registros: acervo.registros
    };
}
