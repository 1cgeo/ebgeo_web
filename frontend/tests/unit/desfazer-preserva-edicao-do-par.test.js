// Path: tests/unit/desfazer-preserva-edicao-do-par.test.js

/**
 * @fileoverview O DESFAZER DE UMA EDICAO DE FEICAO DEVOLVE SO' O QUE ELA MUDOU.
 *
 * A entrada de desfazer guarda a feicao inteira de antes e de depois, e o desfazer regravava a de
 * antes inteira: o nome que um colega deu DEPOIS da minha recoloracao voltava ao antigo, nos dois
 * clientes e no servidor (medido com duas browsers em
 * `frontend/tests/e2e-ui/desfazer-preserva-edicao-do-par.repro.spec.js`). `keepLaterEdits` e' a
 * regra que o conserto aplica dentro da trava do documento: o alvo e' `to`, exceto nos campos cujo
 * valor atual ja' nao e' o que a edicao deixou (`from`), que alguem escreveu depois.
 */

import { describe, it, expect } from 'vitest';
import { keepLaterEdits } from '../../src/js/store/feature.operations.js';

const linha = (props, coords = [[0, 0], [1, 1]]) => ({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: coords },
    properties: { id: 'l1', source: 'line', ...props },
});

describe('keepLaterEdits', () => {
    it('ninguem mexeu depois: o alvo e o estado de antes, inteiro', () => {
        const antes = linha({ nome: 'L', lineColor: '#111111' });
        const depois = linha({ nome: 'L', lineColor: '#ff0000' });
        expect(keepLaterEdits(depois, depois, antes)).toEqual(antes);
    });

    it('o colega renomeou depois da minha recoloracao: volta a cor, fica o nome dele', () => {
        const antes = linha({ nome: 'L', lineColor: '#111111' });
        const depois = linha({ nome: 'L', lineColor: '#ff0000' });
        const agora = linha({ nome: 'Nome do colega', lineColor: '#ff0000' });
        expect(keepLaterEdits(agora, depois, antes).properties).toEqual({ id: 'l1', source: 'line', nome: 'Nome do colega', lineColor: '#111111' });
    });

    it('o colega mexeu no MESMO campo depois: o valor dele fica', () => {
        const antes = linha({ lineColor: '#111111' });
        const depois = linha({ lineColor: '#ff0000' });
        const agora = linha({ lineColor: '#00ff00' });
        expect(keepLaterEdits(agora, depois, antes).properties.lineColor).toBe('#00ff00');
    });

    it('o colega moveu a geometria depois: a geometria dele fica', () => {
        const antes = linha({ nome: 'A' });
        const depois = linha({ nome: 'B' });
        const agora = linha({ nome: 'B' }, [[5, 5], [6, 6]]);
        const alvo = keepLaterEdits(agora, depois, antes);
        expect(alvo.geometry.coordinates).toEqual([[5, 5], [6, 6]]);
        expect(alvo.properties.nome).toBe('A');
    });

    it('um campo que o colega APAGOU depois continua apagado; um que ele CRIOU continua la', () => {
        const antes = linha({ descricao: 'x', lineColor: '#111111' });
        const depois = linha({ descricao: 'x', lineColor: '#ff0000' });
        const agora = linha({ lineColor: '#ff0000', rotulo: 'novo' });
        const alvo = keepLaterEdits(agora, depois, antes);
        expect(alvo.properties).not.toHaveProperty('descricao');
        expect(alvo.properties.rotulo).toBe('novo');
        expect(alvo.properties.lineColor).toBe('#111111');
    });

    it('nao muta as entradas', () => {
        const antes = linha({ lineColor: '#111111' });
        const depois = linha({ lineColor: '#ff0000' });
        const agora = linha({ lineColor: '#ff0000', nome: 'n' });
        const copia = JSON.stringify([antes, depois, agora]);
        keepLaterEdits(agora, depois, antes);
        expect(JSON.stringify([antes, depois, agora])).toBe(copia);
    });

    it('sem estado atual ou sem registro de depois, devolve uma copia do alvo', () => {
        const antes = linha({ lineColor: '#111111' });
        expect(keepLaterEdits(null, null, antes)).toEqual(antes);
        expect(keepLaterEdits(null, null, antes)).not.toBe(antes);
    });
});
