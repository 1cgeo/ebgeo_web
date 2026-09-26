// Path: js/import_export/ebgeo-file-gate.js

/**
 * @module import_export/ebgeo-file-gate
 * @description Reading a `.ebgeo` far enough to decide whether it can be imported AT ALL, with no
 * store, no DOM and no side effect: the archive is opened, `data.json` is parsed, and the version
 * is judged against the same two bounds the importer has always used.
 *
 * WHY IT LEFT `export-import.service.js`. The gate itself never moved an inch of behaviour, but its
 * POSITION in the boot did. "Abrir arquivo .ebgeo" in `atlas.html` hands the bytes to the map, and
 * the map's boot used to CREATE the local atlas first and only then ask the importer to read the
 * file — so a file the gate refuses (one written by a newer version of the product, one that is not
 * even a zip) left behind an empty atlas named after the file, with the person standing inside it
 * and one of the ten local slots spent on an import that never happened. Refusing before creating
 * requires the predicate outside a service that pulls in the `@store` barrel and modal UI, which is
 * the same reason `import-normalize.js` lives on its own.
 *
 * All declared version markers must be readable and within the supported bounds, including v1.x.
 * Structural validation and ZIP CRC checks happen before callers may replace stored data.
 * Both bounds are READ from their constants and never spelled out here — the ceiling is exactly the
 * number that moves when the schema moves.
 *
 * THE ARCHIVE IS OPENED TWICE on the boot path (once here, once by the importer). That is the price
 * of deciding before spending a slot, it is paid on a file the person just chose, and it buys a
 * refusal that costs nothing. Duplicating the READER would have been the other price, and it is the
 * one this module refuses to pay: the importer now opens the archive through this function too, so
 * there is one parser.
 */

import JSZip from 'jszip';
import { ATLAS_SCHEMA_VERSION } from '@store/atlas/atlas.entity.js';
// From the FILE, never from the `@store` barrel: this module is reached from the map's BOOT (see
// `deep-link/pending-import.js`), and `repository.utils.js` imports nothing at all.
import { MIN_SCHEMA_VERSION, compareVersions } from '@store/repository.utils.js';

/** Magic prefix the exporter writes in front of the masked ZIP. */
const MASK_HEADER = 'EBGXOR';

/**
 * Simple XOR operation to mask (and unmask) data.
 *
 * THE ONE COPY. `ExportImportService.xorData` delegates here, so masking on the way out and
 * unmasking on the way in cannot drift apart. Its edge behaviour is deliberately preserved
 * byte-for-byte (a non-numeric key coerces to 0 and a string input yields the key itself, both
 * pinned in `tests/unit/export-import-helpers-puros.test.js`).
 *
 * @param {Uint8Array} data - Data to mask.
 * @param {number} key - XOR key (default 0xAA).
 * @returns {Uint8Array} Masked data.
 */
export function xorMask(data, key = 0xAA) {
    const result = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
        result[i] = data[i] ^ key;
    }
    return result;
}

/**
 * A sentença da casa para um arquivo que não abre como arquivo compactado.
 *
 * O NOME ENTRA QUANDO EXISTE, e só então: `readEbgeoArchive` aceita `File|Blob`, e um `Blob` não
 * tem nome nenhum (é o que chega pelo `.ebgeo` guardado entre páginas). Escrever `"undefined"` no
 * meio da frase seria pior que não nomear o arquivo.
 *
 * @param {File|Blob} file - O arquivo que não abriu.
 * @returns {string} A frase, em português, sem uma palavra de dependência dentro.
 */
function corruptedArchiveMessage(file) {
    const nome = typeof file?.name === 'string' ? file.name.trim() : '';
    return nome
        ? `O arquivo "${nome}" não é um .ebgeo válido, ou está corrompido`
        : 'O arquivo não é um .ebgeo válido, ou está corrompido';
}

/**
 * Opens a `.ebgeo` and returns its archive and its parsed document.
 *
 * Throws on everything that is not a readable archive (not a zip, no `data.json`, invalid JSON),
 * with the message the importer already showed for each case. A caller that only needs the verdict
 * catches and reports; the importer keeps the `zip` because the image blobs are in it.
 *
 * A FALHA DE ABERTURA É TRADUZIDA, e é a única das três que era estrangeira. O `fileoverview` de
 * `deep-link/pending-import.js` declara que a sentença de um arquivo quebrado é a do próprio
 * importador, e até 2026-09-07 o importador não tinha sentença nenhuma para este caso: repassava a
 * do JSZip, que o usuário lê como `Can't find end of central directory : is this a zip file ? If it
 * is, see https://stuk.github.io/jszip/...` (achado D8 da bancada escalada, medido no navegador).
 * Inglês, jargão de formato e um link para a documentação de uma biblioteca, num diálogo cuja
 * pergunta é "e agora?". O erro original vai em `cause`, para o console e para quem depura.
 *
 * OS OUTROS DOIS CASOS FICAM COMO ESTÃO. `data.json` ausente já tem frase da casa, e o JSON inválido
 * continua devolvendo o `SyntaxError` do runtime: ele nomeia a posição do caractere, que é o que se
 * pede a um arquivo que ABRIU e cujo conteúdo é que está errado.
 *
 * @param {File|Blob} file - The archive, masked or plain.
 * @returns {Promise<{zip: import('jszip'), data: Object}>}
 */
export async function readEbgeoArchive(file) {
    const fileArray = new Uint8Array(await file.arrayBuffer());
    const identifier = new TextDecoder().decode(fileArray.slice(0, MASK_HEADER.length));
    const zipData = identifier === MASK_HEADER
        ? xorMask(fileArray.slice(MASK_HEADER.length))
        : fileArray;

    let zip;
    try {
        // Check every entry before a replacing import is allowed to clear its target.
        zip = await JSZip.loadAsync(zipData, { checkCRC32: true });
    } catch (error) {
        throw new Error(corruptedArchiveMessage(file), { cause: error });
    }

    const dataFile = zip.file('data.json');
    if (!dataFile) {
        throw new Error('Arquivo data.json não encontrado no .ebgeo');
    }

    const imageIds = new Set();
    for (const name of Object.keys(zip.files)) {
        if (zip.files[name].dir) continue;
        const match = /^images\/([^/]+)\.(png|jpe?g|svg|webp)$/i.exec(name);
        if (!match) continue;
        if (imageIds.has(match[1])) throw new Error(`Arquivo .ebgeo ambíguo: mais de uma imagem usa o ID ${match[1]}.`);
        imageIds.add(match[1]);
    }
    return { zip, data: JSON.parse(await dataFile.async('string')) };
}

/**
 * Checks if import data is in v1.x format (pre-v2.0).
 * @param {Object} data - Import data.
 * @returns {boolean} True if v1.x format.
 */
export function isV1Format(data) {
    if (!data || data.atlas) return false;
    if (data.schemaVersion && compareVersions(data.schemaVersion, '2.0') >= 0) return false;
    return Boolean(data.version) && compareVersions(data.version, '2.0') < 0;
}

/**
 * The verdict on a parsed `.ebgeo` document: may this build import it?
 *
 * Supported v1.x archives pass before migration stamps the current version. Checking their
 * original markers prevents normalization from concealing an unsupported or corrupt document.
 *
 * @param {Object} data - The parsed `data.json`.
 * @returns {string|null} The pt-BR refusal to show, or `null` when the file may be imported.
 */
export function importVersionRefusal(data) {
    if (!data?.version) {
        return 'Arquivo .ebgeo sem informação de versão. Use a versão mais recente da aplicação para gerar o arquivo.';
    }
    // A malformed marker must not become zero in compareVersions, and a legacy
    // outer marker must not conceal a future atlas record. v1 obeys the same floor.
    for (const version of [data.version, data.schemaVersion, data.atlas?.schemaVersion]) {
        if (version === undefined) continue;
        if (typeof version !== 'string' || !/^\d+\.\d+(?:\.\d+)?$/.test(version)) {
            return 'Arquivo .ebgeo com informação de versão inválida. Os dados atuais foram preservados.';
        }
        if (compareVersions(version, MIN_SCHEMA_VERSION) < 0) {
            return `Arquivo .ebgeo incompatível. Versão do arquivo: ${version}, versão mínima aceita: ${MIN_SCHEMA_VERSION}`;
        }
        if (compareVersions(version, ATLAS_SCHEMA_VERSION) > 0) {
            return `Arquivo .ebgeo incompatível - versão muito recente. Versão do arquivo: ${version}, versão máxima aceita: ${ATLAS_SCHEMA_VERSION}. Atualize a aplicação para usar este arquivo.`;
        }
    }
    const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    if (!object(data) || !object(data.maps)) return 'Arquivo .ebgeo inválido: a coleção de mapas está ausente ou corrompida.';
    for (const [name, map] of Object.entries(data.maps)) {
        if (!object(map) || (map.features !== undefined && !object(map.features))) {
            return `Arquivo .ebgeo inválido: estrutura do mapa "${name}" corrompida.`;
        }
        for (const list of Object.values(map.features || {})) {
            if (!Array.isArray(list) || list.some(feature => !object(feature))) {
                return `Arquivo .ebgeo inválido: coleção de feições do mapa "${name}" corrompida.`;
            }
        }
    }
    for (const key of ['layers', 'groups', 'cesium3d', 'streetview360', 'temporal', 'gridStyle', 'mapNotes', 'comments', 'colorUsage', 'mapLocks', 'mapBadgeColors']) {
        if (data[key] !== undefined && !object(data[key])) return `Arquivo .ebgeo inválido: seção ${key} corrompida.`;
    }
    for (const key of ['customIcons', 'briefings', 'mapOrder']) {
        if (data[key] !== undefined && !Array.isArray(data[key])) return `Arquivo .ebgeo inválido: seção ${key} corrompida.`;
    }
    for (const layers of Object.values(data.layers || {})) {
        if (!Array.isArray(layers) || layers.some(layer => !object(layer))) return 'Arquivo .ebgeo inválido: camadas corrompidas.';
    }
    for (const groups of Object.values(data.groups || {})) {
        if (!object(groups) || Object.values(groups).some(group => !object(group)
            || (group.features !== undefined && (!Array.isArray(group.features) || group.features.some(ref => !object(ref)))))) {
            return 'Arquivo .ebgeo inválido: grupos corrompidos.';
        }
    }
    for (const briefing of data.briefings || []) {
        if (!object(briefing) || (briefing.slides !== undefined && (!Array.isArray(briefing.slides)
            || briefing.slides.some(slide => !object(slide))))) return 'Arquivo .ebgeo inválido: briefings corrompidos.';
    }
    if ((data.customIcons || []).some(icon => !object(icon) || typeof icon.id !== 'string' || !icon.id)) {
        return 'Arquivo .ebgeo inválido: ícones personalizados corrompidos.';
    }
    return null;
}
