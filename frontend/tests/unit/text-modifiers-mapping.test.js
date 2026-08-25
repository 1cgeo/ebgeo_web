// Path: tests/unit/text-modifiers-mapping.test.js

/**
 * @fileoverview O ÚLTIMO PASSO ANTES DE UMA BIBLIOTECA DE TERCEIRO DESENHAR O SÍMBOLO.
 *
 * `extractTextModifiers` traduz as propriedades da feição para os nomes de campo do
 * `milsymbol.js`. Até 2026-08-25 ela era `function` sem `export` dentro de
 * `military_symbol_generator.js`, cujo grafo de módulos puxa o carregador do milsymbol e a
 * conversão para PNG por canvas: inalcançável em node, e por isso listada no `TESTING-BACKLOG` com
 * a nota "(exportar)". A extração foi para um módulo folha de zero imports.
 *
 * ================= O QUE ESTA SUÍTE PRENDE, E POR QUÊ =======================
 *
 * Os catorze campos diretos não são a parte interessante. O que ela prende é o que morde:
 *
 *  1. **O filtro admite ZERO.** É `!== null && !== undefined && !== ''`, e não `if (value)`. Uma
 *     `quantity` de 0 e um `altitudeDepth` de 0 são valores que alguém digitou. Este repositório
 *     passou 2026-08-24 achando exatamente esse defeito em NOVE outros domínios; aqui a forma já
 *     estava certa, e o caso existe para que uma "simplificação" futura não a troque em silêncio.
 *  2. **Os DOIS renomeados**, e só eles: `dateTimeGroup` vira `dtg`, `credibility` vira
 *     `evaluationRating` (o campo combinado J+K do milsymbol).
 *  3. **A assimetria entre os dois grupos**, que é real e foi olhada: o ramo dos renomeados usa
 *     guarda de veracidade e DESCARTA o zero. Inócuo hoje (os dois carregam texto), e fixado para
 *     que a diferença seja deliberada em vez de descoberta.
 *
 * ================= O QUE ELA NÃO ALCANÇA ====================================
 *
 * Nada sobre o DESENHO. Que o milsymbol aceite estes nomes é premissa sobre a biblioteca, não algo
 * que esta suíte possa provar; o que ela prova é que nós emitimos os nomes que dissemos que
 * emitiríamos. O elo com o gerador é preso por leitura de fonte, que é léxica.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    extractTextModifiers,
    DIRECT_TEXT_MODIFIER_FIELDS,
    RENAMED_TEXT_MODIFIER_FIELDS,
} from '@js/military_tools/military_symbol_tool/text-modifiers-mapping.js';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('a lista de campos diretos e contrato', () => {
    it('sao CATORZE, congelados, e sem repetido', () => {
        // A contagem e o membro sao o contrato: um campo novo no modal que nao chegue aqui
        // simplesmente NAO DESENHA, sem erro em lugar nenhum.
        expect(DIRECT_TEXT_MODIFIER_FIELDS).toHaveLength(14);
        expect(Object.isFrozen(DIRECT_TEXT_MODIFIER_FIELDS)).toBe(true);
        expect(new Set(DIRECT_TEXT_MODIFIER_FIELDS).size).toBe(14);
    });

    it('os renomeados sao DOIS, e nao colidem com nenhum direto', () => {
        const renomeados = Object.keys(RENAMED_TEXT_MODIFIER_FIELDS);
        expect(renomeados).toEqual(['dateTimeGroup', 'credibility']);
        expect(Object.isFrozen(RENAMED_TEXT_MODIFIER_FIELDS)).toBe(true);
        for (const nosso of renomeados) {
            expect(DIRECT_TEXT_MODIFIER_FIELDS).not.toContain(nosso);
        }
        // E o nome de destino tambem nao pode colidir, senao o renomeado sobrescreveria o direto.
        for (const deles of Object.values(RENAMED_TEXT_MODIFIER_FIELDS)) {
            expect(DIRECT_TEXT_MODIFIER_FIELDS).not.toContain(deles);
        }
    });
});

describe('o que passa e o que fica de fora', () => {
    it('todo campo direto presente atravessa com o proprio nome', () => {
        const props = Object.fromEntries(DIRECT_TEXT_MODIFIER_FIELDS.map((f) => [f, `v-${f}`]));
        const out = extractTextModifiers(props);
        expect(Object.keys(out)).toHaveLength(14);
        for (const f of DIRECT_TEXT_MODIFIER_FIELDS) expect(out[f]).toBe(`v-${f}`);
    });

    it('ausente, nulo e string vazia NAO entram, e a chave nem existe', () => {
        const out = extractTextModifiers({
            uniqueDesignation: '',
            higherFormation: null,
            quantity: undefined,
        });
        expect(out).toEqual({});
        // `toEqual({})` sozinho nao provaria a AUSENCIA da chave, so que ela nao tem valor util.
        expect('uniqueDesignation' in out).toBe(false);
    });

    it('O ZERO SOBREVIVE, e este e o caso que a suite existe para prender', () => {
        // `if (value)` derrubaria os tres. Uma quantidade de 0 e uma altitude de 0 sao valores.
        const out = extractTextModifiers({ quantity: 0, altitudeDepth: 0, speed: 0 });
        expect(out).toEqual({ quantity: 0, altitudeDepth: 0, speed: 0 });
    });

    it('`false` tambem sobrevive, pela mesma guarda', () => {
        expect(extractTextModifiers({ reinforcedReduced: false }))
            .toEqual({ reinforcedReduced: false });
    });

    it('propriedade fora da lista e IGNORADA, mesmo com valor', () => {
        const out = extractTextModifiers({ nome: 'Alfa', symbolSet: '10', naoExiste: 'x' });
        expect(out).toEqual({});
    });

    it('a cadeia de prototipo NAO entra na saida', () => {
        // A leitura e por chave conhecida, entao `toString` nunca e consultado; este caso fixa que
        // a saida e um objeto limpo, e nao um que herde metodos.
        const out = extractTextModifiers({ quantity: 1 });
        expect(Object.keys(out)).toEqual(['quantity']);
        expect(out.constructor).toBe(Object);
    });
});

describe('os dois renomeados', () => {
    it('`dateTimeGroup` sai como `dtg`, e o nome de origem NAO viaja', () => {
        const out = extractTextModifiers({ dateTimeGroup: '011200ZJAN26' });
        expect(out).toEqual({ dtg: '011200ZJAN26' });
        expect('dateTimeGroup' in out).toBe(false);
    });

    it('`credibility` sai como `evaluationRating`, o campo combinado J+K', () => {
        const out = extractTextModifiers({ credibility: 'A1' });
        expect(out).toEqual({ evaluationRating: 'A1' });
        expect('credibility' in out).toBe(false);
    });

    it('OBSERVADO: os renomeados DESCARTAM o zero, ao contrario dos diretos', () => {
        // Assimetria real, olhada e mantida: a guarda deles e de veracidade. Inocua hoje, porque
        // os dois carregam texto (um DTG, uma letra de credibilidade). Mudar seria alterar
        // comportamento sem defeito atras, e o CONTROLE ao lado mostra que o ramo funciona.
        expect(extractTextModifiers({ dateTimeGroup: 0, credibility: 0 })).toEqual({});
        expect(extractTextModifiers({ dateTimeGroup: '0' })).toEqual({ dtg: '0' });
    });
});

describe('entrada degenerada nao derruba o desenho', () => {
    it('propriedades ausentes ou nao-objeto devolvem vazio, sem lancar', () => {
        for (const entrada of [null, undefined, 42, 'texto', true]) {
            expect(() => extractTextModifiers(entrada)).not.toThrow();
            expect(extractTextModifiers(entrada)).toEqual({});
        }
    });

    it('um array e objeto, entao nao lanca, e simplesmente nao casa nenhum campo', () => {
        expect(extractTextModifiers([])).toEqual({});
    });
});

describe('estrutural: o gerador consome o modulo, e nao uma copia', () => {
    const GERADOR = readFileSync(
        resolve(FRONT, 'src/js/military_tools/military_symbol_tool/military_symbol_generator.js'),
        'utf8',
    );
    const FOLHA = readFileSync(
        resolve(FRONT, 'src/js/military_tools/military_symbol_tool/text-modifiers-mapping.js'),
        'utf8',
    );

    it('o gerador IMPORTA e CHAMA, e nao define mais a funcao', () => {
        expect(GERADOR).toMatch(/import \{ extractTextModifiers \} from '\.\/text-modifiers-mapping\.js'/);
        expect(GERADOR).toMatch(/extractTextModifiers\(properties\)/);
        expect(GERADOR).not.toMatch(/function extractTextModifiers/);
        // O literal do renomeado era so dele; se voltar, a copia voltou.
        expect(GERADOR).not.toContain('evaluationRating');
    });

    it('a folha tem ZERO imports, que e o que a mantem carregavel em node puro', () => {
        const codigo = FOLHA.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        expect(codigo).not.toMatch(/^\s*import\s/m);
        expect(codigo).not.toMatch(/\brequire\(/);
    });
});
