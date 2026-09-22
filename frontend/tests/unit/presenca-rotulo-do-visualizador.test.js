// Path: tests/unit/presenca-rotulo-do-visualizador.test.js

/**
 * @fileoverview A frase que a lista de quem está online escreve para o visualizador aberto por um
 * colega (dono, 2026-09-22). O nome do recurso vem do SERVIDOR, já decidido por destinatário
 * (`backend/src/modules/collab/collab.viewer.js`), então o caso que importa é o do recurso NULO:
 * a frase diz o tipo de visualizador e nada mais, nunca um identificador.
 */

import { describe, it, expect } from 'vitest';
import { viewerLabel } from '@js/presence/viewer-label.js';

describe('viewerLabel', () => {
    it('nomeia o modelo 3D, a cena caminhável e o 360 com projeto e foto', () => {
        expect(viewerLabel({ surface: '3d', recurso: { nome: 'Museu' } })).toBe('no 3D: Museu');
        expect(viewerLabel({ surface: 'fp', recurso: { nome: 'Galeria' } })).toBe('na cena 3D: Galeria');
        expect(viewerLabel({ surface: '360', recurso: { nome: 'Quartel', foto: 'IMG_1.jpg' } }))
            .toBe('no 360°: Quartel, foto IMG_1.jpg');
        expect(viewerLabel({ surface: '360', recurso: { nome: 'Quartel', foto: null } })).toBe('no 360°: Quartel');
    });

    it('sem recurso (privado que este cliente não lê) diz só o tipo de visualizador', () => {
        expect(viewerLabel({ surface: '3d', recurso: null })).toBe('no visualizador 3D');
        expect(viewerLabel({ surface: 'fp', recurso: null })).toBe('numa cena 3D');
        expect(viewerLabel({ surface: '360', recurso: null })).toBe('no visualizador 360°');
        // Um recurso sem nome não vira id na tela: o servidor nem manda id nesse caso.
        expect(viewerLabel({ surface: '3d', recurso: { id: 'modelo-secreto', nome: '' } })).toBe('no visualizador 3D');
    });

    it('no mapa, ou com valor malformado, não há frase', () => {
        expect(viewerLabel(null)).toBeNull();
        expect(viewerLabel(undefined)).toBeNull();
        expect(viewerLabel({ surface: '2d', recurso: null })).toBeNull();
        expect(viewerLabel({ surface: 'teleporte', recurso: { nome: 'x' } })).toBeNull();
        expect(viewerLabel('3d')).toBeNull();
    });
});
