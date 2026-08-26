// Path: tests/unit/aviso-de-camada-nao-engole-clique.test.js

/**
 * @fileoverview O AVISO DE CAMADA QUE NAO CARREGA NAO PODE TAPAR O MAPA, e ate 2026-08-25 ele
 * tapava.
 *
 * O DEFEITO, medido e nao suposto. `.data-layer-notice` (`src/css/data-layer-notice.css`) e
 * `position: absolute` no topo centralizado do conteiner do mapa, e PERSISTE enquanto a falha
 * durar. A persistencia e deliberada e esta escrita no proprio arquivo: "nao serve um aviso que
 * some em tres segundos para uma falha que persiste enquanto a pessoa navega". Acontece que o
 * bloco nao declarava `pointer-events`, entao ele interceptava TODO clique na faixa superior do
 * mapa. Quem tentasse desenhar ali nao recebia erro nenhum, so um clique que nao fazia nada.
 *
 * COMO APARECEU: cinco casos de Playwright reprovavam com "elemento coberto por
 * div.data-layer-notice" ao clicar no mapa, em specs que nao tem nada a ver com camada que falha
 * (`layers-tab-local`, `browser-collab-permissions`, `browser-collab-all-types`). O ambiente de
 * teste bloqueia os tiles externos, o aviso sobe, e passa a tapar o alvo. A leitura facil era
 * culpar o ambiente. A leitura certa e que o painel tem um defeito de interacao que o ambiente
 * de teste apenas TORNOU VISIVEL.
 *
 * POR QUE ISTO E TESTE DE CSS E NAO DE COMPORTAMENTO: o par que conserta o defeito vive inteiro
 * na folha, e ele e um PAR. `pointer-events: none` sozinho no bloco mata os dois botoes que sao a
 * razao de este painel nao ser um toast ("tentar de novo" e "dispensar"). Uma metade sem a outra
 * troca um defeito por outro pior, e nenhum teste de unidade do componente enxergaria isso,
 * porque os dois lados sao pintura.
 *
 * O CONTROLE DO PROPRIO VARREDOR esta no ultimo caso: sem ele, um seletor que parasse de casar
 * deixaria os dois primeiros verdes varrendo string vazia, que e a cobertura vazia de sempre.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const folha = readFileSync(resolve(FRONT, 'src/css/data-layer-notice.css'), 'utf8');

/** A folha SEM COMENTARIO. O porque do conserto esta escrito na prosa do arquivo, e a prosa
 *  nomeia `pointer-events` varias vezes: varrer com ela dentro faria o teste passar por causa da
 *  explicacao, e nao por causa da regra. */
function semComentarios(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** O corpo de uma regra, pelo seletor exato. Devolve null quando o seletor sumiu. */
function corpoDaRegra(css, seletor) {
    const escapado = seletor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const achado = new RegExp(`(^|[,}])\\s*${escapado}\\s*(,[^{]*)?\\{([^}]*)\\}`, 'm').exec(css);
    return achado ? achado[3] : null;
}

describe('o aviso de camada que nao carrega nao engole clique do mapa', () => {
    const limpa = semComentarios(folha);

    it('o BLOCO deixa o clique passar', () => {
        const corpo = corpoDaRegra(limpa, '.data-layer-notice');
        expect(corpo, 'a regra `.data-layer-notice` sumiu da folha').not.toBeNull();
        expect(
            corpo,
            'sem `pointer-events: none` o painel volta a interceptar todo clique na faixa superior '
            + 'do mapa, que e o defeito de 2026-08-25'
        ).toMatch(/pointer-events:\s*none/);
    });

    it('os filhos INTERATIVOS pegam o clique de volta', () => {
        // A outra metade do par. O painel existe para OFERECER "tentar de novo": um bloco
        // transparente ao clique com botoes tambem transparentes e um painel decorativo.
        // `__body` NAO entra nesta lista, e a ausencia dele e o conserto de um conserto:
        // a primeira versao o incluia, e como `__detail` e filho dele, o bloco de PROSA herdava
        // `pointer-events: auto` e voltava a interceptar. O caso `static-modals` do Playwright
        // estourou em 60 s com "data-layer-notice__detail intercepts pointer events" sobre o
        // botao de atalhos, que nao tem relacao nenhuma com camada. Metade do conserto era pior
        // que conserto nenhum, porque parecia resolvido.
        for (const alvo of ['.data-layer-notice__btn', '.data-layer-notice__actions']) {
            const corpo = corpoDaRegra(limpa, alvo);
            expect(corpo, `a regra \`${alvo}\` sumiu da folha`).not.toBeNull();
            expect(
                corpo,
                `${alvo} precisa de \`pointer-events: auto\`, senao o botao do aviso para de responder`
            ).toMatch(/pointer-events:\s*auto/);
        }
    });

    it('o BLOCO DE TEXTO nao recupera o clique: ele nao e alvo de gesto', () => {
        // Sem este caso, alguem reintroduz `__body` na regra de cima para "poder selecionar o
        // texto" e o aviso volta a tapar o mapa, com os dois casos anteriores verdes.
        const corpo = corpoDaRegra(limpa, '.data-layer-notice__body');
        if (corpo !== null) {
            expect(
                corpo,
                '`__body` com `pointer-events: auto` faz `__detail`, que e filho dele, interceptar de novo'
            ).not.toMatch(/pointer-events:\s*auto/);
        }
        const regraAuto = /\.data-layer-notice__(actions|btn)[^{]*\{[^}]*pointer-events:\s*auto/;
        expect(limpa, 'a regra que devolve o clique aos botoes sumiu').toMatch(regraAuto);
        expect(
            limpa.match(/\.data-layer-notice__body[^{]*,[^{]*\{[^}]*pointer-events:\s*auto/),
            '`__body` voltou para a lista que recupera o clique'
        ).toBeNull();
    });

    it('as classes existem no componente que desenha o aviso', () => {
        // Guarda contra o par mais silencioso: a folha certa apontando para classes que o
        // componente parou de escrever. As duas metades acima ficariam verdes sobre CSS morto.
        const componente = readFileSync(resolve(FRONT, 'src/js/terrain/layer-failure-notice.js'), 'utf8');
        for (const classe of ['data-layer-notice__actions', 'data-layer-notice__btn']) {
            expect(componente, `o componente nao escreve mais \`${classe}\``).toContain(classe);
        }
    });

    it('CONTROLE DO VARREDOR: ele acha regra e apaga comentario, e so comentario', () => {
        const amostra = '/* .fake { pointer-events: none; } */ .real { color: red; pointer-events: auto; }';
        const limpo = semComentarios(amostra);
        expect(corpoDaRegra(limpo, '.fake'), 'leu dentro do comentario').toBeNull();
        expect(corpoDaRegra(limpo, '.real')).toMatch(/pointer-events:\s*auto/);
        // E a folha real continua tendo corpo depois da poda.
        expect(limpa.length).toBeGreaterThan(1000);
    });
});
