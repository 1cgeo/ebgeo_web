// Path: js\controls_sig\utilities\image_processor.js
/**
 * Utilitário centralizado para processamento de imagens
 * Oferece métodos para redimensionar, comprimir e converter imagens
 */

// Configurações padrão para processamento de imagens
const DEFAULT_SETTINGS = {
    MAX_DIMENSION: 600,         // Dimensão máxima em pixels
    MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB limite máximo
    QUALITY: 0.6,               // 60% de qualidade para JPEG
    MOBILE_DIMENSION: 400       // Limite menor para dispositivos móveis
};

/**
 * Verifica se o dispositivo atual é móvel
 * @returns {boolean} True se for um dispositivo móvel
 */
function isMobileDevice() {
    return window.matchMedia("(max-width: 768px)").matches;
}

/**
 * Processa uma imagem do objeto File, redimensionando e comprimindo
 * @param {File} file - Objeto File da imagem selecionada
 * @returns {Promise<Object>} Objeto com imageBase64, width, height
 */
export function processImageFile(file) {
    return new Promise((resolve, reject) => {
        // Verificar tamanho do arquivo
        if (file.size > DEFAULT_SETTINGS.MAX_FILE_SIZE) {
            reject(new Error(`A imagem é muito grande (${(file.size / 1024 / 1024).toFixed(1)}MB). O tamanho máximo é ${DEFAULT_SETTINGS.MAX_FILE_SIZE / 1024 / 1024}MB.`));
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            
            img.onload = () => {
                // Redimensionar e comprimir a imagem
                const imageData = resizeAndCompressImage(img);
                resolve(imageData);
            };
            
            img.onerror = () => {
                reject(new Error('Erro ao carregar a imagem'));
            };
            
            img.src = e.target.result;
        };
        
        reader.onerror = () => {
            reject(new Error('Erro ao ler o arquivo de imagem'));
        };
        
        reader.readAsDataURL(file);
    });
}

/**
 * Redimensiona e comprime uma imagem
 * @param {HTMLImageElement} img - Elemento de imagem carregado
 * @returns {Object} Objeto com imageBase64, width, height
 */
function resizeAndCompressImage(img) {
    const canvas = document.createElement('canvas');
    let { width, height } = img;
    
    // Determinar o tamanho máximo baseado no dispositivo
    const MAX_SIZE = isMobileDevice() ? 
        DEFAULT_SETTINGS.MOBILE_DIMENSION : 
        DEFAULT_SETTINGS.MAX_DIMENSION;
    
    // Redimensionar se a imagem exceder o tamanho máximo
    if (width > MAX_SIZE || height > MAX_SIZE) {
        if (width > height) {
            height = Math.round(height * (MAX_SIZE / width));
            width = MAX_SIZE;
        } else {
            width = Math.round(width * (MAX_SIZE / height));
            height = MAX_SIZE;
        }
    }
    
    canvas.width = width;
    canvas.height = height;
    
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    
    // Determinar o tipo de imagem e aplicar compressão
    let imageType = 'image/jpeg';
    if (img.src.startsWith('data:image/png')) {
        imageType = 'image/png';
    } else if (img.src.startsWith('data:image/gif')) {
        imageType = 'image/gif';
    }
    
    // Para PNGs e GIFs, usa uma qualidade mais alta para preservar transparência
    const quality = imageType === 'image/jpeg' ? DEFAULT_SETTINGS.QUALITY : 0.85;
    
    // Converter para Base64
    const imageBase64 = canvas.toDataURL(imageType, quality);
    
    // Liberar memória
    canvas.width = 1;
    canvas.height = 1;
    ctx.clearRect(0, 0, 1, 1);
    
    return {
        imageBase64,
        width,
        height
    };
}

/**
 * Cria uma miniatura para uma imagem base64
 * @param {string} imageBase64 - String da imagem em base64
 * @param {number} maxSize - Tamanho máximo da miniatura
 * @returns {Promise<string>} String base64 da miniatura
 */
export function createThumbnail(imageBase64, maxSize = 100) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let { width, height } = img;
            
            if (width > maxSize || height > maxSize) {
                if (width > height) {
                    height = Math.round(height * (maxSize / width));
                    width = maxSize;
                } else {
                    width = Math.round(width * (maxSize / height));
                    height = maxSize;
                }
            }
            
            canvas.width = width;
            canvas.height = height;
            
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            
            const thumbnail = canvas.toDataURL('image/jpeg', 0.7);
            resolve(thumbnail);
        };
        
        img.onerror = () => {
            reject(new Error('Erro ao gerar miniatura'));
        };
        
        img.src = imageBase64;
    });
}