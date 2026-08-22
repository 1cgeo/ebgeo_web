// Path: tests/unit/forma-3d-censo.test.js
//
// O CENSO DO EIXO DE FORMA DE 3D, E A LICAO QUE ELE EXISTE PARA CODIFICAR.
//
// A LICAO. Uma taxonomia escrita por EXCLUSAO nao acusa a variante nova. Ate 2026-08-19 a forma
// de um modelo 3D era decidida em dois lugares improvisados e sem enumeracao: `config.type ===
// 'glb'` escolhia o carregador, e `config.viewer !== 'firstPerson'` tirava a cena indoor da
// lista. Enquanto a regra fosse "nao e glb e nao e firstPerson", TODA forma que ninguem tivesse
// declarado caia no ramo do tileset, sem rotulo, sem icone e sem erro. Foi assim que a nuvem de
// pontos entrou no acervo e ficou invisivel como categoria: o carregador dela e o certo (o
// formato e parte do 3D Tiles), e a tela nunca soube dizer que aquilo era uma nuvem. E a mesma
// classe de defeito que a constituicao proibe no eixo de papel, com o sinal trocado: la a lista
// fechada EXCLUI em silencio quem esta acima; aqui ela INCLUI em silencio quem ninguem conhece.
//
// O QUE ESTE ARQUIVO COBRA. O eixo virou enumeracao FECHADA de quatro valores
// (`src/js/catalog/forma-3d.js`). Acrescentar um quinto valor e barato; acrescenta-lo sem dizer
// como ele se chama na tela, com que icone aparece e QUEM O DESENHA e o que este censo torna
// vermelho. Tres cobrancas por valor -- rotulo, icone e ramo de visualizador -- mais uma
// varredura que reprova quem voltar a decidir a forma por exclusao.
//
// COMO ELE FUNCIONA, EM DUAS CAMADAS.
//
//   A VARREDURA. O inventario vem do VERSIONAMENTO (`git ls-files --cached --others
//   --exclude-standard` sobre `src/js/`), nunca de uma lista de alvos escrita a mao: "conferir um
//   subconjunto e tratar como o conjunto" e a classe mais repetida de `docs/livro-razao.md`. As
//   duas bandeiras nao sao detalhe: `git ls-files` puro enumera so o RASTREADO, e o ponto cego
//   ficaria no pior lugar -- o arquivo escrito ha cinco minutos, que e o que ninguem classificou.
//
//   O CENSO. Uma entrada por FORMA, com motivo escrito, o rotulo esperado e o visualizador que a
//   desenha. As duas direcoes sao cobradas: forma sem entrada reprova, e entrada sem forma
//   tambem (senao o censo vira uma lista que sobrevive a remocao do que descrevia).
//
// FRAGILIDADES ACEITAS. (a) O inventario precisa de `git`; se o comando falhar, o caso-piso diz
// isso nessas palavras, porque falha de ambiente lida como regressao custa mais do que o guarda
// economiza. (b) A remocao de comentario e textual, nao e um parser: `//` dentro de string
// literal sai junto, e o efeito e perder um sitio, nunca inventar um. (c) A cobranca do ramo de
// visualizador e por TRECHO de texto, nao por execucao: alguem pode manter o `case` e esvazia-lo.
// O que este arquivo garante e que a forma nova nao passe DESPERCEBIDA, nao que o ramo dela
// esteja correto -- isso e o teste de derivacao ao lado e o comportamento no visualizador.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    FORMAS_3D,
    Forma3D,
    Visualizador3D,
    VISUALIZADOR_POR_FORMA,
    visualizadorDaForma,
    derivarForma3d,
} from '@catalog/forma-3d.js';
import { FORMA_3D_LABELS, FORMA_3D_ICONS } from '@catalog/catalog.constants.js';

// Kept as BOTH: the URL is the only join that stays correct on Windows, and `execFileSync` needs
// a real path for its cwd.
const URL_JS = new URL('../../src/js/', import.meta.url);
const DIR_JS = fileURLToPath(URL_JS);

/** O espelho do eixo no BACKEND, aberto como texto: a copia que precisa concordar com esta. */
const ARQ_BACKEND = fileURLToPath(
    new URL('../../../backend/src/modules/catalog/forma-3d.js', import.meta.url),
);


// ============================================================================
// O CENSO
// ============================================================================

/**
 * @typedef {Object} EntradaDoCenso
 * @property {string} forma - Um dos `FORMAS_3D`
 * @property {string} rotulo - O rotulo esperado em `FORMA_3D_LABELS`
 * @property {string} visualizador - Um dos `Visualizador3D`
 * @property {string} motivo - Por que esta forma existe separada das outras
 */

/** @type {EntradaDoCenso[]} */
const CENSO = [
    {
        forma: Forma3D.TILES3D,
        rotulo: 'Tiles 3D',
        visualizador: Visualizador3D.CESIUM_TILESET,
        motivo: 'A malha tileada de uma area inteira, o caso historico do visualizador 3D. E o DEFAULT da derivacao de compatibilidade, e por isso o valor que mais precisa continuar nomeado: enquanto ele era o "resto" de duas negativas, toda forma desconhecida se disfarcava dele.',
    },
    {
        forma: Forma3D.GLB,
        rotulo: 'Modelo isolado',
        visualizador: Visualizador3D.CESIUM_MODEL,
        motivo: 'Um unico glTF/GLB, posicionado por coordenada, rotacao e escala. E a UNICA forma que ja tinha discriminador proprio (`config.type = "glb"`), e o carregador dela nao e o mesmo: mandar um GLB para o carregador de tileset desenha nada, sem erro.',
    },
    {
        forma: Forma3D.POINTCLOUD,
        rotulo: 'Nuvem de pontos',
        visualizador: Visualizador3D.CESIUM_TILESET,
        motivo: 'A forma que este trabalho existe para resgatar. Compartilha o CARREGADOR com tiles3d (o formato dela e parte do 3D Tiles) e nao compartilha a IDENTIDADE: sem valor proprio ela nao tem rotulo, icone nem filtro, e ninguem consegue pedir "so as nuvens". No banco ela e indistinguivel de um tileset comum, entao a migracao 010 NAO a adivinha: marca-se a mao, pelo painel.',
    },
    {
        forma: Forma3D.INDOOR,
        rotulo: 'Cena indoor',
        visualizador: Visualizador3D.FIRST_PERSON,
        motivo: 'A cena de caminhada (Gaussian splatting). E a unica forma que NAO usa o Cesium, e por isso a unica cuja classificacao errada nao degrada: ela some da lista de cenas e cai num visualizador que nao sabe abri-la.',
    },
];

/**
 * Visualizador -> onde ele esta implementado, e o trecho que prova que o ramo existe.
 *
 * O `trecho` e o que transforma "o arquivo existe" em "o ramo existe": sem ele, apagar o `case`
 * inteiro do `switch` deixaria este censo verde, porque o arquivo continuaria no inventario.
 */
const IMPLEMENTACAO_POR_VISUALIZADOR = Object.freeze({
    [Visualizador3D.CESIUM_TILESET]: {
        arquivo: '3d_models_viewer_tool/map_3d.js',
        trecho: 'case Visualizador3D.CESIUM_TILESET:',
    },
    [Visualizador3D.CESIUM_MODEL]: {
        arquivo: '3d_models_viewer_tool/map_3d.js',
        trecho: 'case Visualizador3D.CESIUM_MODEL:',
    },
    [Visualizador3D.FIRST_PERSON]: {
        arquivo: 'first_person_3d_tool/scene-config.service.js',
        trecho: 'ehEntradaIndoor(entry)',
    },
});

/** O consumidor do rotulo e do icone: e ele que faz o cartao dizer o que o item e. */
const ARQUIVO_DO_CARTAO = 'catalog/components/catalog-card.js';

// ============================================================================
// PENDENCIAS NOMEADAS
// ============================================================================
//
// Registrado aqui, e nao em prosa solta, pela mesma razao de todo censo desta casa: pendencia que
// so existe num paragrafo e pendencia que ninguem reencontra. Cada entrada tem um predicado
// `aindaVale`, e quando ele deixar de valer o proprio caso fica VERMELHO pedindo que a nota saia.

const PENDENCIAS = [
    {
        nome: 'conversao de nuvem crua (.pts / .las / .laz) na INGESTAO',
        motivo: 'O acervo tem arquivo CRU de nuvem de pontos, e isso NAO e suporte no visualizador: '
            + 'nem o Cesium nem o campo `forma3d` leem esses formatos. O que falta e uma conversao na '
            + 'INGESTAO, para 3D Tiles, ao lado do que `scripts/assets3d-import.js` ja faz com os '
            + 'demais assets. Fica fora deste trabalho de proposito: declarar o eixo e dar nome ao que '
            + 'ja existe no acervo; converter formato e um pipeline, com custo, formato de saida e '
            + 'dono proprios. Enquanto a conversao nao existe, `pointcloud` significa "nuvem JA em 3D '
            + 'Tiles", e um `.laz` no disco continua sendo um arquivo que nenhuma tela alcanca.',
        /** @param {Map<string,string>} fontes @returns {boolean} */
        aindaVale: (fontes) => ![...fontes.values()].some((src) => /\.(pts|las|laz)\b/i.test(src)),
        comoFecha: 'Quando algum modulo do cliente souber ler ou pedir um `.pts`/`.las`/`.laz`, esta '
            + 'nota deixa de ser verdade: apague-a e escreva o as-built da conversao.',
    },
];

// ============================================================================
// A VARREDURA
// ============================================================================

/**
 * Remove comentario de bloco e de linha, preservando a contagem de linhas.
 *
 * Sem isto a varredura de exclusao acusaria os proprios comentarios que EXPLICAM o padrao
 * antigo -- o cabecalho de `forma-3d.js` e a nota do `switch` em `map_3d.js` citam
 * `config.type === 'glb'` por extenso, e ambos sao prosa.
 * @param {string} src
 * @returns {string}
 */
function semComentarios(src) {
    const normalizado = src.replace(/\r\n?/g, '\n');
    const semBloco = normalizado.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    return semBloco.split('\n').map((linha) => linha.replace(/\/\/.*/, '')).join('\n');
}

/**
 * Arquivos `.js` sob `src/js/`, rastreados MAIS nao rastreados nao ignorados.
 * @returns {string[]} Caminhos relativos a `src/js/`.
 */
function arquivosDoInventario() {
    const saida = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '.'], {
        cwd: DIR_JS,
        encoding: 'utf8',
    });
    return saida.split('\n').map((s) => s.trim()).filter((f) => f.endsWith('.js'));
}

let erroDoInventario = null;
let inventario = [];
try {
    inventario = arquivosDoInventario();
} catch (e) {
    erroDoInventario = e;
}

const fontePorArquivo = new Map(
    inventario.map((rel) => [rel, readFileSync(new URL(rel, URL_JS), 'utf8')]),
);

/**
 * As formas de decidir a forma de 3D POR EXCLUSAO, que e o que este trabalho aposentou.
 *
 * Cada padrao tem uma amostra no controle negativo abaixo: varredura sem prova de que a regex
 * ainda casa e um verde que nao verifica nada, que e a familia de defeito que a constituicao
 * nomeia primeiro.
 */
const PADROES_DE_EXCLUSAO = [
    { nome: '!== FIRST_PERSON_VIEWER', re: /!==\s*FIRST_PERSON_VIEWER/ },
    { nome: "viewer !== 'firstPerson'", re: /viewer\s*!==\s*['"]firstPerson['"]/ },
    { nome: "type === 'glb'", re: /\btype\s*===\s*['"]glb['"]/ },
];

/** Sitios de decisao por exclusao no inventario, ja sem comentario. */
function sitiosDeExclusao() {
    const achados = [];
    for (const [arquivo, bruto] of fontePorArquivo) {
        semComentarios(bruto).split('\n').forEach((linha, i) => {
            const padrao = PADROES_DE_EXCLUSAO.find((p) => p.re.test(linha));
            if (padrao) achados.push(`${arquivo}:${i + 1} [${padrao.nome}] ${linha.trim()}`);
        });
    }
    return achados;
}

// --- Os tres predicados do censo, isolados para que o CONTROLE NEGATIVO possa roda-los ---
// contra uma lista com uma quinta forma inventada. Sem isso, "os quatro estao classificados"
// tambem seria o comportamento de um predicado que aprova qualquer coisa.

/** @param {string[]} formas @returns {string[]} As que nao tem rotulo. */
const semRotulo = (formas) => formas.filter((f) => !FORMA_3D_LABELS[f]);
/** @param {string[]} formas @returns {string[]} As que nao tem icone SVG. */
const semIcone = (formas) => formas.filter((f) => !String(FORMA_3D_ICONS[f] ?? '').includes('<svg'));
/** @param {string[]} formas @returns {string[]} As que nao tem ramo de visualizador. */
const semRamo = (formas) => formas.filter((f) => !VISUALIZADOR_POR_FORMA[f]);
/** @param {string[]} formas @returns {string[]} As que nao estao no censo. */
const semEntradaNoCenso = (formas) => formas.filter((f) => !CENSO.some((e) => e.forma === f));

// ============================================================================
// OS CASOS
// ============================================================================

describe('forma 3D: piso', () => {
    it('FLOOR: o inventario veio do git e alcanca os arquivos que decidem a forma', () => {
        expect(
            erroDoInventario,
            'FALHA DE AMBIENTE, nao regressao: `git ls-files` nao rodou em src/js/. Este guarda '
            + 'deriva o inventario do versionamento e nao tem outra fonte.',
        ).toBeNull();
        expect(inventario.length, 'o inventario veio vazio').toBeGreaterThan(500);
        expect(inventario, 'o visualizador 3D saiu da varredura').toContain('3d_models_viewer_tool/map_3d.js');
        expect(inventario, 'o servico de cena indoor saiu da varredura')
            .toContain('first_person_3d_tool/scene-config.service.js');
        expect(inventario, 'o cartao do catalogo saiu da varredura').toContain(ARQUIVO_DO_CARTAO);
    });

    it('FLOOR: o eixo e uma enumeracao fechada de quatro valores, congelada', () => {
        expect(FORMAS_3D.length, 'o eixo encolheu ou cresceu sem que este piso acompanhasse').toBe(4);
        expect(new Set(FORMAS_3D).size, 'valor repetido no eixo').toBe(FORMAS_3D.length);
        expect(Object.isFrozen(FORMAS_3D)).toBe(true);
        // ABSOLUTO, ao lado do derivado: renomear um valor em silencio muda o que fica gravado no
        // `config` de todo cliente, e so este caso notaria.
        expect([...FORMAS_3D]).toEqual(['tiles3d', 'glb', 'pointcloud', 'indoor']);
    });
});

describe('forma 3D: o censo cobre o eixo nas duas direcoes', () => {
    it('toda forma do eixo tem entrada no censo', () => {
        expect(
            semEntradaNoCenso([...FORMAS_3D]),
            'forma sem entrada no censo. Acrescente uma linha em CENSO com o rotulo, o visualizador '
            + 'que a desenha e o motivo escrito.',
        ).toEqual([]);
    });

    it('toda entrada do censo aponta para uma forma que existe', () => {
        const mortas = CENSO.map((e) => e.forma).filter((f) => !FORMAS_3D.includes(f));
        expect(mortas, 'entrada de censo para forma que saiu do eixo').toEqual([]);
        expect(new Set(CENSO.map((e) => e.forma)).size, 'forma censada duas vezes').toBe(CENSO.length);
    });

    it('toda entrada tem motivo escrito, e o motivo diz alguma coisa', () => {
        const vazias = CENSO
            .filter((e) => typeof e.motivo !== 'string' || e.motivo.trim().length < 80)
            .map((e) => e.forma);
        expect(vazias, 'motivo ausente ou curto demais para significar algo').toEqual([]);
    });
});

describe('forma 3D: rotulo, icone e ramo de visualizador', () => {
    it('toda forma tem ROTULO, e o rotulo e o que o censo declara', () => {
        expect(semRotulo([...FORMAS_3D]), 'forma sem rotulo em FORMA_3D_LABELS').toEqual([]);
        const divergentes = CENSO
            .filter((e) => FORMA_3D_LABELS[e.forma] !== e.rotulo)
            .map((e) => `${e.forma}: censo diz "${e.rotulo}", codigo diz "${FORMA_3D_LABELS[e.forma]}"`);
        expect(divergentes, 'rotulo mudou sem o censo acompanhar').toEqual([]);
        // Rotulos distintos, senao duas formas ficam indistinguiveis na tela, que e exatamente o
        // estado de onde este trabalho partiu.
        expect(new Set(Object.values(FORMA_3D_LABELS)).size).toBe(FORMAS_3D.length);
    });

    it('toda forma tem ICONE, e os icones sao distintos', () => {
        expect(semIcone([...FORMAS_3D]), 'forma sem icone SVG em FORMA_3D_ICONS').toEqual([]);
        const icones = FORMAS_3D.map((f) => FORMA_3D_ICONS[f]);
        expect(new Set(icones).size, 'duas formas com o MESMO icone: o cartao volta a nao distinguir')
            .toBe(FORMAS_3D.length);
    });

    it('o cartao do catalogo consome mesmo o rotulo e o icone por forma', () => {
        // Sem este caso, os dois acima verificariam duas constantes que nada renderiza.
        const cartao = fontePorArquivo.get(ARQUIVO_DO_CARTAO) ?? '';
        expect(cartao, 'o cartao nao le FORMA_3D_LABELS').toContain('FORMA_3D_LABELS');
        expect(cartao, 'o cartao nao le FORMA_3D_ICONS').toContain('FORMA_3D_ICONS');
    });

    it('toda forma tem RAMO de visualizador, e o ramo existe no codigo', () => {
        expect(semRamo([...FORMAS_3D]), 'forma sem entrada em VISUALIZADOR_POR_FORMA').toEqual([]);

        const divergentes = CENSO
            .filter((e) => visualizadorDaForma(e.forma) !== e.visualizador)
            .map((e) => `${e.forma}: censo diz ${e.visualizador}, codigo diz ${visualizadorDaForma(e.forma)}`);
        expect(divergentes, 'o ramo mudou sem o censo acompanhar').toEqual([]);

        const semImplementacao = [];
        for (const e of CENSO) {
            const impl = IMPLEMENTACAO_POR_VISUALIZADOR[e.visualizador];
            if (!impl) { semImplementacao.push(`${e.visualizador} nao tem implementacao declarada`); continue; }
            const fonte = fontePorArquivo.get(impl.arquivo);
            if (!fonte) { semImplementacao.push(`${impl.arquivo} nao esta no inventario`); continue; }
            if (!fonte.includes(impl.trecho)) {
                semImplementacao.push(`${impl.arquivo} nao contem o ramo \`${impl.trecho}\``);
            }
        }
        expect(
            semImplementacao,
            'forma declarada sem quem a desenhe. Um valor no eixo sem ramo no visualizador e um item '
            + 'que abre vazio: acrescente o `case` (ou o filtro) e declare-o em '
            + 'IMPLEMENTACAO_POR_VISUALIZADOR.',
        ).toEqual([]);
    });

    it('todo visualizador declarado e usado por alguma forma', () => {
        // Anti-tapete: um visualizador que nenhuma forma aponta e um ramo morto crescendo calado.
        const usados = new Set(FORMAS_3D.map((f) => VISUALIZADOR_POR_FORMA[f]));
        const orfaos = Object.values(Visualizador3D).filter((v) => !usados.has(v));
        expect(orfaos, 'visualizador sem nenhuma forma que o use').toEqual([]);
    });
});

describe('forma 3D: ninguem volta a decidir por exclusao', () => {
    it('nenhum arquivo de src/js decide a forma por exclusao', () => {
        expect(fontePorArquivo.size, 'a varredura nao leu arquivo nenhum').toBeGreaterThan(500);
        expect(
            sitiosDeExclusao(),
            'decisao de forma 3D por EXCLUSAO. Use o eixo declarado: `derivarForma3d`, '
            + '`ehEntradaDoCesium` ou `ehEntradaIndoor` (`@catalog/forma-3d.js`). Uma negativa inclui '
            + 'em silencio toda forma que ninguem conhece, que e o defeito que este censo existe para '
            + 'impedir.',
        ).toEqual([]);
    });

    it('CONTROLE NEGATIVO: os padroes de exclusao PEGAM o codigo que os contem', () => {
        // Com a lista de sitios vazia, o caso acima e `[] === []` e nao discrimina mais nada.
        const AMOSTRAS = [
            'return config.tilesets.filter(t => t?.viewer !== FIRST_PERSON_VIEWER);',
            "const tilesets = lista.filter(t => t.viewer !== 'firstPerson');",
            "const isGlb = tilesetConfig.type === 'glb';",
        ];
        expect(AMOSTRAS.length, 'uma amostra por padrao').toBe(PADROES_DE_EXCLUSAO.length);
        const naoPegos = PADROES_DE_EXCLUSAO
            .filter((p) => !AMOSTRAS.some((a) => p.re.test(a)))
            .map((p) => p.nome);
        expect(naoPegos, 'padrao que nao pega nem a propria amostra').toEqual([]);

        // E o inverso: a forma NOVA, e o uso legitimo do vocabulario legado, nao podem disparar.
        const INOFENSIVAS = [
            'return config.tilesets.filter(tileset => ehEntradaDoCesium(tileset));',
            "if (result.viewer === 'firstPerson') { abrirCena(result.sceneId); }",
            "export const VIEWER_LEGADO_INDOOR = 'firstPerson';",
            'case Visualizador3D.CESIUM_MODEL:',
        ];
        const falsosPositivos = INOFENSIVAS.filter((l) => PADROES_DE_EXCLUSAO.some((p) => p.re.test(l)));
        expect(falsosPositivos, 'padrao de exclusao disparando em codigo do eixo declarado').toEqual([]);
    });
});

describe('forma 3D: CONTROLE NEGATIVO do censo', () => {
    it('uma QUINTA forma sem rotulo, sem icone e sem ramo e acusada pelos quatro predicados', () => {
        // O caso que prova os dentes deste arquivo SEM editar o codigo-fonte. Ele roda os MESMOS
        // predicados dos casos acima contra uma lista com um valor inventado: se algum deles
        // aprovasse a quinta forma, todos os verdes acima seriam verdes que nao verificam nada.
        const QUINTA = 'holograma';
        expect(FORMAS_3D, 'a quinta forma do controle nao pode existir de verdade').not.toContain(QUINTA);
        const comQuinta = [...FORMAS_3D, QUINTA];

        expect(semRotulo(comQuinta), 'o predicado de ROTULO nao acusou a forma nova').toEqual([QUINTA]);
        expect(semIcone(comQuinta), 'o predicado de ICONE nao acusou a forma nova').toEqual([QUINTA]);
        expect(semRamo(comQuinta), 'o predicado de RAMO nao acusou a forma nova').toEqual([QUINTA]);
        expect(semEntradaNoCenso(comQuinta), 'o predicado de CENSO nao acusou a forma nova').toEqual([QUINTA]);

        // DISCRIMINACAO: os mesmos predicados sobre o eixo REAL nao acusam ninguem. Sem esta
        // linha, "acusa" tambem seria o comportamento de um predicado que acusa tudo.
        expect(semRotulo([...FORMAS_3D])).toEqual([]);
        expect(semIcone([...FORMAS_3D])).toEqual([]);
        expect(semRamo([...FORMAS_3D])).toEqual([]);
        expect(semEntradaNoCenso([...FORMAS_3D])).toEqual([]);
    });

    it('a quinta forma tambem nao tem para onde ser desenhada, e isso e ALTO', () => {
        // `visualizadorDaForma` nao tem default: uma forma sem ramo levanta no ponto onde o id e a
        // forma estao os dois em maos, em vez de cair no carregador errado e desenhar nada.
        expect(() => visualizadorDaForma('holograma')).toThrow(/sem ramo de visualizador/);
    });
});

describe('forma 3D: as copias fora deste pacote', () => {
    // ESTE ARQUIVO ABRE FONTE DO BACKEND, e o preco vem junto: uma mudanca so no backend pode
    // deixar a perna do FRONTEND vermelha. E o guarda funcionando, nao o frontend quebrado --
    // leia a mensagem e edite o arquivo que ela nomeia. Mesmo desenho de
    // `tipos-feicao-paridade-pacotes.test.js`.
    it('o backend declara os MESMOS quatro valores, na mesma ordem', () => {
        const fonte = readFileSync(ARQ_BACKEND, 'utf8');
        const i = fonte.indexOf('export const FORMAS_3D');
        expect(i, 'a constante `FORMAS_3D` sumiu do backend, ou foi renomeada').toBeGreaterThan(-1);
        const trecho = fonte.slice(i, fonte.indexOf(';', i));
        const valores = [...trecho.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
        expect(valores.length, 'o extrator nao achou literal nenhum: o piso, nao a comparacao')
            .toBeGreaterThanOrEqual(4);
        expect(
            valores,
            'a lista fechada divergiu entre os pacotes: o Joi do backend recusaria um valor que o '
            + 'formulario oferece, e o 422 chegaria sem explicacao.',
        ).toEqual([...FORMAS_3D]);
    });

    // A DERIVACAO DE COMPATIBILIDADE E O SUJEITO, e ela nao e mais a migracao. Ate a
    // consolidacao do schema havia uma migracao de backfill e este caso lia o SQL dela;
    // com as baselines por dominio o backfill deixou de existir, porque um banco novo nasce com
    // `tilesets` VAZIA. O que sobrevive, e e o que sempre importou, e `derivarForma3d`: ela le a
    // linha escrita antes do eixo existir.
    it('a derivacao le glb e indoor da linha legada, e NAO adivinha nuvem de pontos', () => {
        expect(derivarForma3d({ forma3d: Forma3D.POINTCLOUD }), 'o campo DECLARADO manda')
            .toBe(Forma3D.POINTCLOUD);
        expect(derivarForma3d({ viewer: 'firstPerson' }), 'a cena indoor legada').toBe(Forma3D.INDOOR);
        expect(derivarForma3d({ type: 'glb' }), 'o modelo isolado legado').toBe(Forma3D.GLB);
        expect(derivarForma3d({}), 'o default historico').toBe(Forma3D.TILES3D);

        // A DECISAO DO DONO, PINADA: no banco a nuvem e indistinguivel de um tileset comum, entao
        // qualquer heuristica inventaria classificacao. Marcar nuvem e trabalho manual pela tela do
        // admin. As entradas abaixo sao as que uma heuristica "esperta" tentaria capturar.
        for (const legada of [{ type: 'pointcloud' }, { url: '/x/nuvem.json' }, { name: 'Nuvem de pontos' }]) {
            expect(
                derivarForma3d(legada),
                'a derivacao passou a ADIVINHAR nuvem de pontos. Isso foi decidido em 2026-08-19 e '
                + 'recusado: no banco ela e indistinguivel de um tileset, e a marcacao e manual, uma '
                + 'a uma, pelo painel de administracao.',
            ).toBe(Forma3D.TILES3D);
        }
    });
});

describe('forma 3D: pendencias nomeadas', () => {
    it('toda pendencia tem nome, motivo escrito e criterio de fechamento', () => {
        expect(PENDENCIAS.length, 'sem pendencia declarada este bloco mede vazio').toBeGreaterThanOrEqual(1);
        const ruins = PENDENCIAS
            .filter((p) => !p.nome || typeof p.motivo !== 'string' || p.motivo.length < 120 || !p.comoFecha)
            .map((p) => p.nome ?? '(sem nome)');
        expect(ruins, 'pendencia sem motivo escrito ou sem criterio de fechamento').toEqual([]);
    });

    it('toda pendencia declarada AINDA vale (senao a nota mente)', () => {
        // A metade que impede a pendencia de apodrecer: quando alguem entregar a conversao, este
        // caso fica vermelho pedindo que a nota saia. Documentacao desatualizada e pior que ausente.
        const resolvidas = PENDENCIAS.filter((p) => !p.aindaVale(fontePorArquivo)).map((p) => p.nome);
        expect(
            resolvidas,
            'pendencia que deixou de ser verdade: entregue o as-built e apague a nota deste censo.',
        ).toEqual([]);
    });
});
