// Path: js\controls_sig\screenshot_control.js
class ScreenshotControl {
    constructor() {
        this.map = null;
        this.container = null;
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl screenshot-control controls-column-left';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.setAttribute("id", "screenshot-tool");
        button.title = 'Salvar tela';
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_screenshot_black.svg" alt="SCREENSHOT" />';
        button.onclick = this.takeScreenshot.bind(this);
        
        this.container.appendChild(button);
        
        // Atualizar o ícone baseado no layer atual
        this.changeButtonColor();
        
        return this.container;
    }
    
    changeButtonColor = () => {
        $("#screenshot-tool").html(`<img class="icon-sig-tool" src="./images/icon_screenshot_black.svg" alt="SCREENSHOT" />`);
    }

    takeScreenshot() {
        try {
            // Desabilitar o botão temporariamente para evitar cliques múltiplos
            const button = this.container.querySelector('button');
            button.disabled = true;
            
            // Garantir que o mapa esteja completamente renderizado
            if (this.map.loaded()) {
                this.captureMapCanvas();
            } else {
                // Se o mapa não estiver carregado, aguardar o evento idle
                this.map.once('idle', () => {
                    this.captureMapCanvas();
                });
            }
            
            // Reabilitar o botão após 1 segundo
            setTimeout(() => {
                button.disabled = false;
            }, 1000);
            
        } catch (error) {
            console.error('Erro ao capturar screenshot:', error);
            alert('Não foi possível capturar o screenshot');
            const button = this.container.querySelector('button');
            button.disabled = false;
        }
    }
    
    captureMapCanvas() {
        // Forçar uma renderização completa
        this.map.triggerRepaint();
        
        // Usar requestAnimationFrame para garantir que a renderização foi concluída
        requestAnimationFrame(() => {
            try {
                const canvas = this.map.getCanvas();
                
                // Método 1: Tentar dataURL direto (mais compatível com HTTP)
                try {
                    const dataURL = canvas.toDataURL('image/png');
                    this.downloadImageFromDataURL(dataURL);
                } catch (securityError) {
                    console.warn('Erro de segurança com dataURL, tentando com blob...');
                    this.captureWithBlob(canvas);
                }
                
            } catch (error) {
                console.error('Erro ao processar canvas:', error);
                // Tentar método alternativo
                this.captureWithPreserveDrawingBuffer();
            }
        });
    }
    
    captureWithBlob(canvas) {
        try {
            // Criar um novo canvas para garantir que capturamos corretamente
            const offscreenCanvas = document.createElement('canvas');
            offscreenCanvas.width = canvas.width;
            offscreenCanvas.height = canvas.height;
            
            const ctx = offscreenCanvas.getContext('2d');
            
            // Desenhar o canvas do mapa no canvas offscreen
            ctx.drawImage(canvas, 0, 0);
            
            // Verificar se a imagem não está vazia
            const imageData = ctx.getImageData(0, 0, 1, 1);
            const pixel = imageData.data;
            const isEmpty = pixel[0] === 0 && pixel[1] === 0 && pixel[2] === 0 && pixel[3] === 0;
            
            if (isEmpty) {
                // Tentar método alternativo se a imagem estiver vazia
                this.captureWithPreserveDrawingBuffer();
            } else {
                // Tentar blob primeiro, depois dataURL se falhar
                try {
                    offscreenCanvas.toBlob((blob) => {
                        if (blob) {
                            this.downloadImageFromBlob(blob);
                        } else {
                            // Fallback para dataURL
                            const dataURL = offscreenCanvas.toDataURL('image/png');
                            this.downloadImageFromDataURL(dataURL);
                        }
                    }, 'image/png');
                } catch (blobError) {
                    console.warn('Erro com blob, usando dataURL como fallback');
                    const dataURL = offscreenCanvas.toDataURL('image/png');
                    this.downloadImageFromDataURL(dataURL);
                }
            }
            
        } catch (error) {
            console.error('Erro ao processar canvas com blob:', error);
            // Tentar método alternativo
            this.captureWithPreserveDrawingBuffer();
        }
    }
    
    captureWithPreserveDrawingBuffer() {
        // Método alternativo: recriar o mapa com preserveDrawingBuffer
        console.warn('Tentando método alternativo para captura de screenshot...');
        
        try {
            // Obter o estado atual do mapa
            const center = this.map.getCenter();
            const zoom = this.map.getZoom();
            const bearing = this.map.getBearing();
            const pitch = this.map.getPitch();
            
            // Criar um container temporário
            const tempContainer = document.createElement('div');
            tempContainer.style.position = 'absolute';
            tempContainer.style.left = '-9999px';
            tempContainer.style.width = this.map.getCanvas().width + 'px';
            tempContainer.style.height = this.map.getCanvas().height + 'px';
            document.body.appendChild(tempContainer);
            
            // Criar um novo mapa temporário com preserveDrawingBuffer
            const tempMap = new maplibregl.Map({
                container: tempContainer,
                style: this.map.getStyle(),
                center: center,
                zoom: zoom,
                bearing: bearing,
                pitch: pitch,
                preserveDrawingBuffer: true,
                interactive: false
            });
            
            // Aguardar o mapa temporário carregar
            tempMap.once('load', () => {
                tempMap.once('idle', () => {
                    setTimeout(() => {
                        try {
                            const canvas = tempMap.getCanvas();
                            const dataURL = canvas.toDataURL('image/png');
                            
                            this.downloadImageFromDataURL(dataURL);
                            
                            // Limpar recursos
                            tempMap.remove();
                            document.body.removeChild(tempContainer);
                        } catch (error) {
                            console.error('Erro no método alternativo:', error);
                            alert('Não foi possível capturar o screenshot');
                            tempMap.remove();
                            document.body.removeChild(tempContainer);
                        }
                    }, 500); // Aguardar um pouco para garantir renderização completa
                });
            });
            
        } catch (error) {
            console.error('Erro ao criar mapa temporário:', error);
            alert('Não foi possível capturar o screenshot. Tente novamente.');
        }
    }
    
    downloadImageFromDataURL(dataURL) {
        try {
            // Método mais compatível com HTTP - usar dataURL diretamente
            const link = document.createElement('a');
            link.download = `ebgeo-map-${new Date().toISOString().slice(0, 10)}.png`;
            link.href = dataURL;
            
            // Simular clique para iniciar download
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
        } catch (error) {
            console.error('Erro ao fazer download via dataURL:', error);
        }
    }
    
    downloadImageFromBlob(blob) {
        try {
            // Primeiro tentar o método tradicional com blob
            const url = URL.createObjectURL(blob);
            
            const link = document.createElement('a');
            link.download = `ebgeo-map-${new Date().toISOString().slice(0, 10)}.png`;
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
                this.downloadImageFromDataURL(event.target.result);
            };
            reader.onerror = () => {
                console.error('Erro ao ler blob');
                alert('Não foi possível processar a imagem');
            };
            reader.readAsDataURL(blob);
        }
    }

    onRemove() {
        this.container.parentNode.removeChild(this.container);
        this.map = undefined;
    }
}

export default ScreenshotControl;