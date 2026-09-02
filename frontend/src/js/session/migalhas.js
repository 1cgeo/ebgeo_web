// Path: js/session/migalhas.js

/**
 * @fileoverview AS MIGALHAS: os últimos trinta fatos ordinários antes do erro.
 *
 * O QUE ELAS FECHAM. O relato de erro responde "qual defeito, em qual página, em qual build" e
 * nada sobre o CAMINHO até ele. Uma assinatura de `Cannot read properties of undefined` é o mesmo
 * texto quando a pessoa acabou de abrir o 3D, quando um `POST /sync` voltou 500 e quando a sessão
 * caiu no meio; as três pedem providências diferentes e eram indistinguíveis. Trinta linhas curtas
 * de "o que estava acontecendo" custam alguns kB e trocam adivinhação por leitura.
 *
 * ZERO IMPORTS por contrato, e aqui a razão é MAIS ESTREITA que a dos vizinhos (`sessao-id.js`,
 * `fila-de-relatos.js`, `origens-de-erro.js`), que já são folhas por causa das quatro páginas: este
 * módulo é importado por `store/sync/api-client.js`, que os helpers do Playwright carregam em NODE
 * PURO, sem alias do Vite e sem navegador. Um import aqui (mesmo relativo) que arraste `window`,
 * `localStorage` ou um alias derruba toda spec de UI antes de abrir o navegador. Ele não lê
 * armazenamento nenhum, não toca a rede e não guarda estado fora da memória desta página.
 *
 * ── AS TRÊS PROPRIEDADES QUE VALEM MAIS QUE O RECURSO ────────────────────────────────────────
 *
 *   1. NUNCA LANÇA. `registrar` é chamado de dentro do embrulho de `console.error`, do caminho de
 *      todo pedido REST e de um `onAny` do barramento, ou seja, dos três lugares em que uma
 *      exceção viraria um defeito maior que o observado. Entrada ruim é DESCARTADA e CONTADA
 *      ({@link criarMigalhas} expõe `estado()`), nunca lançada: um subsistema silencioso sem
 *      contador é indistinguível de um subsistema desligado.
 *   2. TETO DURO, e o mais VELHO cai. Trinta itens, cada um com tipo de 20 e texto de 120, são os
 *      mesmos números que a rota valida do outro lado. O corte é pelo topo porque, num caminho que
 *      degrada, o que explica o desfecho são os últimos fatos, não os primeiros.
 *   3. NADA DE CONTEÚDO DE USUÁRIO, E A GARANTIA NÃO É UNIFORME ENTRE OS ALIMENTADORES. A versão
 *      anterior desta linha a afirmava em bloco, e o alimentador de console não a cumpre.
 *      Nos DOIS que leem dado estruturado ela é MECÂNICA e provada por teste: o de BARRAMENTO lê
 *      só os campos de uma allowlist, e só o que tem forma de símbolo
 *      (`session/migalhas-do-barramento.js`); o de API manda a rota por {@link normalizarRota},
 *      sem corpo e sem query. O de CONSOLE não pode ter essa garantia, porque ele carrega a
 *      mensagem COMO O PROGRAMADOR A ESCREVEU: ali a regra vale no SÍTIO DA CHAMADA, e ela tem
 *      duas metades. Mensagem de console não interpola dado PESSOAL; e nome de conteúdo de atlas
 *      ali é ACEITO, por decisão registrada, porque quem lê a trilha é o administrador. O caso
 *      vivo é o "Error loading layers for map" de `layers/layer.manager.js`, que leva o nome do
 *      mapa para a trilha. O anel segue burro de propósito: uma regra de privacidade espalhada
 *      por dois lugares diverge.
 *
 * O `normalizar` É INJETADO, e não importado, pelo contrato de zero imports acima: quem instala a
 * telemetria (`session/erro-telemetria.js`) chama {@link configurarMigalhas} com o
 * `normalizarMensagem` de verdade, que é o que troca UUID, hash de build e número longo por
 * marcador. Sem ele o anel guarda o texto como veio, que é o comportamento certo para quem só
 * carregou o cliente HTTP em node.
 */

/** Quantas migalhas viajam no relato. O mesmo número que a rota valida. */
export const TETO_DE_MIGALHAS = 30;

/** Teto do `tipo`. É um rótulo de vocabulário fechado, nunca uma frase. */
export const TETO_DO_TIPO = 20;

/** Teto do `texto`. Uma linha curta, nunca um parágrafo. */
export const TETO_DO_TEXTO = 120;

/**
 * OS SEIS TIPOS DE MIGALHA, que são a coluna por onde se filtra a trilha.
 *
 * Vocabulário FECHADO pelo mesmo motivo das origens de erro: um sétimo valor inventado num sítio
 * qualquer não quebra nada e some do filtro, que é a pior forma de uma etiqueta falhar.
 */
export const TipoDeMigalha = Object.freeze({
    /** Um evento do barramento da aplicação (allowlist em `migalhas-do-barramento.js`). */
    EVENTO: 'evento',
    /** Um pedido REST que terminou, com sucesso ou não (`store/sync/api-client.js`). */
    API: 'api',
    /** Alguém chamou `console.error` ou `console.warn`. */
    CONSOLE: 'console',
    /** Em que página a carga começou. */
    NAVEGACAO: 'navegacao',
    /** O estado do socket de colaboração mudou. */
    CONEXAO: 'conexao',
    /** A sessão mudou (entrou, saiu, papel diferente). */
    SESSAO: 'sessao',
});

/** Um UUID inteiro, e nada mais: é o que vira `:id` numa rota. */
const RE_UUID_SEGMENTO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Um segmento que é só dígito: id numérico, página, contador. Vira `:n`. */
const RE_NUMERO_SEGMENTO = /^\d+$/;

/**
 * Teto de UM segmento de rota. Ele não existe por tamanho, e sim por PROCEDÊNCIA: algumas rotas do
 * produto interpolam um id que é, na verdade, um nome escolhido por gente (o mapa local é chaveado
 * por nome, e o catálogo 360 aceita id textual). Cortar em trinta e dois deixa o diagnóstico
 * legível e impede que um nome longo vire a migalha inteira.
 */
const TETO_DO_SEGMENTO = 32;

/**
 * A ROTA SEM O QUE IDENTIFICA UMA LINHA. `/atlas/3f25.../maps/12` vira `/atlas/:id/maps/:n`.
 *
 * DUAS COISAS QUE ELA NÃO FAZ, e as duas são o desenho: ela DESCARTA a query e o fragmento (é ali
 * que moram `?verify=`, `?atlasPublico=` e o termo de busca que a pessoa digitou, e nenhum dos três
 * pode acabar num log), e ela não toca no host, porque quem a chama passa só o caminho relativo à
 * base. O que sobra é a FORMA da rota, que é o que agrupa: trinta chamadas a `/atlas/:id/sync` são
 * uma linha de leitura, e trinta UUIDs diferentes são trinta.
 * @param {*} caminho - O caminho relativo à base da API.
 * @returns {string} Vazio para entrada que não é string.
 */
export function normalizarRota(caminho) {
    try {
        if (typeof caminho !== 'string' || !caminho) return '';
        const semQuery = caminho.split('?')[0].split('#')[0];
        return semQuery
            .split('/')
            .map((segmento) => {
                if (!segmento) return segmento;
                if (RE_UUID_SEGMENTO.test(segmento)) return ':id';
                if (RE_NUMERO_SEGMENTO.test(segmento)) return ':n';
                return segmento.slice(0, TETO_DO_SEGMENTO);
            })
            .join('/');
    } catch {
        return '';
    }
}

/**
 * Corta uma string no teto sem lançar para entrada estranha.
 * @param {*} texto
 * @param {number} teto
 * @returns {string}
 */
function truncar(texto, teto) {
    if (typeof texto !== 'string') return '';
    return texto.length > teto ? texto.slice(0, teto) : texto;
}

/**
 * Um anel de migalhas sobre um relógio e um normalizador injetados.
 *
 * FÁBRICA E SINGLETON, os dois, como o id de sessão ao lado: o singleton é o que o produto usa (uma
 * página, uma trilha) e a fábrica é o que torna o teto, o corte e o descarte testáveis em node puro
 * sem relógio de verdade.
 *
 * @param {Object} [opcoes]
 * @param {number} [opcoes.teto] - Quantas migalhas cabem.
 * @param {() => number} [opcoes.agora] - Relógio injetável.
 * @param {(texto: string) => string} [opcoes.normalizar] - A normalização do texto. Identidade por
 *   padrão; ver o `fileoverview` sobre por que ela é injetada.
 * @returns {{registrar: Function, listar: Function, limpar: Function, tamanho: Function,
 *   estado: Function, configurar: Function}}
 */
export function criarMigalhas({
    teto = TETO_DE_MIGALHAS,
    agora = () => Date.now(),
    normalizar = null,
} = {}) {
    /** @type {Array<{t: number, tipo: string, texto: string}>} */
    const anel = [];

    /** Quantas entraram e quantas foram recusadas. Ver a propriedade 1 do `fileoverview`. */
    const contadores = { registradas: 0, descartadas: 0, caidas: 0 };

    /** A normalização em vigor. Trocável por {@link configurar}. */
    let normalizador = typeof normalizar === 'function' ? normalizar : null;

    /**
     * Aplica a normalização injetada SEM deixar que ela derrube o registro: um normalizador que
     * lance transformaria a migalha num defeito, que é o inverso do propósito.
     * @param {string} texto
     * @returns {string}
     */
    function normalizado(texto) {
        if (!normalizador) return texto;
        try {
            const saida = normalizador(texto);
            return typeof saida === 'string' ? saida : texto;
        } catch {
            return texto;
        }
    }

    return {
        /**
         * Registra uma migalha. NUNCA LANÇA: entrada ruim é descartada e contada.
         * @param {*} tipo - Um valor de {@link TipoDeMigalha}. A forma é conferida, o vocabulário
         *   não: quem alimenta o anel é quem conhece o vocabulário, e uma segunda cópia da lista
         *   aqui divergiria da primeira em silêncio.
         * @param {*} texto - Uma linha curta escrita por programador, nunca conteúdo de usuário.
         * @returns {boolean} Se a migalha entrou.
         */
        registrar(tipo, texto) {
            try {
                const rotulo = truncar(typeof tipo === 'string' ? tipo.trim() : '', TETO_DO_TIPO);
                if (!rotulo) {
                    contadores.descartadas++;
                    return false;
                }
                const cru = typeof texto === 'string' ? texto : '';
                const linha = truncar(normalizado(cru).trim(), TETO_DO_TEXTO);
                if (!linha) {
                    contadores.descartadas++;
                    return false;
                }
                const t = Math.trunc(Number(agora()));
                if (!Number.isFinite(t)) {
                    contadores.descartadas++;
                    return false;
                }
                anel.push({ t, tipo: rotulo, texto: linha });
                contadores.registradas++;
                // O MAIS VELHO CAI, e num laço porque um teto menor pode encontrar um anel maior
                // (um `configurar` futuro, um duplo de teste reusado).
                while (anel.length > teto) {
                    anel.shift();
                    contadores.caidas++;
                }
                return true;
            } catch {
                contadores.descartadas++;
                return false;
            }
        },

        /**
         * A trilha, do mais velho para o mais novo.
         *
         * CÓPIA, e objetos NOVOS: quem chama põe o resultado dentro do corpo de um POST e o corpo
         * pode ir para a fila do `localStorage`, onde uma referência viva ao anel continuaria
         * mudando depois de guardada.
         * @returns {Array<{t: number, tipo: string, texto: string}>}
         */
        listar() {
            try {
                return anel.map(({ t, tipo, texto }) => ({ t, tipo, texto }));
            } catch {
                return [];
            }
        },

        /** Esvazia o anel. Os contadores NÃO zeram: eles descrevem a página, não o anel. */
        limpar() {
            anel.length = 0;
        },

        /** @returns {number} Quantas migalhas estão guardadas. */
        tamanho() {
            return anel.length;
        },

        /** @returns {Object} Os contadores mais o tamanho e o teto. */
        estado() {
            return { ...contadores, tamanho: anel.length, teto };
        },

        /**
         * Troca a normalização depois da construção. Ver o `fileoverview`.
         * @param {Object} [opcoes]
         * @param {(texto: string) => string|null} [opcoes.normalizar]
         */
        configurar({ normalizar: fn } = {}) {
            normalizador = typeof fn === 'function' ? fn : null;
        },
    };
}

/**
 * A trilha desta página. Uma só, compartilhada pelos quatro alimentadores.
 *
 * SEM NORMALIZAÇÃO ATÉ ALGUÉM CONFIGURAR, de propósito: este módulo é carregado por quem só quer o
 * cliente HTTP (os helpers do Playwright, em node puro), e ali não existe telemetria instalada.
 */
export const migalhas = criarMigalhas();

/**
 * Liga a normalização de verdade no anel do produto. Chamada UMA vez, por
 * `instalarTelemetriaDeErro`.
 * @param {Object} [opcoes]
 * @param {(texto: string) => string} [opcoes.normalizar]
 */
export function configurarMigalhas({ normalizar } = {}) {
    try {
        migalhas.configurar({ normalizar });
    } catch {
        // O anel degrada para "sem normalização", nunca para exceção.
    }
}
