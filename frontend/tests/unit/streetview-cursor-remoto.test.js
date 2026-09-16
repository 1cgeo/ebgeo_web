// Path: tests/unit/streetview-cursor-remoto.test.js
//
// O CURSOR DOS COLEGAS DENTRO DO PANORAMA (2026-09-16).
//
// O que estes casos existem para pegar, e que nenhum teste de "guardou o cursor?" pega: um cursor
// que viaja em PIXEL em vez de direcao na esfera. Ele fica plausivel na tela de quem enviou e
// aponta outro lugar em toda tela que o recebe, porque cada par olha o panorama do seu proprio
// yaw/pitch/FOV. Por isso a prova e a IDA E VOLTA: a tela de quem envia vira esfera, e a esfera
// vira a tela de quem recebe, com camera diferente.
//
// Molde: streetview-horizon-marker.test.js, que tambem chama os metodos pelo prototype para nao
// montar canvas nem WebGL.

import { describe, it, expect, vi } from 'vitest';
import { StreetViewProjector } from '../../src/js/street_view_tool/navigation/projector.js';
import { StreetViewNavigator } from '../../src/js/street_view_tool/navigation/navigator.js';
import { EventTypes } from '../../src/js/events/event_types.js';

// O barramento é dublado porque o evento de saída É a interface pública da captura: o que o par
// recebe é o payload, e é ele que precisa carregar esfera, nunca pixel.
const { emitSpy } = vi.hoisted(() => ({ emitSpy: vi.fn() }));
vi.mock('@store/services.js', () => ({ getEventBus: () => ({ emit: emitSpy }) }));
vi.mock('@utils', () => ({ showToast: vi.fn() }));

const WIDTH = 1200;
const HEIGHT = 800;
const FOV = 75;

/** Um navegador mínimo: só o que a projeção do cursor toca. */
function navigatorStub(remoteCursors = []) {
    const projector = new StreetViewProjector(WIDTH, HEIGHT);
    projector.setCameraConfig({ lon: 0, lat: 0, heading: 0 });
    return {
        projector,
        remoteCursors,
        projectRemoteCursor: StreetViewNavigator.prototype.projectRemoteCursor,
        setRemoteCursors: StreetViewNavigator.prototype.setRemoteCursors,
    };
}

/** Câmera em radianos, como `render()` a entrega ao projetor. */
function camera(headingDeg, pitchDeg = 0) {
    return { yaw: -(headingDeg * Math.PI) / 180, pitch: (pitchDeg * Math.PI) / 180 };
}

describe('cursor remoto no 360', () => {
    it('a esfera volta ao MESMO ponto da tela para quem olha do mesmo jeito', () => {
        const nav = navigatorStub();
        const { yaw, pitch } = camera(0);

        // Um ponto qualquer fora do centro: o centro passaria mesmo com a conversão trocada.
        const telaOrigem = { x: 800, y: 300 };
        const esfera = nav.projector.screenToSpherical(telaOrigem.x, telaOrigem.y, yaw, pitch, FOV);

        const projetado = nav.projectRemoteCursor(
            { clientId: 'c1', heading: esfera.heading, pitch: esfera.pitch, color: '#fff', name: 'Alice' },
            yaw, pitch, FOV,
        );

        expect(projetado).not.toBeNull();
        expect(projetado.screenX).toBeCloseTo(telaOrigem.x, 0);
        expect(projetado.screenY).toBeCloseTo(telaOrigem.y, 0);
    });

    it('O MESMO PONTO DA ESFERA CAI EM OUTRO PIXEL quando o colega olha de outro angulo', () => {
        // Este é o caso que condena o cursor em pixel: se a coordenada fosse a da tela, os dois
        // veriam o cursor no mesmo lugar, e um deles estaria vendo a direção errada.
        const nav = navigatorStub();
        const emissor = camera(0);
        const receptor = camera(20);

        const esfera = nav.projector.screenToSpherical(800, 300, emissor.yaw, emissor.pitch, FOV);
        const cursor = { clientId: 'c1', heading: esfera.heading, pitch: esfera.pitch, color: '#fff', name: 'A' };

        const naTelaDoEmissor = nav.projectRemoteCursor(cursor, emissor.yaw, emissor.pitch, FOV);
        const naTelaDoReceptor = nav.projectRemoteCursor(cursor, receptor.yaw, receptor.pitch, FOV);

        expect(naTelaDoReceptor).not.toBeNull();
        expect(Math.abs(naTelaDoReceptor.screenX - naTelaDoEmissor.screenX)).toBeGreaterThan(100);
    });

    it('não desenha o cursor do colega que aponta para trás da câmera', () => {
        const nav = navigatorStub();
        const { yaw, pitch } = camera(0);
        // Olhando para o norte, um cursor no sul está atrás.
        expect(nav.projectRemoteCursor(
            { clientId: 'c1', heading: 180, pitch: 0, color: '#fff', name: 'A' }, yaw, pitch, FOV,
        )).toBeNull();
    });

    it('recusa o cursor sem par heading/pitch, em vez de projetar NaN na tela', () => {
        const nav = navigatorStub();
        const { yaw, pitch } = camera(0);
        expect(nav.projectRemoteCursor({ clientId: 'c1', color: '#fff' }, yaw, pitch, FOV)).toBeNull();
        expect(nav.projectRemoteCursor({ clientId: 'c1', heading: 10 }, yaw, pitch, FOV)).toBeNull();
        expect(nav.projectRemoteCursor(null, yaw, pitch, FOV)).toBeNull();
    });

    it('setRemoteCursors aceita a lista e ignora o que não é lista', () => {
        const nav = navigatorStub();
        nav.setRemoteCursors([{ clientId: 'c1', heading: 0, pitch: 0 }]);
        expect(nav.remoteCursors).toHaveLength(1);
        nav.setRemoteCursors(null);
        expect(nav.remoteCursors).toEqual([]);
    });

    it('o ponteiro local sai em coordenada de ESFERA, com a foto atual', () => {
        emitSpy.mockClear();
        const nav = navigatorStub();
        const { yaw, pitch } = camera(30);
        Object.assign(nav, {
            canvas: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
            currentYaw: yaw,
            currentPitch: pitch,
            currentFov: FOV,
            mousePosition: { x: 800, y: 300 },
            cameraConfig: { img: 'foto-7.jpg', heading: 0, lon: 0, lat: 0 },
            broadcastLocalCursor: StreetViewNavigator.prototype.broadcastLocalCursor,
        });

        nav.broadcastLocalCursor();

        const esperado = nav.projector.screenToSpherical(800, 300, yaw, pitch, FOV);
        expect(emitSpy).toHaveBeenCalledWith(EventTypes.CURSOR_360_MOVED, {
            position: { heading: esperado.heading, pitch: esperado.pitch },
            photoName: 'foto-7.jpg',
        });
        // O que sai NÃO é o pixel: se fosse, estes dois números estariam no payload.
        const payload = emitSpy.mock.calls.at(-1)[1];
        expect(payload.position).not.toHaveProperty('x');
        expect(payload.position).not.toHaveProperty('screenX');
    });

    it('cala antes do primeiro quadro, quando a câmera ainda não existe', () => {
        emitSpy.mockClear();
        const nav = navigatorStub();
        nav.broadcastLocalCursor = StreetViewNavigator.prototype.broadcastLocalCursor;
        nav.mousePosition = { x: 1, y: 1 };
        nav.canvas = { getBoundingClientRect: () => ({ left: 0, top: 0 }) };
        // Sem `currentYaw` a conversão não tem de onde sair, e um NaN no payload desenharia o
        // cursor do colega em lugar nenhum, sem erro.
        nav.broadcastLocalCursor();
        expect(emitSpy).not.toHaveBeenCalled();
    });
});
