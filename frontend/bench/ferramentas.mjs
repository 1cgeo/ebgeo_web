// Bancada de desempenho das FERRAMENTAS de desenho do EBGeo Web.
//
// Mede o que doi ao USAR uma ferramenta, nao o custo do mapa parado: o feedback
// do desenho enquanto o mouse anda, o passe de zoom com N feicoes na vista e a
// latencia de concluir a feicao. Cada cenario devolve a PROVA de que a
// ferramenta trabalhou, e prova que nao bate marca o cenario INVALIDO em vez de
// virar numero bonito.
//
// A bancada reprova a si mesma antes de medir: renderer emulado invalida o
// relogio, aba oculta invalida a rodada, cadencia ociosa do rAF acima de 25 ms
// (p95) invalida a rodada, modulo importado que nao seja o do app invalida a
// rodada, desenho sem escrita na fonte de feedback e cenario invalido ("a
// ferramenta nao desenhou"), zoom sem feicao na fonte e cenario invalido.
//
// NESTA BRANCH A FONTE PRINCIPAL SE ESCREVE POR DIFF. As dezesseis fontes
// migradas passam pelo despachante `layers/geojson-dispatcher.js`, que chama
// `updateData` em vez de `setData`; as fontes de apoio (`-feedback`,
// `-edit-handles`) continuam em `setData` cru. Uma bancada que contasse so
// `setData` diria "zero escritas" no `zoom` e no `conclusao` de TODA ferramenta
// migrada, e reprovaria o app bom. Por isso os dois metodos sao instrumentados,
// por fonte, e a tabela mostra os dois separados: e a coluna que distingue quem
// deriva o tamanho na GPU (uma escrita por gesto) de quem reenvia a colecao a
// cada quadro.
//
// A saida de terminal e ASCII de proposito (o console do Windows abre em
// codepage 850); a prosa acentuada vive nos comentarios, no README e no markdown
// gravado em disco.
//
// Uso e armadilhas: ver bench/README.md.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolverProxyDoNavegador, MODOS_DE_PROXY } from './proxy-do-navegador.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
/** A raiz do PACOTE `frontend/`, que e onde `bench/` mora. */
const PACOTE = path.resolve(AQUI, '..');
/** A raiz do monorepo. */
const RAIZ = path.resolve(PACOTE, '..');

// --------------------------------------------------------------------------
// Ferramentas. Nome curto na linha de comando, o resto lido do app.
//
// `controle` e o nome da CLASSE, que e como o registro de controles do app a
// publica (`store/control.registry.js`); `tipo` sai do FEATURE_TYPE_MAPPINGS de
// `store/store.constants.js` (o balde que getCurrentMapFeatures devolve),
// `fonte` do FEATURE_SOURCES de `layers/layer.constants.js` e `feedback` da
// fonte que o proprio controle escreve no preview. `painel` e a secao de
// atributos que o controle monta ao concluir.
//
// A CHAVE DA FERRAMENTA NO CARREGADOR TARDIO NAO MORA AQUI. Nesta branch quase
// toda ferramenta e carregada sob demanda (`tool_manager/tool-registry.js`), e
// `getControl('AddXControl')` devolve um STAND-IN ate `ensureControl(<chave>)`
// rodar. A chave sai da tabela do PROPRIO app, casada pelo nome da classe,
// dentro da pagina: escrita aqui, ela envelheceria sozinha e o modo de falha
// seria medir o stand-in com o nome da ferramenta.
//
// Os campos opcionais existem porque o app NAO tem uma API uniforme de desenho,
// e inventar uma aqui seria medir um aplicativo que nao existe:
//
// - `modoDesenho`: `clique` (padrao) ou `arrastar`.
// - `pontos`: onde o controle guarda o que o usuario ja colocou. `lista` conta
//   o comprimento do vetor, `ponto` conta 1 quando a propriedade nao e nula.
// - `semeadura`: como o cenario zoom entrega os pontos ao `createFeature()`.
// - `requerTerreno`: a ferramenta nem ativa sem terreno.
// - `feicoesPadrao`: o `--feicoes` que vale quando a linha de comando cala.
// - `processado`: a ferramenta de analise nao para na feicao.
// --------------------------------------------------------------------------
const FERRAMENTAS = {
    line: {
        controle: 'AddLineControl', tipo: 'lines', fonte: 'lines',
        feedback: 'line-feedback', painel: '.line-attributes-section',
        pontosParaCriar: 4, conclusao: { gesto: 'botao-direito', cliquesAntes: 3, evento: 'contextmenu' },
    },
    polygon: {
        controle: 'AddPolygonControl', tipo: 'polygons', fonte: 'polygons',
        feedback: 'polygon-feedback', painel: '.polygon-attributes-section',
        // O poligono fecha um anel: menos de 3 pontos nao vira feicao.
        pontosParaCriar: 6, anel: true, conclusao: { gesto: 'botao-direito', cliquesAntes: 3, evento: 'contextmenu' },
    },
    boundary: {
        controle: 'AddBoundaryControl', tipo: 'boundarys', fonte: 'boundarys',
        feedback: 'boundary-feedback', painel: '.boundary-attributes-section',
        pontosParaCriar: 4, conclusao: { gesto: 'botao-direito', cliquesAntes: 3, evento: 'contextmenu' },
    },
    arrow: {
        controle: 'AddArrowControl', tipo: 'arrows', fonte: 'arrows',
        feedback: 'arrow-feedback', painel: '.arrow-attributes-section',
        pontosParaCriar: 4, conclusao: { gesto: 'botao-direito', cliquesAntes: 3, evento: 'contextmenu' },
    },
    occupied_front: {
        controle: 'AddOccupiedFrontControl', tipo: 'occupied_fronts', fonte: 'occupied_fronts',
        feedback: 'occupied-front-feedback', painel: '.occupied-front-attributes-section',
        // A frente ocupada e de DOIS cliques: o segundo ja cria a feicao, e nao
        // ha botao direito. Concluir aqui e o clique final, nao o menu.
        pontosParaCriar: 2, conclusao: { gesto: 'clique-final', cliquesAntes: 1, evento: 'click' },
    },
    coordination_line: {
        controle: 'AddCoordinationLineControl', tipo: 'coordination_lines', fonte: 'coordination_lines',
        feedback: 'coordination-line-feedback', painel: '.coordination-line-attributes-section',
        pontosParaCriar: 4, conclusao: { gesto: 'botao-direito', cliquesAntes: 3, evento: 'contextmenu' },
    },
    los: {
        // Linha de visada. Dois cliques: o primeiro marca o observador em
        // `startPoint`, o segundo ja calcula o perfil e cria a feicao. Nao tem
        // alca de edicao nem botao direito. Sem terreno, `activate()` devolve
        // falso e `handleMapClick` sai na primeira linha.
        controle: 'AddLOSControl', tipo: 'los', fonte: 'los',
        feedback: 'los-feedback', painel: '.los-attributes-section',
        pontosParaCriar: 2, requerTerreno: true, feicoesPadrao: 15,
        pontos: { propriedade: 'startPoint', forma: 'ponto' }, semeadura: 'startEnd',
        processado: { tipo: 'processed_los', fonte: 'processed-los' },
        conclusao: { gesto: 'clique-final', cliquesAntes: 1, evento: 'click' },
    },
    visibility: {
        // Visibilidade (viewshed). Tambem de dois cliques, no estilo do setor: o
        // primeiro e o observador, o segundo da o raio e o azimute. O segundo
        // clique dispara a varredura do terreno, entao a conclusao aqui e uma
        // conta, e nao so um `addFeature`.
        controle: 'AddVisibilityControl', tipo: 'visibility', fonte: 'visibility',
        feedback: 'visibility-feedback', painel: '.visibility-attributes-section',
        pontosParaCriar: 2, requerTerreno: true, feicoesPadrao: 8,
        pontos: { propriedade: 'startPoint', forma: 'ponto' }, semeadura: 'argumentos',
        processado: { tipo: 'processed_visibility', fonte: 'processed-visibility' },
        conclusao: { gesto: 'clique-final', cliquesAntes: 1, evento: 'click' },
    },
    brush: {
        // Pincel. Desenha com o botao apertado, e o pointerup ja cria a feicao:
        // nao ha clique que vire vertice, e o traco morre com a feicao. O
        // acumulo dos pontos fica no evento BRUTO de proposito (um traco E a
        // sequencia de posicoes), e so o desenho do feedback e coalescido.
        controle: 'AddBrushControl', tipo: 'brushes', fonte: 'brushes',
        feedback: 'brush-feedback', painel: '.brush-attributes-section',
        pontosParaCriar: 8, modoDesenho: 'arrastar',
        pontos: { propriedade: 'points', forma: 'lista' }, semeadura: 'points',
        conclusao: { gesto: 'pointerup', cliquesAntes: 0, evento: 'pointerup' },
    },
};

const ORDEM_FERRAMENTAS = Object.keys(FERRAMENTAS);
const ORDEM_CENARIOS = ['desenho', 'zoom', 'conclusao'];

// Os valores que o descritor aceita. Valor fora daqui e erro na cara, e nao
// ferramenta medida pelo caminho errado em silencio.
const MODOS_DESENHO = ['clique', 'arrastar'];
const FORMAS_DE_PONTO = ['lista', 'ponto'];
const SEMEADURAS = ['drawPoints', 'points', 'startEnd', 'argumentos'];
const GESTOS_CONCLUSAO = ['botao-direito', 'clique-final', 'pointerup'];
const PONTOS_PADRAO = { propriedade: 'drawPoints', forma: 'lista' };

/** Os dois metodos pelos quais uma fonte GeoJSON recebe dado neste app. */
const METODOS_DE_ESCRITA = ['setData', 'updateData'];

/**
 * Completa o descritor com os padroes e reprova o que a bancada nao sabe medir.
 * Descritor sem `conclusao` nao diz como fechar a feicao, e `modoDesenho`
 * desconhecido mediria o gesto errado com o nome certo.
 *
 * @param {string} nome - Nome curto da ferramenta
 * @param {Object} [mapa] - Mapa de descritores (o autoteste passa os degenerados)
 * @returns {Object} O descritor completo
 */
function normalizarFerramenta(nome, mapa = FERRAMENTAS) {
    const f = mapa[nome];
    if (!f) throw new Error(`ferramenta desconhecida: ${nome}. Conhecidas: ${Object.keys(mapa).join(', ')}`);
    const cfg = {
        ...f,
        nome,
        modoDesenho: f.modoDesenho || 'clique',
        pontos: f.pontos || PONTOS_PADRAO,
        semeadura: f.semeadura || 'drawPoints',
        requerTerreno: !!f.requerTerreno,
    };
    for (const campo of ['controle', 'tipo', 'fonte', 'feedback', 'painel']) {
        if (!cfg[campo]) throw new Error(`a ferramenta ${nome} nao declara "${campo}"`);
    }
    if (!MODOS_DESENHO.includes(cfg.modoDesenho)) {
        throw new Error(`modoDesenho desconhecido em ${nome}: "${cfg.modoDesenho}". A bancada so sabe medir ${MODOS_DESENHO.join(' e ')}.`);
    }
    if (!FORMAS_DE_PONTO.includes(cfg.pontos.forma) || !cfg.pontos.propriedade) {
        throw new Error(`pontos invalidos em ${nome}: ${JSON.stringify(cfg.pontos)}. Formas: ${FORMAS_DE_PONTO.join(', ')}.`);
    }
    if (!SEMEADURAS.includes(cfg.semeadura)) {
        throw new Error(`semeadura desconhecida em ${nome}: "${cfg.semeadura}". Conhecidas: ${SEMEADURAS.join(', ')}.`);
    }
    const c = cfg.conclusao;
    if (!c || !c.gesto || !c.evento) {
        throw new Error(`a ferramenta ${nome} nao diz como conclui: falta conclusao: { gesto, cliquesAntes, evento }`);
    }
    if (!GESTOS_CONCLUSAO.includes(c.gesto)) {
        throw new Error(`gesto de conclusao desconhecido em ${nome}: "${c.gesto}". Conhecidos: ${GESTOS_CONCLUSAO.join(', ')}.`);
    }
    if (!Number.isInteger(c.cliquesAntes) || c.cliquesAntes < 0) {
        throw new Error(`cliquesAntes invalido em ${nome}: ${c.cliquesAntes}`);
    }
    return cfg;
}

// Vista de trabalho. A mesma da bancada de terreno.
const VISTA = { center: [-50.87, -29.37], zoom: 12.5 };

// Pontos de clique no viewport de 1600x900, sobre o mapa e fora dos paineis.
const CLIQUES = [[500, 450], [800, 400], [1100, 520]];
// Onde o botao direito cai, deslocado do ultimo clique para nao cair no vertice.
const DESLOCAMENTO_CONCLUSAO = [40, 30];

// Quanto tempo a dupla (camadas, fontes) precisa ficar parada.
const MS_ESTAVEL = 3000;

// Duracao do laco de mouse sintetico, em ms.
const MS_DESENHO = 3000;

// --------------------------------------------------------------------------
// Linha de comando
// --------------------------------------------------------------------------
function lerArgumentos(argv) {
    const p = {
        // O stack de desenvolvimento sobe pela raiz com `npm run dev`: backend na
        // 8080 e Vite na 3000. O `base` do Vite esta comentado, entao a pagina do
        // mapa e a raiz do servidor.
        url: process.env.EBGEO_URL || 'http://localhost:3000/',
        ferramenta: 'coordination_line',
        k: [1, 4, 8],
        feicoes: 30,
        terreno: false,
        cpu: 1,
        snapping: false,
        rodadas: 2,
        saida: null,
        largura: 1600,
        altura: 900,
        headless: false,
        proxy: 'ambiente',
    };
    let informouFeicoes = false;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const proximo = () => argv[++i];
        // Bandeira booleana aceita "--x", "--x true" e "--x false".
        const booleana = () => {
            const v = argv[i + 1];
            if (v === 'true' || v === 'false') { i++; return v === 'true'; }
            return true;
        };
        if (a === '--url') {
            p.url = proximo();
        } else if (a === '--ferramenta') {
            p.ferramenta = proximo();
        } else if (a === '--k') {
            p.k = proximo().split(',').map((s) => s.trim()).filter(Boolean).map(Number);
        } else if (a === '--feicoes') {
            p.feicoes = Number(proximo());
            informouFeicoes = true;
        } else if (a === '--terreno') {
            p.terreno = booleana();
        } else if (a === '--cpu') {
            p.cpu = Number(proximo());
        } else if (a === '--snapping') {
            p.snapping = booleana();
        } else if (a === '--rodadas') {
            p.rodadas = Number(proximo());
        } else if (a === '--saida') {
            p.saida = proximo();
        } else if (a === '--largura') {
            p.largura = Number(proximo());
        } else if (a === '--altura') {
            p.altura = Number(proximo());
        } else if (a === '--headless') {
            p.headless = booleana();
        } else if (a === '--proxy') {
            p.proxy = proximo();
            if (!MODOS_DE_PROXY.includes(p.proxy)) throw new Error(`--proxy desconhecido: ${p.proxy} (aceita ${MODOS_DE_PROXY.join(', ')})`);
        } else if (a === '--ajuda' || a === '-h' || a === '--help') {
            p.ajuda = true;
        } else {
            throw new Error(`argumento desconhecido: ${a}`);
        }
    }
    // Reprova aqui o descritor incompleto: melhor cair na leitura do argumento
    // do que a 90 segundos de carga, com o app ja no ar.
    const cfg = normalizarFerramenta(p.ferramenta);
    // A feicao da LOS e da visibilidade custa uma varredura do terreno, entao a
    // ferramenta pode pedir menos que as 30 do padrao. Pedido explicito manda.
    if (!informouFeicoes && cfg.feicoesPadrao) p.feicoes = cfg.feicoesPadrao;
    if (!p.k.length) throw new Error('--k precisa de ao menos um valor (mousemove por quadro)');
    for (const k of p.k) {
        if (!Number.isInteger(k) || k < 1) throw new Error(`--k tem de ser lista de inteiros >= 1, veio "${k}"`);
    }
    if (new Set(p.k).size !== p.k.length) throw new Error(`--k repete um valor: ${p.k.join(',')}`);
    p.k = p.k.slice().sort((a, b) => a - b);
    if (!Number.isInteger(p.feicoes) || p.feicoes < 1) throw new Error('--feicoes tem de ser inteiro >= 1: zoom sem feicao nao mede a ferramenta');
    if (!Number.isFinite(p.rodadas) || p.rodadas < 1) throw new Error('--rodadas tem de ser inteiro >= 1');
    if (!Number.isFinite(p.cpu) || p.cpu < 1) throw new Error('--cpu tem de ser numero >= 1');
    if (!p.saida) {
        const carimbo = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        p.saida = path.join(AQUI, 'saida', carimbo);
    }
    p.saida = path.resolve(p.saida);
    return p;
}

const AJUDA = `
Bancada de desempenho das ferramentas de desenho do EBGeo Web.

  node frontend/bench/ferramentas.mjs [opcoes]

  --url <url>          padrao http://localhost:3000/ (ou EBGEO_URL). O stack de
                       desenvolvimento sobe pela raiz com "npm run dev".
  --ferramenta <nome>  padrao coordination_line
                       ${ORDEM_FERRAMENTAS.join(', ')}
  --k <lista>          mousemove por quadro no cenario desenho (padrao 1,4,8)
  --feicoes <n>        feicoes criadas antes do cenario zoom (padrao 30; a
                       ferramenta pode pedir menos: los 15, visibility 8)
  --terreno [bool]     padrao false. Liga o terreno pelo botao do app antes de medir.
                       OBRIGATORIO em los e visibility: sem terreno elas nem ativam.
  --cpu <fator>        padrao 1. Estrangula a CPU pelo CDP (4 = maquina quatro vezes mais lenta).
  --snapping [bool]    padrao false. Liga ui.snapping.enabled antes de medir.
  --rodadas <n>        padrao 2 (a primeira e aquecimento e sai da tabela)
  --saida <pasta>      padrao frontend/bench/saida/<data-hora>/
  --largura <px>       padrao 1600
  --altura <px>        padrao 900
  --headless [bool]    padrao false (headless usa SwiftShader: o relogio nao vale)
  --proxy <modo>       padrao ambiente: HTTPS_PROXY/HTTP_PROXY com usuario:senha na URL entram
                       no Chromium sem dialogo; sem credencial cai para sem-proxy. Outros modos:
                       sem-proxy (--no-proxy-server) e sistema (o proxy como estiver).

O Playwright vem do proprio pacote frontend/ (dependencia declarada). A variavel
EBGEO_PLAYWRIGHT_DIR sobrepoe, apontando o diretorio que CONTEM node_modules/playwright.
`;

// --------------------------------------------------------------------------
// Playwright: dependencia do proprio pacote `frontend/`. Nenhum caminho de
// maquina vive no codigo.
// --------------------------------------------------------------------------
async function carregarPlaywright() {
    const candidatos = [];
    if (process.env.EBGEO_PLAYWRIGHT_DIR) candidatos.push({ base: process.env.EBGEO_PLAYWRIGHT_DIR, origem: 'EBGEO_PLAYWRIGHT_DIR' });
    candidatos.push({ base: PACOTE, origem: 'node_modules do pacote frontend' });
    candidatos.push({ base: RAIZ, origem: 'node_modules da raiz do monorepo' });
    candidatos.push({ base: AQUI, origem: 'node_modules de bench/' });
    const tentados = [];
    for (const { base, origem } of candidatos) {
        for (const arquivo of ['index.mjs', 'index.js']) {
            const alvo = path.join(base, 'node_modules', 'playwright', arquivo);
            tentados.push(`${origem}: ${alvo}`);
            if (fs.existsSync(alvo)) {
                const mod = await import(pathToFileURL(alvo).href);
                const versao = lerVersaoPlaywright(path.join(base, 'node_modules', 'playwright', 'package.json'));
                return { chromium: mod.chromium || (mod.default && mod.default.chromium), origem, caminho: alvo, versao };
            }
        }
    }
    throw new Error(
        'Playwright nao encontrado. Rode `npm install --prefix frontend` (ele e dependencia do pacote),\n'
        + 'ou defina EBGEO_PLAYWRIGHT_DIR com o diretorio que contem node_modules/playwright.\n'
        + `Tentados:\n  ${tentados.join('\n  ')}`,
    );
}

function lerVersaoPlaywright(pacote) {
    try { return JSON.parse(fs.readFileSync(pacote, 'utf8')).version; } catch { return '?'; }
}

// --------------------------------------------------------------------------
// Utilidades do lado do Node
// --------------------------------------------------------------------------
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

function percentil(ordenado, p) {
    if (!ordenado.length) return 0;
    return ordenado[Math.min(ordenado.length - 1, Math.floor(p * ordenado.length))];
}

function mediana(valores) {
    if (!valores.length) return null;
    const o = valores.slice().sort((a, b) => a - b);
    const m = Math.floor(o.length / 2);
    return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

const arred = (v, casas = 1) => (v === null || v === undefined || Number.isNaN(v) ? null : +Number(v).toFixed(casas));

// Estatistica de um lote vindo da pagina: quadros, intervalos, latencia do
// feedback, contadores de consulta e de projecao.
function estatistica(B) {
    const quadros = (B && B.quadros) || [];
    const base = {
        quadros: quadros.length,
        query: (B && B.query) || 0,
        proj: (B && B.proj) || 0,
        mousemove: (B && B.mousemove) || 0,
        // Escrita de feedback que a seguinte substituiu antes de a fonte
        // assentar: preview que nunca chegou a tela. E o par obrigatorio da
        // latencia, senao a mediana descreve so os quadros que deram certo.
        feedbackSuperados: (B && B.superadas) || 0,
    };
    if (!quadros.length) return { ...base, lentos: 0 };
    const dts = quadros.map((f) => f.dt).sort((a, b) => a - b);
    const intervalos = [];
    for (let i = 1; i < quadros.length; i++) intervalos.push(quadros[i].t - quadros[i - 1].t);
    intervalos.sort((a, b) => a - b);
    const lat = ((B && B.latencias) || []).slice().sort((a, b) => a - b);
    return {
        ...base,
        render_ms: { p50: arred(percentil(dts, 0.5)), p95: arred(percentil(dts, 0.95)), max: arred(percentil(dts, 1)) },
        intervalo_ms: { p50: arred(percentil(intervalos, 0.5)), p95: arred(percentil(intervalos, 0.95)), max: arred(percentil(intervalos, 1)) },
        // Quadro que passou de 33 ms de intervalo: o usuario sente como engasgo.
        lentos: intervalos.filter((x) => x > 33).length,
        latencia_ms: lat.length
            ? { p50: arred(percentil(lat, 0.5)), p95: arred(percentil(lat, 0.95)), max: arred(percentil(lat, 1)), amostras: lat.length }
            : null,
    };
}

/**
 * Resume as escritas por fonte num par (alvo, resto), separando os DOIS metodos.
 *
 * Por que os dois: nesta branch a fonte principal e migrada para o despachante
 * de diff, que escreve por `updateData`; so as fontes de apoio (`-feedback`,
 * `-edit-handles`) levam `setData` cru. Somar os dois numa coluna so esconderia
 * qual caminho a ferramenta usou; contar so `setData` diria ZERO no `zoom` de
 * toda ferramenta migrada, o que reprovaria o app bom pelo defeito do
 * instrumento.
 *
 * @param {Object} escritas - `{ [fonte]: { setData, updateData, feicoes } }`
 * @param {string} alvo - A fonte que o cenario existe para exercitar
 * @returns {Object} O resumo, com o alvo separado do resto
 */
function resumirEscritas(escritas, alvo) {
    const entradas = Object.entries(escritas || {});
    const zero = () => ({ setData: 0, updateData: 0, feicoes: 0 });
    const soma = { alvo: zero(), outras: zero() };
    for (const [id, v] of entradas) {
        const onde = id === alvo ? soma.alvo : soma.outras;
        for (const m of METODOS_DE_ESCRITA) onde[m] += (v && v[m]) || 0;
        onde.feicoes += (v && v.feicoes) || 0;
    }
    const totalDe = (o) => o.setData + o.updateData;
    return {
        setDataAlvo: soma.alvo.setData,
        updateDataAlvo: soma.alvo.updateData,
        escritasAlvo: totalDe(soma.alvo),
        feicoesAlvo: soma.alvo.feicoes,
        setDataOutras: soma.outras.setData,
        updateDataOutras: soma.outras.updateData,
        escritasOutras: totalDe(soma.outras),
        porFonte: Object.fromEntries(entradas
            .sort((a, b) => (totalDe({ setData: b[1].setData || 0, updateData: b[1].updateData || 0 })
                - totalDe({ setData: a[1].setData || 0, updateData: a[1].updateData || 0 })))
            .map(([k, v]) => [k, `${v.setData || 0}s/${v.updateData || 0}u/${v.feicoes || 0}f`])),
    };
}

// Veredito da cadencia ociosa do rAF. Com a CPU estrangulada de proposito o
// ocioso lento E a condicao medida, e vira aviso em vez de derrubar a rodada.
function avaliarCadencia(cadencia, cpu) {
    if (!cadencia || cadencia.p95 === null || cadencia.p95 === undefined) {
        return { erro: 'cadencia ociosa do rAF nao foi medida', aviso: null };
    }
    if (cadencia.p95 <= 25) return { erro: null, aviso: null };
    const texto = `cadencia ociosa do rAF p95 ${cadencia.p95} ms acima de 25`;
    if (cpu > 1) return { erro: null, aviso: `${texto} com CPU ${cpu}x` };
    return { erro: texto, aviso: null };
}

/**
 * O modulo que a bancada importou tem de ser o MESMO que o app usa.
 *
 * Ver o comentario gemeo em `desempenho-terreno.mjs`: o `?t=` do HMR do Vite
 * entrega outra instancia do modulo, e ai o registro de controles esta vazio, o
 * `ensureControl` recusa por falta de dependencias e a bancada mede uma copia do
 * sujeito com o nome do sujeito.
 *
 * @param {Object} s - Leitura da sonda de prontidao
 * @returns {string[]} Motivos de reprova
 */
function avaliarIdentidade(s) {
    const erros = [];
    if (!s) return ['nao houve leitura de identidade'];
    if (!s.mapaGlobalPresente) erros.push('globalThis.__ebgeoMap ausente: a pagina nao e a do mapa, ou o boot parou antes de map_sig.js');
    if (!s.registroPresente) erros.push('getControl("MapManager") nao devolveu mapa: o modulo do store que a bancada importou nao e o do app');
    if (s.mapaGlobalPresente && s.registroPresente && !s.mesmoMapa) {
        erros.push('o mapa do registro e o globalThis.__ebgeoMap sao objetos DIFERENTES: a bancada importou outra copia do modulo (o ?t= do HMR do Vite). Rode com a arvore parada.');
    }
    // O MAPA SOZINHO NAO PROVA IDENTIDADE. Medido em 2026-09-04: o estado do
    // registro de controles mora em `store/control.registry.js`, que o HMR nao
    // tinha invalidado, entao as duas copias de `store/index.js` reexportavam o
    // MESMO registro e o mapa batia; o `tool-registry.js`, que guarda as
    // dependencias e as instancias, tinha sido invalidado, e a copia da bancada
    // lancava "tool-registry usado antes de initToolRegistry()". A identidade se
    // prova no modulo que guarda o ESTADO que se vai usar, um por um.
    if (!s.registroCarregado) {
        erros.push('a bancada nao importou o registro de ferramentas do app (tool_manager/tool-registry.js)');
    } else if (!s.registroSemeadas) {
        erros.push('o modulo importado nao parece o tool-registry do app: sem FERRAMENTAS ou sem peekControl');
    } else if (!s.registroSemeadas.total) {
        erros.push('a tabela de ferramentas do app nao declara nenhuma ferramenta ansiosa: a bancada nao tem como provar que importou o registro do app');
    } else if (!s.registroSemeadas.vivas) {
        erros.push(`nenhuma das ${s.registroSemeadas.total} ferramentas ansiosas esta viva no registro que a bancada importou: `
            + 'e OUTRA COPIA do modulo (o ?t= do HMR do Vite). A bancada importa pela URL que o app carregou, entao este erro '
            + 'significa que a URL nao foi achada no Resource Timing.');
    }
    return erros;
}

/**
 * O app esta INTEIRO? O criterio e a lista de fontes que o proprio app declara
 * (`FEATURE_SOURCES`), e nao um numero de camadas escrito a mao.
 *
 * @param {Object} s - Leitura da sonda de prontidao
 * @param {number} estavelMs - Ha quanto tempo a dupla (camadas, fontes) nao muda
 * @param {number} [minimoMs] - Piso de estabilidade
 * @returns {{pronto: boolean, motivos: string[]}}
 */
function avaliarProntidao(s, estavelMs, minimoMs = MS_ESTAVEL) {
    if (!s) return { pronto: false, motivos: ['o app ainda nao expoe o mapa'] };
    const motivos = [];
    if (!s.fontesExigidas) {
        motivos.push('a bancada nao leu FEATURE_SOURCES do app: sem elas o criterio de "app inteiro" nao existe');
    } else if (s.fontesAusentes && s.fontesAusentes.length) {
        motivos.push(`${s.fontesAusentes.length} de ${s.fontesExigidas} fontes do app ainda nao existem`
            + ` (ex.: ${s.fontesAusentes.slice(0, 3).join(', ')})`);
    }
    if (!s.carregado) motivos.push('map.loaded() falso');
    if (!(estavelMs >= minimoMs)) motivos.push(`a dupla (camadas, fontes) so ficou parada por ${estavelMs} ms, e o minimo e ${minimoMs}`);
    motivos.push(...avaliarIdentidade(s));
    return { pronto: motivos.length === 0, motivos };
}

// --------------------------------------------------------------------------
// Reguas dos cenarios. Puras: recebem a prova e a estatistica, devolvem a lista
// de motivos de reprova. Sao elas que o autoteste ataca com o pior caso.
// --------------------------------------------------------------------------

// Ferramenta que declara `requerTerreno` mede outra coisa sem ele: a LOS e a
// visibilidade nem ativam, e o cenario sairia com numero bonito de uma
// ferramenta parada. Vale para os tres cenarios, entao mora num lugar so.
function errosDeTerreno(prova) {
    if (!prova || !prova.requerTerreno || prova.terreno) return [];
    return ['a ferramenta exige terreno e getTerrain() esta nulo: rode com --terreno (sem terreno ela nem ativa)'];
}

// O controle que o registro devolve pode ser o STAND-IN da carga tardia: um
// objeto com `getSourceNames`, `getEditHandleSource` e mais nada. Ele nao
// desenha, nao ativa e nao cria feicao, e o cenario mediria uma ferramenta que
// nunca chegou. Vale para os tres cenarios.
function errosDeControle(prova) {
    if (!prova) return [];
    if (prova.controlePresente === false) return ['o app nao expoe o controle da ferramenta'];
    if (prova.ehStandIn) {
        return ['o registro ainda devolve o STAND-IN da ferramenta (carga tardia nao concluida): '
            + 'a bancada mediria um objeto que nao desenha. Ver tool_manager/tool-registry.js, ensureControl().'];
    }
    return [];
}

const CENARIOS = {
    desenho: {
        rotulo: 'ferramenta ativa com 1 ponto, mouse sintetico por 3 s',
        validar: (prova, est) => {
            const erros = [...errosDeTerreno(prova), ...errosDeControle(prova)];
            if (!est || !est.quadros) erros.push('zero quadros medidos');
            if (!prova.escritasAlvo) {
                erros.push(`nenhuma escrita (setData nem updateData) da fonte de feedback "${prova.fonteAlvo}" durante o desenho: a ferramenta nao desenhou`);
            }
            const modo = prova.modoDesenho || 'clique';
            if (!MODOS_DESENHO.includes(modo)) {
                erros.push(`modoDesenho "${modo}" desconhecido: a bancada so sabe medir ${MODOS_DESENHO.join(' e ')}`);
            } else if (modo === 'arrastar') {
                // O traco E a sequencia de posicoes: o pincel acumula no evento
                // bruto de proposito. Ponto a menos aqui e ponto que a ferramenta
                // (ou a bancada) jogou fora, e a curva sai serrilhada.
                const esperado = prova.eventosDeMovimento === null || prova.eventosDeMovimento === undefined
                    ? null : prova.eventosDeMovimento + 1;
                if (prova.pontosAcumulados === null || prova.pontosAcumulados === undefined) {
                    erros.push('nao deu para ler os pontos acumulados do traco antes do pointerup');
                } else if (esperado === null) {
                    erros.push('a bancada nao contou os eventos de movimento do arrasto');
                } else if (prova.pontosAcumulados !== esperado) {
                    erros.push(`${prova.pontosAcumulados} pontos acumulados para ${prova.eventosDeMovimento} eventos de movimento`
                        + ` (esperado ${esperado}: o do pointerdown mais um por evento)`);
                }
            } else if (prova.pontosColocados !== 1) {
                erros.push(`pontos colocados ${prova.pontosColocados}, esperado 1 por clique real`);
            }
            if (!prova.ferramentaAtiva) erros.push('a ferramenta nao ficou ativa (isActive falso)');
            if (prova.visibilidade !== 'visible') erros.push(`visibilityState ${prova.visibilidade}`);
            return erros;
        },
    },
    zoom: {
        rotulo: 'gesto de zoom +1 e volta, com N feicoes criadas',
        validar: (prova, est, alvo) => {
            const erros = [...errosDeTerreno(prova), ...errosDeControle(prova)];
            if (!est || !est.quadros) erros.push('zero quadros medidos');
            const n = alvo && alvo.feicoes;
            // O cenario desenho do pincel conclui a feicao no pointerup, entao o
            // store ja pode ter feicao antes deste cenario. O alvo e o que estava
            // la MAIS as criadas, e nao um numero absoluto que aprovaria a soma
            // errada nas duas direcoes.
            const base = prova.noStoreAntesDeCriar || 0;
            const esperado = n ? n + base : null;
            const comoSoma = base ? ` (${base} antes do cenario + ${n} criadas)` : '';
            if (!prova.naFonte) {
                erros.push(`a fonte "${prova.fonteAlvo}" esta vazia: zoom sem feicao nao mede a ferramenta`);
            } else if (esperado && prova.naFonte < esperado) {
                erros.push(`${prova.naFonte} feicoes na fonte "${prova.fonteAlvo}", esperadas ${esperado}${comoSoma}: o mapa nao mostra o que o store guarda`);
            }
            if (esperado && prova.noStore !== esperado) {
                erros.push(`${prova.noStore} feicoes no store (${prova.tipo}), esperadas ${esperado}${comoSoma}`);
            }
            if (prova.visibilidade !== 'visible') erros.push(`visibilityState ${prova.visibilidade}`);
            return erros;
        },
    },
    conclusao: {
        rotulo: 'concluir a feicao pelo caminho do usuario',
        validar: (prova) => {
            const erros = [...errosDeTerreno(prova), ...errosDeControle(prova)];
            if (prova.gesto === 'pointerup' && !(prova.pontosDoTraco >= 2)) {
                erros.push(`o traco tinha ${prova.pontosDoTraco} pontos antes do pointerup: menos de 2 nao vira feicao`);
            }
            if (prova.noStoreAntes === null || prova.noStore === null) {
                erros.push('nao deu para ler o store antes e depois da conclusao');
            } else if (prova.noStore <= prova.noStoreAntes) {
                erros.push(`a contagem do store nao subiu (${prova.noStoreAntes} -> ${prova.noStore}): a feicao nao foi concluida`);
            }
            if (prova.msStore === null || prova.msStore === undefined) {
                erros.push('o store nao registrou a feicao dentro do limite de espera');
            }
            // A feicao no store nao e o que o usuario ve: a analise so vira tela
            // quando o trecho visivel e o obstruido entram na fonte processada.
            if (prova.processadoDeclarado) {
                if (prova.msProcessado === null || prova.msProcessado === undefined) {
                    erros.push('a ferramenta declara resultado processado e ele nao apareceu na fonte dentro do limite');
                }
                if (!(prova.naFonteProcessada > (prova.naFonteProcessadaAntes || 0))) {
                    erros.push(`a fonte processada nao cresceu (${prova.naFonteProcessadaAntes} -> ${prova.naFonteProcessada}): a analise nao chegou a tela`);
                }
            }
            // A feicao concluida tem de ter chegado a FONTE do mapa, e nao so ao
            // store: nesta branch quem leva o store ate a fonte e o despachante de
            // diff (`updateData`), e um despachante parado deixaria a feicao
            // invisivel com o store certo.
            if (!prova.escritasAlvo) {
                erros.push(`nenhuma escrita da fonte "${prova.fonteAlvo}" no gesto de conclusao: a feicao entrou no store e nao chegou ao mapa`);
            }
            if (prova.cliquesQuePegaram !== prova.cliquesPedidos) {
                erros.push(`${prova.cliquesQuePegaram} de ${prova.cliquesPedidos} cliques viraram vertice: o desenho nao chegou inteiro ao gesto de conclusao`);
            }
            if (prova.visibilidade !== 'visible') erros.push(`visibilityState ${prova.visibilidade}`);
            return erros;
        },
    },
};

// --------------------------------------------------------------------------
// Codigo que roda dentro da pagina.
//
// Toda funcao daqui vai para o navegador por `fn.toString()`, entao nenhuma
// delas pode fechar sobre identificador do escopo do modulo.
// --------------------------------------------------------------------------

/**
 * Importa os modulos do app pela URL que o PROPRIO app carregou. Gemea da de
 * `desempenho-terreno.mjs`, e as duas andam juntas: no `vite dev` um modulo
 * tocado desde que o servidor subiu passa a ser servido com `?t=<epoch>` de HMR,
 * e um `import('/src/js/...')` sem a marca recebe OUTRA INSTANCIA. Medido nesta
 * arvore em 2026-09-04: `ensureControl` da copia nua lancava "tool-registry
 * usado antes de initToolRegistry()".
 *
 * O buffer do Resource Timing e aumentado num init script ANTES da pagina; o
 * padrao de 250 entradas nao cabe nos modulos do app em dev.
 *
 * @returns {Promise<Object>} As URLs escolhidas, para o registro da rodada
 */
async function carregarModulosDoApp() {
    const nomes = performance.getEntriesByType('resource').map((e) => e.name);
    const achar = (caminho) => {
        const iguais = nomes.filter((n) => n.split('?')[0].endsWith(caminho));
        // A PRIMEIRA e a do app; uma importada depois pela propria bancada viria
        // no fim da lista.
        return iguais.length ? iguais[0] : caminho;
    };
    const urls = {
        store: achar('/src/js/store/index.js'),
        registro: achar('/src/js/tool_manager/tool-registry.js'),
        constantes: achar('/src/js/layers/layer.constants.js'),
    };
    window.__urlsDoApp = urls;
    window.__store = await import(urls.store);
    window.__registro = await import(urls.registro);
    const lc = await import(urls.constantes);
    window.__fontesDoApp = Object.values(lc.FEATURE_SOURCES || {});
    return urls;
}

// Espera o app: modulo do store, mapa, fontes do app. Devolve null enquanto nao
// ha mapa. O laco fica do lado do Node de proposito: page.waitForFunction com
// predicado async resolve na hora, porque a Promise ja e um valor verdadeiro.
function sondaProntidao() {
    const store = window.__store;
    const mm = store && store.getControl && store.getControl('MapManager');
    const doRegistro = mm && mm.map;
    const map = doRegistro || window.__ebgeoMap;
    if (!map || !map.getStyle) return null;
    const estilo = map.getStyle();
    window.__mapa = map;
    const exigidas = window.__fontesDoApp || [];
    const ausentes = exigidas.filter((id) => !map.getSource(id));
    // A prova de que o tool-registry importado e o do app: as ferramentas
    // ANSIOSAS sao semeadas nele por `map_sig.js` (`seedControl`), e uma copia
    // recem-nascida do modulo nao tem nenhuma. A lista sai da tabela do proprio
    // app, e nao de um nome escrito aqui.
    const reg = window.__registro;
    let registroSemeadas = null;
    if (reg && reg.FERRAMENTAS && typeof reg.peekControl === 'function') {
        const ansiosas = Object.keys(reg.FERRAMENTAS).filter((k) => reg.FERRAMENTAS[k] && reg.FERRAMENTAS[k].ansiosa);
        registroSemeadas = { total: ansiosas.length, vivas: ansiosas.filter((k) => !!reg.peekControl(k)).length };
    }
    return {
        camadas: estilo.layers.length,
        fontes: Object.keys(estilo.sources).length,
        carregado: !!map.loaded(),
        fontesExigidas: exigidas.length,
        fontesAusentes: ausentes,
        mapaGlobalPresente: !!window.__ebgeoMap,
        registroPresente: !!doRegistro,
        mesmoMapa: !!(doRegistro && window.__ebgeoMap && doRegistro === window.__ebgeoMap),
        registroCarregado: !!reg,
        registroSemeadas,
        urlsDoApp: window.__urlsDoApp || null,
    };
}

// Instala o registro por quadro, o contador de escritas por fonte GeoJSON
// (setData E updateData), os contadores de queryRenderedFeatures e map.project,
// e a latencia do feedback.
function instrumentar(cfg) {
    const map = window.__mapa;
    const B = { quadros: [], escritas: {}, query: 0, proj: 0, latencias: [], pendente: null, superadas: 0, mousemove: 0 };
    window.__B = B;
    window.__cfg = cfg;

    // `isSourceLoaded` de fonte inexistente DISPARA um evento de erro no mapa
    // (nao lanca), o que sujaria os erros da pagina. Pergunta-se antes.
    const fonteCarregada = (id) => {
        try { return !!(map.getSource(id) && map.isSourceLoaded(id)); } catch (_e) { return false; }
    };

    const originalRender = map._render.bind(map);
    map._render = function (...a) {
        const t = performance.now();
        const r = originalRender(...a);
        B.quadros.push({ t, dt: performance.now() - t });
        // Latencia do feedback: da escrita ate o primeiro quadro em que a fonte
        // do feedback esta carregada. E o atraso do traco atras do mouse.
        //
        // So a escrita MAIS RECENTE conta. A anterior que outra substituiu antes
        // de assentar nunca chegou a tela, e cronometra-la ate o proximo quadro
        // bom empilharia o atraso de todas no mesmo instante: uma fila de 160
        // pendentes drenada de uma vez sairia como 160 medidas iguais. Vai para
        // `superadas`, que diz quanto do trabalho o usuario nunca viu.
        if (B.pendente !== null && fonteCarregada(cfg.feedback)) {
            B.latencias.push(performance.now() - B.pendente);
            B.pendente = null;
        }
        return r;
    };

    // Escritas por fonte GeoJSON, nos DOIS metodos. `setData` troca a colecao
    // inteira; `updateData` recebe o diff que o despachante montou
    // (`{ add?, update?, remove? }`), e e por ele que as dezesseis fontes
    // migradas recebem dado nesta branch. O envolvimento e por OBJETO de fonte,
    // entao fonte que nasce depois (terreno, troca de estilo) precisa de nova volta.
    const envolver = () => {
        const estilo = map.getStyle();
        let n = 0;
        for (const id in estilo.sources) {
            if (estilo.sources[id].type !== 'geojson') continue;
            const src = map.getSource(id);
            if (!src || src.__envolvida) continue;
            const marcar = (metodo, contar) => {
                if (typeof src[metodo] !== 'function') return;
                const original = src[metodo].bind(src);
                src[metodo] = function (d) {
                    if (!B.escritas[id]) B.escritas[id] = { setData: 0, updateData: 0, feicoes: 0 };
                    B.escritas[id][metodo]++;
                    B.escritas[id].feicoes += contar(d);
                    if (id === cfg.feedback) {
                        if (B.pendente !== null) B.superadas++;
                        B.pendente = performance.now();
                    }
                    return original(d);
                };
            };
            marcar('setData', (d) => (d && Array.isArray(d.features) ? d.features.length : (d ? 1 : 0)));
            marcar('updateData', (d) => (d
                ? ((d.add ? d.add.length : 0) + (d.update ? d.update.length : 0) + (d.remove ? d.remove.length : 0))
                : 0));
            src.__envolvida = true;
            n++;
        }
        return n;
    };
    const envolvidas = envolver();
    window.__envolver = envolver;

    const qr = map.queryRenderedFeatures.bind(map);
    map.queryRenderedFeatures = function (...a) { B.query++; return qr(...a); };
    const pj = map.project.bind(map);
    map.project = function (...a) { B.proj++; return pj(...a); };

    // Renderer real. SwiftShader ou llvmpipe significa GPU emulada.
    let renderer = 'desconhecido';
    let fornecedor = 'desconhecido';
    try {
        const gl = map.painter.context.gl;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'ext ausente';
        fornecedor = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : 'ext ausente';
    } catch (e) { renderer = `erro: ${String(e).slice(0, 80)}`; }

    window.__zerar = () => {
        B.quadros = []; B.escritas = {}; B.query = 0; B.proj = 0;
        B.latencias = []; B.pendente = null; B.superadas = 0; B.mousemove = 0;
    };
    return { envolvidas, renderer, fornecedor };
}

// Estado dos tiles de cada fonte, para decidir se o mapa assentou.
// `getIds()` devolve CHAVE, e no MapLibre 5.18 quem aceita chave e
// `getTileByID`; `getTile` espera um tileID.
function lerAssentamento() {
    const map = window.__mapa;
    const tm = map.style.tileManagers || map.style.sourceCaches || {};
    const estados = {};
    let tiles = 0;
    let desconhecidos = 0;
    for (const id in tm) {
        const cache = tm[id];
        const ids = cache.getIds ? cache.getIds() : [];
        estados[id] = ids.map((k) => {
            const t = cache.getTileByID ? cache.getTileByID(k)
                : (cache.getTile ? cache.getTile(k) : (cache._tiles && cache._tiles[k]));
            tiles++;
            const estado = t && t.state ? t.state : '?';
            if (estado === '?') desconhecidos++;
            return estado;
        }).join(',');
    }
    return { carregado: !!map.loaded(), assinatura: JSON.stringify(estados), tiles, desconhecidos };
}

/**
 * A leitura do estado dos tiles enxergou alguma coisa? Ver o gemeo em
 * `desempenho-terreno.mjs`: leitor cego faz "tiles estaveis" virar verdade
 * trivial e a medida sai do mapa no meio da carga.
 *
 * @param {Object} resumo - `{ tiles, desconhecidos }`
 * @returns {string[]} Motivos de reprova
 */
function validarLeituraDeTiles(resumo) {
    if (!resumo) return ['nao houve leitura do estado dos tiles'];
    if (!resumo.tiles) return [];
    if (resumo.desconhecidos === resumo.tiles) {
        return [`a leitura do estado dos tiles achou ${resumo.tiles} tiles e nao soube o estado de NENHUM: `
            + 'o leitor nao casa com a API desta versao do MapLibre, e "tiles estaveis" viraria verdade trivial'];
    }
    return [];
}

// Resolve a ferramenta pela tabela do PROPRIO app e espera a carga tardia. Sem
// isto, `getControl(classe)` devolve o stand-in e a bancada mede um objeto que
// nao desenha.
async function prepararFerramentaPagina(cfg) {
    const registro = window.__registro;
    const tabela = (registro && registro.FERRAMENTAS) || {};
    const chave = Object.keys(tabela).find((k) => tabela[k].classe === cfg.controle) || null;
    if (!chave) {
        return { ok: false, chave: null, ehStandIn: false, erro: `o controle ${cfg.controle} nao esta na tabela de ferramentas do app (tool_manager/tool-registry.js)` };
    }
    if (typeof registro.ensureControl !== 'function') {
        return { ok: false, chave, ehStandIn: false, erro: 'o modulo tool-registry do app nao expoe ensureControl' };
    }
    try {
        const c = await registro.ensureControl(chave);
        const ehStandIn = !!(c && c.ehStandInDeFerramenta);
        return { ok: !!c && !ehStandIn, chave, ehStandIn, erro: c ? null : 'ensureControl devolveu nada' };
    } catch (e) {
        return { ok: false, chave, ehStandIn: false, erro: String(e && e.message ? e.message : e).slice(0, 160) };
    }
}

// Estado da ferramenta e do mapa. E a materia-prima da prova de cada cenario.
async function lerEstado(cfg) {
    const map = window.__mapa;
    const c = window.__store.getControl(cfg.controle);
    // Conta o que a fonte do MAPA mostra. No MapLibre 5.18 vendorizado o `_data`
    // da fonte GeoJSON E um envelope (`{ updateable | url | geojson }`), e
    // `serialize().data` e o unico que devolve a colecao: ler `_data` direto
    // contaria toda fonte como vazia.
    const contar = (id) => {
        const src = map.getSource(id);
        if (!src) return null;
        const d = typeof src.serialize === 'function' ? src.serialize().data : src._data;
        if (typeof d === 'string') return null;
        return d && Array.isArray(d.features) ? d.features.length : (d && d.type === 'Feature' ? 1 : 0);
    };
    let noStore = null;
    let noStoreProcessado = null;
    let erroStore = null;
    try {
        const f = await window.__store.getCurrentMapFeatures();
        noStore = Array.isArray(f && f[cfg.tipo]) ? f[cfg.tipo].length : null;
        if (cfg.processado) {
            noStoreProcessado = Array.isArray(f && f[cfg.processado.tipo]) ? f[cfg.processado.tipo].length : null;
        }
    } catch (e) { erroStore = String(e && e.message ? e.message : e).slice(0, 120); }
    let snapping = null;
    try { snapping = !!window.__store.getStateManager().getUnsafe('ui.snapping.enabled'); } catch (_e) { snapping = null; }
    const estilo = map.getStyle();
    // Pontos que o usuario ja colocou. Nao ha propriedade unica no app: a
    // maioria acumula em `drawPoints`, o pincel em `points`, e a LOS e a
    // visibilidade guardam so o observador em `startPoint`.
    const p = cfg.pontos || { propriedade: 'drawPoints', forma: 'lista' };
    const bruto = c ? c[p.propriedade] : undefined;
    const pontosColocados = !c ? null
        : (p.forma === 'ponto' ? (bruto ? 1 : 0) : (Array.isArray(bruto) ? bruto.length : null));
    return {
        controlePresente: !!c,
        // O registro devolve um stand-in enquanto a carga tardia nao termina.
        ehStandIn: !!(c && c.ehStandInDeFerramenta),
        ferramentaAtiva: !!(c && c.isActive),
        pontosColocados,
        requerTerreno: !!cfg.requerTerreno,
        modoDesenho: cfg.modoDesenho || 'clique',
        tipo: cfg.tipo,
        noStore,
        erroStore,
        naFonte: contar(cfg.fonte),
        naFonteFeedback: contar(cfg.feedback),
        // A feicao derivada (trecho visivel e obstruido), quando a ferramenta
        // declara uma. E o que aparece na tela, e nao a feicao principal.
        noStoreProcessado,
        naFonteProcessada: cfg.processado ? contar(cfg.processado.fonte) : null,
        fontePrincipalExiste: !!map.getSource(cfg.fonte),
        fonteFeedbackExiste: !!map.getSource(cfg.feedback),
        painelAberto: !!document.querySelector(cfg.painel),
        snapping,
        terreno: !!map.getTerrain(),
        pitch: +map.getPitch().toFixed(1),
        zoom: +map.getZoom().toFixed(2),
        camadas: estilo.layers.length,
        fontes: Object.keys(estilo.sources).length,
        visibilidade: document.visibilityState,
    };
}

// Cria n feicoes pelo caminho do proprio controle (drawPoints + createFeature),
// em volta da vista. Devolve quantas chamadas passaram; o que o STORE guardou e
// a verdade, e sai da leitura de estado depois.
async function criarFeicoesPagina({ cfg, n, vista, pontos, anel }) {
    const c = window.__store.getControl(cfg.controle);
    if (!c || c.ehStandInDeFerramenta || typeof c.createFeature !== 'function') {
        return { ok: 0, erro: `controle ${cfg.controle} ausente, ainda stand-in, ou sem createFeature` };
    }
    const rnd = (a) => (Math.random() * 2 - 1) * a;
    // Nao ha assinatura unica de createFeature no app, e chamar a errada cria
    // zero feicao em silencio: a semeadura do descritor diz qual e a desta.
    const semear = async (pts) => {
        if (cfg.semeadura === 'argumentos') return c.createFeature(pts[0], pts[pts.length - 1]);
        if (cfg.semeadura === 'startEnd') {
            c.startPoint = pts[0];
            c.endPoint = pts[pts.length - 1];
            return c.createFeature();
        }
        c[cfg.semeadura === 'points' ? 'points' : 'drawPoints'] = pts;
        return c.createFeature();
    };
    const t0 = performance.now();
    const marcas = [];
    let ok = 0;
    let ultimoErro = null;
    for (let i = 0; i < n; i++) {
        const cx = vista.center[0] + rnd(0.03);
        const cy = vista.center[1] + rnd(0.03);
        const pts = [];
        if (anel) {
            for (let k = 0; k < pontos; k++) {
                const a = (k / pontos) * 2 * Math.PI;
                pts.push([cx + 0.004 * Math.cos(a), cy + 0.004 * Math.sin(a)]);
            }
        } else {
            for (let k = 0; k < pontos; k++) pts.push([cx + k * 0.006 + rnd(0.001), cy + rnd(0.004)]);
        }
        const tf = performance.now();
        try { await semear(pts); ok++; } catch (e) { ultimoErro = String(e && e.message ? e.message : e).slice(0, 120); }
        marcas.push(+(performance.now() - tf).toFixed(1));
    }
    await new Promise((r) => setTimeout(r, 1500));
    marcas.sort((a, b) => a - b);
    return {
        ok, erro: ultimoErro,
        ms: +(performance.now() - t0).toFixed(0),
        // A mediana por feicao e o que diz se `--feicoes 30` cabe no dia: a
        // visibilidade varre o terreno raio a raio, e nao e um addFeature.
        msPorFeicao: marcas.length ? marcas[Math.floor(marcas.length / 2)] : null,
    };
}

// Mouse sintetico: k eventos por quadro durante ms, andando em elipse pelo
// mapa. O mouse do Playwright entrega um evento por chamada e nao alcanca a
// taxa de um mouse de 500 Hz; o evento sintetico no rAF alcanca.
//
// Com `arrastar`, o evento e `pointermove` com `buttons: 1` (botao apertado), e
// o passo angular e quatro vezes maior: o pincel descarta movimento abaixo de
// 3 px (MIN_DISTANCE_PX), e o passo de 2 a 3 px do laco de desenho sairia como
// "a ferramenta perdeu pontos" quando quem os descartou foi a bancada.
function mouseSinteticoPagina({ k, ms, arrastar = false }) {
    return new Promise((r) => {
        const canvas = window.__mapa.getCanvas();
        const rect = canvas.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const divisor = arrastar ? 150 : 600;
        let i = 0;
        const t0 = performance.now();
        const passo = () => {
            for (let j = 0; j < k; j++) {
                const a = (i++ / divisor) * Math.PI * 2;
                const clientX = cx + Math.cos(a) * 300;
                const clientY = cy + Math.sin(a) * 200;
                canvas.dispatchEvent(arrastar
                    ? new PointerEvent('pointermove', {
                        bubbles: true, cancelable: true, buttons: 1,
                        pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX, clientY,
                    })
                    : new MouseEvent('mousemove', {
                        bubbles: true, cancelable: true, buttons: 0, clientX, clientY,
                    }));
                window.__B.mousemove++;
            }
            if (performance.now() - t0 < ms) requestAnimationFrame(passo); else r();
        };
        requestAnimationFrame(passo);
    });
}

// Arma o cronometro da conclusao. O t0 sai do PROPRIO evento do usuario, na
// fase de captura, e nao do relogio do Node: medir do lado do Node somaria o
// tempo do canal do CDP a latencia da ferramenta.
// O ouvinte fica no CONTAINER do canvas, e nao no canvas. O pincel captura o
// ponteiro no container (`setPointerCapture`), e a captura redireciona o
// pointerup para ele: um ouvinte no canvas, que e filho, nunca veria o evento
// que a bancada esta cronometrando.
function armarConclusaoPagina({ cfg, evento, antes, antesProcessado, limite }) {
    return new Promise((resolve) => {
        const map = window.__mapa;
        const canvas = map.getCanvasContainer();
        const temProcessado = !!cfg.processado;
        let t0 = null;
        let msStore = null;
        let msPainel = null;
        let msProcessado = null;
        const arranque = () => { if (t0 === null) t0 = performance.now(); };
        canvas.addEventListener(evento, arranque, true);
        const fim = () => {
            canvas.removeEventListener(evento, arranque, true);
            resolve({ msStore, msPainel, msProcessado, disparou: t0 !== null });
        };
        // A feicao derivada, contada na fonte do MAPA: e o que a tela mostra, e
        // a leitura e sincrona, entao cabe dentro do quadro.
        const contarProcessadas = () => {
            const src = map.getSource(cfg.processado.fonte);
            if (!src) return null;
            const d = typeof src.serialize === 'function' ? src.serialize().data : src._data;
            if (typeof d === 'string') return null;
            return d && Array.isArray(d.features) ? d.features.length : null;
        };
        const passo = async () => {
            if (t0 !== null) {
                if (msPainel === null && document.querySelector(cfg.painel)) msPainel = +(performance.now() - t0).toFixed(1);
                if (temProcessado && msProcessado === null) {
                    const n = contarProcessadas();
                    if (n !== null && n > antesProcessado) msProcessado = +(performance.now() - t0).toFixed(1);
                }
                if (msStore === null) {
                    try {
                        const f = await window.__store.getCurrentMapFeatures();
                        if ((f[cfg.tipo] || []).length > antes) msStore = +(performance.now() - t0).toFixed(1);
                    } catch (_e) { /* segue tentando ate o limite */ }
                }
                if (msStore !== null && msPainel !== null && (!temProcessado || msProcessado !== null)) return fim();
                if (performance.now() - t0 > limite) return fim();
            }
            requestAnimationFrame(passo);
        };
        requestAnimationFrame(passo);
        // Rede de seguranca: gesto que nunca chegou nao pode travar a bancada.
        setTimeout(() => { if (t0 === null) fim(); }, limite + 2000);
    });
}

// --------------------------------------------------------------------------
// Motor
// --------------------------------------------------------------------------
class Bancada {
    constructor(page, params, cfg) {
        this.page = page;
        this.params = params;
        this.cfg = cfg;
    }

    // O servidor de desenvolvimento reinicia sozinho quando alguem toca a
    // configuracao, e ai o goto morre ou o contexto de execucao some no meio de
    // um evaluate. Isso e ruido do ambiente, nao medida: tenta de novo.
    async carregar() {
        let ultimoErro = null;
        for (let tentativa = 1; tentativa <= 3; tentativa++) {
            try {
                const r = await this.carregarUmaVez();
                return tentativa === 1 ? r : { ...r, tentativas: tentativa };
            } catch (e) {
                ultimoErro = e;
                console.log(`  carga falhou na tentativa ${tentativa}: ${String(e.message).slice(0, 200)}`);
                await dorme(4000);
            }
        }
        throw ultimoErro;
    }

    async carregarUmaVez() {
        const t0 = Date.now();
        await this.page.goto(this.params.url, { waitUntil: 'load', timeout: 60000 });
        this.urlsDoApp = await this.page.evaluate(carregarModulosDoApp);
        let pronto = null;
        let ultimo = null;
        let assinatura = '';
        let estavelDesde = Date.now();
        for (let i = 0; i < 240; i++) {
            const s = await this.page.evaluate(sondaProntidao);
            ultimo = s;
            if (s) {
                const nova = `${s.camadas}/${s.fontes}`;
                if (nova !== assinatura) { assinatura = nova; estavelDesde = Date.now(); }
                const veredito = avaliarProntidao(s, Date.now() - estavelDesde);
                if (veredito.pronto) {
                    pronto = { ...s, como: 'fontes do app presentes e (camadas, fontes) parada por 3 s' };
                    break;
                }
            }
            await dorme(500);
        }
        if (!pronto) {
            const veredito = avaliarProntidao(ultimo, Date.now() - estavelDesde);
            throw new Error(`o app nao ficou pronto em 120 s: ${veredito.motivos.join('; ')}. `
                + `Ultimo estado: ${JSON.stringify(ultimo)}`);
        }
        const instr = await this.page.evaluate(instrumentar, this.cfg);
        return { ...pronto, ms: Date.now() - t0, instrumentacao: instr };
    }

    // Carga tardia: sem isto o registro devolve o stand-in da ferramenta.
    async prepararFerramenta() {
        const r = await this.page.evaluate(prepararFerramentaPagina, this.cfg);
        // A ferramenta que acabou de nascer pode ter criado fontes proprias.
        await this.page.evaluate(() => window.__envolver());
        return r;
    }

    async assentar(maxMs = 25000) {
        const t0 = Date.now();
        let ultima = '';
        let estavelDesde = Date.now();
        let cega = [];
        while (Date.now() - t0 < maxMs) {
            const s = await this.page.evaluate(lerAssentamento);
            cega = validarLeituraDeTiles(s);
            if (s.carregado) return { como: 'map.loaded()', ms: Date.now() - t0, tiles: s.tiles, desconhecidos: s.desconhecidos };
            if (!cega.length) {
                if (s.assinatura !== ultima) { ultima = s.assinatura; estavelDesde = Date.now(); } else if (Date.now() - estavelDesde > MS_ESTAVEL) {
                    return { como: 'tiles estaveis por 3 s', ms: Date.now() - t0, tiles: s.tiles, desconhecidos: s.desconhecidos };
                }
            }
            await dorme(200);
        }
        return { como: 'TIMEOUT', ms: Date.now() - t0, erros: cega };
    }

    // Cadencia ociosa do rAF: 60 quadros sem pedir repaint. Veredito do instrumento.
    async cadencia() {
        const marcas = await this.page.evaluate(() => new Promise((r) => {
            const ts = [];
            const f = (t) => { ts.push(t); if (ts.length < 60) requestAnimationFrame(f); else r(ts); };
            requestAnimationFrame(f);
        }));
        const ints = marcas.slice(1).map((t, i) => t - marcas[i]).sort((a, b) => a - b);
        return { p50: arred(percentil(ints, 0.5)), p95: arred(percentil(ints, 0.95)), max: arred(percentil(ints, 1)), amostras: ints.length };
    }

    async irParaVista() {
        await this.page.evaluate((v) => { window.__mapa.jumpTo({ center: v.center, zoom: v.zoom, pitch: 0, bearing: 0 }); }, VISTA);
    }

    async estado() {
        return this.page.evaluate(lerEstado, this.cfg);
    }

    // Forca n quadros para o estado derivado se refazer.
    async esperarQuadros(n) {
        await this.page.evaluate((n) => new Promise((r) => {
            const map = window.__mapa;
            let i = 0;
            const f = () => { map.triggerRepaint(); if (++i < n) requestAnimationFrame(f); else requestAnimationFrame(() => r()); };
            requestAnimationFrame(f);
        }), n);
    }

    async ligarTerreno() {
        await this.page.evaluate(async () => { await window.__store.getControl('TerrainControl')._toggleTerrain(); });
        // O controle faz easeTo de pitch com 500 ms; espera o gesto acabar.
        await dorme(1500);
        await this.assentar();
        // Fonte que nasceu com o terreno tambem precisa do contador.
        await this.page.evaluate(() => window.__envolver());
        await this.esperarQuadros(3);
        return this.page.evaluate(() => ({
            terreno: !!window.__mapa.getTerrain(),
            pitch: +window.__mapa.getPitch().toFixed(1),
            pilhas: window.__mapa.painter.renderToTexture && window.__mapa.painter.renderToTexture._stacks
                ? window.__mapa.painter.renderToTexture._stacks.length : null,
        }));
    }

    async ligarSnapping(valor) {
        await this.page.evaluate((v) => { window.__store.getStateManager().set('ui.snapping.enabled', v); }, valor);
        await dorme(300);
        return this.page.evaluate(() => {
            try { return !!window.__store.getStateManager().getUnsafe('ui.snapping.enabled'); } catch (_e) { return null; }
        });
    }

    async ativar() {
        return this.page.evaluate((cfg) => {
            const c = window.__store.getControl(cfg.controle);
            if (!c || typeof c.activate !== 'function') return { ok: false, erro: `controle ${cfg.controle} ausente ou sem activate()` };
            c.activate();
            return { ok: true, ativo: !!c.isActive };
        }, this.cfg);
    }

    async desativar() {
        await this.page.evaluate((cfg) => {
            const c = window.__store.getControl(cfg.controle);
            if (c && typeof c.deactivate === 'function') c.deactivate();
        }, this.cfg);
        await dorme(300);
    }

    // Pontos que o usuario ja colocou, pela propriedade que ESTA ferramenta usa.
    async lerPontos() {
        return this.page.evaluate((cfg) => {
            const c = window.__store.getControl(cfg.controle);
            if (!c) return null;
            const p = cfg.pontos;
            const bruto = c[p.propriedade];
            if (p.forma === 'ponto') return bruto ? 1 : 0;
            return Array.isArray(bruto) ? bruto.length : null;
        }, this.cfg);
    }

    // Clica de verdade e espera o ponto entrar no controle. A espera existe
    // porque nem toda ferramenta transforma o clique em vertice no mesmo tique:
    // ler a contagem logo depois do clique acharia zero e reprovaria o app bom.
    async clicarEEsperarVertice(x, y, limiteMs = 3000) {
        const antes = await this.lerPontos();
        await this.page.mouse.move(x, y);
        await dorme(60);
        const t0 = Date.now();
        await this.page.mouse.click(x, y);
        while (Date.now() - t0 < limiteMs) {
            const n = await this.lerPontos();
            if (n !== null && antes !== null && n > antes) return { pegou: true, ms: Date.now() - t0, pontos: n };
            await dorme(25);
        }
        return { pegou: false, ms: Date.now() - t0, pontos: await this.lerPontos() };
    }

    // Um arrasto: pointerdown REAL, k pointermove sinteticos por quadro, e o
    // pointerup fica com quem chamou. O down e o up passam pelo mouse do
    // Playwright de proposito: `_onPointerDown` faz `setPointerCapture` do
    // pointerId, e capturar um ponteiro que nunca existiu lanca NotFoundError
    // dentro do ouvinte, o que sairia como erro da pagina e nao como medida.
    async arrastar(x, y, k, ms) {
        await this.page.mouse.move(x, y);
        await this.page.mouse.down();
        await dorme(80);
        await this.page.evaluate(mouseSinteticoPagina, { k, ms, arrastar: true });
        const pontos = await this.lerPontos();
        return { pontos };
    }

    async criarFeicoes(n) {
        const r = await this.page.evaluate(criarFeicoesPagina, {
            cfg: this.cfg, n, vista: VISTA,
            pontos: this.cfg.pontosParaCriar, anel: !!this.cfg.anel,
        });
        await this.assentar();
        await this.esperarQuadros(2);
        return r;
    }

    async gestoZoom() {
        await this.page.evaluate(() => new Promise((r) => {
            const map = window.__mapa;
            const z = map.getZoom();
            const volta = () => { map.once('moveend', () => r()); map.easeTo({ zoom: z, duration: 1500, easing: (t) => t }); };
            map.once('moveend', volta);
            map.easeTo({ zoom: z + 1, duration: 1500, easing: (t) => t });
            // Rede de seguranca: moveend perdido nao pode travar a bancada.
            setTimeout(() => r(), 3000 + 5000);
        }));
    }

    async colher() {
        return this.page.evaluate(() => window.__B);
    }

    // --- cenarios ---

    // Desenho: ferramenta ativa, 1 ponto colocado por CLIQUE REAL, e k eventos
    // de mousemove por quadro durante 3 s.
    //
    // No modo `arrastar` nao ha clique que fique: o traco vive entre o
    // pointerdown e o pointerup, e o up ja cria a feicao. Cada valor de k tem
    // entao o seu proprio traco, e os pontos acumulados sao lidos antes do up.
    async cenarioDesenho(ks) {
        const casos = [];
        const ativacao = await this.ativar();
        const arrastando = this.cfg.modoDesenho === 'arrastar';
        const clique = (!arrastando && ativacao.ok)
            ? await this.clicarEEsperarVertice(...CLIQUES[0])
            : { pegou: null, ms: null, pontos: null };
        for (const k of ks) {
            await this.page.evaluate(() => window.__zerar());
            let pontosAcumulados = null;
            if (arrastando) {
                const traco = await this.arrastar(...CLIQUES[0], k, MS_DESENHO);
                pontosAcumulados = traco.pontos;
            } else {
                await this.page.evaluate(mouseSinteticoPagina, { k, ms: MS_DESENHO });
            }
            const B = await this.colher();
            const est = estatistica(B);
            if (arrastando) {
                // O up depois de colher: a criacao da feicao nao entra na
                // estatistica do desenho, que e do traco.
                await this.page.mouse.up();
                await dorme(600);
            }
            const estado = await this.estado();
            const sd = resumirEscritas(B.escritas, this.cfg.feedback);
            const prova = {
                ...sd, ...estado,
                fonteAlvo: this.cfg.feedback,
                ativacao, cliqueMs: clique.ms, cliquePegou: clique.pegou,
                pontosAcumulados, eventosDeMovimento: B.mousemove ?? null,
            };
            casos.push({
                cenario: 'desenho', k, estatistica: est, prova,
                erros: CENARIOS.desenho.validar(prova, est, {}),
            });
        }
        await this.desativar();
        return casos;
    }

    // Zoom: N feicoes criadas pelo caminho do controle, e um gesto de zoom.
    async cenarioZoom(n) {
        // O que ja estava no store ANTES de criar. Com o pincel o cenario
        // anterior deixou uma feicao por valor de k, e comparar com N absoluto
        // reprovaria a bancada boa (ou aprovaria a soma errada).
        const base = await this.estado();
        const criacao = await this.criarFeicoes(n);
        const antes = await this.estado();
        await this.page.evaluate(() => window.__zerar());
        await this.gestoZoom();
        const B = await this.colher();
        const est = estatistica(B);
        const estado = await this.estado();
        const sd = resumirEscritas(B.escritas, this.cfg.fonte);
        const prova = {
            ...sd, ...estado, fonteAlvo: this.cfg.fonte, criacao,
            naFonteAntes: antes.naFonte, noStoreAntesDeCriar: base.noStore,
        };
        return {
            cenario: 'zoom', k: null, estatistica: est, prova,
            erros: CENARIOS.zoom.validar(prova, est, { feicoes: n }),
        };
    }

    // Conclusao: os cliques do desenho e o gesto que fecha a feicao. O relogio
    // parte do evento do usuario, dentro da pagina.
    async cenarioConclusao() {
        const antesEstado = await this.estado();
        const ativacao = await this.ativar();
        const conc = this.cfg.conclusao;
        const cliques = [];
        for (let i = 0; i < conc.cliquesAntes; i++) {
            const [x, y] = CLIQUES[i % CLIQUES.length];
            cliques.push(await this.clicarEEsperarVertice(x, y));
            await dorme(350);
        }
        // O traco do pincel tem de existir ANTES de armar o cronometro: o que se
        // mede e o pointerup ate a feicao no store, e nao o desenho.
        let pontosDoTraco = null;
        if (conc.gesto === 'pointerup') {
            const traco = await this.arrastar(...CLIQUES[0], 2, 400);
            pontosDoTraco = traco.pontos;
        }
        await this.page.evaluate(() => window.__zerar());
        const espera = this.page.evaluate(armarConclusaoPagina, {
            cfg: this.cfg, evento: conc.evento,
            antes: antesEstado.noStore || 0,
            antesProcessado: antesEstado.naFonteProcessada || 0,
            // O calculo da LOS e o da visibilidade sao varreduras do terreno, e
            // nao um addFeature: o limite delas e outro.
            limite: this.cfg.processado ? 30000 : 5000,
        });
        await dorme(120);
        const [ux, uy] = CLIQUES[Math.max(0, conc.cliquesAntes - 1) % CLIQUES.length];
        if (conc.gesto === 'botao-direito') {
            await this.page.mouse.move(ux + DESLOCAMENTO_CONCLUSAO[0], uy + DESLOCAMENTO_CONCLUSAO[1]);
            await this.page.mouse.click(ux + DESLOCAMENTO_CONCLUSAO[0], uy + DESLOCAMENTO_CONCLUSAO[1], { button: 'right' });
        } else if (conc.gesto === 'pointerup') {
            await this.page.mouse.up();
        } else {
            const [x, y] = CLIQUES[conc.cliquesAntes % CLIQUES.length];
            await this.page.mouse.move(x, y);
            await this.page.mouse.click(x, y);
        }
        const tempos = await espera;
        await dorme(800);
        const B = await this.colher();
        const est = estatistica(B);
        const estado = await this.estado();
        const sd = resumirEscritas(B.escritas, this.cfg.fonte);
        const prova = {
            ...sd, ...estado,
            fonteAlvo: this.cfg.fonte,
            gesto: conc.gesto,
            ativacao,
            noStoreAntes: antesEstado.noStore,
            processadoDeclarado: !!this.cfg.processado,
            naFonteProcessadaAntes: antesEstado.naFonteProcessada,
            msStore: tempos.msStore,
            msPainel: tempos.msPainel,
            msProcessado: tempos.msProcessado,
            gestoDisparou: tempos.disparou,
            cliquesPedidos: conc.cliquesAntes,
            cliquesQuePegaram: cliques.filter((c) => c.pegou).length,
            msPorClique: cliques.map((c) => c.ms),
            pontosDoTraco,
        };
        await this.desativar();
        return {
            cenario: 'conclusao', k: null, estatistica: est, prova,
            erros: CENARIOS.conclusao.validar(prova, est, {}),
        };
    }
}

// --------------------------------------------------------------------------
// Saida
// --------------------------------------------------------------------------
function celula(valores) {
    const v = valores.filter((x) => x !== null && x !== undefined && !Number.isNaN(x));
    if (!v.length) return '-';
    const med = mediana(v);
    if (v.length === 1) return String(arred(med, 2));
    const min = Math.min(...v);
    const max = Math.max(...v);
    if (min === max) return String(arred(med, 2));
    return `${arred(med, 2)} (${arred(min, 2)}..${arred(max, 2)})`;
}

const METRICAS = [
    ['quadros', (c) => c.estatistica.quadros],
    ['render p50', (c) => c.estatistica.render_ms && c.estatistica.render_ms.p50],
    ['render p95', (c) => c.estatistica.render_ms && c.estatistica.render_ms.p95],
    ['interv p95', (c) => c.estatistica.intervalo_ms && c.estatistica.intervalo_ms.p95],
    ['>33ms', (c) => c.estatistica.lentos],
    // As TRES colunas de escrita. A soma e a que reprova o cenario inerte; o par
    // (setData, updateData) diz por qual caminho a fonte recebeu dado, que e a
    // diferenca entre a fonte de apoio e a fonte migrada para o despachante.
    ['escritas alvo', (c) => c.prova.escritasAlvo],
    ['setData alvo', (c) => c.prova.setDataAlvo],
    ['updData alvo', (c) => c.prova.updateDataAlvo],
    ['escritas outras', (c) => c.prova.escritasOutras],
    ['queryRend', (c) => c.estatistica.query],
    ['project', (c) => c.estatistica.proj],
    ['lat p50', (c) => c.estatistica.latencia_ms && c.estatistica.latencia_ms.p50],
    ['lat p95', (c) => c.estatistica.latencia_ms && c.estatistica.latencia_ms.p95],
    // Quantas escritas de feedback assentaram (deram medida de latencia) e
    // quantas a seguinte substituiu antes disso. Sem este par, "lat p50" de 19
    // medidas em 180 escritas passaria por medida da ferramenta inteira.
    ['lat n', (c) => c.estatistica.latencia_ms && c.estatistica.latencia_ms.amostras],
    ['perdidos', (c) => c.estatistica.feedbackSuperados],
    ['store ms', (c) => c.prova.msStore],
    // Do gesto ate a analise derivada entrar na fonte que a tela desenha. So a
    // LOS e a visibilidade tem uma; nas outras a coluna sai com traco.
    ['proc ms', (c) => c.prova.msProcessado],
    ['painel ms', (c) => c.prova.msPainel],
    // Pontos que o gesto deixou no controle. No arrasto e o traco inteiro (um
    // por evento, mais o do pointerdown), e e a prova de que nada se perdeu.
    ['pontos', (c) => (c.prova.pontosAcumulados ?? c.prova.pontosDoTraco ?? c.prova.pontosColocados)],
];

// Chave de linha: uma linha por (ferramenta, cenario, k). O k so existe no
// desenho; nos outros cenarios a coluna sai com traco.
function chavesDaTabela(rodadas) {
    const ferramentas = [];
    const chaves = new Map();
    for (const rod of rodadas) {
        for (const caso of rod.casos || []) {
            if (!ferramentas.includes(caso.ferramenta)) ferramentas.push(caso.ferramenta);
            const chave = `${caso.ferramenta}||${caso.cenario}||${caso.k === null || caso.k === undefined ? '' : caso.k}`;
            if (!chaves.has(chave)) chaves.set(chave, { ferramenta: caso.ferramenta, cenario: caso.cenario, k: caso.k ?? null });
        }
    }
    return [...chaves.values()].sort((a, b) => {
        const df = ferramentas.indexOf(a.ferramenta) - ferramentas.indexOf(b.ferramenta);
        if (df) return df;
        const dc = ORDEM_CENARIOS.indexOf(a.cenario) - ORDEM_CENARIOS.indexOf(b.cenario);
        if (dc) return dc;
        return (a.k ?? -1) - (b.k ?? -1);
    });
}

function montarTabela(resultado) {
    const usadas = resultado.rodadas.filter((r) => !r.aquecimento && r.valida);
    const base = usadas.length ? usadas : resultado.rodadas;
    const aquece = resultado.parametros.rodadas > 1 ? 'a rodada 1 e aquecimento e ficou de fora'
        : 'rodada unica: nao ha aquecimento a descartar';
    const nota = usadas.length ? `rodadas usadas: ${base.map((r) => r.rodada).join(', ')} (${aquece})`
        : 'NENHUMA rodada valida fora do aquecimento; a tabela usa TODAS as rodadas e o resultado nao vale';
    const linhas = [];
    for (const chave of chavesDaTabela(base)) {
        const celulas = [];
        const vereditos = new Set();
        for (const rod of base) {
            const c = (rod.casos || []).find((x) => x.ferramenta === chave.ferramenta && x.cenario === chave.cenario && (x.k ?? null) === chave.k);
            if (!c) continue;
            celulas.push(c);
            if (c.erros && c.erros.length) vereditos.add('CENARIO INVALIDO');
            if (!rod.valida) vereditos.add('RODADA INVALIDA');
        }
        if (!celulas.length) continue;
        if (resultado.ambiente.relogio !== 'valido') vereditos.add(resultado.ambiente.relogio);
        if (resultado.ambiente.appMudou) vereditos.add('APP MUDOU ENTRE AS CARGAS');
        linhas.push({
            ferramenta: chave.ferramenta,
            cenario: chave.cenario,
            k: chave.k === null ? '-' : String(chave.k),
            valores: METRICAS.map(([nome, ler]) => ({ nome, texto: celula(celulas.map(ler)) })),
            veredito: vereditos.size ? [...vereditos].join('; ') : 'ok',
        });
    }
    return { linhas, nota };
}

function escreverMarkdown(resultado, tabela) {
    const p = resultado.parametros;
    const l = [];
    l.push('# Bancada de ferramentas do EBGeo Web');
    l.push('');
    l.push(`Data: ${resultado.ambiente.quando}`);
    l.push(`URL: ${p.url} | ferramenta: ${p.ferramenta} | viewport: ${p.largura}x${p.altura} | headless: ${p.headless}`);
    l.push(`k (mousemove por quadro): ${p.k.join(', ')} | feicoes no zoom: ${p.feicoes} | terreno: ${p.terreno} | snapping: ${p.snapping} | CPU: ${p.cpu}x`);
    l.push(`Renderer: ${resultado.ambiente.renderer}`);
    l.push(`Relogio: ${resultado.ambiente.relogio}`);
    l.push(`Playwright ${resultado.ambiente.playwrightVersao}, carregado de ${resultado.ambiente.playwrightOrigem}`);
    l.push(`Rodadas: ${p.rodadas}. ${tabela.nota}`);
    const ass = resultado.ambiente.assinaturas || {};
    l.push(`Assinatura do app (camadas/fontes): ${Object.keys(ass).join('  |  ') || '-'}`);
    if (resultado.ambiente.appMudou) {
        l.push('');
        l.push('**O APP MUDOU DURANTE A BANCADA.** As cargas nao viram o mesmo aplicativo, e a tabela');
        l.push('abaixo compara versoes diferentes com o mesmo rotulo. Onde cada assinatura apareceu:');
        for (const [a, onde] of Object.entries(ass)) l.push(`- \`${a}\`: ${onde.join(', ')}`);
    }
    l.push('');
    l.push('Celula com mais de uma rodada valida mostra `mediana (min..max)`. `escritas alvo` e a soma');
    l.push('de `setData` com `updateData` na fonte que o cenario existe para exercitar: a de feedback');
    l.push('no `desenho`, a principal no `zoom` e na `conclusao`. As duas colunas seguintes separam os');
    l.push('metodos, porque nesta branch a fonte principal e migrada para o despachante de diff');
    l.push('(`layers/geojson-dispatcher.js`) e recebe dado por `updateData`, enquanto a fonte de apoio');
    l.push('continua em `setData` cru. `lat` e a latencia do feedback, da escrita ao primeiro quadro');
    l.push('com a fonte carregada; `lat n` diz quantas escritas assentaram e `perdidos` quantas a');
    l.push('seguinte substituiu antes disso, ou seja, o preview que o usuario nunca viu.');
    l.push('');
    const cab = ['ferramenta', 'cenario', 'k', ...METRICAS.map(([n]) => n), 'veredito'];
    l.push(`| ${cab.join(' | ')} |`);
    l.push(`|${cab.map(() => '---').join('|')}|`);
    for (const linha of tabela.linhas) {
        l.push(`| ${linha.ferramenta} | ${linha.cenario} | ${linha.k} | ${linha.valores.map((v) => v.texto).join(' | ')} | ${linha.veredito} |`);
    }
    l.push('');
    l.push('## Vereditos do instrumento');
    l.push('');
    for (const rod of resultado.rodadas) {
        l.push(`- rodada ${rod.rodada}${rod.aquecimento ? ' (aquecimento)' : ''}: ${rod.valida ? 'valida' : `INVALIDA (${rod.erros.join('; ')})`}`);
        const cad = rod.cadencia ? `cadencia p50 ${rod.cadencia.p50} p95 ${rod.cadencia.p95}` : 'cadencia ausente';
        l.push(`  - ${cad}${rod.avisos && rod.avisos.length ? `; avisos: ${rod.avisos.join('; ')}` : ''}`);
        for (const c of rod.casos || []) {
            l.push(`  - ${c.ferramenta} / ${c.cenario}${c.k === null || c.k === undefined ? '' : ` / k=${c.k}`}: ${c.erros.length ? `CENARIO INVALIDO (${c.erros.join('; ')})` : 'prova ok'}`);
        }
    }
    l.push('');
    l.push('## Provas dos cenarios (ultima rodada)');
    l.push('');
    const ultima = resultado.rodadas[resultado.rodadas.length - 1] || { casos: [] };
    for (const c of ultima.casos || []) {
        l.push(`### ${c.ferramenta} / ${c.cenario}${c.k === null || c.k === undefined ? '' : ` / k=${c.k}`}`);
        l.push('');
        l.push('```json');
        l.push(JSON.stringify({ prova: c.prova, erros: c.erros }, null, 2));
        l.push('```');
        l.push('');
    }
    return l.join('\n');
}

function imprimirTabela(tabela) {
    if (!tabela.linhas.length) { console.log('nenhuma linha medida'); return; }
    const cab = ['ferramenta', 'cenario', 'k', ...METRICAS.map(([n]) => n), 'veredito'];
    const linhas = [cab, ...tabela.linhas.map((li) => [li.ferramenta, li.cenario, li.k, ...li.valores.map((v) => v.texto), li.veredito])];
    const larg = cab.map((_, i) => Math.max(...linhas.map((r) => String(r[i]).length)));
    const sep = larg.map((w) => '-'.repeat(w)).join('-+-');
    console.log(linhas[0].map((c, i) => String(c).padEnd(larg[i])).join(' | '));
    console.log(sep);
    for (const r of linhas.slice(1)) console.log(r.map((c, i) => String(c).padEnd(larg[i])).join(' | '));
}

// --------------------------------------------------------------------------
// Principal
// --------------------------------------------------------------------------
async function principal() {
    const params = lerArgumentos(process.argv.slice(2));
    if (params.ajuda) { console.log(AJUDA); return; }

    const cfg = normalizarFerramenta(params.ferramenta);
    const pw = await carregarPlaywright();
    fs.mkdirSync(params.saida, { recursive: true });

    // O proxy do sistema faz o Chromium com cabeca abrir dialogo de credencial em
    // todo host de fora. A decisao mora em proxy-do-navegador.mjs e nunca vaza valor.
    const proxyDoNavegador = resolverProxyDoNavegador(params.proxy, process.env);
    console.log(`proxy do navegador: ${proxyDoNavegador.descricao}`);
    const navegador = await pw.chromium.launch({
        headless: params.headless,
        ...(proxyDoNavegador.launch.proxy ? { proxy: proxyDoNavegador.launch.proxy } : {}),
        args: [
            ...proxyDoNavegador.launch.args,
            // Aba oculta ou janela ocluida zera o rAF e a medida vira mentira.
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-features=CalculateNativeWinOcclusion',
            `--window-size=${params.largura + 20},${params.altura + 100}`,
        ],
    });

    const errosDaPagina = [];
    const resultado = {
        // O caminho absoluto da saida nao entra no JSON: o artefato fica dentro
        // do repositorio, e caminho de maquina nao se grava no repositorio.
        parametros: { ...params, saida: path.relative(PACOTE, params.saida).split(path.sep).join('/'), vista: VISTA },
        ambiente: {
            quando: new Date().toISOString(),
            node: process.version,
            plataforma: process.platform,
            playwrightOrigem: pw.origem,
            playwrightVersao: pw.versao,
            renderer: null,
            fornecedor: null,
            relogio: 'valido',
            cpu: params.cpu,
        },
        rodadas: [],
        errosDaPagina,
    };

    for (let rodada = 1; rodada <= params.rodadas; rodada++) {
        const reg = {
            rodada, aquecimento: rodada === 1 && params.rodadas > 1,
            valida: true, erros: [], avisos: [], casos: [],
        };
        console.log(`\n===== rodada ${rodada}${reg.aquecimento ? ' (aquecimento)' : ''} | ferramenta ${params.ferramenta}`);
        // Contexto NOVO por rodada: o store do app persiste no IndexedDB do
        // contexto, e a rodada 2 acharia as feicoes da rodada 1 e mediria
        // 2N com o rotulo de N.
        const context = await navegador.newContext({ viewport: { width: params.largura, height: params.altura } });
        // O buffer de Resource Timing tem 250 entradas por padrao e o app carrega
        // centenas de modulos em dev: sem aumenta-lo ANTES da carga, as entradas
        // do boot (que dizem por qual URL cada modulo veio) se perdem, e a
        // bancada importaria a copia errada de cada um.
        await context.addInitScript(() => { try { performance.setResourceTimingBufferSize(20000); } catch (_e) { /* navegador sem a API: a descoberta cai no caminho nu */ } });
        const page = await context.newPage();
        page.on('pageerror', (e) => errosDaPagina.push(String(e).slice(0, 200)));
        page.on('console', (m) => { if (m.type() === 'error') errosDaPagina.push(`console: ${m.text().slice(0, 200)}`); });
        const bancada = new Bancada(page, params, cfg);
        try {
            if (params.cpu > 1) {
                const cdp = await context.newCDPSession(page);
                await cdp.send('Emulation.setCPUThrottlingRate', { rate: params.cpu });
                console.log(`  CPU estrangulada por ${params.cpu}x pelo CDP`);
            }
            const carga = await bancada.carregar();
            reg.carga = carga;
            if (resultado.ambiente.renderer === null) {
                resultado.ambiente.renderer = carga.instrumentacao.renderer;
                resultado.ambiente.fornecedor = carga.instrumentacao.fornecedor;
                if (/SwiftShader|llvmpipe/i.test(String(carga.instrumentacao.renderer))) {
                    resultado.ambiente.relogio = 'INVALIDO (GPU emulada)';
                    console.log(`  ATENCAO: renderer ${carga.instrumentacao.renderer}. So as contagens valem.`);
                }
                console.log(`  renderer: ${carga.instrumentacao.renderer}`);
            }

            // A carga tardia da ferramenta vem ANTES de qualquer leitura de
            // estado: sem ela o registro devolve o stand-in, que nao desenha.
            reg.ferramenta = await bancada.prepararFerramenta();
            if (!reg.ferramenta.ok) {
                throw new Error(`a ferramenta ${params.ferramenta} nao ficou pronta: ${reg.ferramenta.erro || (reg.ferramenta.ehStandIn ? 'o registro devolveu o stand-in' : 'motivo desconhecido')}`);
            }
            console.log(`  ferramenta: ${cfg.controle} carregada pela chave "${reg.ferramenta.chave}" do tool-registry`);

            // Impressao digital do app ANTES de mexer no mapa. Todas as cargas de
            // uma mesma bancada tem de dar a mesma: assinatura distinta significa
            // que a arvore mudou embaixo da medida.
            const base = await bancada.estado();
            reg.assinatura = `${base.camadas}c/${base.fontes}f`;
            reg.estadoBase = base;
            if (!base.controlePresente) {
                throw new Error(`o app nao expoe o controle "${cfg.controle}" (ferramenta ${params.ferramenta})`);
            }
            if (!base.fontePrincipalExiste) throw new Error(`o app nao tem a fonte principal "${cfg.fonte}"`);
            if (!base.fonteFeedbackExiste) throw new Error(`o app nao tem a fonte de feedback "${cfg.feedback}"`);

            await bancada.irParaVista();
            reg.assentou = await bancada.assentar();
            if ((reg.assentou.erros || []).length) {
                reg.valida = false;
                reg.erros.push(...reg.assentou.erros);
            }
            if (cfg.requerTerreno && !params.terreno) {
                // Nao para a rodada: o cenario sai INVALIDO com a razao, e a
                // tabela mostra o que a ferramenta parada faz. Parar aqui
                // esconderia que ela nem ativa.
                reg.valida = false;
                reg.erros.push(`a ferramenta ${params.ferramenta} exige terreno e --terreno nao foi pedido`);
                console.log(`  ** ${params.ferramenta} exige terreno: rode com --terreno`);
            }
            if (params.terreno) {
                reg.terreno = await bancada.ligarTerreno();
                if (!reg.terreno.terreno) { reg.valida = false; reg.erros.push('--terreno pedido e getTerrain() continuou nulo'); }
                console.log(`  terreno: ${JSON.stringify(reg.terreno)}`);
            }
            if (params.snapping) {
                reg.snapping = await bancada.ligarSnapping(true);
                if (!reg.snapping) { reg.valida = false; reg.erros.push('--snapping pedido e ui.snapping.enabled continuou falso'); }
                console.log(`  snapping: ${reg.snapping}`);
            }

            reg.cadencia = await bancada.cadencia();
            const vc = avaliarCadencia(reg.cadencia, params.cpu);
            if (vc.erro) { reg.valida = false; reg.erros.push(vc.erro); }
            if (vc.aviso) { reg.avisos.push(vc.aviso); console.log(`  aviso: ${vc.aviso}`); }
            const vis = await page.evaluate(() => document.visibilityState);
            if (vis !== 'visible') { reg.valida = false; reg.erros.push(`visibilityState ${vis}`); }
            console.log(`  cadencia ociosa: p50 ${reg.cadencia.p50} p95 ${reg.cadencia.p95} | visibilidade ${vis}`);

            const casos = [];
            casos.push(...await bancada.cenarioDesenho(params.k));
            await page.screenshot({ path: path.join(params.saida, `captura-${params.ferramenta}-desenho.png`) });
            console.log(`  criando ${params.feicoes} feicoes para o cenario zoom...`);
            casos.push(await bancada.cenarioZoom(params.feicoes));
            const cri = casos[casos.length - 1].prova.criacao || {};
            console.log(`  criacao: ${cri.ok}/${params.feicoes} em ${cri.ms} ms (mediana ${cri.msPorFeicao} ms por feicao)${cri.erro ? `  ** ultimo erro: ${cri.erro}` : ''}`);
            await page.screenshot({ path: path.join(params.saida, `captura-${params.ferramenta}-zoom.png`) });
            casos.push(await bancada.cenarioConclusao());
            await page.screenshot({ path: path.join(params.saida, `captura-${params.ferramenta}-conclusao.png`) });

            for (const c of casos) {
                c.ferramenta = params.ferramenta;
                reg.casos.push(c);
                const e = c.estatistica;
                const rotuloK = c.k === null || c.k === undefined ? '' : ` k=${c.k}`;
                console.log(`  ${(c.cenario + rotuloK).padEnd(14)} quadros ${String(e.quadros).padStart(4)}`
                    + ` | render p50 ${e.render_ms ? e.render_ms.p50 : '-'} p95 ${e.render_ms ? e.render_ms.p95 : '-'}`
                    + ` | interv p95 ${e.intervalo_ms ? e.intervalo_ms.p95 : '-'} >33ms ${e.lentos}`
                    + ` | escritas ${c.prova.escritasAlvo} (${c.prova.fonteAlvo}: ${c.prova.setDataAlvo} setData + ${c.prova.updateDataAlvo} updateData) outras ${c.prova.escritasOutras}`
                    + ` | query ${e.query} project ${e.proj}`
                    + `${e.latencia_ms ? ` | lat p50 ${e.latencia_ms.p50} p95 ${e.latencia_ms.p95} (${e.latencia_ms.amostras} assentaram, ${e.feedbackSuperados} perdidos)` : (e.feedbackSuperados ? ` | lat sem medida (${e.feedbackSuperados} perdidos)` : '')}`
                    + `${c.prova.msStore !== undefined && c.prova.msStore !== null ? ` | store ${c.prova.msStore} ms painel ${c.prova.msPainel} ms` : ''}`
                    + `${c.prova.processadoDeclarado ? ` | processado ${c.prova.msProcessado} ms (${c.prova.naFonteProcessadaAntes} -> ${c.prova.naFonteProcessada} feicoes)` : ''}`
                    + `${c.erros.length ? `  ** CENARIO INVALIDO: ${c.erros.join('; ')}` : ''}`);
            }
        } catch (e) {
            reg.valida = false;
            reg.erros.push(`excecao: ${String(e && e.message ? e.message : e).slice(0, 300)}`);
            console.log(`  ** excecao na rodada ${rodada}: ${e && e.message}`);
        }
        await context.close();
        resultado.rodadas.push(reg);
    }

    await navegador.close();

    // O app tem de ser o MESMO em todas as cargas.
    const assinaturas = new Map();
    for (const rod of resultado.rodadas) {
        if (!rod.assinatura) continue;
        if (!assinaturas.has(rod.assinatura)) assinaturas.set(rod.assinatura, []);
        assinaturas.get(rod.assinatura).push(`r${rod.rodada}`);
    }
    resultado.ambiente.assinaturas = Object.fromEntries(assinaturas);
    resultado.ambiente.appMudou = assinaturas.size > 1;
    if (resultado.ambiente.appMudou) {
        for (const rod of resultado.rodadas) {
            rod.valida = false;
            rod.erros.push('o app mudou entre as cargas (assinatura distinta)');
        }
        console.log('\n** O APP MUDOU DURANTE A BANCADA. Assinaturas (camadas/fontes):');
        for (const [a, onde] of assinaturas) console.log(`   ${a}  <-  ${onde.join(', ')}`);
    }

    const tabela = montarTabela(resultado);
    resultado.tabela = tabela;
    fs.writeFileSync(path.join(params.saida, 'resultado.json'), JSON.stringify(resultado, null, 2));
    fs.writeFileSync(path.join(params.saida, 'resultado.md'), escreverMarkdown(resultado, tabela));

    console.log('');
    imprimirTabela(tabela);
    console.log('');
    console.log(tabela.nota);
    console.log(`relogio: ${resultado.ambiente.relogio} | renderer: ${resultado.ambiente.renderer}`);
    console.log(`playwright ${pw.versao} de ${pw.origem} (${pw.caminho})`);
    if (errosDaPagina.length) console.log(`\nerros da pagina (${errosDaPagina.length}): ${[...new Set(errosDaPagina)].slice(0, 5).join(' | ')}`);
    console.log(`\nsaida: ${params.saida}`);
}

// So roda quando chamado direto. Importado, expoe as partes puras para o
// autoteste, que e quem prova que a bancada reprova o insumo degenerado.
const chamadoDireto = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (chamadoDireto) principal().catch((e) => { console.error(e); process.exit(1); });

export {
    FERRAMENTAS, ORDEM_FERRAMENTAS, ORDEM_CENARIOS, CENARIOS, METRICAS, VISTA,
    MODOS_DESENHO, SEMEADURAS, GESTOS_CONCLUSAO, FORMAS_DE_PONTO, PONTOS_PADRAO,
    METODOS_DE_ESCRITA, MS_ESTAVEL,
    normalizarFerramenta, lerArgumentos, carregarPlaywright, percentil, mediana,
    estatistica, resumirEscritas, avaliarCadencia, celula, chavesDaTabela,
    montarTabela, escreverMarkdown, errosDeTerreno, errosDeControle,
    avaliarIdentidade, avaliarProntidao, validarLeituraDeTiles,
};
