// Autoteste da bancada de terreno: prova que ela REPROVA o insumo degenerado,
// eixo a eixo.
//
// Uma regua vista so passar em insumo bom nao foi vista funcionar. Este arquivo
// constroi o pior caso de cada eixo que a bancada afirma medir (relogio, aba
// oculta, cadencia do rAF, prova da variante, prova do cenario, conferencia
// contra a referencia, agregacao entre rodadas, leitura da linha de comando,
// identidade do modulo, leitura do estado dos tiles, prontidao do app) e
// confirma que cada um sai marcado. Depois confirma que o insumo bom passa,
// para a regua nao ser um carimbo de reprovacao.
//
//   node frontend/bench/autoteste.mjs

import process from 'node:process';
import {
    VARIANTES, PLANO_POPULAR, REFERENCIA, lerArgumentos, estatistica, celula,
    montarTabela, conferirReferencia, percentil, mediana, escreverMarkdown,
    validarBase, avaliarIdentidade, validarLeituraDeTiles, avaliarProntidao,
    avisosDaVariante,
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

// A tabela de referencia da branch esta VAZIA de proposito (a da `main` descreve
// outro app e outra versao do MapLibre). A regua, porem, tem de continuar sendo
// vista funcionando, entao o autoteste traz a sua propria tabela sintetica e a
// passa por argumento. Sem isto, "a conferencia esta verde" significaria apenas
// que ela nao conferiu nada.
const REF_SINTETICA = [
    { variante: 'terreno', cenario: 'parado', metrica: 'render_p50', valor: 27 },
    { variante: 'terreno', cenario: 'parado', metrica: 'draw_por_quadro', valor: 2500 },
    { variante: 'terreno', cenario: 'parado', metrica: 'pilhas', valor: 17 },
    { variante: 'terreno', cenario: 'parado', metrica: 'tilesTerreno', valor: 20 },
];

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

    const comHillshade = { terreno: true, pitch: 60, hillshade: 'visible', pilhas: 17, hillshadeConfigurado: true };
    checa('terreno sem getTerrain() reprova', VARIANTES['terreno'].validar({ ...comHillshade, terreno: false }, {}).length > 0);
    checa('terreno com pitch 0 reprova', VARIANTES['terreno'].validar({ ...comHillshade, pitch: 0 }, {}).length > 0);
    checa('terreno com hillshade none reprova', VARIANTES['terreno'].validar({ ...comHillshade, hillshade: 'none' }, {}).length > 0);
    checa('terreno sem pilha reprova', VARIANTES['terreno'].validar({ ...comHillshade, pilhas: 0 }, {}).length > 0);
    checa('terreno bom passa', VARIANTES['terreno'].validar(comHillshade, {}).length === 0);

    // O caso medido no stack de desenvolvimento desta branch: o servidor entrega
    // `config.map2d.hillshade.enabled` FALSO. Cobrar `visible` ai mediria a
    // configuracao do servidor, e nao a variante.
    const semHillshadeNoServidor = { terreno: true, pitch: 60, hillshade: 'ausente', pilhas: 17, hillshadeConfigurado: false };
    checa('terreno num app sem hillshade configurado passa (a ausencia e a configuracao)',
        VARIANTES['terreno'].validar(semHillshadeNoServidor, {}).length === 0,
        VARIANTES['terreno'].validar(semHillshadeNoServidor, {}).join('; '));
    // ...mas a celula tem de DIZER, senao ela se compara com uma que tem o passe.
    const aviso = avisosDaVariante(semHillshadeNoServidor);
    checa('a celula sem hillshade sai com aviso, e nao em silencio', aviso.length === 1, JSON.stringify(aviso));
    checa('o aviso diz que o custo medido nao inclui o passe de hillshade', /nao inclui o passe de hillshade/.test(aviso.join(' ')), aviso.join(' '));
    checa('a celula com hillshade nao ganha aviso nenhum', avisosDaVariante(comHillshade).length === 0);
    checa('variante em 2d nao ganha aviso de hillshade', avisosDaVariante({ terreno: false, hillshadeConfigurado: false }).length === 0);
    // A contradicao: o servidor diz desligado e a camada esta visivel. A prova
    // nao sabe o que esta medindo, e isso e erro, nao aviso.
    checa('hillshade visivel num app que o declara desligado reprova',
        VARIANTES['terreno'].validar({ ...semHillshadeNoServidor, hillshade: 'visible' }, {}).length > 0);

    checa('sem-hillshade com hillshade visivel reprova', VARIANTES['terreno-sem-hillshade'].validar({ terreno: true, hillshade: 'visible', hillshadeConfigurado: true }, {}).length > 0);
    checa('sem-hillshade bom passa', VARIANTES['terreno-sem-hillshade'].validar({ terreno: true, hillshade: 'none', hillshadeConfigurado: true }, {}).length === 0);
    // A variante que nao contrasta com nada: sem hillshade no servidor ela mede
    // exatamente o que `terreno` mede, e duas linhas iguais com nomes diferentes
    // sao pior que uma linha a menos.
    const inerte = VARIANTES['terreno-sem-hillshade'].validar({ terreno: true, hillshade: 'ausente', hillshadeConfigurado: false }, {});
    checa('sem-hillshade que nao tem o que esconder reprova', inerte.length > 0);
    checa('a reprova diz que a variante nao contrasta mais com `terreno`', /nao contrasta mais com/.test(inerte.join(' ')), inerte.join(' '));

    const qp = VARIANTES['terreno-quebra-pilha-topo'];
    checa('quebra-pilha com pilhas igual antes e depois reprova', qp.validar({ terreno: true, pilhas: 17 }, { movidas: 40, pilhasAntes: 17 }).length > 0);
    checa('quebra-pilha com pilhas maior reprova', qp.validar({ terreno: true, pilhas: 19 }, { movidas: 40, pilhasAntes: 17 }).length > 0);
    checa('quebra-pilha sem camada movida reprova', qp.validar({ terreno: true, pilhas: 1 }, { movidas: 0, pilhasAntes: 17 }).length > 0);
    checa('quebra-pilha bom passa', qp.validar({ terreno: true, pilhas: 1 }, { movidas: 40, pilhasAntes: 17 }).length === 0);

    const ve = VARIANTES['terreno-vazias-escondidas'];
    checa('vazias-escondidas sem esconder nada reprova', ve.validar({ terreno: true, camadas: 200 }, { camadasEscondidas: 0, camadasAntes: 200 }).length > 0);
    // O caso que a contagem de ALVO aprovaria: o app ja escondeu as camadas.
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

    // Uma sessao paralela mudou o app no meio da bancada.
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

    // Duas bases: cada uma tem de virar a sua linha, com a sua medida, e nunca
    // a medida da vizinha com o mesmo rotulo de variante.
    const duasBases = resultadoFalso({ rodadas: [
        { rodada: 1, aquecimento: false, valida: true, erros: [], variantes: [
            { ...varFalsa('terreno'), base: 'osm' },
            { ...varFalsa('terreno', { cenarios: [cenarioFalso('parado', { render_p50: 5 })] }), base: 'carta-ortoimagem' },
        ] },
    ] });
    duasBases.parametros.bases = ['osm', 'carta-ortoimagem'];
    const t2 = montarTabela(duasBases);
    checa('duas bases dao duas linhas, cada uma com a sua medida',
        t2.linhas.length === 2 && t2.linhas[0].base === 'osm' && t2.linhas[0].valores[0].texto === '27'
        && t2.linhas[1].base === 'carta-ortoimagem' && t2.linhas[1].valores[0].texto === '5',
        JSON.stringify(t2.linhas.map((l) => [l.base, l.valores[0].texto])));
    checa('resultado sem campo base cai em "atual"', montarTabela(bom).linhas[0].base === 'atual');
    checa('a base aparece na linha do markdown', /\| carta-ortoimagem \| terreno \| parado \| 5 \|/.test(escreverMarkdown(duasBases, t2, [])));
}
eixo4();

function eixo5() {
    console.log('\n== eixo 5: conferencia contra a referencia');
    const naReferencia = resultadoFalso({ rodadas: [
        { rodada: 1, aquecimento: false, valida: true, erros: [], variantes: [varFalsa('terreno', { cenarios: [cenarioFalso('parado', { render_p50: 27, draw: 2500, pilhas: 17, tilesTerreno: 20 })] })] },
    ] });
    const c1 = conferirReferencia(naReferencia, REF_SINTETICA);
    checa('medida igual a referencia passa', c1.every((x) => x.situacao === 'dentro do fator 2'), JSON.stringify(c1));

    const foraDobro = resultadoFalso({ rodadas: [
        { rodada: 1, aquecimento: false, valida: true, erros: [], variantes: [varFalsa('terreno', { cenarios: [cenarioFalso('parado', { render_p50: 60, draw: 2500, pilhas: 17, tilesTerreno: 20 })] })] },
    ] });
    const c2 = conferirReferencia(foraDobro, REF_SINTETICA).find((x) => /render_p50/.test(x.item));
    checa('render 60 contra 27 esperado sai DIVERGENTE', c2.situacao.startsWith('DIVERGENTE'), JSON.stringify(c2));

    const metade = resultadoFalso({ rodadas: [
        { rodada: 1, aquecimento: false, valida: true, erros: [], variantes: [varFalsa('terreno', { cenarios: [cenarioFalso('parado', { render_p50: 27, draw: 2500, pilhas: 4, tilesTerreno: 20 })] })] },
    ] });
    const c3 = conferirReferencia(metade, REF_SINTETICA).find((x) => /pilhas/.test(x.item));
    checa('pilhas 4 contra 17 esperado sai DIVERGENTE', c3.situacao.startsWith('DIVERGENTE'), JSON.stringify(c3));

    const gpuFalsa = resultadoFalso({ renderer: 'llvmpipe', relogio: 'INVALIDO (GPU emulada)', rodadas: [
        { rodada: 1, aquecimento: false, valida: true, erros: [], variantes: [varFalsa('terreno', { cenarios: [cenarioFalso('parado', { render_p50: 300 })] })] },
    ] });
    const c4 = conferirReferencia(gpuFalsa, REF_SINTETICA);
    checa('com GPU emulada o tempo nao e conferido', c4.find((x) => /render_p50/.test(x.item)).situacao === 'nao conferido (relogio invalido)');
    checa('com GPU emulada a contagem continua conferida', c4.find((x) => /pilhas/.test(x.item)).situacao === 'dentro do fator 2');

    const outraVista = { ...naReferencia, parametros: { ...naReferencia.parametros, vista: 'alegrete' } };
    checa('vista diferente pula a conferencia em vez de mentir', /pulada/.test(conferirReferencia(outraVista, REF_SINTETICA)[0].situacao));

    // Caso medido em OUTRA base: 300 ms contra 27 esperados nao e divergencia,
    // e outra base. A conferencia pula em vez de acusar.
    const outraBase = resultadoFalso({ rodadas: [
        { rodada: 1, aquecimento: false, valida: true, erros: [], variantes: [
            { ...varFalsa('terreno', { cenarios: [cenarioFalso('parado', { render_p50: 300 })] }), base: 'carta-ortoimagem' },
        ] },
    ] });
    outraBase.parametros.bases = ['carta-ortoimagem'];
    outraBase.ambiente.baseInicial = 'carta-topografica';
    const c5 = conferirReferencia(outraBase, REF_SINTETICA);
    checa('caso de outra base nao entra na conferencia', c5.length === 1 && /pulada/.test(c5[0].situacao), JSON.stringify(c5));
    const mesmaBase = { ...outraBase, ambiente: { ...outraBase.ambiente, baseInicial: 'carta-ortoimagem' } };
    checa('caso na base com que o app abre entra na conferencia', conferirReferencia(mesmaBase, REF_SINTETICA).some((x) => /render_p50/.test(x.item) && x.situacao.startsWith('DIVERGENTE')));

    // A tabela desta branch esta vazia. O pior caso e a conferencia sair CALADA,
    // que se le como "nada divergiu": ela tem de DIZER que nao conferiu.
    const vazia = conferirReferencia(naReferencia, []);
    checa('referencia vazia nao passa por conferencia bem-sucedida', /NAO CONFERIDA/.test(vazia[0].situacao), JSON.stringify(vazia));
    checa('a constante desta branch esta vazia de proposito', Array.isArray(REFERENCIA) && REFERENCIA.length === 0);
    checa('o padrao de conferirReferencia usa a constante da branch', /NAO CONFERIDA/.test(conferirReferencia(naReferencia)[0].situacao));
}
eixo5();

function eixo6() {
    console.log('\n== eixo 6: leitura da linha de comando');
    const p = lerArgumentos([]);
    checa('padrao usa serra-gaucha, 2 rodadas, 1600x900, com cabeca', p.vista === 'serra-gaucha' && p.rodadas === 2 && p.largura === 1600 && p.altura === 900 && p.headless === false);
    checa('o padrao de --url e o stack de desenvolvimento desta branch (Vite na 3000, sem prefixo)',
        p.url === (process.env.EBGEO_URL || 'http://localhost:3000/'), p.url);
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
    checa('padrao mede a base atual, sem estrangular CPU, sem popular', p.bases.join(',') === 'atual' && p.cpu === 1 && p.populado === false);
    const p3 = lerArgumentos(['--bases', 'osm, carta-ortoimagem', '--cpu', '4', '--populado']);
    checa('--bases e lida na ordem digitada', p3.bases.join(',') === 'osm,carta-ortoimagem', p3.bases.join(','));
    checa('--cpu 4 e --populado sao lidos', p3.cpu === 4 && p3.populado === true);
    lanca('--bases vazia lanca', () => lerArgumentos(['--bases', ' , ']));
    lanca('--bases repetida lanca', () => lerArgumentos(['--bases', 'a,a']));
    lanca('--cpu 0 lanca', () => lerArgumentos(['--cpu', '0']));
}
eixo6();

function eixo7() {
    console.log('\n== eixo 7: prova da troca de mapa base (o pior caso de cada eixo)');
    const esperado = { id: 'carta-ortoimagem', atual: 'carta-topografica', estilo: 'ortoimagem_v1', fontes: ['orto'], camadas: ['bg', 'orto'], fontesAnteriores: ['topo', 'rotulos'] };
    const boa = { estilo: 'ortoimagem_v1', atual: 'carta-ortoimagem', fontesPresentes: ['orto'], fontesAusentes: [], fontesAnterioresRestantes: [], camadasPresentes: 2, carregadosPorFonte: { orto: 12 }, tilesCarregadosBase: 12 };
    checa('troca boa passa', validarBase(boa, esperado).length === 0, validarBase(boa, esperado).join('; '));
    checa('base nao registrada reprova com a mensagem do app', /nao esta registrada/.test(validarBase({}, { erro: 'base "x" nao esta registrada no app' }).join(' ')));
    // Nesta branch o estilo de cada base sai de `BaseLayerControl._styleFor`. Se
    // o controle deixar de expor esse caminho, a bancada tem de PARAR com a
    // razao, e nunca aprovar uma troca que ela nao sabe conferir.
    checa('controle sem _styleFor reprova com a razao', /nao expoe _styleFor/.test(validarBase(boa, { erro: 'BaseLayerControl nao expoe _styleFor(id): a bancada nao sabe qual estilo cada base tem neste app' }).join(' ')));
    checa('base cujo estilo e uma URL reprova em vez de ser aprovada as cegas', /so sabe provar estilo em objeto/.test(validarBase(boa, { erro: 'base "x" resolve para uma URL de estilo ("http://exemplo/x.json"), e a bancada so sabe provar estilo em objeto' }).join(' ')));
    checa('estilo da base anterior reprova (a troca nao aconteceu)', /a troca nao aconteceu/.test(validarBase({ ...boa, estilo: 'topo_v1' }, esperado).join(' ')));
    checa('controle apontando outra base reprova', validarBase({ ...boa, atual: 'carta-topografica' }, esperado).length > 0);
    checa('fonte da base ausente reprova', validarBase({ ...boa, fontesPresentes: [], fontesAusentes: ['orto'] }, esperado).length > 0);
    checa('fonte da base anterior que sobrou reprova', /sobraram/.test(validarBase({ ...boa, fontesAnterioresRestantes: ['topo'] }, esperado).join(' ')));
    checa('camada da base faltando reprova', validarBase({ ...boa, camadasPresentes: 1 }, esperado).length > 0);
    checa('estilo certo sem tile carregado reprova (mapa em branco)', /mapa em branco/.test(validarBase({ ...boa, tilesCarregadosBase: 0, carregadosPorFonte: { orto: 0 } }, esperado).join(' ')));
    // O controle que nao sabe que base o mapa tem: a troca "funciona" e deixa a
    // base anterior inteira por cima.
    const controleCego = { ...esperado, estiloAntes: 'topo_v1', estiloDoControleAntes: 'outro_v1' };
    checa('controle que nao sabe que base tem reprova antes de medir', /o app nao sabe que base tem/.test(validarBase(boa, controleCego).join(' ')));
    checa('controle e mapa de acordo passa', validarBase(boa, { ...esperado, estiloAntes: 'topo_v1', estiloDoControleAntes: 'topo_v1' }).length === 0);
    checa('camada de outra base que sobrou reprova', /camadas de outra base sobraram/.test(validarBase({ ...boa, camadasAnterioresRestantes: ['base_land', 'base_water'] }, esperado).join(' ')));
}
eixo7();

function eixo8() {
    console.log('\n== eixo 8: o instrumento mede o MESMO app (identidade do modulo)');
    const bom = {
        mapaGlobalPresente: true, registroPresente: true, mesmoMapa: true,
        registroCarregado: true, registroSemeadas: { total: 8, vivas: 8 },
    };
    checa('mapa do registro igual ao global e registro semeado passam', avaliarIdentidade(bom).length === 0, JSON.stringify(avaliarIdentidade(bom)));
    // O pior caso e o do CLAUDE.md desta casa: o Vite serve o modulo recem-editado
    // com `?t=` e o `import()` da sonda recebe OUTRA instancia. Nada quebra, e a
    // bancada mede um registro vazio com o nome do app.
    const outraCopia = avaliarIdentidade({ ...bom, mesmoMapa: false });
    checa('dois mapas diferentes reprovam', outraCopia.length > 0);
    checa('a reprova nomeia o HMR do Vite como causa', /HMR/.test(outraCopia.join(' ')), outraCopia.join(' '));
    const semRegistro = avaliarIdentidade({ ...bom, registroPresente: false, mesmoMapa: false });
    checa('registro sem mapa reprova', semRegistro.length > 0);
    checa('pagina sem __ebgeoMap reprova', avaliarIdentidade({ ...bom, mapaGlobalPresente: false, registroPresente: false, mesmoMapa: false }).length > 0);
    checa('leitura ausente reprova em vez de passar calada', avaliarIdentidade(null).length > 0);

    // O CASO QUE ESCAPOU DA PRIMEIRA VERSAO DESTA REGUA, e que so a rodada real
    // pegou: o mapa batia (o registro de controles nao tinha sido invalidado pelo
    // HMR, entao as duas copias de `store/index.js` reexportavam o MESMO
    // `control.registry.js`) e o `tool-registry.js` era OUTRO, com zero
    // ferramenta ansiosa viva. Provar identidade so pelo mapa aprovava isso.
    const registroDeOutraCopia = avaliarIdentidade({ ...bom, registroSemeadas: { total: 8, vivas: 0 } });
    checa('mapa igual e registro de ferramentas vazio reprova', registroDeOutraCopia.length > 0, JSON.stringify(registroDeOutraCopia));
    checa('a reprova diz que e OUTRA COPIA do modulo', /OUTRA COPIA/.test(registroDeOutraCopia.join(' ')), registroDeOutraCopia.join(' '));
    checa('registro nao importado reprova', avaliarIdentidade({ ...bom, registroCarregado: false, registroSemeadas: null }).length > 0);
    checa('modulo que nao parece o tool-registry reprova', avaliarIdentidade({ ...bom, registroSemeadas: null }).length > 0);
    // A vacuidade da propria prova: uma tabela sem ferramenta ansiosa nao permite
    // provar nada, e "nenhuma ansiosa, nenhuma viva" passaria por identidade boa.
    const semAnsiosa = avaliarIdentidade({ ...bom, registroSemeadas: { total: 0, vivas: 0 } });
    checa('tabela sem ferramenta ansiosa reprova em vez de aprovar por vacuidade', semAnsiosa.length > 0);
    checa('a reprova diz que a bancada nao tem como provar', /nao tem como provar/.test(semAnsiosa.join(' ')), semAnsiosa.join(' '));
    checa('uma ansiosa viva de oito ja prova a identidade', avaliarIdentidade({ ...bom, registroSemeadas: { total: 8, vivas: 1 } }).length === 0);
}
eixo8();

function eixo9() {
    console.log('\n== eixo 9: a leitura do estado dos tiles enxerga alguma coisa?');
    checa('leitura boa passa', validarLeituraDeTiles({ tiles: 40, desconhecidos: 3 }).length === 0);
    checa('mapa sem tile nenhum nao reprova (nao ha o que ler)', validarLeituraDeTiles({ tiles: 0, desconhecidos: 0 }).length === 0);
    // O pior caso, e o motivo desta regua existir: no MapLibre 5.18 vendorizado
    // `getTile(chave)` devolve undefined (ele espera um tileID), entao um leitor
    // que use a API errada acha 40 tiles e nao sabe o estado de nenhum. A
    // assinatura fica constante e "tiles estaveis por 3 s" vira verdade trivial.
    const cego = validarLeituraDeTiles({ tiles: 40, desconhecidos: 40 });
    checa('leitor que nao soube o estado de NENHUM tile reprova', cego.length > 0);
    checa('a reprova diz que "tiles estaveis" viraria verdade trivial', /verdade trivial/.test(cego.join(' ')), cego.join(' '));
    checa('quase-cego (um estado lido) ainda passa: a regua acusa a cegueira, nao a lentidao', validarLeituraDeTiles({ tiles: 40, desconhecidos: 39 }).length === 0);
    checa('leitura ausente reprova', validarLeituraDeTiles(null).length > 0);
}
eixo9();

function eixo10() {
    console.log('\n== eixo 10: prontidao do app (as fontes que o app declara, nao um numero de camadas)');
    const bom = {
        carregado: true, fontesExigidas: 21, fontesAusentes: [], camadas: 300, fontes: 100,
        mapaGlobalPresente: true, registroPresente: true, mesmoMapa: true,
        registroCarregado: true, registroSemeadas: { total: 8, vivas: 8 },
    };
    checa('app inteiro e estavel passa', avaliarProntidao(bom, 3500).pronto, JSON.stringify(avaliarProntidao(bom, 3500).motivos));
    // O caso que um piso de camadas aprovaria: 300 camadas do estilo base, e as
    // fontes do app ainda por vir.
    const meio = avaliarProntidao({ ...bom, fontesAusentes: ['coordination_lines', 'los', 'visibility'] }, 3500);
    checa('app com fonte faltando reprova mesmo com o estilo cheio', !meio.pronto);
    checa('a reprova nomeia as fontes que faltam', /coordination_lines/.test(meio.motivos.join(' ')), meio.motivos.join(' '));
    checa('map.loaded() falso reprova', !avaliarProntidao({ ...bom, carregado: false }, 3500).pronto);
    checa('estavel por menos de 3 s reprova', !avaliarProntidao(bom, 900).pronto);
    checa('estavel exatamente no piso passa', avaliarProntidao(bom, 3000).pronto);
    // O pior caso do proprio criterio: a bancada nao leu FEATURE_SOURCES, e a
    // lista vazia aprovaria QUALQUER pagina por vacuidade.
    const semLista = avaliarProntidao({ ...bom, fontesExigidas: 0, fontesAusentes: [] }, 3500);
    checa('lista de fontes vazia reprova em vez de aprovar por vacuidade', !semLista.pronto);
    checa('a reprova diz que o criterio de "app inteiro" nao existe sem a lista', /nao existe/.test(semLista.motivos.join(' ')), semLista.motivos.join(' '));
    checa('sonda sem leitura nenhuma reprova', !avaliarProntidao(null, 9999).pronto);
    checa('a identidade do modulo entra na prontidao', !avaliarProntidao({ ...bom, mesmoMapa: false }, 3500).pronto);
    checa('a identidade do REGISTRO tambem entra na prontidao',
        !avaliarProntidao({ ...bom, registroSemeadas: { total: 8, vivas: 0 } }, 3500).pronto);
}
eixo10();

function eixo11() {
    console.log('\n== eixo 11: o plano de --populado');
    checa('o plano cobre dez tipos de feicao', PLANO_POPULAR.length === 10, String(PLANO_POPULAR.length));
    checa('cada entrada e [classe, quantidade, forma]',
        PLANO_POPULAR.every(([c, n, f]) => /^Add.*Control$/.test(c) && Number.isInteger(n) && n > 0 && typeof f === 'string'),
        JSON.stringify(PLANO_POPULAR.filter(([c, n, f]) => !(/^Add.*Control$/.test(c) && Number.isInteger(n) && n > 0 && typeof f === 'string'))));
    checa('nenhum controle se repete no plano', new Set(PLANO_POPULAR.map(([c]) => c)).size === PLANO_POPULAR.length);
    // O plano NAO repete a chave do registro de ferramentas: ela e derivada da
    // tabela do proprio app dentro da pagina. Uma chave escrita aqui envelheceria
    // sozinha, e o modo de falha seria criar zero feicao em silencio.
    checa('o plano nao carrega a chave do tool-registry (ela e derivada do app)',
        PLANO_POPULAR.every((linha) => linha.length === 3));
}
eixo11();

console.log(`\n${total - falhas}/${total} passaram.`);
if (falhas) { console.log(`${falhas} FALHA(S): a bancada nao esta reprovando o que promete pegar.`); process.exit(1); }
console.log('A bancada reprova o insumo degenerado em todos os eixos que afirma medir.');
