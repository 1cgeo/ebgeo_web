// Path: js/store/migration/abrir-recuperado.js

/**
 * @fileoverview O Recuperado ABRE DIRETO (decisão do dono, 2026-09-23).
 *
 * Até esta data o resgate das alterações tardias da versão antiga (`recovery-archive.js`) guardava
 * o trabalho num atlas novo e só avisava ("Ele está na sua lista, em Seus atlas"): o boot seguia no
 * atlas atualizado, e a pessoa tinha de achar sozinha onde o seu trabalho tinha ido parar.
 *
 * Esta função roda no PORTÃO, antes de a store montar qualquer atlas, e aponta o boot para o
 * Recuperado com os mesmos quatro passos com que a tela de atlas abre um atlas local
 * (`pointAtLocalAtlasAndGo`, em `projects/projects-page.js`), pelas mesmas razões:
 *
 *   1. `markStoreLocal`, porque com a origem REMOTE e sessão viva o boot abriria o atlas do servidor.
 *   2. O ponteiro da INSTALAÇÃO (`GlobalKey.CURRENT_LOCAL_ATLAS`), gravado direto no banco global,
 *      como a própria transição faz ao concluir (`legacy-transition.js`): no portão o registro de
 *      atlas locais ainda não foi carregado, então a API dele não está de pé.
 *   3. `clearActiveScope`, que apaga o ponteiro da ABA. Ele vence o da instalação no boot, e uma aba
 *      que vinha de outro slot reabriria esse outro slot.
 *   4. A intenção local da aba, senão uma sessão logada é mandada para a tela de atlas.
 *
 * Não monta nada: montar é do boot.
 */

import { GlobalKey, clearActiveScope, getGlobalStore, readLocalAtlasRegistry } from '../atlas-namespace.js';
import { markStoreLocal } from '../store-origin.js';
import { LOCAL_INTENT_KEY } from '../../deep-link/local-intent.js';

/**
 * @param {{id?: string}|null|undefined} entry - O Recuperado que o resgate devolveu.
 * @returns {Promise<boolean>} Se o boot passou a apontar para ele. Falso quando ele não está no
 *   registro, que é o caso de um resgate que não chegou a registrar nada.
 */
export async function apontarParaORecuperado(entry) {
    if (!entry?.id) return false;
    const registro = await readLocalAtlasRegistry();
    if (!registro.some(e => e.id === entry.id)) return false;
    await markStoreLocal();
    await getGlobalStore().setItem(GlobalKey.CURRENT_LOCAL_ATLAS, entry.id);
    clearActiveScope();
    try {
        sessionStorage.setItem(LOCAL_INTENT_KEY, '1');
    } catch {
        // Sem sessionStorage (node, armazenamento bloqueado): uma sessão logada pode cair na tela de
        // atlas, com o Recuperado já como o atlas local corrente. Nada se perde.
    }
    return true;
}
