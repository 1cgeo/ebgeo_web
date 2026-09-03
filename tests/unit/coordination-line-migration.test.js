import { describe, it, expect } from 'vitest';
import { compareVersions } from '../../src/js/store/repository.utils.js';
import { ATLAS_SCHEMA_VERSION } from '../../src/js/store/atlas/atlas.entity.js';
import { migrateBarrierLines } from '../../src/js/store/migration/v2.2-to-v2.3.migration.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Guard for the Coordination Line rename (v2.2 -> v2.3).
 *
 * Unlike the temporal bump, this migration is NOT additive: the feature type
 * `barrier_line` became `coordination_line` and its bucket moved with it. A
 * feature the migration misses does not degrade, it DISAPPEARS, because nothing
 * reads the old bucket and nothing creates a source by the old name. Nothing
 * throws and nothing logs, so this file is the only place the loss can surface.
 *
 * The IndexedDB half is not unit-testable in `node`, which is exactly why the
 * rewrite lives in a pure exported function and is tested here.
 */

/** A stored feature as the old tool wrote it. */
const legacyFeature = (id, extra = {}) => ({
    type: 'Feature',
    id,
    properties: {
        id,
        source: 'barrier_line',
        type: 'barrier_line',
        color: '#000000',
        symbol_size: 0.5,
        baseCoordinates: [[-53, -30], [-52.9, -30]],
        ...extra,
    },
    geometry: { type: 'LineString', coordinates: [[-53, -30], [-52.9, -30]] },
});

describe('cadeia de versao (v2.2 -> v2.3)', () => {
    it('a versao corrente ja passou de 2.2', () => {
        expect(compareVersions('2.2', ATLAS_SCHEMA_VERSION)).toBe(-1);
    });

    it('todo atlas anterior a 2.3 dispara a migracao, e 2.3 nao', () => {
        const dispara = (v) => compareVersions(v, '2.3') < 0;
        expect(dispara('2.2')).toBe(true);
        expect(dispara('2.1')).toBe(true);
        expect(dispara('1.7')).toBe(true);
        expect(dispara('2.3')).toBe(false);
        expect(dispara(ATLAS_SCHEMA_VERSION)).toBe(false);
    });
});

describe('migrateBarrierLines', () => {
    it('move o balde, reescreve o tipo e carimba o simbolo do que ja existia', () => {
        const resultado = migrateBarrierLines({
            points: [],
            barrier_lines: [legacyFeature('a'), legacyFeature('b')],
        });

        expect(resultado.barrier_lines).toBeUndefined();
        expect(resultado.coordination_lines).toHaveLength(2);

        for (const feature of resultado.coordination_lines) {
            expect(feature.properties.source).toBe('coordination_line');
            expect(feature.properties.type).toBe('coordination_line');
            // 290199 e a unica coisa que a ferramenta antiga sabia desenhar, entao
            // a feicao migrada continua desenhando exatamente o que desenhava.
            expect(feature.properties.symbol_code).toBe('290199');
        }
    });

    it('preserva o resto da feicao, geometria e estilo inclusive', () => {
        const [migrada] = migrateBarrierLines({
            barrier_lines: [legacyFeature('a', { color: '#ff0000', nome: 'Barreira 1' })],
        }).coordination_lines;

        expect(migrada.properties.color).toBe('#ff0000');
        expect(migrada.properties.nome).toBe('Barreira 1');
        expect(migrada.properties.symbol_size).toBe(0.5);
        expect(migrada.geometry.coordinates).toEqual([[-53, -30], [-52.9, -30]]);
        expect(migrada.id).toBe('a');
    });

    it('nao sobrescreve um codigo de simbolo que a feicao ja tenha', () => {
        const [migrada] = migrateBarrierLines({
            barrier_lines: [legacyFeature('a', { symbol_code: '290307' })],
        }).coordination_lines;

        expect(migrada.properties.symbol_code).toBe('290307');
    });

    it('FUNDE com o balde novo em vez de descartar o que ja estava la', () => {
        // Um mapa tocado por uma versao mais nova pode ter os dois baldes. Trocar
        // um pelo outro perderia justamente o trabalho que a migracao protege.
        const resultado = migrateBarrierLines({
            barrier_lines: [legacyFeature('velha')],
            coordination_lines: [legacyFeature('nova', { source: 'coordination_line', type: 'coordination_line' })],
        });

        expect(resultado.coordination_lines).toHaveLength(2);
        expect(resultado.coordination_lines.map(f => f.id).sort()).toEqual(['nova', 'velha']);
    });

    it('some com o balde velho vazio, para a forma convergir', () => {
        const resultado = migrateBarrierLines({ points: [], barrier_lines: [] });
        expect(resultado.barrier_lines).toBeUndefined();
        expect(resultado.coordination_lines).toEqual([]);
    });

    it('nao reescreve mapa que nunca teve o balde velho', () => {
        // Devolver null e o que evita uma escrita por mapa em todo atlas do usuario.
        expect(migrateBarrierLines({ points: [], coordination_lines: [] })).toBeNull();
        expect(migrateBarrierLines({})).toBeNull();
        expect(migrateBarrierLines(undefined)).toBeNull();
    });

    it('WORST CASE: insumo degenerado nao lanca e nao perde feicao', () => {
        const degenerados = [
            ['balde que nao e array', { barrier_lines: 'nao sou array' }],
            ['feicao sem properties', { barrier_lines: [{ type: 'Feature' }] }],
            ['feicao nula', { barrier_lines: [null] }],
            ['balde novo que nao e array', { barrier_lines: [legacyFeature('a')], coordination_lines: 'lixo' }],
        ];

        for (const [nome, features] of degenerados) {
            expect(() => migrateBarrierLines(features), nome).not.toThrow();
            const resultado = migrateBarrierLines(features);
            if (resultado) {
                expect(resultado.barrier_lines, nome).toBeUndefined();
                expect(Array.isArray(resultado.coordination_lines), nome).toBe(true);
            }
        }
    });
});

// ============================================================================
// O CAMINHO DO ARQUIVO
// ============================================================================

/**
 * Um `.ebgeo` NUNCA passa pela migracao de IndexedDB: ele entra pelo importador,
 * que valida a versao e normaliza a forma. Como MIN_SCHEMA_VERSION e 1.3, TODO
 * arquivo aceito foi escrito antes da v2.3 e pode trazer o balde velho. Sem a
 * chamada abaixo, essas feicoes chegam ao armazenamento num balde que ninguem le.
 *
 * Estatico porque o servico importa `@store` inteiro e nao carrega no ambiente
 * `node`. Ele nao prova o COMPORTAMENTO (isso e o bloco de cima, na funcao pura),
 * prova a FIACAO: que o importador continua chamando a mesma funcao.
 */
describe('a importacao de .ebgeo tambem renomeia o balde', () => {
    const servico = readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), '..', '..',
            'src', 'js', 'import_export', 'export-import.service.js'),
        'utf8',
    );

    it('o importador importa a mesma funcao pura da migracao', () => {
        expect(servico).toMatch(
            /import \{ migrateBarrierLines \} from '@store\/migration\/v2\.2-to-v2\.3\.migration\.js';/,
        );
    });

    it('e a CHAMA na normalizacao, nao apenas importa', () => {
        // Uma linha de chamada de verdade, com atribuicao, e nao a palavra solta
        // num comentario.
        expect(servico).toMatch(/=\s*migrateBarrierLines\(mapData\.features\)/);
    });

    it('a normalizacao usa o retorno em vez de descarta-lo', () => {
        // `migrateBarrierLines` devolve null quando nada muda, entao o resultado
        // precisa ser testado antes de substituir as feicoes.
        expect(servico).toMatch(/if \(renamedFeatures\) \{[\s\S]{0,120}mapData\.features = renamedFeatures;/);
    });
});
