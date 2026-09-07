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
 * THE PREDICATE IS UNCHANGED, deliberately: below `MIN_SCHEMA_VERSION` refuses, above
 * `ATLAS_SCHEMA_VERSION` refuses, the two messages are the ones the user already reads, and a v1.x
 * archive is accepted because the importer migrates it (which stamps it with the current version).
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
        zip = await JSZip.loadAsync(zipData);
    } catch (error) {
        throw new Error(corruptedArchiveMessage(file), { cause: error });
    }

    const dataFile = zip.file('data.json');
    if (!dataFile) {
        throw new Error('Arquivo data.json não encontrado no .ebgeo');
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
 * A v1.x archive passes because the importer migrates it, and the migration stamps the current
 * version onto it; judging it by the number it arrives with would refuse a file the product knows
 * how to read.
 *
 * @param {Object} data - The parsed `data.json`.
 * @returns {string|null} The pt-BR refusal to show, or `null` when the file may be imported.
 */
export function importVersionRefusal(data) {
    if (!data?.version) {
        return 'Arquivo .ebgeo sem informação de versão. Use a versão mais recente da aplicação para gerar o arquivo.';
    }
    if (isV1Format(data)) return null;
    if (compareVersions(data.version, MIN_SCHEMA_VERSION) < 0) {
        return `Arquivo .ebgeo incompatível. Versão do arquivo: ${data.version}, versão mínima aceita: ${MIN_SCHEMA_VERSION}`;
    }
    if (compareVersions(data.version, ATLAS_SCHEMA_VERSION) > 0) {
        return `Arquivo .ebgeo incompatível - versão muito recente. Versão do arquivo: ${data.version}, versão máxima aceita: ${ATLAS_SCHEMA_VERSION}. Atualize a aplicação para usar este arquivo.`;
    }
    return null;
}
