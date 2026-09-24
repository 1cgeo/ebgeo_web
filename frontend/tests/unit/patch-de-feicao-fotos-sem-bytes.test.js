// Path: tests/unit/patch-de-feicao-fotos-sem-bytes.test.js

/**
 * @fileoverview O PATCH DE FEIÇÃO COMPARA AS FOTOS SEM OS BYTES (2026-09-24, item 4 da segunda revisão
 * das fotos anexas).
 *
 * O lado anterior de uma edição de feição viaja sem os bytes das fotos inline
 * (`previousOfFeatureEdit`, `store/feature.operations.js`), e o lado novo com eles, porque a
 * reprojeção de uma intenção pendente grava o `data` como a entidade. Se o patch comparasse os dois
 * lados byte a byte, TODA edição de uma feição com foto inline reivindicaria `properties.images`, e
 * dois colegas que editassem campos diferentes disputariam as fotos. A regra é só para `images`: o
 * resto continua comparado inteiro.
 */

import { describe, it, expect } from 'vitest';
import { featureMutationContract } from '@js/store/sync/feature-patch.js';
import { fotosSemBytes } from '@js/user_data/photo-refs.js';

const INLINE = 'data:image/jpeg;base64,/9j/4AAQ';
const foto = (id, extra = {}) => ({ id, name: `${id}.jpg`, thumbnail: 'data:image/jpeg;base64,/9j/mini', data: INLINE, ...extra });

function feicao(images, extra = {}) {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: { id: 'f', source: 'point', nome: 'A', confirmedVersion: 3, images, ...extra },
    };
}

const caminhos = (patch) => patch.map((e) => e.path);

describe('o patch de feição e as fotos sem bytes', () => {
    it('as mesmas fotos, o anterior sem bytes: as fotos ficam fora do patch', () => {
        const anterior = feicao(fotosSemBytes([foto('a'), foto('b')]));
        const nova = feicao([foto('a'), foto('b')], { nome: 'B' });
        expect(featureMutationContract('update', nova, anterior).patch)
            .toEqual([{ op: 'set', path: ['properties', 'nome'], value: 'B' }]);
    });

    it('uma foto trocada, removida ou acrescentada entra no patch, com o valor novo inteiro', () => {
        const anterior = feicao(fotosSemBytes([foto('a'), foto('b')]));
        for (const novas of [[foto('a'), foto('c')], [foto('a')], [foto('a'), foto('b'), foto('c')]]) {
            const { patch } = featureMutationContract('update', feicao(novas), anterior);
            expect(caminhos(patch)).toEqual([['properties', 'images']]);
            expect(patch[0].value).toEqual(novas);
        }
    });

    it('a conversão (inline para referência sob id novo) entra no patch', () => {
        const anterior = feicao(fotosSemBytes([foto('a')]));
        const convertida = { id: 'novo', name: 'a.jpg', thumbnail: 'data:image/jpeg;base64,/9j/mini' };
        expect(caminhos(featureMutationContract('update', feicao([convertida]), anterior).patch)).toEqual([['properties', 'images']]);
    });

    it('um metadado da foto que muda (o nome) entra no patch', () => {
        const anterior = feicao(fotosSemBytes([foto('a')]));
        const renomeada = foto('a', { name: 'outro.jpg' });
        expect(caminhos(featureMutationContract('update', feicao([renomeada]), anterior).patch)).toEqual([['properties', 'images']]);
    });

    it('fora de `images`, um campo `data` continua comparado inteiro', () => {
        const anterior = feicao([], { atributos: { data: '2026-01-01' } });
        const nova = feicao([], { atributos: { data: '2026-02-02' } });
        expect(caminhos(featureMutationContract('update', nova, anterior).patch)).toEqual([['properties', 'atributos']]);
    });

    it('fotos ausentes nos dois lados, ou não-lista, não quebram a comparação', () => {
        const semFotos = { type: 'Feature', geometry: null, properties: { id: 'f', nome: 'A' } };
        expect(featureMutationContract('update', { ...semFotos, properties: { ...semFotos.properties, nome: 'B' } }, semFotos).patch)
            .toEqual([{ op: 'set', path: ['properties', 'nome'], value: 'B' }]);
        expect(caminhos(featureMutationContract('update', feicao('texto'), feicao(null)).patch)).toEqual([['properties', 'images']]);
    });
});
