// Path: js/store/storage-persistence.js

/**
 * @fileoverview Pede ao navegador que o armazenamento desta origem seja PERSISTENTE, e guarda o
 * desfecho para a linha de boot.
 *
 * ===========================================================================================
 * POR QUE PEDIR
 * ===========================================================================================
 * Sem `navigator.storage.persist()`, o grupo de origem do EBGeo e *best-effort*: sob pressao de
 * disco o navegador elege a origem para despejo, e o despejo e do GRUPO INTEIRO, nao do banco
 * menos usado. Para quem acabou de atravessar, isso e o acervo de 14 mapas e 149 imagens mais os
 * slots com sufixo indo embora de uma vez, sem gesto do usuario, sem linha no console e sem nada
 * na tela. Medido em 2026-09-07: `grep` por `navigator.storage`, `persist(`, `persisted()` e
 * `estimate()` devolvia ZERO nas duas linhas do produto, e a integracao e justamente a que
 * multiplica o dado por ate dez atlas locais.
 *
 * A permissao e concedida por HEURISTICA (sitio instalado, marcado nos favoritos, engajamento
 * alto) e nao por dialogo, entao pedir e barato e a recusa e um estado NORMAL, nao um erro.
 *
 * ===========================================================================================
 * TRES REGRAS, E TODAS SAO SOBRE NAO CUSTAR O BOOT
 * ===========================================================================================
 *   1. `persisted()` ANTES de `persist()`: o que ja foi concedido nao se repede, e num navegador
 *      que ja concedeu a segunda chamada e trabalho por nada.
 *   2. TUDO EM `try/catch`: a API nao existe em todo motor, e uma promessa recusada aqui nao pode
 *      derrubar a carga da pagina. Um erro vira `indisponivel`, que e a verdade.
 *   3. MODULO FOLHA, ZERO IMPORTS. Ele e chamado no boot antes de o store existir e e testavel em
 *      node com `navigator` dublado; qualquer import daqui amarraria o pedido a ordem de
 *      inicializacao de outra coisa.
 *
 * O QUE ELE NAO FAZ: nao promete que o dado esta seguro (uma concessao REDUZ o risco de despejo,
 * nao o zera), nao mede a cota (`estimate()` fica para quando houver tela que a mostre) e nao
 * fala com o usuario. Quem le o desfecho e a linha de boot de `boot-legacy-adoption.js`, que e a
 * unica linha que o suporte tem para confirmar a travessia.
 */

/**
 * @typedef {'sim'|'nao'|'indisponivel'} DesfechoDePersistencia
 *   `sim` = o armazenamento desta origem e persistente; `nao` = o navegador recusou;
 *   `indisponivel` = a API nao existe ou lancou, e nada se sabe.
 */

/** @type {DesfechoDePersistencia|null} O ultimo desfecho, ou null enquanto ninguem pediu. */
let _desfecho = null;

/**
 * Pede persistencia ao navegador, uma vez, e guarda o desfecho.
 *
 * @returns {Promise<DesfechoDePersistencia>} O desfecho, que nunca e uma excecao.
 */
export async function pedirPersistencia() {
    try {
        const armazenamento = globalThis.navigator?.storage;
        if (typeof armazenamento?.persisted !== 'function'
            || typeof armazenamento?.persist !== 'function') {
            _desfecho = 'indisponivel';
            return _desfecho;
        }

        if (await armazenamento.persisted() === true) {
            _desfecho = 'sim';
            return _desfecho;
        }

        _desfecho = await armazenamento.persist() === true ? 'sim' : 'nao';
        return _desfecho;
    } catch (erro) {
        console.warn('Boot do atlas: o pedido de armazenamento persistente falhou:', erro);
        _desfecho = 'indisponivel';
        return _desfecho;
    }
}

/**
 * @returns {DesfechoDePersistencia|null} O desfecho do pedido deste boot, ou null quando esta
 *   pagina nunca pediu (a tela de atlas, um script, um teste). Null e o que faz a linha de boot
 *   omitir o campo em vez de afirmar um estado que ninguem mediu.
 */
export function desfechoDaPersistencia() {
    return _desfecho;
}
