// Path: js/admin/producer-scope-phrases.js

/**
 * @fileoverview What the "Usuários" tab SAYS before and after a change that destroys
 * grants, as pure functions.
 *
 * POR QUE ISTO EXISTE. Salvar o formulário de usuário com o papel global trocado, ou com a
 * OM produtora trocada, dispara `fundamentoDeRaizPerdido` + `podarPorRaizes` no servidor
 * (`backend/src/modules/users/users.service.js`, origem `USER_DEMOTION`): TODA concessão
 * viva que aquela pessoa deu é revogada, com a subárvore pendurada nela. Até 2026-08-23 a
 * tela não dizia nada, nem antes nem depois, e o agravante é que a poda dispara na simples
 * desigualdade `omAntes !== omDepois`: corrigir um ERRO DE DIGITAÇÃO na OM de um produtor
 * destruía tudo o que ele havia concedido, com um toast dizendo "Usuário atualizado.".
 *
 * O IRMÃO É `group-phrases.js`, e a forma é copiada dele de propósito, `toCount` inclusive
 * (importado de lá, não recopiado): aviso ANTES com o número que a listagem já sabe, toast
 * DEPOIS com o número que o servidor mediu. Os dois podem discordar (alguém concedeu no
 * meio), e o que de fato caiu é o do servidor.
 *
 * O VEREDITO É UM ESPELHO, e essa é a parte frágil. `verdictOfChange` reimplementa a
 * decisão de `fundamentoDeRaizPerdido` para saber SE deve pedir confirmação. Ele não impõe
 * nada — a imposição é do servidor, e o toast relata o que o servidor devolveu —, mas se
 * ele derivar da definição do servidor o administrador volta a ficar sem aviso. Não há
 * teste ligando os dois lados: o precedente da casa para isso
 * (`sync-trace-espelha-backend.test.js`) importa os DOIS arquivos no mesmo processo, e
 * aqui isso é impossível, porque o lado do servidor mora num arquivo que puxa banco e
 * bcrypt. O par se mantém por leitura, e os dois `fileoverview`/docblock apontam um para o
 * outro. Mude os dois no mesmo commit.
 *
 * A PRÉVIA NÃO É UM ENDPOINT, e a escolha foi medida. A forma preferível seria uma rota
 * somente-leitura de prévia, com o mesmo gate do PUT, devolvendo a contagem: ela mataria o
 * espelho acima, porque o próprio servidor responderia SE poda e QUANTAS. O que a impede
 * hoje é o consumo: a tela fala com o servidor só por `store/sync/api-client.js`, e esta
 * fatia não pode tocar naquele arquivo; chamar o `_request` privado de dentro de uma aba
 * seria abrir uma porta que nenhum outro consumidor usa. A saída escolhida traz o número
 * REAL do mesmo jeito, sem rota nova e sem cliente novo: a listagem de usuários passou a
 * carregar `live_grant_count` por linha, exatamente como a listagem de grupos já carrega
 * `grant_count` para `groupDeletionWarning`. Se um dia a prévia virar rota, o que sai daqui
 * é `verdictOfChange`, e as frases continuam valendo.
 *
 * Every counter crosses the wire from a SQL `COUNT`, so it goes through `toCount()`: a
 * plural picked with `count === 1` reads "1 concessões" the moment the value arrives as
 * `'1'`, and that class of bug never shows up in a hand test.
 */

import { toCount } from './group-phrases.js';

/**
 * Os DOIS papéis globais que dão autoridade sobre TODO recurso privado.
 *
 * Conjunto e não comparação, pela mesma razão que o servidor: os quatro papéis globais NÃO
 * são uma escada, então `role !== 'user'` promoveria o produtor a esta lista e `role >= x`
 * não significa nada neste eixo.
 */
const PAPEIS_DE_DADO_GLOBAL = new Set(['admin', 'credenciado']);

/**
 * OS TRÊS MOTIVOS PELOS QUAIS UM SALVAMENTO PODA, e a razão de serem três e não dois.
 *
 * O servidor distingue só DOIS fundamentos (`acesso_global_de_dado` e
 * `escopo_de_producao`), porque para ele a pergunta é "o que a pessoa perdeu". Para quem
 * está diante do formulário a pergunta é outra, e o `escopo_de_producao` do servidor cobre
 * dois gestos que não se parecem: rebaixar um produtor (ele deixa de ser produtor) e
 * TROCAR a OM de quem continua produtor. O segundo é o que pega o administrador de
 * surpresa, porque na tela ele parece a correção de um campo.
 * @enum {string}
 */
export const PruneMotive = Object.freeze({
    /** Deixou de ser `admin`/`credenciado`: perdeu o fundamento de acesso global de dado. */
    PAPEL_GLOBAL: 'papel_global',
    /** Era Produtor e deixou de ser: o escopo de produção cai junto com o papel. */
    REBAIXOU_PRODUTOR: 'rebaixou_produtor',
    /** Continua Produtor, de OUTRA OM: em relação ao acervo antigo, deixou de produzir. */
    TROCOU_OM: 'trocou_om',
});

/**
 * SE o salvamento vai podar, e por qual dos três gestos.
 *
 * ESPELHO de `fundamentoDeRaizPerdido` (ver o `fileoverview`): a resposta booleana é a
 * mesma, e o refinamento é só do motivo. A ordem dos ramos é a do servidor e NÃO é
 * arbitrária:
 *
 * (1) Quem TERMINA com acesso global de dado não perdeu nada, e este ramo vem primeiro.
 *     Promover um produtor a administrador apaga `producer_org_id` (o CHECK bicondicional
 *     do banco não deixa um admin carregar escopo), então uma regra escrita sobre a coluna
 *     leria a promoção como perda e avisaria destruição no ato que AUMENTA a autoridade.
 *
 * (2) Sair do eixo global é perda sem compensação: o escopo de produção, quando existe,
 *     cobre uma OM, nunca o acervo inteiro.
 *
 * (3) `omAntes && omAntes !== omDepois`, e não `omDepois === null`: quem sai da OM A para
 *     a OM B deixou de produzir o acervo da A, e a concessão viva sobre ele perdeu o
 *     fundamento. Aqui é que os dois gestos se separam pelo papel.
 *
 * @param {{role?: string, producer_org_id?: string|null}} antes - O usuário como está hoje.
 * @param {{role?: string, producer_org_id?: string|null}} depois - O que o formulário vai enviar.
 * @returns {string|null} Um valor de {@link PruneMotive}, ou `null` quando nada é podado.
 */
export function verdictOfChange(antes, depois) {
    const papelAntes = antes?.role ?? 'user';
    const papelDepois = depois?.role ?? 'user';
    if (PAPEIS_DE_DADO_GLOBAL.has(papelDepois)) return null;
    if (PAPEIS_DE_DADO_GLOBAL.has(papelAntes)) return PruneMotive.PAPEL_GLOBAL;

    const omAntes = antes?.producer_org_id ?? null;
    const omDepois = depois?.producer_org_id ?? null;
    if (omAntes && omAntes !== omDepois) {
        return papelDepois === 'producer'
            ? PruneMotive.TROCOU_OM
            : PruneMotive.REBAIXOU_PRODUTOR;
    }
    return null;
}

/**
 * "1 concessão" / "3 concessões".
 * @param {*} value
 * @returns {string}
 */
export function grantLabel(value) {
    const n = toCount(value);
    return `${n} ${n === 1 ? 'concessão' : 'concessões'}`;
}

/**
 * O QUE MUDA NA AUTORIDADE, por motivo. Frase própria, e não um trecho interpolado, porque
 * é a metade da confirmação que responde "por que isso está acontecendo".
 * @param {string|null} motivo - Um valor de {@link PruneMotive}.
 * @returns {string}
 */
function causa(motivo) {
    if (motivo === PruneMotive.TROCOU_OM) {
        return 'Ele continua Produtor, mas passa a manter outra OM, '
            + 'e deixa de produzir o acervo da OM anterior.';
    }
    if (motivo === PruneMotive.REBAIXOU_PRODUTOR) {
        return 'Ele deixa de ser Produtor e perde a OM que mantinha.';
    }
    return 'Ele deixa de ter acesso global aos dados, '
        + 'que é o fundamento das concessões que ele deu.';
}

/**
 * O EFEITO, com o número que a listagem conhece.
 *
 * O RAMO DE ZERO NÃO É DECORAÇÃO. Trocar a OM de um produtor que nunca concedeu nada é
 * uma edição inofensiva, e "revoga 0 concessões" transforma o caso normal num susto — a
 * mesma regra que `groupDeletionWarning` aplica ao grupo vazio. A confirmação continua
 * aparecendo, porque a autoridade muda de fato e a contagem é um retrato da listagem, que
 * pode ter envelhecido desde que a tela abriu.
 *
 * A CASCATA NÃO TEM NÚMERO, e isso é honesto: a listagem conhece as concessões que a
 * pessoa deu, e a subárvore pendurada nelas só é conhecida depois do ato, pelo
 * `grantsAffected` do servidor. Ela só entra quando existe concessão viva, porque sem raiz
 * não há repasse pendurado e prometer uma queda impossível gasta a credibilidade da frase
 * alta no caso em que ela é alta.
 *
 * @param {*} liveGrants
 * @returns {string}
 */
function efeito(liveGrants) {
    const n = toCount(liveGrants);
    if (n === 0) {
        return 'Ele não tem nenhuma concessão viva hoje, então nada é revogado agora.';
    }
    return `As ${grantLabel(n)} que ele deu são revogadas, junto com o que os `
        + 'beneficiários repassaram a partir delas. Isso não se desfaz.';
}

/**
 * O aviso que precede o salvamento, composto de causa mais efeito.
 *
 * COMPOSIÇÃO E NÃO ENUMERAÇÃO, como no irmão: três motivos vezes dois estados de contagem
 * dariam seis frases escritas à mão, e seis frases divergem na primeira revisão.
 *
 * @param {{motivo: string|null, liveGrants?: *}} params
 * @returns {string}
 */
export function producerScopeChangeWarning({ motivo, liveGrants }) {
    return `${causa(motivo)} ${efeito(liveGrants)}`;
}

/**
 * O título da confirmação, que é onde o gesto é NOMEADO.
 *
 * Ele diz qual dos dois gatilhos está acontecendo, porque é a primeira linha que a pessoa
 * lê e porque os dois se parecem no formulário: um campo trocado num caso, outro no outro.
 *
 * @param {{motivo: string|null, username?: string}} params
 * @returns {string}
 */
export function producerScopeChangeTitle({ motivo, username }) {
    const quem = (username || '').trim() || 'este usuário';
    if (motivo === PruneMotive.TROCOU_OM) {
        return `Trocar a OM produtora de "${quem}"?`;
    }
    return `Trocar o papel de "${quem}"?`;
}

/**
 * O rótulo do botão que confirma.
 *
 * Ele muda com a contagem porque um botão "Salvar e revogar" numa edição que não revoga
 * nada é uma ameaça falsa, e ameaça falsa é o que faz a pessoa parar de ler o botão.
 *
 * @param {*} liveGrants
 * @returns {string}
 */
export function producerScopeChangeConfirmLabel(liveGrants) {
    return toCount(liveGrants) > 0 ? 'Salvar e revogar' : 'Salvar';
}

/**
 * O toast DEPOIS do salvamento, com os números do SERVIDOR.
 *
 * `grantsAffected` conta a poda inteira (raízes mais descendentes) e `grantsReparented`
 * conta quem MANTEVE o acesso por outro caminho — sem o segundo, um `grantsAffected` menor
 * que o esperado parece poda incompleta.
 *
 * O EIXO ZERADO NÃO VIRA "0", pela mesma razão de `memberRemovalSummary`: a edição comum
 * de usuário não poda nada, e anunciar "0 concessões revogadas" a cada salvamento
 * transformaria o caso normal num susto e apagaria o sinal do caso que importa.
 *
 * @param {{grantsAffected?: *, grantsReparented?: *}} result - O corpo do PUT.
 * @returns {string}
 */
export function producerScopeChangeSummary(result) {
    const revogadas = toCount(result?.grantsAffected);
    const mantidas = toCount(result?.grantsReparented);
    let frase = 'Usuário atualizado.';
    if (revogadas > 0) frase += ` Concessões revogadas: ${revogadas}.`;
    if (mantidas > 0) frase += ` Mantidas por outro caminho: ${mantidas}.`;
    return frase;
}
