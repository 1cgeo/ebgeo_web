// Path: tests/unit/avisos-de-tela-estilo.test.js
//
// O CENSO DO TEXTO DE AVISO: as formas proibidas mais mecânicas, em todo literal que chega à tela.
//
// POR QUE ELE EXISTE. Em 2026-09-22 o dono mostrou um print do painel de camada que não carrega
// e reprovou o texto: "O servidor respondeu 502. O motivo não é conhecido daqui: pode ser a rede,
// o servidor que publica a camada, ou uma restrição de acesso. A tela não sabe qual dos três, e
// não vai adivinhar." Era honesto e inútil: um código HTTP como frase principal, uma lista de
// causas que a pessoa não distingue, e duas frases sobre a própria tela. O pedido foi reescrever
// todos os avisos desse tipo, e a regra que saiu dali (corpo curto, o que a pessoa pode fazer,
// sem código como frase, sem metacomentário, sem jargão interno) mora em `CLAUDE.md`, seção
// "Convenções que divergem do default". Prosa não segura regra nesta casa; este arquivo é a parte
// dela que é mecânica o bastante para ser cobrada.
//
// ================= O QUE ELE PROÍBE ===========================================
//
// CINCO FORMAS, todas de texto, e escolhidas por terem ZERO falso positivo na árvore medida
// (a casa prefere falso negativo a regra ruidosa, porque regra ruidosa é regra que alguém
// desliga):
//
//   1. "respondeu <3 dígitos>": o código HTTP como frase ("O servidor respondeu 502."). Numa
//      template, "respondeu ${...}" FECHANDO a frase também conta, porque é assim que o aviso do
//      print era escrito (`O servidor respondeu ${codes[0]}.`): o número só existia em tempo de
//      execução, e uma regra só de dígitos não acusaria o próprio caso que a motivou.
//   2. "HTTP <3 dígitos>" ou "HTTP ${...}": o código nomeado pelo protocolo. Numa template
//      string o `${...}` conta como número, porque "(HTTP ${status})" é exatamente a forma.
//   3. "não vai adivinhar".
//   4. "não é conhecido daqui" (ou "conhecida").
//   5. "tela não sabe" / "tela não soube": a frase sobre a própria tela.
//
// O código HTTP NÃO ESTÁ PROIBIDO DE APARECER, e a distinção é o ponto: "Código: 502" no fim
// do corpo é a linha discreta que a pessoa lê para quem vai ajudá-la, e passa. O proibido é a
// frase que ABRE o aviso narrando o protocolo.
//
// ================= ONDE ELE OLHA ==============================================
//
// O inventário vem de `git ls-files --cached --others --exclude-standard` sobre `src/js`, nunca
// de uma lista escrita à mão, pelo mesmo motivo de `permissao-de-atlas-censo.test.js`: conferir
// um subconjunto e tratar como o conjunto é a classe mais repetida do livro-razão, e o arquivo
// escrito há cinco minutos é exatamente o que ninguém listou. Arquivo apagado na árvore e ainda
// no índice é filtrado por existência.
//
// Cada arquivo é PARSEADO (acorn, como `despachante-sem-escrita-crua.test.js`), e não lido como
// texto: comentário não é literal, então um cabeçalho que cita a frase antiga para explicar por
// que ela saiu (como o de `terrain/data-layer-phrases.js`) não reprova. Dois conjuntos de
// literais são cobrados:
//
//   (a) TODO argumento de uma chamada cujo nome seja `showToast`, `showError`, `showWarning`,
//       `showSuccess`, `showInfo` ou `showInChannel`, por identificador ou por membro
//       (`ToastService.showWarning`, `this.showError`), em qualquer profundidade do argumento
//       (ternário, concatenação);
//   (b) TODO literal de um módulo de frase, isto é, arquivo cujo nome termina em `-phrases.js`,
//       `-notice.js` ou `-notices.js`: é ali que a casa escreve o texto que a tela mostra.
//
// A CONCATENAÇÃO É LIDA INTEIRA, e isso não é detalhe: o texto desta casa quebra linha com
// `'...' + '...'`, e "O motivo não é conhecido " + "daqui" escaparia de uma varredura por literal
// solto. Uma cadeia de `+` vira um texto só, com as partes não literais no lugar de `⟨⟩`.
//
// ================= O QUE ELE NÃO PEGA (e é muito) =============================
//
//   - TEXTO MONTADO EM TEMPO DE EXECUÇÃO: `'Erro ao importar: ' + error.message` passa, e o
//     `error.message` pode ser o "HTTP 502" que `apiError` (`store/sync/api-client.js`) cunha
//     quando a resposta não traz mensagem. A mensagem que o BACKEND devolve também não passa por
//     aqui.
//   - LITERAL FORA DOS DOIS CONJUNTOS: `textContent = '...'` num componente, `_showError` dos
//     modais, o corpo de `showConfirm`/`showChoice`, os parágrafos de um estado de falha montado
//     num módulo que não se chama `-phrases`. Nesses a regra é cobrada por leitura.
//   - JARGÃO ("fila", "bytes", "retrato", "namespace", "token"): as palavras têm uso legítimo
//     como valor de enum dentro dos próprios módulos de frase, e uma lista de palavras proibidas
//     acusaria o enum. Ficou para leitura, com a lista no `CLAUDE.md`.
//   - EM-DASH: a casa o usa como marcador de célula vazia ('—') em tabela, legitimamente.
//   - TAMANHO DO CORPO, tom, e se a ação sugerida é verdadeira. Nenhuma regex julga isso.
//
// ================= CONTROLE NEGATIVO ==========================================
//
// A mesma função de análise roda contra fontes sintéticas ANTES da varredura real: cada forma
// proibida tem de ser acusada (inclusive partida por concatenação, dentro de template e numa
// chamada por membro), e as formas certas vizinhas têm de passar ("Código: 502", "O servidor não
// respondeu.", a frase proibida dentro de um COMENTÁRIO, e o literal fora dos dois conjuntos,
// que documenta o alcance). Se a análise parar de enxergar o código, o controle cai antes, em vez
// de a varredura real passar verde sobre coisa nenhuma.

import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from 'acorn';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolvePath(dirname(fileURLToPath(import.meta.url)), '../../..');
const SRC = 'frontend/src/js';

/** Nomes de chamada cujo argumento é texto de toast. */
const FUNCOES_DE_TOAST = new Set([
    'showToast', 'showError', 'showWarning', 'showSuccess', 'showInfo', 'showInChannel',
]);

/** O arquivo cujo corpo inteiro é texto de tela. */
const MODULO_DE_FRASE = /-(?:phrases|notices?)\.js$/;

/** O que ocupa, no texto reconstruído, o lugar de uma parte que não é literal. */
const BURACO = '⟨⟩';

/** As formas proibidas, cada uma com o nome que a mensagem de falha imprime. */
const FORMAS_PROIBIDAS = Object.freeze([
    // O `⟨⟩` só conta quando FECHA a frase: é a forma exata do print (`respondeu ${codes[0]}.`),
    // e deixa passar "respondeu ${janela}, e com que faixa", que narra outra coisa.
    ['respondeu-codigo', new RegExp(`\\brespondeu\\s+(?:com\\s+)?(?:\\d{3}\\b|${BURACO}(?=\\s*[.)]|$))`, 'i')],
    ['http-codigo', new RegExp(`\\bHTTP\\s*(?:\\d{3}\\b|${BURACO})`)],
    ['nao-vai-adivinhar', /\bnão vai adivinhar\b/i],
    ['conhecido-daqui', /\bnão é conhecid[oa] daqui\b/i],
    ['tela-nao-sabe', /\btela não (?:sabe|soube)\b/i],
]);

/**
 * Violações conhecidas em arquivo que outro agente estava editando no mesmo dia, deixadas para
 * uma segunda passada. Chave: caminho relativo à raiz. Valor: as formas que ainda sobram ali.
 *
 * ELA NASCEU VAZIA, e a mecânica fica de pé mesmo assim: uma entrada que não acusa mais nada
 * reprova (caso "a lista de segunda passada não guarda entrada morta"), para que ela só possa
 * encolher e não vire cheque em branco para o arquivo.
 * @type {Map<string, {formas: string[], motivo: string}>}
 */
const SEGUNDA_PASSADA = new Map([
    // Exemplo da forma, sem entrada viva:
    // ['frontend/src/js/presence/x.js', { formas: ['tela-nao-sabe'], motivo: 'segunda passada 2026-09-22' }],
]);

// ---------------------------------------------------------------------------
// Análise
// ---------------------------------------------------------------------------

/** @returns {boolean} Se o nó é texto: literal de string, template, ou cadeia de `+` com um deles. */
function ehTexto(no) {
    if (!no) return false;
    if (no.type === 'Literal') return typeof no.value === 'string';
    if (no.type === 'TemplateLiteral') return true;
    return no.type === 'BinaryExpression' && no.operator === '+'
        && (ehTexto(no.left) || ehTexto(no.right));
}

/** O texto de um nó, com cada parte não literal trocada por {@link BURACO}. */
function textoDe(no) {
    if (!no) return BURACO;
    if (no.type === 'Literal' && typeof no.value === 'string') return no.value;
    if (no.type === 'TemplateLiteral') {
        return no.quasis.map((q) => q.value.cooked ?? q.value.raw).join(BURACO);
    }
    if (no.type === 'BinaryExpression' && no.operator === '+') return textoDe(no.left) + textoDe(no.right);
    return BURACO;
}

/** Chaves de nó que nunca carregam texto de tela. */
function chaveIgnorada(no, chave) {
    if (chave === 'loc' || chave === 'start' || chave === 'end') return true;
    if (chave === 'source' && /^(?:Import|ExportNamed|ExportAll)Declaration$|^ImportExpression$/.test(no.type)) {
        return true;
    }
    return no.type === 'Property' && chave === 'key' && !no.computed;
}

/**
 * Junta os textos MÁXIMOS de uma subárvore: uma cadeia de `+` sai inteira, e não parte por parte.
 * @param {Object} no
 * @param {Array<{texto: string, linha: number}>} saida
 * @param {boolean} [dentroDeCadeia]
 */
function coletarTextos(no, saida, dentroDeCadeia = false) {
    if (!no || typeof no.type !== 'string') return;
    const texto = ehTexto(no);
    if (texto && !dentroDeCadeia) saida.push({ texto: textoDe(no), linha: no.loc.start.line });
    const cadeia = texto && no.type === 'BinaryExpression';
    for (const [chave, valor] of Object.entries(no)) {
        if (chaveIgnorada(no, chave)) continue;
        if (Array.isArray(valor)) valor.forEach((filho) => coletarTextos(filho, saida, false));
        else if (valor && typeof valor.type === 'string') coletarTextos(valor, saida, cadeia);
    }
}

/** @returns {string|null} O nome chamado, por identificador ou por membro não computado. */
function nomeChamado(callee) {
    if (callee?.type === 'Identifier') return callee.name;
    if (callee?.type === 'MemberExpression' && !callee.computed && callee.property?.type === 'Identifier') {
        return callee.property.name;
    }
    return null;
}

/** Visita toda a árvore. */
function visitar(no, fn) {
    if (!no || typeof no.type !== 'string') return;
    fn(no);
    for (const [chave, valor] of Object.entries(no)) {
        if (chave === 'loc') continue;
        if (Array.isArray(valor)) valor.forEach((filho) => visitar(filho, fn));
        else if (valor && typeof valor.type === 'string') visitar(valor, fn);
    }
}

/**
 * A análise de uma fonte: quantas chamadas de toast ela tem e quais formas proibidas ela escreve.
 * @param {string} fonte
 * @param {{moduloDeFrase: boolean}} opcoes
 * @returns {{chamadasDeToast: number, textos: number, achados: Array<{forma: string, linha: number, texto: string}>}}
 */
function analisarFonte(fonte, { moduloDeFrase }) {
    const arvore = parse(fonte, {
        ecmaVersion: 'latest', sourceType: 'module', locations: true, allowHashBang: true,
    });
    const textos = [];
    let chamadasDeToast = 0;
    visitar(arvore, (no) => {
        if (no.type !== 'CallExpression' || !FUNCOES_DE_TOAST.has(nomeChamado(no.callee))) return;
        chamadasDeToast += 1;
        for (const argumento of no.arguments) coletarTextos(argumento, textos);
    });
    if (moduloDeFrase) coletarTextos(arvore, textos);

    const achados = [];
    const vistos = new Set();
    for (const { texto, linha } of textos) {
        for (const [forma, regra] of FORMAS_PROIBIDAS) {
            const chave = `${linha}\u0000${forma}`;
            if (!regra.test(texto) || vistos.has(chave)) continue;
            vistos.add(chave);
            achados.push({ forma, linha, texto });
        }
    }
    return { chamadasDeToast, textos: textos.length, achados };
}

// ---------------------------------------------------------------------------
// Controle negativo
// ---------------------------------------------------------------------------

describe('controle negativo: a análise acusa cada forma e absolve a vizinha certa', () => {
    const formasEm = (fonte, moduloDeFrase = false) =>
        analisarFonte(fonte, { moduloDeFrase }).achados.map((a) => a.forma);

    it('acusa o código HTTP como frase, nas três grafias', () => {
        expect(formasEm("showToast('O servidor respondeu 502.', 'error');")).toEqual(['respondeu-codigo']);
        expect(formasEm("showError('Falhou (HTTP ' + status + ').');")).toEqual(['http-codigo']);
        // eslint-disable-next-line no-template-curly-in-string
        expect(formasEm('showWarning(`Recusado: HTTP ${s}`);')).toEqual(['http-codigo']);
    });

    it('acusa a forma EXATA do print, com o código só em tempo de execução', () => {
        // É o texto de `layerLoadFailureStatusDetail` até 2026-09-22, byte a byte.
        // eslint-disable-next-line no-template-curly-in-string
        expect(formasEm('export const f = (c) => `O servidor respondeu ${c[0]}.`;', true))
            .toEqual(['respondeu-codigo']);
        // eslint-disable-next-line no-template-curly-in-string
        expect(formasEm("export const g = (c) => `O servidor respondeu ${c.join(', ')}.`;", true))
            .toEqual(['respondeu-codigo']);
        // O vizinho que narra OUTRA coisa depois do buraco passa.
        // eslint-disable-next-line no-template-curly-in-string
        expect(formasEm('export const h = (j) => `Quanto o servidor respondeu ${j}, e com que faixa`;', true))
            .toEqual([]);
    });

    it('acusa pela chamada por MEMBRO e em qualquer profundidade do argumento', () => {
        expect(formasEm("ToastService.showWarning('O servidor respondeu 404.');")).toEqual(['respondeu-codigo']);
        expect(formasEm("this.showError(ok ? 'Salvo.' : 'O servidor respondeu 500.');"))
            .toEqual(['respondeu-codigo']);
    });

    it('acusa o metacomentário mesmo partido por concatenação, num módulo de frase', () => {
        const fonte = "export const X = 'O motivo não é conhecido ' + 'daqui: pode ser a rede. '\n"
            + "    + 'A tela não sabe qual dos três, e não vai adivinhar.';";
        expect(formasEm(fonte, true).sort()).toEqual(['conhecido-daqui', 'nao-vai-adivinhar', 'tela-nao-sabe']);
        // Controle do controle: o mesmo literal sem a concatenação lida inteira não seria achado
        // pela metade "daqui", que mora no SEGUNDO pedaço.
        expect(formasEm("export const Y = 'daqui: pode ser a rede.';", true)).toEqual([]);
    });

    it('absolve as formas certas vizinhas', () => {
        expect(formasEm("showToast('Verifique sua conexão. Código: 502', 'info');")).toEqual([]);
        expect(formasEm("showToast('O servidor não respondeu.', 'error');")).toEqual([]);
        expect(formasEm("showToast('Use HTTPS para abrir o link.');")).toEqual([]);
        // Comentário não é literal: o cabeçalho que cita a frase antiga para explicar por que ela
        // saiu não reprova.
        expect(formasEm("// O servidor respondeu 502, e a tela não sabe.\nexport const A = 'ok';", true)).toEqual([]);
    });

    it('O ALCANCE É O DECLARADO: literal fora de toast e fora de módulo de frase passa', () => {
        // Não é o comportamento desejado, é o limite medido: está no cabeçalho, em "O que ele não
        // pega". Se um dia este caso ficar vermelho, o alcance cresceu e o cabeçalho tem de dizer.
        expect(formasEm("const msg = 'O servidor respondeu 502.'; console.log(msg);")).toEqual([]);
        expect(formasEm("const msg = 'O servidor respondeu 502.';", true)).toEqual(['respondeu-codigo']);
    });
});

// ---------------------------------------------------------------------------
// Varredura real
// ---------------------------------------------------------------------------

/** @type {{arquivos: string[], modulosDeFrase: string[], chamadasDeToast: number, achados: string[], porArquivo: Map<string, Set<string>>, falhasDeParse: string[]}} */
let censo;

beforeAll(() => {
    let saida;
    try {
        saida = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', SRC], {
            cwd: RAIZ, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
        });
    } catch (erro) {
        throw new Error(`o inventário precisa de git e ele falhou (${erro.message}): isto é ambiente, `
            + 'não regressão');
    }
    const arquivos = saida.split(/\r?\n/)
        .filter((f) => f.endsWith('.js') && existsSync(join(RAIZ, f)));

    censo = {
        arquivos, modulosDeFrase: [], chamadasDeToast: 0, achados: [], porArquivo: new Map(), falhasDeParse: [],
    };
    for (const arquivo of arquivos) {
        const moduloDeFrase = MODULO_DE_FRASE.test(arquivo);
        if (moduloDeFrase) censo.modulosDeFrase.push(arquivo);
        let analise;
        try {
            analise = analisarFonte(readFileSync(join(RAIZ, arquivo), 'utf8'), { moduloDeFrase });
        } catch (erro) {
            censo.falhasDeParse.push(`${arquivo}: ${erro.message}`);
            continue;
        }
        censo.chamadasDeToast += analise.chamadasDeToast;
        for (const achado of analise.achados) {
            if (!censo.porArquivo.has(arquivo)) censo.porArquivo.set(arquivo, new Set());
            censo.porArquivo.get(arquivo).add(achado.forma);
            if (SEGUNDA_PASSADA.get(arquivo)?.formas.includes(achado.forma)) continue;
            censo.achados.push(`${arquivo}:${achado.linha} [${achado.forma}] ${achado.texto.slice(0, 160)}`);
        }
    }
}, 60000);

describe('varredura: nenhum aviso de tela escreve as formas proibidas', () => {
    it('PISO: o inventário enxerga o código, os toasts e os módulos de frase', () => {
        // Sem este caso, um inventário vazio (git fora do PATH, SRC renomeado) faria o caso
        // seguinte passar verde sobre coisa nenhuma.
        expect(censo.arquivos.length).toBeGreaterThan(500);
        expect(censo.chamadasDeToast).toBeGreaterThan(300);
        expect(censo.modulosDeFrase.length).toBeGreaterThanOrEqual(20);
        // As duas âncoras nomeadas: o módulo do print do dono e o das recusas por capacidade.
        expect(censo.modulosDeFrase).toContain('frontend/src/js/terrain/data-layer-phrases.js');
        expect(censo.modulosDeFrase).toContain('frontend/src/js/store/denial-phrases.js');
    });

    it('todo arquivo do inventário é parseado: um arquivo que não parseia é um arquivo não varrido', () => {
        expect(censo.falhasDeParse).toEqual([]);
    });

    it('nenhuma forma proibida em argumento de toast nem em módulo de frase', () => {
        expect(censo.achados, 'reescreva o aviso: diga o que aconteceu e o que a pessoa pode fazer '
            + '(o código HTTP, se útil, vai no fim como "Código: 502")').toEqual([]);
    });

    it('a lista de segunda passada não guarda entrada morta', () => {
        let conferidas = 0;
        for (const [arquivo, { formas, motivo }] of SEGUNDA_PASSADA) {
            expect(motivo, arquivo).toMatch(/segunda passada/);
            for (const forma of formas) {
                expect(censo.porArquivo.get(arquivo)?.has(forma), `${arquivo} já não escreve ${forma}: `
                    + 'tire a entrada').toBe(true);
            }
            conferidas += 1;
        }
        expect(conferidas).toBe(SEGUNDA_PASSADA.size);
    });
});
