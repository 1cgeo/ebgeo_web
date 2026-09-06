// Path: tests/unit/kmz-nucleo-codigo-desenhavel.test.js

/**
 * @fileoverview O KMZ desenha o Núcleo pelo código DESENHÁVEL, e não pelo código de tela.
 *
 * Desde o Núcleo (2026-09-03) toda medida de coordenação nasce com `pointCode: 'ECHELON'`,
 * que é código de TELA e não existe no catálogo; quem desenha é o `echelonCode` ao lado. O
 * controle resolve isso antes de assar o bitmap, em quatro caminhos. O exportador de KMZ tinha
 * um quinto caminho, a regeneração da imagem para o mapa cuja figura não está no disco, e ele
 * entregava as propriedades cruas ao gerador: `Point ECHELON not found in catalog`, `catch`
 * com `console.warn`, e o Placemark saía SEM ícone. Achado pelo revisor do porte.
 *
 * Duas réguas: a função pura que resolve o código (importada de verdade) e a FIAÇÃO daquele
 * quinto caminho, lida da fonte porque o módulo puxa geradores acoplados ao DOM.
 *
 * A FIAÇÃO MUDOU DE ENDEREÇO em 2026-09-06, com o porte do recorte de bitmap: a regeneração
 * sem mapa e sem store saiu do mapper e virou `frontend/src/js/military_tools/symbol-bitmap.regenerate.js`,
 * um módulo só, usado pelo KMZ e (adiante) pela carga de camadas. A propriedade é a mesma e
 * continua presa; o que este arquivo passou a ler é o novo dono dela. Visto reprovando com a
 * resolução removida de lá.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    COORDINATION_POINTS_CATALOG,
    resolveDrawablePointCode,
} from '../../src/js/military_tools/coordination_measure_tool/coordination_points_catalog.js';

const pacote = resolve(import.meta.dirname, '../..');
const MAPPER = readFileSync(resolve(pacote, 'src/js/import_export/kmz/kmz-feature-mapper.js'), 'utf8');
const REGENERADOR = readFileSync(
    resolve(pacote, 'src/js/military_tools/symbol-bitmap.regenerate.js'),
    'utf8',
);
const CONTROLE = readFileSync(
    resolve(pacote, 'src/js/military_tools/coordination_measure_tool/add_coordination_measure_control.js'),
    'utf8',
);

describe('resolveDrawablePointCode', () => {
    it('o código de tela ECHELON não está no catálogo (senão esta régua mediria nada)', () => {
        expect(COORDINATION_POINTS_CATALOG.ECHELON).toBeUndefined();
        expect(COORDINATION_POINTS_CATALOG.ECHELON_16).toBeDefined();
    });

    it('resolve ECHELON e ECHELON_FT pelo echelonCode, com o batalhão como padrão', () => {
        expect(resolveDrawablePointCode({ pointCode: 'ECHELON', echelonCode: 'ECHELON_11' })).toBe('ECHELON_11');
        expect(resolveDrawablePointCode({ pointCode: 'ECHELON' })).toBe('ECHELON_16');
        expect(resolveDrawablePointCode({ pointCode: 'ECHELON_FT' })).toBe('ECHELON_FT_16');
        expect(resolveDrawablePointCode({ pointCode: 'ECHELON_FT', echelonCode: 'ECHELON_FT_12' })).toBe('ECHELON_FT_12');
    });

    it('deixa passar qualquer outro código, inclusive um já resolvido', () => {
        expect(resolveDrawablePointCode({ pointCode: '130600' })).toBe('130600');
        expect(resolveDrawablePointCode({ pointCode: 'ECHELON_16', echelonCode: 'ECHELON_11' })).toBe('ECHELON_16');
        expect(resolveDrawablePointCode({})).toBeUndefined();
    });

    it('o padrão da ferramenta nasce com o código de tela, que é o que expõe o KMZ', () => {
        expect(CONTROLE).toMatch(/pointCode:\s*["']ECHELON["']/);
    });
});

describe('a regeneração sem mapa resolve o código antes de gerar', () => {
    it('chama resolveDrawablePointCode e passa o código resolvido ao gerador', () => {
        const inicio = REGENERADOR.indexOf('featureType === COORDINATION_MEASURE');
        expect(inicio).toBeGreaterThan(-1);
        const bloco = REGENERADOR.slice(inicio, REGENERADOR.indexOf('} catch', inicio));
        expect(bloco).toContain('resolveDrawablePointCode(properties)');
        expect(bloco).toContain('{ ...properties, pointCode }');
        // A resolução tem de vir do catálogo, e não de uma segunda tabela de apelidos
        // aqui dentro: duas cópias da mesma regra divergem, e a que diverge é muda.
        expect(REGENERADOR).toContain('coordination_points_catalog.js');
        expect(REGENERADOR).not.toMatch(/ECHELON_16['"]?\s*[,:]/);
    });

    it('o KMZ passa por esse módulo, e não por um regenerador próprio', () => {
        expect(MAPPER).toContain('regenerateSymbolBitmap(featureType, properties)');
        expect(MAPPER).not.toMatch(/async function regenerateSymbol\(/);
    });
});
