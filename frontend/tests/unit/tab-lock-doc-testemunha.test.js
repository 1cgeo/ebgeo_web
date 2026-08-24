// Path: tests/unit/tab-lock-doc-testemunha.test.js

/**
 * @fileoverview O `tab-lock.js` NÃO DECLARA ABERTO UM SÍTIO DESTRUTIVO QUE JÁ PASSA TESTEMUNHA.
 *
 * O DEFEITO, medido em 2026-08-24: o JSDoc de `acquireTabLock` e a seção 11 ("furos abertos")
 * diziam que o open de link público de `index.js` era o caminho que ainda pedia o lock SEM
 * testemunha. Era falso: `openPublicAtlasFromUrl` passa `witness: remoteMountWitness(atlas.id)`
 * desde que o quarto sítio destrutivo foi ligado, e o comentário no ponto da chamada diz isso por
 * extenso. O sítio que de fato pede sem testemunha é OUTRO,
 * `AccountControl.saveLocalToServer`.
 *
 * POR QUE ISSO É PIOR QUE UMA OMISSÃO, e é a razão de existir um teste para prosa: `tab-lock.js` é
 * carregado como leitura obrigatória por quem mexe em multiaba. Quem lê "este caminho ainda pede
 * sem testemunha" ou vai fechar um buraco que não existe, ou, na direção que destrói dado, vai
 * APAGAR a testemunha para alinhar o código à documentação. Uma doutrina que aponta o guarda
 * errado custa mais que uma que se cala.
 *
 * ============================ O QUE ESTE ARQUIVO PRENDE ==============================
 *
 * Três asserções, e a terceira é a única que é sobre prosa:
 *
 *   1. O FATO. `openPublicAtlasFromUrl` (`src/js/index.js`) passa `witness:` na sua chamada a
 *      `acquireTabLock`. Sem isto, corrigir a doc seria trocar uma mentira por outra.
 *   2. O CENSO. Todo sítio de chamada de `acquireTabLock` em `src/js`, derivado de `git ls-files`
 *      e não de uma lista escrita à mão, classificado em passa/não passa testemunha, comparado com
 *      um censo declarado aqui. Sítio novo reprova até ser classificado, e ligar a testemunha em
 *      `saveLocalToServer` também reprova, o que obriga a passar por este arquivo e pela doc.
 *   3. A PROSA CONTRA O FATO. Toda frase de comentário de `tab-lock.js` que AFIRME a ausência de
 *      testemunha é lida, e os módulos que ela nomeia têm de pertencer ao conjunto dos que
 *      realmente não passam testemunha. É isto que fica vermelho se alguém reescrever a frase
 *      antiga.
 *
 * ============================ O QUE ELE NÃO PRENDE ==================================
 *
 * A asserção 3 é LÉXICA, e vale dizer o tamanho dela em voz alta. Ela reconhece a afirmação por um
 * vocabulário declarado (`IDIOMAS_DE_AUSENCIA`) e o alvo por outro (`MODULOS`); uma frase que diga
 * a mesma falsidade com outras palavras ("o link público confia só no settle") passa verde, e uma
 * reescrita do arquivo em português passa verde. Ela não entende a frase, apenas casa duas listas
 * que estão escritas aqui, com o porquê. O que NÃO é frágil é a asserção 2, que não lê prosa
 * nenhuma: é ela que garante que o dia em que o código mudar alguém tenha de voltar aqui.
 *
 * E nenhuma delas prova que a testemunha FUNCIONE. `otherClientHoldsLock` tem prova própria em
 * `tests/unit/tab-lock-refutacao.test.js`; aqui só se mede quem a passa e o que a doc diz sobre
 * isso.
 *
 * ============================ O SEGUNDO CENSO (2026-08-24) ==========================
 *
 * O arquivo ganhou um segundo bloco, e o motivo é o mesmo defeito uma camada acima. A seção 5 de
 * `tab-lock.js` afirmava duas coisas falsas: que TODO `clearAllDataStore()` é precedido de um
 * `acquire()` esperado (não é: há wipes em `map.manager.js`, `maps.tab.js`,
 * `export-import.service.js` e em dois pontos de `account.control.js` sem reivindicação nenhuma), e
 * que "there are four such wipes" (são dez sítios, e a enumeração omitia o open de link público e
 * `switchToNewLocalAtlas`).
 *
 * O CONSERTO NÃO É UM NÚMERO NOVO. Um contador em prosa envelhece e nada o pega, e este repositório
 * já pagou essa lição três vezes; o que a seção 5 diz hoje é a PROPRIEDADE (um wipe sem gesto
 * humano, sobre um namespace que outra aba pode ter montado, é precedido de `acquire()` com
 * testemunha) e um ponteiro para cá. A ROLAGEM mora aqui, derivada de `git ls-files`, cada sítio
 * classificado com o motivo escrito, e um sítio novo reprova até ser classificado.
 *
 * O ALCANCE DESSE SEGUNDO CENSO, dito em voz alta: a CLASSIFICAÇÃO ("legitimamente sem") é
 * julgamento humano escrito na tabela, e nenhum teste pode conferi-la. O que é mecânico são duas
 * coisas: o conjunto de sítios (arquivo + função que o contém) e se cada um tem, ou não tem, uma
 * chamada de pre-flight entre o início da função e o wipe. Ou seja, ele não impede uma
 * classificação errada; ele impede que ela seja feita SEM QUE NINGUÉM ESCREVA UMA.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** O arquivo cru. @param {string} rel @returns {string} */
function ler(rel) {
    return readFileSync(resolve(FRONT, rel), 'utf8');
}

/** O código de um arquivo, sem comentário de bloco nem de linha. @param {string} rel */
function codigo(rel) {
    return ler(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * Todo arquivo `.js` de `src/js`, do versionamento. `--others` não é detalhe: sem ele a varredura
 * fica cega no arquivo escrito há cinco minutos e ainda não commitado.
 * @returns {string[]}
 */
function arquivosDeSrc() {
    const saida = execFileSync(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard', '*.js'],
        { cwd: resolve(FRONT, 'src/js'), encoding: 'utf8' }
    );
    return saida.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
        .map((rel) => `src/js/${rel.replace(/\\/g, '/')}`)
        .sort();
}

/**
 * Os argumentos de cada CHAMADA a `acquireTabLock` num texto, com os parênteses balanceados.
 * A definição e o reexport ficam de fora porque só se conta quem CHAMA.
 * @param {string} texto
 * @returns {string[]} O texto entre parênteses de cada chamada.
 */
function chamadasDeAcquire(texto) {
    const encontrados = [];
    const alvo = 'acquireTabLock(';
    for (let i = texto.indexOf(alvo); i !== -1; i = texto.indexOf(alvo, i + 1)) {
        const antes = texto.slice(Math.max(0, i - 20), i);
        // `export function acquireTabLock(` é a definição, não uma chamada.
        if (/function\s+$/.test(antes)) continue;
        let profundidade = 0;
        let fim = i + alvo.length - 1;
        for (; fim < texto.length; fim += 1) {
            if (texto[fim] === '(') {
                profundidade += 1;
            } else if (texto[fim] === ')') {
                profundidade -= 1;
                if (profundidade === 0) break;
            }
        }
        encontrados.push(texto.slice(i + alvo.length, fim));
    }
    return encontrados;
}

/**
 * O CENSO DECLARADO: por arquivo, quantas chamadas a `acquireTabLock` ele faz e se TODAS passam
 * testemunha. Mudar qualquer uma das duas coisas exige editar esta tabela, que é o ponto.
 */
const CENSO = Object.freeze({
    // `openPublicAtlasFromUrl`: o quarto sítio destrutivo, ligado em 2026-08-16.
    'src/js/index.js': { chamadas: 1, comTestemunha: 1 },
    // `claimRemoteAtlas` e `clearMountedAtlasIfGranted`: os dois que a frente original ligou.
    'src/js/account/open-atlas.service.js': { chamadas: 2, comTestemunha: 2 },
    // `AccountControl.saveLocalToServer`: ERA O FURO VIVO, fechado em 2026-08-24. Ficou aberto por
    // ser o mais estreito dos cinco (o atlas nasce uma linha antes do pre-flight, então nenhuma
    // outra aba pode tê-lo montado, e `remoteMountWitness` deriva `selfHolds: 0` do escopo ATIVO,
    // que ali ainda é o local). Repro da causa raiz e do conserto:
    // `tests/integration/wipe-de-salvar-no-servidor-sem-testemunha.repro.test.js`.
    'src/js/account/account.control.js': { chamadas: 1, comTestemunha: 1 },
});

/** Os módulos que a prosa pode nomear, e o arquivo de cada um. */
const MODULOS = Object.freeze({
    'openPublicAtlasFromUrl': 'src/js/index.js',
    'index.js': 'src/js/index.js',
    'open-atlas.service.js': 'src/js/account/open-atlas.service.js',
    'claimRemoteAtlas': 'src/js/account/open-atlas.service.js',
    'clearMountedAtlasIfGranted': 'src/js/account/open-atlas.service.js',
    'account.control.js': 'src/js/account/account.control.js',
    'saveLocalToServer': 'src/js/account/account.control.js',
});

/**
 * As formas em que este arquivo AFIRMA que alguém pede sem testemunha. Lista declarada, e o
 * alcance da asserção 3 é exatamente ela.
 */
const IDIOMAS_DE_AUSENCIA = [
    /\bwithout (a |the |any )?witness\b/i,
    /\bwithout it\b/i,
    /\bomits the `?witness`?\b/i,
    /\bsem testemunha\b/i,
];

describe('tab-lock: a doc não acusa de aberto um sítio que já passa testemunha', () => {
    it('FATO: o open de link público passa a testemunha', () => {
        const fonte = codigo('src/js/index.js');
        const inicio = fonte.indexOf('async function openPublicAtlasFromUrl');
        expect(inicio, 'a função existe').toBeGreaterThan(-1);
        const corpo = fonte.slice(inicio, fonte.indexOf('\nasync function ', inicio + 1) + 1
            || fonte.length);

        const chamadas = chamadasDeAcquire(corpo);
        expect(chamadas, 'ela reivindica o lock').toHaveLength(1);
        expect(chamadas[0]).toMatch(/witness\s*:/);
        // Controle da própria varredura: uma chamada sem testemunha teria de falhar aqui, e é o
        // que o `toMatch` acima faz. A asserção de forma abaixo impede que um `witness` qualquer
        // (um `null` literal, por exemplo) conte como testemunha.
        expect(chamadas[0]).toMatch(/witness\s*:\s*remoteMountWitness\(/);
    });

    it('CENSO: os sítios de chamada e quem passa testemunha são os declarados', () => {
        const medido = {};
        for (const rel of arquivosDeSrc()) {
            if (rel === 'src/js/utilities/tab-lock.js') continue;
            const chamadas = chamadasDeAcquire(codigo(rel));
            if (chamadas.length === 0) continue;
            medido[rel] = {
                chamadas: chamadas.length,
                comTestemunha: chamadas.filter((args) => /witness\s*:/.test(args)).length,
            };
        }
        expect(medido).toEqual(CENSO);
        expect(Object.keys(CENSO).length).toBeGreaterThan(1);

        // DISCRIMINAÇÃO, E ELA MUDOU DE FORMA QUANDO O ÚLTIMO FURO FECHOU. Enquanto havia um sítio
        // sem testemunha, ele próprio provava que a medição sabia distinguir os dois casos: o censo
        // não podia ser só de aprovados. Hoje todos passam, e um censo cujo total de "aprovados"
        // é igual ao total de chamadas ficaria verde também se a medição estivesse cega e
        // aprovasse qualquer coisa. Então a discriminação passa a vir de fixture, que é o único
        // controle que sobra: a mesma varredura, sobre um texto sintético.
        const semTestemunha = Object.values(CENSO)
            .reduce((n, e) => n + (e.chamadas - e.comTestemunha), 0);
        expect(semTestemunha, 'nenhum sítio destrutivo pede sem testemunha').toBe(0);

        const fixture = [
            'acquireTabLock(remoteAtlasKey(id));',
            'acquireTabLock(remoteAtlasKey(id), { witness: remoteMountWitness(id) });',
            'export function acquireTabLock(key, options = {}) {}',
        ].join('\n');
        const daFixture = chamadasDeAcquire(fixture);
        expect(daFixture, 'a definição não conta como chamada').toHaveLength(2);
        expect(daFixture.filter((args) => /witness\s*:/.test(args)),
            'a varredura separa quem passa testemunha de quem não passa').toHaveLength(1);
    });

    it('PROSA: nenhuma frase de ausência nomeia um sítio que passa testemunha', () => {
        const comTestemunha = new Set(
            Object.entries(CENSO).filter(([, e]) => e.comTestemunha > 0).map(([rel]) => rel)
        );
        const semTestemunha = new Set(
            Object.entries(CENSO)
                .filter(([, e]) => e.comTestemunha < e.chamadas).map(([rel]) => rel)
        );

        // Só os comentários: o código do arquivo não afirma nada sobre outros módulos.
        const bruto = ler('src/js/utilities/tab-lock.js');
        const comentarios = [
            ...(bruto.match(/\/\*[\s\S]*?\*\//g) ?? []),
            ...(bruto.match(/^[ \t]*\/\/.*$/gm) ?? []),
        ].join('\n')
            .replace(/^[ \t]*(\*|\/\/)[ \t]?/gm, '')
            .replace(/\s+/g, ' ');

        const frases = comentarios.split(/(?<=[.;:])\s+/);
        const acusacoes = frases.filter((f) => IDIOMAS_DE_AUSENCIA.some((re) => re.test(f)));

        // COBERTURA VAZIA SERIA VERDE. Se nenhuma frase casar, a asserção seguinte não prova
        // nada, então o vocabulário tem de estar achando alguma coisa. Enquanto havia furo vivo,
        // quem sustentava este número era a frase que o declarava; hoje é a frase GENÉRICA da
        // seção 11 ("a caller that omits the `witness` gets the old answer"), que continua
        // verdadeira e não nomeia módulo nenhum. Se ela sair, este teste avisa antes de virar
        // um verde que não mede nada.
        expect(acusacoes.length, 'o vocabulário de ausência acha frase no arquivo')
            .toBeGreaterThan(0);

        for (const frase of acusacoes) {
            for (const [termo, rel] of Object.entries(MODULOS)) {
                if (!frase.includes(termo)) continue;
                expect(
                    comTestemunha.has(rel) && !semTestemunha.has(rel),
                    `frase acusa de pedir sem testemunha um sítio que passa uma (${rel}): "${frase}"`
                ).toBe(false);
            }
        }

        // E o sítio que REALMENTE não passa tem de estar nomeado em alguma dessas frases: uma doc
        // que só apagasse a mentira, sem dizer a verdade, deixaria o furo vivo sem endereço. O
        // laço é VAZIO hoje, porque `semTestemunha` está vazio, e isso é estado legítimo e não
        // asserção morta: ele volta a cobrar no dia em que o censo declarar um sítio novo sem
        // testemunha, que é o dia em que ele importa.
        const nomeados = new Set(
            acusacoes.flatMap((f) => Object.entries(MODULOS)
                .filter(([termo]) => f.includes(termo)).map(([, rel]) => rel))
        );
        for (const rel of semTestemunha) {
            expect(nomeados, `o furo vivo em ${rel} está nomeado na doc`).toContain(rel);
        }
    });
});

// =================================================================================================
// SEGUNDO CENSO: TODO SÍTIO DE `clearAllDataStore()`
// =================================================================================================

/**
 * O código de um arquivo com os comentários BRANQUEADOS em vez de removidos: cada caractere de
 * comentário vira espaço e cada quebra de linha fica onde estava. Sem isso a numeração de linha e a
 * indentação (que é como a função que contém o sítio é encontrada) mudariam junto com a prosa.
 * @param {string} rel
 * @returns {string[]} As linhas do arquivo, sem comentário.
 */
function linhasSemComentario(rel) {
    return ler(rel)
        .replace(/\/\*[\s\S]*?\*\//g, (bloco) => bloco.replace(/[^\n]/g, ' '))
        .replace(/^([ \t]*)\/\/.*$/gm, (linha, indent) => indent
            + ' '.repeat(Math.max(0, linha.length - indent.length)))
        .split('\n');
}

/**
 * As três formas em que uma função nomeada começa neste código: declaração, método de classe e
 * atribuição de arrow. A captura é sempre o NOME.
 */
const INICIO_DE_FUNCAO = new RegExp(
    '^([ \\t]*)(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s+([A-Za-z_$][\\w$]*)'
    + '|^([ \\t]*)(?:static\\s+)?(?:async\\s+)?(?:get\\s+|set\\s+)?([A-Za-z_$][\\w$]*)'
    + '\\s*\\([^;]*\\)\\s*\\{'
    + '|^([ \\t]*)(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:async\\s*)?\\('
);

/**
 * Palavras que a segunda alternativa acima casa sem serem função. `if (...) {` tem exatamente a
 * forma de um método, então sem esta lista todo wipe dentro de um `if` seria atribuído a uma função
 * chamada "if", que foi o que a primeira versão desta varredura mediu.
 */
const NAO_SAO_FUNCOES = new Set([
    'if', 'for', 'while', 'switch', 'catch', 'try', 'else', 'do', 'return', 'with'
]);

/**
 * As chamadas que valem como PRE-FLIGHT. Lista declarada, porque nem todo caminho chama
 * `acquireTabLock` na cara: `openRemoteAtlas` passa por `claimRemoteAtlas`, que é quem reivindica e
 * quem monta a testemunha. Um caminho novo com um envelope novo entra aqui, e o exercício de
 * escrevê-lo é o ponto.
 */
const PRE_FLIGHT = ['acquireTabLock(', 'claimRemoteAtlas('];

/**
 * Todo sítio de chamada de `clearAllDataStore()` em `src/js`, com a função que o contém e se há
 * pre-flight entre o início dessa função e o wipe. A DEFINIÇÃO (em `store/store.js`) não é sítio.
 * @returns {Array<{sitio: string, preFlight: boolean}>}
 */
function sitiosDeWipe() {
    const achados = [];
    for (const rel of arquivosDeSrc()) {
        const linhas = linhasSemComentario(rel);
        for (let i = 0; i < linhas.length; i += 1) {
            if (!/clearAllDataStore\s*\(/.test(linhas[i])) continue;
            if (/function\s+clearAllDataStore/.test(linhas[i])) continue;

            const indent = (linhas[i].match(/^[ \t]*/) || [''])[0].length;
            let nome = null;
            let inicio = 0;
            for (let j = i - 1; j >= 0; j -= 1) {
                if (!linhas[j].trim()) continue;
                if ((linhas[j].match(/^[ \t]*/) || [''])[0].length >= indent) continue;
                const casou = INICIO_DE_FUNCAO.exec(linhas[j]);
                if (!casou) continue;
                const candidato = casou[2] || casou[4] || casou[6];
                if (!candidato || NAO_SAO_FUNCOES.has(candidato)) continue;
                nome = candidato;
                inicio = j;
                break;
            }
            const cabecalho = linhas.slice(inicio, i).join('\n');
            achados.push({
                sitio: `${rel} :: ${nome ?? '(topo do modulo)'}`,
                preFlight: PRE_FLIGHT.some((chamada) => cabecalho.includes(chamada))
            });
        }
    }
    return achados.sort((a, b) => (a.sitio < b.sitio ? -1 : 1));
}

/**
 * COMO CADA WIPE É ARBITRADO. Cinco valores, e nenhum deles é "esquecido": a seção 5 do
 * `tab-lock.js` descreve a propriedade, e esta tabela é a rolagem que ela recusa a escrever em
 * prosa.
 */
const ARBITRAGEM = Object.freeze({
    /** Precedido de `acquire()` esperado, com testemunha. É a cláusula da seção 5. */
    PRE_FLIGHT: 'pre-flight',
    /** O alvo nasceu segundos antes: nenhum par pode tê-lo montado. */
    SEM_ALVO_VIVO: 'sem-alvo-vivo',
    /** Arbitrado pelo aviso de desmontagem da seção 8, não por reivindicação. */
    AVISO_DE_TEARDOWN: 'aviso-de-teardown',
    /** Gesto humano numa aba DESBLOQUEADA: quem perdeu a ordem está atrás da sobreposição. */
    GESTO_SOB_SOBREPOSICAO: 'gesto-sob-sobreposicao',
    /** O atlas já foi excluído no servidor, e toda aba conectada roda esta mesma limpeza. */
    JA_CONDENADO: 'ja-condenado'
});

/**
 * O CENSO DECLARADO dos wipes. Chave: arquivo mais a função que contém a chamada. Um sítio novo
 * reprova até entrar aqui, e um sítio que perde (ou ganha) o pre-flight reprova nomeando o arquivo.
 */
const CENSO_DE_WIPE = Object.freeze({
    // ---- os quatro com pre-flight (a cláusula da seção 5) ----
    // Entra num atlas de servidor recém-criado. Era o quinto sítio destrutivo sem testemunha, e a
    // fechadura tem repro próprio em
    // `tests/integration/wipe-de-salvar-no-servidor-sem-testemunha.repro.test.js`.
    'src/js/account/account.control.js :: saveLocalToServer': ARBITRAGEM.PRE_FLIGHT,
    // O par de BOOT (`enterLocalMapOnBoot`, `openAtlasChooserOnBoot`) chega aqui. `selfHolds` é 1:
    // o endereço perguntado é o que ESTA aba montou.
    'src/js/account/open-atlas.service.js :: clearMountedAtlasIfGranted': ARBITRAGEM.PRE_FLIGHT,
    // Reivindica por `claimRemoteAtlas`, que é quem monta a testemunha.
    'src/js/account/open-atlas.service.js :: openRemoteAtlas': ARBITRAGEM.PRE_FLIGHT,
    // Link público: o quarto sítio destrutivo, ligado em 2026-08-16.
    'src/js/index.js :: openPublicAtlasFromUrl': ARBITRAGEM.PRE_FLIGHT,

    // ---- os seis sem pre-flight, e o que cada um usa no lugar ----
    // O atlas foi EXCLUÍDO no servidor (por este usuário ou por outro dono), e o `atlas_deleted`
    // alcança toda aba conectada, que roda esta mesma desmontagem. Reivindicar seria arbitrar entre
    // duas abas fazendo a mesma limpeza de um dado que o servidor já condenou.
    'src/js/account/account.control.js :: _handleRemoteAtlasDeleted': ARBITRAGEM.JA_CONDENADO,
    // A saída da conta, e aqui a reivindicação seria o instrumento ERRADO, não um esquecimento: o
    // par que precisa ser alcançado (uma aba saindo da conta e uma aba num atlas de servidor) NÃO
    // colide por chave (seção 8). Quem avisa é `announceRemoteNamespaceTeardown()`, na linha
    // imediatamente anterior, endereçado por dbSuffix, e ele ESPERA os acks antes de voltar.
    'src/js/account/account.control.js :: _handleLogout': ARBITRAGEM.AVISO_DE_TEARDOWN,
    // O slot nasceu na linha anterior (`createLocalAtlas`), com UUID e bancos novos, e é MONTADO
    // antes do wipe: o alvo é um namespace que nenhum par pode segurar. O próprio arquivo diz isso
    // por extenso ("THE CLAIM MOVES WITHOUT ARBITRATION, on purpose").
    'src/js/account/open-atlas.service.js :: switchToNewLocalAtlas': ARBITRAGEM.SEM_ALVO_VIVO,
    // Importar `.ebgeo` não-aditivo. Este ramo só roda quando NÃO se está num atlas de servidor
    // (o ramo de servidor sai por `switchToNewLocalAtlas`), e é gesto humano: escolher o arquivo
    // num diálogo. Uma aba que perdeu a ordem está atrás da sobreposição e não alcança o botão.
    'src/js/import_export/export-import.service.js :: _prepareNonAdditiveTarget':
        ARBITRAGEM.GESTO_SOB_SOBREPOSICAO,
    // "Apagar tudo" do gerente de mapas: gesto humano, com a confirmação na aba Mapas, que é o
    // único chamador. Mesmo argumento da sobreposição.
    'src/js/map/map.manager.js :: clearAllData': ARBITRAGEM.GESTO_SOB_SOBREPOSICAO,
    // "Limpar o atlas X": gesto humano atrás de um `showConfirm` destrutivo.
    'src/js/sidebar/tabs/maps.tab.js :: _handleClearAll': ARBITRAGEM.GESTO_SOB_SOBREPOSICAO,
});

/**
 * O trecho da seção 5 do `tab-lock.js`, entre o cabeçalho dela e o da seção 6.
 * @returns {string}
 */
function secaoCinco() {
    const bruto = ler('src/js/utilities/tab-lock.js');
    const inicio = bruto.indexOf('5. WHERE THE CALLER MUST ASK');
    const fim = bruto.indexOf('6. LIFECYCLE OF THE KEY');
    expect(inicio, 'a seção 5 existe').toBeGreaterThan(-1);
    expect(fim, 'a seção 6 existe').toBeGreaterThan(inicio);
    return bruto.slice(inicio, fim);
}

describe('tab-lock: o censo dos wipes, que substitui o contador da seção 5', () => {
    it('CENSO: todo `clearAllDataStore()` de `src/js` está classificado', () => {
        const medido = Object.fromEntries(
            sitiosDeWipe().map(({ sitio, preFlight }) => [sitio, preFlight])
        );
        const declarado = Object.fromEntries(
            Object.entries(CENSO_DE_WIPE)
                .map(([sitio, como]) => [sitio, como === ARBITRAGEM.PRE_FLIGHT])
        );
        // Uma comparação só, para que um sítio novo, um sítio removido e um pre-flight perdido
        // apareçam na MESMA mensagem, com o nome do arquivo e da função.
        expect(medido).toEqual(declarado);
    });

    it('DISCRIMINAÇÃO: a varredura acha os dois lados, e sabe distinguir', () => {
        const medidos = sitiosDeWipe();
        const comPreFlight = medidos.filter((s) => s.preFlight);
        // Se um dos dois lados fosse vazio, a comparação acima passaria verde com a varredura
        // cega para aquele lado.
        expect(comPreFlight.length, 'há sítios com pre-flight').toBeGreaterThan(1);
        expect(medidos.length - comPreFlight.length, 'e sítios sem').toBeGreaterThan(1);
        // E a definição não pode ter entrado como sítio: ela mora em `store/store.js` e é a única
        // ocorrência que não é chamada.
        expect(medidos.map((s) => s.sitio).filter((s) => s.startsWith('src/js/store/store.js')))
            .toEqual([]);
    });

    it('PROSA: a seção 5 descreve a propriedade e aponta para este censo, sem contar wipes', () => {
        const secao = secaoCinco();
        // O contador antigo, na forma exata em que envelheceu ("There are four such wipes").
        const CONTADOR = /\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(such\s+)?wipes\b/i;
        // Controle da própria regra: ela TEM de casar a frase que estava lá, senão esta asserção
        // seria cobertura vazia e passaria verde com qualquer coisa escrita na seção.
        expect(CONTADOR.test('There are four such wipes, and the three that are not')).toBe(true);
        expect(CONTADOR.test(secao), 'a seção 5 não voltou a contar wipes em prosa').toBe(false);

        // E o ponteiro para a rolagem: sem ele, "a propriedade" fica sem endereço e o leitor
        // seguinte reescreve a lista à mão.
        expect(secao).toContain('tab-lock-doc-testemunha.test.js');
        expect(secao).toContain('git ls-files');
    });
});
