// Path: js/admin/org-options.js

/**
 * @fileoverview A lista de Organizações Militares, na forma que as abas do painel precisam.
 *
 * A FONTE É `config.organizacoesMilitares`, hidratado por `GET /api/config` no boot da página, e
 * não uma chamada própria: uma segunda fonte para a mesma lista diverge, e a divergência aparece
 * como duas telas discordando sobre quais OMs existem. Nenhuma aba deve chamar a rota de
 * organizações no mount só para preencher um `<select>`.
 *
 * Este módulo nasceu porque a resolução id → nome passou a ser feita em DUAS abas (a de usuários,
 * pela OM produtora, e a de catálogo, pela OM dona) e as duas já carregavam cópias divergentes do
 * mesmo par de funções.
 */

import config from '@js/config.js';

/**
 * Resolve o id de uma OM para o nome de exibição, caindo no id cru quando ele não está na lista
 * ativa (OM desativada depois de o recurso ter sido carimbado, por exemplo).
 * @param {string} [orgId]
 * @param {string} [vazio] - O que mostrar quando não há OM. Default: travessão.
 * @returns {string}
 */
export function orgLabel(orgId, vazio = '—') {
    if (!orgId) return vazio;
    const list = Array.isArray(config.organizacoesMilitares) ? config.organizacoesMilitares : [];
    const found = list.find((o) => o && o.id === orgId);
    return found?.name || orgId;
}

/**
 * Monta as opções de um `<select>` a partir de uma lista controlada pelo backend
 * (`config.postos` / `config.organizacoesMilitares`). O VALOR da opção é o id da linha (a FK); um
 * "(nenhum)" à frente permite limpar, e o id atual é preservado (rotulado com o nome derivado)
 * mesmo que ele não esteja mais na lista ativa.
 * @param {Array<{id: string, name: string}>|undefined} list
 * @param {string} [currentId]
 * @param {string} [currentLabel]
 * @param {string} [rotuloVazio] - Rótulo da opção vazia.
 * @returns {Array<{value: string, label: string}>}
 */
export function buildDomainOptions(list, currentId, currentLabel, rotuloVazio = '— (nenhum)') {
    const opts = [{ value: '', label: rotuloVazio }];
    const seen = new Set();
    for (const item of (Array.isArray(list) ? list : [])) {
        if (item && item.id && !seen.has(item.id)) {
            opts.push({ value: item.id, label: item.name });
            seen.add(item.id);
        }
    }
    if (currentId && !seen.has(currentId)) {
        opts.push({ value: currentId, label: `${currentLabel || currentId} (atual)` });
    }
    return opts;
}
