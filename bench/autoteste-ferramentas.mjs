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
    FERRAMENTAS, ORDEM_CENARIOS, CENARIOS, lerArgumentos, estatistica,
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

function estFalsa({ quadros = 180, dt = 2, passo = 16.7, query = 0, proj = 0, latencias = [], superadas = 0 } = {}) {
    return estatistica({ quadros: loteDeQuadros(quadros, dt, passo), query, proj, latencias, superadas, mousemove: quadros });
}

// Prova boa do desenho: a ferramenta ativa, um ponto colocado, feedback escrito.
const provaDesenhoBoa = (extra = {}) => ({
    setDataAlvo: 180, feicoesAlvo: 180, setDataOutras: 0, porFonte: {},
    fonteAlvo: 'coordination-line-feedback',
    ferramentaAtiva: true, drawPoints: 1, visibilidade: 'visible',
    controlePresente: true, ...extra,
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

    checa('desenho com 0 pontos colocados reprova', d(provaDesenhoBoa({ drawPoints: 0 }), est, {}).length > 0);
    checa('desenho com 2 pontos colocados reprova', d(provaDesenhoBoa({ drawPoints: 2 }), est, {}).length > 0);
    checa('desenho com drawPoints ilegivel reprova', d(provaDesenhoBoa({ drawPoints: null }), est, {}).length > 0);
    checa('desenho com a ferramenta inativa reprova', d(provaDesenhoBoa({ ferramentaAtiva: false }), est, {}).length > 0);
    checa('desenho com aba oculta reprova', d(provaDesenhoBoa({ visibilidade: 'hidden' }), est, {}).length > 0);
    const semQuadro = d(provaDesenhoBoa(), estFalsa({ quadros: 0 }), {});
    checa('desenho sem quadro medido reprova', /zero quadros/.test(semQuadro.join(' ')), semQuadro.join(' '));
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
    checa('as seis ferramentas do pedido estao no mapa',
        ['line', 'polygon', 'boundary', 'arrow', 'occupied_front', 'coordination_line'].every((n) => nomes.includes(n)),
        nomes.join(','));
    for (const [nome, f] of Object.entries(FERRAMENTAS)) {
        checa(`${nome} tem controle, tipo, fonte, feedback, painel e conclusao`,
            !!(f.controle && f.tipo && f.fonte && f.feedback && f.painel && f.conclusao && f.conclusao.gesto && f.conclusao.evento),
            JSON.stringify(f));
    }
    checa('o controle sempre comeca com Add e termina em Control',
        Object.values(FERRAMENTAS).every((f) => /^Add.*Control$/.test(f.controle)));
    checa('a fonte principal e o tipo do store tem o mesmo nome (FEATURE_SOURCES)',
        Object.values(FERRAMENTAS).every((f) => f.fonte === f.tipo));
    checa('a frente ocupada conclui por clique, nao por botao direito',
        FERRAMENTAS.occupied_front.conclusao.gesto === 'clique-final' && FERRAMENTAS.occupied_front.conclusao.cliquesAntes === 1);
    checa('as outras cinco concluem por botao direito depois de 3 cliques',
        Object.entries(FERRAMENTAS).filter(([n]) => n !== 'occupied_front')
            .every(([, f]) => f.conclusao.gesto === 'botao-direito' && f.conclusao.cliquesAntes === 3));
    checa('o poligono cria por anel, com 3 pontos ou mais', FERRAMENTAS.polygon.anel === true && FERRAMENTAS.polygon.pontosParaCriar >= 3);
    checa('nenhuma ferramenta repete a fonte de feedback',
        new Set(Object.values(FERRAMENTAS).map((f) => f.feedback)).size === Object.keys(FERRAMENTAS).length);
}
eixo10();

console.log(`\n${total - falhas}/${total} passaram.`);
if (falhas) { console.log(`${falhas} FALHA(S): a bancada nao esta reprovando o que promete pegar.`); process.exit(1); }
console.log('A bancada de ferramentas reprova o insumo degenerado em todos os eixos que afirma medir.');
