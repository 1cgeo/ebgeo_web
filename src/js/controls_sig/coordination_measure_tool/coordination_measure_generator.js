// Path: js/controls_sig/coordination_measure_tool/coordination_measure_generator.js
import { COORDINATION_POINTS_CATALOG } from './coordination_points_catalog.js';

const DEFAULT_SIZE = 80;

/**
 * Coordination Measure Generator
 * Generates coordination measure symbols from SVG catalog
 * 
 * Key features:
 * - SVG catalog-based generation
 * - Text modifier support (configured per point type in catalog)
 * - Status-based styling (dashed stroke for "preparado")
 * - Returns actual dimensions for accurate bounding box calculations
 * - Compatible with Military Symbol Generator interface
 * 
 * @class CoordinationMeasureGenerator
 */
export class CoordinationMeasureGenerator {
  constructor() {
    this.catalog = COORDINATION_POINTS_CATALOG;
  }

  /**
   * Generate symbol blob for map rendering with dimensions
   * Public interface - matches Military Symbol Generator
   * @param {Object} properties - Feature properties including pointCode
   * @returns {Promise<Object>} { blob: Blob, width: number, height: number, anchor: string }
   */
  async generateSymbolBlob(properties) {
    const pointCode = properties.pointCode;
    if (!pointCode) {
      throw new Error('Property pointCode is required');
    }
    
    const pointData = this.catalog[pointCode];
    if (!pointData) {
      throw new Error(`Point ${pointCode} not found in catalog`);
    }
    
    // Get base SVG from catalog
    let svg = pointData.svg;
    
    // Apply color: custom color if specified, otherwise transparent (default)
    // fillColor === null or undefined → transparent ('none')
    // fillColor === hex color → apply that color
    const colorToApply = properties.fillColor || 'none';
    svg = this.applyCustomColor(svg, colorToApply);
    
    const baseViewBox = this.extractDimensions(svg);
    
    const hasText = this.hasExternalText(properties, pointData);
    
    let finalWidth = DEFAULT_SIZE;
    let finalHeight = DEFAULT_SIZE;
    
    if (!hasText) {
      // No text: use baseline directly
      // Keep original viewBox, no modifications needed
    } else {
      const expandedViewBox = this.calculateDynamicViewBox(svg, properties, pointData);
      
      const growthFactorX = expandedViewBox.width / baseViewBox.width;
      const growthFactorY = expandedViewBox.height / baseViewBox.height;
      
      if (growthFactorX > 1.01) {
        finalWidth = Math.round(DEFAULT_SIZE * growthFactorX);
      }
      
      if (growthFactorY > 1.01) {
        finalHeight = Math.round(DEFAULT_SIZE * growthFactorY);
      }
      
      svg = this.addExternalTexts(svg, properties, pointData);
    }
    
    // The SVG with expanded viewBox renders in expanded canvas
    // Net result: symbol base stays at DEFAULT_SIZE pixels visually
    const blob = await this.convertToPngBlob(svg, finalWidth, finalHeight);
    
    return {
      blob: blob,
      width: finalWidth,
      height: finalHeight,
      anchor: pointData.anchor
    };
  }

  /**
   * Generate symbol with data URL (legacy/convenience method)
   * Returns dataUrl instead of blob for backward compatibility with existing code
   * @param {string} pointCode - Point code (ex: "130100")
   * @param {Object} properties - Point properties
   * @returns {Promise<Object>} { dataUrl: string, width: number, height: number, anchor: string, blob: Blob }
   */
  async generate(pointCode, properties) {
    // Add pointCode to properties for generateSymbolBlob
    const propsWithCode = { ...properties, pointCode: pointCode };
    
    const result = await this.generateSymbolBlob(propsWithCode);
    
    // Convert blob to dataUrl for backward compatibility
    const dataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(result.blob);
    });
    
    return {
      dataUrl: dataUrl,
      blob: result.blob,
      width: result.width,
      height: result.height,
      anchor: result.anchor
    };
  }

  /**
   * Check if properties contain external text modifiers based on catalog config
   * @param {Object} properties - Point properties
   * @param {Object} pointData - Point data from catalog
   * @returns {boolean} True if has any external text
   */
  hasExternalText(properties, pointData) {
    const textFieldsConfig = pointData.textFields || {};
    const fieldNames = Object.keys(textFieldsConfig);
    
    // Check if any configured field has a value
    return fieldNames.some(fieldName => {
      const value = properties[fieldName];
      return value !== undefined && value !== null && value !== '';
    });
  }

  /**
   * Escapa caracteres especiais XML
   * @param {string} text - Texto a escapar
   * @returns {string} Texto escapado
   */
  escapeXml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  /**
   * Aplica tracejado para símbolos "preparados"
   * @param {string} svg - String SVG
   * @returns {string} SVG com tracejado
   */
  applyDashedStroke(svg) {
    // Add
    return svg.replace(
      /stroke="([^"]*)"/g, 
      'stroke="$1" stroke-dasharray="5,5"'
    );
  }

  /**
   * Aplica cor personalizada substituindo rgb(255,255,255) pela cor escolhida
   * @param {string} svg - String SVG
   * @param {string} color - Cor em formato hex (ex: #11FF00)
   * @returns {string} SVG com cor aplicada
   */
  applyCustomColor(svg, color) {
    // Sem preenchimento
    if (color === 'none') {
      return svg.replace(/fill="rgb\(255,\s*255,\s*255\)"/gi, 'fill="none"');
    }
    
    // Converter cor hex para rgb
    const rgb = this.hexToRgb(color);
    if (rgb) {
      return svg.replace(/rgb\(255,\s*255,\s*255\)/gi, `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`);
    }
    return svg;
  }

  /**
   * Converte cor hexadecimal para RGB
   * @param {string} hex - Cor em formato hex (ex: #11FF00)
   * @returns {Object|null} Objeto com propriedades r, g, b ou null se inválido
   */
  hexToRgb(hex) {
    // Remove # se presente
    hex = hex.replace(/^#/, '');
    
    // Valida formato hex
    if (!/^[0-9A-F]{6}$/i.test(hex)) {
      return null;
    }
    
    return {
      r: parseInt(hex.substr(0, 2), 16),
      g: parseInt(hex.substr(2, 2), 16),
      b: parseInt(hex.substr(4, 2), 16)
    };
  }

  /**
   * Adiciona elementos de texto externos ao símbolo e ajusta viewBox
   * @param {string} svg - String SVG
   * @param {Object} properties - Propriedades do ponto
   * @param {Object} pointData - Dados do catálogo do ponto
   * @returns {string} SVG com textos adicionados e viewBox ajustado
   */
  addExternalTexts(svg, properties, pointData) {
    const textElements = [];
    const textFieldsConfig = pointData.textFields || {};
    
    // Iterar sobre cada campo configurado no catálogo
    Object.entries(textFieldsConfig).forEach(([fieldName, config]) => {
      const value = properties[fieldName];
      
      // Se não tem valor, não renderizar
      if (!value && value !== 0) return;
      
      // Create
      textElements.push(this.createTextElement(
        config.position.x,
        config.position.y,
        value,
        {
          anchor: config.anchor,
          fontSize: config.fontSize,
          fontWeight: config.fontWeight || 'normal',
          fill: config.fill || 'black'
        }
      ));
    });
    
    // Inserir textos antes do fechamento do SVG
    if (textElements.length > 0) {
      const textsString = textElements.join('\n  ');
      svg = svg.replace('</svg>', textsString + '\n</svg>');
      
      // Recalcular e atualizar viewBox para incluir texto
      const dynamicVB = this.calculateDynamicViewBox(svg, properties, pointData);
      
      // Substituir viewBox no SVG
      svg = svg.replace(
        /viewBox="[^"]*"/,
        `viewBox="${dynamicVB.viewBoxString}"`
      );
      
      // Update
      svg = svg.replace(
        /width="[^"]*"/,
        `width="${dynamicVB.width}"`
      );
      svg = svg.replace(
        /height="[^"]*"/,
        `height="${dynamicVB.height}"`
      );
    }
    
    return svg;
  }

  /**
   * Cria elemento de texto SVG
   * @param {number} x - Coordenada X
   * @param {number} y - Coordenada Y
   * @param {string} content - Conteúdo do texto
   * @param {Object} options - Opções de formatação
   * @returns {string} Elemento text SVG
   */
  createTextElement(x, y, content, options = {}) {
    const {
      anchor = 'middle',
      fontSize = 10,
      fontWeight = 'normal',
      fill = 'black'
    } = options;
    
    return `  <text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${fontSize}" font-weight="${fontWeight}" fill="${fill}" font-family="Arial">${this.escapeXml(content)}</text>`;
  }

  /**
   * Extrai dimensões completas do viewBox do SVG
   * @param {string} svg - String SVG
   * @returns {Object} Objeto com minX, minY, width, height, maxX, maxY
   */
  extractDimensions(svg) {
    const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);
    
    if (viewBoxMatch) {
      const values = viewBoxMatch[1].split(/\s+/).map(parseFloat);
      if (values.length === 4) {
        return {
          minX: values[0],
          minY: values[1],
          width: values[2],
          height: values[3],
          maxX: values[0] + values[2],
          maxY: values[1] + values[3]
        };
      }
    }
    
    // Dimensão padrão caso não encontre viewBox
    return { 
      minX: 0, 
      minY: 0, 
      width: 40, 
      height: 40,
      maxX: 40,
      maxY: 40
    };
  }

  /**
   * Convert SVG string to PNG blob using canvas
   * Maintains aspect ratio and centers image in canvas with specified dimensions
   * @param {string} svgString - SVG string
   * @param {number} targetWidth - Target canvas width (uses natural width if null)
   * @param {number} targetHeight - Target canvas height (uses natural height if null)
   * @returns {Promise<Blob>} PNG blob
   */
  async convertToPngBlob(svgString, targetWidth = null, targetHeight = null) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout processing SVG'));
      }, 5000);
      
      try {
        const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        
        img.onload = () => {
          clearTimeout(timeout);
          
          try {
            // Get natural dimensions from rendered SVG
            const naturalWidth = img.naturalWidth || img.width;
            const naturalHeight = img.naturalHeight || img.height;
            
            if (naturalWidth === 0 || naturalHeight === 0) {
              throw new Error('Invalid image dimensions');
            }
            
            // ✅ Use natural dimensions if targets not specified
            const finalWidth = targetWidth || naturalWidth;
            const finalHeight = targetHeight || naturalHeight;
            
            // Create canvas with final dimensions
            const canvas = document.createElement('canvas');
            canvas.width = finalWidth;
            canvas.height = finalHeight;
            const ctx = canvas.getContext('2d');
            
            // Clear background (transparent)
            ctx.clearRect(0, 0, finalWidth, finalHeight);
            
            // ✅ Draw image scaled to fit canvas while maintaining aspect ratio
            const aspectRatio = naturalWidth / naturalHeight;
            const canvasAspectRatio = finalWidth / finalHeight;
            
            let drawWidth, drawHeight, offsetX, offsetY;
            
            if (Math.abs(aspectRatio - canvasAspectRatio) < 0.01) {
              // Aspect ratios match - draw full size
              drawWidth = finalWidth;
              drawHeight = finalHeight;
              offsetX = 0;
              offsetY = 0;
            } else if (aspectRatio >= canvasAspectRatio) {
              // Image is wider - fit to width
              drawWidth = finalWidth;
              drawHeight = Math.round(finalWidth / aspectRatio);
              offsetX = 0;
              offsetY = (finalHeight - drawHeight) / 2;
            } else {
              // Image is taller - fit to height
              drawHeight = finalHeight;
              drawWidth = Math.round(finalHeight * aspectRatio);
              offsetX = (finalWidth - drawWidth) / 2;
              offsetY = 0;
            }
            
            // Draw resized and centered image
            ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
            
            // Convert to blob
            canvas.toBlob(pngBlob => {
              URL.revokeObjectURL(url);
              resolve(pngBlob);
            }, 'image/png');
            
          } catch (canvasError) {
            URL.revokeObjectURL(url);
            reject(new Error('Canvas processing error: ' + canvasError.message));
          }
        };
        
        img.onerror = (error) => {
          clearTimeout(timeout);
          URL.revokeObjectURL(url);
          reject(new Error('Failed to load SVG image: ' + error));
        };
        
        img.src = url;
        
      } catch (error) {
        clearTimeout(timeout);
        reject(new Error('Failed to create SVG blob: ' + error.message));
      }
    });
  }

  /**
   * Valida propriedades do ponto antes de gerar
   * @param {string} pointCode - Código do ponto
   * @param {Object} properties - Propriedades a validar
   * @returns {Array<string>} Array de mensagens de erro (vazio se válido)
   */
  validate(pointCode, properties) {
    const errors = [];
    const pointData = this.catalog[pointCode];
    
    if (!pointData) {
      errors.push(`Ponto ${pointCode} não encontrado`);
      return errors;
    }
    
    // Validar classe de suprimento
    if (pointData.hasSupplyIcon && !properties.classeSuprimento) {
      errors.push('Selecione a classe de suprimento');
    }
    
    // Validar campos de escalão
    if (pointData.isEchelon) {
      if (!properties.nome) {
        errors.push('Informe o nome da unidade');
      }
      if (!properties.status) {
        errors.push('Selecione o status (ocupado/preparado)');
      }
    }
    
    // Validar campos específicos de concentração de fogos (240601)
    if (pointData.code === '240601') {
      if (!properties.numeroConcentracao) {
        errors.push('Informe o número da concentração (ex: HA 107)');
      }
    }
    
    return errors;
  }

  /**
   * Obtém lista de campos de texto disponíveis para um ponto
   * @param {string} pointCode - Código do ponto
   * @returns {Array<string>} Lista de nomes de campos
   */
  getAvailableTextFields(pointCode) {
    const pointData = this.catalog[pointCode];
    
    if (!pointData || !pointData.textFields) {
      return [];
    }
    
    return Object.keys(pointData.textFields);
  }

  /**
   * Obtém informações completas de um ponto
   * @param {string} pointCode - Código do ponto
   * @returns {Object|null} Dados do ponto ou null se não encontrado
   */
  getPointInfo(pointCode) {
    return this.catalog[pointCode] || null;
  }

  /**
   * Lista todos os códigos disponíveis no catálogo
   * @returns {Array<string>} Lista de códigos
   */
  listAvailableCodes() {
    return Object.keys(this.catalog);
  }

  /**
   * Lista pontos por categoria
   * @param {string} category - Nome da categoria
   * @returns {Array<Object>} Lista de pontos da categoria
   */
  listByCategory(category) {
    return Object.values(this.catalog)
      .filter(point => point.category === category)
      .map(point => ({
        code: point.code,
        name: point.name,
        category: point.category
      }));
  }

  /**
   * Obtém todas as categorias disponíveis
   * @returns {Array<string>} Lista de categorias únicas
   */
  getCategories() {
    const categories = new Set();
    Object.values(this.catalog).forEach(point => {
      if (point.category) {
        categories.add(point.category);
      }
    });
    return Array.from(categories).sort();
  }

  /**
   * Estima largura do texto em unidades SVG
   * @param {string} text - Texto a medir
   * @param {number} fontSize - Tamanho da fonte
   * @param {string} fontWeight - Peso da fonte ('normal' ou 'bold')
   * @returns {number} Largura estimada em unidades SVG
   */
  estimateTextWidth(text, fontSize, fontWeight = 'normal') {
    // Aproximação empírica para fontes sans-serif
    const charWidth = fontWeight === 'bold' ? fontSize * 0.7 : fontSize * 0.6;
    return String(text).length * charWidth;
  }

  /**
   * Calcula viewBox dinâmico que expande para incluir todos os textos
   * @param {string} svg - String SVG
   * @param {Object} properties - Propriedades do ponto (valores dos textos)
   * @param {Object} pointData - Dados do catálogo do ponto
   * @returns {Object} ViewBox expandido { minX, minY, width, height, maxX, maxY, viewBoxString }
   */
  calculateDynamicViewBox(svg, properties, pointData) {
    // Extrair viewBox original do SVG
    const original = this.extractDimensions(svg);
    
    // Inicializar limites com o viewBox original
    let minX = original.minX;
    let minY = original.minY;
    let maxX = original.maxX;
    let maxY = original.maxY;
    
    // Margem adicional ao redor dos textos
    const MARGIN = 5;
    
    // Obter configuração de campos de texto
    const textFieldsConfig = pointData.textFields || {};
    
    // Para cada campo de texto configurado
    Object.entries(textFieldsConfig).forEach(([fieldName, config]) => {
      const value = properties[fieldName];
      
      // Ignorar campos sem valor
      if (value === undefined || value === null || value === '') return;
      
      const x = config.position.x;
      const y = config.position.y;
      const anchor = config.anchor;
      const fontSize = config.fontSize;
      const fontWeight = config.fontWeight || 'normal';
      
      // Estimar largura do texto
      const textWidth = this.estimateTextWidth(value, fontSize, fontWeight);
      
      // Calcular limites do texto baseado na âncora
      let textMinX, textMaxX;
      
      if (anchor === 'start') {
        textMinX = x;
        textMaxX = x + textWidth;
      } else if (anchor === 'end') {
        textMinX = x - textWidth;
        textMaxX = x;
      } else { // middle
        textMinX = x - (textWidth / 2);
        textMaxX = x + (textWidth / 2);
      }
      
      // Calcular limites verticais
      const textMinY = y - fontSize;
      const textMaxY = y + (fontSize * 0.3);
      
      // Expandir viewBox se necessário
      minX = Math.min(minX, textMinX - MARGIN);
      maxX = Math.max(maxX, textMaxX + MARGIN);
      minY = Math.min(minY, textMinY - MARGIN);
      maxY = Math.max(maxY, textMaxY + MARGIN);
    });
    
    // Arredondar valores
    minX = Math.floor(minX);
    minY = Math.floor(minY);
    maxX = Math.ceil(maxX);
    maxY = Math.ceil(maxY);
    
    const width = maxX - minX;
    const height = maxY - minY;
    
    return {
      minX,
      minY,
      width,
      height,
      maxX,
      maxY,
      viewBoxString: `${minX} ${minY} ${width} ${height}`
    };
  }
}

export default CoordinationMeasureGenerator;