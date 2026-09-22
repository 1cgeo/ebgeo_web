// Path: js/store/denial-phrases.js

/**
 * @fileoverview WHY a store write was refused, as a sentence the person can act on.
 *
 * ZERO IMPORTS, and that is a contract: this is loaded by the toast listener that runs on every
 * page that mounts the store, and anything reachable from here would ride along.
 *
 * THE DEFECT IT EXISTS TO CLOSE, measured on 2026-08-23. `store-error-listener.js` had ONE
 * sentence for every role refusal: "Acesso somente leitura, você não pode editar este projeto."
 * That sentence is TRUE for a Visualizador and FALSE for everyone above them. An Editor denied
 * `canDeleteMap` (deleting or combining maps is a management action, `manage` and up) was told
 * they cannot edit the project, which they demonstrably can: they had just been editing it. A
 * person who believes that sentence stops trying to work, or asks for the wrong level.
 *
 * THE PHRASE IS KEYED BY CAPABILITY, NOT BY ROLE, and the direction matters. Keying by role
 * would mean listing role names, which is the closed list the constitution forbids on this axis
 * (and which failed twice here already). The capability is what the gate actually consulted:
 * `checkPermission` resolves a {@link GuardAction} to a `PermissionAction` flag and refuses on
 * THAT, so quoting it back is quoting the real reason rather than a guess about the person.
 *
 * THE FALLBACK FAILS SAFE, and it is the whole point of having one. An unknown capability, or a
 * refusal that carries none, gets a sentence that says the level is insufficient WITHOUT naming
 * a capability the person may well have. Inventing "somente leitura" for an unrecognized refusal
 * is exactly the bug above, reintroduced by the default branch.
 *
 * ================= O SEGUNDO VOCABULÁRIO: ESTADO, NÃO CAPACIDADE =============
 *
 * `STORE_OPERATION_BLOCKED` carrega DUAS espécies de `reason`, e confundi-las é o que fez a
 * segunda morar solta no listener: uma CAPACIDADE (`canEdit`, `canDeleteMap`, o que
 * `checkPermission().required` devolveu) e um ESTADO do produto (`map_locked`,
 * `target_map_locked`, `map_missing`). A diferença que importa é a afordância: capacidade é
 * bloqueio por POSTO, permanente enquanto o papel for o que é; estado é reversível, e a frase tem
 * de NOMEAR o estado para a pessoa saber o que fazer a seguir.
 *
 * Os dois vocabulários NÃO se misturam numa tabela só. Uma capacidade nova é uma linha na escada
 * de permissões; um estado novo é uma condição da tela, e uma tabela única deixaria
 * `denialNotice('map_locked')` responder a frase genérica de papel, que é falsa e manda a pessoa
 * pedir um nível que ela já tem.
 */

/**
 * Capability -> the sentence shown to the person, in the vocabulary of the ladder they see on
 * screen (Leitor, Comentarista, Editor, Gestor, Dono).
 *
 * @type {Object<string, string>}
 */
const CAPABILITY_DENIAL = Object.freeze({
    canEdit: 'Seu nível neste atlas não permite editar.',
    canDelete: 'Seu nível neste atlas não permite apagar itens.',
    canDeleteMap: 'Apagar ou combinar mapas exige o nível Gestor neste atlas.',
    canComment: 'Seu nível neste atlas não permite comentar.',
    canLockMaps: 'Bloquear e desbloquear o mapa exige o nível Gestor neste atlas.',
    canManageUsers: 'Gerenciar participantes exige o nível Gestor neste atlas.'
});

/**
 * The sentence for a refusal that names no capability, or names one this build does not know.
 *
 * It must never assert a specific limitation. "Somente leitura" here is how the old single
 * sentence lied; a capability added tomorrow and not listed above would inherit that lie.
 * @type {string}
 */
export const UNKNOWN_DENIAL_TEXT = 'Seu nível neste atlas não permite esta ação.';

/**
 * The user-facing sentence for a refused write.
 *
 * @param {string|null|undefined} capability - The `PermissionAction` value the gate consulted
 *   (e.g. `'canDeleteMap'`), as carried by `checkPermission().required`.
 * @returns {string} A sentence that is true for whoever reads it.
 */
export function denialNotice(capability) {
    if (typeof capability !== 'string') return UNKNOWN_DENIAL_TEXT;
    // `Object.hasOwn` E NAO `??`, e a diferenca so aparece na chave HERDADA: esta tabela carrega o
    // prototipo de Object, entao `CAPABILITY_DENIAL['toString']` devolve uma FUNCAO, que nao e
    // nula e passa direto pelo `??`. O toast mostraria `function toString() { [native code] }` no
    // lugar de uma frase, que e o oposto exato do que este arquivo existe para garantir, e
    // `Object.freeze` nao protege disso. Esta casa ja pagou esta forma uma vez, na tabela de
    // avisos de chegada indexada pela URL. Aqui a chave vem de `checkPermission().required`, isto
    // e, de uma tabela interna congelada, de modo que o caso e INALCANCAVEL hoje: a troca existe
    // para que ele continue inalcancavel no dia em que a chave passar a vir de outro lugar.
    return Object.hasOwn(CAPABILITY_DENIAL, capability)
        ? CAPABILITY_DENIAL[capability]
        : UNKNOWN_DENIAL_TEXT;
}

/**
 * The capabilities this module has a sentence for. Exported so a test can assert the table
 * covers every `PermissionAction` value: a capability with no sentence is not a crash, it is a
 * silent downgrade to the generic text, which is the failure mode that is hardest to notice.
 * @returns {string[]}
 */
export function phrasedCapabilities() {
    return Object.keys(CAPABILITY_DENIAL);
}

/**
 * Estado do produto -> a frase, que NOMEIA o estado e diz o passo seguinte.
 *
 * As duas travas compartilham a frase de propósito: `target_map_locked` é a mesma trava vista do
 * outro lado de uma transferência, e inventar um segundo texto para ela faria a mesma condição se
 * anunciar de duas maneiras conforme o caminho.
 *
 * `map_missing` (D2, 2026-09-21) é o mapa que o atlas não tem mais: um par o apagou, ou o nome
 * corrente desta aba ficou para trás de um rename remoto. A frase diz a SAÍDA (escolher outro
 * mapa) porque a pessoa não pode fazer nada sobre a causa, e sem ela o gesto seria recusado em
 * silêncio, que é o defeito com outro nome.
 * @type {Object<string, string>}
 */
const STATE_DENIAL = Object.freeze({
    map_locked: 'Mapa bloqueado. Desbloqueie para editar.',
    target_map_locked: 'Mapa bloqueado. Desbloqueie para editar.',
    map_missing: 'Este mapa não existe mais neste atlas. Escolha outro mapa na aba Mapas.'
});

/**
 * A frase de uma recusa por ESTADO, ou `null` quando a recusa não é de estado.
 *
 * O `null` é o contrato, e não um descuido: é por ele que o chamador sabe que a recusa é de
 * CAPACIDADE e deve seguir para `denialNotice`. Devolver o texto genérico de papel aqui faria toda
 * recusa parecer de nível.
 *
 * `Object.hasOwn` pela mesma razão que em `denialNotice`: o `reason` vem do payload de um evento,
 * isto é, de mais de vinte sítios de emissão, e `'toString'` devolveria uma função pelo `??`.
 *
 * @param {string|null|undefined} reason - O `reason` de `STORE_OPERATION_BLOCKED`.
 * @returns {string|null} A frase do estado, ou null.
 */
export function stateDenialNotice(reason) {
    if (typeof reason !== 'string') return null;
    return Object.hasOwn(STATE_DENIAL, reason) ? STATE_DENIAL[reason] : null;
}

/**
 * Os estados que este módulo sabe nomear. Exportado para o censo: um `reason` de estado novo sem
 * frase não estoura, ele cai na frase genérica de PAPEL e mente sobre o motivo.
 * @returns {string[]}
 */
export function phrasedStates() {
    return Object.keys(STATE_DENIAL);
}

/**
 * The sentence for an answer of `edicaoIndisponivelSync` (`store/edicao-indisponivel.js`), or
 * `null` when that answer says nothing blocks editing.
 *
 * It keeps the two vocabularies apart the same way the listener does: a refusal on the POSTO
 * axis (`motivo: 'permissao'`) is phrased by the CAPABILITY it carries, and any other `motivo` is
 * a STATE and is phrased by name. Written here, and not at each surface that re-asks at the moment
 * of a gesture, because the photo gallery and the drop onto the map both need the two phrases and
 * would otherwise each grow a copy of this branching.
 *
 * It is a PHRASE, not a gate: a missing or malformed answer returns `null`, and a caller that went
 * ahead on that `null` still meets the store's own guard, which refuses and speaks.
 *
 * @param {{bloqueado?: boolean, motivo?: string|null, required?: string|null}|null|undefined} edicao
 * @returns {string|null}
 */
export function unavailableEditNotice(edicao) {
    if (!edicao || edicao.bloqueado !== true) return null;
    if (edicao.motivo === 'permissao') return denialNotice(edicao.required);
    return stateDenialNotice(edicao.motivo) ?? denialNotice(edicao.required);
}
