// Path: tests/unit/luminosidade-referencia-usno.test.js

/**
 * @fileoverview THE REFERENCE TABLE of the PITCIC light matrix: the model against the U.S. Naval
 * Observatory, every day of 2026, at seven points. Without this table there is no delivery.
 *
 * ── THE SOURCE, and what it reaches ─────────────────────────────────────────────────────────
 *
 * `tests/fixtures/usno-2026/<ponto>.txt` holds, VERBATIM, the five year tables of the USNO
 * "Table of Sunrise/Sunset, Moonrise/Moonset, or Twilight Times for an Entire Year" (tasks 0 to 4:
 * Sun rise/set, Moon rise/set, civil, nautical and astronomical twilight), zone 3 h west (P),
 * captured on 2026-09-23 from
 *
 *   https://aa.usno.navy.mil/calculated/rstt/year?ID=AA&year=2026&task=<0..4>&lat=<lat>&lon=<lon>
 *     &label=<ponto>&tz=3.00&tz_sign=-1&submit=Get+Data
 *
 * with the coordinates of {@link PONTOS}. The proposal of 2026-08-14 said USNO does NOT publish the
 * nautical and astronomical twilights; its one-day API does not, and this year table does, which
 * is what lets the ICMN, the FCVN and the ±18° lines be checked against an institution and not only
 * against a second library. `fases-da-lua-2026-2027.txt` is the USNO phases API (UT), condensed.
 * The files are frozen because the suite runs with no network and must answer the same forever.
 *
 * ── THE TOLERANCE ───────────────────────────────────────────────────────────────────────────
 *
 * ONE MINUTE, written here and not in a comment of the model: USNO rounds to the whole minute, so
 * half a minute of the error is the reference's own rounding. Measured on this tree on 2026-09-23:
 * over the six Brazilian points, 25550 comparisons (4 Sun tables × 730 plus 705 Moon events, per
 * point), the worst was 0.57 min.
 *
 * ── WHAT IS NOT HERE, said so it does not look covered ──────────────────────────────────────
 *
 * The Moon at Ferraz station: 14 of 661 events miss by more than a minute (up to 4.2 min, and one
 * set not found), all on GRAZING passages, where the Moon rises and sets within minutes of each
 * other and the crossing time is ill-conditioned. The astronomical twilight at Ferraz also stays
 * out: its season edges graze the −18° line the same way. The panel still answers there; this table
 * just does not vouch for it. The year 2026 only: the library follows Meeus and should hold the
 * minute for decades, but this table proves the year it contains.
 *
 * ── THE NEGATIVE CONTROLS, codified ────────────────────────────────────────────────────────
 *
 * Each trap of the proposal (A1 longitude sign, A2 the Moon's UTC day, A3 the Sun's solar day, L2
 * the centred phase window) has a case that runs the WRONG variant against the same reference and
 * requires it to FAIL, with the count. A green that stays green with the code broken proves
 * nothing, and a control that lives only in a chat transcript is lost.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { efemerides } from '../../src/js/utilities/luminosidade/efemerides.js';
import {
    criarCalculadora,
    matrizPitcic,
    nomeDaFase,
    sobreposicao,
    FASES_LUNARES,
} from '../../src/js/utilities/luminosidade/matriz-pitcic.model.js';
import {
    arredondarAoMinuto,
    meiaNoiteP,
    somarDias,
    MS_POR_DIA,
} from '../../src/js/utilities/luminosidade/hora-brasilia.js';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/usno-2026');

/** Tolerance against USNO, in minutes. See the fileoverview. */
const TOLERANCIA_MIN = 1;

/** The capture coordinates. Changing one without recapturing its file is a lie. */
const PONTOS = Object.freeze({
    'porto-alegre': { lat: -30.0346, lng: -51.2177 },
    brasilia: { lat: -15.78, lng: -47.929167 },
    manaus: { lat: -3.1019, lng: -60.025 },
    'boa-vista': { lat: 2.8235, lng: -60.6758 },
    'rio-branco': { lat: -9.9747, lng: -67.8243 },
    recife: { lat: -8.0476, lng: -34.877 },
    ferraz: { lat: -62.0847, lng: -58.3928 },
});

const BRASILEIROS = Object.freeze(['porto-alegre', 'brasilia', 'manaus', 'boa-vista', 'rio-branco', 'recife']);

/** USNO task → the model's [morning, evening] keys. Task 1 is the Moon. */
const CHAVES_DA_TAREFA = Object.freeze({
    0: ['nascer', 'por'],
    2: ['inicioCivil', 'fimCivil'],
    3: ['icmn', 'fcvn'],
    4: ['primeiraClaridade', 'ultimaClaridade'],
});

const MS_MIN = 60000;
const P_MS = 3 * 3600 * 1000;

/**
 * Reads the five USNO tables of one point.
 *
 * The layout is FIXED-COLUMN: day in [0, 2), then month m's first value at [4 + 11m, 8 + 11m) and
 * second at [9 + 11m, 13 + 11m). A blank means no event that day; `////`, `****` and `====` are
 * USNO's markers for a Sun continuously above or below the limit. Ferraz has CONTINUATION rows
 * (the same day number again, carrying a second event of that day), and they are read the same way.
 * @param {string} ponto
 * @returns {Object<number, {eventos: Array<{data: string, col: number, instante: number}>,
 *   marcas: Array<{data: string, col: number, marca: string}>}>}
 */
function lerTabelas(ponto) {
    const texto = readFileSync(join(FIXTURES, `${ponto}.txt`), 'utf8');
    const tabelas = {};
    for (const bloco of texto.split('#TAREFA ').slice(1)) {
        const tarefa = Number(bloco[0]);
        const eventos = [];
        const marcas = [];
        for (const linha of bloco.split(/\r?\n/)) {
            if (!/^\d\d /.test(linha)) continue;
            const dia = Number(linha.slice(0, 2));
            for (let m = 0; m < 12; m++) {
                for (let col = 0; col < 2; col++) {
                    const inicio = 4 + 11 * m + 5 * col;
                    const valor = linha.slice(inicio, inicio + 4);
                    const data = `2026-${String(m + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
                    if (/^\d{4}$/.test(valor)) {
                        const [h, mi] = [Number(valor.slice(0, 2)), Number(valor.slice(2))];
                        eventos.push({ data, col, instante: Date.UTC(2026, m, dia, h, mi) + P_MS });
                    } else if (/^(\/{4}|\*{4}|={4})$/.test(valor)) {
                        marcas.push({ data, col, marca: valor });
                    }
                }
            }
        }
        tabelas[tarefa] = { eventos, marcas };
    }
    return tabelas;
}

const TABELAS = Object.fromEntries(Object.keys(PONTOS).map((p) => [p, lerTabelas(p)]));

/** Every civil date of 2026. */
const DATAS_2026 = (() => {
    const datas = [];
    for (let d = '2026-01-01'; d.startsWith('2026'); d = somarDias(d, 1)) datas.push(d);
    return datas;
})();

/** @returns {number} |a − b| in minutes */
const difMin = (a, b) => Math.abs(a - b) / MS_MIN;

/**
 * Every Moon rise and set the model's calculator produces over 2026 (P), from the UTC days that
 * cover it, de-duplicated the way the model de-duplicates.
 * @param {ReturnType<typeof criarCalculadora>} calc
 */
function eventosDaLuaDoAno(calc) {
    const inicio = meiaNoiteP('2026-01-01');
    const fim = meiaNoiteP('2027-01-01');
    const eventos = [];
    for (let d = Math.floor(inicio / MS_POR_DIA) - 1; d <= Math.floor(fim / MS_POR_DIA) + 1; d++) {
        const r = calc.luaNoDiaUtc(d);
        if (r.nasce !== null) eventos.push({ col: 0, instante: r.nasce });
        if (r.poe !== null) eventos.push({ col: 1, instante: r.poe });
    }
    // The year is cut by the ROUNDED instant, as USNO cuts it: at Recife the model's last rise of
    // 2026 is 23:59:33 P on 12-31, which the minute makes 00:00 of 2027-01-01, and USNO lists it
    // in the next year's table.
    return eventos
        .filter((e, i, todos) => !todos.slice(0, i).some((o) => o.col === e.col && difMin(o.instante, e.instante) < 10))
        .filter((e) => arredondarAoMinuto(e.instante) >= inicio && arredondarAoMinuto(e.instante) < fim);
}

// ============================================================================================
// THE INSTRUMENT
// ============================================================================================

describe('o instrumento: o leitor das tabelas do USNO', () => {
    it('leu as cinco tabelas de cada ponto, com a contagem que o USNO publica', () => {
        // Vacuum control: a parser that stopped reading would make every comparison below pass
        // over an empty list.
        for (const ponto of BRASILEIROS) {
            for (const tarefa of [0, 2, 3, 4]) {
                expect(TABELAS[ponto][tarefa].eventos, `${ponto} tarefa ${tarefa}`).toHaveLength(730);
            }
            expect(TABELAS[ponto][1].eventos, `${ponto} Lua`).toHaveLength(705);
        }
    });

    it('lê o valor na coluna certa (Brasília, 24/09: náutico 05:13 e 18:54, Lua 16:29)', () => {
        const nautico = TABELAS.brasilia[3].eventos.filter((e) => e.data === '2026-09-24');
        expect(nautico.map((e) => new Date(e.instante - P_MS).toISOString().slice(11, 16))).toEqual(['05:13', '18:54']);
        const lua = TABELAS.brasilia[1].eventos.filter((e) => e.data === '2026-09-24' && e.col === 0);
        expect(lua.map((e) => new Date(e.instante - P_MS).toISOString().slice(11, 16))).toEqual(['16:29']);
    });

    it('reconhece as marcas de Sol contínuo em Ferraz (dezembro inteiro sem noite náutica)', () => {
        const dezembro = TABELAS.ferraz[3].marcas.filter((m) => m.data.startsWith('2026-12-') && m.marca === '////');
        expect(dezembro).toHaveLength(62);
    });
});

// ============================================================================================
// THE SUN
// ============================================================================================

describe('o Sol contra o USNO, todo dia de 2026, seis pontos brasileiros', () => {
    it.each(BRASILEIROS)('%s: nascer, ocaso e os três crepúsculos a até um minuto', (ponto) => {
        const calc = criarCalculadora(PONTOS[ponto], efemerides);
        let comparacoes = 0;
        let pior = 0;
        const fora = [];
        for (const [tarefa, chaves] of Object.entries(CHAVES_DA_TAREFA)) {
            for (const e of TABELAS[ponto][tarefa].eventos) {
                const modelo = calc.diaSolar(e.data).horarios[chaves[e.col]];
                const dif = modelo === null ? Infinity : difMin(modelo, e.instante);
                comparacoes++;
                pior = Math.max(pior, dif);
                if (dif > TOLERANCIA_MIN) fora.push(`${e.data} ${chaves[e.col]} ${dif.toFixed(2)} min`);
            }
        }
        expect(comparacoes).toBe(2920);
        expect(fora).toEqual([]);
        expect(pior).toBeLessThanOrEqual(TOLERANCIA_MIN);
    });

    it('Ferraz: nascer, ocaso, civil e náutico a até um minuto onde o USNO publica horário', () => {
        const calc = criarCalculadora(PONTOS.ferraz, efemerides);
        let comparacoes = 0;
        const fora = [];
        for (const tarefa of [0, 2, 3]) {
            const chaves = CHAVES_DA_TAREFA[tarefa];
            for (const e of TABELAS.ferraz[tarefa].eventos) {
                // Near the season edges the event sits close to midnight and belongs to the
                // neighbouring solar day, so the nearest of three solar days is the match.
                let melhor = Infinity;
                for (const n of [-1, 0, 1]) {
                    const v = calc.diaSolar(somarDias(e.data, n)).horarios[chaves[e.col]];
                    if (v !== null) melhor = Math.min(melhor, difMin(v, e.instante));
                }
                comparacoes++;
                if (melhor > TOLERANCIA_MIN) fora.push(`${e.data} ${chaves[e.col]} ${melhor.toFixed(2)} min`);
            }
        }
        expect(comparacoes).toBeGreaterThan(1800);
        expect(fora).toEqual([]);
    });

    it('E2, Ferraz: onde o USNO marca Sol acima do limite o dia inteiro, ICMN e FCVN são nulos, com motivo', () => {
        const calc = criarCalculadora(PONTOS.ferraz, efemerides);
        const marcados = new Set(TABELAS.ferraz[3].marcas
            .filter((m) => m.marca === '////').map((m) => m.data));
        // THE SEASON'S EDGE DAY IS LEFT OUT, and it is the only one: a marked day whose neighbour
        // has times. The library solves the twilight with the Sun's declination at NOON, so on the
        // first night the Sun grazes −12° it can place a brief twilight the night before USNO does
        // (2026-02-05: the model finds an ICMN at 01:09 P that USNO puts on the 6th). That is
        // minutes of grazing at 62°S, and the interior of the season is what E2 is about.
        // Outside the table (2025-12-31, 2027-01-01) is the same polar summer, so it counts as marked.
        const marcado = (d) => marcados.has(d) || !d.startsWith('2026-');
        const semNoiteNautica = [...marcados].filter((d) => marcado(somarDias(d, -1)) && marcado(somarDias(d, 1)));
        expect(marcados.size - semNoiteNautica.length, 'uma borda por fim de estação').toBe(2);
        // Vacuum control, and the headline case of the proposal (2026-12-21) is in the list.
        expect(semNoiteNautica.length).toBeGreaterThan(60);
        expect(semNoiteNautica).toContain('2026-12-21');
        const divergentes = [];
        for (const data of semNoiteNautica) {
            const dia = calc.diaSolar(data);
            for (const chave of ['icmn', 'fcvn']) {
                if (dia.horarios[chave] !== null || dia.motivos[chave] !== 'nunca-desce') divergentes.push(`${data} ${chave}`);
            }
        }
        expect(divergentes).toEqual([]);

        // And the rest of that day still exists: the null is per FIELD, never per day (A4).
        const natal = calc.diaSolar('2026-12-21');
        expect(natal.horarios.nascer).not.toBeNull();
        expect(natal.horarios.por).not.toBeNull();
    });
});

// ============================================================================================
// THE MOON
// ============================================================================================

describe('a Lua contra o USNO, todo dia de 2026, seis pontos brasileiros', () => {
    it.each(BRASILEIROS)('%s: todo nascer e ocaso a até um minuto, e nenhum a mais', (ponto) => {
        const calc = criarCalculadora(PONTOS[ponto], efemerides);
        const modelo = eventosDaLuaDoAno(calc);
        const usno = TABELAS[ponto][1].eventos;
        const fora = [];
        for (const e of usno) {
            const melhor = Math.min(...modelo.filter((m) => m.col === e.col).map((m) => difMin(m.instante, e.instante)));
            if (melhor > TOLERANCIA_MIN) fora.push(`${e.data} ${e.col ? 'ocaso' : 'nascer'} ${melhor.toFixed(2)} min`);
        }
        expect(fora).toEqual([]);
        // Both directions: an extra event of the model (a phantom rise) would pass the loop above.
        expect(modelo).toHaveLength(usno.length);
    });
});

// ============================================================================================
// L3: THE MOON OF THE NIGHT, reconstructed from USNO alone
// ============================================================================================

/**
 * The passage that covers the night of D, computed ONLY from the USNO tables: night from the USNO
 * nautical dusk of D to its nautical dawn of D+1, passages from the USNO rises and sets.
 * @param {string} ponto
 * @param {string} data
 * @returns {{nasce: number, poe: number}|null|undefined} undefined when the tables do not reach
 */
function luarPeloUsno(ponto, data) {
    const nautico = TABELAS[ponto][3].eventos;
    const inicio = nautico.find((e) => e.data === data && e.col === 1)?.instante;
    const fim = nautico.find((e) => e.data === somarDias(data, 1) && e.col === 0)?.instante;
    if (inicio === undefined || fim === undefined) return undefined;
    const eventos = [...TABELAS[ponto][1].eventos].sort((a, b) => a.instante - b.instante);
    let melhor = null;
    let melhorSobreposicao = 0;
    for (let i = 0; i < eventos.length; i++) {
        if (eventos[i].col !== 0) continue;
        const poe = eventos.slice(i + 1).find((e) => e.col === 1);
        if (!poe) continue;
        const s = Math.min(poe.instante, fim) - Math.max(eventos[i].instante, inicio);
        if (s > melhorSobreposicao) {
            melhor = { nasce: eventos[i].instante, poe: poe.instante };
            melhorSobreposicao = s;
        }
    }
    return melhor;
}

describe('L3: "Ini Luar" e "Fim do luar" são a passagem que cobre a noite de D', () => {
    it.each(BRASILEIROS)('%s: a matriz concorda com a reconstrução só pelo USNO em toda noite', (ponto) => {
        const divergentes = [];
        let noites = 0;
        let semLuar = 0;
        // 01-02 to 12-30: the reconstruction needs the USNO passage whole, and the tables stop at
        // the year's edges.
        for (const data of DATAS_2026.slice(1, -1)) {
            const esperado = luarPeloUsno(ponto, data);
            if (esperado === undefined) continue;
            noites++;
            const { lua } = matrizPitcic(data, PONTOS[ponto], efemerides, { dias: 1 }).colunas[0];
            if (esperado === null) {
                semLuar++;
                if (!lua.semLuar || lua.nasce !== null) divergentes.push(`${data} esperava sem luar`);
                continue;
            }
            if (lua.nasce === null || difMin(lua.nasce, esperado.nasce) > TOLERANCIA_MIN
                || lua.poe === null || difMin(lua.poe, esperado.poe) > TOLERANCIA_MIN) {
                divergentes.push(`${data} nasce/poe divergem`);
            }
        }
        expect(noites).toBe(363);
        expect(semLuar, 'nenhuma noite sem luar: o caso E3 deixou de ser exercitado').toBeGreaterThan(20);
        expect(divergentes).toEqual([]);
    });

    it('E3, Porto Alegre: 37 das 365 noites de 2026 ficam sem luar, e nenhuma noite tem duas passagens', () => {
        let semLuar = 0;
        let duasPassagens = 0;
        const calc = criarCalculadora(PONTOS['porto-alegre'], efemerides);
        for (const data of DATAS_2026) {
            const noite = calc.noiteDe(data);
            const tocam = calc.passagensDaLua(noite.inicio, noite.fim).filter((p) => sobreposicao(p, noite) > 0);
            if (tocam.length === 0) semLuar++;
            if (tocam.length > 1) duasPassagens++;
        }
        expect(semLuar).toBe(37);
        expect(duasPassagens).toBe(0);
    });
});

// ============================================================================================
// L2: THE CENTRED PHASE WINDOW
// ============================================================================================

const FASES_USNO = readFileSync(join(FIXTURES, 'fases-da-lua-2026-2027.txt'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^\d{4}-/.test(l))
    .map((l) => {
        const [iso, ...nome] = l.split(' ');
        return { instante: Date.parse(iso.replace('Z', ':00Z')), nome: nome.join(' ') };
    });

const NOME_USNO = Object.freeze({
    'New Moon': 'nova', 'First Quarter': 'crescente', 'Full Moon': 'cheia', 'Last Quarter': 'minguante',
});

/**
 * The three borders around every principal phase: the name at the phase instant, 3 days either
 * side (still inside the 7.38-day window; measured, the border is 3.20 to 4.15 days from a full
 * Moon in 2026 and 2027), and 4.5 days either side (in the neighbour window).
 * @param {(fase: number) => string|null} nomear
 * @returns {string[]} the failures
 */
function fronteirasEmTornoDasFases(nomear) {
    const falhas = [];
    const nomeEm = (t) => nomear(efemerides.iluminacaoDaLua(t).fase);
    for (const { instante, nome } of FASES_USNO) {
        const esperado = NOME_USNO[nome];
        const i = FASES_LUNARES.indexOf(esperado);
        const antes = FASES_LUNARES[(i + 3) % 4];
        const depois = FASES_LUNARES[(i + 1) % 4];
        const casos = [
            [0, esperado], [-3 * MS_POR_DIA, esperado], [3 * MS_POR_DIA, esperado],
            [-4.5 * MS_POR_DIA, antes], [4.5 * MS_POR_DIA, depois],
        ];
        for (const [desvio, nomeEsperado] of casos) {
            const obtido = nomeEm(instante + desvio);
            if (obtido !== nomeEsperado) falhas.push(`${nome} ${new Date(instante).toISOString()} ${desvio / MS_POR_DIA} d: ${obtido}`);
        }
    }
    return falhas;
}

describe('L2: a fase lunar é a janela de sete dias CENTRADA no instante da fase (Fig 4-11)', () => {
    it('as 99 fases principais do USNO de 2026 e 2027, e as três fronteiras em torno de cada uma', () => {
        expect(FASES_USNO).toHaveLength(99);
        expect(fronteirasEmTornoDasFases(nomeDaFase)).toEqual([]);
    });

    it('no instante de cada fase do USNO, a fase da biblioteca fica a menos de 0,02 de ciclo do alvo', () => {
        // The residue (up to 0.014, 5°) is not error: the library's phase is the Sun–Moon–Earth
        // angle, and at new and full Moon the Moon's ecliptic latitude keeps that angle off zero.
        const alvo = { 'New Moon': 0, 'First Quarter': 0.25, 'Full Moon': 0.5, 'Last Quarter': 0.75 };
        for (const { instante, nome } of FASES_USNO) {
            const d = Math.abs(efemerides.iluminacaoDaLua(instante).fase - alvo[nome]);
            expect(Math.min(d, 1 - d), `${nome} ${new Date(instante).toISOString()}`).toBeLessThan(0.02);
        }
    });

    it('CONTROLE NEGATIVO: janelas que COMEÇAM na fase, em vez de centradas nela, reprovam', () => {
        const naoCentrada = (fase) => FASES_LUNARES[Math.floor((((fase % 1) + 1) % 1) * 4) % 4];
        const falhas = fronteirasEmTornoDasFases(naoCentrada);
        // Every phase fails at least the "3 days before" case, which falls in the previous window.
        expect(falhas.length).toBeGreaterThanOrEqual(FASES_USNO.length);
    });
});

// ============================================================================================
// THE OTHER NEGATIVE CONTROLS
// ============================================================================================

describe('controles negativos das armadilhas A1, A2 e A3', () => {
    /**
     * @param {string} ponto
     * @param {(data: string) => Object} horarios - the variant under test
     * @returns {number} days whose sunrise misses USNO by more than the tolerance
     */
    function nasceresErrados(ponto, horarios) {
        let errados = 0;
        for (const e of TABELAS[ponto][0].eventos) {
            if (e.col !== 0) continue;
            const v = horarios(e.data).nascer;
            if (v === null || difMin(v, e.instante) > TOLERANCIA_MIN) errados++;
        }
        return errados;
    }

    it('A1: com o sinal da longitude invertido, o nascer erra em quase todo dia de Brasília', () => {
        const invertido = criarCalculadora({ lat: PONTOS.brasilia.lat, lng: -PONTOS.brasilia.lng }, efemerides);
        expect(nasceresErrados('brasilia', (d) => invertido.diaSolar(d).horarios)).toBeGreaterThanOrEqual(360);
    });

    it('A3: passar a MEIA-NOITE de Brasília devolve a véspera a oeste de 45°W, e acerta no litoral nordestino', () => {
        const pelaMeiaNoite = (ponto) => (data) => efemerides.horariosDoSol(meiaNoiteP(data), PONTOS[ponto].lat, PONTOS[ponto].lng);
        expect(nasceresErrados('brasilia', pelaMeiaNoite('brasilia'))).toBe(365);
        expect(nasceresErrados('boa-vista', pelaMeiaNoite('boa-vista'))).toBe(365);
        expect(nasceresErrados('rio-branco', pelaMeiaNoite('rio-branco'))).toBe(365);
        // The trap that makes a coastal-only table useless: the wrong instant is RIGHT here.
        expect(nasceresErrados('recife', pelaMeiaNoite('recife'))).toBe(0);
    });

    it('A2: o dia da Lua da biblioteca é o dia UTC, e tomar a data de Brasília por ele erra o nascer tardio', () => {
        // The naive reading: ask the library for the day of the P date and take its rise.
        const { lat, lng } = PONTOS.brasilia;
        let tardios = 0;
        let erradosIngenuo = 0;
        for (const e of TABELAS.brasilia[1].eventos) {
            if (e.col !== 0) continue;
            const horaP = new Date(e.instante - P_MS).getUTCHours();
            const [ano, mes, dia] = e.data.split('-').map(Number);
            const ingenuo = efemerides.eventosDaLuaNoDiaUtc(Date.UTC(ano, mes - 1, dia), lat, lng).nasce;
            const errado = ingenuo === null || difMin(ingenuo, e.instante) > TOLERANCIA_MIN;
            if (horaP >= 21) {
                tardios++;
                if (errado) erradosIngenuo++;
            }
        }
        // Every rise between 21:00 and 24:00 P falls on the NEXT UTC day, so the naive reading
        // misses all of them; the model (checked above, event by event) misses none.
        expect(tardios).toBeGreaterThan(40);
        expect(erradosIngenuo).toBe(tardios);
    });
});
