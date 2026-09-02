// Path: js/session/uso-lote.js

/**
 * @fileoverview O ACUMULADOR DE USO: contagens em memória, um lote a cada trinta segundos, e um
 * `sendBeacon` na saída da página. É a metade de DECISÃO da telemetria de uso; a metade de FIAÇÃO
 * (quem é a sessão, qual é a base da API, qual é a release, quais são as vitais) mora em
 * `session/uso-telemetria.js`, do mesmo jeito que `erro-telemetria-assinatura.js` e
 * `erro-telemetria.js` se dividem.
 *
 * IMPORTA UM MÓDULO SÓ, o catálogo (`eventos-de-uso.js`), que é folha de zero imports. É isso que
 * o mantém dirigível em node puro: os gatilhos de descarga são `pagehide` e `visibilitychange`
 * num alvo INJETADO, o relógio é injetado, o transporte é injetado, e nada aqui toca `window` no
 * tempo de import.
 *
 * ── AS QUATRO PROPRIEDADES, e cada uma existe contra um desfecho concreto ────────────────────
 *
 *   1. **NUNCA LANÇA, EM NENHUMA PORTA.** `registrarUso` é chamado de dentro do `activate()` de
 *      uma ferramenta, do caminho de sucesso de uma exportação e do `map.on('load')`. Uma exceção
 *      aqui derrubaria o gesto que ela deveria apenas CONTAR, que é a pior troca possível: perder
 *      a funcionalidade para não perder a métrica.
 *   2. **UM EVENTO DESCONHECIDO É DESCARTADO, E CONTADO.** O lote é UM corpo com N contagens, e o
 *      Joi da rota recusa o corpo INTEIRO (422) a uma chave que ele não conhece. Mandar e torcer
 *      custaria a contagem de todos os outros eventos daquele intervalo por causa de um erro de
 *      digitação. `estadoDoUso().descartados` é o que impede que essa tolerância vire silêncio.
 *   3. **NÃO HÁ FILA ENTRE CARGAS DA PÁGINA, E ISSO É DECISÃO.** Nada é gravado em disco: um lote
 *      que não sai antes de a página morrer, morre com ela. Uso não é defeito, a métrica é
 *      agregada, e a fila que a telemetria de ERRO tem (`fila-de-relatos.js`) existe porque lá
 *      cada relato é uma evidência única. Guardar contagem de uso no `localStorage` compraria
 *      precisão marginal pagando com armazenamento, com uma porta a mais para dado sair da
 *      máquina de quem usa, e com risco de contagem DUPLA no reenvio.
 *
 *      **DENTRO DA MESMA PÁGINA, PORÉM, A RECUSA TEM DOIS DESFECHOS, e a primeira versão desta
 *      linha justificava os dois com um argumento que só vale para um.** O `sendBeacon` que
 *      devolve o literal `false` está dizendo, de forma SÍNCRONA e certa, que não enfileirou nada:
 *      repor as contagens ali não pode duplicar coisa nenhuma, e descartá-las perde uso que
 *      aconteceu. O que é INCERTO é a promessa: um `fetch` com `keepalive` pode ter chegado ao
 *      servidor e falhado só na leitura da resposta, e repor ali produz contagem DUPLA, que num
 *      relatório agregado é indistinguível de uso real. Então o certo repõe (`lotesRepostos`) e o
 *      incerto descarta (`lotesPerdidos`), que é a decisão de errar para menos onde não se sabe.
 *   4. **O CORPO TEM EXATAMENTE AS CHAVES DO CONTRATO.** O `.unknown(false)` do Joi vence o
 *      `stripUnknown` do `validate` (medido, e é a mesma regra do `contexto` do relato de erro):
 *      uma chave a mais dentro de `vitais` ou dentro de um item de `eventos` vira 422, não
 *      descarte silencioso. {@link montarCorpoDeUso} é a única coisa que monta o corpo, e ela é
 *      pura.
 *
 * ── O CASO `indisponivel.visto`, QUE É O ÚNICO QUE MENTE SE FOR LIDO INGENUAMENTE ────────────
 *
 * A tela "EBGeo indisponível" tem DUAS causas (`ui/blocking-screen-phrases.js`): o servidor não
 * respondeu, ou o nosso código quebrou com o servidor de pé. Este evento pede uma descarga
 * imediata, e a descarga vai para o SERVIDOR: na primeira causa ela falha por definição, e o lote
 * morre, porque não há fila. Ou seja, **este contador conta praticamente só as telas de
 * `APP_ERROR`**. A queda de servidor não se perde: ela é contada pelo caminho de DEFEITO (a tela
 * relata com origem `indisponivel` e `enfileirarSempre`, e aquele lado TEM fila). Quem ler a série
 * de "Indisponibilidade vista pelo cliente" como "quantas vezes o servidor caiu" lerá o número
 * errado, e é por isso que a frase da tela e esta linha existem.
 */

import {
    EVENTOS_DE_USO,
    EventoDeUso,
    PAGINAS,
    eventoDeUsoValido,
    paginaDeUsoValida,
    propDeUsoValida,
} from './eventos-de-uso.js';

/** O caminho da rota, sob a base que a fiação resolve. */
export const ROTA_DE_USO = '/uso/eventos';

/** O intervalo padrão entre descargas, em milissegundos. */
export const INTERVALO_PADRAO_MS = 30000;

/**
 * A FORMA QUE O SERVIDOR ACEITA COMO `sessaoId`.
 *
 * Ela é conferida AQUI, e não só em `sessao-id.js`, pelo mesmo argumento do `atlasId` do relato
 * de erro: o campo é obrigatório no Joi da rota (`Joi.string().guid()`), então um valor de outra
 * forma custa o LOTE INTEIRO num 422. E o modo de falha é o pior possível: o corpo sai, o
 * servidor recusa, e o cliente conta `lotesEnviados` porque `sendBeacon` já tinha devolvido
 * `true` (ele responde sobre a FILA do navegador, nunca sobre a resposta). O contador diria
 * "está tudo saindo" sobre uma sessão inteira que nunca chegou.
 */
const RE_SESSAO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O teto da coluna `release` no servidor. Aparar aqui evita o mesmo 422 do id. */
export const MAX_RELEASE = 100;

/**
 * O teto de linhas de um lote, e ele é do CONTRATO (o Joi da rota recusa acima disto).
 *
 * Ele não morde no produto de hoje (treze eventos, e só um deles com `prop` livre sobre as duas
 * dúzias de ferramentas do registro), e é justamente por isso que ele precisa de código: um teto
 * que nunca é alcançado é um teto que ninguém testa, e o dia em que ele for alcançado é o dia em
 * que o lote INTEIRO passaria a ser recusado.
 */
export const MAX_LINHAS_DO_LOTE = 50;

/**
 * O que a telemetria de uso fez até agora. Só cresce.
 *
 * ELA CONTA O QUE ENGOLIU, pelo mesmo argumento de `estadoDaTelemetria`: todo caminho de falha
 * daqui é silencioso por desenho, e um subsistema silencioso sem contador é um subsistema que
 * ninguém consegue afirmar que está vivo.
 */
const _estado = {
    /** Chamadas de `registrarUso` que viraram contagem. */
    registrados: 0,
    /** Chamadas recusadas pelo catálogo (evento fora da lista, `prop` não permitida). */
    descartados: 0,
    /** Chamadas feitas antes de haver instalação. */
    naoInstalado: 0,
    /** Lotes que o transporte aceitou. */
    lotesEnviados: 0,
    /** Lotes que o transporte recusou (ver a propriedade 3 sobre quais deles morrem ali). */
    lotesPerdidos: 0,
    /** Lotes cujas contagens voltaram ao acumulador porque nada foi transmitido. */
    lotesRepostos: 0,
    /** Linhas que não couberam no teto do lote. */
    truncados: 0,
    /** Exceções engolidas dentro deste módulo. */
    falhasInternas: 0,
};

/**
 * A instalação viva, ou `null`.
 *
 * Módulo-global de propósito: uma página instala uma vez, e uma segunda chamada (um `import()`
 * repetido, uma recarga parcial de HMR) tem de ser inerte em vez de dobrar os gatilhos e o timer.
 * @type {{desinstalar: () => void, registrar: Function, descarregar: Function}|null}
 */
let _instalacao = null;

/**
 * O que a telemetria de uso fez até agora, mais o que está pendente.
 * @returns {Object} Cópia rasa dos contadores.
 */
export function estadoDoUso() {
    return {
        ..._estado,
        instalada: _instalacao !== null,
        pendentes: _instalacao?.pendentes?.() ?? 0,
    };
}

/**
 * A FAMÍLIA do navegador, a partir do `userAgent`.
 *
 * GROSSA DE PROPÓSITO: cinco valores, sem versão e sem sistema operacional. A pergunta que ela
 * responde é a primeira de todo diagnóstico de tela ("acontece só no Edge?"), e a `userAgent`
 * inteira é uma impressão digital razoavelmente única — num relatório agregado ela seria a única
 * coluna capaz de reidentificar uma pessoa. O relato de ERRO carrega a string inteira porque lá
 * ela é sobre UM defeito e o leitor é o administrador; aqui o dado é agregado e fica para sempre.
 *
 * A ORDEM DOS RAMOS É O CONTRATO, e ela é o avesso da intuição: o Edge se anuncia como Chrome
 * (`Edg/`), e o Chrome se anuncia como Safari (`Safari/`). Testar na ordem alfabética classifica
 * todo Edge como Chrome e todo Chrome como Safari, sem erro nenhum.
 * @param {*} ua
 * @returns {string} `chrome`, `firefox`, `safari`, `edge` ou `outro`. Nunca mais que 40 caracteres.
 */
export function familiaDoNavegador(ua) {
    try {
        const texto = typeof ua === 'string' ? ua : '';
        if (!texto) return 'outro';
        if (/\bEdg[A-Za-z]*\//.test(texto)) return 'edge';
        if (/\b(Chrome|CriOS|Chromium)\//.test(texto)) return 'chrome';
        if (/\b(Firefox|FxiOS)\//.test(texto)) return 'firefox';
        if (/\bSafari\//.test(texto)) return 'safari';
        return 'outro';
    } catch {
        return 'outro';
    }
}

/**
 * Um número inteiro não negativo, ou `null`.
 * @param {*} v
 * @returns {number|null}
 */
function inteiroOuNulo(v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
    return Math.round(v);
}

/**
 * As vitais, recortadas nas QUATRO chaves do contrato.
 *
 * O RECORTE É POR ALLOWLIST e não por cópia, porque uma chave a mais custa o lote inteiro num 422
 * (ver a propriedade 4). `cls` é o único que não é inteiro: ele é uma razão adimensional que vive
 * abaixo de 1, e arredondá-lo o zeraria.
 * @param {*} lidas
 * @returns {Object|null} `null` quando nenhuma das quatro existe.
 */
function recortarVitais(lidas) {
    if (!lidas || typeof lidas !== 'object' || Array.isArray(lidas)) return null;
    const saida = {};
    const lcp = inteiroOuNulo(lidas.lcpMs);
    if (lcp !== null) saida.lcpMs = lcp;
    const inp = inteiroOuNulo(lidas.inpMs);
    if (inp !== null) saida.inpMs = inp;
    if (typeof lidas.cls === 'number' && Number.isFinite(lidas.cls) && lidas.cls >= 0) {
        saida.cls = Math.round(lidas.cls * 1000) / 1000;
    }
    const ate = inteiroOuNulo(lidas.tempoAteMapaMs);
    if (ate !== null) saida.tempoAteMapaMs = ate;
    return Object.keys(saida).length > 0 ? saida : null;
}

/**
 * O CORPO DO LOTE, e ele é a única coisa que monta o corpo.
 *
 * PURA E EXPORTADA para que a forma seja testável sem transporte nenhum: o modo de falha que ela
 * existe para impedir (uma chave a mais, um `null` onde o Joi espera ausência) não aparece em
 * teste de comportamento, só em comparação de chaves.
 *
 * O CAMPO AUSENTE É AUSENTE, e nunca `null`: `release`, `navegador`, `erros` e `vitais` são
 * opcionais no schema, e mandar `null` num opcional é a forma mais barata de descobrir que
 * `Joi.number()` não aceita `null`.
 *
 * AS LINHAS SAEM ORDENADAS PELA MAIOR CONTAGEM, e é isso que dá sentido ao corte no teto: se
 * cinquenta e uma linhas existirem, a que fica de fora é a que menos aconteceu.
 * @param {Object} entrada
 * @param {string} entrada.sessaoId
 * @param {string} entrada.pagina
 * @param {*} [entrada.release]
 * @param {*} [entrada.navegador]
 * @param {number} entrada.inicio
 * @param {number} entrada.ultimoSinal
 * @param {Array<{evento: string, prop?: string, contagem: number}>} entrada.eventos
 * @param {*} [entrada.erros]
 * @param {*} [entrada.vitais]
 * @returns {{corpo: Object, truncados: number}}
 */
export function montarCorpoDeUso({
    sessaoId,
    pagina,
    release,
    navegador,
    inicio,
    ultimoSinal,
    eventos,
    erros,
    vitais,
} = {}) {
    const linhas = (Array.isArray(eventos) ? eventos : [])
        .filter((l) => l && eventoDeUsoValido(l.evento) && inteiroOuNulo(l.contagem) > 0)
        .sort((a, b) => b.contagem - a.contagem
            || a.evento.localeCompare(b.evento)
            || String(a.prop ?? '').localeCompare(String(b.prop ?? '')));
    const truncados = Math.max(0, linhas.length - MAX_LINHAS_DO_LOTE);

    const corpo = {
        sessaoId: String(sessaoId ?? ''),
        pagina: paginaDeUsoValida(pagina) ? pagina : PAGINAS[0],
        inicio: inteiroOuNulo(inicio) ?? 0,
        ultimoSinal: inteiroOuNulo(ultimoSinal) ?? 0,
        eventos: linhas.slice(0, MAX_LINHAS_DO_LOTE).map((l) => (
            typeof l.prop === 'string' && l.prop !== ''
                ? { evento: l.evento, prop: l.prop, contagem: Math.round(l.contagem) }
                : { evento: l.evento, contagem: Math.round(l.contagem) }
        )),
    };

    if (typeof release === 'string' && release.trim() !== '') {
        // APARADA NO TETO DO SERVIDOR, como o `navegador` logo abaixo. `versaoDoBuild` já corta
        // em 100, mas ela é injetável e este é o ponto que monta o corpo: uma release longa
        // custaria o lote inteiro num 422 por causa do campo mais dispensável dele.
        corpo.release = release.trim().slice(0, MAX_RELEASE);
    }
    if (typeof navegador === 'string' && navegador.trim() !== '') {
        corpo.navegador = navegador.trim().slice(0, 40);
    }
    const contagemDeErros = inteiroOuNulo(erros);
    if (contagemDeErros !== null) corpo.erros = contagemDeErros;
    const vitaisRecortadas = recortarVitais(vitais);
    if (vitaisRecortadas) corpo.vitais = vitaisRecortadas;

    return { corpo, truncados };
}

/**
 * A chave de uma linha do lote. O separador é ` ` porque nem evento nem `prop` podem
 * contê-lo (os dois são vocabulário fechado ou casam {@link RE_PROP_LIVRE}), e um separador
 * comum (`:`, `|`) funde duas linhas diferentes no dia em que um valor o contiver.
 * @param {string} evento @param {string} prop @returns {string}
 */
function chaveDaLinha(evento, prop) {
    return `${evento} ${prop}`;
}

/**
 * Instala a telemetria de uso: acumulador, gatilhos de descarga e timer. Idempotente.
 *
 * TUDO É INJETÁVEL porque a única forma honesta de testar os gatilhos é dirigindo os manipuladores
 * de verdade contra um alvo de mentira: um teste que chamasse `descarregarUso()` à mão não
 * provaria que o `pagehide` foi assinado.
 *
 * @param {Object} [opcoes]
 * @param {string} [opcoes.pagina] - Uma de `PAGINAS`. Fora delas, a instalação é RECUSADA: o
 *   servidor agrupa por página, e um valor inventado custaria o lote num 422.
 * @param {string} [opcoes.sessaoId] - O id desta aba.
 * @param {*} [opcoes.release] - `versao+hash`, quando o build a carimbou.
 * @param {*} [opcoes.navegador] - Já reduzido a família (ver {@link familiaDoNavegador}).
 * @param {(corpo: Object, url: string) => (boolean|Promise|void)} [opcoes.enviar] - Transporte.
 * @param {() => number} [opcoes.agora] - Relógio.
 * @param {number} [opcoes.intervaloMs] - Espera entre descargas.
 * @param {() => number} [opcoes.erros] - Quantos erros esta sessão capturou (`estadoDaTelemetria`).
 * @param {() => Object} [opcoes.vitais] - As Web Vitals desta página (`vitais.ler()`).
 * @param {() => string} [opcoes.resolverBase] - De onde sai a base da API.
 * @param {Object} [opcoes.alvo] - Quem emite `pagehide` (padrão: `globalThis`).
 * @param {Object} [opcoes.documento] - Quem emite `visibilitychange` e diz `visibilityState`.
 * @returns {{instalada: boolean, desinstalar: () => void}}
 */
export function configurarUso({
    pagina,
    sessaoId = '',
    release = null,
    navegador = null,
    enviar = null,
    agora = () => Date.now(),
    intervaloMs = INTERVALO_PADRAO_MS,
    erros = null,
    vitais = null,
    resolverBase = () => '',
    alvo = globalThis,
    documento = globalThis.document,
} = {}) {
    try {
        if (_instalacao) return { instalada: false, desinstalar: _instalacao.desinstalar };
        // DUAS COISAS RECUSAM A INSTALAÇÃO, e as duas pelo mesmo motivo: elas são obrigatórias
        // no corpo, então sem elas TODO lote desta página sairia para receber 422. Recusar de
        // uma vez, contando, é melhor que gastar um pedido a cada trinta segundos por uma sessão
        // inteira; e é MUITO melhor que o desfecho silencioso, em que `sendBeacon` devolve
        // `true` (ele fala da fila do navegador, não da resposta) e `lotesEnviados` sobe sobre
        // lotes que o servidor recusou um a um.
        //
        // A página não tem eixo de corte substituto; o id da aba não tem como ser inventado aqui
        // (cunhá-lo faria cada carga de página virar uma sessão nova e sem relação com o relato
        // de erro, que usa o MESMO id).
        if (!paginaDeUsoValida(pagina) || !RE_SESSAO.test(String(sessaoId ?? ''))) {
            _estado.falhasInternas++;
            return { instalada: false, desinstalar: () => {} };
        }

        /** @type {Map<string, {evento: string, prop: string, contagem: number}>} */
        const contagens = new Map();
        const inicio = numeroDoRelogio(agora);

        /**
         * O transporte padrão: `sendBeacon` quando existe, `fetch` com `keepalive` quando não.
         *
         * `sendBeacon` É O PRIMEIRO PORQUE ELE SOBREVIVE À SAÍDA DA PÁGINA, que é justamente o
         * instante da descarga que mais importa: o `pagehide` é o único gatilho que vê o lote
         * inteiro de uma sessão curta. Um `fetch` disparado ali é cancelado pelo navegador em
         * muitos casos, mesmo com `keepalive`.
         *
         * O `Blob` COM `type: 'application/json'` NÃO É DETALHE: um `sendBeacon` de string crua
         * viaja como `text/plain`, e o `express.json()` do servidor não o analisa — o corpo chega
         * vazio e o Joi recusa. Foi por isso que o tipo entrou no contrato desta função.
         *
         * SEM CREDENCIAL LIDA DAQUI, como no relato de erro: a rota aceita anônimo, e o cookie de
         * sessão (quando existe) viaja por ser de mesma origem.
         * @param {Object} corpo @param {string} url @returns {boolean|Promise|undefined}
         */
        const envioPadrao = (corpo, url) => {
            const json = JSON.stringify(corpo);
            const navegadorDaPagina = alvo?.navigator ?? globalThis.navigator;
            if (typeof navegadorDaPagina?.sendBeacon === 'function'
                && typeof alvo?.Blob === 'function') {
                return navegadorDaPagina.sendBeacon(
                    url,
                    new alvo.Blob([json], { type: 'application/json' }),
                );
            }
            const fn = alvo?.fetch ?? globalThis.fetch;
            if (typeof fn !== 'function') return undefined;
            // `.call(alvo)`: `fetch` desamarrado do `window` é "Illegal invocation" em alguns
            // navegadores. Mesma nota do transporte do relato de erro.
            return fn.call(alvo ?? globalThis, url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: json,
                keepalive: true,
            });
        };

        const transporte = typeof enviar === 'function' ? enviar : envioPadrao;

        /**
         * Acumula UMA ocorrência. Nunca lança.
         * @param {*} evento @param {*} prop @returns {boolean}
         */
        const registrar = (evento, prop) => {
            try {
                if (!eventoDeUsoValido(evento) || !propDeUsoValida(evento, prop)) {
                    _estado.descartados++;
                    return false;
                }
                const limpa = typeof prop === 'string' ? prop : '';
                const chave = chaveDaLinha(evento, limpa);
                const linha = contagens.get(chave) ?? { evento, prop: limpa, contagem: 0 };
                linha.contagem++;
                contagens.set(chave, linha);
                _estado.registrados++;
                return true;
            } catch {
                _estado.falhasInternas++;
                return false;
            }
        };

        /**
         * DRENA e manda. Nunca lança, nunca rejeita.
         *
         * A DRENAGEM ACONTECE ANTES DO ENVIO, e o desfecho de uma recusa DEPENDE DE QUAL RECUSA
         * FOI (ver a propriedade 3 do `fileoverview`). São dois ramos porque são duas coisas
         * diferentes:
         *
         *   - **`sendBeacon` devolvendo o literal `false` significa NÃO ENFILEIRADO**, e é uma
         *     resposta SÍNCRONA do navegador (a fila de beacons está cheia, o corpo passou do
         *     limite). Nada foi transmitido, e é certeza: repor as contagens não pode duplicar
         *     nada, e descartá-las perde uso que aconteceu de verdade. Este ramo REPÕE.
         *   - **Uma promessa, ou qualquer outra resposta, é INCERTA.** Um `fetch` com `keepalive`
         *     pode ter CHEGADO ao servidor e falhado só na leitura da resposta, e repor o lote ali
         *     produz contagem DUPLA, que num relatório agregado é indistinguível de uso real.
         *     Este ramo DESCARTA, e é a decisão de errar para menos.
         *
         * A REPOSIÇÃO MESCLA por {@link chaveDaLinha} em vez de sobrescrever: entre a drenagem e a
         * resposta síncrona não há `await`, mas o gatilho de `pagehide` pode ter corrido no meio
         * de um `descarregar` do timer, e sobrescrever apagaria o que chegou depois.
         * @param {{motivo?: string}} [opcoes]
         * @returns {boolean} Se um lote foi produzido (não se ele chegou).
         */
        const descarregar = ({ motivo } = {}) => {
            try {
                if (contagens.size === 0) return false;
                const linhas = [...contagens.values()];
                contagens.clear();

                const { corpo, truncados } = montarCorpoDeUso({
                    sessaoId,
                    pagina,
                    release,
                    navegador,
                    inicio,
                    ultimoSinal: numeroDoRelogio(agora),
                    eventos: linhas,
                    // O CONTADOR DE ERROS VEM DE FORA E NO ÚLTIMO INSTANTE: ele é o `capturados`
                    // da telemetria de erro, e o que a tela quer saber é quantas sessões TIVERAM
                    // erro, não quantas tinham erro quando o lote foi criado.
                    erros: lerNumero(erros),
                    vitais: lerObjeto(vitais),
                });
                if (truncados > 0) _estado.truncados += truncados;
                if (corpo.eventos.length === 0) return false;

                /** Devolve ao acumulador o que o navegador garantiu NÃO ter transmitido. */
                const repor = () => {
                    for (const l of linhas) {
                        const chave = chaveDaLinha(l.evento, l.prop);
                        const atual = contagens.get(chave);
                        if (atual) atual.contagem += l.contagem;
                        else contagens.set(chave, l);
                    }
                    _estado.lotesRepostos++;
                };

                const url = `${textoDaBase(resolverBase)}${ROTA_DE_USO}`;
                let resposta;
                try {
                    resposta = transporte(corpo, url, { motivo });
                } catch {
                    // EXCEÇÃO SÍNCRONA é o mesmo caso do `false`: nada saiu, e sabe-se disso.
                    _estado.lotesPerdidos++;
                    repor();
                    return true;
                }
                // A PROMESSA NUNCA FICA SEM `catch`: uma rejeição solta vira
                // `unhandledrejection`, que é um evento que a telemetria de ERRO assina — a
                // telemetria de uso passaria a fabricar defeitos.
                if (resposta && typeof resposta.then === 'function') {
                    resposta.then(
                        (r) => { contarDesfecho(r); },
                        () => { _estado.lotesPerdidos++; },
                    );
                } else {
                    contarDesfecho(resposta);
                    // SÓ O LITERAL `false`: ver o JSDoc acima. `undefined` (transporte injetado)
                    // e qualquer outra coisa são INCERTOS, e incerto descarta.
                    if (resposta === false) repor();
                }
                return true;
            } catch {
                _estado.falhasInternas++;
                return false;
            }
        };

        /** O timer periódico: só gasta pedido quando há o que mandar. */
        const agendar = alvo?.setInterval ?? globalThis.setInterval;
        const cancelar = alvo?.clearInterval ?? globalThis.clearInterval;
        let temporizador = null;
        if (typeof agendar === 'function' && Number.isFinite(intervaloMs) && intervaloMs > 0) {
            temporizador = agendar.call(alvo ?? globalThis, () => {
                descarregar({ motivo: 'intervalo' });
            }, intervaloMs);
        }

        /**
         * `pagehide` E NÃO `beforeunload`/`unload`: os dois últimos não disparam no iOS e são
         * ignorados por navegador com cache de retorno. `pagehide` é o único evento de saída que
         * dispara em todas as formas de deixar a página.
         */
        const aoSair = () => { descarregar({ motivo: 'saida' }); };
        /**
         * A ABA ESCONDIDA É A OUTRA METADE, e ela é a que de fato acontece: no telefone e no
         * desktop, trocar de aba é muito mais frequente que fechar, e uma aba escondida pode ser
         * congelada pelo navegador sem nunca disparar `pagehide`.
         */
        const aoEsconder = () => {
            if (documento?.visibilityState === 'hidden') descarregar({ motivo: 'oculta' });
        };

        if (typeof alvo?.addEventListener === 'function') {
            alvo.addEventListener('pagehide', aoSair);
        }
        if (typeof documento?.addEventListener === 'function') {
            documento.addEventListener('visibilitychange', aoEsconder);
        }

        const desinstalar = () => {
            try {
                if (temporizador !== null && typeof cancelar === 'function') {
                    cancelar.call(alvo ?? globalThis, temporizador);
                }
                alvo?.removeEventListener?.('pagehide', aoSair);
                documento?.removeEventListener?.('visibilitychange', aoEsconder);
            } catch {
                // Alvo já destruído: não há o que soltar.
            }
            _instalacao = null;
        };

        _instalacao = {
            desinstalar,
            registrar,
            descarregar,
            pendentes: () => contagens.size,
        };
        return { instalada: true, desinstalar };
    } catch {
        _estado.falhasInternas++;
        return { instalada: false, desinstalar: () => {} };
    }
}

/**
 * Conta o desfecho de um envio.
 *
 * TOLERANTE COM O QUE NÃO É RESPOSTA, como `respostaEntregue` do relato de erro: `sendBeacon`
 * devolve booleano, um transporte injetado devolve `undefined`, e tratar "não sei" como falha
 * inflaria `lotesPerdidos` até ele deixar de significar alguma coisa.
 * @param {*} resposta
 */
function contarDesfecho(resposta) {
    try {
        if (resposta === false) {
            _estado.lotesPerdidos++;
            return;
        }
        if (resposta && typeof resposta === 'object' && typeof resposta.ok === 'boolean'
            && !resposta.ok) {
            _estado.lotesPerdidos++;
            return;
        }
        _estado.lotesEnviados++;
    } catch {
        _estado.falhasInternas++;
    }
}

/** @param {*} fn @returns {number} */
function numeroDoRelogio(fn) {
    try {
        const v = typeof fn === 'function' ? fn() : Date.now();
        return Number.isFinite(v) ? Math.round(v) : 0;
    } catch {
        return 0;
    }
}

/** @param {*} fn @returns {number|null} */
function lerNumero(fn) {
    try {
        return typeof fn === 'function' ? fn() : null;
    } catch {
        return null;
    }
}

/** @param {*} fn @returns {Object|null} */
function lerObjeto(fn) {
    try {
        return typeof fn === 'function' ? fn() : null;
    } catch {
        return null;
    }
}

/** @param {*} fn @returns {string} */
function textoDaBase(fn) {
    try {
        const base = typeof fn === 'function' ? fn() : '';
        return typeof base === 'string' ? base : '';
    } catch {
        return '';
    }
}

/**
 * REGISTRA UMA OCORRÊNCIA DE USO. É a única porta, e ela nunca lança.
 *
 * ANTES DA INSTALAÇÃO ELA É INERTE, E CONTA, exatamente como `relatarErro`: os sítios de chamada
 * estão espalhados por ferramentas que várias suítes carregam sozinhas, e três das quatro páginas
 * montam coisas antes de qualquer instalação existir. Um `naoInstalado` alto é um fato sobre a
 * FIAÇÃO, não sobre o uso.
 * @param {string} evento - Um valor de {@link EventoDeUso}. Nunca um literal de string: ver o
 *   censo em `frontend/tests/unit/registro-de-uso-censo.test.js`.
 * @param {string} [prop] - O segundo campo, quando o evento tem um.
 * @returns {boolean} Se a ocorrência foi contada.
 */
export function registrarUso(evento, prop) {
    try {
        if (!_instalacao?.registrar) {
            _estado.naoInstalado++;
            return false;
        }
        return _instalacao.registrar(evento, prop);
    } catch {
        _estado.falhasInternas++;
        return false;
    }
}

/**
 * Manda agora o que estiver acumulado.
 *
 * QUEM CHAMA À MÃO É QUEM SABE QUE NÃO HAVERÁ OUTRA CHANCE: a tela de indisponibilidade (ver o
 * `fileoverview` sobre o que essa descarga de fato consegue contar). O resto do produto deixa os
 * gatilhos trabalharem.
 * @param {{motivo?: string}} [opcoes]
 * @returns {boolean} Se um lote foi produzido (não se ele chegou).
 */
export function descarregarUso({ motivo } = {}) {
    try {
        if (!_instalacao?.descarregar) {
            _estado.naoInstalado++;
            return false;
        }
        return _instalacao.descarregar({ motivo });
    } catch {
        _estado.falhasInternas++;
        return false;
    }
}

/**
 * Desfaz a instalação. Existe para o teste e para o HMR; o produto não a chama.
 * @returns {void}
 */
export function desinstalarUso() {
    try {
        _instalacao?.desinstalar?.();
    } catch {
        _estado.falhasInternas++;
    }
}

export { EventoDeUso, EVENTOS_DE_USO, PAGINAS };
