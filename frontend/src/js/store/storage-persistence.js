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
 * ===========================================================================================
 * "POR HEURISTICA E NAO POR DIALOGO" E UMA FRASE SOBRE O CHROME, E ELA CUSTOU O BOOT INTEIRO
 * ===========================================================================================
 * No Chromium a permissao e de fato concedida por heuristica (sitio instalado, marcado nos
 * favoritos, engajamento alto): `persist()` resolve sem perguntar nada, medido em 0 ms. NO
 * FIREFOX ELA E UM DIALOGO. `persist()` abre o pedido de permissao e a promessa fica PENDENTE
 * ate alguem responder, o que num navegador automatizado, ou num usuario que simplesmente ignora
 * a tarja, e PARA SEMPRE. Medido em 2026-09-15 no Firefox 151 do Playwright: `persist()` seguia
 * sem resolver depois de 8 s, enquanto o Chromium resolvia `false` em 0 ms.
 *
 * Com o boot AGUARDANDO este pedido (`await pedirPersistencia()` em `index.js`), o efeito era o
 * mapa nunca montar: sem erro, sem console, sem tela de indisponivel, `#map-sig` vazio. Um
 * pedido OPCIONAL de faxina segurava a aplicacao inteira refem de uma resposta que podia nunca
 * vir. Dai a quarta regra abaixo, e daí o quarto desfecho.
 *
 * E DESDE 2026-09-23 O BOOT NEM ESPERA (decisao do dono). Com o prazo, o mapa montava, mas todo
 * boot de Firefox em que a tarja nao foi respondida pagava os 2000 ms inteiros, em toda carga e
 * em toda troca de atlas por recarga, e metade de quem usa o EBGeo esta no Firefox (medido pelo
 * agente da auditoria: o temporizador disparava em todo boot do Firefox no harness, e era
 * cancelado no Chromium). Esperar nao comprava nada: a concessao vale para o grupo de origem
 * INTEIRO, inclusive o que ja foi gravado antes dela, entao pedir antes de o store abrir os
 * bancos nunca foi condicao. `index.js` dispara o pedido e segue; o desfecho e `pendente` desde o
 * instante do pedido e se corrige sozinho quando o navegador responder.
 *
 * ===========================================================================================
 * QUATRO REGRAS, E TODAS SAO SOBRE NAO CUSTAR O BOOT
 * ===========================================================================================
 *   1. `persisted()` ANTES de `persist()`: o que ja foi concedido nao se repede, e num navegador
 *      que ja concedeu a segunda chamada e trabalho por nada.
 *   2. TUDO EM `try/catch`: a API nao existe em todo motor, e uma promessa recusada aqui nao pode
 *      derrubar a carga da pagina. Um erro vira `indisponivel`, que e a verdade.
 *   3. MODULO FOLHA, ZERO IMPORTS. Ele e chamado no boot antes de o store existir e e testavel em
 *      node com `navigator` dublado; qualquer import daqui amarraria o pedido a ordem de
 *      inicializacao de outra coisa.
 *   4. PRAZO EM VOLTA DE `persist()`, porque `try/catch` cobre a promessa que REJEITA e nao cobre
 *      a que NUNCA SE RESOLVE, e as duas custam coisas diferentes: a primeira custa um estado, a
 *      segunda custa a pagina. Estourado o prazo, o desfecho e `pendente` e o boot SEGUE; a
 *      resposta tardia continua valendo (quem concede e o navegador, nao esta funcao) e apenas
 *      corrige o desfecho guardado, para a linha de boot nao mentir se for impressa depois.
 *
 * O QUE ELE NAO FAZ: nao promete que o dado esta seguro (uma concessao REDUZ o risco de despejo,
 * nao o zera), nao mede a cota (`estimate()` fica para quando houver tela que a mostre) e nao
 * fala com o usuario. Quem le o desfecho e a linha de boot composta por `boot-legacy-adoption.js`,
 * que desde 2026-09-23 NAO vai mais ao console, a pedido do dono: o pedido continua valendo e o
 * desfecho continua guardado, mas hoje so os testes o leem.
 */

/**
 * @typedef {'sim'|'nao'|'indisponivel'|'pendente'} DesfechoDePersistencia
 *   `sim` = o armazenamento desta origem e persistente; `nao` = o navegador recusou;
 *   `indisponivel` = a API nao existe ou lancou, e nada se sabe; `pendente` = o navegador abriu
 *   um dialogo e ninguem respondeu AINDA (o pedido esta em curso, ou o prazo estourou).
 */

/**
 * Prazo do pedido, em ms. O boot NAO espera por ele desde 2026-09-23 (ver o `fileoverview`); o
 * prazo segura so quem aguardar a promessa, e garante que ela nunca fique pendente para sempre.
 */
export const PRAZO_DE_PERSISTENCIA_MS = 2000;

/** @type {DesfechoDePersistencia|null} O ultimo desfecho, ou null enquanto ninguem pediu. */
let _desfecho = null;

/**
 * Pede persistencia ao navegador, uma vez, e guarda o desfecho.
 *
 * @param {Object} [opcoes]
 * @param {number} [opcoes.prazoMs] - Prazo do `persist()`, injetavel para teste.
 * @returns {Promise<DesfechoDePersistencia>} O desfecho, que nunca e uma excecao e nunca demora
 *   mais que o prazo.
 */
export async function pedirPersistencia({ prazoMs = PRAZO_DE_PERSISTENCIA_MS } = {}) {
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

        // O PRAZO E EM VOLTA DO `persist()` E NAO DO `persisted()`: so o primeiro pode abrir
        // dialogo. Pôr o prazo nos dois faria o boot desistir de uma leitura que sempre responde.
        // `pendente` JA NO PEDIDO, e nao so quando o prazo estoura: o boot nao aguarda mais esta
        // promessa, entao a linha de boot pode ser composta com o dialogo ainda aberto, e sem
        // isto ela leria null, que significa "esta pagina nunca pediu".
        _desfecho = 'pendente';
        const pedido = armazenamento.persist();
        _desfecho = await comPrazo(pedido, prazoMs);
        return _desfecho;
    } catch (erro) {
        console.warn('Boot do atlas: o pedido de armazenamento persistente falhou:', erro);
        _desfecho = 'indisponivel';
        return _desfecho;
    }
}

/**
 * Espera a promessa do `persist()` ate o prazo, e nunca alem dele.
 *
 * A resposta TARDIA nao se perde: ela corrige o desfecho guardado, e so enquanto ele ainda for
 * `pendente`, para nao sobrescrever uma medicao posterior de outra chamada. A promessa original
 * ganha um tratador em todo caminho, senao uma recusa tardia viraria rejeicao nao tratada, que e
 * ruido de console com cara de defeito.
 *
 * @private
 * @param {Promise<boolean>} pedido - O que `persist()` devolveu.
 * @param {number} prazoMs - Prazo.
 * @returns {Promise<DesfechoDePersistencia>}
 */
function comPrazo(pedido, prazoMs) {
    let expirar = null;
    const prazo = new Promise((resolver) => {
        expirar = setTimeout(() => resolver('pendente'), prazoMs);
    });
    const resolvido = pedido.then(
        (valor) => (valor === true ? 'sim' : 'nao'),
        (erro) => {
            console.warn('Boot do atlas: o pedido de armazenamento persistente falhou:', erro);
            return 'indisponivel';
        }
    );
    resolvido.then((tardio) => {
        if (expirar !== null) clearTimeout(expirar);
        if (_desfecho === 'pendente') _desfecho = tardio;
    });
    return Promise.race([resolvido, prazo]);
}

/**
 * @returns {DesfechoDePersistencia|null} O desfecho do pedido deste boot, ou null quando esta
 *   pagina nunca pediu (a tela de atlas, um script, um teste). Null e o que faz a linha de boot
 *   omitir o campo em vez de afirmar um estado que ninguem mediu.
 */
export function desfechoDaPersistencia() {
    return _desfecho;
}
