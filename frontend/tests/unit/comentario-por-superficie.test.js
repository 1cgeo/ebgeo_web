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

/**
 * OS QUATRO PEDIDOS DE 2026-09-18, que vieram do dono usando o produto.
 *
 * Três deles são consertos de defeito e um é função nova, e o que os une é o mesmo assunto: a lista
 * de comentários atravessa superfícies, então o gesto de "ir para" tem de LEVAR — fechando o que
 * está aberto, abrindo o que é o destino, e mostrando a conversa certa.
 */
describe('o painel atravessa superfícies', () => {
    const painel = fonte('src/js/comment_tool/comments-panel.js');

    it('FECHA o visualizador que não é o destino', () => {
        // "Se tiver com 3d aberto ou 360 e clicar num comentario do maplibre na barra lateral deve
        // fechar o 3d/360 e ir pro comentário."
        expect(painel).toContain('_fecharOutrasSuperficies');
        expect(painel).toMatch(/destino !== SUPERFICIE\.FOTO_360[\s\S]{0,400}closeViewer360/);
        expect(painel).toMatch(/destino !== SUPERFICIE\.MODELO_3D[\s\S]{0,400}closeViewer/);
        // E a conta é por SUPERFÍCIE, não por comentário: ir de uma foto para outra não fecha o
        // 360, senão a tela piscaria à toa.
        expect(painel).toMatch(/await this\._fecharOutrasSuperficies\(superficie\)/);
    });

    it('FECHA também o cartão das outras superfícies', () => {
        // O popup do MapLibre ficava aberto POR BAIXO do visualizador, e quem lia via a conversa
        // errada sobre a superfície nova. Medido em 2026-09-18, na própria sonda de aceitação.
        expect(painel).toMatch(/destino !== SUPERFICIE\.MAPA[\s\S]{0,120}closeCard/);
        expect(painel).toContain('fecharCartao360');
        expect(painel).toContain('fecharCartao3D');
        expect(fonte('src/js/comment_tool/comment-overlay.js')).toMatch(/closeCard\(\) \{\s*this\._closeCard\(\);/);
    });

    it('abre o 3D pelo CONTROLE, que é quem troca o layout', () => {
        // `openViewerWithTileset` monta a cena do Cesium e mais nada; quem esconde o mapa 2D e
        // mostra o container do 3D é `setFullMap(false)`, dentro do `openViewer` do controle. Com a
        // chamada errada, a cena existia invisível e a tela não mudava — foi o relato do dono.
        expect(painel).toMatch(/getControl\('Add3DModelsViewerControl'\)/);
        expect(painel).toMatch(/ctrl\?\.openViewer\) await ctrl\.openViewer\(comment\.tilesetId\)/);
    });
});

describe('a camada do 360 acompanha a foto aberta', () => {
    it('assina a troca de foto e troca o escopo', () => {
        // O DEFEITO: `iniciarComentarios360` roda na ABERTURA do visualizador, e andar pela seta
        // troca a foto sem passar por lá. A camada ficava com a foto da abertura, desenhava os
        // balões errados e GRAVAVA o comentário novo com a foto anterior — que é o "abre na foto
        // errada" que o dono viu ao clicar na lista.
        const camada = fonte('src/js/street_view_tool/comments-360.js');
        expect(camada).toMatch(/STREETVIEW_360_PHOTO_CHANGED/);
        expect(camada).toMatch(/estado\.photoName = currentPhoto/);
        // E o cartão aberto fecha junto: ele é da foto que ficou para trás.
        expect(camada).toMatch(/estado\.photoName = currentPhoto;\s*fecharCartao360\(\);/);
    });
});

describe('editar o próprio comentário', () => {
    const card = fonte('src/js/comment_tool/comment-card.js');

    it('a entrada oferece "Editar" a quem pode modificá-la', () => {
        expect(card).toMatch(/if \(podeModificar\(entrada\)\)/);
        expect(card).toContain("dataset.testid = 'comment-edit-open'");
    });

    it('a edição grava por `updateComment`, e não por um caminho próprio', () => {
        expect(card).toMatch(/import \{ addReply, resolveComment, removeComment, updateComment \}/);
        expect(card).toMatch(/await updateComment\(\{ id: entrada\.id, text: texto \}\)/);
    });

    it('o editor nasce com o texto atual e com o salvar já liberado', () => {
        // Editar é quase sempre corrigir: uma caixa vazia obrigaria a reescrever tudo, e um botão
        // desabilitado obrigaria a mexer no texto antes de poder salvar.
        expect(card).toMatch(/caixa\.value = entrada\.text \|\| ''/);
        expect(card).toMatch(/salvar\.disabled = !\(entrada\.text \|\| ''\)\.trim\(\)/);
    });

    it('o 360 e o 3D continuam sem chamar a escrita por conta própria', () => {
        // A régua irmã lá de cima cobre `addReply`, `resolveComment` e `removeComment`; a edição
        // entra na mesma lista pela mesma razão.
        for (const arquivo of ['src/js/street_view_tool/comments-360.js',
            'src/js/3d_models_viewer_tool/tools/comments-3d.js']) {
            expect(fonte(arquivo), arquivo).not.toContain('updateComment');
        }
    });
});
