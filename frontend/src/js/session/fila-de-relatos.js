// Path: js/session/fila-de-relatos.js

/**
 * @fileoverview A FILA DO QUE NÃO CONSEGUIU SAIR. Relatos de erro que o servidor recusou, ou que
 * nem chegaram a ele, guardados no `localStorage` até o próximo boot bem-sucedido.
 *
 * O CASO QUE ELA EXISTE PARA COBRIR É O PIOR DE TODOS, e é o único em que a telemetria falha
 * exatamente quando é mais necessária: o servidor está fora. O boot do mapa é fail-fast em
 * `GET /api/config`, então a pessoa vê a tela de indisponibilidade e o relato daquele fato é
 * justamente o que não tem para onde ir. Sem fila, o incidente inteiro é invisível: o que se lê no
 * banco é um silêncio idêntico ao de "ninguém abriu o produto hoje".
 *
 * `localStorage`, E NÃO `sessionStorage`, ao contrário do id de sessão logo ao lado: o que está
 * sendo preservado tem de sobreviver ao fechamento da aba, porque a próxima carga da página é o
 * único momento em que o envio pode ser tentado de novo.
 *
 * O ARGUMENTO CONTRÁRIO ESTÁ REGISTRADO e continua valendo em parte. O `fileoverview` de
 * `erro-telemetria-assinatura.js` dizia que enfileirar é "o mesmo pico com atraso": uma fila
 * despejada de uma vez na volta é uma rajada. O que a torna aceitável são três limites, e nenhum
 * deles é opcional: o TETO de trinta itens (o mais velho cai, porque o mais novo é o que descreve
 * o estado em que a pessoa desistiu), o descarregamento EM SÉRIE (um pedido por vez, e não trinta
 * em paralelo) e o teto de envios por sessão do limitador, que continua valendo para o que vem
 * daqui — trinta itens não viram trinta pedidos se a sessão já gastou o orçamento dela.
 *
 * ZERO IMPORTS, e armazenamento injetado, pelas mesmas duas razões dos vizinhos: ele é carregado
 * nas quatro páginas e precisa ser testável em node puro, onde não existe `localStorage`.
 *
 * TODA FALHA DEGRADA PARA "NÃO ENFILEIRA", nunca para uma exceção. Cota estourada, JSON corrompido
 * por outra versão do produto, armazenamento bloqueado em modo privado: os três acontecem, e os
 * três acontecem dentro do caminho de tratamento de um erro, que é o pior lugar possível para
 * levantar um segundo.
 */

/** Onde a fila mora. Prefixado, porque o `localStorage` é compartilhado com tudo da origem. */
export const CHAVE_DA_FILA = 'ebgeo:relatos-pendentes';

/**
 * Quantos relatos a fila guarda.
 *
 * TRINTA, e não "todos": o `localStorage` é um recurso compartilhado com o resto do produto, e um
 * defeito em laço produziria relatos até estourar a cota de todo mundo. O corte é pelo TOPO (o
 * mais velho sai) porque numa sessão que degrada é o último estado que explica o desfecho.
 */
export const TETO_DA_FILA = 30;

/**
 * Uma fila de relatos sobre um armazenamento injetado.
 *
 * @param {Object} [opcoes]
 * @param {{getItem: Function, setItem: Function, removeItem: Function}|null} [opcoes.storage] - O
 *   armazenamento. `null` é legítimo e significa "não enfileira", que é o caso degradado.
 * @param {number} [opcoes.teto] - Quantos itens cabem.
 * @param {string} [opcoes.chave] - A chave no armazenamento.
 * @returns {{enfileirar: (corpo: Object) => boolean, drenar: () => Object[], tamanho: () => number}}
 */
export function criarFilaDeRelatos({ storage, teto = TETO_DA_FILA, chave = CHAVE_DA_FILA } = {}) {
    /**
     * O que está guardado, sempre um array.
     *
     * O JSON CORROMPIDO VIRA FILA VAZIA, e não exceção: o valor pode ter sido escrito por outra
     * versão do produto, por outra aba no meio de uma escrita, ou por qualquer coisa que use a
     * mesma origem. Recomeçar do zero perde relatos velhos; lançar perderia os novos também.
     * @returns {Object[]}
     */
    function ler() {
        try {
            const cru = storage?.getItem(chave);
            if (typeof cru !== 'string' || !cru) return [];
            const lista = JSON.parse(cru);
            if (!Array.isArray(lista)) return [];
            return lista.filter((item) => item !== null && typeof item === 'object');
        } catch {
            return [];
        }
    }

    /** @param {Object[]} lista @returns {boolean} Se a escrita aconteceu. */
    function escrever(lista) {
        try {
            storage?.setItem(chave, JSON.stringify(lista));
            return Boolean(storage);
        } catch {
            return false;
        }
    }

    return {
        /**
         * Guarda um relato para a próxima carga da página.
         * @param {Object} corpo - O corpo do POST que não saiu.
         * @returns {boolean} Se ele foi guardado. `false` é um desfecho normal.
         */
        enfileirar(corpo) {
            try {
                if (corpo === null || typeof corpo !== 'object') return false;
                const lista = ler();
                lista.push(corpo);
                // O MAIS VELHO CAI. Corte pela frente, e num laço, porque um teto que mudou entre
                // versões pode encontrar uma fila maior que ele.
                while (lista.length > teto) lista.shift();
                return escrever(lista);
            } catch {
                return false;
            }
        },
        /**
         * Tira TUDO da fila e devolve.
         *
         * ESVAZIAR ANTES DE ENVIAR é deliberado: quem descarrega reenfileira o que falhar de novo,
         * então um item que continua sem sair não se acumula em duplicata. O preço é que um
         * fechamento de aba no meio do descarregamento perde o que estava em voo, e esse é o lado
         * certo de errar (duplicar um relato é pior que perdê-lo: ele vira contagem falsa).
         * @returns {Object[]}
         */
        drenar() {
            try {
                const lista = ler();
                if (lista.length > 0) {
                    try {
                        storage?.removeItem(chave);
                    } catch {
                        // Não deu para limpar: os itens saem e voltam a ser lidos no próximo boot.
                    }
                }
                return lista;
            } catch {
                return [];
            }
        },
        /** @returns {number} Quantos itens estão guardados. */
        tamanho() {
            return ler().length;
        },
    };
}

/** O `localStorage` da página, ou `null` quando lê-lo lança (modo privado, site bloqueado). */
let _armazenamento = null;
try {
    _armazenamento = globalThis.localStorage ?? null;
} catch {
    _armazenamento = null;
}

/** A fila do produto. Uma por origem, compartilhada por todas as abas, de propósito. */
export const filaDeRelatos = criarFilaDeRelatos({ storage: _armazenamento });
