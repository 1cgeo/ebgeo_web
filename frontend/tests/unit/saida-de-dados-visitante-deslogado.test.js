// Path: tests/unit/saida-de-dados-visitante-deslogado.test.js
//
// OS QUATRO ACHADOS DO VISITANTE DESLOGADO na saída de dados e no catálogo, num arquivo só
// porque os quatro compartilham o mesmo sujeito: alguém sem sessão, para quem NADA é privado.
//
//   M8. O aviso de poda dizia "recursos restritos" para quem não tem restrição nenhuma.
//       `isPrivateResource` responde `false` para todo id quando não há sessão (a soma nunca
//       rodou), então CEM POR CENTO do que o anônimo perde é `unknown` — o 360 inteiro, por
//       decisão registrada, mais o que o `config` dele não lista. O relatório já carregava o
//       veredito por perda e `descreverPerdas` o descartava.
//   B3. Crase literal dentro de string de UI. `ConfirmModal` desenha a mensagem como TEXTO
//       PURO, então a convenção de código aparecia na tela.
//   B8. O `.ebgeo` não era nomeado nas abas chamadas "Importar" e "Exportar".
//   B9. O catálogo vazio de quem não entrou não dizia que entrar pode aumentá-lo.
//
// AS DUAS NATUREZAS DE ASSERÇÃO, e as duas são necessárias:
//   1. UNIDADE, sobre função pura: `descreverPerdas` alimentada pelo relatório que o PODADOR
//      REAL produz (e não por um objeto escrito à mão, que provaria só que o formatador
//      formata), e `catalogEmptyNotice`.
//   2. ESTRUTURA, sobre a fonte: o texto novo chega ao `showConfirm`, os dois ponteiros de
//      `.ebgeo` são MONTADOS (e não apenas definidos), e a modal do catálogo PASSA a sessão
//      para a frase pura. Efeito não se prova construindo o objeto: se o caminho até a tela
//      some, estes casos ficam vermelhos.
//
// A VARREDURA ESTRUTURAL RODA SOBRE CÓDIGO, NUNCA SOBRE PROSA: a fonte passa por um removedor
// de comentários ciente de literal de string, e o caso `CONTROLE` prova o par (continua vendo
// o código, deixou de ver a prosa). Sem ele, um comentário citando o símbolo mantém tudo verde
// depois de a chamada sumir — já aconteceu duas vezes neste repositório.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

// O CATÁLOGO QUE ESTE CLIENTE ENXERGA, igual ao do vizinho `aviso-de-perda-de-recursos`:
// `nomeDeRecursoConhecido` só sabe nomear o que está aqui.
vi.mock('@js/config.js', () => ({
    default: {
        basemaps: { 'bm-0001-carta': { name: 'Carta Topográfica' } },
        tilesets: [{ id: 'ts-0001-cidade', name: 'Cidade 3D' }],
        dataLayers: {
            enabled: true,
            layers: [
                { id: 'dl-0001', name: 'Hidrografia' },
                { id: 'dl-0002', name: 'Rodovias' },
            ],
        },
        analysisLayers: { enabled: true, layers: [{ id: 'al-0001', name: 'Declividade' }] },
    },
}));

import {
    descreverPerdas,
    descreverPerdasDoServidor,
} from '../../src/js/catalog/resource-reference.resolver.js';
import {
    RefVerdict,
    podarDocumentoDeExportacao,
} from '../../src/js/catalog/private-reference-pruner.js';
import { catalogEmptyNotice } from '../../src/js/catalog/access-origin-phrases.js';

const SRC = (rel) => new URL(`../../src/js/${rel}`, import.meta.url);

const URL_EXPORT_SERVICE = SRC('import_export/export-import.service.js');
const URL_IMPORT_TAB = SRC('sidebar/tabs/import.tab.js');
const URL_EXPORT_TAB = SRC('sidebar/tabs/export.tab.js');
const URL_CATALOG_MODAL = SRC('catalog/catalog.modal.js');

/** Os arquivos deste lote que carregam string de UI, para a varredura de crase (B3). */
const ARQUIVOS_DE_UI = Object.freeze([
    'import_export/export-import.service.js',
    'catalog/resource-reference.resolver.js',
    'catalog/private-reference-pruner.js',
    'sidebar/tabs/import.tab.js',
    'sidebar/tabs/export.tab.js',
    'catalog/access-origin-phrases.js',
    'catalog/catalog.modal.js',
    'catalog/components/catalog-grid.js',
]);

const CABECALHO_RESTRITO = 'Por restrição de acesso:';
const CABECALHO_DESCONHECIDO = 'Por não dar para confirmar, fora do servidor, que é público:';
const NOTA_360 = 'Toda foto 360 entra nesta lista, inclusive a pública.';

// ============================================================================
// Ferramentas de varredura estrutural
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
 * Brace-matched body of the function/method that follows `ancora`.
 * @param {string} fonte - raw source
 * @param {string} ancora
 * @returns {string|null} The body on the comment-stripped (strings kept) view.
 */
function corpoDe(fonte, ancora) {
    const semStr = semComentarios(fonte, true);
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
            if (nivel === 0) return semComentarios(fonte).slice(abre, j + 1);
        }
    }
    return null;
}

/**
 * Every literal backtick found INSIDE a quoted string of `fonte` (comments excluded).
 *
 * A crase delimitando template literal não conta: o que vaza para a tela é a crase que é
 * CONTEÚDO de uma string, e ela só pode aparecer dentro de aspas simples/duplas ou escapada
 * dentro de um template.
 * @param {string} fonte
 * @returns {string[]} Um trecho por ocorrência, para a mensagem de falha nomear onde está.
 */
function crasesEmStringDeUi(fonte) {
    const limpo = semComentarios(fonte);
    const achados = [];
    for (const re of [/'[^'\n]*`[^'\n]*'/g, /"[^"\n]*`[^"\n]*"/g, /\\`/g]) {
        for (const m of limpo.matchAll(re)) achados.push(m[0]);
    }
    return achados;
}

// ============================================================================
// (1) M8 — o aviso separa as duas naturezas
// ============================================================================

/**
 * O documento de exportação da fixture, com as três situações que interessam.
 *
 * ELE PASSA PELO PODADOR REAL, e essa é a metade que um objeto escrito à mão não prova: o
 * veredito que separa os blocos nasce em `vereditoDe` e é anotado por `anotar`, e é essa
 * cadeia que o aviso passou a ler.
 */
function relatorioReal(resolver) {
    const { relatorio } = podarDocumentoDeExportacao({
        maps: {
            Principal: {
                baseLayer: 'bm-0001-carta',
                catalogLayers: [
                    { type: 'data_layer', originalId: 'dl-0001' },
                    { type: 'data_layer', originalId: 'dl-9999-nao-listada' },
                ],
            },
        },
        streetview360: {
            Principal: {
                markers: [{ photoName: 'foto-alfa.jpg' }, { photoName: 'foto-beta.jpg' }],
            },
        },
    }, resolver);
    return relatorio;
}

/** Alguém COM sessão: uma camada é privada, o resto não se classifica. */
const RESOLVER_COM_SESSAO = (grupo, id) => {
    if (id === 'bm-0001-carta') return RefVerdict.PUBLIC;
    if (id === 'dl-0001') return RefVerdict.PRIVATE;
    return RefVerdict.UNKNOWN;
};

/** O VISITANTE DESLOGADO: nada é privado para ele, porque a soma nunca rodou. */
const RESOLVER_ANONIMO = (grupo, id) => (
    id === 'bm-0001-carta' ? RefVerdict.PUBLIC : RefVerdict.UNKNOWN
);

describe('M8: o aviso de poda separa "restrito" de "não classificável"', () => {
    it('com as duas naturezas, sai um bloco para cada, com o porquê de cada um', () => {
        const texto = descreverPerdas(relatorioReal(RESOLVER_COM_SESSAO));

        // PISO: o relatório que alimenta o texto é o do podador real, e ele contou 4 perdas
        // (a camada de base resolveu PÚBLICA e não entra).
        expect(relatorioReal(RESOLVER_COM_SESSAO).total).toBe(4);

        expect(texto).toBe(
            `${CABECALHO_RESTRITO}\n`
            + '• 1 camada(s) de catálogo (Hidrografia)\n'
            + '\n'
            + `${CABECALHO_DESCONHECIDO}\n`
            + '• 1 camada(s) de catálogo\n'
            + '• 2 marcador(es) em foto 360\n'
            + NOTA_360
        );
    });

    it('VISITANTE DESLOGADO: nada é restrito, então o bloco de restrição NÃO existe', () => {
        const relatorio = relatorioReal(RESOLVER_ANONIMO);
        const texto = descreverPerdas(relatorio);

        // A ASSERÇÃO DO ACHADO. Antes desta divisão, este mesmo texto era emoldurado por um
        // título afirmando que o arquivo saía sem "os recursos restritos".
        expect(texto, 'o anônimo continua sendo acusado de perder recurso restrito')
            .not.toContain(CABECALHO_RESTRITO);
        expect(texto).not.toMatch(/restri/i);

        expect(texto).toContain(CABECALHO_DESCONHECIDO);
        expect(texto).toContain(NOTA_360);

        // CONTROLE POSITIVO: ele PERDE coisa, e a contagem continua inteira.
        expect(relatorio.total).toBe(4);
        expect(texto).toContain('• 2 camada(s) de catálogo');
        expect(texto).toContain('• 2 marcador(es) em foto 360');

        // E nenhum id cru vaza, o nome do arquivo da foto inclusive.
        for (const id of ['foto-alfa.jpg', 'foto-beta.jpg', 'dl-9999-nao-listada', 'dl-0001']) {
            expect(texto, `o id cru "${id}" vazou`).not.toContain(id);
        }
    });

    it('a nota do 360 só aparece quando há 360 no bloco do desconhecido', () => {
        const semTrezentosESessenta = descreverPerdas({
            total: 1,
            porSuperficie: { 'mapa.catalogLayers': 1 },
            nomeados: [{
                superficie: 'mapa.catalogLayers', grupo: 'dataLayers',
                id: 'dl-9999', veredito: RefVerdict.UNKNOWN,
            }],
        });
        expect(semTrezentosESessenta).toBe(`${CABECALHO_DESCONHECIDO}\n• 1 camada(s) de catálogo`);
        expect(semTrezentosESessenta).not.toContain(NOTA_360);

        // DISCRIMINAÇÃO: 360 no bloco RESTRITO (impossível hoje, e é o ponto) não puxa a nota,
        // porque ela fala do bloco do desconhecido.
        const trezentosESessentaRestrito = descreverPerdas({
            total: 1,
            porSuperficie: { 'sv360.markers': 1 },
            nomeados: [{
                superficie: 'sv360.markers', grupo: 'views360',
                id: 'foto.jpg', veredito: RefVerdict.PRIVATE,
            }],
        });
        expect(trezentosESessentaRestrito).not.toContain(NOTA_360);
    });

    it('só uma natureza: um bloco só, e ele diz o porquê', () => {
        const soRestrito = descreverPerdas({
            total: 2,
            porSuperficie: { 'cesium3d.markers': 2 },
            nomeados: [
                { superficie: 'cesium3d.markers', grupo: 'tilesets', id: 'ts-0001-cidade', veredito: RefVerdict.PRIVATE },
                { superficie: 'cesium3d.markers', grupo: 'tilesets', id: 'ts-0002', veredito: RefVerdict.PRIVATE },
            ],
        });
        expect(soRestrito).toBe(`${CABECALHO_RESTRITO}\n• 2 marcador(es) 3D (Cidade 3D)`);
    });

    it('TUDO OU NADA: relatório com veredito faltando ou desconhecido volta à lista única', () => {
        // Um bloco "por restrição" com metade das perdas restritas mentiria por omissão, que é
        // pior do que a lista indiferenciada que ele substitui.
        const meioClassificado = descreverPerdas({
            total: 2,
            porSuperficie: { 'mapa.catalogLayers': 2 },
            nomeados: [
                { superficie: 'mapa.catalogLayers', grupo: 'dataLayers', id: 'dl-0001', veredito: RefVerdict.PRIVATE },
                { superficie: 'mapa.catalogLayers', grupo: 'dataLayers', id: 'dl-0002' },
            ],
        });
        expect(meioClassificado).toBe('• 2 camada(s) de catálogo (Hidrografia, Rodovias)');
        expect(meioClassificado).not.toContain(CABECALHO_RESTRITO);

        // Veredito fora do vocabulário conta como ausente.
        const vereditoEstranho = descreverPerdas({
            total: 1,
            porSuperficie: { 'mapa.catalogLayers': 1 },
            nomeados: [{ superficie: 'mapa.catalogLayers', grupo: 'dataLayers', id: 'dl-0001', veredito: 'talvez' }],
        });
        expect(vereditoEstranho).toBe('• 1 camada(s) de catálogo (Hidrografia)');
    });

    it('o relatório do SERVIDOR continua sem blocos: ele não manda veredito', () => {
        // A poda de LÁ é por destinatário, não keep-list, e o corpo da resposta traz só
        // contagem por superfície de propósito. Inventar natureza ali seria afirmar o que
        // ninguém mediu.
        const texto = descreverPerdasDoServidor({ 'mapa.catalogLayers': 3, 'sv360.markers': 1 });
        expect(texto).toBe('• 3 camada(s) de catálogo\n• 1 marcador(es) em foto 360');
        expect(texto).not.toContain(CABECALHO_RESTRITO);
        expect(texto).not.toContain(CABECALHO_DESCONHECIDO);
        expect(texto).not.toContain(NOTA_360);
    });

    it('SUJO: sem perda não há aviso, com veredito ou sem ele', () => {
        expect(descreverPerdas({ total: 0, porSuperficie: {}, nomeados: [] })).toBeNull();
        expect(descreverPerdas(null)).toBeNull();
        expect(descreverPerdas({ total: 2, porSuperficie: {}, nomeados: [
            { superficie: 'x', grupo: 'dataLayers', id: 'a', veredito: RefVerdict.PRIVATE },
            { superficie: 'x', grupo: 'dataLayers', id: 'b', veredito: RefVerdict.UNKNOWN },
        ] })).toBe(`${CABECALHO_RESTRITO}\n• 1 x\n\n${CABECALHO_DESCONHECIDO}\n• 1 x`);
    });
});

// ============================================================================
// (2) M8 + B3 — a moldura do `showConfirm` chegou à tela
// ============================================================================

describe('ESTRUTURAL: a moldura do aviso de exportação', () => {
    it('o título não afirma mais "restritos", e a mensagem nomeia a REGRA', () => {
        const bruto = readFileSync(URL_EXPORT_SERVICE, 'utf8');
        const corpo = corpoDe(bruto, 'async handleExport(');
        expect(corpo, 'a âncora `async handleExport(` não casou').not.toBeNull();
        expect(corpo.length).toBeGreaterThan(600);

        // O TEXTO ANTIGO SAIU. Ele é falso para o visitante deslogado, para quem 100% da
        // perda é `unknown`.
        expect(corpo).not.toContain('Este arquivo sai sem os recursos restritos');
        expect(corpo).not.toContain('ele nunca leva ');

        // E o novo está no corpo que o `showConfirm` consome.
        expect(corpo).toContain('Este arquivo sai sem parte do catálogo');
        expect(corpo).toContain('comprovadamente público viaja nele');

        // A ORDEM continua sendo a que importa: medir a perda vem antes de perguntar.
        expect(corpo.indexOf('descreverPerdas(')).toBeLessThan(corpo.indexOf('showConfirm('));
    });

    it('B3: nenhuma crase literal dentro de string de UI, nos oito arquivos do lote', () => {
        // A CONVENÇÃO DE CÓDIGO NÃO VAI PARA A TELA. `ConfirmModal` desenha a mensagem como
        // texto puro, então a crase que promete código aparecia como crase.
        expect(ARQUIVOS_DE_UI, 'a lista de arquivos ficou vazia').toHaveLength(8);
        for (const rel of ARQUIVOS_DE_UI) {
            const achados = crasesEmStringDeUi(readFileSync(SRC(rel), 'utf8'));
            expect(achados, `${rel}: crase dentro de string de UI -> ${achados.join(' | ')}`)
                .toEqual([]);
        }
    });

    it('CONTROLE: a varredura de crase enxerga a crase e ignora a de comentário', () => {
        // Sem este par, os oito zeros acima seriam indistinguíveis de uma regra que não casa
        // com nada — a "cobertura vazia" que a constituição chama pelo nome.
        expect(crasesEmStringDeUi("const m = 'Um `.ebgeo` circula por e-mail';"))
            .toEqual(['\'Um `.ebgeo` circula por e-mail\'']);
        expect(crasesEmStringDeUi('const m = "abre o `.ebgeo`";')).toHaveLength(1);
        // A crase que DELIMITA um template não conta. A fixture é montada como template DE
        // VERDADE para não disparar `no-template-curly-in-string` numa string comum.
        const cifrao = '$';
        expect(crasesEmStringDeUi(`const m = \`sai ${cifrao}{x} inteiro\`;`)).toEqual([]);
        expect(crasesEmStringDeUi('// o `.ebgeo` circula por e-mail\nconst m = 1;')).toEqual([]);
        expect(crasesEmStringDeUi('/** O `.ebgeo` é o formato. */\nconst m = 1;')).toEqual([]);
    });

    it('CONTROLE: o removedor de comentários vê o CÓDIGO e deixou de ver a PROSA', () => {
        const bruto = readFileSync(URL_EXPORT_SERVICE, 'utf8');
        const prosa = 'Use selected maps or fall back to all maps';
        const codigo = 'buildPrunedExportData(mapsToExport)';

        expect(bruto, 'a prosa de controle sumiu do arquivo').toContain(prosa);
        expect(semComentarios(bruto), 'a PROSA sobreviveu').not.toContain(prosa);
        expect(semComentarios(bruto), 'o removedor comeu CÓDIGO').toContain(codigo);

        expect(semComentarios('const s = "a // b"; // fora\nconst t = `c /* d */`;'))
            .toBe('const s = "a // b"; \nconst t = `c /* d */`;');
        // A vista com strings em branco tem o MESMO comprimento, que é o que casa os índices.
        expect(semComentarios(bruto, true)).toHaveLength(semComentarios(bruto).length);
    });
});

// ============================================================================
// (3) B8 — as duas abas NOMEIAM o `.ebgeo` e levam até ele
// ============================================================================

const PONTEIROS = [
    {
        nome: 'aba Importar',
        url: URL_IMPORT_TAB,
        ancora: '_createImportOptions() {',
        montagem: '_createEbgeoPointerButton()',
    },
    {
        nome: 'aba Exportar',
        url: URL_EXPORT_TAB,
        ancora: '_createExportOptions() {',
        montagem: 'EXPORT_OPTIONS.ebgeo',
    },
];

describe('B8: as abas Importar e Exportar apontam para onde o `.ebgeo` mora', () => {
    it.each(PONTEIROS)('$nome MONTA o ponteiro e ele leva à aba Mapas', (caso) => {
        const bruto = readFileSync(caso.url, 'utf8');
        const limpo = semComentarios(bruto);
        const corpo = corpoDe(bruto, caso.ancora);
        expect(corpo, `a âncora "${caso.ancora}" não casou`).not.toBeNull();

        // 1. O ponteiro é MONTADO, e não apenas definido: um método que ninguém chama não é
        // uma tela. Este é o caso que fica vermelho quando o `appendChild` some.
        expect(corpo, `o ponteiro não é montado dentro de ${caso.ancora}`)
            .toContain(caso.montagem);

        // 2. Ele NOMEIA o formato, com a extensão, porque é assim que a pessoa o procura.
        expect(limpo).toContain('Arquivo do EBGeo (.ebgeo)');
        expect(limpo).toContain('aba Mapas');

        // 3. E LEVA até lá pelo estado, que é quem a barra (colapsada inclusive) escuta.
        expect(limpo).toContain('SIDEBAR_TABS.MAPAS');
        expect(limpo).toMatch(/expandSidebar\(\s*SIDEBAR_TABS\.MAPAS\s*\)/);

        // 4. E NÃO reimplementa a ação: nenhum seletor de arquivo `.ebgeo` nasce aqui.
        expect(limpo).not.toMatch(/accept\s*=\s*['"]\.ebgeo/);
    });

    it('PISO: a lista de ponteiros não ficou vazia', () => {
        expect(PONTEIROS).toHaveLength(2);
    });
});

// ============================================================================
// (4) B9 — o catálogo vazio de quem não entrou convida a entrar
// ============================================================================

const CONVITE = 'Entrar na sua conta pode revelar itens que só quem tem acesso enxerga.';

describe('B9: o convite do catálogo vazio', () => {
    it('vazio DE VERDADE e sem sessão: a frase diz que entrar pode aumentar a lista', () => {
        const frase = catalogEmptyNotice({ autenticado: false });
        expect(frase).toContain('O catálogo não tem nenhum item para mostrar.');
        expect(frase).toContain(CONVITE);
    });

    it('NÃO CONTA NADA: o convite não afirma quantos nem que existem itens restritos', () => {
        // Cláusula 5.6 (anti-enumeração): dizer "existem N itens privados" a quem não entrou é
        // oráculo de existência. "pode revelar" é a única forma honesta.
        const frase = catalogEmptyNotice({ autenticado: false });
        expect(frase).not.toMatch(/\d/);
        expect(frase).toMatch(/pode revelar/);
        expect(frase).not.toMatch(/existem|há itens|itens privados/i);
    });

    it('quem JÁ ENTROU não lê o convite, e o default é o silêncio', () => {
        expect(catalogEmptyNotice({ autenticado: true })).not.toContain(CONVITE);
        // Sem saber quem olha, calar: convite mostrado a quem já entrou é pior que nenhum.
        expect(catalogEmptyNotice()).not.toContain(CONVITE);
        expect(catalogEmptyNotice({ autenticado: true }))
            .toBe('O catálogo não tem nenhum item para mostrar.');
    });

    it('com filtro ligado o convite NÃO aparece, nem para quem não entrou', () => {
        // Ali o gesto útil é desligar o filtro, e um convite ao lado dele disputaria a atenção
        // com o conselho que resolve a tela.
        for (const estado of [
            { temBusca: true },
            { tiposAtivos: 2 },
            { acessosAtivos: ['publico'] },
        ]) {
            const frase = catalogEmptyNotice({ ...estado, autenticado: false });
            expect(frase, `${JSON.stringify(estado)} trouxe o convite`).not.toContain(CONVITE);
            expect(frase).toMatch(/desligue|limpe/i);
        }
    });

    it('SUJO: `autenticado` lixo não vira "undefined" na tela nem inventa restrição', () => {
        for (const lixo of [null, undefined, 0, '', 'sim', NaN]) {
            const frase = catalogEmptyNotice({ autenticado: lixo });
            expect(frase).not.toMatch(/NaN|undefined|null/);
            expect(frase).toContain('O catálogo não tem nenhum item para mostrar.');
        }
    });

    it('ESTRUTURAL: a modal do catálogo PASSA a sessão para a frase pura', () => {
        // `access-origin-phrases.js` é folha de ZERO IMPORTS por contrato, então o predicado
        // entra como parâmetro. Sem esta passagem a frase pura existe e nunca é exercitada:
        // o default (`autenticado: true`) cala o convite para todo mundo.
        const limpo = semComentarios(readFileSync(URL_CATALOG_MODAL, 'utf8'));
        const chamada = /catalogEmptyNotice\(\{[\s\S]*?\}\)/.exec(limpo);
        expect(chamada, 'nenhuma chamada a `catalogEmptyNotice({...})` na modal').not.toBeNull();
        expect(chamada[0]).toMatch(/autenticado:\s*sessionContext\.isAuthenticated\(\)/);
    });

    it('ESTRUTURAL: o módulo de frases continua com ZERO imports', () => {
        // O contrato que impede o convite de ser resolvido lá dentro: dois chunks diferentes o
        // consomem, e qualquer import daqui chegaria aos dois.
        const limpo = semComentarios(readFileSync(SRC('catalog/access-origin-phrases.js'), 'utf8'));
        expect(limpo).not.toMatch(/^\s*import\s/m);
        expect(limpo).not.toMatch(/\brequire\s*\(/);
        // CONTROLE: o arquivo foi mesmo lido.
        expect(limpo).toContain('export function catalogEmptyNotice(');
    });
});
