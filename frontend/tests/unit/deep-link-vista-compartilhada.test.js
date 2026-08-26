// Path: tests/unit/deep-link-vista-compartilhada.test.js

/**
 * @fileoverview O ABRIDOR do link de camada base, acionado de verdade.
 *
 * Os outros dois arquivos prendem a gramática (texto vira descritor, descritor vira
 * texto). Este aciona `handleDeepLink` com um hash real e observa o que ele FAZ, que
 * é a metade que uma gramática correta não garante: um leitor perfeito ligado a um
 * abridor que não é chamado dá uma tela que não muda e um teste verde.
 *
 * As duas propriedades que o app não pode perder, e que só se veem aqui:
 *   - abrir link de outra pessoa NÃO PERSISTE a camada base (é visita, não edição);
 *   - a troca por indisponibilidade é ANUNCIADA, senão a pessoa recebe um mapa com
 *     cara do que lhe mandaram e que não é ele.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const getControl = vi.fn();
const showError = vi.fn();
const showSuccess = vi.fn();

vi.mock('@store', () => ({ getControl: (...a) => getControl(...a) }));
vi.mock('@utils', () => ({
    showError: (...a) => showError(...a),
    showSuccess: (...a) => showSuccess(...a),
}));

const original = globalThis.window;

/**
 * Monta o dublê do controle de camada base e do mapa.
 * @param {string} [aplicada] - O id que `applySharedBasemap` devolve; por padrão devolve o pedido.
 */
function dublarControle(aplicada = null) {
    const map = { jumpTo: vi.fn() };
    const control = {
        map,
        applySharedBasemap: vi.fn(async (pedida) => aplicada ?? pedida),
    };
    getControl.mockImplementation((nome) => (nome === 'BaseLayerControl' ? control : null));
    return { control, map };
}

/** Instala o endereço e devolve `handleDeepLink` já carregado. */
async function comHash(hash) {
    globalThis.window = {
        location: { hash, search: '', pathname: '/', origin: 'https://ebgeo.exemplo' },
    };
    // `clearHash` chama `history.replaceState`: sem isto o abridor morre antes de agir,
    // e o teste mediria a ausência do history, não o comportamento.
    globalThis.history = { replaceState: vi.fn() };
    return (await import('@js/deep-link/deep-link.js')).handleDeepLink;
}

beforeEach(() => {
    getControl.mockReset();
    showError.mockReset();
    showSuccess.mockReset();
});
afterEach(() => { globalThis.window = original; });

describe('link de camada base: o que ele faz ao ser aberto', () => {
    it('aplica a camada pedida e leva a câmera ao ponto do link', async () => {
        const { control, map } = dublarControle();
        const handleDeepLink = await comHash('#view=base&base=bdgex&lon=-43.18&lat=-22.97&z=14.5&b=30&p=45');

        await handleDeepLink();

        expect(control.applySharedBasemap).toHaveBeenCalledWith('bdgex');
        expect(map.jumpTo).toHaveBeenCalledWith({
            center: [-43.18, -22.97], zoom: 14.5, bearing: 30, pitch: 45,
        });
        expect(showError).not.toHaveBeenCalled();
    });

    it('omite da câmera o que o link não disse, em vez de zerar', async () => {
        const { map } = dublarControle();
        const handleDeepLink = await comHash('#view=base&lon=-43.18&lat=-22.97');

        await handleDeepLink();

        // Sem chave de zoom, orientação ou inclinação: o destinatário fica com as
        // dele. Passar zero seria apontar a câmera para o norte e para o horizonte
        // sem ninguém ter pedido, e com cara de intenção.
        expect(map.jumpTo).toHaveBeenCalledWith({ center: [-43.18, -22.97] });
    });

    it('troca só a camada quando o link não traz posição', async () => {
        const { control, map } = dublarControle();
        const handleDeepLink = await comHash('#view=base&base=osm');

        await handleDeepLink();

        expect(control.applySharedBasemap).toHaveBeenCalledWith('osm');
        expect(map.jumpTo).not.toHaveBeenCalled();
    });

    it('ANUNCIA a troca quando a camada do link não está disponível', async () => {
        const { control } = dublarControle('carta-topografica');
        const handleDeepLink = await comHash('#view=base&base=camada-que-nao-existe&lon=1&lat=2');

        await handleDeepLink();

        expect(control.applySharedBasemap).toHaveBeenCalledWith('camada-que-nao-existe');
        expect(showError).toHaveBeenCalledTimes(1);
        // A frase nomeia a camada que ESTÁ na tela, que é a parte acionável.
        expect(showError.mock.calls[0][0]).toContain('carta-topografica');
    });

    it('cala quando a camada aplicada é a pedida', async () => {
        dublarControle('bdgex');
        const handleDeepLink = await comHash('#view=base&base=bdgex&lon=1&lat=2');

        await handleDeepLink();

        expect(showError).not.toHaveBeenCalled();
    });

    it('acusa, em vez de estourar, quando o mapa ainda não existe', async () => {
        getControl.mockReturnValue(null);
        const handleDeepLink = await comHash('#view=base&base=osm&lon=1&lat=2');

        await expect(handleDeepLink()).resolves.toBeUndefined();
        expect(showError).toHaveBeenCalledTimes(1);
    });

    it('não toca no mapa quando o hash não é um link de vista', async () => {
        const { control, map } = dublarControle();
        const handleDeepLink = await comHash('#foo=bar');

        await handleDeepLink();

        expect(control.applySharedBasemap).not.toHaveBeenCalled();
        expect(map.jumpTo).not.toHaveBeenCalled();
    });
});
