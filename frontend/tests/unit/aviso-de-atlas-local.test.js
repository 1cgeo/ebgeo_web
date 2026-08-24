// Path: tests/unit/aviso-de-atlas-local.test.js
//
// O QUE O MAPA DIZ A QUEM NAO ENTROU: onde o trabalho mora, como se chega aos atlas, e por que o
// comentario espacial recusa. Tres achados da auditoria do VISITANTE DESLOGADO, 2026-08-24.
//
// A3 — o mapa nao dizia onde o trabalho mora. A unica afirmacao sobre a natureza local do
//      trabalho era o `title` do cracha de origem, e um `title` nao existe em toque, nao existe
//      para leitor de tela em varios contextos e nao existe para quem nao passa o mouse ali. A
//      frase agora e TEXTO VISIVEL, e o final dela muda com o estado, porque o comando que fecha
//      o argumento ("Enviar ao servidor") nao e desenhado para quem nao tem sessao.
// M4 — "Abrir" era o unico caminho do mapa ate a tela de atlas e o rotulo nao dizia isso. Passou
//      a ser "Seus atlas", com o `title` anterior de explicacao.
// M6 — a recusa do comentario mandava o anonimo "enviar este atlas ao servidor", que e
//      exatamente a acao que a grade de acoes esconde de quem nao entrou.
//
// POR QUE METADE DESTE ARQUIVO E ESTRUTURAL. O ambiente de teste do frontend e node puro, sem
// jsdom, e nem `maps.tab.js` (Sortable + barril da store) nem `comment-overlay.js` (barril da
// store) carregam aqui. A DECISAO de A3 mora num modulo folha e se AFIRMA; o CAMINHO ate a tela
// (o elemento existir, ser pendurado no cabecalho, e receber a frase em `textContent`) se le como
// texto, e e ele que este arquivo prende, porque "o codigo CONSTROI X" nao prova "X CHEGA a tela".
//
// A VARREDURA RODA SOBRE CODIGO, NUNCA SOBRE PROSA: os comentarios que acompanham as tres
// mudancas citam por extenso os rotulos e as frases que este arquivo procura, e uma varredura
// ingenua ficaria verde para sempre por causa deles. Os dois casos `CONTROLE` provam o par.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { AtlasTabState } from '../../src/js/sidebar/tabs/atlas-actions.js';
import {
    ATLAS_LOCAL_NOTICE,
    atlasLocalNotice,
} from '../../src/js/sidebar/tabs/atlas-local-notice.js';

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

const ler = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const BRUTO_MAPS = ler('../../src/js/sidebar/tabs/maps.tab.js');
const MAPS = semComentarios(BRUTO_MAPS);
const BRUTO_OVERLAY = ler('../../src/js/comment_tool/comment-overlay.js');
const OVERLAY = semComentarios(BRUTO_OVERLAY);
const CSS = ler('../../src/css/sidebar.css');

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
 * Bracket-matched body of a class METHOD, anchored on its DEFINITION (not on a call site, which
 * can appear above it). The match count is asserted, so an ambiguous anchor fails loud.
 * @param {string} fonte
 * @param {string} nome
 * @returns {string}
 */
function corpoDeMetodo(fonte, nome) {
    const definicao = new RegExp(`^ {4}(?:async )?${nome}\\s*\\([^)]*\\)\\s*\\{`, 'gm');
    const achados = [...fonte.matchAll(definicao)];
    expect(achados, `a definicao de \`${nome}\` nao casou uma unica vez`).toHaveLength(1);
    const corpo = recorte(fonte.slice(achados[0].index), nome, '{');
    expect(corpo, `o corpo de \`${nome}\` nao fechou`).not.toBeNull();
    return corpo;
}

// ============================================================================
// A3 — a decisao pura
// ============================================================================

describe('A3: a frase que diz onde o trabalho mora', () => {
    it('cobre TODOS os estados que `AtlasTabState` declara, e so eles', () => {
        // A LIGACAO entre os dois modulos. `atlas-local-notice.js` e folha de propósito (zero
        // imports), entao ele escreve as chaves em vez de importar o enum; sem este caso, um
        // estado novo na tabela de acoes nasceria sem frase e a aba ficaria muda naquele estado.
        const estados = Object.values(AtlasTabState);
        expect(estados.length).toBe(3);
        expect(Object.keys(ATLAS_LOCAL_NOTICE).sort()).toEqual([...estados].sort());
    });

    it('o anonimo e mandado para EXPORTAR, que e o comando que ele tem', () => {
        const frase = atlasLocalNotice(AtlasTabState.LOCAL_ANON);
        expect(frase).toBe(
            'Guardado neste navegador. Nada vai para o servidor. '
            + 'Use Exportar para levar uma cópia.',
        );

        // A METADE QUE E O ACHADO: ele NAO pode ser mandado ao servidor, porque `save-server` nao
        // esta na linha `local-anon` da grade e o comando nao e desenhado sem sessao. Uma frase
        // que nomeasse um botao inexistente e o defeito M6 repetido aqui.
        expect(frase).not.toContain('Enviar ao servidor');
    });

    it('o LOGADO num atlas local recebe a mesma advertencia com a saida a MAIS', () => {
        const frase = atlasLocalNotice(AtlasTabState.LOCAL_SIGNED_IN);
        expect(frase).toBe(
            'Guardado neste navegador. Nada vai para o servidor. '
            + 'Use Enviar ao servidor para publicá-lo, ou Exportar para levar uma cópia.',
        );

        // A exposicao e a MESMA (os bytes estao neste navegador), entao o primeiro periodo nao
        // muda; o que muda e o proximo passo, e ele existe porque `save-server` ESTA na linha
        // `local-signed-in` de `ACTIONS_BY_STATE`.
        expect(frase.startsWith('Guardado neste navegador. Nada vai para o servidor.')).toBe(true);
        expect(frase).toContain('Enviar ao servidor');
        expect(frase).toContain('Exportar');

        // DISCRIMINACAO: as duas frases sao DIFERENTES. Uma so para os dois estados passaria em
        // tudo acima menos aqui, e seria justamente o erro do M6.
        expect(frase).not.toBe(atlasLocalNotice(AtlasTabState.LOCAL_ANON));
    });

    it('num atlas de SERVIDOR a aba fica calada', () => {
        expect(atlasLocalNotice(AtlasTabState.REMOTE)).toBeNull();
        expect(ATLAS_LOCAL_NOTICE[AtlasTabState.REMOTE]).toBeNull();
    });

    it('estado desconhecido FALHA FECHADO, e nao devolve funcao herdada', () => {
        // Prometer "nada vai para o servidor" sobre uma situacao que ninguem classificou e o
        // unico desfecho pior do que nao dizer nada.
        for (const lixo of ['servidor', '', 'LOCAL_ANON', null, undefined, 42, {}, []]) {
            expect(atlasLocalNotice(lixo), `\`${String(lixo)}\` devolveu frase`).toBeNull();
        }
        // Herdado de `Object.prototype`: um `textContent` receberia o codigo-fonte de uma funcao.
        for (const herdado of ['toString', 'constructor', 'hasOwnProperty', '__proto__']) {
            expect(atlasLocalNotice(herdado), herdado).toBeNull();
        }

        // PISO: a funcao de fato devolve frase para os estados que existem, senao tudo acima
        // passaria com um `return null` incondicional.
        expect(atlasLocalNotice(AtlasTabState.LOCAL_ANON)).toBeTypeOf('string');
        expect(atlasLocalNotice(AtlasTabState.LOCAL_SIGNED_IN)).toBeTypeOf('string');
    });

    it('a tabela e congelada: ninguem reescreve a frase em runtime', () => {
        expect(Object.isFrozen(ATLAS_LOCAL_NOTICE)).toBe(true);
    });
});

// ============================================================================
// A3 — o CAMINHO ate a tela
// ============================================================================

describe('A3: a frase CHEGA ao cabecalho da aba Mapas', () => {
    it('CONTROLE: a varredura enxerga o CODIGO e nao a PROSA', () => {
        // A prosa escolhida e exatamente a que envenenaria este arquivo: o comentario que
        // acompanha a troca de rotulo do M4 cita o rotulo novo entre aspas.
        const PROSA = 'as palavras "Seus atlas" não apareciam em lugar nenhum do mapa';
        expect(BRUTO_MAPS, 'a prosa de controle sumiu do arquivo').toContain(PROSA);
        expect(MAPS, 'a PROSA sobreviveu a remocao de comentarios').not.toContain(PROSA);

        expect(MAPS, 'a remocao de comentarios comeu CODIGO').toContain('const actions =');
        expect(semComentarios('const s = "a // b"; // fora\nconst t = `c /* d */`;'))
            .toBe('const s = "a // b"; \nconst t = `c /* d */`;');
    });

    it('a aba importa a decisao em vez de repetir a frase', () => {
        expect(MAPS).toContain("import { atlasLocalNotice } from './atlas-local-notice.js';");
        // A frase NAO e escrita a mao dentro da aba: duas copias divergem, e a de dentro do
        // arquivo que nao carrega em node e a que ninguem consegue afirmar.
        expect(MAPS).not.toContain('Guardado neste navegador');
    });

    it('o elemento do aviso e CRIADO e PENDURADO no cabecalho', () => {
        const corpo = corpoDeMetodo(MAPS, '_createAtlasHeader');
        // PISO: o recorte e o metodo inteiro (ele monta o input, dois crachas e o aviso).
        expect(corpo.length).toBeGreaterThan(800);

        expect(corpo).toMatch(/const note = document\.createElement\('p'\)/);
        expect(corpo).toContain("note.className = 'atlas-header__note'");
        expect(corpo).toContain("note.setAttribute('data-testid', 'atlas-local-note')");
        // O PASSO QUE FAZ O ELEMENTO EXISTIR NA TELA. Sem esta linha o objeto e construido,
        // referenciado e nunca desenhado, que e o modo de falha que este arquivo existe para
        // pegar: um teste do objeto ficaria verde.
        expect(corpo, 'o aviso e construido e nunca pendurado').toContain('header.appendChild(note)');
        // E a referencia que a repintura usa.
        expect(corpo).toContain('this._atlasNote = note');
    });

    it('a repintura ESCREVE a frase no elemento, e antes de qualquer ida a rede', () => {
        const corpo = corpoDeMetodo(MAPS, '_refreshAtlasHeader');
        expect(corpo.length).toBeGreaterThan(1000);

        expect(corpo).toContain('atlasLocalNotice(this._atlasState())');
        // O EFEITO: a frase vira texto do elemento, e some quando nao ha frase. `textContent`,
        // nunca `innerHTML`: e o cabecalho que carrega dado de usuario (o nome do atlas) logo ao
        // lado, e a convencao da casa nao abre excecao por a frase ser constante.
        expect(corpo).toMatch(/this\._atlasNote\.textContent\s*=\s*aviso/);
        expect(corpo).toMatch(/this\._atlasNote\.hidden\s*=\s*!aviso/);
        expect(corpo).not.toContain('_atlasNote.innerHTML');

        // A ORDEM IMPORTA: `_resolveRemoteAtlasName` vai a rede. Escrever o aviso depois dele
        // deixaria a janela sem aviso exatamente enquanto ela esta lenta.
        const escrita = corpo.indexOf('this._atlasNote.textContent');
        const rede = corpo.indexOf('await this._resolveRemoteAtlasName()');
        expect(escrita).toBeGreaterThan(-1);
        expect(rede).toBeGreaterThan(-1);
        expect(escrita, 'o aviso e escrito depois da ida a rede').toBeLessThan(rede);
    });

    it('a repintura roda nos tres eventos que trocam o estado', () => {
        // Entrar e sair da conta troca a frase (o final dela muda), e limpar tudo remarca a store
        // LOCAL sem transicao de conexao nenhuma.
        const corpo = corpoDeMetodo(MAPS, '_setupEventListeners');
        for (const evento of ['SESSION_CHANGED', 'CONNECTION_STATE_CHANGED', 'ALL_DATA_CLEARED']) {
            expect(corpo, `\`${evento}\` nao repinta o cabecalho`)
                .toContain(`EventTypes.${evento}`);
        }
        expect([...corpo.matchAll(/this\._refreshAtlasHeader\(\)/g)]).toHaveLength(3);
    });

    it('o CSS desenha o aviso numa linha propria dentro do cabecalho', () => {
        // A ancora leva a CHAVE junto: o seletor tambem aparece dentro do comentario da regra
        // vizinha, e sem ela o `indexOf` recorta a regra errada (foi o que aconteceu na primeira
        // rodada deste caso, e o vermelho apontava para o bloco de `.atlas-header__name`).
        const regra = recorte(CSS, '.atlas-header__note {', '{');
        expect(regra, 'a classe do aviso nao tem regra nenhuma').not.toBeNull();
        // Sem `flex: 0 0 100%` ele disputa a linha com o nome e os dois crachas.
        expect(regra).toMatch(/flex:\s*0\s+0\s+100%/);

        // E o cabecalho precisa EMBRULHAR, senao o item de base 100% estoura a linha em vez de
        // cair para a seguinte. As duas metades sao uma coisa so.
        const cabecalho = recorte(CSS, '.atlas-header {', '{');
        expect(cabecalho).toMatch(/flex-wrap:\s*wrap/);

        // Sem estilo inline em JS: a cor e o tamanho vem daqui, por token.
        expect(regra).toContain('var(--');
        expect(MAPS).not.toContain('note.style');
    });
});

// ============================================================================
// M4 — o rotulo da unica porta ate a tela de atlas
// ============================================================================

describe('M4: a porta para "Seus atlas" diz o proprio nome', () => {
    /** The `open` entry of the actions grid, as declared. */
    function acaoOpen() {
        const lista = recorte(corpoDeMetodo(MAPS, '_createActionsGrid'), 'const actions =', '[');
        const entradas = [...lista.matchAll(/\{[^{}]*\}/g)].map(([texto]) => ({
            id: /\bid:\s*'([^']+)'/.exec(texto)?.[1] ?? null,
            label: /\blabel:\s*'([^']+)'/.exec(texto)?.[1] ?? null,
            title: /\btitle:\s*'([^']+)'/.exec(texto)?.[1] ?? null,
        }));
        // PISO: o parser achou a grade inteira, e nao uma entrada solta.
        expect(entradas.map((e) => e.id)).toEqual([
            'open', 'save-server', 'import', 'save', 'save-local', 'share', 'participants', 'clear',
        ]);
        return entradas.find((e) => e.id === 'open');
    }

    it('o rotulo e "Seus atlas" e o `title` continua explicando', () => {
        const open = acaoOpen();
        expect(open.label).toBe('Seus atlas');
        expect(open.title).toBe('Escolher outro atlas');

        // O ACHADO: "Abrir" ficava ao lado de "Importar", que E um seletor de arquivo, e o
        // proprio handler registra que este botao JA FOI um seletor de `.ebgeo`.
        expect(open.label).not.toBe('Abrir');
    });

    it('o rotulo novo nao colide com o vizinho que abre arquivo', () => {
        const lista = recorte(corpoDeMetodo(MAPS, '_createActionsGrid'), 'const actions =', '[');
        const rotulos = [...lista.matchAll(/\blabel:\s*'([^']+)'/g)].map((m) => m[1]);
        expect(rotulos).toHaveLength(8);
        expect(new Set(rotulos).size, 'dois botoes da grade tem o mesmo rotulo').toBe(8);
        expect(rotulos).toContain('Importar');
    });
});

// ============================================================================
// M6 — a recusa do comentario nao manda fazer o que a tela esconde
// ============================================================================

describe('M6: a quarta frase da recusa do comentario espacial', () => {
    const corpo = () => corpoDeMetodo(OVERLAY, 'togglePlacement');

    it('CONTROLE: a varredura enxerga o CODIGO e nao a PROSA', () => {
        const PROSA = 'o anonimo saia procurando um botao que nao existe';
        expect(BRUTO_OVERLAY, 'a prosa de controle sumiu do arquivo').toContain(PROSA);
        expect(OVERLAY, 'a PROSA sobreviveu a remocao de comentarios').not.toContain(PROSA);
        expect(OVERLAY, 'a remocao de comentarios comeu CODIGO').toContain('togglePlacement(on)');
    });

    it('sao QUATRO frases, e o desenho de tres ramos foi preservado', () => {
        const texto = corpo();
        expect(texto.length).toBeGreaterThan(400);

        const frases = [...texto.matchAll(/motivo = |motivo$\s|\? '|: '/g)];
        expect(frases.length).toBeGreaterThan(0);

        // As tres que ja existiam, verbatim.
        expect(texto).toContain('Comentários existem só em atlas do servidor. Envie este atlas ao servidor para comentar.');
        expect(texto).toContain('Entre na sua conta para adicionar comentários.');
        expect(texto).toContain('Você não tem permissão para comentar neste atlas.');
        // A QUARTA.
        expect(texto).toContain('Comentários existem só em atlas do servidor. Entre na sua conta para enviar este atlas ao servidor.');

        // O DESENHO: os tres ramos continuam sendo tres, na mesma ordem, decididos pelos mesmos
        // dois sinais. A correcao era uma frase a mais, nunca uma revisao do desenho.
        const ordem = ['!isRemoteStoreSync()', '!sessionContext.isAuthenticated()'];
        let cursor = -1;
        for (const sinal of ordem) {
            const i = texto.indexOf(sinal, cursor + 1);
            expect(i, `\`${sinal}\` fora de ordem ou ausente`).toBeGreaterThan(cursor);
            cursor = i;
        }
    });

    it('o desdobramento acontece DENTRO do ramo local, e depende da sessao', () => {
        const texto = corpo();
        const local = texto.indexOf('if (!isRemoteStoreSync())');
        const proximoRamo = texto.indexOf('} else if', local);
        expect(local).toBeGreaterThan(-1);
        expect(proximoRamo).toBeGreaterThan(local);

        const ramoLocal = texto.slice(local, proximoRamo);
        // A condicional e a SESSAO, nunca o papel: quem esta num atlas local nao tem papel nenhum.
        expect(ramoLocal).toContain('sessionContext.isAuthenticated()');
        expect(ramoLocal).toContain('Entre na sua conta para enviar este atlas ao servidor.');
        expect(ramoLocal).toContain('Envie este atlas ao servidor para comentar.');

        // DISCRIMINACAO, e e o achado: o anonimo NAO recebe a frase que manda enviar ao servidor
        // (`save-server` nao esta na linha `local-anon` da grade e o comando nao e desenhado sem
        // sessao). A frase antiga fica para quem tem o botao.
        const ternario = /sessionContext\.isAuthenticated\(\)\s*\?\s*'Comentários existem só em atlas do servidor\. Envie este atlas ao servidor para comentar\.'\s*:\s*'Comentários existem só em atlas do servidor\. Entre na sua conta para enviar este atlas ao servidor\.'/;
        expect(ramoLocal, 'as duas frases locais nao estao presas a sessao').toMatch(ternario);
    });

    it('o gate continua sendo capacidade, nao papel', () => {
        // O relatorio marca `togglePlacement` como codigo bom: a frase nomeia o motivo real. O
        // que decide se ha recusa continua sendo `_canComment`, e ele nao compara posto nenhum.
        const gate = corpoDeMetodo(OVERLAY, '_canComment');
        expect(gate).toContain('isRemoteStoreSync()');
        expect(gate).toContain('sessionContext.isAuthenticated()');
        expect(gate).toContain('checkPermission(GuardAction.CREATE_COMMENT)');
        // Lista fechada de posto e o defeito que a constituicao proibe, e o censo mecanico
        // (`tests/unit/permissao-de-atlas-censo.test.js`) so pega literal ENTRE ASPAS.
        expect(gate).not.toMatch(/'(read|comment|write|manage|owner)'/);
    });
});
