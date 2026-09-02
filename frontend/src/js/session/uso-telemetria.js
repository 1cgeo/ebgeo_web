// Path: js/session/uso-telemetria.js

/**
 * @fileoverview A FIAÇÃO da telemetria de uso: quem é a aba, qual é a página, qual é a base da
 * API, qual é a release, qual é a família do navegador e onde estão as vitais. A DECISÃO (o que
 * pode ser contado, como o lote é montado, quando ele sai) mora em `session/uso-lote.js`, que
 * importa um módulo só e é dirigível em node puro.
 *
 * É A MESMA DIVISÃO DE `erro-telemetria.js` / `erro-telemetria-assinatura.js`, e pelo mesmo
 * motivo: tudo que precisa de `window`, de rede ou do grafo do produto fica de um lado só, e o
 * lado testável não paga por isso.
 *
 * ELA NÃO PARTICIPA DO BOOT. {@link instalarUso} é síncrona, não faz requisição nenhuma e devolve
 * na hora; ela é chamada logo depois de `instalarTelemetriaDeErro()` nas quatro páginas. Se
 * falhar inteira, o app sobe igual: o fail-fast do mapa continua sendo o `GET /api/config`, e
 * nada aqui participa daquela decisão.
 */

// Por ARQUIVO, e a peça que JÁ EXISTE: a base da API tem override de bancada
// (`__EBGEO_BACKEND_URL__`) e um padrão de mesma origem, e uma segunda cópia dessa regra
// divergiria da primeira em silêncio. Mesmo import do relato de erro.
import { resolveBackendBaseUrl } from '@store/sync/runtime-config.js';
// Os três vizinhos de `session/`, folhas de zero imports: o id da aba, a tabela de páginas e a
// coleta de vitais. `paginaDaUrl` é REUSADA em vez de reescrita porque uma segunda tabela de
// páginas faria o mesmo `admin.html` virar dois eixos de corte diferentes no mesmo servidor.
import { sessaoId as sessaoIdPadrao } from './sessao-id.js';
import { paginaDaUrl } from './erro-telemetria-assinatura.js';
import { vitais as vitaisPadrao } from './vitais.js';
// A release e o contador de erros vêm da telemetria de ERRO, que já os tem: `versaoDoBuild` é a
// soma dos dois carimbos do build, e `capturados` é quantos erros esta sessão viu. Recalcular
// qualquer um dos dois aqui produziria dois números com o mesmo nome.
import { versaoDoBuild, estadoDaTelemetria } from './erro-telemetria.js';
import { configurarUso, familiaDoNavegador, registrarUso } from './uso-lote.js';
import { EventoDeUso } from './eventos-de-uso.js';

/**
 * Instala a telemetria de uso e conta a carga desta página. Síncrona, sem rede e idempotente.
 *
 * A CONTAGEM DA PÁGINA É A PRIMEIRA COISA, e ela é o denominador de tudo o mais: sem
 * `pagina.vista`, "40 exportações de PDF" é um número sem escala. Ela vale UMA por vida da página
 * porque {@link instalarUso} é idempotente (a segunda chamada não instala e não conta).
 *
 * A IDEMPOTÊNCIA AQUI É EMPRESTADA DE DUAS GUARDAS, NÃO DE UMA, e essa é a ressalva que se paga
 * com um número errado se for esquecida. `configurarUso` recusa a segunda instalação em SILÊNCIO,
 * mas `vitais.observar()` roda ANTES dela (de propósito: com `buffered` ligado, assinar cedo é o
 * que faz o LCP existir), então uma segunda chamada desta função CHEGA aos observadores. É
 * `vitais.observar()` que precisa ser idempotente por conta própria, e ela é: sem isso, dois
 * observadores de `layout-shift` entregam cada entrada duas vezes e o CLS sai DOBRADO, o que faz
 * uma página boa se declarar ruim sem nada ficar vermelho.
 *
 * @param {Object} [opcoes] - Injeções, para o teste. O produto chama sem argumento.
 * @param {*} [opcoes.alvo]
 * @param {Object} [opcoes.documento]
 * @param {Function} [opcoes.enviar]
 * @param {number} [opcoes.intervaloMs]
 * @returns {{instalada: boolean, desinstalar: () => void}}
 */
export function instalarUso({ alvo = globalThis, documento, enviar, intervaloMs } = {}) {
    try {
        // AS VITAIS PRIMEIRO, e antes de qualquer coisa que possa falhar: os observadores usam
        // `buffered: true` e alcançam o que já aconteceu, mas um LCP tardio só é visto por quem
        // já está assinando. Se a instalação abaixo falhar, ter observado não custa nada.
        //
        // ELA RODA ANTES DA GUARDA DE IDEMPOTÊNCIA DE `configurarUso`, e isso é deliberado (ver
        // acima), mas cria a dependência que `vitais.observar()` precisa cobrir sozinha: uma
        // segunda chamada de `instalarUso` na mesma página, que `configurarUso` recusa em
        // silêncio, chega aqui do mesmo jeito. Sem a guarda de lá, o CLS sairia dobrado.
        try {
            vitaisPadrao.observar();
        } catch {
            // Navegador sem `PerformanceObserver`: o lote sai sem o bloco de vitais.
        }

        const resultado = configurarUso({
            pagina: paginaDaUrl(alvo?.location?.pathname ?? ''),
            sessaoId: sessaoIdSeguro(),
            release: versaoDoBuild(),
            navegador: familiaDoNavegador(alvo?.navigator?.userAgent ?? ''),
            resolverBase: resolveBackendBaseUrl,
            erros: () => estadoDaTelemetria().capturados,
            vitais: () => vitaisPadrao.ler(),
            alvo,
            documento: documento ?? alvo?.document,
            ...(enviar ? { enviar } : {}),
            ...(Number.isFinite(intervaloMs) ? { intervaloMs } : {}),
        });

        if (resultado.instalada) registrarUso(EventoDeUso.PAGINA_VISTA);
        return resultado;
    } catch {
        return { instalada: false, desinstalar: () => {} };
    }
}

/** O id desta aba, tolerante: um armazenamento bloqueado não pode custar a instalação. */
function sessaoIdSeguro() {
    try {
        return sessaoIdPadrao();
    } catch {
        return '';
    }
}
