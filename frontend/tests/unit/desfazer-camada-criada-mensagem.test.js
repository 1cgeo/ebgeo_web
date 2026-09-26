// Path: tests/unit/desfazer-camada-criada-mensagem.test.js
//
// O AVISO DE DESFAZER UM PROCESSAMENTO OU UMA IMPORTAÇÃO nomeia a camada e quantas feições ela
// levou. Desde 2026-09-26 a entrada desses gestos é um `batch` com a camada criada e as feições
// (`addFeatures` com `createdLayer`), e o caso genérico de lote diria "2 operações desfeitas", que
// não diz à pessoa o que acabou de sumir da árvore.

import { describe, it, expect } from 'vitest';
import { describeUndoRedoAction } from '@store/undo-redo-messages.js';

const ponto = (id) => ({ type: 'Feature', properties: { id, source: 'point' } });

function entrada(n, nome = 'Resultado') {
    return {
        type: 'batch',
        operations: [
            { type: 'createLayer', layer: { id: 'l1', name: nome } },
            { type: 'addMultiple', features: { points: Array.from({ length: n }, (_, i) => ponto(`p${i}`)) } },
        ],
    };
}

describe('o aviso da camada criada', () => {
    it('nomeia a camada e conta as feições, no desfazer e no refazer', () => {
        expect(describeUndoRedoAction(entrada(12), 'undo')).toBe('Criação da camada "Resultado" com 12 feições desfeita');
        expect(describeUndoRedoAction(entrada(12), 'redo')).toBe('Criação da camada "Resultado" com 12 feições refeita');
    });

    it('uma feição fica no singular', () => {
        expect(describeUndoRedoAction(entrada(1), 'undo')).toBe('Criação da camada "Resultado" com 1 feição desfeita');
    });

    it('sem nome, ainda diz que foi uma camada', () => {
        expect(describeUndoRedoAction(entrada(2, ''), 'undo')).toBe('Criação da camada com 2 feições desfeita');
    });

    it('CONTROLE: um lote sem camada continua no caso genérico', () => {
        const lote = { type: 'batch', operations: [{ type: 'add', featureType: 'points', feature: ponto('a') }, { type: 'add', featureType: 'points', feature: ponto('b') }] };
        expect(describeUndoRedoAction(lote, 'undo')).toBe('2 operações desfeitas');
    });
});
