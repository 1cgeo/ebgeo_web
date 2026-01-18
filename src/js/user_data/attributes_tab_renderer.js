// Path: js/user_data/attributes_tab_renderer.js

/**
 * @fileoverview Renderer para a tab de Atributos customizados.
 */

import userDataManager from './user_data_manager.js';

/**
 * Renderiza o conteúdo da tab de Atributos.
 *
 * @param {HTMLElement} container - Container onde renderizar
 * @param {string} featureId - ID da feature
 * @param {string} featureType - Tipo da feature
 * @returns {Promise<void>}
 */
export async function renderAttributesContent(container, featureId, featureType) {
    container.innerHTML = '';

    const addForm = createAddAttributeForm(featureId, featureType, container);
    container.appendChild(addForm);

    const listContainer = document.createElement('div');
    listContainer.className = 'user-data-attr-list';
    container.appendChild(listContainer);

    const attributes = await userDataManager.getAttributes(featureId, featureType);
    const entries = Object.entries(attributes);

    if (entries.length === 0) {
        renderEmptyState(listContainer, 'Nenhum atributo customizado', '📋');
    } else {
        entries.forEach(([key, value]) => {
            const row = createAttributeRow(key, value, featureId, featureType);
            listContainer.appendChild(row);
        });
    }
}

/**
 * Cria formulário de adição de atributo.
 * @private
 * @param {string} featureId - ID da feature
 * @param {string} featureType - Tipo da feature
 * @param {HTMLElement} parentContainer - Container pai para mensagens de erro
 * @returns {HTMLElement} Elemento do formulário
 */
function createAddAttributeForm(featureId, featureType, parentContainer) {
    const addForm = document.createElement('div');
    addForm.className = 'user-data-add-form';

    const keyInput = document.createElement('input');
    keyInput.type = 'text';
    keyInput.placeholder = 'Nome do atributo';
    keyInput.maxLength = 50;

    const valueInput = document.createElement('input');
    valueInput.type = 'text';
    valueInput.placeholder = 'Valor';

    const addBtn = document.createElement('button');
    addBtn.textContent = 'Adicionar';
    addBtn.type = 'button';

    addBtn.addEventListener('click', async () => {
        const key = keyInput.value.trim();
        const value = valueInput.value;

        if (!key) return;

        const validation = userDataManager.validateAttributeKey(key);
        if (!validation.valid) {
            showError(parentContainer, validation.reason);
            return;
        }

        await userDataManager.setAttribute(featureId, featureType, key, value);
        keyInput.value = '';
        valueInput.value = '';
        keyInput.focus();
    });

    const handleEnter = (e) => {
        if (e.key === 'Enter') addBtn.click();
    };
    keyInput.addEventListener('keydown', handleEnter);
    valueInput.addEventListener('keydown', handleEnter);

    addForm.appendChild(keyInput);
    addForm.appendChild(valueInput);
    addForm.appendChild(addBtn);

    return addForm;
}

/**
 * Cria uma linha de atributo editável.
 * @private
 * @param {string} key - Chave do atributo
 * @param {string} value - Valor do atributo
 * @param {string} featureId - ID da feature
 * @param {string} featureType - Tipo da feature
 * @returns {HTMLElement} Elemento da linha
 */
function createAttributeRow(key, value, featureId, featureType) {
    const row = document.createElement('div');
    row.className = 'user-data-attr-row';

    const keyLabel = document.createElement('span');
    keyLabel.className = 'user-data-attr-key';
    keyLabel.textContent = key;

    const valueInput = document.createElement('input');
    valueInput.className = 'user-data-attr-value';
    valueInput.type = 'text';
    valueInput.value = value;

    let debounceTimer = null;
    valueInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
            await userDataManager.setAttribute(featureId, featureType, key, e.target.value);
        }, 500);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'user-data-attr-delete';
    deleteBtn.textContent = '✕';
    deleteBtn.type = 'button';
    deleteBtn.title = 'Remover atributo';

    deleteBtn.addEventListener('click', async () => {
        await userDataManager.removeAttribute(featureId, featureType, key);
    });

    row.appendChild(keyLabel);
    row.appendChild(valueInput);
    row.appendChild(deleteBtn);

    return row;
}

/**
 * Renderiza estado vazio.
 * @private
 * @param {HTMLElement} container - Container onde renderizar
 * @param {string} text - Texto a exibir
 * @param {string} icon - Ícone a exibir
 */
function renderEmptyState(container, text, icon) {
    const empty = document.createElement('div');
    empty.className = 'user-data-empty';
    empty.innerHTML = `
        <div class="user-data-empty-icon">${icon}</div>
        <div class="user-data-empty-text">${text}</div>
    `;
    container.appendChild(empty);
}

/**
 * Mostra mensagem de erro.
 * @private
 * @param {HTMLElement} container - Container onde mostrar o erro
 * @param {string} message - Mensagem de erro
 */
function showError(container, message) {
    const existing = container.querySelector('.user-data-error');
    if (existing) existing.remove();

    const error = document.createElement('div');
    error.className = 'user-data-error';
    error.textContent = message;
    container.insertBefore(error, container.firstChild);

    setTimeout(() => error.remove(), 3000);
}
