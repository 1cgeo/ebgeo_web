import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compareVersions } from '../../src/js/store/repository.utils.js';
import { ATLAS_SCHEMA_VERSION } from '../../src/js/store/atlas/atlas.entity.js';
import { ensureCoordinationLines } from '../../src/js/store/migration/v2.2-to-v2.3.migration.js';

/**
 * Guarda da migracao v2.2 -> v2.3, que da forma aos mapas anteriores a Linha de
 * Coordenacao.
 *
 * A falha que ela existe para impedir e MUDA: um mapa sem o balde
 * `coordination_lines` nao da erro, nao loga e nao avisa. O setup de camadas
 * monta a fonte a partir dessa colecao, e sem ela a ferramenta ativa, aceita
 * clique e nao desenha nada, porque toda escrita passa por
 * `getSource(...)?.setData`. Este arquivo e o unico lugar onde essa perda aparece.
 *
 * A metade de IndexedDB nao e testavel em `node`, e e exatamente por isso que a
 * normalizacao vive numa funcao pura exportada e e provada aqui.
 */

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

describe('ensureCoordinationLines', () => {
    it('CRIA o balde no mapa que nunca teve a ferramenta', () => {
        const resultado = ensureCoordinationLines({ points: [], lines: [] });

        expect(resultado).not.toBeNull();
        expect(resultado.coordination_lines).toEqual([]);
    });

    it('preserva os outros baldes intactos', () => {
        const antes = { points: [{ id: 'p' }], lines: [{ id: 'l' }], boundarys: [] };
        const depois = ensureCoordinationLines(antes);

        expect(depois.points).toEqual([{ id: 'p' }]);
        expect(depois.lines).toEqual([{ id: 'l' }]);
        expect(depois.boundarys).toEqual([]);
        // Devolve objeto NOVO, para o chamador poder comparar por identidade.
        expect(depois).not.toBe(antes);
        expect(antes.coordination_lines).toBeUndefined();
    });

    it('nao toca no mapa que ja esta na forma nova', () => {
        // Devolver null e o que evita uma escrita por mapa em todo atlas do usuario.
        expect(ensureCoordinationLines({ points: [], coordination_lines: [] })).toBeNull();
        expect(ensureCoordinationLines({ coordination_lines: [{ id: 'a' }] })).toBeNull();
    });

    it('nao apaga linha de coordenacao ja existente', () => {
        const existentes = [{ id: 'a' }, { id: 'b' }];
        expect(ensureCoordinationLines({ coordination_lines: existentes })).toBeNull();
    });

    it('WORST CASE: insumo degenerado nao lanca', () => {
        const degenerados = [
            ['sem features', undefined],
            ['features nulo', null],
            ['features nao e objeto', 'lixo'],
            ['features vazio', {}],
            ['balde corrompido', { coordination_lines: 'nao sou array' }],
            ['balde nulo', { coordination_lines: null }],
        ];

        for (const [nome, features] of degenerados) {
            expect(() => ensureCoordinationLines(features), nome).not.toThrow();
            const resultado = ensureCoordinationLines(features);
            if (resultado) {
                expect(Array.isArray(resultado.coordination_lines), nome).toBe(true);
            }
        }
    });

    it('um balde corrompido e substituido por uma colecao valida', () => {
        // `setOrCreateSource` monta `{ type, features }` sem checar, entao um balde
        // que nao e array viraria GeoJSON invalido na fonte do MapLibre.
        const resultado = ensureCoordinationLines({ coordination_lines: 42 });
        expect(resultado.coordination_lines).toEqual([]);
    });
});

// ============================================================================
// O CAMINHO DO ARQUIVO
// ============================================================================

/**
 * Um `.ebgeo` NUNCA passa pela migracao de IndexedDB: ele entra pelo importador,
 * que valida a versao e normaliza a forma. Como MIN_SCHEMA_VERSION e 1.3, todo
 * arquivo aceito pode ter sido escrito antes da v2.3 e chegar sem o balde.
 *
 * Estatico porque o servico importa `@store` inteiro e nao carrega no ambiente
 * `node`. Ele nao prova o COMPORTAMENTO (isso e o bloco de cima, na funcao pura),
 * prova a FIACAO: que o importador continua chamando a mesma funcao.
 */
describe('a importacao de .ebgeo tambem da forma ao mapa', () => {
    const servico = readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), '..', '..',
            'src', 'js', 'import_export', 'export-import.service.js'),
        'utf8',
    );

    it('o importador importa a mesma funcao pura da migracao', () => {
        expect(servico).toMatch(
            /import \{ ensureCoordinationLines \} from '@store\/migration\/v2\.2-to-v2\.3\.migration\.js';/,
        );
    });

    it('e a CHAMA na normalizacao, nao apenas importa', () => {
        expect(servico).toMatch(/=\s*ensureCoordinationLines\(mapData\.features\)/);
    });

    it('a normalizacao usa o retorno em vez de descarta-lo', () => {
        // A funcao devolve null quando nada muda, entao o resultado precisa ser
        // testado antes de substituir as feicoes.
        expect(servico).toMatch(/if \(shapedFeatures\) \{[\s\S]{0,120}mapData\.features = shapedFeatures;/);
    });
});
