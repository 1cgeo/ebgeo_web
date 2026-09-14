// Path: tests/unit/cesium-measure-rotulos.test.js
//
// O que este teste prende, e por que sao exatamente estas duas funcoes.
//
// `services/cesium-measure.js` foi adotado como codigo da casa em 2026-09-14
// (decisao D9) vindo de `public/vendors/cesium/cesium-measure.js`, de onde
// chegou sem licenca, sem versao e sem upstream. Nao ha o que conferir contra
// terceiro: o unico eixo de verificacao disponivel e o DELTA da casa, e duas
// das cinco correcoes locais do fork sao justamente sobre estes dois rotulos
// (`a961a5942`, que trocou quatro decimais por um e o ponto pela virgula, e
// `95f9fe43b`, que consertou o divisor de km2 que `4d21c6abb` deixara em 1000).
//
// O RESTO DO ARQUIVO NAO E TESTAVEL EM NODE, e isso e propriedade dele, nao
// omissao daqui: todo o resto pinta entidade do Cesium a partir de um pick de
// tela, ou seja, precisa de contexto WebGL. O que sobrou puro sao os dois
// formatadores, e eles foram extraidos na adocao exatamente para caber aqui.
//
// A FRONTEIRA E O CASO QUE IMPORTA, porque o bug de `95f9fe43b` era so um
// divisor errado: um teste que medisse 500 m e 5 km passaria verde com ele
// dentro. Dai os casos colados na fronteira dos dois lados.
//
// Os nao-finitos sao asseridos como o COMPORTAMENTO QUE EXISTE, nao como o
// desejavel: `NaN` cai no ramo de km porque `NaN < 1000` e falso, e nenhuma
// guarda foi inventada na adocao. Se alguem acrescentar `Number.isFinite`
// depois, que seja com este teste ficando vermelho primeiro.

import { describe, it, expect } from 'vitest';
import {
    formatDistanceLabel,
    formatAreaLabel,
} from '../../src/js/3d_models_viewer_tool/services/cesium-measure.js';

describe('rotulo de distancia do medidor 3D', () => {
    it('le em metros abaixo de 1000 e em quilometros a partir dele', () => {
        expect(formatDistanceLabel(0)).toBe('0,0 m');
        expect(formatDistanceLabel(523.45)).toBe('523,5 m');
        expect(formatDistanceLabel(999.94)).toBe('999,9 m');
        expect(formatDistanceLabel(1000)).toBe('1,0 km');
        expect(formatDistanceLabel(1234.5)).toBe('1,2 km');
        expect(formatDistanceLabel(12345678)).toBe('12345,7 km');
    });

    it('CONTROLE DA FRONTEIRA: 999,95 arredonda para 1000,0 e continua em metros', () => {
        // O ramo e escolhido ANTES do arredondamento, entao existe um rotulo
        // legitimo de "1000,0 m". Quem "consertar" isso comparando o valor ja
        // arredondado muda o comportamento sem querer.
        expect(formatDistanceLabel(999.95)).toBe('1000,0 m');
    });

    it('usa virgula como separador decimal, uma vez so', () => {
        const rotulo = formatDistanceLabel(1500.55);
        expect(rotulo).toBe('1,5 km');
        expect(rotulo.split(',')).toHaveLength(2);
        expect(rotulo).not.toContain('.');
    });

    it('negativo cai no ramo de metros e o nao-finito no de quilometros', () => {
        expect(formatDistanceLabel(-5)).toBe('-5,0 m');
        expect(formatDistanceLabel(NaN)).toBe('NaN km');
        expect(formatDistanceLabel(Infinity)).toBe('Infinity km');
        expect(formatDistanceLabel(-Infinity)).toBe('-Infinity m');
    });
});

describe('rotulo de area do medidor 3D', () => {
    it('le em metros quadrados abaixo de 1 km2 e em km2 a partir dele', () => {
        expect(formatAreaLabel(0)).toBe('0,0 m²');
        expect(formatAreaLabel(1234.56)).toBe('1234,6 m²');
        expect(formatAreaLabel(999999)).toBe('999999,0 m²');
        expect(formatAreaLabel(1000000)).toBe('1,0 km²');
        expect(formatAreaLabel(2500000)).toBe('2,5 km²');
    });

    it('CONTROLE NEGATIVO DO DIVISOR: 1000 m2 nao viram 1 km2', () => {
        // Este e o caso exato que `4d21c6abb` quebrou e `95f9fe43b` consertou,
        // dividindo por 1000 em vez de 1000000. Sem ele, um teste de 500 m2 e
        // de 5 km2 passa verde com o divisor errado no meio.
        expect(formatAreaLabel(1000)).toBe('1000,0 m²');
        expect(formatAreaLabel(999999)).not.toContain('km');
    });

    it('usa o simbolo de metro quadrado e virgula decimal', () => {
        expect(formatAreaLabel(10.5)).toBe('10,5 m²');
        expect(formatAreaLabel(3000000)).toBe('3,0 km²');
    });

    it('negativo cai no ramo de metros quadrados e o nao-finito no de km2', () => {
        expect(formatAreaLabel(-5)).toBe('-5,0 m²');
        expect(formatAreaLabel(NaN)).toBe('NaN km²');
        expect(formatAreaLabel(Infinity)).toBe('Infinity km²');
    });
});
