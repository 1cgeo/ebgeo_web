// Path: tests/unit/aba-mapas-acoes-por-estado.test.js
//
// A FIAÇÃO DA GRADE DE AÇÕES DA ABA "Mapas": qual botão existe e em qual estado ele aparece.
//
// O BURACO QUE ESTE ARQUIVO FECHA foi medido, não suposto. `grep maps-save-local
// frontend/tests/` devolvia ZERO: tirar `'save-local'` da linha REMOTE de `ACTIONS_BY_STATE`
// — ou apagar a entrada inteira da grade — deixava a suíte verde e o comando sumia da tela.
// A LÓGICA por trás do botão está medida (`tests/integration/salvar-remoto-como-local.test.js`
// exercita `saveActiveRemoteAtlasAsLocal`); o que não estava medido é o caminho até ela.
//
// POR QUE ESTRUTURAL, E NÃO DE COMPORTAMENTO. O ambiente de teste do frontend é node puro,
// sem jsdom, e a tabela é `const` de módulo em um arquivo que monta DOM no import. A grade
// e a tabela são as duas DECLARAÇÕES: lê-las é medir exatamente o que a tela mostra.
//
// A VARREDURA RODA SOBRE CÓDIGO, NUNCA SOBRE PROSA — o bloco de comentário logo acima de
// `ACTIONS_BY_STATE` cita "save-local" por extenso, e uma varredura ingênua ficaria verde
// para sempre por causa dele. O caso `CONTROLE` prova o par: a remoção de comentários
// continua vendo o código e deixou de ver a prosa.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const URL_MAPS = new URL('../../src/js/sidebar/tabs/maps.tab.js', import.meta.url);
const BRUTO = readFileSync(URL_MAPS, 'utf8');

/**
 * Strips JS comments, walking string literals so a `//` inside a string survives.
 * @param {string} fonte
 * @returns {string}
 */
function semComentarios(fonte) {
    let saida = '';
    let i = 0;
    while (i < fonte.length) {
        const atual = fonte[i];
        const proximo = fonte[i + 1];
        if (atual === '/' && proximo === '/') {
            while (i < fonte.length && fonte[i] !== '\n') i++;
            continue;
        }
        if (atual === '/' && proximo === '*') {
            i += 2;
            while (i < fonte.length && !(fonte[i] === '*' && fonte[i + 1] === '/')) i++;
            i += 2;
            continue;
        }
        if (atual === '"' || atual === "'" || atual === '`') {
            saida += atual;
            i++;
            while (i < fonte.length) {
                if (fonte[i] === '\\') {
                    saida += fonte[i] + (fonte[i + 1] ?? '');
                    i += 2;
                    continue;
                }
                saida += fonte[i];
                const fechou = fonte[i] === atual;
                i++;
                if (fechou) break;
            }
            continue;
        }
        saida += atual;
        i++;
    }
    return saida;
}

const FONTE = semComentarios(BRUTO);

/**
 * Bracket-matched slice starting at the first `abertura` char after `ancora`.
 * @param {string} fonte
 * @param {string} ancora
 * @param {string} abertura - '{' or '['
 * @returns {string|null}
 */
function recorte(fonte, ancora, abertura) {
    const fechamento = abertura === '{' ? '}' : ']';
    const declaracao = fonte.indexOf(ancora);
    if (declaracao === -1) return null;
    const abre = fonte.indexOf(abertura, declaracao);
    if (abre === -1) return null;
    let nivel = 0;
    for (let j = abre; j < fonte.length; j++) {
        if (fonte[j] === abertura) {
            nivel++;
        } else if (fonte[j] === fechamento) {
            nivel--;
            if (nivel === 0) return fonte.slice(abre, j + 1);
        }
    }
    return null;
}

/**
 * Bracket-matched body of a class METHOD, anchored on its DEFINITION.
 *
 * Anchoring on the bare name would find a CALL site first (`this._createActionsGrid()`
 * appears above the definition) and slice the wrong body — which is exactly what happened
 * while this helper was an `indexOf`. The definition regex is anchored to the class-member
 * indentation, and the count is asserted so an ambiguous anchor fails loud.
 *
 * @param {string} nome
 * @returns {string}
 */
function corpoDeMetodo(nome) {
    const definicao = new RegExp(`^ {4}(?:async )?${nome}\\s*\\([^)]*\\)\\s*\\{`, 'gm');
    const achados = [...FONTE.matchAll(definicao)];
    expect(achados, `a definição de \`${nome}\` não casou uma única vez`).toHaveLength(1);
    const corpo = recorte(FONTE.slice(achados[0].index), nome, '{');
    expect(corpo, `o corpo de \`${nome}\` não fechou`).not.toBeNull();
    return corpo;
}

/**
 * The visibility table, as `{ [AtlasTabState key]: string[] }`.
 * @returns {Object<string, string[]>}
 */
function tabelaDeEstados() {
    const bloco = recorte(FONTE, 'const ACTIONS_BY_STATE', '{');
    const tabela = {};
    for (const [, estado, lista] of bloco.matchAll(/\[AtlasTabState\.(\w+)\]:\s*\[([^\]]*)\]/g)) {
        tabela[estado] = [...lista.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    }
    return tabela;
}

/**
 * The action entries declared in `_createActionsGrid`, in declaration order.
 * @returns {Array<{id: string, label: string|null, testid: string|null, handler: string|null}>}
 */
function acoesDaGrade() {
    const lista = recorte(corpoDeMetodo('_createActionsGrid'), 'const actions =', '[');
    // Cada entrada é um objeto PLANO (o handler é uma arrow sem corpo em bloco), então
    // casar "chaves sem chaves dentro" recorta uma entrada por vez sem risco de aninhamento.
    return [...lista.matchAll(/\{[^{}]*\}/g)].map(([texto]) => ({
        id: /\bid:\s*'([^']+)'/.exec(texto)?.[1] ?? null,
        label: /\blabel:\s*'([^']+)'/.exec(texto)?.[1] ?? null,
        testid: /\btestid:\s*'([^']+)'/.exec(texto)?.[1] ?? null,
        handler: /\bhandler:\s*\(\)\s*=>\s*this\.(_\w+)\(/.exec(texto)?.[1] ?? null,
    }));
}

describe('aba "Mapas": a grade de ações e a tabela de visibilidade', () => {
    it('CONTROLE: a varredura enxerga o CÓDIGO e deixou de enxergar a PROSA', () => {
        // O par que o CLAUDE.md exige de qualquer guarda que varra texto. A prosa escolhida
        // é exatamente a que envenenaria este arquivo: o comentário acima de
        // `ACTIONS_BY_STATE` explica por que "save-local" só existe no estado REMOTE.
        const PROSA = '"save-local" é o SIMÉTRICO de "save-server"';
        expect(BRUTO, 'a prosa de controle sumiu do arquivo').toContain(PROSA);
        expect(FONTE, 'a PROSA sobreviveu à remoção de comentários').not.toContain(PROSA);

        // E o outro lado do par: o código continua lá.
        expect(FONTE, 'a remoção de comentários comeu CÓDIGO').toContain('const ACTIONS_BY_STATE');
        expect(FONTE).toContain('_handleSaveAsLocal()');

        // O removedor não pode mexer no conteúdo de um literal de string.
        expect(semComentarios('const s = "a // b"; // fora\nconst t = `c /* d */`;'))
            .toBe('const s = "a // b"; \nconst t = `c /* d */`;');
    });

    it('o botão "Salvar como local" existe na grade, com rótulo, testid e handler', () => {
        const acoes = acoesDaGrade();

        // PISO: o parser achou a grade inteira, e não uma entrada solta.
        expect(acoes.map((a) => a.id)).toEqual([
            'open', 'save-server', 'import', 'save', 'save-local', 'share', 'clear',
        ]);

        const alvo = acoes.find((a) => a.id === 'save-local');
        expect(alvo).toBeDefined();
        expect(alvo.label).toBe('Salvar como local');
        expect(alvo.testid).toBe('maps-save-local');
        expect(alvo.handler).toBe('_handleSaveAsLocal');

        // DISCRIMINAÇÃO: o parser distingue as entradas em vez de devolver a primeira que
        // achou — o irmão simétrico tem outro rótulo, outro testid e outro handler.
        const irmao = acoes.find((a) => a.id === 'save-server');
        expect(irmao.label).toBe('Enviar ao servidor');
        expect(irmao.testid).toBe('maps-save-server');
        expect(irmao.handler).toBe('_handleSaveToServer');
    });

    it('"save-local" aparece SÓ no estado REMOTE', () => {
        const tabela = tabelaDeEstados();

        // PISO: as três linhas da tabela, e nenhuma vazia.
        expect(Object.keys(tabela).sort()).toEqual(['LOCAL_ANON', 'LOCAL_SIGNED_IN', 'REMOTE']);
        for (const [estado, ids] of Object.entries(tabela)) {
            expect(ids.length, `a linha ${estado} veio vazia do parser`).toBeGreaterThan(3);
        }

        expect(tabela.REMOTE).toContain('save-local');

        // DISCRIMINAÇÃO, e é a metade que dá sentido à de cima: guardar cópia local de um
        // atlas que já É local não significa nada. Uma tabela que mostrasse tudo em toda
        // linha passaria no `toContain` acima.
        expect(tabela.LOCAL_ANON).not.toContain('save-local');
        expect(tabela.LOCAL_SIGNED_IN).not.toContain('save-local');

        // AS TRÊS LINHAS INTEIRAS, e não só a REMOTE: acrescentar ou tirar QUALQUER comando
        // em QUALQUER estado passa a ser uma decisão, não um efeito colateral.
        //
        // A linha local é a que mais importa, e a razão é a cláusula 7.5 da constituição:
        // "SOMENTE atlas remotos se compartilham pelo sistema". No servidor isso é verdade por
        // construção (atlas local não tem linha), então o ÚNICO ponto onde a regra pode ser
        // violada é esta tabela. Enquanto as linhas locais eram cobradas só por
        // `not.toContain('save-local')`, acrescentar `'share'` a uma delas passava VERDE, que é
        // exatamente a violação da palavra "somente". Uma auditoria de 2026-08-21 achou essa
        // fresta ao procurar o teste que prendia a cláusula, e a citação da constituição aponta
        // para cá: por isso as três são asserções ABSOLUTAS.
        expect(tabela.LOCAL_ANON).toEqual(['open', 'import', 'save', 'clear']);
        expect(tabela.LOCAL_SIGNED_IN).toEqual(['open', 'save-server', 'import', 'save', 'clear']);
        expect(tabela.REMOTE).toEqual(['open', 'import', 'save', 'save-local', 'share']);

        // E o `share` dito pelo nome, porque é ELE que a cláusula 7.5 governa, e um leitor que
        // mude a lista acima não deve precisar reconstruir esse raciocínio a partir do diff.
        expect(tabela.REMOTE).toContain('share');
        expect(tabela.LOCAL_ANON).not.toContain('share');
        expect(tabela.LOCAL_SIGNED_IN).not.toContain('share');
    });

    it('a tabela e a grade falam do MESMO conjunto de ids: nada órfão, nada fantasma', () => {
        const daGrade = new Set(acoesDaGrade().map((a) => a.id));
        const tabela = tabelaDeEstados();
        const daTabela = new Set(Object.values(tabela).flat());

        expect(daGrade.size).toBe(7);
        expect(daTabela.size).toBe(7);

        // Id na tabela e ausente da grade = linha morta; id na grade e ausente da tabela =
        // botão que nenhum estado mostra. As duas falham calado no produto.
        expect([...daTabela].filter((id) => !daGrade.has(id))).toEqual([]);
        expect([...daGrade].filter((id) => !daTabela.has(id))).toEqual([]);

        // E o `AtlasTabState` não pode ganhar um estado sem linha na tabela: o estado sem
        // linha faz `_updateActionsVisibility` ler `undefined` e lançar em `includes`.
        const enumBloco = recorte(FONTE, 'const AtlasTabState', '{');
        const estados = [...enumBloco.matchAll(/(\w+):\s*'[^']+'/g)].map((m) => m[1]);
        expect(estados).toEqual(['LOCAL_ANON', 'LOCAL_SIGNED_IN', 'REMOTE']);
        expect(estados.every((e) => e in tabela)).toBe(true);
    });

    it('a tabela é o que DECIDE a visibilidade, e a chave é o `id` da ação', () => {
        // Sem esta ligação, as três asserções acima medem uma constante decorativa.
        const visibilidade = corpoDeMetodo('_updateActionsVisibility');
        expect(visibilidade).toContain('ACTIONS_BY_STATE[this._atlasState()]');
        expect(visibilidade).toMatch(/button\.hidden\s*=\s*!visible\.includes\(id\)/);

        // E a chave do mapa de botões é o `action.id`, que é o que a tabela lista.
        const grade = corpoDeMetodo('_createActionsGrid');
        expect(grade).toContain('this._actionButtons.set(action.id, button)');
        expect(grade).toMatch(/setAttribute\('data-testid',\s*action\.testid\)/);
    });

    it('`_handleSaveAsLocal` entrega a cópia ao mesmo resolver de saída da poda', () => {
        const corpo = corpoDeMetodo('_handleSaveAsLocal');
        // PISO: o recorte é o método inteiro.
        expect(corpo.length).toBeGreaterThan(600);

        expect(corpo).toContain("await import('@catalog/resource-reference.resolver.js')");
        expect(corpo).toContain("await import('@store/local-atlas.api.js')");

        // O resolver é CONSTRUÍDO aqui e PASSADO adiante: `saveActiveRemoteAtlasAsLocal`
        // sem ele poda com um resolver ausente e a cópia sai errada, sem erro nenhum.
        const construcao = /(\w+)\s*=\s*await\s+construirResolverDeSaida\(\)/.exec(corpo);
        expect(construcao, 'o resolver de saída não é construído neste caminho').not.toBeNull();
        const chamada = new RegExp(`saveActiveRemoteAtlasAsLocal\\([^;]{0,80}?,\\s*${construcao[1]}\\s*\\)`);
        expect(corpo, 'o resolver construído não chega a `saveActiveRemoteAtlasAsLocal`')
            .toMatch(chamada);

        // DISCRIMINAÇÃO: a recusa nomeada da poda vira mensagem ao usuário, e não "erro ao
        // salvar" — é a razão de `ResourceSumMissingError` ser uma subclasse com nome.
        expect(corpo).toContain("error?.name === 'ResourceSumMissingError'");
    });
});
