// Path: tests/unit/record-operation-sem-literal.test.js
//
// O CENSO DO VOCABULÁRIO DE OPERAÇÃO, e a razão de ele ser MECÂNICO.
//
// Até 2026-09-13 doze sítios passavam string solta onde o vocabulário tem constante:
// `tx.recordOperation('feature', ...)` em oito lugares de `feature.operations.js`,
// `'mapNotes'` e `'gridStyle'` em `settings.operations.js`, `'mapTemporal'` em
// `temporal.operations.js`, `'layer'` em `layer-transfer.operations.js` e
// `logMapOperation('update', ...)` em `locking/map-lock.controller.js`. Nenhuma regra de
// lint os pegava, e nada os distinguia de um erro de digitação.
//
// ================= POR QUE ISSO É UM DEFEITO, E NÃO ESTILO ====================
//
// `EntityType` e `OperationType` (`src/js/store/sync/operation-types.js`) são o CONTRATO
// com o servidor: o valor viaja no envelope e o backend despacha por ele. Uma string
// digitada à mão falha em silêncio nos dois sentidos. Errada, ela produz uma op de tipo
// que nenhum ramo de `applyOperation` reconhece, acked e sem efeito, que é exatamente a
// classe "acked, logged, wrote nothing" que o servidor tem comentário próprio para
// nomear. Certa hoje, ela não acompanha um renome do vocabulário amanhã: o enum muda, o
// literal fica, e nada fica vermelho. A constante falha na hora, em `undefined`, e o
// censo de `isValidEntityType` do envelope acusa.
//
// ================= O QUE ESTE ARQUIVO PROÍBE =================================
//
// DUAS FORMAS, as duas mecânicas:
//
//   1. `recordOperation(` (com ou sem receptor) cujo PRIMEIRO ou SEGUNDO argumento seja um
//      literal de string. O primeiro é o tipo de entidade, o segundo o tipo de operação, e
//      os dois têm enum.
//   2. `logXxxOperation(` cujo PRIMEIRO argumento seja `'create'`, `'update'` ou
//      `'delete'`. A família de logs por entidade (`logMapOperation`, `logLayerOperation`,
//      ...) já traz o tipo de ENTIDADE assado na fábrica, então o que sobra na posição um é
//      o tipo de OPERAÇÃO, e ele é `OperationType.X`.
//
// O que ele deliberadamente NÃO pega, dito para não ser lido como cobertura: o terceiro
// argumento em diante (id de entidade e de mapa são valores, não vocabulário), a string
// montada em variável (`const t = 'feature'; tx.recordOperation(t, ...)`), e
// `logOperation(` genérico, que recebe os dois tipos por parâmetro e é o ponto onde eles
// legitimamente trafegam como dado. Um censo comprado com zero falso positivo é o que
// impede que alguém o desligue; o preço é o falso negativo, e ele está escrito aqui.
//
// ================= A VARREDURA ================================================
//
// O inventário vem do VERSIONAMENTO (`git ls-files --cached --others --exclude-standard`
// sobre `src/js`), nunca de uma lista de alvos escrita à mão: "conferir um subconjunto e
// tratar como o conjunto" é a classe mais repetida de `docs/livro-razao.md`. As duas
// bandeiras não são detalhe: `git ls-files` puro enumera só o RASTREADO, e o guarda ficaria
// cego exatamente onde o trabalho novo aparece, no sítio escrito há cinco minutos.
//
// ================= FRAGILIDADES ACEITAS =======================================
//
// (a) O inventário precisa de `git`; se o comando falhar, o caso-piso diz isso nessas
//     palavras, porque falha de ambiente lida como regressão custa mais do que o guarda
//     economiza.
// (b) A remoção de comentário é textual, não é um parser: `//` dentro de string literal
//     seria removido junto. O efeito é perder um sítio, não inventar um.
// (c) O piso de contagem é MEDIDO, não uma folga. Uma varredura que deixasse de casar
//     qualquer coisa passaria os casos de violação verdes comparando vazio com vazio, que
//     é a definição de cobertura vazia. Se o número cair de propósito, baixe o piso com a
//     razão ao lado.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));

/** A fixture do controle negativo, fora de `src/js` e importada por ninguém. */
const FIXTURE = 'tests/fixtures/censo-record-operation/literais-de-operacao.js';

/** Pisos MEDIDOS em 2026-09-13, para que uma varredura muda não passe verde. */
const PISO_ARQUIVOS = 300;
const PISO_RECORD = 18;
const PISO_LOG = 45;

/**
 * Comentário fora, preservando a contagem de linhas para que a mensagem de erro aponte a
 * linha certa do arquivo real.
 * @param {string} src
 * @returns {string}
 */
function semComentarios(src) {
    const normalizado = src.replace(/\r\n?/g, '\n');
    const semBloco = normalizado.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    return semBloco.split('\n').map((linha) => linha.replace(/\/\/.*/, '')).join('\n');
}

const lerCodigo = (arquivo) => semComentarios(readFileSync(path.join(RAIZ, arquivo), 'utf8'));

/**
 * O INVENTÁRIO: rastreado MAIS não rastreado não ignorado.
 * @param {string} [pathspec] - Relativo a `frontend/`.
 * @returns {string[]} Caminhos relativos, só `.js`.
 */
function arquivosDoInventario(pathspec = 'src/js') {
    return execFileSync(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard', pathspec],
        { cwd: RAIZ, encoding: 'utf8' },
    ).split('\n').map((s) => s.trim()).filter((s) => s.endsWith('.js'));
}

/**
 * Os dois primeiros argumentos de uma chamada, a partir do índice logo DEPOIS do abre
 * parênteses. Um scanner de profundidade, e não uma regex, porque a chamada pode quebrar
 * em várias linhas e trazer objeto, array e chamada aninhada no meio (foi o caso real de
 * `layer-transfer.operations.js`, cuja chamada ocupa cinco linhas).
 * @param {string} src - Código já sem comentário.
 * @param {number} inicio - Índice do primeiro caractere após o `(`.
 * @returns {string[]} Os argumentos de topo, aparados, na ordem.
 */
function argumentosDeTopo(src, inicio) {
    const args = [];
    let atual = '';
    let profundidade = 0;
    let aspas = null;
    for (let i = inicio; i < src.length; i++) {
        const c = src[i];
        if (aspas) {
            atual += c;
            if (c === '\\') { atual += src[++i] ?? ''; continue; }
            if (c === aspas) aspas = null;
            continue;
        }
        if (c === "'" || c === '"' || c === '`') { aspas = c; atual += c; continue; }
        if ('([{'.includes(c)) { profundidade++; atual += c; continue; }
        if (')]}'.includes(c)) {
            if (c === ')' && profundidade === 0) { args.push(atual.trim()); return args; }
            profundidade--; atual += c; continue;
        }
        if (c === ',' && profundidade === 0) { args.push(atual.trim()); atual = ''; continue; }
        atual += c;
    }
    args.push(atual.trim());
    return args;
}

/** Um argumento que COMEÇA por aspas é literal de string. */
const ehLiteral = (arg) => typeof arg === 'string' && /^['"`]/.test(arg);

/** Toda chamada de `recordOperation`, com ou sem receptor. */
const RE_RECORD = /(?:\.\s*)?\brecordOperation\s*\(/g;

/** Toda chamada da família `logXxxOperation`, para o piso da varredura. */
const RE_LOG = /\blog[A-Za-z0-9]*Operation\s*\(/g;

/** O tipo de operação escrito como literal na primeira posição de um log de entidade. */
const RE_LOG_LITERAL = /\blog[A-Za-z0-9]*Operation\s*\(\s*(['"])(create|update|delete)\1/g;

/**
 * @param {string} src
 * @param {number} indice
 * @returns {number} Linha 1-based do índice.
 */
const linhaDe = (src, indice) => src.slice(0, indice).split('\n').length;

/**
 * @param {string[]} arquivos
 * @returns {{record: number, log: number, violacoes: string[]}} Contagens da varredura e
 *   as violações, já no formato de mensagem de erro.
 */
function varrer(arquivos) {
    let record = 0;
    let log = 0;
    const violacoes = [];
    for (const arquivo of arquivos) {
        const src = lerCodigo(arquivo);

        for (const m of src.matchAll(RE_RECORD)) {
            record++;
            const [entidade, operacao] = argumentosDeTopo(src, m.index + m[0].length);
            const ruins = [];
            if (ehLiteral(entidade)) ruins.push(`tipo de entidade ${entidade}`);
            if (ehLiteral(operacao)) ruins.push(`tipo de operação ${operacao}`);
            if (ruins.length) {
                violacoes.push(`${arquivo}:${linhaDe(src, m.index)} recordOperation com ${ruins.join(' e ')}`);
            }
        }

        log += [...src.matchAll(RE_LOG)].length;
        for (const m of src.matchAll(RE_LOG_LITERAL)) {
            violacoes.push(`${arquivo}:${linhaDe(src, m.index)} ${m[0].trim()}`);
        }
    }
    return { record, log, violacoes };
}

const COMO_CORRIGIR = 'Use `EntityType.X` e `OperationType.Y` de '
    + '`src/js/store/sync/operation-types.js` (ou o reexport do barril `sync/index.js`, que '
    + 'os arquivos de store já importam, sem aresta nova de import). O valor viaja no '
    + 'envelope e o servidor despacha por ele: uma string digitada à mão errada produz uma '
    + 'op que nenhum ramo reconhece, acked e sem efeito.';

describe('Censo: nenhum literal onde o vocabulário de operação tem constante', () => {
    it('piso: o inventário vem do git e a varredura ALCANÇA os sítios reais', () => {
        let arquivos;
        try {
            arquivos = arquivosDoInventario();
        } catch (err) {
            throw new Error(
                `o inventário deste censo vem de \`git ls-files\` e o comando FALHOU (${err.message}). `
                + 'Isto é falha de ambiente, não regressão de código: rode dentro do repositório.',
            );
        }
        expect(arquivos.length).toBeGreaterThanOrEqual(PISO_ARQUIVOS);
        expect(arquivos).toContain('src/js/store/feature.operations.js');
        expect(arquivos).toContain('src/js/store/store-transaction.js');
        expect(arquivos).toContain('src/js/locking/map-lock.controller.js');

        const { record, log } = varrer(arquivos);
        expect(record, 'a varredura de `recordOperation` parou de casar').toBeGreaterThanOrEqual(PISO_RECORD);
        expect(log, 'a varredura de `logXxxOperation` parou de casar').toBeGreaterThanOrEqual(PISO_LOG);
    });

    it('nenhum sítio de `src/js` passa literal a `recordOperation` ou ao log de entidade', () => {
        const { violacoes } = varrer(arquivosDoInventario());
        expect(violacoes, `literal onde o vocabulário tem constante. ${COMO_CORRIGIR}`).toEqual([]);
    });

    it('a varredura REPROVA literal novo, e só ele (provado com fixture)', () => {
        // AS MESMAS FUNÇÕES do caso acima, apontadas para uma fixture com as duas formas
        // proibidas e duas formas legítimas. Sem esta prova, "o censo pega literal novo"
        // seria uma afirmação do guarda sobre o guarda.
        const { record, log, violacoes } = varrer([FIXTURE]);
        expect(record).toBe(5);
        expect(log).toBe(1);

        expect(violacoes).toHaveLength(4);
        expect(violacoes.every((v) => v.includes(FIXTURE))).toBe(true);
        expect(violacoes.filter((v) => v.includes("tipo de entidade 'feature'"))).toHaveLength(1);
        expect(violacoes.filter((v) => v.includes("tipo de operação 'update'"))).toHaveLength(1);
        expect(violacoes.filter((v) => v.includes("tipo de entidade 'mapNotes'"))).toHaveLength(1);
        expect(violacoes.filter((v) => v.includes("logMapOperation('update'"))).toHaveLength(1);

        // A DISCRIMINAÇÃO, que é o que separa um censo de uma regra que acusa tudo: as duas
        // chamadas legítimas da fixture (constantes, e tipo de operação calculado em
        // variável) estão entre as cinco contadas em `record` e não estão nas violações.
        expect(violacoes.some((v) => v.includes('EntityType'))).toBe(false);
    });

    it('borda: o scanner de argumentos atravessa aninhamento, vírgula em string e quebra de linha', () => {
        const src = "tx.recordOperation(EntityType.FEATURE, tipo(a, b), { x: [1, 2] }, 'a,b')";
        expect(argumentosDeTopo(src, src.indexOf('(') + 1))
            .toEqual(['EntityType.FEATURE', 'tipo(a, b)', '{ x: [1, 2] }', "'a,b'"]);

        const multilinha = "recordOperation(\n  'feature',\n  OperationType.CREATE,\n)";
        expect(argumentosDeTopo(multilinha, multilinha.indexOf('(') + 1).slice(0, 2))
            .toEqual(["'feature'", 'OperationType.CREATE']);

        // Chamada sem fechamento: devolve o que houver, em vez de girar ou lançar.
        expect(argumentosDeTopo('recordOperation(a, b', 'recordOperation('.length)).toEqual(['a', 'b']);
    });
});
