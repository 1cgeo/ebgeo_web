// Path: e2e-ui/helpers/sonda-vazamento.js

/**
 * SONDA DE RECURSO VIVO, injetada por `addInitScript` ANTES de qualquer código do app.
 *
 * O que ela conta é a diferença entre o que se cria e o que se libera: listener ligado ao
 * documento, contexto WebGL e `setInterval`. Nenhum dos três depende de coletor de lixo nem
 * de relógio, então um contador que sobe a cada ciclo é evidência direta, e não inferência.
 * (A frase vale para `listeners`, que conta só o que está ANCORADO no documento; o que fica
 * fora dessa âncora tem balde próprio e não se asserta. Ver a terceira lição, abaixo.)
 *
 * DUAS LIÇÕES ESTÃO EMBUTIDAS AQUI, e as duas custaram uma medida errada antes de virar código
 * (medidas em 2026-08-31, contra o visualizador 3D deste repositório):
 *
 *   - **Listener em elemento descartado NÃO é vazamento.** Ele morre junto com o elemento. A
 *     primeira versão desta sonda contava o registro bruto e acusava +14 por ciclo no 3D, onde
 *     o próprio Chrome (`Memory.getDOMCounters.jsEventListeners`) contava +1. Quem estava errado
 *     era a sonda. Por isso cada registro guarda uma `WeakRef` do alvo, e a contagem que vale se
 *     recalcula no momento da leitura, só sobre o que continua vivo e ligado ao documento. As
 *     duas contagens passaram a bater, e é essa concordância que autoriza usar esta aqui: ela é
 *     a mesma medida do navegador, com o detalhe por tipo que o navegador não dá.
 *
 *   - **Régua que só foi vista aprovar não foi vista funcionar.** Daí `vazarDeProposito()`, que
 *     retém 20 listeners de `document`, 30 texturas e 1 timer por chamada. É o pior caso que
 *     esta régua existe para pegar, e o spec o exercita ANTES de julgar o app.
 *
 * A TERCEIRA LIÇÃO É DE 2026-09-14, e ela é o que obrigou a ressalva do primeiro parágrafo, que
 * até então dizia sem ressalva nenhuma que as três contagens independem do coletor de lixo.
 * **Para um alvo que NÃO é nó do documento, ela depende, e não há como não depender.** Um
 * `AbortSignal`, um `XMLHttpRequest` ou
 * um `WebSocket` só continuam vivos enquanto alguém os segura, e a única pergunta que esta sonda
 * sabe fazer é `WeakRef.deref()`, que responde "vivo" até o coletor passar. O registro de um
 * `fetch` em voo, portanto, entra na conta e sai dela por tempo, não por vazamento.
 *
 * O preço foi medido: o CONTROLE do instrumento (§30.1 de `vazamento-viewers.spec.js`, que fabrica
 * 60 listeners de `document` e exige exatamente 60) reprovou numa rodada cheia com 61, e o tipo
 * que sobrava era `AbortSignal:abort`. Um controle que acusa a si mesmo por causa de um pedido de
 * rede em voo não é controle, é ruído com cara de defeito.
 *
 * DAÍ A SEPARAÇÃO EM DOIS BALDES, e ela é o desenho: `listeners` conta só o que está ANCORADO no
 * documento (`window`, `document` e elemento CONECTADO), que é a metade cuja vida se lê sem
 * coletor nenhum, e é a metade em que moram os vazamentos que este spec existe para pegar (o do
 * visualizador 3D era um clique num botão que nunca sai do documento). O resto vai para
 * `listenersSoltos`, que continua sendo MEDIDO e relatado, para não se perder informação, mas
 * NUNCA é objeto de asserção exata: quem o assertar estará medindo o coletor de lixo.
 *
 * Uso no spec:
 *   import { SONDA_VAZAMENTO, contarRecursos } from './helpers/sonda-vazamento.js';
 *   await page.addInitScript(SONDA_VAZAMENTO);
 *   const antes = await contarRecursos(page);
 */

/**
 * O corpo da sonda, como texto, porque `addInitScript` o executa no contexto da página.
 * @type {string}
 */
export const SONDA_VAZAMENTO = `(() => {
    if (window.__sondaVazamento) return;

    let registros = [];
    let contextosWebgl = 0;
    const intervalos = new Set();
    const jaRegistrado = new WeakMap();

    const capturaDe = (o) => (typeof o === 'object' && o !== null ? !!o.capture : !!o);

    const nomeDe = (alvo) => {
        try {
            if (alvo === window) return 'window';
            if (alvo === document) return 'document';
            if (alvo && alvo.nodeType === 1) return '<' + alvo.tagName.toLowerCase() + '>';
            return (alvo && alvo.constructor && alvo.constructor.name) || 'obj';
        } catch { return '??'; }
    };

    // Recalcula sobre o que AINDA está vivo e ligado. Compacta a lista de passagem, para ela
    // não crescer sem fim numa rodada longa.
    //
    // DOIS BALDES, e a linha divisória é a ÂNCORA no documento: window, document e elemento
    // CONECTADO têm vida legível sem coletor de lixo; qualquer outro alvo (AbortSignal, XHR,
    // WebSocket) responde "vivo" enquanto o coletor não passar, e por isso vai para o balde
    // solto, que se relata e não se asserta. Ver o cabeçalho.
    const vivos = () => {
        const porTipo = new Map();
        const porTipoSolto = new Map();
        const sobrou = [];
        for (const r of registros) {
            if (!r.vivo) continue;
            const alvo = r.ref.deref();
            if (!alvo) continue;
            sobrou.push(r);
            if (alvo.nodeType === 1 && !alvo.isConnected) continue;
            const ancorado = alvo === window || alvo === document || alvo.nodeType === 1;
            const balde = ancorado ? porTipo : porTipoSolto;
            balde.set(r.tipo, (balde.get(r.tipo) || 0) + 1);
        }
        registros = sobrou;
        let total = 0;
        for (const v of porTipo.values()) total += v;
        let totalSolto = 0;
        for (const v of porTipoSolto.values()) totalSolto += v;
        return { total, porTipo, totalSolto, porTipoSolto };
    };

    const addOriginal = EventTarget.prototype.addEventListener;
    const rmOriginal = EventTarget.prototype.removeEventListener;

    EventTarget.prototype.addEventListener = function (tipo, fn, opcoes) {
        const r = addOriginal.call(this, tipo, fn, opcoes);
        try {
            if (fn) {
                let m = jaRegistrado.get(this);
                if (!m) { m = new Map(); jaRegistrado.set(this, m); }
                const chave = tipo + '|' + (capturaDe(opcoes) ? 1 : 0);
                let s = m.get(chave);
                if (!s) { s = new Set(); m.set(chave, s); }
                // O DOM registra o par (alvo, tipo, fn, captura) uma vez só: repetir o mesmo par
                // não cria um segundo listener, e contá-lo duas vezes inventaria vazamento.
                if (!s.has(fn)) {
                    s.add(fn);
                    registros.push({
                        ref: new WeakRef(this), tipo: nomeDe(this) + ':' + tipo,
                        vivo: true, par: [tipo, fn, capturaDe(opcoes)],
                    });
                }
            }
        } catch { /* a sonda nunca derruba o app */ }
        return r;
    };

    EventTarget.prototype.removeEventListener = function (tipo, fn, opcoes) {
        const r = rmOriginal.call(this, tipo, fn, opcoes);
        try {
            const m = jaRegistrado.get(this);
            const chave = tipo + '|' + (capturaDe(opcoes) ? 1 : 0);
            const s = m && m.get(chave);
            if (s && s.has(fn)) {
                s.delete(fn);
                const captura = capturaDe(opcoes);
                for (let i = registros.length - 1; i >= 0; i--) {
                    const reg = registros[i];
                    if (reg.vivo && reg.ref.deref() === this
                        && reg.par[0] === tipo && reg.par[1] === fn && reg.par[2] === captura) {
                        reg.vivo = false;
                        break;
                    }
                }
            }
        } catch { /* idem */ }
        return r;
    };

    const setIntervalOriginal = window.setInterval;
    const clearIntervalOriginal = window.clearInterval;
    window.setInterval = function (...a) {
        const id = setIntervalOriginal.apply(this, a);
        intervalos.add(id);
        return id;
    };
    window.clearInterval = function (id) {
        intervalos.delete(id);
        return clearIntervalOriginal.call(this, id);
    };

    // O Chrome derruba o contexto mais antigo acima de cerca de dezesseis vivos, então um
    // contexto por abertura não degrada: quebra a tela, e sem erro nenhum no console.
    const getContextOriginal = HTMLCanvasElement.prototype.getContext;
    const jaTemContexto = new WeakSet();
    HTMLCanvasElement.prototype.getContext = function (tipo, ...a) {
        const ctx = getContextOriginal.call(this, tipo, ...a);
        try {
            if (ctx && /webgl/i.test(String(tipo)) && !jaTemContexto.has(this)) {
                jaTemContexto.add(this);
                contextosWebgl++;
            }
        } catch { /* */ }
        return ctx;
    };

    const lixoRetido = [];

    window.__sondaVazamento = {
        contar() {
            const v = vivos();
            return {
                listeners: v.total,
                listenersSoltos: v.totalSolto,
                contextosWebgl,
                intervalos: intervalos.size,
                porTipo: [...v.porTipo.entries()].sort((a, b) => b[1] - a[1]),
                porTipoSolto: [...v.porTipoSolto.entries()].sort((a, b) => b[1] - a[1]),
            };
        },
        /** O pior caso, para o spec provar que a régua reprova antes de deixá-la julgar o app. */
        vazarDeProposito() {
            // UM TIPO DE EVENTO QUE SÓ ESTA SONDA USA, e não 'click', desde 2026-09-23. O controle
            // do §30.1 exigia o TOTAL ancorado exato, e sob carga a página ganhava um listener dela
            // mesma na janela da medida (<canvas>:mouseleave +1, no Firefox em 2026-09-22 e no
            // Chromium em 2026-09-23): o controle reprovava a página em vez de provar o instrumento.
            // Com um tipo exclusivo, a contagem do que foi injetado não colide com nada do app.
            for (let i = 0; i < 20; i++) {
                const fn = () => {};
                lixoRetido.push(fn);
                document.addEventListener('ebgeo-sonda-vazamento', fn);
            }
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
            if (gl) for (let i = 0; i < 30; i++) lixoRetido.push(gl.createTexture());
            lixoRetido.push(setInterval(() => {}, 60000));
            lixoRetido.push(canvas);
        },
    };
})();`;

/**
 * Lê a contagem de recurso vivo da página.
 *
 * `listeners` é a contagem ANCORADA (a que se asserta) e `listenersSoltos` a dos alvos cuja vida
 * só o coletor de lixo conhece (a que se relata). Ver o cabeçalho.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{listeners: number, listenersSoltos: number, contextosWebgl: number,
 *   intervalos: number, porTipo: Array<[string, number]>,
 *   porTipoSolto: Array<[string, number]>}>}
 */
export function contarRecursos(page) {
    return page.evaluate(() => window.__sondaVazamento.contar());
}

/**
 * Nomeia os tipos que cresceram entre duas contagens, do maior para o menor.
 * É o que transforma "vazou 4" em "vazou 4 cliques de botão", que é o que se conserta.
 * @param {{porTipo: Array<[string, number]>, porTipoSolto: Array<[string, number]>}} antes
 * @param {{porTipo: Array<[string, number]>, porTipoSolto: Array<[string, number]>}} depois
 * @param {'porTipo'|'porTipoSolto'} [campo='porTipo'] - Qual balde descrever.
 * @returns {string} Legível, para entrar na mensagem do `expect`.
 */
export function diferencaPorTipo(antes, depois, campo = 'porTipo') {
    const mapaAntes = new Map(antes[campo] ?? []);
    const cresceu = (depois[campo] ?? [])
        .map(([tipo, n]) => [tipo, n - (mapaAntes.get(tipo) || 0)])
        .filter(([, d]) => d > 0)
        .sort((a, b) => b[1] - a[1]);
    return cresceu.length === 0 ? '(nenhum)' : cresceu.map(([t, d]) => `${t} +${d}`).join(', ');
}
