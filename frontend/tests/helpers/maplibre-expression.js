// Path: tests/helpers/maplibre-expression.js

/**
 * @fileoverview A minimal evaluator for the MapLibre style expressions this
 * repository writes, for tests that run in `node`.
 *
 * WHY IT EXISTS, and why it is not a hand-written guess. The right reference for
 * "what does the map draw" is the code the map runs, and the main branch of this
 * project gets it from `@maplibre/maplibre-gl-style-spec`, the npm package
 * `maplibre-gl` depends on. HERE MAPLIBRE IS VENDORED, not installed: it is the
 * browser UMD bundle at `public/vendors/maplibre-gl.js`, loaded by a `<script>`
 * tag, and it exports the `Map` class and nothing of the expression compiler.
 * Adding the npm package would touch the lockfile, which this branch does not do
 * for a test helper.
 *
 * So the arithmetic below is TRANSCRIBED from that same vendored bundle rather
 * than reconstructed from the documentation, function by function, so that a
 * disagreement between this file and the map is a typo and not a different
 * reading of the spec:
 *
 *   - the interpolation factor is `dr(input, base, lower, upper)`:
 *     `(base^(input-lower) - 1) / (base^(upper-lower) - 1)`, and `0` when the two
 *     stops coincide;
 *   - the number interpolation is `ke(a, b, t) = a + t * (b - a)`;
 *   - an `interpolate` returns its FIRST output verbatim below the first stop and
 *     its LAST above the last one, so integer stops are exact;
 *   - an assertion (`['number', a, b, ...]`) returns the first argument whose type
 *     matches and throws on the last one otherwise.
 *
 * WHAT THIS FILE IS NOT. It is not a validator: it does not type-check an
 * expression, and it will happily evaluate one MapLibre would reject. A test that
 * needs to know the map ACCEPTS an expression has to look at the map, and the
 * browser spec is where that is done.
 *
 * It also covers only the operators this repository actually writes. Anything
 * else throws by name, loudly, rather than returning a plausible number: a
 * silently wrong evaluator would approve a style that draws nothing.
 */

/** MapLibre's `dr`: the interpolation factor of an exponential interpolation. */
export function interpolationFactor(input, base, lower, upper) {
    const span = upper - lower;
    const travelled = input - lower;
    if (span === 0) return 0;
    if (base === 1) return travelled / span;
    return (Math.pow(base, travelled) - 1) / (Math.pow(base, span) - 1);
}

/** MapLibre's `ke`: interpolate two numbers by a factor. */
export function interpolateNumber(a, b, t) {
    return a + t * (b - a);
}

/**
 * The type name MapLibre reports for a runtime value, for the assertions.
 * @param {*} value - Any evaluated value
 * @returns {string} 'number' | 'string' | 'boolean' | 'null' | 'array' | 'object'
 */
function typeOf(value) {
    if (value === null || value === undefined) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
}

/**
 * Evaluate one MapLibre expression.
 *
 * @param {*} expression - Expression, or a literal value
 * @param {{zoom?: number, properties?: Object, geometryType?: string}} context - Evaluation context
 * @returns {*} The evaluated value
 */
export function evaluateExpression(expression, context = {}) {
    const ev = (node) => evaluateExpression(node, context);

    if (!Array.isArray(expression)) return expression;

    const [op, ...args] = expression;

    switch (op) {
        case 'literal':
            return args[0];
        case 'zoom':
            return context.zoom;
        case 'geometry-type':
            return context.geometryType;
        case 'get': {
            const value = (context.properties || {})[ev(args[0])];
            return value === undefined ? null : value;
        }
        case 'has':
            return Object.prototype.hasOwnProperty.call(context.properties || {}, ev(args[0]));
        case 'typeof':
            return typeOf(ev(args[0]));

        // Assertions. MapLibre walks the arguments and returns the first whose
        // type matches, throwing on the last one when none does.
        case 'number':
        case 'string':
        case 'boolean': {
            for (let i = 0; i < args.length; i++) {
                const value = ev(args[i]);
                if (typeOf(value) === op) return value;
                if (i === args.length - 1) {
                    throw new Error(`Expected value to be of type ${op}, but found ${typeOf(value)} instead.`);
                }
            }
            return null;
        }

        case 'coalesce': {
            for (const arg of args) {
                const value = ev(arg);
                if (value !== null && value !== undefined) return value;
            }
            return null;
        }
        case 'case': {
            for (let i = 0; i + 1 < args.length; i += 2) {
                if (ev(args[i])) return ev(args[i + 1]);
            }
            return ev(args[args.length - 1]);
        }
        case 'match': {
            const input = ev(args[0]);
            for (let i = 1; i + 1 < args.length; i += 2) {
                const labels = ev(args[i]);
                const set = Array.isArray(labels) ? labels : [labels];
                if (set.includes(input)) return ev(args[i + 1]);
            }
            return ev(args[args.length - 1]);
        }

        case 'all':
            return args.every(arg => ev(arg) === true);
        case 'any':
            return args.some(arg => ev(arg) === true);
        case '!':
            return !ev(args[0]);
        case '==':
            return ev(args[0]) === ev(args[1]);
        case '!=':
            return ev(args[0]) !== ev(args[1]);
        case '>':
            return ev(args[0]) > ev(args[1]);
        case '>=':
            return ev(args[0]) >= ev(args[1]);
        case '<':
            return ev(args[0]) < ev(args[1]);
        case '<=':
            return ev(args[0]) <= ev(args[1]);
        case 'in': {
            const needle = ev(args[0]);
            const haystack = ev(args[1]);
            return Array.isArray(haystack) || typeof haystack === 'string'
                ? haystack.includes(needle)
                : false;
        }

        case '+':
            return args.reduce((total, arg) => total + ev(arg), 0);
        case '-':
            return args.length === 1 ? -ev(args[0]) : ev(args[0]) - ev(args[1]);
        case '*':
            return args.reduce((total, arg) => total * ev(arg), 1);
        case '/':
            return ev(args[0]) / ev(args[1]);
        case '^':
            return Math.pow(ev(args[0]), ev(args[1]));
        case 'min':
            return Math.min(...args.map(ev));
        case 'max':
            return Math.max(...args.map(ev));
        case 'abs':
            return Math.abs(ev(args[0]));
        case 'round':
            return Math.round(ev(args[0]));
        case 'floor':
            return Math.floor(ev(args[0]));
        case 'ceil':
            return Math.ceil(ev(args[0]));

        case 'interpolate': {
            const [interpolation, input, ...stops] = args;
            const labels = [];
            const outputs = [];
            for (let i = 0; i + 1 < stops.length; i += 2) {
                labels.push(stops[i]);
                outputs.push(stops[i + 1]);
            }

            if (labels.length === 1) return ev(outputs[0]);

            const value = ev(input);
            if (value <= labels[0]) return ev(outputs[0]);
            if (value >= labels[labels.length - 1]) return ev(outputs[outputs.length - 1]);

            // The last stop at or below the input, which is what MapLibre's
            // binary search finds.
            let index = 0;
            while (index + 1 < labels.length && labels[index + 1] <= value) index++;

            const kind = Array.isArray(interpolation) ? interpolation[0] : interpolation;
            const base = kind === 'exponential' ? interpolation[1] : 1;
            if (kind !== 'exponential' && kind !== 'linear') {
                throw new Error(`maplibre-expression: unsupported interpolation '${kind}'`);
            }

            const t = interpolationFactor(value, base, labels[index], labels[index + 1]);
            return interpolateNumber(ev(outputs[index]), ev(outputs[index + 1]), t);
        }

        case 'step': {
            const [input, fallback, ...stops] = args;
            const value = ev(input);
            let result = ev(fallback);
            for (let i = 0; i + 1 < stops.length; i += 2) {
                if (value >= stops[i]) result = ev(stops[i + 1]);
            }
            return result;
        }

        default:
            throw new Error(`maplibre-expression: unsupported operator '${op}'`);
    }
}

/**
 * Bind an expression to an evaluator with the same signature the style-spec
 * package gives: `(properties, zoom) => value`.
 * @param {Array} expression - MapLibre expression
 * @returns {Function} Evaluator
 */
export function compileExpression(expression) {
    return (properties, zoom, geometryType) =>
        evaluateExpression(expression, { properties, zoom, geometryType });
}
