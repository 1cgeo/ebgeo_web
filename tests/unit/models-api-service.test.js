/**
 * Catálogo de modelos 3D vindo do serviço ebgeo_3d.
 *
 * O que estes testes guardam é o CONTRATO entre dois repositórios: o
 * `ebgeo_3d` publica `/api/v1/models`, e este cliente traduz a resposta para o
 * array `config.tilesets` que sete lugares do aplicativo já leem. Um campo que
 * mude de nome de um lado some do mapa sem erro nenhum do outro.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const BASE = 'http://servico-de-teste/api/v1';

/** Uma entrada como o ebgeo_3d a publica hoje, campo a campo. */
function respostaDoServico(extra = {}) {
    return {
        count: 1,
        tilesets: [{
            id: 'ponte-quatis',
            name: 'Ponte General Osorio (Quatis)',
            type: '3dtiles',
            // O SERVIÇO PUBLICA UM `url`, e o cliente TEM de ignorá-lo: em
            // produção o serviço não enxerga o prefixo sob o qual é publicado.
            url: '/api/v1/models/ponte-quatis/tileset.json',
            description: 'Ponte sobre o rio Paraiba do Sul',
            local: 'Quatis, RJ',
            data_captura: '15/03/2024',
            keywords: ['ponte', 'drone'],
            heightOffset: 0,
            groundHeight: 343.2,
            minHeight: 292.6,
            locate: { lon: -44.286984, lat: -22.400374, height: 843.2 },
            previewThumbnail: '/assets/ponte-quatis.webp',
            formato: { tilesVersion: '1.1', geometry: 'draco' },
            ...extra,
        }],
    };
}

/** Modelo local, servido como arquivo estático. O serviço não o cobre. */
const GLB_LOCAL = { id: 'hangar-01', type: 'glb', name: 'Hangar', url: '/3d/models/TGL.glb' };

/**
 * O `config` VEM DO MESMO GRAFO DE MÓDULOS que o serviço, e não de um import no
 * topo do arquivo.
 *
 * `vi.resetModules()` esvazia o registro, então o `import()` dentro de
 * `carrega()` instancia um `config.js` NOVO. Um `config` importado no topo
 * ficaria preso à instância anterior, e o teste leria um objeto que o serviço
 * nunca tocou: todas as asserções falhariam apontando para o código, quando o
 * defeito é do instrumento. Aconteceu, e custou uma rodada.
 */
let config;
let serviceUrlBase = BASE;

beforeEach(() => {
    serviceUrlBase = BASE;
    vi.resetModules();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

/** Importa o módulo já com o fetch trocado, para o cache dele nascer limpo. */
async function carrega(resposta, { ok = true, locais = [{ ...GLB_LOCAL }] } = {}) {
    vi.stubGlobal('fetch', vi.fn(async () => ({
        ok,
        json: async () => resposta,
    })));
    config = (await import('../../src/js/config.js')).default;
    config.tilesets = locais;
    config.models3d = { serviceUrl: serviceUrlBase };
    return import('../../src/js/3d_models_viewer_tool/services/models-api.service.js');
}

describe('preflightCheck', () => {
    it('preenche config.tilesets com os modelos do serviço', async () => {
        const svc = await carrega(respostaDoServico());
        expect(await svc.preflightCheck()).toBe(true);

        const ponte = config.tilesets.find(t => t.id === 'ponte-quatis');
        expect(ponte).toBeDefined();
        expect(ponte.name).toBe('Ponte General Osorio (Quatis)');
        expect(ponte.description).toBe('Ponte sobre o rio Paraiba do Sul');
        expect(ponte.local).toBe('Quatis, RJ');
        expect(ponte.data_captura).toBe('15/03/2024');
        expect(ponte.keywords).toEqual(['ponte', 'drone']);
        expect(ponte.locate).toEqual({ lon: -44.286984, lat: -22.400374, height: 843.2 });
        expect(ponte.heightOffset).toBe(0);
    });

    it('monta a URL do tileset a partir da BASE, e ignora a que o serviço publica', async () => {
        // O DEFEITO QUE ESTE TESTE TRAVA: em produção o serviço vive atrás de um
        // prefixo que ele não enxerga (`/ebgeo_3d`, que o proxy reescreve para
        // `/api/v1`). A URL que ele monta responde 404 do lado de fora, e o
        // CesiumJS trata isso como tileset vazio: modelo sumido, console limpo.
        const svc = await carrega(respostaDoServico());
        await svc.preflightCheck();

        const ponte = config.tilesets.find(t => t.id === 'ponte-quatis');
        expect(ponte.url).toBe(`${BASE}/models/ponte-quatis/tileset.json`);
        expect(ponte.url).not.toBe('/api/v1/models/ponte-quatis/tileset.json');
    });

    it('prefixa a miniatura com a base, como o 360 faz', async () => {
        const svc = await carrega(respostaDoServico());
        await svc.preflightCheck();

        const ponte = config.tilesets.find(t => t.id === 'ponte-quatis');
        expect(ponte.previewThumbnail).toBe(`${BASE}/assets/ponte-quatis.webp`);
        // Sem arquivo de vídeo o serviço omite o campo, e o cliente não inventa.
        expect(ponte.previewVideo).toBeUndefined();
    });

    it('CONCATENA com os modelos locais, sem apagá-los', async () => {
        // O `type: 'glb'` é arquivo estático, que o ebgeo_3d não cobre.
        // Substituir o array o apagaria do mapa sem erro no console.
        const svc = await carrega(respostaDoServico());
        await svc.preflightCheck();

        expect(config.tilesets).toHaveLength(2);
        expect(config.tilesets.some(t => t.id === 'hangar-01')).toBe(true);
    });

    it('o serviço GANHA de uma entrada local com o mesmo id', async () => {
        // Sete consumidores usam `find`, que para no primeiro. Se alguém deixou
        // no config a entrada a mão de um modelo que já migrou, o dado vivo
        // manda, e por isso o do serviço vem antes.
        const svc = await carrega(respostaDoServico(), {
            locais: [{ id: 'ponte-quatis', name: 'Versao velha, a mao', url: '/3d/velho.json' }],
        });
        await svc.preflightCheck();

        expect(config.tilesets).toHaveLength(1);
        expect(config.tilesets[0].name).toBe('Ponte General Osorio (Quatis)');
    });

    it('chamado duas vezes NAO multiplica os modelos', async () => {
        // Sem guardar a lista local original, o segundo preflight leria o array
        // já concatenado como se fosse a lista local.
        const svc = await carrega(respostaDoServico());
        await svc.preflightCheck();
        await svc.preflightCheck();

        expect(config.tilesets).toHaveLength(2);
        expect(config.tilesets.filter(t => t.id === 'ponte-quatis')).toHaveLength(1);
    });

    it('devolve false e NAO toca no array quando o servico responde erro', async () => {
        const svc = await carrega({}, { ok: false });
        expect(await svc.preflightCheck()).toBe(false);
        expect(config.tilesets).toHaveLength(1);
        expect(config.tilesets[0].id).toBe('hangar-01');
    });

    it('devolve false quando o catalogo vem vazio', async () => {
        const svc = await carrega({ count: 0, tilesets: [] });
        expect(await svc.preflightCheck()).toBe(false);
        expect(config.tilesets).toHaveLength(1);
    });

    it('devolve false sem serviceUrl, e nem tenta a rede', async () => {
        serviceUrlBase = '';
        const svc = await carrega(respostaDoServico());
        expect(await svc.preflightCheck()).toBe(false);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('nao pendura: a busca leva AbortSignal', async () => {
        // Falhar e ruidoso e verdadeiro, pendurar e silencioso e mentiroso. Um
        // servico que aceita a conexao e nao responde travaria a partida inteira
        // sem erro no console, que e o modo de falha que o `load` do MapLibre ja
        // produziu aqui.
        const svc = await carrega(respostaDoServico());
        await svc.preflightCheck();

        const [, opcoes] = globalThis.fetch.mock.calls[0];
        expect(opcoes?.signal).toBeInstanceOf(AbortSignal);
    });
});

describe('getCachedModels', () => {
    it('nao faz pedido de rede', async () => {
        const svc = await carrega(respostaDoServico());
        await svc.preflightCheck();
        const antes = globalThis.fetch.mock.calls.length;

        expect(svc.getCachedModels()).toHaveLength(1);
        expect(globalThis.fetch.mock.calls.length).toBe(antes);
    });
});
