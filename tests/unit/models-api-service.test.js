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

/**
 * Importa o módulo já com o fetch trocado, para o cache dele nascer limpo.
 *
 * O preflight busca DUAS rotas em paralelo, então o duplo tem de responder
 * conforme a URL. Um duplo que devolve o mesmo corpo às duas faria o catálogo
 * de cenas receber a lista de modelos, e o teste passaria medindo outra coisa.
 */
async function carrega(resposta, { ok = true, locais = [{ ...GLB_LOCAL }], cenas = null, okCenas = true } = {}) {
    vi.stubGlobal('fetch', vi.fn(async (url) => (
        String(url).includes('/scenes.json')
            ? { ok: okCenas, json: async () => (cenas ?? { count: 0, scenes: [] }) }
            : { ok, json: async () => resposta }
    )));
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

        // AS DUAS buscas levam o sinal: uma sem ele penduraria a partida do
        // mesmo jeito, e seria a mais fácil de esquecer.
        expect(globalThis.fetch.mock.calls).toHaveLength(2);
        for (const [, opcoes] of globalThis.fetch.mock.calls) {
            expect(opcoes?.signal).toBeInstanceOf(AbortSignal);
        }
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

describe('modelo GLB solto', () => {
    /** Uma entrada `type: 'glb'` como o ebgeo_3d a publica. */
    function respostaGlb() {
        return {
            count: 1,
            tilesets: [{
                id: 'estatua',
                name: 'Estatua',
                type: 'glb',
                url: '/api/v1/models/estatua/model.glb',
                heightOffset: 50,
                position: { lon: -44.447668, lat: -22.454757 },
                rotation: { heading: 180, pitch: 0, roll: 0 },
                locate: { lon: -44.447668, lat: -22.454757, height: 350 },
            }],
        };
    }

    it('aponta o model.glb, e nao o tileset.json', async () => {
        // O DEFEITO QUE ESTE TESTE TRAVA: um cliente que monta sempre
        // `tileset.json` pede um arquivo que nao existe no modelo glb. O Cesium
        // trata 404 de tileset como arvore vazia, e o modelo some sem erro.
        const svc = await carrega(respostaGlb(), { locais: [] });
        await svc.preflightCheck();

        const e = config.tilesets.find(t => t.id === 'estatua');
        expect(e.type).toBe('glb');
        expect(e.url).toBe(`${BASE}/models/estatua/model.glb`);
    });

    it('traz position e rotation, que so o glb usa', async () => {
        // Sem `position` o `createGlbModel` do map_3d.js chama
        // `Cartesian3.fromDegrees(undefined, undefined)` e o modelo vai para o
        // centro da Terra.
        const svc = await carrega(respostaGlb(), { locais: [] });
        await svc.preflightCheck();

        const e = config.tilesets.find(t => t.id === 'estatua');
        expect(e.position).toEqual({ lon: -44.447668, lat: -22.454757 });
        expect(e.rotation).toEqual({ heading: 180, pitch: 0, roll: 0 });
        expect(e.heightOffset).toBe(50);
    });

    it('o 3dtiles NAO ganha position nem rotation', async () => {
        const svc = await carrega(respostaDoServico(), { locais: [] });
        await svc.preflightCheck();

        const t = config.tilesets.find(x => x.id === 'ponte-quatis');
        expect(t.type).toBe('3dtiles');
        expect(t.position).toBeUndefined();
        expect(t.rotation).toBeUndefined();
    });
});

describe('cenas navegáveis a pé', () => {
    /** Uma cena como o ebgeo_3d a publica. */
    function respostaCenas() {
        return {
            count: 1,
            scenes: [{
                id: 'museu-1cgeo',
                name: 'Sala Historica General Malan',
                basePath: '/scenes/museu-1cgeo',
                description: 'Acervo do 1o CGEO',
                local: 'Porto Alegre, RS',
                data_captura: '04/08/2026',
                keywords: ['museu'],
                locate: { lon: -51.2, lat: -30.03 },
                poseInicial: { x: 3.82, y: 0.55, z: 1.42, yaw: 0, pitch: 0 },
                velocidade: 2.4,
                fov: 60,
            }],
        };
    }

    it('preenche config.firstPerson3d.scenes com o basePath ABSOLUTO', async () => {
        // O DEFEITO QUE ESTE TESTE TRAVA: um basePath relativo faria o
        // scene-config.service.js derivar sete endereços a partir da raiz do
        // site, e não do serviço. O splat carregaria de um lugar que não existe,
        // e a cena abriria vazia.
        const svc = await carrega(respostaDoServico(), { cenas: respostaCenas() });
        expect(await svc.preflightCheck()).toBe(true);

        const cena = config.firstPerson3d.scenes[0];
        expect(cena.basePath).toBe(`${BASE}/scenes/museu-1cgeo`);
        expect(cena.id).toBe('museu-1cgeo');
        expect(cena.poseInicial).toEqual({ x: 3.82, y: 0.55, z: 1.42, yaw: 0, pitch: 0 });
        expect(cena.velocidade).toBe(2.4);
        expect(cena.fov).toBe(60);
    });

    it('uma CENA sozinha ja vale, mesmo sem nenhum modelo', async () => {
        // Exigir os dois apagaria do mapa o que está funcionando por causa do
        // que não está.
        const svc = await carrega({ count: 0, tilesets: [] }, { cenas: respostaCenas(), locais: [] });
        expect(await svc.preflightCheck()).toBe(true);
        expect(config.firstPerson3d.scenes).toHaveLength(1);
        expect(config.tilesets).toHaveLength(0);
    });

    it('um MODELO sozinho ja vale, mesmo sem nenhuma cena', async () => {
        const svc = await carrega(respostaDoServico(), { cenas: { count: 0, scenes: [] }, locais: [] });
        expect(await svc.preflightCheck()).toBe(true);
        expect(config.tilesets).toHaveLength(1);
        expect(config.firstPerson3d.scenes).toHaveLength(0);
    });

    it('devolve false so quando NENHUM dos dois responde nada', async () => {
        const svc = await carrega({ count: 0, tilesets: [] }, { cenas: { count: 0, scenes: [] }, locais: [] });
        expect(await svc.preflightCheck()).toBe(false);
    });

    it('a rota de cenas fora do ar nao derruba os modelos', async () => {
        const svc = await carrega(respostaDoServico(), { okCenas: false, locais: [] });
        expect(await svc.preflightCheck()).toBe(true);
        expect(config.tilesets).toHaveLength(1);
        expect(config.firstPerson3d.scenes).toHaveLength(0);
    });
});
