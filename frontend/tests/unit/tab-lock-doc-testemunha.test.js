// Path: tests/unit/tab-lock-doc-testemunha.test.js

/**
 * @fileoverview O `tab-lock.js` NÃO DECLARA ABERTO UM SÍTIO DESTRUTIVO QUE JÁ PASSA TESTEMUNHA.
 *
 * O DEFEITO, medido em 2026-08-24: o JSDoc de `acquireTabLock` e a seção 11 ("furos abertos")
 * diziam que o open de link público de `index.js` era o caminho que ainda pedia o lock SEM
 * testemunha. Era falso: `openPublicAtlasFromUrl` passa `witness: remoteMountWitness(atlas.id)`
 * desde que o quarto sítio destrutivo foi ligado, e o comentário no ponto da chamada diz isso por
 * extenso. O sítio que de fato pede sem testemunha é OUTRO,
 * `AccountControl.saveLocalToServer`.
 *
 * POR QUE ISSO É PIOR QUE UMA OMISSÃO, e é a razão de existir um teste para prosa: `tab-lock.js` é
 * carregado como leitura obrigatória por quem mexe em multiaba. Quem lê "este caminho ainda pede
 * sem testemunha" ou vai fechar um buraco que não existe, ou, na direção que destrói dado, vai
 * APAGAR a testemunha para alinhar o código à documentação. Uma doutrina que aponta o guarda
 * errado custa mais que uma que se cala.
 *
 * ============================ O QUE ESTE ARQUIVO PRENDE ==============================
 *
 * Três asserções, e a terceira é a única que é sobre prosa:
 *
 *   1. O FATO. `openPublicAtlasFromUrl` (`src/js/index.js`) passa `witness:` na sua chamada a
 *      `acquireTabLock`. Sem isto, corrigir a doc seria trocar uma mentira por outra.
 *   2. O CENSO. Todo sítio de chamada de `acquireTabLock` em `src/js`, derivado de `git ls-files`
 *      e não de uma lista escrita à mão, classificado em passa/não passa testemunha, comparado com
 *      um censo declarado aqui. Sítio novo reprova até ser classificado, e ligar a testemunha em
 *      `saveLocalToServer` também reprova, o que obriga a passar por este arquivo e pela doc.
 *   3. A PROSA CONTRA O FATO. Toda frase de comentário de `tab-lock.js` que AFIRME a ausência de
 *      testemunha é lida, e os módulos que ela nomeia têm de pertencer ao conjunto dos que
 *      realmente não passam testemunha. É isto que fica vermelho se alguém reescrever a frase
 *      antiga.
 *
 * ============================ O QUE ELE NÃO PRENDE ==================================
 *
 * A asserção 3 é LÉXICA, e vale dizer o tamanho dela em voz alta. Ela reconhece a afirmação por um
 * vocabulário declarado (`IDIOMAS_DE_AUSENCIA`) e o alvo por outro (`MODULOS`); uma frase que diga
 * a mesma falsidade com outras palavras ("o link público confia só no settle") passa verde, e uma
 * reescrita do arquivo em português passa verde. Ela não entende a frase, apenas casa duas listas
 * que estão escritas aqui, com o porquê. O que NÃO é frágil é a asserção 2, que não lê prosa
 * nenhuma: é ela que garante que o dia em que o código mudar alguém tenha de voltar aqui.
 *
 * E nenhuma delas prova que a testemunha FUNCIONE. `otherClientHoldsLock` tem prova própria em
 * `tests/unit/tab-lock-refutacao.test.js`; aqui só se mede quem a passa e o que a doc diz sobre
 * isso.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** O arquivo cru. @param {string} rel @returns {string} */
function ler(rel) {
    return readFileSync(resolve(FRONT, rel), 'utf8');
}

/** O código de um arquivo, sem comentário de bloco nem de linha. @param {string} rel */
function codigo(rel) {
    return ler(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * Todo arquivo `.js` de `src/js`, do versionamento. `--others` não é detalhe: sem ele a varredura
 * fica cega no arquivo escrito há cinco minutos e ainda não commitado.
 * @returns {string[]}
 */
function arquivosDeSrc() {
    const saida = execFileSync(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard', '*.js'],
        { cwd: resolve(FRONT, 'src/js'), encoding: 'utf8' }
    );
    return saida.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
        .map((rel) => `src/js/${rel.replace(/\\/g, '/')}`)
        .sort();
}

/**
 * Os argumentos de cada CHAMADA a `acquireTabLock` num texto, com os parênteses balanceados.
 * A definição e o reexport ficam de fora porque só se conta quem CHAMA.
 * @param {string} texto
 * @returns {string[]} O texto entre parênteses de cada chamada.
 */
function chamadasDeAcquire(texto) {
    const encontrados = [];
    const alvo = 'acquireTabLock(';
    for (let i = texto.indexOf(alvo); i !== -1; i = texto.indexOf(alvo, i + 1)) {
        const antes = texto.slice(Math.max(0, i - 20), i);
        // `export function acquireTabLock(` é a definição, não uma chamada.
        if (/function\s+$/.test(antes)) continue;
        let profundidade = 0;
        let fim = i + alvo.length - 1;
        for (; fim < texto.length; fim += 1) {
            if (texto[fim] === '(') {
                profundidade += 1;
            } else if (texto[fim] === ')') {
                profundidade -= 1;
                if (profundidade === 0) break;
            }
        }
        encontrados.push(texto.slice(i + alvo.length, fim));
    }
    return encontrados;
}

/**
 * O CENSO DECLARADO: por arquivo, quantas chamadas a `acquireTabLock` ele faz e se TODAS passam
 * testemunha. Mudar qualquer uma das duas coisas exige editar esta tabela, que é o ponto.
 */
const CENSO = Object.freeze({
    // `openPublicAtlasFromUrl`: o quarto sítio destrutivo, ligado em 2026-08-16.
    'src/js/index.js': { chamadas: 1, comTestemunha: 1 },
    // `claimRemoteAtlas` e `clearMountedAtlasIfGranted`: os dois que a frente original ligou.
    'src/js/account/open-atlas.service.js': { chamadas: 2, comTestemunha: 2 },
    // `AccountControl.saveLocalToServer`: O FURO VIVO. Ele reivindica e apaga poucas linhas
    // abaixo, sem testemunha. É estreito (o atlas foi criado uma linha antes, então nenhuma outra
    // aba pode segurá-lo), e por isso está declarado aqui e na seção 11 em vez de ser corrigido de
    // passagem: fechá-lo é mudança de comportamento num caminho de concorrência, com repro
    // próprio. Ao fechá-lo, mude este número E a seção 11 de `tab-lock.js`.
    'src/js/account/account.control.js': { chamadas: 1, comTestemunha: 0 },
});

/** Os módulos que a prosa pode nomear, e o arquivo de cada um. */
const MODULOS = Object.freeze({
    'openPublicAtlasFromUrl': 'src/js/index.js',
    'index.js': 'src/js/index.js',
    'open-atlas.service.js': 'src/js/account/open-atlas.service.js',
    'claimRemoteAtlas': 'src/js/account/open-atlas.service.js',
    'clearMountedAtlasIfGranted': 'src/js/account/open-atlas.service.js',
    'account.control.js': 'src/js/account/account.control.js',
    'saveLocalToServer': 'src/js/account/account.control.js',
});

/**
 * As formas em que este arquivo AFIRMA que alguém pede sem testemunha. Lista declarada, e o
 * alcance da asserção 3 é exatamente ela.
 */
const IDIOMAS_DE_AUSENCIA = [
    /\bwithout (a |the |any )?witness\b/i,
    /\bwithout it\b/i,
    /\bomits the `?witness`?\b/i,
    /\bsem testemunha\b/i,
];

describe('tab-lock: a doc não acusa de aberto um sítio que já passa testemunha', () => {
    it('FATO: o open de link público passa a testemunha', () => {
        const fonte = codigo('src/js/index.js');
        const inicio = fonte.indexOf('async function openPublicAtlasFromUrl');
        expect(inicio, 'a função existe').toBeGreaterThan(-1);
        const corpo = fonte.slice(inicio, fonte.indexOf('\nasync function ', inicio + 1) + 1
            || fonte.length);

        const chamadas = chamadasDeAcquire(corpo);
        expect(chamadas, 'ela reivindica o lock').toHaveLength(1);
        expect(chamadas[0]).toMatch(/witness\s*:/);
        // Controle da própria varredura: uma chamada sem testemunha teria de falhar aqui, e é o
        // que o `toMatch` acima faz. A asserção de forma abaixo impede que um `witness` qualquer
        // (um `null` literal, por exemplo) conte como testemunha.
        expect(chamadas[0]).toMatch(/witness\s*:\s*remoteMountWitness\(/);
    });

    it('CENSO: os sítios de chamada e quem passa testemunha são os declarados', () => {
        const medido = {};
        for (const rel of arquivosDeSrc()) {
            if (rel === 'src/js/utilities/tab-lock.js') continue;
            const chamadas = chamadasDeAcquire(codigo(rel));
            if (chamadas.length === 0) continue;
            medido[rel] = {
                chamadas: chamadas.length,
                comTestemunha: chamadas.filter((args) => /witness\s*:/.test(args)).length,
            };
        }
        expect(medido).toEqual(CENSO);
        // Discriminação: a tabela não pode ser um censo vazio nem um censo só de aprovados.
        const semTestemunha = Object.values(CENSO)
            .reduce((n, e) => n + (e.chamadas - e.comTestemunha), 0);
        expect(Object.keys(CENSO).length).toBeGreaterThan(1);
        expect(semTestemunha, 'há exatamente um furo vivo declarado').toBe(1);
    });

    it('PROSA: nenhuma frase de ausência nomeia um sítio que passa testemunha', () => {
        const comTestemunha = new Set(
            Object.entries(CENSO).filter(([, e]) => e.comTestemunha > 0).map(([rel]) => rel)
        );
        const semTestemunha = new Set(
            Object.entries(CENSO)
                .filter(([, e]) => e.comTestemunha < e.chamadas).map(([rel]) => rel)
        );

        // Só os comentários: o código do arquivo não afirma nada sobre outros módulos.
        const bruto = ler('src/js/utilities/tab-lock.js');
        const comentarios = [
            ...(bruto.match(/\/\*[\s\S]*?\*\//g) ?? []),
            ...(bruto.match(/^[ \t]*\/\/.*$/gm) ?? []),
        ].join('\n')
            .replace(/^[ \t]*(\*|\/\/)[ \t]?/gm, '')
            .replace(/\s+/g, ' ');

        const frases = comentarios.split(/(?<=[.;:])\s+/);
        const acusacoes = frases.filter((f) => IDIOMAS_DE_AUSENCIA.some((re) => re.test(f)));

        // COBERTURA VAZIA SERIA VERDE. Se nenhuma frase casar, a asserção seguinte não prova
        // nada, então o vocabulário tem de estar achando alguma coisa: o furo declarado de
        // `saveLocalToServer` está escrito lá, e é ele que sustenta este número.
        expect(acusacoes.length, 'o vocabulário de ausência acha frase no arquivo')
            .toBeGreaterThan(0);

        for (const frase of acusacoes) {
            for (const [termo, rel] of Object.entries(MODULOS)) {
                if (!frase.includes(termo)) continue;
                expect(
                    comTestemunha.has(rel) && !semTestemunha.has(rel),
                    `frase acusa de pedir sem testemunha um sítio que passa uma (${rel}): "${frase}"`
                ).toBe(false);
            }
        }

        // E o sítio que REALMENTE não passa tem de estar nomeado em alguma dessas frases: uma doc
        // que só apagasse a mentira, sem dizer a verdade, deixaria o furo vivo sem endereço.
        const nomeados = new Set(
            acusacoes.flatMap((f) => Object.entries(MODULOS)
                .filter(([termo]) => f.includes(termo)).map(([, rel]) => rel))
        );
        for (const rel of semTestemunha) {
            expect(nomeados, `o furo vivo em ${rel} está nomeado na doc`).toContain(rel);
        }
    });
});
