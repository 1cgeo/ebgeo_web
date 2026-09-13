// Path: js/store/sync/issue-classes.js

/**
 * @fileoverview As classes de problema da fila de saída, e por que elas não são uma só.
 *
 * TRÊS DESFECHOS DIFERENTES CHEGAVAM COM A MESMA CARA. A fila guarda um resultado durável para
 * toda operação que o servidor não aplicou (`recordIssue`, `operation-queue.js`), e até aqui esse
 * resultado era só o ack cru: quem lia a lista via `rejected: true` e uma frase, sem saber se
 * aquilo era uma disputa (o dado do servidor mudou desde a base que a pessoa viu), uma recusa de
 * política (o posto não permite, e nunca vai permitir com esta conta) ou o efeito colateral de
 * outra operação parada na frente. As três pedem coisas diferentes da pessoa: a primeira pede uma
 * decisão sobre conteúdo, a segunda pede outra conta ou outro pedido, e a terceira não pede nada,
 * porque se resolve sozinha quando a que a bloqueia sair da frente.
 *
 * A DEPENDÊNCIA BLOQUEADA NÃO É UM REGISTRO, E ISSO É DELIBERADO. Ela não é escrita em disco por
 * ninguém: é DERIVADA a cada leitura, pela mesma regra que o carregador da fila usa para decidir o
 * que pode ser enviado (`PendingBlockade`). Gravá-la criaria um problema durável cuja causa pode
 * desaparecer na leitura seguinte, e a próxima pessoa a olhar veria uma pendência para uma
 * operação que já está livre para sair. Por isso ela só aparece em `getProblems`, que deriva, e
 * nunca em `getIssues`, que lê o que foi escrito.
 *
 * ZERO IMPORTS por contrato: a fila, o motor de sync e um dia o painel de resolução leem daqui, e
 * nenhum deles pode arrastar os outros.
 */

/** As classes de problema. `dependencia` é derivada; as outras três vêm de um registro. */
export const IssueClass = Object.freeze({
    /** O servidor recusou porque a entidade mudou desde a base declarada. */
    CONFLITO: 'conflito',
    /** O servidor recusou por política, integridade ou conteúdo: repetir não muda o desfecho. */
    RECUSA: 'recusa',
    /** Intenção de um protocolo anterior, retida para revisão antes de qualquer reenvio. */
    REVISAO: 'revisao',
    /** Não foi recusada: está atrás de outra que está. Sai sozinha quando aquela sair. */
    DEPENDENCIA: 'dependencia',
});

/**
 * A classe de um resultado GUARDADO.
 *
 * O sinal do conflito é o `status: 'conflict'` do recibo, com o objeto `conflict` ao lado
 * (unidades em disputa, `entityVersion`, e o `serverData` quando houver). Ele é lido dos DOIS
 * jeitos de propósito: um recibo de servidor antigo pode trazer o objeto sem o status, e uma
 * recusa de política nunca traz nenhum dos dois.
 *
 * @param {Object|null|undefined} result - O ack guardado por `recordIssue`.
 * @returns {string} Uma das classes acima (nunca `DEPENDENCIA`, que não se grava).
 */
export function classifyIssue(result) {
    if (result?.status === 'conflict' || result?.conflict) return IssueClass.CONFLITO;
    if (result?.status === 'review') return IssueClass.REVISAO;
    return IssueClass.RECUSA;
}
