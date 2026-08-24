// Path: tests/unit/aba-mapas-acoes-por-estado.test.js
//
// A GRADE DE AÇÕES DA ABA "Mapas": qual botão existe, em qual estado ele aparece, e — desde
// 2026-08-23 — para QUEM.
//
// O BURACO QUE ESTE ARQUIVO FECHOU PRIMEIRO foi medido, não suposto. `grep maps-save-local
// frontend/tests/` devolvia ZERO: tirar `'save-local'` da linha REMOTE de `ACTIONS_BY_STATE`
// — ou apagar a entrada inteira da grade — deixava a suíte verde e o comando sumia da tela.
// A LÓGICA por trás do botão está medida (`tests/integration/salvar-remoto-como-local.test.js`
// exercita `saveActiveRemoteAtlasAsLocal`); o que não estava medido é o caminho até ela.
//
// O QUE MUDOU EM 2026-08-23, e é a razão de metade deste arquivo ter deixado de ser um parser:
// a tabela e o gate saíram de `maps.tab.js` para `src/js/sidebar/tabs/atlas-actions.js`, um
// módulo puro. A tabela agora se AFIRMA (importada e comparada), em vez de se reconhecer por
// regex, e o gate por posto se EXERCITA. `maps.tab.js` continua sendo lido como texto, porque
// ele importa Sortable e a store e não carrega em node: o que se lê ali é a fiação (a grade de
// botões e quem decide a visibilidade), nunca mais a decisão.
//
// POR QUE ESTRUTURAL NA METADE QUE SOBROU. O ambiente de teste do frontend é node puro, sem
// jsdom, e a grade é montada com `document.createElement` no import. A lista de ações é uma
// DECLARAÇÃO: lê-la é medir exatamente o que a tela mostra.
//
// A VARREDURA RODA SOBRE CÓDIGO, NUNCA SOBRE PROSA — os comentários de `maps.tab.js` citam por
// extenso os ids que este arquivo procura, e uma varredura ingênua ficaria verde para sempre
// por causa deles. O caso `CONTROLE` prova o par.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    ACTIONS_BY_STATE,
    AtlasTabState,
    atlasTabState,
    visibleAtlasActions,
} from '../../src/js/sidebar/tabs/atlas-actions.js';

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

/** Um atlas de servidor, com a pessoa naquele posto. */
const noServidor = (role) => visibleAtlasActions({ remote: true, authenticated: true, role });

describe('aba "Mapas": a grade de ações e a tabela de visibilidade', () => {
    it('CONTROLE: a varredura enxerga o CÓDIGO e deixou de enxergar a PROSA', () => {
        // O par que o CLAUDE.md exige de qualquer guarda que varra texto. A prosa escolhida é
        // exatamente a que envenenaria este arquivo: o comentário acima da entrada
        // `participants` explica a relação dela com "Compartilhar".
        const PROSA = 'O IRMÃO SOMENTE-LEITURA de "Compartilhar"';
        expect(BRUTO, 'a prosa de controle sumiu do arquivo').toContain(PROSA);
        expect(FONTE, 'a PROSA sobreviveu à remoção de comentários').not.toContain(PROSA);

        // E o outro lado do par: o código continua lá.
        expect(FONTE, 'a remoção de comentários comeu CÓDIGO').toContain('const actions =');
        expect(FONTE).toContain('_handleSaveAsLocal()');

        // O removedor não pode mexer no conteúdo de um literal de string.
        expect(semComentarios('const s = "a // b"; // fora\nconst t = `c /* d */`;'))
            .toBe('const s = "a // b"; \nconst t = `c /* d */`;');
    });

    it('o botão "Salvar como local" existe na grade, com rótulo, testid e handler', () => {
        const acoes = acoesDaGrade();

        // PISO: o parser achou a grade inteira, e não uma entrada solta.
        expect(acoes.map((a) => a.id)).toEqual([
            'open', 'save-server', 'import', 'save', 'save-local', 'share', 'participants', 'clear',
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

    it('o par "Compartilhar"/"Participantes" existe na grade, com testid LITERAL e handler', () => {
        const acoes = acoesDaGrade();

        const share = acoes.find((a) => a.id === 'share');
        expect(share.label).toBe('Compartilhar');
        expect(share.testid).toBe('maps-share');
        expect(share.handler).toBe('_handleShare');

        const participantes = acoes.find((a) => a.id === 'participants');
        expect(participantes.label).toBe('Participantes');
        expect(participantes.testid).toBe('maps-participants');
        expect(participantes.handler).toBe('_handleParticipants');

        // DISCRIMINAÇÃO: são DOIS handlers distintos, e o de leitura pede o modo pelo nome.
        // Se os dois apontassem para o mesmo método, o Leitor tomaria 403 em `getSharing`,
        // que é o beco sem saída que esta mudança existe para fechar.
        expect(share.handler).not.toBe(participantes.handler);
        const corpo = corpoDeMetodo('_handleParticipants');
        expect(corpo).toContain("await import('@modals/sharing.modal.js')");
        expect(corpo).toContain('readOnly: true');
        expect(corpoDeMetodo('_handleShare')).not.toContain('readOnly');
    });

    it('"save-local" aparece SÓ no estado REMOTE', () => {
        // PISO: as três linhas da tabela, e nenhuma vazia.
        expect(Object.keys(ACTIONS_BY_STATE).sort())
            .toEqual(['local-anon', 'local-signed-in', 'remote']);
        for (const [estado, ids] of Object.entries(ACTIONS_BY_STATE)) {
            expect(ids.length, `a linha ${estado} veio vazia`).toBeGreaterThan(3);
        }

        const REMOTO = ACTIONS_BY_STATE[AtlasTabState.REMOTE];
        const ANON = ACTIONS_BY_STATE[AtlasTabState.LOCAL_ANON];
        const LOGADO = ACTIONS_BY_STATE[AtlasTabState.LOCAL_SIGNED_IN];

        expect(REMOTO).toContain('save-local');

        // DISCRIMINAÇÃO, e é a metade que dá sentido à de cima: guardar cópia local de um
        // atlas que já É local não significa nada. Uma tabela que mostrasse tudo em toda
        // linha passaria no `toContain` acima.
        expect(ANON).not.toContain('save-local');
        expect(LOGADO).not.toContain('save-local');

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
        expect(ANON).toEqual(['open', 'import', 'save', 'clear']);
        expect(LOGADO).toEqual(['open', 'save-server', 'import', 'save', 'clear']);
        expect(REMOTO).toEqual(['open', 'import', 'save', 'save-local', 'share', 'participants']);

        // E as duas ações de ACESSO ditas pelo nome, porque é a cláusula 7.5 que as governa, e
        // um leitor que mude a lista acima não deve precisar reconstruir isso a partir do diff.
        expect(REMOTO).toContain('share');
        expect(REMOTO).toContain('participants');
        for (const local of [ANON, LOGADO]) {
            expect(local).not.toContain('share');
            expect(local).not.toContain('participants');
        }
    });

    it('a tabela e a grade falam do MESMO conjunto de ids: nada órfão, nada fantasma', () => {
        const daGrade = new Set(acoesDaGrade().map((a) => a.id));
        const daTabela = new Set(Object.values(ACTIONS_BY_STATE).flat());

        expect(daGrade.size).toBe(8);
        expect(daTabela.size).toBe(8);

        // Id na tabela e ausente da grade = linha morta; id na grade e ausente da tabela =
        // botão que nenhum estado mostra. As duas falham calado no produto.
        expect([...daTabela].filter((id) => !daGrade.has(id))).toEqual([]);
        expect([...daGrade].filter((id) => !daTabela.has(id))).toEqual([]);

        // E o `AtlasTabState` não pode ganhar um estado sem linha na tabela: o estado sem
        // linha faz `_updateActionsVisibility` ler `undefined` e lançar em `includes`.
        expect(Object.keys(AtlasTabState)).toEqual(['LOCAL_ANON', 'LOCAL_SIGNED_IN', 'REMOTE']);
        expect(Object.values(AtlasTabState).every((e) => e in ACTIONS_BY_STATE)).toBe(true);
    });

    it('a decisão pura é o que DECIDE a visibilidade, e a chave é o `id` da ação', () => {
        // Sem esta ligação, as asserções acima medem um módulo decorativo.
        const visibilidade = corpoDeMetodo('_updateActionsVisibility');
        expect(visibilidade).toContain('visibleAtlasActions(this._atlasContext())');
        expect(visibilidade).toMatch(/button\.hidden\s*=\s*!visible\.includes\(id\)/);

        // E o contexto é lido dos TRÊS sinais vivos: origem da store, sessão e posto. Faltar o
        // terceiro faria o gate por posto rodar sempre com `role` indefinido, que fecha tudo.
        const contexto = corpoDeMetodo('_atlasContext');
        expect(contexto).toContain('isRemoteStoreSync()');
        expect(contexto).toContain('sessionContext.isAuthenticated()');
        expect(contexto).toContain('sessionContext.role');

        // A chave do mapa de botões é o `action.id`, que é o que a tabela lista.
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

// ============================================================================
// O GATE POR POSTO: quem vê "Compartilhar" e quem vê "Participantes"
// ============================================================================

describe('aba "Mapas": as duas portas de acesso, por posto', () => {
    it('o estado ainda é decidido pela STORE, não pela pessoa', () => {
        expect(atlasTabState({ remote: true, authenticated: true })).toBe(AtlasTabState.REMOTE);
        // O visitante de link público é anônimo SOBRE um atlas de servidor, e cai em REMOTE:
        // a pergunta que a linha responde é sobre a store.
        expect(atlasTabState({ remote: true, authenticated: false })).toBe(AtlasTabState.REMOTE);
        expect(atlasTabState({ remote: false, authenticated: true }))
            .toBe(AtlasTabState.LOCAL_SIGNED_IN);
        expect(atlasTabState({ remote: false, authenticated: false }))
            .toBe(AtlasTabState.LOCAL_ANON);
        // Sem argumento nenhum: o mais fechado dos quatro.
        expect(atlasTabState()).toBe(AtlasTabState.LOCAL_ANON);
    });

    it('só de `manage` para cima vê "Compartilhar", nos DOIS vocabulários', () => {
        // A escada do servidor. `manage` e `owner` são os dois postos que as quatro rotas de
        // `/atlas/:atlasId/sharing` aceitam.
        for (const posto of ['manage', 'owner']) {
            expect(noServidor(posto), `${posto} deveria ver "Compartilhar"`).toContain('share');
            expect(noServidor(posto), `${posto} não deveria ver "Participantes"`)
                .not.toContain('participants');
        }

        // DISCRIMINAÇÃO, e é o defeito que a decisão fechou: os três degraus de baixo tinham o
        // botão e o clique morria em 403.
        for (const posto of ['read', 'comment', 'write']) {
            expect(noServidor(posto), `${posto} não pode ver "Compartilhar"`)
                .not.toContain('share');
            expect(noServidor(posto), `${posto} precisa da porta de leitura`)
                .toContain('participants');
        }

        // O vocabulário do CLIENTE (`UserRole`, seis valores, com o `admin` global dobrado para
        // dentro da escada) responde igual, porque `atlasRoleHasAtLeast` traduz antes de comparar.
        for (const papel of ['manager', 'owner', 'admin']) {
            expect(noServidor(papel), `${papel} deveria ver "Compartilhar"`).toContain('share');
        }
        for (const papel of ['viewer', 'commenter', 'editor']) {
            expect(noServidor(papel), `${papel} não pode ver "Compartilhar"`)
                .not.toContain('share');
        }
    });

    it('o VISITANTE DE LINK PÚBLICO não vê nenhuma das duas portas', () => {
        // Ele é anônimo sobre um atlas de servidor. "Compartilhar" morreria em 403 na rota de
        // sharing; "Participantes" morreria em 403 uma camada antes, em
        // `confineVisitorPrincipal`, porque `GET /atlas/overview` não nomeia atlas nenhum e o
        // token dele está confinado ao atlas que o emitiu.
        const visitante = visibleAtlasActions({ remote: true, authenticated: false, role: null });
        expect(visitante).not.toContain('share');
        expect(visitante).not.toContain('participants');

        // DISCRIMINAÇÃO: ele continua com tudo o que não depende de conta.
        expect(visitante).toEqual(['open', 'import', 'save', 'save-local']);

        // E o par que prova que é a SESSÃO, e não o posto, que fecha a porta de leitura: a
        // mesma ausência de posto COM conta abre "Participantes".
        expect(visibleAtlasActions({ remote: true, authenticated: true, role: null }))
            .toContain('participants');
    });

    it('posto DESCONHECIDO fecha "Compartilhar" (falha fechada, não aberta)', () => {
        const desconhecido = noServidor('superuser');
        expect(desconhecido).not.toContain('share');
        // Ele continua sendo uma conta que participa, então a porta de leitura fica: o servidor
        // decide o que ela mostra, e mostrar é o que ela faz.
        expect(desconhecido).toContain('participants');

        // DISCRIMINAÇÃO em quatro valores que um gate ingênuo trataria como "algum papel":
        // nenhum deles alcança `manage`.
        for (const lixo of [null, undefined, '', 42, {}, 'ADMIN', 'Manage']) {
            expect(
                visibleAtlasActions({ remote: true, authenticated: true, role: lixo }),
                `\`${String(lixo)}\` não pode abrir "Compartilhar"`,
            ).not.toContain('share');
        }
    });

    it('as duas portas NUNCA aparecem juntas, e nunca fora do atlas de servidor', () => {
        const postos = [
            'read', 'comment', 'write', 'manage', 'owner',
            'viewer', 'commenter', 'editor', 'manager', 'admin',
            'superuser', null,
        ];
        for (const role of postos) {
            for (const authenticated of [true, false]) {
                const remoto = visibleAtlasActions({ remote: true, authenticated, role });
                const juntas = remoto.includes('share') && remoto.includes('participants');
                expect(juntas, `\`${String(role)}\` viu as duas portas ao mesmo tempo`).toBe(false);

                // Cláusula 7.5: atlas local não se compartilha pelo sistema, e não tem
                // participante para listar. Nenhum posto muda isso.
                const local = visibleAtlasActions({ remote: false, authenticated, role });
                expect(local).not.toContain('share');
                expect(local).not.toContain('participants');
            }
        }

        // PISO da varredura acima: ela de fato viu as duas portas aparecerem, cada uma na vez
        // dela. Sem isto, um `visibleAtlasActions` que devolvesse [] passaria verde.
        expect(noServidor('owner')).toContain('share');
        expect(noServidor('read')).toContain('participants');
    });

    it('o array devolvido é NOVO a cada chamada e mantém a ordem da tabela', () => {
        const a = noServidor('owner');
        const b = noServidor('owner');
        expect(a).toEqual(b);
        expect(a).not.toBe(b);
        a.push('contaminado');
        expect(noServidor('owner')).not.toContain('contaminado');

        // A ordem é a da tabela, não a de um filtro que reordena.
        expect(noServidor('owner')).toEqual(['open', 'import', 'save', 'save-local', 'share']);
        expect(noServidor('read')).toEqual(['open', 'import', 'save', 'save-local', 'participants']);
    });
});
