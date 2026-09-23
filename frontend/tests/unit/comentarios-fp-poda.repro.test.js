import { describe, it, expect } from 'vitest';
import { podarDocumentoDeComentarios, RefVerdict } from '@catalog/private-reference-pruner.js';

describe('first-person comments respect export resource privacy', () => {
    for (const verdict of [RefVerdict.PRIVATE, RefVerdict.UNKNOWN]) {
        it(`removes the ${verdict} model thread, preserving public and map comments`, () => {
            const original = {
                hidden: { id: 'hidden', surface: 'fp', tilesetId: 'restricted-model', text: 'Private discussion' },
                reply: { id: 'reply', parentId: 'hidden', text: 'Private reply' },
                visible: { id: 'visible', surface: 'fp', tilesetId: 'public-model', text: 'Public discussion' },
                publicReply: { id: 'publicReply', parentId: 'visible', text: 'Public reply' },
                map: { id: 'map', surface: '2d', text: 'Map discussion' },
            };
            const before = structuredClone(original);
            const { documento, relatorio } = podarDocumentoDeComentarios(original,
                (_group, id) => id === 'public-model' ? RefVerdict.PUBLIC : verdict);
            expect(Object.keys(documento).sort()).toEqual(['map', 'publicReply', 'visible']);
            expect(documento.visible).toEqual(original.visible);
            expect(relatorio.porSuperficie['comments.modelo3d']).toBe(1);
            expect(original).toEqual(before);
        });
    }
});
