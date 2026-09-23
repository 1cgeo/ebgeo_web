// Path: e2e-ui/helpers/peso-de-boot.js

/**
 * @fileoverview QUANTO O BOOT PESA, e nao apenas se ele passou.
 *
 * `boot-probe.js` responde POR QUE o boot falhou. Este arquivo responde a pergunta vizinha, que
 * ninguem estava fazendo: quanto codigo o boot baixou para chegar ate ali, e quanto tempo levou.
 * As duas sondas sao irmas de proposito, e esta reusa aquela: `expectAppBooted` JA DEVOLVIA os ms
 * do boot e JA acumulava a serie por pagina, e ate agora nenhum chamador lia o retorno. Este
 * modulo e o primeiro consumidor. `EBGEO_E2E_BOOT_TIMING=1` continua imprimindo uma linha por
 * boot; `EBGEO_E2E_PESO=1` imprime uma linha por RODADA medida aqui.
 *
 * CINCO METRICAS POR RODADA, e cada uma existe porque as outras quatro nao a substituem:
 *
 *   1. BYTES ANSIOSOS DE SCRIPT ate o boot terminar. E o numero que "ficou mais leve" alega.
 *   2. REQUISICOES DE SCRIPT ate o boot terminar. Contagem que sobe sem os bytes subirem e
 *      fragmentacao de chunk; bytes que sobem sem a contagem subir e import estatico novo. Sao
 *      dois defeitos diferentes, com correcoes opostas, e uma medida so nao os separa.
 *   3. ms ate a barra da conta anexar, vindo de `expectAppBooted`.
 *   4. ms ate o mapa estar vivo, pelo predicado que a casa ja usa em uma duzia de specs. Abrir
 *      um atlas de SERVIDOR tem um marco a mais (`mapaDoAtlasAtivo`), porque o mapa vivo daquele
 *      instante ainda e o local; ver o comentario no proprio marco.
 *   5. BYTES BAIXADOS DEPOIS DO BOOT, numa janela curta de ociosidade. Este e o CONTROLE
 *      NEGATIVO da proxima onda de emagrecimento: um `await import()` que dispara no boot mesmo
 *      assim nao economizou nada, so mudou de coluna. Sem a metrica 5, "ficou mais leve" e
 *      indistinguivel de "adiou por 200 ms", e as duas coisas se leem igual na metrica 1.
 *
 * ONDE O BOOT TERMINA, para as metricas 1, 2 e 5 nao ficarem ambiguas: no ULTIMO marco pedido da
 * rodada (o mapa vivo, quando pedido; a barra da conta, quando nao). Nao e o marco mais cedo, e
 * a escolha e deliberada: se a fronteira fosse a barra da conta, todo script que o mapa ainda
 * puxa cairia na coluna 5 e a coluna 1 pareceria magra sem nada ter emagrecido.
 *
 * AS TRES REGRAS DE MEDICAO, que sao o motivo de este arquivo existir em vez de um `expect` solto:
 *
 *   - N REPETICOES, sempre. Uma medicao unica de algo probabilistico nao e medicao. `repetir()`
 *     esta aqui para que N seja um argumento, e nao um esquecimento.
 *   - BYTES E CONTAGEM SAO DETERMINISTICOS, entao levam teto JUSTO (`expectDeterministico`, que
 *     reprova QUALQUER rodada fora da faixa). TEMPO NAO E, entao reprova pela MEDIANA da serie,
 *     com teto folgado (`expectTempoPelaMediana`). Teto de tempo apertado vira exatamente o
 *     defeito que o `boot-probe.js` descreve: sobe-se o numero ate parar de doer, e o teste deixa
 *     de medir o que dizia medir.
 *   - SEMPRE COM PISO, nunca so teto. Bytes abaixo do piso significam que o app NAO carregou, e
 *     nunca que ele ficou leve: a tela de "EBGeo indisponivel" passa em qualquer teto sozinho. Em
 *     tempo o piso pega o outro lado da mesma moeda, um marco que ja estava satisfeito antes do
 *     gesto (mapa da tela anterior ainda montado), que mede zero e se le como otimizacao.
 *
 * A UNICA COLUNA SEM PISO E A 5, e a isencao e nomeada aqui para nao virar descuido: zero byte
 * depois do boot e o estado desejado hoje, entao piso ali proibiria o alvo.
 *
 * DEGRADA, como a irma: uma pagina sem `instalarPesoDeBoot` ainda devolve os tempos, com as
 * colunas de byte em `null` e o campo `sonda` dizendo isso. O que NAO degrada e a assercao:
 * `expectDeterministico` sobre coluna nula REPROVA nomeando a sonda ausente, porque um teto de
 * bytes que passa sem bytes e um verde sem verificacao.
 *
 * SONDAGEM DESTE INSTRUMENTO: 2026-08-25, viva nos tres caminhos, pelo proprio corredor
 * (`desempenho-do-boot-do-mapa.spec.js`), em nove baterias completas da suite de um arquivo.
 * (a) caminho feliz, com as cinco colunas preenchidas e as series anexadas; (b) pesagem
 * incompleta, contada em `naoPesadas` em vez de virar byte perdido em silencio; (c) a fronteira
 * do boot, conferida contra a coluna 5 num boot frio de contexto novo.
 *
 * A SONDAGEM PEGOU DOIS DEFEITOS REAIS NO PROPRIO INSTRUMENTO, e sao eles a razao de esta linha
 * ter data. Os dois tinham o MESMO sintoma, que e o pior sintoma que um medidor de peso pode ter:
 * bytes A MENOS, que LEEM-SE como emagrecimento. Um instrumento assim nao erra, ele APROVA uma
 * otimizacao que nunca aconteceu.
 *
 *   1. A primeira versao lia o tamanho por `Content-Length`, e o Vite de desenvolvimento serve
 *      modulo sem esse cabecalho: as colunas 1 e 5 vinham ZERO. O conserto foi `request().sizes()`.
 *   2. Com `sizes()` no lugar, uma bateria de transicoes voltou `bytesDeScript: -3116` numa janela
 *      onde a irma somava 17 MB: com cache de memoria quente o Chromium devolve
 *      `responseBodySize` NEGATIVO. O conserto e a guarda no listener, que joga o valor para
 *      `naoPesadas` em vez de somar. Nenhum dos dois foi pego por leitura, e o segundo nem sequer
 *      pela primeira bateria: so a QUARTA repeticao o exibiu, que e o argumento inteiro a favor de
 *      N repeticoes escrito pelo proprio instrumento contra si mesmo.
 *
 * Ao mexer aqui, re-sonde e troque a data.
 */

import { expect } from '@playwright/test';
import { expectAppBooted } from './boot-probe.js';
import { currentMapKeyIsUuid } from './collab-helpers.js';
import { APP_ORIGIN, BACKEND_PORT } from '../constants.js';

/** Estado por pagina. `WeakMap` para nao segurar pagina fechada viva. */
const sondas = new WeakMap();

/**
 * O predicado de "mapa vivo" DA CASA, escrito uma vez.
 *
 * As duas metades importam. `globalThis.__ebgeoMap` sozinho fica verdadeiro assim que o objeto
 * existe, muito antes de o estilo carregar; `loaded()` sozinho estoura quando o objeto ainda nao
 * existe, e o erro chega como falha do instrumento em vez de como espera.
 */
export const MAPA_VIVO = () => Boolean(globalThis.__ebgeoMap && globalThis.__ebgeoMap.loaded());

/** Quanto tempo esperar as pesagens pendentes antes de desistir e contar `naoPesadas`. */
const PESAGEM_TIMEOUT_MS = 5000;

/** As origens que ESTA camada serve: o app (Vite) e o backend descartavel. @private */
const ORIGENS_DA_CASA = Object.freeze([
    APP_ORIGIN,
    `http://127.0.0.1:${BACKEND_PORT}`,
    `http://localhost:${BACKEND_PORT}`,
]);

/**
 * A resposta veio de algo que esta camada SERVE, ou de um terceiro na internet?
 *
 * A pergunta existe por causa do contador `naoPesadas`, que e o controle do proprio instrumento.
 * Ele protege as somas de BYTE: uma pesagem perdida entra como zero, e byte a menos le-se como
 * emagrecimento. Só que uma pesagem perdida de um tile de basemap de terceiro nao entra em soma
 * nenhuma que este arquivo assere (`bytesDeScript` e `requisicoesDeScript` filtram
 * `resourceType === 'script'`, e o tile chega como `fetch`), e ela depende de latencia que a
 * camada nao controla. Medido em 2026-08-28 nesta maquina: 18 tiles de `a.tile.openstreetmap.org`
 * por boot frio, pedidos pelo estilo do mapa, cujo `sizes()` nao resolve dentro do teto de
 * pesagem, contra UM unico `blob:` do proprio app. O contador marcava 19 em 5 de 5 rodadas e
 * reprovava um teto de 10 escrito quando ele media 1, sem que nenhuma das grandezas asseridas
 * tivesse mudado um byte.
 *
 * `blob:` e `data:` sao da casa por construcao (a propria pagina os cunha), e a URL ilegivel
 * conta como da casa: falhar FECHADO aqui mantem o controle do instrumento no lado seguro.
 *
 * @private
 * @param {string} url
 * @returns {boolean}
 */
function ehDaCasa(url) {
    if (!url) return true;
    if (url.startsWith('blob:') || url.startsWith('data:')) return true;
    return ORIGENS_DA_CASA.some((origem) => url.startsWith(origem));
}

/**
 * Liga a sonda de peso numa pagina RECEM-CRIADA, antes do primeiro `goto`.
 *
 * Instalar depois da navegacao tambem funciona, e perde justamente o inicio do boot, que e o
 * trecho que concentra os bytes ansiosos.
 * @param {import('@playwright/test').Page} page
 */
export function instalarPesoDeBoot(page) {
    const estado = {
        t0: Date.now(),
        respostas: [],   // { ms, tipo, url, bytes, pesada }
        pendentes: [],   // as promessas de `sizes()`, aguardadas na hora de somar
    };
    sondas.set(page, estado);

    page.on('response', (res) => {
        const ms = Date.now() - estado.t0;
        let tipo = '(ilegivel)';
        let url = '';
        let req = null;
        try {
            req = res.request();
            tipo = req.resourceType();
            url = res.url();
        } catch {
            // Pagina morta no meio do evento. A linha entra assim mesmo: uma resposta que
            // existiu e nao foi classificada nao pode sumir da contagem.
        }
        const registro = { ms, tipo, url: String(url).slice(0, 200), bytes: 0, pesada: false };
        estado.respostas.push(registro);
        if (!req) return;
        // O `await` fica FORA do listener de proposito: `sizes()` so resolve depois do corpo
        // inteiro chegar, e segurar o listener atrasaria o carimbo de tempo das respostas
        // seguintes, que e a coordenada de que toda a soma depende.
        estado.pendentes.push(
            req.sizes()
                .then((s) => {
                    // TAMANHO NEGATIVO NAO E TAMANHO, e a guarda existe porque foi MEDIDA: numa
                    // bateria de transicoes o Chromium serviu o modulo do cache de memoria e o
                    // `responseBodySize` voltou NEGATIVO, somando `bytesDeScript: -3116` numa
                    // janela onde a irma somava 17 MB. Sem esta linha o valor entrava como bytes,
                    // e byte a menos LE-SE COMO EMAGRECIMENTO: o instrumento estava pronto a
                    // aprovar uma otimizacao que nunca aconteceu. Uma resposta que o navegador
                    // nao soube dimensionar conta em `naoPesadas`, que e o controle do medidor.
                    const n = Number(s?.responseBodySize);
                    if (!Number.isFinite(n) || n < 0) return;
                    registro.bytes = n;
                    registro.pesada = true;
                })
                .catch(() => { /* fica `pesada: false`, e a rodada conta em `naoPesadas` */ }),
        );
    });
    instalarRastroDeSincronia(page, estado);
    return estado;
}

/**
 * O RASTRO QUE DIZ ONDE A ABERTURA DE UM ATLAS DE SERVIDOR PAROU, lido só quando ela para.
 *
 * Ele existe por causa de UMA falha da matriz de 2026-09-22 (transições, Chromium): 30 s de badge
 * em `offline`/`sem-conexao`, sem nunca passar por `connecting`, com a página parada no mapa, e
 * nenhuma evidência do que o pipeline estava esperando. Três modos de falha forçados um a um em
 * 2026-09-23, nos dois navegadores, deixam três ASSINATURAS diferentes: o socket que fecha antes
 * do quadro `connected` derruba a abertura e leva a página a `atlas.html` em cerca de 3 s; o socket
 * mudo deixa a badge em `connecting`; e só a parada ANTES do socket (o pull inicial que não
 * responde) reproduz a da matriz. A assinatura aponta a fase, e este rastro aponta o PASSO: quais
 * pedidos da API ficaram sem resposta e se algum socket de colaboração chegou a abrir.
 *
 * Só pedidos de `/api/v1/` e sockets de `/collab`: é o que o pipeline de abertura toca na rede, e
 * o resto (módulos, tiles) inflaria a lista sem dizer nada sobre a sincronia.
 *
 * SONDAGEM DO RASTRO: 2026-09-23, Chromium e Firefox, por `medirJanela` com a espera de sincronia
 * encurtada e cada modo forçado por rota: sem bloqueio fica online e não diagnostica nada; pull
 * parado nomeia o `GET .../sync/0` pendente e lê "antes do socket"; socket mudo lê "não completou
 * o handshake"; socket fechado lê "voltou ao seletor". Quatro de quatro nos dois.
 *
 * RE-SONDADO EM 2026-09-23 para o QUINTO modo, o da falha da matriz de 2026-09-22: a abertura
 * FALHA (o `/sync/protocol` abortado por rota) numa aba com a intenção "Mapa local", e a cadeia de
 * boot cai no mapa local, com a origem local e sem `?atlas=`. Sem a leitura nova o diagnóstico
 * dessa cena não dizia nada; com ela, e com a linha de console capturada, leu nos dois navegadores
 * "a abertura FALHOU ... caiu no mapa LOCAL", com o motivo (`TypeError: Failed to fetch` no
 * Chromium, `NetworkError when attempting to fetch resource.` no Firefox, que chega como
 * `JSHandle@object` no texto cru e por isso é lido do argumento).
 * @private
 */
function instalarRastroDeSincronia(page, estado) {
    estado.pedidos = [];
    estado.soquetes = [];
    estado.falhasDeAbertura = [];
    const porPedido = new WeakMap();
    const agora = () => Date.now() - estado.t0;
    // A LINHA QUE O BOOT ESCREVE QUANDO A ABERTURA POR `?atlas=` FALHA, e ela é a única que nomeia
    // o erro: depois dela a cadeia de roteamento segue (seletor, ou mapa local com a intenção), e a
    // página não guarda o motivo em lugar nenhum que o diagnóstico alcance. Foi o que faltou na
    // falha da matriz de 2026-09-22, cujo erro era um `AbortError` do fence de descarte.
    page.on('console', (mensagem) => {
        let texto = '';
        try { texto = mensagem.text(); } catch { return; }
        if (!texto.includes('[boot] atlas open from URL failed')) return;
        const registro = { ms: agora(), texto: texto.slice(0, 240) };
        estado.falhasDeAbertura.push(registro);
        // NO FIREFOX O ERRO CHEGA COMO `JSHandle@object` no texto (medido em 2026-09-23), então o
        // motivo é lido do próprio argumento. Best-effort: a página pode ter navegado e levado o
        // handle junto, e aí fica o texto cru.
        let args = [];
        try { args = mensagem.args(); } catch { /* sem argumentos legíveis */ }
        if (args.length > 1) {
            args[1].evaluate((e) => (e && typeof e === 'object' ? `${e.name}: ${e.message}` : String(e)))
                .then((motivo) => {
                    registro.texto = `[boot] atlas open from URL failed: ${motivo}`.slice(0, 240);
                })
                .catch(() => {});
        }
    });
    page.on('request', (req) => {
        let url;
        try { url = new URL(req.url()); } catch { return; }
        // A telemetria de uso fica de fora: ela é abandonada de propósito a cada navegação
        // (`net::ERR_ABORTED`), e oito falhas dela por janela afogariam o pedido que importa.
        if (!url.pathname.includes('/api/v1/') || url.pathname.includes('/api/v1/uso/')) return;
        const registro = { ms: agora(), fim: null, metodo: req.method(), caminho: url.pathname, falha: null };
        porPedido.set(req, registro);
        estado.pedidos.push(registro);
    });
    page.on('requestfinished', (req) => {
        const registro = porPedido.get(req);
        if (registro) registro.fim = agora();
    });
    page.on('requestfailed', (req) => {
        const registro = porPedido.get(req);
        if (!registro) return;
        registro.fim = agora();
        registro.falha = req.failure()?.errorText ?? 'falhou';
    });
    page.on('websocket', (ws) => {
        if (!ws.url().includes('/collab')) return;
        const registro = { ms: agora(), fim: null, erro: null };
        estado.soquetes.push(registro);
        ws.on('close', () => { registro.fim = agora(); });
        ws.on('socketerror', (erro) => { registro.erro = String(erro).slice(0, 80); });
    });
}

/**
 * Monta o diagnóstico de uma espera de sincronia que estourou, a partir do rastro e da página.
 *
 * Nunca lança: é chamado dentro de um `catch`, e um diagnóstico que quebra esconderia a falha que
 * ele veio explicar. O estado lido na página é o do módulo que o app usa, porque esta camada serve
 * sem HMR (`vite.e2e.config.js`) e o `import()` devolve a mesma instância.
 * @private
 * @param {import('@playwright/test').Page} page
 * @param {Object|null} estado - O da sonda, ou nulo quando ela não foi instalada.
 * @param {number} desde - Início da janela, em ms relativos ao `t0` da sonda.
 * @returns {Promise<string>}
 */
async function diagnosticoDeSincronia(page, estado, desde) {
    const linhas = [];
    // A LEITURA SAI DO ESTADO DA CONEXÃO NA PÁGINA, e não da contagem de sockets: um socket
    // interceptado por `routeWebSocket` não emite o evento `websocket` do Playwright (medido na
    // sondagem abaixo), enquanto `connectionState` passa a `connecting` no mesmo passo síncrono em
    // que `WsClient._open()` cria o socket. `offline` com a origem já REMOTA e a página no mapa é,
    // portanto, a abertura parada antes de `wsClient.connect`.
    let pagina = null;
    try {
        pagina = await page.evaluate(async () => {
            const { connectionState } = await import('/src/js/store/sync/connection-state.js');
            const { isRemoteStoreSync } = await import('/src/js/store/store-origin.js');
            return {
                caminho: location.pathname + location.search,
                conexao: connectionState.getState(),
                origemRemota: isRemoteStoreSync(),
            };
        });
        linhas.push(`página: ${JSON.stringify(pagina)}`);
    } catch (erro) {
        linhas.push(`página ilegível: ${String(erro?.message ?? erro).slice(0, 120)}`);
    }
    let pendentes = [];
    if (estado?.pedidos) {
        const fim = Date.now() - estado.t0;
        const naJanela = estado.pedidos.filter((p) => p.ms >= desde);
        pendentes = naJanela.filter((p) => p.fim === null);
        const falhos = naJanela.filter((p) => p.falha);
        const soquetes = estado.soquetes.filter((s) => s.ms >= desde);
        linhas.push(`pedidos da API na janela: ${naJanela.length}; sem resposta: ${pendentes.length}`);
        for (const p of pendentes) linhas.push(`  PENDENTE ${p.metodo} ${p.caminho} há ${fim - p.ms} ms`);
        for (const p of falhos) linhas.push(`  FALHOU ${p.metodo} ${p.caminho} (${p.falha})`);
        linhas.push(`sockets de colaboração vistos pelo Playwright: ${soquetes.length}`
            + (soquetes.length ? ` ${JSON.stringify(soquetes)}` : ''));
    } else {
        linhas.push('sem rastro de rede (instalarPesoDeBoot não foi chamado nesta página)');
    }
    const falhas = (estado?.falhasDeAbertura ?? []).filter((f) => f.ms >= desde);
    for (const f of falhas) linhas.push(`  CONSOLE ${f.texto}`);
    if (pagina) {
        const noMapa = !pagina.caminho.startsWith('/atlas.html');
        if (!noMapa) {
            linhas.push('LEITURA: a abertura FALHOU e a página voltou ao seletor.');
        } else if (pagina.conexao === 'connecting' || pagina.conexao === 'reconnecting') {
            linhas.push('LEITURA: o socket de colaboração abriu e não completou o handshake.');
        } else if (pagina.conexao === 'offline' && pagina.origemRemota) {
            linhas.push(pendentes.length
                ? 'LEITURA: a abertura parou ANTES do socket, esperando o pedido pendente acima.'
                : 'LEITURA: a abertura parou ANTES do socket e FORA da rede (IndexedDB, trava ou o '
                    + 'próprio pipeline de `syncEngine.connect`); nenhum pedido da API ficou sem resposta.');
        } else if (pagina.conexao === 'offline' && !pagina.origemRemota && !/[?&]atlas=/.test(pagina.caminho)) {
            // O CASO QUE FICAVA SEM LEITURA, e é a assinatura da falha da matriz de 2026-09-22: a
            // abertura FALHOU, o `?atlas=` saiu da barra, a origem voltou a local e a página ficou no
            // mapa, porque a aba carregava a intenção "Mapa local" e a cadeia caiu no ramo local em
            // vez do seletor. O motivo está na linha de console acima, quando ela foi capturada.
            linhas.push(falhas.length
                ? 'LEITURA: a abertura FALHOU (motivo na linha de console acima) e a cadeia de boot '
                    + 'caiu no mapa LOCAL pela intenção "Mapa local" desta aba.'
                : 'LEITURA: a página está no mapa, fora de atlas de servidor e sem `?atlas=`, e '
                    + 'nenhuma falha de abertura foi vista no console: a abertura nem começou.');
        }
    }
    return linhas.join('\n');
}

/**
 * Espera as pesagens pendentes, com teto. Nunca lanca.
 * @private
 */
async function aguardarPesagem(estado) {
    if (!estado.pendentes.length) return;
    const pendentes = estado.pendentes.slice();
    let alarme;
    const relogio = new Promise((r) => { alarme = setTimeout(r, PESAGEM_TIMEOUT_MS); });
    try {
        await Promise.race([Promise.allSettled(pendentes), relogio]);
    } finally {
        clearTimeout(alarme);
    }
}

/**
 * Soma uma FATIA da linha do tempo da sonda.
 * @private
 * @param {Object} estado
 * @param {{de: number, ate: number}} janela - ms relativos ao `t0` da sonda.
 */
function somar(estado, { de, ate }) {
    const dentro = estado.respostas.filter((r) => r.ms > de && r.ms <= ate);
    const scripts = dentro.filter((r) => r.tipo === 'script');
    return {
        bytesDeScript: scripts.reduce((a, r) => a + r.bytes, 0),
        requisicoesDeScript: scripts.length,
        bytesTotais: dentro.reduce((a, r) => a + r.bytes, 0),
        requisicoesTotais: dentro.length,
        // DUAS COLUNAS, e a divisao e a do predicado acima: `naoPesadas` cobre o que esta camada
        // serve, que e o que pode corromper as somas de byte; `naoPesadasDeTerceiros` fica
        // VISIVEL na serie anexada, sem teto, para que a rede externa continue legivel sem
        // reprovar a medida do app.
        naoPesadas: dentro.filter((r) => !r.pesada && ehDaCasa(r.url)).length,
        naoPesadasDeTerceiros: dentro.filter((r) => !r.pesada && !ehDaCasa(r.url)).length,
    };
}

/**
 * MEDE UMA JANELA: executa um gesto, espera os marcos pedidos e pesa o que a rede trouxe.
 *
 * O gesto entra como funcao (`acao`) em vez de a janela ser um `goto` fixo, e e o que permite ao
 * mesmo instrumento medir o boot frio e as TRANSICOES (abrir atlas, trocar de atlas, sair da
 * conta) sem duas implementacoes que se desencontram na terceira mudanca.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Object} opcoes
 * @param {string} opcoes.rotulo - Aparece na serie anexada e na mensagem de falha.
 * @param {() => Promise<any>} opcoes.acao - O gesto medido. Comeca o cronometro.
 * @param {boolean} [opcoes.barraDaConta=true] - Espera o marco 3 (via `expectAppBooted`).
 * @param {boolean} [opcoes.sincroniaOnline=false] - Espera a badge de sincronia ficar `online`.
 * @param {boolean} [opcoes.mapaVivo=true] - Espera o marco 4.
 * @param {boolean} [opcoes.mapaDoAtlasAtivo=false] - Espera o mapa DO ATLAS ficar ativo. Ver
 *   abaixo: sem ele, abrir um atlas de servidor mede o mapa LOCAL.
 * @param {number} [opcoes.timeout=30000] - Orcamento de CADA marco.
 * @param {number} [opcoes.ociosidadeMs=0] - A janela do marco 5. Zero desliga a coluna.
 * @returns {Promise<Object>} a rodada.
 */
export async function medirJanela(page, {
    rotulo,
    acao,
    barraDaConta = true,
    sincroniaOnline = false,
    mapaVivo = true,
    mapaDoAtlasAtivo = false,
    timeout = 30000,
    ociosidadeMs = 0,
} = {}) {
    const estado = sondas.get(page) ?? null;
    const base = estado ? estado.t0 : Date.now();
    const inicio = Date.now() - base;

    const tA = Date.now();
    await acao();
    const msAcao = Date.now() - tA;

    // O marco 3 vem de `expectAppBooted`, que cronometra a partir de SI MESMO. Os ms do gesto
    // entram somados para que todas as colunas de tempo tenham a mesma origem: sem isso, uma
    // navegacao lenta ficaria invisivel na coluna que mais se olha.
    const msBarraDaConta = barraDaConta
        ? msAcao + await expectAppBooted(page, { timeout, rotulo })
        : null;

    let msSincroniaOnline = null;
    if (sincroniaOnline) {
        try {
            await expect(page.locator('[data-testid="sync-status-badge"]'))
                .toHaveAttribute('data-state', 'online', { timeout });
        } catch (erro) {
            // A espera continua reprovando: o diagnóstico só ACRESCENTA o que o pipeline estava
            // esperando, que é o que faltou na única falha desta espera (ver o rastro acima).
            const diagnostico = await diagnosticoDeSincronia(page, estado, inicio);
            process.stdout.write(`[peso] [${rotulo}] sincronia não ficou online:\n${diagnostico}\n`);
            throw new Error(`${erro.message}\n\nDIAGNÓSTICO [${rotulo}]\n${diagnostico}`, { cause: erro });
        }
        msSincroniaOnline = Date.now() - tA;
    }

    let msMapaVivo = null;
    if (mapaVivo) {
        await page.waitForFunction(MAPA_VIVO, null, { timeout });
        msMapaVivo = Date.now() - tA;
    }

    // O MARCO QUE ABRIR UM ATLAS DE SERVIDOR PRECISA, e que `mapaVivo` NAO da.
    //
    // MEDIDO por sonda descartavel em 2026-08-25: um segundo depois do clique no cartao, a URL ja
    // e `/?atlas=<uuid>`, o mapa ja esta `loaded()` e a badge ainda diz `data-work="local"`. O
    // mapa vivo daquele instante e o LOCAL, que a pagina monta primeiro; o atlas remoto so assenta
    // seis segundos depois. Parar em `mapaVivo` mediria a abertura do atlas em um sexto do tempo
    // real, e o numero pareceria uma otimizacao. A distincao e a mesma que `openAtlasUI` ja fazia
    // em `collab-helpers.js`, e o predicado vem DE LA, e nao reescrito aqui.
    let msMapaDoAtlasAtivo = null;
    if (mapaDoAtlasAtivo) {
        await expect.poll(() => currentMapKeyIsUuid(page), {
            timeout,
            message: `[${rotulo}] o mapa do atlas nao ficou ativo (mapa local e chaveado pelo `
                + 'nome, mapa de atlas por UUID)',
        }).toBe(true);
        msMapaDoAtlasAtivo = Date.now() - tA;
    }

    const fimDoBoot = Date.now() - base;
    let fimDaOciosidade = fimDoBoot;
    if (ociosidadeMs > 0) {
        await page.waitForTimeout(ociosidadeMs);
        fimDaOciosidade = Date.now() - base;
    }

    if (!estado) {
        return {
            rotulo,
            sonda: 'AUSENTE (instalarPesoDeBoot nao foi chamado nesta pagina)',
            msAcao, msBarraDaConta, msSincroniaOnline, msMapaVivo, msMapaDoAtlasAtivo,
            bytesDeScript: null,
            requisicoesDeScript: null,
            bytesTotais: null,
            bytesDeScriptDepoisDoBoot: null,
            bytesTotaisDepoisDoBoot: null,
            requisicoesDepoisDoBoot: null,
            naoPesadas: null,
            naoPesadasDeTerceiros: null,
            ociosidadeMs,
        };
    }

    await aguardarPesagem(estado);
    const noBoot = somar(estado, { de: inicio, ate: fimDoBoot });
    const depois = ociosidadeMs > 0
        ? somar(estado, { de: fimDoBoot, ate: fimDaOciosidade })
        : null;

    const rodada = {
        rotulo,
        sonda: 'ligada',
        msAcao,
        msBarraDaConta,
        msSincroniaOnline,
        msMapaVivo,
        msMapaDoAtlasAtivo,
        bytesDeScript: noBoot.bytesDeScript,
        requisicoesDeScript: noBoot.requisicoesDeScript,
        bytesTotais: noBoot.bytesTotais,
        bytesDeScriptDepoisDoBoot: depois ? depois.bytesDeScript : null,
        bytesTotaisDepoisDoBoot: depois ? depois.bytesTotais : null,
        requisicoesDepoisDoBoot: depois ? depois.requisicoesTotais : null,
        naoPesadas: noBoot.naoPesadas + (depois ? depois.naoPesadas : 0),
        naoPesadasDeTerceiros: noBoot.naoPesadasDeTerceiros
            + (depois ? depois.naoPesadasDeTerceiros : 0),
        ociosidadeMs,
    };
    if (process.env.EBGEO_E2E_PESO === '1') {
        process.stdout.write(`[peso] ${JSON.stringify(rodada)}\n`);
    }
    return rodada;
}

/**
 * Um BOOT FRIO: contexto novo (cache vazio), sonda ligada antes da navegacao, medida, contexto
 * fechado.
 *
 * O contexto novo A CADA repeticao e o que torna a coluna de bytes comparavel entre rodadas: um
 * `reload()` na mesma pagina responderia do cache e a serie inteira desabaria para perto de zero,
 * que e a assinatura exata de "o app nao carregou".
 *
 * `waitUntil: 'commit'` e nao o padrao `'load'`: o cronometro precisa comecar na navegacao, e nao
 * depois de o documento ja ter carregado, senao o marco 3 mede so a cauda do boot.
 *
 * @param {import('@playwright/test').Browser} browser
 * @param {Object} [opcoes] - As de `medirJanela`, mais `url` e `initScript`.
 */
export async function medirBootFrio(browser, {
    rotulo = 'boot-frio',
    url = '/',
    initScript = null,
    ...resto
} = {}) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    instalarPesoDeBoot(page);
    if (initScript) await page.addInitScript(initScript.fn, initScript.arg);
    try {
        return await medirJanela(page, {
            rotulo,
            acao: () => page.goto(url, { waitUntil: 'commit' }),
            ...resto,
        });
    } finally {
        await ctx.close();
    }
}

/**
 * Roda `fn` N vezes em SERIE e devolve as N rodadas.
 *
 * Em serie, e nunca em paralelo: esta camada tem porta, banco e trabalhador FIXOS, e duas medidas
 * concorrentes disputariam a mesma maquina, medindo contencao em vez do app.
 *
 * @param {number} n
 * @param {(i: number) => Promise<Object>} fn
 */
export async function repetir(n, fn) {
    const rodadas = [];
    for (let i = 0; i < n; i += 1) rodadas.push(await fn(i));
    return rodadas;
}

/** A mediana de uma serie de numeros (media dos dois centrais quando N e par). @private */
function mediana(valores) {
    const ordenados = [...valores].sort((a, b) => a - b);
    const meio = Math.floor(ordenados.length / 2);
    return ordenados.length % 2 ? ordenados[meio] : (ordenados[meio - 1] + ordenados[meio]) / 2;
}

/**
 * O resumo de UMA coluna da serie.
 * @param {Object[]} rodadas
 * @param {string} campo
 */
export function resumir(rodadas, campo) {
    const valores = rodadas.map((r) => r[campo]);
    const numeros = valores.filter((v) => typeof v === 'number' && Number.isFinite(v));
    return {
        campo,
        n: rodadas.length,
        lidos: numeros.length,
        min: numeros.length ? Math.min(...numeros) : null,
        mediana: numeros.length ? mediana(numeros) : null,
        max: numeros.length ? Math.max(...numeros) : null,
        valores,
    };
}

/** As colunas que o resumo anexado percorre. @private */
const COLUNAS = Object.freeze([
    'msAcao', 'msBarraDaConta', 'msSincroniaOnline', 'msMapaVivo', 'msMapaDoAtlasAtivo',
    'bytesDeScript', 'requisicoesDeScript', 'bytesTotais',
    'bytesDeScriptDepoisDoBoot', 'bytesTotaisDepoisDoBoot', 'requisicoesDepoisDoBoot',
    'naoPesadas', 'naoPesadasDeTerceiros',
]);

/**
 * Anexa a SERIE INTEIRA, e nao so o agregado.
 *
 * O agregado sozinho esconde a forma da distribuicao, que e onde mora a resposta util: uma
 * mediana boa com um maximo tres vezes maior nao e a mesma coisa que cinco rodadas iguais, e so a
 * segunda autoriza um teto justo.
 *
 * @param {import('@playwright/test').TestInfo} testInfo
 * @param {string} nome
 * @param {Object[]} rodadas
 */
export async function anexarSerie(testInfo, nome, rodadas) {
    const resumo = Object.fromEntries(
        COLUNAS.map((c) => [c, resumir(rodadas, c)])
            .filter(([, r]) => r.lidos > 0)
            .map(([c, r]) => [c, { min: r.min, mediana: r.mediana, max: r.max, valores: r.valores }]),
    );
    await testInfo.attach(nome, {
        contentType: 'application/json',
        body: JSON.stringify({ nome, n: rodadas.length, resumo, rodadas }, null, 2),
    });
}

/**
 * A data de medicao e OBRIGATORIA em todo teto deste arquivo.
 *
 * Constante de desempenho sem data e conselho sem prazo de validade: seis meses depois ninguem
 * sabe se `1800` foi medido nesta maquina, nesta versao do app, ou herdado de um numero que
 * alguem subiu ate parar de doer.
 * @private
 */
function exigirData(medidoEm, quem) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(medidoEm ?? ''))) {
        throw new Error(`${quem}: falta \`medidoEm\` (AAAA-MM-DD). Teto sem data nao entra aqui.`);
    }
}

/** @private */
function exigirColunaLida(rodadas, campo, quem) {
    const nulos = rodadas.filter((r) => typeof r[campo] !== 'number');
    if (!nulos.length) return;
    const sonda = rodadas.find((r) => r.sonda !== 'ligada')?.sonda;
    throw new Error(
        `${quem}: a coluna "${campo}" veio nula em ${nulos.length}/${rodadas.length} rodadas`
        + `${sonda ? ` (${sonda})` : ''}. Um teto que passa sem a medida e um verde sem verificacao.`,
    );
}

/**
 * TETO JUSTO para coluna DETERMINISTICA (bytes, contagem de requisicoes).
 *
 * Reprova QUALQUER rodada fora da faixa, e nao a mediana: byte de boot frio nao varia por carga
 * de maquina, entao uma rodada fora e sinal, nunca ruido. O PISO nao e simetria decorativa: sem
 * ele, a tela de "EBGeo indisponivel" passa em qualquer teto, porque ela baixa quase nada.
 *
 * @param {Object[]} rodadas
 * @param {string} campo
 * @param {{piso: number, teto: number, medidoEm: string, porque?: string}} faixa
 */
export function expectDeterministico(rodadas, campo, { piso, teto, medidoEm, porque = '' }) {
    exigirData(medidoEm, `expectDeterministico(${campo})`);
    exigirColunaLida(rodadas, campo, `expectDeterministico(${campo})`);
    const r = resumir(rodadas, campo);
    const detalhe = `serie=[${r.valores.join(', ')}] (medido em ${medidoEm})${porque ? ` | ${porque}` : ''}`;
    expect(r.min, `${campo} ABAIXO do piso ${piso}: o app provavelmente nao carregou. ${detalhe}`)
        .toBeGreaterThanOrEqual(piso);
    expect(r.max, `${campo} ACIMA do teto ${teto}. ${detalhe}`).toBeLessThanOrEqual(teto);
}

/**
 * TETO FOLGADO, PELA MEDIANA, para coluna de TEMPO.
 *
 * Tempo nao e deterministico, entao a rodada mais lenta da serie nao e o numero que decide: uma
 * pausa de coletor de lixo ou um vizinho na maquina reprovaria um app intacto, e o conserto que
 * isso convida e subir o teto, o que apaga a medida. A mediana de N e o que se compara.
 *
 * ISTO FOI MEDIDO, e nao deduzido: numa bateria com a maquina carregada, um boot frio levou
 * 9356 ms ate a barra da conta enquanto a MEDIANA das cinco rodadas ficou em 2131 ms. Pelo maximo
 * a rodada teria reprovado um app intacto; pela mediana ela passou, e a serie inteira ficou no
 * anexo para quem quisesse ver a cauda. Uma medicao unica teria 1 chance em 5 de ser aquele 9356.
 *
 * O PISO aqui pega o outro modo de falha, que o teto nao ve: um marco que ja estava satisfeito
 * antes do gesto (o mapa da tela anterior ainda montado) mede quase zero e LE-SE como otimizacao.
 *
 * @param {Object[]} rodadas
 * @param {string} campo
 * @param {{piso: number, teto: number, medidoEm: string, porque?: string}} faixa
 */
export function expectTempoPelaMediana(rodadas, campo, { piso, teto, medidoEm, porque = '' }) {
    exigirData(medidoEm, `expectTempoPelaMediana(${campo})`);
    exigirColunaLida(rodadas, campo, `expectTempoPelaMediana(${campo})`);
    const r = resumir(rodadas, campo);
    const detalhe = `mediana=${r.mediana} serie=[${r.valores.join(', ')}] (medido em ${medidoEm})`
        + `${porque ? ` | ${porque}` : ''}`;
    expect(r.mediana, `mediana de ${campo} ABAIXO do piso ${piso}: o marco ja estava satisfeito `
        + `antes do gesto, entao a janela nao mediu nada. ${detalhe}`).toBeGreaterThanOrEqual(piso);
    expect(r.mediana, `mediana de ${campo} ACIMA do teto ${teto}. ${detalhe}`)
        .toBeLessThanOrEqual(teto);
}
