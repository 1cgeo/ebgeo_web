// Path: js\control_3d\screenshot_tool.js
let viewerInstance = null;

/**
 * Função principal para capturar screenshot do viewer Cesium
 * @param {Cesium.Viewer} viewer - Instância do viewer Cesium
 * @returns {Promise<boolean>} - True se capturou com sucesso, false caso contrário
 */
async function takeScreenshot(viewer) {
    viewerInstance = viewer;
    
    try {
        
        // Verificar se preserveDrawingBuffer está ativo
        if (!checkPreserveDrawingBuffer()) {
            console.warn('⚠️ preserveDrawingBuffer não está ativo, tentando workaround...');
        }
        
        // Aguardar que tudo esteja carregado e renderizado
        await ensureFullyRendered();
        
        // Capturar o screenshot com método robusto
        const success = await captureScreenshotRobust();
        
        return success;
        
    } catch (error) {
        console.error('💥 Erro ao capturar screenshot 3D:', error);
        alert('Não foi possível capturar o screenshot 3D');
        return false;
    }
}

/**
 * Verifica se preserveDrawingBuffer está ativo no contexto WebGL
 */
function checkPreserveDrawingBuffer() {
    try {
        const canvas = viewerInstance.scene.canvas;
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        
        if (gl) {
            const contextAttributes = gl.getContextAttributes();
            return contextAttributes && contextAttributes.preserveDrawingBuffer;
        }
        
        return false;
    } catch (error) {
        console.warn('Erro ao verificar preserveDrawingBuffer:', error);
        return false;
    }
}

/**
 * Aguarda que a cena esteja completamente carregada e renderizada
 */
async function ensureFullyRendered() {
    const scene = viewerInstance.scene;
    const globe = scene.globe;
    
    // 1. Aguardar que imagery layers estejam prontos
    await waitForImageryLayers();
    
    // 2. Aguardar que terrain esteja carregado
    await waitForTerrain();
    
    // 3. Aguardar que tilesets estejam carregados
    await waitForTilesets();
    
    // 4. Forçar várias renderizações para garantir que tudo foi desenhado
    await renderMultipleFrames();
    
}

/**
 * Aguarda que todos os imagery layers estejam prontos
 */
function waitForImageryLayers() {
    return new Promise((resolve) => {
        const imageryLayers = viewerInstance.imageryLayers;
        if (imageryLayers._layers.length <=1) {
            resolve();
            return;
        }
        
        let readyCount = 0;
        const totalLayers = imageryLayers.length;
        
        const checkReady = () => {
            readyCount = 0;
            for (let i = 0; i < imageryLayers.length; i++) {
                const layer = imageryLayers.get(i);
                if (layer.ready) {
                    readyCount++;
                }
            }
            
            if (readyCount === totalLayers) {
                resolve();
            } else {
                setTimeout(checkReady, 100);
            }
        };
        
        checkReady();
    });
}

/**
 * Aguarda que o terrain esteja carregado na view atual
 */
function waitForTerrain() {
    return new Promise((resolve) => {
        const scene = viewerInstance.scene;
        const globe = scene.globe;
        // Se usando EllipsoidTerrainProvider, não precisa aguardar
        if (!globe.terrainProvider._availability) {
            resolve();
            return;
        }
        
        // Para CesiumTerrainProvider, aguardar que esteja pronto
        const checkTerrain = () => {
            if (globe.terrainProvider.ready) {
                // Aguardar um pouco mais para garantir que os tiles foram carregados
                setTimeout(resolve, 200);
            } else {
                setTimeout(checkTerrain, 100);
            }
        };
        
        checkTerrain();
    });
}

/**
 * Aguarda que os tilesets 3D estejam carregados
 */
function waitForTilesets() {
    return new Promise((resolve) => {
        const primitives = viewerInstance.scene.primitives;
        const tilesets = [];
        
        // Encontrar todos os tilesets
        for (let i = 0; i < primitives.length; i++) {
            const primitive = primitives.get(i);
            if (primitive instanceof Cesium.Cesium3DTileset) {
                tilesets.push(primitive);
            }
        }
        
        if (tilesets.length === 0) {
            resolve();
            return;
        }
        
        // Aguardar que todos estejam prontos
        const checkTilesets = () => {
            const allReady = tilesets.every(tileset => tileset.ready);
            
            if (allReady) {
                // Aguardar um pouco mais para carregamento de tiles na view atual
                setTimeout(resolve, 300);
            } else {
                setTimeout(checkTilesets, 100);
            }
        };
        
        checkTilesets();
    });
}

/**
 * Renderiza múltiplos frames para garantir que tudo foi desenhado
 */
function renderMultipleFrames() {
    return new Promise((resolve) => {
        let frameCount = 0;
        const maxFrames = 5;
        
        function renderFrame() {
            frameCount++;
            
            // Forçar renderização
            viewerInstance.render();
            
            if (frameCount >= maxFrames) {
                // Aguardar mais um frame para garantir
                requestAnimationFrame(() => {
                    viewerInstance.render();
                    resolve();
                });
            } else {
                requestAnimationFrame(renderFrame);
            }
        }
        
        renderFrame();
    });
}

/**
 * Captura screenshot com estratégia robusta
 */
async function captureScreenshotRobust() {
    const canvas = viewerInstance.scene.canvas;
    
    // Método 1: Verificar se o canvas tem conteúdo válido
    if (await isCanvasEmpty(canvas)) {
        console.warn('⚠️ Canvas vazio detectado, tentando método alternativo...');
        return await captureWithWorkaround();
    }
    
    // Método 2: Captura direta do canvas (melhor qualidade)
    try {
        const dataURL = canvas.toDataURL('image/png');
        
        // Verificar se o dataURL é válido (não só header)
        if (dataURL.length > 100) { // Um PNG válido tem mais que 100 caracteres
            await downloadImageFromDataURL(dataURL);
            return true;
        } else {
            throw new Error('DataURL muito pequeno, provavelmente vazio');
        }
        
    } catch (error) {
        console.warn('Erro na captura direta, tentando método alternativo:', error);
        return await captureWithWorkaround();
    }
}

/**
 * Verifica se o canvas está vazio (preto ou transparente)
 */
async function isCanvasEmpty(canvas) {
    try {
        // Criar um canvas temporário para testar
        const testCanvas = document.createElement('canvas');
        testCanvas.width = Math.min(canvas.width, 100); // Amostra pequena para performance
        testCanvas.height = Math.min(canvas.height, 100);
        
        const ctx = testCanvas.getContext('2d');
        
        // Copiar uma pequena área do canvas original
        ctx.drawImage(canvas, 0, 0, testCanvas.width, testCanvas.height);
        
        // Obter dados dos pixels
        const imageData = ctx.getImageData(0, 0, testCanvas.width, testCanvas.height);
        const data = imageData.data;
        
        // Verificar se há pixels não-pretos
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3];
            
            // Se encontrar qualquer pixel que não seja preto/transparente
            if ((r > 0 || g > 0 || b > 0) && a > 0) {
                return false; // Canvas não está vazio
            }
        }
        
        return true; // Canvas está vazio
        
    } catch (error) {
        console.warn('Erro ao verificar se canvas está vazio:', error);
        return false; // Em caso de erro, assumir que não está vazio
    }
}

/**
 * Método alternativo para captura quando o canvas está vazio
 */
async function captureWithWorkaround() {
    
    try {
        // Salvar configurações atuais
        const scene = viewerInstance.scene;
        const originalRequestRenderMode = scene.requestRenderMode;
        
        // Desabilitar render mode otimizado temporariamente
        scene.requestRenderMode = false;
        
        // Aguardar um tempo maior para recarregamento
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Forçar múltiplas renderizações
        for (let i = 0; i < 10; i++) {
            viewerInstance.render();
            await new Promise(resolve => requestAnimationFrame(resolve));
        }
        
        // Tentar capturar novamente
        const canvas = viewerInstance.scene.canvas;
        const dataURL = canvas.toDataURL('image/png');
        
        // Restaurar configurações originais
        scene.requestRenderMode = originalRequestRenderMode;
        
        if (dataURL.length > 100) {
            await downloadImageFromDataURL(dataURL);
            return true;
        } else {
            throw new Error('Ainda produzindo canvas vazio após workaround');
        }
        
    } catch (error) {
        console.error('Workaround falhou:', error);
        return await captureLastResort();
    }
}

/**
 * Último recurso para captura
 */
async function captureLastResort() {
    console.warn('🆘 Usando último recurso para screenshot...');
    
    try {
        // Aguardar mais tempo
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Forçar renderização com configurações menos otimizadas
        const scene = viewerInstance.scene;
        const originalFXAA = scene.fxaa;
        const originalRequestRenderMode = scene.requestRenderMode;
        
        scene.fxaa = true;
        scene.requestRenderMode = false;
        
        // Múltiplas renderizações
        for (let i = 0; i < 15; i++) {
            viewerInstance.render();
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        const canvas = viewerInstance.scene.canvas;
        const dataURL = canvas.toDataURL('image/png');
        
        // Restaurar configurações
        scene.fxaa = originalFXAA;
        scene.requestRenderMode = originalRequestRenderMode;
        
        if (dataURL === 'data:,' || dataURL.length < 100) {
            console.error('❌ Canvas permanece vazio mesmo após último recurso');
            alert('Screenshot não pôde ser capturado. Tente aguardar o carregamento completo da cena.');
            return false;
        }
        
        await downloadImageFromDataURL(dataURL);
        return true;
        
    } catch (error) {
        console.error('Último recurso falhou completamente:', error);
        return false;
    }
}

/**
 * Download usando dataURL
 */
async function downloadImageFromDataURL(dataURL) {
    try {
        const link = document.createElement('a');
        link.download = `ebgeo-3d-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.png`;
        link.href = dataURL;
        
        // Simular clique para iniciar download
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
                
    } catch (error) {
        console.error('Erro ao fazer download via dataURL:', error);
        throw error;
    }
}

export { takeScreenshot };