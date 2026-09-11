// Path: tests/unit/los-handles.test.js

/**
 * Os dois nos da linha de visada: observador no inicio, alvo no fim. Arrastar a
 * LINHA foi desligado (canMove devolve false), porque translada a geometria sem
 * reler o terreno debaixo dela; quem move a analise sao estes nos, e cada solta
 * dispara o recalculo inteiro.
 */

import { describe, it, expect } from 'vitest';
import AddLOSGeometry from '../../src/js/analysis_tools/los_tool/add_los_geometry.js';

const INICIO = [-53.5, -29.7];
const FIM = [-53.35, -29.62];

function featureSemObstrucao() {
    return {
        properties: { id: 'l1' },
        geometry: { type: 'LineString', coordinates: [INICIO, FIM] },
    };
}

function featureComObstrucao() {
    const intersecao = [-53.43, -29.66];
    return {
        properties: { id: 'l2' },
        geometry: {
            type: 'MultiLineString',
            coordinates: [[INICIO, intersecao], [intersecao, FIM]],
        },
    };
}

describe('createHandles', () => {
    it('devolve observador e alvo, ambos arrastaveis', () => {
        const geometry = new AddLOSGeometry();
        const handles = geometry.createHandles(featureSemObstrucao());

        expect(handles).toHaveLength(2);

        const [inicio, fim] = handles;
        expect(inicio.properties.handleId).toBe('start');
        expect(inicio.properties.handleType).toBe('observer');
        expect(inicio.geometry.coordinates).toEqual(INICIO);

        expect(fim.properties.handleId).toBe('end');
        expect(fim.properties.handleType).toBe('target');
        expect(fim.geometry.coordinates).toEqual(FIM);

        for (const h of handles) {
            expect(h.properties.user_isEditingHandle).toBe(true);
            expect(h.properties.featureId).toBe('l1');
        }
    });

    it('acha as pontas tambem quando a visada esta partida em visivel e obstruida', () => {
        const geometry = new AddLOSGeometry();
        const handles = geometry.createHandles(featureComObstrucao());

        // A ponta do alvo e o fim da SEGUNDA linha, nao o ponto de intersecao.
        expect(handles[0].geometry.coordinates).toEqual(INICIO);
        expect(handles[1].geometry.coordinates).toEqual(FIM);
    });

    it('devolve null quando a geometria nao tem duas pontas legiveis', () => {
        const geometry = new AddLOSGeometry();
        const handles = geometry.createHandles({
            properties: { id: 'l3' },
            geometry: { type: 'Point', coordinates: INICIO },
        });

        expect(handles).toBeNull();
    });
});

describe('updateFromHandle', () => {
    it('mover o observador mantem o alvo parado', () => {
        const geometry = new AddLOSGeometry();
        const novo = [-53.55, -29.75];

        const result = geometry.updateFromHandle('start', novo, featureSemObstrucao());

        expect(result.coordinates).toEqual([novo, FIM]);
    });

    it('mover o alvo mantem o observador parado', () => {
        const geometry = new AddLOSGeometry();
        const novo = [-53.30, -29.60];

        const result = geometry.updateFromHandle('end', novo, featureSemObstrucao());

        expect(result.coordinates).toEqual([INICIO, novo]);
    });

    it('recusa uma visada de comprimento zero, que nao tem perfil nem azimute', () => {
        const geometry = new AddLOSGeometry();

        // Alvo solto em cima do observador.
        expect(geometry.updateFromHandle('end', INICIO, featureSemObstrucao())).toBeNull();
    });

    it('recusa um handle que nao existe', () => {
        const geometry = new AddLOSGeometry();

        expect(geometry.updateFromHandle('center', [-53.4, -29.65], featureSemObstrucao())).toBeNull();
    });
});
