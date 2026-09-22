// Path: tests/integration/tiles-360-sem-laco-em-404.repro.test.js
//
// O TILE QUE FOI SERVIDO E DEPOIS RECUSADO NAO E PEDIDO DE NOVO, E O LACO SE MEDE COM O CODIGO DO
// MAPLIBRE QUE O PRODUZIA.
//
// O INCIDENTE (stack de teste, 2026-09-21, log do nginx): 309.325 respostas 404 em oito minutos
// para `GET .../api/v1/sv360/tiles/{z}/{x}/{y}.pbf?atlasId=<um atlas>`, pico perto de 530 por
// segundo, duas estacoes ao mesmo tempo e so 26 tiles DISTINTOS, cada um pedido ate ~56 mil vezes.
// Eram os tiles que cada mapa tinha na tela, o minimapa oculto do 360 parado em 0,0 inclusive.
//
// A CAUSA NAO ESTAVA NO NOSSO CODIGO, e a primeira hipotese (alguma recarga de fonte nossa reagindo
// a erro ou a evento) foi descartada lendo o caminho vivo: nada chama `setTiles`, `setUrl`,
// `refreshTiles` ou `reload` numa fonte do 360, e a unica demolicao (`rebuildScopedSource`) so roda
// numa troca de atlas comparada por valor. O laco e do MapLibre instalado, e fecha com tres fatos
// (o `fileoverview` de `frontend/src/js/map/tile-expiry-guard.js` os descreve por extenso):
//
//   1. a rota do MVT responde `max-age=60`, entao todo tile ganha validade e e atualizado PELA
//      REDE um minuto depois (`_setTileReloadTimer` -> `_reloadTile(id, 'expired')`);
//   2. um tile VETORIAL respondido 404 nao e erro: `_afterTileLoadWorkerResponse(tile, null)` o
//      carrega vazio sem passar por `setExpiryData`, e a validade vencida fica no tile;
//   3. `getExpiryTimeout` devolve entao `expirationTime - agora`, um numero NEGATIVO, que o
//      `if (expiryTimeout)` le como verdadeiro: o `setTimeout` dispara na hora, o pedido volta 404,
//      e o ciclo se fecha a cada ida e volta, para sempre.
//
// O QUE ESTE ARQUIVO DIRIGE E O CODIGO REAL, NAS DUAS PONTAS. Do lado do MapLibre, `getExpiryTimeout`,
// `_setTileReloadTimer`, `_clearTileReloadTimer` e `_reloadTile` sao EXTRAIDOS do bundle instalado
// (`node_modules/maplibre-gl/dist/maplibre-gl.mjs`, o que o navegador executa) e rodam aqui como
// metodos do duble. O que o duble reescreve a mao e so o que nao se extrai sem arrastar o pacote
// inteiro (o carregamento do tile, reduzido aos dois caminhos em jogo, 200 com `max-age` e 404), e
// cada linha reescrita tem a premissa PRESA contra o mesmo bundle no primeiro bloco. Do nosso lado,
// o modulo da guarda, sem duble nenhum.
//
// CONTROLE NEGATIVO, conferido: comentar a chamada a `installTileExpiryGuard` em `cenario()` (ou
// fazer `guardTilePrototype` devolver `false` antes de embrulhar) deixa VERMELHOS os casos "COM a
// guarda" do segundo bloco, com centenas de pedidos contados onde se exige um por tile; e o caso
// "CONTROLE DO INSTRUMENTO" e o mesmo cenario sem a guarda, que precisa ver o laco para que o verde
// dos outros signifique alguma coisa. Uma atualizacao do MapLibre que mude qualquer dos tres fatos
// reprova o primeiro bloco, que e o aviso para medir de novo em vez de confiar na guarda.
//
// O QUE ELE NAO PROVA: um mapa vivo com Web Worker e rede de verdade. Isso e Playwright; aqui fica
// o mecanismo, com o tempo falso do vitest no lugar do relogio e 20 ms de ida e volta no servidor.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
    guardTilePrototype, installTileExpiryGuard, isRunOutTimeout, LOADED_WITHOUT_DATA,
} from '../../src/js/map/tile-expiry-guard.js';

const BUNDLE = readFileSync(
    fileURLToPath(new URL('../../node_modules/maplibre-gl/dist/maplibre-gl.mjs', import.meta.url)),
    'utf8'
);

/**
 * O corpo de um metodo do bundle minificado, casando chaves a partir da assinatura. Os metodos
 * extraidos aqui nao tem chave dentro de string, o que o controle de vacuo confere.
 * @param {RegExp} assinatura - Casa ate o `{` de abertura; os grupos sao os parametros.
 * @returns {{params: string[], corpo: string}|null}
 */
function metodo(assinatura) {
    const casou = assinatura.exec(BUNDLE);
    if (!casou) return null;
    const inicio = casou.index + casou[0].length;
    let profundidade = 1;
    let i = inicio;
    for (; i < BUNDLE.length && profundidade > 0; i++) {
        if (BUNDLE[i] === '{') profundidade++;
        else if (BUNDLE[i] === '}') profundidade--;
    }
    return { params: casou.slice(1), corpo: BUNDLE.slice(inicio, i - 1) };
}

const AsyncFunction = (async () => {}).constructor;

/**
 * Compila um corpo extraido do bundle. E o unico `eval` do arquivo, e ele e o ponto: o metodo que
 * roda no duble e o do MapLibre, nao uma copia escrita a mao que poderia discordar dele.
 * @param {string[]} params
 * @param {string} corpo
 * @param {{assincrono?: boolean}} [opcoes]
 * @returns {Function}
 */
function compilar(params, corpo, { assincrono = false } = {}) {
    if (assincrono) return new AsyncFunction(...params, corpo);
    // eslint-disable-next-line no-new-func
    return new Function(...params, corpo);
}

const EXPIRY = metodo(/getExpiryTimeout\(\)\{/);
const ARMAR = metodo(/_setTileReloadTimer\((\w+),(\w+)\)\{/);
const DESARMAR = metodo(/_clearTileReloadTimer\((\w+)\)\{/);
const RECARREGAR = metodo(/async _reloadTile\((\w+),(\w+)\)\{/);
const DEPOIS_DO_WORKER = metodo(/_afterTileLoadWorkerResponse\((\w+),(\w+)\)\{/);
const CARREGADO = metodo(/_tileLoaded\((\w+),(\w+),(\w+),(\w+),(\w+)\)\{/);

// ============================================================
// 1. As premissas, no bundle que o navegador executa
// ============================================================

describe('o que o MapLibre instalado faz com um tile vetorial que volta 404', () => {
    it('CONTROLE DE VACUO: os seis metodos foram achados e tem corpo', () => {
        // Sem isto, um extrator que parasse de casar deixaria o bloco seguinte rodando `undefined`
        // e reprovando pelo motivo errado, que e o convite para "consertar" apagando o caso.
        for (const achado of [EXPIRY, ARMAR, DESARMAR, RECARREGAR, DEPOIS_DO_WORKER, CARREGADO]) {
            expect(achado).not.toBeNull();
            expect(achado.corpo.length).toBeGreaterThan(20);
        }
        expect(EXPIRY.corpo).toContain('this.expirationTime');
        expect(ARMAR.corpo).toContain('setTimeout(');
        // Uma definicao so de cada, senao o extrator poderia ter pego a errada.
        expect(BUNDLE.match(/getExpiryTimeout\(\)\{/g)).toHaveLength(1);
        expect(BUNDLE.match(/_setTileReloadTimer\(\w+,\w+\)\{/g)).toHaveLength(1);
    });

    it('fato 2: o 404 VETORIAL vira tile vazio, sem erro e sem `setExpiryData`', () => {
        expect(BUNDLE).toMatch(
            /if\(\w+&&\w+\.status!==404\)throw \w+;this\._afterTileLoadWorkerResponse\(\w+,null\)/
        );
        const [tile, dado] = DEPOIS_DO_WORKER.params;
        // A validade so e renovada QUANDO HA DADO; o 404 chega aqui com `null`.
        expect(DEPOIS_DO_WORKER.corpo)
            .toContain(`${dado}&&this.map._refreshExpiredTiles&&${tile}.setExpiryData(${dado})`);
        expect(DEPOIS_DO_WORKER.corpo).toContain(`${tile}.loadVectorData(${dado},`);
    });

    it('fato 3: o timer e rearmado DEPOIS de todo carregamento, antes do evento `data`', () => {
        const corpo = CARREGADO.corpo;
        const [tile, id] = CARREGADO.params;
        const armar = corpo.indexOf(`this._setTileReloadTimer(${id},${tile})`);
        expect(armar).toBeGreaterThanOrEqual(0);
        expect(armar).toBeLessThan(corpo.indexOf('`data`'));
        // E o timer, quando dispara, pede de novo como `expired`, que e o ramo que vai a rede.
        expect(ARMAR.corpo).toContain('this._reloadTile(');
        expect(ARMAR.corpo).toContain('`expired`');
        expect(BUNDLE).toMatch(/!\w+\.actor\|\|\w+\.state===`expired`/);
    });
});

// ============================================================
// 2. O laco, com o codigo do MapLibre dirigindo o duble
// ============================================================

const RTT_MS = 20;
const MAX_AGE_S = 60;
const UM_MINUTO = 60_000;

/**
 * Um tile com o `getExpiryTimeout` REAL. `loadVectorData` e `setExpiryData` sao reduzidos ao que o
 * bundle faz nos dois caminhos daqui (presos no bloco 1): o carregamento marca `loaded` e guarda o
 * dado ou nada; uma validade `max-age` nova poe `expirationTime` no futuro e zera a contagem.
 * Uma CLASSE POR CENARIO, porque a guarda embrulha o prototipo e um cenario nao pode herdar a
 * guarda do anterior.
 */
function classeDeTile() {
    return class TileDuble {
        constructor(id) {
            this.id = id;
            this.state = 'loading';
            this.expirationTime = undefined;
            this.expiredRequestCount = 0;
        }

        hasData() {
            return this.state === 'loaded' || this.state === 'reloading' || this.state === 'expired';
        }

        loadVectorData(dado) {
            this.state = 'loaded';
            this.dado = dado ?? null;
        }

        setExpiryData({ maxAgeS }) {
            this.expirationTime = Date.now() + maxAgeS * 1000;
            this.expiredRequestCount = 0;
        }

        getExpiryTimeout() {
            return undefined; // trocado abaixo pelo metodo extraido
        }
    };
}

/**
 * O `TileManager` do duble: armar, desarmar e recarregar sao os do bundle; carregar e o par
 * `TileManager._loadTile` + `VectorTileSource.loadTile` + `_afterTileLoadWorkerResponse`, reduzido.
 */
function cenario({ guarda, ids = ['12/2048/2048'] }) {
    const Tile = classeDeTile();
    Tile.prototype.getExpiryTimeout = compilar([], EXPIRY.corpo);

    const ouvintes = new Set();
    const mapa = {
        on: (tipo, fn) => { if (tipo === 'sourcedata') ouvintes.add(fn); },
        off: (tipo, fn) => { if (tipo === 'sourcedata') ouvintes.delete(fn); },
    };

    const estado = { acesso: true, pedidos: [], cargas: [] };
    const servidor = () => new Promise((responder) => {
        estado.pedidos.push(Date.now());
        setTimeout(() => responder(estado.acesso ? { status: 200 } : { status: 404 }), RTT_MS);
    });

    const emVista = new Map();
    const gerente = {
        sourceId: 'streetViewPointsSource',
        _timers: {},
        _inViewTiles: { getTileById: (id) => emVista.get(id) },
        async _loadTile(tile, id, estadoAnterior) {
            const resposta = await servidor();
            const dado = resposta.status === 404 ? null : { maxAgeS: MAX_AGE_S };
            if (dado) tile.setExpiryData(dado);
            tile.loadVectorData(dado);
            this._tileLoaded(tile, id, estadoAnterior);
        },
        _tileLoaded(tile, id, estadoAnterior) {
            if (estadoAnterior === 'expired') tile.refreshedUponExpiration = true;
            this._setTileReloadTimer(id, tile);
            for (const fn of [...ouvintes]) fn({ sourceId: this.sourceId, tile, dataType: 'source' });
        },
        adicionar(id) {
            const tile = new Tile(id);
            emVista.set(id, tile);
            return this._loadTile(tile, id, tile.state);
        },
    };
    gerente._setTileReloadTimer = compilar(ARMAR.params, ARMAR.corpo);
    gerente._clearTileReloadTimer = compilar(DESARMAR.params, DESARMAR.corpo);
    gerente._reloadTile = compilar(RECARREGAR.params, RECARREGAR.corpo, { assincrono: true });

    if (guarda) {
        installTileExpiryGuard(mapa, { onTileLoad: (carga) => estado.cargas.push(carga) });
    }
    return { Tile, gerente, estado, emVista, ids };
}

/** Carrega os tiles com acesso, passa trinta segundos e retira o acesso, como uma revogacao. */
async function servirERecusar(c) {
    for (const id of c.ids) c.gerente.adicionar(id);
    await vi.advanceTimersByTimeAsync(30_000);
    c.estado.acesso = false;
    return c.estado.pedidos.length;
}

describe('o tile servido e depois recusado, com o codigo do MapLibre dirigindo', () => {
    beforeEach(() => {
        vi.useFakeTimers({ now: new Date('2026-09-21T16:37:00Z') });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('CONTROLE DO INSTRUMENTO: SEM a guarda, o tile recusado e pedido a cada ida e volta', async () => {
        const c = cenario({ guarda: false });
        const antes = await servirERecusar(c);
        expect(antes).toBe(1);

        // O timer de 60 s vence, a atualizacao volta 404, e a validade vencida rearma em zero.
        await vi.advanceTimersByTimeAsync(40_000);
        const depois = c.estado.pedidos.length - antes;
        // ~476 em dez segundos com 21 ms por volta. O piso e largo de proposito: o que se prova e
        // que o duble, rodando o timer do proprio MapLibre, VE o laco do incidente.
        expect(depois).toBeGreaterThan(100);
    });

    it('COM a guarda: depois da recusa, UM pedido por tile e mais nenhum em dez minutos', async () => {
        // Os quatro tiles do minimapa oculto em 0,0, que o log do incidente nomeia.
        const ids = ['12/2047/2047', '12/2047/2048', '12/2048/2047', '12/2048/2048'];
        const c = cenario({ guarda: true, ids });
        const antes = await servirERecusar(c);
        expect(antes).toBe(4);

        await vi.advanceTimersByTimeAsync(10 * UM_MINUTO);
        // A atualizacao agendada de cada tile sai (e o servidor a recusa); depois dela, nada.
        expect(c.estado.pedidos.length - antes).toBe(4);
        for (const id of ids) expect(c.emVista.get(id).dado).toBeNull();

        // E cada recusa foi relatada como carga SEM dado, que e o que o controle do 360 le.
        const recusas = c.estado.cargas.filter((carga) => carga.withoutData === true);
        expect(recusas).toHaveLength(4);
        expect(recusas.every((carga) => carga.sourceId === 'streetViewPointsSource')).toBe(true);
    });

    it('a guarda NAO mexe na atualizacao saudavel: um pedido por minuto, igual com e sem ela', async () => {
        const contar = async (guarda) => {
            const c = cenario({ guarda });
            c.gerente.adicionar(c.ids[0]);
            await vi.advanceTimersByTimeAsync(10 * UM_MINUTO);
            return c.estado.pedidos.length;
        };
        const sem = await contar(false);
        const com = await contar(true);
        expect(sem).toBeGreaterThanOrEqual(10);
        expect(sem).toBeLessThanOrEqual(11);
        expect(com).toBe(sem);
    });

    it('o tile que so VENCEU (fora de vista, com dado) ganha UMA atualizacao, e o 200 renova', async () => {
        const c = cenario({ guarda: true });
        c.gerente.adicionar(c.ids[0]);
        await vi.advanceTimersByTimeAsync(RTT_MS + 1);
        const tile = c.emVista.get(c.ids[0]);
        // Simula o tile que ficou no cache fora de vista com o timer atrasado: a validade venceu
        // e ninguem o atualizou. `_addTile` o devolve rearmando o timer, como aqui.
        c.gerente._clearTileReloadTimer(c.ids[0]);
        await vi.advanceTimersByTimeAsync(2 * UM_MINUTO);
        const antes = c.estado.pedidos.length;

        c.gerente._setTileReloadTimer(c.ids[0], tile);
        await vi.advanceTimersByTimeAsync(RTT_MS + 5);
        expect(c.estado.pedidos.length - antes).toBe(1);
        // O 200 renovou a validade: o proximo pedido e o de um minuto depois, nao antes.
        await vi.advanceTimersByTimeAsync(UM_MINUTO - 1000);
        expect(c.estado.pedidos.length - antes).toBe(1);
        await vi.advanceTimersByTimeAsync(2000);
        expect(c.estado.pedidos.length - antes).toBe(2);
    });

    it('o backoff do proprio MapLibre passa intacto, e o vencido sem dado NAO rearma', () => {
        const Sem = classeDeTile();
        Sem.prototype.getExpiryTimeout = compilar([], EXPIRY.corpo);
        const Com = classeDeTile();
        Com.prototype.getExpiryTimeout = compilar([], EXPIRY.corpo);
        expect(guardTilePrototype(Com.prototype)).toBe(true);

        const backoff = (T) => Object.assign(new T('x'), { expirationTime: 1, expiredRequestCount: 3 });
        expect(new Com('x').getExpiryTimeout()).toBeUndefined();
        expect(backoff(Com).getExpiryTimeout()).toBe(backoff(Sem).getExpiryTimeout());
        expect(backoff(Com).getExpiryTimeout()).toBe(4000);

        // O estado exato do incidente: carregado SEM dado, validade vencida, contagem zero.
        const vencido = (T) => {
            const t = new T('x');
            t.loadVectorData(null);
            t.expirationTime = Date.now() - 5000;
            return t;
        };
        expect(vencido(Sem).getExpiryTimeout()).toBeLessThan(0);
        expect(vencido(Com).getExpiryTimeout()).toBeUndefined();
    });
});

// ============================================================
// 3. A instalacao
// ============================================================

describe('a instalacao da guarda', () => {
    function mapaComOuvintes() {
        const ouvintes = new Set();
        return {
            ouvintes,
            on: (tipo, fn) => { if (tipo === 'sourcedata') ouvintes.add(fn); },
            off: (tipo, fn) => { if (tipo === 'sourcedata') ouvintes.delete(fn); },
            emitir: (evento) => { for (const fn of [...ouvintes]) fn(evento); },
        };
    }

    it('le o prototipo do primeiro tile, embrulha UMA vez, e sem ouvinte de carga a escuta sai', () => {
        const Tile = classeDeTile();
        const mapaA = mapaComOuvintes();
        const mapaB = mapaComOuvintes();
        installTileExpiryGuard(mapaA);
        installTileExpiryGuard(mapaB);

        // Evento sem tile (a carga do estilo, por exemplo) nao decide nada e nao tira a escuta.
        mapaA.emitir({ sourceId: 'osm' });
        expect(mapaA.ouvintes.size).toBe(1);

        mapaA.emitir({ sourceId: 'osm', tile: new Tile('a') });
        const embrulhado = Tile.prototype.getExpiryTimeout;
        mapaB.emitir({ sourceId: 'osm', tile: new Tile('b') });
        expect(Tile.prototype.getExpiryTimeout).toBe(embrulhado);
        expect(mapaA.ouvintes.size).toBe(0);
        expect(mapaB.ouvintes.size).toBe(0);
    });

    it('com ouvinte de carga ela fica, e so relata o que sabe ler', () => {
        const Tile = classeDeTile();
        const mapa = mapaComOuvintes();
        const cargas = [];
        const parar = installTileExpiryGuard(mapa, { onTileLoad: (c) => cargas.push(c) });

        // O PRIMEIRO tile da pagina carregou antes de o prototipo ser conhecido: sem registro.
        mapa.emitir({ sourceId: 'fotos_linha', tile: new Tile('primeiro') });
        expect(cargas).toEqual([]);

        const recusado = new Tile('r');
        recusado.loadVectorData(null);
        const servido = new Tile('s');
        servido.loadVectorData({ featureIndex: {} });
        mapa.emitir({ sourceId: 'fotos_linha', tile: recusado });
        mapa.emitir({ sourceId: 'fotos_linha', tile: servido });
        expect(cargas).toEqual([
            { sourceId: 'fotos_linha', withoutData: true },
            { sourceId: 'fotos_linha', withoutData: false },
        ]);
        expect(recusado[LOADED_WITHOUT_DATA]).toBe(true);

        parar();
        expect(mapa.ouvintes.size).toBe(0);
    });

    it('prototipo sem os dois metodos nao e tocado, e Object.prototype muito menos', () => {
        expect(guardTilePrototype(Object.prototype)).toBe(false);
        expect(Object.prototype.getExpiryTimeout).toBeUndefined();
        const metade = { getExpiryTimeout() { return 1; } };
        expect(guardTilePrototype(metade)).toBe(false);
        expect(guardTilePrototype(null)).toBe(false);
        // E o mapa que nao e mapa devolve um `parar` inerte em vez de estourar na montagem.
        expect(() => installTileExpiryGuard(null)()).not.toThrow();
    });

    it('isRunOutTimeout: so numero nao positivo esta vencido', () => {
        expect(isRunOutTimeout(undefined)).toBe(false);
        expect(isRunOutTimeout(null)).toBe(false);
        expect(isRunOutTimeout(1)).toBe(false);
        expect(isRunOutTimeout(Infinity)).toBe(false);
        expect(isRunOutTimeout(0)).toBe(true);
        expect(isRunOutTimeout(-0)).toBe(true);
        expect(isRunOutTimeout(-5)).toBe(true);
        expect(isRunOutTimeout(NaN)).toBe(true);
        expect(isRunOutTimeout(-Infinity)).toBe(true);
    });
});
