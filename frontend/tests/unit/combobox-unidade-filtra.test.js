// Path: tests/unit/combobox-unidade-filtra.test.js

/**
 * @fileoverview O FILTRO DO COMBOBOX DE UNIDADE, que é a metade do controle onde erro não aparece
 * na tela: uma lista mal filtrada não quebra nada, só responde "Nenhuma unidade encontrada" a um
 * termo certo, e quem digitou conclui que a própria OM não está cadastrada.
 *
 * O que este arquivo prende, e por que cada um custa:
 *
 * - ACENTO NOS DOIS SENTIDOS. Nome de OM em pt-BR é acentuado e teclado com pressa não é. Se a
 *   dobra NFD sair, "servico" para de achar "Serviço" e o campo fica inútil para metade do acervo.
 * - CARACTERE DE REGEX NO TERMO. "(", "*", "[" e "+" são caracteres comuns num nome de unidade e
 *   chegam do teclado. Um filtro escrito com `new RegExp(termo)` LANÇA em "(" e casa errado em
 *   "*": o teste passa os quatro e exige lista bem formada.
 * - TERMO VAZIO NÃO É "NADA CASA", É "SEM FILTRO". É o que faz a lista abrir inteira ao clicar, e
 *   inverter isso deixa o combobox sem estado inicial.
 * - A ORDEM DO CHAMADOR SOBREVIVE dentro de cada posto. As OM vêm do servidor ordenadas por nome,
 *   e um `sort` instável (ou um sort por rótulo) desfaz isso em silêncio.
 * - ITEM SEM `value` SAI. Escolhê-lo submeteria vazio, que é a única falha desta tela que chega
 *   ao servidor.
 *
 * O QUE ELE NÃO PRENDE: desenho, teclado e ARIA, que são do componente DOM ao lado e não deste
 * módulo. Um filtro perfeito numa lista que não abre passa verde aqui.
 */

import { describe, it, expect } from 'vitest';
import {
    normalizarBusca,
    filtrarOpcoes,
    MatchRank,
} from '@ui/searchable-select.model.js';

/** A amostra tem as três formas que a lista real tem: acento, sigla e sigla ausente. */
const UNIDADES = Object.freeze([
    { value: 'a', label: 'Diretoria de Serviço Geográfico', sigla: 'DSG' },
    { value: 'b', label: '1º Centro de Geoinformação', sigla: '1º CGEO' },
    { value: 'c', label: '5º Centro de Geoinformação', sigla: '5º CGEO' },
    { value: 'd', label: 'Comando Militar do Sul', sigla: null },
    { value: 'e', label: 'Departamento de Ciência e Tecnologia', sigla: 'DCT' },
]);

/** Os ids devolvidos, na ordem. @param {Array} lista */
const ids = (lista) => lista.map((item) => item.value);

describe('normalizarBusca', () => {
    it('dobra acento, caixa e espaço repetido', () => {
        expect(normalizarBusca('  Serviço   Geográfico ')).toBe('servico geografico');
        expect(normalizarBusca('ÁÉÍÓÚÂÊÔÃÕÇ')).toBe('aeiouaeoaoc');
    });

    it('o que não é texto dobra para vazio, em vez de lançar', () => {
        // Roda a cada tecla e sobre dado do servidor: um `null` de coluna nullable não pode
        // derrubar o campo inteiro.
        for (const entrada of [null, undefined, 42, {}, [], NaN]) {
            expect(normalizarBusca(entrada), String(entrada)).toBe('');
        }
    });

    it('dobra o ORDINAL nos dois lados, em todas as grafias de teclado', () => {
        // Nome de OM começa por ordinal, então ele é o primeiro caractere digitado, e cada teclado
        // o escreve de um jeito. As cinco grafias dobram para a MESMA string; preservar o "º" (o que
        // este caso afirmava antes) fazia "1o cgeo" não achar o 1º CGEO.
        for (const grafia of ['1º CGEO', '1° CGEO', '1o CGEO', '1O cgeo', '1 CGEO']) {
            expect(normalizarBusca(grafia), grafia).toBe('1 cgeo');
        }
        expect(normalizarBusca('2ª Cia')).toBe(normalizarBusca('2a cia'));
        // Só o ordinal: a letra depois de dígito que NÃO fecha palavra fica ("3oficial" não é "3º").
        expect(normalizarBusca('B2a1 Oeste')).toBe('b2a1 oeste');
        expect(normalizarBusca('(Ex) Cia*')).toBe('(ex) cia*');
    });

    it('o filtro acha a unidade por qualquer grafia do ordinal', () => {
        for (const termo of ['1o cgeo', '1° cgeo', '1 cgeo', '1º centro', '1o centro de geo']) {
            expect(ids(filtrarOpcoes(UNIDADES, termo)), termo).toEqual(['b']);
        }
        expect(ids(filtrarOpcoes(UNIDADES, '5o'))).toEqual(['c']);
    });
});

describe('filtrarOpcoes: o termo vazio é ausência de filtro', () => {
    it('sem termo, a lista inteira na ordem do chamador', () => {
        expect(ids(filtrarOpcoes(UNIDADES, ''))).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    it('só espaços também é sem filtro', () => {
        expect(ids(filtrarOpcoes(UNIDADES, '   '))).toEqual(['a', 'b', 'c', 'd', 'e']);
        expect(ids(filtrarOpcoes(UNIDADES, null))).toEqual(['a', 'b', 'c', 'd', 'e']);
        expect(ids(filtrarOpcoes(UNIDADES, undefined))).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    it('não devolve o mesmo array, e não mexe no de entrada', () => {
        const saida = filtrarOpcoes(UNIDADES, '');
        expect(saida).not.toBe(UNIDADES);
        saida.push({ value: 'z', label: 'intruso' });
        expect(UNIDADES).toHaveLength(5);
    });
});

describe('filtrarOpcoes: acento e caixa não separam ninguém', () => {
    it('sem acento acha com acento', () => {
        expect(ids(filtrarOpcoes(UNIDADES, 'servico'))).toEqual(['a']);
        expect(ids(filtrarOpcoes(UNIDADES, 'geoinformacao'))).toEqual(['b', 'c']);
    });

    it('com acento acha sem acento no termo, e a caixa é indiferente', () => {
        expect(ids(filtrarOpcoes(UNIDADES, 'SERVIÇO'))).toEqual(['a']);
        expect(ids(filtrarOpcoes(UNIDADES, 'ciência'))).toEqual(['e']);
        expect(ids(filtrarOpcoes(UNIDADES, 'CIENCIA'))).toEqual(['e']);
    });

    it('a sigla casa sozinha, em qualquer caixa', () => {
        expect(ids(filtrarOpcoes(UNIDADES, 'dsg'))).toEqual(['a']);
        expect(ids(filtrarOpcoes(UNIDADES, 'DCT'))).toEqual(['e']);
        expect(ids(filtrarOpcoes(UNIDADES, 'cgeo'))).toEqual(['b', 'c']);
    });

    it('sigla nula não impede o item de casar pelo nome', () => {
        expect(ids(filtrarOpcoes(UNIDADES, 'comando'))).toEqual(['d']);
    });
});

describe('filtrarOpcoes: o termo é texto, nunca um padrão', () => {
    it('caractere de regex não lança e casa literalmente', () => {
        const comSimbolos = [
            { value: 'p', label: 'Base (Antiga) do Norte', sigla: null },
            { value: 'q', label: 'Posto * Avançado', sigla: null },
            { value: 'r', label: 'Grupo [Alfa]', sigla: null },
            { value: 's', label: 'Batalhão A+B', sigla: null },
        ];
        expect(ids(filtrarOpcoes(comSimbolos, '('))).toEqual(['p']);
        expect(ids(filtrarOpcoes(comSimbolos, '*'))).toEqual(['q']);
        expect(ids(filtrarOpcoes(comSimbolos, '['))).toEqual(['r']);
        expect(ids(filtrarOpcoes(comSimbolos, 'a+b'))).toEqual(['s']);
        // Controle: como padrão, `.*` casaria os quatro. Como TEXTO, casa zero.
        expect(filtrarOpcoes(comSimbolos, '.*')).toEqual([]);
    });
});

describe('filtrarOpcoes: a ordem é posto, e dentro do posto é a do chamador', () => {
    it('prefixo de sigla vem antes de prefixo de nome, e ambos antes de contém', () => {
        const lista = [
            { value: 'nome-contem', label: 'Centro de Apoio ao Comando', sigla: null },
            { value: 'nome-prefixo', label: 'Comando de Operações', sigla: null },
            { value: 'sigla-contem', label: 'Escola de Instrução', sigla: 'XCOM' },
            { value: 'sigla-prefixo', label: 'Zona de Controle', sigla: 'COM-1' },
        ];
        expect(ids(filtrarOpcoes(lista, 'com')))
            .toEqual(['sigla-prefixo', 'nome-prefixo', 'sigla-contem', 'nome-contem']);
    });

    it('empate de posto mantém a ordem recebida, não a alfabética', () => {
        const lista = [
            { value: 'z', label: 'Zulu Geo', sigla: null },
            { value: 'a', label: 'Alfa Geo', sigla: null },
        ];
        expect(ids(filtrarOpcoes(lista, 'geo'))).toEqual(['z', 'a']);
    });

    it('os postos são quatro e estão declarados', () => {
        // Controle de vácuo do caso acima: se o vocabulário encolher, a asserção de ordem passa a
        // comparar menos coisa do que promete.
        expect(MatchRank.SIGLA_PREFIXO).toBeLessThan(MatchRank.NOME_PREFIXO);
        expect(MatchRank.NOME_PREFIXO).toBeLessThan(MatchRank.SIGLA_CONTEM);
        expect(MatchRank.SIGLA_CONTEM).toBeLessThan(MatchRank.NOME_CONTEM);
        expect(MatchRank.NOME_CONTEM).toBeLessThan(MatchRank.FORA);
    });
});

describe('filtrarOpcoes: as bordas da lista', () => {
    it('lista vazia e lista que não é lista devolvem vazio', () => {
        expect(filtrarOpcoes([], 'dsg')).toEqual([]);
        expect(filtrarOpcoes([], '')).toEqual([]);
        for (const entrada of [null, undefined, 'DSG', 42, {}]) {
            expect(filtrarOpcoes(entrada, 'dsg'), String(entrada)).toEqual([]);
        }
    });

    it('item sem value sai, com ou sem termo', () => {
        const suja = [
            { value: '', label: 'Sem id' },
            null,
            undefined,
            { label: 'Sem campo value' },
            { value: 'ok', label: 'Tem id' },
        ];
        expect(ids(filtrarOpcoes(suja, ''))).toEqual(['ok']);
        expect(ids(filtrarOpcoes(suja, 'sem'))).toEqual([]);
    });

    it('item sem label não derruba o filtro nem casa por engano', () => {
        const lista = [{ value: 'x' }, { value: 'y', label: 'Geo', sigla: 'G' }];
        expect(ids(filtrarOpcoes(lista, 'geo'))).toEqual(['y']);
        expect(ids(filtrarOpcoes(lista, ''))).toEqual(['x', 'y']);
    });

    it('termo que não casa nada devolve vazio, e não a lista inteira', () => {
        // A falha ABERTA desta função seria devolver tudo ao não achar nada: o estado vazio
        // deixaria de existir e a pessoa escolheria a primeira linha de uma lista não filtrada.
        expect(filtrarOpcoes(UNIDADES, 'marinha')).toEqual([]);
    });
});
