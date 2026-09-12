// Path: tests/unit/admin-sombreamento-do-relevo.test.js

/**
 * @fileoverview O SOMBREAMENTO DO RELEVO É ESCOLHA DO ADMINISTRADOR, e a aba "Sistema" é o
 * único lugar onde ela se faz.
 *
 * O servidor serve `map2d.hillshade.enabled: false` por padrão, e isso é decisão do dono
 * (2026-09-12): a casa não decide por todo mundo. Até esta data não havia caminho NENHUM pela
 * tela, porque o editor "Avançado (JSON)" saiu do painel em 2026-08-29; só quem chamasse
 * `PUT /config/admin` à mão alcançava a chave. A borda de tipo no servidor é
 * `backend/tests/unit/config-sombreamento-do-relevo.test.js`, e nenhuma das duas metades
 * cobre a outra: aquela recusa o valor errado, esta garante que existe quem o mande.
 *
 * A GUARDA É ESTRUTURAL, e não é preguiça: este pacote roda vitest com `environment: 'node'`
 * e não traz jsdom, então montar a aba de verdade exigiria uma dependência nova para provar
 * três linhas. O preço da escolha é que uma guarda estrutural pode nascer cega, lendo texto
 * que sempre casa. Por isso cada afirmação vem com o CONTROLE NEGATIVO ao lado: a fonte é
 * mutilada de propósito e a mesma leitura tem de reprovar. Régua vista só passar em texto bom
 * não foi vista funcionar.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const FONTE = fs.readFileSync(new URL('../../src/js/admin/config-tab.js', import.meta.url), 'utf8');

/**
 * O trecho que monta o corpo de `map2d` no salvamento, recortado entre a declaração do
 * acumulador e o envio dele. Ler o arquivo INTEIRO faria qualquer menção casar, inclusive a
 * de um comentário, que é o jeito clássico de uma guarda destas mentir.
 * @param {string} fonte
 * @returns {string}
 */
export function blocoDoMap2d(fonte) {
    const i = fonte.indexOf('const map2dDiff = {};');
    if (i === -1) return '';
    const j = fonte.indexOf('payload.map2d = map2dDiff;', i);
    return j === -1 ? '' : fonte.slice(i, j);
}

/**
 * A criação do campo na tela, recortada da linha do `check(...)` que o declara.
 * @param {string} fonte
 * @returns {string}
 */
export function campoDoSombreamento(fonte) {
    const linhas = fonte.split('\n');
    const i = linhas.findIndex((l) => l.includes('admin-config-map2d-hillshade'));
    return i === -1 ? '' : linhas.slice(Math.max(0, i - 1), i + 2).join('\n');
}

describe('o campo existe na aba, e lê o valor que o servidor serve', () => {
    it('há uma caixa de marcar para o sombreamento, com testid próprio', () => {
        const campo = campoDoSombreamento(FONTE);

        expect(campo).toMatch(/check\(/);
        expect(campo).toMatch(/admin-config-map2d-hillshade/);
    });

    it('ela nasce marcada conforme `map2d.hillshade.enabled` do config efetivo', () => {
        // Uma caixa que nascesse sempre desmarcada diria "desligado" a quem já ligou, e o
        // primeiro salvamento seguinte desligaria de volta sem ninguém pedir.
        expect(campoDoSombreamento(FONTE)).toMatch(/eff\.map2d\?\.hillshade\?\.enabled/);
    });

    it('o rótulo diz do que se trata, em vez de repetir o nome da chave', () => {
        expect(campoDoSombreamento(FONTE)).toMatch(/Sombreamento do relevo/i);
    });
});

describe('o salvamento manda a chave, e manda SÓ ela', () => {
    it('o corpo de `map2d` carrega `hillshade`', () => {
        expect(blocoDoMap2d(FONTE)).toMatch(/map2dDiff\.hillshade\s*=/);
    });

    it('manda apenas `enabled`, porque o resto do bloco vem do servidor', () => {
        // O `deepMerge` de `getAppConfig` devolve nome, camada e tinta do estático. Mandar o
        // bloco inteiro daqui congelaria a tinta na versão que aquela tela leu, e uma mudança
        // de paleta no servidor nunca mais alcançaria este deploy.
        const bloco = blocoDoMap2d(FONTE);
        const atribuicao = /map2dDiff\.hillshade\s*=\s*\{([^}]*)\}/.exec(bloco);

        expect(atribuicao).not.toBeNull();
        expect(atribuicao[1]).toMatch(/enabled/);
        expect(atribuicao[1]).not.toMatch(/layer|paint|name|description/);
    });

    it('só manda quando MUDOU, que é o contrato desta aba inteira', () => {
        // A aba envia campo alterado, nunca o formulário todo: o documento de override guarda
        // exatamente o que um administrador decidiu, e o resto segue acompanhando o deploy.
        expect(blocoDoMap2d(FONTE)).toMatch(/if\s*\(\s*sombreamento\.checked\s*!==/);
    });
});

describe('a régua REPROVA a fonte mutilada, que é o que a torna régua', () => {
    it('fonte sem o campo não produz recorte nenhum', () => {
        const semCampo = FONTE.split('\n').filter((l) => !l.includes('admin-config-map2d-hillshade')).join('\n');

        expect(campoDoSombreamento(semCampo)).toBe('');
    });

    it('fonte sem o envio não produz bloco com `hillshade`', () => {
        const semEnvio = FONTE.replace(/map2dDiff\.hillshade\s*=\s*\{[^}]*\};/, '');

        expect(blocoDoMap2d(semEnvio)).not.toMatch(/map2dDiff\.hillshade\s*=/);
    });

    it('o recorte do bloco NÃO enxerga o resto do arquivo', () => {
        // O pior caso desta guarda: um recorte frouxo que leia o arquivo inteiro e case com a
        // palavra num comentário distante, aprovando uma aba que não manda nada.
        const bloco = blocoDoMap2d(FONTE);

        expect(bloco.length).toBeGreaterThan(0);
        expect(bloco.length).toBeLessThan(FONTE.length / 2);
        expect(bloco).not.toMatch(/@fileoverview/);
    });

    it('sem o acumulador, o recorte devolve vazio em vez de casar com tudo', () => {
        expect(blocoDoMap2d('const outraCoisa = {}; map2dDiff.hillshade = { enabled: true };')).toBe('');
    });
});
