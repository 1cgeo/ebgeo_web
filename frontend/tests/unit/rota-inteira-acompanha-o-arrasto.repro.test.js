// Path: tests/unit/rota-inteira-acompanha-o-arrasto.repro.test.js
//
// REPRO (achado E7): MOVER A MESMA FEIÇÃO COM TRAJETÓRIA TINHA DUAS SEMÂNTICAS.
//
// O DEFEITO. No computador, arrastar uma feição com rota chamava `reanchorOnMove`
// (`temporal/trajectory-anchor.js`), que movia SÓ o ponto-chave 0 e deixava todos os outros
// onde estavam: a rota DEFORMAVA, e uma patrulha arrastada de uma cidade para a vizinha ficava
// com a primeira perna esticada pelo mapa inteiro e o resto do trajeto para trás. No celular
// (`phone/phone-move-geometry.js`) e no "Colar Aqui" (`tool_manager/clipboard-offset.js`) a
// mesma feição movia a rota INTEIRA, porque as duas passam por `translateKeypoints`.
//
// A CAUSA. `reanchorOnMove` só conhecia o destino (`coords`) e nunca o DESLOCAMENTO, então a
// única coisa que ela sabia posicionar era a âncora. O `fromCoords` que os três controles já
// passavam servia apenas para recusar o arrasto de uma feição deslocada no meio da rota.
//
// O CONSERTO. O deslocamento sai de `coords - fromCoords` e a rota inteira viaja por
// `translateKeypoints`, o MESMO ajudante puro das outras duas portas; a âncora é então fixada
// exatamente no destino, o que absorve o resíduo de ponto flutuante e repara uma rota cujo
// kp 0 tivesse saído de cima da posição de origem.
//
// O CONTROLE que dá peso a estes casos é o último bloco: a saída daqui é comparada com a do
// caminho do CELULAR para o mesmo deslocamento. Enquanto as duas divergirem, o defeito existe,
// e a comparação não depende de nenhum número escrito à mão.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { reanchorOnMove } from '../../src/js/temporal/trajectory-anchor.js';
import { normalizeTrajectory } from '../../src/js/temporal/temporal-model.js';
import { translateFeature } from '../../src/js/phone/phone-move-geometry.js';

/** Patrulha de três pernas, fora de ordem cronológica de propósito. */
const rota = () => ([
    { t: 2000, lng: -47.8, lat: -15.7 },
    { t: 1000, lng: -47.9, lat: -15.8 },
    { t: 3000, lng: -47.6, lat: -15.5 },
]);

describe('arrastar a feição leva a rota inteira', () => {
    it('REPRO: os pontos-chave 2 e 3 andam o mesmo que a âncora, e não ficam para trás', () => {
        const patch = reanchorOnMove({ trajetoria: rota() }, [-47.4, -15.3], [-47.9, -15.8]);

        // Deslocamento de +0,5 em lng e +0,5 em lat.
        expect(patch.trajetoria[0]).toEqual({ t: 1000, lng: -47.4, lat: -15.3 });
        expect(patch.trajetoria[1].lng).toBeCloseTo(-47.3, 10);
        expect(patch.trajetoria[1].lat).toBeCloseTo(-15.2, 10);
        expect(patch.trajetoria[2].lng).toBeCloseTo(-47.1, 10);
        expect(patch.trajetoria[2].lat).toBeCloseTo(-15.0, 10);
    });

    it('a FORMA da rota é invariante: toda distância entre pontos-chave sobrevive ao arrasto', () => {
        const antes = normalizeTrajectory(rota());
        const patch = reanchorOnMove({ trajetoria: rota() }, [10, 20], [-47.9, -15.8]);

        for (let i = 1; i < antes.length; i++) {
            expect(patch.trajetoria[i].lng - patch.trajetoria[i - 1].lng)
                .toBeCloseTo(antes[i].lng - antes[i - 1].lng, 10);
            expect(patch.trajetoria[i].lat - patch.trajetoria[i - 1].lat)
                .toBeCloseTo(antes[i].lat - antes[i - 1].lat, 10);
        }
    });

    it('a âncora fica EXATAMENTE no destino, sem resíduo de ponto flutuante', () => {
        const patch = reanchorOnMove(
            { trajetoria: [{ t: 1, lng: 0.1, lat: 0.2 }, { t: 2, lng: 0.3, lat: 0.4 }] },
            [0.30000000000000004, 0.7],
            [0.1, 0.2],
        );
        expect(patch.trajetoria[0].lng).toBe(0.30000000000000004);
        expect(patch.trajetoria[0].lat).toBe(0.7);
    });

    it('sem `fromCoords` a origem é a própria âncora, e a rota ainda anda inteira', () => {
        const patch = reanchorOnMove({ trajetoria: rota() }, [-46.9, -14.8]);
        expect(patch.trajetoria[0]).toEqual({ t: 1000, lng: -46.9, lat: -14.8 });
        expect(patch.trajetoria[1].lng).toBeCloseTo(-46.8, 10);
        expect(patch.trajetoria[2].lat).toBeCloseTo(-14.5, 10);
    });

    it('a âncora fora de cima da origem é REPARADA, e o resto anda pelo deslocamento', () => {
        // kp 0 a 1 grau da posição da feição (invariante quebrada por importação).
        const traj = [{ t: 1, lng: 0, lat: 0 }, { t: 2, lng: 1, lat: 1 }];
        const patch = reanchorOnMove({ trajetoria: traj }, [11, 11], [10, 10]);
        expect(patch.trajetoria[0]).toEqual({ t: 1, lng: 11, lat: 11 });
        expect(patch.trajetoria[1]).toEqual({ t: 2, lng: 2, lat: 2 });
    });

    it('feição deslocada e ESTACIONADA em casa: a rota anda e `_temporalHome` segue junto', () => {
        const props = { trajetoria: rota(), _temporalHome: [-47.9, -15.8] };
        const patch = reanchorOnMove(props, [-47.4, -15.3], [-47.9, -15.8]);

        expect(patch._temporalHome).toEqual([-47.4, -15.3]);
        expect(patch.trajetoria[1].lng).toBeCloseTo(-47.3, 10);
    });

    it('feição deslocada NO MEIO da rota continua recusando: o arrasto ali é transitório', () => {
        const props = { trajetoria: rota(), _temporalHome: [-47.9, -15.8] };
        expect(reanchorOnMove(props, [-47.4, -15.3], [-47.85, -15.75])).toBeNull();
    });

    it.each([
        ['sem rota', {}, [1, 2], [0, 0]],
        ['rota vazia', { trajetoria: [] }, [1, 2], [0, 0]],
        ['destino não finito', { trajetoria: rota() }, [NaN, 2], [0, 0]],
        ['destino ausente', { trajetoria: rota() }, null, [0, 0]],
    ])('%s: nulo, porque patch nenhum é melhor que meia rota', (_r, props, coords, from) => {
        expect(reanchorOnMove(props, coords, from)).toBeNull();
    });

    it('arrasto que termina onde começou não escreve nada (nem enfileira op de sync)', () => {
        expect(reanchorOnMove({ trajetoria: rota() }, [-47.9, -15.8], [-47.9, -15.8])).toBeNull();
        // E sem `fromCoords`, com o destino em cima da âncora, idem.
        expect(reanchorOnMove({ trajetoria: rota() }, [-47.9, -15.8])).toBeNull();
    });

    it('um ponto-chave só continua se comportando como antes: a âncora vai ao destino', () => {
        const patch = reanchorOnMove({ trajetoria: [{ t: 1, lng: 5, lat: 6 }] }, [9, 9], [5, 6]);
        expect(patch.trajetoria).toEqual([{ t: 1, lng: 9, lat: 9 }]);
    });

    it('não muta a entrada', () => {
        const traj = rota();
        const copia = JSON.parse(JSON.stringify(traj));
        reanchorOnMove({ trajetoria: traj }, [1, 1], [-47.9, -15.8]);
        expect(traj).toEqual(copia);
    });
});

describe('CONTROLE: o computador passou a responder como o celular', () => {
    /** O caminho do CELULAR para o mesmo deslocamento, que sempre moveu a rota inteira. */
    function pelaPortaDoCelular(trajetoria, from, to) {
        const movida = translateFeature(
            { type: 'Feature', geometry: { type: 'Point', coordinates: from }, properties: { trajetoria } },
            to[0] - from[0],
            to[1] - from[1],
        );
        return movida.properties.trajetoria;
    }

    it('as duas portas dão a MESMA rota para o mesmo arrasto', () => {
        const from = [-47.9, -15.8];
        const to = [-47.4, -15.3];
        const doCelular = pelaPortaDoCelular(rota(), from, to);
        const doComputador = reanchorOnMove({ trajetoria: rota() }, to, from).trajetoria;

        // O celular preserva a ordem do array; aqui a rota sai cronológica. Compara por `t`.
        for (const kp of doComputador) {
            const par = doCelular.find((k) => k.t === kp.t);
            expect(par, `ponto-chave t=${kp.t} sumiu`).toBeDefined();
            expect(kp.lng).toBeCloseTo(par.lng, 9);
            expect(kp.lat).toBeCloseTo(par.lat, 9);
        }
    });

    it('PROPRIEDADE: concordam para qualquer arrasto plausível', () => {
        // A ORIGEM É A ÂNCORA, e não um ponto qualquer: no produto, `fromCoords` é a posição da
        // FEIÇÃO, que é onde o ponto-chave 0 está. Sortear origem solta compararia duas funções
        // sobre entradas que nenhum dos três controles produz.
        const ancora = normalizeTrajectory(rota())[0];
        const desloc = fc.double({ min: -60, max: 60, noNaN: true });
        fc.assert(fc.property(desloc, desloc, (dLng, dLat) => {
            const from = [ancora.lng, ancora.lat];
            const to = [ancora.lng + dLng, ancora.lat + dLat];
            // Um deslocamento subnormal é ABSORVIDO pela soma, e aí o arrasto não moveu nada:
            // a recusa é o desfecho certo, medido no caso próprio acima.
            fc.pre(to[0] !== from[0] || to[1] !== from[1]);
            const doCelular = pelaPortaDoCelular(rota(), from, to);
            const doComputador = reanchorOnMove({ trajetoria: rota() }, to, from).trajetoria;
            for (const kp of doComputador) {
                const par = doCelular.find((k) => k.t === kp.t);
                // A âncora é FIXADA no destino aqui, então ela pode diferir do celular pelo
                // resíduo de `kp + (to - kp)`; os demais saem da mesma conta.
                expect(kp.lng).toBeCloseTo(par.lng, 8);
                expect(kp.lat).toBeCloseTo(par.lat, 8);
            }
        }));
    });
});
