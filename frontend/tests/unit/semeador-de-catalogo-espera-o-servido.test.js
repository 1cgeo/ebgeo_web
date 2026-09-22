// Path: tests/unit/semeador-de-catalogo-espera-o-servido.test.js
//
// O SEMEADOR DE CATALOGO SO VOLTA QUANDO O CATALOGO SERVIDO CONCORDA, E POR QUE ISSO PRECISA
// DE GUARDA AQUI, NO NODE, E NAO NA CAMADA QUE ELE SERVE.
//
// `frontend/tests/e2e-ui/helpers/catalog-seed.js` escreve a linha de catalogo por SQL. O
// harness do Playwright liga o memo do `GET /api/config` (`CONFIG_CACHE_FORCE=1` em
// `tests/e2e-ui/backend.js`), cuja invalidacao e a escrita PELA API e mais nada: um INSERT
// nao a dispara. Sozinha, uma spec nao sente (o memo esta frio); na rodada completa a spec
// anterior o aqueceu, e a pagina abre com o catalogo SEM a linha recem-semeada. Medido em
// 2026-09-21 em `first-person-collaboration.spec.js` (1 reprovacao por rodada completa, zero
// em 16 execucoes isoladas) e de novo em 2026-09-22 com um controle direto: com o memo
// aquecido, o `config` do cliente responde `tilesets: []` depois de uma semeadura.
//
// A ESPERA E AGORA PARTE DO SEMEADOR, e este arquivo existe para que ela nao volte a sair. Ele
// nao le prosa: ele DIRIGE o modulo com `fetch` e Postgres falsos e olha a ORDEM dos fatos.
// Um guarda estrutural (procurar a palavra `esperarCatalogoServido` no arquivo) passaria verde
// com a chamada presente e inerte, que e a forma que a constituicao chama de cobertura vazia.
//
// A SEGUNDA METADE E A FORMA DA COLECAO, e ela e a armadilha barata de cometer: no payload,
// `tilesets` e LISTA e `basemaps` e OBJETO chaveado por id. Uma espera escrita so para lista
// responde `undefined` na segunda, em silencio, e a fresta continua aberta exatamente onde se
// acredita te-la fechado. Por isso o caso do mapa base afirma o mesmo que o do tileset.
//
// O QUE ELE DECLARA QUE NAO ACONTECE: `seedSv360Photo` e `seedModelo3d` nao falam com o
// `/api/config`, porque as tabelas deles nao entram naquele payload (conferido no payload
// SERVIDO em 2026-09-22: a chave `streetView360` traz so `serviceUrl`, `miniMapBasemap` e os
// dois pares de source; `a3d.models` nao aparece). Declarar a ausencia e o que impede a
// proxima leitura de "consertar" o que nao esta quebrado, e o que faz uma espera acrescentada
// por engano ali reprovar em vez de travar 45 s numa spec.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** O que o `GET /api/config` falso devolve agora. Cada caso o reescreve. */
let payload;
/** Toda URL pedida, na ordem. */
let pedidos;
/** Todo SQL executado, na ordem. */
let sqls;

vi.mock('../e2e-ui/state.js', () => ({
    readState: () => ({ skip: false, baseUrl: 'http://backend.invalido', dbName: 'banco' }),
}));

vi.mock('../e2e-ui/helpers/accounts.js', () => ({
    DEFAULT_ORG_ID: '00000000-0000-0000-0000-000000000001',
}));

vi.mock('../e2e-ui/helpers/db.js', () => ({
    createDb: () => ({
        raw: {
            none: async (sql) => { sqls.push(sql); },
            one: async (sql) => { sqls.push(sql); return { id: 'projeto-1' }; },
        },
    }),
}));

/** O modulo sob teste, importado uma vez (a transformacao e o que custa; ver testing.md). */
let seed;

beforeEach(async () => {
    payload = { tilesets: [], basemaps: {} };
    pedidos = [];
    sqls = [];
    vi.stubGlobal('fetch', async (url) => {
        pedidos.push(String(url));
        return { status: 200, json: async () => JSON.parse(JSON.stringify(payload)) };
    });
    seed = await import('../e2e-ui/helpers/catalog-seed.js');
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('o semeador de catalogo espera o catalogo SERVIDO', () => {
    it('seedTileset publico nao volta enquanto o payload nao traz a linha, e o SQL vem antes', async () => {
        let resolvido = false;
        const promessa = seed.seedTileset('banco', { id: 'ts-1' }).then((v) => { resolvido = true; return v; });

        // A janela em que o memo ainda nao viu a linha: o SQL ja foi, a espera nao terminou.
        await vi.waitFor(() => expect(pedidos.length).toBeGreaterThan(0));
        expect(sqls.length).toBe(1);
        expect(sqls[0]).toContain('INSERT INTO tilesets');
        expect(resolvido).toBe(false);

        // O memo "vence": a linha aparece, e so entao o semeador devolve.
        payload.tilesets = [{ id: 'ts-1', name: 'Tileset de teste' }];
        await expect(promessa).resolves.toBe('ts-1');
        expect(pedidos.every((u) => u.includes('/api/config'))).toBe(true);
    }, 20000);

    it('seedBasemap publico le a colecao OBJETO, que uma espera so-de-lista nao enxergaria', async () => {
        let resolvido = false;
        const promessa = seed.seedBasemap('banco', { id: 'bm-1', accessLevel: 'public' })
            .then((v) => { resolvido = true; return v; });

        await vi.waitFor(() => expect(pedidos.length).toBeGreaterThan(0));
        expect(sqls[0]).toContain('INSERT INTO basemaps');
        expect(resolvido).toBe(false);

        // A FORMA E O PONTO: objeto chaveado por id, valor SEM `id` proprio.
        payload.basemaps = { 'bm-1': { name: 'Camada base de teste', enabled: true } };
        await expect(promessa).resolves.toBe('bm-1');
    }, 20000);

    it('linha PRIVADA espera o contrario: volta na primeira ida, e nao volta enquanto o memo a servir', async () => {
        // Uma linha privada nao pode aparecer no payload anonimo. O memo que ainda serve a
        // versao PUBLICA do mesmo id e o caso que a espera de ausencia existe para pegar.
        payload.tilesets = [{ id: 'ts-2', name: 'versao publica velha' }];
        let resolvido = false;
        const promessa = seed.seedTileset('banco', { id: 'ts-2', accessLevel: 'private' })
            .then((v) => { resolvido = true; return v; });
        await vi.waitFor(() => expect(pedidos.length).toBeGreaterThan(0));
        expect(resolvido).toBe(false);

        payload.tilesets = [];
        await expect(promessa).resolves.toBe('ts-2');
    }, 20000);

    it('esperarCatalogo: false devolve sem uma unica ida ao /api/config', async () => {
        await expect(seed.seedTileset('banco', { id: 'ts-3', esperarCatalogo: false })).resolves.toBe('ts-3');
        expect(pedidos).toEqual([]);
        expect(sqls.length).toBe(1);
    });

    it('os dois semeadores FORA do payload nao falam com o /api/config', async () => {
        await seed.seedSv360Photo('banco', { photoName: 'f.jpg', slug: 's' });
        await seed.seedModelo3d('banco', { modelId: 'm-1' });
        expect(pedidos).toEqual([]);
        // E o SQL foi mesmo executado, senao o zero acima seria zero de nada.
        expect(sqls.length).toBeGreaterThan(0);
        expect(sqls.join(' ')).toContain('sv360.projects');
        expect(sqls.join(' ')).toContain('a3d.models');
    });
});
