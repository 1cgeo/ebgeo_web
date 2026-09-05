// Path: tests/unit/teto-de-peso-da-pagina-do-mapa.test.js

/**
 * @fileoverview O peso da página do mapa é a única grandeza cara deste repositório que vivia SÓ
 * EM COMENTÁRIO, e comentário não fica vermelho.
 *
 * O DEFEITO QUE ESTE ARQUIVO FECHA, em duas partes.
 *
 * A primeira é de cobertura: nenhum teste do repositório carregava `src/js/map_sig.js`. Ele é a
 * fase 4 do boot (`createControls`), o arquivo que instancia TODA ferramenta do mapa, e por isso é
 * exatamente onde o peso entra. `paginas-sem-mapa-nao-arrastam-a-store.test.js` vigia as três
 * páginas LEVES e usa o mapa apenas como controle positivo do caminhador; ninguém media o mapa em
 * si. A próxima onda vai trocar imports estáticos de ferramenta por `await import()` neste mesmo
 * arquivo, e sem uma guarda o import estático volta no commit seguinte sem nada acusar: a página
 * continua funcionando, só que mais pesada.
 *
 * A segunda é de prova: os números que descrevem esse peso estão em `vite.config.js:70-75`, em
 * prosa ("admin eager payload 900 kB -> 78 kB, and the MAP's eager payload dropped 3.96 MB -> 3.30
 * MB"). Número em comentário envelhece calado. O que aquela frase afirma é medível, e a partir
 * daqui é medido.
 *
 * POR QUE DUAS METADES, e elas medem coisas DIFERENTES de propósito:
 *
 *   (a) O GRAFO DE IMPORTS da fonte, a partir de `src/js/map_sig.js`. Não depende de build, roda em
 *       milissegundos e diz POR ONDE o peso entrou: reprova nomeando a cadeia de import, que é o
 *       que alguém precisa para consertar. É o instrumento que a próxima onda usa como régua.
 *   (b) Os kB do `dist/`, somando todo `.js` que cada HTML construído referencia por `src=` ou
 *       `href=`. É o que a pessoa de fato paga. O grafo pode encolher sem o payload encolher (o
 *       chunking junta módulos), e o payload pode inchar sem o grafo mudar (uma regra de
 *       `codeSplitting` errada arrasta um chunk lazy para o preload). Uma metade não substitui a
 *       outra, e é por isso que as duas existem.
 *
 * O ORÇAMENTO POR PASTA É FECHADO NOS DOIS SENTIDOS. Subir reprova, e BAIXAR sem editar a tabela
 * também reprova. Um orçamento que só proíbe subir envelhece por cima: quando a onda de
 * `await import()` tirar 47 módulos de `military_tools` do grafo ansioso, um teto de 47 continuaria
 * verde e a conquista deixaria de ser medida no dia seguinte. O lado "baixou" transforma cada ganho
 * em linha de tabela, no mesmo commit que o produziu.
 *
 * CONTROLE DE VÁCUO EM TODA METADE, porque as duas falham de forma silenciosa. Um caminhador
 * quebrado (alias que não resolve, regex que não casa) alcança um arquivo só e passa em qualquer
 * teto. Um HTML que deixe de referenciar chunks dá 0 kB e passa também. Então cada metade tem PISO
 * além do teto, ÂNCORAS que precisam ser alcançadas, e o caminhador ainda é provado contra uma
 * amostra sintética com comentário mentiroso, import de efeito colateral e import dinâmico.
 *
 * O caminhador é cópia do de `paginas-sem-mapa-nao-arrastam-a-store.test.js`, incluindo o motivo de
 * a regex estática usar `[^;'"]*?` e não `[\s\S]*?`. É a terceira cópia (a segunda está em
 * `compartilhar-sem-a-store.test.js`), e ela se paga: os três apontam para naturezas de alvo
 * diferentes (pastas de página, um módulo solto, e aqui um arquivo de boot mais o `dist/`).
 *
 * O QUE ESTE ARQUIVO NÃO SABE: se o `dist/` está atualizado. Ele mede o que está no disco. Um
 * `dist/` velho dá verde velho, e o remédio é `npm run build` antes de acreditar na metade (b).
 */

import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, writeFileSync, existsSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Os aliases do `vite.config.js` / `vitest.config.js`, em cópia mínima (só o mapeamento). */
const ALIASES = Object.freeze({
    '@js': 'src/js',
    '@css': 'src/css',
    '@store': 'src/js/store',
    '@state': 'src/js/state',
    '@utils': 'src/js/utilities',
    '@tools': 'src/js/tool_manager',
    '@toolbar': 'src/js/toolbar',
    '@modals': 'src/js/modals',
    '@sidebar': 'src/js/sidebar',
    '@layers': 'src/js/layers',
    '@catalog': 'src/js/catalog',
    '@ui': 'src/js/ui',
    '@events': 'src/js/events',
    '@': 'src'
});

/** Do mais longo para o mais curto: `@` casaria `@store` se viesse antes. */
const ALIAS_KEYS = Object.keys(ALIASES).sort((a, b) => b.length - a.length);

const NORM = (p) => p.replace(/\\/g, '/');

/**
 * Apaga o CONTEÚDO dos comentários preservando a contagem de linhas, para que prosa citando um
 * `from '...'` não vire aresta do grafo. Isto não é zelo: `map_sig.js` tem comentários que citam o
 * barril `./import_export` por extenso, para explicar por que ele NÃO é importado. Sem o limpador,
 * o próprio comentário que documenta a economia entraria no grafo e a desfaria na medida.
 * @param {string} texto
 * @returns {string}
 */
function semComentarios(texto) {
    return texto
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/(^|[^:])\/\/[^\n]*/g, (m, antes) => antes + ' '.repeat(m.length - antes.length));
}

/**
 * Resolve um especificador como o bundler resolve: alias, relativo, ou pacote externo.
 * @param {string} spec
 * @param {string} arquivo - Arquivo que fez o import (para o caso relativo).
 * @returns {{file?: string, bare?: string, missing?: string}}
 */
function resolverEspecificador(spec, arquivo) {
    let base = null;
    if (spec.startsWith('.')) {
        base = resolve(dirname(arquivo), spec);
    } else {
        for (const alias of ALIAS_KEYS) {
            if (spec === alias || spec.startsWith(`${alias}/`)) {
                base = resolve(FRONT, ALIASES[alias], spec.slice(alias.length).replace(/^\//, ''));
                break;
            }
        }
    }
    if (base === null) return { bare: spec };
    for (const candidato of [base, `${base}.js`, join(base, 'index.js')]) {
        if (existsSync(candidato) && statSync(candidato).isFile()) return { file: NORM(candidato) };
    }
    return { missing: spec };
}

/**
 * O `[^;'"]*?` do meio (a lista de nomes importados) NÃO pode ser `[\s\S]*?`, e isto foi medido, não
 * suposto: com `[\s\S]` a expansão preguiçosa atravessa a linha atrás do próximo ` from `, então um
 * import de EFEITO COLATERAL (`import '@utils';`, sem lista de nomes) era engolido pelo import
 * seguinte e não virava aresta do grafo. O controle negativo da guarda irmã passava VERDE por causa
 * disso. Um `[^;'"]` continua atravessando quebra de linha (lista de nomes em várias linhas resolve
 * normalmente), mas para na primeira aspa, que é onde o import de efeito colateral termina.
 *
 * A amostra sintética lá embaixo prende exatamente este caso, para a lição não depender de alguém
 * ler este parágrafo.
 */
const RE_ESTATICO = /(?:^|[\s;}])(?:import|export)\s+(?:[^;'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const RE_DINAMICO = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * Percorre o grafo de imports a partir de um conjunto de raízes.
 * @param {string[]} raizes - Caminhos absolutos.
 * @param {{seguirDinamicos?: boolean}} [options]
 * @returns {{arquivos: Set<string>, externos: Set<string>, naoResolvidos: string[],
 *   pai: Map<string, string>}}
 */
function percorrer(raizes, { seguirDinamicos = true } = {}) {
    const arquivos = new Set();
    const externos = new Set();
    const naoResolvidos = [];
    const pai = new Map();
    const fila = raizes.map(NORM);

    while (fila.length > 0) {
        const arquivo = fila.pop();
        if (arquivos.has(arquivo)) continue;
        arquivos.add(arquivo);
        if (!arquivo.endsWith('.js')) continue;

        const codigo = semComentarios(readFileSync(arquivo, 'utf8'));
        const regexes = seguirDinamicos ? [RE_ESTATICO, RE_DINAMICO] : [RE_ESTATICO];
        for (const regex of regexes) {
            regex.lastIndex = 0;
            let achado;
            while ((achado = regex.exec(codigo)) !== null) {
                const alvo = resolverEspecificador(achado[1], arquivo);
                if (alvo.file) {
                    if (!pai.has(alvo.file)) pai.set(alvo.file, arquivo);
                    fila.push(alvo.file);
                } else if (alvo.bare) {
                    externos.add(alvo.bare);
                } else {
                    naoResolvidos.push(`${arquivo} → ${achado[1]}`);
                }
            }
        }
    }
    return { arquivos, externos, naoResolvidos, pai };
}

/** Caminho de import da raiz até `alvo`, para a mensagem de falha dizer POR ONDE ele entrou. */
function caminhoAte(alvo, pai) {
    const cadeia = [alvo];
    let atual = alvo;
    while (pai.has(atual) && cadeia.length < 30) {
        atual = pai.get(atual);
        cadeia.push(atual);
    }
    return cadeia.reverse().map((p) => p.replace(`${NORM(FRONT)}/`, '')).join('\n  → ');
}

const abs = (rel) => NORM(resolve(FRONT, rel));
const rel = (p) => p.replace(`${NORM(FRONT)}/`, '');

/** Soma o tamanho da FONTE dos módulos do grafo, em kB. Fonte, não bundle: ver a metade (b). */
function kbDe(arquivos) {
    let bytes = 0;
    for (const f of arquivos) bytes += statSync(f).size;
    return Math.round(bytes / 1024);
}

/** Módulos de `src/js/<pasta>/` que o grafo alcançou. */
function daPasta(pasta, grafo) {
    return [...grafo.arquivos].filter((f) => f.includes(`/src/js/${pasta}/`));
}

/**
 * As PORTAS da pasta: os módulos dela cujo importador está FORA dela.
 *
 * É por onde a pasta entrou no grafo, e é a única informação que serve numa falha de orçamento.
 * "esperava 47, recebeu 52" não diz a ninguém o que desfazer; "entrou por `map_sig.js` →
 * `analysis_tools/index.js`" diz.
 */
function portasDe(pasta, grafo) {
    const dentro = (p) => Boolean(p) && p.includes(`/src/js/${pasta}/`);
    return daPasta(pasta, grafo).filter((f) => !dentro(grafo.pai.get(f))).sort();
}

// ============================================================================================
// (a) O GRAFO DE IMPORTS, a partir de `src/js/map_sig.js`
// ============================================================================================

const RAIZ = 'src/js/map_sig.js';

/**
 * Âncoras: arquivos que o caminhador TEM de alcançar no grafo ansioso.
 *
 * São o controle de que os aliases e os caminhos relativos resolveram de verdade. Sem elas, um
 * alias quebrado devolveria "nenhuma pasta estourou o orçamento" sobre um grafo vazio, e todo teto
 * abaixo passaria verde e cego.
 *
 * As três primeiras vêm por caminho RELATIVO a partir da raiz, a quarta por alias `@js` (é o único
 * import por alias de `map_sig.js`), e a quinta é transitiva de dentro de uma ferramenta.
 *
 * A QUINTA MUDOU EM 2026-08-25, e a troca é a prova de que a âncora estava fazendo o trabalho
 * dela. Era `military_tools/svg-to-png.js`, transitiva do controle de símbolo militar; a onda de
 * `await import()` tirou `military_tools` inteiro do grafo ansioso e a âncora reprovou, como
 * devia. A nova é transitiva do controle de linha, que continua ansioso porque `layer_setup.js`
 * remede as linhas no boot (ver `tool_manager/tool-registry.js`).
 */
const ANCORAS = Object.freeze([
    'src/js/store/index.js',
    'src/js/modals/index.js',
    'src/js/import_export/import.control.js',
    'src/js/first_person_3d_tool/services/keyboard-service-fp.js',
    'src/js/draw_tools/line_tool/line_measurement.js'
]);

/**
 * O ORÇAMENTO POR PASTA, em módulos do grafo ANSIOSO (remedido em 2026-08-25, DEPOIS da onda).
 *
 * Cada número é uma medida, não uma estimativa, e vale nos DOIS sentidos: subir reprova nomeando a
 * cadeia de import, baixar reprova mandando editar esta tabela no mesmo commit. Ver o parágrafo do
 * `@fileoverview` sobre por que o lado "baixou" existe.
 *
 * A ONDA DE `await import()` ACONTECEU, e esta tabela é o recibo dela. `tool-registry.js` passou a
 * carregar dezesseis ferramentas sob demanda, e as quatro linhas abaixo caíram no mesmo commit:
 *   military_tools        47 → 0   (820 kB de fonte)
 *   draw_tools            36 → 23  (652 → 380 kB)
 *   azimuth_distance_tool 10 → 0   (133 kB)
 *   analysis_tools         7 → 0   (160 kB)
 *   measurement_tool       8 → 3   (56 → 19 kB)
 * O grafo ansioso inteiro foi de 522 para 438 módulos, e de 7237 para 5844 kB de fonte.
 *
 * AS QUATRO LINHAS ZERADAS FICAM, e ficam de propósito. Zero não é ausência de orçamento: é o
 * orçamento mais apertado que existe, e o lado "subiu" continua armado. Apagar a linha faria a
 * pasta voltar em silêncio, protegida apenas pelo caso de cobertura abaixo — que só exige uma
 * linha, e uma linha nova traz o número de quem a escreveu, não o de quem a mediu.
 *
 * O QUE SOBROU EM `draw_tools`, e por quê: ponto, linha, polígono, texto, imagem e pincel
 * continuam ansiosos porque o BOOT DESENHA O QUE JÁ ESTAVA NO MAPA e chama esses seis de forma
 * síncrona, usando o valor de volta (`applyZoomCorrections` em `layers/styles/*.js`,
 * `restoreMeasurements` em `layer_setup.js`, `DEFAULT_PROPERTIES` em `import.control.js`). Os
 * três arquivos ficaram fora da superfície daquela onda. É a próxima fatia, e ela vale 23 módulos.
 *
 * As pastas `*_tool` / `*_tools` estão aqui por REGRA (o caso de cobertura abaixo exige uma linha
 * para toda pasta de ferramenta que o grafo alcance, então uma ferramenta nova entra no orçamento
 * sozinha). As cinco restantes estão por MEDIDA: `import_export`, `temporal`, `processing`,
 * `attribute_table` e `briefing` não têm o sufixo, mas são carga de ferramenta pela mesma
 * definição, e são alvo da mesma onda de `await import()`.
 */
const ORCAMENTO = Object.freeze({
    military_tools: 0,
    draw_tools: 23,
    import_export: 14,
    temporal: 12,
    azimuth_distance_tool: 0,
    processing: 10,
    attribute_table: 10,
    // 10 desde 2026-08-31: `mini-mapa-base.js`, que decide qual mapa base do CATÁLOGO o
    // mini-mapa desenha e em que faixa de zoom. Ele é ansioso porque o construtor do
    // MapLibre precisa do estilo e da faixa na hora, e o peso que ele traz é o do
    // `baselayers/index.js` (os cinco estilos), que a página do mapa já carrega.
    street_view_tool: 10,
    briefing: 8,
    measurement_tool: 3,
    analysis_tools: 0,
    '3d_models_viewer_tool': 5,
    first_person_3d_tool: 5,
    comment_tool: 3,
    selection_tools: 2
});

/**
 * As dependências externas do grafo ANSIOSO, em lista FECHADA.
 *
 * "não contém tal pacote" aceitaria em silêncio um quilo de dependência nova. Fechada, ela reprova
 * também quando um pacote SAI, que é a mesma disciplina do orçamento por pasta.
 */
const EXTERNOS_ANSIOSOS = Object.freeze([
    '@tmcw/togeojson',
    'dompurify',
    'geomagnetism',
    'jszip',
    'localforage',
    // OS TRÊS DO MAPLIBRE ENTRARAM EM 2026-09-05, e a entrada deles é o assunto do lote: a
    // aplicação deixou de ler `window.maplibregl` e passou a IMPORTAR o ponto único
    // (`src/js/map/maplibre.js`), então a aresta que o `<script>` de vendor escondia do
    // bundler passou a existir no grafo. Não é peso novo: a biblioteca já era baixada por
    // esta página desde 2026-09-04 (lote E), pelo entry `src/js/index.js`; o que mudou é
    // que agora `map_sig.js` também a alcança, e o caminhador enxerga.
    //
    // São três especificadores porque são três coisas: o módulo, a folha de estilo do
    // pacote e a URL do worker por `?worker&url`, sem a qual o Vite resolve o worker dentro
    // de `node_modules/.vite/deps` e o mapa sobe SEM TILE NENHUM, calado.
    'maplibre-gl',
    'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url',
    'maplibre-gl/dist/maplibre-gl.css',
    'mgrs',
    'proj4',
    'shpjs',
    'sortablejs'
]);

/**
 * Os pesados que só podem entrar por `import()` dinâmico. Somados, passam de 2 MB de fonte.
 *
 * A afirmação tem DOIS lados, e os dois são verificados: ausentes do grafo ansioso, e presentes no
 * grafo que segue dinâmicos. Só o primeiro lado seria satisfeito por um caminhador que não anda.
 */
const EXTERNOS_SO_DINAMICOS = Object.freeze([
    '@manycore/aholo-viewer',
    'chart.js',
    'html2canvas',
    'jspdf',
    'quill'
]);

describe('(a) o grafo de imports de `map_sig.js`', () => {
    const ansioso = percorrer([abs(RAIZ)], { seguirDinamicos: false });
    const completo = percorrer([abs(RAIZ)]);

    it('a raiz é mesmo o arquivo que a página do mapa carrega no boot', () => {
        // Sem este caso, renomear `map_sig.js` deixaria o arquivo aqui apontando para um módulo
        // morto: o grafo seria pequeno, todo teto passaria, e a guarda mediria outra coisa.
        expect(existsSync(abs(RAIZ)), `${RAIZ} não existe`).toBe(true);
        const daEntrada = percorrer([abs('src/js/index.js')], { seguirDinamicos: false });
        expect([...daEntrada.arquivos].map(rel), 'a entrada do mapa não alcança mais a raiz medida')
            .toContain(RAIZ);
    });

    it('o caminhador caminhou, resolveu tudo e alcançou as âncoras', () => {
        // Cobertura vazia é o modo de falha desta classe de teste. Um especificador não resolvido é
        // um ramo do grafo que não foi percorrido, e um ramo não percorrido é peso não medido.
        expect(ansioso.naoResolvidos).toEqual([]);
        expect(completo.naoResolvidos).toEqual([]);
        const alcancados = [...ansioso.arquivos].map(rel);
        for (const ancora of ANCORAS) expect(alcancados, `não alcançou ${ancora}`).toContain(ancora);
    });

    it('o grafo ANSIOSO cabe entre o piso e o teto medidos', () => {
        // 467 módulos e 6369 kB de fonte em 2026-09-02. A banda é de ~8% em torno da medida:
        // apertada o bastante para acusar uma pasta inteira voltando, larga o bastante para não
        // reprovar por um arquivo novo. O piso é tão obrigatório quanto o teto: um caminhador
        // quebrado devolve um grafo pequeno, e grafo pequeno passa em qualquer teto.
        //
        // A BANDA FOI RECENTRADA, e a razão é a metade útil desta anotação. Ela vinha de
        // 2026-08-25 (438 módulos, 5844 kB, logo depois da onda de `await import()`; antes dela
        // eram 522 e 7237), e em 2026-09-02 o grafo já estava em 6346 kB SEM a mudança do dia:
        // seis kB abaixo do teto, isto é, com a folga toda gasta por deriva que ninguém remediu.
        // Nesse estado a banda deixa de fazer o trabalho que o comentário promete: ela reprova o
        // PRÓXIMO arquivo novo, seja ele qual for, em vez de reprovar uma pasta voltando. Quem a
        // estourou aqui foram os dois folhas de continuar-feição (`line-extension.model.js` e
        // `line-extension.helpers.js`, 23 kB somados), que o controle de linha importa
        // estaticamente porque `createEditHandles` liga a alça de forma síncrona.
        //
        // RECENTRAR NÃO É AFROUXAR: o piso sobe junto, então um caminhador quebrado continua
        // acusando, e a próxima pasta inteira que voltar continua estourando o teto. Remeça e
        // reescreva os quatro números, com a data, sempre que a medida sair da banda.
        expect(ansioso.arquivos.size).toBeGreaterThanOrEqual(430);
        expect(ansioso.arquivos.size).toBeLessThanOrEqual(505);
        const kb = kbDe(ansioso.arquivos);
        expect(kb, `fonte ansiosa em ${kb} kB`).toBeGreaterThanOrEqual(5860);
        expect(kb, `fonte ansiosa em ${kb} kB`).toBeLessThanOrEqual(6880);
    });

    it('o grafo COMPLETO (seguindo `import()`) cabe entre o piso e o teto medidos', () => {
        // 638 módulos e 10740 kB em 2026-09-03. Este teto guarda o tamanho da aplicação inteira, e a
        // diferença para o ansioso é o que hoje está sob demanda.
        //
        // A BANDA FOI RECENTRADA em 2026-09-03, pela mesma regra do bloco ansioso acima. Ela vinha de
        // 2026-08-25 (603 módulos, 9805 kB, teto em 10600), e o porte do dia trouxe 140 kB de fonte
        // NOVA, quase toda sob demanda: a Linha de Coordenação (cinco arquivos, 124 kB, dos quais só
        // 14 no grafo ansioso), o corte da Linha de Limite (22 kB) e o Núcleo das medidas de
        // coordenação (27 kB). Medido na árvore integrada: 10740 kB, 140 acima do teto velho, e
        // 10605 kB SEM o lote, isto é, o teto já estava vencido por deriva antes dele. O grafo
        // ansioso ficou em 6467 kB, dentro da banda dele. Piso e teto sobem juntos (~8% em torno da
        // medida), então o caminhador quebrado continua acusando.
        expect(completo.arquivos.size).toBeGreaterThanOrEqual(580);
        expect(completo.arquivos.size).toBeLessThanOrEqual(700);
        const kb = kbDe(completo.arquivos);
        expect(kb, `fonte total em ${kb} kB`).toBeGreaterThanOrEqual(9880);
        expect(kb, `fonte total em ${kb} kB`).toBeLessThanOrEqual(11600);
    });

    it('seguir `import()` de fato acrescenta grafo, e é isso que prova a regex dinâmica', () => {
        // CONTROLE DE VÁCUO da regex `RE_DINAMICO`. Se ela parasse de casar, os dois grafos ficariam
        // idênticos, o ansioso continuaria dentro da sua banda e nada acusaria. A diferença medida
        // passou de 82 módulos / ~2600 kB para 162 módulos / ~4000 kB em 2026-08-25, que é a onda
        // de `await import()` das ferramentas. O piso de 50 tem folga e ainda pega o instrumento
        // quebrado.
        const novos = [...completo.arquivos].filter((f) => !ansioso.arquivos.has(f));
        expect(novos.length, 'o grafo dinâmico não acrescentou nada: a regex parou de casar')
            .toBeGreaterThanOrEqual(50);
        expect(kbDe(novos)).toBeGreaterThanOrEqual(1500);
    });

    it('as dependências externas do grafo ansioso são exatamente as declaradas', () => {
        expect([...ansioso.externos].sort()).toEqual([...EXTERNOS_ANSIOSOS].sort());
    });

    for (const pacote of EXTERNOS_SO_DINAMICOS) {
        it(`o pacote pesado ${pacote} entra só por \`import()\``, () => {
            expect([...ansioso.externos], `${pacote} voltou para o payload ansioso`)
                .not.toContain(pacote);
            // O outro lado da mesma afirmação: sem ele, um caminhador que não achasse pacote nenhum
            // deixaria a linha acima verde para sempre.
            expect([...completo.externos], `${pacote} sumiu do grafo: a afirmação virou vazia`)
                .toContain(pacote);
        });
    }
});

describe('(a) o orçamento por pasta, fechado nos DOIS sentidos', () => {
    const ansioso = percorrer([abs(RAIZ)], { seguirDinamicos: false });

    it('toda pasta de ferramenta que o grafo alcança tem linha na tabela', () => {
        // Sem este caso, uma ferramenta NOVA nasceria fora do orçamento e o verde continuaria
        // completo sobre as quinze pastas que a tabela conhece. É a forma silenciosa desta classe de
        // teste envelhecer: a lista escrita à mão deixa de descrever o que existe.
        const pastas = new Set();
        for (const f of ansioso.arquivos) {
            const achado = f.match(/\/src\/js\/([^/]+)\//);
            if (achado && /_tools?$/.test(achado[1])) pastas.add(achado[1]);
        }
        // Sete em 2026-08-25 (eram dez antes de `military_tools`, `azimuth_distance_tool` e
        // `analysis_tools` saírem do grafo ansioso). O piso continua sendo controle de vácuo: ele
        // acusa um caminhador quebrado, não um ganho de peso.
        expect(pastas.size, 'nenhuma pasta de ferramenta no grafo: o caminhador não caminhou')
            .toBeGreaterThanOrEqual(6);
        for (const pasta of [...pastas].sort()) {
            expect(
                Object.keys(ORCAMENTO),
                `${pasta} entrou no grafo ansioso e não tem linha no ORCAMENTO`
            ).toContain(pasta);
        }
    });

    for (const [pasta, teto] of Object.entries(ORCAMENTO)) {
        it(`${pasta}: exatamente ${teto} módulos ansiosos`, () => {
            const modulos = daPasta(pasta, ansioso);
            const portas = portasDe(pasta, ansioso)
                .map((f) => caminhoAte(f, ansioso.pai))
                .join('\n\n');

            if (modulos.length > teto) {
                expect.fail(
                    `${pasta} subiu de ${teto} para ${modulos.length} módulos ansiosos.\n` +
                    `A pasta entra no grafo por estas portas:\n\n${portas}\n\n` +
                    'Troque o import estático por `await import()`, ou justifique o peso novo ' +
                    'ajustando a tabela ORCAMENTO com a medida na mão.'
                );
            }
            if (modulos.length < teto) {
                expect.fail(
                    `${pasta} caiu de ${teto} para ${modulos.length} módulos ansiosos. ` +
                    'Isto é bom, e por isso reprova: EDITE a tabela ORCAMENTO para ' +
                    `${modulos.length} NESTE MESMO COMMIT. Um orçamento que só proíbe subir ` +
                    'envelhece por cima e deixa de medir o que se conquistou.\n\n' +
                    (portas ? `Portas que restaram:\n\n${portas}` : 'A pasta saiu do grafo ansioso.')
                );
            }
            expect(modulos.length).toBe(teto);
        });
    }
});

// ============================================================================================
// CONTROLE DE VÁCUO DO INSTRUMENTO: uma amostra sintética, com as três armadilhas
// ============================================================================================

describe('(a) o caminhador é provado contra uma amostra sintética', () => {
    // Este bloco não mede o repositório: ele mede o INSTRUMENTO. Os tetos todos acima são
    // afirmações sobre um grafo, e um grafo só vale o que vale quem o percorreu. As três armadilhas
    // são as que já custaram caro: prosa em comentário virando aresta, import de efeito colateral
    // sumindo por causa da regex, e `import()` sendo ignorado.
    const dir = NORM(mkdtempSync(join(tmpdir(), 'ebgeo-caminhador-')));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    writeFileSync(join(dir, 'raiz.js'), [
        "// import './mentira-de-linha.js';",
        "/* aqui o texto diz from './mentira-de-bloco.js' e não pode virar aresta */",
        "import './efeito-colateral.js';",
        "import { x } from './nomeado.js';",
        "import config from '@js/config.js';",
        'export async function abrir() {',
        "    const m = await import('./tardio.js');",
        '    return m.default + x + config;',
        '}'
    ].join('\n'));
    writeFileSync(join(dir, 'efeito-colateral.js'), 'globalThis.__ebgeo_amostra = true;\n');
    writeFileSync(join(dir, 'nomeado.js'), 'export const x = 1;\n');
    writeFileSync(join(dir, 'tardio.js'), 'export default 2;\n');

    const raiz = join(dir, 'raiz.js');
    const ansioso = percorrer([raiz], { seguirDinamicos: false });
    const completo = percorrer([raiz]);
    const nomes = (g) => [...g.arquivos].map((f) => f.split('/').pop()).sort();

    it('comentário não vira aresta, nem de linha nem de bloco', () => {
        // Os dois arquivos citados nos comentários NÃO EXISTEM. Se o limpador falhasse, eles
        // apareceriam como não resolvidos, e é exatamente por isso que a amostra os cita por um nome
        // inexistente: a falha fica visível em vez de silenciosa.
        expect(ansioso.naoResolvidos).toEqual([]);
        expect(nomes(ansioso)).not.toContain('mentira-de-linha.js');
        expect(nomes(ansioso)).not.toContain('mentira-de-bloco.js');
    });

    it('import de EFEITO COLATERAL vira aresta (a armadilha do `[\\s\\S]`)', () => {
        // Este é o caso que já fez um controle negativo passar verde. Ver o comentário de
        // `RE_ESTATICO`.
        expect(nomes(ansioso)).toContain('efeito-colateral.js');
        expect(nomes(ansioso)).toContain('nomeado.js');
    });

    it('o alias resolve, e `import()` só entra no grafo completo', () => {
        expect([...ansioso.arquivos].map(rel), 'o alias `@js` parou de resolver')
            .toContain('src/js/config.js');
        expect(nomes(ansioso), '`tardio.js` entrou no grafo ANSIOSO').not.toContain('tardio.js');
        expect(nomes(completo), '`tardio.js` sumiu do grafo completo').toContain('tardio.js');
    });

    it('e o `caminhoAte` devolve a cadeia inteira, que é o que a falha de orçamento imprime', () => {
        // Uma mensagem de falha também quebra calada: se `caminhoAte` devolvesse só o alvo, todas as
        // falhas de orçamento diriam "esperava 47, recebeu 52" e não ajudariam ninguém.
        const alvo = [...completo.arquivos].find((f) => f.endsWith('tardio.js'));
        const cadeia = caminhoAte(alvo, completo.pai);
        expect(cadeia).toContain('raiz.js');
        expect(cadeia).toContain('→');
        expect(cadeia).toContain('tardio.js');
    });
});

// ============================================================================================
// (b) OS kB DO `dist/`: o que a pessoa de fato paga
// ============================================================================================

/**
 * A válvula de escape, para quem declara que AQUELA rodada não mede peso construído.
 *
 * Ela é uma variável de ambiente e não um `it.skip`, porque a diferença é quem decide: um `skip`
 * escrito no arquivo pula para todo mundo e para sempre, e é verde sem verificação. Faltando o
 * `dist/` sem a declaração, esta metade REPROVA nomeando `npm run build`.
 */
const PULA_DIST = process.env.EBGEO_SEM_PESO_CONSTRUIDO === '1';
const DIST = join(FRONT, 'dist');

/**
 * Todo `.js` que um HTML construído referencia por `src=` ou `href=`, com o `/vendors/` de fora.
 *
 * O `href=` é obrigatório na conta e é a maior parte dela: é o `<link rel="modulepreload">` que o
 * Vite injeta, ou seja, o chunk que o navegador baixa ANTES de rodar qualquer coisa. Contar só o
 * `src=` mediria três arquivos de sessenta e três.
 *
 * `/vendors/` sai porque não é payload do bundler: são estáticos de `public/` (Cesium, Turf,
 * GDAL), copiados sem passar pelo chunking, e o que esta metade guarda é a decisão de
 * `codeSplitting`. Eles somam ~7,4 MB e afogariam qualquer variação do que se mede aqui.
 *
 * O MAPLIBRE SAIU DESSA LISTA EM 2026-09-04 e ENTROU na conta, e é a maior mudança que este
 * arquivo já sofreu sem que o produto engordasse: a 6.x não publica bundle UMD, então o
 * `<script src="/vendors/maplibre-gl.js">` deu lugar a um import de npm, e 981 kB atravessaram o
 * balcão de "não é payload do bundler" para "é". Os números de antes e depois estão nas bandas
 * abaixo, com a comparação honesta feita ali.
 * @param {string} html - Nome do arquivo em `dist/`.
 * @returns {{assets: string[], vendors: string[], kb: number}}
 */
function payloadDe(html) {
    const texto = readFileSync(join(DIST, html), 'utf8');
    const refs = new Set();
    const regex = /(?:src|href)="([^"]+\.js)"/g;
    let achado;
    while ((achado = regex.exec(texto)) !== null) refs.add(achado[1]);

    const todos = [...refs].sort();
    const vendors = todos.filter((p) => p.startsWith('/vendors/'));
    const assets = todos.filter((p) => !p.startsWith('/vendors/'));
    const kb = Math.round(assets.reduce((a, p) => a + statSync(join(DIST, p)).size, 0) / 1024);
    return { assets, vendors, kb };
}

/**
 * As quatro páginas construídas, com piso e teto MEDIDOS em 2026-08-25.
 *
 * O teto de `index.html` desceu de 3600 para 3000 kB em 2026-08-25, e a descida é o recibo da onda
 * de carga tardia das ferramentas: a página do mapa passou de 63 arquivos e 3362 kB para 65
 * arquivos e 2781 kB. Mais arquivos e menos peso é o resultado esperado de um corte assim — cada
 * ferramenta que saiu virou um chunk próprio, e nenhum deles é baixado no boot.
 *
 * O TETO NUNCA VOLTA A SUBIR SOZINHO. `vite.config.js:70-75` registra que este payload já foi 3,96
 * MB (4055 kB); um teto acima disso deixaria a regressão inteira passar, e a frase daquele
 * comentário voltaria a ser só uma frase. O PISO segue a mesma disciplina do ORÇAMENTO por pasta:
 * ele subiu junto, para 2450 kB, de modo que um ganho novo apareça na tabela em vez de passar
 * calado.
 *
 * `entrada` é a ÂNCORA: o chunk de entrada que o `<script type="module">` da página carrega. Sem
 * ela, um HTML que perdesse todas as referências daria 0 arquivos e 0 kB, e passaria em qualquer
 * teto. É o vácuo desta metade, e ele é fácil de produzir: basta uma regra de `input` errada.
 */
const PAGINAS_DIST = Object.freeze([
    // index.html: 3000 -> 4150 em 2026-09-04, e a SUBIDA NÃO É UMA REGRESSÃO, é uma troca de
    // balcão. Medido nesta árvore, build fresco, nos dois estados do mesmo dia:
    //
    //   antes  71 arquivos, 2909 kB de assets + 1022 kB de `/vendors/maplibre-gl.js` (fora da
    //          conta desta metade) = 3931 kB que a pessoa baixava para abrir o mapa;
    //   depois 71 arquivos, 3889 kB de assets, zero MapLibre em `/vendors/`.
    //
    // Os mesmos 71 arquivos: o MapLibre não abriu um chunk novo, entrou num que já existia
    // (`entriesAware` o compartilha com `calibracao.html`, que também o carregava por
    // `<script>`). O teto sobe 1150 e o payload sobe 980, então a folga NÃO aumentou.
    //
    // O QUE ESTE NÚMERO NÃO CONTA, e precisa ficar dito porque é o custo real da migração: o
    // worker. A 5.18 era um UMD de 998 kB (263 kB gzip) com o worker embutido, criado por Blob;
    // a 6.x separa `assets/maplibre-gl-worker-*.js`, 620 kB (147 kB gzip), que `setWorkerUrl`
    // busca no boot do mapa e que NENHUM HTML referencia, logo esta conta não o vê. Somando o que
    // a pessoa de fato baixa: 998 kB (263 gzip) antes, 1601 kB (403 gzip) depois, ou seja +603 kB
    // (+140 gzip) de MapLibre, que é o código compartilhado duplicado entre a thread principal e
    // o worker. Quem paga isso ganha o outro lado da 6.x, medido na bancada e não aqui.
    //
    // O TETO CONTINUA NÃO SUBINDO SOZINHO. O `vite.config.js` registra 3,96 MB (4055 kB) como o
    // payload de antes do `entriesAware`, e 4150 é maior que aquilo, mas os dois números não são
    // do mesmo balcão: 4055 kB EXCLUÍA os 998 kB do MapLibre, e o equivalente de hoje seria
    // 5053 kB. Contra o teto novo, aquela regressão continua reprovando com folga de 900 kB.
    // A banda é de ~7% acima e ~7% abaixo da medida (3889), como o ORÇAMENTO por pasta.
    { html: 'index.html', entrada: 'main', minArq: 45, maxArq: 80, minKb: 3600, maxKb: 4150 },
    { html: 'atlas.html', entrada: 'atlas', minArq: 18, maxArq: 40, minKb: 320, maxKb: 700 },
    // admin.html: 800 -> 950 -> 720 em 2026-09-02, com a medida na mao: 670 kB em 24 arquivos, build
    // fresco. As abas Diagnostico e Uso (com os folhas de frase) tinham levado a pagina a 882 kB
    // (admin-*.js 258 kB, admin-legacy-*.js 358 kB), e o teto de 800 passou verde por semanas porque
    // esta metade le o dist/, e dist velho da verde velho. A DESCIDA e o recibo da carga tardia: as
    // duas abas passaram a entrar por import() no registro de admin/index.js (ver admin/lazy-tab.js),
    // o que tirou 106 kB de CADA chunk de entrada (258 -> 152 kB e 358 -> 252 kB). Os 212 kB viraram
    // quatro chunks que o HTML nao referencia (diag-tab 61 kB + legado 61 kB, uso-tab 45 kB + legado
    // 45 kB), e e por isso que a contagem de arquivos NAO mudou: 24 antes e 24 depois. O piso subiu
    // junto, para o proximo ganho aparecer na tabela em vez de passar calado.
    { html: 'admin.html', entrada: 'admin', minArq: 14, maxArq: 34, minKb: 600, maxKb: 720 },
    // calibracao.html: 1100 -> 1980 em 2026-09-04, pela MESMA troca de balcão de `index.html` e
    // pelo MESMO arquivo. Esta página carregava o `<script src="/vendors/maplibre-gl.js">` para
    // desenhar o mapa de projeto e o minimapa; agora ela alcança o chunk de MapLibre pelo grafo,
    // o mesmo que o mapa alcança. Medido: 23 arquivos e 845 kB antes, 23 arquivos e 1824 kB
    // depois, com os mesmos 23 arquivos e um deles 981 kB maior.
    //
    // Ela é a única das três páginas sem mapa que sobe, e isso é uma propriedade e não um acaso:
    // `atlas.html` e `admin.html` não instanciam mapa nenhum, não alcançam o ponto único, e as
    // medidas delas ficaram idênticas (521 e 673 kB) do outro lado da migração.
    { html: 'calibracao.html', entrada: 'calibracao', minArq: 12, maxArq: 32, minKb: 1700, maxKb: 1980 }
]);

describe('(b) o peso construído de cada página', () => {
    it('o `dist/` existe, ou esta rodada declarou que não mede peso construído', () => {
        if (PULA_DIST) {
            // A declaração deixa RASTRO: este caso continua rodando e afirma que alguém abriu a
            // válvula de propósito. Um `skip` mudo aqui seria verde sem verificação nenhuma.
            expect(process.env.EBGEO_SEM_PESO_CONSTRUIDO).toBe('1');
            return;
        }
        expect(
            existsSync(join(DIST, 'index.html')),
            'não há `frontend/dist/`, e esta metade mede o que a pessoa de fato baixa. ' +
            'Rode `npm run build` a partir de `frontend/`. ' +
            'Se esta rodada não mede peso construído (unitário rápido, CI sem build), ' +
            'declare `EBGEO_SEM_PESO_CONSTRUIDO=1` e o bloco abaixo sai do ar com rastro.'
        ).toBe(true);
    });

    const MEDE = !PULA_DIST && existsSync(join(DIST, 'index.html'));

    (MEDE ? describe : describe.skip).each(PAGINAS_DIST)(
        '$html',
        ({ html, entrada, minArq, maxArq, minKb, maxKb }) => {
            // Leitura PREGUIÇOSA, e isto foi medido: `describe.skip` ainda EXECUTA o corpo da
            // suíte. Lendo o `dist/` aqui, um `dist/` ausente derruba a coleta do arquivo inteiro
            // com `ENOENT`, e a falha informativa logo acima ("rode `npm run build`") nunca chega a
            // ser impressa. A mensagem útil só sobrevive se nada tocar o disco fora dos casos.
            let cache = null;
            const payload = () => (cache ??= payloadDe(html));

            it('referencia o próprio chunk de entrada (senão a conta é sobre o vazio)', () => {
                const temEntrada = payload().assets.some(
                    (p) => new RegExp(`/assets/${entrada}-[^/]+\\.js$`).test(p)
                );
                expect(temEntrada, `${html} não referencia mais o chunk \`${entrada}-*.js\``)
                    .toBe(true);
                // O runtime do Rolldown está em toda página construída. É a segunda âncora, e ela
                // pega o caso de a página referenciar só o entry e mais nada.
                const temRuntime = payload().assets.some((p) => p.includes('/assets/rolldown-runtime-'));
                expect(temRuntime, `${html} não referencia o runtime do bundler`).toBe(true);
            });

            it(`baixa entre ${minArq} e ${maxArq} arquivos, e entre ${minKb} e ${maxKb} kB`, () => {
                const lista = payload().assets.join('\n  ');
                expect(payload().assets.length, `arquivos:\n  ${lista}`)
                    .toBeGreaterThanOrEqual(minArq);
                expect(payload().assets.length, `arquivos:\n  ${lista}`).toBeLessThanOrEqual(maxArq);
                expect(payload().kb, `${html} está em ${payload().kb} kB`)
                    .toBeGreaterThanOrEqual(minKb);
                expect(
                    payload().kb,
                    `${html} está em ${payload().kb} kB, acima do teto de ${maxKb} kB. ` +
                    'Confira o que o grafo de imports da metade (a) diz que entrou, e rode ' +
                    '`npm run build` de novo se o `dist/` for mais velho que o código.'
                ).toBeLessThanOrEqual(maxKb);
            });

            it('todo arquivo referenciado existe no disco e não está vazio', () => {
                // Um `href` para um chunk que não existe é 404 no navegador, e aqui seria um kB a
                // menos na conta, sem nada acusar.
                for (const p of payload().assets) {
                    const caminho = join(DIST, p);
                    expect(existsSync(caminho), `${p} referenciado e ausente`).toBe(true);
                    expect(statSync(caminho).size, `${p} está vazio`).toBeGreaterThan(0);
                }
            });
        }
    );

    (MEDE ? it : it.skip)('o `/vendors/` de fora da conta é uma escolha, e ele está lá', () => {
        // Se o filtro de `/vendors/` passasse a comer TUDO (um `base` diferente, um caminho
        // reescrito), a conta cairia para zero e o piso de kB acusaria. Este caso acusa antes, e
        // nomeia o motivo: os vendores existem, e foram excluídos de propósito.
        //
        // O PISO DESCEU DE 3 PARA 2 EM 2026-08-25, e DE 2 PARA 1 EM 2026-09-04. As duas descidas
        // são recibo de uma onda, não afrouxamento. Primeiro os 619 kB de `/vendors/turf.min.js`
        // saíram do `index.html` para a carga sob demanda de `src/js/utilities/turf-loader.js`,
        // como o milsymbol (855 kB) e o GDAL (187 kB) já tinham saído. Depois saiu o MapLibre, por
        // outro motivo: a 6.x não publica bundle UMD, então `public/vendors/maplibre-gl.js` foi
        // APAGADO e a biblioteca entrou no grafo do bundler.
        //
        // RESTA UM, o `<link rel="prefetch">` do Cesium, e por isso o piso de contagem sozinho
        // deixaria de ser um controle de vácuo decente: com um só item, "pelo menos um" e "exatamente
        // o que eu espero" ficaram longe demais. Então este caso passou a cobrar a IDENTIDADE, que é
        // mais forte do que o piso de 2 jamais foi, e a cobrar dos dois lados: o Cesium está lá, e o
        // MapLibre NÃO está. Se ele voltar para `public/vendors/`, este caso acusa antes de a
        // metade (b) notar que a página emagreceu 981 kB por motivo errado.
        const { vendors } = payloadDe('index.html');
        expect(vendors.length, 'a página do mapa não referencia mais nenhum vendor de `public/`')
            .toBeGreaterThanOrEqual(1);
        expect(vendors, 'o `prefetch` do Cesium é o último vendor de `public/` da página do mapa')
            .toContain('/vendors/cesium/Cesium.js');
        expect(
            vendors.some((p) => p.includes('maplibre')),
            'o MapLibre voltou a `public/vendors/`: a 6.x não tem bundle UMD'
        ).toBe(false);
        for (const p of vendors) {
            expect(existsSync(join(DIST, p)), `${p} referenciado e ausente`).toBe(true);
        }
    });

    (MEDE ? it : it.skip)('o mapa é a página pesada, e as outras três continuam leves', () => {
        // A propriedade que `paginas-sem-mapa-nao-arrastam-a-store.test.js` guarda no GRAFO, medida
        // aqui em kB construídos. As duas medidas podem divergir, e divergência entre elas é
        // defeito de chunking, não ruído.
        //
        // A CONTA É SOBRE O PAYLOAD EXCLUSIVO, e a mudança de 2026-09-04 é a razão. A conta antiga
        // era a razão bruta entre os totais, com piso 3. Quando o MapLibre passou de `<script>` de
        // vendor a chunk do bundler, ele entrou no total das DUAS páginas que o carregam, e a razão
        // bruta caiu de 3,44 para 2,13 sem que uma única linha do app tivesse mudado de lugar. Ou
        // seja: a razão bruta media, em parte, quanta BIBLIOTECA as duas dividem, e não quanta
        // APLICAÇÃO só o mapa tem.
        //
        // Descontando de cada lado o que as duas páginas de fato COMPARTILHAM, a medida é invariante
        // à migração: 4,34 antes e 4,35 depois para a calibração (o vizinho mais pesado), 8,8 para o
        // admin e 17,4 para o atlas. Piso 3, o mesmo de sempre, agora sobre a grandeza certa.
        //
        // O piso continua sendo o controle contra o modo de falha que este caso existe para pegar:
        // uma página sem mapa que passe a arrastar o app do mapa engorda o EXCLUSIVO dela, e nenhum
        // desconto a salva.
        const mapa = payloadDe('index.html');
        for (const html of ['atlas.html', 'admin.html', 'calibracao.html']) {
            const outra = payloadDe(html);
            const comuns = outra.assets.filter((p) => mapa.assets.includes(p));
            const kbComuns = Math.round(
                comuns.reduce((a, p) => a + statSync(join(DIST, p)).size, 0) / 1024
            );
            const soMapa = mapa.kb - kbComuns;
            const soEla = outra.kb - kbComuns;
            // Sem esta linha o desconto poderia comer TUDO (duas páginas com o mesmo conjunto de
            // assets dariam 0/0) e a divisão abaixo sairia `NaN`, que não reprova nada.
            expect(soEla, `${html}: nada é exclusivo dela, o desconto comeu a conta`)
                .toBeGreaterThan(0);
            expect(
                soMapa / soEla,
                `mapa ${soMapa} kB exclusivos contra ${soEla} kB de ${html} `
                + `(${kbComuns} kB em ${comuns.length} arquivos comuns)`
            ).toBeGreaterThanOrEqual(3);
        }
    });
});
