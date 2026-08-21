import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * A RE-SOMA QUE JÁ FOI SUPERADA NÃO PODE ATERRISSAR.
 *
 * `refreshVisibleResources` tem uma janela entre o pedido e a resposta, e nessa janela o
 * mundo muda. Os dois disparos por FRAME (`atlas_resources_updated` e, desde a onda 0b,
 * `atlas_owner_changed`) saem sem `await`: o `sync-engine` os larga com `.then()`, então a
 * guarda de `connectionState.isOnline()` que eles carregam roda ANTES do `await` e não
 * diz nada sobre o instante em que a resposta volta.
 *
 * O que isso permitia, e é o motivo deste arquivo:
 *
 *   - LOGOUT NO MEIO DO VOO. O frame chega, a re-soma parte, o usuário sai. O
 *     `logoutAndDisconnect` já é cuidadoso com a re-soma que ELE mesmo dispara
 *     (`resumeGranted: false`, com o motivo escrito lá), mas não tem como cancelar a que
 *     um frame disparou. A resposta voltava e re-somava os privados no `config` de uma
 *     sessão que já não existe: nomes de recurso privado num catálogo anônimo, que é
 *     exatamente o vazamento que o `fileoverview` de `resource-scope.js` descreve.
 *   - ORDEM DE CHEGADA COMO ÁRBITRO. Dois frames em sequência, duas respostas em voo, e
 *     vencia quem RESOLVESSE por último, não quem foi PEDIDO por último. A resposta
 *     velha (de antes da revogação) sobrescrevia a nova e o recurso revogado voltava
 *     para o `config` — a "camada quebrada" que a onda existe para eliminar, agora
 *     produzida pela própria correção.
 *
 * A guarda é um número de pedido monotônico comparado NA VOLTA. É a mesma doutrina do
 * carimbo de escopo do módulo vizinho (comparar na leitura, não sair limpando na
 * saída): quem volta depois de alguém mais novo ter pedido, ou depois de a soma ter sido
 * apagada, simplesmente não aterrissa.
 */

const h = vi.hoisted(() => ({
    /** As respostas represadas: uma entrada por chamada, resolvida à mão pelo caso. */
    pendentes: [],
}));

vi.mock('../../src/js/store/sync/api-client.js', () => ({
    apiClient: {
        getVisibleResources: vi.fn(
            (escopo) => new Promise((resolve) => { h.pendentes.push({ escopo, resolve }); })
        ),
    },
}));

vi.mock('../../src/js/store/sync/atlas-settings.service.js', () => ({
    mergeGrantedIntoBaseline: vi.fn(),
    revertGrantedResources: vi.fn(),
}));

vi.mock('../../src/js/store/sync/session-context.js', () => ({
    sessionContext: { userId: 'user-1', hasGlobalDataAccess: () => false },
}));

const { mergeGrantedIntoBaseline } = await import('../../src/js/store/sync/atlas-settings.service.js');
const {
    refreshVisibleResources,
    clearVisibleResources,
    isPrivateResource,
    _grantedScope,
} = await import('../../src/js/store/sync/resource-access.service.js');

/** @param {string} id @returns {Object} Um payload aditivo com um único tileset privado. */
const payloadCom = (id) => ({
    basemaps: [], tilesets: [{ id, name: id }], dataLayers: [], analysisLayers: [], views360: [],
    shareable: { basemaps: [], tilesets: [], dataLayers: [], analysisLayers: [], views360: [] },
});

describe('re-soma superada não aterrissa', () => {
    beforeEach(() => {
        h.pendentes.length = 0;
        clearVisibleResources();
        mergeGrantedIntoBaseline.mockClear();
    });

    it('PISO: sem nada intervindo, a re-soma aterrissa normalmente', async () => {
        // Sem esta metade, todos os "não aterrissou" abaixo seriam satisfeitos por um
        // serviço que nunca soma nada, que é a cobertura vazia da constituição.
        const voo = refreshVisibleResources('atlas-1');
        expect(h.pendentes).toHaveLength(1);
        h.pendentes[0].resolve(payloadCom('priv-3d'));

        expect(await voo).toBe(true);
        expect(mergeGrantedIntoBaseline).toHaveBeenCalledTimes(1);
        expect(isPrivateResource('tilesets', 'priv-3d')).toBe(true);
        expect(_grantedScope()).toBe('atlas-1');
    });

    it('a resposta que volta DEPOIS do logout não re-soma nada', async () => {
        const voo = refreshVisibleResources('atlas-1');
        expect(h.pendentes).toHaveLength(1);

        // O logout, no meio do voo. `clearVisibleResources` é o que o
        // `logoutAndDisconnect` chama depois de apagar a sessão.
        clearVisibleResources();
        mergeGrantedIntoBaseline.mockClear();

        h.pendentes[0].resolve(payloadCom('priv-3d'));

        expect(await voo).toBe(false);
        expect(mergeGrantedIntoBaseline).not.toHaveBeenCalled();
        // O observável que importa: o nome do recurso privado não volta ao catálogo.
        expect(isPrivateResource('tilesets', 'priv-3d')).toBe(false);
        // E a soma continua declarando que NÃO houve soma nenhuma.
        expect(_grantedScope()).toBeUndefined();
    });

    it('vence quem foi PEDIDO por último, não quem RESOLVEU por último', async () => {
        // Dois frames em sequência: `atlas_resources_updated` e `atlas_owner_changed`
        // podem chegar juntos, e nenhum dos dois handlers espera pelo outro.
        const velho = refreshVisibleResources('atlas-1');
        const novo = refreshVisibleResources('atlas-1');
        expect(h.pendentes).toHaveLength(2);

        // A resposta NOVA chega primeiro; a VELHA (de antes da revogação) chega depois.
        h.pendentes[1].resolve(payloadCom('depois-da-revogacao'));
        h.pendentes[0].resolve(payloadCom('antes-da-revogacao'));

        expect(await novo).toBe(true);
        expect(await velho).toBe(false);
        expect(isPrivateResource('tilesets', 'depois-da-revogacao')).toBe(true);
        expect(isPrivateResource('tilesets', 'antes-da-revogacao')).toBe(false);
    });

    it('DISCRIMINAÇÃO: duas somas SEQUENCIAIS continuam ambas valendo', async () => {
        // O vizinho que a guarda não pode matar: chamadas em série (login, connect, troca
        // de atlas) não se superam, e a segunda tem de substituir a primeira de verdade.
        const primeira = refreshVisibleResources('atlas-1');
        h.pendentes[0].resolve(payloadCom('do-atlas-1'));
        expect(await primeira).toBe(true);
        expect(isPrivateResource('tilesets', 'do-atlas-1')).toBe(true);

        const segunda = refreshVisibleResources('atlas-2');
        h.pendentes[1].resolve(payloadCom('do-atlas-2'));
        expect(await segunda).toBe(true);
        expect(isPrivateResource('tilesets', 'do-atlas-2')).toBe(true);
        expect(isPrivateResource('tilesets', 'do-atlas-1')).toBe(false);
        expect(_grantedScope()).toBe('atlas-2');
    });
});
