// Path: js/ui/producer-org-notice.js

/**
 * @fileoverview A frase de quando a OM PRODUTORA foi desativada.
 *
 * ZERO IMPORTS, contrato e não estilo: é lida pela barra superior das três páginas sem mapa e pelo
 * controle de conta DENTRO do mapa, e um import aqui arrastaria o grafo de uma para a outra.
 *
 * O DEFEITO QUE ELA FECHA É O PIOR PADRÃO DE RECUSA QUE EXISTE: painel inteiro funcional negando
 * tudo com a mensagem menos informativa possível. `fn_can_produce_resource` exige a OM produtora
 * ATIVA, e o gate de rota não barra (`CATALOG_PRODUCER_ACTOR` resolve o escopo juntando só a OM de
 * LOTAÇÃO, então a requisição passa); quem recusa é o predicado dentro do `WHERE` da escrita, e um
 * `WHERE` que não casa devolve zero linhas, que viram **404**. Ou seja: a porta "Catálogo" abria, a
 * calibração continuava visível, Editar e Excluir continuavam desenhados, e cada gravação voltava
 * "não encontrado" — sobre um item que estava ali na tela.
 *
 * POR QUE A FRASE NÃO DIZ "SEM PERMISSÃO". Ninguém perdeu papel: o crachá de produtor continua,
 * e é a ORGANIZAÇÃO que foi desativada por um administrador. Uma frase de permissão mandaria a
 * pessoa pedir um papel que ela já tem, que é exatamente o erro que a recusa da calibração cometia.
 * O que resolve é reativar a OM, e é isso que ela diz.
 *
 * E POR QUE ELA É REVERSÍVEL NO TEXTO: reativar a OM devolve tudo, sem perda. Dizer isso evita que
 * a pessoa conclua que o acervo dela foi destruído e vá recriar o que ainda existe.
 */

/**
 * O aviso para uma sessão cujo crachá de produtor está vivo e cuja OM produtora não está.
 *
 * @param {Object} [entrada]
 * @param {boolean} [entrada.inativa] - O que `sessionContext.isProducerOrgInactive()` respondeu.
 * @param {string|null} [entrada.nome] - O nome da OM, resolvido pelo SERVIDOR.
 * @returns {{title: string, message: string}|null} Nulo quando não há o que dizer, para que o
 *   chamador não tenha de repetir a condição.
 */
export function producerOrgInactiveNotice({ inativa = false, nome = null } = {}) {
    if (inativa !== true) return null;
    // O NOME VEM DO PAYLOAD DE SESSÃO e não da lista de OMs do `/api/config`: aquela lista só traz
    // OM ATIVA, então era justamente neste caso que o nome sumia e a tela caía no UUID cru.
    const qual = nome ? `A OM "${nome}"` : 'A OM para a qual você produz';
    return {
        title: 'Escopo de produção suspenso',
        message: `${qual} foi desativada, então tudo o que você mantém por ela está fora de `
            + 'alcance: o servidor recusa cada gravação, e a calibração 360 não abre. Nada foi '
            + 'apagado, e reativar a OM devolve o acesso. Peça a um administrador.',
    };
}
