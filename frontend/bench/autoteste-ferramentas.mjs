// Autoteste da bancada de ferramentas: prova que ela REPROVA o insumo
// degenerado, eixo a eixo.
//
// Uma regua vista so passar em insumo bom nao foi vista funcionar. Este arquivo
// constroi o pior caso de cada eixo que a bancada afirma medir (leitura da linha
// de comando, estatistica, resumo das escritas, cadencia do rAF, prova do
// desenho, prova do zoom, prova da conclusao, montagem da tabela, o mapa de
// nomes, o normalizador do descritor, as tres reguas do INSTRUMENTO, o criterio
// de `perdidos` e a semeadura do cenario zoom) e confirma que cada um sai
// marcado. Depois confirma que o insumo bom passa, para a regua nao ser um
// carimbo de reprovacao.
//
// Tres eixos nasceram com o porte das quatro formas (2026-09-05): o contador de
// `snapping.resolve` cobrado contra si mesmo (eixo 4), porque contador que nao
// instalou le ZERO e zero e o numero bonito que o porte quer produzir; o
// criterio de `perdidos` (eixo 13), que contava como perdida a escrita desenhada
// pelo proprio quadro seguinte; e a semeadura do cenario zoom (eixo 14), que
// degenerava o retangulo em cerca de metade das rodadas e contava como criada a
// chamada que o controle recusou em silencio.
//
//   node frontend/bench/autoteste-ferramentas.mjs

import process from 'node:process';
import {
    FERRAMENTAS, ORDEM_CENARIOS, CENARIOS, MODOS_DESENHO, SEMEADURAS,
    GESTOS_CONCLUSAO, METODOS_DE_ESCRITA, normalizarFerramenta, lerArgumentos,
    estatistica, resumirEscritas, avaliarCadencia, celula, chavesDaTabela,
    montarTabela, escreverMarkdown, percentil, mediana, errosDeControle,
    avaliarIdentidade, avaliarProntidao, validarLeituraDeTiles,
    avaliarFeedback, instrumentar, pontosDaSemeadura, criarFeicoesPagina, VISTA,
} from './ferramentas.mjs';

let falhas = 0;
let total = 0;

function checa(nome, condicao, detalhe) {
    total++;
    if (condicao) { console.log(`  ok    ${nome}`); return; }
    falhas++;
    console.log(`  FALHA ${nome}${detalhe ? `  (${detalhe})` : ''}`);
}

function lanca(nome, fn) {
    total++;
    try { fn(); falhas++; console.log(`  FALHA ${nome} (nao lancou)`); } catch (e) { console.log(`  ok    ${nome} -> ${String(e.message).slice(0, 70)}`); }
}

// --------------------------------------------------------------------------
// Insumos sinteticos
// --------------------------------------------------------------------------
function loteDeQuadros(n, dt, passo = 16.7) {
    const q = [];
    for (let i = 0; i < n; i++) q.push({ t: i * passo, dt });
    return q;
}

function estFalsa({
    quadros = 180, dt = 2, passo = 16.7, query = 0, proj = 0,
    latencias = [], superadas = 0, resolve = 180, timers = 0, timersCurtos = 0,
} = {}) {
    return estatistica({
        quadros: loteDeQuadros(quadros, dt, passo), query, proj, latencias, superadas,
        mousemove: quadros, resolve, timers, timersCurtos,
    });
}

// Prova boa do desenho: a ferramenta ativa (e nao um stand-in), um ponto
// colocado, feedback escrito por `setData` cru (a fonte de apoio nao e migrada),
// e o contador de `snapping.resolve` no ar (sem ele "resolve 0" nao prova nada).
const provaDesenhoBoa = (extra = {}) => ({
    setDataAlvo: 180, updateDataAlvo: 0, escritasAlvo: 180, feicoesAlvo: 180,
    setDataOutras: 0, updateDataOutras: 0, escritasOutras: 0, porFonte: {},
    fonteAlvo: 'coordination-line-feedback',
    ferramentaAtiva: true, pontosColocados: 1, visibilidade: 'visible',
    modoDesenho: 'clique', requerTerreno: false, terreno: false,
    controlePresente: true, ehStandIn: false,
    snapa: true, snapping: true, contadorDeSnapInstalado: true, contadorDeSnapMotivo: null,
    ...extra,
});

// Prova boa do desenho por ARRASTO: um traco de 181 pontos para 180 eventos de
// movimento (o do pointerdown mais um por evento).
const provaArrastoBoa = (extra = {}) => provaDesenhoBoa({
    fonteAlvo: 'brush-feedback', modoDesenho: 'arrastar',
    pontosColocados: 0, pontosAcumulados: 181, eventosDeMovimento: 180, ...extra,
});

// Prova boa do zoom: a fonte principal e MIGRADA, entao a escrita chegou por
// `updateData` e o `setData` dela e zero. Uma bancada que so contasse `setData`
// leria "zero escritas" aqui.
const provaZoomBoa = (extra = {}) => ({
    setDataAlvo: 0, updateDataAlvo: 1, escritasAlvo: 1, feicoesAlvo: 30,
    setDataOutras: 2, updateDataOutras: 0, escritasOutras: 2, porFonte: {},
    fonteAlvo: 'coordination_lines', tipo: 'coordination_lines',
    naFonte: 30, noStore: 30, visibilidade: 'visible',
    controlePresente: true, ehStandIn: false, ...extra,
});

const provaConclusaoBoa = (extra = {}) => ({
    setDataAlvo: 0, updateDataAlvo: 2, escritasAlvo: 2, feicoesAlvo: 2,
    setDataOutras: 1, updateDataOutras: 0, escritasOutras: 1, porFonte: {},
    fonteAlvo: 'coordination_lines', tipo: 'coordination_lines',
    noStoreAntes: 30, noStore: 31, msStore: 26, msPainel: 27,
    cliquesPedidos: 3, cliquesQuePegaram: 3, gestoDisparou: true,
    visibilidade: 'visible', controlePresente: true, ehStandIn: false, ...extra,
});

function casoFalso(cenario, { k = null, ferramenta = 'coordination_line', est, prova, erros } = {}) {
    const e = est || estFalsa();
    const p = prova || (cenario === 'desenho' ? provaDesenhoBoa() : cenario === 'zoom' ? provaZoomBoa() : provaConclusaoBoa());
    const alvo = cenario === 'zoom' ? { feicoes: 30 } : {};
    return {
        ferramenta, cenario, k,
        estatistica: e, prova: p,
        erros: erros || CENARIOS[cenario].validar(p, e, alvo),
    };
}

function resultadoFalso({ renderer = 'NVIDIA GeForce RTX A2000', relogio = 'valido', rodadas, ferramenta = 'coordination_line' }) {
    return {
        parametros: {
            url: 'http://localhost:3000/', ferramenta, k: [1, 4], feicoes: 30,
            terreno: false, cpu: 1, snapping: false, rodadas: rodadas.length,
            largura: 1600, altura: 900, headless: false,
        },
        ambiente: { quando: 'agora', renderer, relogio, playwrightOrigem: 'teste', playwrightVersao: '0' },
        rodadas,
    };
}

const rodadaFalsa = (n, { aquecimento = false, valida = true, erros = [], casos, cadencia } = {}) => ({
    rodada: n, aquecimento, valida, erros, avisos: [],
    cadencia: cadencia || { p50: 16.7, p95: 16.9, max: 20, amostras: 59 },
    assinatura: '302c/103f',
    casos: casos || [casoFalso('desenho', { k: 1 })],
});

// --------------------------------------------------------------------------
function eixo1() {
    console.log('\n== eixo 1: estatistica, percentil e mediana');
    const vazio = estatistica({ quadros: [], query: 0, proj: 0, latencias: [] });
    checa('lote sem quadro devolve quadros=0', vazio.quadros === 0, JSON.stringify(vazio));
    checa('lote sem quadro nao inventa render_ms', vazio.render_ms === undefined);
    const q = [];
    for (let i = 0; i < 100; i++) q.push({ t: i * 16, dt: i });
    const e = estatistica({ quadros: q, query: 7, proj: 1234, latencias: [5, 10, 15, 20] });
    checa('p50 do dt sai no meio', e.render_ms.p50 === 50, JSON.stringify(e.render_ms));
    checa('intervalo p50 sai 16', e.intervalo_ms.p50 === 16, JSON.stringify(e.intervalo_ms));
    checa('queryRenderedFeatures e project atravessam', e.query === 7 && e.proj === 1234);
    checa('latencia do feedback vira p50/p95', e.latencia_ms && e.latencia_ms.p50 === 15, JSON.stringify(e.latencia_ms));
    checa('a latencia diz de quantas amostras saiu', e.latencia_ms.amostras === 4, JSON.stringify(e.latencia_ms));
    checa('sem latencia medida o campo fica nulo, nao zero', estatistica({ quadros: q, latencias: [] }).latencia_ms === null);
    // O caso que o instrumento antigo escondia: 19 medidas em 180 escritas.
    // Sem `perdidos` ao lado, "lat p50 16,5" passaria por medida da ferramenta.
    const escasso = estFalsa({ latencias: [16, 17], superadas: 178 });
    checa('escrita de feedback substituida antes de assentar conta em perdidos', escasso.feedbackSuperados === 178, String(escasso.feedbackSuperados));
    checa('lote sem perdido nenhum sai zero', estFalsa({ latencias: [16] }).feedbackSuperados === 0);
    checa('lote sem quadro ainda conta os perdidos', estatistica({ quadros: [], superadas: 12 }).feedbackSuperados === 12);
    // Engasgo: intervalos de 50 ms tem de aparecer no contador de quadros lentos.
    const lento = estatistica({ quadros: loteDeQuadros(30, 40, 50), latencias: [] });
    checa('intervalo de 50 ms conta como quadro lento', lento.lentos === 29, String(lento.lentos));
    checa('intervalo de 16,7 ms nao conta como lento', estFalsa().lentos === 0);
    checa('percentil de lista vazia nao explode', percentil([], 0.5) === 0);
    checa('mediana de lista vazia devolve null', mediana([]) === null);

    // As duas grandezas que o porte das formas existe para mover: chamadas a
    // `snapping.resolve` por quadro e timers armados durante o gesto. Sem elas na
    // estatistica a tabela nao mostra o que mudou, e a bancada mediria o porte
    // pelo relogio, que e justamente o eixo que a GPU e a CPU contaminam.
    const contadores = estatistica({
        quadros: loteDeQuadros(180, 2), resolve: 720, timers: 540, timersCurtos: 538, latencias: [],
    });
    checa('a estatistica carrega as chamadas a snapping.resolve', contadores.resolve === 720, String(contadores.resolve));
    checa('a estatistica carrega os timers armados', contadores.timers === 540, String(contadores.timers));
    checa('a estatistica separa os timers de menos de um quadro', contadores.timersCurtos === 538, String(contadores.timersCurtos));
    checa('resolve por quadro sai da divisao pelos quadros medidos',
        contadores.resolvePorQuadro === 4, String(contadores.resolvePorQuadro));
    checa('um resolve por quadro sai 1',
        estatistica({ quadros: loteDeQuadros(180, 2), resolve: 180, latencias: [] }).resolvePorQuadro === 1);
    checa('lote sem quadro nao inventa resolve por quadro',
        estatistica({ quadros: [], resolve: 12 }).resolvePorQuadro === null);
    checa('lote sem contador nenhum sai zerado, e nao undefined',
        estatistica({ quadros: loteDeQuadros(10, 1) }).resolve === 0);
}
eixo1();

function eixo2() {
    console.log('\n== eixo 2: resumo das escritas (a fonte alvo separada do resto, e os DOIS metodos)');
    const esc = {
        'coordination-line-feedback': { setData: 180, updateData: 0, feicoes: 180 },
        'snap-indicator': { setData: 111, updateData: 0, feicoes: 102 },
    };
    const r = resumirEscritas(esc, 'coordination-line-feedback');
    checa('a fonte alvo sai contada a parte', r.escritasAlvo === 180 && r.feicoesAlvo === 180, JSON.stringify(r));
    checa('as outras fontes somam a parte', r.escritasOutras === 111, String(r.escritasOutras));
    const semAlvo = resumirEscritas(esc, 'boundary-feedback');
    checa('alvo que ninguem escreveu sai zero (e nao o total)', semAlvo.escritasAlvo === 0 && semAlvo.escritasOutras === 291, JSON.stringify(semAlvo));
    checa('lote sem escrita nenhuma sai zerado', resumirEscritas({}, 'x').escritasAlvo === 0);
    checa('lote nulo nao explode', resumirEscritas(null, 'x').escritasOutras === 0);

    // O eixo NOVO desta branch: a fonte principal e migrada para o despachante de
    // diff e recebe dado por `updateData`. Um resumo que so somasse `setData`
    // devolveria ZERO aqui, e o cenario `zoom` de toda ferramenta migrada sairia
    // CENARIO INVALIDO com o app intacto.
    const migrada = { coordination_lines: { setData: 0, updateData: 1, feicoes: 30 } };
    const m = resumirEscritas(migrada, 'coordination_lines');
    checa('escrita por updateData conta como escrita do alvo', m.escritasAlvo === 1, JSON.stringify(m));
    checa('a coluna de updateData mostra o metodo usado', m.updateDataAlvo === 1 && m.setDataAlvo === 0, JSON.stringify(m));
    checa('somar setData e updateData nao perde nem duplica',
        m.escritasAlvo === m.setDataAlvo + m.updateDataAlvo);
    const misto = resumirEscritas({
        boundarys: { setData: 3, updateData: 88, feicoes: 910 },
        'boundary-feedback': { setData: 180, updateData: 0, feicoes: 180 },
    }, 'boundarys');
    checa('fonte escrita pelos DOIS metodos soma os dois no alvo', misto.escritasAlvo === 91, JSON.stringify(misto));
    checa('os dois metodos continuam visiveis separados', misto.setDataAlvo === 3 && misto.updateDataAlvo === 88);
    checa('a fonte de apoio nao entra no alvo da fonte principal', misto.escritasOutras === 180);
    checa('porFonte mostra o par (setData, updateData) por fonte',
        misto.porFonte.boundarys === '3s/88u/910f', JSON.stringify(misto.porFonte));
    checa('METODOS_DE_ESCRITA declara os dois caminhos que o app usa',
        METODOS_DE_ESCRITA.join(',') === 'setData,updateData', METODOS_DE_ESCRITA.join(','));
}
eixo2();

function eixo3() {
    console.log('\n== eixo 3: cadencia ociosa do rAF');
    checa('cadencia boa passa', avaliarCadencia({ p50: 16.7, p95: 16.9 }, 1).erro === null);
    const ruim = avaliarCadencia({ p50: 20, p95: 33 }, 1);
    checa('cadencia p95 33 ms invalida a rodada', ruim.erro !== null && ruim.aviso === null, JSON.stringify(ruim));
    checa('a reprova diz o numero medido', /33/.test(ruim.erro), ruim.erro);
    const comCpu = avaliarCadencia({ p50: 20, p95: 33 }, 4);
    checa('com --cpu 4 a mesma cadencia vira aviso, nao erro', comCpu.erro === null && comCpu.aviso !== null, JSON.stringify(comCpu));
    checa('o aviso diz que a CPU estava estrangulada', /CPU 4x/.test(comCpu.aviso), comCpu.aviso);
    checa('cadencia limite de 25 ms ainda passa', avaliarCadencia({ p50: 20, p95: 25 }, 1).erro === null);
    checa('cadencia nao medida reprova', avaliarCadencia(null, 1).erro !== null);
    checa('cadencia com p95 ausente reprova', avaliarCadencia({ p50: 16 }, 1).erro !== null);
}
eixo3();

function eixo4() {
    console.log('\n== eixo 4: prova do DESENHO (o pior caso de cada eixo)');
    const est = estFalsa();
    const d = CENARIOS.desenho.validar;
    checa('desenho bom passa', d(provaDesenhoBoa(), est, {}).length === 0, JSON.stringify(d(provaDesenhoBoa(), est, {})));

    // A ferramenta nao escreveu a fonte de feedback, por metodo nenhum.
    const semFeedback = d(provaDesenhoBoa({ setDataAlvo: 0, updateDataAlvo: 0, escritasAlvo: 0, feicoesAlvo: 0 }), est, {});
    checa('desenho sem escrita de feedback reprova', semFeedback.length > 0);
    checa('a reprova diz que a ferramenta nao desenhou', /a ferramenta nao desenhou/.test(semFeedback.join(' ')), semFeedback.join(' '));
    checa('a reprova nomeia a fonte de feedback', /coordination-line-feedback/.test(semFeedback.join(' ')));
    checa('a reprova nomeia os DOIS metodos, para nao induzir a olhar so setData',
        /setData nem updateData/.test(semFeedback.join(' ')), semFeedback.join(' '));

    // O caso que "escrita de QUALQUER fonte" aprovaria: o app escreveu 300 vezes
    // o snap-indicator e nenhuma vez o feedback da ferramenta.
    const soOutras = d(provaDesenhoBoa({ setDataAlvo: 0, updateDataAlvo: 0, escritasAlvo: 0, escritasOutras: 300, setDataOutras: 300 }), est, {});
    checa('escrita de outras fontes nao substitui a do feedback', soOutras.length > 0, JSON.stringify(soOutras));

    // Uma ferramenta cuja fonte de feedback fosse migrada escreveria por
    // `updateData`, e a regua nao pode cobrar o METODO, so a escrita.
    const soUpdate = d(provaDesenhoBoa({ setDataAlvo: 0, updateDataAlvo: 180, escritasAlvo: 180 }), est, {});
    checa('feedback escrito so por updateData passa (a regua cobra a escrita, nao o metodo)', soUpdate.length === 0, JSON.stringify(soUpdate));

    checa('desenho com 0 pontos colocados reprova', d(provaDesenhoBoa({ pontosColocados: 0 }), est, {}).length > 0);
    checa('desenho com 2 pontos colocados reprova', d(provaDesenhoBoa({ pontosColocados: 2 }), est, {}).length > 0);
    checa('desenho com a contagem de pontos ilegivel reprova', d(provaDesenhoBoa({ pontosColocados: null }), est, {}).length > 0);
    checa('desenho com a ferramenta inativa reprova', d(provaDesenhoBoa({ ferramentaAtiva: false }), est, {}).length > 0);
    checa('desenho com aba oculta reprova', d(provaDesenhoBoa({ visibilidade: 'hidden' }), est, {}).length > 0);
    const semQuadro = d(provaDesenhoBoa(), estFalsa({ quadros: 0 }), {});
    checa('desenho sem quadro medido reprova', /zero quadros/.test(semQuadro.join(' ')), semQuadro.join(' '));

    // Ferramenta que exige terreno medida sem terreno. Sem isso a LOS sairia com
    // 180 quadros bonitos de uma ferramenta que nem ativa.
    const semTerreno = d(provaDesenhoBoa({ requerTerreno: true, terreno: false }), est, {});
    checa('ferramenta com requerTerreno medida sem terreno reprova', semTerreno.length > 0);
    checa('a reprova manda ligar o terreno', /--terreno/.test(semTerreno.join(' ')), semTerreno.join(' '));
    checa('a mesma ferramenta COM terreno passa', d(provaDesenhoBoa({ requerTerreno: true, terreno: true }), est, {}).length === 0);
    checa('terreno ligado numa ferramenta que nao exige nao reprova',
        d(provaDesenhoBoa({ requerTerreno: false, terreno: true }), est, {}).length === 0);

    // O eixo NOVO desta branch: a carga tardia. `getControl('AddXControl')`
    // devolve um STAND-IN ate `ensureControl` terminar, e o stand-in nao desenha.
    const standIn = d(provaDesenhoBoa({ ehStandIn: true }), est, {});
    checa('controle que ainda e stand-in reprova', standIn.length > 0);
    checa('a reprova nomeia o ensureControl como o que falta', /ensureControl/.test(standIn.join(' ')), standIn.join(' '));
    checa('controle ausente reprova', d(provaDesenhoBoa({ controlePresente: false }), est, {}).length > 0);

    // Arrasto: o traco E a sequencia de posicoes, entao ponto perdido e defeito.
    checa('arrasto bom passa', d(provaArrastoBoa(), est, {}).length === 0, JSON.stringify(d(provaArrastoBoa(), est, {})));
    const perdeu = d(provaArrastoBoa({ pontosAcumulados: 90 }), est, {});
    checa('arrasto que perdeu metade dos pontos reprova', perdeu.length > 0);
    checa('a reprova diz quantos pontos para quantos eventos', /90 pontos acumulados para 180 eventos/.test(perdeu.join(' ')), perdeu.join(' '));
    checa('arrasto com um ponto a mais tambem reprova', d(provaArrastoBoa({ pontosAcumulados: 182 }), est, {}).length > 0);
    checa('arrasto sem leitura dos pontos reprova', d(provaArrastoBoa({ pontosAcumulados: null }), est, {}).length > 0);
    checa('arrasto sem contagem de eventos reprova', d(provaArrastoBoa({ eventosDeMovimento: null }), est, {}).length > 0);
    // No arrasto o `pontosColocados` lido depois do pointerup e zero de direito.
    checa('arrasto nao e cobrado pela regra do clique', d(provaArrastoBoa({ pontosColocados: 0 }), est, {}).length === 0);
    const arrastoSemFeedback = d(provaArrastoBoa({ setDataAlvo: 0, escritasAlvo: 0 }), est, {});
    checa('arrasto sem escrita do feedback reprova', /a ferramenta nao desenhou/.test(arrastoSemFeedback.join(' ')));

    // modoDesenho que a bancada nao sabe medir: sem esta reprova o gesto errado
    // sairia com o rotulo certo.
    const modoTorto = d(provaDesenhoBoa({ modoDesenho: 'girar' }), est, {});
    checa('modoDesenho desconhecido reprova', modoTorto.length > 0);
    checa('a reprova nomeia o modo que veio', /"girar"/.test(modoTorto.join(' ')), modoTorto.join(' '));
    checa('modoDesenho ausente vale como clique', d(provaDesenhoBoa({ modoDesenho: undefined }), est, {}).length === 0);

    // O CONTADOR DE RESOLVE, contra si mesmo. Um contador que nao foi instalado
    // le zero, e zero e exatamente o numero que o porte quer produzir: sem esta
    // reprova a bancada carimbaria "coalesce perfeitamente" numa ferramenta que
    // resolve o snap cinco vezes por quadro.
    const semContador = d(provaDesenhoBoa({ contadorDeSnapInstalado: false, contadorDeSnapMotivo: 'getSnappingService() devolveu null' }), est, {});
    checa('desenho com o contador de resolve nao instalado reprova', semContador.length > 0);
    checa('a reprova diz que resolve 0 nao prova coalescencia', /nao prova/.test(semContador.join(' ')), semContador.join(' '));
    checa('a reprova repete o motivo que veio da pagina', /devolveu null/.test(semContador.join(' ')), semContador.join(' '));

    // O caso mais traicoeiro: o contador FOI instalado, mas num segundo exemplar
    // do modulo, e por isso nunca ve a chamada que a ferramenta faz.
    const contadorCego = d(provaDesenhoBoa(), estFalsa({ resolve: 0 }), {});
    checa('ferramenta que snapa, snapping ligado e zero resolve contado reprova', contadorCego.length > 0);
    checa('a reprova diz que o contador nao esta no servico que a ferramenta usa',
        /nao esta no servico/.test(contadorCego.join(' ')), contadorCego.join(' '));
    // ...e os tres casos em que zero e a verdade, e reprovar seria mentira.
    checa('seta e pincel (snapa: false) nao sao cobrados por zero resolve',
        d(provaDesenhoBoa({ snapa: false }), estFalsa({ resolve: 0 }), {}).length === 0);
    checa('rodada sem --snapping nao e cobrada por zero resolve',
        d(provaDesenhoBoa({ snapping: false }), estFalsa({ resolve: 0 }), {}).length === 0);
    checa('cenario sem quadro nenhum nao vira reprova de contador cego',
        d(provaDesenhoBoa(), estFalsa({ quadros: 0, resolve: 0 }), {}).filter((e) => /nao esta no servico/.test(e)).length === 0);
    checa('resolve contado normalmente passa', d(provaDesenhoBoa(), estFalsa({ resolve: 180 }), {}).length === 0);
}
eixo4();

function eixo5() {
    console.log('\n== eixo 5: prova do ZOOM (o pior caso de cada eixo)');
    const est = estFalsa();
    const z = CENARIOS.zoom.validar;
    const alvo = { feicoes: 30 };
    checa('zoom bom passa', z(provaZoomBoa(), est, alvo).length === 0, JSON.stringify(z(provaZoomBoa(), est, alvo)));
    // A prova boa desta branch tem `setDataAlvo` ZERO: a fonte principal e
    // migrada. Uma regua que cobrasse `setData` reprovaria o app intacto.
    checa('a prova boa do zoom escreve por updateData, com setData zero',
        provaZoomBoa().setDataAlvo === 0 && provaZoomBoa().updateDataAlvo === 1);

    const vazia = z(provaZoomBoa({ naFonte: 0 }), est, alvo);
    checa('zoom com a fonte vazia reprova', vazia.length > 0);
    checa('a reprova diz que zoom sem feicao nao mede a ferramenta', /zoom sem feicao/.test(vazia.join(' ')), vazia.join(' '));
    checa('zoom com fonte inexistente (null) reprova', z(provaZoomBoa({ naFonte: null }), est, alvo).length > 0);

    // O store guarda 30 e o mapa mostra 12: a medida descreve outro estado.
    const parcial = z(provaZoomBoa({ naFonte: 12 }), est, alvo);
    checa('fonte com menos feicoes que o pedido reprova', /o mapa nao mostra o que o store guarda/.test(parcial.join(' ')), parcial.join(' '));
    checa('store com menos feicoes que o pedido reprova', z(provaZoomBoa({ noStore: 24 }), est, alvo).length > 0);
    checa('store com MAIS feicoes que o pedido reprova (contexto sujo)', z(provaZoomBoa({ noStore: 60, naFonte: 60 }), est, alvo).length > 0);
    checa('zoom sem quadro medido reprova', z(provaZoomBoa(), estFalsa({ quadros: 0 }), alvo).length > 0);
    checa('zoom com aba oculta reprova', z(provaZoomBoa({ visibilidade: 'hidden' }), est, alvo).length > 0);
    // Uma fonte que devolve MAIS feicoes que as linhas criadas e legitima: a
    // geometria de uma ferramenta pode render varias feicoes por linha.
    checa('fonte com mais feicoes que o store nao reprova sozinha', z(provaZoomBoa({ naFonte: 90 }), est, alvo).length === 0);

    // O pincel conclui no cenario ANTERIOR (o pointerup do desenho cria a
    // feicao), entao o store ja tem N0 antes do zoom. O alvo e N0 + criadas.
    const comBase = provaZoomBoa({ noStoreAntesDeCriar: 3, noStore: 33, naFonte: 33 });
    checa('store que ja tinha feicoes do cenario anterior passa pela soma', z(comBase, est, alvo).length === 0, JSON.stringify(z(comBase, est, alvo)));
    const somaErrada = z(provaZoomBoa({ noStoreAntesDeCriar: 3, noStore: 30, naFonte: 30 }), est, alvo);
    checa('store que nao somou as criadas as anteriores reprova', somaErrada.length > 0);
    checa('a reprova mostra a soma esperada', /esperadas 33 \(3 antes do cenario \+ 30 criadas\)/.test(somaErrada.join(' ')), somaErrada.join(' '));
    checa('base zero continua cobrando o numero pedido', z(provaZoomBoa({ noStoreAntesDeCriar: 0, noStore: 31 }), est, alvo).length > 0);

    // Terreno, o mesmo eixo do desenho: a LOS sem terreno cria zero feicao.
    checa('zoom de ferramenta com requerTerreno sem terreno reprova',
        z(provaZoomBoa({ requerTerreno: true, terreno: false }), est, alvo).length > 0);
    checa('zoom com terreno ligado passa', z(provaZoomBoa({ requerTerreno: true, terreno: true }), est, alvo).length === 0);
    // Carga tardia: o stand-in nao cria feicao, e mediria o gesto de zoom com o
    // rotulo da ferramenta.
    checa('zoom com o controle ainda em stand-in reprova', z(provaZoomBoa({ ehStandIn: true }), est, alvo).length > 0);
}
eixo5();

function eixo6() {
    console.log('\n== eixo 6: prova da CONCLUSAO');
    const est = estFalsa({ quadros: 20 });
    const c = CENARIOS.conclusao.validar;
    checa('conclusao boa passa', c(provaConclusaoBoa(), est, {}).length === 0, JSON.stringify(c(provaConclusaoBoa(), est, {})));

    const naoSubiu = c(provaConclusaoBoa({ noStore: 30, msStore: null }), est, {});
    checa('store que nao subiu reprova', naoSubiu.length > 0);
    checa('a reprova diz que a feicao nao foi concluida', /a feicao nao foi concluida/.test(naoSubiu.join(' ')), naoSubiu.join(' '));
    checa('store subiu mas sem tempo medido reprova', c(provaConclusaoBoa({ msStore: null }), est, {}).length > 0);
    checa('store ilegivel reprova', c(provaConclusaoBoa({ noStore: null }), est, {}).length > 0);

    // O eixo NOVO desta branch: o store subiu e a fonte do mapa nao recebeu
    // escrita nenhuma. E o modo de falha que o despachante de diff pode produzir
    // (lote pendente descartado por um setData cru): o usuario tem a feicao
    // gravada e a tela vazia, e so olhar o store aprovaria isso.
    const semEscrita = c(provaConclusaoBoa({ setDataAlvo: 0, updateDataAlvo: 0, escritasAlvo: 0 }), est, {});
    checa('feicao que entrou no store e nao chegou a fonte reprova', semEscrita.length > 0);
    checa('a reprova diz que a feicao nao chegou ao mapa', /nao chegou ao mapa/.test(semEscrita.join(' ')), semEscrita.join(' '));
    checa('conclusao escrita por setData cru tambem passa (a regua cobra a escrita, nao o metodo)',
        c(provaConclusaoBoa({ setDataAlvo: 2, updateDataAlvo: 0 }), est, {}).length === 0);

    // Dois dos tres cliques se perderam: a feicao concluida nao e a que a
    // bancada pensa ter desenhado.
    const cliquePerdido = c(provaConclusaoBoa({ cliquesQuePegaram: 1 }), est, {});
    checa('clique que nao virou vertice reprova', /1 de 3 cliques/.test(cliquePerdido.join(' ')), cliquePerdido.join(' '));
    checa('conclusao com aba oculta reprova', c(provaConclusaoBoa({ visibilidade: 'hidden' }), est, {}).length > 0);
    // Painel que nao abriu nao invalida: nem toda ferramenta abre painel.
    checa('painel ausente nao reprova sozinho', c(provaConclusaoBoa({ msPainel: null }), est, {}).length === 0);

    // Conclusao por pointerup (o pincel): sem traco na mao, o up nao cria nada.
    const pincelBom = provaConclusaoBoa({
        gesto: 'pointerup', cliquesPedidos: 0, cliquesQuePegaram: 0, pontosDoTraco: 14,
        fonteAlvo: 'brushes', tipo: 'brushes',
    });
    checa('conclusao do pincel com traco passa', c(pincelBom, est, {}).length === 0, JSON.stringify(c(pincelBom, est, {})));
    const semTraco = c({ ...pincelBom, pontosDoTraco: 1 }, est, {});
    checa('pointerup sem traco de 2 pontos reprova', semTraco.length > 0);
    checa('a reprova diz que menos de 2 pontos nao vira feicao', /menos de 2 nao vira feicao/.test(semTraco.join(' ')), semTraco.join(' '));
    checa('pointerup sem leitura do traco reprova', c({ ...pincelBom, pontosDoTraco: null }, est, {}).length > 0);
    checa('a conclusao por clique nao e cobrada pelo traco', c(provaConclusaoBoa({ pontosDoTraco: null }), est, {}).length === 0);

    checa('conclusao de ferramenta com requerTerreno sem terreno reprova',
        c(provaConclusaoBoa({ requerTerreno: true, terreno: false }), est, {}).length > 0);
    checa('conclusao com o controle ainda em stand-in reprova',
        c(provaConclusaoBoa({ ehStandIn: true }), est, {}).length > 0);

    // Analise (LOS, visibilidade): a feicao no store nao e o que a tela mostra.
    const analiseBoa = provaConclusaoBoa({
        requerTerreno: true, terreno: true, processadoDeclarado: true,
        naFonteProcessadaAntes: 30, naFonteProcessada: 32, msProcessado: 41.2,
    });
    checa('analise com resultado processado passa', c(analiseBoa, est, {}).length === 0, JSON.stringify(c(analiseBoa, est, {})));
    const semProcessado = c({ ...analiseBoa, msProcessado: null, naFonteProcessada: 30 }, est, {});
    checa('analise cuja fonte processada nao cresceu reprova', semProcessado.length > 0);
    checa('a reprova diz que a analise nao chegou a tela', /nao chegou a tela/.test(semProcessado.join(' ')), semProcessado.join(' '));
    const storeSemTela = c({ ...analiseBoa, msProcessado: null }, est, {});
    checa('store que subiu sem o processado aparecer reprova', /nao apareceu na fonte dentro do limite/.test(storeSemTela.join(' ')), storeSemTela.join(' '));
    checa('ferramenta sem resultado processado nao e cobrada por ele',
        c(provaConclusaoBoa({ processadoDeclarado: false, msProcessado: null }), est, {}).length === 0);
}
eixo6();

function eixo7() {
    console.log('\n== eixo 7: celula, mediana e amplitude');
    checa('celula sem valor vira traco', celula([null, undefined, NaN]) === '-');
    checa('celula de um valor nao mostra amplitude', celula([27]) === '27');
    checa('celula de valores iguais nao mostra amplitude', celula([1, 1, 1]) === '1');
    checa('celula com amplitude mostra min..max', celula([1, 91]) === '46 (1..91)', celula([1, 91]));
    checa('celula ignora o nulo no meio', celula([9, null, 11]) === '10 (9..11)', celula([9, null, 11]));
}
eixo7();

function eixo8() {
    console.log('\n== eixo 8: montagem da tabela e vereditos');
    const bom = resultadoFalso({ rodadas: [
        rodadaFalsa(1, { aquecimento: true }),
        rodadaFalsa(2),
    ] });
    const tb = montarTabela(bom);
    checa('tabela boa sai ok', tb.linhas[0].veredito === 'ok', tb.linhas[0].veredito);
    checa('tabela boa descarta o aquecimento', /rodadas usadas: 2/.test(tb.nota), tb.nota);

    // Uma linha por (ferramenta, cenario, k), na ordem canonica dos cenarios.
    const tresCenarios = resultadoFalso({ rodadas: [rodadaFalsa(1, { casos: [
        casoFalso('conclusao'),
        casoFalso('desenho', { k: 4 }),
        casoFalso('zoom'),
        casoFalso('desenho', { k: 1 }),
    ] })] });
    const t3 = montarTabela(tresCenarios);
    checa('a tabela sai na ordem desenho k=1, desenho k=4, zoom, conclusao',
        t3.linhas.map((l) => `${l.cenario}/${l.k}`).join(' ') === 'desenho/1 desenho/4 zoom/- conclusao/-',
        t3.linhas.map((l) => `${l.cenario}/${l.k}`).join(' '));
    checa('ORDEM_CENARIOS e a ordem que a tabela usa', ORDEM_CENARIOS.join(',') === 'desenho,zoom,conclusao');
    checa('chavesDaTabela nao repete chave entre rodadas',
        chavesDaTabela([rodadaFalsa(1, { casos: [casoFalso('desenho', { k: 1 })] }), rodadaFalsa(2, { casos: [casoFalso('desenho', { k: 1 })] })]).length === 1);

    // Dois k dao duas linhas, cada uma com a SUA medida.
    const doisK = resultadoFalso({ rodadas: [rodadaFalsa(1, { casos: [
        casoFalso('desenho', { k: 1, est: estFalsa({ quadros: 180, dt: 1.7 }) }),
        casoFalso('desenho', { k: 8, est: estFalsa({ quadros: 180, dt: 5.8 }) }),
    ] })] });
    const tk = montarTabela(doisK);
    checa('k=1 e k=8 dao linhas distintas com medidas distintas',
        tk.linhas.length === 2 && tk.linhas[0].valores[1].texto === '1.7' && tk.linhas[1].valores[1].texto === '5.8',
        JSON.stringify(tk.linhas.map((l) => [l.k, l.valores[1].texto])));

    // As TRES colunas de escrita tem de chegar a tabela separadas: e por elas
    // que se distingue quem manda uma escrita por gesto de quem reenvia a
    // colecao por quadro, e por qual caminho.
    const migrada = resultadoFalso({ rodadas: [rodadaFalsa(1, { casos: [
        casoFalso('zoom', { prova: provaZoomBoa({ setDataAlvo: 0, updateDataAlvo: 91, escritasAlvo: 91, naFonte: 30, noStore: 30 }) }),
    ] })] });
    const colunasMigrada = Object.fromEntries(montarTabela(migrada).linhas[0].valores.map((v) => [v.nome, v.texto]));
    checa('a tabela mostra a soma das escritas do alvo', colunasMigrada['escritas alvo'] === '91', JSON.stringify(colunasMigrada));
    checa('a tabela mostra updateData separado de setData',
        colunasMigrada['updData alvo'] === '91' && colunasMigrada['setData alvo'] === '0', JSON.stringify(colunasMigrada));
    checa('uma escrita por gesto e 91 por gesto dao celulas distintas',
        Object.fromEntries(montarTabela(resultadoFalso({ rodadas: [rodadaFalsa(1, { casos: [casoFalso('zoom')] })] }))
            .linhas[0].valores.map((v) => [v.nome, v.texto]))['escritas alvo'] === '1');

    // A latencia escassa tem de sair na tabela com o par (assentaram, perdidos).
    const escassa = resultadoFalso({ rodadas: [rodadaFalsa(1, { casos: [
        casoFalso('desenho', { k: 1, est: estFalsa({ latencias: [16, 17], superadas: 178 }) }),
    ] })] });
    const te = montarTabela(escassa);
    const colunas = Object.fromEntries(te.linhas[0].valores.map((v) => [v.nome, v.texto]));
    checa('a tabela mostra quantas latencias assentaram', colunas['lat n'] === '2', JSON.stringify(colunas));
    checa('a tabela mostra o feedback perdido ao lado da latencia', colunas.perdidos === '178', JSON.stringify(colunas));

    // As tres colunas do porte das formas. A dividida por quadro e a que compara
    // rodadas de duracao diferente sem mentir.
    const comContadores = resultadoFalso({ rodadas: [rodadaFalsa(1, { casos: [
        casoFalso('desenho', { k: 8, est: estFalsa({ resolve: 720, timers: 540, timersCurtos: 540 }) }),
    ] })] });
    const tc = montarTabela(comContadores);
    const colC = Object.fromEntries(tc.linhas[0].valores.map((v) => [v.nome, v.texto]));
    checa('a tabela mostra as chamadas a snapping.resolve', colC.resolve === '720', JSON.stringify(colC));
    checa('a tabela mostra resolve por quadro', colC['res/quadro'] === '4', JSON.stringify(colC));
    checa('a tabela mostra os timers armados no gesto', colC.timers === '540', JSON.stringify(colC));
    checa('as colunas novas aparecem no markdown', /res\/quadro/.test(escreverMarkdown(comContadores, tc)));

    const gpuFalsa = resultadoFalso({ renderer: 'Google SwiftShader', relogio: 'INVALIDO (GPU emulada)', rodadas: [rodadaFalsa(1)] });
    checa('renderer emulado marca o relogio na tabela', /INVALIDO \(GPU emulada\)/.test(montarTabela(gpuFalsa).linhas[0].veredito), montarTabela(gpuFalsa).linhas[0].veredito);

    const rodadaRuim = resultadoFalso({ rodadas: [rodadaFalsa(1, { valida: false, erros: ['cadencia ociosa do rAF p95 33 ms acima de 25'] })] });
    const tr = montarTabela(rodadaRuim);
    checa('rodada invalida (cadencia ou aba oculta) marca a celula', /RODADA INVALIDA/.test(tr.linhas[0].veredito), tr.linhas[0].veredito);
    checa('sem rodada valida a nota denuncia', /NENHUMA rodada valida/.test(tr.nota), tr.nota);

    const cenRuim = resultadoFalso({ rodadas: [rodadaFalsa(1, { casos: [
        casoFalso('desenho', { k: 1, prova: provaDesenhoBoa({ setDataAlvo: 0, escritasAlvo: 0 }) }),
    ] })] });
    checa('cenario sem feedback marca CENARIO INVALIDO na tabela', /CENARIO INVALIDO/.test(montarTabela(cenRuim).linhas[0].veredito), montarTabela(cenRuim).linhas[0].veredito);

    const zoomRuim = resultadoFalso({ rodadas: [rodadaFalsa(1, { casos: [
        casoFalso('zoom', { prova: provaZoomBoa({ naFonte: 0 }) }),
    ] })] });
    checa('zoom sem feicao marca CENARIO INVALIDO na tabela', /CENARIO INVALIDO/.test(montarTabela(zoomRuim).linhas[0].veredito));

    // O app trocado no meio da bancada: dois aplicativos com o mesmo rotulo.
    const appMudou = resultadoFalso({ rodadas: [rodadaFalsa(1, { valida: false, erros: ['o app mudou entre as cargas (assinatura distinta)'] })] });
    appMudou.ambiente.appMudou = true;
    appMudou.ambiente.assinaturas = { '302c/103f': ['r1'], '305c/104f': ['r2'] };
    const tm = montarTabela(appMudou);
    checa('app mudando entre as cargas marca a celula', /APP MUDOU ENTRE AS CARGAS/.test(tm.linhas[0].veredito), tm.linhas[0].veredito);
    checa('app mudando aparece no markdown', /O APP MUDOU DURANTE A BANCADA/.test(escreverMarkdown(appMudou, tm)));
    checa('app estavel nao marca nada', montarTabela(bom).linhas[0].veredito === 'ok');

    const md = escreverMarkdown(bom, tb);
    checa('o markdown tem a linha da ferramenta e do cenario', /\| coordination_line \| desenho \| 1 \|/.test(md), md.split('\n').filter((x) => /coordination_line/.test(x))[0]);
    checa('o markdown registra o veredito por cenario', /prova ok/.test(md));
    checa('o markdown despeja a prova da ultima rodada', /Provas dos cenarios/.test(md) && /escritasAlvo/.test(md));
    checa('a legenda do markdown explica por que ha duas colunas de metodo', /geojson-dispatcher/.test(md));
    const mdRuim = escreverMarkdown(cenRuim, montarTabela(cenRuim));
    checa('o markdown diz por que o cenario caiu', /a ferramenta nao desenhou/.test(mdRuim));
}
eixo8();

function eixo9() {
    console.log('\n== eixo 9: leitura da linha de comando');
    const p = lerArgumentos([]);
    checa('padrao mede coordination_line, k 1,4,8, 30 feicoes, 2 rodadas',
        p.ferramenta === 'coordination_line' && p.k.join(',') === '1,4,8' && p.feicoes === 30 && p.rodadas === 2,
        JSON.stringify({ f: p.ferramenta, k: p.k, n: p.feicoes, r: p.rodadas }));
    checa('o padrao de --url e o stack de desenvolvimento desta branch (Vite na 3000, sem prefixo)',
        p.url === (process.env.EBGEO_URL || 'http://localhost:3000/'), p.url);
    checa('padrao nao liga terreno, snapping nem estrangula CPU', p.terreno === false && p.snapping === false && p.cpu === 1);
    checa('padrao usa 1600x900 com cabeca', p.largura === 1600 && p.altura === 900 && p.headless === false);
    const p2 = lerArgumentos(['--ferramenta', 'boundary', '--k', '4, 1', '--feicoes', '10', '--rodadas', '1', '--terreno', '--snapping', '--cpu', '4']);
    checa('--ferramenta boundary e lida', p2.ferramenta === 'boundary');
    checa('--k volta ordenada, mesmo digitada fora de ordem', p2.k.join(',') === '1,4', p2.k.join(','));
    checa('--feicoes, --rodadas e --cpu sao lidos', p2.feicoes === 10 && p2.rodadas === 1 && p2.cpu === 4);
    checa('--terreno e --snapping sem valor ligam', p2.terreno === true && p2.snapping === true);
    checa('--terreno false desliga', lerArgumentos(['--terreno', 'false']).terreno === false);
    checa('--headless sem valor liga', lerArgumentos(['--headless']).headless === true);
    checa('padrao de --proxy e ambiente', lerArgumentos([]).proxy === 'ambiente');
    checa('--proxy sem-proxy e lido', lerArgumentos(['--proxy', 'sem-proxy']).proxy === 'sem-proxy');
    lanca('--proxy desconhecido lanca', () => lerArgumentos(['--proxy', 'tunel']));

    // A feicao da LOS e da visibilidade custa uma varredura do terreno, entao o
    // padrao de --feicoes e da FERRAMENTA. Pedido explicito continua mandando.
    checa('los pede menos feicoes que o padrao', lerArgumentos(['--ferramenta', 'los']).feicoes === FERRAMENTAS.los.feicoesPadrao,
        String(lerArgumentos(['--ferramenta', 'los']).feicoes));
    checa('visibility pede menos feicoes que o padrao', lerArgumentos(['--ferramenta', 'visibility']).feicoes === FERRAMENTAS.visibility.feicoesPadrao);
    checa('--feicoes explicito manda na ferramenta', lerArgumentos(['--ferramenta', 'visibility', '--feicoes', '30']).feicoes === 30);
    checa('ferramenta sem feicoesPadrao continua em 30', lerArgumentos(['--ferramenta', 'brush']).feicoes === 30);

    lanca('ferramenta desconhecida lanca', () => lerArgumentos(['--ferramenta', 'poligono']));
    lanca('ferramenta com o nome do CONTROLE lanca (o nome curto e o contrato)', () => lerArgumentos(['--ferramenta', 'AddBoundaryControl']));
    lanca('--k 0 lanca', () => lerArgumentos(['--k', '0']));
    lanca('--k negativo lanca', () => lerArgumentos(['--k', '1,-2']));
    lanca('--k nao numerico lanca', () => lerArgumentos(['--k', 'muito']));
    lanca('--k fracionario lanca', () => lerArgumentos(['--k', '1.5']));
    lanca('--k vazia lanca', () => lerArgumentos(['--k', ' , ']));
    lanca('--k repetida lanca', () => lerArgumentos(['--k', '4,4']));
    lanca('--feicoes 0 lanca (zoom sem feicao nao mede nada)', () => lerArgumentos(['--feicoes', '0']));
    lanca('--feicoes fracionaria lanca', () => lerArgumentos(['--feicoes', '2.5']));
    lanca('--rodadas 0 lanca', () => lerArgumentos(['--rodadas', '0']));
    lanca('--cpu 0 lanca', () => lerArgumentos(['--cpu', '0']));
    lanca('argumento desconhecido lanca', () => lerArgumentos(['--turbo']));

    // A mensagem tem de dizer as ferramentas conhecidas, senao o operador chuta.
    try { lerArgumentos(['--ferramenta', 'x']); } catch (e) {
        checa('a reprova lista as ferramentas conhecidas', /coordination_line/.test(e.message) && /occupied_front/.test(e.message), e.message);
    }
}
eixo9();

function eixo10() {
    console.log('\n== eixo 10: o mapa de nomes das ferramentas');
    const nomes = Object.keys(FERRAMENTAS);
    checa('as nove ferramentas do pedido estao no mapa',
        ['line', 'polygon', 'boundary', 'arrow', 'occupied_front', 'coordination_line', 'los', 'visibility', 'brush']
            .every((n) => nomes.includes(n)),
        nomes.join(','));
    checa('as quatro formas entraram no mapa',
        ['circle', 'ellipse', 'rectangle', 'sector'].every((n) => nomes.includes(n)), nomes.join(','));
    checa('as quatro formas concluem no SEGUNDO clique, sem botao direito',
        ['circle', 'ellipse', 'rectangle', 'sector'].every((n) => FERRAMENTAS[n].conclusao.gesto === 'clique-final'
            && FERRAMENTAS[n].conclusao.cliquesAntes === 1 && FERRAMENTAS[n].conclusao.evento === 'click'));
    checa('as quatro formas criam com dois pontos',
        ['circle', 'ellipse', 'rectangle', 'sector'].every((n) => FERRAMENTAS[n].pontosParaCriar === 2));
    // O setor e o unico cujo balde do store esta em portugues. Escrever
    // `sectors` aqui daria zero feicao no cenario zoom, em silencio.
    checa('o setor le o store e a fonte em `setores`',
        FERRAMENTAS.sector.tipo === 'setores' && FERRAMENTAS.sector.fonte === 'setores',
        `${FERRAMENTAS.sector.tipo}/${FERRAMENTAS.sector.fonte}`);
    checa('o feedback das formas segue o prefixo em ingles do controle',
        ['circle', 'ellipse', 'rectangle', 'sector'].every((n) => FERRAMENTAS[n].feedback === `${n}-feedback`));
    checa('so a seta e o pincel declaram que nao snapam',
        nomes.filter((n) => FERRAMENTAS[n].snapa === false).join(',') === 'arrow,brush',
        nomes.filter((n) => FERRAMENTAS[n].snapa === false).join(','));
    checa('o padrao do normalizador e snapa true',
        normalizarFerramenta('line').snapa === true && normalizarFerramenta('brush').snapa === false);
    for (const nome of nomes) {
        // O normalizador e quem cobra: descritor incompleto lanca aqui, e nao a
        // 90 segundos de carga com o app ja no ar.
        checa(`${nome} passa pelo normalizador`, !!normalizarFerramenta(nome), nome);
    }
    checa('o controle sempre comeca com Add e termina em Control',
        Object.values(FERRAMENTAS).every((f) => /^Add.*Control$/.test(f.controle)));
    checa('a fonte principal e o tipo do store tem o mesmo nome (FEATURE_SOURCES)',
        Object.values(FERRAMENTAS).every((f) => f.fonte === f.tipo));
    checa('a frente ocupada, a LOS e a visibilidade concluem no segundo clique',
        ['occupied_front', 'los', 'visibility'].every((n) => FERRAMENTAS[n].conclusao.gesto === 'clique-final'
            && FERRAMENTAS[n].conclusao.cliquesAntes === 1));
    checa('as cinco de varios vertices concluem por botao direito depois de 3 cliques',
        ['line', 'polygon', 'boundary', 'arrow', 'coordination_line']
            .every((n) => FERRAMENTAS[n].conclusao.gesto === 'botao-direito' && FERRAMENTAS[n].conclusao.cliquesAntes === 3));
    checa('o pincel conclui no pointerup, sem clique nenhum antes',
        FERRAMENTAS.brush.conclusao.gesto === 'pointerup' && FERRAMENTAS.brush.conclusao.cliquesAntes === 0
        && FERRAMENTAS.brush.conclusao.evento === 'pointerup');
    checa('so o pincel desenha por arrasto',
        nomes.filter((n) => FERRAMENTAS[n].modoDesenho === 'arrastar').join(',') === 'brush');
    checa('so a LOS e a visibilidade exigem terreno',
        nomes.filter((n) => FERRAMENTAS[n].requerTerreno).join(',') === 'los,visibility');
    checa('quem exige terreno le o ponto do observador em startPoint',
        ['los', 'visibility'].every((n) => FERRAMENTAS[n].pontos.propriedade === 'startPoint' && FERRAMENTAS[n].pontos.forma === 'ponto'));
    checa('o pincel acumula o traco em points',
        FERRAMENTAS.brush.pontos.propriedade === 'points' && FERRAMENTAS.brush.pontos.forma === 'lista');
    checa('so as duas ferramentas de analise declaram resultado processado',
        nomes.filter((n) => FERRAMENTAS[n].processado).join(',') === 'los,visibility');
    checa('a fonte processada nao se confunde com a principal',
        ['los', 'visibility'].every((n) => FERRAMENTAS[n].processado.fonte !== FERRAMENTAS[n].fonte
            && FERRAMENTAS[n].processado.tipo !== FERRAMENTAS[n].tipo));
    checa('o poligono cria por anel, com 3 pontos ou mais', FERRAMENTAS.polygon.anel === true && FERRAMENTAS.polygon.pontosParaCriar >= 3);
    checa('nenhuma ferramenta repete a fonte de feedback',
        new Set(Object.values(FERRAMENTAS).map((f) => f.feedback)).size === Object.keys(FERRAMENTAS).length);
    checa('nenhuma ferramenta repete o controle',
        new Set(Object.values(FERRAMENTAS).map((f) => f.controle)).size === Object.keys(FERRAMENTAS).length);
    // A chave do carregador tardio NAO mora no descritor: ela e casada pelo nome
    // da classe contra a tabela do PROPRIO app, dentro da pagina. Escrita aqui,
    // envelheceria sozinha e o modo de falha seria medir o stand-in.
    checa('nenhum descritor carrega a chave do tool-registry',
        Object.values(FERRAMENTAS).every((f) => !('controlKey' in f) && !('chave' in f)));
}
eixo10();

function eixo11() {
    console.log('\n== eixo 11: o normalizador do descritor (o pior caso de cada campo)');
    const bom = {
        controle: 'AddXControl', tipo: 'xs', fonte: 'xs', feedback: 'x-feedback', painel: '.x-attributes-section',
        pontosParaCriar: 2, conclusao: { gesto: 'clique-final', cliquesAntes: 1, evento: 'click' },
    };
    const com = (extra) => ({ x: { ...bom, ...extra } });

    const padrao = normalizarFerramenta('x', com({}));
    checa('descritor minimo ganha os padroes',
        padrao.modoDesenho === 'clique' && padrao.semeadura === 'drawPoints'
        && padrao.pontos.propriedade === 'drawPoints' && padrao.requerTerreno === false,
        JSON.stringify(padrao));
    checa('o nome curto entra no descritor', padrao.nome === 'x');

    // Descritor sem conclusao: a bancada nao teria gesto para fechar a feicao, e
    // o cenario mediria o nada com o rotulo certo.
    lanca('descritor sem conclusao lanca', () => normalizarFerramenta('x', { x: { ...bom, conclusao: undefined } }));
    lanca('conclusao sem gesto lanca', () => normalizarFerramenta('x', com({ conclusao: { cliquesAntes: 1, evento: 'click' } })));
    lanca('conclusao sem evento lanca', () => normalizarFerramenta('x', com({ conclusao: { gesto: 'clique-final', cliquesAntes: 1 } })));
    lanca('gesto de conclusao desconhecido lanca', () => normalizarFerramenta('x', com({ conclusao: { gesto: 'balancar', cliquesAntes: 1, evento: 'click' } })));
    lanca('cliquesAntes negativo lanca', () => normalizarFerramenta('x', com({ conclusao: { gesto: 'clique-final', cliquesAntes: -1, evento: 'click' } })));
    lanca('cliquesAntes fracionario lanca', () => normalizarFerramenta('x', com({ conclusao: { gesto: 'clique-final', cliquesAntes: 1.5, evento: 'click' } })));

    lanca('modoDesenho desconhecido lanca', () => normalizarFerramenta('x', com({ modoDesenho: 'girar' })));
    lanca('semeadura desconhecida lanca', () => normalizarFerramenta('x', com({ semeadura: 'magica' })));
    lanca('forma de ponto desconhecida lanca', () => normalizarFerramenta('x', com({ pontos: { propriedade: 'p', forma: 'nuvem' } })));
    lanca('pontos sem propriedade lanca', () => normalizarFerramenta('x', com({ pontos: { forma: 'lista' } })));
    lanca('descritor sem controle lanca', () => normalizarFerramenta('x', com({ controle: undefined })));
    lanca('descritor sem fonte de feedback lanca', () => normalizarFerramenta('x', com({ feedback: undefined })));
    lanca('ferramenta ausente do mapa lanca', () => normalizarFerramenta('y', com({})));

    // A mensagem tem de dizer o que veio e o que a bancada aceita.
    try { normalizarFerramenta('x', com({ modoDesenho: 'girar' })); } catch (e) {
        checa('a reprova do modo diz o valor e as opcoes', /girar/.test(e.message) && MODOS_DESENHO.every((m) => e.message.includes(m)), e.message);
    }
    try { normalizarFerramenta('x', com({ semeadura: 'magica' })); } catch (e) {
        checa('a reprova da semeadura lista as conhecidas', SEMEADURAS.every((s) => e.message.includes(s)), e.message);
    }
    try { normalizarFerramenta('x', { x: { ...bom, conclusao: undefined } }); } catch (e) {
        checa('a reprova da conclusao mostra a forma esperada', /gesto, cliquesAntes, evento/.test(e.message), e.message);
    }
    checa('GESTOS_CONCLUSAO cobre os gestos que o mapa usa',
        Object.values(FERRAMENTAS).every((f) => GESTOS_CONCLUSAO.includes(f.conclusao.gesto)));
}
eixo11();

function eixo12() {
    console.log('\n== eixo 12: as reguas do INSTRUMENTO (carga tardia, identidade, prontidao, tiles)');
    // Carga tardia.
    checa('controle de verdade passa', errosDeControle({ controlePresente: true, ehStandIn: false }).length === 0);
    const standIn = errosDeControle({ controlePresente: true, ehStandIn: true });
    checa('stand-in reprova', standIn.length > 0);
    checa('a reprova do stand-in diz que ele nao desenha', /nao desenha/.test(standIn.join(' ')), standIn.join(' '));
    checa('controle ausente reprova com a razao dele', /nao expoe o controle/.test(errosDeControle({ controlePresente: false }).join(' ')));
    checa('prova sem os campos de controle nao inventa reprova', errosDeControle({}).length === 0);

    // Identidade do modulo (o `?t=` do HMR do Vite entrega outra copia).
    const identidadeBoa = {
        mapaGlobalPresente: true, registroPresente: true, mesmoMapa: true,
        registroCarregado: true, registroSemeadas: { total: 8, vivas: 8 },
    };
    checa('mapa do registro igual ao global e registro semeado passam', avaliarIdentidade(identidadeBoa).length === 0);
    const outraCopia = avaliarIdentidade({ ...identidadeBoa, mesmoMapa: false });
    checa('dois mapas diferentes reprovam', outraCopia.length > 0);
    checa('a reprova nomeia o HMR do Vite como causa', /HMR/.test(outraCopia.join(' ')), outraCopia.join(' '));
    checa('pagina sem __ebgeoMap reprova', avaliarIdentidade({ ...identidadeBoa, mapaGlobalPresente: false, registroPresente: false, mesmoMapa: false }).length > 0);
    checa('leitura ausente reprova em vez de passar calada', avaliarIdentidade(null).length > 0);
    // O caso que a primeira versao desta bancada deixou passar, e que a rodada
    // real pegou: mapa igual, tool-registry de OUTRA copia, `ensureControl`
    // lancando "usado antes de initToolRegistry()".
    const registroDeOutraCopia = avaliarIdentidade({ ...identidadeBoa, registroSemeadas: { total: 8, vivas: 0 } });
    checa('mapa igual e registro de ferramentas vazio reprova', registroDeOutraCopia.length > 0, JSON.stringify(registroDeOutraCopia));
    checa('a reprova diz que e OUTRA COPIA do modulo', /OUTRA COPIA/.test(registroDeOutraCopia.join(' ')), registroDeOutraCopia.join(' '));
    checa('registro nao importado reprova', avaliarIdentidade({ ...identidadeBoa, registroCarregado: false, registroSemeadas: null }).length > 0);
    checa('tabela sem ferramenta ansiosa reprova em vez de aprovar por vacuidade',
        avaliarIdentidade({ ...identidadeBoa, registroSemeadas: { total: 0, vivas: 0 } }).length > 0);

    // Prontidao do app.
    const pronto = {
        carregado: true, fontesExigidas: 21, fontesAusentes: [], camadas: 300, fontes: 100,
        mapaGlobalPresente: true, registroPresente: true, mesmoMapa: true,
        registroCarregado: true, registroSemeadas: { total: 8, vivas: 8 },
    };
    checa('app inteiro e estavel passa', avaliarProntidao(pronto, 3500).pronto);
    checa('app com fonte faltando reprova mesmo com o estilo cheio',
        !avaliarProntidao({ ...pronto, fontesAusentes: ['los'] }, 3500).pronto);
    checa('estavel por menos de 3 s reprova', !avaliarProntidao(pronto, 900).pronto);
    checa('lista de fontes vazia reprova em vez de aprovar por vacuidade',
        !avaliarProntidao({ ...pronto, fontesExigidas: 0 }, 3500).pronto);
    checa('a identidade do modulo entra na prontidao', !avaliarProntidao({ ...pronto, mesmoMapa: false }, 3500).pronto);

    // Leitura do estado dos tiles.
    checa('leitura de tiles boa passa', validarLeituraDeTiles({ tiles: 40, desconhecidos: 3 }).length === 0);
    const cego = validarLeituraDeTiles({ tiles: 40, desconhecidos: 40 });
    checa('leitor que nao soube o estado de NENHUM tile reprova', cego.length > 0);
    checa('a reprova diz que "tiles estaveis" viraria verdade trivial', /verdade trivial/.test(cego.join(' ')), cego.join(' '));
    checa('mapa sem tile nenhum nao reprova', validarLeituraDeTiles({ tiles: 0, desconhecidos: 0 }).length === 0);
}
eixo12();

function eixo13() {
    console.log('\n== eixo 13: o criterio de `perdidos` e `lat` (o preview que o usuario nao viu)');

    /** Uma escrita na fonte de feedback, no instante t. */
    const escrita = (t) => ({ tipo: 'escrita', t });
    /** Um quadro no instante t, com a fonte assentada ou nao. */
    const quadro = (t, fonteCarregada = true) => ({ tipo: 'quadro', t, fonteCarregada });

    // O PIOR CASO, e o que a coluna antiga errava: uma escrita por quadro, cada
    // uma desenhada pelo seu quadro. Medido no circulo em 2026-09-05, depois do
    // porte: 180 escritas em 180 quadros sairam como 179 "perdidas", e a leitura
    // natural seria "o porte quebrou o preview". Nenhuma se perdeu: o que a
    // coluna via era a fonte ainda nao assentada, e nao uma escrita substituida.
    const umaPorQuadro = [];
    for (let i = 0; i < 180; i++) {
        umaPorQuadro.push(escrita(i * 16.7));
        // A fonte NAO assenta dentro do quadro: e o caso real, com a escrita
        // colada no render.
        umaPorQuadro.push(quadro(i * 16.7 + 5, false));
    }
    const r1 = avaliarFeedback(umaPorQuadro);
    checa('uma escrita por quadro nao perde nenhuma', r1.superadas === 0, `superadas ${r1.superadas} de 180 escritas`);

    // Duas escritas ANTES do quadro: a primeira nunca foi desenhada.
    const duasNoMesmoQuadro = [escrita(0), escrita(5), quadro(16.7)];
    checa('duas escritas no mesmo quadro perdem uma', avaliarFeedback(duasNoMesmoQuadro).superadas === 1,
        String(avaliarFeedback(duasNoMesmoQuadro).superadas));

    const cincoNoMesmoQuadro = [escrita(0), escrita(1), escrita(2), escrita(3), escrita(4), quadro(16.7)];
    checa('cinco escritas no mesmo quadro perdem quatro', avaliarFeedback(cincoNoMesmoQuadro).superadas === 4,
        String(avaliarFeedback(cincoNoMesmoQuadro).superadas));

    // Escrita que espera DOIS quadros para a fonte assentar: continua sendo a
    // mesma escrita, desenhada com atraso, e nao uma escrita perdida.
    const esperaDoisQuadros = [escrita(0), quadro(16.7, false), quadro(33.4, true)];
    const r2 = avaliarFeedback(esperaDoisQuadros);
    checa('escrita que demora dois quadros para assentar nao conta como perdida', r2.superadas === 0, String(r2.superadas));
    checa('a latencia dessa escrita e ate o quadro em que assentou', r2.latencias[0] === 33.4, JSON.stringify(r2.latencias));

    // A latencia sai da ULTIMA escrita do intervalo, nao da primeira: a anterior
    // nunca chegou a tela, e cronometra-la empilharia o atraso das duas.
    const duasEUmaLatencia = avaliarFeedback([escrita(0), escrita(5), quadro(20, true)]);
    checa('a latencia sai da ultima escrita do intervalo', duasEUmaLatencia.latencias[0] === 15, JSON.stringify(duasEUmaLatencia.latencias));
    checa('e a escrita que ela substituiu conta como perdida', duasEUmaLatencia.superadas === 1);

    checa('sequencia sem escrita nenhuma sai zerada', avaliarFeedback([quadro(0), quadro(16.7)]).superadas === 0);
    checa('sequencia vazia nao explode', avaliarFeedback([]).superadas === 0 && avaliarFeedback([]).latencias.length === 0);
    checa('sequencia nula nao explode', avaliarFeedback(null).superadas === 0);
    // Escrita depois do ultimo quadro fica sem latencia, e nao vira perdida.
    const sobrando = avaliarFeedback([quadro(0), escrita(10)]);
    checa('escrita sem quadro depois nao conta como perdida nem como latencia',
        sobrando.superadas === 0 && sobrando.latencias.length === 0, JSON.stringify(sobrando));

    // A instrumentacao da pagina tem de seguir as MESMAS tres linhas. Ela nao e
    // chamavel daqui (roda dentro do navegador), entao a conferencia e no texto:
    // se alguem mudar um lado sem o outro, a regua pura deixa de descrever o que
    // a bancada mede, e a tabela mente sem ninguem ver.
    const fonte = String(instrumentar);
    // Ancorado no PUSH DO QUADRO, e nao no nome da variavel: `B.superavel = null`
    // tambem aparece no `__zerar`, e a primeira versao desta linha passou verde
    // com a zeragem do render apagada (medido aqui em 2026-09-05, no controle
    // negativo). Verificacao que casa em outro sitio nao verifica este.
    checa('o quadro da pagina zera o marcador de supersessao',
        /B\.quadros\.push\([^;]*;[\s\S]{0,600}?B\.superavel = null;/.test(fonte),
        'nao achei "B.superavel = null;" logo depois do push do quadro em instrumentar');
    checa('a escrita da pagina conta perdida pelo marcador do quadro', /if \(B\.superavel !== null\) B\.superadas\+\+;/.test(fonte),
        'nao achei a contagem por B.superavel em instrumentar');
    checa('a latencia da pagina continua saindo da ultima escrita', /B\.pendente = performance\.now\(\);/.test(fonte));
    checa('a pagina ainda exige a fonte assentada para cronometrar', /fonteCarregada\(cfg\.feedback\)/.test(fonte));
}
eixo13();

function eixo14() {
    console.log('\n== eixo 14: a semeadura do cenario zoom (o insumo que o controle recusa em silencio)');

    // Um sorteio determinista, para o pior caso nao depender da sorte da rodada.
    const semente = (s0) => { let s = s0; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; };

    // Separacao minima entre pontos CONSECUTIVOS de um lote, em grau, nos dois
    // eixos. E o que decide se o retangulo nasce: ele cobra o piso de 10 m em
    // LARGURA E ALTURA por separado (`createFeature` em
    // src/js/draw_tools/rectangle_tool/add_rectangle_control.js), e a altura sai
    // so da latitude. Um grau de latitude vale cerca de 111 km, entao 10 m sao
    // cerca de 0,00009 grau.
    const separacoes = (lotes) => {
        let dx = Infinity;
        let dy = Infinity;
        for (const pts of lotes) {
            for (let k = 1; k < pts.length; k++) {
                dx = Math.min(dx, Math.abs(pts[k][0] - pts[k - 1][0]));
                dy = Math.min(dy, Math.abs(pts[k][1] - pts[k - 1][1]));
            }
        }
        return { dx, dy };
    };

    // O GERADOR ANTIGO, o pior caso que esta regua existe para pegar: passo fixo
    // so em longitude, latitude sorteada de novo a cada ponto.
    const antigo = ({ n, pontos, vista, aleatorio }) => {
        const rnd = (a) => (aleatorio() * 2 - 1) * a;
        const lotes = [];
        for (let i = 0; i < n; i++) {
            const cx = vista.center[0] + rnd(0.03);
            const cy = vista.center[1] + rnd(0.03);
            const pts = [];
            for (let k = 0; k < pontos; k++) pts.push([cx + k * 0.006 + rnd(0.001), cy + rnd(0.004)]);
            lotes.push(pts);
        }
        return lotes;
    };

    const PISO_GRAU = 0.00009; // os 10 m que o retangulo cobra, em latitude
    const velho = separacoes(antigo({ n: 2000, pontos: 2, vista: VISTA, aleatorio: semente(7) }));
    checa('o gerador ANTIGO produz altura abaixo do piso de 10 m (o defeito medido)',
        velho.dy < PISO_GRAU, `menor delta de latitude: ${velho.dy.toFixed(7)} grau`);
    checa('e o gerador antigo nunca errava a LARGURA, que e por isso que so o retangulo caia',
        velho.dx > PISO_GRAU, `menor delta de longitude: ${velho.dx.toFixed(7)} grau`);

    const novo = separacoes(pontosDaSemeadura({ n: 2000, pontos: 2, anel: false, vista: VISTA, aleatorio: semente(7) }));
    checa('o gerador NOVO garante altura muito acima do piso', novo.dy > 10 * PISO_GRAU, `${novo.dy.toFixed(7)} grau`);
    checa('e continua garantindo a largura', novo.dx > 10 * PISO_GRAU, `${novo.dx.toFixed(7)} grau`);
    // O ruido tem de ser menor que metade do passo, senao a garantia some.
    checa('o ruido nao chega a metade do passo de latitude', novo.dy > 0.004 / 2, `${novo.dy.toFixed(7)} grau`);

    // O anel (poligono) nao muda: ele ja nascia de um circulo de raio fixo. O
    // ponto k=0 cai em (cx + 0,004, cy), entao o centro do lote se recupera dele.
    const noRaio = (pts, raio) => {
        const cx = pts[0][0] - raio;
        const cy = pts[0][1];
        return pts.every((p) => Math.abs(Math.hypot(p[0] - cx, p[1] - cy) - raio) < 1e-9);
    };
    const anel = pontosDaSemeadura({ n: 50, pontos: 6, anel: true, vista: VISTA, aleatorio: semente(3) });
    checa('o anel continua fechando com o raio fixo', anel.length === 50 && anel[0].length === 6);
    checa('os pontos do anel ficam a 0,004 grau do centro do lote', noRaio(anel[0], 0.004));
    // ...e a conferencia acima nao e vacua: um anel de outro raio reprova nela.
    checa('a conferencia do anel REPROVA um raio diferente', !noRaio(anel[0], 0.008));

    checa('a semeadura devolve exatamente n lotes de `pontos` coordenadas',
        pontosDaSemeadura({ n: 7, pontos: 4, anel: false, vista: VISTA, aleatorio: semente(1) })
            .every((l) => l.length === 4), 'lote com comprimento errado');

    // E a contagem de criadas passou a sair do STORE, e nao das chamadas que
    // voltaram: `createFeature` recusa em silencio, sem lancar.
    const fonte = String(criarFeicoesPagina);
    checa('a criacao le o store antes e depois', /noStoreAntes/.test(fonte) && /noStoreDepois/.test(fonte));
    checa('a criacao devolve `ok` como a diferenca no store, e nao as chamadas',
        /ok: \(noStoreAntes === null \|\| noStoreDepois === null\) \? chamadas : noStoreDepois - noStoreAntes/.test(fonte),
        'nao achei a diferenca de store em criarFeicoesPagina');
    checa('a criacao ainda guarda as chamadas ao lado, para a diferenca aparecer', /chamadas, noStoreAntes, noStoreDepois/.test(fonte));
}
eixo14();

console.log(`\n${total - falhas}/${total} passaram.`);
if (falhas) { console.log(`${falhas} FALHA(S): a bancada nao esta reprovando o que promete pegar.`); process.exit(1); }
console.log('A bancada de ferramentas reprova o insumo degenerado em todos os eixos que afirma medir.');
