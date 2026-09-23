// Path: js/admin/ambiente-phrases.js

/**
 * @fileoverview What the two admin tabs SAY about the browser environment (2026-09-23): the
 * environment block of a defect occurrence (Diagnóstico) and the browsers and systems of the
 * sessions (Uso). Pure functions, testable in node.
 *
 * TWO IMPORTS, both safe for `admin.html`, which boots without the store: the session leaf that
 * holds the one User-Agent parser of the product (zero imports), and `uso-phrases.js` for the
 * number and percent formatters, so a share here and a share in the neighboring table are
 * written by the same rule.
 *
 * THE PARSER IS READ HERE ONLY AS A FALLBACK. An occurrence that carries `ambiente` is shown as
 * the client declared it; the User-Agent is parsed only for reports that predate the block, and
 * the tab says so, because "the UA says Windows NT 10.0" and "the machine runs Windows 10" are
 * different claims.
 *
 * ONE READING IS A DECISION AND NOT A FORMAT: Windows. Every Windows 10 and 11 declares "Windows
 * NT 10.0" in the User-Agent, so without the Client Hints (Chromium only, secure context only)
 * the honest label is "Windows 10 ou 11". With them, the platform major version tells: 13 and
 * above is Windows 11. Firefox never sends Client Hints, and about half of the users run Firefox.
 *
 * EVERY TEXT HERE GOES TO THE SCREEN BY `textContent`. The GPU name, the language and the time
 * zone are what a browser declared about itself.
 */

import { analisarUserAgent, versaoPrincipal } from '@js/session/ambiente-do-navegador.js';
import { numeroLabel, percentualLabel, estadoDaFonte, HORIZONTE, dataLocal, instanteDe } from './uso-phrases.js';

/** Display names of the browser families. */
export const NAVEGADOR_NOME = Object.freeze({
    chrome: 'Chrome',
    firefox: 'Firefox',
    edge: 'Edge',
    safari: 'Safari',
    opera: 'Opera',
    outro: 'Outro navegador',
});

/** Display names of the system families. */
export const SO_NOME = Object.freeze({
    windows: 'Windows',
    macos: 'macOS',
    linux: 'Linux',
    chromeos: 'ChromeOS',
    android: 'Android',
    ios: 'iOS / iPadOS',
    outro: 'Outro sistema',
});

/** Display names of the device kinds. */
export const DISPOSITIVO_NOME = Object.freeze({
    desktop: 'Computador',
    movel: 'Celular',
    tablet: 'Tablet',
});

/** @param {*} tabela @param {*} chave @returns {string|null} */
function nomeDe(tabela, chave) {
    return typeof chave === 'string' && Object.hasOwn(tabela, chave) ? tabela[chave] : null;
}

/** @param {*} v @returns {boolean} */
function objeto(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * A browser family by name. Absent is "não declarado", never "outro": `outro` is a UA the parser
 * did not recognize, and absence is a report that said nothing.
 * @param {*} familia
 * @returns {string}
 */
export function navegadorNome(familia) {
    return nomeDe(NAVEGADOR_NOME, familia) ?? 'Navegador não declarado';
}

/** @param {*} familia @returns {string} */
export function soNome(familia) {
    return nomeDe(SO_NOME, familia) ?? 'Sistema não declarado';
}

/**
 * "Firefox 143": the family and the MAJOR version, which is what distinguishes two builds a
 * defect can depend on without spelling a patch number nobody compares.
 * @param {*} familia
 * @param {*} versao - A version string or a major number.
 * @returns {string}
 */
export function navegadorComVersaoLabel(familia, versao) {
    const nome = nomeDe(NAVEGADOR_NOME, familia);
    // A version without a family is a number about nothing: the label says only what is known.
    if (nome === null) return navegadorNome(familia);
    const principal = versaoPrincipal(versao);
    return principal === null ? nome : `${nome} ${principal}`;
}

/** Windows NT versions older than 10, which the UA still tells apart. */
const WINDOWS_NT = Object.freeze({ '6.1': 'Windows 7', '6.2': 'Windows 8', '6.3': 'Windows 8.1' });

/**
 * The operating system as a reading, with the reason in `detalhe` when the reading is partial.
 * @param {{so?: *, soVersao?: *, soVersaoCh?: *}} [ambiente]
 * @returns {{texto: string, detalhe: string}}
 */
export function sistemaLabel(ambiente) {
    const a = objeto(ambiente) ? ambiente : {};
    const ch = typeof a.soVersaoCh === 'string' ? a.soVersaoCh : '';
    const ua = typeof a.soVersao === 'string' ? a.soVersao : '';
    const principalCh = versaoPrincipal(ch);
    if (a.so === 'windows') {
        if (principalCh !== null) {
            const nome = principalCh >= 13 ? 'Windows 11' : principalCh >= 1 ? 'Windows 10' : 'Windows 7 ou 8';
            return { texto: nome, detalhe: `Versão da plataforma informada pelo navegador: ${ch}.` };
        }
        if (Object.hasOwn(WINDOWS_NT, ua)) return { texto: WINDOWS_NT[ua], detalhe: '' };
        if (ua === '10.0') {
            return {
                texto: 'Windows 10 ou 11',
                detalhe: 'O navegador informa "Windows NT 10.0" nos dois. Só navegadores baseados no '
                    + 'Chromium, em conexão segura (HTTPS), dizem qual é; o Firefox nunca diz.',
            };
        }
        return { texto: 'Windows', detalhe: '' };
    }
    if (a.so === 'macos') {
        if (ch) return { texto: `macOS ${ch.split('.').slice(0, 2).join('.')}`, detalhe: '' };
        return {
            texto: 'macOS',
            detalhe: 'O navegador informa uma versão congelada do macOS; a real só vem de navegadores '
                + 'baseados no Chromium, em conexão segura (HTTPS).',
        };
    }
    if (a.so === 'android') {
        const v = ch || ua;
        return { texto: v ? `Android ${versaoPrincipal(v) ?? v}` : 'Android', detalhe: '' };
    }
    if (a.so === 'ios') {
        return { texto: ua ? `iOS ${ua}` : SO_NOME.ios, detalhe: '' };
    }
    return { texto: soNome(a.so), detalhe: '' };
}

/**
 * The environment of one occurrence, preferring what it declared.
 * @param {*} ocorrencia
 * @returns {{ambiente: Object|null, declarado: boolean}}
 */
export function ambienteDaOcorrencia(ocorrencia) {
    if (objeto(ocorrencia?.ambiente) && Object.keys(ocorrencia.ambiente).length > 0) {
        return { ambiente: ocorrencia.ambiente, declarado: true };
    }
    const ua = typeof ocorrencia?.userAgent === 'string' ? ocorrencia.userAgent.trim() : '';
    if (ua) return { ambiente: analisarUserAgent(ua), declarado: false };
    return { ambiente: null, declarado: false };
}

/**
 * The short line of an occurrence button: "Firefox 143 · Windows 10 ou 11".
 * @param {*} ocorrencia
 * @returns {string}
 */
export function ambienteCurtoLabel(ocorrencia) {
    const { ambiente } = ambienteDaOcorrencia(ocorrencia);
    if (!ambiente) return 'navegador não declarado';
    return `${navegadorComVersaoLabel(ambiente.navegador, ambiente.navegadorVersao)} · ${sistemaLabel(ambiente).texto}`;
}

/** @returns {string} */
export function ambienteTitulo() {
    return 'Máquina desta ocorrência';
}

/**
 * The note above the environment rows, when the occurrence did not declare its environment.
 * @param {*} ocorrencia
 * @returns {string} Empty when the block was declared.
 */
export function ambienteAusenteNotice(ocorrencia) {
    if (ambienteDaOcorrencia(ocorrencia).declarado) return '';
    if (ocorrencia?.origem === 'servidor') {
        return 'Esta ocorrência é do servidor: não há navegador nem máquina por trás dela.';
    }
    if (typeof ocorrencia?.userAgent === 'string' && ocorrencia.userAgent.trim()) {
        return 'Esta ocorrência veio de uma versão anterior do EBGeo, que não informava a máquina. '
            + 'O navegador e o sistema abaixo foram lidos do user agent.';
    }
    return 'Esta ocorrência não informou o navegador nem a máquina.';
}

/** @param {*} n @returns {number|null} */
function inteiro(n) {
    return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * A size in megabytes as a person reads it: gigabytes from 1024 on.
 * @param {number} mb
 * @returns {string}
 */
function megabytesLabel(mb) {
    return mb >= 1024 ? `${decimal(mb / 1024, 1)} GB` : `${numeroLabel(mb)} MB`;
}

/** @param {*} n @param {number} casas @returns {string} */
function decimal(n, casas) {
    return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: casas }).format(n);
}

/**
 * The rows of the environment block, in reading order. A row the occurrence cannot fill says why
 * instead of vanishing, for the two readings that the browser withholds on purpose (memory and
 * GPU), because an empty cell there reads as a defect of the telemetry.
 * @param {*} ocorrencia
 * @returns {Array<{rotulo: string, valor: string, detalhe?: string, titulo?: string}>} `detalhe` is a
 *   visible explanation; `titulo` is hover text (the whole user agent, which is long).
 */
export function linhasDoAmbiente(ocorrencia) {
    const { ambiente: a, declarado } = ambienteDaOcorrencia(ocorrencia);
    if (!a) return [];
    const linhas = [];
    const ua = typeof ocorrencia?.userAgent === 'string' ? ocorrencia.userAgent.trim() : '';

    const versao = typeof a.navegadorVersao === 'string' && a.navegadorVersao ? ` ${a.navegadorVersao}` : '';
    linhas.push({ rotulo: 'Navegador', valor: `${navegadorNome(a.navegador)}${versao}`, titulo: ua });
    const so = sistemaLabel(a);
    linhas.push({ rotulo: 'Sistema', valor: so.texto, detalhe: so.detalhe });
    if (!declarado) return linhas;

    const dispositivo = nomeDe(DISPOSITIVO_NOME, a.dispositivo);
    if (dispositivo) {
        const toque = inteiro(a.toque);
        const sufixo = toque === null ? '' : toque === 0 ? ', sem toque' : `, com toque (${toque} pontos)`;
        linhas.push({ rotulo: 'Dispositivo', valor: `${dispositivo}${sufixo}` });
    }
    const tl = inteiro(a.telaLargura);
    const ta = inteiro(a.telaAltura);
    if (tl !== null && ta !== null) {
        const escala = typeof a.escala === 'number' && Number.isFinite(a.escala) ? `, escala ${decimal(a.escala, 2)}` : '';
        linhas.push({ rotulo: 'Tela', valor: `${tl} × ${ta}${escala}` });
    }
    const jl = inteiro(a.janelaLargura);
    const ja = inteiro(a.janelaAltura);
    if (jl !== null && ja !== null) linhas.push({ rotulo: 'Janela do navegador', valor: `${jl} × ${ja}` });
    const lugar = [a.idioma, a.fuso].filter((x) => typeof x === 'string' && x).join(' · ');
    if (lugar) linhas.push({ rotulo: 'Idioma e fuso', valor: lugar });
    const nucleos = inteiro(a.nucleos);
    if (nucleos !== null) {
        linhas.push({ rotulo: 'Processador', valor: `${nucleos} ${nucleos === 1 ? 'núcleo lógico' : 'núcleos lógicos'}` });
    }
    if (typeof a.memoriaGb === 'number' && Number.isFinite(a.memoriaGb)) {
        // `deviceMemory` is ROUNDED to a power of two and CAPPED by the browser, and the cap moved
        // between versions (8 for years, 32 in the Chromium of this writing), so the number is an
        // approximation and the tab says so instead of guessing the cap.
        linhas.push({
            rotulo: 'Memória',
            valor: `cerca de ${decimal(a.memoriaGb, 2)} GB`,
            detalhe: 'O navegador arredonda e limita este número; ele não é a memória exata da máquina.',
        });
    } else {
        linhas.push({
            rotulo: 'Memória',
            valor: 'não informada',
            detalhe: 'Só navegadores baseados no Chromium, em conexão segura, informam a memória.',
        });
    }
    if (a.webgl === 'nenhum') {
        linhas.push({ rotulo: 'WebGL', valor: 'indisponível: o navegador não criou um contexto WebGL' });
    } else if (a.webgl === 'webgl2' || a.webgl === 'webgl') {
        const textura = inteiro(a.texturaMax);
        const nome = a.webgl === 'webgl2' ? 'WebGL 2' : 'WebGL 1';
        linhas.push({ rotulo: 'WebGL', valor: textura === null ? nome : `${nome}, textura máxima ${textura}` });
        linhas.push(typeof a.gpu === 'string' && a.gpu
            ? { rotulo: 'Placa de vídeo', valor: a.gpu }
            : {
                rotulo: 'Placa de vídeo',
                valor: 'não informada',
                detalhe: 'O navegador escondeu o nome da placa (o Safari e o modo de proteção contra '
                    + 'rastreamento do Firefox fazem isso).',
            });
    }
    const uso = inteiro(a.armazenamentoUsoMb);
    const cota = inteiro(a.armazenamentoCotaMb);
    if (uso !== null || cota !== null) {
        // THE QUOTA IS ROUNDED ON PURPOSE (a power of two, `cotaArredondadaMb`): the exact Chromium
        // quota derives from the disk size and would help tell machines apart. The row says
        // "cerca de" and why, so the round number is not read as a measurement.
        const usado = uso === null ? '' : `${numeroLabel(uso)} MB usados`;
        const deCota = cota === null ? '' : `cota de cerca de ${megabytesLabel(cota)}`;
        const partes = [usado && deCota ? `${usado} de uma ${deCota}` : (usado || deCota)];
        if (a.armazenamentoPersistente === true) partes.push('persistente');
        if (a.armazenamentoPersistente === false) partes.push('o navegador pode apagar sob pressão de espaço');
        linhas.push({
            rotulo: 'Armazenamento local',
            valor: partes.join(', '),
            ...(cota === null ? {} : {
                detalhe: 'A cota é arredondada de propósito: o número exato ajudaria a identificar a máquina.',
            }),
        });
    }
    const sinais = [];
    if (typeof a.online === 'boolean') sinais.push(a.online ? 'conectado' : 'sem rede');
    if (typeof a.cookies === 'boolean') sinais.push(a.cookies ? 'cookies ativos' : 'cookies bloqueados');
    if (typeof a.indexedDB === 'boolean') sinais.push(a.indexedDB ? 'IndexedDB disponível' : 'IndexedDB indisponível');
    if (typeof a.contextoSeguro === 'boolean') sinais.push(a.contextoSeguro ? 'conexão segura' : 'conexão sem HTTPS');
    if (sinais.length) linhas.push({ rotulo: 'Navegador no instante', valor: sinais.join(' · ') });
    return linhas;
}

/**
 * "Nas 12 ocorrências guardadas: Firefox 143 (9), Chrome 140 (3)." The distribution of the
 * stored occurrences, which are at most twenty and the most recent ones.
 * @param {*} ocorrencias
 * @returns {string} Empty when no occurrence says anything about its browser.
 */
export function navegadoresDasOcorrenciasNotice(ocorrencias) {
    if (!Array.isArray(ocorrencias) || ocorrencias.length === 0) return '';
    const contagem = new Map();
    for (const oc of ocorrencias) {
        const { ambiente } = ambienteDaOcorrencia(oc);
        if (!ambiente) continue;
        const rotulo = navegadorComVersaoLabel(ambiente.navegador, ambiente.navegadorVersao);
        contagem.set(rotulo, (contagem.get(rotulo) ?? 0) + 1);
    }
    if (contagem.size === 0) return '';
    const partes = [...contagem.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([rotulo, n]) => `${rotulo} (${n})`);
    const quantas = ocorrencias.length === 1 ? 'Na ocorrência guardada' : `Nas ${ocorrencias.length} ocorrências guardadas`;
    return `${quantas}: ${partes.join(', ')}.`;
}

/**
 * The "Navegadores" cell of a defect row.
 *
 * THE SET COVERS ONLY THE REPORTS THAT DECLARED A BROWSER (`navegadores`, accumulated by the
 * server). Clients older than the field never declared one, and nothing in the defect row tells
 * how many of its reports came from them, so a defect that already existed can show "Firefox"
 * after one new Firefox report on top of a thousand old Chrome ones. The cell cannot know; the
 * `title` says it, in every case, instead of promising "since the first report". A defect with no
 * declared browser at all falls back to its latest User-Agent, and says that too.
 * @param {*} item
 * @returns {{texto: string, detalhe: string}}
 */
export function navegadoresDoDefeitoLabel(item) {
    const lista = Array.isArray(item?.navegadores) ? item.navegadores.filter((n) => typeof n === 'string') : [];
    if (lista.length > 0) {
        return {
            texto: lista.map(navegadorNome).join(', '),
            detalhe: 'Navegadores dos relatos que informaram o navegador. Versões anteriores do '
                + 'EBGeo não informavam, então um defeito que já existia pode ter ocorrido também em '
                + 'outros navegadores.',
        };
    }
    if (item?.origem === 'servidor') return { texto: '—', detalhe: 'Defeito do servidor: não há navegador.' };
    const ua = typeof item?.userAgent === 'string' ? item.userAgent.trim() : '';
    if (ua) {
        return {
            texto: navegadorNome(analisarUserAgent(ua).navegador),
            detalhe: 'Lido do último relato. Relatos de versões anteriores do EBGeo não informavam o navegador.',
        };
    }
    return { texto: '—', detalhe: 'Nenhum relato informou o navegador.' };
}

// ===== the Uso section =====

/** @returns {string} */
export function ambienteUsoTitulo() {
    return 'Navegadores e sistemas';
}

/** @param {string} quando - The window in words, from `janelaEmPalavras`. @returns {string} */
export function ambienteUsoSubtitulo(quando) {
    return `Com que navegador e sistema as sessões chegaram ${quando}, e quantas delas tiveram erro`;
}

/**
 * Whether the server sent the block. Same rule as the neighbors: an absent block is not zero.
 * @param {*} bloco
 * @returns {boolean}
 */
export function ambienteUsoInformado(bloco) {
    return objeto(bloco) && Array.isArray(bloco.familias) && Array.isArray(bloco.sistemas);
}

/** @returns {string} */
export function ambienteUsoNaoInformadoNotice() {
    return 'O servidor não informou os navegadores das sessões. Ele pode ser de uma versão anterior; '
        + 'isso não quer dizer que ninguém usou o EBGeo no período.';
}

/** @param {string} quando @returns {string} */
export function ambienteUsoVazioNotice(quando) {
    return `Nenhuma sessão guardada ${quando}.`;
}

/** @returns {string} */
export function ambienteUsoVazioHint() {
    return 'Ou ninguém abriu o EBGeo no período, ou as sessões já foram removidas pela retenção.';
}

/** The numeric columns of the two tables, in drawing order. */
export const COLUNAS_DE_AMBIENTE = Object.freeze([
    Object.freeze({ rotulo: 'Sessões', detalhe: 'abas que relataram uso com este navegador' }),
    Object.freeze({ rotulo: 'Fatia', detalhe: 'parte do total de sessões guardadas do período' }),
    Object.freeze({ rotulo: 'Com erro', detalhe: 'sessões em que ao menos um erro foi capturado' }),
    Object.freeze({
        rotulo: 'Taxa de erro',
        detalhe: 'sessões com erro sobre as sessões deste navegador; com poucas sessões, o número oscila',
    }),
    Object.freeze({ rotulo: 'Pessoas', detalhe: 'contas distintas; a sessão anônima não conta como pessoa' }),
]);

/**
 * One table row's cells, in the order of {@link COLUNAS_DE_AMBIENTE}.
 * @param {*} grupo
 * @param {number} total
 * @returns {string[]}
 */
function celulas(grupo, total) {
    const sessoes = inteiro(grupo?.sessoes) ?? 0;
    const comErro = inteiro(grupo?.sessoesComErro) ?? 0;
    return [
        numeroLabel(sessoes),
        percentualLabel(sessoes, total) ?? '—',
        numeroLabel(comErro),
        percentualLabel(comErro, sessoes) ?? '—',
        numeroLabel(inteiro(grupo?.usuariosDistintos)),
    ];
}

/**
 * The browser table: each family, followed by its versions, most used first.
 *
 * THE FAMILY ROW IS THE SERVER'S, never the sum of its version rows: the version rows are cut at
 * twenty and the family rows are not, so summing would shrink a family whose rare versions fell
 * off the list.
 * @param {*} bloco
 * @returns {Array<{nivel: string, rotulo: string, celulas: string[]}>}
 */
export function linhasDeNavegadores(bloco) {
    if (!ambienteUsoInformado(bloco)) return [];
    const total = inteiro(bloco.sessoes) ?? 0;
    const versoes = Array.isArray(bloco.versoes) ? bloco.versoes : [];
    const linhas = [];
    for (const familia of bloco.familias) {
        linhas.push({ nivel: 'familia', rotulo: navegadorNome(familia?.navegador), celulas: celulas(familia, total) });
        for (const v of versoes) {
            if ((v?.navegador ?? null) !== (familia?.navegador ?? null)) continue;
            const rotulo = inteiro(v.versao) === null ? 'versão não declarada' : `versão ${v.versao}`;
            linhas.push({ nivel: 'versao', rotulo, celulas: celulas(v, total) });
        }
    }
    return linhas;
}

/**
 * The system table, most used first.
 * @param {*} bloco
 * @returns {Array<{nivel: string, rotulo: string, celulas: string[]}>}
 */
export function linhasDeSistemas(bloco) {
    if (!ambienteUsoInformado(bloco)) return [];
    const total = inteiro(bloco.sessoes) ?? 0;
    return bloco.sistemas.map((s) => ({ nivel: 'familia', rotulo: soNome(s?.so), celulas: celulas(s, total) }));
}

/** @param {*} bloco @returns {string} Empty when nothing was cut. */
export function ambienteUsoCorteNotice(bloco) {
    const cortadas = inteiro(bloco?.versoesCortadas) ?? 0;
    if (cortadas === 0) return '';
    const quantas = cortadas === 1 ? 'Uma versão de navegador com poucas sessões ficou' : `${cortadas} versões de navegador com poucas sessões ficaram`;
    return `${quantas} fora da lista; os totais de cada navegador continuam completos.`;
}

/**
 * The retention floor: this section reads the sessions kept one by one, like "Pessoas distintas".
 * @param {Object} entrada
 * @param {*} entrada.desde - Epoch ms of the window start, as the server echoed it.
 * @param {*} entrada.horizonte - The `horizonte` block of the response (`usoDesde` and `usoSessoesDesde`).
 * @param {string} [entrada.timeZone] - For the test; the screen never passes it.
 * @returns {string} Empty when the retained sessions cover the window.
 */
export function ambienteUsoPisoNotice({ desde, horizonte, timeZone } = {}) {
    const estado = estadoDaFonte({ desde, horizonte, chave: 'usoSessoesDesde' });
    if (estado !== HORIZONTE.ENCURTADO) return '';
    // A YOUNG INSTALLATION IS NOT A FLOOR OF THIS SECTION: when the kept sessions start where the
    // usage measurement itself starts, the header of the usage half already says how old the
    // measurement is. The note is for the case in which the daily totals reach further back than
    // the kept sessions, which means the retention removed sessions this section would count.
    const geral = instanteDe(horizonte?.usoDesde);
    const sessoes = instanteDe(horizonte?.usoSessoesDesde);
    if (geral && sessoes && sessoes.getTime() <= geral.getTime()) return '';
    const data = dataLocal(horizonte?.usoSessoesDesde, { timeZone });
    const desdeQuando = data ? ` desde ${data}` : '';
    return `Esta seção conta as sessões guardadas uma a uma, que só vão${desdeQuando}: as mais antigas já `
        + 'foram removidas pela retenção. Ela cobre um trecho mais curto que o das seções acima.';
}

/** @returns {string} */
export function ambienteUsoHint() {
    return 'Cada sessão entra pela família e pela versão principal do navegador e pela família do '
        + 'sistema, e nada mais da máquina entra nesta tabela. Sessões de antes desta medição aparecem '
        + 'como "não declarado". Os detalhes da máquina (tela, placa de vídeo, memória) ficam em cada '
        + 'ocorrência de defeito, na aba Diagnóstico.';
}
