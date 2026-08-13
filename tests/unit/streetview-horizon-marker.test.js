import { describe, it, expect } from 'vitest';
import { StreetViewProjector } from '../../src/js/street_view_tool/navigation/projector.js';
import { NAV_CONSTANTS } from '../../src/js/street_view_tool/navigation/constants.js';
import { StreetViewNavigator } from '../../src/js/street_view_tool/navigation/navigator.js';
import { rankOpacity } from '../../src/js/street_view_tool/navigation/renderer.js';
import { StreetViewHitTester } from '../../src/js/street_view_tool/navigation/hit-tester.js';

// Canvas of a typical desktop viewer, and the default FOV of the 360 camera.
const WIDTH = 1200;
const HEIGHT = 800;
const FOV = 75;

/**
 * Builds a projector looking at a given world bearing, with no pitch.
 * The navigator derives yaw from the world heading as yaw = -heading (radians).
 */
function projectorLookingAt(headingDeg, cameraConfig = {}) {
    const projector = new StreetViewProjector(WIDTH, HEIGHT);
    projector.setCameraConfig({ lon: 0, lat: 0, ...cameraConfig });
    return { projector, yaw: -(headingDeg * Math.PI) / 180 };
}

/** A navigator stub carrying only what the layout code actually touches. */
function navigatorStub(cameraConfig = { lon: 0, lat: 0 }) {
    const projector = new StreetViewProjector(WIDTH, HEIGHT);
    projector.setCameraConfig(cameraConfig);
    return {
        projector,
        cameraConfig,
        canvas: { width: WIDTH, height: HEIGHT },
        resolveTargetVector: StreetViewNavigator.prototype.resolveTargetVector,
        layoutDirections: StreetViewNavigator.prototype.layoutDirections,
        assignHitRadii: StreetViewNavigator.prototype.assignHitRadii,
        // O arranjo mede o degrau de andar, entao o stub precisa dele. Faltando,
        // o layout estoura em vez de responder.
        deltaDeAndar: StreetViewNavigator.prototype.deltaDeAndar,
    };
}

/** A target as the API delivers it: bearing and distance derived from lat/lon. */
function target(id, bearing, distance, extra = {}) {
    return { id, bearing, distance, ...extra };
}

describe('projectOnHorizon', () => {
    it('places a target straight ahead at the centre of the canvas', () => {
        const { projector, yaw } = projectorLookingAt(0);
        const result = projector.projectOnHorizon(0, yaw, 0, FOV);

        expect(result.visible).toBe(true);
        expect(result.screenX).toBeCloseTo(WIDTH / 2, 6);
        expect(result.screenY).toBeCloseTo(HEIGHT / 2, 6);
        expect(result.azimuthRelDeg).toBeCloseTo(0, 6);
    });

    it('puts a target to the right of the view on the right half of the canvas', () => {
        const { projector, yaw } = projectorLookingAt(0);
        const result = projector.projectOnHorizon(20, yaw, 0, FOV);

        expect(result.visible).toBe(true);
        expect(result.screenX).toBeGreaterThan(WIDTH / 2);
        expect(result.azimuthRelDeg).toBeCloseTo(20, 6);
    });

    it('reports a negative relative azimuth for a target to the left', () => {
        const { projector, yaw } = projectorLookingAt(90);
        const result = projector.projectOnHorizon(70, yaw, 0, FOV);

        expect(result.azimuthRelDeg).toBeCloseTo(-20, 6);
        expect(result.screenX).toBeLessThan(WIDTH / 2);
    });

    it('wraps the relative azimuth across north instead of reporting 350 degrees', () => {
        const { projector, yaw } = projectorLookingAt(10);
        const result = projector.projectOnHorizon(350, yaw, 0, FOV);

        expect(result.azimuthRelDeg).toBeCloseTo(-20, 6);
    });

    it('marks a target behind the camera as not visible', () => {
        const { projector, yaw } = projectorLookingAt(0);
        const result = projector.projectOnHorizon(180, yaw, 0, FOV);

        expect(result.visible).toBe(false);
        expect(Math.abs(result.azimuthRelDeg)).toBeCloseTo(180, 6);
    });

    it('follows the horizon when the camera pitches', () => {
        // The band is anchored to the corrected horizon, so tilting the view
        // must carry the icons with it.
        const { projector, yaw } = projectorLookingAt(0);

        const level = projector.projectOnHorizon(0, yaw, 0, FOV);
        const lookingDown = projector.projectOnHorizon(0, yaw, -(20 * Math.PI) / 180, FOV);

        expect(lookingDown.screenY).toBeLessThan(level.screenY);
    });
});

describe('angularMarkerRadius', () => {
    it('shrinks by a constant fraction for each rank', () => {
        const { projector } = projectorLookingAt(0);

        const first = projector.angularMarkerRadius(0, FOV);
        const second = projector.angularMarkerRadius(1, FOV);

        expect(second / first).toBeCloseTo(NAV_CONSTANTS.HORIZON_RANK_DECAY, 2);
    });

    it('satisfies the inequality that makes any queue length fit the band', () => {
        // r0 <= (1 - decay) * band. This single relation is what replaces every
        // stacking rule: when it holds, the centre of every icon falls outside
        // the disc in front of it, for any number of icons.
        const band = NAV_CONSTANTS.HORIZON_BASE_DEPRESSION_DEG
            + NAV_CONSTANTS.HORIZON_CEILING_ELEVATION_DEG;
        const limit = (1 - NAV_CONSTANTS.HORIZON_RANK_DECAY) * band;

        expect(NAV_CONSTANTS.HORIZON_ANGULAR_NEAR).toBeLessThanOrEqual(limit);
    });

    it('shrinks monotonically down the queue', () => {
        const { projector } = projectorLookingAt(0);
        const radii = [0, 1, 2, 3, 4].map(rank => projector.angularMarkerRadius(rank, FOV));

        for (let i = 1; i < radii.length; i++) {
            expect(radii[i]).toBeLessThanOrEqual(radii[i - 1]);
        }
    });

    it('keeps shrinking without a floor, so the gap guarantee never breaks', () => {
        // Flooring the drawn size would break the invariant: the gap keeps
        // shrinking geometrically while a floored radius would not, so deep
        // icons would start covering each other's centres.
        const { projector } = projectorLookingAt(0);

        expect(projector.angularRadiusDeg(6))
            .toBeLessThan(projector.angularRadiusDeg(5));
    });

    it('grows when zooming in, so markers stay proportional to the scene', () => {
        const { projector } = projectorLookingAt(0);

        expect(projector.angularMarkerRadius(0, 30))
            .toBeGreaterThan(projector.angularMarkerRadius(0, 75));
    });

    it('does not depend on distance in any way', () => {
        // The whole point of the redesign: the archive's metric fields are not
        // trustworthy, so none of them reaches the drawing.
        const { projector } = projectorLookingAt(0);
        const plain = projector.angularMarkerRadius(1, FOV);

        projector.setCameraConfig({
            lon: 0, lat: 0,
            height: 1.5, distance_scale: 1.59, marker_scale: 0.3,
        });

        expect(projector.angularMarkerRadius(1, FOV)).toBeCloseTo(plain, 10);
    });
});

describe('resolveTargetVector', () => {
    it('takes bearing and distance straight from the API, which derives them from lat/lon', () => {
        const nav = navigatorStub();
        const vector = nav.resolveTargetVector(target('a', 340.4, 1.79));

        expect(vector).toEqual({ bearing: 340.4, distance: 1.79 });
    });

    it('ignores the legacy per-target overrides entirely', () => {
        // A real museum target carries override_bearing 347.17 and
        // override_distance 17.32 against a measured 10.21 m. Honouring the
        // override silently reordered the queue.
        const nav = navigatorStub();
        const vector = nav.resolveTargetVector(target('a', 351.47, 10.21, {
            override_bearing: 347.17,
            override_distance: 17.32,
            override_height: 2,
        }));

        expect(vector).toEqual({ bearing: 351.47, distance: 10.21 });
    });

    it('falls back to geometry for metadata without a precomputed vector', () => {
        // lonLatToMeters is stubbed because it reaches for the Turf global, which
        // only exists in the browser. Ten metres due east of the camera.
        const nav = navigatorStub({ lon: 0, lat: 0 });
        nav.projector.lonLatToMeters = () => ({ x: 10, z: 0 });

        const vector = nav.resolveTargetVector({
            id: 'a', lon: 0.0001, lat: 0, bearing: null, distance: null,
        });

        expect(vector.bearing).toBeCloseTo(90, 6);
        expect(vector.distance).toBeCloseTo(10, 6);
    });
});

describe('elevationDeg', () => {
    it('puts the first icon below the corrected horizon', () => {
        const { projector } = projectorLookingAt(0);
        expect(projector.elevationDeg(0)).toBeCloseTo(-NAV_CONSTANTS.HORIZON_BASE_DEPRESSION_DEG, 6);
    });

    it('climbs towards the ceiling but never crosses it, however long the queue', () => {
        const { projector } = projectorLookingAt(0);
        const ceiling = NAV_CONSTANTS.HORIZON_CEILING_ELEVATION_DEG;

        // Never ABOVE the ceiling. At very deep ranks the decay underflows to
        // zero and the elevation lands exactly on it, which is the limit itself.
        for (const rank of [1, 2, 5, 20, 200]) {
            expect(projector.elevationDeg(rank)).toBeLessThanOrEqual(ceiling);
        }
        expect(projector.elevationDeg(3)).toBeLessThan(ceiling);
        expect(projector.elevationDeg(200)).toBeCloseTo(ceiling, 3);
    });

    it('rises monotonically', () => {
        const { projector } = projectorLookingAt(0);
        const alturas = [0, 1, 2, 3, 4].map(r => projector.elevationDeg(r));

        for (let i = 1; i < alturas.length; i++) {
            expect(alturas[i]).toBeGreaterThan(alturas[i - 1]);
        }
    });
});

describe('elevacaoComAndar', () => {
    // POR QUE ESTE BLOCO EXISTE. A altura era funcao SO da posicao na fila, e
    // a fila cruza o horizonte no rank 1: um alvo que descia dois andares
    // aparecia ACIMA da linha por estar em segundo na direcao. Altura o olho
    // le antes da seta, entao o lado tem de vir do degrau, nao da fila.
    const RANKS = [0, 1, 2, 3, 5, 20];

    it('a fila sozinha CRUZA o horizonte, que e o defeito de origem', () => {
        // Sem esta medida os testes abaixo nao provam nada: se a fila nunca
        // subisse acima da linha, garantir que quem desce fica abaixo seria de
        // graca. Ela cruza ja no rank 1.
        const { projector } = projectorLookingAt(0);

        expect(projector.elevationDeg(0)).toBeLessThan(0);
        expect(projector.elevationDeg(1)).toBeGreaterThan(0);
    });

    it('quem DESCE fica abaixo do horizonte em qualquer posicao da fila', () => {
        const { projector } = projectorLookingAt(0);

        for (const rank of RANKS) {
            for (const delta of [-1, -2, -6]) {
                expect(projector.elevacaoComAndar(rank, delta)).toBeLessThan(0);
            }
        }
    });

    it('quem SOBE fica acima do horizonte em qualquer posicao da fila', () => {
        const { projector } = projectorLookingAt(0);

        for (const rank of RANKS) {
            for (const delta of [1, 2, 6]) {
                expect(projector.elevacaoComAndar(rank, delta)).toBeGreaterThan(0);
            }
        }
    });

    it('mesmo andar nao muda nada, que e o acervo externo inteiro', () => {
        const { projector } = projectorLookingAt(0);

        for (const rank of RANKS) {
            for (const delta of [0, null, undefined, NaN]) {
                expect(projector.elevacaoComAndar(rank, delta))
                    .toBeCloseTo(projector.elevationDeg(rank), 12);
            }
        }
    });

    it('sobe e desce sao espelhos exatos, entao a escada e a MESMA', () => {
        // E o que preserva a garantia do arranjo: o centro de um icone nunca
        // cai dentro do disco do icone da frente. Refletir mantem distancias,
        // inventar uma segunda escada nao manteria.
        const { projector } = projectorLookingAt(0);

        for (const rank of RANKS) {
            expect(projector.elevacaoComAndar(rank, 1))
                .toBeCloseTo(-projector.elevacaoComAndar(rank, -1), 12);
        }
    });

    it('o DISCO nao encosta na linha, e nao so o centro dele', () => {
        // A regra que o olho cobra: o icone tem de ficar inteiro de um lado.
        // Comparar o centro com zero passaria com o disco cruzando a linha, que
        // foi exatamente a primeira versao desta regra.
        const { projector } = projectorLookingAt(0);

        for (const rank of RANKS) {
            const raio = projector.angularRadiusDeg(rank);
            for (const delta of [1, -1]) {
                expect(Math.abs(projector.elevacaoComAndar(rank, delta)))
                    .toBeGreaterThan(raio);
            }
        }
    });

    it('a folga do primeiro icone vale meio raio dele', () => {
        // O numero sai do tamanho do icone, e nao de um grau escolhido a dedo.
        const { projector } = projectorLookingAt(0);
        const raio = projector.angularRadiusDeg(0);
        const folga = Math.abs(projector.elevacaoComAndar(0, -1)) - raio;

        expect(folga).toBeCloseTo(raio * 0.5, 6);
    });

    it('a fila afunda e sobe monotonicamente, cada uma para o seu lado', () => {
        const { projector } = projectorLookingAt(0);
        const descendo = [0, 1, 2, 3].map(r => projector.elevacaoComAndar(r, -1));
        const subindo = [0, 1, 2, 3].map(r => projector.elevacaoComAndar(r, 1));

        for (let i = 1; i < descendo.length; i++) {
            expect(descendo[i]).toBeLessThan(descendo[i - 1]);
            expect(subindo[i]).toBeGreaterThan(subindo[i - 1]);
        }
    });
});

describe('layoutDirections e o lado do horizonte', () => {
    // DUAS filas de dois, e nao uma de tres: no terceiro posto o icone ja cai
    // abaixo de HORIZON_MIN_ANGULAR_DRAW e a fila termina, entao o alvo nem
    // entra no arranjo. O que interessa e o SEGUNDO posto, porque e onde a
    // fila comum ja passou para cima da linha.
    const camera = { lon: 0, lat: 0, floor_level: 3 };
    const fila = [
        { id: 'perto', bearing: 340.0, distance: 2, floor_level: 3 },
        { id: 'desce', bearing: 340.2, distance: 5, floor_level: 1 },
        { id: 'base', bearing: 90.0, distance: 3, floor_level: 3 },
        { id: 'sobe', bearing: 90.2, distance: 6, floor_level: 5 },
        // Sozinho na direcao dele, ou seja, PRIMEIRO da fila. E o caso que
        // separa de verdade: a regra antiga punha todo primeiro icone abaixo
        // da linha, entao um alvo que sobe nascia do lado errado.
        { id: 'sobe_so', bearing: 200.0, distance: 4, floor_level: 6 },
    ];

    it('poe o alvo que desce abaixo do horizonte, mesmo no meio da fila', () => {
        const nav = navigatorStub(camera);
        const layout = nav.layoutDirections(fila, FOV);

        expect(layout.get('desce').rank).toBeGreaterThan(0);
        expect(layout.get('desce').elevationDeg).toBeLessThan(0);
    });

    it('poe o alvo que sobe acima do horizonte, mesmo no meio da fila', () => {
        const nav = navigatorStub(camera);
        const layout = nav.layoutDirections(fila, FOV);

        expect(layout.get('sobe').rank).toBeGreaterThan(0);
        expect(layout.get('sobe').elevationDeg).toBeGreaterThan(0);
    });

    it('poe o alvo que sobe acima do horizonte tambem no PRIMEIRO posto', () => {
        // Aqui a regra antiga reprova: o primeiro icone de uma direcao nascia
        // abaixo da linha, subisse ele ou nao.
        const nav = navigatorStub(camera);
        const layout = nav.layoutDirections(fila, FOV);

        expect(layout.get('sobe_so').rank).toBeLessThan(1);
        expect(layout.get('sobe_so').elevationDeg).toBeGreaterThan(0);
    });

    it('nao mexe no alvo do mesmo andar', () => {
        const nav = navigatorStub(camera);
        const layout = nav.layoutDirections(fila, FOV);

        expect(layout.get('perto').elevationDeg)
            .toBeCloseTo(nav.projector.elevationDeg(layout.get('perto').rank), 12);
    });

    it('mede o degrau contra a camera do proprio navegador', () => {
        const doTerceiro = navigatorStub(camera).layoutDirections(fila, FOV);
        const doQuinto = navigatorStub({ lon: 0, lat: 0, floor_level: 5 })
            .layoutDirections(fila, FOV);

        // O MESMO alvo, olhado de dois andares diferentes, nao pode cair na
        // mesma altura: do 3o ele sobe, do 5o ele esta no proprio andar.
        expect(doTerceiro.get('sobe').elevationDeg).toBeGreaterThan(0);
        expect(doQuinto.get('sobe').elevationDeg)
            .not.toBe(doTerceiro.get('sobe').elevationDeg);

        // E o que descia continua descendo, agora dois andares mais fundo.
        expect(doQuinto.get('desce').elevationDeg).toBeLessThan(0);
    });
});

describe('layoutDirections', () => {
    // The real first photo of the museum: four targets down one corridor.
    const museum = [
        target('0002', 340.39, 1.79),
        target('0003', 339.79, 4.54),
        target('0005', 339.77, 14.43),
        target('0004', 351.47, 10.21),
    ];

    it('ranks a queue by distance, nearest first', () => {
        const nav = navigatorStub();
        const layout = nav.layoutDirections(museum, FOV);

        // 0002, 0003 e 0005 estao a menos de um grau um do outro: sao uma fila,
        // e nela os postos crescem em ordem de distancia. Nao sao inteiros
        // porque cada um carrega tambem seu lugar na ordem de distancia da foto.
        expect(layout.get('0002').rank).toBe(0);
        expect(layout.get('0003').rank).toBeGreaterThan(1);
        expect(layout.get('0003').rank).toBeLessThan(2);

        // 0004 esta a 11 graus dos outros. Com o balde fixo de 25 graus ele era
        // empilhado e subia; agora e a primeira esfera da propria direcao, que
        // e o que se ve na foto: ele esta ao lado, nao atras.
        expect(layout.get('0004').rank).toBeLessThan(1);
    });

    it('shrinks a lone far target, so distance still reads without a queue', () => {
        // O pedido que motivou o termo de distancia: sem ele, um alvo isolado a
        // 60 m era desenhado exatamente como um alvo isolado a 3 m.
        const nav = navigatorStub();
        const layout = nav.layoutDirections([
            target('perto', 0, 3),
            target('longe', 120, 60),
        ], FOV);

        // Cada um e o primeiro da propria direcao, entao a fila nao os separa.
        expect(layout.get('longe').radius).toBeLessThan(layout.get('perto').radius);
        expect(layout.get('longe').elevationDeg).toBeGreaterThan(layout.get('perto').elevationDeg);
    });

    it('bounds that nudge to less than one queue position', () => {
        // O termo de distancia e um tempero, nao um segundo criterio: o alvo
        // mais distante da foto nunca encolhe tanto quanto encolheria por estar
        // um posto atras numa fila.
        const nav = navigatorStub();
        const layout = nav.layoutDirections([
            target('perto', 0, 3),
            target('longe', 120, 600),
        ], FOV);

        expect(layout.get('longe').rank).toBeLessThan(1);
        expect(layout.get('longe').rank)
            .toBeCloseTo(NAV_CONSTANTS.HORIZON_DISTANCE_RANK_WEIGHT, 6);
    });

    it('keeps the distance nudge from ever shrinking the gap below one rank', () => {
        // A garantia inteira depende de postos consecutivos diferirem de pelo
        // menos 1. Como a fila e ordenada por distancia, o termo global nunca
        // decresce ao longo dela, entao o passo so aumenta.
        const nav = navigatorStub();
        const fila = Array.from({ length: 12 }, (_, i) => target(`t${i}`, 340, 2 + i * 5));
        const layout = nav.layoutDirections(fila, FOV);

        const postos = [...layout.values()].map(p => p.rank).sort((a, b) => a - b);
        for (let i = 1; i < postos.length; i++) {
            expect(postos[i] - postos[i - 1]).toBeGreaterThanOrEqual(1);
        }
    });

    it('puts the first icon of a direction at the bottom of the band', () => {
        const nav = navigatorStub();
        const layout = nav.layoutDirections(museum, FOV);

        expect(layout.get('0002').elevationDeg)
            .toBeCloseTo(-NAV_CONSTANTS.HORIZON_BASE_DEPRESSION_DEG, 6);
    });

    it('keeps every centre clear of the disc in front, however long the queue', () => {
        // The property the whole model exists for. Checked on a queue of twelve,
        // to show it does not depend on the count.
        const nav = navigatorStub();
        const fila = Array.from({ length: 12 }, (_, i) => target(`t${i}`, 340, 2 + i * 5));
        const layout = nav.layoutDirections(fila, FOV);
        const focal = nav.projector.focalLength(FOV);
        const px = deg => focal * Math.tan((deg * Math.PI) / 180);

        const queue = [...layout.values()].sort((a, b) => a.rank - b.rank);
        expect(queue.length).toBeGreaterThan(1);

        for (let i = 1; i < queue.length; i++) {
            const gap = px(queue[i].elevationDeg) - px(queue[i - 1].elevationDeg);
            expect(gap).toBeGreaterThanOrEqual(queue[i - 1].radius);
        }
    });

    it('never lets a queue climb past the ceiling, however long', () => {
        const nav = navigatorStub();
        const fila = Array.from({ length: 30 }, (_, i) => target(`t${i}`, 340, 2 + i * 5));
        const layout = nav.layoutDirections(fila, FOV);

        for (const p of layout.values()) {
            expect(p.elevationDeg).toBeLessThanOrEqual(NAV_CONSTANTS.HORIZON_CEILING_ELEVATION_DEG);
        }
    });

    it('does not push a target sideways up: a lone direction stays near the bottom', () => {
        // The complaint that started this: a target 20 degrees off was being
        // stacked and raised as if it were behind the near one. It still rises a
        // little, for being far, but nothing like a whole queue position.
        const nav = navigatorStub();
        const layout = nav.layoutDirections([
            target('frente', 340, 2),
            target('lado', 320, 30),
        ], FOV);

        expect(layout.get('lado').rank).toBeLessThan(1);
        expect(layout.get('lado').elevationDeg).toBeLessThan(0);
        expect(layout.get('lado').elevationDeg)
            .toBeGreaterThan(-NAV_CONSTANTS.HORIZON_BASE_DEPRESSION_DEG);
    });

    it('separates targets that lie in genuinely different directions', () => {
        const nav = navigatorStub();
        const layout = nav.layoutDirections([
            target('frente', 0, 3),
            target('tras', 180, 4),
        ], FOV);

        // Neither is behind the other, so neither takes a queue position.
        expect(layout.get('frente').rank).toBe(0);
        expect(layout.get('tras').rank).toBeLessThan(1);
        expect(layout.get('frente').elevationDeg)
            .toBeCloseTo(-NAV_CONSTANTS.HORIZON_BASE_DEPRESSION_DEG, 6);
    });

    it('stacks two targets only when their icons would actually cover each other', () => {
        const nav = navigatorStub();
        const alcance = NAV_CONSTANTS.HORIZON_ANGULAR_NEAR
            * (1 + NAV_CONSTANTS.HORIZON_RANK_DECAY);

        const juntos = nav.layoutDirections([
            target('a', 0, 3),
            target('b', alcance * 0.5, 6),
        ], FOV);
        expect(juntos.get('b').rank).toBeGreaterThanOrEqual(1);

        const separados = nav.layoutDirections([
            target('a', 0, 3),
            target('b', alcance * 2, 6),
        ], FOV);
        expect(separados.get('b').rank).toBeLessThan(1);
    });

    it('handles a direction that straddles north', () => {
        // Tres graus de separacao, um de cada lado do norte: a diferenca
        // circular tem que dar 3, e nao 357.
        const nav = navigatorStub();
        const layout = nav.layoutDirections([
            target('a', 359, 3),
            target('b', 2, 6),
        ], FOV);

        expect(layout.get('b').rank).toBeGreaterThanOrEqual(1);
    });

    it('ends a queue on legibility, not on a chosen maximum', () => {
        const nav = navigatorStub();
        const many = Array.from({ length: 9 }, (_, i) => target(`t${i}`, 10, i + 1));
        const layout = nav.layoutDirections(many, FOV);

        // Whatever is drawn is drawn from the front, and every one drawn is
        // above the legibility threshold. The count is a consequence.
        expect(layout.has('t0')).toBe(true);
        for (const p of layout.values()) {
            expect(nav.projector.angularRadiusDeg(p.rank))
                .toBeGreaterThanOrEqual(NAV_CONSTANTS.HORIZON_MIN_ANGULAR_DRAW);
        }
        expect(layout.size).toBeLessThan(many.length);
    });
});

describe('assignHitRadii', () => {
    const nav = { canvas: { width: WIDTH, height: HEIGHT } };
    const assign = markers => StreetViewNavigator.prototype.assignHitRadii.call(nav, markers);

    it('gives a small distant marker a target far bigger than its drawing', () => {
        const marker = { radius: 8, screenX: 0, screenY: 0 };
        assign([marker]);

        expect(marker.hitRadius).toBeGreaterThanOrEqual(HEIGHT * NAV_CONSTANTS.HIT_RADIUS_MIN_REL);
        expect(marker.hitRadius).toBeGreaterThan(marker.radius * 2);
    });

    it('scales the target with the drawing once the drawing is large', () => {
        const marker = { radius: 40, screenX: 0, screenY: 0 };
        assign([marker]);

        expect(marker.hitRadius).toBeCloseTo(40 * NAV_CONSTANTS.HIT_RADIUS_MULTIPLIER, 6);
    });

    it('keeps the target proportional to the canvas, not to a fixed pixel count', () => {
        const small = { radius: 8, screenX: 0, screenY: 0 };
        const big = { radius: 8, screenX: 0, screenY: 0 };

        StreetViewNavigator.prototype.assignHitRadii.call({ canvas: { height: 400 } }, [small]);
        StreetViewNavigator.prototype.assignHitRadii.call({ canvas: { height: 1600 } }, [big]);

        expect(big.hitRadius).toBeGreaterThan(small.hitRadius);
    });
});

describe('rankOpacity', () => {
    it('never fades the target a click would take', () => {
        expect(rankOpacity(0, true)).toBe(1);
        expect(rankOpacity(9, true)).toBe(1);
    });

    it('fades progressively down the queue', () => {
        const alphas = [0, 1, 2, 3].map(r => rankOpacity(r));

        for (let i = 1; i < alphas.length; i++) {
            expect(alphas[i]).toBeLessThan(alphas[i - 1]);
        }
    });

    it('never fades so far that a marker stops looking clickable', () => {
        expect(rankOpacity(50)).toBeGreaterThanOrEqual(NAV_CONSTANTS.HORIZON_RANK_FADE_MIN);
    });
});

describe('every icon of a queue stays clickable', () => {
    // The property the whole layout exists to guarantee, checked end to end on
    // the real first photo of the museum: build the queue, place it on screen,
    // then click the exact centre of each icon and demand that icon back.
    const museum = [
        { id: '0002', bearing: 340.39, distance: 1.787 },
        { id: '0003', bearing: 339.79, distance: 4.538 },
        { id: '0004', bearing: 351.47, distance: 10.209 },
        { id: '0005', bearing: 339.77, distance: 14.432 },
    ];

    function buildMarkers() {
        const nav = navigatorStub({ lon: -51.2354, lat: -30.0318 });
        const layout = nav.layoutDirections(museum, FOV);
        const focal = nav.projector.focalLength(FOV);

        // Uma fila so: o 0004 fica noutra direcao, entao nao entra na coluna.
        const fila = museum.filter(t => layout.get(t.id) && t.id !== '0004');

        const markers = fila.map(t => {
            const placement = layout.get(t.id);
            return {
                id: t.id,
                screenX: WIDTH / 2,
                screenY: HEIGHT / 2 - focal * Math.tan((placement.elevationDeg * Math.PI) / 180),
                radius: placement.radius,
                distance: placement.rank,
                type: 'navigation',
            };
        });

        nav.assignHitRadii(markers);
        return markers;
    }

    it('returns each icon when its own centre is clicked', () => {
        const markers = buildMarkers();
        const hitTester = new StreetViewHitTester();
        hitTester.setMarkers(markers);

        for (const marker of markers) {
            const hit = hitTester.testPoint(marker.screenX, marker.screenY);
            expect(hit?.id, `clicking the centre of ${marker.id}`).toBe(marker.id);
        }
    });

    it('leaves no icon fully buried under its neighbour', () => {
        const markers = buildMarkers();

        for (let i = 1; i < markers.length; i++) {
            const gap = Math.abs(markers[i].screenY - markers[i - 1].screenY);
            // Centres must be far enough apart that each circle still shows.
            expect(gap).toBeGreaterThan(Math.max(markers[i].radius, markers[i - 1].radius));
        }
    });
});
