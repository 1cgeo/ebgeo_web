// Path: tests/unit/viewshed-3d-campo-vertical.test.js

/**
 * O frustum do shadow map da cesium-viewshed contra o campo vertical pedido.
 *
 * A biblioteca monta o shadow map com `fov = min(max(horizontal, vertical), 170)`
 * e passava o ASPECTO DO CANVAS como `aspectRatio`. No Cesium (conferido no
 * bundle em public/vendors/cesium/Cesium.js) o `fov` vale para o eixo maior:
 * `fovy = aspectRatio <= 1 ? fov : 2*atan(tan(fov/2)/aspectRatio)`. Com um canvas
 * deitado o campo vertical saia encolhido, enquanto o shader seguia cortando em
 * `czzj/2` com o valor cheio: a faixa entre o que o frustum cobria e o que o
 * shader prometia ficava sem tingir, e ninguem via porque a analise "funcionava".
 *
 * O PIOR CASO desta regua e o canvas mais deitado que a tela do chefe alcanca
 * (21:9 e a janela achatada de 4000x600 do modo apresentacao), onde o encolhimento
 * e maior. A regua exercita OS DOIS eixos: o horizontal tem de continuar cobrindo
 * o que cobria, senao trocar o aspecto conserta a vertical estragando a outra.
 *
 * A textura do shadow map de um spot light e QUADRADA (2048x2048, conferido no
 * mesmo bundle), entao o aspecto certo e 1: nao ha eixo maior a favorecer.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createContext, runInContext } from 'vm';

// ===== A biblioteca, carregada pelo ramo CommonJS do UMD =====

const FONTE = resolve(__dirname, '../../public/vendors/cesium/cesium-viewshed.js');

/** Frustums entregues ao ShadowMap na ultima construcao. */
let frustumCriado;

/**
 * Simbolo generico para o rabo do Cesium que o modulo do sensor retangular le na
 * carga (Event, createPropertyDescriptor, BlendingState e companhia). Chamavel,
 * construivel, e devolve outro generico em qualquer propriedade. Nada que a
 * regua afirma passa por aqui: o frustum vem dos dubles nomeados.
 */
function generico(nome) {
    const fn = function () { return {}; };
    Object.defineProperty(fn, 'name', { value: nome });
    return new Proxy(fn, {
        get: (alvo, chave) => {
            if (chave === 'prototype' || chave === 'name' || chave === 'length') return alvo[chave];
            if (chave === Symbol.toPrimitive || typeof chave === 'symbol') return undefined;
            return generico(`${nome}.${String(chave)}`);
        },
        construct: () => ({})
    });
}

/** Cesium dublado ate onde a construcao do ViewShed3D chega. */
function fazerCesium() {
    frustumCriado = null;

    class Cartesian3 {
        constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    }
    const c3 = (x, y, z) => new Cartesian3(x, y, z);

    Object.assign(Cartesian3, {
        clone: (a, out) => Object.assign(out || c3(), { x: a.x, y: a.y, z: a.z }),
        subtract: (a, b, out) => Object.assign(out || c3(), { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
        negate: (a, out) => Object.assign(out || c3(), { x: -a.x, y: -a.y, z: -a.z }),
        normalize: (a, out) => {
            const m = Math.hypot(a.x, a.y, a.z) || 1;
            return Object.assign(out || c3(), { x: a.x / m, y: a.y / m, z: a.z / m });
        },
        distance: (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
    });

    class Camera {
        constructor() {
            this.position = c3();
            this.direction = c3(0, 0, 1);
            this.up = c3(0, 1, 0);
            this.frustum = null;
        }
        get directionWC() { return this.direction; }
        get upWC() { return this.up; }
        get rightWC() { return c3(1, 0, 0); }
    }

    return {
        // O UMD passa o Cesium por um interop que embrulha em { default } quando
        // nao ha __esModule, e ai o modulo do sensor retangular le tudo de um
        // objeto vazio e quebra na carga.
        __esModule: true,
        defaultValue: (a, b) => (a === undefined || a === null ? b : a),
        defined: (x) => x !== undefined && x !== null,
        Math: { toRadians: (d) => (d * Math.PI) / 180, toDegrees: (r) => (r * 180) / Math.PI },
        Cartesian3,
        Camera,
        Matrix3: Object.assign(class Matrix3 {}, { setColumn: (m) => m }),
        Matrix4: Object.assign(class Matrix4 {}, {
            fromRotationTranslation: () => new (class {})()
        }),
        Quaternion: Object.assign(class Quaternion {}, { fromRotationMatrix: () => ({}) }),
        Transforms: { eastNorthUpToFixedFrame: () => ({}) },
        PerspectiveFrustum: class {
            constructor(options) { Object.assign(this, options); }
        },
        ShadowMap: class {
            constructor(options) {
                frustumCriado = options.lightCamera.frustum;
                this._isPointLight = false;
                this._primitiveBias = { depthBias: 0 };
                this._terrainBias = { depthBias: 0 };
            }
        },
        PostProcessStage: class {
            constructor(options) { Object.assign(this, options); }
        },
        RectangularSensorGraphics: class {
            constructor(options) { Object.assign(this, options); }
        },
        Color: class {
            constructor(r, g, b, a) { Object.assign(this, { red: r, green: g, blue: b, alpha: a }); }
        },
        CallbackProperty: class {
            constructor(fn) { this.fn = fn; }
        },
        ScreenSpaceEventHandler: class {
            setInputAction() {}
            removeInputAction() {}
            destroy() {}
        },
        ScreenSpaceEventType: { LEFT_CLICK: 1, MOUSE_MOVE: 2, RIGHT_CLICK: 3 }
    };
}

/** O Cesium dublado com o rabo generico atras, para o UMD carregar inteiro. */
function fazerCesiumCompleto() {
    const nomeado = fazerCesium();
    return new Proxy(nomeado, {
        get: (alvo, chave) => (chave in alvo ? alvo[chave] : generico(String(chave))),
        has: () => true,
        set: (alvo, chave, valor) => { alvo[chave] = valor; return true; }
    });
}

/** Viewer dublado com um canvas da forma pedida. */
function fazerViewer(largura, altura) {
    return {
        scene: {
            canvas: { clientWidth: largura, clientHeight: altura },
            context: {},
            primitives: { add: (x) => x, remove: () => {} },
            postProcessStages: { add: (x) => x, remove: () => {} },
            globe: {}
        },
        canvas: { clientWidth: largura, clientHeight: altura, style: {} },
        entities: { add: (x) => x, remove: () => {} },
        camera: {}
    };
}

let fonte;

beforeAll(() => {
    fonte = readFileSync(FONTE, 'utf-8');
});

/**
 * Constroi um ViewShed3D com os dois pontos ja definidos (sem clique) e devolve
 * o frustum que a biblioteca entregou ao ShadowMap.
 */
function frustumDe({ horizontalAngle, verticalAngle, largura, altura }) {
    // O corpo do ViewShed3D le o `Cesium` GLOBAL, como no navegador, onde a
    // biblioteca entra por <script> depois do Cesium.js. Um contexto de vm da
    // esse global sem sujar o da suite.
    const Cesium = fazerCesiumCompleto();
    const modulo = { exports: {} };
    const contexto = createContext({
        Cesium,
        module: modulo,
        exports: modulo.exports,
        require: () => Cesium,
        console
    });
    runInContext(fonte, contexto, { filename: FONTE });

    const viewer = fazerViewer(largura, altura);
    new Cesium.ViewShed3D(viewer, {
        cameraPosition: new Cesium.Cartesian3(0, 0, 0),
        viewPosition: new Cesium.Cartesian3(500, 0, 0),
        horizontalAngle,
        verticalAngle,
        distance: 500
    });

    return frustumCriado;
}

/** Abertura vertical efetiva do frustum, em graus (formula do Cesium). */
function campoVerticalEfetivo(frustum) {
    const fov = (frustum.fov * 180) / Math.PI;
    if (frustum.aspectRatio <= 1) return fov;
    return (2 * Math.atan(Math.tan((frustum.fov) / 2) / frustum.aspectRatio) * 180) / Math.PI;
}

/** Abertura horizontal efetiva do frustum, em graus. */
function campoHorizontalEfetivo(frustum) {
    const fov = (frustum.fov * 180) / Math.PI;
    if (frustum.aspectRatio >= 1) return fov;
    return (2 * Math.atan(Math.tan((frustum.fov) / 2) * frustum.aspectRatio) * 180) / Math.PI;
}

const FORMATOS = [
    ['quadrado', 1000, 1000],
    ['16:9', 1920, 1080],
    ['21:9', 2560, 1080],
    ['apresentacao achatada', 4000, 600],
    ['retrato', 900, 1600]
];

describe('frustum do shadow map contra os angulos pedidos', () => {
    it.each(FORMATOS)('canvas %s cobre o campo vertical de 120 graus', (_nome, largura, altura) => {
        const frustum = frustumDe({ horizontalAngle: 120, verticalAngle: 120, largura, altura });

        expect(campoVerticalEfetivo(frustum)).toBeGreaterThanOrEqual(120 - 1e-6);
    });

    it.each(FORMATOS)('canvas %s cobre o campo horizontal de 120 graus', (_nome, largura, altura) => {
        const frustum = frustumDe({ horizontalAngle: 120, verticalAngle: 120, largura, altura });

        expect(campoHorizontalEfetivo(frustum)).toBeGreaterThanOrEqual(120 - 1e-6);
    });

    it('o setor de 150 graus, o maior que uma instancia aguenta, cabe nos dois eixos', () => {
        const frustum = frustumDe({ horizontalAngle: 150, verticalAngle: 120, largura: 1920, altura: 1080 });

        expect(campoHorizontalEfetivo(frustum)).toBeGreaterThanOrEqual(150 - 1e-6);
        expect(campoVerticalEfetivo(frustum)).toBeGreaterThanOrEqual(120 - 1e-6);
    });

    it('a mesma analise rende o mesmo frustum em qualquer forma de janela', () => {
        const deitado = frustumDe({ horizontalAngle: 120, verticalAngle: 120, largura: 1920, altura: 1080 });
        const empe = frustumDe({ horizontalAngle: 120, verticalAngle: 120, largura: 900, altura: 1600 });

        expect(deitado.aspectRatio).toBe(empe.aspectRatio);
        expect(deitado.fov).toBeCloseTo(empe.fov, 12);
    });

    it('o alcance de 5000 m, o teto do painel, cabe no far plane', () => {
        const frustum = frustumDe({ horizontalAngle: 120, verticalAngle: 120, largura: 1920, altura: 1080 });

        expect(frustum.far).toBeGreaterThanOrEqual(5000);
    });
});
