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
        // Garantir que a cena seja renderizada completamente
        await ensureSceneRendered();
        
        // Tentar capturar o screenshot com método robusto
        const success = await captureScreenshotRobust();
        return success;
        
    } catch (error) {
        console.error('Erro ao capturar screenshot 3D:', error);
        alert('Não foi possível capturar o screenshot 3D');
        return false;
    }
}

/**
 * Garante que a cena Cesium esteja completamente renderizada
 */
function ensureSceneRendered() {
    return new Promise((resolve) => {
        // Forçar renderização
        viewerInstance.render();
        
        // Aguardar próximo frame para garantir renderização completa
        requestAnimationFrame(() => {
            // Render mais uma vez para garantir
            viewerInstance.render();
            requestAnimationFrame(resolve);
        });
    });
}

/**
 * Captura screenshot com estratégia robusta de fallbacks
 */
async function captureScreenshotRobust() {
    const canvas = viewerInstance.scene.canvas;
    
    // Método 1: Tentar dataURL direto (mais compatível com HTTP)
    try {
        const dataURL = canvas.toDataURL('image/png');
        await downloadImageFromDataURL(dataURL);
        return true;
    } catch (securityError) {
        console.warn('Erro de segurança com dataURL, tentando com blob...');
        return await captureWithBlob(canvas);
    }
}

/**
 * Captura usando blob como alternativa
 */
async function captureWithBlob(canvas) {
    try {
        // Criar um novo canvas para garantir que capturamos corretamente
        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = canvas.width;
        offscreenCanvas.height = canvas.height;
        
        // Tentar blob primeiro, depois dataURL se falhar
        return new Promise((resolve) => {
            try {
                offscreenCanvas.toBlob(async (blob) => {
                    if (blob) {
                        await downloadImageFromBlob(blob);
                        resolve(true);
                    } else {
                        // Fallback para dataURL
                        const dataURL = offscreenCanvas.toDataURL('image/png');
                        await downloadImageFromDataURL(dataURL);
                        resolve(true);
                    }
                }, 'image/png');
            } catch (blobError) {
                console.warn('Erro com blob, usando dataURL como fallback');
                const dataURL = offscreenCanvas.toDataURL('image/png');
                downloadImageFromDataURL(dataURL).then(() => resolve(true));
            }
        });
        
    } catch (error) {
        console.error('Erro ao processar canvas com blob:', error);
        return await captureWithAlternativeMethod();
    }
}

/**
 * Método alternativo usando Cesium's built-in screenshot functionality
 */
async function captureWithAlternativeMethod() {
    console.warn('Tentando método alternativo para captura de screenshot Cesium...');
    
    try {
        // Método alternativo: usar requestAnimationFrame para garantir renderização
        return new Promise((resolve) => {
            // Aguardar alguns frames para garantir renderização completa
            let frameCount = 0;
            const maxFrames = 3;
            
            function waitForRender() {
                frameCount++;
                
                if (frameCount >= maxFrames) {
                    try {
                        // Tentar capturar novamente após aguardar renderização
                        const canvas = viewerInstance.scene.canvas;
                        
                        // Forçar preserveDrawingBuffer se possível
                        if (viewerInstance.scene.context._gl) {
                            const gl = viewerInstance.scene.context._gl;
                            if (gl.getParameter) {
                                // Verificar se preserveDrawingBuffer está ativo
                                const preserveBuffer = gl.getParameter(gl.getContextAttributes()?.preserveDrawingBuffer);
                                if (!preserveBuffer) {
                                    console.warn('preserveDrawingBuffer não está ativo, screenshot pode não funcionar corretamente');
                                }
                            }
                        }
                        
                        const dataURL = canvas.toDataURL('image/png');
                        downloadImageFromDataURL(dataURL).then(() => resolve(true));
                        
                    } catch (error) {
                        console.error('Erro no método alternativo:', error);
                        // Último recurso: captura sem verificações
                        captureLastResort().then(resolve);
                    }
                } else {
                    viewerInstance.render();
                    requestAnimationFrame(waitForRender);
                }
            }
            
            waitForRender();
        });
        
    } catch (error) {
        console.error('Erro no método alternativo Cesium:', error);
        return await captureLastResort();
    }
}

/**
 * Último recurso para captura
 */
async function captureLastResort() {
    try {
        console.warn('Usando último recurso para screenshot...');
        
        // Tentar capturar o canvas diretamente sem verificações
        const canvas = viewerInstance.scene.canvas;
        
        // Aguardar um momento e tentar novamente
        await new Promise(resolve => setTimeout(resolve, 500));
        
        viewerInstance.render();
        
        const dataURL = canvas.toDataURL('image/png');
        
        if (dataURL === 'data:,') {
            // Canvas completamente vazio
            return false;
        }
        
        await downloadImageFromDataURL(dataURL);
        return true;
        
    } catch (error) {
        console.error('Último recurso falhou:', error);
        return false;
    }
}

/**
 * Download usando dataURL (mais compatível com HTTP)
 */
async function downloadImageFromDataURL(dataURL) {
    try {
        // Método mais compatível com HTTP - usar dataURL diretamente
        const link = document.createElement('a');
        link.download = `ebgeo-3d-${new Date().toISOString().slice(0, 10)}.png`;
        link.href = dataURL;
        
        // Simular clique para iniciar download
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
    } catch (error) {
        console.error('Erro ao fazer download via dataURL:', error);
    }
}

/**
 * Download usando blob com fallback
 */
async function downloadImageFromBlob(blob) {
    try {
        // Primeiro tentar o método tradicional com blob
        const url = URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.download = `ebgeo-3d-${new Date().toISOString().slice(0, 10)}.png`;
        link.href = url;
        
        // Adicionar evento de cleanup
        link.addEventListener('click', () => {
            setTimeout(() => {
                URL.revokeObjectURL(url);
            }, 100);
        });
        
        // Simular clique para iniciar download
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
    } catch (error) {
        console.warn('Erro com blob URL, convertendo para dataURL');
        // Fallback: converter blob para dataURL
        const reader = new FileReader();
        reader.onload = (event) => {
            downloadImageFromDataURL(event.target.result);
        };
        reader.onerror = () => {
            console.error('Erro ao ler blob');
            alert('Não foi possível processar a imagem 3D');
        };
        reader.readAsDataURL(blob);
    }
}

export { takeScreenshot };