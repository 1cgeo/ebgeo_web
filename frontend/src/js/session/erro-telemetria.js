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
 * ── AS TRÊS PORTAS, E POR QUE A AUTOMÁTICA NÃO BASTAVA ───────────────────────────────────────
 *
 * Os dois manipuladores do navegador (`error` e `unhandledrejection`) só veem o que NINGUÉM pegou,
 * e o produto pega quase tudo: um `catch` que mostra um toast, um `.catch(() => {})` que degrada,
 * um `console.error` no meio de um caminho de falha. Esses são justamente os defeitos que a pessoa
 * VÊ e que a telemetria não via. Daí as outras duas portas: {@link relatarErro}, chamada à mão por
 * quem pegou o erro e sabe algo que o navegador não sabe (de qual subsistema ele veio), e o
 * embrulho de `console.error`, que pega o que foi engolido sem que ninguém precise se lembrar.
 *
 * AS TRÊS ATRAVESSAM O MESMO PORTÃO: mesmo limitador, mesma guarda de reentrância, mesma
 * assinatura. A `origem` é ETIQUETA e não entra na chave (o mesmo defeito entra por duas portas o
 * tempo todo, e dois grupos para um defeito é a divergência que ninguém percebe olhando um
 * gráfico); o porquê por extenso está em `session/origens-de-erro.js`.
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
// Os três vizinhos, todos folhas de zero imports pelo mesmo motivo (quatro páginas, três sem store).
import { sessaoId as sessaoIdPadrao } from './sessao-id.js';
import { filaDeRelatos } from './fila-de-relatos.js';
import { OrigemDeErro, origemDoCliente } from './origens-de-erro.js';
// A trilha das migalhas, também folha de zero imports. Ela é ALIMENTADA de três pontos daqui (o
// embrulho de `console.error`, o de `console.warn` e a navegação da instalação) e LIDA num só, na
// montagem do corpo.
import { migalhas, configurarMigalhas, TipoDeMigalha } from './migalhas.js';
import {
    MotivoDeEnvio,
    assinaturaDeErro,
    criarLimitador,
    montarCorpo,
    normalizarMensagem,
    paginaDaUrl,
    textoDeErro,
} from './erro-telemetria-assinatura.js';

/** O caminho da rota, sob a base que `resolveBackendBaseUrl()` devolve. */
const ROTA = '/diag/erro-cliente';

/**
 * A instalação viva, ou `null`. Módulo-global de propósito: as quatro páginas instalam uma vez cada,
 * e uma segunda chamada na mesma página (um `import()` repetido, uma recarga parcial de HMR) tem de
 * ser inerte em vez de dobrar os manipuladores.
 * @type {{ desinstalar: () => void, capturar: Function, drenar: () => Promise<number> }|null}
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
    // Relatos que a rede recusou e que ficaram guardados para a próxima carga da página.
    enfileirados: 0,
    // Relatos de uma carga ANTERIOR que finalmente chegaram ao servidor.
    descarregados: 0,
    // Chamadas a {@link relatarErro} feitas antes de haver instalação. Um relato que não vira
    // envio precisa virar número, senão o subsistema que existe para acabar com o silêncio ganha
    // um silêncio próprio.
    naoInstalado: 0,
    // Relatos que o SERVIDOR recusou por defeito do relato (4xx que não é 408 nem 429). Eles não
    // vão para a fila: reenviar o mesmo corpo no próximo boot receberia a mesma recusa, e a fila
    // tem teto, então cada recusado guardado é um relato legítimo que deixa de caber.
    recusados: 0,
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
    // A TRILHA ENTRA AQUI pelo mesmo argumento do parágrafo acima: ela também engole entrada ruim
    // em silêncio (`descartadas`), e um `tamanho: 0` distingue "nada aconteceu" de "os
    // alimentadores não estão ligados".
    let trilha = null;
    try {
        trilha = migalhas.estado();
    } catch {
        trilha = null;
    }
    return { ..._estado, instalada: _instalacao !== null, migalhas: trilha };
}

/**
 * A versão do build, quando existe.
 *
 * SÃO DOIS CARIMBOS, e a soma é o que torna o campo utilizável. `__APP_VERSION__` vem do `version`
 * do `package.json` e muda uma vez por lançamento; `__APP_RELEASE__` é o commit curto do HEAD,
 * posto pelo `vite.config.js` no momento do build. Só a versão não identifica build nenhum (dez
 * builds seguidos dizem `1.0.0`), e é justamente entre dois builds da mesma versão que a pergunta
 * "isto já estava quebrado ontem?" se faz. Juntos eles são `1.0.0+a1b2c3d`, que é o que o servidor
 * guarda e o que o sourcemap resolve.
 *
 * OS DOIS SÃO SUBSTITUÍDOS TEXTUALMENTE pelo Vite (`define`), e é o `typeof` que os torna
 * utilizáveis: fora do bundle (vitest em node puro, por exemplo) o identificador não existe, e uma
 * leitura crua seria `ReferenceError` dentro do capturador de erro, que é o pior lugar possível
 * para um. O hash é vazio quando o build rodou sem `git` disponível.
 * @returns {string|null}
 */
export function versaoDoBuild() {
    try {
        const versao = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : null;
        if (!versao) return null;
        const hash = typeof __APP_RELEASE__ === 'string' ? __APP_RELEASE__ : '';
        const completo = hash ? `${versao}+${hash}` : versao;
        return completo.slice(0, 100);
    } catch {
        return null;
    }
}

/**
 * Se uma resposta do transporte conta como entregue.
 *
 * TOLERANTE COM O QUE NÃO É RESPOSTA. Um transporte injetado devolve `undefined`, e `sendBeacon`
 * devolveria um booleano: nesses casos não há o que julgar, e tratar "não sei" como falha encheria
 * a fila de relatos que já chegaram. Só o que se parece com uma `Response` é julgado.
 * @param {*} resposta
 * @returns {boolean}
 */
function respostaEntregue(resposta) {
    try {
        if (!resposta || typeof resposta !== 'object') return true;
        if (typeof resposta.ok === 'boolean') return resposta.ok;
        const status = Number(resposta.status);
        if (Number.isFinite(status) && status > 0) return status >= 200 && status < 300;
        return true;
    } catch {
        return true;
    }
}

/**
 * Whether a report that did NOT get through deserves the queue.
 *
 * A FILA É PARA O QUE PODE DAR CERTO DEPOIS: rede ausente, 5xx do servidor ou do proxy, 408 e
 * 429. Um 4xx de outra natureza é o servidor dizendo que o RELATO está errado (Joi recusou um
 * campo, o corpo passou do teto), e o mesmo corpo no próximo boot recebe a mesma recusa. Guardá-lo
 * ocuparia, para sempre, uma das trinta vagas de um relato que ainda pode chegar; a versão anterior
 * desta regra enfileirava todo não-2xx e teria feito exatamente isso a cada versão do cliente que
 * enviasse um campo que o servidor ainda não conhecia. Resposta sem status legível é tratada como
 * falha de transporte, que é o caso que a fila existe para cobrir.
 * @param {*} resposta
 * @returns {boolean}
 */
function deveEnfileirar(resposta) {
    try {
        if (!resposta || typeof resposta !== 'object') return true;
        const status = Number(resposta.status);
        if (!Number.isFinite(status) || status <= 0) return true;
        if (status >= 500) return true;
        return status === 408 || status === 429;
    } catch {
        return true;
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
 * @param {() => string} [opcoes.resolverSessaoId] - De onde sai o id desta aba.
 * @param {{enfileirar: Function, drenar: Function}} [opcoes.fila] - A fila do que não saiu.
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
    resolverSessaoId = sessaoIdPadrao,
    fila = filaDeRelatos,
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

        // A NORMALIZAÇÃO DA TRILHA SÓ EXISTE A PARTIR DAQUI, e é por isso que ela é injetada em vez
        // de importada lá dentro: `session/migalhas.js` é folha de zero imports porque o cliente
        // HTTP o carrega em node puro (ver o `fileoverview` dele). É a MESMA função que normaliza a
        // mensagem do relato, de propósito: uma segunda regra faria a mesma URL virar dois textos
        // diferentes na mesma linha do banco.
        configurarMigalhas({ normalizar: normalizarMensagem });

        // A PRIMEIRA MIGALHA É ONDE A CARGA COMEÇOU. Sem ela a trilha de um erro de boot começa no
        // meio, e a página é justamente a primeira pergunta ("isto acontece no admin também?"). O
        // caminho vai SEM a query, porque é ali que moram `?verify=` e `?atlasPublico=`, que são
        // credenciais de uso único (o corpo do relato já as oculta, em `urlSegura`).
        try {
            const caminho = String(alvo?.location?.pathname ?? '').split('?')[0].split('#')[0];
            migalhas.registrar(TipoDeMigalha.NAVEGACAO, `${paginaDaUrl(caminho)} ${caminho}`);
        } catch {
            _estado.falhasInternas++;
        }

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

        /** Guarda um relato que não saiu, contando. @param {Object} corpo @returns {boolean} */
        const enfileirar = (corpo) => {
            try {
                if (fila?.enfileirar?.(corpo)) {
                    _estado.enfileirados++;
                    return true;
                }
            } catch {
                // Armazenamento bloqueado: a fila degrada para "não enfileira", como o
                // `fileoverview` dela declara.
            }
            return false;
        };

        /**
         * UM envio, do começo ao fim, e ele nunca rejeita.
         *
         * O QUE FALHA VAI PARA A FILA, e é aqui que "servidor fora" deixa de ser evidência perdida.
         * Falha é a rejeição da promessa E a resposta fora da faixa 2xx: um 502 do proxy reverso
         * descarta o relato tão silenciosamente quanto um cabo arrancado. A EXCEÇÃO é o 4xx que
         * recusa o relato em si ({@link deveEnfileirar}): ele conta como recusado e não é guardado.
         * @param {Object} corpo
         * @returns {Promise<boolean>} Se chegou.
         */
        const enviarUm = async (corpo) => {
            try {
                const resposta = await transporte(corpo);
                if (!respostaEntregue(resposta)) {
                    _estado.falhasDeEnvio++;
                    if (deveEnfileirar(resposta)) enfileirar(corpo);
                    else _estado.recusados++;
                    return false;
                }
                return true;
            } catch {
                _estado.falhasDeEnvio++;
                enfileirar(corpo);
                return false;
            }
        };

        /**
         * Despacha e ENGOLE, nos dois sentidos: a exceção síncrona e a promessa rejeitada. A
         * segunda é a que fecha o laço — uma promessa rejeitada sem `catch` vira um
         * `unhandledrejection`, que é exatamente o evento que este módulo assina. `enviarUm` já
         * trata as duas, então aqui basta não esperar por ela.
         * @param {Object} corpo
         */
        const despachar = (corpo) => {
            const pendente = enviarUm(corpo);
            if (pendente && typeof pendente.then === 'function') pendente.then(undefined, () => {});
        };

        /**
         * O caminho inteiro de uma captura. Nunca lança, nunca reentra.
         * @param {*} valor - O erro, ou a razão da rejeição.
         * @param {Object} [opcoes]
         * @param {string} [opcoes.origem] - Uma das dez de `ORIGENS_DO_CLIENTE`. Etiqueta, não
         *   chave. O vocabulário tem onze; `servidor` não é do cliente.
         * @param {Object} [opcoes.contexto] - As cinco chaves enumeradas; o resto é descartado.
         * @param {boolean} [opcoes.enfileirarSempre] - Ver {@link relatarErro}.
         * @returns {boolean} Se um corpo foi produzido (não se ele chegou).
         */
        const capturar = (valor, { origem, contexto, enfileirarSempre = false } = {}) => {
            if (_dentroDoCapturador) {
                _estado.reentrancias++;
                return false;
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
                    if (veredito.motivo === MotivoDeEnvio.DUPLICADA) _estado.duplicadas++;
                    else if (veredito.motivo === MotivoDeEnvio.TETO) _estado.teto++;
                    else _estado.intervalo++;
                    return false;
                }
                const corpo = montarCorpo({
                    assinatura,
                    mensagem,
                    stack,
                    // A pilha CRUA, ao lado da normalizada: a normalizada agrupa, a crua resolve o
                    // sourcemap daquele build. Ver o `fileoverview` de `montarCorpo`.
                    stackBruta: typeof stack === 'string' ? stack : '',
                    url: alvo?.location?.href ?? '',
                    pagina: paginaDaUrl(alvo?.location?.pathname ?? ''),
                    release: versaoDoBuild(),
                    // O NAVEGADOR, que não é identidade: é a primeira pergunta de todo diagnóstico
                    // de defeito de tela ("acontece só no Edge?").
                    userAgent: alvo?.navigator?.userAgent ?? '',
                    // A ABA, que também não é identidade. Best-effort como os outros.
                    sessaoId: (() => {
                        try {
                            return resolverSessaoId();
                        } catch {
                            return null;
                        }
                    })(),
                    // O VOCABULÁRIO se confere aqui, e não no módulo de decisão (que é folha de
                    // zero imports): uma origem inventada vira a padrão em vez de custar o relato
                    // inteiro num 422.
                    //
                    // `origemDoCliente` E NÃO `origemValida`: são listas diferentes desde que o
                    // vocabulário ganhou `servidor`, que é a origem que o BACKEND escreve ao
                    // registrar na mesma tabela um defeito que ele mesmo viu. Ela é VÁLIDA e não é
                    // do cliente, e mandá-la daqui seria o navegador se passando por servidor.
                    origem: origemDoCliente(origem) ? origem : OrigemDeErro.NAO_TRATADO,
                    contexto,
                    // A TRILHA, lida no ÚLTIMO instante possível: ela precisa conter tudo o que
                    // aconteceu até este erro, e nada do que vier depois. `montarCorpo` a recebe
                    // como valor (ele é folha de zero imports) e aplica os tetos.
                    migalhas: migalhas.listar(),
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
                // ENFILEIRA SEM TENTAR A REDE, quando quem chama já sabe que ela não vai responder:
                // a tela de indisponibilidade É a prova de que o servidor não está lá. Tentar assim
                // mesmo custaria um pedido que falha e chegaria ao mesmo lugar; e tentar E
                // enfileirar mandaria o mesmo relato duas vezes no caso em que o pedido desse
                // certo, que é contagem falsa. Se a fila recusar (armazenamento bloqueado), a rede
                // é o que sobra, e aí vale tentar.
                if (enfileirarSempre && enfileirar(corpo)) return true;
                despachar(corpo);
                return true;
            } catch {
                _estado.falhasInternas++;
                return false;
            } finally {
                _dentroDoCapturador = false;
            }
        };

        /**
         * Manda o que ficou de cargas anteriores, EM SÉRIE.
         *
         * A ORDEM É "TIRA TUDO, DEPOIS TENTA": `drenar()` esvazia a fila antes do primeiro pedido,
         * e o que falhar de novo é reenfileirado por `enviarUm`. Ler-e-apagar-por-item seria mais
         * cuidadoso e mais errado: um fechamento de aba no meio deixaria itens já enviados na fila,
         * e relato duplicado é contagem falsa, que é pior que relato perdido.
         *
         * O TETO DA SESSÃO CONTINUA VALENDO, e um item recusado por ele VOLTA para a fila em vez de
         * morrer: a próxima carga da página tem orçamento novo. O recusado por DUPLICATA não volta,
         * porque essa assinatura já chegou ao servidor nesta sessão.
         * @returns {Promise<number>} Quantos relatos chegaram.
         */
        const drenar = async () => {
            let chegaram = 0;
            let pendentes = [];
            try {
                pendentes = fila?.drenar?.() ?? [];
            } catch {
                pendentes = [];
            }
            for (const corpo of pendentes) {
                if (corpo === null || typeof corpo !== 'object') continue;
                const assinatura = typeof corpo.assinatura === 'string' ? corpo.assinatura : '';
                const veredito = limitador.permite(assinatura, { ignorarIntervalo: true });
                if (!veredito.ok) {
                    if (veredito.motivo === MotivoDeEnvio.DUPLICADA) {
                        _estado.duplicadas++;
                    } else {
                        _estado.teto++;
                        enfileirar(corpo);
                    }
                    continue;
                }
                _estado.enviados++;
                // EM SÉRIE é o desenho, e o `await` dentro do laço é ele: trinta pedidos em
                // paralelo na volta do servidor são a rajada que a fila existe para atrasar, e não
                // para concentrar.
                if (await enviarUm(corpo)) {
                    chegaram++;
                    _estado.descarregados++;
                }
            }
            return chegaram;
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
            capturar(evento?.error ?? evento?.message ?? evento, {
                origem: OrigemDeErro.NAO_TRATADO,
            });
        };

        /** @param {Object} evento - `PromiseRejectionEvent`. */
        const aoRejeitar = (evento) => capturar(evento?.reason, { origem: OrigemDeErro.REJEICAO });

        alvo.addEventListener('error', aoErro);
        alvo.addEventListener('unhandledrejection', aoRejeitar);

        // O EMBRULHO DE `console.error`, e as quatro regras que o tornam seguro.
        //
        //   1. O ORIGINAL É SEMPRE CHAMADO, primeiro e incondicionalmente, mesmo que o relato
        //      falhe: quem depura no console não pode perder uma linha por causa da telemetria.
        //   2. NÃO SE RELATA O QUE A PRÓPRIA TELEMETRIA REGISTRA (`_dentroDoCapturador`), senão um
        //      `console.error` dentro do caminho de captura vira outra captura.
        //   3. SÓ `Error` OU STRING no primeiro argumento. `console.error(objeto)` é quase sempre
        //      um despejo de estado, e despejo de estado é dado de usuário: a regra fecha a mesma
        //      porta que `formaDeValor` fechou do outro lado.
        //   4. O DEDUPE É O DE SEMPRE, e ele é a razão de o `Error` dos argumentos ser PREFERIDO
        //      ao rótulo. A forma dominante no produto é `console.error('falhou:', erro)`, e nos
        //      dois pontos em que ela convive com um relato explícito (o `catch` do boot e o
        //      ouvinte de erro do store) relatar o RÓTULO produziria duas assinaturas para um
        //      defeito só, gastando dois dos vinte envios e criando dois grupos no servidor.
        //      Relatando o mesmo `Error`, a segunda passagem cai como duplicata e some sozinha.
        //      Uma linha de log repetida num laço também é uma assinatura só, porque a mensagem
        //      normaliza antes de virar chave.
        //
        // `console.warn` NÃO VIRA RELATO, e a assimetria continua deliberada: aviso é o canal do
        // esperado (o `WsClient handler ... error`, o "renovação proativa desligada"), e relatá-lo
        // gastaria o teto de vinte envios com coisas que ninguém pediu para saber. O que ele passou
        // a fazer é deixar MIGALHA, que é barato (uma linha no anel, nada de rede) e é exatamente
        // onde o aviso vale: "a conexão avisou três vezes antes de o erro acontecer" é a frase que
        // o relato não conseguia contar.
        const consola = alvo?.console;

        // A MIGALHA DE CONSOLE CARREGA A MENSAGEM COMO ELA FOI ESCRITA, então "nada de conteúdo
        // de usuário" vale no SÍTIO DA CHAMADA: ver a propriedade 3 de `session/migalhas.js`.
        /**
         * O que de um `console.*` pode virar migalha: a primeira string, ou a mensagem do primeiro
         * `Error`. Nada mais. `console.error(objeto)` é quase sempre um despejo de estado, e
         * despejo de estado é dado de usuário: mesma porta que `formaDeValor` fecha do outro lado.
         * @param {Array} args
         * @returns {string} Vazio quando não há nada que possa viajar.
         */
        const textoDoConsole = (args) => {
            try {
                const primeiro = args[0];
                if (primeiro instanceof Error) return String(primeiro.message ?? '');
                if (typeof primeiro === 'string') return primeiro;
                return '';
            } catch {
                return '';
            }
        };

        const erroOriginal = typeof consola?.error === 'function' ? consola.error : null;
        if (erroOriginal) {
            consola.error = function relatarDoConsole(...args) {
                try {
                    erroOriginal.apply(consola, args);
                } catch {
                    // Console sequestrado: não há o que fazer, e não se lança daqui.
                }
                try {
                    if (_dentroDoCapturador) return;
                    const primeiro = args[0];
                    const ehErro = primeiro instanceof Error;
                    const ehTexto = typeof primeiro === 'string' && primeiro.trim() !== '';
                    if (!ehErro && !ehTexto) return;
                    const comPilha = args.find((arg) => arg instanceof Error);
                    capturar(comPilha ?? primeiro, { origem: OrigemDeErro.CONSOLE });
                    // A MIGALHA VEM DEPOIS DA CAPTURA, de propósito: o relato que este mesmo
                    // `console.error` acabou de produzir não pode carregar a si mesmo como última
                    // linha da própria trilha. As migalhas descrevem o que veio ANTES.
                    migalhas.registrar(TipoDeMigalha.CONSOLE, `erro: ${textoDoConsole(args)}`);
                } catch {
                    _estado.falhasInternas++;
                }
            };
        }

        const avisoOriginal = typeof consola?.warn === 'function' ? consola.warn : null;
        if (avisoOriginal) {
            consola.warn = function migalharDoConsole(...args) {
                try {
                    avisoOriginal.apply(consola, args);
                } catch {
                    // Console sequestrado: não há o que fazer, e não se lança daqui.
                }
                try {
                    // A MESMA guarda de reentrância do irmão, e pelo mesmo motivo: um
                    // `console.warn` de dentro do caminho de captura descreveria a telemetria, não
                    // o produto.
                    if (_dentroDoCapturador) return;
                    const texto = textoDoConsole(args);
                    if (!texto.trim()) return;
                    migalhas.registrar(TipoDeMigalha.CONSOLE, `aviso: ${texto}`);
                } catch {
                    _estado.falhasInternas++;
                }
            };
        }

        const desinstalar = () => {
            try {
                alvo.removeEventListener?.('error', aoErro);
                alvo.removeEventListener?.('unhandledrejection', aoRejeitar);
                if (erroOriginal) consola.error = erroOriginal;
                if (avisoOriginal) consola.warn = avisoOriginal;
            } catch {
                // Alvo já destruído: não há o que soltar.
            }
            _instalacao = null;
            _dentroDoCapturador = false;
        };

        _instalacao = { desinstalar, capturar, drenar };
        return { instalada: true, desinstalar };
    } catch {
        _estado.falhasInternas++;
        return { instalada: false, desinstalar: () => {} };
    }
}

/**
 * RELATA UM ERRO À MÃO, pela mesma porta dos automáticos.
 *
 * PARA QUE ELA EXISTE: os dois manipuladores do navegador só veem o que ninguém pegou, e o produto
 * pega quase tudo. O erro que o `catch` do boot registrou, a falha de persistência que virou toast,
 * o socket que caiu, o tile que não desenhou: todos são invisíveis para o `window`, e todos são
 * exatamente o que se quer saber. Quem chama aqui sabe uma coisa a mais que o navegador, de qual
 * subsistema o erro veio, e é isso que a `origem` carrega.
 *
 * ANTES DA INSTALAÇÃO ELA É INERTE, E CONTA. Os emissores estão espalhados por módulos que várias
 * suítes carregam sozinhos, e três das quatro páginas montam coisas antes de qualquer capturador
 * existir: lançar daqui seria trocar um defeito observável por um defeito no observador. O contador
 * `naoInstalado` é o que impede que essa tolerância vire silêncio — um `naoInstalado` alto diz "há
 * relato acontecendo cedo demais", que é um fato sobre a fiação, não sobre o erro.
 *
 * @param {*} erro - O erro, ou o que houver: `textoDeErro` tolera qualquer coisa.
 * @param {Object} [opcoes]
 * @param {string} [opcoes.origem] - Uma das dez de `ORIGENS_DO_CLIENTE`. Fora dela (inventada, ou
 *   a `servidor`, que é do backend), vira `NAO_TRATADO` em vez de custar o relato num 422.
 * @param {Object} [opcoes.contexto] - Só as cinco chaves enumeradas (`atlasKind`, `conexao`,
 *   `causa`, `camada`, `status`); qualquer outra é DESCARTADA por `montarCorpo`. Nunca um objeto
 *   livre, e nunca dado de usuário.
 * @param {boolean} [opcoes.enfileirarSempre] - Guarda para a próxima carga da página em vez de
 *   tentar a rede. Para quem já sabe que o servidor não responde (a tela de indisponibilidade).
 * @returns {boolean} Se um relato foi produzido.
 */
export function relatarErro(erro, { origem, contexto, enfileirarSempre = false } = {}) {
    try {
        if (!_instalacao?.capturar) {
            _estado.naoInstalado++;
            return false;
        }
        return _instalacao.capturar(erro, { origem, contexto, enfileirarSempre });
    } catch {
        _estado.falhasInternas++;
        return false;
    }
}

/**
 * Manda o que ficou guardado de cargas anteriores da página.
 *
 * QUANDO CHAMAR: logo depois do primeiro `GET /api/config` bem-sucedido, e em lugar nenhum antes.
 * Aquele é o ponto em que se sabe que o servidor responde, e mandar antes é gastar pedido contra um
 * servidor que acabou de não responder, que é, por construção, a razão de a fila existir.
 * @returns {Promise<number>} Quantos relatos chegaram.
 */
export async function descarregarFilaDeRelatos() {
    try {
        if (!_instalacao?.drenar) {
            _estado.naoInstalado++;
            return 0;
        }
        return await _instalacao.drenar();
    } catch {
        _estado.falhasInternas++;
        return 0;
    }
}

export { OrigemDeErro };
