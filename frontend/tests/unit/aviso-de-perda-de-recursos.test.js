// Path: tests/unit/aviso-de-perda-de-recursos.test.js
//
// O AVISO "VOCÊ VAI PERDER ISTO": o texto e os DOIS caminhos que o mostram.
//
// O BURACO QUE ESTE ARQUIVO FECHA foi medido, não suposto. `descreverPerdas` não tinha
// UMA ocorrência em `frontend/tests/`, e nenhum literal do aviso tampouco: apagar os dois
// `showConfirm` (o do `.ebgeo` e o do "Salvar como local") deixava a suíte inteira verde.
// O vizinho `poda-de-saida-fiacao.test.js` assere o `relatorio` que ALIMENTA o aviso e
// para aí, e relatório existir não é usuário ser avisado.
//
// SÃO DUAS ASSERÇÕES DE NATUREZAS DIFERENTES, e as duas são necessárias:
//   1. UNIDADE: `descreverPerdas` conta por superfície, rotula em pt-BR, nomeia no máximo
//      três e NUNCA imprime um id cru. Essa última é a que mais importa: o id de um 360 é
//      o nome do arquivo da foto, e o de um tileset não diz nada a quem lê.
//   2. ESTRUTURA: os dois chamadores consomem `descreverPerdas`, pedem confirmação e
//      ABORTAM quando ela é negada, ANTES do trabalho irreversível (o zip; a cópia banco a
//      banco). Nenhum teste de comportamento chega lá: um zipa, baixa e abre diálogo, o
//      outro copia dez bancos.
//
// A VARREDURA ESTRUTURAL RODA SOBRE CÓDIGO, NUNCA SOBRE PROSA. Guarda que varre o texto
// bruto de um arquivo já deu resposta errada duas vezes neste repositório (um comentário
// citando o símbolo mantém o teste verde depois de a chamada sumir), então a fonte passa
// por um removedor de comentários ciente de literal de string, e o caso
// `CONTROLE: o removedor de comentários funciona` prova o par: continua vendo o código,
// deixou de ver a prosa.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

// O CATÁLOGO QUE ESTE CLIENTE ENXERGA. `nomeDeRecursoConhecido` só sabe nomear o que está
// aqui, e é essa fronteira que separa "nome" de "id cru" no aviso.
vi.mock('@js/config.js', () => ({
    default: {
        basemaps: { 'bm-0001-carta': { name: 'Carta Topográfica' } },
        tilesets: [{ id: 'ts-0001-cidade', name: 'Cidade 3D' }],
        dataLayers: {
            enabled: true,
            layers: [
                { id: 'dl-0001', name: 'Hidrografia' },
                { id: 'dl-0002', name: 'Rodovias' },
                { id: 'dl-0003', name: 'Ferrovias' },
                { id: 'dl-0004', name: 'Limites Municipais' },
            ],
        },
        analysisLayers: { enabled: true, layers: [{ id: 'al-0001', name: 'Declividade' }] },
    },
}));

import { descreverPerdas, nomeDeRecursoConhecido } from '../../src/js/catalog/resource-reference.resolver.js';

const URL_EXPORT = new URL('../../src/js/import_export/export-import.service.js', import.meta.url);
const URL_MAPS = new URL('../../src/js/sidebar/tabs/maps.tab.js', import.meta.url);

// ============================================================================
// (1) A UNIDADE: o texto do aviso
// ============================================================================

/** Duas superfícies, quatro nomes resolvíveis e um id que o catálogo não conhece. */
const RELATORIO_DUAS_SUPERFICIES = Object.freeze({
    total: 6,
    porSuperficie: { 'mapa.catalogLayers': 4, 'cesium3d.markers': 2 },
    nomeados: [
        { superficie: 'mapa.catalogLayers', grupo: 'dataLayers', id: 'dl-0001' },
        { superficie: 'mapa.catalogLayers', grupo: 'dataLayers', id: 'dl-0002' },
        { superficie: 'mapa.catalogLayers', grupo: 'dataLayers', id: 'dl-0003' },
        { superficie: 'mapa.catalogLayers', grupo: 'dataLayers', id: 'dl-0004' },
        { superficie: 'cesium3d.markers', grupo: 'tilesets', id: 'ts-0001-cidade' },
        { superficie: 'cesium3d.markers', grupo: 'tilesets', id: 'ts-9999-ausente' },
    ],
});

describe('`descreverPerdas`: o texto que o usuário lê antes de perder o restrito', () => {
    it('conta por superfície, rotula em pt-BR e nomeia no máximo três (com "e mais N")', () => {
        const texto = descreverPerdas(RELATORIO_DUAS_SUPERFICIES);
        const linhas = texto.split('\n');

        // PISO: uma linha por superfície do relatório, na ordem em que ele as trouxe.
        expect(linhas).toHaveLength(2);
        expect(linhas[0]).toBe('• 4 camada(s) de catálogo (Hidrografia, Rodovias, Ferrovias e mais 1)');

        // A contagem vem de `porSuperficie` e NÃO do número de nomes: aqui são 2 perdas e
        // um nome só, porque o segundo id não está no catálogo deste cliente.
        expect(linhas[1]).toBe('• 2 marcador(es) 3D (Cidade 3D)');

        // DISCRIMINAÇÃO do teto de três: o quarto nome existe no catálogo e mesmo assim
        // não sai. Sem esta linha, "e mais 1" passaria verde num aviso que listasse tudo.
        expect(texto).not.toContain('Limites Municipais');

        // DISCRIMINAÇÃO do rótulo: a chave crua da superfície não vaza para a tela.
        expect(texto).not.toContain('mapa.catalogLayers');
        expect(texto).not.toContain('cesium3d.markers');
    });

    it('NENHUM id cru aparece no aviso, e os nomes aparecem', () => {
        const texto = descreverPerdas(RELATORIO_DUAS_SUPERFICIES);

        // A ASSERÇÃO QUE MAIS IMPORTA. O id de um 360 é o nome do arquivo da foto e o de um
        // tileset não informa ninguém: nomear o irresolúvel seria despejar metadado.
        const ids = RELATORIO_DUAS_SUPERFICIES.nomeados.map((n) => n.id);
        expect(ids, 'a varredura de ids ficou vazia e passaria verde sem verificar nada')
            .toHaveLength(6);
        for (const id of ids) {
            expect(texto, `o id cru "${id}" vazou para o aviso`).not.toContain(id);
        }

        // CONTROLE POSITIVO: o `not.toContain` acima não é vácuo porque o aviso É sobre
        // esses mesmos recursos — o que sai deles é o NOME.
        expect(texto).toContain('Hidrografia');
        expect(texto).toContain('Cidade 3D');
    });

    it('SUJO: superfície sem nenhum nome resolvível sai contada e SEM parênteses', () => {
        // O 360 é o caso real: `views360` responde sempre `unknown` e a referência gravada é
        // o nome do arquivo da foto, que não pode aparecer.
        const texto = descreverPerdas({
            total: 3,
            porSuperficie: { 'sv360.markers': 3 },
            nomeados: [{ superficie: 'sv360.markers', grupo: 'views360', id: 'foto-alfa.jpg' }],
        });

        expect(texto).toBe('• 3 marcador(es) em foto 360');
        expect(texto).not.toContain('foto-alfa.jpg');
        // No trailing name group. (A bare "(" cannot be the probe: the label itself carries
        // one, in "marcador(es)".)
        expect(texto).not.toMatch(/\([^)]*\)$/);
    });

    it('SUJO: superfície desconhecida cai para a própria chave como rótulo', () => {
        // Superfície nova no registro de referências e ausente do mapa de rótulos: o aviso
        // degrada para a chave em vez de sumir com a linha (perda contada é perda avisada).
        const texto = descreverPerdas({
            total: 1,
            porSuperficie: { 'nova.superficie': 1 },
            nomeados: [],
        });
        expect(texto).toBe('• 1 nova.superficie');
    });

    it('SUJO: o mesmo nome duas vezes na mesma superfície aparece uma vez só', () => {
        const texto = descreverPerdas({
            total: 2,
            porSuperficie: { 'mapa.catalogLayers': 2 },
            nomeados: [
                { superficie: 'mapa.catalogLayers', grupo: 'dataLayers', id: 'dl-0001' },
                { superficie: 'mapa.catalogLayers', grupo: 'dataLayers', id: 'dl-0001' },
            ],
        });
        expect(texto).toBe('• 2 camada(s) de catálogo (Hidrografia)');
    });

    it('sem perda não há aviso: `total: 0` e relatório ausente devolvem null', () => {
        // O GATE É O `total`, e não `porSuperficie`: prendido aqui porque é a diferença que
        // decide se o diálogo aparece.
        expect(descreverPerdas({ total: 0, porSuperficie: { 'mapa.catalogLayers': 4 }, nomeados: [] })).toBeNull();
        expect(descreverPerdas({ total: 0, porSuperficie: {}, nomeados: [] })).toBeNull();
        expect(descreverPerdas(null)).toBeNull();
        expect(descreverPerdas(undefined)).toBeNull();
    });

    it('`nomeDeRecursoConhecido` responde pelos quatro grupos nomeáveis e null fora deles', () => {
        expect(nomeDeRecursoConhecido('basemaps', 'bm-0001-carta')).toBe('Carta Topográfica');
        expect(nomeDeRecursoConhecido('tilesets', 'ts-0001-cidade')).toBe('Cidade 3D');
        expect(nomeDeRecursoConhecido('dataLayers', 'dl-0002')).toBe('Rodovias');
        expect(nomeDeRecursoConhecido('analysisLayers', 'al-0001')).toBe('Declividade');

        // O 360 nunca é nomeável, e id ausente ou grupo desconhecido também não.
        expect(nomeDeRecursoConhecido('views360', 'foto-alfa.jpg')).toBeNull();
        expect(nomeDeRecursoConhecido('dataLayers', 'dl-9999')).toBeNull();
        expect(nomeDeRecursoConhecido('grupo-que-nao-existe', 'dl-0001')).toBeNull();
    });
});

// ============================================================================
// (2) A ESTRUTURA: os dois chamadores avisam e obedecem ao "Cancelar"
// ============================================================================

/**
 * Strips JS comments, walking string literals so a `//` inside a string survives.
 *
 * With `esvaziarStrings`, every character of a literal's BODY becomes a space and the
 * delimiters stay, which keeps the output the SAME LENGTH as the plain pass. That is what
 * lets the brace matcher run over a view where no brace can hide inside a string while the
 * offsets still address the view that kept the strings.
 *
 * @param {string} fonte
 * @param {boolean} [esvaziarStrings=false]
 * @returns {string}
 */
function semComentarios(fonte, esvaziarStrings = false) {
    let saida = '';
    let i = 0;
    while (i < fonte.length) {
        const atual = fonte[i];
        const proximo = fonte[i + 1];
        if (atual === '/' && proximo === '/') {
            while (i < fonte.length && fonte[i] !== '\n') i++;
            continue;
        }
        if (atual === '/' && proximo === '*') {
            i += 2;
            while (i < fonte.length && !(fonte[i] === '*' && fonte[i + 1] === '/')) i++;
            i += 2;
            continue;
        }
        if (atual === '"' || atual === "'" || atual === '`') {
            saida += atual;
            i++;
            while (i < fonte.length) {
                if (fonte[i] === '\\') {
                    saida += esvaziarStrings ? '  ' : fonte[i] + (fonte[i + 1] ?? '');
                    i += 2;
                    continue;
                }
                const fechou = fonte[i] === atual;
                saida += (esvaziarStrings && !fechou) ? ' ' : fonte[i];
                i++;
                if (fechou) break;
            }
            continue;
        }
        saida += atual;
        i++;
    }
    return saida;
}

/**
 * Brace-matched body of the method that follows `ancora`, as a [start, end) index pair on
 * the comment-stripped source. Matching runs on the string-blanked view.
 *
 * @param {string} semStr - comment-stripped, string-blanked source
 * @param {string} ancora
 * @returns {{ini: number, fim: number}|null}
 */
function faixaDoCorpo(semStr, ancora) {
    const declaracao = semStr.indexOf(ancora);
    if (declaracao === -1) return null;
    const abre = semStr.indexOf('{', declaracao);
    if (abre === -1) return null;
    let nivel = 0;
    for (let j = abre; j < semStr.length; j++) {
        if (semStr[j] === '{') {
            nivel++;
        } else if (semStr[j] === '}') {
            nivel--;
            if (nivel === 0) return { ini: abre, fim: j + 1 };
        }
    }
    return null;
}

/**
 * Asserts that a method body asks for confirmation and RETURNS when it is denied, before
 * the irreversible step.
 *
 * @param {string} corpo
 * @param {string} irreversivel - literal that marks the first irreversible call
 * @returns {number} Index of the `showConfirm` call inside `corpo`.
 */
function exigirConfirmacaoQueAborta(corpo, irreversivel) {
    const chamada = /const\s+(\w+)\s*=\s*await\s+showConfirm\s*\(/.exec(corpo);
    expect(chamada, 'nenhum `const x = await showConfirm(` neste corpo').not.toBeNull();

    const aborto = new RegExp(`if\\s*\\(\\s*!${chamada[1]}\\s*\\)\\s*return`).exec(corpo);
    expect(aborto, `a resposta de showConfirm ("${chamada[1]}") não tem um \`if (!x) return\``)
        .not.toBeNull();
    expect(aborto.index).toBeGreaterThan(chamada.index);

    const iIrreversivel = corpo.indexOf(irreversivel);
    expect(iIrreversivel, `âncora "${irreversivel}" não está neste corpo`).toBeGreaterThan(-1);
    expect(aborto.index, `o "Cancelar" só aborta DEPOIS de ${irreversivel}`)
        .toBeLessThan(iIrreversivel);

    return chamada.index;
}

const CAMINHOS = [
    {
        nome: '`.ebgeo` (handleExport)',
        url: URL_EXPORT,
        ancora: 'async handleExport(',
        irreversivel: 'zip.file(',
        // Um par (prosa, código) deste arquivo, para o controle do removedor de comentários.
        prosa: 'Use selected maps or fall back to all maps',
        codigo: 'buildPrunedExportData(mapsToExport)',
    },
    {
        nome: 'Salvar como local (_handleSaveAsLocal)',
        url: URL_MAPS,
        ancora: 'async _handleSaveAsLocal(',
        irreversivel: 'saveActiveRemoteAtlasAsLocal(',
        prosa: 'A MEDIÇÃO DAS PERDAS É FEITA EM MEMÓRIA',
        codigo: 'saveActiveRemoteAtlasAsLocal(',
    },
];

describe('ESTRUTURAL: os dois caminhos de saída avisam e obedecem ao "Cancelar"', () => {
    it('CONTROLE: o removedor de comentários enxerga o CÓDIGO e deixou de enxergar a PROSA', () => {
        // O PAR DE CONTROLE que o CLAUDE.md exige de qualquer guarda que varra texto: sem
        // ele, um comentário citando `descreverPerdas` manteria os casos abaixo verdes
        // depois de a chamada real sumir.
        for (const caso of CAMINHOS) {
            const bruto = readFileSync(caso.url, 'utf8');
            const limpo = semComentarios(bruto);

            expect(bruto, `${caso.nome}: a prosa de controle sumiu do arquivo`).toContain(caso.prosa);
            expect(limpo, `${caso.nome}: a PROSA sobreviveu à remoção de comentários`)
                .not.toContain(caso.prosa);
            expect(limpo, `${caso.nome}: a remoção de comentários comeu CÓDIGO`)
                .toContain(caso.codigo);
        }
        expect(CAMINHOS, 'o laço de controle ficou vazio').toHaveLength(2);

        // E o removedor não pode mexer no conteúdo de um literal de string.
        expect(semComentarios('const s = "a // b"; // fora\nconst t = `c /* d */`;'))
            .toBe('const s = "a // b"; \nconst t = `c /* d */`;');

        // A vista com strings em branco tem o MESMO comprimento, que é o que permite casar
        // os índices do casador de chaves com o texto que preservou as strings.
        const amostra = readFileSync(URL_MAPS, 'utf8');
        expect(semComentarios(amostra, true)).toHaveLength(semComentarios(amostra).length);
        expect(semComentarios('const a = { x: "}{" };', true)).toBe('const a = { x: "  " };');
    });

    it.each(CAMINHOS)('$nome consome `descreverPerdas` e aborta quando a confirmação é negada', (caso) => {
        const bruto = readFileSync(caso.url, 'utf8');
        const limpo = semComentarios(bruto);
        const faixa = faixaDoCorpo(semComentarios(bruto, true), caso.ancora);
        expect(faixa, `a âncora "${caso.ancora}" não casou`).not.toBeNull();

        const corpo = limpo.slice(faixa.ini, faixa.fim);
        // PISO: o recorte é o método inteiro, e não um toco que passaria vazio.
        expect(corpo.length).toBeGreaterThan(600);
        expect(corpo.endsWith('}')).toBe(true);

        // 1. O aviso é MONTADO a partir do relatório, uma vez.
        expect(corpo.match(/descreverPerdas\s*\(/g),
            'nenhuma (ou mais de uma) chamada a `descreverPerdas` neste corpo')
            .toHaveLength(1);

        // 2. Ele é CONFIRMADO, e o "Cancelar" aborta antes do trabalho irreversível.
        const iConfirm = exigirConfirmacaoQueAborta(corpo, caso.irreversivel);

        // 3. E a ordem é a que importa: medir a perda vem ANTES de perguntar.
        expect(corpo.indexOf('descreverPerdas(')).toBeLessThan(iConfirm);
    });
});
