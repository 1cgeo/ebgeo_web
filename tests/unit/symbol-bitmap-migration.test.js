// Path: tests/unit/symbol-bitmap-migration.test.js

/**
 * Guard of the v2.3 -> v2.4 rung: the startup pass that rebuilds every symbol
 * bitmap written before the crop.
 *
 * The migration itself talks to IndexedDB and cannot run in `node`, and that is
 * exactly why the decision it makes lives in a pure function (`refreshStaleBitmaps`,
 * proved in symbol-bitmap-refresh.test.js) and why the WIRING is proved here as
 * source text. A rung that is written but never called into `safelyMigrate` fails in
 * total silence: no error, no log, just an atlas that keeps its old bitmaps while
 * the version stamp says it was migrated.
 *
 * The version bump is the trigger. Without it, `detectMigrationNeeded` reports
 * nothing to do and the rung is never reached at all.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compareVersions } from '../../src/js/store/repository.utils.js';
import { ATLAS_SCHEMA_VERSION } from '../../src/js/store/atlas/atlas.entity.js';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'js');

/**
 * Reads one source file under `src/js`.
 * @param {...string} segments - Path segments below src/js
 * @returns {string} File contents
 */
function source(...segments) {
    return readFileSync(join(srcRoot, ...segments), 'utf8');
}

describe('cadeia de versao (v2.3 -> v2.4)', () => {
    it('a versao corrente ja passou de 2.3', () => {
        expect(compareVersions('2.3', ATLAS_SCHEMA_VERSION)).toBe(-1);
    });

    it('todo atlas anterior a 2.4 dispara a migracao, e 2.4 nao', () => {
        const dispara = (v) => compareVersions(v, '2.4') < 0;
        expect(dispara('2.3')).toBe(true);
        expect(dispara('2.2')).toBe(true);
        expect(dispara('1.7')).toBe(true);
        expect(dispara('2.4')).toBe(false);
        expect(dispara(ATLAS_SCHEMA_VERSION)).toBe(false);
    });

    it('a versao alvo do atlas e exatamente 2.4', () => {
        // Um degrau escrito para 2.4 com o alvo em 2.3 nunca seria alcancado.
        expect(ATLAS_SCHEMA_VERSION).toBe('2.4');
    });
});

describe('a fiacao do degrau em safelyMigrate', () => {
    const servico = source('store', 'migration', 'migration.service.js');

    it('importa migrateToV2_4', () => {
        expect(servico).toMatch(
            /import \{ migrateToV2_4 \} from '\.\/v2\.3-to-v2\.4\.migration\.js';/,
        );
    });

    it('e a CHAMA sob a condicao de versao, nao apenas importa', () => {
        expect(servico).toMatch(
            /if \(compareVersions\(currentVersion, '2\.4'\) < 0\) \{\s*await migrateToV2_4\(\);/,
        );
    });

    it('o degrau novo vem DEPOIS do de 2.3 (a escada e ordenada)', () => {
        expect(servico.indexOf('migrateToV2_3();'))
            .toBeLessThan(servico.indexOf('migrateToV2_4();'));
    });
});

describe('a migracao usa a mesma passagem pura da importacao', () => {
    const migracao = source('store', 'migration', 'v2.3-to-v2.4.migration.js');

    it('chama refreshStaleBitmaps sobre as feicoes do mapa', () => {
        expect(migracao).toMatch(/refreshStaleBitmaps\(mapData\.features/);
    });

    it('grava os blobs no armazenamento de imagens', () => {
        expect(migracao).toMatch(/createInstance\(\{ name: 'ebgeo_images' \}\)/);
        expect(migracao).toMatch(/imageStore\.setItem\(id, blob\)/);
    });

    it('so reescreve o mapa que mudou', () => {
        expect(migracao).toMatch(/if \(updated > 0\) \{\s*await mapStore\.setItem/);
    });

    it('carimba a versao no atlas e nas configuracoes', () => {
        expect(migracao).toMatch(/atlas\.schemaVersion = ATLAS_SCHEMA_VERSION;/);
        expect(migracao).toMatch(/appStore\.setItem\('schemaVersion', ATLAS_SCHEMA_VERSION\)/);
    });

    it('so carimba a versao quando NENHUMA feicao ficou para tras', () => {
        // Carimbar com feicao ainda velha e o pior desfecho possivel: o degrau nao
        // roda de novo, e o bitmap velho fica para sempre. Os dois carimbos tem de
        // estar DENTRO da guarda.
        // O `giveUp` e a saida limitada: depois de MAX_FAILED_ATTEMPTS inicios com
        // pendencia a versao e carimbada mesmo assim, para um codigo de catalogo
        // aposentado nao prender o esquema em 2.3 para sempre.
        expect(migracao).toMatch(/const MAX_FAILED_ATTEMPTS = 3;/);
        expect(migracao).toMatch(/const giveUp = totalFailed > 0 && attempts >= MAX_FAILED_ATTEMPTS;/);
        const guarda = migracao.indexOf('if (totalFailed === 0 || giveUp) {');
        const carimboDoAtlas = migracao.indexOf('atlas.schemaVersion = ATLAS_SCHEMA_VERSION;');
        const carimboDasConfiguracoes = migracao.indexOf(
            "appStore.setItem('schemaVersion', ATLAS_SCHEMA_VERSION)",
        );

        expect(guarda).toBeGreaterThan(-1);
        expect(carimboDoAtlas).toBeGreaterThan(guarda);
        expect(carimboDasConfiguracoes).toBeGreaterThan(guarda);
    });

    it('avisa que roda de novo, em vez de dar a migracao por feita', () => {
        expect(migracao).toMatch(/console\.warn\(/);
        expect(migracao).toMatch(/runs again at the next startup/);
    });

    it('devolve success apenas quando nada falhou', () => {
        // O `safelyMigrate` e quem le isto: `success: true` com falhas seria a mesma
        // mentira do carimbo, dita para quem chamou.
        expect(migracao).toMatch(
            /return \{ success: totalFailed === 0, updated: totalUpdated, failed: totalFailed \};/,
        );
    });
});

describe('o importador de .ebgeo refaz os bitmaps antigos', () => {
    const servico = source('import_export', 'export-import.service.js');

    it('importa a mesma funcao pura da migracao', () => {
        expect(servico).toMatch(
            /import \{ refreshStaleBitmaps \} from '@store\/migration\/symbol-bitmap\.refresh\.js';/,
        );
    });

    it('chama a passagem nos DOIS ramos da importacao', () => {
        const chamadas = servico.match(/this\.refreshImportedBitmaps\(/g) || [];
        expect(chamadas).toHaveLength(2);
    });

    it('no ramo aditivo grava logo apos regenerar os ids, sem colher os blobs', () => {
        // Os ids ja sao finais: `regenerateMapIds` copiou os blobs velhos do arquivo
        // para eles, entao gravar agora apenas os substitui pelos novos. Por isso o
        // ramo passa `storeImage` como `onBlob` e nao guarda nada: colher os blobs
        // num Map seria segurar todos os PNGs do arquivo em memoria a toa.
        const aditivo = servico.indexOf('await this.refreshImportedBitmaps(newMapData, storeImage);');

        expect(aditivo).toBeGreaterThan(-1);
        expect(aditivo).toBeGreaterThan(servico.indexOf('IDUtils.regenerateMapIds'));
        expect(aditivo).toBeLessThan(servico.indexOf('await addMap(finalMapName'));
        // O Map devolvido nao e mais amarrado a nada nesse ramo.
        expect(servico).not.toContain('const refreshedBlobs');
    });

    it('repassa o onBlob para a passagem pura, que e quem o aguarda', () => {
        // Sem o repasse o ramo aditivo voltaria a gravar depois do carimbo, e uma
        // gravacao que falha deixaria a feicao carimbada sem bitmap novo no disco.
        expect(servico).toMatch(/async refreshImportedBitmaps\(mapData, onBlob\) \{/);
        expect(servico).toMatch(
            /refreshStaleBitmaps\(mapData\?\.features, \{ onBlob \}\)/,
        );
    });

    it('no ramo normal so descarrega os blobs DEPOIS do arquivo', () => {
        // `loadImagesFromZip` roda por ultimo nesse ramo: um blob gravado antes dele
        // seria sobrescrito pelo bitmap velho que veio no .ebgeo.
        const coleta = servico.indexOf('const pendingBitmapBlobs = new Map();');
        const zip = servico.lastIndexOf('await this.loadImagesFromZip(zip);');
        const descarga = servico.indexOf('for (const [imageId, blob] of pendingBitmapBlobs)');
        const troca = servico.indexOf('await this.baseLayerControl.switchMap();');

        expect(coleta).toBeGreaterThan(-1);
        expect(coleta).toBeLessThan(zip);
        expect(zip).toBeLessThan(descarga);
        // E antes da troca de mapa, que e o que registra as imagens da loja.
        expect(descarga).toBeLessThan(troca);
    });
});
