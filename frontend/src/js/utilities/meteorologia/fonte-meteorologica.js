// Path: js/utilities/meteorologia/fonte-meteorologica.js

/**
 * @fileoverview THE WEATHER SOURCE: the one place that talks to the Open-Meteo API, from the
 * BROWSER (owner, 2026-09-23: arrangement C2 of the weather proposal; this server makes no
 * outbound call). No DOM; the transport is injected, so every rule here is driven in node.
 *
 * ── WHAT LEAVES THE BROWSER, AND WHAT DOES NOT ─────────────────────────────────────────────
 *
 * Every query tells the source a region of interest and a date, and what was sent does not come
 * back. Two things ALWAYS go and cannot be removed here: the `Origin` header, which CORS requires
 * and which names the EBGeo deployment (not the atlas), and the network's egress address. Only a
 * source installed inside the network (the root in `services.meteorologiaUrl`) keeps them in. So
 * the request carries the LEAST it can:
 *
 *   - the point ROUNDED to {@link PASSO_DA_GRADE_GRAUS} before the URL is built: the forecast has
 *     no resolution finer than the model's grid, so a decimal more would only expose the point;
 *   - NO credential. The request never goes through the app's HTTP client (`apiClient`), which
 *     stamps the session token, and the source's CORS policy lists `authorization` among the
 *     accepted headers (measured 2026-09-23), so a stamped token would leave WITHOUT any error.
 *     {@link OPCOES_DA_REQUISICAO} has no `headers` at all, and `credentials: 'omit'`;
 *   - NO Referer: the page's address can carry the atlas id (`?atlas=`), hence `no-referrer`;
 *   - NOTHING ON DISK: `cache: 'no-store'` keeps the response, and the coordinate inside it, out of
 *     the browser's HTTP cache. The only cache is this module's, in memory, and dies with the tab;
 *   - NO elevation. The source corrects temperature for the elevation of the requested point with
 *     its own DEM, so the rounded point is what the numbers refer to, and the panel prints that
 *     reference elevation back (it comes in the response) instead of sending ours.
 *
 * The coordinate never reaches a log line either: {@link FalhaDaFonte} messages never carry the
 * URL, because console messages travel as breadcrumbs with error reports.
 *
 * ── THE MODEL IS PINNED ────────────────────────────────────────────────────────────────────
 *
 * `gfs_seamless` is the only one of the four global models probed on 2026-09-23 that delivers
 * every row of the panel (visibility and the 80 m temperature included) for all 16 days: ECMWF IFS
 * has no visibility, ICON stops at day 8. Pinning it also makes the stamp honest: the panel names
 * ONE model and ONE run, which "best match" (a blend chosen by the source) could not.
 */

import { dataIsoValida, diasEntre, MS_POR_DIA, somarDias } from '@utils/hora-brasilia.js';

/** The model every request pins, and the metadata entry that tells its latest run. */
export const MODELO = 'gfs_seamless';
export const MODELO_DA_RODADA = 'ncep_gfs013';

/** The hourly variables of one request: every row of the panel comes from these. */
export const VARIAVEIS_HORARIAS = Object.freeze([
    'temperature_2m',
    'relative_humidity_2m',
    'precipitation',
    'precipitation_probability',
    'weather_code',
    'cloud_cover',
    'pressure_msl',
    'visibility',
    'wind_speed_10m',
    'wind_direction_10m',
    'wind_gusts_10m',
]);

/** The rounding of the point before it leaves (decision D11 of the proposal): about 11 km. */
export const PASSO_DA_GRADE_GRAUS = 0.1;

/**
 * How far the forecast reaches, in civil days of P counted from today's UTC date. The source
 * answers 16 UTC days (today to today+15); a P day runs from 03:00 UTC to 03:00 UTC of the next, so
 * the last P day with all 24 hours inside is today+14. Backwards, the source keeps about three
 * months of past forecasts.
 */
export const ALCANCE_FUTURO_DIAS = 14;
export const ALCANCE_PASSADO_DIAS = 90;

/** The run metadata changes every 6 h; asking again within this window only spends a request. */
const VALIDADE_DA_RODADA_MS = 10 * 60 * 1000;

/**
 * How long each request may take. A closed network whose firewall DROPS packets instead of refusing
 * them would otherwise hold the panel in "Consultando" until the system's TCP timeout, tens of
 * seconds. The run metadata is optional (the panel shows the forecast without it), so it gets less.
 */
export const TEMPO_LIMITE_PREVISAO_MS = 15000;
export const TEMPO_LIMITE_RODADA_MS = 5000;

/**
 * The fetch options of every request, and the reason each one is there is in the file header.
 * No `headers` key on purpose.
 */
export const OPCOES_DA_REQUISICAO = Object.freeze({
    method: 'GET',
    mode: 'cors',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
});

/**
 * Does a set of fetch options carry nothing that identifies the person? The adapter's test asserts
 * this on every call, and asserts it REFUSES the options the app's HTTP client would build.
 * @param {Object} opcoes
 * @returns {boolean}
 */
export function opcoesSemCredencial(opcoes) {
    if (!opcoes || typeof opcoes !== 'object') return false;
    if (opcoes.credentials !== 'omit') return false;
    if (opcoes.referrerPolicy !== 'no-referrer') return false;
    if (opcoes.headers !== undefined) return false;
    return true;
}

/**
 * A failure of the source, with a REASON and never the URL.
 */
export class FalhaDaFonte extends Error {
    /**
     * @param {'rede'|'http'|'formato'} motivo - `rede` covers no network, a proxy refusal and a
     *   CORS refusal alike, because the browser reports the three the same way
     * @param {number|null} [status] - the HTTP code, when there was a response
     */
    constructor(motivo, status = null) {
        super(status ? `fonte meteorológica: ${motivo} (${status})` : `fonte meteorológica: ${motivo}`);
        this.name = 'FalhaDaFonte';
        this.motivo = motivo;
        this.status = status;
    }
}

/**
 * @param {number} valor
 * @param {number} passo
 * @returns {number}
 */
function arredondarAoPasso(valor, passo) {
    const casas = Math.max(0, -Math.floor(Math.log10(passo)));
    const r = Number((Math.round(valor / passo) * passo).toFixed(casas));
    return r === 0 ? 0 : r; // never -0
}

/**
 * The point that leaves the browser: rounded to the grid step, latitude clamped, longitude wrapped
 * to [−180, 180).
 * @param {{lat: number, lng: number}} ponto
 * @returns {{lat: number, lng: number}}
 * @throws {Error} when the point is not finite (caller bug)
 */
export function arredondarPonto(ponto) {
    if (!Number.isFinite(ponto?.lat) || !Number.isFinite(ponto?.lng)) {
        throw new Error('ponto inválido para a fonte meteorológica');
    }
    const lat = arredondarAoPasso(Math.max(-90, Math.min(90, ponto.lat)), PASSO_DA_GRADE_GRAUS);
    let lng = arredondarAoPasso(ponto.lng, PASSO_DA_GRADE_GRAUS);
    lng = ((((lng + 180) % 360) + 360) % 360) - 180;
    lng = arredondarAoPasso(lng, PASSO_DA_GRADE_GRAUS);
    return { lat, lng };
}

/**
 * The UTC date of an instant.
 * @param {number} instanteMs
 * @returns {string} `AAAA-MM-DD`
 */
function dataUtc(instanteMs) {
    return new Date(Math.floor(instanteMs / MS_POR_DIA) * MS_POR_DIA).toISOString().slice(0, 10);
}

/**
 * Which of the panel's civil days the forecast can answer today.
 * @param {string[]} datas - civil dates in P
 * @param {number} agoraMs
 * @returns {string[]} the dates in reach, in the order given
 */
export function diasNoAlcance(datas, agoraMs) {
    const hoje = dataUtc(agoraMs);
    return datas.filter((d) => {
        if (!dataIsoValida(d)) return false;
        const n = diasEntre(hoje, d);
        return n >= -ALCANCE_PASSADO_DIAS && n <= ALCANCE_FUTURO_DIAS;
    });
}

/**
 * The API root without trailing slashes.
 * @param {string} base
 * @returns {string}
 */
function raiz(base) {
    return String(base ?? '').trim().replace(/\/+$/, '');
}

/**
 * The forecast request for a rounded point and a run of civil days in P. The hours come in UTC as
 * unix seconds (`timeformat=unixtime`), and the day is cut in P by the aggregation, never by the
 * source: asking the source for São Paulo's zone would change by itself if daylight saving came
 * back, while P is fixed.
 * @param {string} base - the Open-Meteo root
 * @param {{lat: number, lng: number}} celula - ALREADY rounded
 * @param {string[]} datas - civil dates in P, non-empty, all in reach
 * @returns {string}
 */
export function montarUrlDaPrevisao(base, celula, datas) {
    const ordenadas = [...datas].sort();
    const inicio = ordenadas[0];
    // The last P day ends at 03:00 UTC of the NEXT date, so the UTC range goes one date further.
    const fim = somarDias(ordenadas[ordenadas.length - 1], 1);
    const parametros = [
        `latitude=${celula.lat.toFixed(1)}`,
        `longitude=${celula.lng.toFixed(1)}`,
        `hourly=${VARIAVEIS_HORARIAS.join(',')}`,
        `models=${MODELO}`,
        'wind_speed_unit=ms',
        'timezone=GMT',
        'timeformat=unixtime',
        `start_date=${inicio}`,
        `end_date=${fim}`,
    ];
    return `${raiz(base)}/v1/forecast?${parametros.join('&')}`;
}

/**
 * The run metadata of the pinned model: no coordinate in it.
 * @param {string} base
 * @returns {string}
 */
export function montarUrlDaRodada(base) {
    return `${raiz(base)}/data/${MODELO_DA_RODADA}/static/meta.json`;
}

/**
 * @typedef {Object} SerieHoraria
 * @property {number[]} tempos - instants, ms UTC
 * @property {Object<string, Array<number|null>>} valores - one array per variable, same length
 * @property {number|null} elevacao - the reference elevation the source used, m
 * @property {{lat: number, lng: number}|null} grade - the grid cell the source answered with
 */

/**
 * Reads and checks the forecast response. Anything but the expected shape is a `formato` failure:
 * a half-read series shown as a table would be worse than no table.
 * @param {*} json
 * @returns {SerieHoraria}
 * @throws {FalhaDaFonte}
 */
export function lerSerie(json) {
    const horas = json?.hourly;
    if (!horas || !Array.isArray(horas.time) || horas.time.length === 0) throw new FalhaDaFonte('formato');
    if (!horas.time.every((t) => Number.isFinite(t))) throw new FalhaDaFonte('formato');
    const n = horas.time.length;
    const valores = {};
    for (const v of VARIAVEIS_HORARIAS) {
        const serie = horas[v];
        if (!Array.isArray(serie) || serie.length !== n) throw new FalhaDaFonte('formato');
        valores[v] = serie.map((x) => (Number.isFinite(x) ? x : null));
    }
    return {
        tempos: horas.time.map((t) => t * 1000),
        valores,
        elevacao: Number.isFinite(json.elevation) ? json.elevation : null,
        grade: Number.isFinite(json.latitude) && Number.isFinite(json.longitude)
            ? { lat: json.latitude, lng: json.longitude }
            : null,
    };
}

/**
 * Reads the run metadata; anything unexpected is "run unknown", never a failure of the panel.
 * @param {*} json
 * @returns {{inicioMs: number, intervaloMs: number|null}|null}
 */
export function lerRodada(json) {
    const inicio = json?.last_run_initialisation_time;
    if (!Number.isFinite(inicio)) return null;
    const intervalo = json?.update_interval_seconds;
    return { inicioMs: inicio * 1000, intervaloMs: Number.isFinite(intervalo) ? intervalo * 1000 : null };
}

/**
 * @typedef {Object} Previsao
 * @property {{lat: number, lng: number}} celula - the point that was sent
 * @property {string[]} noAlcance - the requested dates the forecast reaches
 * @property {SerieHoraria|null} serie - null when no date is in reach
 * @property {{inicioMs: number, intervaloMs: number|null}|null} rodada
 */

/**
 * The source, with a memory cache by cell, dates and run.
 * @param {Object} opcoes
 * @param {string} opcoes.base - the Open-Meteo root, from `services.meteorologiaUrl`
 * @param {(url: string, opcoes: Object) => Promise<Response>} [opcoes.transporte] - `fetch`
 * @param {() => number} [opcoes.agora]
 * @param {number} [opcoes.limiteDoCache]
 * @param {{previsao: number, rodada: number}} [opcoes.tempoLimiteMs] - test seam
 * @returns {{consultar: (ponto: {lat: number, lng: number}, datas: string[]) => Promise<Previsao>}}
 */
export function criarFonteMeteorologica({
    base,
    transporte = (url, opcoes) => globalThis.fetch(url, opcoes),
    agora = () => Date.now(),
    limiteDoCache = 20,
    tempoLimiteMs = { previsao: TEMPO_LIMITE_PREVISAO_MS, rodada: TEMPO_LIMITE_RODADA_MS },
}) {
    /** @type {Map<string, SerieHoraria>} */
    const cache = new Map();
    let rodada = null;
    let rodadaLidaEm = -Infinity;

    async function chamar(url, limiteMs) {
        let resposta;
        try {
            // A timeout, and nothing else, added per call: the options stay credential-free.
            resposta = await transporte(url, { ...OPCOES_DA_REQUISICAO, signal: AbortSignal.timeout(limiteMs) });
        } catch {
            throw new FalhaDaFonte('rede');
        }
        if (!resposta?.ok) throw new FalhaDaFonte('http', Number.isInteger(resposta?.status) ? resposta.status : null);
        try {
            return await resposta.json();
        } catch {
            throw new FalhaDaFonte('formato');
        }
    }

    async function rodadaAtual() {
        if (agora() - rodadaLidaEm < VALIDADE_DA_RODADA_MS) return rodada;
        try {
            rodada = lerRodada(await chamar(montarUrlDaRodada(base), tempoLimiteMs.rodada));
        } catch {
            rodada = null; // a stamp without the run, never a panel without the forecast
        }
        rodadaLidaEm = agora();
        return rodada;
    }

    return {
        async consultar(ponto, datas) {
            const celula = arredondarPonto(ponto);
            const noAlcance = diasNoAlcance(datas, agora());
            if (noAlcance.length === 0) return { celula, noAlcance, serie: null, rodada: null };

            const ordenadas = [...noAlcance].sort();
            // Without the run, the hour bucket: a forecast is never older than an hour in the cache.
            const chaveDa = (r) => `${celula.lat},${celula.lng}|${ordenadas[0]}|${ordenadas[ordenadas.length - 1]}|`
                + `${r ? r.inicioMs : Math.floor(agora() / 3600000)}`;

            // A run still valid in memory settles the cache without any request.
            if (agora() - rodadaLidaEm < VALIDADE_DA_RODADA_MS) {
                const guardada = cache.get(chaveDa(rodada));
                if (guardada) return { celula, noAlcance, serie: guardada, rodada };
            }

            // Otherwise the run and the forecast go TOGETHER: in series, a dropped network would
            // make the person wait for both timeouts one after the other.
            const [rodadaDaVez, serie] = await Promise.all([
                rodadaAtual(),
                chamar(montarUrlDaPrevisao(base, celula, noAlcance), tempoLimiteMs.previsao).then(lerSerie),
            ]);
            cache.set(chaveDa(rodadaDaVez), serie);
            while (cache.size > limiteDoCache) cache.delete(cache.keys().next().value);
            return { celula, noAlcance, serie, rodada: rodadaDaVez };
        },
    };
}
