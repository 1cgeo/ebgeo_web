// Path: js/session/uso-do-barramento.js

/**
 * @fileoverview O ALIMENTADOR DE USO QUE OUVE O BARRAMENTO: UMA assinatura `onAny`, com allowlist,
 * que transforma cinco eventos de ciclo de vida em contagens.
 *
 * A FORMA É A DE `migalhas-do-barramento.js`, e a razão é a mesma: uma assinatura observa o
 * barramento inteiro, e o custo por emissão é uma consulta de tabela. Os eventos quentes (o cursor
 * temporal a cada rAF, o cursor de presença) CHEGAM aqui e saem numa falta de chave.
 *
 * ── POR QUE ESTES CINCO CHEGAM PELO BARRAMENTO E OS OUTROS NÃO ──────────────────────────────
 *
 * Os cinco já são anunciados: os três visualizadores pesados emitem ao abrir, o briefing emite ao
 * começar a apresentar, e a linha do tempo emite ao ligar. Pendurar uma chamada de `registrarUso`
 * dentro de cada um desses arquivos seria escrever cinco vezes o que uma tabela diz uma vez, e
 * três deles são módulos que só chegam por `import()` — a chamada viveria dentro do chunk pesado
 * em vez de no entry. Os eventos que NÃO têm anúncio no barramento (a ferramenta ativada, a
 * medição, as três saídas de arquivo, o atlas aberto) recebem a chamada no sítio, porque ali não
 * há evento para ouvir.
 *
 * ── A ÚNICA REGRA QUE NÃO É "TRADUZA O NOME" ────────────────────────────────────────────────
 *
 * `MAP_TEMPORAL_CHANGED` é emitido nos DOIS sentidos do interruptor, e o payload diz qual
 * (`enabled`). Contar os dois faria "temporal ativado" valer o dobro para quem liga e desliga, e o
 * ato de DESLIGAR entraria numa métrica que se chama "ativado". O filtro é uma função por entrada
 * (`quando`), e não um caso especial escrito no manipulador, porque o dia em que o segundo evento
 * precisar de filtro é o dia em que um `if` solto vira dois `if` soltos.
 *
 * REPARE QUE O CAMPO É `enabled` E NÃO `ativo`: a configuração temporal guarda `ativo` no store,
 * e o evento anuncia `enabled`. Os dois emissores (`store/temporal.operations.js` e
 * `store/sync/remote-operation-handler.js`) mandam `enabled`, e escrever `ativo` aqui produziria
 * um filtro que nunca casa, ou seja uma métrica sempre zerada, sem erro em lugar nenhum.
 *
 * E O FILTRO TEM UM SEGUNDO TERMO, QUE É O QUE SEPARA GESTO DE ECO. O segundo emissor é o
 * manipulador de op REMOTA, e ele emite a cada op de entrada que carregue a configuração
 * temporal, SEM detecção de mudança: um colega que liga a linha do tempo UMA vez produz uma
 * emissão em CADA aba do atlas. Contá-las faria a métrica medir o tamanho da equipe em vez do
 * gesto, e o número cresceria com a colaboração sem ninguém ter ligado nada a mais. Daí o
 * `remoto` carimbado lá (a telemetria de uso é o único assinante que o lê) e o `!payload?.remoto`
 * aqui. A AUSÊNCIA do campo é o estado normal, do emissor LOCAL, que é o que se quer contar.
 *
 * SÓ O MAPA INSTALA ISTO, como as migalhas: as outras três páginas bootam sem `initServices()` e
 * portanto sem barramento.
 */

import { EventTypes } from '@events/event_types.js';
import { EventoDeUso } from './eventos-de-uso.js';
import { registrarUso } from './uso-lote.js';

/**
 * A ALLOWLIST: evento do barramento, evento de uso, e o filtro quando há um.
 *
 * `Map` e não objeto literal, pelo mesmo motivo de `migalhas-do-barramento.js`: a chave vem de
 * fora (é o nome do evento que alguém emitiu), e um objeto responderia por herança de protótipo a
 * um evento chamado `toString`.
 *
 * NENHUMA ENTRADA LÊ CAMPO DO PAYLOAD PARA MANDAR. O `quando` decide se conta; nada do payload
 * viaja. É o que mantém a métrica agregada de verdade: qual modelo 3D, qual foto e qual briefing
 * ficam de fora, e sem eles não há nada aqui que identifique conteúdo nem pessoa.
 */
const REGRAS = new Map([
    [EventTypes.VIEWER_3D_OPENED, { uso: EventoDeUso.VISUALIZADOR3D_ABERTO }],
    [EventTypes.STREETVIEW_360_OPENED, { uso: EventoDeUso.VISUALIZADOR360_ABERTO }],
    [EventTypes.FIRST_PERSON_OPENED, { uso: EventoDeUso.PRIMEIRA_PESSOA_ABERTO }],
    [EventTypes.BRIEFING_PRESENT_STARTED, { uso: EventoDeUso.BRIEFING_APRESENTADO }],
    [EventTypes.MAP_TEMPORAL_CHANGED, {
        uso: EventoDeUso.TEMPORAL_ATIVADO,
        quando: (payload) => payload?.enabled === true && !payload?.remoto,
    }],
]);

/**
 * Os eventos observados, na ordem em que foram declarados. Exportado para o teste, que precisa
 * emitir TODOS eles: uma lista escrita à mão lá deixaria o evento novo sem cobertura no dia em que
 * ele entrasse aqui.
 * @type {ReadonlyArray<string>}
 */
export const EVENTOS_DE_USO_OBSERVADOS = Object.freeze([...REGRAS.keys()]);

/**
 * O manipulador único. Sai na hora para tudo que não está na allowlist.
 * @param {string} evento
 * @param {Object} payload
 */
function aoEvento(evento, payload) {
    try {
        const regra = REGRAS.get(evento);
        if (!regra) return;
        if (typeof regra.quando === 'function' && !regra.quando(payload)) return;
        registrarUso(regra.uso);
    } catch {
        // A escuta NUNCA pode quebrar a entrega de evento: ela observa, não participa.
    }
}

/**
 * A assinatura viva, ou `null`. Módulo-global de propósito: um `import()` repetido ou uma recarga
 * parcial de HMR não pode dobrar a contagem.
 * @type {(() => void)|null}
 */
let _remover = null;

/**
 * Instala a escuta no barramento da aplicação. Idempotente e best-effort.
 *
 * CHAMADA UMA VEZ, ao lado de `instalarMigalhasDoBarramento` (`js/index.js`), que é o primeiro
 * instante em que `getEventBus()` existe.
 * @param {Object} eventBus - O barramento (`events/event_emitter.js`).
 * @returns {() => void} A função que desfaz a assinatura.
 */
export function instalarUsoDoBarramento(eventBus) {
    try {
        if (_remover) return _remover;
        if (typeof eventBus?.onAny !== 'function') return () => {};
        const soltar = eventBus.onAny(aoEvento);
        _remover = () => {
            try {
                soltar();
            } catch {
                // Barramento já destruído: não há o que soltar.
            }
            _remover = null;
        };
        return _remover;
    } catch {
        return () => {};
    }
}
