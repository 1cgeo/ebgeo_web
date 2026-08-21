// Path: tests/unit/poda-de-referencia-privada.test.js
//
// A PODA DE SAÍDA sobre um documento DOURADO que esgota o registro de superfícies.
//
// O PISO é o que impede este arquivo de virar cobertura vazia: antes de podar, o teste
// afirma que os VINTE ids (um público e um privado por superfície podável) aparecem no
// JSON serializado do documento. Sem ele, um erro de digitação na fixture produziria um
// documento sem nada para podar e as asserções de "sumiu" passariam verdes provando nada.
//
// A DISCRIMINAÇÃO tem duas metades, e as duas são necessárias: os dez públicos
// SOBREVIVEM (um podador que apaga tudo fica vermelho) e os dez privados SOMEM (um
// podador que não faz nada fica vermelho). Um terceiro grupo de controle — um uuid de
// feição, um nome de mapa e um id de briefing — precisa continuar byte-idêntico.
//
// E A FIXTURE É COBRADA PELO REGISTRO: o conjunto de superfícies exercitado aqui tem de
// ser IGUAL a `prunableSurfaceIds()`. Superfície nova no registro sem fixture reprova
// nesta linha, que é o que impede o inventário e a prova de andarem separados.

import { describe, it, expect } from 'vitest';
import {
    podarDocumentoDeExportacao,
    RefVerdict,
} from '@catalog/private-reference-pruner.js';
import { prunableSurfaceIds } from '@catalog/resource-reference.registry.js';

/** id público e id privado de cada superfície podável, na ordem do registro. */
const PAR = {
    'mapa.baseLayer': ['basemap-publico', 'basemap-privado'],
    'mapa.catalogLayers': ['dl-publico', 'al-privado'],
    'cesium3d.cameraPositions': ['tileset-cam-publico', 'tileset-cam-privado'],
    'cesium3d.markers': ['tileset-mk-publico', 'tileset-mk-privado'],
    'cesium3d.measurements': ['tileset-md-publico', 'tileset-md-privado'],
    'cesium3d.viewsheds': ['tileset-vs-publico', 'tileset-vs-privado'],
    // AS DUAS LINHAS DE 360 DESCREVEM UM ESTADO QUE A PRODUCAO NAO PRODUZ, e a nota esta
    // aqui para que a proxima leitura nao conclua o contrario do produto: o resolver de
    // producao (`construirResolverDeSaida`) devolve `unknown` para TODA referencia de
    // `views360`, sem excecao, porque a saida 3 da decisao do dono manda podar tudo o que
    // nao e classificavel localmente. Logo o ramo "360 publico sobrevive" que estas duas
    // metades exercitam e um ramo MORTO em producao. Elas continuam aqui de proposito: o
    // sujeito deste arquivo e a funcao PURA, e ela tem de tratar o veredito que recebe, nao
    // adivinhar quem o produziu. Quem prende a decisao do produto e
    // `poda-recusa-sem-soma.test.js`, no caso do 360.
    'sv360.orientations': ['foto-or-publica', 'foto-or-privada'],
    'sv360.markers': ['foto-mk-publica', 'foto-mk-privada'],
    'briefing.slide.modelId': ['tileset-slide-publico', 'tileset-slide-privado'],
    'briefing.slide.photoId': ['foto-slide-publica', 'foto-slide-privada'],
};

const PUBLICOS = Object.values(PAR).map(([p]) => p);
const PRIVADOS = Object.values(PAR).map(([, p]) => p);

/** Controle: dado do usuário que não é referência de recurso nenhuma. */
const CONTROLE = {
    featureId: '11111111-2222-3333-4444-555555555555',
    mapa: 'Mapa Alfa',
    // O SEGUNDO MAPA existe por uma razão de medição: `baseLayer` é UM valor por mapa, então
    // um único mapa só consegue exercitar metade do par (o privado que sai OU o público que
    // fica), e a discriminação desta superfície ficaria sem lado nenhum.
    mapaPublico: 'Mapa Bravo',
    briefingId: '99999999-8888-7777-6666-555555555555',
};

/** Resolver injetado: público quando está na lista, privado quando está na outra. */
function resolverDeTeste(grupo, id) {
    if (PUBLICOS.includes(id)) return RefVerdict.PUBLIC;
    if (PRIVADOS.includes(id)) return RefVerdict.PRIVATE;
    return RefVerdict.UNKNOWN;
}

function documentoDourado() {
    return {
        version: '2.3',
        currentMap: CONTROLE.mapa,
        mapOrder: [CONTROLE.mapa, CONTROLE.mapaPublico],
        maps: {
            [CONTROLE.mapa]: {
                baseLayer: PAR['mapa.baseLayer'][1],
                features: {
                    points: [{ id: CONTROLE.featureId, properties: { nome: 'Ponto' } }],
                },
                catalogLayers: [
                    { id: `data-${PAR['mapa.catalogLayers'][0]}`, type: 'data_layer', visible: true },
                    { id: `analysis-${PAR['mapa.catalogLayers'][1]}`, type: 'analysis_layer', visible: true },
                    // Hillshade: não é recurso de catálogo e não pode ser tocado.
                    { id: 'hillshade', type: 'hillshade', visible: true },
                ],
            },
            [CONTROLE.mapaPublico]: {
                baseLayer: PAR['mapa.baseLayer'][0],
                features: { points: [] },
            },
        },
        cesium3d: {
            [CONTROLE.mapa]: {
                cameraPositions: {
                    [PAR['cesium3d.cameraPositions'][0]]: { tilesetId: PAR['cesium3d.cameraPositions'][0] },
                    [PAR['cesium3d.cameraPositions'][1]]: { tilesetId: PAR['cesium3d.cameraPositions'][1] },
                },
                markers: [
                    { id: 'm1', tilesetId: PAR['cesium3d.markers'][0] },
                    { id: 'm2', tilesetId: PAR['cesium3d.markers'][1] },
                ],
                measurements: [
                    { id: 'd1', tilesetId: PAR['cesium3d.measurements'][0] },
                    { id: 'd2', tilesetId: PAR['cesium3d.measurements'][1] },
                ],
                viewsheds: [
                    { id: 'v1', tilesetId: PAR['cesium3d.viewsheds'][0] },
                    { id: 'v2', tilesetId: PAR['cesium3d.viewsheds'][1] },
                ],
            },
        },
        streetview360: {
            [CONTROLE.mapa]: {
                orientations: {
                    [PAR['sv360.orientations'][0]]: { lon: 1, lat: 2, fov: 75 },
                    [PAR['sv360.orientations'][1]]: { lon: 3, lat: 4, fov: 75 },
                },
                markers: [
                    { id: 's1', photoName: PAR['sv360.markers'][0] },
                    { id: 's2', photoName: PAR['sv360.markers'][1] },
                ],
            },
        },
        briefings: [{
            id: CONTROLE.briefingId,
            name: 'Briefing',
            slides: [
                { id: 'sl1', title: 'Com modelo público', mode: '3d', modelId: PAR['briefing.slide.modelId'][0] },
                { id: 'sl2', title: 'Com modelo privado', mode: '3d', modelId: PAR['briefing.slide.modelId'][1] },
                { id: 'sl3', title: 'Com foto pública', mode: '360', photoId: PAR['briefing.slide.photoId'][0] },
                { id: 'sl4', title: 'Com foto privada', mode: '360', photoId: PAR['briefing.slide.photoId'][1] },
            ],
        }],
    };
}

describe('poda de saída sobre o documento dourado', () => {
    it('a fixture esgota o registro de superfícies podáveis', () => {
        // Sem este caso, uma superfície nova no registro entraria sem prova nenhuma e os
        // outros casos continuariam verdes sobre uma fixture incompleta.
        expect(Object.keys(PAR).sort()).toEqual(prunableSurfaceIds().sort());
        expect(prunableSurfaceIds().length).toBe(10);
    });

    it('PISO: os vinte ids estão no documento antes da poda', () => {
        const json = JSON.stringify(documentoDourado());
        const ausentes = [...PUBLICOS, ...PRIVADOS].filter((id) => !json.includes(id));
        expect(ausentes).toEqual([]);
        expect(new Set([...PUBLICOS, ...PRIVADOS]).size).toBe(20);
    });

    it('perde TODA referência privada e mantém TODA pública', () => {
        const { documento, relatorio } = podarDocumentoDeExportacao(documentoDourado(), resolverDeTeste);
        const json = JSON.stringify(documento);

        const publicosPerdidos = PUBLICOS.filter((id) => !json.includes(id));
        expect(publicosPerdidos, 'público não pode sair').toEqual([]);

        const privadosSobreviventes = PRIVADOS.filter((id) => json.includes(id));
        expect(privadosSobreviventes, 'privado não pode ficar').toEqual([]);

        // Uma perda por superfície, e o relatório nomeia exatamente as dez.
        expect(Object.keys(relatorio.porSuperficie).sort()).toEqual(prunableSurfaceIds().sort());
        expect(relatorio.total).toBe(10);
    });

    it('DISCRIMINAÇÃO: o que não é referência de recurso fica byte-idêntico', () => {
        const { documento } = podarDocumentoDeExportacao(documentoDourado(), resolverDeTeste);

        expect(documento.currentMap).toBe(CONTROLE.mapa);
        expect(documento.maps[CONTROLE.mapa].features.points).toEqual([
            { id: CONTROLE.featureId, properties: { nome: 'Ponto' } },
        ]);
        expect(documento.briefings[0].id).toBe(CONTROLE.briefingId);
        // Hillshade não tem linha em catálogo nenhum: tocá-lo tiraria o relevo do mapa.
        expect(documento.maps[CONTROLE.mapa].catalogLayers.some((c) => c.id === 'hillshade')).toBe(true);
    });

    it('o basemap privado volta ao PADRÃO em vez de sumir', () => {
        // A coluna é NOT NULL com padrão e um mapa sem camada de base não desenha: esta é a
        // única superfície cuja ação não é remover.
        const { documento } = podarDocumentoDeExportacao(documentoDourado(), resolverDeTeste);
        expect(documento.maps[CONTROLE.mapa].baseLayer).toBe('carta-topografica');
    });

    it('o slide é REBAIXADO, nunca apagado: a prosa fica e o modo cai para 2D', () => {
        const { documento } = podarDocumentoDeExportacao(documentoDourado(), resolverDeTeste);
        const slides = documento.briefings[0].slides;

        expect(slides).toHaveLength(4);
        expect(slides[1].title).toBe('Com modelo privado');
        expect(slides[1].modelId).toBeNull();
        expect(slides[1].mode).toBe('2d');
        expect(slides[3].photoId).toBeNull();
        expect(slides[3].mode).toBe('2d');

        // DISCRIMINAÇÃO: os slides cuja referência sobreviveu NÃO são rebaixados.
        expect(slides[0].mode).toBe('3d');
        expect(slides[2].mode).toBe('360');
    });

    it('não muta o documento de entrada', () => {
        const entrada = documentoDourado();
        podarDocumentoDeExportacao(entrada, resolverDeTeste);
        expect(JSON.stringify(entrada)).toBe(JSON.stringify(documentoDourado()));
    });
});
