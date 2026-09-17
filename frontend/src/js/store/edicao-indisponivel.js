// Path: js/store/edicao-indisponivel.js

/**
 * @fileoverview "NÃO DÁ PARA EDITAR AGORA", nos DOIS eixos, numa conta só.
 *
 * O produto sempre soube responder isso por ESTADO (o mapa travado, `isCurrentMapLockedSync`) e por
 * POSTO (o papel no atlas, `checkPermission`), em caminhos separados — e quinze superfícies
 * perguntavam só pelo primeiro. O efeito, medido em 2026-09-16: quem entrava com compartilhamento
 * `read` ou por link público via o painel de feição inteiro, a tabela de atributos, o menu de
 * contexto, os cartões de briefing e as teclas de desenho como se pudesse editar, e a escrita morria
 * lá embaixo, no guarda da store. Em oito delas a TELA AFIRMAVA O CONTRÁRIO: "Briefing X excluído"
 * sobre uma exclusão recusada, a feição pintada na fonte do MapLibre por um atalho de teclado, a
 * linha do catálogo sumindo da lista, "Configurações salvas.".
 *
 * A soma mora AQUI, e não repetida em cada consumidor, pela razão que o mapa base cobrou no mesmo
 * dia: duas contas do mesmo fato divergem no dia em que uma delas muda.
 *
 * O MOTIVO VIAJA JUNTO porque as duas recusas não dizem a mesma coisa: a da trava é reversível pelo
 * dono do atlas ("destrave para editar") e a do posto é do nível da pessoa, com a frase derivada da
 * CAPACIDADE negada (`denialNotice`). Quem esconde o comando usa só `bloqueado`; quem fala usa o
 * resto.
 *
 * A ORDEM É POSTO, DEPOIS ESTADO, a mesma de `guardWrite` (`feature.operations.js`) e a que
 * `layer-operations.test.js` fixa pelo nome: quem não tem nível nenhum não deve receber a frase que
 * manda destravar um mapa que ele não poderia editar de qualquer jeito.
 *
 * @dependencies @store/map.operations.js (isCurrentMapLockedSync),
 *   @store/sync/permission-guard.js (checkPermission)
 */

import { isCurrentMapLockedSync } from './map.operations.js';
import { checkPermission } from './sync/permission-guard.js';

/**
 * @typedef {Object} EdicaoIndisponivel
 * @property {boolean} bloqueado - Se alguma coisa impede editar agora.
 * @property {('permissao'|'map_locked'|null)} motivo - Qual dos dois eixos recusou.
 * @property {string|null} required - A CAPACIDADE negada (`canEdit`, ...), só no eixo de posto.
 *   É a chave que `denialNotice` traduz em frase; no eixo de estado ela não existe.
 */

/**
 * Responde se a edição está indisponível agora, e por quê.
 *
 * @param {string} [acao='UPDATE_FEATURE'] - A `GuardAction` que a superfície realmente exerce. O
 *   padrão é a edição de feição, que é o que quase toda afordância de mapa pede; um comando que
 *   apaga deve passar a ação DELE, ou a frase da recusa citaria a capacidade errada.
 * @returns {EdicaoIndisponivel}
 */
export function edicaoIndisponivelSync(acao = 'UPDATE_FEATURE') {
    const perm = checkPermission(acao);
    if (!perm.allowed) {
        return { bloqueado: true, motivo: 'permissao', required: perm.required ?? null };
    }
    if (isCurrentMapLockedSync()) {
        return { bloqueado: true, motivo: 'map_locked', required: null };
    }
    return { bloqueado: false, motivo: null, required: null };
}

/**
 * Atalho booleano, para quem só precisa decidir se DESENHA a afordância.
 *
 * O produto esconde o comando nos dois eixos (decisão do dono, 2026-09-16): quem não pode editar
 * não vê o comando de edição, venha a recusa do posto ou da trava do mapa.
 * @param {string} [acao='UPDATE_FEATURE']
 * @returns {boolean}
 */
export function semEdicaoSync(acao = 'UPDATE_FEATURE') {
    return edicaoIndisponivelSync(acao).bloqueado;
}
