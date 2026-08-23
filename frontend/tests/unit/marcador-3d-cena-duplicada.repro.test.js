// Path: tests/unit/marcador-3d-cena-duplicada.repro.test.js
//
// REGRESSAO: a cena indoor recebia DOIS pinos no mapa 2D, e metade dos cliques dava excecao.
//
// CAUSA-RAIZ. Uma cena de caminhada (Gaussian splatting) NAO e uma secao propria do catalogo: ela
// e uma linha de `config.tilesets` que declara a forma `indoor`. A camada de marcadores montava os
// pinos de MODELO a partir da lista INTEIRA, filtrando so por coordenada, e depois SOMAVA os pinos
// de cena vindos de `getFirstPersonScenes()`. A mesma linha entrava nas duas listas. Com
// `icon-allow-overlap: true` os dois icones desenham empilhados e o clique pega `e.features[0]`,
// que e arbitrario: pelo pino errado o botao vira "Visualizar em 3D" e entrega o id ao carregador
// do Cesium, onde `visualizadorDaForma` LEVANTA de proposito em vez de cair num default. O unico
// acervo indoor em producao (a Sala Historica) aparecia duas vezes.
//
// A MESMA FALTA DE PARTICAO NO SEGUNDO SITIO. `_resolveMarkerInfo` (usado pela busca, via
// `navigateToModel`) procurava o id na lista inteira ANTES de olhar as cenas, entao um id de cena
// voltava com o descritor de modelo: voava para o lugar certo e oferecia o botao errado.
//
// POR QUE NENHUM GUARDA PEGOU. O censo `forma-3d-censo` proibe as tres GRAFIAS ANTIGAS de decidir
// a forma por exclusao; um consumidor que nao filtra NADA nao casa padrao nenhum e passa verde.
// E a licao de "cobertura vazia passa verde" da constituicao, do lado do consumidor.
//
// O CONSERTO, e o que este arquivo prende: uma particao explicita e unica
// (`partitionTilesetEntries`), e as duas montagens derivadas dela. As asserções abaixo cobram
// CONTAGEM (um pino por linha) e ROTEAMENTO (o pino da cena abre o visualizador da cena), mais a
// discriminacao que impede uma implementacao vazia de passar: uma que devolvesse [] para tudo, ou
// que rotulasse tudo de um tipo so, fica vermelha aqui.

import { describe, it, expect } from 'vitest';
import {
    MARKER_KIND,
    buildMarkerFeatures,
    resolveMarkerDescriptor
} from '@js/3d_models_viewer_tool/marker-features.js';
import { partitionTilesetEntries } from '@js/first_person_3d_tool/scene-config.service.js';
import {
    Forma3D,
    Visualizador3D,
    derivarForma3d,
    visualizadorDaForma
} from '@catalog/forma-3d.js';

// ============================================================================
// FIXTURES: as linhas de catalogo, na forma em que o servidor as entrega
// ============================================================================

/** Um tileset 3D comum, com posicao. */
const MODELO = Object.freeze({
    id: 'predio-x',
    name: 'Prédio X',
    url: '/api/v1/assets3d/predio-x/tileset.json',
    locate: { lon: -43.2, lat: -22.9 }
});

/**
 * A cena indoor, na grafia LEGADA (`viewer: 'firstPerson'`), que e a que o unico acervo em
 * producao carrega. A derivacao de compatibilidade a resolve para `indoor`.
 */
const CENA = Object.freeze({
    id: 'museu-1cgeo',
    name: 'Sala Histórica',
    viewer: 'firstPerson',
    basePath: '/3d/primeira-pessoa/museu-1cgeo',
    locate: { lon: -43.3, lat: -22.8 }
});

/** A mesma cena, na grafia DECLARADA. O eixo novo tem de produzir o mesmo pino. */
const CENA_DECLARADA = Object.freeze({
    id: 'museu-declarado',
    name: 'Sala Histórica (declarada)',
    forma3d: Forma3D.INDOOR,
    basePath: '/3d/primeira-pessoa/museu-declarado',
    locate: { lon: -43.4, lat: -22.7 }
});

/** Nuvem de pontos: forma propria, desenhada pelo Cesium. Pino de MODELO. */
const NUVEM = Object.freeze({
    id: 'nuvem-y',
    name: 'Nuvem Y',
    forma3d: Forma3D.POINTCLOUD,
    url: '/api/v1/assets3d/nuvem-y/tileset.json',
    locate: { lon: -43.5, lat: -22.6 }
});

/** Linha indoor SEM `basePath`: nao ha o que abrir, entao nao ha pino nenhum. */
const CENA_IRRESOLVIVEL = Object.freeze({
    id: 'cena-sem-arquivos',
    name: 'Cena sem arquivos',
    forma3d: Forma3D.INDOOR,
    locate: { lon: -43.6, lat: -22.5 }
});

/** Modelo sem posicao: existe no catalogo e na busca, mas nao tem pino. */
const MODELO_SEM_POSICAO = Object.freeze({
    id: 'sem-locate',
    name: 'Sem posição',
    url: '/api/v1/assets3d/sem-locate/tileset.json'
});

/** @param {Array<Object>} features @returns {string[]} */
const ids = (features) => features.map((f) => f.properties.markerId);
/** @param {Array<Object>} features @param {string} id @returns {Array<Object>} */
const porId = (features, id) => features.filter((f) => f.properties.markerId === id);

// ============================================================================
// O DEFEITO, PRENDIDO PELA CONTAGEM
// ============================================================================

describe('marcador 3D: um modelo e uma cena viram UM pino cada', () => {
    const features = buildMarkerFeatures([MODELO, CENA], new Map());

    it('a cena aparece UMA vez, e nao duas', () => {
        // O caso do bug: antes do conserto a cena entrava na lista de modelos (que nao filtrava
        // forma nenhuma) E na lista de cenas, e saiam dois pinos empilhados com o mesmo id.
        expect(porId(features, CENA.id).length,
            'a cena indoor voltou a receber mais de um pino: a particao por forma se perdeu')
            .toBe(1);
        expect(features.length, 'uma linha posicionada, um pino').toBe(2);
        expect(ids(features).sort()).toEqual([CENA.id, MODELO.id].sort());
    });

    it('DISCRIMINACAO: cada pino leva o tipo do seu proprio visualizador', () => {
        // Sem este caso, uma implementacao que devolvesse lista vazia (ou tudo de um tipo so)
        // passaria no caso acima. As duas asserções sao ABSOLUTAS, nao comparadas entre si.
        const [pinoDaCena] = porId(features, CENA.id);
        const [pinoDoModelo] = porId(features, MODELO.id);
        expect(pinoDaCena.properties.kind).toBe(MARKER_KIND.FIRST_PERSON);
        expect(pinoDoModelo.properties.kind).toBe(MARKER_KIND.TILESET);
    });

    it('o pino da cena aponta para o VISUALIZADOR da cena, e nao para o do Cesium', () => {
        // O elo que transforma contagem em consequencia: o `kind` do pino e o que o popup le para
        // escolher entre "Entrar na cena" e "Visualizar em 3D". Aqui se afirma que o tipo do pino
        // concorda com o ramo declarado da forma daquela linha, que e o que o carregador exige.
        for (const feature of features) {
            const entrada = [MODELO, CENA].find((e) => e.id === feature.properties.markerId);
            const visualizador = visualizadorDaForma(derivarForma3d(entrada));
            const esperado = visualizador === Visualizador3D.FIRST_PERSON
                ? MARKER_KIND.FIRST_PERSON
                : MARKER_KIND.TILESET;
            expect(feature.properties.kind,
                `${entrada.id} desenha com ${visualizador} e ganhou o pino errado`)
                .toBe(esperado);
        }
        // O laco acima percorre uma colecao de tamanho ASSERIDO logo abaixo: laco sobre lista
        // vazia nao verifica nada.
        expect(features.length).toBe(2);
    });

    it('a geometria do pino e a posicao declarada na linha', () => {
        const [pinoDaCena] = porId(features, CENA.id);
        expect(pinoDaCena.geometry).toEqual({
            type: 'Point',
            coordinates: [CENA.locate.lon, CENA.locate.lat]
        });
    });
});

// ============================================================================
// A PARTICAO, DIRETAMENTE
// ============================================================================

describe('marcador 3D: a particao por forma e total e sem sobreposicao', () => {
    const TODAS = [MODELO, CENA, CENA_DECLARADA, NUVEM, CENA_IRRESOLVIVEL, MODELO_SEM_POSICAO];

    it('cada linha cai em EXATAMENTE uma das tres listas', () => {
        const { cesium, scenes, unrouted } = partitionTilesetEntries(TODAS);
        const total = cesium.length + scenes.length + unrouted.length;
        expect(total, 'linha perdida ou contada duas vezes pela particao').toBe(TODAS.length);
        expect(new Set([...cesium, ...scenes, ...unrouted]).size).toBe(TODAS.length);
    });

    it('as duas grafias de indoor caem na metade das CENAS', () => {
        const { scenes } = partitionTilesetEntries(TODAS);
        expect(scenes.map((s) => s.id).sort()).toEqual([CENA.id, CENA_DECLARADA.id].sort());
    });

    it('nuvem de pontos e tileset caem na metade do CESIUM', () => {
        const { cesium } = partitionTilesetEntries(TODAS);
        expect(cesium.map((c) => c.id).sort())
            .toEqual([MODELO.id, MODELO_SEM_POSICAO.id, NUVEM.id].sort());
    });

    it('a cena irresolvivel nao vira modelo: ela fica SEM visualizador', () => {
        // A metade que impede o conserto de virar o bug espelhado. Se a lista de modelos fosse
        // "tudo o que a lista de cenas recusou", uma linha indoor sem `basePath` viraria um pino
        // de modelo e o clique cairia no carregador do Cesium, que e a excecao original.
        const { cesium, unrouted } = partitionTilesetEntries(TODAS);
        expect(unrouted.map((u) => u.id)).toEqual([CENA_IRRESOLVIVEL.id]);
        expect(cesium.map((c) => c.id)).not.toContain(CENA_IRRESOLVIVEL.id);
        expect(ids(buildMarkerFeatures(TODAS, new Map())))
            .not.toContain(CENA_IRRESOLVIVEL.id);
    });

    it('entrada que nao e lista devolve as tres listas vazias', () => {
        for (const bruto of [undefined, null, {}, 'tilesets']) {
            expect(partitionTilesetEntries(bruto)).toEqual({ cesium: [], scenes: [], unrouted: [] });
        }
    });
});

// ============================================================================
// O SEGUNDO SITIO: A BUSCA
// ============================================================================

describe('marcador 3D: o id resolvido pela busca respeita a mesma particao', () => {
    const TODAS = [MODELO, CENA, NUVEM];

    it('o id de uma CENA volta com o descritor da cena', () => {
        // O bug do segundo sitio: `config.tilesets.find(...)` casava a propria cena primeiro,
        // porque uma cena E uma linha daquela lista, e devolvia `kind: 'tileset'`.
        const descritor = resolveMarkerDescriptor(TODAS, CENA.id);
        expect(descritor, 'a cena sumiu da resolucao por id').not.toBeNull();
        expect(descritor.kind).toBe(MARKER_KIND.FIRST_PERSON);
        expect(descritor.markerId).toBe(CENA.id);
        expect(descritor.coordinates).toEqual([CENA.locate.lon, CENA.locate.lat]);
        // As duas pre-visualizacoes de uma cena sao DERIVADAS da pasta dela, nunca lidas da linha.
        expect(descritor.previewThumbnail).toContain(CENA.basePath);
    });

    it('DISCRIMINACAO: o id de um MODELO continua voltando como modelo', () => {
        const descritor = resolveMarkerDescriptor(TODAS, MODELO.id);
        expect(descritor.kind).toBe(MARKER_KIND.TILESET);
        expect(descritor.name).toBe(MODELO.name);
        expect(descritor.coordinates).toEqual([MODELO.locate.lon, MODELO.locate.lat]);
    });

    it('id desconhecido e linha sem posicao devolvem null, sem levantar', () => {
        // A linha sem `locate` levantava aqui (`tileset.locate.lon` cru), e o throw subia pela
        // busca. O catalogo e JSON livre editado a mao: linha malformada nao pode derrubar tela.
        expect(resolveMarkerDescriptor(TODAS, 'nao-existe')).toBeNull();
        expect(resolveMarkerDescriptor([MODELO_SEM_POSICAO], MODELO_SEM_POSICAO.id)).toBeNull();
    });
});

// ============================================================================
// CONTAGEM DE FEICOES
// ============================================================================

describe('marcador 3D: a contagem de feicoes segue no pino do modelo', () => {
    it('o modelo carrega a contagem, e a cena carrega zero', () => {
        // Uma cena nao persiste nada, entao nao ha o que contar; o modelo carrega o numero que a
        // badge do pino desenha.
        const features = buildMarkerFeatures([MODELO, CENA], new Map([[MODELO.id, 7]]));
        expect(porId(features, MODELO.id)[0].properties.featureCount).toBe(7);
        expect(porId(features, CENA.id)[0].properties.featureCount).toBe(0);
    });

    it('sem mapa de contagens o pino ainda sai, com zero', () => {
        const features = buildMarkerFeatures([MODELO], undefined);
        expect(features.length).toBe(1);
        expect(features[0].properties.featureCount).toBe(0);
    });
});
