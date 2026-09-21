// Path: tests/unit/conversao-de-ponto-respeita-trava.repro.test.js
//
// ACHADO N2: O MENU OFERECIA "CONVERTER PARA SÍMBOLO MILITAR" E "CONVERTER PARA MEDIDA DE
// COORDENAÇÃO" A QUALQUER PONTO, SEM PERGUNTA NENHUMA, E O CLIQUE CONVERTIA DIRETO.
//
// ================= A CAUSA ====================================================
//
// O bloco "Add conversion options for point features" de
// `src/js/tool_manager/helpers/feature-header.helpers.js` desenhava os dois comandos sempre
// que a seleção era um ponto, e o `click` chamava a conversão sem consultar papel nem estado.
// As folhas da store (`addFeature`/`removeFeature`) têm `guardWrite`, que recusa por PAPEL e
// por MAPA travado, mas NÃO consultam a trava da FEIÇÃO nem a da CAMADA, que são convenção de
// tela: converter um ponto bloqueado funcionava INTEIRO.
//
// A ironia da classe é a vizinhança: o irmão LINEAR, duas linhas acima no MESMO menu, já
// passava por `linearConversionActions` e recusava o clique nomeando o estado. Um Leitor via
// os comandos de ponto e não via os de linha; um ponto numa camada travada convertia e uma
// linha na mesma camada não.
//
// ================= A REGRA QUE O CONSERTO APLICA ==============================
//
// "O POSTO some, o ESTADO recusa o clique" (`.claude/rules/architecture.md` §UI Architecture):
//
//   - POSTO (falta `CREATE_FEATURE` ou `DELETE_FEATURE`, porque converter é criar MAIS apagar)
//     não desenha o comando;
//   - ESTADO (mapa travado, feição/camada/grupo bloqueados) desenha com `aria-disabled` e o
//     clique recusa NOMEANDO o estado, porque o clique é como o motivo chega à pessoa.
//
// ================= O QUE ESTE ARQUIVO MEDE, E O QUE NÃO =======================
//
// A DECISÃO, que é pura (`src/js/tool_manager/helpers/point-conversion.model.js`), e a FIAÇÃO
// por leitura textual do menu, que em node puro não carrega (ele importa o barril da store, o
// despachante de GeoJSON e o MapLibre). O comportamento na tela (o toast que aparece no clique
// recusado) é do Playwright. Os dois medem coisas diferentes de propósito: um verde aqui com o
// desenho errado continua verde, e vice-versa.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    POINT_CONVERSION_CAPABILITIES,
    POINT_CONVERSION_LABELS,
    POINT_CONVERSION_TARGETS,
    pointConversionActions,
    pointConversionTargets,
} from '@js/tool_manager/helpers/point-conversion.model.js';
import {
    LINEAR_CONVERSION_CAPABILITIES,
    LOCKED_FEATURE_NOTICE,
    LOCKED_MAP_NOTICE,
    linearConversionActions,
} from '@js/tool_manager/helpers/linear-conversion.model.js';

/** Um predicado de capacidade que permite tudo. */
const PODE_TUDO = () => true;

/** Um predicado que permite tudo MENOS a chave dada. */
const podeMenos = (proibida) => (key) => key !== proibida;

describe('N2 — a tabela de decisão da conversão de ponto', () => {
    it('PISO: a tabela não é vazia, e os rótulos são os dois do menu', () => {
        // Sem esta asserção de PRESENÇA, os casos de ausência abaixo ficariam vacuamente
        // verdes com um modelo que não devolvesse nada nunca.
        expect(POINT_CONVERSION_TARGETS).toEqual(['military_symbol', 'coordination_measure']);
        expect(POINT_CONVERSION_LABELS.military_symbol).toBe('Converter para Símbolo Militar');
        expect(POINT_CONVERSION_LABELS.coordination_measure).toBe('Converter para Medida de Coordenação');
    });

    it('TUDO LIVRE: os dois comandos aparecem, na ordem do menu, e nenhum recusa', () => {
        const acoes = pointConversionActions({ source: 'point', can: PODE_TUDO });

        expect(acoes).toEqual([
            { target: 'military_symbol', blocked: null },
            { target: 'coordination_measure', blocked: null },
        ]);
    });

    it('POSTO SEM CRIAR: o comando NÃO é desenhado', () => {
        // Quem não pode criar não vira Editor a partir deste menu, e uma linha morta dizendo
        // "exige Editor" transforma o menu num catálogo do que a pessoa não é.
        const acoes = pointConversionActions({
            source: 'point',
            can: podeMenos('CREATE_FEATURE'),
        });
        expect(acoes).toEqual([]);
    });

    it('POSTO SEM APAGAR: o comando NÃO é desenhado', () => {
        // A metade que uma implementação apressada perde: converter APAGA o ponto de origem, e
        // gatear só pelo CREATE ofereceria a quem edita e não apaga uma travessia que morre na
        // metade, deixando as DUAS feições vivas.
        const acoes = pointConversionActions({
            source: 'point',
            can: podeMenos('DELETE_FEATURE'),
        });
        expect(acoes).toEqual([]);
    });

    it('MAPA TRAVADO: os comandos são desenhados e o clique recusa nomeando o mapa', () => {
        const acoes = pointConversionActions({ source: 'point', can: PODE_TUDO, mapLocked: true });

        expect(acoes).toHaveLength(2);
        for (const acao of acoes) {
            expect(acao.blocked).toBe(LOCKED_MAP_NOTICE);
        }
        // A frase NOMEIA o estado e diz o que a pessoa pode fazer para revertê-lo.
        expect(LOCKED_MAP_NOTICE).toContain('Destrave');
    });

    it('FEIÇÃO BLOQUEADA: os comandos são desenhados e o clique recusa nomeando a feição', () => {
        // `featureLocked` é o resultado de `isFeatureEffectivelyLocked`, que soma o `bloqueado`
        // da feição, o `locked` da CAMADA e o do grupo: as três travas caem nesta mesma frase.
        const acoes = pointConversionActions({ source: 'point', can: PODE_TUDO, featureLocked: true });

        expect(acoes).toHaveLength(2);
        for (const acao of acoes) {
            expect(acao.blocked).toBe(LOCKED_FEATURE_NOTICE);
        }
        expect(LOCKED_FEATURE_NOTICE).toContain('Desbloqueie');
    });

    it('MAPA TRAVADO tem precedência sobre feição bloqueada', () => {
        // O cadeado do mapa é o que a pessoa tem mais chance de não saber que está ligado, e é
        // a mesma ordem do irmão linear: duas telas do mesmo produto não podem discordar sobre
        // qual estado nomear quando os dois valem.
        const acoes = pointConversionActions({
            source: 'point',
            can: PODE_TUDO,
            mapLocked: true,
            featureLocked: true,
        });
        expect(acoes[0].blocked).toBe(LOCKED_MAP_NOTICE);
    });

    it('FONTE QUE NÃO É PONTO: nenhum comando, nem para os próprios destinos', () => {
        // Símbolo militar e medida de coordenação NÃO voltam a ser ponto nem se convertem
        // entre si: inventar esses sentidos aqui prometeria comandos que não existem do outro
        // lado. E os tipos lineares têm o menu deles, que é outra tabela.
        for (const source of ['military_symbol', 'coordination_measure', 'line', 'arrow',
            'polygon', 'text', 'image', 'magnetic_declination']) {
            expect(pointConversionActions({ source, can: PODE_TUDO }), source).toEqual([]);
        }
    });

    it('o POSTO é perguntado mesmo para a fonte errada não custar nada, e a ORDEM é forma primeiro', () => {
        // Fonte errada sai antes de perguntar capacidade: o menu desenha o bloco de ponto para
        // toda seleção única, e um `checkPermission` por abertura de menu sobre um polígono
        // seria trabalho sem resposta possível.
        let perguntas = 0;
        pointConversionActions({ source: 'polygon', can: () => { perguntas++; return true; } });
        expect(perguntas).toBe(0);

        perguntas = 0;
        pointConversionActions({ source: 'point', can: () => { perguntas++; return true; } });
        expect(perguntas).toBe(POINT_CONVERSION_CAPABILITIES.length);
    });
});

describe('N2 — o gate de posto FALHA FECHADA', () => {
    it('predicado que LANÇA esconde os comandos', () => {
        const acoes = pointConversionActions({
            source: 'point',
            can: () => { throw new Error('sessão caiu no meio'); },
        });
        expect(acoes).toEqual([]);
    });

    it('predicado ausente ou que não é função esconde os comandos', () => {
        expect(pointConversionActions({ source: 'point' })).toEqual([]);
        expect(pointConversionActions({ source: 'point', can: null })).toEqual([]);
        expect(pointConversionActions({ source: 'point', can: 'sim' })).toEqual([]);
        expect(pointConversionActions()).toEqual([]);
    });

    it('truthy que NÃO é `true` esconde os comandos', () => {
        // `checkPermission(k).allowed` devolve booleano; um chamador que injete outra coisa
        // (um objeto de veredito inteiro, por exemplo) seria lido como permissão se a
        // comparação fosse frouxa. Perder um clique custa menos que oferecer trabalho que a
        // store recusa.
        for (const truthy of [1, 'true', {}, [], 'allowed']) {
            expect(pointConversionActions({ source: 'point', can: () => truthy })).toEqual([]);
        }
        // E o par que prova que a asserção acima não é vacuidade: `true` passa.
        expect(pointConversionActions({ source: 'point', can: () => true })).toHaveLength(2);
    });
});

describe('N2 — o modelo de ponto e o linear falam a MESMA língua', () => {
    it('a forma de retorno é a mesma, porque o desenho é o mesmo laço', () => {
        const ponto = pointConversionActions({ source: 'point', can: PODE_TUDO, mapLocked: true });
        const linear = linearConversionActions({
            source: 'line',
            can: PODE_TUDO,
            mapLocked: true,
            feature: {
                properties: { source: 'line', baseCoordinates: [[0, 0], [1, 1]] },
                geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
            },
        });

        expect(linear.length).toBeGreaterThan(0);
        expect(Object.keys(ponto[0]).sort()).toEqual(Object.keys(linear[0]).sort());
        // E a MESMA frase sobre o mesmo cadeado: duas cópias divergiriam na primeira redação.
        expect(ponto[0].blocked).toBe(linear[0].blocked);
    });

    it('as capacidades são as MESMAS duas, e são lidas de lá em vez de reescritas', () => {
        expect(POINT_CONVERSION_CAPABILITIES).toEqual(['CREATE_FEATURE', 'DELETE_FEATURE']);
        expect(POINT_CONVERSION_CAPABILITIES).toBe(LINEAR_CONVERSION_CAPABILITIES);
    });

    it('`pointConversionTargets` devolve array NOVO, e não a constante congelada', () => {
        // Quem receber a lista pode ordenar ou filtrar; devolver a constante faria isso
        // lançar (ela é `Object.freeze`) ou, pior, mutar a tabela do módulo.
        const a = pointConversionTargets('point');
        const b = pointConversionTargets('point');
        expect(a).toEqual(['military_symbol', 'coordination_measure']);
        expect(a).not.toBe(b);
        expect(a).not.toBe(POINT_CONVERSION_TARGETS);
    });
});

// ================= A FIAÇÃO, POR LEITURA DO TEXTO ============================

const CAMINHO_MENU = fileURLToPath(
    new URL('../../src/js/tool_manager/helpers/feature-header.helpers.js', import.meta.url)
);
const BRUTO = readFileSync(CAMINHO_MENU, 'utf8');

/**
 * Strips JS comments, walking string literals so a `//` inside a string survives.
 * @param {string} fonte - Source text
 * @returns {string} Source without comments
 */
function semComentarios(fonte) {
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
            const aspa = atual;
            saida += fonte[i++];
            while (i < fonte.length && fonte[i] !== aspa) {
                if (fonte[i] === '\\') saida += fonte[i++];
                if (i < fonte.length) saida += fonte[i++];
            }
            if (i < fonte.length) saida += fonte[i++];
            continue;
        }
        saida += fonte[i++];
    }
    return saida;
}

const FONTE = semComentarios(BRUTO);

/**
 * O BLOCO que desenha as conversões de PONTO, e não o arquivo inteiro.
 *
 * O recorte importa: o arquivo tem um `button.disabled = ...` legítimo (a engrenagem, quando a
 * seleção mistura tipos), e varrer o arquivo todo pela propriedade proibida acusaria esse. O
 * bloco vai da chamada à tabela até a linha que anexa o menu ao documento, que é o fim da
 * função de desenho.
 * @returns {string} O trecho do desenho das conversões de ponto, sem comentários
 */
function blocoDePonto() {
    const inicio = FONTE.indexOf('pointConversionActions({');
    const fim = FONTE.indexOf('document.body.appendChild(dropdown)', inicio);
    if (inicio < 0 || fim < 0 || fim <= inicio) return '';
    return FONTE.slice(inicio, fim);
}

/**
 * O corpo de uma das duas funções de conversão, sem comentários.
 * @param {string} nome - Nome da função
 * @returns {string} O corpo, do cabeçalho até a função seguinte (ou o fim do arquivo)
 */
function corpoDaConversao(nome) {
    const inicio = FONTE.indexOf(`async function ${nome}(`);
    if (inicio < 0) return '';
    const fim = FONTE.indexOf('\nasync function ', inicio + 1);
    return FONTE.slice(inicio, fim < 0 ? FONTE.length : fim);
}

describe('N2 — a fiação entre a decisão e o desenho do menu de ponto', () => {
    it('CONTROLE: a varredura enxerga o CÓDIGO e deixou de enxergar a PROSA', () => {
        // O par que a constituição exige de qualquer guarda que varra texto. O cabeçalho do
        // próprio menu cita por extenso os símbolos procurados abaixo, e uma remoção de
        // comentários quebrada deixaria os casos de ausência verdes pela prosa.
        const PROSA = 'E ELAS DEIXARAM DE SER AS DUAS SEM GATE';
        expect(BRUTO, 'a prosa de controle sumiu do arquivo').toContain(PROSA);
        expect(FONTE, 'a PROSA sobreviveu à remoção de comentários').not.toContain(PROSA);

        expect(FONTE).toContain('pointConversionActions');
        expect(semComentarios('const s = "a // b"; // fora\nconst t = `c /* d */`;'))
            .toBe('const s = "a // b"; \nconst t = `c /* d */`;');
    });

    it('o recorte do bloco de ponto não veio vazio', () => {
        // PISO: sem ele, todas as asserções de ausência abaixo ficariam vacuamente verdes.
        const bloco = blocoDePonto();
        expect(bloco.length, 'o recorte do bloco de ponto falhou').toBeGreaterThan(300);
        expect(bloco).toContain('POINT_CONVERSION_LABELS');
    });

    it('o desenho CONSULTA a tabela, e injeta os três estados que ela pede', () => {
        const bloco = blocoDePonto();
        // O predicado de posto é `checkPermission`, nunca um nome de papel: comparar posto por
        // igualdade é a lista fechada que a constituição proíbe neste eixo.
        expect(bloco).toMatch(/can:\s*\(key\)\s*=>\s*checkPermission\(key\)\.allowed/);
        expect(bloco).toMatch(/mapLocked:\s*isCurrentMapLockedSync\(\)/);
        expect(bloco).toMatch(/featureLocked:\s*isFeatureEffectivelyLocked\(/);
        expect(bloco).toMatch(/source:\s*currentFeature\?\.properties\?\.source/);
    });

    it('o item bloqueado sai com `aria-disabled` e com `title`', () => {
        const bloco = blocoDePonto();
        expect(bloco).toContain("setAttribute('aria-disabled', 'true')");
        expect(bloco).toMatch(/\.title\s*=\s*blocked/);
    });

    it('o bloco NÃO usa a propriedade `disabled`, que mataria o clique', () => {
        const bloco = blocoDePonto();
        expect(bloco, 'a propriedade `disabled` entrou no bloco de conversão de ponto')
            .not.toMatch(/\.disabled\s*=/);

        // DISCRIMINAÇÃO: a varredura ACHA a propriedade quando ela existe. A engrenagem, fora
        // do bloco, continua usando-a legitimamente, e é o par que prova que o `not.toMatch`
        // acima não é vacuidade.
        expect(FONTE, 'o arquivo perdeu o `disabled` legítimo do botão de engrenagem')
            .toMatch(/button\.disabled\s*=\s*shouldDisable/);
    });

    it('o clique recusado mostra a frase e PARA; o clique livre converte', () => {
        const bloco = blocoDePonto();
        expect(bloco).toContain('showWarning(blocked)');
        // O `return` depois do aviso: sem ele, o clique recusado avisaria E converteria.
        expect(bloco).toMatch(/showWarning\(blocked\);\s*return;/);
        expect(bloco).toMatch(/POINT_CONVERSION_RUNNERS\[target\]\(currentFeature,\s*selectionManager,\s*uiManager\)/);
    });

    it('o rótulo vem da tabela, e os literais antigos sumiram do arquivo', () => {
        const bloco = blocoDePonto();
        expect(bloco).toContain('POINT_CONVERSION_LABELS[target]');
        // Duas fontes para o mesmo texto divergem na primeira renomeação.
        expect(FONTE).not.toContain("textContent = 'Converter para Símbolo Militar'");
        expect(FONTE).not.toContain("textContent = 'Converter para Medida de Coordenação'");
    });

    it('a tabela de executores cobre os DOIS destinos declarados pelo modelo', () => {
        const bloco = blocoDePonto();
        for (const target of POINT_CONVERSION_TARGETS) {
            expect(bloco, `o executor de '${target}' sumiu da tabela`).toContain(`${target}:`);
        }
        expect(bloco).toContain('convertPointToMilitarySymbol');
        expect(bloco).toContain('convertPointToCoordinationMeasure');
    });

    it('o separador só é desenhado quando há comando, e não quando a fonte é ponto', () => {
        // Antes ele saía de `source === 'point'`, então o Leitor ganhava um separador solto
        // pendurado em nada. Agora ele depende do que a tabela devolveu.
        const bloco = blocoDePonto();
        expect(bloco).toMatch(/pointConversions\.length\s*>\s*0/);
        expect(bloco, 'o desenho voltou a decidir por `source === \'point\'`')
            .not.toMatch(/source\s*===\s*'point'/);
    });
});

describe('N2 — as DUAS funções de conversão RECONSULTAM o predicado', () => {
    for (const nome of ['convertPointToMilitarySymbol', 'convertPointToCoordinationMeasure']) {
        it(`${nome} pergunta antes de QUALQUER efeito`, () => {
            const corpo = corpoDaConversao(nome);
            expect(corpo.length, `o corpo de ${nome} não foi encontrado`).toBeGreaterThan(400);

            const iGate = corpo.indexOf('pointConversionDenial(pointFeature)');
            expect(iGate, `${nome} não reconsulta o predicado`).toBeGreaterThan(-1);
            expect(corpo).toMatch(/showWarning\(denial\);\s*return;/);

            // A ORDEM é o que importa: o gate tem de vir antes de cunhar id, de gerar bitmap,
            // de gravar blob e das duas escritas da store. Perguntar depois de qualquer um
            // deles deixa lixo (um blob órfão, um id gasto) mesmo na recusa.
            for (const efeito of [
                'IDUtils.generateFeatureIds()',
                'storeImage(',
                'addFeature(',
                'removeFeature(',
                'startBatchUndo()',
            ]) {
                const iEfeito = corpo.indexOf(efeito);
                expect(iEfeito, `${efeito} sumiu de ${nome}`).toBeGreaterThan(-1);
                expect(iGate, `${nome} reconsulta DEPOIS de ${efeito}`).toBeLessThan(iEfeito);
            }
        });
    }

    it('a reconsulta pergunta pelas DUAS capacidades e pelos DOIS estados', () => {
        const i = FONTE.indexOf('function pointConversionDenial');
        expect(i, '`pointConversionDenial` sumiu').toBeGreaterThan(-1);
        const corpo = FONTE.slice(i, FONTE.indexOf('\n}', i));

        // As capacidades vêm da lista do modelo, e não escritas à mão aqui: uma terceira
        // cópia divergiria da do menu no primeiro ajuste.
        expect(corpo).toContain('POINT_CONVERSION_CAPABILITIES');
        expect(corpo).toContain('checkPermission(key)');
        // A frase do posto é keyed pela CAPACIDADE, nunca pelo papel.
        expect(corpo).toContain('denialNotice(perm.required)');
        expect(corpo).toContain('isCurrentMapLockedSync()');
        expect(corpo).toContain('isFeatureEffectivelyLocked(pointFeature)');
        expect(corpo).toContain('LOCKED_MAP_NOTICE');
        expect(corpo).toContain('LOCKED_FEATURE_NOTICE');
    });
});
