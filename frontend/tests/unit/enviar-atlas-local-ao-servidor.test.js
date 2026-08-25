// Path: tests/unit/enviar-atlas-local-ao-servidor.test.js

/**
 * @fileoverview "Enviar ao servidor" de um atlas LOCAL, medido sobre IndexedDB DE VERDADE.
 *
 * `fake-indexeddb` é instalado para todo arquivo desta suíte (`tests/setup/indexeddb.setup.js`), e
 * é por isso que nada aqui mocka `localforage`: um `Map` chaveado por nome não distingue banco
 * AUSENTE de banco VAZIO, e não sabe nada sobre PREFIXO DE CHAVE, que é justamente o que este
 * leitor pode errar. O precedente é `tests/unit/copia-de-atlas-local.test.js`.
 *
 * QUATRO AFIRMAÇÕES, e nenhuma se sustenta sozinha:
 *
 *   1. ENDEREÇO. Cada seção sai da chave certa. As chaves NÃO são uniformes: `layers_`,
 *      `gridStyle_`, `map_notes_` e `color_usage_` são indexadas pela CHAVE do mapa, enquanto
 *      `temporal_` é indexada pelo NOME. Num atlas cujo mapa é keyed por UUID as duas divergem, e
 *      um leitor que uniformizasse leria a gaveta errada em silêncio. Por isso o mapa de teste é
 *      keyed por UUID e as duas chaves de `temporal_` existem com valores CONFLITANTES.
 *   2. ESCOPO. Lê o slot pedido, e só ele. Um segundo slot com conteúdo conflitante está semeado o
 *      tempo todo: sem ele, "leu o certo" não separa o endereçamento correto de um leitor que
 *      ignora o `dbSuffix` e cai sempre nos bancos legados.
 *   3. NÃO DESTRUIÇÃO. É o contrato do produto neste caminho, e o que o distingue do irmão do mapa
 *      (`AccountControl.saveLocalToServer`, que apaga o store porque o store É o atlas que subiu).
 *      Os dez bancos são fotografados chave a chave ANTES e comparados DEPOIS, e o escopo ativo é
 *      asserido nulo em toda linha: montar o slot seria tomar o lock de montagem dele.
 *   4. RECUSA ANTES DA REDE. Atlas sem mapa não vira atlas vazio no servidor para ser explicado
 *      depois: `importAtlas` não chega a ser chamado.
 *
 * O QUE ESTE ARQUIVO NÃO ALCANÇA, dito para não ser lido como cobertura completa: `FileReader` não
 * existe em node, e `blobToBase64` depende dele. O dublê mínimo instalado aqui lê `Blob` de
 * verdade, mas NÃO é o `FileReader` do navegador, então o que se prova sobre a imagem é que o id
 * local chega preservado ao `bulkUploadImages` — nunca que o base64 que um Chrome produziria é
 * byte a byte este. A tela e o servidor de verdade são caso de navegador.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// Do módulo, e não do global: o `env` desta suíte é o do NAVEGADOR, onde `Buffer` não existe e o
// eslint reprova o identificador solto.
import { Buffer } from 'node:buffer';
import { resetIndexedDB } from '../helpers/idb-helpers.js';

/**
 * `FileReader` mínimo, o suficiente para `readAsDataURL` de um `Blob` real.
 *
 * Instalado no GLOBAL e não injetado, porque é assim que `blobToBase64` o alcança (e é assim que o
 * localforage decide se sabe guardar `Blob`). Ele não emula o `FileReader` do navegador: emula a
 * UMA operação que este caminho usa.
 */
class FileReaderDublê {
    constructor() {
        this.result = null;
        this.error = null;
        this.onloadend = null;
        this.onerror = null;
    }

    readAsDataURL(blob) {
        Promise.resolve()
            .then(() => blob.arrayBuffer())
            .then((buf) => {
                const base64 = Buffer.from(buf).toString('base64');
                this.result = `data:${blob.type || 'application/octet-stream'};base64,${base64}`;
                this.onloadend?.();
            })
            .catch((e) => { this.error = e; this.onerror?.(); });
    }
}

/** Os DEZ bancos de dado de um atlas, escritos à mão e nunca derivados do módulo sob teste. */
const BANCOS_DE_DADO = [
    'ATLAS', 'MAPS', 'IMAGES', 'SETTINGS', 'GROUPS',
    'LAYERS', 'CESIUM3D', 'STREETVIEW360', 'BRIEFINGS', 'COMMENTS',
];

let buildServerImportPayload;
const UUID_ALFA = 'a1b2c3d4-0000-4000-8000-000000000001';
const ID_FEICAO = 'f0000000-0000-4000-8000-00000000000f';
const ID_IMAGEM = 'e0000000-0000-4000-8000-00000000000e';

let ns;
let servico;
let originalFileReader;

beforeEach(async () => {
    await resetIndexedDB();
    // A fábrica guarda um handle por (store, escopo) no nível do módulo: sem instância nova, um
    // teste leria handles que apontam para bancos que o reset acabou de apagar.
    vi.resetModules();
    originalFileReader = globalThis.FileReader;
    globalThis.FileReader = FileReaderDublê;
    ns = await import('../../src/js/store/atlas-namespace.js');
    servico = await import('../../src/js/projects/send-local-to-server.service.js');
    ({ buildServerImportPayload } = await import('../../src/js/import_export/local-atlas-to-server.js'));
});

afterEach(() => {
    globalThis.FileReader = originalFileReader;
});

/** O escopo do slot sob teste, e o do slot vizinho que nunca deve ser lido. */
const escopoAlvo = () => ns.localScope('atlas-alvo', 'alvo');
const escopoVizinho = () => ns.localScope('atlas-vizinho', 'vizinho');

/** Escreve uma chave num banco de um escopo. */
const gravar = (banco, scope, key, value) =>
    ns.getStoreFor(ns.StoreName[banco], scope).setItem(key, value);

/**
 * Semeia um atlas local completo: dois mapas (um keyed por UUID, outro pelo NOME) e uma seção de
 * cada tipo. Devolve o que foi semeado, para que as asserções não repitam os literais.
 */
async function semearAtlas(scope) {
    await gravar('ATLAS', scope, 'current_atlas', {
        id: 'atlas-alvo', name: 'Atlas do Slot', schemaVersion: '2.3',
        mapOrder: [UUID_ALFA], lastActiveMapId: UUID_ALFA,
    });

    // Mapa 1: chave UUID, nome DIFERENTE da chave. É o caso que separa "leu o nome do valor" de
    // "usou a chave como nome".
    await gravar('MAPS', scope, UUID_ALFA, {
        id: UUID_ALFA,
        name: 'Mapa Alfa',
        baseLayer: 'osm',
        zoom: 9, center_lat: -22.9, center_long: -43.2, bearing: 15, pitch: 30,
        analysisLayers: {},
        // A IDENTIDADE DA FEIÇÃO MORA EM `properties`, não na raiz: é de `properties.id`,
        // `properties.source` e `properties.layerId` que `buildFeatures` lê, e uma feição sem
        // `source` válido é DESCARTADA em silêncio (contada em `stats.droppedFeatures`).
        // Uma feição de IMAGEM tem `properties.id` igual ao id do blob, e é essa igualdade que
        // liga a referência ao upload.
        features: {
            points: [{
                geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                properties: { id: ID_FEICAO, source: 'point', layerId: 'default' },
            }],
            images: [{
                geometry: { type: 'Point', coordinates: [-43.3, -22.8] },
                properties: { id: ID_IMAGEM, source: 'image', layerId: 'default' },
            }],
        },
    });
    // Mapa 2: chave IGUAL ao nome, que é o atlas local anônimo.
    await gravar('MAPS', scope, 'Mapa Bravo', {
        id: 'Mapa Bravo', name: 'Mapa Bravo', baseLayer: 'carta-topografica', features: {},
    });

    await gravar('LAYERS', scope, `layers_${UUID_ALFA}`, [
        { id: 'default', name: 'Padrão', visible: true, locked: false, opacity: 1, order: 0 },
    ]);
    await gravar('GROUPS', scope, UUID_ALFA, {
        g1: { id: 'g1', name: 'Grupo Um', visible: true, features: [{ type: 'points', id: ID_FEICAO }] },
    });
    await gravar('CESIUM3D', scope, `cesium3d_${UUID_ALFA}`, {
        cameraPositions: {}, markers: [], measurements: [], viewsheds: [],
    });
    await gravar('STREETVIEW360', scope, `streetview360_${UUID_ALFA}`, {
        orientations: {}, markers: [],
    });

    await gravar('SETTINGS', scope, `map_notes_${UUID_ALFA}`, { title: 'Nota', description: 'Corpo' });
    await gravar('SETTINGS', scope, `gridStyle_${UUID_ALFA}`, { visible: true, type: 'utm' });
    await gravar('SETTINGS', scope, `color_usage_${UUID_ALFA}`, { '#ff0000': 2 });
    // AS DUAS CHAVES DE `temporal_`, com valores conflitantes: a certa é a do NOME.
    await gravar('SETTINGS', scope, 'temporal_Mapa Alfa', { ativo: true, unidade: 'hora' });
    await gravar('SETTINGS', scope, `temporal_${UUID_ALFA}`, { ativo: false, unidade: 'ERRADA' });
    await gravar('SETTINGS', scope, 'mapOrder', ['Mapa Bravo', UUID_ALFA]);
    await gravar('SETTINGS', scope, 'lastActiveMap', 'Mapa Alfa');
    await gravar('SETTINGS', scope, 'custom_icons', [{ id: 'ico-1', name: 'Ícone' }]);

    await gravar('BRIEFINGS', scope, 'b1', { id: 'b1', name: 'Briefing Um', slides: [], updatedAt: 2 });

    // Os DOIS blobs que o payload vai referenciar: o da feição de imagem e o do ícone
    // personalizado. `buildServerImportPayload` acrescenta os ids dos ícones a `imageIds`, e um
    // ícone sem blob subiria como referência para nada.
    await gravar('IMAGES', scope, ID_IMAGEM, new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
    await gravar('IMAGES', scope, 'ico-1', new Blob([new Uint8Array([4, 5])], { type: 'image/png' }));
}

/** Semeia o slot vizinho com conteúdo que colide em NOME de mapa e em valor de seção. */
async function semearVizinho(scope) {
    await gravar('MAPS', scope, 'Mapa Alfa', {
        id: 'Mapa Alfa', name: 'Mapa Alfa', baseLayer: 'DO-VIZINHO', features: {},
    });
    await gravar('SETTINGS', scope, 'mapOrder', ['Mapa Alfa']);
    await gravar('SETTINGS', scope, 'lastActiveMap', 'Mapa Alfa');
}

/** Fotografa chave a chave os dez bancos de um escopo. */
async function fotografar(scope) {
    const foto = {};
    for (const banco of BANCOS_DE_DADO) {
        const pares = [];
        await ns.getStoreFor(ns.StoreName[banco], scope).iterate((value, key) => {
            pares.push([key, value instanceof Blob ? `blob:${value.size}:${value.type}` : value]);
        });
        pares.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
        foto[banco] = pares;
    }
    return foto;
}

/** ApiClient de mentira que registra o que recebeu. */
function apiFalso() {
    const chamadas = { importAtlas: [], bulkUploadImages: [] };
    return {
        chamadas,
        async importAtlas(payload) {
            chamadas.importAtlas.push(payload);
            return { id: 'srv-novo-1', name: payload?.atlas?.name };
        },
        async bulkUploadImages(atlasId, itens) {
            chamadas.bulkUploadImages.push([atlasId, itens]);
            return { mapping: Object.fromEntries(itens.map((i) => [i.localId, i.localId])), failed: [] };
        },
    };
}

const enviar = (scope, extra = {}) => servico.sendLocalAtlasToServer(
    { id: 'atlas-alvo', name: 'Atlas do Slot', dbSuffix: 'alvo' },
    { scopeOf: () => scope, ...extra },
);

// ============================================================================
// 1 — ENDEREÇO: cada seção sai da chave certa
// ============================================================================

describe('buildLocalAtlasExportData :: endereço', () => {
    it('indexa os mapas pelo NOME do valor, e não pela chave do banco', async () => {
        const scope = escopoAlvo();
        await semearAtlas(scope);

        const data = await servico.buildLocalAtlasExportData(scope);

        expect(Object.keys(data.maps).sort()).toEqual(['Mapa Alfa', 'Mapa Bravo']);
        // A METADE QUE PEGA O ERRO: a chave crua NÃO virou nome de mapa.
        expect(data.maps[UUID_ALFA]).toBeUndefined();
        expect(data.maps['Mapa Alfa'].baseLayer).toBe('osm');
        expect(data.maps['Mapa Alfa'].zoom).toBe(9);
        expect(data.maps['Mapa Alfa'].bearing).toBe(15);
        expect(data.maps['Mapa Alfa'].features.points).toHaveLength(1);
    });

    it('lê `layers_`, `gridStyle_`, `map_notes_` e `color_usage_` pela CHAVE do mapa', async () => {
        const scope = escopoAlvo();
        await semearAtlas(scope);

        const data = await servico.buildLocalAtlasExportData(scope);

        expect(data.layers['Mapa Alfa']).toHaveLength(1);
        expect(data.gridStyle['Mapa Alfa']).toEqual({ visible: true, type: 'utm' });
        expect(data.mapNotes['Mapa Alfa']).toEqual({ title: 'Nota', description: 'Corpo' });
        expect(data.colorUsage['Mapa Alfa']).toEqual({ '#ff0000': 2 });
        expect(data.groups['Mapa Alfa'].g1.name).toBe('Grupo Um');
    });

    it('lê `temporal_` pelo NOME, e a chave conflitante do UUID não vence', async () => {
        // O CASO QUE REPROVA A UNIFORMIZAÇÃO. As duas chaves existem, com valores diferentes: um
        // leitor que tratasse `temporal_` como as outras devolveria `unidade: 'ERRADA'` e passaria
        // em todas as demais asserções deste arquivo.
        const scope = escopoAlvo();
        await semearAtlas(scope);

        const data = await servico.buildLocalAtlasExportData(scope);

        expect(data.temporal['Mapa Alfa']).toEqual({ ativo: true, unidade: 'hora' });
    });

    it('traduz `mapOrder` de chave para NOME, e resolve o mapa corrente', async () => {
        const scope = escopoAlvo();
        await semearAtlas(scope);

        const data = await servico.buildLocalAtlasExportData(scope);

        // A ordem gravada é ['Mapa Bravo', <uuid>]: a segunda entrada é uma CHAVE e tem de sair
        // como nome, senão o payload teria uma ordem que não casa com mapa nenhum.
        expect(data.mapOrder).toEqual(['Mapa Bravo', 'Mapa Alfa']);
        expect(data.currentMap).toBe('Mapa Alfa');
    });

    it('traz briefings e ícones personalizados, e nada disso é por mapa', async () => {
        const scope = escopoAlvo();
        await semearAtlas(scope);

        const data = await servico.buildLocalAtlasExportData(scope);

        expect(data.briefings.map((b) => b.id)).toEqual(['b1']);
        expect(data.customIcons.map((i) => i.id)).toEqual(['ico-1']);
    });

    it('atlas sem nada devolve um documento vazio, e não estoura', async () => {
        // Banco AUSENTE é o estado de um slot recém-criado, e é diferente de banco vazio: nenhum
        // dos dez existe no disco aqui.
        const data = await servico.buildLocalAtlasExportData(ns.localScope('novo', 'novo'));

        expect(data.maps).toEqual({});
        expect(data.mapOrder).toEqual([]);
        expect(data.currentMap).toBeNull();
        expect(data.briefings).toEqual([]);
    });

    it('escopo ausente quebra alto, em vez de ler o namespace de quem passar por último', async () => {
        await expect(servico.buildLocalAtlasExportData(null)).rejects.toThrow(/scope is required/);
    });
});

// ============================================================================
// 2 — ESCOPO: lê o slot pedido, e só ele
// ============================================================================

// ============================================================================
// A CAMADA PADRAO SOBE JUNTO (defeito de 2026-08-25)
// ============================================================================

describe('buildLocalAtlasExportData :: a camada padrao', () => {
    /** Um atlas com feicao e SEM a chave `layers_`, que e o atlas local mais comum. */
    async function semearSemCamada(scope) {
        await gravar('ATLAS', scope, 'current_atlas', {
            id: 'atlas-alvo', name: 'Sem Camada', schemaVersion: '2.3', mapOrder: [UUID_ALFA],
        });
        await gravar('MAPS', scope, UUID_ALFA, {
            id: UUID_ALFA, name: 'Mapa Alfa', baseLayer: 'osm',
            features: {
                points: [{
                    geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                    properties: { id: ID_FEICAO, source: 'point', layerId: 'default' },
                }],
            },
        });
        // NENHUM `gravar('LAYERS', ...)` AQUI, e essa ausencia E o caso. Um atlas local que so
        // usou a camada padrao nunca grava a chave: `LocalRepository.getLayers` SINTETIZA a
        // padrao na leitura e nunca a persiste.
    }

    it('sem a chave `layers_`, a camada padrao e SINTETIZADA no documento', async () => {
        const scope = escopoAlvo();
        await semearSemCamada(scope);
        const data = await servico.buildLocalAtlasExportData(scope);
        expect(data.layers['Mapa Alfa']).toHaveLength(1);
        expect(data.layers['Mapa Alfa'][0]).toEqual(expect.objectContaining({
            id: 'default', name: 'Padrão',
        }));
    });

    it('INVARIANTE: toda feicao do payload aponta para uma camada QUE ESTA no payload', async () => {
        // ESTE E O CASO QUE REPROVA O DEFEITO, e ele mede o que a tela sofre, nao o formato.
        //
        // Medido em 2026-08-25, no banco do chefe: os atlas enviados por este caminho tinham ZERO
        // camadas e 100% das feicoes orfas, enquanto os enviados pelo menu do mapa tinham camada
        // e nenhuma orfa. Sem camada no servidor, o `layerId` cunhado para cada feicao nao nomeia
        // coisa alguma, o filtro do mapa esconde todas, e a aba de feicoes, que nao filtra, lista
        // todas. O atlas parece cheio na lista e vazio no mapa.
        //
        // A assercao e sobre o PAYLOAD INTEIRO de propósito. Conferir so `data.layers` deixaria
        // passar um remendo que cria a camada com um id que o mapeador nao usa nas feicoes, que e
        // exatamente o mesmo estrago por outro caminho.
        const scope = escopoAlvo();
        await semearSemCamada(scope);
        const data = await servico.buildLocalAtlasExportData(scope);
        const { payload } = buildServerImportPayload(data, { name: 'Enviado' });

        for (const mapa of payload.maps) {
            const idsDeCamada = new Set((mapa.layers || []).map((l) => l.id));
            expect(idsDeCamada.size, `o mapa "${mapa.name}" subiu sem camada nenhuma`)
                .toBeGreaterThan(0);
            for (const f of (mapa.features || [])) {
                expect(idsDeCamada.has(f.properties.layerId),
                    `feicao ${f.id} aponta para a camada ${f.properties.layerId}, que nao subiu`)
                    .toBe(true);
            }
        }
    });

    it('CONTROLE: com a chave gravada, sao as camadas DELA que sobem, e nao a sintetizada', async () => {
        // Sem este controle, "sintetiza a padrao" passaria verde numa implementacao que IGNORASSE
        // as camadas reais do atlas e mandasse sempre uma padrao sozinha.
        const scope = escopoAlvo();
        await semearSemCamada(scope);
        await gravar('LAYERS', scope, `layers_${UUID_ALFA}`, [
            { id: 'uuid-um', name: 'Camada Um', visible: true, locked: false, opacity: 1, order: 0 },
            { id: 'uuid-dois', name: 'Camada Dois', visible: true, locked: false, opacity: 1, order: 1 },
        ]);
        const data = await servico.buildLocalAtlasExportData(scope);
        expect(data.layers['Mapa Alfa'].map((l) => l.name)).toEqual(['Camada Um', 'Camada Dois']);
    });
});

describe('buildLocalAtlasExportData :: escopo', () => {
    it('não lê o slot vizinho, ainda que ele tenha um mapa de mesmo NOME', async () => {
        const alvo = escopoAlvo();
        await semearAtlas(alvo);
        await semearVizinho(escopoVizinho());

        const data = await servico.buildLocalAtlasExportData(alvo);

        expect(data.maps['Mapa Alfa'].baseLayer).toBe('osm');
        expect(data.maps['Mapa Alfa'].baseLayer).not.toBe('DO-VIZINHO');
        expect(Object.keys(data.maps)).toHaveLength(2);
    });

    it('CONTROLE POSITIVO: pedindo o vizinho, é o vizinho que vem', async () => {
        // Sem esta linha, a asserção acima ficaria verde contra um leitor que não lê nada.
        const alvo = escopoAlvo();
        await semearAtlas(alvo);
        await semearVizinho(escopoVizinho());

        const data = await servico.buildLocalAtlasExportData(escopoVizinho());

        expect(Object.keys(data.maps)).toEqual(['Mapa Alfa']);
        expect(data.maps['Mapa Alfa'].baseLayer).toBe('DO-VIZINHO');
    });

    it('NUNCA ATIVA ESCOPO NENHUM: ler não é montar', async () => {
        // `activateScope` toma o lock de montagem daquele namespace e escreve o ponteiro desta aba.
        // Uma aba de mapa aberta no mesmo atlas veria uma limpeza legítima ser recusada com "já
        // está aberto em outra aba", por causa de uma LEITURA.
        const scope = escopoAlvo();
        await semearAtlas(scope);
        expect(ns.getActiveScope()).toBeNull();

        await servico.buildLocalAtlasExportData(scope);

        expect(ns.getActiveScope()).toBeNull();
    });
});

// ============================================================================
// 3 — O ENVIO, e a sua não destruição
// ============================================================================

describe('sendLocalAtlasToServer', () => {
    it('sobe o atlas com os dois mapas, o nome pedido e as feições', async () => {
        const scope = escopoAlvo();
        await semearAtlas(scope);
        const apiClient = apiFalso();

        const result = await enviar(scope, { apiClient, name: 'Operação Alfa' });

        expect(result.atlasId).toBe('srv-novo-1');
        expect(result.name).toBe('Operação Alfa');
        expect(result.stats.maps).toBe(2);

        const [payload] = apiClient.chamadas.importAtlas;
        expect(payload.atlas.name).toBe('Operação Alfa');
        expect(payload.maps.map((m) => m.name).sort()).toEqual(['Mapa Alfa', 'Mapa Bravo']);
        const alfa = payload.maps.find((m) => m.name === 'Mapa Alfa');
        expect(alfa.base_layer).toBe('osm');
        expect(alfa.zoom).toBe(9);
        // A FEICAO COMUM MANTEM O ID; A DE IMAGEM, NAO. Desde 2026-08-25 o blob ganha id novo a
        // cada envio, porque `images.id` e chave primaria global e o blob sobe DEPOIS do import,
        // fora do alcance do recunho do servidor. A feicao de imagem tem `properties.id` IGUAL ao
        // id do blob, entao ela viaja junto na troca. A comum nao tem nada a ver com blob.
        expect(alfa.features[0].id).toBe(ID_FEICAO);
        expect(alfa.features[1].id).not.toBe(ID_IMAGEM);
        expect(alfa.features).toHaveLength(2);
        expect(alfa.groups.map((g) => g.name)).toEqual(['Grupo Um']);
        expect(payload.atlas.settings.mapOrder).toEqual(['Mapa Bravo', 'Mapa Alfa']);
    });

    it('o blob sobe com id NOVO, e o payload aponta para esse mesmo id', async () => {
        // ESTE CASO MUDOU DE PREMISSA EM 2026-08-25, e a premissa velha era o defeito.
        //
        // Ele dizia "sobe a imagem PRESERVANDO o id local", e isso valia enquanto o primeiro
        // envio era o unico. Com o reenvio, `images.id` sendo chave primaria GLOBAL, o id local
        // ja esta ocupado: o servidor recunha feicao, camada e grupo no momento do import, mas o
        // blob sobe DEPOIS e fica fora desse alcance. O reenvio de um atlas com imagem entrava e
        // a imagem sumia, em silencio.
        //
        // O QUE SE MEDE AGORA E A CONCORDANCIA, e nao o valor: nao importa qual id o blob recebe,
        // importa que o payload ja aponte para ELE. Um teste que cobrasse o id local de volta
        // seria o defeito escrito como contrato.
        const scope = escopoAlvo();
        await semearAtlas(scope);
        const apiClient = apiFalso();

        const result = await enviar(scope, { apiClient, name: 'Com Imagem' });

        expect(apiClient.chamadas.bulkUploadImages).toHaveLength(1);
        const [atlasId, itens] = apiClient.chamadas.bulkUploadImages[0];
        expect(atlasId).toBe('srv-novo-1');
        // SAO DOIS, porque o icone personalizado tambem e um blob que o payload referencia.
        expect(itens).toHaveLength(2);
        const enviados = itens.map((i) => i.localId).sort();

        // 1. NENHUM id local sobreviveu.
        expect(enviados).not.toContain(ID_IMAGEM);
        expect(enviados).not.toContain('ico-1');

        // 2. E o payload aponta EXATAMENTE para os ids que subiram. Esta e a asserção que o
        //    defeito reprova: sem a troca em duas passadas, o payload guarda o id velho e a
        //    referencia fica pendurada.
        const [payload] = apiClient.chamadas.importAtlas;
        const alfa = payload.maps.find((m) => m.name === 'Mapa Alfa');
        const citados = [
            alfa.features[1].id,
            payload.atlas.settings.customIcons?.[0]?.id
                ?? Object.keys(payload.atlas.settings.customIcons ?? {})[0],
        ].filter(Boolean).sort();
        expect(citados.length, 'o payload precisa citar os dois blobs').toBe(2);
        expect(citados).toEqual(enviados);

        expect(itens.every((i) => i.mimeType === 'image/png')).toBe(true);
        expect(result.imageStats).toEqual({ total: 2, uploaded: 2, skipped: 0, failed: 0 });
    });

    it('NÃO DESTRUTIVO: os dez bancos do slot saem byte a byte como entraram', async () => {
        const scope = escopoAlvo();
        await semearAtlas(scope);
        const antes = await fotografar(scope);
        // PREMISSA ASSERIDA: a foto não está vazia. Sem ela, "igual depois" seria verdade contra
        // um slot que nunca teve nada.
        expect(antes.MAPS).toHaveLength(2);
        expect(antes.SETTINGS.length).toBeGreaterThan(5);

        await enviar(scope, { apiClient: apiFalso(), name: 'Operação Alfa' });

        expect(await fotografar(scope)).toEqual(antes);
        expect(ns.getActiveScope()).toBeNull();
    });

    it('atlas sem mapa é recusado ANTES da rede', async () => {
        const scope = ns.localScope('vazio', 'vazio');
        const apiClient = apiFalso();

        await expect(enviar(scope, { apiClient })).rejects.toThrow(/nenhum mapa/i);
        expect(apiClient.chamadas.importAtlas).toHaveLength(0);
        expect(apiClient.chamadas.bulkUploadImages).toHaveLength(0);
    });

    it('sem nome pedido, usa o nome do slot', async () => {
        const scope = escopoAlvo();
        await semearAtlas(scope);
        const apiClient = apiFalso();

        const result = await enviar(scope, { apiClient });

        expect(result.name).toBe('Atlas do Slot');
        expect(apiClient.chamadas.importAtlas[0].atlas.name).toBe('Atlas do Slot');
    });

    it('entrada sem id quebra alto, em vez de enviar o namespace errado', async () => {
        await expect(servico.sendLocalAtlasToServer({}, { apiClient: apiFalso(), scopeOf: () => escopoAlvo() }))
            .rejects.toThrow(/entry with an id/);
    });
});
