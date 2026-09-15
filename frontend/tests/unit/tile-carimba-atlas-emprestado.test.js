// Path: tests/unit/tile-carimba-atlas-emprestado.test.js
//
// O CARIMBO DE ATLAS NO TILE (clausula 6.7, decisao D17 de 2026-09-15).
//
// O QUE ELE EXISTE PARA PROVAR. O ramo de emprestimo do predicado do servidor so e
// exercido quando a requisicao diz QUAL atlas esta em foco. Ate D17 o tile nao dizia, e o
// efeito medido era uma camada privada que aparecia na lista e nao desenhava: quem a
// alcanca SO pelo emprestimo levava 401 nos bytes. O carimbo e a metade de cliente do
// conserto, e ele viaja na URL porque e a unica coisa que atravessa o `auth_request` do
// nginx, que chega ao backend com a query VAZIA e so carrega a URI original num cabecalho.
//
// O PAR COMPLETO, e o segundo lado e o que importa mais:
//   1. carimbo A MENOS nas duas bases credenciadas = a camada emprestada nao desenha, em
//      silencio, que e o defeito que D17 fecha;
//   2. carimbo A MAIS em qualquer outro endereco = contar a terceiros em qual atlas o
//      usuario esta, e sujar de `?atlasId=` o glifo, o sprite e o basemap do mesmo host.
//
// O CONTROLE NEGATIVO DESTE ARQUIVO E O ESTADO NORMAL, e por isso ele vem primeiro: SEM
// atlas em foco (o anonimo, o mapa local, a calibracao) a saida tem de ser byte a byte a
// de antes de D17. Um carimbo de `atlasId=` vazio nao seria ruido: o servidor valida o
// campo como UUID, entao ele derruba a leitura inteira para quem nunca teve atlas nenhum.
//
// A DISCRIMINACAO POR ORIGEM E POR FRONTEIRA DE CAMINHO nao se remede aqui: ela e o
// assunto de `credencial-de-tile-por-origem.test.js`, e este arquivo so exerce o lado
// negativo dela com o carimbo ligado, que e a combinacao nova.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const ORIGEM_DA_PAGINA = 'https://mapa.example.mil.br';
const BASE_360 = 'https://sv360.example.mil.br/api/v1/sv360';
const BASE_TILES = 'https://tiles.example.mil.br/tiles';
const TOKEN = 'jwt-de-mentira.aaa.bbb';
const ATLAS = '11111111-2222-4333-8444-555555555555';

// `window` antes do import: o ambiente unitario e node e a resolucao das bases le
// `window.location.origin`.
globalThis.window = { location: { origin: ORIGEM_DA_PAGINA } };

const estado = vi.hoisted(() => ({
    config: {
        streetView360: { serviceUrl: 'https://sv360.example.mil.br/api/v1/sv360' },
        services: { tileServerUrl: 'https://tiles.example.mil.br/tiles' },
    },
    token: 'jwt-de-mentira.aaa.bbb',
}));

vi.mock('../../src/js/config.js', () => ({ default: estado.config }));
vi.mock('../../src/js/store/sync/api-client.js', () => ({
    apiClient: { getAccessToken: () => estado.token },
}));

const { credencialDeTile } = await import('../../src/js/map/credencial-de-tile.js');
// O ESCOPO E O MODULO REAL, e nao um duplo: e ele que decide o que `?atlasId=` significa
// no resto do cliente, e um duplo aqui mediria a receita deste arquivo em vez da dele.
const { setResourceScope, resetResourceScope, resourceScopeKey } = await import(
    '../../src/js/store/sync/resource-scope.js'
);

const comAtlas = (id) => setResourceScope(resourceScopeKey('u-1', id));

describe('sem atlas em foco, a saida e a de antes de D17', () => {
    beforeEach(() => {
        resetResourceScope();
        estado.token = TOKEN;
    });

    it('o tile de uma camada de dados sai com a URL INTACTA', () => {
        const url = `${BASE_TILES}/areas_treinamento/10/385/577`;
        expect(credencialDeTile(url)).toEqual({
            url,
            headers: { Authorization: `Bearer ${TOKEN}` },
        });
    });

    it('sem sessao E sem atlas continua sendo `undefined`, o "deixe como esta"', () => {
        estado.token = null;
        expect(credencialDeTile(`${BASE_TILES}/rodovias`)).toBeUndefined();
    });
});

describe('com atlas em foco, o carimbo vai nas DUAS bases credenciadas', () => {
    beforeEach(() => {
        comAtlas(ATLAS);
        estado.token = TOKEN;
    });

    it('a camada de dados privada recebe `?atlasId=` E o cabecalho', () => {
        // Os dois juntos, porque eles cobrem pessoas diferentes: o membro sem concessao
        // propria precisa do atlas, e quem tem concessao pessoal precisa do cabecalho.
        expect(credencialDeTile(`${BASE_TILES}/areas_treinamento/10/385/577`)).toEqual({
            url: `${BASE_TILES}/areas_treinamento/10/385/577?atlasId=${ATLAS}`,
            headers: { Authorization: `Bearer ${TOKEN}` },
        });
    });

    it('o documento TileJSON tambem, e nao so os tiles', () => {
        // O MapLibre busca o documento antes dos tiles: carimbar so os tiles deixaria a
        // camada emprestada morrer no primeiro pedido, que e o defeito inteiro de volta.
        expect(credencialDeTile(`${BASE_TILES}/areas_treinamento`)?.url)
            .toBe(`${BASE_TILES}/areas_treinamento?atlasId=${ATLAS}`);
    });

    it('a base do 360 tambem, e o carimbo que ja veio da fonte nao vira dois', () => {
        // `stampAtlasOnTiles` ja escreve o escopo no template do MVT do 360. A passagem por
        // aqui precisa ser inerte naquele caso: dois `atlasId=` na mesma URL fariam o
        // Express ler um array e o Joi recusar com 422.
        const jaCarimbada = `${BASE_360}/tiles/12/1543/2270.pbf?atlasId=${ATLAS}`;
        expect(credencialDeTile(jaCarimbada)?.url).toBe(jaCarimbada);
        expect(credencialDeTile(`${BASE_360}/tiles/12/1543/2270.pbf`)?.url)
            .toBe(`${BASE_360}/tiles/12/1543/2270.pbf?atlasId=${ATLAS}`);
    });

    it('a query que ja existe sobrevive, e o fragmento fica no fim', () => {
        expect(credencialDeTile(`${BASE_TILES}/dem/1/2/3.png?rev=7#x`)?.url)
            .toBe(`${BASE_TILES}/dem/1/2/3.png?rev=7&atlasId=${ATLAS}#x`);
    });

    it('SEM TOKEN o carimbo continua indo, e e ele que alcanca o visitante de link publico', () => {
        // O caso da clausula 6.3: o visitante nao tem cookie, e um atlas `is_public` da
        // `read` a chamador anonimo. Recusar o carimbo por falta de sessao apagaria
        // exatamente a pessoa que o emprestimo existe para alcancar.
        estado.token = null;
        expect(credencialDeTile(`${BASE_TILES}/areas_treinamento/10/385/577`)).toEqual({
            url: `${BASE_TILES}/areas_treinamento/10/385/577?atlasId=${ATLAS}`,
        });
    });
});

describe('CONTROLE NEGATIVO: o carimbo nao vaza para fora das bases credenciadas', () => {
    beforeEach(() => {
        comAtlas(ATLAS);
        estado.token = TOKEN;
    });

    it('host de TERCEIRO nao recebe nem o carimbo nem o cabecalho', () => {
        // Com o carimbo ligado a falha muda de natureza: alem do token, vazaria em qual
        // atlas o usuario esta, para um servidor que nao e nosso. O `undefined` e a unica
        // resposta certa, e e ele que o MapLibre le como "deixe como esta".
        for (const url of [
            'https://a.tile.openstreetmap.org/12/1543/2270.png',
            'https://bdgex.eb.mil.br/mapcache?SERVICE=WMS&LAYERS=ctm',
            // O host que COMECA com o nosso, que e o que reprova a comparacao por prefixo.
            'https://tiles.example.mil.br.evil.example/tiles/x/1/2/3',
            'https://sv360.example.mil.br@evil.example/api/v1/sv360/tiles/3/1/2.pbf',
        ]) {
            expect(credencialDeTile(url), url).toBeUndefined();
        }
    });

    it('no MESMO host, o que esta fora das bases sai intacto', () => {
        // O deploy same-origin e onde isto morde: um deslocamento pede dezenas de faixas de
        // glifo, e todas sairiam com `?atlasId=` se a origem sozinha decidisse.
        for (const url of [
            `${ORIGEM_DA_PAGINA}/fonts/Noto%20Sans%20Regular/0-255.pbf`,
            `${ORIGEM_DA_PAGINA}/sprites/sprite@2x.png`,
            'https://tiles.example.mil.br/tilesextra/x/1/2/3',
        ]) {
            expect(credencialDeTile(url), url).toBeUndefined();
        }
    });

    it('sem a base de tiles configurada, nada dela e carimbado', () => {
        // Falha FECHADA, e tambem a guarda contra os positivos acima passarem por vacuidade.
        estado.config.services.tileServerUrl = '';
        expect(credencialDeTile(`${BASE_TILES}/rodovias`)).toBeUndefined();
        estado.config.services.tileServerUrl = BASE_TILES;
        expect(credencialDeTile(`${BASE_TILES}/rodovias`)?.url)
            .toBe(`${BASE_TILES}/rodovias?atlasId=${ATLAS}`);
    });
});
