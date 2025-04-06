// Path: js\controls_sig\draw_tool\custom_attributes_editor.js

/**
 * Creates and manages the UI for editing custom attributes on a single feature
 * @param {HTMLElement} container - The container to append the custom attributes panel to
 * @param {Object} feature - The feature being edited
 * @param {Object} drawControl - Reference to the draw control to update properties
 */
export function createCustomAttributesPanel(container, feature, drawControl) {
    if (!feature || !feature.properties) {
        console.error('Invalid feature for custom attributes panel');
        return;
    }

    // Create the attributes panel section
    const sectionContainer = document.createElement('div');
    sectionContainer.className = 'custom-attributes-section';
    
    // Create section title
    const titleElement = document.createElement('h4');
    titleElement.textContent = 'Atributos personalizados';
    titleElement.style.marginTop = '15px';
    titleElement.style.marginBottom = '10px';
    sectionContainer.appendChild(titleElement);
    
    // Create attributes table container
    const attributesTableContainer = document.createElement('div');
    attributesTableContainer.className = 'attributes-table-container';
    attributesTableContainer.style.maxHeight = '200px';
    attributesTableContainer.style.overflowY = 'auto';
    attributesTableContainer.style.marginBottom = '10px';
    
    // Create attributes table
    const attributesTable = document.createElement('table');
    attributesTable.style.width = '100%';
    attributesTable.style.borderCollapse = 'collapse';
    
    // Initialize custom attributes if not present
    if (!feature.properties.customAttributes) {
        feature.properties.customAttributes = {};
    }
    
    // Function to render the current attributes
    const renderAttributesTable = () => {
        attributesTable.innerHTML = '';
        
        // Add header row
        const headerRow = document.createElement('tr');
        
        const nameHeader = document.createElement('th');
        nameHeader.textContent = 'Nome';
        nameHeader.style.textAlign = 'left';
        nameHeader.style.padding = '5px';
        headerRow.appendChild(nameHeader);
        
        const valueHeader = document.createElement('th');
        valueHeader.textContent = 'Valor';
        valueHeader.style.textAlign = 'left';
        valueHeader.style.padding = '5px';
        headerRow.appendChild(valueHeader);
        
        const actionsHeader = document.createElement('th');
        actionsHeader.textContent = 'Ações';
        actionsHeader.style.width = '60px';
        actionsHeader.style.textAlign = 'center';
        actionsHeader.style.padding = '5px';
        headerRow.appendChild(actionsHeader);
        
        attributesTable.appendChild(headerRow);
        
        // Add rows for each attribute
        const attributes = feature.properties.customAttributes;
        
        if (Object.keys(attributes).length === 0) {
            const emptyRow = document.createElement('tr');
            const emptyCell = document.createElement('td');
            emptyCell.colSpan = 3;
            emptyCell.textContent = 'Nenhum atributo personalizado';
            emptyCell.style.padding = '10px 5px';
            emptyCell.style.textAlign = 'center';
            emptyCell.style.fontStyle = 'italic';
            emptyRow.appendChild(emptyCell);
            attributesTable.appendChild(emptyRow);
        } else {
            Object.entries(attributes).forEach(([name, value]) => {
                const row = document.createElement('tr');
                
                const nameCell = document.createElement('td');
                nameCell.textContent = name;
                nameCell.style.padding = '5px';
                nameCell.style.borderBottom = '1px solid #eee';
                row.appendChild(nameCell);
                
                const valueCell = document.createElement('td');
                valueCell.textContent = value;
                valueCell.style.padding = '5px';
                valueCell.style.borderBottom = '1px solid #eee';
                row.appendChild(valueCell);
                
                const actionsCell = document.createElement('td');
                actionsCell.style.padding = '5px';
                actionsCell.style.borderBottom = '1px solid #eee';
                actionsCell.style.textAlign = 'center';
                
                // Edit button
                const editButton = document.createElement('button');
                editButton.innerHTML = '✏️';
                editButton.title = 'Editar';
                editButton.style.marginRight = '5px';
                editButton.style.backgroundColor = 'transparent';
                editButton.style.border = 'none';
                editButton.style.cursor = 'pointer';
                editButton.onclick = () => editAttribute(name, value);
                
                // Delete button
                const deleteButton = document.createElement('button');
                deleteButton.innerHTML = '🗑️';
                deleteButton.title = 'Excluir';
                deleteButton.style.backgroundColor = 'transparent';
                deleteButton.style.border = 'none';
                deleteButton.style.cursor = 'pointer';
                deleteButton.onclick = () => deleteAttribute(name);
                
                actionsCell.appendChild(editButton);
                actionsCell.appendChild(deleteButton);
                row.appendChild(actionsCell);
                
                attributesTable.appendChild(row);
            });
        }
    };
    
    // Function to add a new attribute
    const addNewAttribute = () => {
        const attributeName = prompt('Nome do atributo:');
        if (!attributeName || attributeName.trim() === '') return;
        
        // Check for duplicate
        if (feature.properties.customAttributes[attributeName]) {
            alert('Um atributo com este nome já existe.');
            return;
        }
        
        const attributeValue = prompt('Valor do atributo:');
        if (attributeValue === null) return; // User canceled
        
        // Update the feature
        feature.properties.customAttributes[attributeName] = attributeValue;
        
        // Update draw control with new attribute
        drawControl.draw.setFeatureProperty(feature.id, 'customAttributes', 
            JSON.parse(JSON.stringify(feature.properties.customAttributes)));
        
        // Refresh the table
        renderAttributesTable();
    };
    
    // Function to edit an attribute
    const editAttribute = (name, currentValue) => {
        const newValue = prompt(`Editar valor para "${name}":`, currentValue);
        if (newValue === null) return; // User canceled
        
        // Update the feature
        feature.properties.customAttributes[name] = newValue;
        
        // Update draw control with edited attribute
        drawControl.draw.setFeatureProperty(feature.id, 'customAttributes', 
            JSON.parse(JSON.stringify(feature.properties.customAttributes)));
        
        // Refresh the table
        renderAttributesTable();
    };
    
    // Function to delete an attribute
    const deleteAttribute = (name) => {
        if (!confirm(`Tem certeza que deseja excluir o atributo "${name}"?`)) return;
        
        // Delete the attribute
        delete feature.properties.customAttributes[name];
        
        // Update draw control without deleted attribute
        drawControl.draw.setFeatureProperty(feature.id, 'customAttributes', 
            JSON.parse(JSON.stringify(feature.properties.customAttributes)));
        
        // Refresh the table
        renderAttributesTable();
    };
    
    // Add button
    const addButton = document.createElement('button');
    addButton.classList.add('tool-button', 'pure-material-tool-button-contained');
    addButton.textContent = 'Adicionar atributo';
    addButton.style.marginBottom = '10px';
    addButton.onclick = addNewAttribute;
    
    // Initialize the table
    renderAttributesTable();
    
    // Assemble the components
    attributesTableContainer.appendChild(attributesTable);
    sectionContainer.appendChild(attributesTableContainer);
    sectionContainer.appendChild(addButton);
    
    // Add to container
    container.appendChild(sectionContainer);
}