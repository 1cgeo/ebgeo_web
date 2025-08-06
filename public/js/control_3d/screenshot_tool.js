// Path: js\control_3d\screenshot_tool.js
let viewerInstance = null;

// Função para capturar screenshot
function takeScreenshot(viewer) {
    viewerInstance = viewer
    try {
        // Garantir que a cena seja renderizada
        viewerInstance.render();
        
        // Capturar o canvas
        const canvas = viewerInstance.scene.canvas;
        const dataURL = canvas.toDataURL('image/png');
        
        // Criar link para download
        const link = document.createElement('a');
        link.download = `ebgeo-3d-${new Date().toISOString().slice(0, 10)}.png`;
        link.href = dataURL;
        
        // Simular clique para iniciar download
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        return true;
    } catch (error) {
        console.error('Erro ao capturar screenshot 3D:', error);
        alert('Não foi possível capturar o screenshot 3D');
        return false;
    }
}

export { takeScreenshot };