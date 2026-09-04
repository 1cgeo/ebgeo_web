// Bancada de desempenho do EBGeo Web: terreno, render-to-texture e pilhas.
//
// Mede o custo do quadro (map._render), o intervalo entre quadros, as fases do
// MapLibre e os contadores de GL, sob variantes de estado do mapa. Cada variante
// parte de uma recarga da pagina e devolve a PROVA de que aplicou o que prometeu.
// A bancada reprova a si mesma antes de medir: renderer emulado invalida o
// relogio, aba oculta invalida a rodada, cadencia ociosa do rAF acima de 25 ms
// (p95) invalida a rodada, e o modulo que a bancada importou tem de ser o MESMO
// que o app usa.
//
// A saida de terminal e ASCII de proposito (o console do Windows abre em
// codepage 850 e comeria os acentos); a prosa acentuada vive nos comentarios,
// no README e no markdown gravado em disco, que sao UTF-8.
//
// Uso e armadilhas: ver bench/README.md.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
/** A raiz do PACOTE `frontend/`, que e onde `bench/` mora. */
const PACOTE = path.resolve(AQUI, '..');
/** A raiz do monorepo. */
const RAIZ = path.resolve(PACOTE, '..');

// --------------------------------------------------------------------------
// Vistas embutidas. Nome na linha de comando, coordenada aqui.
// --------------------------------------------------------------------------
const VISTAS = {
    'serra-gaucha': { center: [-50.87, -29.37], zoom: 12.5 },
    'porto-alegre': { center: [-51.23, -30.03], zoom: 13.5 },
    'alegrete': { center: [-55.79, -29.78], zoom: 12 },
};

// Tipos que o render-to-texture consegue drapear sobre o terreno. Camada de
// tipo fora desta lista quebra a pilha e abre uma nova.
const TIPOS_DRAPEAVEIS = new Set(['background', 'fill', 'line', 'raster', 'hillshade', 'color-relief']);
// Tipos que a variante quebra-pilha manda para o topo.
const TIPOS_QUEBRA_PILHA = ['symbol', 'circle', 'fill-extrusion', 'heatmap'];

const ORDEM_VARIANTES = [
    '2d',
    'terreno',
    'terreno-sem-hillshade',
    'terreno-quebra-pilha-topo',
    'terreno-vazias-escondidas',
    'terreno-vazias-removidas',
    'terreno-vazias-escondidas-quebra-pilha-topo',
];

const ORDEM_CENARIOS = ['parado', 'rotacao', 'pan', 'zoom', 'pitch'];

/**
 * Quanto tempo a dupla (camadas, fontes) precisa ficar PARADA antes de a bancada
 * aceitar que o app terminou de montar.
 */
const MS_ESTAVEL = 3000;

// Referencia medida: VAZIA nesta branch, de proposito.
//
// A tabela da `main` (2026-09-04) descreve OUTRO aplicativo: outra versao do
// MapLibre (a `main` roda a 6.7.0, esta branch tem a 5.18 vendorizada em
// `frontend/public/vendors/maplibre-gl.js`), outro conjunto de camadas e outro
// servidor de tiles. Copia-la para ca produziria DIVERGENTE em toda linha, e a
// divergencia estaria certa pelo motivo errado: nao e o app que mudou, e a
// referencia que e de outro app. Numero herdado mente com cara de medida.
//
// Como preencher: rode a bancada duas vezes com a arvore parada, na vista
// `serra-gaucha`, com janela visivel e GPU de verdade, e escreva aqui o que as
// duas concordaram, com a data e a maquina no README. Enquanto a lista estiver
// vazia, `conferirReferencia` DIZ que nao conferiu nada, em vez de sair calada.
const REFERENCIA = [];

// --------------------------------------------------------------------------
// Linha de comando
// --------------------------------------------------------------------------
function lerArgumentos(argv) {
    const p = {
        // O stack de desenvolvimento sobe pela raiz com `npm run dev`: backend na
        // 8080 e Vite na 3000. O `base` do Vite esta comentado em
        // `frontend/vite.config.js`, entao a pagina do mapa e a raiz do servidor.
        url: process.env.EBGEO_URL || 'http://localhost:3000/',
        vista: 'serra-gaucha',
        rodadas: 2,
        variantes: ORDEM_VARIANTES.slice(),
        saida: null,
        largura: 1600,
        altura: 900,
        headless: false,
        perfil: false,
        // Mapas base a comparar. 'atual' e o que o app abriu, sem troca.
        bases: ['atual'],
        // Fator de estrangulamento da CPU pelo CDP (1 = sem estrangular).
        cpu: 1,
        // Cria feicoes pelas ferramentas do app, uma vez, antes das rodadas.
        populado: false,
    };
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
        } else if (a === '--vista') {
            p.vista = proximo();
        } else if (a === '--rodadas') {
            p.rodadas = Number(proximo());
        } else if (a === '--variantes') {
            p.variantes = proximo().split(',').map((s) => s.trim()).filter(Boolean);
        } else if (a === '--saida') {
            p.saida = proximo();
        } else if (a === '--largura') {
            p.largura = Number(proximo());
        } else if (a === '--altura') {
            p.altura = Number(proximo());
        } else if (a === '--headless') {
            p.headless = booleana();
        } else if (a === '--perfil') {
            p.perfil = booleana();
        } else if (a === '--bases') {
            p.bases = proximo().split(',').map((s) => s.trim()).filter(Boolean);
        } else if (a === '--cpu') {
            p.cpu = Number(proximo());
        } else if (a === '--populado') {
            p.populado = booleana();
        } else if (a === '--ajuda' || a === '-h' || a === '--help') {
            p.ajuda = true;
        } else {
            throw new Error(`argumento desconhecido: ${a}`);
        }
    }
    if (!VISTAS[p.vista]) throw new Error(`vista desconhecida: ${p.vista}. Conhecidas: ${Object.keys(VISTAS).join(', ')}`);
    const desconhecidas = p.variantes.filter((v) => !ORDEM_VARIANTES.includes(v));
    if (desconhecidas.length) throw new Error(`variante desconhecida: ${desconhecidas.join(', ')}. Conhecidas: ${ORDEM_VARIANTES.join(', ')}`);
    // Mantem a ordem canonica, nao a ordem que o usuario digitou.
    p.variantes = ORDEM_VARIANTES.filter((v) => p.variantes.includes(v));
    if (!Number.isFinite(p.rodadas) || p.rodadas < 1) throw new Error('--rodadas tem de ser inteiro >= 1');
    if (!p.bases.length) throw new Error('--bases precisa de ao menos um id de mapa base (ou "atual")');
    if (new Set(p.bases).size !== p.bases.length) throw new Error(`--bases repete um id: ${p.bases.join(', ')}`);
    if (!Number.isFinite(p.cpu) || p.cpu < 1) throw new Error('--cpu tem de ser numero >= 1');
    if (!p.saida) {
        const carimbo = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        p.saida = path.join(AQUI, 'saida', carimbo);
    }
    p.saida = path.resolve(p.saida);
    return p;
}

const AJUDA = `
Bancada de desempenho do EBGeo Web (terreno e render-to-texture).

  node frontend/bench/desempenho-terreno.mjs [opcoes]

  --url <url>          padrao http://localhost:3000/ (ou EBGEO_URL). O stack de
                       desenvolvimento sobe pela raiz com "npm run dev".
  --vista <nome>       ${Object.keys(VISTAS).join(' | ')} (padrao serra-gaucha)
  --rodadas <n>        padrao 2 (a primeira e aquecimento e sai da tabela)
  --variantes <lista>  separada por virgula (padrao todas)
                       ${ORDEM_VARIANTES.join(', ')}
  --saida <pasta>      padrao frontend/bench/saida/<data-hora>/
  --largura <px>       padrao 1600
  --altura <px>        padrao 900
  --headless [bool]    padrao false (headless usa SwiftShader: o relogio nao vale)
  --perfil [bool]      padrao false (liga o profiler do CDP; ele infla o quadro)
  --bases <lista>      ids de mapa base do app, separados por virgula (padrao "atual", sem troca).
                       Cada caso base x variante parte de uma recarga e troca a base pelo mesmo
                       caminho do painel (BaseLayerControl.applySharedBasemap), sem persistir.
  --cpu <fator>        padrao 1. Estrangula a CPU pelo CDP (4 = maquina quatro vezes mais lenta).
  --populado [bool]    padrao false. Cria feicoes de 10 tipos pelas ferramentas do app, uma vez,
                       antes das rodadas; elas voltam em toda recarga do mesmo contexto.

O Playwright vem do proprio pacote frontend/ (dependencia declarada). A variavel
EBGEO_PLAYWRIGHT_DIR sobrepoe, apontando o diretorio que CONTEM node_modules/playwright.
`;

// --------------------------------------------------------------------------
// Playwright. Nesta branch ele e dependencia do PROPRIO pacote `frontend/`
// (`@playwright/test`, que traz `playwright`), entao nao ha variavel de outro
// projeto a definir. A variavel de ambiente continua existindo como escotilha.
// Nenhum caminho de maquina vive no codigo.
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
                // A origem entra no resultado; o caminho de maquina fica so no console.
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

// Estatistica de um lote de quadros vindos da pagina.
function estatistica(quadros) {
    if (!quadros || !quadros.length) return { quadros: 0 };
    const dts = quadros.map((f) => f.dt).sort((a, b) => a - b);
    const intervalos = [];
    for (let i = 1; i < quadros.length; i++) intervalos.push(quadros[i].t - quadros[i - 1].t);
    intervalos.sort((a, b) => a - b);
    const somaCnt = (k) => quadros.reduce((s, f) => s + (f[k] || 0), 0);
    const somaFase = (k) => quadros.reduce((s, f) => s + ((f.fases && f.fases[k]) || 0), 0);
    const n = quadros.length;
    return {
        quadros: n,
        render_ms: { p50: arred(percentil(dts, 0.5)), p95: arred(percentil(dts, 0.95)), max: arred(percentil(dts, 1)) },
        intervalo_ms: { p50: arred(percentil(intervalos, 0.5)), p95: arred(percentil(intervalos, 0.95)), max: arred(percentil(intervalos, 1)) },
        fases_ms_por_quadro: {
            updateSources: arred(somaFase('updateSources') / n, 2),
            placement: arred(somaFase('placement') / n, 2),
            painterRender: arred(somaFase('painterRender') / n, 2),
            rttPrepare: arred(somaFase('rttPrepare') / n, 2),
        },
        gl_por_quadro: {
            draw: Math.round(somaCnt('draw') / n),
            fbo: Math.round(somaCnt('fbo') / n),
            clear: Math.round(somaCnt('clear') / n),
            tex: Math.round(somaCnt('tex') / n),
            stamp: Math.round(somaCnt('stamp') / n),
            renderLayer: Math.round(somaCnt('renderLayer') / n),
        },
    };
}

// Agrega um perfil do CDP no top 20 de self time por funcao.
function agregarPerfil(profile) {
    const porNo = new Map();
    for (const n of profile.nodes) porNo.set(n.id, n);
    const self = new Map();
    const porGrupo = new Map();
    const dts = profile.timeDeltas || [];
    let total = 0;
    for (let i = 0; i < profile.samples.length; i++) {
        const no = porNo.get(profile.samples[i]);
        if (!no) continue;
        const dt = (dts[i] || 0) / 1000;
        total += dt;
        const cf = no.callFrame;
        const arquivo = (cf.url || '').replace(/^.*\//, '');
        const chave = `${cf.functionName || '(anon)'} @ ${arquivo}:${cf.lineNumber + 1}`;
        self.set(chave, (self.get(chave) || 0) + dt);
        const grupo = /maplibre/.test(cf.url) ? 'maplibre'
            : /\/src\/js\//.test(cf.url) ? 'app'
                : /turf|milsymbol/.test(cf.url) ? 'vendor'
                    : cf.url ? 'outro' : `(${cf.functionName || 'nativo/idle'})`;
        porGrupo.set(grupo, (porGrupo.get(grupo) || 0) + dt);
    }
    return {
        total_ms: arred(total, 0),
        grupos: Object.fromEntries([...porGrupo.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, arred(v, 0)])),
        top20: [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, v]) => ({ funcao: k, self_ms: arred(v, 0) })),
    };
}

// --------------------------------------------------------------------------
// Reguas puras do INSTRUMENTO. Sao elas que o autoteste ataca com o pior caso.
// --------------------------------------------------------------------------

/**
 * O modulo que a bancada importou tem de ser o MESMO que o app usa.
 *
 * O `vite dev` serve o arquivo recem-editado com `?t=<epoch>` de HMR, e um
 * `import()` que caia nessa URL recebe OUTRA instancia do modulo: o registro de
 * controles estaria vazio, o `getCurrentMapFeatures` leria outra store, e a
 * bancada mediria uma copia do sujeito com o nome do sujeito. A prova barata e o
 * mapa: o `map_sig.js` publica `globalThis.__ebgeoMap`, e o registro devolve o
 * mesmo objeto quando (e so quando) as duas pontas sao o mesmo modulo.
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
    // O MAPA SOZINHO NAO PROVA IDENTIDADE, e foi assim que a primeira versao
    // desta bancada passou por aqui achando que media o app. Medido em
    // 2026-09-04: o estado do registro de controles mora em
    // `store/control.registry.js`, que o HMR nao tinha invalidado, entao as DUAS
    // copias de `store/index.js` reexportavam o MESMO registro e o mapa batia; o
    // `tool_manager/tool-registry.js`, que guarda as dependencias e as
    // instancias, tinha sido invalidado, e a copia da bancada lancava
    // "tool-registry usado antes de initToolRegistry()". A identidade se prova
    // no modulo que guarda o ESTADO que se vai usar, um por um.
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
 * A leitura do estado dos tiles enxergou alguma coisa?
 *
 * No MapLibre 5.18 vendorizado, `tileManager.getIds()` devolve CHAVES e
 * `getTile(e)` espera um tileID (o corpo dele e `this.getTileByID(e.key)`): passar
 * a chave crua devolve `undefined` para TODO tile, e o leitor sairia com `?` em
 * cada posicao. O efeito e pior que um erro, porque a assinatura de tiles fica
 * constante e o `assentar()` declara "estaveis por 3 s" na primeira volta,
 * medindo o mapa no meio da carga. Esta regua existe para reprovar esse silencio.
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

/**
 * O que a celula precisa DIZER mesmo sem reprovar.
 *
 * O caso medido em 2026-09-04 no stack de desenvolvimento desta branch: o
 * servidor entrega `config.map2d.hillshade.enabled` FALSO, entao o terreno liga
 * sem hillshade nenhum. A medida e valida e o numero e real, mas ele descreve um
 * terreno SEM o passe de hillshade, e comparar essa celula com uma de um deploy
 * que o tem seria comparar duas coisas com o mesmo rotulo. Aviso, e nao erro:
 * reprovar mediria a configuracao do servidor; calar deixaria a diferenca
 * invisivel na tabela.
 *
 * @param {Object} prova - A prova do estado do mapa
 * @returns {string[]} Avisos que entram na celula
 */
function avisosDaVariante(prova) {
    if (!prova) return [];
    const avisos = [];
    if (prova.terreno && prova.hillshadeConfigurado === false) {
        avisos.push('SEM HILLSHADE (o servidor o declara desligado): o custo medido nao inclui o passe de hillshade');
    }
    return avisos;
}

/**
 * O app esta INTEIRO?
 *
 * O criterio nao e um numero de camadas escrito a mao (ele envelhece sozinho e
 * vira mentira com cara de medida), e sim a lista de fontes que o PROPRIO app
 * declara em `layers/layer.constants.js` (`FEATURE_SOURCES`). Enquanto uma delas
 * faltar, o que esta na tela e o estilo base sem o app por cima, e o quadro
 * medido ali descreve outro aplicativo.
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
// Codigo que roda dentro da pagina.
//
// Toda funcao daqui vai para o navegador por `fn.toString()`, entao nenhuma
// delas pode fechar sobre identificador do escopo do modulo: o que ela precisa
// chega por argumento ou por `window.__*`.
// --------------------------------------------------------------------------

/**
 * Importa os modulos do app pela URL que o PROPRIO app carregou.
 *
 * NO `vite dev`, UM MODULO TOCADO DESDE QUE O SERVIDOR SUBIU PASSA A SER SERVIDO
 * COM `?t=<epoch>` DE HMR, e um `import('/src/js/...')` sem a marca recebe OUTRA
 * INSTANCIA: estado de modulo zerado, registro de ferramentas sem dependencias,
 * e a bancada mede uma copia do sujeito com o nome do sujeito. Medido nesta
 * arvore em 2026-09-04: o app tinha carregado
 * `/src/js/tool_manager/tool-registry.js?t=1788551638589` e o import nu devolveu
 * um modulo cujo `ensureControl` lancava "usado antes de initToolRegistry()".
 *
 * A URL de verdade sai do Resource Timing. O buffer dele tem 250 entradas por
 * padrao e o app carrega 577 modulos em dev, entao a bancada o aumenta num
 * init script que roda ANTES da pagina; sem isso as primeiras entradas, que sao
 * justamente as do boot, se perdem.
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
        config: achar('/src/js/config.js'),
    };
    window.__urlsDoApp = urls;
    window.__store = await import(urls.store);
    window.__registro = await import(urls.registro);
    const lc = await import(urls.constantes);
    window.__fontesDoApp = Object.values(lc.FEATURE_SOURCES || {});
    const cfg = await import(urls.config);
    window.__config = cfg.default || cfg;
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
    // recem-nascida do modulo nao tem nenhuma. A lista de ansiosas sai da tabela
    // do proprio app, e nao de um nome escrito aqui.
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

// Instala os cronometros de fase, os contadores de GL e o registro por quadro.
function instrumentar() {
    const map = window.__mapa;
    const B = {
        fases: { updateSources: { ms: 0, n: 0 }, placement: { ms: 0, n: 0 }, painterRender: { ms: 0, n: 0 }, rttPrepare: { ms: 0, n: 0 } },
        envolvidas: {},
        cnt: { draw: 0, fbo: 0, clear: 0, tex: 0, stamp: 0, renderLayer: 0 },
        quadros: [],
    };
    window.__bancada = B;

    const envolve = (obj, nome, rotulo) => {
        if (!obj || typeof obj[nome] !== 'function') { B.envolvidas[rotulo] = false; return false; }
        const original = obj[nome].bind(obj);
        obj[nome] = function (...a) {
            const t = performance.now();
            const r = original(...a);
            B.fases[rotulo].ms += performance.now() - t;
            B.fases[rotulo].n++;
            return r;
        };
        B.envolvidas[rotulo] = true;
        return true;
    };
    envolve(map.style, '_updateSources', 'updateSources');
    envolve(map.style, '_updatePlacement', 'placement');
    envolve(map.painter, 'render', 'painterRender');

    // Contadores de GL. Draw, framebuffer, clear e upload de textura.
    const gl = map.painter.context.gl;
    for (const [nome, chave] of [['drawElements', 'draw'], ['drawArrays', 'draw'], ['texImage2D', 'tex'],
        ['texSubImage2D', 'tex'], ['bindFramebuffer', 'fbo'], ['clear', 'clear']]) {
        if (typeof gl[nome] !== 'function') continue;
        const original = gl[nome].bind(gl);
        gl[nome] = function (...a) { B.cnt[chave]++; return original(...a); };
    }
    const renderLayer = map.painter.renderLayer.bind(map.painter);
    map.painter.renderLayer = function (...a) { B.cnt.renderLayer++; return renderLayer(...a); };

    // Renderer real. SwiftShader ou llvmpipe significa GPU emulada.
    try {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        window.__renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'ext ausente';
        window.__fornecedor = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : 'ext ausente';
    } catch (e) { window.__renderer = `erro: ${String(e).slice(0, 80)}`; }

    // Registro por quadro: tempo do _render mais os deltas de contador e de fase.
    const originalRender = map._render.bind(map);
    map._render = function (...a) {
        const cntAntes = { ...B.cnt };
        const faseAntes = {};
        for (const k in B.fases) faseAntes[k] = B.fases[k].ms;
        const t = performance.now();
        const r = originalRender(...a);
        const quadro = { t, dt: performance.now() - t, fases: {} };
        for (const k in B.cnt) quadro[k] = B.cnt[k] - cntAntes[k];
        for (const k in B.fases) quadro.fases[k] = +(B.fases[k].ms - faseAntes[k]).toFixed(3);
        B.quadros.push(quadro);
        return r;
    };

    // So existe depois que o terreno liga.
    window.__armarTerreno = () => {
        const rtt = map.painter.renderToTexture;
        if (!rtt) return false;
        if (!rtt.__armado) {
            envolve(rtt, 'prepareForRender', 'rttPrepare');
            if (rtt.pool && typeof rtt.pool.stampObject === 'function') {
                const stamp = rtt.pool.stampObject.bind(rtt.pool);
                rtt.pool.stampObject = function (...a) { B.cnt.stamp++; return stamp(...a); };
            }
            rtt.__armado = true;
        }
        return true;
    };
    window.__zerar = () => { B.quadros = []; };
    return { envolvidas: B.envolvidas, renderer: window.__renderer, fornecedor: window.__fornecedor };
}

// Estado dos tiles de cada fonte, para decidir se o mapa assentou.
//
// `getIds()` devolve CHAVE, e no MapLibre 5.18 quem aceita chave e
// `getTileByID`; `getTile` espera um tileID e faria `e.key` numa string,
// devolvendo undefined para todo tile. A contagem de desconhecidos existe para
// a regua `validarLeituraDeTiles` poder reprovar um leitor cego.
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

// Prova do estado do mapa. Isto e o que a variante tem de mostrar.
function lerProva() {
    const map = window.__mapa;
    // O hillshade e OPCIONAL no servidor (`config.map2d.hillshade.enabled`, que
    // vem de `GET /api/config`). Sem ele o `TerrainControl` sai de
    // `_setHillshadeVisibility` na primeira linha e a camada nunca nasce.
    // Cobrar `visible` nesse caso mediria a configuracao do servidor, e nao a
    // variante; ignorar a diferenca seria pior, porque o passe de hillshade
    // custa caro e a celula sairia comparavel com uma que o tem.
    const cfg = window.__config || {};
    const hillshadeConfigurado = !!(cfg.map2d && cfg.map2d.hillshade && cfg.map2d.hillshade.enabled);
    const rtt = map.painter.renderToTexture;
    const tm = map.style.tileManagers || map.style.sourceCaches || {};
    const tilesPorFonte = {};
    for (const id in tm) tilesPorFonte[id] = tm[id].getIds ? tm[id].getIds().length : -1;
    let projecao = null;
    try { projecao = map.getProjection && map.getProjection() ? map.getProjection().type : null; } catch { projecao = null; }
    // Camada sem `layout.visibility` conta como visivel: e o padrao do MapLibre.
    const camadasVisiveis = map.getStyle().layers.filter((l) => !l.layout || l.layout.visibility !== 'none').length;
    // Feicoes vivas nas fontes GeoJSON do app: e a prova do estado populado.
    const estiloAtual = map.getStyle();
    let feicoes = 0;
    for (const id in estiloAtual.sources) {
        if (estiloAtual.sources[id].type !== 'geojson') continue;
        const src = map.getSource(id);
        // No MapLibre 5.18 vendorizado o `_data` da fonte GeoJSON E um envelope
        // (`{ updateable | url | geojson }`), e `serialize().data` e o unico que
        // devolve a colecao. Ler `_data` direto contaria toda fonte como vazia.
        const dados = src && typeof src.serialize === 'function' ? src.serialize().data : (src && src._data);
        if (dados && Array.isArray(dados.features)) feicoes += dados.features.length;
    }
    return {
        terreno: !!map.getTerrain(),
        estilo: estiloAtual.name || null,
        feicoes,
        camadasVisiveis,
        pilhas: rtt && rtt._stacks ? rtt._stacks.length : null,
        tilesTerreno: rtt ? (rtt._renderableTiles ? rtt._renderableTiles.length : null) : null,
        fontes: Object.keys(map.getStyle().sources).length,
        camadas: map.getStyle().layers.length,
        hillshade: map.getLayer('hillshade') ? (map.getLayoutProperty('hillshade', 'visibility') || 'visible') : 'ausente',
        hillshadeConfigurado,
        projecao,
        pitch: +map.getPitch().toFixed(1),
        zoom: +map.getZoom().toFixed(2),
        bearing: +map.getBearing().toFixed(1),
        visibilidade: document.visibilityState,
        pool: rtt && rtt.pool ? { objetos: rtt.pool._objects ? rtt.pool._objects.length : null } : null,
        tilesPorFonte,
    };
}

// Levanta as fontes GeoJSON sem feicao. Fonte cujo dado e uma string de URL nao
// da para julgar aqui, entao sai separada em vez de virar "vazia" calada.
function levantarVazias() {
    const map = window.__mapa;
    const estilo = map.getStyle();
    const vazias = [];
    const urlDesconhecida = [];
    for (const id in estilo.sources) {
        if (estilo.sources[id].type !== 'geojson') continue;
        const src = map.getSource(id);
        if (!src) continue;
        // serialize().data primeiro: na 5.18 vendorizada o `_data` e envelope, e
        // lido direto contaria TODA fonte como vazia.
        let dados = typeof src.serialize === 'function' ? src.serialize().data : undefined;
        if (dados === undefined) dados = src._data;
        if (typeof dados === 'string') { urlDesconhecida.push(id); continue; }
        const n = dados && Array.isArray(dados.features) ? dados.features.length
            : (dados && dados.type === 'Feature' ? 1 : 0);
        if (n === 0) vazias.push(id);
    }
    const camadas = estilo.layers.filter((l) => vazias.includes(l.source)).map((l) => l.id);
    return { vazias, urlDesconhecida, camadas };
}

// --------------------------------------------------------------------------
// Mapa base. A troca segue o caminho do painel (BaseLayerControl), e a prova
// sai do proprio app.
//
// Nesta branch o controle NAO tem `styleUrls`: a lista de bases vem do servidor
// (`config.basemaps`, hidratado por `GET /api/config`) e o estilo de cada id
// sai de `BaseLayerControl._styleFor(id)`, que e a mesma resolucao que a troca
// usa (modulo embutido, senao o estilo publicado). Nada aqui repete uma
// constante do app; se o estilo mudar, o esperado muda junto.
// --------------------------------------------------------------------------

// O que a base pedida tem de apresentar, lido do controle do app.
function lerEsperadoBase(id) {
    const ctl = window.__store.getControl('BaseLayerControl');
    if (!ctl) return { erro: 'BaseLayerControl ausente no registro de controles' };
    if (typeof ctl._styleFor !== 'function') {
        return { erro: 'BaseLayerControl nao expoe _styleFor(id): a bancada nao sabe qual estilo cada base tem neste app' };
    }
    const cfg = window.__config || {};
    const registradas = Object.keys(cfg.basemaps || {}).filter((k) => !!ctl._styleFor(k));
    const atual = ctl.currentLayer;
    const estilo = ctl._styleFor(id);
    if (!estilo) return { erro: `base "${id}" nao esta registrada no app (registradas: ${registradas.join(', ') || 'nenhuma'})`, atual };
    if (typeof estilo === 'string') {
        return { erro: `base "${id}" resolve para uma URL de estilo ("${estilo}"), e a bancada so sabe provar estilo em objeto`, atual };
    }
    const map = window.__mapa;
    const noMapa = map.getStyle();
    const fontes = Object.keys(estilo.sources || {});
    const camadas = (estilo.layers || []).map((l) => l.id);
    // O que e de OUTRA base e esta no mapa AGORA, lido do MAPA e nao do que o
    // controle acredita: um controle que erra a base corrente separaria base de
    // conteudo pelos ids errados, e a prova que confia nele aprovaria uma troca
    // que deixou a base anterior inteira por cima.
    const presentes = new Set(Object.keys(noMapa.sources || {}));
    const fontesAlheias = new Set();
    const camadasAlheias = new Set();
    for (const k of registradas) {
        if (k === id) continue;
        const s = ctl._styleFor(k);
        if (!s || typeof s === 'string') continue;
        for (const f of Object.keys(s.sources || {})) if (!fontes.includes(f) && presentes.has(f)) fontesAlheias.add(f);
        for (const l of s.layers || []) if (!camadas.includes(l.id) && map.getLayer(l.id)) camadasAlheias.add(l.id);
    }
    const estiloDoControleAtual = ctl._styleFor(atual);
    return {
        id,
        atual,
        registradas,
        estiloAntes: noMapa.name || null,
        estiloDoControleAntes: estiloDoControleAtual && typeof estiloDoControleAtual !== 'string'
            ? (estiloDoControleAtual.name || null) : null,
        estilo: estilo.name || null,
        fontes,
        camadas,
        // Fontes e camadas de outra base que estao no mapa antes da troca:
        // depois dela nao podem sobrar.
        fontesAnteriores: [...fontesAlheias],
        camadasAnteriores: [...camadasAlheias],
    };
}

async function trocarBasePagina(id) {
    const ctl = window.__store.getControl('BaseLayerControl');
    const t0 = performance.now();
    // Sem persistir: e visita, nao edicao do mapa salvo. E o mesmo caminho do
    // deep-link, que devolve o id REALMENTE aplicado em vez de ecoar o pedido.
    const aplicado = await ctl.applySharedBasemap(id);
    return { aplicado, ms: Math.round(performance.now() - t0) };
}

// Le o mapa depois da troca, com a vista assentada.
function lerProvaBase(esperado) {
    const map = window.__mapa;
    const estilo = map.getStyle();
    const tm = map.style.tileManagers || map.style.sourceCaches || {};
    const carregadosPorFonte = {};
    for (const f of esperado.fontes) {
        const cache = tm[f];
        if (!cache || !cache.getIds) { carregadosPorFonte[f] = null; continue; }
        carregadosPorFonte[f] = cache.getIds().filter((k) => {
            const t = cache.getTileByID ? cache.getTileByID(k) : (cache._tiles && cache._tiles[k]);
            return t && t.state === 'loaded';
        }).length;
    }
    const fontesPresentes = Object.keys(estilo.sources);
    return {
        estilo: estilo.name || null,
        atual: window.__store.getControl('BaseLayerControl').currentLayer,
        fontesPresentes: esperado.fontes.filter((f) => fontesPresentes.includes(f)),
        fontesAusentes: esperado.fontes.filter((f) => !fontesPresentes.includes(f)),
        fontesAnterioresRestantes: esperado.fontesAnteriores.filter((f) => fontesPresentes.includes(f)),
        camadasAnterioresRestantes: (esperado.camadasAnteriores || []).filter((id) => !!map.getLayer(id)),
        camadasPresentes: esperado.camadas.filter((id) => !!map.getLayer(id)).length,
        carregadosPorFonte,
        tilesCarregadosBase: Object.values(carregadosPorFonte).reduce((s, n) => s + (n || 0), 0),
        camadas: estilo.layers.length,
        fontes: fontesPresentes.length,
    };
}

/**
 * Regua pura da troca de base. O pior caso que ela existe para pegar: a troca
 * que nao aconteceu (estilo da base anterior), a base velha que sobrou por
 * baixo, a camada que faltou e a base sem tile carregado (estilo certo com o
 * mapa em branco).
 *
 * @param {Object} prova - Leitura do mapa depois da troca
 * @param {Object} esperado - O que o controle do app diz que a base tem
 * @returns {string[]} Motivos de reprova
 */
function validarBase(prova, esperado) {
    if (esperado.erro) return [esperado.erro];
    const erros = [];
    // O controle tem de saber com que base o mapa esta ANTES da troca, senao a
    // troca separa base de conteudo pelos ids errados (defeito do app).
    if (esperado.estiloDoControleAntes !== undefined && esperado.estiloAntes !== undefined && esperado.estiloDoControleAntes !== esperado.estiloAntes) {
        erros.push(`antes da troca o controle dizia "${esperado.atual}" (estilo "${esperado.estiloDoControleAntes}") e o mapa mostrava "${esperado.estiloAntes}": o app nao sabe que base tem`);
    }
    if (prova.atual !== esperado.id) erros.push(`o controle diz base "${prova.atual}", pedida "${esperado.id}"`);
    if (prova.estilo !== esperado.estilo) erros.push(`estilo "${prova.estilo}", esperado "${esperado.estilo}": a troca nao aconteceu`);
    if ((prova.fontesAusentes || []).length) erros.push(`fontes da base ausentes: ${prova.fontesAusentes.join(', ')}`);
    if ((prova.fontesAnterioresRestantes || []).length) erros.push(`fontes da base anterior sobraram: ${prova.fontesAnterioresRestantes.join(', ')}`);
    if ((prova.camadasAnterioresRestantes || []).length) erros.push(`${prova.camadasAnterioresRestantes.length} camadas de outra base sobraram (ex.: ${prova.camadasAnterioresRestantes.slice(0, 3).join(', ')})`);
    if (prova.camadasPresentes !== esperado.camadas.length) erros.push(`${prova.camadasPresentes} camadas da base no mapa, esperadas ${esperado.camadas.length}`);
    if (!prova.tilesCarregadosBase) erros.push('nenhum tile da base carregado: estilo certo com o mapa em branco');
    return erros;
}

// Cria feicoes pelas ferramentas do app, em volta da vista. E o caminho do
// usuario (createFeature de cada controle): persiste no store e volta na
// recarga. Devolve quantas ficaram, por controle.
//
// Nesta branch a maioria das ferramentas e TARDIA: `getControl('AddXControl')`
// devolve um STAND-IN ate alguem chamar `ensureControl(<chave>)`. Chamar
// `createFeature` no stand-in nao cria nada e nao lanca, entao o plano abaixo
// resolve a chave pela TABELA DO PROPRIO APP (`FERRAMENTAS` do tool-registry) em
// vez de repetir uma lista aqui, e espera a instancia de verdade.
async function popularPagina({ vista, plano }) {
    const { getControl } = window.__store;
    const registro = window.__registro;
    const tabela = (registro && registro.FERRAMENTAS) || {};
    const chaveDe = (classe) => Object.keys(tabela).find((k) => tabela[k].classe === classe) || null;
    const rnd = (a) => (Math.random() * 2 - 1) * a;
    const perto = (r = 0.03) => [vista.center[0] + rnd(r), vista.center[1] + rnd(r)];
    const caminho = (n, r = 0.01) => { const c = perto(0.025); const pts = []; for (let i = 0; i < n; i++) pts.push([c[0] + rnd(r) + i * 0.003, c[1] + rnd(r)]); return pts; };
    const anel = (n, r = 0.004) => { const c = perto(0.025); const pts = []; for (let i = 0; i < n; i++) { const a = (i / n) * 2 * Math.PI; pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); } return pts; };
    const semear = {
        caminho5: (c) => { c.drawPoints = caminho(5); return c.createFeature(); },
        anel6: (c) => { c.drawPoints = anel(6); return c.createFeature(); },
        caminho4: (c) => { c.drawPoints = caminho(4); return c.createFeature(); },
        traco20: (c) => { c.drawPoints = caminho(20, 0.002); return c.createFeature(); },
        doisPontos: (d) => (c) => { const p = perto(); c.drawPoints = [p, [p[0] + d[0], p[1] + d[1]]]; return c.createFeature(); },
    };
    const receita = {
        caminho5: semear.caminho5,
        anel6: semear.anel6,
        caminho4: semear.caminho4,
        traco20: semear.traco20,
        raio: semear.doisPontos([0.004, 0]),
        diagonal: semear.doisPontos([0.005, 0.003]),
        oval: semear.doisPontos([0.005, 0.002]),
    };
    const porControle = {};
    const ausentes = [];
    let total = 0;
    for (const [classe, n, forma] of plano) {
        const chave = chaveDe(classe);
        if (!chave) { ausentes.push(`${classe} (fora da tabela do tool-registry)`); continue; }
        let ctrl = null;
        try {
            ctrl = registro && typeof registro.ensureControl === 'function'
                ? await registro.ensureControl(chave)
                : getControl(classe);
        } catch (e) { ausentes.push(`${classe} (ensureControl: ${String(e && e.message ? e.message : e).slice(0, 80)})`); continue; }
        if (!ctrl || ctrl.ehStandInDeFerramenta || typeof ctrl.createFeature !== 'function') {
            ausentes.push(`${classe} (${ctrl && ctrl.ehStandInDeFerramenta ? 'ainda e stand-in' : 'sem createFeature'})`);
            continue;
        }
        porControle[classe] = 0;
        for (let i = 0; i < n; i++) {
            try { await receita[forma](ctrl); porControle[classe]++; total++; } catch (_e) { /* conta so o que ficou */ }
        }
    }
    // O que o STORE guardou e a verdade sobre o estado populado, nao o numero de
    // chamadas.
    await new Promise((r) => setTimeout(r, 1500));
    let persistidas = null;
    try {
        const f = await window.__store.getCurrentMapFeatures();
        persistidas = { total: 0, porTipo: {} };
        for (const [tipo, lista] of Object.entries(f || {})) {
            const n = Array.isArray(lista) ? lista.length : 0;
            if (n) persistidas.porTipo[tipo] = n;
            persistidas.total += n;
        }
    } catch (e) {
        persistidas = { total: 0, erro: String(e && e.message ? e.message : e) };
    }
    return { total, porControle, ausentes, persistidas };
}

/**
 * O plano de povoamento: classe do controle, quantas feicoes, e a forma da
 * semeadura. A CHAVE do controle no registro do app sai da tabela do proprio
 * app, dentro da pagina.
 */
const PLANO_POPULAR = [
    ['AddLineControl', 15, 'caminho5'],
    ['AddPolygonControl', 10, 'anel6'],
    ['AddCircleControl', 5, 'raio'],
    ['AddSectorControl', 5, 'diagonal'],
    ['AddEllipseControl', 5, 'oval'],
    ['AddRectangleControl', 5, 'diagonal'],
    ['AddArrowControl', 5, 'caminho4'],
    ['AddBrushControl', 3, 'traco20'],
    ['AddBoundaryControl', 3, 'caminho4'],
    ['AddCoordinationLineControl', 3, 'caminho4'],
];

// --------------------------------------------------------------------------
// Variantes. Cada uma prepara o estado a partir da base recarregada.
// --------------------------------------------------------------------------
const VARIANTES = {
    '2d': {
        terreno: false,
        // A base ja vem em pitch 0 e sem terreno; nada a fazer.
        aplicar: async () => ({ nota: 'estado base, sem terreno' }),
        validar: (prova) => {
            const erros = [];
            if (prova.terreno) erros.push('getTerrain() nao e nulo em 2d');
            if (prova.pitch !== 0) erros.push(`pitch ${prova.pitch} deveria ser 0`);
            return erros;
        },
    },
    'terreno': {
        terreno: true,
        aplicar: async (ctx) => ctx.ligarTerreno(),
        validar: (prova) => {
            const erros = [];
            if (!prova.terreno) erros.push('getTerrain() nulo depois do toggle');
            if (prova.pitch < 55) erros.push(`pitch ${prova.pitch} abaixo de 55`);
            // So se cobra hillshade de um app que declara ter hillshade. Onde o
            // servidor o desliga, a ausencia e a configuracao, e ela vira AVISO
            // na celula (ver `avisosDaVariante`), nunca um verde calado.
            if (prova.hillshadeConfigurado && prova.hillshade !== 'visible') {
                erros.push(`hillshade ${prova.hillshade}, esperado visible`);
            }
            if (prova.hillshadeConfigurado === false && prova.hillshade === 'visible') {
                erros.push('o servidor declara hillshade desligado e a camada esta visivel: a prova nao sabe o que esta medindo');
            }
            if (!prova.pilhas) erros.push('nenhuma pilha de render-to-texture');
            return erros;
        },
    },
    'terreno-sem-hillshade': {
        terreno: true,
        aplicar: async (ctx) => {
            const t = await ctx.ligarTerreno();
            await ctx.page.evaluate(() => {
                if (window.__mapa.getLayer('hillshade')) window.__mapa.setLayoutProperty('hillshade', 'visibility', 'none');
            });
            return { ...t, hillshadeEscondido: true };
        },
        validar: (prova) => {
            const erros = [];
            if (!prova.terreno) erros.push('getTerrain() nulo');
            // Sem hillshade configurado esta variante nao esconde nada e mede
            // exatamente o que `terreno` mede: duas linhas iguais com nomes
            // diferentes sao pior que uma linha a menos.
            if (prova.hillshadeConfigurado === false) {
                erros.push('o servidor declara hillshade desligado (config.map2d.hillshade.enabled falso): '
                    + 'nao ha hillshade para esconder, e esta variante nao contrasta mais com `terreno`');
            } else if (prova.hillshade !== 'none') {
                erros.push(`hillshade ${prova.hillshade}, esperado none`);
            }
            return erros;
        },
    },
    'terreno-quebra-pilha-topo': {
        terreno: true,
        aplicar: async (ctx) => {
            const t = await ctx.ligarTerreno();
            const r = await ctx.moverQuebraPilha();
            return { ...t, ...r };
        },
        validar: (prova, detalhe) => {
            const erros = [];
            if (!prova.terreno) erros.push('getTerrain() nulo');
            if (!detalhe.movidas) erros.push('nenhuma camada movida para o topo');
            if (detalhe.pilhasAntes !== null && prova.pilhas !== null && prova.pilhas >= detalhe.pilhasAntes) {
                erros.push(`pilhas ${prova.pilhas} nao caiu de ${detalhe.pilhasAntes}: a reordenacao nao surtiu efeito`);
            }
            return erros;
        },
    },
    'terreno-vazias-escondidas': {
        terreno: true,
        aplicar: async (ctx) => {
            const t = await ctx.ligarTerreno();
            const r = await ctx.esconderVazias();
            return { ...t, ...r };
        },
        validar: (prova, detalhe) => {
            const erros = [];
            if (!prova.terreno) erros.push('getTerrain() nulo');
            if (!detalhe.camadasEscondidas) {
                erros.push(`nenhuma camada mudou de visivel para none (${detalhe.camadasJaEscondidas || 0} de ${detalhe.camadasAlvo || 0} ja estavam escondidas): `
                    + 'o app provavelmente ja esconde a camada de fonte vazia sozinho, e esta variante nao contrasta mais com `terreno`');
            }
            if (detalhe.camadasAntes !== prova.camadas) erros.push('esconder nao pode mudar a contagem de camadas');
            return erros;
        },
    },
    'terreno-vazias-removidas': {
        terreno: true,
        aplicar: async (ctx) => {
            const t = await ctx.ligarTerreno();
            const r = await ctx.removerVazias();
            return { ...t, ...r };
        },
        validar: (prova, detalhe) => {
            const erros = [];
            if (!prova.terreno) erros.push('getTerrain() nulo');
            if (!detalhe.fontesRemovidas) erros.push('nenhuma fonte vazia removida');
            if (prova.camadas >= detalhe.camadasAntes) erros.push(`camadas ${prova.camadas} nao caiu de ${detalhe.camadasAntes}`);
            if (prova.fontes >= detalhe.fontesAntes) erros.push(`fontes ${prova.fontes} nao caiu de ${detalhe.fontesAntes}`);
            return erros;
        },
    },
    'terreno-vazias-escondidas-quebra-pilha-topo': {
        terreno: true,
        aplicar: async (ctx) => {
            const t = await ctx.ligarTerreno();
            const a = await ctx.esconderVazias();
            const b = await ctx.moverQuebraPilha();
            return { ...t, ...a, ...b };
        },
        validar: (prova, detalhe) => {
            const erros = [];
            if (!prova.terreno) erros.push('getTerrain() nulo');
            if (!detalhe.camadasEscondidas) {
                erros.push(`nenhuma camada mudou de visivel para none (${detalhe.camadasJaEscondidas || 0} de ${detalhe.camadasAlvo || 0} ja estavam escondidas): `
                    + 'o app provavelmente ja esconde a camada de fonte vazia sozinho, e esta variante nao contrasta mais com `terreno`');
            }
            if (!detalhe.movidas) erros.push('nenhuma camada movida para o topo');
            if (detalhe.pilhasAntes !== null && prova.pilhas !== null && prova.pilhas >= detalhe.pilhasAntes) {
                erros.push(`pilhas ${prova.pilhas} nao caiu de ${detalhe.pilhasAntes}`);
            }
            return erros;
        },
    },
};

// --------------------------------------------------------------------------
// Motor
// --------------------------------------------------------------------------
class Bancada {
    constructor(page, params) {
        this.page = page;
        this.params = params;
        this.vista = VISTAS[params.vista];
        this.cdp = null;
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
        // Os modulos do app que a bancada usa. O store e o registro de
        // ferramentas guardam ESTADO de modulo, entao importar outra copia deles
        // mediria outro aplicativo; `avaliarIdentidade` cobra isso logo abaixo.
        const urls = await this.page.evaluate(carregarModulosDoApp);
        this.urlsDoApp = urls;
        // Laco do lado do Node. Predicado async em waitForFunction passa na hora.
        //
        // O criterio de "app inteiro" e a lista de fontes que o app declara, e
        // nao um numero de camadas escrito a mao: o catalogo entra DEPOIS do
        // estilo base, e a base sozinha fica estavel por segundos.
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
        const instr = await this.page.evaluate(instrumentar);
        const baseAtual = await this.page.evaluate(() => {
            const c = window.__store.getControl('BaseLayerControl');
            return c ? c.currentLayer : null;
        });
        return { ...pronto, ms: Date.now() - t0, instrumentacao: instr, baseAtual };
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
            // Leitor cego deixa a assinatura constante, e "estavel por 3 s" viraria
            // verdade trivial. Nesse caso so `map.loaded()` vale.
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

    async irParaVistaBase() {
        await this.page.evaluate((v) => { window.__mapa.jumpTo({ center: v.center, zoom: v.zoom, pitch: 0, bearing: 0 }); }, this.vista);
    }

    // Troca o mapa base pelo caminho do painel e devolve o esperado (lido do
    // app) e o que a troca disse ter aplicado. A prova vem depois, com a vista
    // assentada, em provarBase().
    async trocarBase(id) {
        const esperado = await this.page.evaluate(lerEsperadoBase, id);
        if (esperado.erro) return { esperado, troca: null };
        const troca = await this.page.evaluate(trocarBasePagina, id);
        await this.assentar();
        await this.esperarQuadros(3);
        return { esperado, troca };
    }

    async provarBase(esperado) {
        return this.page.evaluate(lerProvaBase, esperado);
    }

    async popular() {
        const r = await this.page.evaluate(popularPagina, { vista: this.vista, plano: PLANO_POPULAR });
        // As ferramentas deixam selecao e feedback no mapa; a recarga limpa.
        await dorme(1500);
        return r;
    }

    // --- acoes das variantes ---

    async ligarTerreno() {
        const antes = await this.page.evaluate(lerProva);
        await this.page.evaluate(async () => { await window.__store.getControl('TerrainControl')._toggleTerrain(); });
        // O controle faz easeTo de pitch com 500 ms; espera o gesto acabar.
        await dorme(1200);
        const armado = await this.page.evaluate(() => window.__armarTerreno());
        await this.assentar();
        await this.esperarQuadros(3);
        const depois = await this.page.evaluate(lerProva);
        return { rttArmado: armado, pilhasAntes: antes.pilhas, pilhasComTerreno: depois.pilhas };
    }

    async moverQuebraPilha() {
        const antes = await this.page.evaluate(lerProva);
        const r = await this.page.evaluate(({ tipos, drapeaveis }) => {
            const map = window.__mapa;
            const alvo = new Set(tipos);
            const drap = new Set(drapeaveis);
            const camadas = map.getStyle().layers;
            const naoDrapeaveis = camadas.filter((l) => !drap.has(l.type)).length;
            let movidas = 0;
            // Itera na ordem do estilo e manda cada uma para o fim: a ordem
            // relativa entre as movidas se preserva.
            for (const l of camadas) if (alvo.has(l.type)) { map.moveLayer(l.id); movidas++; }
            return { movidas, naoDrapeaveis, tiposPresentes: [...new Set(camadas.map((l) => l.type))].sort() };
        }, { tipos: TIPOS_QUEBRA_PILHA, drapeaveis: [...TIPOS_DRAPEAVEIS] });
        await this.assentar();
        await this.esperarQuadros(3);
        return { ...r, pilhasAntes: antes.pilhas };
    }

    async esconderVazias() {
        const antes = await this.page.evaluate(lerProva);
        const r = await this.page.evaluate(() => {
            const map = window.__mapa;
            const lev = window.__levantarVazias();
            // Conta a camada que MUDOU de visivel para none, nao a camada que a
            // variante mirou. Se o app ja esconder essas camadas sozinho, a
            // variante nao faz nada, e contar o alvo aprovaria uma variante inerte.
            let escondidas = 0;
            let jaEscondidas = 0;
            for (const id of lev.camadas) {
                if (!map.getLayer(id)) continue;
                if (map.getLayoutProperty(id, 'visibility') === 'none') { jaEscondidas++; continue; }
                map.setLayoutProperty(id, 'visibility', 'none');
                escondidas++;
            }
            return {
                fontesVazias: lev.vazias.length,
                camadasAlvo: lev.camadas.length,
                camadasEscondidas: escondidas,
                camadasJaEscondidas: jaEscondidas,
                fontesUrlDesconhecidas: lev.urlDesconhecida.length,
                exemploFontes: lev.vazias.slice(0, 5),
            };
        });
        await this.assentar();
        await this.esperarQuadros(3);
        return { ...r, camadasAntes: antes.camadas, fontesAntes: antes.fontes, pilhasAntes: antes.pilhas };
    }

    async removerVazias() {
        const antes = await this.page.evaluate(lerProva);
        const r = await this.page.evaluate(() => {
            const map = window.__mapa;
            const lev = window.__levantarVazias();
            let camadas = 0;
            for (const id of lev.camadas) if (map.getLayer(id)) { map.removeLayer(id); camadas++; }
            let fontes = 0;
            for (const id of lev.vazias) if (map.getSource(id)) { map.removeSource(id); fontes++; }
            return { fontesRemovidas: fontes, camadasRemovidas: camadas, fontesUrlDesconhecidas: lev.urlDesconhecida.length, exemploFontes: lev.vazias.slice(0, 5) };
        });
        await this.assentar();
        await this.esperarQuadros(3);
        return { ...r, camadasAntes: antes.camadas, fontesAntes: antes.fontes, pilhasAntes: antes.pilhas };
    }

    // Forca n quadros para o estado derivado (pilhas, tiles do RTT) se refazer.
    async esperarQuadros(n) {
        await this.page.evaluate((n) => new Promise((r) => {
            const map = window.__mapa;
            let i = 0;
            const f = () => { map.triggerRepaint(); if (++i < n) requestAnimationFrame(f); else requestAnimationFrame(() => r()); };
            requestAnimationFrame(f);
        }), n);
    }

    // --- cenarios ---

    async cenarioParado(ms = 2000) {
        await this.page.evaluate(() => window.__zerar());
        await this.page.evaluate((ms) => new Promise((r) => {
            const map = window.__mapa;
            const t0 = performance.now();
            const f = () => { map.triggerRepaint(); if (performance.now() - t0 < ms) requestAnimationFrame(f); else r(); };
            requestAnimationFrame(f);
        }), ms);
    }

    async gesto(opcoes) {
        await this.page.evaluate((o) => new Promise((r) => {
            const map = window.__mapa;
            const pronto = () => r();
            map.once('moveend', pronto);
            map.easeTo({ ...o, easing: (t) => t });
            // Rede de seguranca: moveend perdido nao pode travar a bancada.
            setTimeout(() => { map.off('moveend', pronto); r(); }, (o.duration || 1000) + 4000);
        }), opcoes);
    }

    async rodarCenario(nome, prova) {
        const assentou = await this.assentar();
        await this.page.evaluate(() => window.__zerar());
        if (nome === 'parado') {
            await this.cenarioParado(2000);
        } else if (nome === 'rotacao') {
            await this.gesto({ bearing: (prova.bearing + 90) % 360, duration: 3000 });
        } else if (nome === 'pan') {
            await this.gesto({ center: [this.vista.center[0] + 0.02, this.vista.center[1]], duration: 3000 });
        } else if (nome === 'zoom') {
            await this.gesto({ zoom: prova.zoom + 1, duration: 1500 });
            await this.gesto({ zoom: prova.zoom, duration: 1500 });
        } else if (nome === 'pitch') {
            await this.gesto({ pitch: 30, duration: 1500 });
            await this.gesto({ pitch: prova.pitch, duration: 1500 });
        }
        const quadros = await this.page.evaluate(() => window.__bancada.quadros);
        const est = estatistica(quadros);
        const depois = await this.page.evaluate(lerProva);
        // Prova de que o cenario trabalhou.
        const erros = [];
        if (!est.quadros) erros.push('zero quadros medidos');
        if (depois.visibilidade !== 'visible') erros.push(`visibilityState ${depois.visibilidade}`);
        // O app que ganha fonte ou camada no meio do cenario ainda estava
        // carregando, e o numero medido descreve outro app.
        if (depois.fontes !== prova.fontes) erros.push(`fontes mudaram durante o cenario (${prova.fontes} -> ${depois.fontes})`);
        if (depois.camadas !== prova.camadas) erros.push(`camadas mudaram durante o cenario (${prova.camadas} -> ${depois.camadas})`);
        if (depois.terreno && est.quadros) {
            const st = est.gl_por_quadro.stamp;
            if (!st && !depois.pilhas) erros.push('terreno ligado mas sem stamps nem pilhas');
        }
        erros.push(...(assentou.erros || []));
        return { cenario: nome, assentou, estatistica: est, provaFinal: depois, erros };
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
    ['render p50', (c) => c.estatistica.render_ms && c.estatistica.render_ms.p50],
    ['interv p50', (c) => c.estatistica.intervalo_ms && c.estatistica.intervalo_ms.p50],
    ['interv p95', (c) => c.estatistica.intervalo_ms && c.estatistica.intervalo_ms.p95],
    ['updSrc/q', (c) => c.estatistica.fases_ms_por_quadro && c.estatistica.fases_ms_por_quadro.updateSources],
    ['prep/q', (c) => c.estatistica.fases_ms_por_quadro && c.estatistica.fases_ms_por_quadro.rttPrepare],
    ['draw/q', (c) => c.estatistica.gl_por_quadro && c.estatistica.gl_por_quadro.draw],
    ['stamps/q', (c) => c.estatistica.gl_por_quadro && c.estatistica.gl_por_quadro.stamp],
    ['pilhas', (c) => c.provaFinal.pilhas],
    ['fontes', (c) => c.provaFinal.fontes],
];

// Nome das metricas para a conferencia contra a referencia.
const METRICA_REF = {
    render_p50: (c) => c.estatistica.render_ms && c.estatistica.render_ms.p50,
    draw_por_quadro: (c) => c.estatistica.gl_por_quadro && c.estatistica.gl_por_quadro.draw,
    pilhas: (c) => c.provaFinal.pilhas,
    tilesTerreno: (c) => c.provaFinal.tilesTerreno,
};

function montarTabela(resultado) {
    const usadas = resultado.rodadas.filter((r) => !r.aquecimento && r.valida);
    const base = usadas.length ? usadas : resultado.rodadas;
    const aquece = resultado.parametros.rodadas > 1 ? 'a rodada 1 e aquecimento e ficou de fora'
        : 'rodada unica: nao ha aquecimento a descartar';
    const nota = usadas.length ? `rodadas usadas: ${base.map((r) => r.rodada).join(', ')} (${aquece})`
        : 'NENHUMA rodada valida fora do aquecimento; a tabela usa TODAS as rodadas e o resultado nao vale';
    const linhas = [];
    const bases = resultado.parametros.bases || ['atual'];
    for (const variante of resultado.parametros.variantes) {
        for (const nomeBase of bases) {
            for (const cenario of ORDEM_CENARIOS) {
                const celulas = [];
                const vereditos = new Set();
                for (const rod of base) {
                    const v = rod.variantes.find((x) => x.variante === variante && (x.base || 'atual') === nomeBase);
                    if (!v) continue;
                    const c = v.cenarios.find((x) => x.cenario === cenario);
                    if (!c) continue;
                    celulas.push(c);
                    if (!v.valida) vereditos.add('VARIANTE INVALIDA');
                    if (c.erros.length) vereditos.add('CENARIO INVALIDO');
                    if (!rod.valida) vereditos.add('RODADA INVALIDA');
                    // Aviso NAO invalida, mas tem de aparecer: uma celula sem
                    // hillshade nao se compara com uma que o tem.
                    for (const a of avisosDaVariante(v.prova)) vereditos.add(a.split(' (')[0]);
                }
                if (!celulas.length) continue;
                if (resultado.ambiente.relogio !== 'valido') vereditos.add(resultado.ambiente.relogio);
                if (resultado.ambiente.appMudou) vereditos.add('APP MUDOU ENTRE AS CARGAS');
                const veredito = vereditos.size ? [...vereditos].join('; ') : 'ok';
                linhas.push({
                    base: nomeBase, variante, cenario,
                    valores: METRICAS.map(([nome, ler]) => ({ nome, texto: celula(celulas.map(ler)) })),
                    veredito,
                });
            }
        }
    }
    return { linhas, nota };
}

// A referencia foi medida na base com que o app abre. Caso de outra base fica
// fora da conferencia, em vez de divergir por fator 2 e mentir sobre a causa.
function casoNaBaseInicial(v, resultado) {
    const b = v.base || 'atual';
    return b === 'atual' || b === (resultado.ambiente && resultado.ambiente.baseInicial);
}

/**
 * Confere o que a rodada mediu contra a tabela de referencia.
 *
 * A tabela chega por argumento (e nao por leitura direta da constante) para o
 * autoteste poder atacar a regua com uma referencia sintetica: a constante desta
 * branch esta VAZIA de proposito, e uma regua que so roda contra lista vazia
 * nunca foi vista funcionar.
 *
 * @param {Object} resultado - O resultado inteiro da bancada
 * @param {Array} [referencia] - A tabela de referencia
 * @returns {Array} Uma linha por item conferido
 */
function conferirReferencia(resultado, referencia = REFERENCIA) {
    if (!referencia.length) {
        return [{ item: 'conferencia', situacao: 'NAO CONFERIDA: a tabela de referencia desta branch esta vazia (ver o comentario de REFERENCIA em bench/desempenho-terreno.mjs)' }];
    }
    if (resultado.parametros.vista !== 'serra-gaucha') {
        return [{ item: 'conferencia', situacao: `pulada: a referencia e da vista serra-gaucha, e esta rodada usou ${resultado.parametros.vista}` }];
    }
    const usadas = resultado.rodadas.filter((r) => !r.aquecimento && r.valida);
    const base = usadas.length ? usadas : resultado.rodadas;
    const saida = [];
    for (const ref of referencia) {
        if (!resultado.parametros.variantes.includes(ref.variante)) continue;
        const ler = METRICA_REF[ref.metrica];
        const vals = [];
        for (const rod of base) {
            const v = rod.variantes.find((x) => x.variante === ref.variante && casoNaBaseInicial(x, resultado));
            const c = v && v.cenarios.find((x) => x.cenario === ref.cenario);
            if (c) { const x = ler(c); if (x !== null && x !== undefined) vals.push(x); }
        }
        if (!vals.length) continue;
        const med = mediana(vals);
        const relogioVale = resultado.ambiente.relogio === 'valido';
        const eTempo = ref.metrica === 'render_p50';
        const fator = med === 0 ? (ref.valor === 0 ? 1 : Infinity) : med / ref.valor;
        const fora = fator >= 2 || fator <= 0.5;
        saida.push({
            item: `${ref.variante} / ${ref.cenario} / ${ref.metrica}`,
            esperado: ref.valor,
            medido: arred(med, 2),
            fator: arred(fator, 2),
            situacao: (eTempo && !relogioVale) ? 'nao conferido (relogio invalido)' : (fora ? 'DIVERGENTE por fator 2 ou mais' : 'dentro do fator 2'),
        });
    }
    const basesPedidas = resultado.parametros.bases || ['atual'];
    if (!saida.length && basesPedidas.every((b) => b !== 'atual' && b !== (resultado.ambiente && resultado.ambiente.baseInicial))) {
        saida.push({ item: 'conferencia', situacao: `pulada: a referencia e da base com que o app abre (${(resultado.ambiente && resultado.ambiente.baseInicial) || '?'}), e esta rodada mediu ${basesPedidas.join(', ')}` });
    }
    return saida;
}

function escreverMarkdown(resultado, tabela, conferencia) {
    const l = [];
    l.push('# Bancada de desempenho do EBGeo Web');
    l.push('');
    l.push(`Data: ${resultado.ambiente.quando}`);
    l.push(`URL: ${resultado.parametros.url} | vista: ${resultado.parametros.vista} | viewport: ${resultado.parametros.largura}x${resultado.parametros.altura} | headless: ${resultado.parametros.headless}`);
    l.push(`Renderer: ${resultado.ambiente.renderer}`);
    l.push(`Relogio: ${resultado.ambiente.relogio}`);
    l.push(`Bases: ${(resultado.parametros.bases || ['atual']).join(', ')} (base com que o app abre: ${resultado.ambiente.baseInicial || '?'}) | CPU: ${resultado.ambiente.cpu || 1}x | populado: ${resultado.parametros.populado ? `${resultado.ambiente.populacao ? resultado.ambiente.populacao.total : '?'} feicoes pelas ferramentas` : 'nao'}`);
    l.push(`Playwright ${resultado.ambiente.playwrightVersao}, carregado de ${resultado.ambiente.playwrightOrigem}`);
    l.push(`Rodadas: ${resultado.parametros.rodadas}. ${tabela.nota}`);
    const ass = resultado.ambiente.assinaturasBase || {};
    l.push(`Assinatura base do app (camadas/fontes/camadas visiveis): ${Object.keys(ass).join('  |  ') || '-'}`);
    if (resultado.ambiente.appMudou) {
        l.push('');
        l.push('**O APP MUDOU DURANTE A BANCADA.** As cargas nao viram o mesmo aplicativo, e a tabela');
        l.push('abaixo compara versoes diferentes com o mesmo rotulo. Onde cada assinatura apareceu:');
        for (const [a, onde] of Object.entries(ass)) l.push(`- \`${a}\`: ${onde.join(', ')}`);
    }
    l.push('');
    l.push('Celula com mais de uma rodada valida mostra `mediana (min..max)`.');
    l.push('');
    const cab = ['base', 'variante', 'cenario', ...METRICAS.map(([n]) => n), 'veredito'];
    l.push(`| ${cab.join(' | ')} |`);
    l.push(`|${cab.map(() => '---').join('|')}|`);
    for (const linha of tabela.linhas) {
        l.push(`| ${linha.base || 'atual'} | ${linha.variante} | ${linha.cenario} | ${linha.valores.map((v) => v.texto).join(' | ')} | ${linha.veredito} |`);
    }
    l.push('');
    l.push('## Conferencia contra a referencia');
    l.push('');
    l.push('| item | esperado | medido | fator | situacao |');
    l.push('|---|---|---|---|---|');
    for (const c of conferencia) {
        l.push(`| ${c.item} | ${c.esperado ?? '-'} | ${c.medido ?? '-'} | ${c.fator ?? '-'} | ${c.situacao} |`);
    }
    l.push('');
    l.push('## Vereditos do instrumento');
    l.push('');
    for (const rod of resultado.rodadas) {
        l.push(`- rodada ${rod.rodada}${rod.aquecimento ? ' (aquecimento)' : ''}: ${rod.valida ? 'valida' : `INVALIDA (${rod.erros.join('; ')})`}`);
        for (const v of rod.variantes) {
            const cad = v.cadenciaAssentada ? `cadencia p50 ${v.cadenciaAssentada.p50} p95 ${v.cadenciaAssentada.p95}` : 'cadencia ausente';
            l.push(`  - ${v.base || 'atual'} / ${v.variante}: ${v.valida ? 'prova ok' : `PROVA INVALIDA (${v.erros.join('; ')})`}; ${cad}${v.avisos && v.avisos.length ? `; avisos: ${v.avisos.join('; ')}` : ''}`);
        }
    }
    l.push('');
    l.push('## Provas das variantes (ultima rodada)');
    l.push('');
    const ultima = resultado.rodadas[resultado.rodadas.length - 1] || { variantes: [] };
    for (const v of ultima.variantes) {
        l.push(`### ${v.base || 'atual'} / ${v.variante}`);
        l.push('');
        l.push('```json');
        l.push(JSON.stringify({ prova: v.prova, detalhe: v.detalhe, trocaBase: v.troca, provaTrocaBase: v.provaTrocaBase }, null, 2));
        l.push('```');
        l.push('');
    }
    return l.join('\n');
}

function imprimirTabela(tabela) {
    if (!tabela.linhas.length) { console.log('nenhuma linha medida'); return; }
    const cab = ['base', 'variante', 'cenario', ...METRICAS.map(([n]) => n), 'veredito'];
    const linhas = [cab, ...tabela.linhas.map((li) => [li.base || 'atual', li.variante, li.cenario, ...li.valores.map((v) => v.texto), li.veredito])];
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

    const pw = await carregarPlaywright();
    fs.mkdirSync(params.saida, { recursive: true });

    const navegador = await pw.chromium.launch({
        headless: params.headless,
        args: [
            // Aba oculta ou janela ocluida zera o rAF e a medida vira mentira.
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-features=CalculateNativeWinOcclusion',
            `--window-size=${params.largura + 20},${params.altura + 100}`,
        ],
    });
    const page = await navegador.newPage({ viewport: { width: params.largura, height: params.altura } });
    // O buffer de Resource Timing tem 250 entradas por padrao e o app carrega
    // centenas de modulos em dev: sem aumenta-lo ANTES da carga, as entradas do
    // boot (que sao as que dizem por qual URL cada modulo veio) se perdem, e a
    // bancada importaria a copia errada de cada um.
    await page.addInitScript(() => { try { performance.setResourceTimingBufferSize(20000); } catch (_e) { /* navegador sem a API: a descoberta cai no caminho nu */ } });
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e).slice(0, 200)));
    page.on('console', (m) => { if (m.type() === 'error') erros.push(`console: ${m.text().slice(0, 200)}`); });

    const bancada = new Bancada(page, params);
    if (params.perfil || params.cpu > 1) bancada.cdp = await page.context().newCDPSession(page);
    if (params.perfil) {
        await bancada.cdp.send('Profiler.enable');
        await bancada.cdp.send('Profiler.setSamplingInterval', { interval: 250 });
    }
    if (params.cpu > 1) {
        // Vale para a sessao inteira, recargas inclusive.
        await bancada.cdp.send('Emulation.setCPUThrottlingRate', { rate: params.cpu });
        console.log(`CPU estrangulada por ${params.cpu}x pelo CDP`);
    }

    const resultado = {
        // O caminho absoluto da saida nao entra no JSON: o artefato fica dentro
        // do repositorio, e caminho de maquina nao se grava no repositorio.
        parametros: { ...params, saida: path.relative(PACOTE, params.saida).split(path.sep).join('/'), vistaCoord: VISTAS[params.vista] },
        ambiente: {
            quando: new Date().toISOString(),
            node: process.version,
            plataforma: process.platform,
            playwrightOrigem: pw.origem,
            playwrightVersao: pw.versao,
            renderer: null,
            fornecedor: null,
            relogio: 'valido',
            perfilLigado: params.perfil,
            cpu: params.cpu,
            baseInicial: null,
            populacao: null,
        },
        rodadas: [],
        errosDaPagina: erros,
    };

    if (params.populado) {
        // Uma vez, antes das rodadas: as ferramentas persistem no store do
        // contexto, e toda recarga seguinte traz as feicoes de volta.
        console.log('\n===== populando o mapa pelas ferramentas do app');
        await bancada.carregar();
        await bancada.irParaVistaBase();
        await bancada.assentar();
        const pop = await bancada.popular();
        resultado.ambiente.populacao = pop;
        console.log(`  chamadas a createFeature: ${pop.total} ${JSON.stringify(pop.porControle)}${pop.ausentes.length ? `  (controles ausentes: ${pop.ausentes.join(', ')})` : ''}`);
        console.log(`  persistidas no store: ${pop.persistidas ? pop.persistidas.total : '?'} ${pop.persistidas && pop.persistidas.porTipo ? JSON.stringify(pop.persistidas.porTipo) : (pop.persistidas && pop.persistidas.erro) || ''}${pop.persistidas && pop.persistidas.total !== pop.total ? `  (${pop.total - pop.persistidas.total} chamadas nao viraram feicao persistida)` : ''}`);
        if (!pop.persistidas || !pop.persistidas.total) throw new Error('--populado nao persistiu feicao nenhuma no store: o app nao expoe os controles esperados, ou o store nao gravou');
    }

    for (let rodada = 1; rodada <= params.rodadas; rodada++) {
        const reg = { rodada, aquecimento: rodada === 1 && params.rodadas > 1, valida: true, erros: [], variantes: [] };
        console.log(`\n===== rodada ${rodada}${reg.aquecimento ? ' (aquecimento)' : ''}`);
        // Base por dentro, variante por fora: os casos que se comparam ficam
        // vizinhos no tempo, e a rodada ja intercala o resto.
        const casos = [];
        for (const nome of params.variantes) for (const base of params.bases) casos.push([nome, base]);
        for (const [nome, base] of casos) {
            const def = VARIANTES[nome];
            const rv = { base, variante: nome, valida: true, erros: [], cenarios: [] };
            console.log(`--- ${base} / ${nome}`);
            try {
                const carga = await bancada.carregar();
                rv.carga = carga;
                if (resultado.ambiente.renderer === null) {
                    resultado.ambiente.renderer = carga.instrumentacao.renderer;
                    resultado.ambiente.fornecedor = carga.instrumentacao.fornecedor;
                    if (/SwiftShader|llvmpipe/i.test(String(carga.instrumentacao.renderer))) {
                        resultado.ambiente.relogio = 'INVALIDO (GPU emulada)';
                        console.log(`ATENCAO: renderer ${carga.instrumentacao.renderer}. So as contagens valem.`);
                    }
                    console.log(`renderer: ${carga.instrumentacao.renderer}`);
                }
                // Instala o levantamento de fontes vazias no escopo da pagina.
                await page.evaluate(`window.__levantarVazias = ${levantarVazias.toString()}`);

                rv.cadenciaCarregando = await bancada.cadencia();

                // Impressao digital do app ANTES de trocar a base ou aplicar a
                // variante. Todas as cargas de uma mesma bancada tem de dar a
                // mesma; assinatura distinta significa que a arvore mudou embaixo
                // da medida, e a tabela compararia dois aplicativos diferentes com
                // o mesmo rotulo.
                const pb = await page.evaluate(lerProva);
                rv.provaBase = pb;
                rv.assinaturaBase = `${pb.camadas}c/${pb.fontes}f/${pb.camadasVisiveis}v`;
                if (resultado.ambiente.baseInicial === null) resultado.ambiente.baseInicial = carga.baseAtual;

                // Troca de base ANTES da vista, para os tiles da vista serem os da
                // base pedida. A prova so se le com a vista assentada, abaixo.
                let troca = null;
                if (base !== 'atual') {
                    troca = await bancada.trocarBase(base);
                    rv.troca = troca;
                }

                await bancada.irParaVistaBase();
                const assentouBase = await bancada.assentar();
                rv.assentouBase = assentouBase;
                if ((assentouBase.erros || []).length) {
                    reg.valida = false;
                    reg.erros.push(...assentouBase.erros.map((e) => `${base}/${nome}: ${e}`));
                }
                rv.cadenciaAssentada = await bancada.cadencia();
                if (rv.cadenciaAssentada.p95 > 25) {
                    if (params.cpu > 1) {
                        // Com a CPU estrangulada de proposito, o ocioso lento E a
                        // condicao medida, nao defeito do instrumento.
                        rv.avisos = rv.avisos || [];
                        rv.avisos.push(`cadencia ociosa do rAF p95 ${rv.cadenciaAssentada.p95} ms acima de 25 com CPU ${params.cpu}x`);
                        console.log(`  aviso: ${rv.avisos[rv.avisos.length - 1]}`);
                    } else {
                        reg.valida = false;
                        reg.erros.push(`${base}/${nome}: cadencia ociosa do rAF p95 ${rv.cadenciaAssentada.p95} ms acima de 25`);
                    }
                }
                const vis = await page.evaluate(() => document.visibilityState);
                rv.visibilidade = vis;
                if (vis !== 'visible') { reg.valida = false; reg.erros.push(`${base}/${nome}: visibilityState ${vis}`); }

                if (troca) {
                    const provaTroca = troca.esperado.erro ? null : await bancada.provarBase(troca.esperado);
                    rv.provaTrocaBase = provaTroca;
                    const errosBase = validarBase(provaTroca || {}, troca.esperado);
                    if (errosBase.length) { rv.valida = false; rv.erros.push(...errosBase.map((e) => `base: ${e}`)); }
                    const esp = troca.esperado;
                    console.log(`  base: ${base} -> estilo ${provaTroca ? provaTroca.estilo : '-'}, ${provaTroca ? provaTroca.camadasPresentes : '-'}/${esp.camadas ? esp.camadas.length : '-'} camadas da base, tiles carregados ${provaTroca ? JSON.stringify(provaTroca.carregadosPorFonte) : '-'}${errosBase.length ? `  ** BASE INVALIDA: ${errosBase.join('; ')}` : ''}`);
                }

                const detalhe = await def.aplicar(bancada) || {};
                await bancada.esperarQuadros(3);
                const prova = await page.evaluate(lerProva);
                rv.prova = prova;
                rv.detalhe = detalhe;
                const errosProva = def.validar(prova, detalhe) || [];
                if (errosProva.length) { rv.valida = false; rv.erros.push(...errosProva); }
                const avisosProva = avisosDaVariante(prova);
                if (avisosProva.length) {
                    rv.avisos = [...(rv.avisos || []), ...avisosProva];
                    for (const a of avisosProva) console.log(`  aviso: ${a}`);
                }
                // Estado populado: as feicoes criadas antes das rodadas tem de
                // ter voltado nesta recarga, senao o caso mediu o app vazio.
                if (params.populado) {
                    const pop = resultado.ambiente.populacao;
                    const criadas = pop && pop.persistidas ? pop.persistidas.total : 0;
                    if (!criadas || prova.feicoes < criadas) {
                        rv.valida = false;
                        rv.erros.push(`estado populado nao voltou: ${prova.feicoes} feicoes nas fontes, persistidas no store ${criadas}`);
                    }
                }
                console.log(`  prova: estilo=${prova.estilo} feicoes=${prova.feicoes} terreno=${prova.terreno} pilhas=${prova.pilhas} tilesT=${prova.tilesTerreno} fontes=${prova.fontes} camadas=${prova.camadas} hillshade=${prova.hillshade} proj=${prova.projecao} pitch=${prova.pitch} zoom=${prova.zoom}${rv.valida ? '' : `  ** INVALIDA: ${rv.erros.join('; ')}`}`);

                for (const cenario of ORDEM_CENARIOS) {
                    if (cenario === 'pitch' && !def.terreno) continue;
                    if (params.perfil) await bancada.cdp.send('Profiler.start');
                    const c = await bancada.rodarCenario(cenario, prova);
                    if (params.perfil) {
                        const { profile } = await bancada.cdp.send('Profiler.stop');
                        const arq = path.join(params.saida, `perfil-r${rodada}-${nome}-${cenario}.cpuprofile`);
                        fs.writeFileSync(arq, JSON.stringify(profile));
                        c.perfil = { arquivo: path.basename(arq), ...agregarPerfil(profile) };
                    }
                    rv.cenarios.push(c);
                    const e = c.estatistica;
                    console.log(`  ${cenario.padEnd(8)} quadros ${String(e.quadros).padStart(4)} | render p50 ${e.render_ms ? e.render_ms.p50 : '-'} p95 ${e.render_ms ? e.render_ms.p95 : '-'} | interv p50 ${e.intervalo_ms ? e.intervalo_ms.p50 : '-'} p95 ${e.intervalo_ms ? e.intervalo_ms.p95 : '-'} | draw ${e.gl_por_quadro ? e.gl_por_quadro.draw : '-'} stamp ${e.gl_por_quadro ? e.gl_por_quadro.stamp : '-'}${c.erros.length ? `  ** ${c.erros.join('; ')}` : ''}`);
                    if (cenario === 'parado') {
                        await page.screenshot({ path: path.join(params.saida, `captura-${base}-${nome}.png`) });
                    }
                }
            } catch (e) {
                rv.valida = false;
                rv.erros.push(`excecao: ${String(e && e.message ? e.message : e).slice(0, 300)}`);
                reg.valida = false;
                reg.erros.push(`${base}/${nome}: excecao`);
                console.log(`  ** excecao em ${base}/${nome}: ${e && e.message}`);
            }
            reg.variantes.push(rv);
        }
        resultado.rodadas.push(reg);
    }

    await navegador.close();

    // O app tem de ser o MESMO em todas as cargas.
    const assinaturas = new Map();
    for (const rod of resultado.rodadas) {
        for (const v of rod.variantes) {
            if (!v.assinaturaBase) continue;
            if (!assinaturas.has(v.assinaturaBase)) assinaturas.set(v.assinaturaBase, []);
            assinaturas.get(v.assinaturaBase).push(`r${rod.rodada}/${v.base || 'atual'}/${v.variante}`);
        }
    }
    resultado.ambiente.assinaturasBase = Object.fromEntries(assinaturas);
    resultado.ambiente.appMudou = assinaturas.size > 1;
    if (resultado.ambiente.appMudou) {
        for (const rod of resultado.rodadas) {
            rod.valida = false;
            rod.erros.push('o app mudou entre as cargas (assinatura base distinta)');
        }
        console.log('\n** O APP MUDOU DURANTE A BANCADA. Assinaturas base (camadas/fontes/camadas visiveis):');
        for (const [a, onde] of assinaturas) console.log(`   ${a}  <-  ${onde.join(', ')}`);
        console.log('   A tabela abaixo compara aplicativos diferentes. Rode de novo com a arvore parada.');
    }

    const tabela = montarTabela(resultado);
    const conferencia = conferirReferencia(resultado);
    resultado.tabela = tabela;
    resultado.conferencia = conferencia;
    fs.writeFileSync(path.join(params.saida, 'resultado.json'), JSON.stringify(resultado, null, 2));
    fs.writeFileSync(path.join(params.saida, 'resultado.md'), escreverMarkdown(resultado, tabela, conferencia));

    console.log('');
    imprimirTabela(tabela);
    console.log('');
    console.log(tabela.nota);
    console.log(`relogio: ${resultado.ambiente.relogio} | renderer: ${resultado.ambiente.renderer}`);
    console.log(`playwright ${pw.versao} de ${pw.origem} (${pw.caminho})`);
    console.log('');
    console.log('conferencia contra a referencia:');
    for (const c of conferencia) console.log(`  ${c.item}: esperado ${c.esperado ?? '-'}, medido ${c.medido ?? '-'} (fator ${c.fator ?? '-'}) -> ${c.situacao}`);
    if (erros.length) console.log(`\nerros da pagina (${erros.length}): ${[...new Set(erros)].slice(0, 5).join(' | ')}`);
    console.log(`\nsaida: ${params.saida}`);
}

// So roda quando chamado direto. Importado, expoe as partes puras para o
// autoteste, que e quem prova que a bancada reprova o insumo degenerado.
const chamadoDireto = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (chamadoDireto) principal().catch((e) => { console.error(e); process.exit(1); });

export {
    VISTAS, ORDEM_VARIANTES, ORDEM_CENARIOS, VARIANTES, REFERENCIA, METRICAS,
    PLANO_POPULAR, MS_ESTAVEL,
    lerArgumentos, carregarPlaywright, percentil, mediana, estatistica,
    agregarPerfil, celula, montarTabela, conferirReferencia, escreverMarkdown,
    validarBase, avaliarIdentidade, validarLeituraDeTiles, avaliarProntidao,
    avisosDaVariante,
};
