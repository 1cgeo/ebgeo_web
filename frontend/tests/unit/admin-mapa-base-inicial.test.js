// Path: tests/unit/admin-mapa-base-inicial.test.js

/**
 * @fileoverview O MAPA BASE INICIAL É ESCOLHA DO ADMINISTRADOR, e a aba "Sistema" é onde ela se
 * faz (pedido do dono, 2026-09-23: "torne isso configurável na tela de administrador - Sistema").
 *
 * O servidor serve `map2d.defaultBasemap` (`carta-topografica` por padrão) e recusa com 422 um id
 * que não seja mapa base público do catálogo: a borda de tipo é
 * `backend/tests/unit/config-mapa-base-inicial.test.js`, e a de existência mais a rota, é
 * `backend/tests/integration/config-mapa-base-inicial.test.js`. Nenhuma metade cobre a outra:
 * aquelas recusam o valor errado, esta garante que existe quem mande o certo.
 *
 * A GUARDA É ESTRUTURAL pela razão de `admin-sombreamento-do-relevo.test.js`: este pacote roda
 * vitest em node, sem jsdom. Por isso cada afirmação tem ao lado o CONTROLE NEGATIVO: a fonte é
 * mutilada de propósito e a mesma leitura tem de reprovar.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const FONTE = fs.readFileSync(new URL('../../src/js/admin/config-tab.js', import.meta.url), 'utf8');

/**
 * O trecho que monta o corpo de `map2d` no salvamento, entre a declaração do acumulador e o
 * envio dele. Ler o arquivo inteiro faria qualquer menção casar, inclusive a de um comentário.
 * @param {string} fonte
 * @returns {string}
 */
function blocoDoMap2d(fonte) {
    const i = fonte.indexOf('const map2dDiff = {};');
    if (i === -1) return '';
    const j = fonte.indexOf('payload.map2d = map2dDiff;', i);
    return j === -1 ? '' : fonte.slice(i, j);
}

/**
 * A criação do campo na tela: a chamada de `selectOne(...)` que carrega o testid, inteira.
 * @param {string} fonte
 * @returns {string}
 */
function campoDaBaseInicial(fonte) {
    const t = fonte.indexOf("'admin-config-map2d-default-basemap'");
    if (t === -1) return '';
    const i = fonte.lastIndexOf('selectOne(', t);
    const j = fonte.indexOf(');', t);
    return i === -1 || j === -1 ? '' : fonte.slice(i, j + 2);
}

describe('o campo existe na aba, na seção Mapa 2D, e lê o valor servido', () => {
    it('é um seletor com testid próprio, rotulado pelo que faz', () => {
        const campo = campoDaBaseInicial(FONTE);
        expect(campo).toMatch(/^selectOne\(/);
        expect(campo).toMatch(/'Mapa base inicial'/);
    });

    it('oferece a MESMA lista do mini-mapa do 360: os habilitados do catálogo, por prioridade', () => {
        // Uma segunda leitura de `eff.basemaps` seria uma segunda regra livre para divergir.
        expect(campoDaBaseInicial(FONTE)).toMatch(/basesDisponiveis/);
        expect(FONTE.match(/eff\.basemaps/g)).toHaveLength(1);
    });

    it('nasce selecionado no valor que o servidor serve', () => {
        // Um seletor que nascesse no primeiro item diria "Topográfica" a quem escolheu outra, e
        // o primeiro salvamento de QUALQUER campo da aba trocaria a escolha sem ninguém pedir.
        expect(campoDaBaseInicial(FONTE)).toMatch(/eff\.map2d\?\.defaultBasemap/);
    });

    it('fica na seção Mapa 2D, antes do Visualizador 360', () => {
        const campo = FONTE.indexOf("'admin-config-map2d-default-basemap'");
        expect(campo).toBeGreaterThan(FONTE.indexOf("heading(form, 'Mapa 2D')"));
        expect(campo).toBeLessThan(FONTE.indexOf("heading(form, 'Visualizador 360')"));
    });
});

describe('o salvamento manda a chave, só quando muda, e nunca vazia', () => {
    it('o corpo de `map2d` carrega `defaultBasemap` do seletor', () => {
        expect(blocoDoMap2d(FONTE)).toMatch(/map2dDiff\.defaultBasemap\s*=\s*baseInicial\.value/);
    });

    it('só quando MUDOU, que é o contrato da aba inteira', () => {
        expect(blocoDoMap2d(FONTE)).toMatch(/baseInicial\.value\s*!==\s*\(eff\.map2d\?\.defaultBasemap/);
    });

    it('nunca vazio: o servidor recusa `""` e reprovaria o salvamento da aba inteira', () => {
        expect(blocoDoMap2d(FONTE)).toMatch(/if\s*\(\s*baseInicial\.value\s*&&/);
    });
});

describe('a régua REPROVA a fonte mutilada', () => {
    it('fonte sem o campo não produz recorte nenhum', () => {
        const semCampo = FONTE.replace("'admin-config-map2d-default-basemap'", "'outro-campo'");
        expect(campoDaBaseInicial(semCampo)).toBe('');
    });

    it('fonte sem o envio não produz bloco com `defaultBasemap`', () => {
        const semEnvio = FONTE.replace(/map2dDiff\.defaultBasemap\s*=\s*baseInicial\.value;/, '');
        expect(blocoDoMap2d(semEnvio)).not.toMatch(/map2dDiff\.defaultBasemap\s*=/);
    });

    it('fonte que manda sempre (sem a comparação) reprova a regra do "só quando muda"', () => {
        const semComparacao = FONTE.replace(
            /if \(baseInicial\.value && baseInicial\.value !== \(eff\.map2d\?\.defaultBasemap \?\? ''\)\)/,
            'if (baseInicial.value)',
        );
        expect(semComparacao).not.toBe(FONTE);
        expect(blocoDoMap2d(semComparacao)).not.toMatch(/baseInicial\.value\s*!==\s*\(eff\.map2d\?\.defaultBasemap/);
    });

    it('o recorte do bloco NÃO enxerga o resto do arquivo', () => {
        const bloco = blocoDoMap2d(FONTE);
        expect(bloco.length).toBeGreaterThan(0);
        expect(bloco.length).toBeLessThan(FONTE.length / 2);
        expect(bloco).not.toMatch(/@fileoverview/);
        expect(bloco).not.toMatch(/'Mapa base inicial'/);
    });
});
