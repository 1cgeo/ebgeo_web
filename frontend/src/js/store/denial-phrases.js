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
 */

/**
 * Capability -> the sentence shown to the person, in the vocabulary of the ladder they see on
 * screen (Leitor, Comentarista, Editor, Gestor, Dono).
 *
 * `canLockMaps` says DONO and not Gestor on purpose: the server keeps lock/unlock strictly
 * owner-only (`operationDenialReason`, `backend/src/modules/sync/sync.service.js`), deliberately
 * narrower than delete, because it is a coordination override rather than a management action.
 * @type {Object<string, string>}
 */
const CAPABILITY_DENIAL = Object.freeze({
    canEdit: 'Seu nível neste atlas não permite editar.',
    canDelete: 'Seu nível neste atlas não permite apagar itens.',
    canDeleteMap: 'Apagar ou combinar mapas exige o nível Gestor neste atlas.',
    canComment: 'Seu nível neste atlas não permite comentar.',
    canLockMaps: 'Travar e destravar o mapa é exclusivo do dono do atlas.',
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
    return CAPABILITY_DENIAL[capability] ?? UNKNOWN_DENIAL_TEXT;
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
