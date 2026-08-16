// Path: tests/unit/deep-link-fp.test.js
//
// The first-person deep link (`#view=fp`) and the boot-routing defect it exposed.
//
// Two things are pinned here, and the second one is a bug fix, not a feature:
//
// 1. The hash grammar. A shared link is third-party text — truncated by a chat
//    client, hand-edited, or plain garbage — so a malformed pose must fall back
//    to the scene's `poseInicial` instead of sending the camera to an arbitrary
//    zero, and a link must never be built with the literal "NaN" in it.
//
// 2. `shouldRouteToProjects`. The phase -1 redirect is
//    `window.location.replace('./atlas.html')`, which carries NO fragment: a
//    signed-in visitor opening `/#view=fp&scene=…` landed on "Seus projetos" and
//    the payload of the link evaporated, silently. That was already true for
//    `#view=360` and `#view=3d`. Behaviour was the only witness, which is why the
//    decision was moved out of `index.js` (it runs `initApp()` at import time and
//    cannot be imported by a test) into `deep-link/route-decision.js`.

import { describe, it, expect, afterEach } from 'vitest';
import {
    parseDeepLink,
    buildShareUrlFirstPerson,
    resolveFpPose
} from '@js/deep-link/deep-link.js';
import { shouldRouteToProjects } from '@js/deep-link/route-decision.js';

/**
 * Installs a minimal `window` (the modules only ever read `location`) and returns
 * the uninstaller. The test environment is `node`, so there is none by default.
 */
function installWindow({ hash = '', search = '', origin = 'https://ebgeo.exemplo', pathname = '/' } = {}) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', {
        value: { location: { hash, search, origin, pathname } },
        configurable: true,
        writable: true
    });
    return () => {
        if (previous) Object.defineProperty(globalThis, 'window', previous);
        else delete globalThis.window;
    };
}

let uninstall = () => {};
afterEach(() => { uninstall(); uninstall = () => {}; });

describe('parseDeepLink — the three viewer grammars', () => {
    it('reads a 360 link', () => {
        uninstall = installWindow({ hash: '#view=360&photo=abc-123&lon=10.5&lat=-3.25&fov=75' });
        expect(parseDeepLink()).toEqual({
            type: '360',
            photo: 'abc-123',
            lon: 10.5,
            lat: -3.25,
            fov: 75
        });
    });

    it('reads a 3d link', () => {
        uninstall = installWindow({
            hash: '#view=3d&tileset=museu&lon=-43.2&lat=-22.9&h=120.5&heading=1.5&pitch=-0.3&roll=0'
        });
        expect(parseDeepLink()).toEqual({
            type: '3d',
            tileset: 'museu',
            lon: -43.2,
            lat: -22.9,
            height: 120.5,
            heading: 1.5,
            pitch: -0.3,
            roll: 0
        });
    });

    it('reads an fp link, pose included', () => {
        uninstall = installWindow({
            hash: '#view=fp&scene=museu-1cgeo&x=1.25&y=-2.5&z=0&yaw=3.1416&pitch=-0.2'
        });
        expect(parseDeepLink()).toEqual({
            type: 'fp',
            scene: 'museu-1cgeo',
            x: 1.25,
            y: -2.5,
            z: 0,
            yaw: 3.1416,
            pitch: -0.2
        });
    });

    it('refuses an fp link with no scene: there is nothing to open', () => {
        uninstall = installWindow({ hash: '#view=fp&x=1&y=2&z=3' });
        expect(parseDeepLink()).toBeNull();
    });

    it('reports every unusable pose component as absent, never as a number', () => {
        // `parseFloat('12abc')` is 12 and `Number('')` is 0 — both would move the
        // camera somewhere nobody asked for. Only a whole finite number survives.
        uninstall = installWindow({
            hash: '#view=fp&scene=s&x=12abc&y=&z=Infinity&yaw=NaN'
        });
        expect(parseDeepLink()).toEqual({
            type: 'fp',
            scene: 's',
            x: null,
            y: null,
            z: null,
            yaw: null,
            pitch: null // absent from the hash altogether
        });
    });

    it('ignores a hash that names no viewer, and an empty one', () => {
        for (const hash of ['', '#', '#qualquer-coisa', '#view=xyz&scene=s']) {
            uninstall = installWindow({ hash });
            expect(parseDeepLink(), `hash ${JSON.stringify(hash)}`).toBeNull();
            uninstall();
        }
    });
});

describe('resolveFpPose — a malformed link lands on poseInicial, never breaks', () => {
    const poseInicial = { x: 10, y: 20, z: 30, yaw: 0.5, pitch: -0.1 };

    it('prefers every component the link carried', () => {
        const link = { x: 1, y: 2, z: 3, yaw: 0.25, pitch: 0 };
        expect(resolveFpPose(link, poseInicial)).toEqual(link);
    });

    it('fills each missing component from poseInicial, component by component', () => {
        const link = { x: 1, y: null, z: null, yaw: null, pitch: 0 };
        expect(resolveFpPose(link, poseInicial)).toEqual({
            x: 1, y: 20, z: 30, yaw: 0.5, pitch: 0
        });
    });

    it('falls back entirely when the link carried nothing usable', () => {
        const link = { x: null, y: null, z: null, yaw: null, pitch: null };
        expect(resolveFpPose(link, poseInicial)).toEqual(poseInicial);
    });

    it('drops the whole pose when a component is missing on BOTH sides', () => {
        // Half a pose is worse than none: the viewer would place the camera at an
        // arbitrary zero instead of applying its own default.
        const link = { x: 1, y: 2, z: 3, yaw: null, pitch: null };
        expect(resolveFpPose(link, { x: 0, y: 0, z: 0, pitch: 0 })).toBeNull();
        expect(resolveFpPose(link, null)).toBeNull();
        expect(resolveFpPose(link)).toBeNull();
    });
});

describe('buildShareUrlFirstPerson', () => {
    it('round-trips through parseDeepLink', () => {
        uninstall = installWindow({ origin: 'https://ebgeo.exemplo', pathname: '/mapa/' });
        const url = buildShareUrlFirstPerson('museu-1cgeo', 1.25, -2.5, 0, 3.1416, -0.2);
        expect(url.startsWith('https://ebgeo.exemplo/mapa/#')).toBe(true);

        uninstall();
        uninstall = installWindow({ hash: `#${url.split('#')[1]}` });
        expect(parseDeepLink()).toEqual({
            type: 'fp',
            scene: 'museu-1cgeo',
            x: 1.25,
            y: -2.5,
            z: 0,
            yaw: 3.1416,
            pitch: -0.2
        });
    });

    it('never writes the literal "NaN" into a link that is about to be shared', () => {
        uninstall = installWindow({});
        const url = buildShareUrlFirstPerson('s', NaN, undefined, Infinity, 1, -1);
        expect(url).not.toContain('NaN');
        expect(url).not.toContain('Infinity');
        expect(url).toContain('x=0.00');
        expect(url).toContain('y=0.00');
        expect(url).toContain('z=0.00');
    });
});

describe('shouldRouteToProjects — a viewer hash keeps the visit on the map', () => {
    it('sends a signed-in visitor at a bare / to the chooser', () => {
        uninstall = installWindow({});
        expect(shouldRouteToProjects(null, null, true)).toBe(true);
    });

    it('stays on the map for all THREE viewer hashes', () => {
        // The redirect drops the fragment, so routing away destroys the link. The
        // fp case is the one that made this intolerable, but the fix covers three.
        const hashes = [
            '#view=fp&scene=museu-1cgeo&x=1.25&y=-2.5&z=0&yaw=3.1416&pitch=-0.2',
            '#view=3d&tileset=museu&lon=-43.2&lat=-22.9&h=120.5',
            '#view=360&photo=abc-123&lon=10.5&lat=-3.25&fov=75'
        ];
        for (const hash of hashes) {
            uninstall = installWindow({ hash });
            expect(shouldRouteToProjects(null, null, true), hash).toBe(false);
            uninstall();
        }
    });

    it('still routes when the hash names no viewer', () => {
        // Deciding from `parseDeepLink()` and not from "the hash is non-empty":
        // a stray fragment is not a reason to skip the chooser.
        for (const hash of ['#', '#secao-qualquer', '#view=fp']) {
            uninstall = installWindow({ hash });
            expect(shouldRouteToProjects(null, null, true), hash).toBe(true);
            uninstall();
        }
    });

    it('never routes an anonymous visitor, hash or no hash', () => {
        uninstall = installWindow({});
        expect(shouldRouteToProjects(null, null, false)).toBe(false);
        uninstall();
        uninstall = installWindow({ hash: '#view=fp&scene=s' });
        expect(shouldRouteToProjects(null, null, false)).toBe(false);
    });

    it('keeps honouring the reasons that were already there', () => {
        uninstall = installWindow({ search: '?atlas=uuid' });
        expect(shouldRouteToProjects({ atlasId: 'uuid' }, null, true)).toBe(false);
        uninstall();

        uninstall = installWindow({ search: '?atlasPublico=uuid' });
        expect(shouldRouteToProjects(null, 'uuid', true)).toBe(false);
        uninstall();

        uninstall = installWindow({ search: '?verify=token' });
        expect(shouldRouteToProjects(null, null, true)).toBe(false);
    });
});
