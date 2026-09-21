// Path: tests/unit/painel-temporal-recusa-janela-e-ancora.test.js

/**
 * @fileoverview OS DEFEITOS QUE ESTE ARQUIVO PRENDE, todos do painel de atributos
 * temporais (`src/js/temporal/temporal-attributes-section.js`), achados na auditoria
 * de 2026-09-21. A causa é a mesma em quatro dos cinco: o painel DECIDIA dentro do
 * DOM, e o que só existe dentro do DOM nunca teve teste nesta suíte (ambiente node).
 * As decisões saíram para `src/js/temporal/temporal-attributes.model.js`, e é lá que
 * cada regra abaixo é medida; o painel continua sendo exercido contra o dublê de
 * `document`, para provar que a decisão CHEGA à tela.
 *
 *  - M6 (= E6): fim ANTERIOR ao início era aceito sem uma palavra. Nenhum cursor
 *    satisfaz `inicio <= cursor <= fim` invertido, então a feição sumia para sempre
 *    do 3D, do 360 e da legenda do PDF, enquanto o mapa 2D podia continuar a
 *    desenhá-la (o filtro de lá testa uma célula, não o instante).
 *  - E4: trocar o instante de um ponto-chave para antes do primeiro mudava quem é a
 *    ÂNCORA sem mover geometria nenhuma. A âncora é a posição de partida da feição
 *    (`trajectory-anchor.js`), e o `_persist` seguinte do editor do mapa reimpõe a
 *    âncora à geometria: a feição TELEPORTAVA, longe do gesto que causou isso.
 *  - E8: `deriveDtgFields` só escrevia com instante finito, então apagar o "Início"
 *    de um símbolo com GDH automático deixava o GDH ANTIGO impresso e gravado.
 *  - E11: `input.min`/`input.max` nos campos de data, sob um comentário que os
 *    chamava de "highlight". O navegador não destaca, ele RECUSA fora da janela, e a
 *    janela vem da extensão das feições que já existem.
 *  - E12: a caixa de GDH automático usava a propriedade `disabled` no modo relativo,
 *    que é estado REVERSÍVEL, e o motivo não chegava por caminho nenhum (no toque
 *    nem `title` existe). E o gate era só de tela: a derivação continuava.
 *  - E2: "Limpar" apagava a trajetória inteira sem perguntar, num módulo em que
 *    NENHUMA edição de trajetória tinha desfazer (só o arrasto do primeiro ponto, que
 *    segue por outro caminho: o mesmo gesto com duas regras). Hoje o `persist()` da
 *    seção pede `recordUndo` e a pergunta nomeia a volta; a janela de validade
 *    continua fora, por decisão escrita no código e presa no bloco 7.
 *
 * O ALCANCE DO BLOCO 8, dito em voz alta: os dois painéis de marcador (3D e 360) não
 * são montáveis em node (puxam Cesium e o visualizador 360), então ali a prova é por
 * LEITURA DE FONTE, que prova EXISTÊNCIA da fiação e nunca EXECUÇÃO dela. É a mesma
 * limitação declarada em `painel-temporal-solta-a-inscricao.test.js` §5.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from '../../src/js/events/event_emitter.js';
import { makeDocumentStub, fire } from '../helpers/dom-double.js';
import { DEFAULT_TEMPORAL_CONFIG, TEMPORAL_MODES } from '../../src/js/temporal/temporal.constants.js';
import {
    validarJanela,
    fraseDeJanelaInvertida,
    decidirTrocaDeInstante,
    derivarCamposDtg,
    fraseDeLimpezaDeTrajetoria,
    fraseDaJanelaDaRegua,
    GDH_LIGA_SO_NO_ABSOLUTO,
} from '../../src/js/temporal/temporal-attributes.model.js';

// Mutable box read at CALL time by the hoisted mock factories below.
const box = vi.hoisted(() => ({
    bus: null,
    config: null,
    escritas: [],
    avisos: [],
    confirmacoes: [],
    respostaDoConfirm: true,
}));

// PARTIAL mock of the store barrel, in the shape `painel-temporal-solta-a-inscricao`
// already uses: everything else stays real, only the four doors this file steers are
// replaced. `updateFeatureProperty` becomes the LEDGER of what the panel persisted,
// which is the ruler for "a refused edit writes nothing".
vi.mock('@store', async (importOriginal) => {
    const original = await importOriginal();
    return {
        ...original,
        getEventBus: () => box.bus,
        getControl: () => null,
        getMapTemporalConfigSync: () => box.config,
        updateFeatureProperty: (...args) => { box.escritas.push(args); },
    };
});

vi.mock('@utils/toast_service.js', () => ({
    showWarning: (msg) => { box.avisos.push(msg); },
    showToast: () => {},
    showSuccess: () => {},
    showError: () => {},
}));

vi.mock('@modals/confirm.modal.js', () => ({
    showConfirm: async (titulo, opcoes) => {
        box.confirmacoes.push({ titulo, ...opcoes });
        return box.respostaDoConfirm;
    },
}));

const {
    createTemporalValiditySection,
    createTemporalAttributesSection,
    createTrajectorySection,
} = await import('../../src/js/temporal/temporal-attributes-section.js');

/** 20/11/2024 14:00 UTC — the reference instant for every GDH assertion. */
const T_NOV = Date.UTC(2024, 10, 20, 14, 0);
const UMA_HORA = 3_600_000;

/** Depth-first search for the first element matching `pred`. */
function acharNaArvore(raiz, pred) {
    if (!raiz) return null;
    if (pred(raiz)) return raiz;
    for (const filho of raiz.children || []) {
        const achado = acharNaArvore(filho, pred);
        if (achado) return achado;
    }
    return null;
}

/** Every element matching `pred`, in document order. */
function todosNaArvore(raiz, pred, saida = []) {
    if (!raiz) return saida;
    if (pred(raiz)) saida.push(raiz);
    for (const filho of raiz.children || []) todosNaArvore(filho, pred, saida);
    return saida;
}

const ehInputDeData = (el) => el.tagName === 'INPUT' && el.type === 'datetime-local';
const ehCheckbox = (el) => el.tagName === 'INPUT' && el.type === 'checkbox';

/** The two date inputs of a validity section, in render order (Início, Fim). */
function inputsDeData(section) {
    return todosNaArvore(section, ehInputDeData);
}

/** Types a datetime-local value into an input and fires the change the panel listens to. */
function digitar(input, valor) {
    input.value = valor;
    fire(input, 'change');
}

/** A `datetime-local` string for an epoch, in the local zone the panel writes/reads. */
function comoLocal(epoch) {
    const d = new Date(epoch);
    const p2 = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

let previousDocument;

beforeEach(() => {
    box.bus = new EventEmitter();
    box.config = { ...DEFAULT_TEMPORAL_CONFIG };
    box.escritas = [];
    box.avisos = [];
    box.confirmacoes = [];
    box.respostaDoConfirm = true;
    previousDocument = globalThis.document;
    globalThis.document = makeDocumentStub();
});

afterEach(() => {
    globalThis.document = previousDocument;
});

describe('painel temporal: o que ele recusa, o que ele apaga e o que ele pergunta', () => {
    // 1. M6/E6 — a decisão pura. Uma janela invertida não contém instante nenhum.
    describe('1. janela invertida é recusada (M6/E6)', () => {
        it('início DEPOIS do fim é recusado, nomeando os dois campos', () => {
            const decisao = validarJanela('temporalInicio', T_NOV + UMA_HORA, {
                temporalInicio: T_NOV - UMA_HORA,
                temporalFim: T_NOV,
            });

            expect(decisao.aceita).toBe(false);
            expect(decisao.campo).toBe('Início');
            expect(decisao.oposto).toBe('Fim');
            expect(decisao.limite).toBe(T_NOV);
        });

        it('fim ANTES do início é recusado, com os papéis trocados', () => {
            const decisao = validarJanela('temporalFim', T_NOV - UMA_HORA, {
                temporalInicio: T_NOV,
                temporalFim: null,
            });

            expect(decisao.aceita).toBe(false);
            expect(decisao.campo).toBe('Fim');
            expect(decisao.oposto).toBe('Início');
            expect(decisao.limite).toBe(T_NOV);
        });

        it('janela INSTANTÂNEA (início igual ao fim) é aceita: ela é visível num instante', () => {
            expect(validarJanela('temporalFim', T_NOV, { temporalInicio: T_NOV, temporalFim: null }).aceita).toBe(true);
            expect(validarJanela('temporalInicio', T_NOV, { temporalInicio: null, temporalFim: T_NOV }).aceita).toBe(true);
        });

        it('bordas: limpar um limite, o outro limite ausente, NaN e propriedade estranha passam', () => {
            expect(validarJanela('temporalInicio', null, { temporalInicio: T_NOV, temporalFim: T_NOV - UMA_HORA }).aceita).toBe(true);
            expect(validarJanela('temporalFim', T_NOV - UMA_HORA, { temporalInicio: null, temporalFim: null }).aceita).toBe(true);
            expect(validarJanela('temporalFim', Number.NaN, { temporalInicio: T_NOV, temporalFim: null }).aceita).toBe(true);
            expect(validarJanela('temporalFim', T_NOV, { temporalInicio: Number.NaN, temporalFim: null }).aceita).toBe(true);
            expect(validarJanela('trajetoria', 1, { temporalInicio: T_NOV, temporalFim: T_NOV }).aceita).toBe(true);
            expect(validarJanela('temporalInicio', T_NOV, undefined).aceita).toBe(true);
        });

        it('a frase nomeia o campo editado, o campo que conflita e o instante dele', () => {
            const decisao = validarJanela('temporalFim', T_NOV - UMA_HORA, { temporalInicio: T_NOV, temporalFim: null });
            const frase = fraseDeJanelaInvertida(decisao, '20/11/2024 11:00');

            expect(frase).toContain('Fim recusado');
            expect(frase).toContain('antes do Início');
            expect(frase).toContain('20/11/2024 11:00');
        });
    });

    // 2. M6/E6 na TELA: a decisão tem de chegar ao campo, e o campo tem de voltar.
    describe('2. o painel recusa na tela e devolve o campo ao valor anterior (M6/E6)', () => {
        it('digitar um fim anterior ao início: não grava, avisa e o campo volta', () => {
            const gravadas = [];
            const section = createTemporalValiditySection({
                inicio: T_NOV,
                fim: null,
                onChange: (prop, epoch) => gravadas.push([prop, epoch]),
                timeContext: { modo: TEMPORAL_MODES.ABSOLUTO, unidade: 'HORA', origem: null, anchor: null, inicio: null, fim: null },
            });

            const [, inputFim] = inputsDeData(section);
            // Absolute assertion first: without two date inputs this case is vacuous.
            expect(inputsDeData(section)).toHaveLength(2);

            digitar(inputFim, comoLocal(T_NOV - UMA_HORA));

            expect(gravadas).toEqual([]);
            expect(box.avisos).toHaveLength(1);
            expect(box.avisos[0]).toContain('Fim recusado');
            // The field went back to the last ACCEPTED value: empty, since Fim was null.
            expect(inputsDeData(section)[1].value).toBe('');
        });

        it('o mesmo campo aceita um fim POSTERIOR: a recusa não trancou a edição', () => {
            const gravadas = [];
            const section = createTemporalValiditySection({
                inicio: T_NOV,
                fim: null,
                onChange: (prop, epoch) => gravadas.push([prop, epoch]),
                timeContext: { modo: TEMPORAL_MODES.ABSOLUTO, unidade: 'HORA', origem: null, anchor: null, inicio: null, fim: null },
            });

            digitar(inputsDeData(section)[1], comoLocal(T_NOV - UMA_HORA));
            digitar(inputsDeData(section)[1], comoLocal(T_NOV + UMA_HORA));

            expect(gravadas).toEqual([['temporalFim', T_NOV + UMA_HORA]]);
            expect(box.avisos).toHaveLength(1);
        });

        it('pelo caminho do painel de feição: a recusa também não chega à store', () => {
            const feature = { properties: { id: 'f1', source: 'point', temporalInicio: T_NOV, temporalFim: null } };
            const section = createTemporalAttributesSection({
                feature,
                featureType: 'point',
                selectedFeatures: [feature],
                control: null,
            });

            digitar(inputsDeData(section)[1], comoLocal(T_NOV - UMA_HORA));

            expect(box.escritas).toEqual([]);
            expect(feature.properties.temporalFim).toBeNull();
            expect(box.avisos[0]).toContain('Fim recusado');
        });
    });

    // 3. E4 — quem é a âncora não muda por edição de instante.
    describe('3. a âncora da trajetória não troca por edição de instante (E4)', () => {
        const fazerTrajetoria = () => ([
            { t: 1_000, lng: -43.1, lat: -22.9 },
            { t: 2_000, lng: -43.2, lat: -22.8 },
            { t: 3_000, lng: -43.3, lat: -22.7 },
        ]);

        it('pôr o ponto 3 ANTES do ponto 1 é recusado, nomeando a partida', () => {
            const traj = fazerTrajetoria();
            const decisao = decidirTrocaDeInstante(traj, traj[2], 500);

            expect(decisao.aceita).toBe(false);
            expect(decisao.causa).toBe('assumiria_ancora');
            expect(decisao.motivo).toContain('ponto 3');
            expect(decisao.motivo).toContain('partida');
        });

        it('pôr o ponto 1 DEPOIS do ponto 2 é recusado pela causa inversa', () => {
            const traj = fazerTrajetoria();
            const decisao = decidirTrocaDeInstante(traj, traj[0], 2_500);

            expect(decisao.aceita).toBe(false);
            expect(decisao.causa).toBe('abandonaria_ancora');
        });

        it('mexer no MEIO sem ultrapassar a partida é aceito', () => {
            const traj = fazerTrajetoria();

            expect(decidirTrocaDeInstante(traj, traj[1], 2_900).aceita).toBe(true);
            expect(decidirTrocaDeInstante(traj, traj[1], 1_001).aceita).toBe(true);
            expect(decidirTrocaDeInstante(traj, traj[2], 9_000).aceita).toBe(true);
            // A âncora pode ir para MAIS CEDO: ela continua sendo a âncora.
            expect(decidirTrocaDeInstante(traj, traj[0], -5_000).aceita).toBe(true);
        });

        it('EMPATE com a âncora: decide a ordem do array, como o ordenador real', () => {
            // O alvo vem DEPOIS da âncora no array cru: o ordenador é estável, então
            // a âncora continua na frente e o empate passa.
            const depois = [
                { t: 1_000, lng: -43.1, lat: -22.9 },
                { t: 3_000, lng: -43.3, lat: -22.7 },
            ];
            expect(decidirTrocaDeInstante(depois, depois[1], 1_000).aceita).toBe(true);

            // O mesmo empate com o alvo ANTES da âncora no array cru vira troca de
            // âncora, e é recusado. Um teste que só medisse o caso acima passaria
            // verde sobre a metade que de fato teleporta.
            const antes = [
                { t: 3_000, lng: -43.3, lat: -22.7 },
                { t: 1_000, lng: -43.1, lat: -22.9 },
            ];
            expect(decidirTrocaDeInstante(antes, antes[0], 1_000).aceita).toBe(false);
        });

        it('bordas: um ponto só, lista vazia, instante não finito, alvo de fora', () => {
            const um = [{ t: 1_000, lng: -43.1, lat: -22.9 }];
            expect(decidirTrocaDeInstante(um, um[0], -9_999).aceita).toBe(true);
            expect(decidirTrocaDeInstante([], { t: 1 }, 5).aceita).toBe(true);
            expect(decidirTrocaDeInstante(undefined, { t: 1 }, 5).aceita).toBe(true);
            const traj = fazerTrajetoria();
            expect(decidirTrocaDeInstante(traj, traj[2], Number.NaN).aceita).toBe(true);
            expect(decidirTrocaDeInstante(traj, { t: 7, lng: 0, lat: 0 }, 5).aceita).toBe(true);
            expect(decidirTrocaDeInstante(traj, null, 5).aceita).toBe(true);
        });

        // O campo `datetime-local` tem granularidade de MINUTO, então a ida e volta
        // pelo input trunca qualquer instante que não caia num minuto cheio. Os casos
        // de tela usam uma trajetória alinhada ao minuto; os puros acima não precisam.
        const UM_MINUTO = 60_000;
        const fazerTrajetoriaDeTela = () => ([
            { t: T_NOV, lng: -43.1, lat: -22.9 },
            { t: T_NOV + UM_MINUTO, lng: -43.2, lat: -22.8 },
            { t: T_NOV + 2 * UM_MINUTO, lng: -43.3, lat: -22.7 },
        ]);

        it('na TELA: a recusa não muda o ponto-chave, não grava e avisa', () => {
            const traj = fazerTrajetoriaDeTela();
            const feature = { properties: { id: 'f1', source: 'point', trajetoria: traj } };
            const section = createTrajectorySection({ feature, featureType: 'point', map: null });

            const campos = inputsDeData(section);
            // Três linhas, três campos de instante: sem isto o índice abaixo seria cego.
            expect(campos).toHaveLength(3);

            digitar(campos[2], comoLocal(T_NOV - UM_MINUTO));

            expect(traj[2].t).toBe(T_NOV + 2 * UM_MINUTO);
            expect(box.escritas).toEqual([]);
            expect(box.avisos[0]).toContain('partida');
            // O campo voltou ao instante gravado, em vez de exibir o recusado.
            expect(inputsDeData(section)[2].value).toBe(comoLocal(T_NOV + 2 * UM_MINUTO));
        });

        it('na TELA: uma troca legítima continua passando', () => {
            const traj = fazerTrajetoriaDeTela();
            const feature = { properties: { id: 'f1', source: 'point', trajetoria: traj } };
            const section = createTrajectorySection({ feature, featureType: 'point', map: null });

            digitar(inputsDeData(section)[1], comoLocal(T_NOV + 3 * UM_MINUTO));

            expect(traj[1].t).toBe(T_NOV + 3 * UM_MINUTO);
            expect(box.escritas).toHaveLength(1);
            expect(box.escritas[0][2]).toBe('trajetoria');
            expect(box.avisos).toEqual([]);
        });
    });

    // 4. E8 — o que a derivação escreve, e o que ela NÃO consulta.
    describe('4. o GDH automático apaga quando o instante some, e não conhece a lente (E8)', () => {
        it('símbolo militar com início finito: o GDH sai do instante', () => {
            const campos = derivarCamposDtg({ autoDtg: true, temporalInicio: T_NOV }, 'military_symbol');

            expect(campos).toEqual({ dateTimeGroup: '201400NOV24' });
        });

        it('O DEFEITO: início apagado grava GDH VAZIO, em vez de deixar o antigo', () => {
            const campos = derivarCamposDtg(
                { autoDtg: true, temporalInicio: null, dateTimeGroup: '201400NOV24' },
                'military_symbol'
            );

            expect(campos).toEqual({ dateTimeGroup: '' });
        });

        it('medida de coordenação: os dois GDH, cada um com o seu limite, vazio inclusive', () => {
            const campos = derivarCamposDtg(
                { autoDtg: true, temporalInicio: T_NOV, temporalFim: null },
                'coordination_measure'
            );

            expect(campos).toEqual({ gdhIni: '201400Z NOV', gdhFim: '' });
        });

        it('sem o vínculo ligado, e em tipo sem GDH, não se deriva nada', () => {
            expect(derivarCamposDtg({ autoDtg: false, temporalInicio: T_NOV }, 'military_symbol')).toEqual({});
            expect(derivarCamposDtg({ temporalInicio: T_NOV }, 'military_symbol')).toEqual({});
            expect(derivarCamposDtg({ autoDtg: true, temporalInicio: T_NOV }, 'point')).toEqual({});
            expect(derivarCamposDtg(null, 'military_symbol')).toEqual({});
        });

        it('A LENTE NÃO ENTRA: um terceiro argumento pedindo pausa é IGNORADO', () => {
            // Esta função teve, por algumas horas em 2026-09-21, um ramo `{ relativo }` que
            // devolvia vazio sob a lente D+N. Ele foi removido porque o "Reagendar" SÓ roda
            // no modo relativo: a pausa desligava a rederivação no único caminho de produção
            // que a chama, e o símbolo ficava com o GDH VELHO depois de a janela andar. A
            // invariante é `autoDtg` ligado implica GDH igual à janela, em qualquer lente.
            const esperado = { dateTimeGroup: '201400NOV24' };
            const props = { autoDtg: true, temporalInicio: T_NOV, dateTimeGroup: '010000JAN00' };

            expect(derivarCamposDtg(props, 'military_symbol')).toEqual(esperado);
            expect(derivarCamposDtg(props, 'military_symbol', { relativo: true })).toEqual(esperado);
            // A forma do retorno também mudou: é o mapa de campos, sem invólucro. Um
            // chamador que ainda leia `.campos` recebe `undefined`, não um vazio silencioso.
            expect(derivarCamposDtg(props, 'military_symbol').campos).toBeUndefined();
        });
    });

    // 5. E12 na TELA: a caixa é recusa de ESTADO, nunca `disabled`. E o que ela trava
    // é a CHAVE do vínculo, nunca o vínculo já ligado (ver o último caso do bloco).
    describe('5. a caixa de GDH automático recusa o clique em vez de sumir (E12)', () => {
        const fazerSimbolo = (extra = {}) => ({
            properties: { id: 's1', source: 'military_symbol', autoDtg: false, trajetoria: [], ...extra },
        });

        function caixaDoGdh(section) {
            return acharNaArvore(section, (el) => ehCheckbox(el)
                && el.parentNode?.title === GDH_LIGA_SO_NO_ABSOLUTO);
        }

        it('no modo relativo a caixa é desenhada, com aria-disabled e SEM a propriedade disabled', () => {
            box.config = { ...DEFAULT_TEMPORAL_CONFIG, modo: TEMPORAL_MODES.RELATIVO, origem: T_NOV };
            const feature = fazerSimbolo();

            const section = createTrajectorySection({ feature, featureType: 'military_symbol', map: null });
            const cb = caixaDoGdh(section);

            expect(cb).toBeTruthy();
            expect(cb.getAttribute('aria-disabled')).toBe('true');
            // A propriedade `disabled` é justamente o que impediria o clique de
            // acontecer, e o clique é como o motivo chega à pessoa.
            expect(cb.disabled).not.toBe(true);
            expect(cb.parentNode.className).toContain('temporal-auto-binding--travado');
        });

        it('o clique é recusado NOMEANDO o estado, e nada é gravado', () => {
            box.config = { ...DEFAULT_TEMPORAL_CONFIG, modo: TEMPORAL_MODES.RELATIVO, origem: T_NOV };
            const feature = fazerSimbolo();
            const section = createTrajectorySection({ feature, featureType: 'military_symbol', map: null });

            const cb = caixaDoGdh(section);
            cb.checked = true; // o que o navegador faria antes do preventDefault
            fire(cb, 'click');
            fire(cb, 'change');

            expect(box.avisos).toEqual([GDH_LIGA_SO_NO_ABSOLUTO]);
            expect(box.avisos[0]).toContain('modo absoluto');
            expect(box.escritas).toEqual([]);
            expect(cb.checked).toBe(false);
        });

        it('a frase promete a CHAVE travada, nunca o vínculo pausado', () => {
            // A frase anterior dizia "pausado", e a pausa correspondente no código deixava
            // o GDH velho impresso. Se alguém repuser aquele texto, este caso acusa.
            expect(GDH_LIGA_SO_NO_ABSOLUTO).toContain('Ligar ou desligar');
            expect(GDH_LIGA_SO_NO_ABSOLUTO).toContain('continua valendo');
            expect(GDH_LIGA_SO_NO_ABSOLUTO).not.toContain('pausad');
        });

        it('e o vínculo JÁ LIGADO continua derivando no modo relativo (a invariante)', () => {
            // A metade que o E12 não pode custar: com a lente em D+N e `autoDtg` já
            // ligado, editar a janela grava o GDH NOVO. Uma pausa aqui deixaria o
            // amplificador descrevendo uma janela que a pessoa acabou de mudar.
            box.config = { ...DEFAULT_TEMPORAL_CONFIG, modo: TEMPORAL_MODES.RELATIVO, origem: T_NOV };
            const feature = {
                properties: {
                    id: 's1', source: 'military_symbol',
                    autoDtg: true, dateTimeGroup: '010000JAN00',
                    temporalInicio: null, temporalFim: null,
                },
            };
            const section = createTemporalAttributesSection({
                feature, featureType: 'military_symbol', selectedFeatures: [feature], control: null,
            });

            // Sob a lente relativa o campo é o de OFFSET (D+N), não o de data: é a
            // própria lente que troca o controle, e digitar no campo errado aqui seria
            // medir uma tela que o modo relativo não desenha. Offset 0 resolve contra a
            // origem, que é T_NOV.
            const offset = todosNaArvore(section, (el) => el.tagName === 'INPUT' && el.type === 'number');
            expect(offset).toHaveLength(2);
            offset[0].value = '0';
            fire(offset[0], 'change');

            // Duas escritas: a janela e o amplificador derivado dela.
            const gdh = box.escritas.find(([, , prop]) => prop === 'dateTimeGroup');
            expect(gdh).toBeTruthy();
            expect(gdh[3]).toBe('201400NOV24');
        });

        it('no modo ABSOLUTO a mesma caixa grava normalmente (controle do gate)', () => {
            const feature = fazerSimbolo();
            const section = createTrajectorySection({ feature, featureType: 'military_symbol', map: null });

            const cb = acharNaArvore(section, (el) => ehCheckbox(el)
                && el.parentNode?.children?.[1]?.textContent?.includes('GDH automático'));
            expect(cb).toBeTruthy();
            expect(cb.getAttribute('aria-disabled')).toBeNull();

            cb.checked = true;
            fire(cb, 'change');

            expect(box.escritas.some(([, , prop, valor]) => prop === 'autoDtg' && valor === true)).toBe(true);
            expect(box.avisos).toEqual([]);
        });
    });

    // 6. E11 e E2 — a cerca que virou dica, e o apagar que virou pergunta.
    describe('6. a janela da régua é dica, e Limpar pergunta (E11/E2)', () => {
        it('o campo de data não carrega min nem max, e traz a janela no title', () => {
            box.config = { ...DEFAULT_TEMPORAL_CONFIG, inicio: T_NOV, fim: T_NOV + UMA_HORA };
            const feature = { properties: { id: 'f1', source: 'point', temporalInicio: null, temporalFim: null } };

            const section = createTemporalAttributesSection({
                feature, featureType: 'point', selectedFeatures: [feature], control: null,
            });
            const [inicio] = inputsDeData(section);

            expect(inicio.min).toBeUndefined();
            expect(inicio.max).toBeUndefined();
            expect(inicio.title).toContain('linha do tempo');
        });

        it('a frase da janela cobre os quatro estados dos limites', () => {
            expect(fraseDaJanelaDaRegua('A', 'B')).toContain('de A a B');
            expect(fraseDaJanelaDaRegua('A', null)).toContain('começa em A');
            expect(fraseDaJanelaDaRegua(null, 'B')).toContain('termina em B');
            expect(fraseDaJanelaDaRegua(null, null)).toBe('Data e hora exatas.');
        });

        it('a pergunta de Limpar diz quantos pontos saem, no singular e no plural', () => {
            expect(fraseDeLimpezaDeTrajetoria(3).mensagem).toContain('3 pontos-chave');
            expect(fraseDeLimpezaDeTrajetoria(1).mensagem).toContain('1 ponto-chave');
            expect(fraseDeLimpezaDeTrajetoria(0).mensagem).toContain('0 pontos-chave');
        });

        it('e ela NOMEIA a volta, em vez de negar que exista', () => {
            const { mensagem } = fraseDeLimpezaDeTrajetoria(3);

            // A frase anterior ("Esta ação não tem desfazer") virou mentira no dia em
            // que o `persist()` da trajetória passou a pedir `recordUndo`. As duas
            // asserções andam juntas de propósito: a positiva prende o texto novo, a
            // negativa impede que o antigo volte por cópia de um vizinho.
            expect(mensagem).toContain('Ctrl+Z');
            expect(mensagem).toContain('Desfazer');
            expect(mensagem).not.toContain('não tem desfazer');
        });

        it('Limpar PERGUNTA antes, e o "Manter" preserva a trajetória inteira', async () => {
            box.respostaDoConfirm = false;
            const traj = [
                { t: 1_000, lng: -43.1, lat: -22.9 },
                { t: 2_000, lng: -43.2, lat: -22.8 },
            ];
            const feature = { properties: { id: 'f1', source: 'point', trajetoria: traj } };
            const section = createTrajectorySection({ feature, featureType: 'point', map: null });

            const limpar = acharNaArvore(section, (el) => el.tagName === 'BUTTON' && el.textContent === 'Limpar');
            expect(limpar).toBeTruthy();

            limpar.click();
            await Promise.resolve();
            await Promise.resolve();

            expect(box.confirmacoes).toHaveLength(1);
            expect(box.confirmacoes[0].message).toContain('2 pontos-chave');
            expect(box.confirmacoes[0].destructive).toBe(true);
            expect(traj).toHaveLength(2);
            expect(box.escritas).toEqual([]);
        });

        it('e o "Limpar" confirmado apaga de verdade (controle do gate)', async () => {
            box.respostaDoConfirm = true;
            const traj = [
                { t: 1_000, lng: -43.1, lat: -22.9 },
                { t: 2_000, lng: -43.2, lat: -22.8 },
            ];
            const feature = { properties: { id: 'f1', source: 'point', trajetoria: traj } };
            const section = createTrajectorySection({ feature, featureType: 'point', map: null });

            acharNaArvore(section, (el) => el.tagName === 'BUTTON' && el.textContent === 'Limpar').click();
            await Promise.resolve();
            await Promise.resolve();

            expect(traj).toHaveLength(0);
            expect(box.escritas).toHaveLength(1);
        });
    });

    // 7. E2, a outra metade: o desfazer. `updateFeatureProperty` não registra desfazer
    // por padrão, então quem É gesto tem de PEDIR. Estes casos medem o pedido no
    // argumento da chamada REAL (o mock guarda os argumentos), e não por leitura de
    // fonte: é a diferença entre provar que a bandeira chega e provar que ela existe.
    describe('7. o que é desfazível, e o que declaradamente não é (E2)', () => {
        const UM_MINUTO = 60_000;
        const fazerTraj = () => ([
            { t: T_NOV, lng: -43.1, lat: -22.9 },
            { t: T_NOV + UM_MINUTO, lng: -43.2, lat: -22.8 },
            { t: T_NOV + 2 * UM_MINUTO, lng: -43.3, lat: -22.7 },
        ]);

        /** The `{recordUndo}` bag of the single write a gesture produced. */
        function marcaDaEscrita() {
            expect(box.escritas).toHaveLength(1);
            const [tipo, , prop, , mapa, opcoes] = box.escritas[0];
            expect(tipo).toBe('points');
            expect(prop).toBe('trajetoria');
            // O mapa alvo vai EXPLÍCITO como null (o corrente), porque o 6º argumento
            // só existe depois do 5º: sem ele as opções cairiam na vaga do mapa.
            expect(mapa).toBeNull();
            return opcoes;
        }

        it('trocar o instante de um ponto grava pedindo desfazer', () => {
            const feature = { properties: { id: 'f1', source: 'point', trajetoria: fazerTraj() } };
            const section = createTrajectorySection({ feature, featureType: 'point', map: null });

            digitar(inputsDeData(section)[1], comoLocal(T_NOV + 3 * UM_MINUTO));

            expect(marcaDaEscrita()).toEqual({ recordUndo: true });
        });

        it('remover um ponto da lista também', () => {
            const feature = { properties: { id: 'f1', source: 'point', trajetoria: fazerTraj() } };
            const section = createTrajectorySection({ feature, featureType: 'point', map: null });

            const remover = todosNaArvore(section, (el) => el.tagName === 'BUTTON' && el.textContent === '✕');
            // A âncora não tem botão de remover: três pontos, dois botões. Sem esta
            // asserção o clique abaixo poderia estar caindo em qualquer outro botão.
            expect(remover).toHaveLength(2);

            remover[0].click();

            expect(feature.properties.trajetoria).toHaveLength(2);
            expect(marcaDaEscrita()).toEqual({ recordUndo: true });
        });

        it('e o Limpar confirmado, que é o gesto que a frase promete poder desfazer', async () => {
            box.respostaDoConfirm = true;
            const feature = { properties: { id: 'f1', source: 'point', trajetoria: fazerTraj() } };
            const section = createTrajectorySection({ feature, featureType: 'point', map: null });

            acharNaArvore(section, (el) => el.tagName === 'BUTTON' && el.textContent === 'Limpar').click();
            await Promise.resolve();
            await Promise.resolve();

            expect(marcaDaEscrita()).toEqual({ recordUndo: true });
            // A promessa da tela e a bandeira que a sustenta, na mesma asserção: se
            // alguém tirar o `recordUndo`, a frase do diálogo vira mentira, e é este
            // par que impede que as duas andem separadas.
            expect(box.confirmacoes[0].message).toContain('Ctrl+Z');
        });

        it('a janela de validade NÃO pede desfazer: é decisão, e está declarada no código', () => {
            const feature = { properties: { id: 'f1', source: 'point', temporalInicio: null, temporalFim: null } };
            const section = createTemporalAttributesSection({
                feature, featureType: 'point', selectedFeatures: [feature], control: null,
            });

            digitar(inputsDeData(section)[0], comoLocal(T_NOV));

            expect(box.escritas).toHaveLength(1);
            // Quatro argumentos: nem mapa nem opções. O motivo mora no comentário de
            // `createTemporalAttributesSection` (o GDH derivado grava por fora, sem
            // await, e meio desfazer é pior que nenhum). Este caso existe para que
            // acender o desfazer ali seja uma DECISÃO com teste a atualizar, e não uma
            // linha que passa despercebida.
            expect(box.escritas[0]).toHaveLength(4);
            expect(box.escritas[0][2]).toBe('temporalInicio');
        });
    });

    // 8. V4, POR LEITURA DE FONTE. Ver o alcance declarado no cabeçalho.
    describe('8. os painéis de marcador fazem a mesma pergunta do painel 2D (V4)', () => {
        const raiz = fileURLToPath(new URL('../../src/js/', import.meta.url));
        const paineis = [
            { nome: 'marcador 3D', arquivo: '3d_models_viewer_tool/components/marker-panel-3d.js' },
            { nome: 'marcador 360', arquivo: 'street_view_tool/components/marker-panel-360.js' },
        ];

        for (const painel of paineis) {
            it(`${painel.nome}: consulta semEdicaoSync e cai no resumo somente leitura`, () => {
                const fonte = readFileSync(join(raiz, painel.arquivo), 'utf8');

                expect(fonte).toMatch(/import \{ semEdicaoSync \} from '@store\/edicao-indisponivel\.js';/);
                expect(fonte).toMatch(/import \{[^}]*createTemporalReadonlySection[^}]*\} from '@js\/temporal\/temporal-attributes-section\.js';/);

                // Linha a linha, sem comentário: uma menção em prosa contaria como
                // fiação, que é a armadilha medida no teste irmão desta pasta.
                const linhas = fonte
                    .split('\n')
                    .map((linha) => linha.trim())
                    .filter((linha) => !linha.startsWith('//') && !linha.startsWith('*'));
                expect(linhas.filter((l) => /semEdicaoSync\(\)/.test(l))).toHaveLength(1);
                expect(linhas.filter((l) => /createTemporalReadonlySection\(\{ feature:/.test(l))).toHaveLength(1);
            });
        }

        it('o painel 2D continua sendo a referência: ele já troca a seção pelo resumo', () => {
            const fonte = readFileSync(join(raiz, 'sidebar/panels/feature-panel-content.js'), 'utf8');

            expect(fonte).toContain('semEdicaoSync()');
            expect(fonte).toContain('createTemporalReadonlySection({ feature })');
        });
    });
});
