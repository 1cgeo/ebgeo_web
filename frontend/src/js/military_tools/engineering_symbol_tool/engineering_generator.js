// Path: js/military_tools/engineering_symbol_tool/engineering_generator.js
import { ENGINEERING_CATALOG } from './engineering_catalog.js';
import { engineeringFields } from './engineering_fields.js';
import { makeDrawing } from './engineering_drawing.js';
import { convertSvgToPngBlob } from '../svg-to-png.js';
import './engineering.css';

export function engineeringItem(code) {
    const item = ENGINEERING_CATALOG.find(entry => entry.number === Number(code));
    if (!item) throw new Error(`Unknown engineering symbol: ${code}`);
    return item;
}

export function engineeringDraft(code, data = {}) {
    const item = engineeringItem(code);
    const values = Object.fromEntries(engineeringFields[item.number].fields.map(f => [f.key, f.value]));
    // Whitelist fields and cap text before measuring imported or synced properties.
    for (const field of engineeringFields[item.number].fields) {
        if (data.values?.[field.key] === undefined) continue;
        const value = data.values[field.key];
        if (field.kind === 'checkbox') {values[field.key] = value === true;} else if (field.kind === 'select') {
            if (field.options.some(([key]) => key === value)) values[field.key] = value;
        } else {values[field.key] = String(value).slice(0, 40);}
    }
    const variant = Number.isInteger(data.variant) && item.variants[data.variant] ? data.variant : 0;
    return { variant, values };
}

/** Measures the actual drawing, including user text, without reference roads. */
export function engineeringSvg(code, properties = {}) {
    const item = engineeringItem(code);
    const draft = engineeringDraft(code, properties.engineering);
    const svg = makeDrawing(item, draft);
    const group = svg.firstElementChild;
    // Defense in depth: context can never become a map symbol after a catalog revision.
    group.querySelectorAll('[data-role="context"]').forEach(node => node.remove());
    group.setAttribute('color', /^#[0-9a-f]{6}$/i.test(properties.fillColor) ? properties.fillColor : '#000000');
    svg.classList.add('engineering-measure');
    document.body.appendChild(svg);
    try {
        for (const text of group.querySelectorAll('text[data-max-width]')) {
            const width = text.getComputedTextLength(), limit = Number(text.dataset.maxWidth);
            if (width > limit) text.setAttribute('font-size', Number(text.getAttribute('font-size')) * limit / width);
        }
        for (const text of group.querySelectorAll('text[data-underline]')) {
            if (!text.textContent) continue;
            const box = text.getBBox();
            const line = document.createElementNS(svg.namespaceURI, 'line');
            for (const [key, value] of Object.entries({ x1: box.x, x2: box.x + box.width, y1: box.y + box.height + 2, y2: box.y + box.height + 2 })) line.setAttribute(key, value);
            group.appendChild(line);
        }
        const box = group.getBBox();
        const minX = box.x - 4, minY = box.y - 4, width = Math.max(8, box.width + 8), height = Math.max(8, box.height + 8);
        svg.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`);
        svg.setAttribute('width', width);
        svg.setAttribute('height', height);
        svg.removeAttribute('class');
        const [x, y] = item.variants[draft.variant].anchor;
        // A constant scale preserves stroke and text size between symbols.
        const scale = 0.7;
        return {
            svg: new XMLSerializer().serializeToString(svg), width: width * scale, height: height * scale,
            iconOffset: [(minX + width / 2 - x) * scale, (minY + height / 2 - y) * scale]
        };
    } finally { svg.remove(); }
}

export class EngineeringSymbolGenerator {
    async generate(pointCode, properties = {}, { nitidez = 4 } = {}) {
        const drawing = engineeringSvg(pointCode, properties);
        const result = await convertSvgToPngBlob(drawing.svg, Math.max(1, Math.round(drawing.width * nitidez)), Math.max(1, Math.round(drawing.height * nitidez)));
        return { blob: result.blob, width: result.width / nitidez, height: result.height / nitidez, pixelRatio: nitidez, anchor: 'center', iconOffset: drawing.iconOffset };
    }

    generateSymbolBlob(properties) { return this.generate(properties.pointCode, properties); }
}
