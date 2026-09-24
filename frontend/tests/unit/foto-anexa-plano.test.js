// Path: tests/unit/foto-anexa-plano.test.js
//
// A REGRA DA FOTO ANEXA (2026-09-24, fase 1 aprovada pelo dono): quando uma foto de feição, de
// marcador 3D ou de marcador 360 é reduzida, e quando fica como veio. A parte com canvas é medida
// no navegador (`tests/e2e-ui/foto-anexa-comprimida.spec.js`); aqui fica a decisão, que é pura.

import { describe, it, expect } from 'vitest';
import { planPhotoEncoding, PHOTO_CONFIG } from '../../src/js/utilities/image_utils.js';
import { photoStillLargeNotice } from '../../src/js/utilities/image-limit-phrases.js';

describe('planPhotoEncoding', () => {
    it('uma foto de câmera é reduzida a 1600 px no lado maior, mantendo a proporção', () => {
        expect(planPhotoEncoding({ type: 'image/jpeg', size: 5e6, width: 4000, height: 3000 }))
            .toEqual({ keep: false, fits: false, width: 1600, height: 1200 });
        expect(planPhotoEncoding({ type: 'image/jpeg', size: 5e6, width: 3000, height: 4000 }))
            .toEqual({ keep: false, fits: false, width: 1200, height: 1600 });
    });

    it('abaixo de 2 MB e acima de 1600 px também é reduzida: o limiar antigo por bytes saiu', () => {
        const plano = planPhotoEncoding({ type: 'image/jpeg', size: 1.9 * 1024 * 1024, width: 3000, height: 2000 });
        expect(plano.keep).toBe(false);
        expect(Math.max(plano.width, plano.height)).toBe(PHOTO_CONFIG.maxSide);
    });

    it('já pequena e dentro do lado fica como veio; um byte acima do limiar é re-codificada', () => {
        expect(planPhotoEncoding({ type: 'image/jpeg', size: PHOTO_CONFIG.keepBytes, width: 800, height: 600 }).keep).toBe(true);
        expect(planPhotoEncoding({ type: 'image/png', size: 1000, width: 1600, height: 1600 }).keep).toBe(true);
        expect(planPhotoEncoding({ type: 'image/jpeg', size: PHOTO_CONFIG.keepBytes + 1, width: 800, height: 600 }))
            .toEqual({ keep: false, fits: true, width: 800, height: 600 });
        expect(planPhotoEncoding({ type: 'image/jpeg', size: 1000, width: 1601, height: 10 }).keep).toBe(false);
    });

    it('formato fora da lista do servidor nunca fica como veio', () => {
        expect(planPhotoEncoding({ type: 'image/gif', size: 1000, width: 10, height: 10 }).keep).toBe(false);
        expect(planPhotoEncoding({ type: '', size: 1000, width: 10, height: 10 }).keep).toBe(false);
    });

    it('medida ilegível não produz canvas de 0 nem NaN', () => {
        for (const ruim of [0, -1, NaN, Infinity, undefined, null]) {
            const plano = planPhotoEncoding({ type: 'image/jpeg', size: 5e6, width: ruim, height: ruim });
            expect(plano.width).toBeGreaterThanOrEqual(1);
            expect(plano.height).toBeGreaterThanOrEqual(1);
            expect(Number.isFinite(plano.width) && Number.isFinite(plano.height)).toBe(true);
        }
        expect(planPhotoEncoding({ type: 'image/jpeg', size: NaN, width: 10, height: 10 }).keep).toBe(false);
        expect(planPhotoEncoding().keep).toBe(false);
    });

    it('uma faixa estreita nunca vira 0 px no lado menor', () => {
        expect(planPhotoEncoding({ type: 'image/png', size: 5e6, width: 8000, height: 2 }))
            .toEqual({ keep: false, fits: false, width: 1600, height: 1 });
    });
});

describe('photoStillLargeNotice', () => {
    it('nomeia a foto, diz o tamanho e o que fazer', () => {
        expect(photoStillLargeNotice({ nome: 'IMG_0042.jpg', bytes: 1.2 * 1024 * 1024 })).toBe(
            'A foto "IMG_0042.jpg" ficou com 1,2 MB mesmo depois de reduzida e pode demorar a '
            + 'sincronizar. Se puder, anexe uma versão menor.');
    });

    it('sem nome, um rótulo genérico; sem número, "?" em vez de NaN', () => {
        expect(photoStillLargeNotice({ bytes: 2 * 1024 * 1024 }).startsWith('A foto ficou com 2 MB')).toBe(true);
        expect(photoStillLargeNotice({ nome: '  ', bytes: NaN })).toContain('A foto ficou com ? MB');
    });
});
