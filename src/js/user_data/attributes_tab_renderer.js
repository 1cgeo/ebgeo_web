// Path: js/user_data/attributes_tab_renderer.js

/**
 * @fileoverview Renderer para a tab de Atributos customizados.
 * Redesign inspirado no Google Maps - layout chave-valor com edição inline.
 */

import userDataManager from './user_data_manager.js';

// SVG Icons
const ICONS = {
    plus: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`,
    trash: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`,
    edit: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>`,
    check: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
    x: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`
};

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
    // Adiciona a classe sem remover as existentes (ex: feature-tab-content, active)
    container.classList.add('feature-attributes-tab');

    const listContainer = document.createElement('div');
    listContainer.className = 'feature-attributes-list';
    container.appendChild(listContainer);

    const attributes = await userDataManager.getAttributes(featureId, featureType);
    const entries = Object.entries(attributes);

    if (entries.length === 0) {
        renderEmptyState(listContainer);
    } else {
        entries.forEach(([key, value]) => {
            const row = createAttributeRow(key, value, featureId, featureType, container);
            listContainer.appendChild(row);
        });
    }

    // Botão adicionar atributo
    const addBtn = createAddAttributeButton(featureId, featureType, container);
    container.appendChild(addBtn);
}

/**
 * Cria botão de adicionar atributo no estilo do mockup.
 * @private
 * @param {string} featureId - ID da feature
 * @param {string} featureType - Tipo da feature
 * @param {HTMLElement} parentContainer - Container pai para re-render
 * @returns {HTMLElement} Elemento do botão
 */
function createAddAttributeButton(featureId, featureType, parentContainer) {
    const wrapper = document.createElement('div');
    wrapper.className = 'feature-attributes-add-wrapper';

    const addBtn = document.createElement('button');
    addBtn.className = 'feature-attributes-add-btn';
    addBtn.type = 'button';
    addBtn.innerHTML = `${ICONS.plus}<span>Adicionar Atributo</span>`;

    addBtn.addEventListener('click', () => {
        // Esconde o botão e mostra o formulário inline
        addBtn.style.display = 'none';
        const form = createInlineAddForm(featureId, featureType, parentContainer, () => {
            addBtn.style.display = '';
            form.remove();
        });
        wrapper.appendChild(form);
        form.querySelector('input').focus();
    });

    wrapper.appendChild(addBtn);
    return wrapper;
}

/**
 * Cria formulário inline para adicionar atributo.
 * @private
 * @param {string} featureId - ID da feature
 * @param {string} featureType - Tipo da feature
 * @param {HTMLElement} parentContainer - Container pai para re-render
 * @param {Function} onCancel - Callback ao cancelar
 * @returns {HTMLElement} Elemento do formulário
 */
function createInlineAddForm(featureId, featureType, parentContainer, onCancel) {
    const form = document.createElement('div');
    form.className = 'feature-attributes-inline-form';

    const keyInput = document.createElement('input');
    keyInput.type = 'text';
    keyInput.className = 'feature-attributes-inline-input';
    keyInput.placeholder = 'Nome do atributo';
    keyInput.maxLength = 50;

    const valueInput = document.createElement('input');
    valueInput.type = 'text';
    valueInput.className = 'feature-attributes-inline-input';
    valueInput.placeholder = 'Valor';

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'feature-attributes-inline-actions';

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'feature-attributes-inline-confirm';
    confirmBtn.type = 'button';
    confirmBtn.innerHTML = ICONS.check;
    confirmBtn.title = 'Confirmar';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'feature-attributes-inline-cancel';
    cancelBtn.type = 'button';
    cancelBtn.innerHTML = ICONS.x;
    cancelBtn.title = 'Cancelar';

    const handleSave = async () => {
        const key = keyInput.value.trim();
        const value = valueInput.value;

        if (!key) {
            keyInput.focus();
            keyInput.classList.add('error');
            setTimeout(() => keyInput.classList.remove('error'), 1000);
            return;
        }

        const validation = userDataManager.validateAttributeKey(key);
        if (!validation.valid) {
            showError(parentContainer, validation.reason);
            keyInput.focus();
            return;
        }

        await userDataManager.setAttribute(featureId, featureType, key, value);
        onCancel();
    };

    confirmBtn.addEventListener('click', handleSave);
    cancelBtn.addEventListener('click', onCancel);

    // Keyboard handling
    const handleKeydown = (e) => {
        if (e.key === 'Enter') handleSave();
        if (e.key === 'Escape') onCancel();
    };
    keyInput.addEventListener('keydown', handleKeydown);
    valueInput.addEventListener('keydown', handleKeydown);

    actionsDiv.appendChild(confirmBtn);
    actionsDiv.appendChild(cancelBtn);

    form.appendChild(keyInput);
    form.appendChild(valueInput);
    form.appendChild(actionsDiv);

    return form;
}

/**
 * Cria uma linha de atributo no estilo chave-valor do mockup.
 * @private
 * @param {string} key - Chave do atributo
 * @param {string} value - Valor do atributo
 * @param {string} featureId - ID da feature
 * @param {string} featureType - Tipo da feature
 * @param {HTMLElement} parentContainer - Container pai para re-render
 * @returns {HTMLElement} Elemento da linha
 */
function createAttributeRow(key, value, featureId, featureType, parentContainer) {
    const row = document.createElement('div');
    row.className = 'feature-attribute-row';

    // Container da chave (editável)
    const keyContainer = document.createElement('div');
    keyContainer.className = 'feature-attribute-key-container';

    const keySpan = document.createElement('span');
    keySpan.className = 'feature-attribute-key';
    keySpan.textContent = key;
    keySpan.title = 'Clique para editar o nome';

    const keyEditBtn = document.createElement('button');
    keyEditBtn.className = 'feature-attribute-key-edit';
    keyEditBtn.type = 'button';
    keyEditBtn.innerHTML = ICONS.edit;
    keyEditBtn.title = 'Editar nome do atributo';

    keyContainer.appendChild(keySpan);
    keyContainer.appendChild(keyEditBtn);

    // Handler para editar a chave
    const startKeyEdit = () => {
        keyContainer.classList.add('editing');
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'feature-attribute-key-input';
        input.value = key;
        input.maxLength = 50;

        keySpan.style.display = 'none';
        keyEditBtn.style.display = 'none';
        keyContainer.insertBefore(input, keySpan);
        input.focus();
        input.select();

        const finishEdit = async (save) => {
            if (save) {
                const newKey = input.value.trim();
                if (newKey && newKey !== key) {
                    const validation = userDataManager.validateAttributeKey(newKey);
                    if (!validation.valid) {
                        showError(parentContainer, validation.reason);
                        input.focus();
                        return;
                    }
                    // Renomear atributo: remove o antigo e adiciona com novo nome
                    await userDataManager.removeAttribute(featureId, featureType, key);
                    await userDataManager.setAttribute(featureId, featureType, newKey, value);
                    return; // Re-render acontecerá via evento
                }
            }
            // Cancelar edição
            input.remove();
            keySpan.style.display = '';
            keyEditBtn.style.display = '';
            keyContainer.classList.remove('editing');
        };

        input.addEventListener('blur', () => finishEdit(true));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                finishEdit(false);
            }
        });
    };

    keySpan.addEventListener('click', startKeyEdit);
    keyEditBtn.addEventListener('click', startKeyEdit);

    // Container do valor (editável)
    const valueContainer = document.createElement('div');
    valueContainer.className = 'feature-attribute-value-container';

    const valueSpan = document.createElement('span');
    valueSpan.className = 'feature-attribute-value';
    valueSpan.textContent = value || '—';
    valueSpan.title = 'Clique para editar o valor';

    valueContainer.appendChild(valueSpan);

    // Handler para editar o valor
    const startValueEdit = () => {
        valueContainer.classList.add('editing');
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'feature-attribute-value-input';
        input.value = value;

        valueSpan.style.display = 'none';
        valueContainer.insertBefore(input, valueSpan);
        input.focus();
        input.select();

        const debounceTimer = null;

        const finishEdit = async (save) => {
            clearTimeout(debounceTimer);
            if (save) {
                const newValue = input.value;
                if (newValue !== value) {
                    await userDataManager.setAttribute(featureId, featureType, key, newValue);
                    return; // Re-render acontecerá via evento
                }
            }
            // Cancelar edição ou valor igual
            input.remove();
            valueSpan.style.display = '';
            valueContainer.classList.remove('editing');
        };

        input.addEventListener('blur', () => finishEdit(true));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                finishEdit(false);
            }
        });
    };

    valueSpan.addEventListener('click', startValueEdit);

    // Botão deletar
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'feature-attribute-delete';
    deleteBtn.type = 'button';
    deleteBtn.innerHTML = ICONS.trash;
    deleteBtn.title = 'Remover atributo';

    deleteBtn.addEventListener('click', async () => {
        // Confirmação visual rápida
        row.classList.add('deleting');
        await userDataManager.removeAttribute(featureId, featureType, key);
    });

    row.appendChild(keyContainer);
    row.appendChild(valueContainer);
    row.appendChild(deleteBtn);

    return row;
}

/**
 * Renderiza estado vazio.
 * @private
 * @param {HTMLElement} container - Container onde renderizar
 */
function renderEmptyState(container) {
    const empty = document.createElement('div');
    empty.className = 'feature-attributes-empty';
    empty.innerHTML = `
        <div class="feature-attributes-empty-text">Nenhum atributo customizado</div>
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
    const existing = container.querySelector('.feature-attributes-error');
    if (existing) existing.remove();

    const error = document.createElement('div');
    error.className = 'feature-attributes-error';
    error.textContent = message;
    container.insertBefore(error, container.firstChild);

    setTimeout(() => error.remove(), 3000);
}
