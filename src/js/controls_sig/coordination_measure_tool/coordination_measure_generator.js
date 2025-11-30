// Path: src/js/controls_sig/coordination_measure_tool/coordination_measure_generator.js

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
   * Apply dashed stroke for "preparado" status symbols
   * @param {string} svg - SVG string
   * @returns {string} SVG with dashed stroke
   */
  applyDashedStroke(svg) {
    return svg.replace(
      /stroke="([^"]*)"/g,
      'stroke="$1" stroke-dasharray="5,5"'
    );
  }

  /**
   * Apply custom color by replacing rgb(255,255,255) with chosen color
   * @param {string} svg - SVG string
   * @param {string} color - Color in hex format (e.g. #11FF00)
   * @returns {string} SVG with applied color
   */
  applyCustomColor(svg, color) {
    if (color === 'none') {
      return svg.replace(/fill="rgb\(255,\s*255,\s*255\)"/gi, 'fill="none"');
    }

    const rgb = this.hexToRgb(color);
    if (rgb) {
      return svg.replace(/rgb\(255,\s*255,\s*255\)/gi, `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`);
    }
    return svg;
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

      if (!value && value !== 0) return;

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

    return `  <text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${fontSize}" font-weight="${fontWeight}" fill="${fill}" font-family="Arial">${this.escapeXml(content)}</text>`;
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

            const finalWidth = targetWidth || naturalWidth;
            const finalHeight = targetHeight || naturalHeight;

            const canvas = document.createElement('canvas');
            canvas.width = finalWidth;
            canvas.height = finalHeight;
            const ctx = canvas.getContext('2d');

            ctx.clearRect(0, 0, finalWidth, finalHeight);

            const aspectRatio = naturalWidth / naturalHeight;
            const canvasAspectRatio = finalWidth / finalHeight;

            let drawWidth, drawHeight, offsetX, offsetY;

            if (Math.abs(aspectRatio - canvasAspectRatio) < 0.01) {
              drawWidth = finalWidth;
              drawHeight = finalHeight;
              offsetX = 0;
              offsetY = 0;
            } else if (aspectRatio >= canvasAspectRatio) {
              drawWidth = finalWidth;
              drawHeight = Math.round(finalWidth / aspectRatio);
              offsetX = 0;
              offsetY = (finalHeight - drawHeight) / 2;
            } else {
              drawHeight = finalHeight;
              drawWidth = Math.round(finalHeight * aspectRatio);
              offsetX = (finalWidth - drawWidth) / 2;
              offsetY = 0;
            }

            ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);

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
      if (!properties.numeroConcentracao) {
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

      if (value === undefined || value === null || value === '') return;

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
