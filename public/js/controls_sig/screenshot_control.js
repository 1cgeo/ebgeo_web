// Path: js\controls_sig\screenshot_control.js
class ScreenshotControl {
    constructor() {
        this.map = null;
        this.container = null;
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.setAttribute("id", "screenshot-tool");
        button.title = 'Capturar Screenshot';
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_screenshot_black.svg" alt="SCREENSHOT" />';
        button.onclick = this.takeScreenshot.bind(this);
        
        this.container.appendChild(button);
        
        // Atualizar o ícone baseado no layer atual
        this.changeButtonColor();
        $('input[name="base-layer"]').on('change', this.changeButtonColor);
        
        return this.container;
    }
    
    changeButtonColor = () => {
        const color = $('input[name="base-layer"]:checked').val() == 'Carta' ? 'black' : 'white';
        $("#screenshot-tool").html(`<img class="icon-sig-tool" src="./images/icon_screenshot_${color}.svg" alt="SCREENSHOT" />`);
    }

    takeScreenshot() {
        try {
            // Obter o canvas do mapa
            const canvas = this.map.getCanvas();
            
            // Converter para formato de dados URL
            const dataURL = canvas.toDataURL('image/png');
            
            // Criar link para download
            const link = document.createElement('a');
            link.download = `ebgeo-map-${new Date().toISOString().slice(0, 10)}.png`;
            link.href = dataURL;
            
            // Simular clique para iniciar download
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
        } catch (error) {
            console.error('Erro ao capturar screenshot:', error);
            alert('Não foi possível capturar o screenshot');
        }
    }

    onRemove() {
        this.container.parentNode.removeChild(this.container);
        this.map = undefined;
    }
}

export default ScreenshotControl;