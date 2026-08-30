// Path: js/session/erro-telemetria.js

/**
 * @fileoverview A FIAÇÃO da telemetria de erro: ouve o navegador e manda o fato ao servidor, best
 * effort. A DECISÃO (assinatura, dedupe, teto, intervalo) mora em `erro-telemetria-assinatura.js`,
 * que é folha e testável em node puro; aqui fica só o que precisa de `window` e de rede.
 *
 * O QUE ELE FECHA: erro de navegador não era registrado em lugar nenhum. A evidência de um defeito
 * chegava como texto colado do console (dezenove linhas, no incidente que originou isto), e chegava
 * só quando alguém estava olhando o console — ou seja, quase nunca.
 *
 * AS QUATRO PROPRIEDADES QUE VALEM MAIS QUE O RECURSO, porque um capturador de erro que falha é
 * pior que capturador nenhum:
 *
 *   1. NUNCA LANÇA. Todo caminho daqui está dentro de `try`, inclusive o que monta o corpo. Um erro
 *      levantado dentro do manipulador de erro do `window` vira um erro não tratado sobre o qual
 *      não há mais ninguém para falar.
 *   2. NÃO REENTRA. Se o envio falhar de um jeito que produza um erro global, ele não pode disparar
 *      outra captura: isso é um laço infinito que derruba o navegador da pessoa e inunda o servidor
 *      ao mesmo tempo. A guarda é síncrona ({@link _dentroDoCapturador}) e o envio nunca devolve
 *      promessa rejeitada, que são as duas metades do laço.
 *   3. DEDUPLICA E LIMITA. Uma assinatura por sessão, teto de sessão e intervalo mínimo — o
 *      limitador, no módulo de decisão.
 *   4. NÃO PARTICIPA DO BOOT. `instalarTelemetriaDeErro()` é síncrona, não faz requisição nenhuma e
 *      devolve na hora; ela é chamada ANTES de tudo nas quatro páginas justamente para pegar erro
 *      de boot. Se ela falhar inteira, ou se a rota não existir, o app sobe igual: o boot do MAPA
 *      continua fail-fast em `GET /api/config` e nada aqui participa daquela decisão.
 *
 * NÃO É UM CANAL DE DIAGNÓSTICO INTERATIVO, e não se confunde com o SyncLedger (`store/sync/diag/`),
 * que é gateado por bandeira e morre em produção. Este roda sempre, para todo mundo, anônimo
 * inclusive, e por isso o teto de vinte envios por sessão é a peça de que ele menos pode abrir mão.
 */

// Por ARQUIVO, e a peça que JÁ EXISTE: a base da API nunca se escreve fixa aqui, porque ela tem um
// override de bancada (`__EBGEO_BACKEND_URL__`) e um padrão de mesma origem, e uma segunda cópia
// dessa regra divergiria da primeira em silêncio.
import { resolveBackendBaseUrl } from '@store/sync/runtime-config.js';
// Módulo FOLHA de zero imports (o `fileoverview` dele declara esse contrato): é a identidade do
// atlas sob o qual o cliente está perguntando, e é o que responde "em qual atlas isto quebrou".
// Nada de `syncEngine` aqui — aquele arrasta a store, e três das quatro páginas bootam sem ela.
import { currentResourceAtlasId } from '@store/sync/resource-scope.js';
import {
    assinaturaDeErro,
    criarLimitador,
    montarCorpo,
    paginaDaUrl,
    textoDeErro,
} from './erro-telemetria-assinatura.js';

/** O caminho da rota, sob a base que `resolveBackendBaseUrl()` devolve. */
const ROTA = '/diag/erro-cliente';

/**
 * A instalação viva, ou `null`. Módulo-global de propósito: as quatro páginas instalam uma vez cada,
 * e uma segunda chamada na mesma página (um `import()` repetido, uma recarga parcial de HMR) tem de
 * ser inerte em vez de dobrar os manipuladores.
 * @type {{ desinstalar: () => void }|null}
 */
let _instalacao = null;

/**
 * A guarda de reentrância. Módulo-global, e não por instalação, porque o laço que ela impede não
 * respeita fronteira de instância: é o mesmo `window`.
 */
let _dentroDoCapturador = false;

/** O que aconteceu com a telemetria nesta sessão. Só cresce; lido por {@link estadoDaTelemetria}. */
const _estado = {
    capturados: 0,
    enviados: 0,
    duplicadas: 0,
    teto: 0,
    intervalo: 0,
    reentrancias: 0,
    falhasDeEnvio: 0,
    falhasInternas: 0,
};

/**
 * O que a telemetria fez até agora.
 *
 * ELA CONTA O QUE ENGOLIU, e é por isso que existe. Todo caminho de falha daqui é silencioso por
 * desenho (um aviso na tela sobre a telemetria seria o subsistema roubando a cena do defeito de
 * verdade), e um subsistema silencioso sem contador é um subsistema que ninguém consegue afirmar
 * que está vivo. Ler `enviados: 0, capturados: 0` no console é a diferença entre "não houve erro"
 * e "o capturador não está instalado".
 * @returns {Object} Cópia rasa dos contadores.
 */
export function estadoDaTelemetria() {
    return { ..._estado, instalada: _instalacao !== null };
}

/**
 * A versão do build, quando existe.
 *
 * `__APP_VERSION__` é substituído textualmente pelo Vite (`define`, em `vite.config.js`), e vem do
 * `version` do `package.json` — NÃO é o commit. É o único carimbo de build que o repositório tem
 * hoje, e é o `typeof` que o torna utilizável: fora do bundle (vitest em node puro, por exemplo) o
 * identificador não existe, e uma leitura crua seria `ReferenceError` dentro do capturador de erro,
 * que é o pior lugar possível para um.
 * @returns {string|null}
 */
function versaoDoBuild() {
    try {
        return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : null;
    } catch {
        return null;
    }
}

/**
 * Instala a captura de erro do navegador. Síncrona, sem rede, e idempotente.
 *
 * Tudo é injetável porque a única forma honesta de testar as quatro propriedades é dirigindo os
 * manipuladores de verdade contra um `window` de mentira: um teste que chamasse uma função interna
 * não provaria que o `addEventListener` foi feito.
 *
 * @param {Object} [opcoes]
 * @param {Object} [opcoes.alvo] - Quem emite os eventos (padrão: `globalThis`).
 * @param {(corpo: Object) => (Promise|void)} [opcoes.enviar] - Transporte injetável.
 * @param {() => number} [opcoes.agora] - Relógio injetável.
 * @param {number} [opcoes.max] - Teto de envios por sessão.
 * @param {number} [opcoes.intervaloMs] - Espera mínima entre envios.
 * @param {() => (string|null)} [opcoes.resolverAtlasId] - De onde sai o `atlasId`.
 * @param {() => string} [opcoes.resolverBase] - De onde sai a base da API.
 * @returns {{ instalada: boolean, desinstalar: () => void }}
 */
export function instalarTelemetriaDeErro({
    alvo = globalThis,
    enviar = null,
    agora = () => Date.now(),
    max,
    intervaloMs,
    resolverAtlasId = currentResourceAtlasId,
    resolverBase = resolveBackendBaseUrl,
} = {}) {
    // TODO O CORPO DENTRO DO `try`: esta função é a primeira linha do boot das quatro páginas, e
    // uma exceção aqui derrubaria o boot inteiro por causa do subsistema que existe para OBSERVAR
    // o boot. O desfecho de uma falha é "não há telemetria", nunca "não há aplicação".
    try {
        if (_instalacao) return { instalada: false, desinstalar: _instalacao.desinstalar };
        if (typeof alvo?.addEventListener !== 'function') {
            return { instalada: false, desinstalar: () => {} };
        }

        const limitador = criarLimitador({ max, intervaloMs, agora });

        /**
         * O transporte padrão. `keepalive` porque um erro levantado durante a saída da página é
         * justamente o que ninguém consegue reproduzir depois; o corpo cabe folgado no limite de
         * 64 kB dessa opção, porque os tetos já cortaram tudo.
         *
         * SEM CREDENCIAL LIDA DAQUI, e sem `Authorization`: quem está falando é assunto do cookie
         * de sessão, que o `fetch` de mesma origem anexa por padrão. A rota aceita anônimo, e ler
         * o token do `localStorage` exigiria arrastar o cliente HTTP para dentro do capturador.
         * @param {Object} corpo
         * @returns {Promise|undefined}
         */
        const envioPadrao = (corpo) => {
            const fn = alvo?.fetch ?? globalThis.fetch;
            if (typeof fn !== 'function') return undefined;
            // `.call(alvo)`: `fetch` desamarrado do `window` é "Illegal invocation" em alguns
            // navegadores.
            return fn.call(alvo ?? globalThis, `${resolverBase()}${ROTA}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(corpo),
                keepalive: true,
            });
        };

        const transporte = typeof enviar === 'function' ? enviar : envioPadrao;

        /**
         * Despacha e ENGOLE, nos dois sentidos: a exceção síncrona e a promessa rejeitada. A
         * segunda é a que fecha o laço — uma promessa rejeitada sem `catch` vira um
         * `unhandledrejection`, que é exatamente o evento que este módulo assina.
         * @param {Object} corpo
         */
        const despachar = (corpo) => {
            try {
                const resultado = transporte(corpo);
                if (resultado && typeof resultado.then === 'function') {
                    resultado.then(undefined, () => { _estado.falhasDeEnvio++; });
                }
            } catch {
                _estado.falhasDeEnvio++;
            }
        };

        /**
         * O caminho inteiro de uma captura. Nunca lança, nunca reentra.
         * @param {*} valor - O erro, ou a razão da rejeição.
         */
        const capturar = (valor) => {
            if (_dentroDoCapturador) {
                _estado.reentrancias++;
                return;
            }
            _dentroDoCapturador = true;
            try {
                _estado.capturados++;
                const { mensagem, stack } = textoDeErro(valor);
                // A MESMA assinatura serve o limitador e o corpo: recalculá-la lá embaixo abriria
                // a possibilidade de o cliente deduplicar por uma chave e o servidor agrupar por
                // outra, que é a divergência que ninguém percebe olhando um gráfico.
                const assinatura = assinaturaDeErro({ mensagem, stack });
                const veredito = limitador.permite(assinatura);
                if (!veredito.ok) {
                    if (veredito.motivo === 'duplicada') _estado.duplicadas++;
                    else if (veredito.motivo === 'teto') _estado.teto++;
                    else _estado.intervalo++;
                    return;
                }
                const corpo = montarCorpo({
                    assinatura,
                    mensagem,
                    stack,
                    url: alvo?.location?.href ?? '',
                    pagina: paginaDaUrl(alvo?.location?.pathname ?? ''),
                    release: versaoDoBuild(),
                    // O NAVEGADOR, que não é identidade: é a primeira pergunta de todo diagnóstico
                    // de defeito de tela ("acontece só no Edge?").
                    userAgent: alvo?.navigator?.userAgent ?? '',
                    // Best-effort e tolerante: fora de um atlas isto é `null` e o campo some.
                    atlasId: (() => {
                        try {
                            return resolverAtlasId();
                        } catch {
                            return null;
                        }
                    })(),
                });
                _estado.enviados++;
                despachar(corpo);
            } catch {
                _estado.falhasInternas++;
            } finally {
                _dentroDoCapturador = false;
            }
        };

        /**
         * `window.onerror` na forma de evento. O `error` traz o objeto quando existe (com pilha); a
         * `message` é o que sobra para script de outra origem, onde o navegador entrega só
         * "Script error." e nada mais.
         * @param {Object} evento
         */
        const aoErro = (evento) => {
            // FALHA DE CARREGAMENTO DE RECURSO (`<img>`, `<script>`) NÃO É EXCEÇÃO DE CÓDIGO: ela
            // chega com o ELEMENTO como alvo. Ela não borbulha, então este ramo é cinto de
            // segurança para quem um dia registrar em fase de captura.
            if (evento?.target && evento.target !== alvo && evento.target !== alvo?.document) return;
            capturar(evento?.error ?? evento?.message ?? evento);
        };

        /** @param {Object} evento - `PromiseRejectionEvent`. */
        const aoRejeitar = (evento) => capturar(evento?.reason);

        alvo.addEventListener('error', aoErro);
        alvo.addEventListener('unhandledrejection', aoRejeitar);

        const desinstalar = () => {
            try {
                alvo.removeEventListener?.('error', aoErro);
                alvo.removeEventListener?.('unhandledrejection', aoRejeitar);
            } catch {
                // Alvo já destruído: não há o que soltar.
            }
            _instalacao = null;
            _dentroDoCapturador = false;
        };

        _instalacao = { desinstalar };
        return { instalada: true, desinstalar };
    } catch {
        _estado.falhasInternas++;
        return { instalada: false, desinstalar: () => {} };
    }
}
