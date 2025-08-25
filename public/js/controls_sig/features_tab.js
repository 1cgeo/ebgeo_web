// Path: js/controls_sig/features_tab/features_tab.js
import { getCurrentMapFeatures, updateFeatureProperty, getFeatureById } from './store.js';
import { zoomToFeature } from '../map_sig.js';

class FeaturesTab {
    constructor(map, selectionManager = null) {
        this.map = map;
        this.selectionManager = selectionManager;
        this.container = null;
        
        this.FEATURE_TYPE_LABELS = {
            'polygons': 'Polígonos',
            'lines': 'Linhas', 
            'points': 'Pontos',
            'texts': 'Textos',
            'images': 'Imagens',
            'circles': 'Círculos',
            'ellipses': 'Elipses',
            'rectangle': 'Retângulo',
            'brushes': 'Pincel',
            'arrows': 'Setas',
            'boundarys': 'Boundaries',
            'occupied_fronts': 'Frentes Ocupadas',
            'military_symbols': 'Símbolos Militares',
            'los': 'Linhas de Visada',
            'visibility': 'Áreas de Visibilidade'
        };

        this.OPACITY_MAPPINGS = {
            'polygons': [
                { layer: 'gl-draw-polygon-fill-inactive', property: 'fill-opacity' },
                { layer: 'gl-draw-polygon-stroke-inactive', property: 'line-opacity' },
                { layer: 'gl-draw-polygon-fill-active', property: 'fill-opacity' },
                { layer: 'gl-draw-polygon-stroke-active', property: 'line-opacity' }
            ],
            'lines': [
                { layer: 'gl-draw-line-inactive', property: 'line-opacity' },
                { layer: 'gl-draw-line-active', property: 'line-opacity' }
            ],
            'points': [
                { layer: 'gl-draw-point-inactive', property: 'circle-opacity' },
                { layer: 'gl-draw-point-active', property: 'circle-opacity' },
                { layer: 'gl-draw-point-stroke-inactive', property: 'circle-stroke-opacity' },
                { layer: 'gl-draw-point-stroke-active', property: 'circle-stroke-opacity' }
            ],
            'circles': [
                { layer: 'circle-fill-layer', property: 'fill-opacity' },
                { layer: 'circle-layer', property: 'line-opacity' },
                { layer: 'circle-x-layer', property: 'line-opacity' }
            ],
            'ellipses': [
                { layer: 'ellipse-fill-layer', property: 'fill-opacity' },
                { layer: 'ellipse-layer', property: 'line-opacity' }
            ],
            'arrows': [
                { layer: 'arrow-fill-layer', property: 'fill-opacity' },
                { layer: 'arrow-layer', property: 'line-opacity' }
            ],
            'boundarys': [
                { layer: 'boundary-main-layer', property: 'line-opacity' },
                { layer: 'boundary-circles-layer', property: 'fill-opacity' },
                { layer: 'boundary-circles-stroke-layer', property: 'line-opacity' },
                { layer: 'boundary-text-layer', property: 'text-opacity' }
            ],
            'occupied_fronts': [
                { layer: 'occupied-front-layer', property: 'line-opacity' }
            ],
            'military_symbols': [
                { layer: 'military-symbols-layer', property: 'icon-opacity' }
            ],
            'texts': [
                { layer: 'text-layer', property: 'text-opacity' }
            ],
            'images': [
                { layer: 'image-layer', property: 'icon-opacity' }
            ],
            'los': [
                { layer: 'processed-los-layer', property: 'line-opacity' }
            ],
            'visibility': [
                { layer: 'processed-visibility-layer', property: 'fill-opacity' }
            ]
        };

        this.ICON_PATHS = {
            EYE_VISIBLE: './images/eye_visible.svg',
            EYE_HIDDEN: './images/eye_hidden.svg',
            LOCK_LOCKED: './images/lock_locked.svg',
            LOCK_UNLOCKED: './images/lock_unlocked.svg'
        };
    }

    createUI() {
        this.container = document.createElement('div');
        this.container.className = 'features-tab-content';
        this.container.style.display = 'none';
        
        const featuresList = document.createElement('div');
        featuresList.className = 'features-list';
        
        this.container.appendChild(featuresList);
        return this.container;
    }

    async loadFeatures() {
        if (!this.container) return;
        
        const features = await getCurrentMapFeatures();
        const grouped = this.groupFeaturesByType(features);
        this.renderUI(grouped);
    }

    groupFeaturesByType(features) {
        const groups = {};
        
        Object.entries(features).forEach(([type, featureArray]) => {
            if (featureArray.length > 0) {
                groups[type] = featureArray.map(feature => ({
                    id: feature.properties.id,
                    name: feature.properties.nome || 'Sem nome',
                    visible: feature.properties.visivel ?? true,
                    locked: feature.properties.bloqueado ?? false,
                    rawFeature: feature
                }));
            }
        });
        
        return groups;
    }

    renderUI(groupedFeatures) {
        const featuresList = this.container.querySelector('.features-list');
        featuresList.innerHTML = '';
        
        Object.entries(groupedFeatures).forEach(([type, items]) => {
            const group = this.createGroup(type, items);
            featuresList.appendChild(group);
        });
    }

    createGroup(featureType, features) {
        const group = document.createElement('div');
        group.className = 'feature-group';
        
        const header = document.createElement('div');
        header.className = 'group-header';
        header.textContent = `${this.FEATURE_TYPE_LABELS[featureType]} (${features.length})`;
        
        group.appendChild(header);
        
        features.forEach(feature => {
            const item = this.createFeatureItem(feature, featureType);
            group.appendChild(item);
        });
        
        return group;
    }

    createFeatureItem(feature, featureType) {
        const item = document.createElement('div');
        item.className = 'feature-item';
        item.dataset.featureId = feature.id;
        item.dataset.featureType = featureType;
        
        const nameDiv = document.createElement('div');
        nameDiv.className = 'feature-name';
        nameDiv.textContent = feature.name;
        nameDiv.addEventListener('click', () => zoomToFeature(feature.rawFeature));
        
        const controlsDiv = document.createElement('div');
        controlsDiv.className = 'feature-controls';
        
        const visibilityBtn = document.createElement('button');
        visibilityBtn.className = 'visibility-toggle';
        const visibilityImg = document.createElement('img');
        visibilityImg.src = feature.visible ? this.ICON_PATHS.EYE_VISIBLE : this.ICON_PATHS.EYE_HIDDEN;
        visibilityImg.alt = feature.visible ? 'Visível' : 'Oculto';
        visibilityBtn.appendChild(visibilityImg);
        visibilityBtn.title = feature.visible ? 'Ocultar' : 'Mostrar';
        visibilityBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleVisibility(feature.id, featureType);
        });
        
        const lockBtn = document.createElement('button');
        lockBtn.className = 'lock-toggle';
        const lockImg = document.createElement('img');
        lockImg.src = feature.locked ? this.ICON_PATHS.LOCK_LOCKED : this.ICON_PATHS.LOCK_UNLOCKED;
        lockImg.alt = feature.locked ? 'Bloqueado' : 'Desbloqueado';
        lockBtn.appendChild(lockImg);
        lockBtn.title = feature.locked ? 'Desbloquear' : 'Bloquear';
        lockBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleLock(feature.id, featureType);
        });
        
        controlsDiv.appendChild(visibilityBtn);
        controlsDiv.appendChild(lockBtn);
        
        item.appendChild(nameDiv);
        item.appendChild(controlsDiv);
        
        this.updateItemVisualState(feature.id, feature.visible, feature.locked);
        
        return item;
    }

    async toggleVisibility(featureId, featureType) {
        const feature = await getFeatureById(featureType, featureId);
        if (!feature) return;
        
        const newVisibility = !(feature.properties.visivel ?? true);
        await updateFeatureProperty(featureType, featureId, 'visivel', newVisibility);
        
        await this.applyFeatureVisibility(featureType, featureId, newVisibility);
        
        this.updateVisibilityButton(featureId, newVisibility);
        this.updateItemVisualState(featureId, newVisibility, feature.properties.bloqueado ?? false);
        
        if (!newVisibility && this.selectionManager?.isFeatureSelected?.(featureId)) {
            this.selectionManager.deselectFeature(featureId, featureType);
        }
    }

    async toggleLock(featureId, featureType) {
        const feature = await getFeatureById(featureType, featureId);
        if (!feature) return;
        
        const newLockState = !(feature.properties.bloqueado ?? false);
        await updateFeatureProperty(featureType, featureId, 'bloqueado', newLockState);
        
        await this.applyFeatureVisibility(featureType, featureId, !newLockState);
        
        this.updateLockButton(featureId, newLockState);
        this.updateItemVisualState(featureId, feature.properties.visivel ?? true, newLockState);
        
        if (newLockState && this.selectionManager?.isFeatureSelected?.(featureId)) {
            this.selectionManager.deselectFeature(featureId, featureType);
        }
    }

    async applyFeatureVisibility(featureType, featureId, visible) {
        const mappings = this.OPACITY_MAPPINGS[featureType];
        if (!mappings) return;
        
        mappings.forEach(({ layer, property }) => {
            if (this.map.getLayer(layer)) {
                this.updateLayerOpacityExpression(layer, property, featureId, visible);
            }
        });
    }

    updateLayerOpacityExpression(layerId, opacityProperty, featureId, visible) {
        const layer = this.map.getLayer(layerId);
        if (!layer) return;
        
        const currentPaint = this.map.getPaintProperty(layerId, opacityProperty);
        let newExpression;
        
        if (visible) {
            newExpression = this.removeFeatureFromOpacityExpression(currentPaint, featureId);
        } else {
            newExpression = this.addFeatureToOpacityExpression(currentPaint, featureId);
        }
        
        this.map.setPaintProperty(layerId, opacityProperty, newExpression);
    }

    addFeatureToOpacityExpression(currentExpression, featureId) {
        if (Array.isArray(currentExpression) && currentExpression[0] === 'case') {
            return [
                'case',
                ['==', ['get', 'id'], featureId], 0,
                ...currentExpression.slice(1)
            ];
        }
        
        return [
            'case',
            ['==', ['get', 'id'], featureId], 0,
            currentExpression || 1
        ];
    }

    removeFeatureFromOpacityExpression(currentExpression, featureId) {
        if (!Array.isArray(currentExpression) || currentExpression[0] !== 'case') {
            return currentExpression;
        }
        
        const newExpression = ['case'];
        
        for (let i = 1; i < currentExpression.length - 1; i += 2) {
            const condition = currentExpression[i];
            const value = currentExpression[i + 1];
            
            if (Array.isArray(condition) && 
                condition[0] === '==' && 
                Array.isArray(condition[2]) &&
                condition[2][1] === 'id' &&
                condition[1] === featureId) {
                continue;
            }
            
            newExpression.push(condition, value);
        }
        
        const defaultValue = currentExpression[currentExpression.length - 1];
        newExpression.push(defaultValue);
        
        if (newExpression.length === 2) {
            return newExpression[1];
        }
        
        return newExpression;
    }

    updateVisibilityButton(featureId, visible) {
        const item = this.container.querySelector(`[data-feature-id="${featureId}"]`);
        const btn = item?.querySelector('.visibility-toggle');
        const img = btn?.querySelector('img');
        if (btn && img) {
            img.src = visible ? this.ICON_PATHS.EYE_VISIBLE : this.ICON_PATHS.EYE_HIDDEN;
            img.alt = visible ? 'Visível' : 'Oculto';
            btn.title = visible ? 'Ocultar' : 'Mostrar';
        }
    }

    updateLockButton(featureId, locked) {
        const item = this.container.querySelector(`[data-feature-id="${featureId}"]`);
        const btn = item?.querySelector('.lock-toggle');
        const img = btn?.querySelector('img');
        if (btn && img) {
            img.src = locked ? this.ICON_PATHS.LOCK_LOCKED : this.ICON_PATHS.LOCK_UNLOCKED;
            img.alt = locked ? 'Bloqueado' : 'Desbloqueado';
            btn.title = locked ? 'Desbloquear' : 'Bloquear';
        }
    }

    updateItemVisualState(featureId, visible, locked) {
        const item = this.container.querySelector(`[data-feature-id="${featureId}"]`);
        if (item) {
            item.classList.toggle('feature-hidden', !visible);
            item.classList.toggle('feature-locked', locked);
        }
    }

    show() {
        if (this.container) {
            this.container.style.display = 'block';
            this.loadFeatures();
        }
    }

    hide() {
        if (this.container) {
            this.container.style.display = 'none';
        }
    }
}

export default FeaturesTab;