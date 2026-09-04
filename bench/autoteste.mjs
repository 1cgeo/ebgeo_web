// Autoteste da bancada: prova que ela REPROVA o insumo degenerado, eixo a eixo.
//
// Uma regua vista so passar em insumo bom nao foi vista funcionar. Este arquivo
// constroi o pior caso de cada eixo que a bancada afirma medir (relogio, aba
// oculta, cadencia do rAF, prova da variante, prova do cenario, conferencia
// contra a referencia, agregacao entre rodadas, leitura da linha de comando) e
// confirma que cada um sai marcado. Depois confirma que o insumo bom passa,
// para a regua nao ser um carimbo de reprovacao.
//
//   node bench/autoteste.mjs

import process from 'node:process';
import {
    VARIANTES, lerArgumentos, estatistica, celula, montarTabela,
    conferirReferencia, percentil, mediana, escreverMarkdown,
} from './desempenho-terreno.mjs';

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
    try { fn(); falhas++; console.log(`  FALHA ${nome} (nao lancou)`); } catch (e) { console.log(`  ok    ${nome} -> ${String(e.message).slice(0, 60)}`); }
}

// Monta um resultado sintetico com um cenario por variante.
function resultadoFalso({ renderer = 'NVIDIA GeForce', relogio = 'valido', rodadas }) {
    return {
        parametros: { vista: 'serra-gaucha', variantes: [...new Set(rodadas.flatMap((r) => r.variantes.map((v) => v.variante)))], rodadas: rodadas.length, url: 'x', largura: 1600, altura: 900, headless: false },
        ambiente: { quando: 'agora', renderer, relogio, playwrightOrigem: 'teste', playwrightVersao: '0' },
        rodadas,
    };
}

function cenarioFalso(nome, { render_p50 = 27, draw = 2500, pilhas = 17, fontes = 100, quadros = 120, erros = [], tilesTerreno = 20 } = {}) {
    return {
        cenario: nome,
        assentou: { como: 'map.loaded()', ms: 10 },
        estatistica: {
            quadros,
            render_ms: { p50: render_p50, p95: render_p50 * 1.4, max: render_p50 * 2 },
            intervalo_ms: { p50: 16.7, p95: 33, max: 60 },
            fases_ms_por_quadro: { updateSources: 1, placement: 0.5, painterRender: render_p50 * 0.8, rttPrepare: 3 },
            gl_por_quadro: { draw, fbo: 40, clear: 40, tex: 2, stamp: 20, renderLayer: 200 },
        },
        provaFinal: { pilhas, fontes, tilesTerreno, terreno: true, visibilidade: 'visible' },
        erros,
    };
}

const varFalsa = (variante, { valida = true, erros = [], cenarios } = {}) => ({
    variante, valida, erros,
    prova: {}, detalhe: {},
    cadenciaAssentada: { p50: 16.7, p95: 16.9, max: 20 },
    cenarios: cenarios || [cenarioFalso('parado')],
});

function eixo1() {
    console.log('\n== eixo 1: estatistica e percentil');
    const vazio = estatistica([]);
    checa('lote sem quadro devolve quadros=0', vazio.quadros === 0, JSON.stringify(vazio));
    const q = [];
    for (let i = 0; i < 100; i++) q.push({ t: i * 16, dt: i, draw: 10, fbo: 1, clear: 1, tex: 0, stamp: 2, renderLayer: 5, fases: { updateSources: 1, placement: 0, painterRender: 2, rttPrepare: 0.5 } });
    const e = estatistica(q);
    checa('p50 do dt sai no meio', e.render_ms.p50 === 50, JSON.stringify(e.render_ms));
    checa('intervalo p50 sai 16', e.intervalo_ms.p50 === 16, JSON.stringify(e.intervalo_ms));
    checa('draw por quadro sai 10', e.gl_por_quadro.draw === 10);
    checa('fase por quadro sai 1', e.fases_ms_por_quadro.updateSources === 1);
    checa('percentil de lista vazia nao explode', percentil([], 0.5) === 0);
    checa('mediana de lista vazia devolve null', mediana([]) === null);
}
eixo1();

function eixo2() {
    console.log('\n== eixo 2: prova das variantes (o pior caso de cada uma)');
    // 2d com terreno ligado: tem de reprovar.
    checa('2d com getTerrain() reprova', VARIANTES['2d'].validar({ terreno: true, pitch: 0 }, {}).length > 0);
    checa('2d com pitch 60 reprova', VARIANTES['2d'].validar({ terreno: false, pitch: 60 }, {}).length > 0);
    checa('2d bom passa', VARIANTES['2d'].validar({ terreno: false, pitch: 0 }, {}).length === 0);

    // terreno sem getTerrain(): o caso citado no pedido.
    checa('terreno sem getTerrain() reprova', VARIANTES['terreno'].validar({ terreno: false, pitch: 60, hillshade: 'visible', pilhas: 17 }, {}).length > 0);
    checa('terreno com pitch 0 reprova', VARIANTES['terreno'].validar({ terreno: true, pitch: 0, hillshade: 'visible', pilhas: 17 }, {}).length > 0);
    checa('terreno com hillshade none reprova', VARIANTES['terreno'].validar({ terreno: true, pitch: 60, hillshade: 'none', pilhas: 17 }, {}).length > 0);
    checa('terreno sem pilha reprova', VARIANTES['terreno'].validar({ terreno: true, pitch: 60, hillshade: 'visible', pilhas: 0 }, {}).length > 0);
    checa('terreno bom passa', VARIANTES['terreno'].validar({ terreno: true, pitch: 60, hillshade: 'visible', pilhas: 17 }, {}).length === 0);

    checa('sem-hillshade com hillshade visivel reprova', VARIANTES['terreno-sem-hillshade'].validar({ terreno: true, hillshade: 'visible' }, {}).length > 0);
    checa('sem-hillshade bom passa', VARIANTES['terreno-sem-hillshade'].validar({ terreno: true, hillshade: 'none' }, {}).length === 0);

    // quebra-pilha que nao mudou nada: o caso citado no pedido.
    const qp = VARIANTES['terreno-quebra-pilha-topo'];
    checa('quebra-pilha com pilhas igual antes e depois reprova', qp.validar({ terreno: true, pilhas: 17 }, { movidas: 40, pilhasAntes: 17 }).length > 0);
    checa('quebra-pilha com pilhas maior reprova', qp.validar({ terreno: true, pilhas: 19 }, { movidas: 40, pilhasAntes: 17 }).length > 0);
    checa('quebra-pilha sem camada movida reprova', qp.validar({ terreno: true, pilhas: 1 }, { movidas: 0, pilhasAntes: 17 }).length > 0);
    checa('quebra-pilha bom passa', qp.validar({ terreno: true, pilhas: 1 }, { movidas: 40, pilhasAntes: 17 }).length === 0);

    const ve = VARIANTES['terreno-vazias-escondidas'];
    checa('vazias-escondidas sem esconder nada reprova', ve.validar({ terreno: true, camadas: 200 }, { camadasEscondidas: 0, camadasAntes: 200 }).length > 0);
    // O caso que a contagem de ALVO aprovaria: o app ja escondeu as 84 camadas.
    const jaFeito = ve.validar({ terreno: true, camadas: 200 }, { camadasEscondidas: 0, camadasJaEscondidas: 84, camadasAlvo: 84, camadasAntes: 200 });
    checa('vazias-escondidas que so reescreve o que ja estava none reprova', jaFeito.length > 0);
    checa('a reprova diz que o app ja esconde sozinho', /ja esconde a camada de fonte vazia sozinho/.test(jaFeito.join(' ')), jaFeito.join(' '));
    checa('vazias-escondidas que mudou a contagem de camadas reprova', ve.validar({ terreno: true, camadas: 133 }, { camadasEscondidas: 67, camadasAntes: 200 }).length > 0);
    checa('vazias-escondidas bom passa', ve.validar({ terreno: true, camadas: 200 }, { camadasEscondidas: 67, camadasAntes: 200 }).length === 0);

    const vr = VARIANTES['terreno-vazias-removidas'];
    checa('vazias-removidas sem remover fonte reprova', vr.validar({ terreno: true, camadas: 200, fontes: 100 }, { fontesRemovidas: 0, camadasAntes: 200, fontesAntes: 100 }).length > 0);
    checa('vazias-removidas com camadas iguais reprova', vr.validar({ terreno: true, camadas: 200, fontes: 33 }, { fontesRemovidas: 67, camadasAntes: 200, fontesAntes: 100 }).length > 0);
    checa('vazias-removidas bom passa', vr.validar({ terreno: true, camadas: 133, fontes: 33 }, { fontesRemovidas: 67, camadasAntes: 200, fontesAntes: 100 }).length === 0);

    const ambos = VARIANTES['terreno-vazias-escondidas-quebra-pilha-topo'];
    checa('combinada sem esconder reprova', ambos.validar({ terreno: true, pilhas: 1 }, { camadasEscondidas: 0, movidas: 40, pilhasAntes: 17 }).length > 0);
    checa('combinada sem mover reprova', ambos.validar({ terreno: true, pilhas: 1 }, { camadasEscondidas: 67, movidas: 0, pilhasAntes: 17 }).length > 0);
    checa('combinada com pilha teimosa reprova', ambos.validar({ terreno: true, pilhas: 17 }, { camadasEscondidas: 67, movidas: 40, pilhasAntes: 17 }).length > 0);
    checa('combinada boa passa', ambos.validar({ terreno: true, pilhas: 1 }, { camadasEscondidas: 67, movidas: 40, pilhasAntes: 17 }).length === 0);
}
eixo2();

function eixo3() {
    console.log('\n== eixo 3: celula, mediana e amplitude');
    checa('celula sem valor vira traco', celula([null, undefined, NaN]) === '-');
    checa('celula de um valor nao mostra amplitude', celula([27]) === '27');
    checa('celula de valores iguais nao mostra amplitude', celula([9, 9, 9]) === '9');
    checa('celula com amplitude mostra min..max', celula([9, 27]) === '18 (9..27)', celula([9, 27]));
    checa('celula ignora o nulo no meio', celula([9, null, 11]) === '10 (9..11)', celula([9, null, 11]));
}
eixo3();

function eixo4() {
    console.log('\n== eixo 4: relogio, aba oculta e cadencia chegam ao veredito da tabela');
    const bom = resultadoFalso({ rodadas: [
        { rodada: 1, aquecimento: true, valida: true, erros: [], variantes: [varFalsa('terreno')] },
        { rodada: 2, aquecimento: false, valida: true, erros: [], variantes: [varFalsa('terreno')] },
    ] });
    const tb = montarTabela(bom);
    checa('tabela boa sai ok', tb.linhas[0].veredito === 'ok', tb.linhas[0].veredito);
    checa('tabela boa descarta o aquecimento', /rodadas usadas: 2/.test(tb.nota), tb.nota);

    const gpuFalsa = resultadoFalso({ renderer: 'Google SwiftShader', relogio: 'INVALIDO (GPU emulada)', rodadas: [
        { rodada: 1, aquecimento: false, valida: true, erros: [], variantes: [varFalsa('terreno')] },
    ] });
    checa('renderer emulado marca o relogio na tabela', /INVALIDO \(GPU emulada\)/.test(montarTabela(gpuFalsa).linhas[0].veredito), montarTabela(gpuFalsa).linhas[0].veredito);

    const rodadaRuim = resultadoFalso({ rodadas: [
        { rodada: 1, aquecimento: false, valida: false, erros: ['cadencia p95 33 ms'], variantes: [varFalsa('terreno')] },
    ] });
    const tr = montarTabela(rodadaRuim);
    checa('rodada invalida (cadencia ou aba oculta) marca a celula', /RODADA INVALIDA/.test(tr.linhas[0].veredito), tr.linhas[0].veredito);
    checa('sem rodada valida a nota denuncia', /NENHUMA rodada valida/.test(tr.nota), tr.nota);

    const varRuim = resultadoFalso({ rodadas: [
        { rodada: 1, aquecimento: false, valida: true, erros: [], variantes: [varFalsa('terreno', { valida: false, erros: ['getTerrain() nulo'] })] },
    ] });
    checa('variante invalida marca a celula', /VARIANTE INVALIDA/.test(montarTabela(varRuim).linhas[0].veredito));

    const cenRuim = resultadoFalso({ rodadas: [
        { rodada: 1, aquecimento: false, valida: true, erros: [], variantes: [varFalsa('terreno', { cenarios: [cenarioFalso('parado', { quadros: 0, erros: ['zero quadros medidos'] })] })] },
    ] });
    checa('cenario sem quadro marca a celula', /CENARIO INVALIDO/.test(montarTabela(cenRuim).linhas[0].veredito));

    // O caso de 2026-09-04: uma sessao paralela mudou o app no meio da bancada.
    const appMudou = resultadoFalso({ rodadas: [
        { rodada: 1, aquecimento: false, valida: false, erros: ['o app mudou entre as cargas (assinatura base distinta)'], variantes: [varFalsa('terreno')] },
    ] });
    appMudou.ambiente.appMudou = true;
    appMudou.ambiente.assinaturasBase = { '302c/103f/302v': ['r1/terreno'], '302c/103f/218v': ['r2/terreno'] };
    const tm = montarTabela(appMudou);
    checa('app mudando entre as cargas marca a celula', /APP MUDOU ENTRE AS CARGAS/.test(tm.linhas[0].veredito), tm.linhas[0].veredito);
    checa('app mudando derruba a validade da rodada', /RODADA INVALIDA/.test(tm.linhas[0].veredito));
    checa('app mudando aparece no markdown', /O APP MUDOU DURANTE A BANCADA/.test(escreverMarkdown(appMudou, tm, [])));
    checa('app estavel nao marca nada', montarTabela(bom).linhas[0].veredito === 'ok');
}
eixo4();

function eixo5() {
    console.log('\n== eixo 5: conferencia contra a referencia de 2026-09-04');
    const naReferencia = resultadoFalso({ rodadas: [
        { rodada: 1, aquecimento: false, valida: true, erros: [], variantes: [varFalsa('terreno', { cenarios: [cenarioFalso('parado', { render_p50: 27, draw: 2500, pilhas: 17, tilesTerreno: 20 })] })] },
    ] });
    const c1 = conferirReferencia(naReferencia);
    checa('medida igual a referencia passa', c1.every((x) => x.situacao === 'dentro do fator 2'), JSON.stringify(c1));

    const foraDobro = resultadoFalso({ rodadas: [
        { rodada: 1, aquecimento: false, valida: true, erros: [], variantes: [varFalsa('terreno', { cenarios: [cenarioFalso('parado', { render_p50: 60, draw: 2500, pilhas: 17, tilesTerreno: 20 })] })] },
    ] });
    const c2 = conferirReferencia(foraDobro).find((x) => /render_p50/.test(x.item));
    checa('render 60 contra 27 esperado sai DIVERGENTE', c2.situacao.startsWith('DIVERGENTE'), JSON.stringify(c2));

    const metade = resultadoFalso({ rodadas: [
        { rodada: 1, aquecimento: false, valida: true, erros: [], variantes: [varFalsa('terreno', { cenarios: [cenarioFalso('parado', { render_p50: 27, draw: 2500, pilhas: 4, tilesTerreno: 20 })] })] },
    ] });
    const c3 = conferirReferencia(metade).find((x) => /pilhas/.test(x.item));
    checa('pilhas 4 contra 17 esperado sai DIVERGENTE', c3.situacao.startsWith('DIVERGENTE'), JSON.stringify(c3));

    const gpuFalsa = resultadoFalso({ renderer: 'llvmpipe', relogio: 'INVALIDO (GPU emulada)', rodadas: [
        { rodada: 1, aquecimento: false, valida: true, erros: [], variantes: [varFalsa('terreno', { cenarios: [cenarioFalso('parado', { render_p50: 300 })] })] },
    ] });
    const c4 = conferirReferencia(gpuFalsa);
    checa('com GPU emulada o tempo nao e conferido', c4.find((x) => /render_p50/.test(x.item)).situacao === 'nao conferido (relogio invalido)');
    checa('com GPU emulada a contagem continua conferida', c4.find((x) => /pilhas/.test(x.item)).situacao === 'dentro do fator 2');

    const outraVista = { ...naReferencia, parametros: { ...naReferencia.parametros, vista: 'alegrete' } };
    checa('vista diferente pula a conferencia em vez de mentir', /pulada/.test(conferirReferencia(outraVista)[0].situacao));
}
eixo5();

function eixo6() {
    console.log('\n== eixo 6: leitura da linha de comando');
    const p = lerArgumentos([]);
    checa('padrao usa serra-gaucha, 2 rodadas, 1600x900, com cabeca', p.vista === 'serra-gaucha' && p.rodadas === 2 && p.largura === 1600 && p.altura === 900 && p.headless === false);
    checa('padrao usa todas as variantes', p.variantes.length === 7);
    const p2 = lerArgumentos(['--variantes', 'terreno,2d', '--rodadas', '3', '--headless']);
    checa('variantes voltam na ordem canonica', p2.variantes.join(',') === '2d,terreno', p2.variantes.join(','));
    checa('--headless sem valor liga', p2.headless === true);
    checa('--rodadas 3 e lido', p2.rodadas === 3);
    checa('--headless false desliga', lerArgumentos(['--headless', 'false']).headless === false);
    lanca('vista desconhecida lanca', () => lerArgumentos(['--vista', 'marte']));
    lanca('variante desconhecida lanca', () => lerArgumentos(['--variantes', 'terreno,inventada']));
    lanca('rodadas zero lanca', () => lerArgumentos(['--rodadas', '0']));
    lanca('argumento desconhecido lanca', () => lerArgumentos(['--turbo']));
}
eixo6();

console.log(`\n${total - falhas}/${total} passaram.`);
if (falhas) { console.log(`${falhas} FALHA(S): a bancada nao esta reprovando o que promete pegar.`); process.exit(1); }
console.log('A bancada reprova o insumo degenerado em todos os eixos que afirma medir.');
