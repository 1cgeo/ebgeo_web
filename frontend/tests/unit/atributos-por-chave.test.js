// Path: tests/unit/atributos-por-chave.test.js

/**
 * @fileoverview AS DUAS METADES DO CLIENTE da convergência por chave dos atributos personalizados
 * (decisão do dono em 2026-09-24): o patch que sai, e o desfazer que volta.
 *
 * 1. `featureMutationContract` (`frontend/src/js/store/sync/feature-patch.js`) passa a mandar
 *    `['properties','attributes',chave]`, com `op: 'remove'` para a exclusão, em vez do objeto
 *    inteiro. O servidor funde e disputa por chave (`backend/src/modules/sync/feature-conflicts.js`,
 *    medido contra o backend real em `frontend/tests/e2e/atributos-por-chave.e2e.test.js`).
 * 2. `keepLaterEdits` (`frontend/src/js/store/feature.operations.js`), a regra que faz o desfazer
 *    devolver só o que a edição mudou, também passa a ler os atributos por chave: com o objeto como
 *    unidade, desfazer a MINHA mudança de "x" depois de o colega mudar "z" não desfazia nada, porque
 *    o objeto inteiro "tinha sido mexido depois".
 */

import { describe, it, expect } from 'vitest';
import { featureMutationContract } from '../../src/js/store/sync/feature-patch.js';
import { keepLaterEdits } from '../../src/js/store/feature.operations.js';

const ponto = (attributes, extra = {}) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
    properties: { id: 'p1', source: 'point', nome: 'Posto', confirmedVersion: 4, ...extra, ...(attributes === undefined ? {} : { attributes }) },
});

const caminhos = (patch) => patch.map((e) => `${e.op}:${e.path.join('.')}${e.op === 'set' ? `=${JSON.stringify(e.value)}` : ''}`).sort();

describe('o patch de atributos sai por chave', () => {
    it('excluir, mudar e acrescentar viram uma entrada por chave, e a exclusão é explícita', () => {
        const { patch, baseVersion } = featureMutationContract('update',
            ponto({ y: 'dois', z: 'um', w: 'novo' }), ponto({ x: 'um', y: 'um', z: 'um' }));
        expect(baseVersion).toBe(4);
        expect(caminhos(patch)).toEqual([
            'remove:properties.attributes.x',
            'set:properties.attributes.w="novo"',
            'set:properties.attributes.y="dois"',
        ]);
    });

    it('o primeiro atributo de uma feição sem bolsa também sai por chave', () => {
        const { patch } = featureMutationContract('update', ponto({ x: 'um' }), ponto(undefined));
        expect(caminhos(patch)).toEqual(['set:properties.attributes.x="um"']);
    });

    it('atributos iguais não produzem entrada nenhuma', () => {
        const { patch } = featureMutationContract('update', ponto({ x: 'um' }, { nome: 'Outro' }), ponto({ x: 'um' }));
        expect(caminhos(patch)).toEqual(['set:properties.nome="Outro"']);
    });

    it('a bolsa que some, ou que não é objeto, continua indo inteira (o formato antigo)', () => {
        expect(caminhos(featureMutationContract('update', ponto(undefined), ponto({ x: 'um' })).patch))
            .toEqual(['remove:properties.attributes']);
        expect(caminhos(featureMutationContract('update', ponto(['a']), ponto({ x: 'um' })).patch))
            .toEqual(['set:properties.attributes=["a"]']);
    });

    it('uma chave que o servidor recusaria faz a bolsa ir inteira, nunca por chave', () => {
        const antes = ponto({ x: 'um' });
        const depois = ponto({ x: 'um' });
        Object.defineProperty(depois.properties.attributes, 'constructor', { value: 'mal', enumerable: true });
        const { patch } = featureMutationContract('update', depois, antes);
        expect(patch).toHaveLength(1);
        expect(patch[0].path).toEqual(['properties', 'attributes']);
    });
});

describe('o desfazer lê os atributos por chave', () => {
    it('o colega mudou "z" depois da minha mudança de "x": o desfazer devolve "x" e deixa o "z" dele', () => {
        const antes = ponto({ x: 'velho', z: 'um' });
        const depois = ponto({ x: 'meu', z: 'um' });
        const agora = ponto({ x: 'meu', z: 'do colega' });
        expect(keepLaterEdits(agora, depois, antes).properties.attributes).toEqual({ x: 'velho', z: 'do colega' });
    });

    it('o colega EXCLUIU "z" depois: o desfazer não o ressuscita', () => {
        const antes = ponto({ x: 'velho', z: 'um' });
        const depois = ponto({ x: 'meu', z: 'um' });
        const agora = ponto({ x: 'meu' });
        expect(keepLaterEdits(agora, depois, antes).properties.attributes).toEqual({ x: 'velho' });
    });

    it('o colega mexeu na MESMA chave depois: o valor dele fica', () => {
        const antes = ponto({ x: 'velho' });
        const depois = ponto({ x: 'meu' });
        const agora = ponto({ x: 'do colega' });
        expect(keepLaterEdits(agora, depois, antes).properties.attributes).toEqual({ x: 'do colega' });
    });

    it('desfazer a minha exclusão de "x" devolve "x", mesmo com o colega mudando "y" depois', () => {
        const antes = ponto({ x: 'um', y: 'um' });
        const depois = ponto({ y: 'um' });
        const agora = ponto({ y: 'do colega' });
        expect(keepLaterEdits(agora, depois, antes).properties.attributes).toEqual({ x: 'um', y: 'do colega' });
    });

    it('ninguém mexeu depois: o desfazer devolve a bolsa inteira de antes', () => {
        const antes = ponto({ x: 'velho', z: 'um' });
        const depois = ponto({ x: 'meu', w: 'novo' });
        expect(keepLaterEdits(depois, depois, antes).properties.attributes).toEqual({ x: 'velho', z: 'um' });
    });
});
