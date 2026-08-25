// Path: tests/unit/engagement-bar-codec.test.js

/**
 * @fileoverview A BARRA DE ENGAJAMENTO É UMA STRING QUE CARREGA TRÊS CAMPOS, e o que importa aqui
 * não é cada metade: é que as duas sejam INVERSAS.
 *
 * O `TESTING-BACKLOG` listou este par por meses com a nota "extrair; nomes sugeridos, ainda não
 * existem". Até 2026-08-25 as duas metades eram closures dentro de `createEngagementBarContent`
 * (`engagement-bar.section.js`), cujo único export monta DOM: a codificação rodava num ouvinte de
 * `change` e a decodificação ficava pendurada no elemento devolvido. Escritas apart, lidas apart, e
 * o round-trip só exercitado por alguém clicando.
 *
 * ================= O QUE ESTA SUÍTE PRENDE ==================================
 *
 * O round-trip por fast-check sobre o vocabulário REAL das duas tabelas, mais os três lugares em
 * que o formato é ambíguo por construção e o comportamento tem de ser escolhido em vez de sofrido.
 *
 * ================= O QUE ELA NÃO ALCANÇA ====================================
 *
 * Nada de DOM: o ambiente é `node` e a seção que consome o codec continua sem suíte. O que garante
 * que a seção usa ESTE codec, e não uma cópia, é um caso estrutural no fim do arquivo, que lê a
 * fonte. Ele é léxico e cairia numa reescrita que preservasse a semântica com outra grafia.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    encodeEngagementBar,
    decodeEngagementBar,
} from '@js/military_tools/military_symbol_tool/attributes/engagement-bar-codec.js';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** O vocabulário real, tal como `getEngagementBarData` o serve. */
const ESTAGIOS = ['TGT', 'ENG', 'DET', 'DES', 'NEU', 'SUP'];
const ARMAMENTOS = ['ART', 'MOR', 'AV', 'MSL', 'CAV'];
const ehEstagio = (v) => ESTAGIOS.includes(v);

describe('encode: dobra os tres campos numa string so', () => {
    it('os dois campos juntam com hifen', () => {
        expect(encodeEngagementBar({ stage: 'TGT', weapon: 'ART' })).toBe('TGT-ART');
    });

    it('um campo sozinho sai SEM hifen, dos dois lados', () => {
        expect(encodeEngagementBar({ stage: 'TGT' })).toBe('TGT');
        expect(encodeEngagementBar({ weapon: 'ART' })).toBe('ART');
    });

    it('a designacao remota prefixa, e prefixa tambem o campo sozinho', () => {
        expect(encodeEngagementBar({ stage: 'TGT', weapon: 'ART', remote: true })).toBe('R:TGT-ART');
        expect(encodeEngagementBar({ weapon: 'ART', remote: true })).toBe('R:ART');
    });

    it('nenhum campo devolve `null`, e NUNCA a string vazia', () => {
        // A propriedade e lida como teste de veracidade a jusante: `''` seria uma barra que existe
        // e nao desenha nada.
        expect(encodeEngagementBar({})).toBeNull();
        expect(encodeEngagementBar()).toBeNull();
        expect(encodeEngagementBar({ stage: '', weapon: '', remote: true })).toBeNull();
    });

    it('entrada nao-string e tratada como ausente, e nao coagida', () => {
        expect(encodeEngagementBar({ stage: 0, weapon: null })).toBeNull();
        expect(encodeEngagementBar({ stage: 42, weapon: 'ART' })).toBe('ART');
    });
});

describe('decode: desdobra de volta, sempre com os tres campos', () => {
    it('devolve os tres, mesmo para entrada vazia', () => {
        expect(decodeEngagementBar('')).toEqual({ stage: '', weapon: '', remote: false });
        expect(decodeEngagementBar(null)).toEqual({ stage: '', weapon: '', remote: false });
        expect(decodeEngagementBar(undefined)).toEqual({ stage: '', weapon: '', remote: false });
        expect(decodeEngagementBar(42)).toEqual({ stage: '', weapon: '', remote: false });
    });

    it('o prefixo remoto sai, e o resto continua sendo lido', () => {
        expect(decodeEngagementBar('R:TGT-ART', { isStage: ehEstagio }))
            .toEqual({ stage: 'TGT', weapon: 'ART', remote: true });
    });

    it('so o prefixo, sem corpo, e remoto e vazio', () => {
        expect(decodeEngagementBar('R:')).toEqual({ stage: '', weapon: '', remote: true });
    });

    it('o valor SOZINHO e resolvido pelo catalogo, nao pela forma', () => {
        expect(decodeEngagementBar('TGT', { isStage: ehEstagio }))
            .toEqual({ stage: 'TGT', weapon: '', remote: false });
        expect(decodeEngagementBar('ART', { isStage: ehEstagio }))
            .toEqual({ stage: '', weapon: 'ART', remote: false });
    });

    it('SEM o catalogo, o valor sozinho cai em ARMAMENTO', () => {
        // E o que a implementacao inline fazia quando a tabela de estagios nao conhecia o valor.
        expect(decodeEngagementBar('TGT')).toEqual({ stage: '', weapon: 'TGT', remote: false });
    });

    it('um `isStage` que nao seja funcao, ou que devolva lixo, nao promove a estagio', () => {
        expect(decodeEngagementBar('TGT', { isStage: 'sim' }).stage).toBe('');
        expect(decodeEngagementBar('TGT', { isStage: () => 'sim' }).stage).toBe('');
        expect(decodeEngagementBar('TGT', { isStage: () => 1 }).stage).toBe('');
    });
});

describe('a ambiguidade do formato, escolhida em vez de sofrida', () => {
    it('CONSERTADO: um armamento COM HIFEN sobrevive a volta', () => {
        // ANTES: `split('-')` pegava as duas primeiras partes e descartava o resto em silencio,
        // entao `TGT-A-B` decodificava para `TGT` + `A`, perdendo `-B`. Agora o corte e o PRIMEIRO,
        // e o armamento fica com os hifens dele.
        expect(decodeEngagementBar('TGT-A-B', { isStage: ehEstagio }))
            .toEqual({ stage: 'TGT', weapon: 'A-B', remote: false });
        expect(encodeEngagementBar({ stage: 'TGT', weapon: 'A-B' })).toBe('TGT-A-B');
    });

    it('OBSERVADO: um ESTAGIO com hifen nao sobrevive, e nao ha como faze-lo sobreviver', () => {
        // O corte e sempre o primeiro hifen, entao a parte do estagio nao pode conter um. Isto e
        // propriedade do FORMATO, nao deste codigo: consertar exigiria um escape que os dados ja
        // persistidos nao tem. Nenhum estagio do catalogo carrega hifen.
        expect(decodeEngagementBar('A-B-ART').stage).toBe('A');
        expect(ESTAGIOS.every((e) => !e.includes('-'))).toBe(true);
    });

    it('OBSERVADO: um valor que COMECE com `R:` e indistinguivel do prefixo', () => {
        expect(decodeEngagementBar('R:X', { isStage: ehEstagio }))
            .toEqual({ stage: '', weapon: 'X', remote: true });
        // Inalcancavel pelos dois catalogos de hoje, que e o que torna isto observacao e nao defeito.
        expect([...ESTAGIOS, ...ARMAMENTOS].some((v) => v.startsWith('R:'))).toBe(false);
    });
});

describe('round-trip: as duas metades sao inversas sobre o vocabulario real', () => {
    it('propriedade: encode seguido de decode devolve o que entrou', () => {
        fc.assert(fc.property(
            fc.constantFrom('', ...ESTAGIOS),
            fc.constantFrom('', ...ARMAMENTOS),
            fc.boolean(),
            (stage, weapon, remote) => {
                const s = encodeEngagementBar({ stage, weapon, remote });
                const volta = decodeEngagementBar(s, { isStage: ehEstagio });
                if (!stage && !weapon) {
                    // Sem campo nenhum a barra nao existe, e `remote` nao tem o que carregar.
                    return s === null && volta.stage === '' && volta.weapon === '' && !volta.remote;
                }
                return volta.stage === stage && volta.weapon === weapon && volta.remote === remote;
            },
        ), { numRuns: 500 });
    });

    it('propriedade: decode seguido de encode devolve a MESMA string', () => {
        const todas = [];
        for (const e of ['', ...ESTAGIOS]) {
            for (const a of ['', ...ARMAMENTOS]) {
                for (const r of [false, true]) {
                    const s = encodeEngagementBar({ stage: e, weapon: a, remote: r });
                    if (s !== null) todas.push(s);
                }
            }
        }
        // O tamanho e asserido: um laco sobre colecao vazia passaria verde sem verificar nada.
        // 7 estagios (com o vazio) x 6 armamentos (com o vazio) x 2 remotos = 84, menos os DOIS
        // em que os dois campos sao vazios, que devolvem `null` e nao entram na lista.
        expect(todas.length).toBe(82);
        for (const s of todas) {
            const { stage, weapon, remote } = decodeEngagementBar(s, { isStage: ehEstagio });
            expect(encodeEngagementBar({ stage, weapon, remote }), s).toBe(s);
        }
    });
});

describe('estrutural: a secao consome o codec, e nao uma copia', () => {
    const SECAO = readFileSync(
        resolve(FRONT, 'src/js/military_tools/military_symbol_tool/attributes/engagement-bar.section.js'),
        'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    it('ela IMPORTA as duas metades e as CHAMA', () => {
        expect(SECAO).toMatch(/import \{ encodeEngagementBar, decodeEngagementBar \}/);
        expect(SECAO).toMatch(/encodeEngagementBar\(\{/);
        expect(SECAO).toMatch(/decodeEngagementBar\(/);
    });

    it('e NAO carrega mais o formato dentro dela', () => {
        // Estes tres literais eram o formato inline. Se voltarem, a copia voltou.
        expect(SECAO).not.toContain("startsWith('R:')");
        expect(SECAO).not.toContain("split('-')");
        expect(SECAO).not.toMatch(/\$\{prefix\}\$\{text\}/);
    });

    it('CONTROLE: o varredor le codigo, nao a prosa que o explica', () => {
        // Esta frase aparece so nos comentarios da secao.
        expect(SECAO).not.toContain('escritas apart');
    });
});
