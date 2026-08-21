// Path: tests/unit/tiles-360-credencial-de-origem.test.js
//
// A CREDENCIAL DOS TILES DO 360, E EM QUE ORIGEM ELA PODE ENCOSTAR.
//
// A rota do MVT (`/api/v1/sv360/tiles/:z/:x/:y.pbf`) e `flexibleAuth`. Sem principal ela
// NAO responde 401: responde HTTP 200 com o subconjunto PUBLICO, porque o predicado de
// acesso e alimentado por `readScope(user, atlasId)`. Hoje o cookie de sessao viaja por
// acidente, ja que o worker do MapLibre monta `new Request(url, { credentials })` com
// `credentials` indefinido e o padrao do Fetch e `same-origin`. Servido o 360 de outra
// origem (SV360_SERVICE_URL, previsto em backend/src/config.js), o cookie para de ir, o
// tile continua 200 e o projeto privado do usuario some da camada 2D sem erro nenhum.
//
// ESTE ARQUIVO MEDE O PAR COMPLETO, e o segundo caso e o que importa:
//   1. carimbo A MENOS na origem do 360 = a falha muda de cima, silenciosa;
//   2. carimbo A MAIS em qualquer outra origem = o token do usuario na mao de terceiro,
//      que e estritamente pior que o defeito original.
//
// O caso 2 e escrito para REPROVAR a comparacao por prefixo de string. Duas URLs de
// terceiro passam num `url.startsWith(origem_do_360)`: o dominio registravel diferente
// que comeca igual (`...mil.br.evil.example`) e o nome do servico rebaixado a userinfo
// (`...mil.br@evil.example`, que resolve em `evil.example`). Cada bloco afirma as duas
// coisas: que o predicado ingenuo aceitaria, e que o predicado real recusa.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const ORIGEM_DA_PAGINA = 'https://mapa.example.mil.br';
const BASE_360 = 'https://sv360.example.mil.br/api/v1/sv360';
const TOKEN = 'jwt-de-mentira.aaa.bbb';

// Stub de `window` ANTES do import do modulo sob teste: o ambiente unitario e node, e
// tanto `withAbsoluteTiles` quanto a resolucao da base leem `window.location.origin`.
globalThis.window = { location: { origin: ORIGEM_DA_PAGINA } };

const estado = vi.hoisted(() => ({
    config: { streetView360: { serviceUrl: 'https://sv360.example.mil.br/api/v1/sv360' } },
    token: 'jwt-de-mentira.aaa.bbb',
}));

vi.mock('../../src/js/config.js', () => ({ default: estado.config }));

vi.mock('../../src/js/store/sync/api-client.js', () => ({
    apiClient: {
        // Sincrono de proposito: `transformRequest` do MapLibre e sincrono e nao pode
        // esperar `authHeader()`, que renova. O token e lido do que ja esta em memoria.
        getAccessToken: () => estado.token,
    },
}));

const { isSv360Url, sv360TransformRequest } = await import(
    '../../src/js/street_view_tool/streetview-api.service.js'
);

// OS DOIS PREDICADOS INGENUOS QUE ESTE ARQUIVO EXISTE PARA REPROVAR. Sao as duas
// formas obvias de "e do 360?", e cada uma erra num eixo:
//   - por prefixo de ORIGEM, o eixo do host, que e o que vaza o token para terceiro;
//   - por prefixo da BASE inteira, o eixo do caminho, que carimba o vizinho textual.
const ORIGEM_360 = 'https://sv360.example.mil.br';
const prefixoDeOrigem = (url) => url.startsWith(ORIGEM_360);
const prefixoDeBase = (url) => url.startsWith(BASE_360);

describe('a credencial vai para a origem do 360', () => {
    beforeEach(() => {
        estado.config.streetView360.serviceUrl = BASE_360;
        estado.token = TOKEN;
    });

    it('carimba o tile MVT servido de outra origem, e devolve a URL intacta', () => {
        const url = `${BASE_360}/tiles/12/1543/2270.pbf`;
        expect(isSv360Url(url)).toBe(true);
        expect(sv360TransformRequest(url)).toEqual({
            url,
            headers: { Authorization: `Bearer ${TOKEN}` },
        });
    });

    it('carimba a propria base e o resto do servico, nao so o tile', () => {
        expect(isSv360Url(BASE_360)).toBe(true);
        expect(isSv360Url(`${BASE_360}/projects`)).toBe(true);
        expect(isSv360Url(`${BASE_360}/thumbnails/x.webp`)).toBe(true);
    });

    it('sem sessao nao inventa credencial: o anonimo continua vendo o publico', () => {
        estado.token = null;
        const url = `${BASE_360}/tiles/12/1543/2270.pbf`;
        expect(isSv360Url(url)).toBe(true);
        expect(sv360TransformRequest(url)).toBeUndefined();
    });
});

describe('a credencial NAO vai para outra origem (o caso que reprova o prefixo)', () => {
    beforeEach(() => {
        estado.config.streetView360.serviceUrl = BASE_360;
        estado.token = TOKEN;
    });

    it('dominio registravel diferente que COMECA com o nome do servico', () => {
        const ataque = 'https://sv360.example.mil.br.evil.example/api/v1/sv360/tiles/3/1/2.pbf';
        // A comparacao por prefixo aceitaria, e e por isso que ela nao serve.
        expect(prefixoDeOrigem(ataque)).toBe(true);
        expect(isSv360Url(ataque)).toBe(false);
        expect(sv360TransformRequest(ataque)).toBeUndefined();
    });

    it('nome do servico rebaixado a USERINFO, com o host real depois do @', () => {
        const ataque = 'https://sv360.example.mil.br@evil.example/api/v1/sv360/tiles/3/1/2.pbf';
        expect(prefixoDeOrigem(ataque)).toBe(true);
        // Quem resolve isto e o host, nao o texto: o browser pede a `evil.example`.
        expect(new URL(ataque).origin).toBe('https://evil.example');
        expect(isSv360Url(ataque)).toBe(false);
        expect(sv360TransformRequest(ataque)).toBeUndefined();
    });

    it('mesmo host e mesmo esquema, PORTA diferente, e outra origem', () => {
        const outra = 'https://sv360.example.mil.br:8443/api/v1/sv360/tiles/3/1/2.pbf';
        expect(isSv360Url(outra)).toBe(false);
        expect(sv360TransformRequest(outra)).toBeUndefined();
    });

    it('host de terceiro sem parentesco nenhum sai intacto', () => {
        for (const url of [
            'https://bdgex.eb.mil.br/mapcache?SERVICE=WMS&LAYERS=ctmmultiescalas_mercator',
            'https://a.tile.openstreetmap.org/12/1543/2270.png',
            'https://mt1.google.com/vt/lyrs=s&x=1&y=2&z=3',
            `https://evil.example/?alvo=${encodeURIComponent(BASE_360)}/tiles/3/1/2.pbf`,
        ]) {
            expect(isSv360Url(url)).toBe(false);
            expect(sv360TransformRequest(url)).toBeUndefined();
        }
    });

    it('na origem CERTA, caminho vizinho que so compartilha o prefixo textual nao entra', () => {
        const vizinho = 'https://sv360.example.mil.br/api/v1/sv360extra/tiles/3/1/2.pbf';
        expect(prefixoDeBase(vizinho)).toBe(true);
        expect(isSv360Url(vizinho)).toBe(false);
        expect(sv360TransformRequest(vizinho)).toBeUndefined();
    });
});

describe('o deploy PADRAO (mesma origem) continua como esta hoje', () => {
    beforeEach(() => {
        // O default de `SV360_SERVICE_URL`: relativo, resolvido contra a origem da pagina.
        estado.config.streetView360.serviceUrl = '/api/v1/sv360';
        estado.token = TOKEN;
    });

    it('o tile do 360 na propria origem recebe o carimbo', () => {
        const url = `${ORIGEM_DA_PAGINA}/api/v1/sv360/tiles/12/1543/2270.pbf`;
        expect(sv360TransformRequest(url)).toEqual({
            url,
            headers: { Authorization: `Bearer ${TOKEN}` },
        });
        // E a forma relativa, que e como a URL chega antes de `withAbsoluteTiles`.
        expect(isSv360Url('/api/v1/sv360/tiles/12/1543/2270.pbf')).toBe(true);
    });

    it('o que NAO e do 360 na MESMA origem sai intacto: a origem sozinha nao basta', () => {
        for (const url of [
            `${ORIGEM_DA_PAGINA}/api/v1/tiles/carta/12/1543/2270.pbf`,
            `${ORIGEM_DA_PAGINA}/font/Noto%20Sans%20Regular/0-255.pbf`,
            `${ORIGEM_DA_PAGINA}/api/v1/assets3d/3d/PCL/tileset.json`,
            '/api/v1/auth/refresh',
        ]) {
            expect(isSv360Url(url)).toBe(false);
            expect(sv360TransformRequest(url)).toBeUndefined();
        }
    });
});

describe('entrada inutil nao derruba a criacao do mapa', () => {
    beforeEach(() => {
        estado.config.streetView360.serviceUrl = BASE_360;
        estado.token = TOKEN;
    });

    it('URL vazia, nao-string ou impossivel de parsear vira "nao mexe"', () => {
        for (const url of ['', null, undefined, 42, 'http://[', 'nao e uma url']) {
            expect(isSv360Url(url)).toBe(false);
            expect(sv360TransformRequest(url)).toBeUndefined();
        }
    });

    it('esquema opaco (blob:, data:) nunca casa com o servico', () => {
        for (const url of ['blob:https://sv360.example.mil.br/abc', 'data:application/json,{}']) {
            expect(isSv360Url(url)).toBe(false);
        }
    });

    it('config ainda sem `serviceUrl` (antes do merge do /api/config) nao carimba nada', () => {
        estado.config.streetView360 = {};
        expect(isSv360Url(`${BASE_360}/tiles/3/1/2.pbf`)).toBe(false);
        expect(sv360TransformRequest(`${BASE_360}/tiles/3/1/2.pbf`)).toBeUndefined();
        estado.config.streetView360 = { serviceUrl: BASE_360 };
    });
});
