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
    return estado;
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
        naoPesadas: dentro.filter((r) => !r.pesada).length,
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
        await expect(page.locator('[data-testid="sync-status-badge"]'))
            .toHaveAttribute('data-state', 'online', { timeout });
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
    'naoPesadas',
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
