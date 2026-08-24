// Path: tests/unit/acervo-privado-aviso.test.js
//
// O ACERVO PRIVADO QUE NÃO CARREGOU, E O AVISO QUE ANTES NÃO EXISTIA.
//
// O DEFEITO MEDIDO. `refreshVisibleResources` é best-effort por desenho: o `catch` devolve
// `false` e não propaga, e os três chamadores (login, abertura de atlas e boot) descartam o
// retorno. Falhada a PRIMEIRA soma da sessão, `_privados` fica vazio e assim permanece: para
// uma conta `credenciado`, que lê todo recurso privado do acervo, `isPrivateResource` passa a
// responder `false` para tudo, nenhum cartão mostra "Privado", a ação "Compartilhar" some
// (ela é gateada por `privado && canShareResource`) e o catálogo fica idêntico ao de um
// visitante anônimo, com o papel intacto e sem uma linha na tela.
//
// A ARMADILHA QUE FAZ O CONSERTO INGÊNUO NÃO CONSERTAR NADA. `retryVisibleResources` começa
// por `if (_escopo !== undefined) return true;`, e `_escopo` só é escrito no SUCESSO. Depois
// de uma soma boa, uma soma POSTERIOR que falhe (a troca de atlas é o caso comum) deixa o
// escopo antigo de pé, e a retentativa responde "está tudo bem" sem pedir nada ao servidor.
// Um botão "Tentar de novo" pendurado nela seria um botão que não faz nada, exatamente no
// caso em que a pessoa mais precisa dele. O caso `NÃO PEDE NADA` abaixo é o que prende isso,
// e ele assere a CONTAGEM DE CHAMADAS, não o booleano: o booleano é `true` nos dois modos.
//
// O `false` COBRE QUATRO DESFECHOS E SÓ UM É FALHA. Servidor inalcançável (falha), pedido
// superado por outro mais novo e soma apagada no meio do voo (os dois últimos são o fim
// normal de uma corrida). Acender o aviso nos dois últimos faria a tela acusar erro a cada
// troca rápida de atlas e a cada logout, que é como se ensina alguém a ignorar avisos. Os
// dois contadores independentes do serviço são o que permite distingui-los, e o caso
// `apagada != superada` é o único lugar que prova que são dois e não um.

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
    RESOURCE_NOTICE_TONE,
    ResourceSumOutcome,
    resourceAccessDegradedAfter,
    resourceAccessNotice,
} from '../../src/js/store/sync/resource-access-phrases.js';

// ============================================================================
// (1) O MÓDULO FOLHA: a distinção e a frase, sem uma linha de rede
// ============================================================================

describe('resourceAccessDegradedAfter: só UM dos quatro desfechos é falha', () => {
    it('APPLIED abaixa o sinal, venha de onde vier', () => {
        expect(resourceAccessDegradedAfter(true, ResourceSumOutcome.APPLIED)).toBe(false);
        expect(resourceAccessDegradedAfter(false, ResourceSumOutcome.APPLIED)).toBe(false);
    });

    it('FAILED levanta o sinal, venha de onde vier', () => {
        expect(resourceAccessDegradedAfter(false, ResourceSumOutcome.FAILED)).toBe(true);
        expect(resourceAccessDegradedAfter(true, ResourceSumOutcome.FAILED)).toBe(true);
    });

    it('SUPERSEDED e CLEARED NÃO afirmam nada: carregam o valor anterior', () => {
        // Este é o caso que impede a tela de acusar erro a cada troca de atlas e a cada
        // logout. Se algum dia ele virar `false`, o aviso apagará sozinho uma falha real
        // assim que a pessoa trocar de atlas; se virar `true`, acusará erro no caminho
        // normal do produto.
        for (const desfecho of [ResourceSumOutcome.SUPERSEDED, ResourceSumOutcome.CLEARED]) {
            expect(resourceAccessDegradedAfter(false, desfecho)).toBe(false);
            expect(resourceAccessDegradedAfter(true, desfecho)).toBe(true);
        }
    });

    it('desfecho que este build não conhece também carrega o anterior', () => {
        // Falha aberta seria desligar o aviso no dia em que alguém acrescentar um quinto
        // desfecho; falha fechada seria acendê-lo para uma corrida normal. Não afirmar nada
        // é o único ramo que não inventa.
        expect(resourceAccessDegradedAfter(true, 'inventado-amanha')).toBe(true);
        expect(resourceAccessDegradedAfter(false, 'inventado-amanha')).toBe(false);
        expect(resourceAccessDegradedAfter(false, undefined)).toBe(false);
    });

    it('os quatro desfechos são strings distintas', () => {
        // Sem isto, dois valores colididos fariam todas as asserções acima passar com dois
        // ramos fundidos.
        const valores = Object.values(ResourceSumOutcome);
        expect(valores).toHaveLength(4);
        expect(new Set(valores).size).toBe(4);
    });
});

describe('resourceAccessNotice: o que a tela diz, e para quem', () => {
    it('anônimo NUNCA vê o aviso, nem com o sinal levantado', () => {
        // Quem nunca entrou não perdeu nada: o catálogo público É o catálogo dele. Acusar
        // erro aqui seria o caso mais comum de todos, que é como um aviso vira papel de parede.
        expect(resourceAccessNotice({ authenticated: false, degraded: true })).toBeNull();
        expect(resourceAccessNotice({ degraded: true })).toBeNull();
        expect(resourceAccessNotice()).toBeNull();
    });

    it('autenticado e sem falha não vê aviso nenhum', () => {
        expect(resourceAccessNotice({ authenticated: true, degraded: false })).toBeNull();
        expect(resourceAccessNotice({ authenticated: true })).toBeNull();
    });

    it('autenticado com falha vê rótulo curto, frase longa e AÇÃO', () => {
        const aviso = resourceAccessNotice({ authenticated: true, degraded: true });
        expect(aviso).not.toBeNull();
        expect(aviso.label.length).toBeGreaterThan(0);
        expect(aviso.actionLabel).toBe('Tentar de novo');
        expect(aviso.tone).toBe(RESOURCE_NOTICE_TONE.WARN);
    });

    it('a frase diz o EFEITO e afirma que a conta está intacta', () => {
        const { detail } = resourceAccessNotice({ authenticated: true, degraded: true });
        // O que a pessoa perdeu, nas palavras dela.
        expect(detail).toMatch(/catálogo/i);
        expect(detail).toMatch(/público/i);
        // A metade que só a tela sabe: nada foi tirado de ninguém.
        expect(detail).toMatch(/permissões continuam/i);
        // E NUNCA a causa técnica. Um endpoint, um 500 ou um token não são coisas sobre as
        // quais quem lê possa fazer alguma coisa, e nenhum deles é o que aconteceu com ela.
        expect(detail).not.toMatch(/endpoint|http|token|500|api|json/i);
    });

    it('reparo em curso troca o tom e RETIRA a ação', () => {
        const aviso = resourceAccessNotice({ authenticated: true, degraded: true, repairing: true });
        expect(aviso.tone).toBe(RESOURCE_NOTICE_TONE.BUSY);
        // `null` e não uma string vazia: o chamador decide por ele se há algo a oferecer.
        expect(aviso.actionLabel).toBeNull();
        expect(aviso.label).not.toBe(
            resourceAccessNotice({ authenticated: true, degraded: true }).label
        );
    });

    it('sem prosa com em-dash em nenhuma frase', () => {
        for (const entrada of [{ repairing: true }, { repairing: false }]) {
            const aviso = resourceAccessNotice({ authenticated: true, degraded: true, ...entrada });
            expect(aviso.detail).not.toMatch(/—/);
            expect(aviso.label).not.toMatch(/—/);
        }
    });
});

// ============================================================================
// (2) O SERVIÇO: os desfechos, o sinal de saúde, o reparo e a procedência
// ============================================================================

const h = vi.hoisted(() => ({
    /** Um resolvedor por chamada em voo, para dirigir a corrida à mão. */
    voos: [],
    autenticado: true,
}));

vi.mock('../../src/js/store/sync/api-client.js', () => ({
    apiClient: {
        getVisibleResources: vi.fn(
            (escopo) => new Promise((resolve, reject) => { h.voos.push({ escopo, resolve, reject }); })
        ),
    },
}));

vi.mock('../../src/js/store/sync/atlas-settings.service.js', () => ({
    // A soma no `config` é assunto de `recursos-concedidos-overlay.test.js`.
    mergeGrantedIntoBaseline: vi.fn(),
    revertGrantedResources: vi.fn(),
}));

vi.mock('../../src/js/store/sync/session-context.js', () => ({
    sessionContext: {
        userId: 'user-1',
        hasGlobalDataAccess: () => false,
        isAuthenticated: () => h.autenticado,
    },
}));

const { apiClient } = await import('../../src/js/store/sync/api-client.js');
const {
    RESOURCE_ORIGIN,
    clearVisibleResources,
    isPrivateResource,
    isResourceAccessDegraded,
    lastResourceSumOutcome,
    onResourceAccessHealthChanged,
    refreshVisibleResources,
    resourceAccessOrigin,
    retryVisibleResources,
} = await import('../../src/js/store/sync/resource-access.service.js');

/**
 * Um payload aditivo com um tileset privado e, opcionalmente, a procedência dele.
 * @param {string} id @param {string} [origem]
 */
function payloadCom(id, origem) {
    const base = {
        basemaps: [], tilesets: [{ id, name: id }], dataLayers: [], analysisLayers: [], views360: [],
        shareable: { basemaps: [], tilesets: [], dataLayers: [], analysisLayers: [], views360: [] },
    };
    if (origem === undefined) return base;
    return {
        ...base,
        origins: {
            basemaps: {}, tilesets: { [id]: origem }, dataLayers: {}, analysisLayers: {}, views360: {},
        },
    };
}

describe('o sinal de saúde da soma de recursos privados', () => {
    beforeEach(() => {
        h.voos.length = 0;
        h.autenticado = true;
        clearVisibleResources();
        apiClient.getVisibleResources.mockClear();
    });

    it('PISO: a soma que aterrissa deixa o sinal BAIXO', async () => {
        // Sem esta metade, todo "levantou o sinal" abaixo seria satisfeito por um serviço
        // que levanta o sinal sempre.
        const voo = refreshVisibleResources('atlas-1');
        h.voos[0].resolve(payloadCom('priv-3d'));
        expect(await voo).toBe(true);
        expect(lastResourceSumOutcome()).toBe(ResourceSumOutcome.APPLIED);
        expect(isResourceAccessDegraded()).toBe(false);
        expect(isPrivateResource('tilesets', 'priv-3d')).toBe(true);
    });

    it('servidor inalcançável levanta o sinal e nomeia o desfecho FAILED', async () => {
        const voo = refreshVisibleResources('atlas-1');
        h.voos[0].reject(new Error('network'));
        expect(await voo).toBe(false);
        expect(lastResourceSumOutcome()).toBe(ResourceSumOutcome.FAILED);
        expect(isResourceAccessDegraded()).toBe(true);
    });

    it('pedido SUPERADO por outro mais novo não levanta o sinal', async () => {
        const velho = refreshVisibleResources('atlas-1');
        const novo = refreshVisibleResources('atlas-2');
        expect(h.voos).toHaveLength(2);

        // O velho falha DEPOIS de já ter sido superado: é o 401/abort de uma requisição que
        // ninguém mais espera, não uma avaria a relatar.
        h.voos[0].reject(new Error('superado'));
        expect(await velho).toBe(false);
        expect(lastResourceSumOutcome()).toBe(ResourceSumOutcome.SUPERSEDED);
        expect(isResourceAccessDegraded()).toBe(false);

        h.voos[1].resolve(payloadCom('priv-3d'));
        expect(await novo).toBe(true);
        expect(isResourceAccessDegraded()).toBe(false);
    });

    it('soma APAGADA no meio do voo não levanta o sinal, e não é "superada"', async () => {
        // ESTE É O CASO QUE PROVA QUE SÃO DOIS CONTADORES. `clearVisibleResources` incrementa
        // o número de pedido junto com o de limpezas, então uma implementação com um contador
        // só chamaria isto de SUPERSEDED. As duas leituras não acendem o aviso, mas só uma
        // delas é verdade, e é ela que um diagnóstico precisa ler.
        const voo = refreshVisibleResources('atlas-1');
        clearVisibleResources();
        h.voos[0].reject(new Error('logout no meio do voo'));
        expect(await voo).toBe(false);
        expect(lastResourceSumOutcome()).toBe(ResourceSumOutcome.CLEARED);
        expect(isResourceAccessDegraded()).toBe(false);
    });

    it('logout ABAIXA um sinal já levantado', async () => {
        const voo = refreshVisibleResources('atlas-1');
        h.voos[0].reject(new Error('network'));
        await voo;
        expect(isResourceAccessDegraded()).toBe(true);

        clearVisibleResources();
        // Não há mais acervo privado a carregar, e o reparo recusaria por falta de sessão:
        // um aviso que sobrevive ao fato que o motivou é como se aprende a ignorá-lo.
        expect(isResourceAccessDegraded()).toBe(false);
        expect(lastResourceSumOutcome()).toBeNull();
    });

    it('o assinante é acordado só na VIRADA', async () => {
        const visto = [];
        const cancelar = onResourceAccessHealthChanged((v) => visto.push(v));

        const bom = refreshVisibleResources(null);
        h.voos[0].resolve(payloadCom('priv-3d'));
        await bom;
        expect(visto).toEqual([]); // já estava baixo: não é notícia.

        const ruim = refreshVisibleResources(null);
        h.voos[1].reject(new Error('network'));
        await ruim;
        expect(visto).toEqual([true]);

        const outraRuim = refreshVisibleResources(null);
        h.voos[2].reject(new Error('network'));
        await outraRuim;
        expect(visto).toEqual([true]); // continua ruim: também não é notícia.

        cancelar();
        const volta = refreshVisibleResources(null);
        h.voos[3].resolve(payloadCom('priv-3d'));
        await volta;
        expect(visto).toEqual([true]); // cancelado, não recebe a virada de volta.
        expect(isResourceAccessDegraded()).toBe(false);
    });
});

describe('o reparo: retryVisibleResources e o curto-circuito', () => {
    beforeEach(() => {
        h.voos.length = 0;
        h.autenticado = true;
        clearVisibleResources();
        apiClient.getVisibleResources.mockClear();
    });

    /** Uma soma boa seguida de uma soma que falha: o estado exato da armadilha. */
    async function somaBoaDepoisFalha() {
        const bom = refreshVisibleResources('atlas-1');
        h.voos[0].resolve(payloadCom('priv-3d'));
        await bom;
        const ruim = refreshVisibleResources('atlas-2');
        h.voos[1].reject(new Error('network'));
        await ruim;
    }

    it('SEM force, depois de uma soma boa e uma ruim, NÃO PEDE NADA ao servidor', async () => {
        await somaBoaDepoisFalha();
        expect(isResourceAccessDegraded()).toBe(true);
        apiClient.getVisibleResources.mockClear();

        // O booleano mente aqui, e é por isso que a asserção é a contagem de chamadas: o
        // `true` sai do curto-circuito `_escopo !== undefined`, que só sabe que ALGUMA soma
        // deu certo em algum momento. Um botão ligado nisto não faria nada.
        expect(await retryVisibleResources()).toBe(true);
        expect(apiClient.getVisibleResources).not.toHaveBeenCalled();
        expect(isResourceAccessDegraded()).toBe(true);
    });

    it('COM force, pede de novo e no ESCOPO do último pedido', async () => {
        await somaBoaDepoisFalha();
        apiClient.getVisibleResources.mockClear();

        const reparo = retryVisibleResources({ force: true });
        expect(apiClient.getVisibleResources).toHaveBeenCalledTimes(1);
        // `_escopoPedido`, e não `_escopo`: o que se refaz é o ÚLTIMO PEDIDO, que é o que
        // falhou, e não a última soma bem-sucedida.
        expect(h.voos[h.voos.length - 1].escopo).toBe('atlas-2');

        h.voos[h.voos.length - 1].resolve(payloadCom('priv-outro'));
        expect(await reparo).toBe(true);
        expect(isResourceAccessDegraded()).toBe(false);
        expect(isPrivateResource('tilesets', 'priv-outro')).toBe(true);
    });

    it('o reparo que falha de novo mantém o sinal levantado', async () => {
        await somaBoaDepoisFalha();
        const reparo = retryVisibleResources({ force: true });
        h.voos[h.voos.length - 1].reject(new Error('ainda sem rede'));
        expect(await reparo).toBe(false);
        expect(isResourceAccessDegraded()).toBe(true);
    });

    it('sem sessão, o reparo recusa sem tocar na rede', async () => {
        h.autenticado = false;
        apiClient.getVisibleResources.mockClear();
        expect(await retryVisibleResources({ force: true })).toBe(false);
        expect(apiClient.getVisibleResources).not.toHaveBeenCalled();
    });
});

describe('resourceAccessOrigin: a procedência, e o null que não quebra nada', () => {
    beforeEach(() => {
        h.voos.length = 0;
        h.autenticado = true;
        clearVisibleResources();
        apiClient.getVisibleResources.mockClear();
    });

    /** @param {Object} payload */
    async function somar(payload) {
        const voo = refreshVisibleResources('atlas-1');
        h.voos[h.voos.length - 1].resolve(payload);
        await voo;
    }

    it('lê as três procedências do vocabulário', async () => {
        for (const origem of Object.values(RESOURCE_ORIGIN)) {
            await somar(payloadCom('priv-3d', origem));
            expect(resourceAccessOrigin('tilesets', 'priv-3d')).toBe(origem);
        }
        expect(Object.values(RESOURCE_ORIGIN)).toEqual(['papel', 'concessao', 'emprestimo']);
    });

    it('servidor antigo (sem `origins`) devolve null, com o resto do índice intacto', async () => {
        await somar(payloadCom('priv-3d'));
        // O recurso continua sendo privado: a procedência é informação a MAIS, e a sua
        // ausência não pode apagar a resposta que já existia.
        expect(isPrivateResource('tilesets', 'priv-3d')).toBe(true);
        expect(resourceAccessOrigin('tilesets', 'priv-3d')).toBeNull();
    });

    it('procedência que este build não conhece vira null, e não chega crua à tela', async () => {
        await somar(payloadCom('priv-3d', 'delegacao-inventada-amanha'));
        expect(resourceAccessOrigin('tilesets', 'priv-3d')).toBeNull();
    });

    it('id ausente, grupo ausente e argumentos vazios devolvem null', async () => {
        await somar(payloadCom('priv-3d', RESOURCE_ORIGIN.PAPEL));
        expect(resourceAccessOrigin('tilesets', 'nunca-visto')).toBeNull();
        expect(resourceAccessOrigin('grupoInventado', 'priv-3d')).toBeNull();
        expect(resourceAccessOrigin('', 'priv-3d')).toBeNull();
        expect(resourceAccessOrigin('tilesets', null)).toBeNull();
        expect(resourceAccessOrigin('tilesets', undefined)).toBeNull();
    });

    it('id numérico casa com a chave string do payload', async () => {
        await somar({
            basemaps: [], tilesets: [{ id: 7 }], dataLayers: [], analysisLayers: [], views360: [],
            shareable: {
                basemaps: [], tilesets: [], dataLayers: [], analysisLayers: [], views360: [],
            },
            origins: {
                basemaps: {}, tilesets: { 7: RESOURCE_ORIGIN.CONCESSAO }, dataLayers: {},
                analysisLayers: {}, views360: {},
            },
        });
        expect(resourceAccessOrigin('tilesets', 7)).toBe(RESOURCE_ORIGIN.CONCESSAO);
        expect(resourceAccessOrigin('tilesets', '7')).toBe(RESOURCE_ORIGIN.CONCESSAO);
    });

    it('a limpeza esvazia o índice de procedência junto com os outros dois', async () => {
        await somar(payloadCom('priv-3d', RESOURCE_ORIGIN.EMPRESTIMO));
        expect(resourceAccessOrigin('tilesets', 'priv-3d')).toBe(RESOURCE_ORIGIN.EMPRESTIMO);
        clearVisibleResources();
        // Pela mesma razão dos outros dois: procedência é resposta decidida sob a sessão que
        // acabou, e um selo "emprestado por este atlas" num catálogo anônimo é o vazamento
        // que a limpeza existe para impedir.
        expect(resourceAccessOrigin('tilesets', 'priv-3d')).toBeNull();
        expect(isPrivateResource('tilesets', 'priv-3d')).toBe(false);
    });
});
