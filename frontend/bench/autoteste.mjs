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
    VARIANTES, PLANO_POPULAR, REFERENCIA, ORDEM_PASSES, ORDEM_VARIANTES, lerArgumentos, estatistica, celula,
    montarTabela, conferirReferencia, percentil, mediana, escreverMarkdown,
    validarBase, avaliarIdentidade, validarLeituraDeTiles, avaliarProntidao,
    avisosDaVariante, validarGerenteDeSelecao, validarRemendo, validarSelecao,
    validarPasseNoGesto, aplicarRegraDeDecisao,
    posicaoAlvoDoHillshade, planoDeAgrupamento, validarLeituraDeDem, TIPOS_DRAPEAVEIS,
} from './desempenho-terreno.mjs';
import { lerProxyDoAmbiente, resolverProxyDoNavegador } from './proxy-do-navegador.mjs';

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
    // A linha do markdown carrega os QUATRO eixos do caso (base, variante, passe,
    // selecionadas) antes do cenario. Este casamento mudou quando o passe e a
    // selecao viraram dimensao: um resultado gravado sem elas cai no padrao
    // `selecao-quadro` e `0`, que e o que esta linha confere.
    checa('a base aparece na linha do markdown, com o passe e a selecao no padrao',
        /\| carta-ortoimagem \| terreno \| selecao-quadro \| 0 \| parado \| 5 \|/.test(escreverMarkdown(duasBases, t2, [])),
        escreverMarkdown(duasBases, t2, []).split('\n').filter((x) => /carta-ortoimagem/.test(x)).join(' // '));
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
    // DERIVADO da lista canonica, nunca um numero escrito aqui: um `7` a mao
    // reprova a bancada certa no dia em que ela ganha a oitava variante, que e
    // exatamente o dia em que este teste devia calar.
    checa('padrao usa todas as variantes', p.variantes.length === ORDEM_VARIANTES.length, `${p.variantes.length} de ${ORDEM_VARIANTES.length}`);
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
    checa('padrao de --proxy e ambiente', p.proxy === 'ambiente');
    checa('--proxy sem-proxy e lido', lerArgumentos(['--proxy', 'sem-proxy']).proxy === 'sem-proxy');
    lanca('--proxy desconhecido lanca', () => lerArgumentos(['--proxy', 'tunel']));
    // O passe da caixa de selecao e a selecao, os dois eixos novos.
    checa('padrao mede sem selecao e so o passe como esta', p.selecionadas.join(',') === '0' && p.passes.join(',') === 'selecao-quadro');
    const p4 = lerArgumentos(['--selecionadas', '50,0', '--passes', 'selecao-zoomend,selecao-quadro']);
    checa('--selecionadas sai em ordem crescente (zero e a linha de base, e ela vem primeiro)', p4.selecionadas.join(',') === '0,50', p4.selecionadas.join(','));
    checa('--passes volta na ordem canonica', p4.passes.join(',') === 'selecao-quadro,selecao-zoomend', p4.passes.join(','));
    checa('--selecionadas 0 sozinha e valida (e a medida sem selecao)', lerArgumentos(['--selecionadas', '0']).selecionadas.join(',') === '0');
    lanca('--selecionadas negativa lanca', () => lerArgumentos(['--selecionadas', '-1']));
    lanca('--selecionadas fracionaria lanca', () => lerArgumentos(['--selecionadas', '2.5']));
    lanca('--selecionadas nao numerica lanca', () => lerArgumentos(['--selecionadas', 'todas']));
    lanca('--selecionadas repetida lanca', () => lerArgumentos(['--selecionadas', '50,50']));
    lanca('--selecionadas vazia lanca', () => lerArgumentos(['--selecionadas', ' , ']));
    lanca('passe desconhecido lanca', () => lerArgumentos(['--passes', 'selecao-quadro,selecao-magica']));
    lanca('--passes repetida lanca', () => lerArgumentos(['--passes', 'selecao-exata,selecao-exata']));
    lanca('--passes vazia lanca', () => lerArgumentos(['--passes', ' , ']));
    checa('as tres variantes do passe sao as declaradas', ORDEM_PASSES.join(',') === 'selecao-quadro,selecao-exata,selecao-zoomend', ORDEM_PASSES.join(','));
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

function eixo12() {
    console.log('\n== eixo 12: o proxy do navegador, sem dialogo e sem vazar valor');
    const comCredencial = { HTTPS_PROXY: 'http://fulano:s3nh%40@proxy.interno:3128', NO_PROXY: 'localhost, 127.0.0.1 .eb.mil.br' };
    const lido = lerProxyDoAmbiente(comCredencial);
    checa('usuario e senha saem da URL, decodificados', !!lido && lido.username === 'fulano' && lido.password === 's3nh@');
    checa('o servidor fica sem a credencial', !!lido && lido.server === 'http://proxy.interno:3128', lido && lido.server);
    checa('NO_PROXY com espaco e virgula vira lista por virgula', !!lido && lido.bypass === 'localhost,127.0.0.1,.eb.mil.br', lido && lido.bypass);
    checa('sem credencial na URL nao ha proxy utilizavel (o dialogo voltaria)', lerProxyDoAmbiente({ HTTP_PROXY: 'http://proxy.interno:3128' }) === null);
    checa('so usuario, sem senha, tambem nao serve', lerProxyDoAmbiente({ HTTP_PROXY: 'http://fulano@proxy.interno:3128' }) === null);
    checa('ambiente vazio nao ha proxy', lerProxyDoAmbiente({}) === null);
    checa('URL invalida nao derruba a bancada', lerProxyDoAmbiente({ HTTPS_PROXY: '::nao-e-url' }) === null);
    const r = resolverProxyDoNavegador('ambiente', comCredencial);
    checa('modo ambiente com credencial passa proxy ao launch e nenhum --no-proxy-server',
        r.modo === 'ambiente' && !!r.launch.proxy && r.launch.proxy.username === 'fulano' && r.launch.proxy.password === 's3nh@' && r.launch.args.length === 0);
    checa('a descricao cita a chave e nunca a senha nem o host', /HTTPS_PROXY/.test(r.descricao) && !/s3nh|proxy\.interno|fulano/.test(r.descricao), r.descricao);
    const semCred = resolverProxyDoNavegador('ambiente', { HTTP_PROXY: 'http://proxy.interno:3128' });
    checa('modo ambiente sem credencial cai para sem-proxy com --no-proxy-server',
        semCred.modo === 'sem-proxy' && semCred.launch.args.includes('--no-proxy-server') && !semCred.launch.proxy);
    const off = resolverProxyDoNavegador('sem-proxy', comCredencial);
    checa('sem-proxy ignora a credencial do ambiente', off.launch.args.includes('--no-proxy-server') && !off.launch.proxy);
    const sistema = resolverProxyDoNavegador('sistema', comCredencial);
    checa('sistema nao mexe em nada', sistema.launch.args.length === 0 && !sistema.launch.proxy);
    lanca('modo desconhecido lanca', () => resolverProxyDoNavegador('tunel', comCredencial));
    checa('o que vai para o JSON de resultado (modo, args, descricao) nao carrega a senha',
        !JSON.stringify({ modo: r.modo, args: r.launch.args, descricao: r.descricao }).includes('s3nh'));
}
eixo12();

function eixo13() {
    console.log('\n== eixo 13: a bancada achou o GERENTE da caixa de selecao?');
    const bom = { achado: true, caminho: 'x', temPasse: true, temHandler: true, temChave: true, temSelectionManager: true };
    checa('gerente completo passa', validarGerenteDeSelecao(bom).length === 0, JSON.stringify(validarGerenteDeSelecao(bom)));
    // O pior caso, e o motivo desta regua: o caminho errado devolve undefined, o
    // remendo cai em silencio e a rodada mede o app intacto com o nome da variante.
    const ausente = validarGerenteDeSelecao({ achado: false, motivo: 'nenhum controle ansioso levou ao gerente', tentativas: ['AddPointControl: ainda e stand-in'] });
    checa('gerente ausente reprova', ausente.length > 0);
    checa('a reprova traz o que foi tentado', /stand-in/.test(ausente.join(' ')), ausente.join(' '));
    checa('busca nao feita reprova em vez de passar calada', validarGerenteDeSelecao(null).length > 0);
    // Achar um objeto QUALQUER nao e achar o gerente: os tres pontos que o remendo
    // troca tem de estar la, e cada um sozinho ja reprova.
    checa('objeto sem updateSelectionHighlight reprova', validarGerenteDeSelecao({ ...bom, temPasse: false }).length > 0);
    checa('objeto sem _handleZoomChange reprova', validarGerenteDeSelecao({ ...bom, temHandler: false }).length > 0);
    checa('objeto sem getCacheKey reprova', validarGerenteDeSelecao({ ...bom, temChave: false }).length > 0);
    checa('gerente que nao leva ao selectionManager reprova', validarGerenteDeSelecao({ ...bom, temSelectionManager: false }).length > 0);
}
eixo13();

function eixo14() {
    console.log('\n== eixo 14: o REMENDO pegou? (a funcao trocada e a que roda)');
    const quantizada = { amostras: 10, passo: 0.01, distintas: 1 };
    const exata = { amostras: 10, passo: 0.01, distintas: 10 };
    const bomQuadro = {
        aplicado: true, passadasNaProva: 1, handlerNaProva: 1, chave: quantizada,
        ouvintes: { legivel: true, emZoom: true, emZoomend: false },
    };
    checa('remendo do passe por quadro passa', validarRemendo('selecao-quadro', bomQuadro).length === 0, validarRemendo('selecao-quadro', bomQuadro).join('; '));
    checa('remendo nao aplicado reprova', validarRemendo('selecao-quadro', { aplicado: false, motivo: 'gerente ausente' }).length > 0);
    checa('remendo ausente reprova', validarRemendo('selecao-quadro', null).length > 0);
    // O pior caso do embrulho: a atribuicao caiu noutro objeto, nada lancou, e o
    // contador ficou em zero. Sem isto a tabela sai com o nome da variante e o
    // numero do app intacto.
    const passeMudo = validarRemendo('selecao-quadro', { ...bomQuadro, passadasNaProva: 0 });
    checa('passe que nao contou na chamada direta reprova', passeMudo.length > 0);
    checa('a reprova diz que o embrulho nao e a funcao que roda', /nao e a funcao que roda/.test(passeMudo.join(' ')), passeMudo.join(' '));
    checa('handler que nao contou na chamada direta reprova', validarRemendo('selecao-quadro', { ...bomQuadro, handlerNaProva: 0 }).length > 0);

    // A chave de cache, nas DUAS direcoes. Aprovar so uma delas deixaria a outra
    // passando por omissao, que e onde a proxima medida mente.
    const bomExata = { ...bomQuadro, chave: exata };
    checa('remendo da chave exata passa', validarRemendo('selecao-exata', bomExata).length === 0, validarRemendo('selecao-exata', bomExata).join('; '));
    const exataQueNaoPegou = validarRemendo('selecao-exata', { ...bomQuadro, chave: quantizada });
    checa('chave exata que continuou quantizada reprova', exataQueNaoPegou.length > 0);
    checa('a reprova diz que a chave continua QUANTIZADA', /continua QUANTIZADA/.test(exataQueNaoPegou.join(' ')), exataQueNaoPegou.join(' '));
    const quadroQueDesquantizou = validarRemendo('selecao-quadro', { ...bomQuadro, chave: exata });
    checa('passe por quadro cuja chave deixou de quantizar reprova', quadroQueDesquantizou.length > 0);
    checa('a chave de duas faixas ainda conta como quantizada (o zoom pode cruzar uma)',
        validarRemendo('selecao-quadro', { ...bomQuadro, chave: { amostras: 10, passo: 0.01, distintas: 2 } }).length === 0);
    // A vacuidade da propria prova: zero zooms experimentados aprovaria qualquer chave.
    const semExperimento = validarRemendo('selecao-exata', { ...bomQuadro, chave: { amostras: 0, passo: 0.01, distintas: 0 } });
    checa('chave nao experimentada reprova em vez de aprovar por vacuidade', semExperimento.length > 0);
    checa('a reprova diz que a variante exata nao teria como se provar', /nao teria como se provar/.test(semExperimento.join(' ')), semExperimento.join(' '));

    // A fiacao do ouvinte: o zoomend que nao desligou o `zoom` mede o passe por
    // quadro com o nome do zoomend.
    const bomZoomend = { aplicado: true, passadasNaProva: 1, handlerNaProva: 1, chave: quantizada, ouvintes: { legivel: true, emZoom: false, emZoomend: true } };
    checa('remendo do zoomend passa', validarRemendo('selecao-zoomend', bomZoomend).length === 0, validarRemendo('selecao-zoomend', bomZoomend).join('; '));
    const zoomendComZoomVivo = validarRemendo('selecao-zoomend', { ...bomZoomend, ouvintes: { legivel: true, emZoom: true, emZoomend: true } });
    checa('zoomend com o ouvinte de zoom ainda ligado reprova', zoomendComZoomVivo.length > 0, zoomendComZoomVivo.join('; '));
    checa('passe por quadro que perdeu o ouvinte de zoom reprova',
        validarRemendo('selecao-quadro', { ...bomQuadro, ouvintes: { legivel: true, emZoom: false, emZoomend: false } }).length > 0);
    // Lista de ouvintes ilegivel nao pode virar reprova: a versao do MapLibre pode
    // nao expor `_listeners`, e ai quem responde e o gesto (eixo 16).
    checa('ouvintes ilegiveis nao reprovam por si (quem responde e o gesto)',
        validarRemendo('selecao-zoomend', { ...bomZoomend, ouvintes: { legivel: false } }).length === 0);
}
eixo14();

function eixo15() {
    console.log('\n== eixo 15: a SELECAO esta na fonte da caixa?');
    const boa = { pedidas: 50, disponiveis: 56, selecionadas: 50, caixas: 50, fonteDaCaixa: 'selection-boxes', fontesQueEscreveram: ['selection-boxes'] };
    checa('selecao boa passa', validarSelecao(50, boa).length === 0, validarSelecao(50, boa).join('; '));
    checa('zero pedidas com zero caixas passa (e a linha de base)',
        validarSelecao(0, { ...boa, pedidas: 0, selecionadas: 0, caixas: 0 }).length === 0);
    checa('prova ausente reprova', validarSelecao(50, null).length > 0);
    checa('erro na selecao reprova com o motivo', /getCurrentMapFeatures/.test(validarSelecao(50, { erro: 'getCurrentMapFeatures: store ausente' }).join(' ')));
    // N maior que o que existe: o pior caso que o brief nomeia.
    const demais = validarSelecao(100, { ...boa, pedidas: 100, selecionadas: 56, caixas: 56 });
    checa('pedir mais feicoes do que o app tem reprova', demais.length > 0);
    checa('a reprova diz quantas o app tem', /so tem 56/.test(demais.join(' ')), demais.join(' '));
    checa('selecionar menos do que se pediu reprova', validarSelecao(50, { ...boa, selecionadas: 47 }).length > 0);
    // O pior caso de todos: o estado bate e a tela esta vazia.
    const telaVazia = validarSelecao(50, { ...boa, caixas: 0 });
    checa('estado certo com a fonte da caixa vazia reprova', telaVazia.length > 0);
    checa('a reprova nomeia a tela vazia', /a tela esta vazia/.test(telaVazia.join(' ')), telaVazia.join(' '));
    // A descoberta da fonte: sem ela a bancada nao sabe o que contar.
    const semFonte = validarSelecao(50, { ...boa, fonteDaCaixa: null, fontesQueEscreveram: [], caixas: -1 });
    checa('fonte da caixa nao descoberta reprova', semFonte.length > 0);
    checa('a reprova diz que nenhuma fonte recebeu escrita', /nenhuma fonte recebeu escrita/.test(semFonte.join(' ')), semFonte.join(' '));
    const ambigua = validarSelecao(50, { ...boa, fonteDaCaixa: null, fontesQueEscreveram: ['selection-boxes', 'lines'] });
    checa('duas fontes escritas na passada forcada reprovam (a descoberta nao e univoca)', ambigua.length > 0);
    checa('a reprova diz que a descoberta nao e univoca', /nao e univoca/.test(ambigua.join(' ')), ambigua.join(' '));
}
eixo15();

function eixo16() {
    console.log('\n== eixo 16: o GESTO mostrou o comportamento que a variante promete?');
    const quadroComSelecao = { handler: 92, passadas: 47 };
    checa('passe por quadro com 50 selecionadas passa', validarPasseNoGesto('selecao-quadro', 50, quadroComSelecao, 92).length === 0,
        validarPasseNoGesto('selecao-quadro', 50, quadroComSelecao, 92).join('; '));
    checa('chave exata segue a mesma regra do passe por quadro', validarPasseNoGesto('selecao-exata', 50, quadroComSelecao, 92).length === 0);
    checa('zoomend com dois gestos passa', validarPasseNoGesto('selecao-zoomend', 50, { handler: 2, passadas: 2 }, 92).length === 0,
        validarPasseNoGesto('selecao-zoomend', 50, { handler: 2, passadas: 2 }, 92).join('; '));
    checa('contador ausente reprova', validarPasseNoGesto('selecao-quadro', 50, null, 92).length > 0);
    checa('sem quadro nenhum a regua se cala (quem reprova e a prova do cenario)',
        validarPasseNoGesto('selecao-quadro', 50, { handler: 0, passadas: 0 }, 0).length === 0);

    // O PIOR CASO MEDIDO NESTA ARVORE: 92 eventos de zoom e DUAS passadas, porque
    // o `cancelAnimationFrame` matava a callback do proprio quadro. A caixa ficava
    // congelada e so saltava no fim do gesto.
    const fome = validarPasseNoGesto('selecao-quadro', 50, { handler: 92, passadas: 2 }, 92);
    checa('passe faminto (92 eventos, 2 passadas) reprova', fome.length > 0);
    checa('a reprova nomeia a FOME', /FOME/.test(fome.join(' ')), fome.join(' '));
    // O outro pior caso: o zoomend que nao desligou o ouvinte de zoom.
    const zoomendFalso = validarPasseNoGesto('selecao-zoomend', 50, { handler: 92, passadas: 47 }, 92);
    checa('zoomend com o handler rodando por quadro reprova', zoomendFalso.length > 0);
    checa('a reprova diz que o ouvinte de zoom nao foi desligado', /nao foi desligado/.test(zoomendFalso.join(' ')), zoomendFalso.join(' '));
    checa('zoomend com 47 passadas reprova mesmo com o handler quieto',
        validarPasseNoGesto('selecao-zoomend', 50, { handler: 2, passadas: 47 }, 92).length > 0);
    // O remendo por quadro que nao pegou: o handler quieto num gesto de 92 quadros.
    const handlerMudo = validarPasseNoGesto('selecao-quadro', 50, { handler: 1, passadas: 1 }, 92);
    checa('passe por quadro com o handler quieto reprova', handlerMudo.length > 0);
    checa('a reprova diz que o ouvinte de zoom nao esta ligado', /nao esta ligado/.test(handlerMudo.join(' ')), handlerMudo.join(' '));
    // A LINHA DE BASE: com zero selecionadas o passe nao pode rodar, senao ela nao
    // e a ausencia do passe e a comparacao da regra de decisao perde o sentido.
    checa('zero selecionadas com zero passadas passa', validarPasseNoGesto('selecao-quadro', 0, { handler: 92, passadas: 0 }, 92).length === 0);
    const baseSuja = validarPasseNoGesto('selecao-quadro', 0, { handler: 92, passadas: 30 }, 92);
    checa('zero selecionadas com passadas do gerente reprova', baseSuja.length > 0);
    checa('a reprova diz que a linha de base nao mede a ausencia do passe', /ausencia do passe/.test(baseSuja.join(' ')), baseSuja.join(' '));
    checa('com zero selecionadas a passada nao e cobrada como presenca',
        validarPasseNoGesto('selecao-zoomend', 0, { handler: 2, passadas: 0 }, 92).length === 0);
}
eixo16();

function eixo17() {
    console.log('\n== eixo 17: a REGRA DE DECISAO do zoomend, aplicada linha a linha');
    const caso = (passe, sel, render) => ({
        ...varFalsa('terreno', { cenarios: [cenarioFalso('zoom', { render_p50: render })] }),
        base: 'atual', passe, selecionadas: sel,
    });
    // `cenarioFalso` fixa o intervalo p95 em 33; para mexer nele a celula se monta a mao.
    const comP95 = (v, p95) => {
        const c = v.cenarios[0];
        c.estatistica.intervalo_ms = { p50: 16.7, p95, max: p95 * 2 };
        return v;
    };
    const montar = (variantesPorRodada, selecoes = [0, 50], passes = ['selecao-quadro']) => {
        const r = resultadoFalso({ rodadas: variantesPorRodada });
        r.parametros.selecionadas = selecoes;
        r.parametros.passes = passes;
        r.parametros.bases = ['atual'];
        r.ambiente.baseInicial = 'atual';
        return r;
    };
    // Dentro da amplitude: o zoomend "nao compensa".
    const dentro = montar([
        { rodada: 1, aquecimento: false, valida: true, erros: [], variantes: [
            comP95(caso('selecao-quadro', 0, 4), 16.8),
            comP95(caso('selecao-quadro', 50, 4.2), 16.9),
        ] },
        { rodada: 2, aquecimento: false, valida: true, erros: [], variantes: [
            comP95(caso('selecao-quadro', 0, 4.5), 17.2),
            comP95(caso('selecao-quadro', 50, 4.3), 17.0),
        ] },
    ]);
    const d1 = aplicarRegraDeDecisao(dentro);
    checa('medida de 50 dentro da amplitude de zero sai "dentro"', d1.length === 2 && d1.every((x) => /^dentro da amplitude/.test(x.situacao)), JSON.stringify(d1));
    checa('a linha diz de quantas amostras a amplitude saiu', d1.every((x) => x.amostrasBase === 2 && x.amostrasN === 2), JSON.stringify(d1.map((x) => [x.amostrasBase, x.amostrasN])));

    // Fora da amplitude: o conserto e baratear o passe.
    const fora = montar([
        { rodada: 1, aquecimento: false, valida: true, erros: [], variantes: [
            comP95(caso('selecao-quadro', 0, 4), 16.8),
            comP95(caso('selecao-quadro', 50, 4.2), 33.0),
        ] },
        { rodada: 2, aquecimento: false, valida: true, erros: [], variantes: [
            comP95(caso('selecao-quadro', 0, 4.5), 17.2),
            comP95(caso('selecao-quadro', 50, 4.3), 34.0),
        ] },
    ]);
    const d2 = aplicarRegraDeDecisao(fora).find((x) => /interv p95/.test(x.item));
    checa('cadencia p95 fora da amplitude sai SAI DA AMPLITUDE', /^SAI DA AMPLITUDE/.test(d2.situacao), JSON.stringify(d2));
    checa('a linha diz para que lado saiu', /acima/.test(d2.situacao), d2.situacao);

    // O PIOR CASO DA PROPRIA REGUA: sem a celula de zero, responder "dentro"
    // aprovaria por vacuidade.
    const semBase = montar([
        { rodada: 1, aquecimento: false, valida: true, erros: [], variantes: [comP95(caso('selecao-quadro', 50, 90), 60)] },
    ]);
    const d3 = aplicarRegraDeDecisao(semBase);
    checa('sem a celula de zero a regra diz SEM BASE em vez de aprovar', d3.some((x) => /SEM BASE/.test(x.situacao)), JSON.stringify(d3));

    // Celula de zero INVALIDA nao e linha de base: comparar com ela e comparar
    // com lixo, e o veredito herdaria uma validade que nao existe.
    const zeroInvalido = montar([
        { rodada: 1, aquecimento: false, valida: true, erros: [], variantes: [
            { ...comP95(caso('selecao-quadro', 0, 4), 16.8), valida: false, erros: ['getTerrain() nulo'] },
            comP95(caso('selecao-quadro', 50, 4.2), 16.9),
        ] },
    ]);
    checa('celula de zero invalida vira SEM BASE', aplicarRegraDeDecisao(zeroInvalido).some((x) => /SEM BASE/.test(x.situacao)));

    // Uma rodada so: a amplitude tem largura zero e qualquer ruido sai "fora". A
    // linha tem de DIZER isso, senao o veredito se le como medida.
    const umaRodada = montar([
        { rodada: 1, aquecimento: false, valida: true, erros: [], variantes: [
            comP95(caso('selecao-quadro', 0, 4), 16.8),
            comP95(caso('selecao-quadro', 50, 4), 16.8),
        ] },
    ]);
    const d4 = aplicarRegraDeDecisao(umaRodada);
    checa('amplitude de uma amostra so sai marcada', d4.every((x) => /LARGURA ZERO/.test(x.situacao)), JSON.stringify(d4.map((x) => x.situacao)));

    // O CASO QUE A GRADE REAL MOSTROU, e que a primeira versao desta regua deixava
    // passar: DUAS rodadas que concordam EXATAMENTE dao amplitude de largura zero
    // igual, e ai 16,8 contra 16,9..16,9 sai "fora" por um decimo. Contar amostras
    // nao pega isso; o que pega e a LARGURA.
    const duasIguais = montar([
        { rodada: 1, aquecimento: false, valida: true, erros: [], variantes: [
            comP95(caso('selecao-quadro', 0, 4), 16.9),
            comP95(caso('selecao-quadro', 50, 4), 16.8),
        ] },
        { rodada: 2, aquecimento: false, valida: true, erros: [], variantes: [
            comP95(caso('selecao-quadro', 0, 4), 16.9),
            comP95(caso('selecao-quadro', 50, 4), 16.8),
        ] },
    ]);
    const d4b = aplicarRegraDeDecisao(duasIguais).find((x) => /interv p95/.test(x.item));
    checa('duas rodadas que concordam exatamente dao largura zero, e a linha DIZ isso',
        /LARGURA ZERO/.test(d4b.situacao), JSON.stringify(d4b));
    checa('a linha de largura zero traz as duas amostras (nao e o caso de uma so)',
        d4b.amostrasBase === 2, JSON.stringify(d4b));
    // ...e uma amplitude de largura de verdade NAO ganha a marca.
    const comLargura = montar([
        { rodada: 1, aquecimento: false, valida: true, erros: [], variantes: [
            comP95(caso('selecao-quadro', 0, 4), 16.5),
            comP95(caso('selecao-quadro', 50, 4), 16.8),
        ] },
        { rodada: 2, aquecimento: false, valida: true, erros: [], variantes: [
            comP95(caso('selecao-quadro', 0, 4), 17.5),
            comP95(caso('selecao-quadro', 50, 4), 16.8),
        ] },
    ]);
    checa('amplitude com largura de verdade nao ganha a marca',
        !/LARGURA ZERO/.test(aplicarRegraDeDecisao(comLargura).find((x) => /interv p95/.test(x.item)).situacao));

    // Sem rodada valida, e sem o par (zero, N), nao ha veredito nenhum.
    const semRodada = montar([{ rodada: 1, aquecimento: false, valida: false, erros: ['cadencia'], variantes: [caso('selecao-quadro', 50, 4)] }]);
    checa('sem rodada valida a regra nao se aplica', /NAO APLICADA/.test((aplicarRegraDeDecisao(semRodada)[0] || {}).situacao || ''), JSON.stringify(aplicarRegraDeDecisao(semRodada)));
    const soZero = montar([
        { rodada: 1, aquecimento: false, valida: true, erros: [], variantes: [comP95(caso('selecao-quadro', 0, 4), 16.8)] },
    ], [0]);
    checa('rodada que so mediu zero nao produz veredito', /NAO APLICADA/.test((aplicarRegraDeDecisao(soZero)[0] || {}).situacao || ''), JSON.stringify(aplicarRegraDeDecisao(soZero)));
    const soCinquenta = montar([
        { rodada: 1, aquecimento: false, valida: true, erros: [], variantes: [comP95(caso('selecao-quadro', 50, 4), 16.8)] },
    ], [50]);
    checa('rodada que so mediu 50 nao produz veredito', /NAO APLICADA/.test((aplicarRegraDeDecisao(soCinquenta)[0] || {}).situacao || ''));

    // Cada variante do passe se julga contra a PROPRIA linha de base: cruzar as
    // duas compararia zoomend com quadro e chamaria a diferenca de efeito da selecao.
    const duasVariantes = montar([
        { rodada: 1, aquecimento: false, valida: true, erros: [], variantes: [
            // Uma rodada so: a amplitude tem largura zero, entao a celula de 50 so
            // fica "dentro" quando bate EXATAMENTE com a de zero. E o que faz este
            // caso isolar o unico eixo que sai: o render do zoomend.
            comP95(caso('selecao-quadro', 0, 4), 16.8),
            comP95(caso('selecao-quadro', 50, 4), 16.8),
            comP95(caso('selecao-zoomend', 0, 4), 16.8),
            comP95(caso('selecao-zoomend', 50, 40), 16.8),
        ] },
    ], [0, 50], ['selecao-quadro', 'selecao-zoomend']);
    const d5 = aplicarRegraDeDecisao(duasVariantes);
    checa('cada passe rende as suas duas linhas', d5.length === 4, JSON.stringify(d5.map((x) => x.item)));
    checa('o render fora da amplitude sai marcado so na variante dele',
        d5.filter((x) => /^SAI DA AMPLITUDE/.test(x.situacao)).every((x) => /selecao-zoomend \/ zoom \/ render p50/.test(x.item)),
        JSON.stringify(d5.map((x) => [x.item, x.situacao])));
    checa('a tabela do markdown traz a secao da regra de decisao',
        /A regra de decisao do `zoomend`, aplicada linha a linha/.test(escreverMarkdown(dentro, montarTabela(dentro), [], d1)));
    checa('sem decisao nenhuma o markdown nao inventa a secao',
        !/A regra de decisao/.test(escreverMarkdown(dentro, montarTabela(dentro), [], [])));
}
eixo17();

// --------------------------------------------------------------------------
// As tres propostas do relatorio da `main` (itens 2, 3 e 4). Os eixos 18 a 21.
//
// Cada uma delas mexe na ORDEM ou na FONTE, e as duas se parecem muito com um
// remendo que nao pegou: a camada continua no mapa, o estilo continua valido, e
// so a leitura de volta separa "movi" de "chamei a funcao de mover".
// --------------------------------------------------------------------------

// Um estilo de exemplo com a forma dos dois casos que importam: a base RASTER
// (que e a desta arvore, `carta-topografica` sobre tiles do OSM) e a base
// VETORIAL (que e a da `main`, com rotulo proprio). Nenhum id aqui vem do app:
// sao nomes de teste.
const estiloRaster = () => [
    { id: 'base-raster', type: 'raster', vis: 'visible' },
    { id: 'sep', type: 'circle', vis: 'none' },
    { id: 'app-fill', type: 'fill', vis: 'visible' },
    { id: 'app-line', type: 'line', vis: 'visible' },
    { id: 'app-label', type: 'symbol', vis: 'visible' },
    { id: 'app-handles', type: 'circle', vis: 'visible' },
];
const estiloVetorial = () => [
    { id: 'base-fundo', type: 'background', vis: 'visible' },
    { id: 'base-agua', type: 'fill', vis: 'visible' },
    { id: 'base-via', type: 'line', vis: 'visible' },
    { id: 'base-rotulo', type: 'symbol', vis: 'visible' },
    { id: 'sep', type: 'circle', vis: 'none' },
    { id: 'app-fill', type: 'fill', vis: 'visible' },
    { id: 'app-label', type: 'symbol', vis: 'visible' },
];
const IDS_RASTER = ['base-raster'];
const IDS_VETORIAL = ['base-fundo', 'base-agua', 'base-via', 'base-rotulo'];

function eixo18() {
    console.log('\n== eixo 18: a posicao alvo do hillshade (item 3 do relatorio da main)');
    checa('sem camada nenhuma nao inventa alvo', posicaoAlvoDoHillshade([], IDS_RASTER).alvo === null);
    checa('sem os ids da base nao inventa alvo', posicaoAlvoDoHillshade(estiloRaster(), []).alvo === null);
    checa('a recusa sem ids da base diz que faltou a lista', /nao leu os ids da base/.test(posicaoAlvoDoHillshade(estiloRaster(), []).motivo || ''));

    // O pior caso do calculo: base sem cobertura drapeavel nenhuma. Devolver 0
    // aqui poria o hillshade debaixo do mapa inteiro com cara de acerto.
    const soSymbol = [{ id: 'base-rotulo', type: 'symbol' }, { id: 'app-fill', type: 'fill' }];
    const semCobertura = posicaoAlvoDoHillshade(soSymbol, ['base-rotulo']);
    checa('base sem camada drapeavel nao tem alvo', semCobertura.alvo === null);
    checa('a recusa diz que nao existe "logo acima da cobertura"', /nao tem camada drapeavel/.test(semCobertura.motivo || ''), semCobertura.motivo);

    // As duas condicoes que se contradizem: um rotulo da base ANTES da ultima
    // cobertura dela. Nao ha posicao que satisfaca "acima da cobertura" e
    // "abaixo do primeiro symbol" ao mesmo tempo.
    const contraditoria = posicaoAlvoDoHillshade([
        { id: 'base-agua', type: 'fill' }, { id: 'base-rotulo', type: 'symbol' }, { id: 'base-via', type: 'line' },
    ], ['base-agua', 'base-rotulo', 'base-via']);
    checa('rotulo da base antes da ultima cobertura nao tem alvo', contraditoria.alvo === null);
    checa('a recusa nomeia as duas condicoes', /nao ha posicao que satisfaca as duas/.test(contraditoria.motivo || ''), contraditoria.motivo);

    const raster = posicaoAlvoDoHillshade(estiloRaster(), IDS_RASTER);
    checa('base raster: o alvo e logo depois do raster', raster.alvo === 1, JSON.stringify(raster));
    checa('base raster: a ancora e a camada seguinte', raster.beforeId === 'sep', raster.beforeId);
    const vetorial = posicaoAlvoDoHillshade(estiloVetorial(), IDS_VETORIAL);
    checa('base vetorial: o alvo e depois da ultima cobertura, e nao depois do rotulo', vetorial.alvo === 3, JSON.stringify(vetorial));
    checa('base vetorial: a ancora e o primeiro rotulo da base', vetorial.beforeId === 'base-rotulo', vetorial.beforeId);
    checa('a ultima cobertura da base sai nomeada', vetorial.ultimaCoberturaBase === 'base-via', vetorial.ultimaCoberturaBase);

    // O proprio hillshade nao conta como camada abaixo dele: com ele ja no meio
    // do estilo, o alvo tem de ser o MESMO que sem ele, senao a variante nunca
    // convergiria (cada aplicacao acharia um alvo novo).
    const comEle = estiloRaster();
    comEle.splice(3, 0, { id: 'hillshade', type: 'hillshade', vis: 'visible' });
    const idempotente = posicaoAlvoDoHillshade(comEle, IDS_RASTER);
    checa('o alvo nao muda por o hillshade ja estar no estilo', idempotente.alvo === raster.alvo, `${idempotente.alvo} contra ${raster.alvo}`);
}
eixo18();

function eixo19() {
    console.log('\n== eixo 19: o plano de agrupamento das camadas do app (item 2 do relatorio da main)');
    checa('sem camada nenhuma nao produz plano', planoDeAgrupamento([], IDS_RASTER).ordem === null);
    checa('sem os ids da base nao produz plano', planoDeAgrupamento(estiloRaster(), []).ordem === null);
    const soBase = planoDeAgrupamento([{ id: 'base-raster', type: 'raster' }], IDS_RASTER);
    checa('estilo so com a base nao produz plano', soBase.ordem === null);
    checa('a recusa diz que o app nao pos camada', /o app nao pos camada/.test(soBase.motivo || ''), soBase.motivo);

    // O pior caso do plano: camada da BASE no meio do bloco do app. Mover o
    // bloco inteiro para o fim arrastaria a base junto e trocaria o mapa de
    // baixo, com cara de agrupamento.
    const atravessado = [
        { id: 'base-raster', type: 'raster' }, { id: 'app-fill', type: 'fill' },
        { id: 'base-rotulo', type: 'symbol' }, { id: 'app-label', type: 'symbol' },
    ];
    const p = planoDeAgrupamento(atravessado, ['base-raster', 'base-rotulo']);
    checa('base no meio do bloco do app recusa o plano', p.ordem === null);
    checa('a recusa nomeia a camada da base que atravessa', /base-rotulo/.test(p.motivo || ''), p.motivo);
    checa('a recusa diz que agrupar arrastaria a base', /arrastaria a base junto/.test(p.motivo || ''), p.motivo);

    const bom = planoDeAgrupamento(estiloRaster(), IDS_RASTER);
    checa('as drapeaveis vem antes das quebra-pilha', bom.ordem.join(',') === 'app-fill,app-line,sep,app-label,app-handles', bom.ordem.join(','));
    checa('a ordem relativa dentro de cada bloco se preserva', bom.ordem.indexOf('app-fill') < bom.ordem.indexOf('app-line')
        && bom.ordem.indexOf('sep') < bom.ordem.indexOf('app-label'), bom.ordem.join(','));
    checa('conta as drapeaveis do app', bom.drapeaveis === 2, String(bom.drapeaveis));
    checa('conta as quebra-pilha do app', bom.quebraPilha === 3, String(bom.quebraPilha));
    // O separador nasce `none`: contar a camada ESCONDIDA como quebra-pilha
    // aprovaria um agrupamento que nao funde pilha nenhuma.
    checa('so as quebra-pilha VISIVEIS contam para o efeito', bom.quebraPilhaVisiveis === 2, String(bom.quebraPilhaVisiveis));
    checa('o bloco do app no fim do estilo nao tem ancora', bom.beforeId === null, String(bom.beforeId));

    // O caso do `--selecionadas 0` desta arvore: o app so tem drapeavel visivel,
    // e as quebra-pilha estao todas escondidas por fonte vazia.
    const tudoEscondido = estiloRaster().map((l) => (TIPOS_DRAPEAVEIS.has(l.type) ? l : { ...l, vis: 'none' }));
    checa('bloco com todas as quebra-pilha escondidas conta zero visiveis',
        planoDeAgrupamento(tudoEscondido, IDS_RASTER).quebraPilhaVisiveis === 0);

    // O bloco JA agrupado: a variante reordena, nada muda, e a celula sairia
    // igual a de `terreno` com outro nome.
    const jaOrdenado = [
        { id: 'base-raster', type: 'raster', vis: 'visible' },
        { id: 'app-fill', type: 'fill', vis: 'visible' },
        { id: 'app-line', type: 'line', vis: 'visible' },
        { id: 'app-label', type: 'symbol', vis: 'visible' },
    ];
    checa('bloco ja agrupado sai marcado como tal', planoDeAgrupamento(jaOrdenado, IDS_RASTER).jaAgrupado === true);
    checa('bloco desordenado nao sai marcado como agrupado', bom.jaAgrupado === false);

    // A ancora quando ha camada da base ACIMA do bloco do app.
    const comAncora = [
        { id: 'base-raster', type: 'raster', vis: 'visible' },
        { id: 'app-label', type: 'symbol', vis: 'visible' },
        { id: 'app-fill', type: 'fill', vis: 'visible' },
        { id: 'base-topo', type: 'symbol', vis: 'visible' },
    ];
    const pa = planoDeAgrupamento(comAncora, ['base-raster', 'base-topo']);
    checa('com base acima do bloco a ancora e ela', pa.beforeId === 'base-topo', String(pa.beforeId));
    checa('e a ordem poe a drapeavel primeiro', pa.ordem.join(',') === 'app-fill,app-label', pa.ordem.join(','));
}
eixo19();

function eixo20() {
    console.log('\n== eixo 20: o leitor de DEM cego e o DEM sem cobertura (item 4 do relatorio da main)');
    checa('sem terreno a regua nao opina', validarLeituraDeDem({ terreno: false, demFontes: 0, demTiles: 0 }).length === 0);
    checa('prova ausente nao explode', validarLeituraDeDem(null).length === 0);
    const semFonte = validarLeituraDeDem({ terreno: true, demFontes: 0, demTiles: 0 });
    checa('terreno ligado sem fonte raster-dem reprova', semFonte.length > 0);
    checa('a reprova diz que a bancada nao esta lendo a fonte', /nao esta lendo a fonte de elevacao/.test(semFonte.join(' ')), semFonte.join(' '));
    // O pior caso DESTA regua e o instrumento cego: um leitor que devolve lista
    // vazia deixaria toda celula sair com o terreno "medido".
    const leitorCego = validarLeituraDeDem({ terreno: true, demFontes: 2, demTiles: 0, demCarregados: 0 });
    checa('fonte de DEM sem tile residente reprova', leitorCego.length > 0);
    checa('a reprova diz que a bancada nao esta lendo a fonte', /nao esta lendo a fonte de elevacao/.test(leitorCego.join(' ')), leitorCego.join(' '));
    checa('uma fonte com tile carregado passa', validarLeituraDeDem({ terreno: true, demFontes: 1, demTiles: 74, demCarregados: 74, demErro: 0 }).length === 0);
    checa('duas fontes com tile carregado passam', validarLeituraDeDem({ terreno: true, demFontes: 2, demTiles: 103, demCarregados: 103, demErro: 0 }).length === 0);
    // O DEM sem COBERTURA nao e defeito da bancada, e nao reprova: o servidor
    // respondeu e a leitura funcionou. Quem responde por ele e o aviso.
    const todoErrado = { terreno: true, hillshade: 'ausente', hillshadeConfigurado: true, hillshadeDeclarado: true, demFontes: 1, demTiles: 25, demCarregados: 0, demErro: 25 };
    checa('DEM inteiro com erro nao REPROVA a variante', validarLeituraDeDem(todoErrado).length === 0, validarLeituraDeDem(todoErrado).join('; '));
    // ...e este e o estado medido nesta maquina: o `terrain-tiles` do demotiles
    // cobre um grau quadrado nos Alpes, e devolve 404 sobre o Rio Grande do Sul.
    // A contagem de tile RESIDENTE aprova esse estado; so o estado do tile o pega.
    const avisoSemCobertura = avisosDaVariante(todoErrado);
    checa('DEM inteiro com erro sai com aviso', avisoSemCobertura.length === 1, JSON.stringify(avisoSemCobertura));
    checa('o aviso diz que o relevo medido e PLANO', /relevo medido e PLANO/.test(avisoSemCobertura.join(' ')), avisoSemCobertura.join(' '));
    checa('o aviso diz quantos tiles vieram com erro', /25 de 25/.test(avisoSemCobertura.join(' ')), avisoSemCobertura.join(' '));
    // Cobertura parcial tambem tem de aparecer: um relevo que so existe em meio
    // quadro nao se compara com um que existe inteiro.
    const parcial = avisosDaVariante({ ...todoErrado, demCarregados: 10, demErro: 15 });
    checa('DEM parcial sai com aviso proprio', /DEM PARCIAL/.test(parcial.join(' ')), parcial.join(' '));
    checa('DEM inteiro carregado nao ganha aviso de cobertura',
        avisosDaVariante({ ...todoErrado, demCarregados: 25, demErro: 0 }).length === 0);
    checa('em 2d o aviso de DEM nao aparece',
        avisosDaVariante({ ...todoErrado, terreno: false }).length === 0);
    // Resultado gravado antes das contagens novas nao pode inventar aviso.
    checa('prova sem as contagens novas nao inventa aviso de DEM',
        avisosDaVariante({ terreno: true, hillshade: 'ausente', hillshadeConfigurado: true, hillshadeDeclarado: true }).length === 0);
}
eixo20();

function eixo21() {
    console.log('\n== eixo 21: as quatro variantes novas, cada uma no pior caso dela');

    // --- terreno-hillshade-app: a linha de base das duas de hillshade
    const app = VARIANTES['terreno-hillshade-app'];
    const provaApp = { terreno: true, hillshade: 'visible', hillshadeConfigurado: false, demFontes: 2, demTiles: 103 };
    const TINTA = { 'hillshade-exaggeration': 0.5 };
    const detApp = { hillshadeApp: { instalado: true, fonteDaCamada: 'fonte-do-hillshade', fonteDeclarada: 'fonte-do-hillshade', sobreFonteDoTerreno: false, tinta: TINTA, tintaDeclarada: TINTA } };
    checa('hillshade-app bom passa', app.validar(provaApp, detApp).length === 0, app.validar(provaApp, detApp).join('; '));
    checa('hillshade-app sem instalar reprova', app.validar(provaApp, { hillshadeApp: { instalado: false, motivo: 'config ausente' } }).length > 0);
    checa('hillshade-app com a camada ausente reprova', app.validar({ ...provaApp, hillshade: 'ausente' }, detApp).length > 0);
    const sobreOTerreno = app.validar(provaApp, { hillshadeApp: { ...detApp.hillshadeApp, fonteDaCamada: 'fonte-do-terreno', sobreFonteDoTerreno: true } });
    checa('hillshade-app com a camada sobre a fonte do terreno reprova', sobreOTerreno.length > 0);
    checa('a reprova diz que isso seria a outra variante', /seria a outra variante/.test(sobreOTerreno.join(' ')), sobreOTerreno.join(' '));
    checa('hillshade-app com a tinta diferente da declarada reprova',
        app.validar(provaApp, { hillshadeApp: { ...detApp.hillshadeApp, tinta: {} } }).length > 0);
    // A linha de base E a duplicacao: uma fonte so ja seria a outra variante.
    const umaFonte = app.validar({ ...provaApp, demFontes: 1 }, detApp);
    checa('hillshade-app com uma fonte de DEM so reprova', umaFonte.length > 0);
    checa('a reprova diz que a linha de base tem duas fontes', /a linha de base tem duas/.test(umaFonte.join(' ')), umaFonte.join(' '));
    checa('hillshade-app com DEM sem tile reprova', app.validar({ ...provaApp, demTiles: 0 }, detApp).length > 0);
    // A celula tem de DIZER que o hillshade e da bancada: sem isso ela se
    // compararia com a de um deploy que o liga por configuracao.
    const av = avisosDaVariante(provaApp);
    checa('a celula com hillshade da bancada sai com aviso', av.length === 1, JSON.stringify(av));
    checa('o aviso diz que a camada nasceu depois do boot', /nasceu depois do boot/.test(av.join(' ')), av.join(' '));
    // A armadilha que a rodada de fumaca revelou: `TerrainControl.hillshadeConfig`
    // E o mesmo objeto que `config.map2d.hillshade`, entao ligar a bandeira para
    // instalar a camada tambem apaga o rastro de que o servidor a tinha
    // desligada. Lido pelo valor VIVO, o aviso sumiria e a celula sairia com cara
    // de deploy que o tem por configuracao.
    const remendadoPorDentro = { ...provaApp, hillshadeConfigurado: true, hillshadeDeclarado: false };
    checa('o hillshade instalado pela bancada continua marcado depois de a bandeira virar',
        /LIGADO PELA BANCADA/.test(avisosDaVariante(remendadoPorDentro).join(' ')), JSON.stringify(avisosDaVariante(remendadoPorDentro)));
    checa('num app que declara o hillshade ligado nao ha aviso',
        avisosDaVariante({ ...provaApp, hillshadeConfigurado: true, hillshadeDeclarado: true }).length === 0);
    // Resultado gravado antes do campo novo cai no valor vivo, que era o mesmo
    // naquela epoca: a tabela de uma rodada velha continua se lendo.
    checa('prova sem o campo novo cai no valor vivo',
        /LIGADO PELA BANCADA/.test(avisosDaVariante(provaApp).join(' ')), JSON.stringify(avisosDaVariante(provaApp)));

    // --- terreno-dem-unico: o degenerado nomeado e a FONTE NAO TROCADA
    const unico = VARIANTES['terreno-dem-unico'];
    const provaUnico = { terreno: true, hillshade: 'visible', hillshadeConfigurado: false, demFontes: 1, demTiles: 25 };
    const instUnico = { instalado: true, sobreFonteDoTerreno: true, fonteDeclarada: 'fonte-do-hillshade', fonteAlvo: 'fonte-do-terreno', fonteDaCamada: 'fonte-do-terreno', tinta: TINTA, tintaDeclarada: TINTA };
    const consBoa = { consolidado: true, fonteDoTerreno: 'fonte-do-terreno', fonteDoHillshade: 'fonte-do-terreno', demAntes: ['fonte-do-terreno', 'fonte-do-hillshade'], removidas: ['fonte-do-hillshade'], emUso: [], demDepois: ['fonte-do-terreno'], erroSetTerrain: null };
    const detUnico = { hillshadeApp: instUnico, consolidacao: consBoa };
    checa('dem-unico bom passa', unico.validar(provaUnico, detUnico).length === 0, unico.validar(provaUnico, detUnico).join('; '));
    // O pior caso nomeado no brief: a FONTE NAO TROCADA. A camada continua sobre
    // a fonte propria do hillshade, e o estilo continua valido.
    const naoTrocou = unico.validar({ ...provaUnico, demFontes: 2 }, { hillshadeApp: { ...instUnico, fonteDaCamada: 'fonte-do-hillshade' }, consolidacao: { ...consBoa, fonteDoHillshade: 'fonte-do-hillshade', removidas: [], demDepois: ['fonte-do-terreno', 'fonte-do-hillshade'] } });
    checa('dem-unico com a FONTE NAO TROCADA reprova', naoTrocou.length > 0);
    checa('a reprova diz que os tiles continuam vindo duas vezes', /pedidos duas vezes/.test(naoTrocou.join(' ')), naoTrocou.join(' '));
    checa('a reprova nomeia as duas fontes', /fonte-do-hillshade.*fonte-do-terreno/.test(naoTrocou.join(' ')), naoTrocou.join(' '));
    // O caso que a contagem de fontes sozinha nao pegaria: a camada passou para a
    // fonte do terreno e OUTRA camada ficou sobre a fonte velha, que por isso nao
    // se removeu. A consolidacao nao pode calar sobre o que deixou para tras.
    const sobrou = unico.validar({ ...provaUnico, demFontes: 2 }, { hillshadeApp: instUnico, consolidacao: { ...consBoa, removidas: [], emUso: [{ id: 'fonte-do-hillshade', camadas: ['hillshade-2'] }], demDepois: ['fonte-do-terreno', 'fonte-do-hillshade'] } });
    checa('dem-unico com fonte de DEM alheia ainda em uso reprova', sobrou.length > 0);
    checa('a reprova nomeia a fonte que sobrou', /fonte-do-hillshade/.test(sobrou.join(' ')), sobrou.join(' '));
    checa('dem-unico que nao consolidou reprova',
        unico.validar({ ...provaUnico, demFontes: 2 }, { hillshadeApp: instUnico, consolidacao: { consolidado: false, motivo: 'getTerrain() nao devolve fonte' } }).length > 0);
    checa('dem-unico que perdeu a camada reprova', unico.validar({ ...provaUnico, hillshade: 'ausente' }, detUnico).length > 0);
    // O remendo troca a FONTE da definicao, e mais nada.
    const tintaPerdida = unico.validar(provaUnico, { hillshadeApp: { ...instUnico, tinta: {} }, consolidacao: consBoa });
    checa('dem-unico cuja tinta nao e a declarada reprova', tintaPerdida.length > 0);
    checa('a reprova diz que a celula compara duas camadas diferentes', /duas camadas diferentes/.test(tintaPerdida.join(' ')), tintaPerdida.join(' '));
    checa('dem-unico cujo setTerrain lancou reprova',
        unico.validar(provaUnico, { hillshadeApp: instUnico, consolidacao: { ...consBoa, erroSetTerrain: 'cannot load terrain' } }).length > 0);
    checa('dem-unico com DEM sem tile reprova', unico.validar({ ...provaUnico, demTiles: 0 }, detUnico).length > 0);
    checa('dem-unico com duas fontes de DEM no fim reprova', unico.validar({ ...provaUnico, demFontes: 2 }, detUnico).length > 0);

    // --- terreno-hillshade-baixo: o degenerado nomeado e a CAMADA NAO MOVIDA
    const baixo = VARIANTES['terreno-hillshade-baixo'];
    const provaBaixo = { terreno: true, hillshade: 'visible', hillshadeConfigurado: false, demFontes: 2, demTiles: 103 };
    const descidaBoa = { movido: true, noAlvo: true, indiceAntes: 40, indiceDepois: 1, primeiroSymbolDepois: 4, alvo: { alvo: 1, ultimaCoberturaBase: 'base-raster', motivo: null } };
    const detBaixo = { hillshadeApp: { instalado: true }, descida: descidaBoa };
    checa('hillshade-baixo bom passa', baixo.validar(provaBaixo, detBaixo).length === 0, baixo.validar(provaBaixo, detBaixo).join('; '));
    const inerte = baixo.validar(provaBaixo, { hillshadeApp: { instalado: true }, descida: { ...descidaBoa, movido: false, indiceAntes: 1, indiceDepois: 1 } });
    checa('hillshade-baixo com a CAMADA NAO MOVIDA reprova', inerte.length > 0);
    checa('a reprova diz que o app ja o poe no alvo', /o app JA poe o hillshade no indice 1/.test(inerte.join(' ')), inerte.join(' '));
    checa('a reprova diz que a variante nao contrasta mais', /nao contrasta mais com/.test(inerte.join(' ')), inerte.join(' '));
    checa('hillshade-baixo que moveu e errou o alvo reprova',
        baixo.validar(provaBaixo, { hillshadeApp: { instalado: true }, descida: { ...descidaBoa, noAlvo: false, indiceDepois: 3 } }).length > 0);
    // A promessa e ficar ABAIXO do primeiro rotulo: moveu, caiu no alvo que o
    // calculo pediu, e ainda assim ficou por cima.
    const acimaDoRotulo = baixo.validar(provaBaixo, { hillshadeApp: { instalado: true }, descida: { ...descidaBoa, indiceDepois: 9, noAlvo: true, primeiroSymbolDepois: 4, alvo: { alvo: 9, ultimaCoberturaBase: 'base-raster', motivo: null } } });
    checa('hillshade-baixo acima do primeiro symbol reprova', acimaDoRotulo.length > 0);
    checa('a reprova nomeia os dois indices', /indice 9\).*indice 4/.test(acimaDoRotulo.join(' ')), acimaDoRotulo.join(' '));
    checa('hillshade-baixo sem alvo possivel reprova',
        baixo.validar(provaBaixo, { hillshadeApp: { instalado: true }, descida: { movido: false, alvo: { alvo: null, motivo: 'a base nao tem camada drapeavel nenhuma' } } }).length > 0);
    checa('hillshade-baixo sem a camada reprova', baixo.validar({ ...provaBaixo, hillshade: 'ausente' }, detBaixo).length > 0);

    // --- terreno-camadas-agrupadas: o degenerado nomeado e o GRUPO NAO CONTIGUO
    const grupo = VARIANTES['terreno-camadas-agrupadas'];
    const provaGrupo = { terreno: true, pilhas: 1, hillshade: 'ausente', hillshadeConfigurado: false };
    const agrupBom = { aplicado: true, plano: { jaAgrupado: false, quebraPilha: 32, quebraPilhaVisiveis: 9, motivo: null }, ordemBate: true, mudaramDePosicao: 20, pilhasAntes: 9 };
    checa('camadas-agrupadas bom passa', grupo.validar(provaGrupo, { agrupamento: agrupBom }).length === 0,
        grupo.validar(provaGrupo, { agrupamento: agrupBom }).join('; '));
    const naoContiguo = grupo.validar(provaGrupo, { agrupamento: { aplicado: false, plano: { motivo: 'as camadas da base base-rotulo estao DENTRO do bloco do app: agrupar arrastaria a base junto' } } });
    checa('camadas-agrupadas com o GRUPO NAO CONTIGUO reprova', naoContiguo.length > 0);
    checa('a reprova repete o motivo do plano', /estao DENTRO do bloco do app/.test(naoContiguo.join(' ')), naoContiguo.join(' '));
    const jaEstava = grupo.validar(provaGrupo, { agrupamento: { ...agrupBom, plano: { ...agrupBom.plano, jaAgrupado: true } } });
    checa('camadas-agrupadas num bloco ja agrupado reprova', jaEstava.length > 0);
    checa('a reprova diz que nao contrasta mais com terreno', /nao contrasta mais com/.test(jaEstava.join(' ')), jaEstava.join(' '));
    // O pior caso desta variante: a ordem LIDA do mapa nao e a do plano. O
    // `moveLayer` pode ter falhado numa camada e a contagem de movidas nao sabe.
    const ordemErrada = grupo.validar(provaGrupo, { agrupamento: { ...agrupBom, ordemBate: false } });
    checa('camadas-agrupadas cuja ordem lida nao bate com o plano reprova', ordemErrada.length > 0);
    checa('a reprova diz que a ordem LIDA e que manda', /ordem LIDA do mapa/.test(ordemErrada.join(' ')), ordemErrada.join(' '));
    checa('camadas-agrupadas em que nada trocou de posicao reprova',
        grupo.validar(provaGrupo, { agrupamento: { ...agrupBom, mudaramDePosicao: 0 } }).length > 0);
    // O caso REAL do `--selecionadas 0` nesta arvore: as quebra-pilha do app
    // estao todas escondidas por fonte vazia, entao nao ha pilha a fundir.
    const soEscondidas = grupo.validar({ ...provaGrupo, pilhas: 1 }, { agrupamento: { ...agrupBom, plano: { ...agrupBom.plano, quebraPilhaVisiveis: 0 }, pilhasAntes: 1 } });
    checa('camadas-agrupadas sem quebra-pilha VISIVEL reprova', soEscondidas.length > 0);
    checa('a reprova diz que nao havia pilha a fundir', /nao havia pilha a fundir/.test(soEscondidas.join(' ')), soEscondidas.join(' '));
    checa('camadas-agrupadas com a pilha teimosa reprova',
        grupo.validar({ ...provaGrupo, pilhas: 9 }, { agrupamento: agrupBom }).length > 0);
}
eixo21();

console.log(`\n${total - falhas}/${total} passaram.`);
if (falhas) { console.log(`${falhas} FALHA(S): a bancada nao esta reprovando o que promete pegar.`); process.exit(1); }
console.log('A bancada reprova o insumo degenerado em todos os eixos que afirma medir.');
