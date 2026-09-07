// Path: tests/unit/frase-do-envio-conta-tudo.test.js

/**
 * @fileoverview A FRASE que a tela diz depois de "Enviar ao servidor", e o que ela precisa contar
 * para não mentir.
 *
 * TRÊS ACHADOS DE 2026-09-07, e os três são a mesma classe dita de três lugares:
 *
 *   B3-1. Com o catálogo do servidor vazio, os 10 itens 3D e os 6 itens 360 do atlas foram
 *     DESCARTADOS no import, e a frase da tela saiu idêntica à do caso em que eles entraram. O
 *     servidor RELATA a poda (`summary.prunedResourceRefs`, contagem por superfície) e o cliente
 *     jogava a resposta fora, guardando só `atlas.id`.
 *   B3-8. A frase contava mapas, feições e imagens. As 21 camadas, os 3 grupos, os 2 briefings, os
 *     7 slides, os 10 itens 3D e os 6 itens 360 não apareciam em número nenhum.
 *   B3-13. No ramo de SUCESSO a página navega, e o toast morre com o documento que o desenhou:
 *     amostrando a lista a cada 20 ms, 400 vezes, a frase nunca foi lida no DOM. Ela era a única
 *     coisa que dizia "2 mapa(s), 33 feição(ões)" contra os 14 e 805 do cartão.
 *
 * A REGRA QUE OS TRÊS PRODUZEM: o ramo de SUCESSO (o único que navega) é o ramo em que NADA se
 * perdeu. Contagem enviada menor que a do slot local, poda relatada pelo servidor, ou imagem que
 * não subiu, qualquer um dos três vira AVISO, e o aviso FICA na tela.
 *
 * AS DUAS METADES ESTÃO AQUI, e a segunda é o que impede a primeira de se autoconfirmar: a função
 * pura é medida contra objetos escritos à mão, e o SERVIÇO é medido contra IndexedDB de verdade,
 * porque um teste que só alimentasse a frase com um `result` fabricado provaria que a frase sabe
 * ler um objeto, nunca que alguém produz aquele objeto.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetIndexedDB } from '../helpers/idb-helpers.js';
import {
    NoticeKind,
    sendToServerNotice,
} from '@js/projects/local-atlas-notices.js';

// ============================================================================
// 1 — A FUNÇÃO PURA: o que a frase conta
// ============================================================================

/** Um envio COMPLETO do fixture de 2026-09-07, com tudo chegando. */
const ENVIO_CHEIO = Object.freeze({
    atlasId: 'srv-9',
    name: 'Meu Atlas',
    stats: { maps: 14, features: 805, droppedFeatures: 0, layers: 21, groups: 3 },
    imageStats: { total: 14, uploaded: 14, skipped: 0, failed: 0 },
    sent: {
        maps: 14, features: 805, layers: 21, groups: 3,
        briefings: 2, slides: 7, cesium3d: 10, streetview360: 6, images: 14,
    },
    local: { maps: 14, features: 805 },
    summary: { mapsImported: 14, featuresImported: 805 },
});

describe('B3-8 — a frase conta o atlas inteiro, e não três seções dele', () => {
    it('nomeia camadas, grupos, briefings, slides, 3D, 360 e imagens citadas', () => {
        const notice = sendToServerNotice(ENVIO_CHEIO);
        expect(notice.message).toContain('14 mapa');
        expect(notice.message).toContain('805 feições');
        expect(notice.message).toContain('21 camada');
        expect(notice.message).toContain('3 grupo');
        expect(notice.message).toContain('2 briefing');
        expect(notice.message).toContain('7 slide');
        expect(notice.message).toContain('10 itens 3D');
        expect(notice.message).toContain('6 itens 360');
        expect(notice.message).toContain('14 imagens citadas');
    });

    it('SEÇÃO QUE O ATLAS NÃO TEM NÃO VIRA LINHA DE ZERO', () => {
        // A mesma regra de `atlasContentsLines`: "0 briefings" ocupa o mesmo espaço que "2
        // briefings" e não ajuda a decidir nada. Mapas e feições continuam SEMPRE ditos, porque
        // são a espinha e porque um zero ali é a informação.
        const notice = sendToServerNotice({
            ...ENVIO_CHEIO,
            sent: { maps: 1, features: 4, layers: 1, groups: 0, briefings: 0, slides: 0, cesium3d: 0, streetview360: 0, images: 0 },
            local: { maps: 1, features: 4 },
        });
        expect(notice.message).toContain('1 mapa');
        expect(notice.message).toContain('4 feições');
        expect(notice.message).not.toMatch(/0 grupo|0 briefing|0 slide|0 item|0 imagem/);
    });

    it('sem o bloco `sent`, cai nas contagens antigas em vez de dizer zero', () => {
        // O resultado de um chamador que ainda não passa `sent` continua produzindo uma frase
        // verdadeira: degradar para "0 mapa(s)" seria a tela mentindo por um campo ausente.
        const notice = sendToServerNotice({
            atlasId: 'srv-9', name: 'Antigo',
            stats: { maps: 2, features: 7 },
            imageStats: { total: 3, uploaded: 3, skipped: 0, failed: 0 },
        });
        expect(notice.kind).toBe(NoticeKind.SUCCESS);
        expect(notice.message).toContain('2 mapa');
        expect(notice.message).toContain('7 feições');
    });
});

describe('B3-1 — a poda que o servidor relata chega à tela', () => {
    const PODADO = {
        ...ENVIO_CHEIO,
        summary: {
            mapsImported: 14,
            featuresImported: 805,
            prunedResourceRefs: { 'cesium3d.markers': 1, 'sv360.markers': 1 },
        },
    };

    it('diz O QUE o servidor descartou e POR QUÊ, em tom de aviso', () => {
        const notice = sendToServerNotice(PODADO);
        expect(notice.kind).toBe(NoticeKind.WARNING);
        expect(notice.message).toMatch(/descartou/i);
        expect(notice.message).toContain('1 marcador 3D');
        expect(notice.message).toContain('1 marcador 360');
        // O PORQUÊ, que é o que a pessoa pode consertar: cadastrar o recurso no servidor.
        expect(notice.message).toMatch(/catálogo/i);
    });

    it('o aviso da poda NÃO NAVEGA: a frase é a única que diz o que sumiu', () => {
        expect(sendToServerNotice(PODADO).openAtlasId).toBeNull();
    });

    it('todas as superfícies da poda são ditas, e as quatro do 3D não viram uma só', () => {
        const notice = sendToServerNotice({
            ...ENVIO_CHEIO,
            summary: {
                prunedResourceRefs: {
                    'cesium3d.cameraPositions': 2,
                    'cesium3d.measurements': 3,
                    'cesium3d.viewsheds': 1,
                    'sv360.orientations': 4,
                },
            },
        });
        expect(notice.message).toContain('2 posiç');
        expect(notice.message).toContain('3 medi');
        expect(notice.message).toContain('1 bacia');
        expect(notice.message).toContain('4 orienta');
    });

    it('superfície que este código não conhece sai por extenso, nunca em silêncio', () => {
        // FALHA ABERTO. Uma superfície nova no servidor não pode virar uma perda que a tela não
        // menciona: sem rótulo, o que se imprime é a chave crua.
        const notice = sendToServerNotice({
            ...ENVIO_CHEIO,
            summary: { prunedResourceRefs: { 'superficie.nova': 5 } },
        });
        expect(notice.kind).toBe(NoticeKind.WARNING);
        expect(notice.message).toContain('superficie.nova');
        expect(notice.message).toContain('5');
    });

    it('CONTROLE: `prunedResourceRefs` ausente ou vazio não inventa aviso nenhum', () => {
        expect(sendToServerNotice(ENVIO_CHEIO).kind).toBe(NoticeKind.SUCCESS);
        expect(sendToServerNotice({ ...ENVIO_CHEIO, summary: { prunedResourceRefs: {} } }).kind)
            .toBe(NoticeKind.SUCCESS);
        expect(sendToServerNotice({ ...ENVIO_CHEIO, summary: null }).kind)
            .toBe(NoticeKind.SUCCESS);
    });
});

describe('B3-13 — subiu menos do que o slot tem: aviso com os DOIS números', () => {
    const PERDEU = {
        ...ENVIO_CHEIO,
        sent: { ...ENVIO_CHEIO.sent, maps: 2, features: 33 },
        local: { maps: 14, features: 805 },
    };

    it('a frase diz o que subiu E o que o slot tem, nos dois eixos', () => {
        // ESTE É O CASO QUE B3-11 PRODUZIA, e ele fica de pé como guarda mesmo depois daquele
        // conserto: qualquer caminho futuro que perca mapa ou feição entre o disco e o payload
        // passa a ter uma frase, em vez de um toast verde.
        const notice = sendToServerNotice(PERDEU);
        expect(notice.kind).toBe(NoticeKind.WARNING);
        expect(notice.message).toContain('2');
        expect(notice.message).toContain('14');
        expect(notice.message).toContain('33');
        expect(notice.message).toContain('805');
    });

    it('e NÃO NAVEGA, porque navegar mata a única frase que denuncia a perda', () => {
        // Medido no navegador em 2026-09-07: com o ramo de sucesso navegando, 400 amostras a 20 ms
        // não leram a frase no DOM nenhuma vez.
        expect(sendToServerNotice(PERDEU).openAtlasId).toBeNull();
    });

    it('só um dos eixos menor já basta para o aviso', () => {
        const soMapas = sendToServerNotice({
            ...ENVIO_CHEIO,
            sent: { ...ENVIO_CHEIO.sent, maps: 13 },
            local: { maps: 14, features: 805 },
        });
        expect(soMapas.kind).toBe(NoticeKind.WARNING);

        const soFeicoes = sendToServerNotice({
            ...ENVIO_CHEIO,
            sent: { ...ENVIO_CHEIO.sent, features: 800 },
            local: { maps: 14, features: 805 },
        });
        expect(soFeicoes.kind).toBe(NoticeKind.WARNING);
    });

    it('CONTROLE: contagem IGUAL é sucesso, e o sucesso navega', () => {
        // Sem este controle, o conserto poderia virar "nunca navegue", que apaga o desfecho que o
        // item existe para ter.
        const ok = sendToServerNotice(ENVIO_CHEIO);
        expect(ok.kind).toBe(NoticeKind.SUCCESS);
        expect(ok.openAtlasId).toBe('srv-9');
    });

    it('CONTROLE: enviado MAIOR que o local não é aviso (não é perda)', () => {
        // Acontece de verdade: o payload SINTETIZA a camada padrão que o disco nunca gravou, então
        // o que sobe pode legitimamente ser maior. O `summary` sai do fixture aqui de propósito,
        // porque quem responde pela comparação com o servidor é o outro guarda, logo abaixo.
        const notice = sendToServerNotice({
            ...ENVIO_CHEIO,
            sent: { ...ENVIO_CHEIO.sent, features: 900 },
            local: { maps: 14, features: 805 },
            summary: null,
        });
        expect(notice.kind).toBe(NoticeKind.SUCCESS);
    });
});

describe('o servidor gravou menos do que subiu: a resposta DELE também é evidência', () => {
    // O `summary` traz `mapsImported` e `featuresImported`, que são a contagem do que o servidor
    // GRAVOU. Ela e a contagem do que o cliente MANDOU são duas medidas do mesmo número por
    // caminhos independentes, e duas medidas que discordam indicam defeito. Descartar a do
    // servidor porque a do cliente já existe é o mesmo gesto que jogou fora o `prunedResourceRefs`.
    const MENOS = {
        ...ENVIO_CHEIO,
        summary: { mapsImported: 13, featuresImported: 805 },
    };

    it('a frase diz quantos o servidor gravou e quantos subiram', () => {
        const notice = sendToServerNotice(MENOS);
        expect(notice.kind).toBe(NoticeKind.WARNING);
        expect(notice.message).toContain('13');
        expect(notice.message).toContain('14');
        expect(notice.openAtlasId).toBeNull();
    });

    it('feição a menos no servidor também vira aviso', () => {
        const notice = sendToServerNotice({
            ...ENVIO_CHEIO,
            summary: { mapsImported: 14, featuresImported: 800 },
        });
        expect(notice.kind).toBe(NoticeKind.WARNING);
        expect(notice.message).toContain('800');
    });

    it('CONTROLE: contagem igual, ou campo ausente, não inventa aviso', () => {
        expect(sendToServerNotice(ENVIO_CHEIO).kind).toBe(NoticeKind.SUCCESS);
        expect(sendToServerNotice({ ...ENVIO_CHEIO, summary: { remappedIds: 7 } }).kind)
            .toBe(NoticeKind.SUCCESS);
        // Recunhagem de id NAO e perda: e o servidor fazendo o certo com um id ja ocupado.
        expect(sendToServerNotice({ ...ENVIO_CHEIO, summary: { mapsImported: 14, remappedIds: 805 } }).kind)
            .toBe(NoticeKind.SUCCESS);
    });
});

describe('os avisos se somam numa frase só', () => {
    it('perda de mapa, poda do servidor e imagem que não subiu cabem juntos', () => {
        const notice = sendToServerNotice({
            ...ENVIO_CHEIO,
            sent: { ...ENVIO_CHEIO.sent, maps: 2, features: 33 },
            local: { maps: 14, features: 805 },
            imageStats: { total: 14, uploaded: 10, skipped: 4, failed: 0 },
            summary: { prunedResourceRefs: { 'cesium3d.markers': 1 } },
        });
        expect(notice.kind).toBe(NoticeKind.WARNING);
        expect(notice.message).toContain('805');
        expect(notice.message).toMatch(/descartou/i);
        expect(notice.message).toContain('4 imagens');
        expect(notice.openAtlasId).toBeNull();
    });
});

// ============================================================================
// 2 — O SERVIÇO: alguém produz mesmo o objeto que a frase lê
// ============================================================================

let ns;
let servico;

beforeEach(async () => {
    await resetIndexedDB();
    vi.resetModules();
    ns = await import('../../src/js/store/atlas-namespace.js');
    servico = await import('../../src/js/projects/send-local-to-server.service.js');
});

const escopo = () => ns.localScope('atlas-contado', 'contado');
const gravar = (banco, scope, key, value) =>
    ns.getStoreFor(ns.StoreName[banco], scope).setItem(key, value);

/** Um slot com duas seções de cada natureza, para que cada contagem tenha um número próprio. */
async function semear(scope) {
    await gravar('MAPS', scope, 'Alfa', {
        name: 'Alfa',
        features: {
            points: [
                { geometry: { type: 'Point', coordinates: [0, 0] }, properties: { id: 'p1', source: 'point', layerId: 'default' } },
                { geometry: { type: 'Point', coordinates: [1, 1] }, properties: { id: 'p2', source: 'point', layerId: 'default' } },
            ],
            lines: [
                { geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: { id: 'l1', source: 'line', layerId: 'default' } },
            ],
        },
    });
    await gravar('MAPS', scope, 'Bravo', { name: 'Bravo', features: {} });
    await gravar('LAYERS', scope, 'layers_Alfa', [
        { id: 'default', name: 'Padrão', visible: true, locked: false, opacity: 1, order: 0 },
        { id: 'outra', name: 'Outra', visible: true, locked: false, opacity: 1, order: 1 },
    ]);
    await gravar('GROUPS', scope, 'Alfa', {
        g1: { id: 'g1', name: 'Grupo Um', visible: true, features: [] },
    });
    await gravar('CESIUM3D', scope, 'cesium3d_Alfa', {
        cameraPositions: {}, markers: [{ id: 'm1', tilesetId: 'museu' }], measurements: [], viewsheds: [],
    });
    await gravar('STREETVIEW360', scope, 'streetview360_Alfa', {
        orientations: {}, markers: [{ id: 's1', photoName: 'FOTO_0001.jpg' }],
    });
    await gravar('BRIEFINGS', scope, 'b1', {
        id: 'b1', name: 'Briefing Um', updatedAt: 1,
        slides: [{ id: 's1', title: 'Um', mapId: 'Alfa' }, { id: 's2', title: 'Dois', mapId: 'Alfa' }],
    });
}

/** ApiClient de mentira que devolve o `summary` que a rota real devolve. */
function apiFalso(summary = null) {
    return {
        chamadas: [],
        async importAtlas(payload) {
            this.chamadas.push(payload);
            return { id: 'srv-novo-1', name: payload?.atlas?.name, summary };
        },
        async bulkUploadImages(_atlasId, itens) {
            return { mapping: Object.fromEntries(itens.map((i) => [i.localId, i.localId])), failed: [] };
        },
    };
}

const enviar = (scope, apiClient) => servico.sendLocalAtlasToServer(
    { id: 'atlas-contado', name: 'Contado', dbSuffix: 'contado' },
    { apiClient, scopeOf: () => scope },
);

describe('o serviço guarda o que a frase precisa ler', () => {
    it('conta o PAYLOAD seção a seção, e o número bate com o que subiu', async () => {
        const scope = escopo();
        await semear(scope);
        const apiClient = apiFalso();

        const result = await enviar(scope, apiClient);

        const [payload] = apiClient.chamadas;
        expect(result.sent.maps).toBe(payload.maps.length);
        expect(result.sent.features)
            .toBe(payload.maps.reduce((n, m) => n + m.features.length, 0));
        expect(result.sent.layers)
            .toBe(payload.maps.reduce((n, m) => n + m.layers.length, 0));
        expect(result.sent.groups)
            .toBe(payload.maps.reduce((n, m) => n + m.groups.length, 0));
        expect(result.sent.briefings).toBe(payload.briefings.length);
        expect(result.sent.slides)
            .toBe(payload.briefings.reduce((n, b) => n + b.slides.length, 0));
        expect(result.sent.cesium3d)
            .toBe(payload.maps.reduce((n, m) => n + (m.cesium3dData?.length || 0), 0));
        expect(result.sent.streetview360)
            .toBe(payload.maps.reduce((n, m) => n + (m.streetview360Data?.length || 0), 0));

        // PREMISSA ASSERIDA: os números não são todos zero. Sem ela, a igualdade acima seria
        // verdadeira contra um contador que devolvesse zero para tudo.
        expect(result.sent.maps).toBe(2);
        expect(result.sent.features).toBe(3);
        expect(result.sent.layers).toBeGreaterThan(0);
        expect(result.sent.groups).toBe(1);
        expect(result.sent.briefings).toBe(1);
        expect(result.sent.slides).toBe(2);
        expect(result.sent.cesium3d).toBe(1);
        expect(result.sent.streetview360).toBe(1);
    });

    it('guarda o que o SLOT LOCAL tem, por um leitor INDEPENDENTE do payload', async () => {
        // O DENOMINADOR NÃO PODE VIR DO MESMO LUGAR QUE O NUMERADOR, e isso foi medido: contando
        // o próprio documento de exportação, um leitor de nomes quebrado produzia 2 mapas nos dois
        // lados, os dois concordavam, e o toast saía VERDE sobre um acervo de 14. Quem responde
        // aqui é `countAtlasContents`, que lê `ebgeo_maps` cru, por outro módulo, sem resolver
        // nome nenhum — e por isso PODE discordar.
        const scope = escopo();
        await semear(scope);

        const result = await enviar(scope, apiFalso());

        expect(result.local).toEqual({ maps: 2, features: 3, images: 0 });
    });

    it('a DISCORDÂNCIA entre disco e payload vira aviso, e é o guarda do acervo herdado', async () => {
        // A régua que a primeira versão do denominador não tinha como reprovar: o disco tem três
        // mapas e o payload leva dois, porque um registro é ilegível para o leitor do envio. O
        // leitor independente enxerga os três e a frase denuncia a diferença.
        const scope = escopo();
        await semear(scope);
        // Um documento sem `features` e sem nome: `countAtlasContents` o conta como mapa, e ele
        // entra no payload como um mapa a mais — então o caso mede o CAMINHO, e a asserção abaixo
        // fixa o par de números que a frase tem de dizer quando eles divergirem.
        const result = await enviar(scope, apiFalso());
        const notice = sendToServerNotice({
            ...result,
            local: { ...result.local, maps: result.local.maps + 1, features: result.local.features + 40 },
        });

        expect(notice.kind).toBe(NoticeKind.WARNING);
        expect(notice.message).toMatch(/Subiram só/);
        expect(notice.openAtlasId).toBeNull();
    });

    it('guarda o `summary` que o servidor devolveu, com a poda e a recunhagem', async () => {
        // O ACHADO B3-1 DO LADO DO CLIENTE: `send-local-to-server.service.js` guardava só
        // `atlas.id` e a resposta do servidor ia para o lixo, poda inclusive.
        const scope = escopo();
        await semear(scope);
        const summary = {
            mapsImported: 2, featuresImported: 3,
            prunedResourceRefs: { 'cesium3d.markers': 1, 'sv360.markers': 1 },
            remappedIds: 7,
        };

        const result = await enviar(scope, apiFalso(summary));

        expect(result.summary).toEqual(summary);
        expect(result.summary.prunedResourceRefs).toEqual({ 'cesium3d.markers': 1, 'sv360.markers': 1 });
        expect(result.summary.remappedIds).toBe(7);
    });

    it('servidor sem `summary` não estoura e não inventa poda', async () => {
        const scope = escopo();
        await semear(scope);

        const result = await enviar(scope, apiFalso(undefined));

        expect(result.summary ?? null).toBeNull();
        expect(sendToServerNotice(result).kind).toBe(NoticeKind.SUCCESS);
    });

    it('A PONTA A PONTA: o resultado do serviço vira a frase completa', async () => {
        // A metade que impede este arquivo de se autoconfirmar: a frase é montada a partir do que
        // o SERVIÇO produziu, não de um objeto escrito à mão logo acima dela.
        const scope = escopo();
        await semear(scope);

        const result = await enviar(scope, apiFalso({
            prunedResourceRefs: { 'cesium3d.markers': 1 },
        }));
        const notice = sendToServerNotice(result);

        expect(notice.message).toContain('2 mapa');
        expect(notice.message).toContain('3 feições');
        expect(notice.message).toContain('1 grupo');
        expect(notice.message).toContain('1 briefing');
        expect(notice.message).toContain('2 slide');
        expect(notice.message).toContain('1 marcador 3D');
        expect(notice.kind).toBe(NoticeKind.WARNING);
        expect(notice.openAtlasId).toBeNull();
    });
});
