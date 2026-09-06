// Path: js/military_tools/coordination_measure_tool/coordination_measure_generator.js

import { COORDINATION_POINTS_CATALOG } from './coordination_points_catalog.js';
import { convertSvgToPngBlob } from '../svg-to-png.js';

const DEFAULT_SIZE = 80;

// Quantos pixels de bitmap por pixel de tela. O `icon-size` da camada de medidas cresce
// com o zoom (2^(zoom - createdAtZoom), com teto 10), entao um PNG no tamanho justo chega
// a ser esticado varias vezes e o desenho borra, o que aparece primeiro na curva fina da
// elipse do nucleo. Rasterizar acima e registrar a imagem com `pixelRatio` mantem o
// simbolo do MESMO tamanho na tela e da nitidez ate ampliar duas vezes. O custo e memoria
// de textura, que cresce com o QUADRADO deste numero, e o nucleo ja usa quadro de 200:
// em 2 o bitmap dele tem 400 por 400, e em 4 teria 800 por 800, quatro vezes mais caro.
const NITIDEZ = 4;

// A previa do modal e as miniaturas do combobox nao vao para o mapa, entao nao precisam de
// supersampling. Sao 13 miniaturas a cada troca de subtipo, e rasteriza-las na nitidez do
// mapa era o que deixava marcar Forca-Tarefa lento.
export const NITIDEZ_DE_TELA = 1;

// Tracado do contorno do nucleo preparado. O periodo de 80 unidades da cerca de uma duzia
// de tracos ao longo do arco de 220 por 100, como na figura do MD33-M-02.
const NUCLEO_TRACEJADO = '58,22';

/**
 * Escala do desenho: pixels LOGICOS de tela por unidade do SVG.
 *
 * O normal e o quadro do ponto dividido pela maior medida do viewBox, que e o que o
 * ajuste dentro do quadro sempre deu. O ponto que precisa de outra escala a declara em
 * `escalaLogica`: e o caso do Nucleo, cujo quadro deixou de ser simetrico e encolheu, e
 * que tem de continuar desenhando a elipse do tamanho de sempre.
 *
 * @param {Object} pointData - Catalog point data
 * @param {Object} baseViewBox - viewBox do simbolo sem texto
 * @returns {number} Logical pixels per SVG unit
 */
function escalaLogicaDe(pointData, baseViewBox) {
  if (Number.isFinite(pointData.escalaLogica) && pointData.escalaLogica > 0) {
    return pointData.escalaLogica;
  }

  const maiorMedida = Math.max(baseViewBox.width, baseViewBox.height);

  if (!Number.isFinite(maiorMedida) || maiorMedida <= 0) {
    throw new Error(`Point ${pointData.code} has an unusable viewBox`);
  }

  return (pointData.tamanhoBase || DEFAULT_SIZE) / maiorMedida;
}

/**
 * Deslocamento do icone, em pixels logicos, para o ponto do DESENHO declarado em
 * `anchorSvg` cair sobre a coordenada da feicao.
 *
 * A camada ancora o bitmap pelo meio, entao o deslocamento e a distancia do meio do
 * viewBox ate o ponto de ancoragem. Positivo e para a direita e para BAIXO, como o
 * `icon-offset` do MapLibre, que o multiplica pelo `icon-size`.
 *
 * Sem `anchorSvg` o resultado e `[0, 0]`: o meio do bitmap segue sobre a coordenada, que
 * e o comportamento de todos os outros pontos do catalogo.
 *
 * @param {Object} viewBox - { minX, minY, width, height } final do desenho
 * @param {Object} [anchorSvg] - { x, y } em unidades do SVG
 * @param {number} escala - Pixels logicos por unidade do SVG
 * @returns {Array<number>} [dx, dy] em pixels logicos
 */
export function iconOffsetFor(viewBox, anchorSvg, escala) {
  if (!viewBox || !anchorSvg || !Number.isFinite(escala)) {
    return [0, 0];
  }

  const centroX = viewBox.minX + viewBox.width / 2;
  const centroY = viewBox.minY + viewBox.height / 2;
  const valores = [centroX, centroY, anchorSvg.x, anchorSvg.y];

  if (valores.some(valor => !Number.isFinite(valor))) {
    return [0, 0];
  }

  // O `|| 0` desfaz o zero negativo, que passaria a gravar `-0` nas propriedades.
  return [
    (Math.round((centroX - anchorSvg.x) * escala * 100) / 100) || 0,
    (Math.round((centroY - anchorSvg.y) * escala * 100) / 100) || 0
  ];
}

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
   * @param {Object} [opcoes] - Opcoes de rasterizacao
   * @param {number} [opcoes.nitidez] - Pixels de bitmap por pixel de tela
   * @returns {Promise<Object>} { blob, width, height, pixelRatio, anchor, iconOffset }
   */
  async generateSymbolBlob(properties, { nitidez = NITIDEZ } = {}) {
    const pointCode = properties.pointCode;
    if (!pointCode) {
      throw new Error('Property pointCode is required');
    }

    const pointData = this.catalog[pointCode];
    if (!pointData) {
      throw new Error(`Point ${pointCode} not found in catalog`);
    }

    let svg = pointData.svg;

    const colorToApply = properties.fillColor || 'none';
    svg = this.applyCustomColor(svg, colorToApply);

    // A SITUACAO roda DEPOIS da cor, e a ordem e contrato: a cor reescreve `stroke="black"`
    // no contorno, e o tracejado e um atributo NOVO no mesmo elemento. Invertidas, o
    // `stroke-dasharray` continuaria de pe, mas o alvo da cor teria mudado de forma.
    if (pointData.isNucleo) {
      svg = this.aplicarSituacaoDoNucleo(svg, properties.status);
    }

    // O quadro na tela e do PONTO, nao do catalogo inteiro: o nucleo desenha uma area e
    // pede mais espaco que um ponto, senao o traco e o texto dele saem finos e ilegiveis.
    // A escala sai do simbolo SEM texto, e por isso escrever a identificacao alarga o
    // desenho em vez de encolher o simbolo.
    const escala = escalaLogicaDe(pointData, this.extractDimensions(svg));

    if (this.hasExternalText(properties, pointData)) {
      svg = this.addExternalTexts(svg, properties, pointData);
    }

    const viewBox = this.extractDimensions(svg);

    // O bitmap sai em `nitidez` vezes o tamanho logico, e e recortado no desenho: o que
    // vai para a tela e exatamente o viewBox, sem faixa transparente. O `width` e o
    // `height` devolvidos seguem sendo os LOGICOS, porque e deles que saem a caixa de
    // selecao e o KMZ: quem traduz o bitmap grande de volta ao tamanho de tela e o
    // `pixelRatio`.
    const largura = Math.max(1, Math.round(viewBox.width * escala * nitidez));
    const altura = Math.max(1, Math.round(viewBox.height * escala * nitidez));

    const rasterizado = await this.convertToPngBlob(svg, largura, altura);

    return {
      blob: rasterizado.blob,
      width: rasterizado.width / nitidez,
      height: rasterizado.height / nitidez,
      pixelRatio: nitidez,
      anchor: pointData.anchor,
      iconOffset: iconOffsetFor(viewBox, pointData.anchorSvg, escala)
    };
  }

  /**
   * Generate symbol from a point code, without requiring it inside the properties.
   *
   * The result is the same shape `generateSymbolBlob` returns: no base64 copy of the
   * bitmap. Whoever needs a data URL (only the preview modal does) encodes the blob
   * itself with `blobToDataUrl`, instead of paying a FileReader on every regeneration.
   *
   * @param {string} pointCode - Point code (ex: "130100")
   * @param {Object} properties - Point properties
   * @param {Object} [opcoes] - Opcoes de rasterizacao, repassadas ao generateSymbolBlob
   * @returns {Promise<Object>} { blob, width, height, pixelRatio, anchor, iconOffset }
   */
  async generate(pointCode, properties, opcoes) {
    return this.generateSymbolBlob({ ...properties, pointCode }, opcoes);
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

    return fieldNames.some(fieldName => this.hasTextValue(properties[fieldName]));
  }

  /**
   * Whether a text-modifier value counts as filled in.
   *
   * ONE predicate for the three places that used to ask the question differently.
   * `hasExternalText` and `calculateDynamicViewBox` tested undefined/null/'';
   * `addExternalTexts` tested `!value && value !== 0`. The boolean `false` split
   * them, so the symbol grew its viewBox to fit a label that was never drawn.
   * @param {*} value - Raw property value
   * @returns {boolean} True when the value should be rendered
   */
  hasTextValue(value) {
    return value !== undefined && value !== null && value !== '';
  }

  /**
   * Escape XML special characters
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
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
   * A situacao do nucleo muda o tracado da ELIPSE, e so dela: ocupado desenha continuo,
   * preparado e preparado-nao-ocupado desenham tracejado (MD33-M-02). O simbolo de escalao
   * e a identificacao seguem continuos, por isso o alvo e o elemento marcado com
   * `data-nucleo="contorno"`, nunca todo `stroke=` do SVG.
   *
   * Situacao em branco desenha continuo, que e o caso comum e o que a figura do manual
   * mostra como ocupado.
   *
   * @param {string} svg - SVG string
   * @param {string|null} status - ocupado | preparado | preparado-nao-ocupado
   * @returns {string} SVG with the situation stroke applied
   */
  aplicarSituacaoDoNucleo(svg, status) {
    if (!status || status === 'ocupado') {
      return svg;
    }

    return svg.replace(
      /(<[a-z]+\b[^>]*\bdata-nucleo="contorno"[^>]*?)(\s*\/?>)/,
      `$1 stroke-dasharray="${NUCLEO_TRACEJADO}"$2`
    );
  }

  /**
   * Aplica a cor personalizada ao simbolo.
   *
   * A cor pinta a TINTA: o traco e o preenchimento preto. O branco NAO e cor do simbolo,
   * e mascara: no `290800` Travessia para carros de combate ele e a lagarta que INTERROMPE
   * a linha, e pinta-lo deixava a linha preta, o contrario do pedido. Por isso o branco
   * segue o mesmo caminho nos dois modos.
   *
   * A versao anterior trocava `rgb(255,255,255)` pela cor escolhida, o que so mexia nos
   * simbolos com interior branco e deixava metade do catalogo inerte ao controle.
   *
   * @param {string} svg - SVG string
   * @param {string} color - Cor em hexadecimal (ex: #11FF00), ou 'none' para o padrao
   * @returns {string} SVG com a cor aplicada
   */
  applyCustomColor(svg, color) {
    const semMascara = svg.replace(/fill="rgb\(255,\s*255,\s*255\)"/gi, 'fill="none"');

    if (color === 'none') {
      return semMascara;
    }

    const rgb = this.hexToRgb(color);
    if (!rgb) {
      // Hex invalido e no-op byte a byte, contrato antigo que a suite fixa: entrada que
      // nao se entende nao autoriza mexer no desenho, nem para abrir a mascara.
      return svg;
    }

    // Tres grafias de preto convivem no catalogo: `black`, `#000` e `#000000`. Casar so
    // uma delas deixava o `240601` inerte. `stroke="none"` e `fill="none"` ficam como estao.
    const alvo = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
    return semMascara.replace(/(stroke|fill)="(?:black|#000|#000000)"/gi, (_, attr) => `${attr}="${alvo}"`);
  }

  /**
   * Convert hexadecimal color to RGB
   * @param {string} hex - Color in hex format (e.g. #11FF00)
   * @returns {Object|null} Object with r, g, b properties or null if invalid
   */
  hexToRgb(hex) {
    hex = hex.replace(/^#/, '');

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
   * Add external text elements to symbol and adjust viewBox
   * @param {string} svg - SVG string
   * @param {Object} properties - Point properties
   * @param {Object} pointData - Catalog point data
   * @returns {string} SVG with added texts and adjusted viewBox
   */
  addExternalTexts(svg, properties, pointData) {
    const textElements = [];
    const textFieldsConfig = pointData.textFields || {};

    Object.entries(textFieldsConfig).forEach(([fieldName, config]) => {
      const value = properties[fieldName];

      if (!this.hasTextValue(value)) return;

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

    if (textElements.length > 0) {
      const textsString = textElements.join('\n  ');
      svg = svg.replace('</svg>', textsString + '\n</svg>');

      const dynamicVB = this.calculateDynamicViewBox(svg, properties, pointData);

      svg = svg.replace(
        /viewBox="[^"]*"/,
        `viewBox="${dynamicVB.viewBoxString}"`
      );

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
   * Create SVG text element
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @param {string} content - Text content
   * @param {Object} options - Formatting options
   * @returns {string} SVG text element
   */
  createTextElement(x, y, content, options = {}) {
    const {
      anchor = 'middle',
      fontSize = 10,
      fontWeight = 'normal',
      fill = 'black'
    } = options;

    // `String(content)`: `escapeXml` calls String.prototype.replace, so a NUMERIC
    // label (which `hasTextValue` deliberately admits, 0 included) used to throw a
    // TypeError here and take the whole symbol render down with it.
    return `  <text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${fontSize}" font-weight="${fontWeight}" fill="${fill}" font-family="Arial">${this.escapeXml(String(content))}</text>`;
  }

  /**
   * Extract complete dimensions from SVG viewBox
   * @param {string} svg - SVG string
   * @returns {Object} Object with minX, minY, width, height, maxX, maxY
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
   * Convert SVG string to PNG blob using canvas.
   * Delegates to shared svg-to-png utility.
   * @param {string} svgString - SVG string
   * @param {number} targetWidth - Target box width (uses DEFAULT_SIZE if null)
   * @param {number} targetHeight - Target box height (uses targetWidth if null)
   * @returns {Promise<{blob: Blob, width: number, height: number}>} Blob and cropped canvas size
   */
  async convertToPngBlob(svgString, targetWidth = null, targetHeight = null) {
    return convertSvgToPngBlob(svgString, targetWidth || DEFAULT_SIZE, targetHeight);
  }

  /**
   * Validate point properties before generation
   * @param {string} pointCode - Point code
   * @param {Object} properties - Properties to validate
   * @returns {Array<string>} Array of error messages (empty if valid)
   */
  validate(pointCode, properties) {
    const errors = [];
    const pointData = this.catalog[pointCode];

    if (!pointData) {
      errors.push(`Point ${pointCode} not found`);
      return errors;
    }

    if (pointData.hasSupplyIcon && !properties.classeSuprimento) {
      errors.push('Select supply class');
    }

    if (pointData.isEchelon) {
      if (!properties.nome) {
        errors.push('Enter unit name');
      }
      if (!properties.status) {
        errors.push('Select status (occupied/prepared)');
      }
    }

    if (pointData.code === '240601') {
      // Explicit presence test, not `!value`: a concentration number of 0 is a value
      // the operator can enter, and it used to be reported as missing.
      if (!this.hasTextValue(properties.numeroConcentracao)) {
        errors.push('Enter concentration number (e.g. HA 107)');
      }
    }

    return errors;
  }

  /**
   * Get list of available text fields for a point
   * @param {string} pointCode - Point code
   * @returns {Array<string>} List of field names
   */
  getAvailableTextFields(pointCode) {
    const pointData = this.catalog[pointCode];

    if (!pointData || !pointData.textFields) {
      return [];
    }

    return Object.keys(pointData.textFields);
  }

  /**
   * Get complete information for a point
   * @param {string} pointCode - Point code
   * @returns {Object|null} Point data or null if not found
   */
  getPointInfo(pointCode) {
    return this.catalog[pointCode] || null;
  }

  /**
   * List all available codes in catalog
   * @returns {Array<string>} List of codes
   */
  listAvailableCodes() {
    return Object.keys(this.catalog);
  }

  /**
   * List points by category
   * @param {string} category - Category name
   * @returns {Array<Object>} List of points in category
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
   * Get all available categories
   * @returns {Array<string>} List of unique categories
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
   * Estimate text width in SVG units
   * @param {string} text - Text to measure
   * @param {number} fontSize - Font size
   * @param {string} fontWeight - Font weight ('normal' or 'bold')
   * @returns {number} Estimated width in SVG units
   */
  estimateTextWidth(text, fontSize, fontWeight = 'normal') {
    const charWidth = fontWeight === 'bold' ? fontSize * 0.7 : fontSize * 0.6;
    return String(text).length * charWidth;
  }

  /**
   * Calculate dynamic viewBox that expands to include all texts
   * @param {string} svg - SVG string
   * @param {Object} properties - Point properties (text values)
   * @param {Object} pointData - Catalog point data
   * @returns {Object} Expanded viewBox { minX, minY, width, height, maxX, maxY, viewBoxString }
   */
  calculateDynamicViewBox(svg, properties, pointData) {
    const original = this.extractDimensions(svg);

    let minX = original.minX;
    let minY = original.minY;
    let maxX = original.maxX;
    let maxY = original.maxY;

    const MARGIN = 5;

    const textFieldsConfig = pointData.textFields || {};

    Object.entries(textFieldsConfig).forEach(([fieldName, config]) => {
      const value = properties[fieldName];

      if (!this.hasTextValue(value)) return;

      const x = config.position.x;
      const y = config.position.y;
      const anchor = config.anchor;
      const fontSize = config.fontSize;
      const fontWeight = config.fontWeight || 'normal';

      const textWidth = this.estimateTextWidth(value, fontSize, fontWeight);

      let textMinX, textMaxX;

      if (anchor === 'start') {
        textMinX = x;
        textMaxX = x + textWidth;
      } else if (anchor === 'end') {
        textMinX = x - textWidth;
        textMaxX = x;
      } else {
        textMinX = x - (textWidth / 2);
        textMaxX = x + (textWidth / 2);
      }

      const textMinY = y - fontSize;
      const textMaxY = y + (fontSize * 0.3);

      minX = Math.min(minX, textMinX - MARGIN);
      maxX = Math.max(maxX, textMaxX + MARGIN);
      minY = Math.min(minY, textMinY - MARGIN);
      maxY = Math.max(maxY, textMaxY + MARGIN);
    });

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
