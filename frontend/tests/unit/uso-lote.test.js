// Path: tests/unit/uso-lote.test.js

/**
 * @fileoverview O ACUMULADOR DE USO dirigido de verdade: a porteira do catálogo, a contagem, a
 * forma EXATA do corpo, os dois transportes, o descarte na falha e os três gatilhos de descarga.
 *
 * ELE É DIRIGIDO PELOS MANIPULADORES REAIS, e não pelas funções internas: um teste que chamasse
 * `descarregarUso()` à mão provaria que a função monta um corpo e nada sobre o `pagehide` ter sido
 * assinado — que é a metade que de fato entrega o lote de uma sessão curta. Daí o alvo e o
 * documento de mentira, com `addEventListener` de verdade.
 *
 * OS QUATRO CONTROLES NEGATIVOS, isto é, o que fica vermelho se o código voltar ao óbvio. Os
 * quatro foram RODADOS (reverter a peça, ver o vermelho, restaurar):
 *
 *   1. **A PORTEIRA APAGADA.** Trocar a guarda de `registrar` por um acúmulo incondicional (que é
 *      o que se escreve sem pensar) faz um evento inventado entrar no corpo. O caso mede as duas
 *      metades: o descarte E o contador, porque um descarte silencioso é o mesmo silêncio que a
 *      telemetria existe para acabar.
 *   2. **O CORPO COM CHAVE A MAIS.** Devolver o objeto interno em vez de montar o corpo campo a
 *      campo passa `prop: ''` e `vitais: null` para o Joi, que responde 422 e apaga o lote inteiro.
 *      A asserção é sobre o CONJUNTO de chaves, e não sobre valores: é a única forma de uma chave
 *      a mais ficar vermelha.
 *   3. **OS DOIS RAMOS DE RECUSA COLAPSADOS NUM SÓ.** Este é o item que mudou depois da revisão, e
 *      ele erra nos DOIS sentidos, um por ramo. Repor SEMPRE produz contagem dupla no ramo
 *      incerto (um `fetch` com `keepalive` pode ter chegado e falhado só na leitura da resposta);
 *      descartar SEMPRE joga fora uso real no ramo certo (`sendBeacon` devolvendo o literal
 *      `false` é o navegador dizendo, de forma síncrona, que NÃO enfileirou nada). São três casos,
 *      e cada um mede um sentido: o `false` repõe e sai de novo, a promessa rejeitada não repõe, e
 *      a reposição MESCLA com o que chegou entre a drenagem e a resposta.
 *   4. **O TIMER SEM GUARDA DE VAZIO.** Um `setInterval` que descarregue incondicionalmente manda
 *      um pedido a cada trinta segundos para toda aba aberta e parada. O caso avança o relógio com
 *      o acumulador vazio e exige zero envios.
 *
 *      **E AQUI HÁ UMA ARMADILHA DE CONTROLE NEGATIVO, medida:** o vazio é barrado DUAS vezes, por
 *      `contagens.size === 0` e por `corpo.eventos.length === 0`, e **cada metade sozinha já
 *      basta**. Reverter só a primeira deixa a suíte VERDE, e uma declaração que mandasse conferir
 *      só ela seria um controle negativo que não discrimina — que é exatamente a classe de coisa
 *      que este cabeçalho existe para não ter. As duas foram revertidas juntas para ver o
 *      vermelho, e o par foi revertido em separado para descobrir isto.
 *
 * O `sendBeacon` É PREFERIDO E O `fetch` É A RESERVA, e os dois casos são separados: o primeiro
 * prova que o `Blob` viaja com `type: 'application/json'` (sem ele o `express.json()` não analisa
 * o corpo e o lote chega vazio ao servidor, que é uma falha invisível dos dois lados).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    INTERVALO_PADRAO_MS,
    MAX_LINHAS_DO_LOTE,
    MAX_RELEASE,
    ROTA_DE_USO,
    configurarUso,
    descarregarUso,
    desinstalarUso,
    estadoDoUso,
    familiaDoNavegador,
    montarCorpoDeUso,
    registrarUso,
} from '@js/session/uso-lote.js';
import { EventoDeUso } from '@js/session/eventos-de-uso.js';

/** Um alvo de mentira com o mínimo que o módulo usa, mais os espiões. */
function criarAlvo({ comBeacon = false } = {}) {
    const ouvintes = new Map();
    const timers = [];
    const enviados = [];
    const beacons = [];
    const alvo = {
        addEventListener(nome, fn) {
            if (!ouvintes.has(nome)) ouvintes.set(nome, new Set());
            ouvintes.get(nome).add(fn);
        },
        removeEventListener(nome, fn) {
            ouvintes.get(nome)?.delete(fn);
        },
        setInterval(fn, ms) {
            timers.push({ fn, ms });
            return timers.length;
        },
        clearInterval(id) {
            timers[id - 1] = null;
        },
        fetch(url, init) {
            enviados.push({ url, init });
            return Promise.resolve({ ok: true, status: 204 });
        },
        Blob: class BlobFalso {
            constructor(partes, opcoes) {
                this.partes = partes;
                this.type = opcoes?.type ?? '';
            }
        },
        navigator: comBeacon
            ? {
                userAgent: 'Mozilla/5.0 Chrome/130.0 Safari/537.36',
                sendBeacon(url, blob) {
                    beacons.push({ url, blob });
                    return true;
                },
            }
            : { userAgent: 'Mozilla/5.0 Chrome/130.0 Safari/537.36' },
        disparar(nome) {
            for (const fn of [...(ouvintes.get(nome) ?? [])]) fn();
        },
        tick() {
            for (const t of timers) t?.fn();
        },
        ouvintesDe: (nome) => ouvintes.get(nome)?.size ?? 0,
        enviados,
        beacons,
    };
    return alvo;
}

/** Um `document` de mentira, com o estado de visibilidade que o gatilho lê. */
function criarDocumento() {
    const ouvintes = new Map();
    return {
        visibilityState: 'visible',
        addEventListener(nome, fn) {
            if (!ouvintes.has(nome)) ouvintes.set(nome, new Set());
            ouvintes.get(nome).add(fn);
        },
        removeEventListener(nome, fn) {
            ouvintes.get(nome)?.delete(fn);
        },
        disparar(nome) {
            for (const fn of [...(ouvintes.get(nome) ?? [])]) fn();
        },
        ouvintesDe: (nome) => ouvintes.get(nome)?.size ?? 0,
    };
}

afterEach(() => {
    desinstalarUso();
});

describe('familiaDoNavegador — cinco valores, e a ordem dos ramos é o contrato', () => {
    it('reconhece as quatro famílias pelo token próprio', () => {
        expect(familiaDoNavegador('Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36')).toBe('chrome');
        expect(familiaDoNavegador('Mozilla/5.0 Firefox/131.0')).toBe('firefox');
        expect(familiaDoNavegador('Mozilla/5.0 Version/17.0 Safari/605.1.15')).toBe('safari');
    });

    it('o Edge NÃO cai em chrome, e o Chrome NÃO cai em safari', () => {
        // ESTE É O CASO INTEIRO: os dois se anunciam como o vizinho, e testar na ordem alfabética
        // classificaria todo Edge como Chrome e todo Chrome como Safari, sem erro nenhum.
        expect(familiaDoNavegador(
            'Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
        )).toBe('edge');
        expect(familiaDoNavegador(
            'Mozilla/5.0 CriOS/130.0 Mobile/15E148 Safari/604.1',
        )).toBe('chrome');
    });

    it('o desconhecido e o que não é texto viram `outro`, sem lançar', () => {
        expect(familiaDoNavegador('curl/8.4.0')).toBe('outro');
        expect(familiaDoNavegador('')).toBe('outro');
        expect(familiaDoNavegador(null)).toBe('outro');
        expect(familiaDoNavegador(undefined)).toBe('outro');
        expect(familiaDoNavegador({ toString() { throw new Error('hostil'); } })).toBe('outro');
    });

    it('nunca devolve mais de 40 caracteres (o teto da coluna)', () => {
        for (const ua of ['Chrome/1', 'Edg/1', 'Firefox/1', 'Safari/1', 'x'.repeat(5000)]) {
            expect(familiaDoNavegador(ua).length).toBeLessThanOrEqual(40);
        }
    });
});

describe('montarCorpoDeUso — a forma EXATA do corpo', () => {
    const BASE = {
        sessaoId: '11111111-2222-4333-8444-555555555555',
        pagina: 'mapa',
        inicio: 1_000,
        ultimoSinal: 2_000,
        eventos: [{ evento: EventoDeUso.PAGINA_VISTA, prop: '', contagem: 1 }],
    };

    it('o corpo mínimo tem as CINCO chaves obrigatórias, e nenhuma a mais', () => {
        // O TÍTULO DIZIA SEIS e o corpo asseria cinco. Um título que promete mais do que o caso
        // mede é pior que um título vago: quem lê a suíte para saber o que está preso conta a
        // sexta como coberta.
        const { corpo } = montarCorpoDeUso(BASE);
        expect(Object.keys(corpo).sort()).toEqual([
            'eventos', 'inicio', 'pagina', 'sessaoId', 'ultimoSinal',
        ].sort());
        expect(Object.keys(corpo.eventos[0]).sort()).toEqual(['contagem', 'evento']);
    });

    it('os opcionais entram quando existem, e a `prop` vazia NÃO vira chave', () => {
        const { corpo } = montarCorpoDeUso({
            ...BASE,
            release: ' 1.0.0+abc1234 ',
            navegador: 'chrome',
            erros: 3,
            vitais: { lcpMs: 1200.7, inpMs: 88.2, cls: 0.12345, tempoAteMapaMs: 2400.4 },
            eventos: [
                { evento: EventoDeUso.FERRAMENTA_ATIVADA, prop: 'point', contagem: 4 },
                { evento: EventoDeUso.PAGINA_VISTA, prop: '', contagem: 1 },
            ],
        });
        expect(corpo.release).toBe('1.0.0+abc1234');
        expect(corpo.navegador).toBe('chrome');
        expect(corpo.erros).toBe(3);
        // ARREDONDAMENTO DECLARADO: os três de tempo viram inteiro (a coluna é inteira), e o CLS
        // guarda três casas, porque ele é uma razão abaixo de 1 e arredondá-lo o zeraria.
        expect(corpo.vitais).toEqual({ lcpMs: 1201, inpMs: 88, cls: 0.123, tempoAteMapaMs: 2400 });
        expect(Object.keys(corpo.eventos[0]).sort()).toEqual(['contagem', 'evento', 'prop']);
        expect(Object.keys(corpo.eventos[1]).sort()).toEqual(['contagem', 'evento']);
    });

    it('a `release` é aparada no teto da coluna, e o `navegador` também', () => {
        // Os dois são opcionais e dispensáveis, e um valor longo custaria o lote INTEIRO num
        // 422 por causa deles.
        const { corpo } = montarCorpoDeUso({
            ...BASE, release: 'x'.repeat(500), navegador: 'y'.repeat(500),
        });
        expect(corpo.release).toHaveLength(MAX_RELEASE);
        expect(corpo.navegador).toHaveLength(40);
    });

    it('opcional AUSENTE é ausente, e nunca `null` (o Joi recusa `null` num opcional)', () => {
        const { corpo } = montarCorpoDeUso({
            ...BASE, release: null, navegador: '', erros: null, vitais: {},
        });
        expect('release' in corpo).toBe(false);
        expect('navegador' in corpo).toBe(false);
        expect('erros' in corpo).toBe(false);
        expect('vitais' in corpo).toBe(false);
    });

    it('as linhas saem da maior para a menor, e o excedente do teto é CONTADO', () => {
        const eventos = [];
        for (let i = 0; i < MAX_LINHAS_DO_LOTE + 5; i++) {
            eventos.push({ evento: EventoDeUso.FERRAMENTA_ATIVADA, prop: `t${i}`, contagem: i + 1 });
        }
        const { corpo, truncados } = montarCorpoDeUso({ ...BASE, eventos });
        expect(corpo.eventos).toHaveLength(MAX_LINHAS_DO_LOTE);
        expect(truncados).toBe(5);
        expect(corpo.eventos[0].contagem).toBeGreaterThan(corpo.eventos[1].contagem);
        // O QUE FICA DE FORA É O QUE MENOS ACONTECEU: sem a ordenação, o corte seria arbitrário.
        const menores = corpo.eventos.map((l) => l.contagem);
        expect(Math.min(...menores)).toBe(6);
    });

    it('evento fora do catálogo e contagem não positiva não viram linha', () => {
        const { corpo } = montarCorpoDeUso({
            ...BASE,
            eventos: [
                { evento: 'inventado.aqui', contagem: 9 },
                { evento: EventoDeUso.PAGINA_VISTA, contagem: 0 },
                { evento: EventoDeUso.PAGINA_VISTA, contagem: -1 },
                { evento: EventoDeUso.MEDICAO_ABERTA, contagem: 2 },
            ],
        });
        expect(corpo.eventos).toEqual([{ evento: 'medicao.aberta', contagem: 2 }]);
    });
});

describe('configurarUso — a porteira, a contagem e os gatilhos', () => {
    let alvo;
    let documento;

    beforeEach(() => {
        alvo = criarAlvo();
        documento = criarDocumento();
    });

    /** @param {Object} [extra] @returns {Array<Object>} os corpos que o transporte viu */
    function instalar(extra = {}) {
        const corpos = [];
        configurarUso({
            pagina: 'mapa',
            sessaoId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            agora: () => 5_000,
            resolverBase: () => 'http://bancada/api/v1',
            enviar: (corpo, url) => {
                corpos.push({ corpo, url });
                return true;
            },
            alvo,
            documento,
            ...extra,
        });
        return corpos;
    }

    it('a instalação é IDEMPOTENTE: a segunda chamada não dobra os gatilhos', () => {
        instalar();
        expect(alvo.ouvintesDe('pagehide')).toBe(1);
        expect(documento.ouvintesDe('visibilitychange')).toBe(1);
        const segunda = configurarUso({ pagina: 'mapa', alvo, documento });
        expect(segunda.instalada).toBe(false);
        expect(alvo.ouvintesDe('pagehide')).toBe(1);
        expect(documento.ouvintesDe('visibilitychange')).toBe(1);
    });

    it('um `sessaoId` fora da forma de UUID RECUSA a instalação, e conta', () => {
        // O MODO DE FALHA QUE ISTO FECHA É SILENCIOSO: o campo é obrigatório no Joi da rota,
        // então TODO lote daquela página receberia 422; e `sendBeacon` devolve `true` de
        // qualquer forma (ele fala da FILA do navegador, não da resposta), de modo que
        // `lotesEnviados` subiria a cada trinta segundos sobre lotes que nunca chegaram.
        const antes = estadoDoUso().falhasInternas;
        const r = configurarUso({ pagina: 'mapa', sessaoId: 'nao-e-uuid', alvo, documento });
        expect(r.instalada).toBe(false);
        expect(alvo.ouvintesDe('pagehide')).toBe(0);
        expect(estadoDoUso().falhasInternas).toBe(antes + 1);
        expect(registrarUso(EventoDeUso.PAGINA_VISTA)).toBe(false);
    });

    it('o id vazio (armazenamento bloqueado) também recusa', () => {
        expect(configurarUso({ pagina: 'mapa', sessaoId: '', alvo, documento }).instalada)
            .toBe(false);
        expect(configurarUso({ pagina: 'mapa', alvo, documento }).instalada).toBe(false);
    });

    it('uma PÁGINA fora das quatro RECUSA a instalação, em vez de mandar um lote que o servidor apaga', () => {
        const r = configurarUso({ pagina: 'relatorio.html', alvo, documento });
        expect(r.instalada).toBe(false);
        expect(alvo.ouvintesDe('pagehide')).toBe(0);
        expect(registrarUso(EventoDeUso.PAGINA_VISTA)).toBe(false);
    });

    it('conta o que é válido e DESCARTA o que não é, contando o descarte', () => {
        const corpos = instalar();
        const antes = estadoDoUso().descartados;

        expect(registrarUso(EventoDeUso.PAGINA_VISTA)).toBe(true);
        expect(registrarUso(EventoDeUso.FERRAMENTA_ATIVADA, 'point')).toBe(true);
        expect(registrarUso(EventoDeUso.FERRAMENTA_ATIVADA, 'point')).toBe(true);
        // Evento fora do catálogo.
        expect(registrarUso('inventado.aqui')).toBe(false);
        // `prop` fora da lista fechada do evento.
        expect(registrarUso(EventoDeUso.PDF_EXPORTADO, 'panfleto')).toBe(false);
        // `prop` num evento que não aceita nenhuma.
        expect(registrarUso(EventoDeUso.MEDICAO_ABERTA, 'distancia')).toBe(false);
        // `prop` livre fora da FORMA.
        expect(registrarUso(EventoDeUso.FERRAMENTA_ATIVADA, 'Ponto Novo')).toBe(false);

        expect(estadoDoUso().descartados - antes).toBe(4);

        descarregarUso({ motivo: 'teste' });
        expect(corpos).toHaveLength(1);
        expect(corpos[0].corpo.eventos).toEqual([
            { evento: 'ferramenta.ativada', prop: 'point', contagem: 2 },
            { evento: 'pagina.vista', contagem: 1 },
        ]);
    });

    it('a URL é a base resolvida mais a rota', () => {
        const corpos = instalar();
        registrarUso(EventoDeUso.PAGINA_VISTA);
        descarregarUso();
        expect(corpos[0].url).toBe(`http://bancada/api/v1${ROTA_DE_USO}`);
    });

    it('descarrega no `pagehide`', () => {
        const corpos = instalar();
        registrarUso(EventoDeUso.PAGINA_VISTA);
        alvo.disparar('pagehide');
        expect(corpos).toHaveLength(1);
    });

    it('descarrega no `visibilitychange` SÓ quando a aba fica escondida', () => {
        const corpos = instalar();
        registrarUso(EventoDeUso.PAGINA_VISTA);
        documento.visibilityState = 'visible';
        documento.disparar('visibilitychange');
        expect(corpos).toHaveLength(0);
        documento.visibilityState = 'hidden';
        documento.disparar('visibilitychange');
        expect(corpos).toHaveLength(1);
    });

    it('o timer descarrega no intervalo, e NÃO gasta pedido com o acumulador vazio', () => {
        const corpos = instalar({ intervaloMs: INTERVALO_PADRAO_MS });
        alvo.tick();
        expect(corpos, 'aba parada não pode mandar lote').toHaveLength(0);
        registrarUso(EventoDeUso.PAGINA_VISTA);
        alvo.tick();
        expect(corpos).toHaveLength(1);
        alvo.tick();
        expect(corpos, 'o lote já drenado não pode sair de novo').toHaveLength(1);
    });

    it('o `false` SÍNCRONO REPÕE: o navegador garantiu que nada foi transmitido', () => {
        // `sendBeacon` devolve `false` quando NÃO enfileirou (fila cheia, corpo grande demais).
        // É uma resposta certa e síncrona: repor não pode duplicar nada, e descartar perderia
        // uso que aconteceu de verdade.
        const tentativas = [];
        configurarUso({
            pagina: 'mapa',
            sessaoId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            enviar: (corpo) => { tentativas.push(corpo); return false; },
            alvo,
            documento,
        });
        const antes = estadoDoUso().lotesRepostos;
        registrarUso(EventoDeUso.PAGINA_VISTA);
        registrarUso(EventoDeUso.MEDICAO_ABERTA);
        expect(descarregarUso()).toBe(true);
        expect(estadoDoUso().lotesPerdidos).toBeGreaterThan(0);
        expect(estadoDoUso().lotesRepostos).toBe(antes + 1);
        // AS LINHAS VOLTARAM, com a contagem intacta, e saem de novo na próxima descarga.
        expect(descarregarUso()).toBe(true);
        expect(tentativas).toHaveLength(2);
        expect(tentativas[1].eventos).toEqual(tentativas[0].eventos);
    });

    it('a reposição MESCLA com o que chegou depois, e não sobrescreve', () => {
        const tentativas = [];
        let recusar = true;
        configurarUso({
            pagina: 'mapa',
            sessaoId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            enviar: (corpo) => {
                tentativas.push(corpo);
                // A CONTAGEM QUE CHEGA NO MEIO: o transporte é síncrono, então registrar daqui
                // é o instante exato entre a drenagem e a reposição.
                if (recusar) registrarUso(EventoDeUso.PAGINA_VISTA);
                return recusar ? false : true;
            },
            alvo,
            documento,
        });
        registrarUso(EventoDeUso.PAGINA_VISTA);
        descarregarUso();
        recusar = false;
        descarregarUso();
        // 1 drenado + 1 que chegou no meio: sobrescrever teria perdido um dos dois.
        expect(tentativas[1].eventos).toEqual([{ evento: 'pagina.vista', contagem: 2 }]);
    });

    it('a PROMESSA rejeitada DESCARTA: o pedido pode ter chegado', async () => {
        // O ramo INCERTO. Um `fetch` com `keepalive` pode ter sido entregue ao servidor e falhado
        // só na leitura da resposta; repor ali produz contagem DUPLA, indistinguível de uso real.
        const tentativas = [];
        configurarUso({
            pagina: 'mapa',
            sessaoId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            enviar: (corpo) => { tentativas.push(corpo); return Promise.reject(new Error('x')); },
            alvo,
            documento,
        });
        registrarUso(EventoDeUso.PAGINA_VISTA);
        expect(descarregarUso()).toBe(true);
        // O DESFECHO DA PROMESSA É ASSÍNCRONO, e sem esperar por ele a asserção abaixo mediria o
        // instante ANTERIOR à decisão: uma reposição indevida escrita no `catch` da promessa
        // passaria verde, que foi exatamente o que aconteceu na primeira versão deste caso.
        await Promise.resolve();
        await Promise.resolve();
        expect(descarregarUso(), 'a promessa rejeitada não pode repor').toBe(false);
        expect(tentativas).toHaveLength(1);
    });

    it('uma promessa REJEITADA do transporte é engolida e contada', async () => {
        configurarUso({
            pagina: 'mapa',
            sessaoId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            enviar: () => Promise.reject(new Error('rede fora')),
            alvo,
            documento,
        });
        const antes = estadoDoUso().lotesPerdidos;
        registrarUso(EventoDeUso.PAGINA_VISTA);
        descarregarUso();
        await Promise.resolve();
        await Promise.resolve();
        expect(estadoDoUso().lotesPerdidos).toBe(antes + 1);
    });

    it('`desinstalar` solta os dois gatilhos E o timer', () => {
        // A METADE DO TIMER NÃO ERA ASSERIDA, e o título a prometia: um `clearInterval` que
        // nunca fosse chamado deixaria a página mandando um lote a cada trinta segundos depois
        // de a aba ter sido desmontada, com o acumulador de uma instalação morta.
        const corpos = instalar({ intervaloMs: INTERVALO_PADRAO_MS });
        expect(alvo.ouvintesDe('pagehide')).toBe(1);
        registrarUso(EventoDeUso.PAGINA_VISTA);
        desinstalarUso();
        expect(alvo.ouvintesDe('pagehide')).toBe(0);
        expect(documento.ouvintesDe('visibilitychange')).toBe(0);
        expect(estadoDoUso().instalada).toBe(false);
        // O ACUMULADOR ESTAVA CHEIO: se o timer continuasse vivo, este `tick` mandaria o lote.
        alvo.tick();
        expect(corpos, 'o timer sobreviveu ao desinstalar').toHaveLength(0);
    });
});

describe('configurarUso — os dois transportes de verdade', () => {
    it('prefere `sendBeacon`, e o Blob viaja como `application/json`', () => {
        const alvo = criarAlvo({ comBeacon: true });
        const documento = criarDocumento();
        configurarUso({
            pagina: 'mapa',
            sessaoId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            resolverBase: () => '/api/v1',
            alvo,
            documento,
        });
        registrarUso(EventoDeUso.EBGEO_EXPORTADO);
        descarregarUso();
        expect(alvo.beacons).toHaveLength(1);
        expect(alvo.enviados, 'com beacon disponível, o fetch não pode ser usado').toHaveLength(0);
        expect(alvo.beacons[0].url).toBe('/api/v1/uso/eventos');
        // SEM O TIPO o `express.json()` não analisa o corpo, e o lote chega vazio dos dois lados.
        expect(alvo.beacons[0].blob.type).toBe('application/json');
        const corpo = JSON.parse(alvo.beacons[0].blob.partes[0]);
        expect(corpo.eventos).toEqual([{ evento: 'ebgeo.exportado', contagem: 1 }]);
    });

    it('cai para `fetch` com `keepalive` quando não há `sendBeacon`', () => {
        const alvo = criarAlvo({ comBeacon: false });
        const documento = criarDocumento();
        configurarUso({
            pagina: 'admin',
            sessaoId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            resolverBase: () => '/api/v1',
            alvo,
            documento,
        });
        registrarUso(EventoDeUso.PAGINA_VISTA);
        descarregarUso();
        expect(alvo.enviados).toHaveLength(1);
        expect(alvo.enviados[0].init.method).toBe('POST');
        expect(alvo.enviados[0].init.keepalive).toBe(true);
        expect(alvo.enviados[0].init.headers['Content-Type']).toBe('application/json');
        expect(JSON.parse(alvo.enviados[0].init.body).pagina).toBe('admin');
    });
});

describe('as duas portas antes da instalação são inertes, e CONTAM', () => {
    it('`registrarUso` e `descarregarUso` não lançam e incrementam `naoInstalado`', () => {
        const antes = estadoDoUso().naoInstalado;
        expect(registrarUso(EventoDeUso.PAGINA_VISTA)).toBe(false);
        expect(descarregarUso({ motivo: 'x' })).toBe(false);
        expect(estadoDoUso().naoInstalado).toBe(antes + 2);
        expect(estadoDoUso().instalada).toBe(false);
    });
});
