// Path: eslint-rules/no-event-string-literal.js
// An event name typed as a string literal fails SILENTLY. `bus.emit('layer:chagned')`
// throws nothing, logs nothing and returns `false`: the subscriber simply never
// runs, and the damage shows up far from the typo — a panel that stops
// refreshing, a sync op that never leaves the queue. `EventTypes.LAYER_CHANGED`
// turns the same typo into a ReferenceError at the call site. The canonical list
// is `frontend/src/js/events/event_types.js` (store errors live apart, in
// `store/store-errors.js` as `StoreErrorEvents`).
//
// The whole difficulty is telling OUR bus from the third-party APIs that share
// the `.on()/.off()` shape and use string literals legitimately, so the rule
// fires on two narrow, independent signals and stays quiet otherwise:
//
//   1. the receiver is recognizably the app bus — an identifier or property named
//      `eventBus`/`bus` (with optional `_` prefix), or a `getEventBus()` /
//      `createEventBus()` call;
//   2. the literal has the shape every EventTypes value has, `dominio:acao` with
//      a colon — a shape no MapLibre or DOM event uses.
//
// DELIBERATELY NOT CAUGHT (false positive here is worse than a miss: with
// `--max-warnings 0` one bad report gets the rule switched off):
//   - `map.on('click', ...)`, `map.off('styledata', ...)`, `marker.on('dragend')`,
//     `el.addEventListener('keydown')` — third-party vocabularies, colon-free.
//   - `toolManager.on('toolActivated')` and `wsClient.on('operation')`. Both are
//     private mini-emitters with their own vocabulary that is NOT in EventTypes
//     (`tool_manager/tool_manager.js:29`, `store/sync/ws-client.js`), so demanding
//     a constant there would be demanding a constant that does not exist.
//   - dynamic names (`bus.emit(`feature:${kind}`)`, `bus.on(evt)`): a template with
//     expressions or a variable can be a legitimate fan-out (`for (const evt of
//     REMOTE_FEATURE_EVENTS) bus.on(evt, ...)`), and the typo this rule exists to
//     catch is the typed one.
//   - test files. `tests/integration/event-bus.test.js` exercises the emitter
//     itself with invented names like `'feature:created'`; that is the subject
//     under test, not a call site. Keep `tests/` out of this rule's `files` glob.

/** Methods of EventEmitter/EventBus whose first argument is the event name. */
const BUS_METHODS = new Set([
    'emit',
    'on',
    'once',
    'off',
    'offAll',
    'waitFor',
    'hasListeners',
    'listenerCount',
]);

/** Identifiers/properties that hold the application event bus in this codebase. */
const BUS_NAMES = new Set(['eventBus', '_eventBus', 'bus', '_bus']);

/** Factories that return the application event bus. */
const BUS_FACTORIES = new Set(['getEventBus', 'createEventBus']);

/**
 * Shape shared by every value in `EventTypes`: `dominio:acao`, lowercase start,
 * at least one colon. No MapLibre, Cesium or DOM event name contains a colon,
 * which is what makes this safe to apply regardless of the receiver.
 */
const EVENT_SHAPE = /^[a-z][a-zA-Z0-9]*(?::[a-zA-Z0-9]+)+$/;

/**
 * Is this expression the application event bus?
 * @param {import('estree').Node} node - Receiver of the method call.
 * @returns {boolean}
 */
function isBusReceiver(node) {
    if (!node) return false;
    if (node.type === 'Identifier') return BUS_NAMES.has(node.name);
    if (node.type === 'MemberExpression') {
        return !node.computed && node.property.type === 'Identifier' && BUS_NAMES.has(node.property.name);
    }
    if (node.type === 'CallExpression') {
        const callee = node.callee;
        if (callee.type === 'Identifier') return BUS_FACTORIES.has(callee.name);
        if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') {
            return BUS_FACTORIES.has(callee.property.name);
        }
    }
    return false;
}

/**
 * Static string value of an argument, or null when it is not a typed literal.
 * A template with interpolation is dynamic and out of scope.
 * @param {import('estree').Node} node - First argument of the call.
 * @returns {string|null}
 */
function staticStringValue(node) {
    if (!node) return null;
    if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
    if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
        return node.quasis[0].value.cooked;
    }
    return null;
}

export default {
    meta: {
        type: 'problem',
        docs: {
            description:
                'proíbe nome de evento como string literal nas chamadas do event bus — use a constante EventTypes.XXX',
        },
        schema: [],
        messages: {
            busLiteral:
                'Nome de evento como string literal no event bus: se ele estiver errado nada falha, o assinante apenas nunca é chamado. Use a constante `EventTypes.{{sugestao}}` (importada de `@events`), ou `StoreErrorEvents.XXX` se for erro de store; se o evento ainda não existe, declare-o em `frontend/src/js/events/event_types.js`.',
            eventShapedLiteral:
                'String no formato `dominio:acao` usada como nome de evento: esse é o vocabulário do event bus do EBGeo, e passá-lo como literal faz um erro de digitação virar assinante mudo. Use a constante `EventTypes.{{sugestao}}` (importada de `@events`), ou `StoreErrorEvents.XXX` se for erro de store; declare o evento em `frontend/src/js/events/event_types.js` se ainda não existir.',
        },
    },
    create(context) {
        return {
            CallExpression(node) {
                const callee = node.callee;
                if (callee.type !== 'MemberExpression' || callee.computed) return;
                if (callee.property.type !== 'Identifier' || !BUS_METHODS.has(callee.property.name)) return;
                if (node.arguments.length === 0) return;

                const eventName = staticStringValue(node.arguments[0]);
                if (eventName === null) return;

                const onBus = isBusReceiver(callee.object);
                if (!onBus && !EVENT_SHAPE.test(eventName)) return;

                context.report({
                    node: node.arguments[0],
                    messageId: onBus ? 'busLiteral' : 'eventShapedLiteral',
                    data: { sugestao: eventName.replace(/[:.-]/g, '_').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase() },
                });
            },
        };
    },
};
