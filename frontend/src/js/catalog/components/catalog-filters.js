// Path: js/catalog/components/catalog-filters.js

/**
 * @fileoverview Catalog filters sidebar component.
 *
 * SÃO DOIS GRUPOS DE FILTRO, e eles se cruzam: TIPO (o que o item é) e ACESSO (por que você
 * o enxerga). O segundo nasceu em 2026-08-24 porque o acervo privado passou a ter dono de
 * verdade: o CREDENCIADO enxerga todo o privado do sistema somado ao público, numa grade que
 * só sabia filtrar por tipo. Sem o eixo de acesso ele não tem como estreitar a lista para o
 * que interessa, que quase sempre é "o que é restrito" ou "o que só existe aqui dentro".
 *
 * O GRUPO DE ACESSO SE ESCONDE QUANDO NÃO SEPARA NADA, e essa é a parte que não se adivinha
 * lendo o desenho: para um visitante anônimo (ou para quem não recebeu nada) o acervo é todo
 * público, e um filtro cujas duas metades são "tudo" e "nada" só ocupa a barra. As três chaves
 * de ORIGEM se escondem pela mesma regra, uma a uma: origem que não tem item hoje é um botão
 * que só sabe produzir lista vazia. Quem decide é a CONTAGEM, em `updateAccessFilterCounts`,
 * e não um palpite sobre o papel de quem olha.
 */

import { CATALOG_MODAL_FILTERS } from '../catalog.constants.js';
import { ACCESS_FILTER, accessFilterLabel, accessFilterTitle } from '../access-origin-phrases.js';

/**
 * A ordem em que as chaves de acesso aparecem na barra: primeiro o corte grosso (público
 * contra privado), depois as três origens, que são subconjuntos do segundo.
 * @type {string[]}
 */
export const ACCESS_FILTER_ORDER = Object.freeze([
    ACCESS_FILTER.PUBLICO,
    ACCESS_FILTER.PRIVADO,
    ACCESS_FILTER.PAPEL,
    ACCESS_FILTER.CONCESSAO,
    ACCESS_FILTER.EMPRESTIMO,
]);

/** As três chaves que só existem quando o servidor manda a procedência. @type {string[]} */
const CHAVES_DE_ORIGEM = Object.freeze([
    ACCESS_FILTER.PAPEL,
    ACCESS_FILTER.CONCESSAO,
    ACCESS_FILTER.EMPRESTIMO,
]);

/**
 * Creates the filters sidebar with toggle buttons.
 * Only shows filters defined in CATALOG_MODAL_FILTERS.
 * @param {Object} options
 * @param {Object} options.types - Type configurations
 * @param {Set} options.activeFilters - Active filters
 * @param {Function} options.onFilterChange - Filter change callback
 * @param {Set} [options.activeAccessFilters] - Chaves de acesso ligadas
 * @param {Function} [options.onAccessFilterChange] - (chave, ligada) => void
 * @returns {HTMLElement}
 */
export function createCatalogFilters({
    types,
    activeFilters,
    onFilterChange,
    activeAccessFilters,
    onAccessFilterChange,
}) {
    const sidebar = document.createElement('aside');
    sidebar.className = 'catalog-filters';

    const title = document.createElement('h3');
    title.className = 'catalog-filters-title';
    title.textContent = 'Filtrar por tipo';
    sidebar.appendChild(title);

    const filtersList = document.createElement('div');
    filtersList.className = 'catalog-filters-list';

    // Only show filters defined in CATALOG_MODAL_FILTERS
    CATALOG_MODAL_FILTERS.forEach(type => {
        const config = types[type];
        if (!config) return;

        const button = document.createElement('button');
        button.className = 'catalog-filter-btn';
        button.dataset.type = type;
        button.dataset.active = activeFilters.has(type) ? 'true' : 'false';
        button.style.setProperty('--filter-color', config.color);

        button.innerHTML = `
            <span class="filter-indicator"></span>
            <span class="filter-icon">${config.icon}</span>
            <span class="filter-label">${config.label}</span>
            <span class="filter-count" data-filter-count="${type}"></span>
        `;

        button.addEventListener('click', () => {
            const isActive = button.dataset.active === 'true';
            button.dataset.active = (!isActive).toString();
            onFilterChange(type, !isActive);
        });

        filtersList.appendChild(button);
    });

    sidebar.appendChild(filtersList);

    if (onAccessFilterChange) {
        sidebar.appendChild(createAccessFilters({
            activeAccessFilters: activeAccessFilters ?? new Set(),
            onAccessFilterChange,
        }));
    }

    return sidebar;
}

/**
 * @private O segundo grupo da barra, com as cinco chaves de acesso.
 *
 * NASCE INTEIRO E ESCONDIDO. O grupo só aparece depois que a contagem chega, porque é ela que
 * sabe se há privado nenhum (grupo inteiro sem função) e quais origens existem hoje. Desenhar
 * primeiro e revelar depois é o que evita a barra pular de tamanho a cada carga da grade.
 * @param {{activeAccessFilters: Set, onAccessFilterChange: Function}} options
 * @returns {HTMLElement}
 */
function createAccessFilters({ activeAccessFilters, onAccessFilterChange }) {
    const grupo = document.createElement('div');
    grupo.className = 'catalog-filters-group';
    grupo.dataset.testid = 'catalog-access-filters';
    grupo.hidden = true;

    const titulo = document.createElement('h3');
    titulo.className = 'catalog-filters-title catalog-filters-title--acesso';
    titulo.textContent = 'Filtrar por acesso';
    grupo.appendChild(titulo);

    const lista = document.createElement('div');
    lista.className = 'catalog-filters-list';

    ACCESS_FILTER_ORDER.forEach((chave) => {
        const botao = document.createElement('button');
        botao.className = 'catalog-filter-btn catalog-filter-btn--acesso';
        botao.dataset.access = chave;
        botao.dataset.active = activeAccessFilters.has(chave) ? 'true' : 'false';
        botao.title = accessFilterTitle(chave);
        // As três de origem entram escondidas: só a contagem sabe se elas existem hoje.
        botao.hidden = CHAVES_DE_ORIGEM.includes(chave);

        const indicador = document.createElement('span');
        indicador.className = 'filter-indicator';

        const rotulo = document.createElement('span');
        rotulo.className = 'filter-label';
        rotulo.textContent = accessFilterLabel(chave);

        const contagem = document.createElement('span');
        contagem.className = 'filter-count';
        contagem.dataset.accessCount = chave;

        botao.append(indicador, rotulo, contagem);

        botao.addEventListener('click', () => {
            const ligada = botao.dataset.active === 'true';
            botao.dataset.active = (!ligada).toString();
            onAccessFilterChange(chave, !ligada);
        });

        lista.appendChild(botao);
    });

    grupo.appendChild(lista);
    return grupo;
}

/**
 * Updates the count badges on filter buttons.
 * @param {HTMLElement} filtersContainer - The filters sidebar element
 * @param {Object<string, number>} counts - Map of type to item count
 */
export function updateFilterCounts(filtersContainer, counts) {
    if (!filtersContainer) return;

    Object.entries(counts).forEach(([type, count]) => {
        const badge = filtersContainer.querySelector(`[data-filter-count="${type}"]`);
        if (badge) {
            badge.textContent = count;
        }
    });
}

/**
 * Atualiza as contagens do grupo de ACESSO e decide o que fica visível.
 *
 * O NÚMERO E A VISIBILIDADE SAEM DA MESMA PASSADA de propósito: são a mesma decisão. Um botão
 * com contagem zero é um botão que só sabe esvaziar a lista, e mantê-lo visível transformaria
 * o filtro numa armadilha em vez de um atalho.
 *
 * @param {HTMLElement} filtersContainer - A barra de filtros.
 * @param {Object<string, number>} counts - Saída de `countByAccessFilter`.
 * @returns {string[]} As chaves que ficaram VISÍVEIS, para o chamador desligar as demais.
 */
export function updateAccessFilterCounts(filtersContainer, counts) {
    if (!filtersContainer) return [];
    const grupo = filtersContainer.querySelector('[data-testid="catalog-access-filters"]');
    if (!grupo) return [];

    const privados = Number(counts?.[ACCESS_FILTER.PRIVADO]) || 0;
    // Sem NENHUM item privado o eixo não separa nada: o acervo inteiro é público.
    grupo.hidden = privados === 0;

    const visiveis = [];
    ACCESS_FILTER_ORDER.forEach((chave) => {
        const botao = grupo.querySelector(`[data-access="${chave}"]`);
        if (!botao) return;
        const n = Number(counts?.[chave]) || 0;
        const escondeSemItem = CHAVES_DE_ORIGEM.includes(chave);
        botao.hidden = grupo.hidden || (escondeSemItem && n === 0);
        const badge = botao.querySelector('[data-access-count]');
        if (badge) badge.textContent = String(n);
        if (!botao.hidden) visiveis.push(chave);
    });

    return visiveis;
}
