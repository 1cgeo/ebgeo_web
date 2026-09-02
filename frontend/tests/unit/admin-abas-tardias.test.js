// Path: tests/unit/admin-abas-tardias.test.js

/**
 * @fileoverview AS DUAS ABAS QUE O PAINEL BAIXA SOB DEMANDA, e as três formas de o adiamento se
 * desfazer sem nada ficar vermelho.
 *
 * `diagnostico` e `uso` são as telas mais caras de `admin.html` (código de tela mais os folhas de
 * frase de cada uma) e só o administrador global as recebe. Até 2026-09-02 elas entravam por
 * import ESTÁTICO em `admin/index.js`, e o bundler não lê `adminAudience`: o chunk de entrada da
 * página levava as duas para TODA audiência, inclusive a do credenciado, que recebe duas abas e
 * nenhuma delas é destas. Medido num `dist/` fresco antes da mudança: 882 kB em 24 arquivos, dos
 * quais 616 kB eram os dois chunks de entrada (moderno e legado).
 *
 * O PESO CONSTRUÍDO JÁ TEM GUARDA, e não é esta: quem mede os kB é
 * `teto-de-peso-da-pagina-do-mapa.test.js`, metade (b), lendo o `dist/`. Mas aquela metade só sabe
 * dizer que a página engordou; ela não sabe POR ONDE, e depende de um `dist/` fresco (dist velho
 * dá verde velho). Esta suíte é a guarda ESTRUTURAL, que roda em milissegundos, não depende de
 * build nenhum e reprova nomeando o arquivo que refez o import estático.
 *
 * AS TRÊS AFIRMAÇÕES, e cada uma existe porque a outra não a cobre:
 *
 *   1. **Os dois ids do registro apontam para o CARREGADOR tardio, e as duas abas continuam sendo
 *      oferecidas a alguém.** A costura entre `admin-audience.js` e o registro (todo id tem
 *      fábrica, toda fábrica tem id) NÃO está aqui, e não deve estar: ela já é asserida por
 *      `admin-audiencia.test.js`, e duas cópias da mesma regra divergem com o tempo. O que aquela
 *      suíte não sabe distinguir é uma fábrica ansiosa de um carregador tardio — as duas são
 *      apenas uma chave com um valor —, e é essa metade que fica aqui.
 *   2. **Nenhum módulo de `src/js/` importa as duas de forma ESTÁTICA.** A varredura é sobre a
 *      árvore INTEIRA, e não sobre o grafo alcançável a partir da entrada, de propósito: se
 *      ninguém as importa estaticamente, elas não podem estar no payload ansioso de página
 *      nenhuma, e a afirmação vale sem precisar de um caminhador de grafo (já há três cópias de um
 *      neste repositório). O outro lado da mesma varredura é obrigatório e está aqui: a forma
 *      DINÂMICA tem de ser encontrada, senão renomear os arquivos deixaria as duas metades vazias
 *      e verdes.
 *   3. **O metadado ansioso é igual ao que a fábrica real devolve.** O trilho de navegação é
 *      construído antes de qualquer clique e precisa de `label`, `testid` e `icon`, então eles não
 *      podem ser adiados: eles são copiados para `index.js`. Duplicação declarada tem preço, e o
 *      preço é este caso. Sem ele, renomear a aba na fábrica real deixaria o trilho com o rótulo
 *      antigo e o `data-testid` antigo, o que quebra em silêncio toda spec de Playwright que
 *      procura o botão.
 *
 * POR QUE TUDO POR LEITURA DE FONTE, e não importando `admin/index.js`: aquele módulo é o barril
 * da página e importa as OITO abas ansiosas, o cliente HTTP e o contexto de sessão. Importá-lo num
 * teste de node puro para conferir um mapa de ids arrastaria essa superfície inteira para dentro
 * da suíte unitária, e é justamente a superfície que esta mudança existe para não arrastar. A
 * única coisa importada aqui é `admin-audience.js`, que é folha de zero imports por contrato.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminAudience } from '../../src/js/admin/admin-audience.js';
import {
    lazyTab,
    carregandoAbaNotice,
    abaNaoCarregouNotice,
} from '../../src/js/admin/lazy-tab.js';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** @param {string} rel @returns {string} */
const fonte = (rel) => readFileSync(resolve(FRONT, rel), 'utf8');

/** Remove o CONTEÚDO dos comentários: prosa que cita um import não é um import. */
const semComentarios = (texto) => texto
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, antes) => antes);

/** As duas abas tardias, com o arquivo de cada uma e a fábrica que ela exporta. */
const TARDIAS = Object.freeze([
    {
        id: 'diagnostico',
        arquivo: 'diag-tab.js',
        fabrica: 'createDiagTab',
        icone: 'ICON_DIAG',
        carregador: 'carregarDiagnostico',
    },
    {
        id: 'uso',
        arquivo: 'uso-tab.js',
        fabrica: 'createUsoTab',
        icone: 'ICON_USO',
        carregador: 'carregarUso',
    },
]);

const REGISTRO = 'src/js/admin/index.js';

/**
 * As chaves de TOPO do literal `TAB_FACTORIES`.
 *
 * QUEM FAZ O TRABALHO É A FATIA, e vale dizer qual, porque a intuição atribui isso à âncora de
 * indentação: o recorte vai de `const TAB_FACTORIES = Object.freeze({` até a primeira linha
 * `
});`, e é ELE que deixa de fora os literais de metadado (`META_DIAGNOSTICO`, `META_USO`),
 * que são declarados ANTES do registro e cujas chaves também estão a quatro espaços. A âncora
 * `^ {4}` faz outra coisa, mais modesta: dentro da fatia, ela distingue uma chave do registro de
 * qualquer coisa aninhada mais fundo, caso o literal volte a receber um corpo de função.
 *
 * As duas juntas ainda podem devolver lista vazia em silêncio (uma fatia que não case, um registro
 * renomeado), e é o caso de vácuo abaixo que fecha isso.
 * @returns {string[]}
 */
function idsDoRegistro() {
    const texto = semComentarios(fonte(REGISTRO));
    const inicio = texto.indexOf('const TAB_FACTORIES = Object.freeze({');
    expect(inicio, `\`TAB_FACTORIES\` não foi encontrado em ${REGISTRO}`).toBeGreaterThanOrEqual(0);
    const fim = texto.indexOf('\n});', inicio);
    expect(fim, 'o literal `TAB_FACTORIES` não fecha').toBeGreaterThan(inicio);
    const bloco = texto.slice(inicio, fim);
    return [...bloco.matchAll(/^ {4}([A-Za-z_$][\w$]*):/gm)].map((m) => m[1]);
}

/**
 * Os quatro campos de metadado de um literal de aba, lidos do texto.
 * @param {string} texto - O trecho que contém o literal.
 * @returns {{id: string, label: string, testid: string, icon: string}}
 */
function metadadoDe(texto) {
    const ler = (campo) => {
        const achado = texto.match(new RegExp(`${campo}:\\s*'([^']*)'`));
        expect(achado, `campo \`${campo}\` não encontrado no literal`).not.toBeNull();
        return achado[1];
    };
    const icone = texto.match(/icon:\s*([A-Z_][A-Z_0-9]*)/);
    expect(icone, 'campo `icon` não é um símbolo importado').not.toBeNull();
    return { id: ler('id'), label: ler('label'), testid: ler('testid'), icon: icone[1] };
}

describe('o registro aponta os dois ids para o carregador tardio', () => {
    const ids = idsDoRegistro();

    it('o parser leu o registro (senão as asserções abaixo são sobre o vazio)', () => {
        // Cobertura vazia é o modo de falha desta classe. As duas âncoras são abas ANSIOSAS,
        // porque um parser que só achasse as tardias também estaria quebrado.
        expect(ids.length).toBeGreaterThanOrEqual(8);
        expect(ids).toContain('users');
        expect(ids).toContain('account');
        expect(new Set(ids).size, 'há id repetido no registro').toBe(ids.length);
    });

    for (const { id, carregador } of TARDIAS) {
        it(`\`${id}\` continua no registro e continua sendo uma aba que alguém recebe`, () => {
            // Sem a segunda metade, apagar a aba do administrador deixaria toda esta suíte verde e
            // a carga tardia viraria uma afirmação sobre código morto.
            expect(ids).toContain(id);
            expect(adminAudience({ isAuthenticated: true, isAdmin: true }).tabIds).toContain(id);
        });

        it(`e a fábrica de \`${id}\` é o carregador tardio, não a aba direta`, () => {
            // O QUE `admin-audiencia.test.js` NÃO VÊ: para ele o registro é um mapa de chaves para
            // valores, e um valor que volte a ser a fábrica ansiosa continua sendo um valor. Esta é
            // a asserção que distingue os dois.
            const texto = semComentarios(fonte(REGISTRO));
            expect(texto).toMatch(new RegExp(`^ {4}${id}: ${carregador},$`, 'm'));
            expect(texto).toContain(`const ${carregador} = (principal) => lazyTab(`);
        });
    }
});

describe('as duas abas pesadas entram só por `import()`', () => {
    /** Todo `.js` versionado (ou novo e não ignorado) de `src/js/`. */
    const arquivos = execFileSync(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard', 'src/js'],
        { cwd: FRONT, encoding: 'utf8' }
    ).split('\n').map((l) => l.trim()).filter((l) => l.endsWith('.js'));

    it('a varredura tem o que varrer', () => {
        // O inventário vem do versionamento e não de uma lista à mão, pela razão de sempre: lista à
        // mão deixa de descrever o que existe. O piso é o controle de vácuo do `git ls-files`.
        expect(arquivos.length, 'o inventário de `src/js/` veio vazio').toBeGreaterThanOrEqual(400);
        expect(arquivos).toContain('src/js/admin/index.js');
    });

    for (const { arquivo, fabrica } of TARDIAS) {
        it(`nenhum módulo de \`src/js/\` importa \`${arquivo}\` de forma estática`, () => {
            const estatico = new RegExp(`(?:^|[\\s;}])(?:import|export)\\s+(?:[^;'"]*?\\s+from\\s+)?['"][^'"]*${arquivo.replace('.', '\\.')}['"]`);
            const culpados = arquivos.filter((rel) => estatico.test(semComentarios(fonte(rel))));
            expect(
                culpados,
                `${arquivo} voltou ao payload ansioso de \`admin.html\`. Troque o import ` +
                'estático por `await import()` no registro de `admin/index.js` (ver `lazy-tab.js`).'
            ).toEqual([]);
        });

        it(`e o registro o carrega por \`import('./${arquivo}')\`, chamando \`${fabrica}\``, () => {
            // O OUTRO LADO DA MESMA AFIRMAÇÃO. Sem ele, renomear os dois arquivos deixaria a
            // varredura acima verde para sempre sobre um alvo que não existe mais.
            const texto = semComentarios(fonte(REGISTRO));
            expect(texto).toContain(`await import('./${arquivo}')`);
            expect(texto).toContain(fabrica);
        });
    }
});

describe('o metadado ansioso do trilho é o mesmo que a fábrica real devolve', () => {
    for (const { id, arquivo, fabrica, icone } of TARDIAS) {
        it(`\`${id}\`: id, label, testid e ícone iguais dos dois lados`, () => {
            const registro = semComentarios(fonte(REGISTRO));
            const inicioMeta = registro.indexOf(`id: '${id}'`);
            expect(inicioMeta, `o metadado de \`${id}\` sumiu de ${REGISTRO}`)
                .toBeGreaterThanOrEqual(0);
            // JANELA PARA A FRENTE, e isto foi medido: uma janela que começasse ANTES do `id`
            // pegava o `icon: ICON_DIAG` do metadado anterior como se fosse o desta aba, e o caso
            // do `uso` reprovou por causa do instrumento, não do código.
            const doRegistro = metadadoDe(registro.slice(inicioMeta, inicioMeta + 300));

            const real = semComentarios(fonte(`src/js/admin/${arquivo}`));
            const inicioFabrica = real.indexOf(`export function ${fabrica}(`);
            expect(inicioFabrica, `${fabrica} sumiu de ${arquivo}`).toBeGreaterThanOrEqual(0);
            const daFabrica = metadadoDe(real.slice(inicioFabrica, inicioFabrica + 500));

            expect(doRegistro).toEqual(daFabrica);
            // E o valor concreto, em absoluto: comparar os dois lados sozinho ficaria verde com as
            // duas cópias erradas do mesmo jeito, que é a armadilha do teste de espelho.
            expect(doRegistro.id).toBe(id);
            expect(doRegistro.icon).toBe(icone);
            expect(doRegistro.testid).toBe(`admin-tab-${id}`);
        });
    }

    it('o ícone das duas vem de `admin-dom.js`, e não é uma segunda cópia do SVG', () => {
        // O metadado do trilho é cópia declarada; o ícone NÃO precisa ser, porque ele já mora num
        // módulo compartilhado. Se alguém colar o SVG aqui para "não depender de `admin-dom`", o
        // trilho e a aba passam a poder divergir num desenho, que é o tipo de diferença que
        // ninguém vê numa revisão.
        const registro = semComentarios(fonte(REGISTRO));
        expect(registro).toMatch(/import \{ ICON_DIAG, ICON_USO \} from '\.\/admin-dom\.js'/);
        expect(registro, 'há SVG colado no registro de abas').not.toContain('<svg');
    });
});

// ==============================================================================================
// O EMBRULHO, POR COMPORTAMENTO
//
// As quatro propriedades de `lazy-tab.js` viviam aqui como grep de fonte (um `toMatch` atrás da
// linha `if (!vivo) return;` e irmãos), e grep de fonte não executa nada: um refactor que
// guardasse a limpeza numa variável capturada cedo (`const l = limpezaReal; return () => l?.();`)
// preserva a linha, quebra a propagação da limpeza na PRIMEIRA visita e deixa a suíte inteira
// verde. O molde é `ferramenta-tardia-responde-ao-clique.test.js`: `document` mínimo, dublê com
// contador, `afterAll` que limpa o global.
// ==============================================================================================

/**
 * Elemento reduzido ao que `lazy-tab.js` e `failureState` penduram nele.
 * @param {string} tag
 * @returns {Object}
 */
function elementoFalso(tag = 'div') {
    return {
        tag,
        className: '',
        type: '',
        dataset: {},
        textContent: '',
        filhos: [],
        ouvintes: {},
        appendChild(filho) { this.filhos.push(filho); return filho; },
        replaceChildren(...novos) { this.filhos = novos; },
        addEventListener(evento, fn) { (this.ouvintes[evento] ??= []).push(fn); },
        removeEventListener() {},
    };
}

globalThis.document = { createElement: (tag) => elementoFalso(tag) };
afterAll(() => { delete globalThis.document; });

/**
 * Esgota as microtarefas pendentes.
 *
 * UM `await Promise.resolve()` NÃO BASTA, e o teste que se contentasse com ele reprovaria pelo
 * motivo errado ("não montou") sobre um código correto: o carregador real é uma função `async` que
 * ainda faz `await import(...)` dentro, então a promessa que o embrulho encadeia resolve alguns
 * ticks depois. O `setTimeout(0)` é um macrotask, e todo microtask pendente roda antes dele.
 * @returns {Promise<void>}
 */
const drenar = () => new Promise((r) => { setTimeout(r, 0); });

/** O metadado de uma aba tardia, no formato que o trilho recebe. */
const META = Object.freeze({
    id: 'diagnostico',
    label: 'Diagnóstico',
    testid: 'admin-tab-diagnostico',
    icon: '<svg/>',
});

/**
 * Um dublê de aba com contadores, mais o carregador que o entrega.
 * @param {{falha?: Error}} [opts] - Com `falha`, o carregador REJEITA em vez de entregar a aba.
 * @returns {{carregar: Function, contas: {cargas: number, montagens: number, limpezas: number}}}
 */
function dubleDeAba({ falha } = {}) {
    const contas = { cargas: 0, montagens: 0, limpezas: 0 };
    const aba = {
        id: META.id,
        label: META.label,
        testid: META.testid,
        mount(container) {
            contas.montagens += 1;
            const corpo = elementoFalso('p');
            corpo.dataset.testid = 'corpo-da-aba-real';
            container.replaceChildren(corpo);
            return () => { contas.limpezas += 1; };
        },
    };
    const carregar = async () => {
        contas.cargas += 1;
        // Um tick a mais, para que o dublê não resolva antes do que o `import()` real resolveria: o
        // caso do abandono depende de a limpeza caber ANTES da resolução, e um carregador síncrono
        // demais o tornaria vacuamente verde.
        await Promise.resolve();
        if (falha) throw falha;
        return aba;
    };
    return { carregar, contas };
}

describe('o embrulho tardio, executado', () => {
    it('o metadado é síncrono, porque o trilho é desenhado antes de qualquer clique', () => {
        const { carregar, contas } = dubleDeAba();
        const tardia = lazyTab(META, carregar);
        expect(tardia.id).toBe('diagnostico');
        expect(tardia.label).toBe('Diagnóstico');
        expect(tardia.testid).toBe('admin-tab-diagnostico');
        expect(tardia.icon).toBe('<svg/>');
        // E ele NÃO custa a carga: um metadado que só existisse depois do `import()` desfaria a
        // mudança inteira.
        expect(contas.cargas).toBe(0);
    });

    it('mostra a espera nomeando a aba, e num `data-testid` que não é o do botão do trilho', () => {
        const { carregar } = dubleDeAba();
        const container = elementoFalso();
        lazyTab(META, carregar).mount(container);
        expect(container.filhos).toHaveLength(1);
        expect(container.filhos[0].textContent).toBe(carregandoAbaNotice('Diagnóstico'));
        expect(container.filhos[0].dataset.testid).toBe('admin-aba-carregando-diagnostico');
        // O prefixo dos BOTÕES do trilho não pode aparecer num nó do CORPO: um seletor de teste que
        // casasse os dois acharia dois nós para a mesma aba.
        expect(container.filhos[0].dataset.testid).not.toContain('admin-tab-');
    });

    it('(a) a limpeza da aba real é propagada pela limpeza do embrulho', async () => {
        // O CASO QUE O GREP NÃO PEGAVA. Capturar `limpezaReal` cedo (`const l = limpezaReal`) deixa
        // a linha `vivo = false;` de pé e faz a limpeza da primeira visita virar `undefined`.
        const { carregar, contas } = dubleDeAba();
        const container = elementoFalso();
        const limpar = lazyTab(META, carregar).mount(container);
        await drenar();
        expect(contas.montagens, 'a aba real não chegou a montar').toBe(1);
        expect(contas.limpezas).toBe(0);
        limpar();
        expect(contas.limpezas, 'a limpeza da aba real não foi chamada').toBe(1);
    });

    it('(b) a limpeza ANTES da resolução impede a montagem da aba abandonada', async () => {
        // O painel esvazia o corpo e monta a próxima aba; uma promessa que resolvesse depois disso
        // pintaria a tela antiga sobre a nova.
        const { carregar, contas } = dubleDeAba();
        const container = elementoFalso();
        const limpar = lazyTab(META, carregar).mount(container);
        limpar();
        await drenar();
        expect(contas.montagens, 'a aba abandonada montou mesmo assim').toBe(0);
        expect(contas.limpezas, 'chamou uma limpeza que nunca existiu').toBe(0);
        // O container fica com a espera: quem escreve nele a partir daqui é a aba SEGUINTE, e o
        // embrulho não pode disputar isso com ela.
        expect(container.filhos[0].dataset.testid).toBe('admin-aba-carregando-diagnostico');
    });

    it('(c) a segunda visita monta de forma SÍNCRONA e não recarrega', async () => {
        const { carregar, contas } = dubleDeAba();
        const tardia = lazyTab(META, carregar);
        const container = elementoFalso();
        const limpar = tardia.mount(container);
        await drenar();
        limpar();

        const segundo = elementoFalso();
        tardia.mount(segundo);
        // SEM `await`: se a volta passasse por uma promessa, aqui ainda estaria a espera, e a
        // pessoa veria um "Carregando…" de um frame a cada troca de aba.
        expect(contas.montagens, 'a segunda visita não montou de forma síncrona').toBe(2);
        expect(segundo.filhos[0].dataset.testid).toBe('corpo-da-aba-real');
        expect(contas.cargas, 'a segunda visita recarregou o módulo').toBe(1);
    });

    it('(d) duas visitas DURANTE a mesma carga pedem o módulo uma vez só', async () => {
        // Diagnóstico, Uso e Diagnóstico de novo, antes de o chunk descer. Sem memoização são duas
        // chamadas da fábrica e duas instâncias da aba, e a que sobrevive é a da última promessa a
        // resolver: a outra fica viva em lugar nenhum.
        const { carregar, contas } = dubleDeAba();
        const tardia = lazyTab(META, carregar);
        const primeiro = elementoFalso();
        const limpar = tardia.mount(primeiro);
        limpar();
        const segundo = elementoFalso();
        tardia.mount(segundo);
        await drenar();
        expect(contas.cargas, 'a fábrica foi chamada duas vezes na mesma carga').toBe(1);
        expect(contas.montagens, 'montou mais de uma vez').toBe(1);
        expect(segundo.filhos[0].dataset.testid).toBe('corpo-da-aba-real');
        expect(primeiro.filhos[0].dataset.testid, 'pintou o container abandonado')
            .toBe('admin-aba-carregando-diagnostico');
    });

    it('(e) a falha vira `failureState` com saída, e "Tentar de novo" tenta de novo', async () => {
        const { carregar, contas } = dubleDeAba({ falha: new Error('chunk 404') });
        const container = elementoFalso();
        lazyTab(META, carregar).mount(container);
        await drenar();

        const bloco = container.filhos[0];
        expect(bloco.dataset.testid, 'a falha não desenhou o bloco de saída')
            .toBe('admin-failure-state');
        expect(bloco.filhos[0].textContent).toBe(abaNaoCarregouNotice('Diagnóstico'));
        const botao = bloco.filhos.find((f) => f.dataset.testid === 'admin-failure-retry');
        expect(botao, 'o bloco de falha veio sem botão').toBeTruthy();

        // A PROMESSA REJEITADA NÃO PODE FICAR MEMOIZADA: se ficasse, o botão reapresentaria a mesma
        // falha sem tentar nada, e o contador continuaria em 1.
        botao.ouvintes.click[0]();
        expect(contas.cargas, 'o botão não repetiu a carga').toBe(2);
        expect(container.filhos[0].dataset.testid, 'o retry não voltou para a espera')
            .toBe('admin-aba-carregando-diagnostico');
    });
});

describe('as duas frases da carga tardia', () => {
    // ELAS TÊM IMPORTADOR AGORA, e é este arquivo: antes o único caso que as tocava era um
    // `not.toMatch` sobre a FONTE, que fica verde para uma frase vazia, sem acento, ou que não
    // nomeie a aba. Valor absoluto, como manda a régua dos módulos de frase do painel.
    it('a espera nomeia a aba, com acento', () => {
        expect(carregandoAbaNotice('Diagnóstico')).toBe('Carregando a aba Diagnóstico…');
        expect(carregandoAbaNotice('Uso')).toBe('Carregando a aba Uso…');
    });

    it('a falha nomeia a aba e NÃO afirma causa', () => {
        expect(abaNaoCarregouNotice('Diagnóstico'))
            .toBe('Não foi possível carregar a aba Diagnóstico.');
        expect(abaNaoCarregouNotice('Uso')).toBe('Não foi possível carregar a aba Uso.');
        // Daqui não se distingue rede, sessão, servidor ou publicação nova, e "verifique sua
        // conexão" manda a pessoa depurar a internet dela por um erro que pode ser do programa.
        for (const frase of [abaNaoCarregouNotice('Uso'), carregandoAbaNotice('Uso')]) {
            expect(frase).not.toMatch(/conexão|internet|offline/i);
        }
    });
});
