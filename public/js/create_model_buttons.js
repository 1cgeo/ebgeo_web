// Path: js\utils\create_model_buttons.js
import config from './config.js';

/**
 * Dynamically creates the 3D model buttons in the specified container
 * @param {string} containerId - ID of the container element
 * @param {Function} clickHandler - Click event handler function
 */
export function createModelButtons(containerId) {
    const container = document.getElementById(containerId);
    
    if (!container) {
        console.error(`Container element with ID '${containerId}' not found`);
        return;
    }
    
    // Clear existing content
    container.innerHTML = '';
    
    // Create a button for each tileset in the configuration
    config.map3d.tilesets.forEach(tileset => {
        const button = document.createElement('button');
        button.id = tileset.id.toLowerCase();
        button.className = 'tutorial-button pure-material-button-contained';
        button.textContent = tileset.title || tileset.id;
        
        container.appendChild(button);
    });
}