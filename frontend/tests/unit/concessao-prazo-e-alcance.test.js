// Path: tests/unit/concessao-prazo-e-alcance.test.js
//
// O QUE O MODAL DE COMPARTILHAR RECURSO AFIRMA, E QUE ATE 2026-08-24 ERA FALSO EM CINCO
// PONTOS. Todos os cinco eram texto ou oferta de acao, nao aritmetica, e por isso nenhum
// teste os pegava: sao exatamente a classe de defeito que so aparece quando alguem le a
// tela acreditando nela.
//
// 1. A lista "quem tem acesso" nomeava TRES origens que nao aparecem nela e parava ali.
//    Faltavam as duas que mudam a decisao de quem concede: o emprestimo por atlas
//    (`fn_granted_resource_ids`, clausula 6.1) e o visitante de link publico (6.3). A tela
//    podia dizer "tres pessoas tem acesso" enquanto um atlas publico entregava o recurso a
//    qualquer um com o link, e quem revogasse a unica linha acharia que fechou o acesso.
// 2. "Ninguem encontrado" e "a rede caiu" eram a MESMA tela em branco.
// 3. O 404 caia no erro generico, com um "Tentar novamente" que nunca ia resolver.
// 4. O toast de revogacao declarava um fim instantaneo que o memo de 30 s do asset 3D e a
//    clausula 10.3 desmentem.
// 5. Nao havia como ESTENDER uma concessao viva, e o texto mandava "conceder de novo", que
//    o servidor recusa com 409 (e que so seria possivel revogando antes, o que poda a
//    subarvore e nao volta).
//
// COMO ESTE ARQUIVO VERIFICA, e o que cada metade prova. As funcoes puras (`grant-tree.js`)
// sao exercitadas de verdade, com valor de entrada e saida. A TELA e verificada por TEXTO,
// pelo molde de `calibracao-escape-e-repeticao.test.js`: o modal monta innerHTML e a suite
// roda em `node`, entao o que se pode prender aqui e o SITIO (a funcao pura chamada no lugar
// certo, a forma antiga ausente). O helper `linhaUnica` falha alto quando a ancora some ou
// duplica, para que renomear um simbolo derrube o teste em vez de deixa-lo verde e mudo.
//
// CONTROLE NEGATIVO, conferido caso a caso ao escrever: revertendo cada conserto no modal
// (a frase de alcance, o `results.length ? ... : ''`, o ramo por status, o toast antigo, o
// botao de estender e o paragrafo que mandava conceder de novo), o `it()` correspondente
// reprova. Os casos de matcher marcados "controle do matcher" provam que os padroes usados
// para negar de fato casam com a forma ANTIGA, senao a negacao seria cobertura vazia.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    extendGrantHint,
    extensionDeadline,
    extensionOutcome,
    extensionSummary,
    grantsListScopeNote,
    loadFailureState,
    revocationLagNotice,
    revocationSummary,
    searchFailureNotice,
    EXTENSION_OUTCOME,
    LOAD_FAILURE,
    REVOCATION_LAG_MS,
} from '../../src/js/catalog/grant-tree.js';

const PACOTE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MODAL = readFileSync(join(PACOTE, 'src/js/catalog/resource-share.modal.js'), 'utf8');
/** O mesmo texto com o espaco em branco normalizado: a prosa da tela quebra em varias linhas. */
const PROSA = MODAL.replace(/\s+/g, ' ');

/**
 * Devolve a UNICA linha que contem `ancora`, falhando alto quando ela some ou duplica.
 *
 * A forma ingenua (`texto.includes(...)`) fica verde quando o simbolo e renomeado: a
 * verificacao passa a nao verificar nada, que e a cobertura vazia que a casa proibe.
 */
function linhaUnica(texto, ancora, arquivo = 'resource-share.modal.js') {
    const casos = texto.split('\n').filter((l) => l.includes(ancora));
    expect(casos.length, `esperada UMA linha com "${ancora}" em ${arquivo}, achadas ${casos.length}`).toBe(1);
    return casos[0];
}

const DIA_MS = 24 * 60 * 60 * 1000;
/** 2026-08-24T15:00:00Z, um instante fixo para a aritmetica de prazo. */
const AGORA = Date.UTC(2026, 7, 24, 15, 0, 0);

describe('1. o alcance que a lista NAO cobre, dito na propria lista', () => {
    const nota = grantsListScopeNote();

    it('nomeia as tres origens por PAPEL', () => {
        expect(nota).toContain('administradores');
        expect(nota).toContain('credenciados');
        expect(nota).toContain('produtores da OM dona');
    });

    it('e as DUAS que faltavam: o emprestimo por atlas e o visitante de link publico', () => {
        // Sao as que mudam a decisao de quem concede, e as unicas que a listagem nao tem como
        // enumerar (`LIST_GRANTS_FOR_RESOURCE` le so `resource_grants`).
        expect(nota).toMatch(/atlas cujo dono o enxerga/);
        expect(nota).toContain('link público');
    });

    it('diz que revogar uma linha NAO fecha esses caminhos, e onde se fecha', () => {
        // A consequencia e o ponto: sem esta oracao a frase informa e nao muda decisao
        // nenhuma. "Uma negativa sem saida e so um muro" (`groupOwnerCannotLeaveNotice`).
        expect(nota).toContain('não fecha esses dois caminhos');
        expect(nota).toContain('configuração do atlas que empresta');
    });

    it('NAO inventa numero, porque nenhuma rota entrega a contagem ao cliente', () => {
        // `atlasesLendingResource` existe no servidor e nao e exposta. Numero inventado num
        // aviso e a forma de gastar a credibilidade dele no dia em que ele for alto.
        expect(nota).not.toMatch(/\d/);
    });

    it('a tela consome a funcao, e a frase de tres origens saiu', () => {
        expect(linhaUnica(MODAL, 'grantsListScopeNote())')).toContain('escapeHtml');
        expect(PROSA).not.toContain('enxergam este recurso por papel, sem concessão');
    });

    it('controle do matcher: o padrao negado casa com a forma ANTIGA', () => {
        const antigo = 'Administradores, credenciados e produtores da OM dona '
            + 'enxergam este recurso por papel, sem concessão, e não aparecem nesta lista.';
        expect(antigo.replace(/\s+/g, ' ')).toContain('enxergam este recurso por papel, sem concessão');
    });
});

describe('2. busca sem resultado e busca que falhou sao telas diferentes', () => {
    it('a frase da falha nega ausencia por extenso', () => {
        const f = searchFailureNotice();
        expect(f).toContain('não ausência de resultados');
        expect(f).toContain('servidor');
    });

    it('o painel passou a desenhar o VAZIO, em vez de string vazia', () => {
        // Era `results.length ? this._renderResults(results) : ''`, e por causa desse ternario
        // o ramo "Nenhum usuário encontrado" de `_renderResults` era inalcancavel.
        expect(linhaUnica(MODAL, 'container.innerHTML = this._renderResults(')).toContain('Array.isArray(results)');
        expect(MODAL).not.toContain("results.length ? this._renderResults(results) : ''");
        expect(MODAL).toContain('data-testid="resource-share-no-results"');
    });

    it('e o `catch` da busca desenha a FALHA, com nova tentativa da MESMA consulta', () => {
        expect(linhaUnica(MODAL, 'this._renderSearchFailure(q);')).toBeTruthy();
        expect(MODAL).toContain('data-testid="resource-share-search-retry"');
        expect(MODAL).toMatch(/data-action="retry-search"[\s\S]{0,300}?this\._runSearch\(q\)/);
    });

    it('controle do matcher: a forma antiga do painel casa com o padrao negado', () => {
        const antigo = "container.innerHTML = results.length ? this._renderResults(results) : '';";
        expect(antigo).toContain("results.length ? this._renderResults(results) : ''");
    });
});

describe('3. a leitura recusada fala por STATUS, e o 404 nao oferece repetir', () => {
    it('403 nao afirma a causa, e nao oferece nova tentativa', () => {
        const e = loadFailureState(403);
        expect(e.kind).toBe(LOAD_FAILURE.SEM_AUTORIDADE);
        expect(e.retry).toBe(false);
        // A sentenca que saiu era falsa para o credenciado (nao recebeu nada, ve por papel),
        // para o produtor cujo escopo mudou e para quem foi rebaixado com token vivo.
        expect(e.paragrafos.join(' ')).not.toContain('apenas para ver');
        expect(e.paragrafos.join(' ')).toContain('não autorizou você a conceder');
    });

    it('404 diz que o recurso acabou, e TAMBEM nao oferece repetir', () => {
        const e = loadFailureState(404);
        expect(e.kind).toBe(LOAD_FAILURE.SUMIU);
        expect(e.retry).toBe(false);
        expect(e.paragrafos.join(' ')).toContain('não existe mais');
        expect(e.paragrafos.join(' ')).toContain('Não há o que tentar de novo');
    });

    it('o resto (rede, 500, sem status) e o UNICO ramo com nova tentativa', () => {
        for (const status of [undefined, null, 0, 500, 502, 'nada', NaN]) {
            const e = loadFailureState(status);
            expect(e.kind, String(status)).toBe(LOAD_FAILURE.FALHA);
            expect(e.retry, String(status)).toBe(true);
        }
    });

    it('todo ramo devolve pelo menos um paragrafo com texto', () => {
        for (const status of [403, 404, 500, undefined]) {
            const e = loadFailureState(status);
            expect(e.paragrafos.length, String(status)).toBeGreaterThan(0);
            for (const p of e.paragrafos) expect(p.length).toBeGreaterThan(20);
        }
    });

    it('a tela roteia pelo status e so desenha o botao no ramo que o pede', () => {
        expect(linhaUnica(MODAL, 'loadFailureState(error?.status)')).toBeTruthy();
        expect(linhaUnica(MODAL, 'const botao = estado.retry')).toBeTruthy();
        expect(MODAL).toContain('resource-share-gone');
        // O par antigo: dois metodos, um deles com o botao incondicional.
        expect(MODAL).not.toContain('_renderDenied()');
        expect(MODAL).not.toContain('_renderError()');
    });
});

describe('4. o toast da revogacao para de afirmar um fim instantaneo', () => {
    it('o atraso declarado ESPELHA o `TTL_MS` do gate do asset 3D', () => {
        // Espelho estrutural, e nao numero copiado a mao: se o servidor mudar o TTL, este
        // caso reprova e obriga a mexer na frase. Foi a instrucao explicita da tarefa
        // ("confira o valor antes de escrever qualquer numero"), e ela vale como guarda.
        const servidor = readFileSync(
            join(PACOTE, '../backend/src/modules/nomes/assets3d-acesso.js'), 'utf8',
        );
        const achado = /^const TTL_MS = ([\d_]+);/m.exec(servidor);
        expect(achado, 'TTL_MS sumiu de assets3d-acesso.js').not.toBeNull();
        expect(Number(achado[1].replace(/_/g, ''))).toBe(REVOCATION_LAG_MS);
    });

    it('o 3D diz os segundos; os outros tipos nao inventam atraso de memo', () => {
        const tres_d = revocationLagNotice('tileset');
        expect(tres_d).toContain('30 segundos');
        for (const tipo of ['data_layer', 'analysis_layer', 'sv360_project', undefined]) {
            expect(revocationLagNotice(tipo), String(tipo)).not.toContain('30 segundos');
        }
    });

    it('e TODO tipo carrega a clausula 10.3: nao ha empurrao em tempo real', () => {
        for (const tipo of ['tileset', 'data_layer', undefined]) {
            expect(revocationLagNotice(tipo), String(tipo)).toContain('próximo carregamento');
        }
    });

    it('o resumo continua contando a queda do SERVIDOR e as mantidas', () => {
        const t = revocationSummary({
            revoked: [1, 2, 3],
            reparented: [1],
            trimmed: [1],
        }, 'tileset');
        expect(t).toContain('3 concessões caíram junto');
        expect(t).toContain('2 concessões foram mantidas');
        expect(t).toContain('30 segundos');
    });

    it('uma queda so, sem mantidas: nem plural nem zero anunciado', () => {
        const t = revocationSummary({ revoked: [1], reparented: [], trimmed: [] }, 'data_layer');
        expect(t).toContain('Acesso removido.');
        expect(t).not.toContain('caíram junto');
        expect(t).not.toContain('mantida');
        expect(t).not.toMatch(/\b0\b/);
    });

    it('resposta suja nao produz NaN nem promessa', () => {
        for (const r of [null, undefined, {}, { revoked: 'nao-e-lista' }]) {
            const t = revocationSummary(r, 'tileset');
            expect(t, String(r)).toContain('Acesso removido.');
            expect(t).not.toContain('NaN');
        }
    });

    it('a tela usa o resumo com o TIPO do recurso, e o texto antigo saiu', () => {
        expect(linhaUnica(MODAL, 'revocationSummary(resposta, this._type)')).toContain('showSuccess');
        // Montado por concatenacao: escrever a sequencia crua acionaria o
        // `no-template-curly-in-string` do eslint da casa, que esta certo em geral.
        const CIFRAO = '$';
        expect(MODAL).not.toContain(`\`${CIFRAO}{caiu}${CIFRAO}{manteve}\``);
    });
});

describe('5a. o prazo pedido ao estender', () => {
    it('sempre devolve data, inclusive no prazo padrao de um ano', () => {
        // Ao contrario de `vencimentoEmDias`, que devolve nulo no padrao para o servidor
        // decidir: o corpo do PATCH e `{ expiresAt }` e sem data nao se pede nada.
        for (const dias of [7, 30, 90, 180, 365]) {
            expect(typeof extensionDeadline(dias, AGORA), String(dias)).toBe('string');
        }
    });

    it('ancora no meio-dia UTC e cai no dia certo', () => {
        expect(extensionDeadline(7, AGORA)).toBe('2026-08-31T12:00:00.000Z');
        expect(extensionDeadline(365, AGORA)).toBe('2027-08-24T12:00:00.000Z');
    });

    it('e o resultado esta SEMPRE no futuro, inclusive no pior instante do dia', () => {
        // O ancoramento no meio-dia recua o instante; para um dia inteiro de partidas ele
        // nunca recua para tras do agora.
        for (let hora = 0; hora < 24; hora += 1) {
            const t0 = Date.UTC(2026, 7, 24, hora, 59, 59);
            expect(new Date(extensionDeadline(7, t0)).getTime(), `h=${hora}`).toBeGreaterThan(t0);
        }
    });

    it('entrada inutilizavel devolve nulo, e nao uma data qualquer', () => {
        for (const mau of [0, -5, NaN, Infinity, null, undefined, 'trinta', {}]) {
            expect(extensionDeadline(mau, AGORA), String(mau)).toBeNull();
        }
        expect(extensionDeadline(30, NaN)).toBeNull();
        expect(extensionDeadline(30, 'ontem')).toBeNull();
    });
});

describe('5b. o desfecho: o efetivo pode vir MENOR que o pedido', () => {
    const iso = (ms) => new Date(ms).toISOString();

    it('veio o que se pediu: estendido', () => {
        const pedido = extensionDeadline(180, AGORA);
        expect(extensionOutcome({ pedido, efetivo: pedido, anterior: iso(AGORA + DIA_MS) }))
            .toBe(EXTENSION_OUTCOME.ESTENDIDO);
    });

    it('veio menos que o pedido: APARADO pelo teto de quem concedeu', () => {
        // O caso da tarefa: pede 180 dias, recebe 20. Mostrar 180 seria pior que nao ter botao.
        const pedido = extensionDeadline(180, AGORA);
        const efetivo = extensionDeadline(20, AGORA);
        expect(extensionOutcome({ pedido, efetivo, anterior: iso(AGORA + DIA_MS) }))
            .toBe(EXTENSION_OUTCOME.APARADO);
    });

    it('o teto ja era a data atual: INALTERADO, e esse ramo vence o de aparado', () => {
        // Ordem dos ramos: dizer "estendido, porem menos" quando nada mudou afirmaria uma
        // mudanca que nao houve.
        const anterior = extensionDeadline(20, AGORA);
        expect(extensionOutcome({
            pedido: extensionDeadline(180, AGORA), efetivo: anterior, anterior,
        })).toBe(EXTENSION_OUTCOME.INALTERADO);
        // Efetivo ANTES do anterior tambem e "nao mudou para melhor".
        expect(extensionOutcome({
            pedido: extensionDeadline(180, AGORA),
            efetivo: extensionDeadline(10, AGORA),
            anterior,
        })).toBe(EXTENSION_OUTCOME.INALTERADO);
    });

    it('a comparacao e por DIA, que e o que a tela mostra', () => {
        // O teto de um ano do servidor (`NOW() + 1 ano`) cai algumas horas antes dos 365 dias
        // ancorados ao meio-dia UTC. Comparar instantes acusaria aparo em toda extensao normal
        // de um ano, que e o falso positivo mais caro possivel nesta frase.
        const pedido = extensionDeadline(365, AGORA);
        const efetivo = iso(new Date(pedido).getTime() - 3 * 60 * 60 * 1000);
        expect(extensionOutcome({ pedido, efetivo, anterior: iso(AGORA + DIA_MS) }))
            .toBe(EXTENSION_OUTCOME.ESTENDIDO);
    });

    it('sem `anterior` o ramo de inalterado nao se aplica, em vez de comparar com zero', () => {
        const pedido = extensionDeadline(180, AGORA);
        expect(extensionOutcome({ pedido, efetivo: pedido })).toBe(EXTENSION_OUTCOME.ESTENDIDO);
        expect(extensionOutcome({ pedido, efetivo: pedido, anterior: null }))
            .toBe(EXTENSION_OUTCOME.ESTENDIDO);
        expect(extensionOutcome({ pedido, efetivo: pedido, anterior: 'nao-e-data' }))
            .toBe(EXTENSION_OUTCOME.ESTENDIDO);
    });

    it('sem efetivo utilizavel o desfecho e INDETERMINADO, nunca um "estendido" otimista', () => {
        for (const mau of [null, undefined, '', 'amanha', {}]) {
            expect(extensionOutcome({ pedido: extensionDeadline(30, AGORA), efetivo: mau }), String(mau))
                .toBe(EXTENSION_OUTCOME.INDETERMINADO);
        }
        expect(extensionOutcome()).toBe(EXTENSION_OUTCOME.INDETERMINADO);
        expect(extensionOutcome({})).toBe(EXTENSION_OUTCOME.INDETERMINADO);
    });
});

describe('5c. o que o toast de estender diz', () => {
    it('o ramo aparado NOMEIA a data efetiva e diz que veio menos', () => {
        const t = extensionSummary(EXTENSION_OUTCOME.APARADO, '13/09/2026');
        expect(t).toContain('13/09/2026');
        expect(t).toContain('menos do que foi pedido');
    });

    it('o ramo inalterado NAO anuncia extensao nenhuma', () => {
        const t = extensionSummary(EXTENSION_OUTCOME.INALTERADO, '13/09/2026');
        expect(t).toContain('não mudou');
        expect(t).toContain('13/09/2026');
        expect(t).not.toContain('estendido até');
    });

    it('o ramo comum e curto e traz a data', () => {
        expect(extensionSummary(EXTENSION_OUTCOME.ESTENDIDO, '20/02/2027'))
            .toBe('Prazo estendido até 20/02/2027.');
    });

    it('sem data nao se promete "até": todos os ramos degradam para a frase honesta', () => {
        for (const outcome of Object.values(EXTENSION_OUTCOME)) {
            for (const quando of [undefined, null, '', '   ']) {
                const t = extensionSummary(outcome, quando);
                expect(t, `${outcome}/${JSON.stringify(quando)}`).toContain('não informou a nova data');
                expect(t).not.toContain('até ');
            }
        }
    });

    it('a dica do botao nao congela o numero de dias', () => {
        // O `title` e assado no HTML da linha e o seletor de prazo muda sem redesenha-la:
        // um "estender por 30 dias" ali mentiria no instante da troca.
        expect(extendGrantHint()).not.toMatch(/\d/);
        expect(extendGrantHint()).toContain('Conceder acesso');
    });
});

describe('5d. a tela oferece estender onde oferece remover, e parou de mandar conceder de novo', () => {
    it('o botao nasce no MESMO ramo do de remover', () => {
        // Mesmo gate (`revokeAvailability`), porque quem nao pode desfazer a linha tambem nao
        // manda no prazo dela: o servidor redecide com `GRANT_REVOKER_ACTOR`.
        expect(linhaUnica(MODAL, 'const estender = podeRevogar')).toBeTruthy();
        expect(MODAL).toMatch(/const estender = podeRevogar[\s\S]{0,400}?data-action="extend"/);
        expect(MODAL).toContain('data-testid="resource-share-extend"');
    });

    it('e o botao ENTRA na linha, ao lado do nivel e antes do remover', () => {
        // ESTE CASO NASCEU DE UM CONTROLE NEGATIVO QUE PASSOU VERDE: apagar a interpolacao do
        // botao no HTML da linha (deixando a variavel montada e nunca usada) nao derrubava
        // nada, porque o resto do bloco so olhava a construcao. Montar sem inserir e
        // exatamente o defeito que um teste de sitio existe para pegar.
        expect(MODAL).toMatch(/data-testid="resource-share-level">[\s\S]{0,200}?\$\{estender\}/);
        expect(MODAL).toMatch(/\$\{estender\}[\s\S]{0,80}?\$\{acao\}/);
    });

    it('o clique do botao chama o handler com o id DAQUELA linha', () => {
        expect(linhaUnica(MODAL, "row.querySelector('[data-action=\"extend\"]')")).toBeTruthy();
        expect(MODAL).toMatch(/data-action="extend"[\s\S]{0,200}?this\._handleExtend\(grantId\)/);
    });

    it('e a nota de recusa continua ocupando o outro ramo (nada do que ja existia saiu)', () => {
        expect(MODAL).toContain('data-testid="resource-share-revoke-blocked"');
        expect(MODAL).toContain('revocationWarning(this._grants, grantId)');
        expect(MODAL).toContain('data-testid="resource-share-dead"');
        expect(MODAL).toContain('granteeGroupOwnerLabel(grant)');
        expect(MODAL).toContain('newGroupEmptyHint(porta)');
    });

    it('o handler manda o pedido e le o EFETIVO da resposta', () => {
        expect(linhaUnica(MODAL, 'apiClient.extendResourceGrant(grantId, pedido)')).toBeTruthy();
        expect(MODAL).toMatch(/resposta\?\.expiresAt \?\? resposta\?\.expires_at/);
        expect(linhaUnica(MODAL, 'extensionOutcome({')).toBeTruthy();
        expect(MODAL).toMatch(/showSuccess\(extensionSummary\(desfecho, dataCurta\(efetivo\)\)\)/);
    });

    it('o paragrafo aponta para o botao, em vez de mandar fazer o que o servidor recusa', () => {
        expect(PROSA).toContain('use "Estender" na linha da pessoa ou do grupo');
        expect(PROSA).toContain('não é caminho');
        expect(PROSA).not.toContain('para manter, conceda de novo antes da data');
    });

    it('controle do matcher: o paragrafo ANTIGO casa com o padrao negado', () => {
        const antigo = 'Vencido, ele deixa de valer sozinho, sem aviso: para manter, conceda\n'
            + '                    de novo antes da data.';
        expect(antigo.replace(/\s+/g, ' ')).toContain('para manter, conceda de novo antes da data');
    });
});
