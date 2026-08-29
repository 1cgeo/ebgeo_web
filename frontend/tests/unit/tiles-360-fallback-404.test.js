// Path: tests/unit/tiles-360-fallback-404.test.js
/**
 * @fileoverview O tratamento de 404 do `tiles.json` no carregador de tiles do 360.
 *
 * TILES-ONLY desde 2026-08-29. Antes, uma foto sem piramide caia num fallback para
 * `image?quality=preview|full`; a rota de imagem inteira foi removida e o fallback
 * saiu junto (visualizador e estudio). O que este arquivo cobre agora e so a metade
 * que continua viva: como o CARREGADOR reage ao 404 do `tiles.json`.
 *
 * O MODO DE FALHA E MUDO, e por isso o teste existe. Se o carregador parar de anexar
 * o STATUS ao erro, ou nao distinguir "a rede caiu" de "esta foto nao tem piramide",
 * a panoramica simplesmente nao pinta: nao ha excecao que reprove outro teste.
 *
 * O QUE ESTE ARQUIVO NAO COBRE, e fica dito em vez de fingido: o desenho em si.
 * A composicao do canvas de tiles pede WebGL e um `document` de verdade, que o
 * ambiente `node` do vitest nao tem. O que da para medir sem GPU e a DECISAO: o
 * carregador separa "nao existe piramide" de "a rede caiu", nao gasta pedido depois
 * do 404, e pede o descritor na base da API, nao na origem da pagina.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTileLoader } from '@js/street_view_tool/tile-loader.js';
import config from '@js/config.js';

/** Foto real do museu_cms, o unico projeto com piramide no servico. */
const UUID_COM_PIRAMIDE = '00374597-0d4c-4a2d-9bf2-639af7f6c47c';

/** Foto de um dos 28 projetos sem piramide, que e o caso comum. */
const UUID_SEM_PIRAMIDE = '11111111-2222-4333-8444-555555555555';

/** As URLs que o carregador pediu, na ordem. */
let pedidas;

// A BASE DA API AQUI NASCE VAZIA, e essa é a diferença deste pacote para o monolito
// de onde o teste veio. Lá `config.js` trazia `streetView360.serviceUrl` como valor
// estático, presente no load do módulo; aqui `config.js` é só o SHAPE, e quem o preenche
// é `applyRuntimeConfig` depois do `GET /api/config` do boot. Sem esta hidratação o teste
// mediria `undefined/photos/...`, que não é o que roda em lugar nenhum.
//
// O valor é o mesmo default do servidor (`SV360_SERVICE_URL` em `backend/src/config.js`),
// e é RELATIVO de propósito: é assim que ele viaja no `/api/config`, e o carregador o
// resolve contra `location.href`. Por isso as asserções abaixo esperam a URL ABSOLUTA.
const BASE_DA_API = '/api/v1/sv360';

beforeEach(() => {
    pedidas = [];
    config.streetView360.serviceUrl = BASE_DA_API;
    // `location` nao existe no ambiente `node` do vitest, e o carregador resolve
    // o descritor contra ela. A origem aqui e de proposito DIFERENTE da base da
    // API: e assim em desenvolvimento, com a pagina numa porta e o servico na
    // 8081, e e o que faz o teste da base valer alguma coisa.
    vi.stubGlobal('location', {
        href: 'http://localhost:5173/index.html',
        origin: 'http://localhost:5173',
        pathname: '/index.html'
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

/**
 * Instala um fetch falso que responde o status pedido no `tiles.json`.
 *
 * O CORPO NAO E DECORACAO. O servico responde o 404 com um JSON de erro, e um
 * corpo vazio aqui deixaria passar o cliente que ignora o status: ele morreria
 * no `JSON.parse` de string vazia e o teste veria uma rejeicao qualquer,
 * dando-a por boa. Com corpo valido, so o cliente que OLHA o status rejeita
 * pelo motivo certo.
 * @param {number} status - Status HTTP do descritor.
 * @returns {import('vitest').Mock} O mock, para contar chamadas.
 */
function fetchQueResponde(status) {
    const falso = vi.fn(async (url) => {
        pedidas.push(String(url));
        return new Response(JSON.stringify({ error: 'pyramid not found' }), {
            status,
            headers: { 'content-type': 'application/json' }
        });
    });
    vi.stubGlobal('fetch', falso);
    return falso;
}

describe('tiles.json 404: o caminho normal, e nao a excecao', () => {
    it('sobe o erro com o STATUS anexado, e nao so uma mensagem', () => {
        // REPROVA `throw new Error('tiles.json falhou')`. Quem chama precisa
        // separar "esta foto nao tem piramide" de "a rede caiu" SEM ler a
        // mensagem, que e texto e muda de lugar. Sem o status, ou o viewer
        // enche o console de aviso em 28 dos 29 projetos, ou cala a boca
        // tambem quando o servico realmente cai.
        fetchQueResponde(404);
        const carregador = createTileLoader({});

        return carregador.carregarFoto(UUID_SEM_PIRAMIDE).then(
            () => expect.unreachable('o 404 tem de rejeitar'),
            (erro) => {
                expect(erro).toBeInstanceOf(Error);
                expect(erro.status).toBe(404);
            }
        );
    });

    it('para no descritor: nenhum tile, nenhuma imagem depois do 404', async () => {
        // REPROVA o carregador que segue baixando o preview e o nivel de fundo
        // mesmo sem descritor. Em 28 de 29 projetos isso seriam dois pedidos
        // perdidos por foto, disputando a rede com o `full` que a tela espera:
        // o porte deixaria a navegacao MAIS lenta, que e o oposto do motivo.
        const falso = fetchQueResponde(404);
        const carregador = createTileLoader({});

        await expect(carregador.carregarFoto(UUID_SEM_PIRAMIDE)).rejects.toThrow();

        expect(falso).toHaveBeenCalledTimes(1);
        expect(pedidas[0]).toContain('/tiles.json');
        expect(pedidas.some(u => u.includes('/tiles/'))).toBe(false);
        expect(pedidas.some(u => u.includes('quality='))).toBe(false);
    });

    it('pede o descritor na base da API, e nao na origem da pagina', async () => {
        // REPROVA deduzir a raiz de `location`, que era o desenho do
        // ebgeo_360: la a interface de calibracao e servida pelo PROPRIO
        // servico. No ebgeo_web a pagina abre em 5173 e a API responde em 8081,
        // entao a deducao apontaria para o ebgeo_web e TODO tile viraria 404.
        // O sintoma seria foto sem detalhe com o console limpo, porque o
        // carregador so anota falha de tile no log.
        fetchQueResponde(404);
        const carregador = createTileLoader({});

        await expect(carregador.carregarFoto(UUID_COM_PIRAMIDE)).rejects.toThrow();

        // A base é relativa, então o carregador a resolve contra `location.href`. O que
        // importa é que o CAMINHO saiu da base da API, e não que a URL seja crua.
        expect(pedidas[0]).toBe(
            new URL(`${BASE_DA_API}/photos/${UUID_COM_PIRAMIDE}/tiles.json`, location.href).href
        );
        expect(pedidas[0]).toContain(`${BASE_DA_API}/photos/`);
    });

    it('distingue a rede caida da foto sem piramide', async () => {
        // REPROVA transformar toda falha em 404. Um 500 ou um 503 e defeito do
        // servico e merece barulho; o 404 e rotina e tem de ser silencioso. Com
        // os dois iguais, o dia em que o servico de tiles quebrar passa
        // despercebido, porque o full continua chegando.
        for (const status of [500, 503, 403]) {
            fetchQueResponde(status);
            const carregador = createTileLoader({});
            await carregador.carregarFoto(UUID_COM_PIRAMIDE).then(
                () => expect.unreachable(`HTTP ${status} tem de rejeitar`),
                (erro) => expect(erro.status).toBe(status)
            );
        }
    });

    it('recusa um descritor de schema desconhecido, e SEM status', async () => {
        // O outro jeito de nao ter piramide utilizavel: o servico responde 200
        // com um `tiles.json` de outra versao. REPROVA o cliente que ignora
        // `schemaVersion` e compoe o que vier: ele leria `levels` com outro
        // significado e pediria tiles que nao existem, ou pintaria a grade
        // trocada, sem nunca falhar.
        //
        // E o erro sai SEM `status` de proposito. E assim que quem chama
        // distingue este caso do 404: aqui o servico mudou por baixo e merece
        // barulho no console, enquanto o 404 e rotina e tem de ser silencioso.
        vi.stubGlobal('fetch', vi.fn(async (url) => {
            pedidas.push(String(url));
            return new Response(JSON.stringify({ schemaVersion: 2, levels: [] }), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            });
        }));

        const carregador = createTileLoader({});
        await carregador.carregarFoto(UUID_COM_PIRAMIDE).then(
            () => expect.unreachable('schema desconhecido tem de rejeitar'),
            (erro) => {
                expect(erro).toBeInstanceOf(Error);
                expect(erro.message).toContain('schemaVersion');
                expect(erro.status).toBeUndefined();
            }
        );
        // E para no descritor, sem gastar pedido com tile de grade que nao entendeu.
        expect(pedidas).toHaveLength(1);
    });

    it('aborta a sonda da foto anterior ao trocar de foto', async () => {
        // A navegacao do 360 e clicar de foto em foto, e o descritor da
        // anterior fica em voo. REPROVA o carregador sem abort: a sonda de A
        // resolveria DEPOIS da de B, e a continuacao de A sobrescreveria
        // descritor, niveis e canvas no formato de A enquanto os tiles de B
        // chegavam por cima. Nada disso levanta erro; a tela so mistura duas
        // fotos. Este e o par do 404, porque as duas cargas terminam no mesmo
        // ramo de quem chama.
        const sinais = [];
        vi.stubGlobal('fetch', vi.fn(async (url, opcoes) => {
            pedidas.push(String(url));
            sinais.push(opcoes?.signal);
            // A primeira sonda so termina se alguem abortar. E o caso real: a
            // foto A ainda esta na rede quando o usuario clica na B.
            if (pedidas.length === 1) {
                return new Promise((_, rejeitar) => {
                    opcoes.signal.addEventListener('abort', () => {
                        rejeitar(new DOMException('Aborted', 'AbortError'));
                    });
                });
            }
            return new Response(null, { status: 404 });
        }));

        const carregador = createTileLoader({});
        const cargaA = carregador.carregarFoto(UUID_COM_PIRAMIDE).catch(e => e);
        const cargaB = carregador.carregarFoto(UUID_SEM_PIRAMIDE).catch(e => e);

        expect(sinais).toHaveLength(2);
        expect(sinais[0].aborted).toBe(true);
        expect(sinais[1].aborted).toBe(false);
        expect((await cargaA).name).toBe('AbortError');
        // E a carga nova segue seu proprio caminho: 404, com o status na mao,
        // que e o sinal para cair no full.
        expect((await cargaB).status).toBe(404);
    });
});
