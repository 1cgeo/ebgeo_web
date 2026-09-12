// Path: js/session/uso-do-barramento.js

/**
 * @fileoverview Allowlisted product events. Catalog preferences send only IDs found in the current catalog, never geometry, text, URLs or arbitrary event payloads. Remote temporal changes are excluded. Base counts include initial map loads.
 */

import { EventTypes } from '@events/event_types.js';
import config from '@js/config.js';
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
    [EventTypes.BASE_LAYER_CHANGED, {
        uso: EventoDeUso.PREFERENCIA_BASE,
        prop: payload => typeof payload?.layer === 'string' && Object.hasOwn(config.basemaps, payload.layer) ? payload.layer : null,
    }],
    [EventTypes.CATALOG_ADD_LAYER, {
        uso: EventoDeUso.PREFERENCIA_CAMADA,
        prop: payload => {
            const id = payload?.item?.id;
            const catalogo = [...(config.dataLayers?.layers ?? []), ...(config.analysisLayers?.layers ?? [])];
            return catalogo.some(item => item.id === id) ? id : null;
        },
    }],
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
        if (regra.prop) {
            const prop = regra.prop(payload);
            if (prop) registrarUso(regra.uso, prop);
        } else {
            registrarUso(regra.uso);
        }
        if (evento === EventTypes.VIEWER_3D_OPENED) {
            const id = payload?.tilesetId;
            if ((config.tilesets ?? []).some(item => item.id === id)) registrarUso(EventoDeUso.RECURSO_ABERTO, id);
        }
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
