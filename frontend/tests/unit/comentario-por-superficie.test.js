// Path: tests/unit/comentario-por-superficie.test.js
/**
 * @fileoverview O COMENTÁRIO ESPACIAL NAS TRÊS SUPERFÍCIES.
 *
 * O PEDIDO (dono, 2026-09-17): "da mesma forma que temos sistema de comentários no maplibre quero
 * no 360 e no 3d, com as mesmas regras e funcionalidades", e a decisão dele de que o comentário
 * desenha SÓ na superfície onde nasceu, aparecendo no painel com o caminho de volta.
 *
 * O QUE ESTA SUÍTE PRENDE, e por que cada coisa:
 *
 *  1. A LEITURA DO PASSADO. Todo comentário criado antes deste campo existir não tem `surface`, e
 *     é do mapa. Quem filtrar tratando a ausência como "outra coisa" some com os comentários que
 *     já estão no banco — o defeito mais caro possível, porque ele apaga conversa alheia da tela.
 *  2. O ESCOPO SEPARA DUAS FOTOS. `surface` diz o TIPO de superfície, nunca QUAL: sem o escopo, a
 *     foto A desenharia o comentário feito na foto B, e o modelo A o do modelo B.
 *  3. A ENTIDADE É UMA SÓ. O que muda entre as três é a ÂNCORA; o cartão, os gates e as ações são
 *     o mesmo módulo. O bloco de fonte no fim cobra isso: se um dia o 360 ou o 3D montarem cartão
 *     próprio, "as mesmas regras e funcionalidades" deixa de ser verdade em silêncio.
 *
 * O AMBIENTE É NODE PURO, sem jsdom: o que se testa aqui são as funções puras do módulo comum. O
 * desenho (o balão no canvas do panorama, a entidade do Cesium) é medido na tela, e as medidas
 * estão no corpo dos commits.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SUPERFICIE, superficieDe, ehDaSuperficie, respostasDe, tempoRelativo } from '@js/comment_tool/comment-card.js';

const fonte = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

describe('a superfície de um comentário', () => {
    it('as três são declaradas com os valores que o documento grava', () => {
        expect(SUPERFICIE.MAPA).toBe('2d');
        expect(SUPERFICIE.FOTO_360).toBe('360');
        expect(SUPERFICIE.MODELO_3D).toBe('3d');
    });

    it('O PASSADO É DO MAPA: comentário sem o campo conta como 2D', () => {
        // O caso que não pode falhar: todo comentário criado antes de 2026-09-17 está assim.
        expect(superficieDe({ id: 'antigo', lng: 1, lat: 2 })).toBe(SUPERFICIE.MAPA);
        expect(superficieDe({})).toBe(SUPERFICIE.MAPA);
        expect(superficieDe(null)).toBe(SUPERFICIE.MAPA);
        expect(superficieDe(undefined)).toBe(SUPERFICIE.MAPA);
    });

    it('o campo, quando existe, manda', () => {
        expect(superficieDe({ surface: '360' })).toBe(SUPERFICIE.FOTO_360);
        expect(superficieDe({ surface: '3d' })).toBe(SUPERFICIE.MODELO_3D);
    });
});

describe('o escopo separa duas fotos e dois modelos', () => {
    const naFotoA = { surface: '360', photoName: 'FOTO-A', heading: 10, pitch: 0 };
    const naFotoB = { surface: '360', photoName: 'FOTO-B', heading: 10, pitch: 0 };
    const noModeloX = { surface: '3d', tilesetId: 'MODELO-X', lng: 1, lat: 2 };
    const noModeloY = { surface: '3d', tilesetId: 'MODELO-Y', lng: 1, lat: 2 };
    const noMapa = { lng: 1, lat: 2 };

    it('a foto A não desenha o comentário da foto B', () => {
        expect(ehDaSuperficie(naFotoA, SUPERFICIE.FOTO_360, 'FOTO-A')).toBe(true);
        expect(ehDaSuperficie(naFotoB, SUPERFICIE.FOTO_360, 'FOTO-A')).toBe(false);
    });

    it('o modelo X não desenha o comentário do modelo Y', () => {
        expect(ehDaSuperficie(noModeloX, SUPERFICIE.MODELO_3D, 'MODELO-X')).toBe(true);
        expect(ehDaSuperficie(noModeloY, SUPERFICIE.MODELO_3D, 'MODELO-X')).toBe(false);
    });

    it('as superfícies não se misturam entre si', () => {
        expect(ehDaSuperficie(naFotoA, SUPERFICIE.MAPA)).toBe(false);
        expect(ehDaSuperficie(noModeloX, SUPERFICIE.MAPA)).toBe(false);
        expect(ehDaSuperficie(noMapa, SUPERFICIE.FOTO_360, 'FOTO-A')).toBe(false);
        expect(ehDaSuperficie(noMapa, SUPERFICIE.MAPA)).toBe(true);
    });

    it('sem escopo, o filtro é só pelo TIPO — que é o que o painel precisa', () => {
        // O painel lista as três superfícies de todos os mapas, então ele pergunta pelo tipo sem
        // dizer qual foto; quem precisa do escopo é quem DESENHA.
        expect(ehDaSuperficie(naFotoA, SUPERFICIE.FOTO_360)).toBe(true);
        expect(ehDaSuperficie(naFotoB, SUPERFICIE.FOTO_360)).toBe(true);
    });
});

describe('as respostas de uma conversa', () => {
    const colecao = {
        raiz: { id: 'raiz', parentId: null, createdAt: 1 },
        outra: { id: 'outra', parentId: null, createdAt: 2 },
        b: { id: 'b', parentId: 'raiz', createdAt: 30 },
        a: { id: 'a', parentId: 'raiz', createdAt: 20 },
        alheia: { id: 'alheia', parentId: 'outra', createdAt: 5 },
    };

    it('vêm em ordem de criação, e só as da raiz pedida', () => {
        expect(respostasDe(colecao, 'raiz').map((c) => c.id)).toEqual(['a', 'b']);
        expect(respostasDe(colecao, 'outra').map((c) => c.id)).toEqual(['alheia']);
    });

    it('coleção vazia ou ausente não explode', () => {
        expect(respostasDe({}, 'raiz')).toEqual([]);
        expect(respostasDe(null, 'raiz')).toEqual([]);
    });
});

describe('o tempo relativo', () => {
    it('fala em pt-BR e encurta conforme a distância', () => {
        const agora = Date.now();
        expect(tempoRelativo(agora)).toBe('agora');
        expect(tempoRelativo(agora - 5 * 60 * 1000)).toBe('há 5 min');
        expect(tempoRelativo(agora - 3 * 3600 * 1000)).toBe('há 3 h');
        expect(tempoRelativo(agora - 2 * 86400 * 1000)).toBe('há 2 d');
        expect(tempoRelativo(null)).toBe('');
    });
});

/**
 * O CONTRATO ENTRE AS TRÊS SUPERFÍCIES, em teste de fonte.
 *
 * Vale o que teste de fonte vale, e existe pelo que nenhum teste de comportamento alcança em node:
 * que as três telas montem O MESMO cartão. Um cartão próprio no 360 passaria em toda régua de
 * comportamento desta suíte e quebraria exatamente o que o dono pediu.
 */
describe('as três superfícies usam o MESMO cartão', () => {
    const consumidores = [
        'src/js/comment_tool/comment-overlay.js',
        'src/js/street_view_tool/comments-360.js',
        'src/js/3d_models_viewer_tool/tools/comments-3d.js',
    ];

    it('todas importam o cartão comum, e nenhuma monta o seu', () => {
        for (const arquivo of consumidores) {
            const texto = fonte(arquivo);
            expect(texto, `${arquivo} não usa o cartão comum`).toMatch(/comment-card\.js'/);
            expect(texto, `${arquivo} monta cartão próprio`).toMatch(/montarCartaoDeThread/);
            // A classe do cartão é criada SÓ no módulo comum: um `comment-card comment-card--`
            // escrito à mão em qualquer um dos três é uma segunda cópia nascendo.
            expect(texto, `${arquivo} cria o cartão à mão`).not.toMatch(/'comment-card comment-card--/);
        }
    });

    it('as ações de escrita da conversa moram no cartão, e não nos consumidores', () => {
        // Responder, resolver e excluir são REGRAS: se um consumidor as chamar direto, ele pode
        // aplicar uma regra diferente (esquecer o gate, mudar o texto do aviso) sem ninguém ver.
        for (const arquivo of ['src/js/street_view_tool/comments-360.js',
            'src/js/3d_models_viewer_tool/tools/comments-3d.js']) {
            const texto = fonte(arquivo);
            for (const acao of ['addReply', 'resolveComment', 'removeComment']) {
                expect(texto, `${arquivo} chama ${acao} direto`).not.toContain(acao);
            }
            // O que eles PRECISAM chamar é a criação, porque só eles sabem a âncora.
            expect(texto).toContain('addComment');
        }
    });

    it('o cartão comum é o único a decidir quem pode comentar e quem pode modificar', () => {
        const card = fonte('src/js/comment_tool/comment-card.js');
        expect(card).toContain('GuardAction.CREATE_COMMENT');
        expect(card).toContain("canPerformAction('canEdit')");
        // E o gate do comentário NÃO pode passar a consultar o gate de edição: o Comentarista tem
        // `canComment` e não tem `canEdit`, então seria tirar dele a única coisa que sabe fazer.
        expect(card).not.toMatch(/edicao-indisponivel/);
    });
});
