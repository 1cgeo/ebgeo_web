// Path: js\controls_sig\coordination_measure_tool\coordination_measure_generator.js
import { COORDINATION_POINTS_CATALOG } from './coordination_points_catalog.js';

/**
 * Gerador de símbolos para Medidas de Coordenação
 * Baseado em MD33-C-01 e MD33-M-02
 * 
 * @class CoordinationMeasureGenerator
 */
export class CoordinationMeasureGenerator {
  constructor() {
    this.catalog = COORDINATION_POINTS_CATALOG;
  }

  /**
   * Gera símbolo PNG a partir de código e propriedades
   * @param {string} pointCode - Código do ponto (ex: "130100")
   * @param {Object} properties - Propriedades do ponto
   * @returns {Promise<Object>} Objeto com dataUrl, width, height e anchor
   */
  async generate(pointCode, properties) {
    const pointData = this.catalog[pointCode];
    
    if (!pointData) {
      throw new Error(`Ponto ${pointCode} não encontrado no catálogo`);
    }

    let svg = pointData.svg;
    
    // Substituir placeholders internos do SVG ({{NUMERO}}, {{NOME}})
    svg = this.replacePlaceholders(svg, properties);
    
    // Aplicar tracejado para status "preparado" (não ocupado)
    if (properties.status === 'preparado' || properties.status === 'preparado-nao-ocupado') {
      svg = this.applyDashedStroke(svg);
    }
    
    // Adicionar textos externos (GDH, identificação, etc)
    svg = this.addExternalTexts(svg, properties, pointData);
    
    // Extrair dimensões
    const { width, height } = this.extractDimensions(svg);
    
    // Converter SVG para PNG
    const { dataUrl, width: finalWidth, height: finalHeight } = await this.svgToPng(svg);
    
    return {
      dataUrl: dataUrl,
      width: finalWidth,
      height: finalHeight,
      anchor: pointData.anchor
    };
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
   * Converte SVG para PNG usando Canvas
   * @param {string} svgString - String SVG
   * @returns {Promise<Object>} Objeto com dataUrl, width e height
   */
  async svgToPng(svgString) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout ao processar SVG'));
      }, 5000);

      try {
        const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        
        img.onload = () => {
          clearTimeout(timeout);
          
          try {
            const canvas = document.createElement('canvas');
            const width = img.naturalWidth || img.width;
            const height = img.naturalHeight || img.height;
            
            if (width === 0 || height === 0) {
              throw new Error('Dimensões inválidas da imagem');
            }
            
            canvas.width = width;
            canvas.height = height;
            
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            
            const dataUrl = canvas.toDataURL('image/png');
            
            URL.revokeObjectURL(url);
            
            resolve({
              dataUrl: dataUrl,
              width: width,
              height: height
            });
            
          } catch (canvasError) {
            URL.revokeObjectURL(url);
            reject(new Error('Erro ao processar canvas: ' + canvasError.message));
          }
        };
        
        img.onerror = (error) => {
          clearTimeout(timeout);
          URL.revokeObjectURL(url);
          reject(new Error('Erro ao carregar imagem SVG: ' + error));
        };
        
        img.src = url;
        
      } catch (error) {
        reject(new Error('Erro ao criar blob SVG: ' + error.message));
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