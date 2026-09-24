// Path: tests/unit/pending-edit-helpers.test.js

/**
 * @fileoverview A EDIÇÃO PENDENTE DO PAINEL contra a versão corrente da fonte.
 *
 * O que o módulo existe para impedir está no `fileoverview` dele: o "Salvar" grava a cópia DA
 * FONTE, e a fonte é redesenhada a partir da store a cada op remota, o que apaga a prévia do
 * painel. O caso de ponta a ponta, no navegador real, é
 * `tests/e2e-ui/edicao-pendente-sobrevive-a-op-remota.repro.spec.js`; aqui fica a régua da
 * aritmética, que é onde as bordas cabem.
 *
 * A ASSIMETRIA É O SUJEITO: reaplicar de menos perde a edição do usuário, reaplicar de mais
 * desfaz a edição do PAR. Os dois casos têm teste próprio abaixo, e nenhum dos dois passa por
 * acidente, porque cada um afirma o valor das DUAS chaves em jogo.
 */

import { describe, it, expect } from 'vitest';
import { mergePendingEdits, pendingPropertyEdits, rebaseOnStored } from '../../src/js/tool_manager/helpers/pending-edit.helpers.js';

const feicao = (props, geometry = { type: 'LineString', coordinates: [[0, 0], [1, 1]] }) => ({
    type: 'Feature',
    id: 'geo-1',
    properties: { id: 'f1', ...props },
    geometry,
});

describe('pendingPropertyEdits', () => {
    it('não acusa nada quando a cópia do painel é igual ao retrato', () => {
        const props = { id: 'f1', lineColor: '#111111', lineWidth: 3 };
        expect(pendingPropertyEdits(props, { ...props })).toEqual({});
    });

    it('acusa só a chave que o usuário mexeu', () => {
        const inicial = { id: 'f1', lineColor: '#111111', lineWidth: 3 };
        const atual = { id: 'f1', lineColor: '#00ff00', lineWidth: 3 };
        expect(pendingPropertyEdits(atual, inicial)).toEqual({ lineColor: '#00ff00' });
    });

    it('compara objeto e array por valor, não por identidade', () => {
        const inicial = { baseCoordinates: [[0, 0], [1, 1]], observations: { a: 1 } };
        const iguais = { baseCoordinates: [[0, 0], [1, 1]], observations: { a: 1 } };
        expect(pendingPropertyEdits(iguais, inicial)).toEqual({});

        const mexido = { baseCoordinates: [[0, 0], [2, 2]], observations: { a: 1 } };
        expect(pendingPropertyEdits(mexido, inicial)).toEqual({ baseCoordinates: [[0, 0], [2, 2]] });
    });

    it('acusa a chave acrescentada e a chave removida (esta como undefined)', () => {
        const inicial = { id: 'f1', nome: 'Alfa' };
        const atual = { id: 'f1', descricao: 'nova' };
        const deltas = pendingPropertyEdits(atual, inicial);
        expect(deltas).toEqual({ descricao: 'nova', nome: undefined });
        expect('nome' in deltas).toBe(true);
    });

    it('trata falsy e NaN sem inventar diferença', () => {
        const inicial = { visivel: false, opacity: 0, nada: null, ruim: NaN };
        const atual = { visivel: false, opacity: 0, nada: null, ruim: NaN };
        // NaN !== NaN, e os dois são objeto? não: caem no ramo escalar e DIVERGEM. A régua
        // documenta o que o código faz, em vez de fingir uma igualdade que ele não tem.
        expect(pendingPropertyEdits(atual, inicial)).toEqual({ ruim: NaN });
    });

    it('devolve vazio quando falta qualquer um dos dois lados', () => {
        expect(pendingPropertyEdits(null, { a: 1 })).toEqual({});
        expect(pendingPropertyEdits({ a: 1 }, undefined)).toEqual({});
    });
});

describe('mergePendingEdits', () => {
    it('reaplica a edição do usuário que o redesenho da fonte apagou', () => {
        const inicial = { id: 'f1', lineColor: '#111111', nome: 'Alfa' };
        const daFonte = feicao({ lineColor: '#111111', nome: 'Alfa' }); // redesenhada da store
        const doPainel = feicao({ lineColor: '#00ff00', nome: 'Alfa' });

        const saida = mergePendingEdits(daFonte, doPainel, inicial);
        expect(saida.properties.lineColor).toBe('#00ff00');
        expect(saida.properties.nome).toBe('Alfa');
    });

    it('NÃO desfaz a edição do par numa chave que o usuário não tocou', () => {
        const inicial = { id: 'f1', lineColor: '#111111', nome: 'Alfa' };
        // O par renomeou enquanto eu escolhia a cor: o redesenho trouxe o nome novo.
        const daFonte = feicao({ lineColor: '#111111', nome: 'Bravo' });
        const doPainel = feicao({ lineColor: '#00ff00', nome: 'Alfa' });

        const saida = mergePendingEdits(daFonte, doPainel, inicial);
        expect(saida.properties.lineColor).toBe('#00ff00');
        expect(saida.properties.nome, 'o nome do par sobrevive').toBe('Bravo');
    });

    it('devolve a feição da fonte SEM CÓPIA quando não há nada pendente', () => {
        const inicial = { id: 'f1', lineColor: '#111111' };
        const daFonte = feicao({ lineColor: '#222222' }); // o par mudou; eu não mexi em nada
        const doPainel = feicao({ lineColor: '#111111' });

        expect(mergePendingEdits(daFonte, doPainel, inicial)).toBe(daFonte);
    });

    it('sem retrato de abertura, não reaplica nada (comportamento anterior, intacto)', () => {
        const daFonte = feicao({ lineColor: '#111111' });
        const doPainel = feicao({ lineColor: '#00ff00' });
        expect(mergePendingEdits(daFonte, doPainel, undefined)).toBe(daFonte);
    });

    it('apaga a propriedade que o painel removeu', () => {
        const inicial = { id: 'f1', descricao: 'velha' };
        const daFonte = feicao({ descricao: 'velha' });
        const doPainel = { ...feicao({}), properties: { id: 'f1' } };

        const saida = mergePendingEdits(daFonte, doPainel, inicial);
        expect('descricao' in saida.properties).toBe(false);
    });

    it('a geometria acompanha baseCoordinates, e só ela', () => {
        const geoFonte = { type: 'LineString', coordinates: [[0, 0], [1, 1]] };
        const geoPainel = { type: 'LineString', coordinates: [[0, 0], [9, 9]] };

        // Só a cor mudou: a geometria da FONTE manda (ela carrega o arrasto de alça).
        const soCor = mergePendingEdits(
            feicao({ lineColor: '#111111', baseCoordinates: [[0, 0], [1, 1]] }, geoFonte),
            feicao({ lineColor: '#00ff00', baseCoordinates: [[0, 0], [1, 1]] }, geoPainel),
            { id: 'f1', lineColor: '#111111', baseCoordinates: [[0, 0], [1, 1]] },
        );
        expect(soCor.geometry).toBe(geoFonte);

        // As coordenadas mudaram no painel: a geometria derivada delas vai junto.
        const comCoords = mergePendingEdits(
            feicao({ baseCoordinates: [[0, 0], [1, 1]] }, geoFonte),
            feicao({ baseCoordinates: [[0, 0], [9, 9]] }, geoPainel),
            { id: 'f1', baseCoordinates: [[0, 0], [1, 1]] },
        );
        expect(comCoords.geometry).toBe(geoPainel);
    });

    it('não muta a feição lida da fonte', () => {
        const inicial = { id: 'f1', lineColor: '#111111' };
        const daFonte = feicao({ lineColor: '#111111' });
        mergePendingEdits(daFonte, feicao({ lineColor: '#00ff00' }), inicial);
        expect(daFonte.properties.lineColor).toBe('#111111');
    });

    it('argumento ausente não explode', () => {
        expect(mergePendingEdits(null, feicao({}), {})).toBe(null);
        const f = feicao({});
        expect(mergePendingEdits(f, null, {})).toBe(f);
    });
});

describe('rebaseOnStored', () => {
    // O caso de ponta a ponta, com dois navegadores, é
    // `tests/e2e-ui/trajetoria-arrasto-copia-velha.repro.spec.js`.
    const ponto = (props, coordinates = [0, 0]) => ({
        type: 'Feature', properties: { id: 'f1', source: 'military_symbol', ...props },
        geometry: { type: 'Point', coordinates },
    });

    it('as propriedades vêm da guardada: o nome do par e a rota sem o ponto que ele removeu', () => {
        const mostrada = ponto({ nome: 'antigo', trajetoria: [{ t: 1 }, { t: 2 }, { t: 3 }] });
        const guardada = ponto({ nome: 'do par', trajetoria: [{ t: 1 }, { t: 2 }] });
        const r = rebaseOnStored(mostrada, guardada);
        expect(r.properties.nome).toBe('do par');
        expect(r.properties.trajetoria).toEqual([{ t: 1 }, { t: 2 }]);
    });

    it('a chave que o par APAGOU não volta da mostrada', () => {
        const r = rebaseOnStored(ponto({ temporalFim: 5 }), ponto({}));
        expect('temporalFim' in r.properties).toBe(false);
    });

    it('a geometria mostrada e as chaves de runtime ficam (a posição deslocada e a casa)', () => {
        const mostrada = ponto({ _temporalHome: [0, 0], nome: 'a' }, [7, 7]);
        const guardada = ponto({ nome: 'b' }, [0, 0]);
        const r = rebaseOnStored(mostrada, guardada);
        expect(r.geometry.coordinates).toEqual([7, 7]);
        expect(r.properties._temporalHome).toEqual([0, 0]);
        expect(r.properties.nome).toBe('b');
    });

    it('sem a guardada (o par a excluiu) devolve a própria mostrada', () => {
        const mostrada = ponto({ nome: 'a' });
        expect(rebaseOnStored(mostrada, null)).toBe(mostrada);
        expect(rebaseOnStored(mostrada, undefined)).toBe(mostrada);
        expect(rebaseOnStored(null, ponto({}))).toBe(null);
    });

    it('guardada sem `source` herda o da mostrada, e nenhuma das duas é mutada', () => {
        const mostrada = ponto({ nome: 'a' });
        const guardada = { type: 'Feature', properties: { id: 'f1', nome: 'b' }, geometry: { type: 'Point', coordinates: [0, 0] } };
        const r = rebaseOnStored(mostrada, guardada);
        expect(r.properties.source).toBe('military_symbol');
        expect(mostrada.properties.nome).toBe('a');
        expect(guardada.properties.source).toBeUndefined();
    });
});
