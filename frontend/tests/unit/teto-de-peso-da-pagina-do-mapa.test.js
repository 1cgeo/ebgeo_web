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
import { Buffer } from 'node:buffer';
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

/**
 * Soma o tamanho da FONTE dos módulos do grafo, em kB. Fonte, não bundle: ver a metade (b).
 *
 * CONTA O CONTEÚDO COM O FIM DE LINHA NORMALIZADO PARA LF, e não o tamanho do arquivo em disco,
 * desde 2026-09-23. Com `core.autocrlf=true` o mesmo commit dá bytes diferentes conforme cada
 * arquivo foi gravado: medido naquela data, a árvore de trabalho tinha 771 arquivos de `src/js` em
 * CRLF, 63 em LF e 77 mistos, e um checkout LIMPO do HEAD dava 11799 kB contra o teto de 11790,
 * enquanto a árvore principal do mesmo commit passava. O guarda media o checkout, não o código.
 */
function kbDe(arquivos) {
    let bytes = 0;
    for (const f of arquivos) {
        bytes += Buffer.byteLength(readFileSync(f, 'utf8').replace(/\r\n/g, '\n'), 'utf8');
    }
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
    // 15 desde 2026-09-07: `ebgeo-file-gate.js`, o leitor do `.ebgeo` e o veredito de versão que
    // saíram de dentro de `export-import.service.js` para que o BOOT possa recusar um arquivo ANTES
    // de gastar um dos dez atlas locais com ele (`deep-link/pending-import.js` o carrega por
    // `await import()`, e portanto não conta aqui). O módulo novo é o único peso: os três imports
    // dele (JSZip, `atlas.entity.js` e `repository.utils.js`) já estavam no grafo ansioso desta
    // página pelo próprio serviço, então subiram 5,7 kB de fonte e nenhum pacote externo novo.
    //
    // 16 desde 2026-09-21, medido pela reprovação deste caso (16 contra 15 com UM arquivo novo):
    // `ebgeo-missing-images.js`, folha de ZERO imports com a lista das imagens que um `.ebgeo` não
    // pode perder calado e a pergunta que o exportador faz quando uma delas não tem arquivo. Saiu de
    // dentro de `export-import.service.js` para ser testável em node, e é ansioso porque o serviço é.
    //
    // 18 em 2026-09-24, fim da caça noturna: `texto-de-arquivo.js` (a decodificação de CSV, DBF, KML
    // e GPX em Windows-1252/ISO-8859-1, que perdia todo acento) e `estilo-importado.js` (o estilo do
    // nosso KMZ de volta na importação, sem lixo de atributo), os dois ansiosos porque o controle de
    // importação é.
    import_export: 18,
    // 16 em 2026-09-21, com as QUATRO folhas puras que a execução da auditoria temporal tirou de
    // dentro de componentes de DOM para que a regra fosse testável em node: `temporal-attributes.model.js`
    // (janela invertida, troca de âncora, GDH derivado), `temporal-bar.model.js` (arraste e teclas da
    // régua), `temporal-playback.model.js` (avanço por fração da janela, última célula, cursor
    // pendente) e `temporal-settings.model.js` (validação da engrenagem e decisão do reagendar).
    // Nenhuma traz pacote externo: os imports delas são `temporal.utils.js`, `temporal-model.js` e
    // `temporal.constants.js`, que já eram ansiosos pelo controlador.
    temporal: 16,
    azimuth_distance_tool: 0,
    processing: 10,
    attribute_table: 10,
    // 10 desde 2026-08-31: `mini-mapa-base.js`, que decide qual mapa base do CATÁLOGO o
    // mini-mapa desenha e em que faixa de zoom. Ele é ansioso porque o construtor do
    // MapLibre precisa do estilo e da faixa na hora, e o peso que ele traz é o do
    // `baselayers/index.js` (os cinco estilos), que a página do mapa já carrega.
    street_view_tool: 10,
    // 10 desde 2026-09-20, com DOIS modulos da vista do slide: `briefing/slide-view.js`, a folha PURA
    // (zero imports, cerca de 4 kB) que decide qual mapa base e qual interruptor temporal um slide
    // mostra, e `briefing/screen-view.js`, a leitura IMPURA da tela do autor, separada justamente
    // para a primeira continuar sem import. As duas sao ansiosas porque o servico de transicao, o
    // editor e a aba de briefings as leem, e os tres ja eram ansiosos.
    // 11 no mesmo dia: `briefing/slide-controls.js`, a lista FECHADA (zero imports) dos controles que
    // um slide mostra ao ser apresentado, lida pelo editor, pelo apresentador e pelo envio ao servidor.
    // 12 em 2026-09-21: `briefing/slide-temporal.js`, folha de zero imports com a regra de captura do
    // instante do slide nos três modos, lida por `screen-view.js` e pelo serviço de transição.
    briefing: 12,
    measurement_tool: 3,
    analysis_tools: 0,
    '3d_models_viewer_tool': 5,
    first_person_3d_tool: 5,
    // 4 desde 2026-09-17: `comment-card.js`, o cartao de comentario com as regras dele (os dois
    // gates, resolver, responder, excluir), extraido do overlay para o 360 e o 3D montarem O MESMO
    // cartao. Ele nao traz peso novo ao grafo ansioso: as dependencias dele (store, sessao, guarda
    // de permissao, cores de presenca) sao as que o proprio overlay ja carregava.
    comment_tool: 4,
    selection_tools: 2,
    // AS DUAS ÚLTIMAS NÃO SÃO PASTA DE FERRAMENTA, e entraram em 2026-09-21 com o lote que tirou
    // do boot do mapa os três diálogos do menu da conta. Elas estão aqui pela mesma definição que
    // trouxe `import_export` e `briefing`: são carga que a página do mapa paga por uma porta que
    // só se abre depois de um clique, e portanto são alvo da mesma onda de `await import()`.
    //
    // `modals`: 20 antes do lote, 14 depois, medidos pelo caminhador com a versão do HEAD ao lado
    // (controle por cópia de arquivo). Os SEIS que saíram são `login.modal.js`,
    // `create-atlas.modal.js`, `sharing.modal.js`, `sharing.modal.core.js`,
    // `login-failure.model.js` (só o login o lê), `link-publico-phrases.js` (só o núcleo de
    // compartilhamento o lê) e `password-recovery.model.js` (idem, o login), menos o lançador
    // novo, que ENTRA: 20 - 7 + 1 = 14. Esta linha é o recibo: um import estático de qualquer um
    // deles voltando a `account/account.control.js` reprova aqui nomeando a cadeia, muito antes de
    // os 66 kB reaparecerem na metade (b), onde eles cabem na folga do teto.
    modals: 14,
    // `account`: 6, e o lote NÃO a moveu. Ela ganha linha porque é a pasta do `IControl` que
    // `map_sig.js` instancia, ou seja, a porta por onde este peso entrou: o painel de pendências
    // (`account/pendencias/`, cinco módulos) já é sob demanda, e um import estático dele passaria
    // despercebido em qualquer outro número deste arquivo.
    account: 6,
    // `catalog`: 16 since 2026-09-23, 18 before, measured by this walker on both sides. The resource
    // share dialog left the boot: `catalog.modal.js` (eager, through the sidebar chips) imported
    // `resource-share.modal.js` statically, which carried `resource-share.modal.core.js` and
    // `grant-tree.js` from this folder (and `admin/group-phrases.js` from outside it). Three left and
    // the door `resource-share-launcher.js` entered: 18 - 3 + 1 = 16. Same reason as the two lines
    // above: the dialog only exists after two clicks, and a static import of it coming back fails
    // here naming the chain.
    catalog: 16
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
    // OS DOIS DO GDAL ENTRARAM EM 2026-09-14, e eles não são a biblioteca: são as duas URLs que o
    // Vite emite para o `.wasm` (28,2 MB) e o `.data` (11,6 MB), pedidas por `?url` no ponto único
    // `src/js/vendor/gdal.js`. O que o payload ansioso paga por elas são duas STRINGS, medidas no
    // `dist/`: 110 bytes dentro do chunk `import-export`, que a página do mapa já baixava. Os
    // arquivos em si continuam sendo buscados só quando alguém exporta um PDF de folha única, e
    // quem os busca é o Emscripten pelo `Module.locateFile`, que recebe estas duas strings.
    //
    // A BIBLIOTECA fica na lista de baixo, e a divisão é o desenho inteiro: se `vendor/gdal.js`
    // importasse `gdal3.js` estaticamente, os 191 kB dela voltariam para cá, porque `map_sig.js`
    // importa `import_export/pdf-export.tab.js` de forma estática. É exatamente a regressão que a
    // onda de 2026-08-25 desfez tirando a `<script>` do `index.html`.
    'gdal3.js/dist/package/gdal3WebAssembly.data?url',
    'gdal3.js/dist/package/gdal3WebAssembly.wasm?url',
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
    // `@turf/turf` ENTROU EM 2026-09-14, e a entrada dele é exatamente o que esta lista existe
    // para vigiar. A biblioteca sempre foi sob demanda, mas por uma tag `<script>` injetada em
    // runtime apontando `public/vendors/turf.min.js`, que este caminhador não enxerga por
    // definição, porque ele anda no grafo de imports. Agora ela vem do npm pelo ponto único
    // `src/js/vendor/turf.js`, alcançado SÓ pelo `import()` de `utilities/turf-loader.js`, então
    // a aresta passou a existir e os dois lados da afirmação passaram a ser verificáveis.
    //
    // O lado "ausente do grafo ansioso" é o que importa aqui, e ele não é decorativo: um import
    // estático do ponto único devolveria 531 kB ao payload do boot e desfaria a onda de
    // 2026-08-25 inteira, sem que o produto parecesse diferente. É o defeito mais fácil de
    // cometer neste lote, e é este caso que o pega.
    '@turf/turf',
    // DESDE 2026-09-14 (V9), quando a distribuição de 14 MB que morava em
    // `frontend/public/vendors/cesium/` foi apagada e a biblioteca passou a vir do npm por
    // `src/js/vendor/cesium.js`. Enquanto era um `<script>` injetado em runtime, nenhuma guarda
    // deste repositório enxergava aqueles bytes: o caminhador anda no grafo de IMPORTS, e uma tag
    // criada por `document.createElement` não é uma aresta. Agora é, e a propriedade que importa
    // passa a ser medida em vez de prometida: o motor (4,97 MB no `dist/`) só é alcançado pelo
    // `import()` de `map_3d.js`, então ele NÃO pode aparecer no grafo ansioso do mapa. Este caso
    // reprova se alguém importar o ponto único de um módulo eager, que é como 4 MB entrariam no
    // boot sem que o teto de kB da metade (b) percebesse (o chunk lazy não é referenciado por
    // HTML nenhum, logo não entra naquela soma).
    'cesium',
    'chart.js',
    // DESDE 2026-09-14, quando a biblioteca deixou de ser `frontend/public/vendors/gdal/gdal3.js`
    // servida por uma tag injetada e passou a vir do npm. A propriedade que se quer preservar é a
    // MESMA que a tag injetada dava (o mapa não paga os 191 kB no boot), e ela agora é medida em
    // vez de prometida em comentário: é este caso que reprova se alguém trocar o `import()` de
    // `src/js/vendor/gdal.js` por um import estático. As duas URLs de asset ficam na lista de
    // cima, e é por isso que elas não contradizem esta linha.
    'gdal3.js',
    'html2canvas',
    'jspdf',
    // `milsymbol` ENTROU EM 2026-09-14 pelo mesmo caminho do `@turf/turf` acima, e pela mesma
    // razão: ele sempre foi sob demanda, mas por uma tag `<script>` injetada em runtime, que este
    // caminhador não enxerga. Agora vem do npm pelo ponto único `src/js/vendor/milsymbol.js`,
    // alcançado só pelo `import()` de `military_symbol_tool/milsymbol-loader.js`.
    'milsymbol',
    'quill',
    // `suncalc` ENTROU EM 2026-09-23 com o painel de luminosidade (dados solares e lunares do
    // PITCIC). Ele é o molde do Turf e NÃO o do WMM: o `geomagnetism` está na lista de cima porque
    // entrou no boot pelo painel de feição sem que nada acusasse, e este caso é o que impede o
    // mesmo caminho aqui. O único leitor é `utilities/luminosidade/efemerides.js`, alcançado só pelo
    // `import()` de `utilities/luminosidade/carregador.js`, cuja porta estática é o menu de contexto.
    'suncalc'
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
        //
        // RECENTRADA DE NOVO EM 2026-09-13, e a leitura honesta da medida é a parte útil desta
        // anotação: 507 módulos e 6880 kB, SOMADOS das duas medições dos blocos do plano de
        // lançamento que nasceram em paralelo (505 e 6864 kB antes deles) e recentraram a banda
        // cada um por si; a próxima rodada com `dist/` é quem mede o valor fundido. Os arquivos
        // que estouraram o teto foram DOIS folhas novos (`store/map-position-clear.js`, 2 kB,
        // achado F1; e `store/sync/quarantine-registry.js`, 14 kB, alcançado pelo caminho do
        // logout), mas eles foram apenas o 506º e o 507º: entre 2026-09-02 e hoje o grafo saiu
        // de 467 para 505 módulos e de 6369 para 6864 kB, isto é, a folga inteira já tinha sido
        // gasta por deriva que ninguém remediu, e a banda estava reprovando o PRÓXIMO arquivo,
        // qualquer que fosse ele, pela terceira vez seguida. Se a próxima recentragem vier outra
        // vez de deriva não atribuída, o conserto não é o número: é medir a deriva.
        //
        // RECENTRADA EM 2026-09-20, e desta vez a deriva FOI medida, dos dois lados e pelo mesmo
        // caminhador: 526 módulos e 7408 kB no HEAD limpo (`cd99fb20`, num `git worktree`
        // descartável), 529 e 7437 kB com os quatro lotes do dia. A parte do dia é +3 módulos e
        // +29 kB, e ela tem dono: `context-menu/qan-menu-gate.js` (o portão do "Exportar QAN"),
        // `utilities/person-label.js` (o rótulo militar da tela de compartilhamento) e
        // `utilities/image-limit-phrases.js` (as frases de recusa de imagem), três folhas de zero
        // imports, mais o crescimento de `utilities/image_utils.js` e de `account.control.js`.
        // O que NÃO tem dono é o resto: de 6880 kB em 2026-09-13 a 7408 kB no HEAD são 528 kB em
        // seis dias, entrados pelos commits do plano de lançamento sem que ninguém remedisse, e o
        // HEAD já estava a 22 kB do teto. É a quarta vez que a banda reprova o PRÓXIMO arquivo em
        // vez de uma pasta voltando. A banda nova é de ~8% em torno de 529 e 7437.
        //
        // 2026-09-21: a medida CAIU e a banda NÃO se mexeu, de propósito. O lote dos três diálogos
        // do menu da conta levou o grafo ansioso de 548 módulos / 7867 kB para 539 / 7647, medido
        // dos dois lados com a versão do HEAD ao lado por CÓPIA DE ARQUIVO. Recentrar em ~8% sobre
        // 7647 daria teto perto de 8260, isto é, SUBIRIA o teto em cima de um ganho, que é o
        // oposto do que este número serve para fazer. Quem passou a guardar este ganho com
        // exatidão são as duas linhas novas do ORCAMENTO por pasta (`modals` e `account`),
        // fechadas nos dois sentidos. O que sobra aqui é a leitura honesta: o teto de 8030 ficou
        // com 383 kB de folga, e quem remedir a deriva de fundo é que o desce.
        expect(ansioso.arquivos.size).toBeGreaterThanOrEqual(487);
        expect(ansioso.arquivos.size).toBeLessThanOrEqual(571);
        const kb = kbDe(ansioso.arquivos);
        expect(kb, `fonte ansiosa em ${kb} kB`).toBeGreaterThanOrEqual(6840);
        expect(kb, `fonte ansiosa em ${kb} kB`).toBeLessThanOrEqual(8030);
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
        //
        // O TETO SUBIU DE 11600 PARA 11700 EM 2026-09-13, e de propósito NÃO foi recentrado. O lote
        // é o painel de pendências (B5 item 5, cinco arquivos sob `account/pendencias/`, 74 kB de
        // fonte nova, alcançados por `import()` no clique do crachá de sync). Medido nesta árvore,
        // trocando o `import()` do painel por um vizinho já no grafo: 11535 kB SEM o lote e 11609
        // kB COM ele, ou seja, a deriva desde 2026-09-03 já tinha comido 795 dos 860 kB de folga e
        // o teto velho estava a 65 kB de vencer por conta própria. Recentrar em ±8% sobre 11609
        // daria teto perto de 12500 e compraria 900 kB de deriva futura silenciosa, que é o oposto
        // do que este número serve para fazer; 11700 deixa 91 kB, o que obriga o próximo lote a
        // olhar para cá. O PISO fica onde está: ele guarda o caminhador quebrado, e 9880 continua
        // acusando um grafo que desabou.
        //
        // O TETO SUBIU DE 11700 PARA 11760 AINDA EM 2026-09-13, e o parágrafo acima funcionou
        // exatamente como devia: o lote seguinte (bloco B5, conflitos) bateu aqui e teve de medir.
        // MEDIDO nesta árvore, com e sem o lote: 11678 kB SEM ele e 11705 kB COM ele, ou seja,
        // 27 kB de fonte nova em TRÊS folhas de zero imports
        // (`account/pendencias/comparacao-de-conflito.js` e `comparacao-phrases.js`, alcançados
        // pelo `import()` do painel, e `store/map-revision.js`, que entra no grafo ANSIOSO por
        // `store/map.operations.js`). Repare no que os dois números dizem juntos e nenhum diz
        // sozinho: dos 91 kB de folga deixados horas antes, 69 já tinham sido comidos por deriva
        // de outros lotes do MESMO dia, e o lote que reprovou responde por 27. 11760 deixa 55 kB,
        // de novo pouco de propósito.
        //
        // O TETO SUBIU DE 11760 PARA 11790 EM 2026-09-14, E ESTA SUBIDA NÃO É DERIVA NEM PAYLOAD
        // NOVO: é a medição ficando honesta. O lote é a adoção de `cesium-measure.js` (decisão D9,
        // item V2), que saiu de `frontend/public/vendors/cesium/` e virou
        // `src/js/3d_models_viewer_tool/services/cesium-measure.js`. Aqueles bytes SEMPRE foram
        // baixados pelo visualizador 3D; eles chegavam por uma tag `<script>` injetada em runtime,
        // que este caminhador não enxerga por definição, porque ele anda no grafo de imports. O que
        // mudou é que agora eles são visíveis, e o que a pessoa baixa continua o mesmo (na prática
        // um pouco menos: as 5,8 kB de cabeçalho novo são comentário e o build as remove, e o
        // pedido HTTP separado deixou de existir).
        //
        // MEDIDO nesta árvore, trocando o import por um comentário: 11733 kB SEM o lote e 11767 kB
        // COM ele, 34 kB de diferença. Os dois números dizem juntos o que nenhum diz sozinho: dos
        // 55 kB de folga deixados em 2026-09-13, 28 já tinham sido comidos por deriva de outros
        // lotes, sobrando 27 para um lote que precisava de 34. 11790 deixa 23 kB, e a disciplina
        // segue a mesma: pouco de propósito, para que o próximo lote tenha de medir em vez de
        // empurrar o número.
        //
        // O TETO DE CONTAGEM SUBIU DE 700 PARA 708 EM 2026-09-14, E ELE É O ÚNICO DOS DOIS QUE
        // ESTES LOTES TOCAM. São DUAS migrações que chegaram por linhas de trabalho paralelas e se
        // encontraram aqui, e cada uma acrescenta ao grafo DOIS folhas de `src/js/vendor/`:
        //
        //   - o Cesium vindo do npm (V9): `cesium.js` (7,5 kB) e `cesium-base-url.js` (2,9 kB),
        //     alcançados pelo `import()` de `map_3d.js`. Medido na linha dela: 701 módulos com o
        //     lote, contra 699 sem;
        //   - o Turf e o milsymbol vindo do npm: `turf.js` e `milsymbol.js`, alcançados pelo
        //     `import()` dos respectivos carregadores. Medido na linha deles, na mesma base: 699
        //     módulos / 10500 kB SEM o lote e 701 / 10509 COM ele.
        //
        // Os números dizem juntos o que nenhum diz sozinho: dos 700 do teto velho, 699 já estavam
        // gastos por deriva anterior, e cada lote responde por 2. Somados sobre a MESMA base, os
        // quatro módulos põem a árvore fundida em 703, que é o número medido aqui depois da fusão
        // e não a soma no papel. 708 deixa cinco de folga, pouco de propósito, como as subidas
        // anteriores.
        //
        // NENHUM DOS DOIS É PAYLOAD NOVO: os quatro módulos SUBSTITUEM bundles de
        // `public/vendors/` que este caminhador nunca enxergou, porque eles chegavam por tag
        // `<script>` injetada em runtime e ele anda no grafo de imports. O que a pessoa baixa
        // diminuiu (o Turf entra 109 kB menor que o UMD que saiu; o milsymbol empata; o motor do
        // Cesium viaja num chunk lazy que nenhum HTML referencia). É a mesma correção de
        // instrumento que a adoção do `cesium-measure.js` trouxe ao teto de kB, agora na contagem.
        //
        // E O TETO DE kB NÃO SUBIU: ele SOBRA, e o que sobra é deriva não atribuída na direção
        // contrária, que é a que ninguém percebe. Medido hoje: 10507 kB, 1283 ABAIXO do teto de
        // 11790, escrito horas antes com uma medida de 11767. O que saiu do grafo entre as duas
        // medições é o snapshot do Three.js: `frontend/src/vendor/three/three.module.js` sozinho
        // passava de 1,2 MB e deixou de ser alcançado quando a biblioteca passou a vir do npm
        // (commits `d5b26384` e `4ae81c3f`), sem que ninguém descesse este número no mesmo commit.
        // NÃO o desci aqui, e a razão é a mesma que mantém os pisos da metade (b) parados: estas
        // medidas saíram de árvores que carregavam lotes de outras sessões, então elas são a soma
        // de dois trabalhos e não a medida de nenhum. Quem remedir sozinho desce o teto para perto
        // de 10600 e o guarda volta a guardar; até lá ele está frouxo em 1,2 MB, e é melhor que
        // isso esteja escrito do que descoberto.
        // 710 desde 2026-09-17, e os dois arquivos novos sao nomeados:
        // `3d_models_viewer_tool/tools/comments-3d.js`, a camada de comentarios do modelo, e
        // `street_view_tool/comments-360.js`, a
        // camada de comentarios do panorama, alcancada por `import()` a partir do visualizador. Ele
        // nao entra no grafo ANSIOSO (a metade (b) deste arquivo continua contando 10 na pasta), e
        // o peso que ele traz ja estava no grafo completo: `comment_tool/comment-card.js` e o store
        // sao alcancados pelo overlay do 2D desde antes.
        expect(completo.arquivos.size).toBeGreaterThanOrEqual(580);
        // 2026-09-19: 711 módulos com snapshot-frontier.js (menos de 1 kB), que impede
        // um retrato HTTP antigo de apagar confirmações/edições recebidas pelo socket.
        // One shared image-context module fences asynchronous image writes/renders.
        // One lazy builder prepares complete imports without mounting their namespace.
        // Two lazy modules implement additive preparation and resumable server import.
        // One lazy layer adds first-person comments and walker presence.
        // 2026-09-19: 717 com `import_export/svg-to-png.js` (cerca de 6 kB), que rasteriza o
        // ícone personalizado em SVG na preparação do envio, para que um atlas que tenha um deles
        // volte a ter caminho para o servidor. Ele entra SÓ por `import()`, de dentro de
        // `buildImageUploads`: a metade (b) deste arquivo continua contando 15 módulos ansiosos em
        // `import_export`, que é o outro lado desta mesma linha.
        // 2026-09-20: 720, e a medida tem os dois lados. O HEAD limpo (`cd99fb20`) deu 717; os
        // três módulos novos do dia são folhas de ZERO imports e ANSIOSAS, cada uma medida por
        // controle pela sessão que a escreveu: `context-menu/qan-menu-gate.js` (o portão puro do
        // "Exportar QAN" no clique direito, que saiu de dentro de `context-menu.control.js`),
        // `utilities/person-label.js` (o compositor do rótulo militar, "Cap Silva · 1º CGEO", que
        // chega pelo barril `@modals`) e `utilities/image-limit-phrases.js` (as frases de recusa
        // de imagem, lidas por `utilities/image_utils.js`, que já era ansioso). Três sessões
        // escreveram aqui em paralelo e deixaram o número RED de propósito, para que nenhuma
        // absorvesse o lote da outra; esta linha é a recentragem única que elas pediram.
        //
        // 2026-09-20, segundo lote do dia: 724, medido pelo mesmo caminhador (533 módulos e
        // 7498 kB ansiosos, 724 e 10936 kB no completo). Os quatro módulos novos são de `ui/` e
        // entram por `modals/signup.modal.js`, que já era ansioso pelo barril `@modals`:
        // `searchable-select.js` e `searchable-select.model.js` (o combo buscável da OM no
        // cadastro), `password-visibility.js` (o olho, que `modals/login.modal.js` também usa) e
        // `password-match.model.js` (o veredicto ao vivo da confirmação). A sessão que os
        // escreveu mediu por controle, trocando o modal pela versão do HEAD: 720 sem eles.
        //
        // O CADASTRO PASSOU A ENTRAR POR `import()` NO MESMO DIA, por autorização do dono, depois
        // de ter sido avaliado e recusado aqui de manhã. O que a recusa dizia continua verdadeiro e
        // é o que dimensiona o ganho: o modal mais os três módulos que só ele usa (o olho fica,
        // porque o login também o usa) são 52 kB de FONTE, quase todo comentário, 19,6 kB
        // minificados e 6,7 kB em gzip. Contagem de módulo é procuração de peso, e aqui ela
        // exagera. O preço previsto também se confirmou, e foi maior: o caminho de falha do clique
        // de "Criar conta" NÃO PODE oferecer "tente de novo", porque um `import()` que falha fica
        // gravado como falho no mapa de módulos da página (medido no Chromium e no Firefox), então
        // a saída é recarregar. Ver `modals/signup-launcher.js`.
        //
        // 2026-09-20, terceiro lote do dia: 725 com `utilities/quill-image-paste.model.js`
        // (cerca de 6 kB), a folha pura das portas de colagem de imagem do editor Quill. A sessão
        // que a escreveu mediu por controle: comentada a aresta em `utilities/quill-helpers.js`,
        // 724; reposta, 725. O lote de nomes do mesmo dia acrescentou ZERO módulos, também por
        // controle: `utilities/person-label.js` já estava no grafo pelo modal de compartilhamento.
        //
        // 2026-09-20, quarto lote do dia: 726 com `modals/signup-launcher.js`, a folha que carrega
        // o cadastro sob demanda. O grafo COMPLETO ganha um módulo; o ANSIOSO perde quatro e ganha
        // um (534 -> 531 módulos, 7547 -> 7508 kB), medido por controle pela sessão que o escreveu.
        //
        // 2026-09-20, quinto lote do dia: 728, com os DOIS módulos da faixa do tablet. Medido por
        // controle, e os dois entram por arestas diferentes: comentada a aresta de
        // `map/tablet-panel-push.js` em `map_sig.js`, 727; comentada ela E a de
        // `utilities/tablet-mode.js`, que entra pelo `phone-layout.js` (o corte de telefone passou
        // a morar lá, para a faixa do tablet ser derivada dele em vez de escrita de novo), 726.
        // Cada módulo vale exatamente um, e nenhum dos dois é pesado: juntos somam menos de 6 kB
        // de fonte, porque os dois são folha e um deles não tem import nenhum.
        //
        // 2026-09-20, sexto lote do dia: 731, com os TRÊS módulos da vista da pessoa. Medido pela
        // reprovação deste próprio caso, em dois passos: 730 contra 728 com dois arquivos novos no
        // grafo, `store/map-view.operations.js` (o gesto composto de salvar a vista do mapa, que
        // entra pela fachada da store) e `briefing/slide-view.js` (folha de zero imports); e 731
        // contra 730 quando entrou `briefing/screen-view.js`, a leitura da tela do autor. Os dois de
        // `briefing` o orçamento da pasta acima conta também. Nenhum é pesado: os três somam menos
        // de 11 kB de fonte.
        //
        // 2026-09-20, sétimo lote do dia: 732, com `briefing/slide-controls.js` (folha de zero imports,
        // cerca de 4 kB), medido do mesmo jeito: este caso acusou 732 contra 731 com um arquivo novo.
        //
        // 2026-09-20, oitavo lote do dia: 733, com `map/undo-redo.runner.js`, para onde a regra de
        // desfazer e refazer mudou de casa quando a barra de ferramentas ganhou os dois botões (até
        // então a única porta era o Ctrl+Z, o que num tablet é porta nenhuma). Medido pela reprovação
        // deste próprio caso, 733 contra 732 com um arquivo novo. Ele entra por DUAS arestas
        // estáticas (`keyboard/keyboard-shortcuts.js` e `toolbar/toolbar.control.js`) e mesmo assim
        // vale UM, porque o grafo é um conjunto; e os quatro módulos que ele importa já estavam no
        // grafo pelo teclado, que é de onde a regra saiu. O ANSIOSO não se mexeu o bastante para
        // sair da banda dele, que tem folga.
        //
        // 2026-09-20, nono lote do dia: 735, com os DOIS folhas de toque do visualizador 3D,
        // `3d_models_viewer_tool/services/pick-de-alvo.js` (a folga do retângulo de `scene.pick`,
        // que era de três pixels para o dedo também) e `services/orcamento-de-memoria.js` (o teto
        // de `cacheBytes` de um tileset, que era um gigabyte em toda máquina). Medido por
        // controle: comentada a aresta do segundo em `map_3d.js`, este caso acusou 734 contra os
        // 735 da árvore inteira, ou seja, cada um vale exatamente um. Os dois são folha, um deles
        // de zero imports, e entram pelo grafo LAZY do Cesium, não pelo ansioso.
        //
        // 2026-09-20, décimo lote do dia: 736, com `first_person_3d_tool/walk/touch-stick.js`, o
        // manche de toque. Ele é a única forma de ANDAR na cena caminhável num tablet, onde WASD,
        // as setas, `Space` e `Shift` não existem, e vale UM módulo porque importa apenas a
        // limpeza de recurso, que já estava no grafo. Medido pela reprovação deste caso, 736
        // contra 735 com um arquivo novo.
        //
        // 2026-09-20, décimo primeiro lote: 737, com
        // `first_person_3d_tool/progresso-de-carga.js`, a conta que traduz bytes em fração e em
        // frase para a tela de carga da cena caminhável (a barra dela era um `@keyframes` de dois
        // segundos que terminava cheia com 18 MB ainda por vir). Folha de ZERO imports, medida
        // pela reprovação deste caso: 737 contra 736 com um arquivo novo.
        //
        // 2026-09-20, décimo segundo lote: 739, com DOIS folhas do gerente de seleção, medidos pela
        // reprovação deste caso (739 contra 737 com dois arquivos novos). `tool_manager/edit-surface.js`
        // é o predicado que deixa a superfície inerte para quem não pode editar, como a trava do mapa
        // já deixava (o visitante de link público ganhava alça e arrastava feição);
        // `tool_manager/click-after-drag.js`, de zero imports, devolve a regra de que o clique que
        // encerra um arrasto não é clique, perdida quando o arrasto de alça virou de ponteiro. Os
        // dois módulos da faixa de visita, removidos no mesmo lote, NÃO descontam daqui: entravam
        // por `index.js`, e este grafo parte de `map_sig.js`.
        //
        // 2026-09-21, décimo terceiro lote: 746, medido pela reprovação deste caso (746 contra 739 com
        // SETE arquivos novos), todos folhas puras nascidas da execução da auditoria temporal: as
        // quatro de `temporal/` e a de `briefing/` que o orçamento por pasta acima nomeia, mais
        // `tool_manager/helpers/point-conversion.model.js` (o bloco de propriedades que a conversão de
        // ponto preserva, janela e trajetória inclusive) e `import_export/kmz/kml-time.js` (o
        // TimeSpan do KML, que só entra seguindo `import()`).
        //
        // 2026-09-21, décimo quarto lote: 747, medido pela reprovação deste caso (747 contra 746 com UM
        // arquivo novo): `features_tab/layer-transfer-phrases.js`, folha de zero imports com a frase do
        // desfecho de uma transferência de camada, que saiu de dentro da aba de feições para dizer os
        // três desfechos da origem e ser testável em node. No mesmo dia entrou `store/mapa-inexistente.js`
        // e saiu `sidebar/tabs/remote-map-redirect.js`, um pelo outro, e por isso o 746 não se mexeu ali.
        //
        // 2026-09-21, décimo quinto lote: 748, medido pela reprovação deste caso (748 contra 747 com UM
        // arquivo novo): `import_export/ebgeo-missing-images.js`, a folha descrita no orçamento de
        // `import_export` acima.
        //
        // 2026-09-21, décimo sexto lote: 749, com `modals/account-modals-launcher.js`, a folha que
        // carrega sob demanda os TRÊS diálogos do menu da conta (login, "novo atlas" e
        // compartilhar). Medido pela reprovação deste próprio caso (749 contra 748 com um arquivo
        // novo). O grafo COMPLETO ganha um módulo, e o ANSIOSO perde NOVE, que é o outro lado do
        // mesmo commit: 548 módulos / 7867 kB de fonte antes, 539 / 7647 depois, medidos pelo mesmo
        // caminhador com a versão do HEAD ao lado por CÓPIA DE ARQUIVO. Os dez que saíram do
        // ansioso são `modals/login.modal.js`, `modals/create-atlas.modal.js`,
        // `modals/sharing.modal.js`, `modals/sharing.modal.core.js`, `modals/login-failure.model.js`,
        // `modals/link-publico-phrases.js`, `modals/password-recovery.model.js`,
        // `presence/sharing-presence.source.js`, `ui/password-visibility.js` e
        // `utilities/request-failure.js`.
        //
        // 2026-09-22, décimo sétimo lote: 750, com `first_person_3d_tool/splat-parse-timeout.js`, o
        // teto de tempo sobre `SplatLoader.parseSplatData` (o motor de splatting só decide a
        // promessa dele por MENSAGEM de worker, então um worker que não carrega pendura a cena para
        // sempre, calado). Medido pela reprovação deste próprio caso (750 contra 749 com um arquivo
        // novo). Ele NÃO mexe no grafo ANSIOSO, e isso foi conferido pelo verde do caso irmão na
        // mesma rodada: quem o importa é `first_person_viewer.js`, que só é alcançado por
        // `import()`, então a folha cai no grupo lazy `first-person-3d` junto com ele.
        //
        // 2026-09-22, décimo oitavo lote: +1, com `catalog/resource-share.modal.core.js`. O modal de
        // compartilhar recurso foi PARTIDO em núcleo sem store e entrada do mapa (item 19b do dono,
        // para caber em `admin.html`), no molde de `modals/sharing.modal.core.js`; o mapa passa a
        // alcançar os dois arquivos onde alcançava um, e a fonte cresce só a entrada (uns 3 kB). A
        // folha nova do painel (`admin/shareable-resources.js`) não entra aqui: só `admin.html` a
        // alcança. A medida do dia, pelo mesmo caminhador e com o trabalho de outras sessões em
        // voo na mesma árvore, deu 759: os outros oito não são deste lote.
        //
        // 2026-09-22, décimo nono lote: +1, com `map/tile-expiry-guard.js`, folha de ZERO imports que
        // impede o MapLibre de pedir de novo, a cada ida e volta, o tile vetorial que foi servido e
        // depois recusado (o laço de 404 do stack de teste em 2026-09-21). É ANSIOSO de propósito:
        // `map_sig.js` e o minimapa do 360 o instalam antes do primeiro tile. Não medido por este
        // caminhador (a sessão não rodou testes); a conta é uma aresta nova para um arquivo novo.
        //
        // 2026-09-22, MEDIDO no fim do dia, com a árvore inteira do dia e os arquivos novos postos no
        // índice (este caminhador não vê arquivo fora do `git ls-files` dos censos, mas vê o disco):
        // 764, ou seja +14 sobre os 750 do commit anterior, e o teto sobe para 764 por decisão do dono.
        // A conta fecha sem resto: 15 módulos novos menos `context-menu/qan-menu-gate.js`, apagado
        // quando o QAN saiu do menu de botão direito. Os 15, por item do dia: o núcleo do modal de
        // recurso (acima), `map/tile-expiry-guard.js` (acima), `utilities/carga-sob-demanda.js` e
        // `utilities/carga-sob-demanda.model.js` (chunk que não chega), `store/vista-da-pessoa.js` e
        // `store/vista-da-pessoa-disco.js` (mapa base e temporal lembrados por mapa),
        // `3d_models_viewer_tool/services/viewshed-preview.js` (preview do viewshed),
        // `3d_models_viewer_tool/services/viewer-teardown.js` (desmontagem do 3D com um dono por
        // objeto), `sidebar/components/feature-name-commit.model.js` e
        // `sidebar/panels/feature-panel-flush.js` (nome da feição no Enter), e as folhas de decisão
        // `snapping/snap-availability.js`, `sidebar/components/photo-gallery-affordance.js`,
        // `baselayers/glyphs-template.js`, `catalog/endereco-da-miniatura.js` e
        // `presence/viewer-label.js`. Quase todas são folhas puras, que existem para a regra ser
        // testável em node; juntá-las para caber no teto antigo trocaria teste por número.
        // Engineering adds nine lazy modules; the eager military budget stays zero.
        // One shared finalization context replaces repeated drawing race guards.
        // Brush is already eager, so this small helper joins its existing graph; byte budgets stay unchanged.
        //
        // 2026-09-23: 775, with `session/ambiente-do-navegador.js`, the zero-import leaf that holds
        // the one User-Agent parser and the environment collector of the error report. Measured by
        // this case's own failure (775 against 774, with no other new source file in the tree). It
        // enters wherever the capturer (`session/erro-telemetria.js`) enters, by a static import,
        // because the report is built synchronously inside the error handler. The eager case stayed
        // green inside its budget in the same run.
        //
        // 2026-09-23: 776, with `baselayers/default-basemap.js`, the leaf (one import, `config.js`)
        // that reads the default basemap the administrator picks in the "Sistema" tab. It is
        // EAGER on purpose: the map is born with it (`initialBaseLayer`, `map_sig.js`) and the
        // blank map document reads it (`store/repository.utils.js`), and it is a separate file so
        // the store does not reach the base-layer control. Measured by this case's own failure
        // (776 against 775) with a copy of this walker, which also showed the only other new
        // source file in the tree that day (`store/migration/abrir-recuperado.js`) outside the
        // graph. Source total 11540 kB, inside the ceiling below.
        //
        // 2026-09-23: 785, with the NINE modules of the PITCIC light panel (dados solares e lunares),
        // measured by this case's own failure (785 against 776, no other new source file in the
        // tree). TWO are eager and small, the door the context menu reaches statically:
        // `utilities/luminosidade/carregador.js` (the on-demand loader) and
        // `utilities/luminosidade/luminosidade-phrases.js` (a zero-import leaf, for the menu label).
        // SEVEN arrive only by the loader's `import()`: the public door `index.js`, the adapter
        // `efemerides.js`, the pure leaves `matriz-pitcic.model.js`, `hora-brasilia.js` and
        // `quadro-pitcic.js`, the panel, and the single entry of the package, `vendor/suncalc.js`.
        // Together they are 81.1 kB of source, and the source ceiling below moved from 11560 to 11650
        // for them: 11625 kB measured, 11541 without them, which is the 11540 of the paragraph above.
        // The PACKAGE is not in these kB (the walker counts the tree's own files), and its static
        // absence from the boot graph is what `EXTERNOS_SO_DINAMICOS` holds.
        //
        // 2026-09-23 (later the same day): 794, with the PITCIC weather panel and the shell the two
        // point panels now share, measured by this case's own failure (794 against 785). Nine new
        // source files: the shell (`utilities/painel-de-ponto/painel-de-ponto.js` and its phrase
        // leaf) and seven of `utilities/meteorologia/`. TWO of those are eager and small, the door the
        // context menu reaches statically: `meteorologia/carregador.js` (the loader, which also
        // answers whether the deployment offers the panel) and `meteorologia/meteorologia-phrases.js`
        // (a zero-import leaf, for the menu label). The rest arrive only by `import()`.
        // `hora-brasilia.js` MOVED out of the light module to `utilities/` and is not new.
        //
        // 2026-09-23 (night): 795, with `store/analysis-output.js`, the one-import leaf (the type
        // registry) that derives the output of the line of sight and of the viewshed. It is EAGER on
        // purpose: the inbound path and the snapshot (`store/sync/remote-operation-handler.js`) and
        // the dispatcher reach it statically, because a peer derives the output the moment the input
        // arrives. Measured by this case's own failure (795 against 794, no other new source file).
        // The same night, the two phrase leaves named above as eager LEFT the boot: they are each
        // panel's whole text, and the menu read one string from each. The label moved into each
        // loader; the count here does not move (same files), the eager graph loses the two leaves,
        // and the case "the TEXT of the two point panels" below pins it.
        //
        // 2026-09-23 (night): 796, with `catalog/resource-share-launcher.js`, the on-demand door of the
        // resource share dialog, which left the map's boot (see the `catalog` line of ORCAMENTO and
        // the case "the resource share dialog" below). One new file; nothing else moved in this graph.
        // 2026-09-23 (night): 795, with `projects/server-send-phrases.js`, measured by this case's
        // own failure (795 against 794). The account menu's "Salvar no servidor" now says what the
        // server pruned, with the same sentences as the `atlas.html` card; the leaf (7 kB, ZERO
        // imports) was split out of `projects/local-atlas-notices.js` precisely so the map does
        // not carry the chooser's 35 kB notice module to say them. Eager, one small file.
        // 2026-09-24 (end of the night's bug hunt): 801, re-measured once for the whole lot instead
        // of branch by branch (ten branches bumping one number were a conflict at every merge).
        // The four files past the ones named above, all bug fixes: `import_export/texto-de-arquivo.js`
        // (encoding of imported text), `import_export/estilo-importado.js` (our KMZ's own style on
        // the way back), `tool_manager/helpers/discard-targets.helpers.js` ("Descartar" keeps a
        // colleague's later edit) and `vendor/shpjs.js` (the toReversed polyfill's single door).
        expect(completo.arquivos.size).toBeLessThanOrEqual(801);
        const creationContext = 'src/js/tool_manager/helpers/feature-creation-context.js';
        expect([...completo.arquivos].some(f => f.endsWith(creationContext))).toBe(true);
        expect([...ansioso.arquivos].some(f => f.endsWith(creationContext))).toBe(true);
        // O TETO DESCEU DE 11790 PARA 11560 EM 2026-09-23, e a descida é do INSTRUMENTO, não do
        // código: `kbDe` passou a contar o conteúdo com fim de linha normalizado (ver o JSDoc dele).
        // Medido na árvore daquele dia: 11798 kB pela régua velha e 11534 pela nova, 264 kB de
        // quebras de linha. Os lotes do dia (a abertura que falha não apaga a fila, a marca de
        // descarte que sobrevivia à saída e o lote de uso de outra conta) somam no máximo 16,6 kB
        // normalizados em 16 arquivos, então o HEAD anterior media cerca de 11518. Deixar o teto em
        // 11790 daria 256 kB de folga, e um teto frouxo não guarda nada; 11560 deixa 26 kB, pouco de
        // propósito, como as subidas anteriores.
        const kb = kbDe(completo.arquivos);
        expect(kb, `fonte total em ${kb} kB`).toBeGreaterThanOrEqual(9880);
        // 11650 -> 11710 on 2026-09-23 for the weather panel and the shared point-panel shell:
        // 11685 kB measured by this case's failure, 60 kB over the light panel's 11625 of the same
        // day (the shell moved code out of the light panel, so its growth is less than the new files).
        // 11710 -> 11730 on 2026-09-23 (night, branch hunt/collab-briefing): three sync fixes with
        // no new module, only code in eager files: the briefing editor's three-way merge
        // (`store/briefing.operations.js`, `briefing/editor/briefing-editor.control.js`), undo that
        // keeps a peer's later edit (`keepLaterEdits`, `store/feature.operations.js`) and the per-slide
        // inbound apply (`store/sync/remote-operation-handler.js`). 11713 kB measured by this case's
        // failure, about 24 kB of source over the three commits, half of it comments.
        // 11730 -> 11930 on 2026-09-24, at the end of the night's bug hunt: 11897 kB measured once for the

        // whole integrated lot (ten branches), about 170 kB of source over the 11730 of the evening, spread

        // over some ninety fixes and the comments that say why each one exists; the four new eager files are

        // named in the module count above, and the lazy side gained no package. Headroom of about 30 kB.

        // 11930 -> 11960 on 2026-09-24 for the owner's decision B6.1 (split the same verb over
        // independent features above LOTE_MAX_OPS): 11941 kB measured by this case's failure, 11 kB
        // over the ceiling, all of it in files already eager (`store/sync/operation-factory.js`,
        // `store/sync/gesture-batch.js`, `store/store-state-manager.js`, `store/sync/sync-engine.js`),
        // no new module and no new package. The rule was kept in existing files on purpose: a new
        // leaf module also crossed the module-count ceilings when it was tried.
        expect(kb, `fonte total em ${kb} kB`).toBeLessThanOrEqual(11960);
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

    it('o cadastro entra só por `import()`, e os três módulos que só ele usa vão junto', () => {
        // A lista acima é de PACOTES externos; o cadastro é módulo da casa, e sem este caso o
        // import estático voltaria no commit seguinte com só 16 kB de peso construído para acusar,
        // bem dentro da folga do teto. Os DOIS lados, pela mesma razão dos pacotes: ausente do
        // grafo ansioso e PRESENTE no completo, senão um caminhador cego passaria verde.
        const soDoCadastro = [
            'src/js/modals/signup.modal.js',
            'src/js/ui/searchable-select.js',
            'src/js/ui/searchable-select.model.js',
            'src/js/ui/password-match.model.js',
        ];
        const tem = (grafo, sufixo) => [...grafo.arquivos]
            .some((f) => f.replace(/\\/g, '/').endsWith(sufixo));
        for (const modulo of soDoCadastro) {
            expect(tem(ansioso, modulo), `${modulo} voltou para o payload ansioso do mapa`).toBe(false);
            expect(tem(completo, modulo), `${modulo} sumiu do grafo: a afirmação virou vazia`).toBe(true);
        }
        // O carregador, esse sim, é ansioso, e é ele que guarda a aresta dinâmica.
        expect(tem(ansioso, 'src/js/modals/signup-launcher.js')).toBe(true);
        // O OLHO DEIXOU DE FICAR EM 2026-09-21, e a troca de lado é consequência e não descuido.
        // A linha anterior dizia "E o olho FICA: o diálogo de login também o usa", e era verdade
        // enquanto `modals/login.modal.js` era import ESTÁTICO de `account/account.control.js`.
        // No dia em que o login passou a ser buscado no clique (ver o caso dos três diálogos
        // abaixo), os DOIS únicos consumidores de `ui/password-visibility.js` no grafo do mapa
        // ficaram sob `import()`, e o olho saiu junto. Ele continua ANSIOSO em `atlas.html`, que
        // importa o login de forma estática, e isso não é medido aqui: este arquivo mede o mapa.
        expect(tem(ansioso, 'src/js/ui/password-visibility.js')).toBe(false);
        expect(tem(completo, 'src/js/ui/password-visibility.js')).toBe(true);
    });

    it('os TRÊS diálogos do menu da conta entram só por `import()`', () => {
        // O lote de 2026-09-21. `account/account.control.js` é um `IControl` que `map_sig.js`
        // instancia, então todo import estático dele viaja no BOOT do mapa; três dos seus imports
        // eram telas que só existem depois de um clique E só fazem sentido com servidor. Elas
        // passaram a ser buscadas no clique, por `modals/account-modals-launcher.js`.
        //
        // OS DOIS LADOS, pela mesma razão do cadastro acima: ausentes do grafo ansioso e
        // PRESENTES no completo. Só o primeiro lado seria satisfeito por um caminhador cego.
        //
        // O QUE ESTE CASO MEDE E O TETO DE kB NÃO MEDIRIA: `modals/login.modal.js` e
        // `modals/create-atlas.modal.js` continuam imports ESTÁTICOS de `projects/projects-page.js`
        // e de `projects/atlas-drive.js`, de propósito, porque `atlas.html` é outra entrada e lá o
        // formulário de login é a primeira coisa que o visitante vê. Medido no `dist/` daquele
        // build: os chunks deles seguem referenciados por `atlas.html` e saíram de `index.html`.
        const sobDemanda = [
            'src/js/modals/login.modal.js',
            'src/js/modals/create-atlas.modal.js',
            'src/js/modals/sharing.modal.js',
            'src/js/modals/sharing.modal.core.js',
            // Ela só é importada por `modals/sharing.modal.js`, então acompanha o vizinho. É o
            // módulo que liga a presença viva, e o cabeçalho dele avisa que só o mapa o alcança.
            'src/js/presence/sharing-presence.source.js',
        ];
        const tem = (grafo, sufixo) => [...grafo.arquivos]
            .some((f) => f.replace(/\\/g, '/').endsWith(sufixo));
        for (const modulo of sobDemanda) {
            expect(tem(ansioso, modulo), `${modulo} voltou para o payload ansioso do mapa`)
                .toBe(false);
            expect(tem(completo, modulo), `${modulo} sumiu do grafo: a afirmação virou vazia`)
                .toBe(true);
        }
        // O lançador é ansioso, e é ele que guarda as três arestas dinâmicas. Sem esta linha, um
        // arquivo apagado deixaria as cinco afirmações acima verdes e vazias.
        expect(tem(ansioso, 'src/js/modals/account-modals-launcher.js')).toBe(true);
    });

    it('the TEXT of the two point panels arrives only by `import()`; the menu carries its label only', () => {
        // The 2026-09-23 lots (light panel, then weather panel) imported each panel's WHOLE phrase
        // leaf into `context-menu/context-menu.control.js` to read ONE string, the menu label, and
        // that put every sentence of both panels in the map's boot. Measured with fresh builds and
        // the ruler of half (b): 4292069 bytes with the two leaves eager, and the label moved into
        // each loader (the module's eager door, already imported by the menu) took them out. The
        // labels now live in `utilities/luminosidade/carregador.js` and
        // `utilities/meteorologia/carregador.js`; the leaves are read only by the lazy panels.
        //
        // BOTH SIDES, for the same reason as the dialogs above: absent from the eager graph AND
        // present in the full one, or a blind walker would pass green.
        const sobDemanda = [
            'src/js/utilities/luminosidade/luminosidade-phrases.js',
            'src/js/utilities/meteorologia/meteorologia-phrases.js',
        ];
        const tem = (grafo, sufixo) => [...grafo.arquivos]
            .some((f) => f.replace(/\\/g, '/').endsWith(sufixo));
        for (const modulo of sobDemanda) {
            expect(tem(ansioso, modulo), `${modulo} voltou para o payload ansioso do mapa`)
                .toBe(false);
            expect(tem(completo, modulo), `${modulo} sumiu do grafo: a afirmação virou vazia`)
                .toBe(true);
        }
        // The doors stay eager, and they hold the two dynamic edges. Without these lines a deleted
        // loader would leave the four assertions above green and empty.
        expect(tem(ansioso, 'src/js/utilities/luminosidade/carregador.js')).toBe(true);
        expect(tem(ansioso, 'src/js/utilities/meteorologia/carregador.js')).toBe(true);
    });

    it('the resource share dialog arrives only by `import()`, through its door', () => {
        // `catalog/catalog.modal.js` rides the boot (the sidebar chips import it statically), and
        // its static import of `resource-share.modal.js` carried the whole share dialog with it:
        // the core, the grant tree and the group phrases, for a command that only a producer, a
        // credenciado or an administrator sees, after two clicks. It is the class of the three
        // account-menu dialogs above, left out of that lot. Since 2026-09-23 the catalog opens it
        // through `catalog/resource-share-launcher.js`.
        //
        // BOTH SIDES, as above. `admin/group-phrases.js` is in the list because, in the MAP's graph,
        // the share core was its only reader; `admin.html` reads it statically and is not measured
        // here.
        const sobDemanda = [
            'src/js/catalog/resource-share.modal.js',
            'src/js/catalog/resource-share.modal.core.js',
            'src/js/catalog/grant-tree.js',
            'src/js/admin/group-phrases.js',
        ];
        const tem = (grafo, sufixo) => [...grafo.arquivos]
            .some((f) => f.replace(/\\/g, '/').endsWith(sufixo));
        for (const modulo of sobDemanda) {
            expect(tem(ansioso, modulo), `${modulo} voltou para o payload ansioso do mapa`)
                .toBe(false);
            expect(tem(completo, modulo), `${modulo} sumiu do grafo: a afirmação virou vazia`)
                .toBe(true);
        }
        // The door is eager and holds the dynamic edge.
        expect(tem(ansioso, 'src/js/catalog/resource-share-launcher.js')).toBe(true);
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
 * `/vendors/` sai porque não é payload do bundler: são estáticos de `public/` (Cesium, GDAL e o
 * que mais sobrar lá), copiados sem passar pelo chunking, e o que esta metade guarda é a decisão
 * de `codeSplitting`. Eles afogariam qualquer variação do que se mede aqui. O TURF saiu dessa
 * enumeração em 2026-09-14, quando `public/vendors/turf.min.js` foi apagado e a biblioteca passou
 * a vir do npm; ela continua sob demanda, então continua fora desta conta, agora por ser um chunk
 * que nenhum HTML referencia e não por morar em `public/`.
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
 * As CINCO páginas construídas (quatro até 2026-09-15), com piso e teto MEDIDOS em 2026-08-25.
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
/**
 * AS QUATRO LINHAS FORAM RECENTRADAS EM 2026-09-14, e o que se ganha lendo isto é a ATRIBUIÇÃO,
 * porque ela não é a que a data sugere.
 *
 * As quatro páginas estouravam a CONTAGEM de arquivos (e o admin também os kB) já em `9033b60b`,
 * ANTES do lote que as recentrou: medido com build fresco naquele commit, 84/41/35/35 arquivos
 * contra tetos de 82/40/34/32, e o admin em 769 kB contra 720. Ou seja, o vermelho estava em
 * árvore e não foi a migração de vendors para o npm que o produziu; ela apenas foi o primeiro lote
 * a rodar esta metade com `dist/` fresco depois que ele apareceu.
 *
 * O QUE O LOTE DE VENDORS MOVEU, e é pouco: `index.html` caiu de 84 para 83 arquivos, com os mesmos
 * 4097 kB, quando o Turf virou chunk do bundler e um chunk se fundiu. As outras três não se
 * moveram um byte, o que é a propriedade esperada: Turf e milsymbol são LAZY e nenhum HTML os
 * referencia.
 *
 * SÃO DUAS LINHAS DE TRABALHO, e esta árvore é a fusão delas, então a medida de baixo não é a de
 * nenhuma das duas sozinha. A outra linha é o Cesium vindo do npm (V9), e o que ela custa a esta
 * conta está medido no comentário de `index.html` abaixo: ZERO arquivo e UM kB em cada página. É
 * por isso que os kB da fusão são os do lote de vendors mais um, e as contagens são iguais.
 *
 * O QUE NÃO SE PODE AFIRMAR DAQUI, e fica escrito para ninguém herdar uma causa inventada: a
 * hipótese natural para a deriva de contagem é o bump do MapLibre (6.7.0 -> 6.9.1, em `9033b60b`),
 * que muda o conteúdo da biblioteca que `index.html` e `calibracao.html` compartilham. Ela explica
 * essas duas e NÃO explica `admin.html`, que não instancia mapa nenhum e não alcança o ponto único
 * (o próprio comentário de `calibracao.html` abaixo registra que admin e atlas ficaram idênticas
 * dos dois lados da migração do MapLibre). O A/B que fecharia a questão exige instalar a 6.7.0 ao
 * lado, e esta sessão não instala nada. Então: deriva MEDIDA, causa NÃO atribuída, e o teto novo é
 * apertado justamente para que o próximo lote tropece aqui e meça de novo.
 *
 * Medido NA ÁRVORE FUNDIDA, build fresco de 2026-09-14: 83/41/35/35 arquivos e 4098/625/770/1966
 * kB. A linha do lote de vendors sozinha media 83/41/35/35 e 4097/624/769/1965, isto é, a mesma
 * contagem e um kB a menos por página, que é exatamente o que o Cesium acrescenta. Os tetos de
 * contagem deixam TRÊS arquivos de folga cada; o de kB do admin deixa 20.
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
    // Presence and pre-migration telemetry: fresh production build on 2026-09-12,
    // 81 files / 3955 kB. Removing the pending-monitor dynamic entry reduced 82 to 81
    // files. Allow one file of headroom for this entry-set split; the byte ceiling
    // stays unchanged, so additional page weight still fails at 4150 kB.
    //
    // O QUE O LOTE DO CESIUM (npm, V9) CUSTA A ESTA CONTA É ZERO ARQUIVO E UM kB, e isso foi
    // medido dos dois lados, com build fresco em cada um: 84 arquivos / 4097 kB ANTES e 84 / 4098
    // DEPOIS, no mapa. É o resultado esperado e é o ponto da migração: os 4,97 MB do motor saem
    // num chunk que NENHUM HTML referencia, então não entram nesta soma; o que saiu da página foi
    // o `<link rel="prefetch">` de `/vendors/cesium/Cesium.js`, que esta conta nunca somou porque
    // exclui `/vendors/`. Esse UM kB é a única diferença entre a medida da linha do Cesium e a
    // desta árvore fundida: 4098 contra 4097 no mapa, e o mesmo +1 em cada uma das outras três.
    //
    // OS PISOS NÃO SE MEXEM, de propósito, e essa é a parte que merece ser lida. As duas medidas
    // que recentraram os tetos saíram de árvores que carregavam TAMBÉM lote de outra sessão em
    // voo (a do Cesium, um lote de GDAL; o A/B do MapLibre, o lote de vendors), então elas são a
    // soma de dois trabalhos e não a medida de nenhum: subir os pisos aqui gravaria como conquista
    // um número que ninguém pode atribuir. Os pisos continuam sendo o que sempre foram, controle
    // de vácuo contra caminhador quebrado, e quem remedir sozinho é que os move. O teto de kB do
    // mapa fica em 4150 (52 kB de folga sobre 4098) e o do admin passa de 720 para 790 (20 kB
    // sobre 770).
    //
    // A FUSÃO DE `plano/npmc` COM O GDAL DO NPM (rebase sobre `b3b19d4c`) FOI MEDIDA, build fresco,
    // e os quatro números são 83/4098, 41/625, 35/770 e 35/1966. Só a contagem do mapa se move:
    // 84 na linha do Cesium acima, 83 aqui, um arquivo A MENOS. Não há teto a mexer, e a nota fica
    // porque o parágrafo do Cesium afirma 84 por extenso e um absoluto que envelhece cala quem o
    // lê depois. A diferença é de composição de chunk, não de peso: os kB do mapa são os MESMOS
    // 4098, ou seja, o que sumiu foi uma fronteira entre chunks e não conteúdo. As contagens das
    // outras três páginas (41/35/35) são as MESMAS da medida de recentragem acima, o que é a
    // propriedade esperada: nem o Turf nem o milsymbol nem o GDAL são referenciados por HTML
    // nenhum, então nenhum dos três podia mover estas contas.
    //
    // index.html: 4150 -> 4220 em 2026-09-20, MEDIDO DOS DOIS LADOS com build fresco em cada um e
    // a mesma régua (`payloadDe`): 84 arquivos e 4134 kB em `cd99fb20`, o HEAD de antes do dia,
    // num `git worktree` descartável; 84 e 4166 kB com os seis lotes do dia (QAN, teto de
    // imagem, rótulo militar, botão Entrar, cadastro e recuperação de senha, portas de imagem do
    // Quill). São +32 kB, e eles têm dono. Esta régua soma a passada moderna E a legacy (o
    // `nomodule` referencia por `data-src`, que a regex casa), então os 32 são cerca de 16 kB de
    // código novo contados duas vezes. As outras páginas, na mesma medida: `atlas.html` de 638
    // para 669 (abre login e cadastro), `admin.html` de 781 para 786.
    //
    // O QUE NÃO TEM DONO É O RESTO, de novo: de 4098 em 2026-09-14 a 4134 no HEAD são 36 kB que
    // entraram sem remedição, e o HEAD já estava a 16 kB do teto. A folga nova é a de sempre,
    // cerca de 52 kB sobre a medida.
    //
    // O CADASTRO SOB DEMANDA FOI FEITO NO MESMO DIA, e a estimativa que morava aqui ERROU POR MAIS
    // DE DUAS VEZES. Ela dizia "cerca de 40 kB" (19,6 kB minificados, contados nas duas passadas).
    // Medido com build fresco dos dois lados e esta mesma régua: `index.html` de 4167 para 4151 kB
    // e `atlas.html` de 669 para 653, isto é, 16 kB em cada, com a contagem de arquivos parada em
    // 84 e 39. O modal e as três folhas viraram um par de chunks que HTML nenhum referencia
    // (19 kB cada, moderno e legacy), e o resto da diferença esperada voltou por deslocamento de
    // fronteira entre chunks. Estimar peso construído somando o minificado dos módulos ignora que
    // o bundler redesenha as fronteiras: o número só existe depois do build. O teto NÃO desceu
    // por isso, de propósito: 4151 já é maior que o teto antigo de 4150, e a folga é a de sempre.
    //
    // index.html: 4220 -> 4170 em 2026-09-21, E O TETO DESCEU, que é o sentido que este número
    // quase nunca anda. MEDIDO DOS DOIS LADOS, com build fresco em cada um e esta mesma régua
    // (`payloadDe`): 78 arquivos e 4286417 bytes (4186 kB) antes, 77 e 4218590 bytes (4120 kB)
    // depois, ou seja 67827 bytes a menos no payload ANSIOSO do mapa, ~66 kB. Em gzip, 1102 ->
    // 1085 kB. O lote é a carga sob demanda dos três diálogos do menu da conta.
    //
    // A CONTA FECHA COM OS CHUNKS, e é por isso que ela é atribuída e não estimada. No `dist/`
    // novo, os quatro chunks que saíram da lista de `index.html` somam 66439 bytes: o do login
    // (17958), o do "novo atlas" (15340), o do núcleo de compartilhamento (31162) e o par
    // invólucro-mais-presença (1153); mais 1826 do olho de senha, que acompanhou os dois diálogos
    // que o liam. Os dois primeiros continuam referenciados por `atlas.html`, que importa aqueles
    // modais de forma estática; os três últimos não são referenciados por HTML nenhum, porque
    // agora só se alcançam por `import()`.
    //
    // O PISO NÃO SE MEXE, pela disciplina já escrita acima: ele é controle de vácuo contra um HTML
    // que perdesse as referências, não registro de conquista. Quem registra a conquista com
    // exatidão é o ORCAMENTO por pasta da metade (a) (`modals: 14`), fechado nos dois sentidos.
    // 4170 deixa 50 kB de folga sobre 4120, pouco de propósito, como as subidas anteriores.
    //
    // 2026-09-23 (night): the ceiling WAS BROKEN and did NOT move. Fresh builds, this ruler, one
    // per commit from `b0a199bc` (4218979 bytes) to `5379fc3e` (4292069, 4191 kB): +73090 bytes
    // over twelve commits, all static imports of new features, none a lazy chunk leaking through a
    // `codeSplitting` rule. The first red commit was `e848a09e` (4172 kB); `cd6498d2` was the last
    // green, 853 bytes under. About 13 kB of the growth is CSS: `main-legacy-*.js` carries the whole
    // map stylesheet as a string (522 of its 640 kB), so every rule added to `style.css` grows this
    // sum once. Two static imports that did not belong in the boot were cut instead: the two point
    // panels' phrase leaves (-8000 bytes) and the resource share dialog (-39508 bytes, see the
    // `catalog` line of ORCAMENTO). Measured after both: 82 files, 4244561 bytes, 4145 kB.
    //
    // index.html: 4170 -> 4230 on 2026-09-24, at the end of the night's bug hunt, measured on a fresh
    // build of the integrated state: 4183 kB, that is 38 kB over the 4145 of the two cuts above. It
    // is the eager code of about ninety fixes (the sync engine, the inbound handler, the queue, the
    // session exit and its rescue of every pending atlas, the derived analysis output, the import
    // leaves, the panels' discard and exit guards), none of it a lazy chunk leaking: the new eager
    // files are the four named in the module count above. The usual headroom of about 50 kB.
    { html: 'index.html', entrada: 'main', minArq: 45, maxArq: 86, minKb: 3600, maxKb: 4230 },
    // atlas.html: MEDIDA dos dois lados do mesmo lote, 36 arquivos / 663 kB antes e 40 / 664
    // depois. Os quatro arquivos a mais são repartição de chunk e não conteúdo (os modais que o
    // mapa deixou de alcançar estaticamente deixaram de dividir chunk com ele e viraram chunks
    // próprios desta página); o kB a mais é o arredondamento disso. A banda não se mexe.
    // 700 -> 740 em 2026-09-24, fim da caça noturna: 701 kB medidos com build fresco. A página entra
    // pela saída involuntária da sessão e pelo portão de migração, que cresceram com o resgate da fila
    // de todo atlas com pendência e a contenção do rollback, e ganhou `projects/server-send-phrases.js`
    // (o que o servidor podou no envio, dito igual nas duas portas).
    { html: 'atlas.html', entrada: 'atlas', minArq: 18, maxArq: 44, minKb: 320, maxKb: 740 },
    // admin.html: 800 -> 950 -> 720 em 2026-09-02, com a medida na mao: 670 kB em 24 arquivos, build
    // fresco. As abas Diagnostico e Uso (com os folhas de frase) tinham levado a pagina a 882 kB
    // (admin-*.js 258 kB, admin-legacy-*.js 358 kB), e o teto de 800 passou verde por semanas porque
    // esta metade le o dist/, e dist velho da verde velho. A DESCIDA e o recibo da carga tardia: as
    // duas abas passaram a entrar por import() no registro de admin/index.js (ver admin/lazy-tab.js),
    // o que tirou 106 kB de CADA chunk de entrada (258 -> 152 kB e 358 -> 252 kB). Os 212 kB viraram
    // quatro chunks que o HTML nao referencia (diag-tab 61 kB + legado 61 kB, uso-tab 45 kB + legado
    // 45 kB), e e por isso que a contagem de arquivos NAO mudou: 24 antes e 24 depois. O piso subiu
    // junto, para o proximo ganho aparecer na tabela em vez de passar calado.
    // 790 -> 830 em 2026-09-21, ATRIBUIDO com build fresco em tres commits e o grafo de imports do
    // entry medido nos dois lados: 758 kB em 2026-09-13, 784 kB na manha de 2026-09-21 e 803 kB a
    // tarde. Os 19 kB do dia sao os tres commits de migracao tardia (`store/migration/late-legacy-plan.js`
    // novo, 14 kB, e `legacy-transition.js` +15 kB de fonte, que entram pelo portao de migracao das
    // quatro paginas que tocam o acervo) mais o seletor pesquisavel novo do admin
    // (`ui/searchable-select.js` e o modelo dele, 24 kB de fonte). A suite passou verde o dia inteiro
    // porque o dist/ era de 2026-09-20: dist velho da verde velho, como o comentario acima ja dizia.
    // 830 -> 870 em 2026-09-24, fim da caça noturna, medido com build fresco: 844 kB. A página entra
    // pelo portão de migração e pela saída involuntária da sessão, e as duas cresceram com consertos
    // de perda de dado da noite (a espera pela janela da versão antiga, a contenção do rollback, o
    // resgate da fila de todo atlas com pendência), mais `admin/conteudo-misto.js` na aba Sistema.
    { html: 'admin.html', entrada: 'admin', minArq: 14, maxArq: 38, minKb: 600, maxKb: 870 },
    // calibracao.html: 1100 -> 1980 em 2026-09-04, pela MESMA troca de balcão de `index.html` e
    // pelo MESMO arquivo. Esta página carregava o `<script src="/vendors/maplibre-gl.js">` para
    // desenhar o mapa de projeto e o minimapa; agora ela alcança o chunk de MapLibre pelo grafo,
    // o mesmo que o mapa alcança. Medido: 23 arquivos e 845 kB antes, 23 arquivos e 1824 kB
    // depois, com os mesmos 23 arquivos e um deles 981 kB maior.
    //
    // Ela é a única das três páginas sem mapa que sobe, e isso é uma propriedade e não um acaso:
    // `atlas.html` e `admin.html` não instanciam mapa nenhum, não alcançam o ponto único, e as
    // medidas delas ficaram idênticas (521 e 673 kB) do outro lado da migração.
    // 1980 -> 2020 em 2026-09-21, pela MESMA causa do admin acima: 1955 kB em 2026-09-13, 1977 na
    // manha e 1987 a tarde, com os mesmos modulos de migracao tardia entrando pelo portao.
    // 2020 -> 2040 em 2026-09-24, pela decisao B6.1 do dono (partir o mesmo verbo sobre feicoes
    // independentes acima de LOTE_MAX_OPS): 2022 kB medidos por este caso num build fresco. A pagina
    // alcanca `store/sync/operation-factory.js` e `store/sync/gesture-batch.js` por chunks
    // compartilhados (conferido pelo sourcemap), e a regra mora nesses dois arquivos. Folga de ~18 kB.
    { html: 'calibracao.html', entrada: 'calibracao', minArq: 12, maxArq: 38, minKb: 1700, maxKb: 2040 },
    // tutorial.html: a QUINTA página, medida na estreia, 2026-09-15, build fresco: 7 arquivos e
    // 499 kB. Ela é a mais LEVE das cinco por uma margem grande, e vale entender de que os 499 são
    // feitos, porque a leitura ingênua é que uma página de documentação deveria custar dezenas de
    // kB: 189 kB são o chunk moderno (docsify 5.0.0 mais prismjs, marked, tinydate e common-tags,
    // que o pacote traz), 241 kB são o MESMO conteúdo na passada legacy (`@vitejs/plugin-legacy`,
    // que o `nomodule` referencia por `data-src` e esta regex conta), 76 kB são os polyfills
    // legacy e o resto são três folhas de helper do Babel. Somam-se ainda 51 kB de CSS, que esta
    // conta não vê porque ela é só de `.js`, e 50 dos 51 são o tema `core.css` do pacote.
    //
    // O QUE ELA SUBSTITUI, para a comparação honesta: `public/docs/doc.html` baixava 157 kB de
    // `docsify.min.js` mais 13 kB de `vue.css`, que esta metade nunca somou, porque
    // `/vendors/` sai da conta por definição. Então o número não é comparável ao de antes, e
    // fingir que é seria o erro que o comentário do MapLibre acima descreve como troca de balcão.
    //
    // A banda segue a disciplina das outras quatro: teto perto da medida (7%), piso folgado, que
    // aqui é controle de vácuo contra um HTML que perdesse as referências e desse 0 kB.
    { html: 'tutorial.html', entrada: 'tutorial', minArq: 4, maxArq: 12, minKb: 350, maxKb: 535 }
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
                // A SEGUNDA ÂNCORA pega o caso de a página referenciar só o entry e mais nada, e
                // ela MUDOU DE SUJEITO EM 2026-09-15, depois de reprovar nas CINCO páginas.
                //
                // Ela pedia `/assets/rolldown-runtime-*`, e esse chunk não existe mais: medido
                // neste build (Vite 8.1.2, build fresco), `ls dist/assets | grep rolldown` devolve
                // ZERO arquivos, e nenhum dos cinco HTML o referencia. Ou seja, a metade (b) estava
                // VERMELHA em `HEAD` por deriva do bundler, e não por causa da página nova: o
                // vermelho aparece nas quatro páginas antigas igualmente, e é a mesma classe que o
                // livro-razão registrou em 2026-09-14 (guarda que só falha para quem constrói o
                // `dist/` envelhece vermelho em vez de envelhecer frouxo).
                //
                // O substituto é escrito em DOIS níveis de propósito. O estrutural é a afirmação
                // que o comentário original queria fazer e que nome de chunk nenhum garante: a
                // página referencia MAIS do que o próprio entry. O nomeado é o polyfill de
                // `modulepreload`, que as cinco carregam hoje; se ele também sumir um dia, o
                // estrutural continua de pé e a falha nomeia só a âncora, não a conta inteira.
                const outros = payload().assets.filter(
                    (p) => !new RegExp(`/assets/${entrada}-[^/]+\\.js$`).test(p)
                );
                expect(outros.length, `${html} referencia só o próprio entry`).toBeGreaterThan(0);
                const temPolyfill = payload().assets.some(
                    (p) => p.includes('/assets/modulepreload-polyfill-'));
                expect(temPolyfill, `${html} não referencia o polyfill de modulepreload`).toBe(true);
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

    (MEDE ? it : it.skip)('a página do mapa não liga mais nenhum `/vendors/`, e os que sobrevivem em disco entram em runtime', () => {
        // Se o filtro de `/vendors/` passasse a comer TUDO (um `base` diferente, um caminho
        // reescrito), a conta cairia para zero e o piso de kB acusaria. Este caso acusava antes, e
        // nomeava o motivo: os vendores existiam, e eram excluídos de propósito.
        //
        // O PISO DESCEU DE 3 PARA 2 EM 2026-08-25, DE 2 PARA 1 EM 2026-09-04, E CHEGOU A ZERO EM
        // 2026-09-14. As três descidas são recibo de uma onda, não afrouxamento. Primeiro os 619 kB
        // de `/vendors/turf.min.js` saíram do `index.html` para a carga sob demanda de
        // `src/js/utilities/turf-loader.js`, como o milsymbol (855 kB) e o GDAL (187 kB) já tinham
        // saído. Depois saiu o MapLibre, por outro motivo: a 6.x não publica bundle UMD, então
        // `public/vendors/maplibre-gl.js` foi APAGADO e a biblioteca entrou no grafo do bundler.
        // Por último saiu o `<link rel="prefetch">` de `/vendors/cesium/Cesium.js`: a distribuição
        // do Cesium virou `cesium` do npm (V9), e o motor viaja num chunk lazy cujo nome carrega
        // hash de conteúdo, que não existe para quem escreve o HTML. O `index.html` diz isso por
        // extenso, e diz o que se perdeu com o prefetch.
        //
        // ZERO É UM ESTADO LEGÍTIMO E UM PÉSSIMO CONTROLE DE VÁCUO, então a afirmação mudou de
        // lugar em vez de sumir. A lista de `/vendors/` da página tem de ser EXATAMENTE vazia (um
        // `href` novo para lá reprova, e é assim que se percebe um vendor voltando ao HTML), e o
        // arquivo de `public/vendors/` que o produto ainda carrega EM RUNTIME, por caminho que
        // nenhum HTML menciona, tem de estar no `dist/`. Sem a segunda metade, apagar
        // `frontend/public/` inteiro deixaria este caso verde.
        //
        // ERAM DOIS ATÉ ESTA FUSÃO, E O SEGUNDO ERA `/vendors/gdal`, LIDO PELO CAMINHO QUE
        // `_getGdalPath` MONTAVA. Ele saiu porque a pasta saiu: desde 2026-09-14 o gdal3.js vem do
        // npm pelo ponto único `src/js/vendor/gdal.js`, e o `.wasm` e o `.data` são assets emitidos
        // pelo Vite com hash de conteúdo, endereçados pelas duas URLs de `?url` que a lista
        // `EXTERNOS_ANSIOSOS` afirma lá em cima. A afirmação sobre eles não sumiu, mudou de eixo: é
        // a lista de externos que a guarda agora, e não a existência de um diretório em `dist/`.
        // Esta linha ficou pedindo o diretório por uma revisão inteira, e o caso reprovava.
        const { vendors } = payloadDe('index.html');
        expect(vendors, 'a página do mapa voltou a referenciar um vendor de `public/` no HTML')
            .toEqual([]);
        // A SEGUNDA METADE PERDEU O ÚLTIMO OCUPANTE EM 2026-09-15, e ela mudou de sentido em vez
        // de sumir. Até aqui ela exigia que `/vendors/cesium/cesium-viewshed.js` estivesse no
        // `dist/`, porque `map_3d.js` o injetava como `<script>` em runtime, por um caminho que
        // nenhum HTML menciona. A decisão D15 trocou aquele arquivo por código da casa
        // (`src/js/3d_models_viewer_tool/services/viewshed-3d.js`), e com ele saiu o ÚLTIMO
        // caminho de runtime que este repositório tinha para `public/vendors/`: hoje tudo o que a
        // página do mapa carrega está no grafo do bundler, e portanto nas contagens acima.
        //
        // A afirmação vira a inversa, e ela é mais forte: o arquivo não pode estar no `dist/`,
        // porque estar ali significaria que alguém o repôs em `public/`. O que restou daquela
        // pasta é o par do tutorial (`docsify.min.js` e `vue.css`), que `public/docs/doc.html`
        // carrega fora do Vite e que nenhuma das quatro páginas do app referencia.
        expect(
            existsSync(join(DIST, '/vendors/cesium/cesium-viewshed.js')),
            'o vendor ofuscado do viewshed voltou para `public/vendors/` e foi publicado no dist/',
        ).toBe(false);
        // E os ativos estáticos do Cesium, que `window.CESIUM_BASE_URL` endereça e que o plugin
        // `ebgeo-cesium` do `vite.config.js` copia de `node_modules/cesium/Build/Cesium/`. A
        // ausência deles é a falha mais silenciosa desta migração: o visualizador 3D abre, a cena
        // fica vazia e nada reclama.
        for (const sub of ['Assets', 'ThirdParty', 'Widgets', 'Workers']) {
            expect(
                existsSync(join(DIST, 'vendors/cesium', sub)),
                `os ativos do Cesium (${sub}) não foram copiados para o dist/`
            ).toBe(true);
        }
    });

    (MEDE ? it : it.skip)('o mapa é a página pesada, e as outras quatro continuam leves', () => {
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
        // A QUINTA ENTROU EM 2026-09-15 e é a que menos compartilha com o mapa: 5 arquivos e 79 kB
        // comuns (contra 29 e 1349 kB da calibração), porque o único ancestral comum entre as duas
        // são os helpers do Babel e os polyfills da passada legacy. A razão medida na estreia é
        // 9,57 (4019 kB exclusivos do mapa contra 420 dela).
        const mapa = payloadDe('index.html');
        for (const html of ['atlas.html', 'admin.html', 'calibracao.html', 'tutorial.html']) {
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
