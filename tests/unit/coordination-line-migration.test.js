import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compareVersions } from '../../src/js/store/repository.utils.js';
import { ATLAS_SCHEMA_VERSION } from '../../src/js/store/atlas/atlas.entity.js';
import { ensureCoordinationLines } from '../../src/js/store/migration/v2.2-to-v2.3.migration.js';
// O catalogo do MD33 e uma folha sem import nenhum, entao ele carrega no ambiente `node`. O
// codigo da fonte esta AQUI e nao na migracao, pelo motivo do bloco final deste arquivo.
import {
    DEFAULT_SYMBOL_CODE,
    LINEAR_SYMBOLS,
} from '../../src/js/military_tools/coordination_line_tool/coordination_line_catalog.js';

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

// ============================================================================
// O BALDE DA 2.2: `barrier_lines` -> `coordination_lines`
// ============================================================================

/**
 * B2-2. A v2.3 nao trocou so o nome da ferramenta. Antes dela havia a Linha de Barreiras,
 * que escrevia no balde `barrier_lines` com `source: 'barrier_line'`, e a v2.3 a
 * generalizou na Linha de Coordenacao, cujo combobox escolhe um dos dez simbolos lineares
 * do MD33 pelo codigo. A linha de barreiras e o 290199 desse catalogo, e ele e tambem o
 * padrao da ferramenta nova.
 *
 * A migracao NAO movia nada: ela acrescentava o balde novo VAZIO. Medido em 2026-09-07 com
 * insumo forjado de 5 linhas (relatorio B2 daquele dia): `grep barrier_lines` da 0 ocorrencia
 * no codigo da 2.3, da 2.4 e da 3.0, nenhuma fonte do MapLibre tem esse nome, e as feicoes
 * viajam da 2.2 ao arquivo exportado sem nunca serem desenhadas, listadas, selecionadas nem
 * contadas. Nao e perda de bytes, e perda de alcance.
 *
 * O PIOR CASO deste bloco e o insumo do B2 verbatim: uma feicao movida para `barrier_lines`
 * com nada alem do carimbo de `source`, SEM `baseCoordinates`. Ele existe porque a versao
 * ingenua do conserto (so trocar o balde de nome) e PIOR que o defeito:
 * `applyZoomCorrections` regenera a geometria de toda linha de coordenacao na carga, e
 * `generateCoordinationLineGeometry` sem `baseCoordinates` devolve
 * `{ LineString, [[0,0],[0,0]] }`, isto e, a feicao sairia do lugar dela e iria para a Ilha
 * Nula. Por isso a adocao deriva `baseCoordinates` da propria geometria quando ela e um
 * LineString, e SO nesse caso.
 */
describe('ensureCoordinationLines: o balde `barrier_lines` da 2.2', () => {
    /** Uma feicao como a que o B2 forjou: linha comum, so com o carimbo de `source`. */
    const forjadaB2 = (n) => ({
        type: 'Feature',
        id: 1700000000000 + n,
        properties: {
            id: `b-${n}`, source: 'barrier_line', color: '#000000', lineWidth: 4, opacity: 1,
            nome: `Linha #${n}`, visivel: true, bloqueado: false, layerId: 'default',
        },
        geometry: { type: 'LineString', coordinates: [[-43.2 - n / 100, -22.9], [-43.1 - n / 100, -22.8]] },
    });

    /** Uma Linha de Barreiras AUTENTICA da 2.2, com o bloco inteiro que o controle escrevia. */
    const autentica2_2 = () => ({
        type: 'Feature',
        id: 1700000000099,
        properties: {
            id: 'bl-autentica',
            source: 'barrier_line',
            color: '#123456',
            lineWidth: 6,
            opacity: 0.7,
            symbol_size: 1.25,
            symbol_spacing: 3.75,
            createdAtZoom: 12.4,
            zoomCorrectionEnabled: false,
            calculatedLineWidth: 6,
            calculatedSymbolSize: 1.25,
            calculatedSymbolSpacing: 3.75,
            baseCoordinates: [[-43.5, -22.5], [-43.4, -22.4], [-43.3, -22.45]],
            nome: 'Linha de Barreiras #3',
            descricao: 'obstaculo do vale',
            visivel: true,
            bloqueado: false,
            layerId: 'camada-2',
        },
        geometry: { type: 'MultiLineString', coordinates: [[[-43.5, -22.5], [-43.45, -22.45]]] },
    });

    it('PIOR CASO (insumo do B2): 5 no balde velho saem 5 no balde novo, e o velho SOME', () => {
        const antes = { lines: [], barrier_lines: [1, 2, 3, 4, 5].map(forjadaB2) };
        const depois = ensureCoordinationLines(antes);

        expect(depois).not.toBeNull();
        expect(depois.coordination_lines).toHaveLength(5);
        expect('barrier_lines' in depois).toBe(false);
        for (const feicao of depois.coordination_lines) {
            expect(feicao.properties.source).toBe('coordination_line');
            expect(feicao.properties.symbol_code).toBe('290199');
        }
        // A entrada nao e mutada: a migracao compara por identidade para decidir se grava.
        expect(antes.barrier_lines).toHaveLength(5);
        expect(antes.barrier_lines[0].properties.source).toBe('barrier_line');
    });

    it('PIOR CASO: sem `baseCoordinates` a adocao as deriva do LineString, em vez de mandar a feicao para [0,0]', () => {
        const depois = ensureCoordinationLines({ barrier_lines: [forjadaB2(1)] });

        expect(depois.coordination_lines[0].properties.baseCoordinates)
            .toEqual([[-43.21, -22.9], [-43.11, -22.8]]);
    });

    it('nao INVENTA coordenadas quando a geometria nao e um LineString', () => {
        const semBase = autentica2_2();
        delete semBase.properties.baseCoordinates;
        const depois = ensureCoordinationLines({ barrier_lines: [semBase] });

        expect(depois.coordination_lines[0].properties.baseCoordinates).toBeUndefined();
    });

    it('a linha AUTENTICA atravessa com tamanho, espacamento e ancora de zoom intactos', () => {
        const depois = ensureCoordinationLines({ barrier_lines: [autentica2_2()] });
        const p = depois.coordination_lines[0].properties;

        expect(p.source).toBe('coordination_line');
        expect(p.symbol_code).toBe('290199');
        expect(p.symbol_size).toBe(1.25);
        expect(p.symbol_spacing).toBe(3.75);
        expect(p.createdAtZoom).toBe(12.4);
        expect(p.zoomCorrectionEnabled).toBe(false);
        expect(p.baseCoordinates).toEqual([[-43.5, -22.5], [-43.4, -22.4], [-43.3, -22.45]]);
        // O que e do usuario nao se reescreve: nome, descricao, cor, camada e id.
        expect(p.nome).toBe('Linha de Barreiras #3');
        expect(p.descricao).toBe('obstaculo do vale');
        expect(p.color).toBe('#123456');
        expect(p.lineWidth).toBe(6);
        expect(p.opacity).toBe(0.7);
        expect(p.layerId).toBe('camada-2');
        expect(p.id).toBe('bl-autentica');
        expect(depois.coordination_lines[0].geometry.type).toBe('MultiLineString');
        expect(depois.coordination_lines[0].id).toBe(1700000000099);
    });

    it('a feicao sem o par de tamanho ganha o PADRAO da ferramenta nova, nunca um zero', () => {
        const p = ensureCoordinationLines({ barrier_lines: [forjadaB2(1)] }).coordination_lines[0].properties;

        expect(p.symbol_size).toBe(0.5);
        expect(p.symbol_spacing).toBe(1.5);
        expect(p.createdAtZoom).toBe(0);
        expect(p.zoomCorrectionEnabled).toBe(true);
    });

    it('`properties.type` legado acompanha o `source`', () => {
        const f = forjadaB2(1);
        f.properties.type = 'barrier_line';
        const p = ensureCoordinationLines({ barrier_lines: [f] }).coordination_lines[0].properties;

        expect(p.type).toBe('coordination_line');
    });

    it('e IDEMPOTENTE: a segunda passada nao acha mais nada', () => {
        const uma = ensureCoordinationLines({ points: [], barrier_lines: [forjadaB2(1), forjadaB2(2)] });
        expect(ensureCoordinationLines(uma)).toBeNull();
        expect(uma.coordination_lines).toHaveLength(2);
    });

    it('linha de coordenacao JA existente nao e tocada, e a legada entra depois dela', () => {
        const existente = {
            type: 'Feature',
            properties: { id: 'cl-1', source: 'coordination_line', symbol_code: '290307' },
            geometry: null,
        };
        const depois = ensureCoordinationLines({ coordination_lines: [existente], barrier_lines: [forjadaB2(7)] });

        expect(depois.coordination_lines).toHaveLength(2);
        expect(depois.coordination_lines[0]).toBe(existente);
        expect(depois.coordination_lines[0].properties.symbol_code).toBe('290307');
        expect(depois.coordination_lines[1].properties.id).toBe('b-7');
    });

    it('o balde velho VAZIO some sem inventar feicao nenhuma', () => {
        // E o que o `05-completo-2.2.ebgeo` de verdade traz: o balde existe e esta vazio.
        const depois = ensureCoordinationLines({ points: [], barrier_lines: [], coordination_lines: [] });

        expect(depois).not.toBeNull();
        expect('barrier_lines' in depois).toBe(false);
        expect(depois.coordination_lines).toEqual([]);
    });

    it('PIOR CASO: balde velho degenerado nao lanca e nao contamina o novo', () => {
        const degenerados = [
            ['balde nao e array', { barrier_lines: 'nao sou array' }],
            ['balde nulo', { barrier_lines: null }],
            ['balde com membro nulo', { barrier_lines: [null, undefined] }],
            ['balde com membro que nao e objeto', { barrier_lines: ['lixo', 42] }],
            ['membro sem properties', { barrier_lines: [{ type: 'Feature', geometry: null }] }],
        ];

        for (const [nome, features] of degenerados) {
            expect(() => ensureCoordinationLines(features), nome).not.toThrow();
            const resultado = ensureCoordinationLines(features);
            expect(resultado, nome).not.toBeNull();
            expect('barrier_lines' in resultado, nome).toBe(false);
            expect(Array.isArray(resultado.coordination_lines), nome).toBe(true);
            for (const feicao of resultado.coordination_lines) {
                expect(feicao?.properties?.source, nome).toBe('coordination_line');
            }
        }
    });

    it('o mapa sem balde velho nenhum continua devolvendo null', () => {
        // O caso comum, e o que impede uma escrita por mapa em todo atlas do usuario.
        expect(ensureCoordinationLines({ points: [], coordination_lines: [] })).toBeNull();
    });
});

// ============================================================================
// A COPIA DO CATALOGO
// ============================================================================

/**
 * A migracao guarda `'290199'` e o par de tamanho por COPIA, nao por import: ela roda no boot,
 * e importar `military_tools/` de dentro do modulo de migracao arrastaria a pasta da
 * ferramenta para o pedaco do boot. Copia sem guarda envelhece calada, entao a guarda e este
 * bloco, que le as duas pontas e as compara.
 */
describe('a copia de `290199` e dos padroes bate com a fonte', () => {
    const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const migracao = readFileSync(
        join(RAIZ, 'src', 'js', 'store', 'migration', 'v2.2-to-v2.3.migration.js'), 'utf8');
    const controle = readFileSync(
        join(RAIZ, 'src', 'js', 'military_tools', 'coordination_line_tool',
            'add_coordination_line_control.js'), 'utf8');

    const valorNoBloco = (texto, marcador, chave) => {
        const bloco = texto.slice(texto.indexOf(marcador));
        const achado = bloco.match(new RegExp(`\\b${chave}:\\s*([^,\\n]+)`));
        return achado ? achado[1].trim() : null;
    };

    it('`290199` e mesmo a Linha de barreiras do MD33, e o padrao da ferramenta nova', () => {
        expect(LINEAR_SYMBOLS['290199'].name).toBe('Linha de barreiras');
        expect(LINEAR_SYMBOLS['290199'].glyph).toBe('diamond');
        expect(DEFAULT_SYMBOL_CODE).toBe('290199');
        expect(valorNoBloco(migracao, 'COORDINATION_LINE_FALLBACKS', 'symbol_code')).toBe("'290199'");
    });

    it('o par de tamanho e a ancora copiados sao os do `DEFAULT_PROPERTIES` da ferramenta', () => {
        for (const chave of ['symbol_size', 'symbol_spacing', 'createdAtZoom', 'zoomCorrectionEnabled']) {
            expect(valorNoBloco(migracao, 'COORDINATION_LINE_FALLBACKS', chave), chave)
                .toBe(valorNoBloco(controle, 'static DEFAULT_PROPERTIES', chave));
        }
    });

    it('o caminhador do bloco acima nao aprova por vacuo', () => {
        // Uma regex que nao casa devolveria null dos dois lados e o teste acima passaria
        // comparando nada com nada.
        expect(valorNoBloco(migracao, 'COORDINATION_LINE_FALLBACKS', 'symbol_size')).toBe('0.5');
        expect(valorNoBloco(controle, 'static DEFAULT_PROPERTIES', 'symbol_size')).toBe('0.5');
        expect(valorNoBloco(migracao, 'COORDINATION_LINE_FALLBACKS', 'chave_que_nao_existe')).toBeNull();
    });
});
