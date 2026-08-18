import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * O ÍNDICE DO PAYLOAD ADITIVO, do lado do cliente.
 *
 * Duas perguntas que a interface faz por cartão do catálogo, e nenhuma delas tem
 * resposta no item:
 *
 *   - "este item é PRIVADO?" — `config` não carrega `access_level`, porque aquele
 *     documento é o PÚBLICO e igual para todo chamador. O que o cliente sabe é que
 *     o id veio pelo payload aditivo, que devolve SÓ o privado visível.
 *   - "eu posso REPASSAR este item?" — papel global (admin e credenciado concedem
 *     de raiz) OU concessão viva de `view_share`. Errar para MENOS esconde um botão;
 *     errar para MAIS oferece um formulário que o servidor recusa em 403.
 *
 * O papel global entra aqui por UM predicado só, `hasGlobalDataAccess()`, e é ele que o
 * duplo abaixo estampa. Quem responde por QUAIS papéis esse predicado cobre (hoje
 * administrador e credenciado, e deliberadamente NÃO o produtor) é
 * `tests/unit/session-context.test.js`: um duplo que trocasse de papel aqui estaria
 * medindo a segunda cópia da regra, e é a segunda cópia que envelhece errada.
 */

const h = vi.hoisted(() => ({
    payload: {
        tilesets: [{ id: 'priv-3d', name: 'Modelo restrito' }],
        dataLayers: [{ id: 'priv-data', name: 'Camada restrita' }],
        analysisLayers: [],
        views360: [{ id: 'uuid-360', name: 'Panorama restrito' }],
        shareable: { tilesets: ['priv-3d'], dataLayers: [], analysisLayers: [], views360: [] },
    },
    global: { valor: false },
}));

vi.mock('../../src/js/store/sync/api-client.js', () => ({
    apiClient: { getVisibleResources: vi.fn(async () => h.payload) },
}));

vi.mock('../../src/js/store/sync/atlas-settings.service.js', () => ({
    // A soma no `config` é assunto de `recursos-concedidos-overlay.test.js`; aqui
    // mede-se só o índice, e um duplo mede duas coisas ao mesmo tempo.
    mergeGrantedIntoBaseline: vi.fn(),
    revertGrantedResources: vi.fn(),
}));

vi.mock('../../src/js/store/sync/session-context.js', () => ({
    sessionContext: { hasGlobalDataAccess: () => h.global.valor },
}));

const {
    refreshVisibleResources,
    clearVisibleResources,
    isPrivateResource,
    canShareResource,
} = await import('../../src/js/store/sync/resource-access.service.js');

describe('índice dos recursos privados visíveis', () => {
    beforeEach(async () => {
        h.global.valor = false;
        clearVisibleResources();
    });

    it('antes da primeira soma, nada é privado e nada é compartilhável', () => {
        // Fecha por padrão: sem payload, o catálogo é o público e não há botão.
        expect(isPrivateResource('tilesets', 'priv-3d')).toBe(false);
        expect(canShareResource('tilesets', 'priv-3d')).toBe(false);
    });

    it('depois da soma, só os ids que o servidor mandou são privados', async () => {
        expect(await refreshVisibleResources(null)).toBe(true);

        expect(isPrivateResource('tilesets', 'priv-3d')).toBe(true);
        expect(isPrivateResource('dataLayers', 'priv-data')).toBe(true);
        expect(isPrivateResource('views360', 'uuid-360')).toBe(true);
        // O par (grupo, id) importa: o mesmo id noutro grupo é outro recurso.
        expect(isPrivateResource('analysisLayers', 'priv-data')).toBe(false);
        expect(isPrivateResource('tilesets', 'publico-3d')).toBe(false);
        expect(isPrivateResource('grupo-que-nao-existe', 'priv-3d')).toBe(false);
        expect(isPrivateResource('tilesets', null)).toBe(false);
    });

    it('compartilhar segue a lista `shareable`, e NÃO a de recursos visíveis', async () => {
        await refreshVisibleResources(null);
        // Este é o par que dá sentido ao teste: os dois são privados e visíveis, e
        // só um pode ser repassado. Sem o segundo, "devolve true" também passaria
        // numa implementação que confundisse ver com poder ceder.
        expect(canShareResource('tilesets', 'priv-3d')).toBe(true);
        expect(canShareResource('dataLayers', 'priv-data')).toBe(false);
    });

    it('papel global compartilha tudo, sem concessão nenhuma', async () => {
        await refreshVisibleResources(null);
        expect(canShareResource('dataLayers', 'priv-data')).toBe(false);
        h.global.valor = true;
        expect(canShareResource('dataLayers', 'priv-data')).toBe(true);
        // Mas o eixo de PRIVACIDADE não muda com o papel: quem vê tudo continua
        // vendo o que é público como público.
        expect(isPrivateResource('tilesets', 'publico-3d')).toBe(false);
    });

    it('um payload SEM `shareable` não promove ninguém', async () => {
        // O visitante de link público recebe os grupos vazios; uma resposta antiga
        // (ou truncada) simplesmente não traz a chave. As duas precisam degradar
        // para "não pode repassar", nunca para "pode".
        h.payload = { tilesets: [{ id: 'priv-3d', name: 'x' }] };
        await refreshVisibleResources(null);
        expect(isPrivateResource('tilesets', 'priv-3d')).toBe(true);
        expect(canShareResource('tilesets', 'priv-3d')).toBe(false);
    });

    it('a soma nova SUBSTITUI a anterior, e o logout apaga as duas listas', async () => {
        h.payload = {
            tilesets: [{ id: 'do-atlas', name: 'Emprestado' }],
            shareable: { tilesets: ['do-atlas'] },
        };
        await refreshVisibleResources('atlas-1');
        expect(isPrivateResource('tilesets', 'do-atlas')).toBe(true);

        // Sair de um atlas que empresta e entrar noutro que não empresta precisa
        // TIRAR o que o primeiro deu.
        h.payload = { tilesets: [] };
        await refreshVisibleResources('atlas-2');
        expect(isPrivateResource('tilesets', 'do-atlas')).toBe(false);
        expect(canShareResource('tilesets', 'do-atlas')).toBe(false);
    });

    it('uma falha de rede não deixa o índice anterior de pé', async () => {
        h.payload = { tilesets: [{ id: 'priv-3d', name: 'x' }], shareable: { tilesets: ['priv-3d'] } };
        await refreshVisibleResources(null);
        expect(isPrivateResource('tilesets', 'priv-3d')).toBe(true);

        clearVisibleResources();
        expect(isPrivateResource('tilesets', 'priv-3d')).toBe(false);
        expect(canShareResource('tilesets', 'priv-3d')).toBe(false);
    });
});
