// Autoteste da bancada de ferramentas: prova que ela REPROVA o insumo
// degenerado, eixo a eixo.
//
// Uma regua vista so passar em insumo bom nao foi vista funcionar. Este arquivo
// constroi o pior caso de cada eixo que a bancada afirma medir (leitura da linha
// de comando, estatistica, resumo do setData, cadencia do rAF, prova do
// desenho, prova do zoom, prova da conclusao, montagem da tabela) e confirma que
// cada um sai marcado. Depois confirma que o insumo bom passa, para a regua nao
// ser um carimbo de reprovacao.
//
//   node bench/autoteste-ferramentas.mjs

import process from 'node:process';
import {
    FERRAMENTAS, ORDEM_CENARIOS, CENARIOS, MODOS_DESENHO, SEMEADURAS,
    GESTOS_CONCLUSAO, normalizarFerramenta, lerArgumentos, baseDeModulos,
    avaliarProntidao, avaliarObstrucao, FONTES_MINIMAS, estatistica,
    resumirSetData, avaliarCadencia, celula, chavesDaTabela, montarTabela,
    escreverMarkdown, percentil, mediana,
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

// Prova boa do desenho: a ferramenta ativa, um ponto colocado, feedback escrito,
// e o contador de `snapping.resolve` no ar (sem ele "resolve 0" nao prova nada).
const provaDesenhoBoa = (extra = {}) => ({
    setDataAlvo: 180, feicoesAlvo: 180, setDataOutras: 0, porFonte: {},
    fonteAlvo: 'coordination-line-feedback',
    ferramentaAtiva: true, pontosColocados: 1, visibilidade: 'visible',
    modoDesenho: 'clique', requerTerreno: false, terreno: false,
    controlePresente: true,
    snapa: true, snapping: true, contadorDeSnapInstalado: true, contadorDeSnapMotivo: null,
    ...extra,
});

// Prova boa do desenho por ARRASTO: um traco de 181 pontos para 180 eventos de
// movimento (o do pointerdown mais um por evento).
const provaArrastoBoa = (extra = {}) => provaDesenhoBoa({
    fonteAlvo: 'brush-feedback', modoDesenho: 'arrastar',
    pontosColocados: 0, pontosAcumulados: 181, eventosDeMovimento: 180, ...extra,
});

const provaZoomBoa = (extra = {}) => ({
    setDataAlvo: 1, feicoesAlvo: 30, setDataOutras: 2, porFonte: {},
    fonteAlvo: 'coordination_lines', tipo: 'coordination_lines',
    naFonte: 30, noStore: 30, visibilidade: 'visible', ...extra,
});

const provaConclusaoBoa = (extra = {}) => ({
    setDataAlvo: 2, feicoesAlvo: 2, setDataOutras: 1, porFonte: {},
    fonteAlvo: 'coordination_lines', tipo: 'coordination_lines',
    noStoreAntes: 30, noStore: 31, msStore: 26, msPainel: 27,
    cliquesPedidos: 3, cliquesQuePegaram: 3, gestoDisparou: true,
    visibilidade: 'visible', ...extra,
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
            url: 'http://localhost:3007/ebgeo/', ferramenta, k: [1, 4], feicoes: 30,
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
    checa('setData de feedback substituido antes de assentar conta em perdidos', escasso.feedbackSuperados === 178, String(escasso.feedbackSuperados));
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
    console.log('\n== eixo 2: resumo do setData (a fonte alvo separada do resto)');
    const sd = { 'coordination-line-feedback': { n: 180, feicoes: 180 }, 'snap-indicator': { n: 111, feicoes: 102 } };
    const r = resumirSetData(sd, 'coordination-line-feedback');
    checa('a fonte alvo sai contada a parte', r.setDataAlvo === 180 && r.feicoesAlvo === 180, JSON.stringify(r));
    checa('as outras fontes somam a parte', r.setDataOutras === 111, String(r.setDataOutras));
    const semAlvo = resumirSetData(sd, 'boundary-feedback');
    checa('alvo que ninguem escreveu sai zero (e nao o total)', semAlvo.setDataAlvo === 0 && semAlvo.setDataOutras === 291, JSON.stringify(semAlvo));
    checa('lote sem setData nenhum sai zerado', resumirSetData({}, 'x').setDataAlvo === 0);
    checa('lote nulo nao explode', resumirSetData(null, 'x').setDataOutras === 0);
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

    // O caso do pedido: a ferramenta nao escreveu a fonte de feedback.
    const semFeedback = d(provaDesenhoBoa({ setDataAlvo: 0, feicoesAlvo: 0 }), est, {});
    checa('desenho sem setData de feedback reprova', semFeedback.length > 0);
    checa('a reprova diz que a ferramenta nao desenhou', /a ferramenta nao desenhou/.test(semFeedback.join(' ')), semFeedback.join(' '));
    checa('a reprova nomeia a fonte de feedback', /coordination-line-feedback/.test(semFeedback.join(' ')));

    // O caso que "setData de QUALQUER fonte" aprovaria: o app escreveu 300
    // vezes o snap-indicator e nenhuma vez o feedback da ferramenta.
    const soOutras = d(provaDesenhoBoa({ setDataAlvo: 0, setDataOutras: 300 }), est, {});
    checa('setData de outras fontes nao substitui o do feedback', soOutras.length > 0, JSON.stringify(soOutras));

    checa('desenho com 0 pontos colocados reprova', d(provaDesenhoBoa({ pontosColocados: 0 }), est, {}).length > 0);
    checa('desenho com 2 pontos colocados reprova', d(provaDesenhoBoa({ pontosColocados: 2 }), est, {}).length > 0);
    checa('desenho com a contagem de pontos ilegivel reprova', d(provaDesenhoBoa({ pontosColocados: null }), est, {}).length > 0);
    checa('desenho com a ferramenta inativa reprova', d(provaDesenhoBoa({ ferramentaAtiva: false }), est, {}).length > 0);
    checa('desenho com aba oculta reprova', d(provaDesenhoBoa({ visibilidade: 'hidden' }), est, {}).length > 0);
    const semQuadro = d(provaDesenhoBoa(), estFalsa({ quadros: 0 }), {});
    checa('desenho sem quadro medido reprova', /zero quadros/.test(semQuadro.join(' ')), semQuadro.join(' '));

    // O caso do pedido: ferramenta que exige terreno medida sem terreno. Sem
    // isso a LOS sairia com 180 quadros bonitos de uma ferramenta que nem ativa.
    const semTerreno = d(provaDesenhoBoa({ requerTerreno: true, terreno: false }), est, {});
    checa('ferramenta com requerTerreno medida sem terreno reprova', semTerreno.length > 0);
    checa('a reprova manda ligar o terreno', /--terreno/.test(semTerreno.join(' ')), semTerreno.join(' '));
    checa('a mesma ferramenta COM terreno passa', d(provaDesenhoBoa({ requerTerreno: true, terreno: true }), est, {}).length === 0);
    checa('terreno ligado numa ferramenta que nao exige nao reprova',
        d(provaDesenhoBoa({ requerTerreno: false, terreno: true }), est, {}).length === 0);

    // O outro caso do pedido: modoDesenho que a bancada nao sabe medir. Sem
    // esta reprova o gesto errado sairia com o rotulo certo.
    const modoTorto = d(provaDesenhoBoa({ modoDesenho: 'girar' }), est, {});
    checa('modoDesenho desconhecido reprova', modoTorto.length > 0);
    checa('a reprova nomeia o modo que veio', /"girar"/.test(modoTorto.join(' ')), modoTorto.join(' '));
    checa('modoDesenho ausente vale como clique', d(provaDesenhoBoa({ modoDesenho: undefined }), est, {}).length === 0);

    // Arrasto: o traco E a sequencia de posicoes, entao ponto perdido e defeito.
    checa('arrasto bom passa', d(provaArrastoBoa(), est, {}).length === 0, JSON.stringify(d(provaArrastoBoa(), est, {})));
    const perdeu = d(provaArrastoBoa({ pontosAcumulados: 90 }), est, {});
    checa('arrasto que perdeu metade dos pontos reprova', perdeu.length > 0);
    checa('a reprova diz quantos pontos para quantos eventos', /90 pontos acumulados para 180 eventos/.test(perdeu.join(' ')), perdeu.join(' '));
    checa('arrasto com um ponto a mais tambem reprova', d(provaArrastoBoa({ pontosAcumulados: 182 }), est, {}).length > 0);
    checa('arrasto sem leitura dos pontos reprova', d(provaArrastoBoa({ pontosAcumulados: null }), est, {}).length > 0);
    checa('arrasto sem contagem de eventos reprova', d(provaArrastoBoa({ eventosDeMovimento: null }), est, {}).length > 0);
    // No arrasto o `pontosColocados` lido depois do pointerup e zero de direito:
    // o traco morreu com a feicao, e cobrar 1 aqui reprovaria o pincel bom.
    checa('arrasto nao e cobrado pela regra do clique', d(provaArrastoBoa({ pontosColocados: 0 }), est, {}).length === 0);
    const arrastoSemFeedback = d(provaArrastoBoa({ setDataAlvo: 0 }), est, {});
    checa('arrasto sem setData do feedback reprova', /a ferramenta nao desenhou/.test(arrastoSemFeedback.join(' ')));

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

    // O caso do pedido: gesto de zoom com a fonte vazia.
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
    // O caso que so olhar o store aprovaria: dois dos tres cliques se perderam,
    // e a feicao concluida nao e a que a bancada pensa ter desenhado.
    const cliquePerdido = c(provaConclusaoBoa({ cliquesQuePegaram: 1 }), est, {});
    checa('clique que nao virou vertice reprova', /1 de 3 cliques/.test(cliquePerdido.join(' ')), cliquePerdido.join(' '));
    checa('conclusao com aba oculta reprova', c(provaConclusaoBoa({ visibilidade: 'hidden' }), est, {}).length > 0);
    // Painel que nao abriu nao invalida: nem toda ferramenta abre painel, e o
    // pedido pede o tempo, nao a existencia dele.
    checa('painel ausente nao reprova sozinho', c(provaConclusaoBoa({ msPainel: null }), est, {}).length === 0);

    // Conclusao por pointerup (o pincel): sem traco na mao, o up nao cria nada,
    // e a reprova tem de dizer isso em vez de so "o store nao subiu".
    const pincelBom = provaConclusaoBoa({
        gesto: 'pointerup', cliquesPedidos: 0, cliquesQuePegaram: 0, pontosDoTraco: 14,
        fonteAlvo: 'brushes', tipo: 'brushes',
    });
    checa('conclusao do pincel com traco passa', c(pincelBom, est, {}).length === 0, JSON.stringify(c(pincelBom, est, {})));
    const semTraco = c({ ...pincelBom, pontosDoTraco: 1 }, est, {});
    checa('pointerup sem traco de 2 pontos reprova', semTraco.length > 0);
    checa('a reprova diz que menos de 2 pontos nao vira feicao', /menos de 2 nao vira feicao/.test(semTraco.join(' ')), semTraco.join(' '));
    checa('pointerup sem leitura do traco reprova', c({ ...pincelBom, pontosDoTraco: null }, est, {}).length > 0);
    // Traco so e cobrado de quem conclui por pointerup.
    checa('a conclusao por clique nao e cobrada pelo traco', c(provaConclusaoBoa({ pontosDoTraco: null }), est, {}).length === 0);

    checa('conclusao de ferramenta com requerTerreno sem terreno reprova',
        c(provaConclusaoBoa({ requerTerreno: true, terreno: false }), est, {}).length > 0);

    // Analise (LOS, visibilidade): a feicao no store nao e o que a tela mostra.
    // O trecho visivel e o obstruido sao OUTRAS feicoes, em outra fonte, e a
    // conta que os produz e assincrona.
    const analiseBoa = provaConclusaoBoa({
        requerTerreno: true, terreno: true, processadoDeclarado: true,
        naFonteProcessadaAntes: 30, naFonteProcessada: 32, msProcessado: 41.2,
    });
    checa('analise com resultado processado passa', c(analiseBoa, est, {}).length === 0, JSON.stringify(c(analiseBoa, est, {})));
    const semProcessado = c({ ...analiseBoa, msProcessado: null, naFonteProcessada: 30 }, est, {});
    checa('analise cuja fonte processada nao cresceu reprova', semProcessado.length > 0);
    checa('a reprova diz que a analise nao chegou a tela', /nao chegou a tela/.test(semProcessado.join(' ')), semProcessado.join(' '));
    // O caso que so olhar o store aprovaria: a feicao entrou em 28 ms e o
    // resultado processado nunca apareceu.
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

    // A latencia escassa tem de sair na tabela com o par (assentaram, perdidos).
    const escassa = resultadoFalso({ rodadas: [rodadaFalsa(1, { casos: [
        casoFalso('desenho', { k: 1, est: estFalsa({ latencias: [16, 17], superadas: 178 }) }),
    ] })] });
    const te = montarTabela(escassa);
    const colunas = Object.fromEntries(te.linhas[0].valores.map((v) => [v.nome, v.texto]));
    checa('a tabela mostra quantas latencias assentaram', colunas['lat n'] === '2', JSON.stringify(colunas));
    checa('a tabela mostra o feedback perdido ao lado da latencia', colunas.perdidos === '178', JSON.stringify(colunas));

    // As duas colunas do porte das formas. A dividida por quadro e a que compara
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
        casoFalso('desenho', { k: 1, prova: provaDesenhoBoa({ setDataAlvo: 0 }) }),
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
    checa('o markdown despeja a prova da ultima rodada', /Provas dos cenarios/.test(md) && /setDataAlvo/.test(md));
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
    checa('padrao nao liga terreno, snapping nem estrangula CPU', p.terreno === false && p.snapping === false && p.cpu === 1);
    checa('padrao usa 1600x900 com cabeca', p.largura === 1600 && p.altura === 900 && p.headless === false);
    const p2 = lerArgumentos(['--ferramenta', 'boundary', '--k', '4, 1', '--feicoes', '10', '--rodadas', '1', '--terreno', '--snapping', '--cpu', '4']);
    checa('--ferramenta boundary e lida', p2.ferramenta === 'boundary');
    checa('--k volta ordenada, mesmo digitada fora de ordem', p2.k.join(',') === '1,4', p2.k.join(','));
    checa('--feicoes, --rodadas e --cpu sao lidos', p2.feicoes === 10 && p2.rodadas === 1 && p2.cpu === 4);
    checa('--terreno e --snapping sem valor ligam', p2.terreno === true && p2.snapping === true);
    checa('--terreno false desliga', lerArgumentos(['--terreno', 'false']).terreno === false);
    checa('--headless sem valor liga', lerArgumentos(['--headless']).headless === true);

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

    // De onde os modulos do app sao importados. O prefixo fixo `/ebgeo/` que
    // estava no codigo daria 404 num `vite` cru, que abre em `/`, e a bancada
    // culparia o aplicativo por um erro de endereco.
    checa('a base dos modulos sai da --url, com /ebgeo/', baseDeModulos('http://localhost:3007/ebgeo/') === '/ebgeo/');
    checa('a base dos modulos sai da --url, na raiz', baseDeModulos('http://localhost:3200/') === '/', baseDeModulos('http://localhost:3200/'));
    checa('url sem barra no fim ganha a barra', baseDeModulos('http://localhost:3200/ebgeo') === '/ebgeo/', baseDeModulos('http://localhost:3200/ebgeo'));
    checa('url sem caminho nenhum vira /', baseDeModulos('http://localhost:3200') === '/', baseDeModulos('http://localhost:3200'));
    checa('arquivo no fim da url nao vira diretorio', baseDeModulos('http://localhost:3200/ebgeo/index.html') === '/ebgeo/', baseDeModulos('http://localhost:3200/ebgeo/index.html'));
    checa('a --url padrao e a leitura da linha de comando concordam', lerArgumentos([]).baseModulos === '/ebgeo/', lerArgumentos([]).baseModulos);
    checa('--url na raiz muda a base lida', lerArgumentos(['--url', 'http://localhost:3200/']).baseModulos === '/');
    lanca('--url invalida lanca', () => lerArgumentos(['--url', 'nao-e-url']));
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
    // O padrao de `snapa` e TRUE: descritor novo que esquecesse o campo tem de
    // cair na cobranca do contador, e nao escapar dela por omissao.
    checa('descritor que cala sobre o snap e cobrado como se snapasse', padrao.snapa === true);
    checa('snapa: false atravessa o normalizador', normalizarFerramenta('x', com({ snapa: false })).snapa === false);
    checa('o nome curto entra no descritor', padrao.nome === 'x');

    // O caso do pedido: descritor sem conclusao. A bancada nao teria gesto para
    // fechar a feicao, e o cenario mediria o nada com o rotulo certo.
    lanca('descritor sem conclusao lanca', () => normalizarFerramenta('x', { x: { ...bom, conclusao: undefined } }));
    lanca('conclusao sem gesto lanca', () => normalizarFerramenta('x', com({ conclusao: { cliquesAntes: 1, evento: 'click' } })));
    lanca('conclusao sem evento lanca', () => normalizarFerramenta('x', com({ conclusao: { gesto: 'clique-final', cliquesAntes: 1 } })));
    lanca('gesto de conclusao desconhecido lanca', () => normalizarFerramenta('x', com({ conclusao: { gesto: 'balancar', cliquesAntes: 1, evento: 'click' } })));
    lanca('cliquesAntes negativo lanca', () => normalizarFerramenta('x', com({ conclusao: { gesto: 'clique-final', cliquesAntes: -1, evento: 'click' } })));
    lanca('cliquesAntes fracionario lanca', () => normalizarFerramenta('x', com({ conclusao: { gesto: 'clique-final', cliquesAntes: 1.5, evento: 'click' } })));

    // O outro caso do pedido: modoDesenho desconhecido.
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
    console.log('\n== eixo 12: prontidao do app (o corte que nao depende da base)');
    const montado = {
        camadas: 85, fontes: 69, carregado: true, temFontePrincipal: true, temFonteFeedback: true,
    };
    checa('app montado com a base do OSM passa', avaliarProntidao(montado).pronto === true, JSON.stringify(avaliarProntidao(montado)));
    checa('app montado com a base vetorial passa',
        avaliarProntidao({ ...montado, camadas: 246, fontes: 99 }).pronto === true);

    // O pior caso: a base sozinha. `map.loaded()` ja e verdadeiro, o estilo ja
    // esta estavel, e nao ha uma unica fonte de ferramenta para medir.
    const soBase = avaliarProntidao({ camadas: 1, fontes: 1, carregado: true, temFontePrincipal: false, temFonteFeedback: false });
    checa('so a base do estilo reprova', soBase.pronto === false);
    checa('a reprova diz que faltam as fontes da ferramenta', /fontes da ferramenta/.test(soBase.motivo), soBase.motivo);
    const baseVetorial = avaliarProntidao({ camadas: 159, fontes: 9, carregado: true, temFontePrincipal: false, temFonteFeedback: false });
    checa('a base vetorial sozinha, com 159 camadas, tambem reprova', baseVetorial.pronto === false, JSON.stringify(baseVetorial));

    checa('mapa que ainda nao carregou reprova',
        avaliarProntidao({ ...montado, carregado: false }).pronto === false);
    checa('fonte de feedback ausente reprova (o preview nao teria onde ser escrito)',
        avaliarProntidao({ ...montado, temFonteFeedback: false }).pronto === false);
    checa('sonda vazia reprova', avaliarProntidao(null).pronto === false);
    // O piso de fontes ainda vale: um estilo com as duas fontes da ferramenta e
    // mais nada seria um app pela metade.
    const poucasFontes = avaliarProntidao({ ...montado, fontes: 3 });
    checa('estilo com pouquissimas fontes reprova mesmo com as da ferramenta', poucasFontes.pronto === false);
    checa('a reprova diz quantas fontes viu e quantas espera',
        /so 3 fontes/.test(poucasFontes.motivo) && poucasFontes.motivo.includes(String(FONTES_MINIMAS)), poucasFontes.motivo);
    // ...e o piso nao pode ser tao alto que reprove o app medido de verdade.
    checa('o piso de fontes fica abaixo do app montado mais magro', FONTES_MINIMAS < 69);

    // O ponto de clique. O pior caso e o modal do servidor secundario por cima
    // do mapa: o clique morre no DIV, o mapa nao ve evento nenhum, e sem esta
    // reprova o cenario sairia acusando a FERRAMENTA de perder cliques.
    const noCanvas = avaliarObstrucao({ descricao: 'CANVAS.maplibregl-canvas', ehCanvas: true });
    checa('ponto de clique sobre o canvas passa', noCanvas.livre === true, JSON.stringify(noCanvas));
    const coberto = avaliarObstrucao({ descricao: 'DIV.server-notice server-notice--visible', ehCanvas: false });
    checa('ponto de clique coberto por um modal reprova', coberto.livre === false);
    checa('a reprova nomeia o elemento que cobriu', /server-notice/.test(coberto.motivo), coberto.motivo);
    checa('a reprova diz que o clique nao chega ao mapa', /nunca chega ao mapa/.test(coberto.motivo), coberto.motivo);
    checa('leitura ausente reprova', avaliarObstrucao(null).livre === false);
    checa('ponto sobre nada (fora da janela) reprova', avaliarObstrucao({ descricao: 'nada', ehCanvas: false }).livre === false);

    // E a regra entra nos dois cenarios que clicam, com a causa junto.
    const d = CENARIOS.desenho.validar(
        provaDesenhoBoa({ pontoDeCliqueLivre: false, obstrucaoDoClique: 'o ponto de clique esta coberto por DIV.server-notice, e o clique nunca chega ao mapa' }),
        estFalsa(), {},
    );
    checa('o cenario desenho reprova com o ponto coberto', /server-notice/.test(d.join(' ')), d.join(' '));
    const c = CENARIOS.conclusao.validar(
        provaConclusaoBoa({ pontoDeCliqueLivre: false, obstrucaoDoClique: 'coberto por DIV.server-notice' }), estFalsa({ quadros: 20 }), {},
    );
    checa('o cenario conclusao reprova com o ponto coberto', /server-notice/.test(c.join(' ')), c.join(' '));
    checa('bancada que nao leu a obstrucao (null) nao inventa reprova',
        CENARIOS.desenho.validar(provaDesenhoBoa({ pontoDeCliqueLivre: null }), estFalsa(), {}).length === 0);
}
eixo12();

console.log(`\n${total - falhas}/${total} passaram.`);
if (falhas) { console.log(`${falhas} FALHA(S): a bancada nao esta reprovando o que promete pegar.`); process.exit(1); }
console.log('A bancada de ferramentas reprova o insumo degenerado em todos os eixos que afirma medir.');
