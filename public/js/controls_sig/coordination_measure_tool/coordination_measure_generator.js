// Path: js\controls_sig\coordination_measure_tool\coordination_measure_generator.js
import { COORDINATION_POINTS_CATALOG } from './coordination_points_catalog.js';

const DEFAULT_SIZE = 80;

/**
 * Coordination Measure Generator
 * Generates coordination measure symbols from SVG catalog
 * 
 * Key features:
 * - SVG catalog-based generation
 * - Text modifier support (internal placeholders + external positioning)
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
    
    // Generate SVG with all modifications
    let svg = pointData.svg;
    svg = this.replacePlaceholders(svg, properties);
    
    if (properties.status === 'preparado' || properties.status === 'preparado-nao-ocupado') {
      svg = this.applyDashedStroke(svg);
    }
    
    
    // Apply custom color if specified
    if (properties.fillColor) {
      svg = this.applyCustomColor(svg, properties.fillColor);
    }
    
    
    svg = this.addExternalTexts(svg, properties, pointData);
    
    // Extract original dimensions from SVG
    const { width: originalWidth, height: originalHeight } = this.extractDimensions(svg);
    
    // Check if has external text
    const hasText = this.hasExternalText(properties);
    
    // Calculate canvas dimensions using DEFAULT_SIZE
    let canvasWidth, canvasHeight;
    if (hasText) {
      // With text: use larger canvas to accommodate external text
      const aspectRatio = originalWidth / originalHeight;
      if (aspectRatio >= 1) {
        // Landscape or square
        canvasWidth = DEFAULT_SIZE * 1.5;
        canvasHeight = canvasWidth / aspectRatio;
      } else {
        // Portrait
        canvasHeight = DEFAULT_SIZE * 1.5;
        canvasWidth = canvasHeight * aspectRatio;
      }
    } else {
      // Without text: standard proportional sizing
      const aspectRatio = originalWidth / originalHeight;
      if (aspectRatio >= 1) {
        canvasWidth = DEFAULT_SIZE;
        canvasHeight = DEFAULT_SIZE / aspectRatio;
      } else {
        canvasHeight = DEFAULT_SIZE;
        canvasWidth = DEFAULT_SIZE * aspectRatio;
      }
    }
    
    // Round to integers
    canvasWidth = Math.round(canvasWidth);
    canvasHeight = Math.round(canvasHeight);
    
    // Convert to blob with normalized dimensions
    const blob = await this.convertToPngBlob(svg, canvasWidth, canvasHeight);
    
    return {
      blob: blob,
      width: canvasWidth,
      height: canvasHeight,
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
   * Check if properties contain external text modifiers
   * @param {Object} properties - Point properties
   * @returns {boolean} True if has any external text
   */
  hasExternalText(properties) {
    return !!(
      properties.gdhIni ||
      properties.gdhFim ||
      properties.identificacao ||
      properties.tipo ||
      properties.numeroConcentracao ||
      properties.altitude ||
      properties.classeSuprimento
    );
  }

  /**
   * Substitui placeholders internos do SVG
   * @param {string} svg - String SVG
   * @param {Object} properties - Propriedades do ponto
   * @returns {string} SVG com placeholders substituídos
   */
  replacePlaceholders(svg, properties) {
    let result = svg;
    
    // Nome da unidade (para escalões)
    if (properties.nome) {
      result = result.replace(/\{\{NOME\}\}/g, this.escapeXml(properties.nome));
    }
    
    // Número (para pontos numerados)
    if (properties.numero !== undefined && properties.numero !== null) {
      result = result.replace(/\{\{NUMERO\}\}/g, properties.numero.toString());
    }
    
    return result;
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
    // Adicionar stroke-dasharray a todos os elementos com stroke
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
   * Adiciona elementos de texto externos ao símbolo
   * @param {string} svg - String SVG
   * @param {Object} properties - Propriedades do ponto
   * @param {Object} pointData - Dados do catálogo do ponto
   * @returns {string} SVG com textos adicionados
   */
  addExternalTexts(svg, properties, pointData) {
    const textElements = [];
    const positions = this.getTextPositions(pointData);
    
    // GDH Início
    if (properties.gdhIni && positions.gdhIni) {
      textElements.push(this.createTextElement(
        positions.gdhIni.x,
        positions.gdhIni.y,
        properties.gdhIni,
        { anchor: positions.gdhIni.anchor, fontSize: 8 }
      ));
    }
    
    // GDH Fim
    if (properties.gdhFim && positions.gdhFim) {
      textElements.push(this.createTextElement(
        positions.gdhFim.x,
        positions.gdhFim.y,
        properties.gdhFim,
        { anchor: positions.gdhFim.anchor, fontSize: 8 }
      ));
    }
    
    // Identificação (para pontos não-numerados)
    if (properties.identificacao && positions.identificacao) {
      textElements.push(this.createTextElement(
        positions.identificacao.x,
        positions.identificacao.y,
        properties.identificacao,
        { anchor: positions.identificacao.anchor, fontSize: 10, fontWeight: 'bold' }
      ));
    }
    
    // Tipo (para ponto genérico e similares)
    if (properties.tipo && positions.tipo) {
      textElements.push(this.createTextElement(
        positions.tipo.x,
        positions.tipo.y,
        properties.tipo,
        { anchor: positions.tipo.anchor, fontSize: 10, fontWeight: 'bold' }
      ));
    }
    
    // Número da concentração (específico para fogos - código 240601)
    if (properties.numeroConcentracao && positions.numeroConcentracao) {
      textElements.push(this.createTextElement(
        positions.numeroConcentracao.x,
        positions.numeroConcentracao.y,
        properties.numeroConcentracao,
        { anchor: positions.numeroConcentracao.anchor, fontSize: 12, fontWeight: 'bold' }
      ));
    }
    
    // Altitude (específico para fogos - código 240601)
    if (properties.altitude && positions.altitude) {
      textElements.push(this.createTextElement(
        positions.altitude.x,
        positions.altitude.y,
        properties.altitude,
        { anchor: positions.altitude.anchor, fontSize: 10 }
      ));
    }
    
    // Inserir textos antes do fechamento do SVG
    const textsString = textElements.join('\n');
    return svg.replace('</svg>', textsString + '\n</svg>');
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
    
    return `  <text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${fontSize}" font-weight="${fontWeight}" fill="${fill}">${this.escapeXml(content)}</text>`;
  }

  /**
   * Determina posições dos textos baseado no tipo de ponto
   * @param {Object} pointData - Dados do catálogo do ponto
   * @returns {Object} Objeto com posições dos textos
   */
  getTextPositions(pointData) {
    const anchor = pointData.anchor;
    const code = pointData.code;
    
    // Pontos tipo "pin" (bottom-center)
    if (anchor === 'bottom-center') {
      // Concentração de fogos (código 240601) tem layout específico
      if (code === '240601') {
        return {
          numeroConcentracao: { x: 40, y: 28, anchor: 'middle' },
          altitude: { x: 40, y: 45, anchor: 'middle' },
          gdhIni: { x: 5, y: 25, anchor: 'start' },
          gdhFim: { x: 5, y: 45, anchor: 'start' }
        };
      }
      
      // Ponto de suprimento (código 321700 e variantes) tem layout específico
      if (code === '321700' || code.startsWith('SUPPLY_')) {
        return {
          identificacao: { x: 15, y: 55, anchor: 'middle' },
          gdhIni: { x: -5, y: 10, anchor: 'end' },
          gdhFim: { x: -5, y: 25, anchor: 'end' }
        };
      }
      
      // Ponto de interesse (131300) - ponta do pin indica localização
      if (code === '131300') {
        return {
          identificacao: { x: 15, y: 55, anchor: 'middle' },
          gdhIni: { x: -5, y: 10, anchor: 'end' },
          gdhFim: { x: -5, y: 25, anchor: 'end' }
        };
      }
      
      // Layout padrão para pins (ponto genérico - 130100)
      return {
        tipo: { x: 15, y: -5, anchor: 'middle' },
        identificacao: { x: 15, y: 55, anchor: 'middle' },
        gdhIni: { x: -5, y: 10, anchor: 'end' },
        gdhFim: { x: -5, y: 25, anchor: 'end' }
      };
    }
    
    // Pontos centrados (center-center)
    if (anchor === 'center-center') {
      // Escalões têm layout específico
      if (pointData.isEchelon) {
        return {
          gdhIni: { x: -5, y: 15, anchor: 'end' },
          gdhFim: { x: -5, y: 45, anchor: 'end' }
        };
      }
      
      // Ponto de controle aéreo (180000) - agora usa número
      if (code === '180000') {
        return {
          gdhIni: { x: -25, y: -10, anchor: 'end' },
          gdhFim: { x: -25, y: 5, anchor: 'end' }
        };
      }
      
      // Layout padrão para pontos centrados
      return {
        identificacao: { x: 45, y: 5, anchor: 'start' },
        gdhIni: { x: -25, y: -10, anchor: 'end' },
        gdhFim: { x: -25, y: 5, anchor: 'end' }
      };
    }
    
    return {};
  }

  /**
   * Extrai dimensões do viewBox do SVG
   * @param {string} svg - String SVG
   * @returns {Object} Objeto com width e height
   */
  extractDimensions(svg) {
    const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);
    
    if (viewBoxMatch) {
      const values = viewBoxMatch[1].split(/\s+/);
      if (values.length === 4) {
        return {
          width: parseInt(values[2], 10),
          height: parseInt(values[3], 10)
        };
      }
    }
    
    // Dimensão padrão caso não encontre viewBox
    return { width: 40, height: 40 };
  }

  /**
   * Convert SVG string to PNG blob using canvas
   * Maintains aspect ratio and centers image in canvas with specified dimensions
   * @param {string} svgString - SVG string
   * @param {number} targetWidth - Target canvas width (optional, uses natural width if not specified)
   * @param {number} targetHeight - Target canvas height (optional, uses natural height if not specified)
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
            // Get natural dimensions
            const originalWidth = img.naturalWidth || img.width;
            const originalHeight = img.naturalHeight || img.height;
            
            if (originalWidth === 0 || originalHeight === 0) {
              throw new Error('Invalid image dimensions');
            }
            
            // Use natural dimensions if targets not specified
            const finalWidth = targetWidth || originalWidth;
            const finalHeight = targetHeight || originalHeight;
            
            // Create canvas
            const canvas = document.createElement('canvas');
            canvas.width = finalWidth;
            canvas.height = finalHeight;
            const ctx = canvas.getContext('2d');
            
            // If resizing, maintain aspect ratio and center
            if (targetWidth || targetHeight) {
              const aspectRatio = originalWidth / originalHeight;
              const canvasAspectRatio = finalWidth / finalHeight;
              
              let newWidth, newHeight;
              if (aspectRatio >= canvasAspectRatio) {
                // Image is wider than canvas - fit to width
                newWidth = finalWidth;
                newHeight = Math.round(finalWidth / aspectRatio);
              } else {
                // Image is taller than canvas - fit to height
                newHeight = finalHeight;
                newWidth = Math.round(finalHeight * aspectRatio);
              }
              
              // Center image in canvas
              const offsetX = (finalWidth - newWidth) / 2;
              const offsetY = (finalHeight - newHeight) / 2;
              
              ctx.clearRect(0, 0, finalWidth, finalHeight);
              ctx.drawImage(img, offsetX, offsetY, newWidth, newHeight);
            } else {
              // No resize, direct draw
              ctx.drawImage(img, 0, 0);
            }
            
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
    
    // Validar campo "numero" para pontos numerados
    if (pointData.requiresNumber && !properties.numero) {
      errors.push('Este ponto requer um número');
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
    
    // Validar formato GDH se fornecido
    if (properties.gdhIni && !this.validateGDH(properties.gdhIni)) {
      errors.push('GDH Início com formato inválido (use: ddhhmmZ mês)');
    }
    
    if (properties.gdhFim && !this.validateGDH(properties.gdhFim)) {
      errors.push('GDH Fim com formato inválido (use: ddhhmmZ mês ou "Mdt O")');
    }
    
    return errors;
  }

  /**
   * Valida formato de Group Date-Hour (GDH)
   * @param {string} gdh - String GDH a validar
   * @returns {boolean} true se válido
   */
  validateGDH(gdh) {
    if (!gdh || gdh === "Mdt O") return true;
    
    // Formato: ddhhmmZ MÊS
    // Exemplo: 121400Z JUN
    const regex = /^\d{6}Z\s[A-Z]{3}$/;
    return regex.test(gdh);
  }

  /**
   * Obtém lista de campos necessários para um ponto
   * @param {string} pointCode - Código do ponto
   * @returns {Array<string>} Lista de nomes de campos
   */
  getRequiredFields(pointCode) {
    const pointData = this.catalog[pointCode];
    
    if (!pointData) {
      return [];
    }
    
    return pointData.textFields || [];
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
}

export default CoordinationMeasureGenerator;