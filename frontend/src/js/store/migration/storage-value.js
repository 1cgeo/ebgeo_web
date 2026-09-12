// Path: js/store/migration/storage-value.js
// A tagged encoding prevents user properties from being confused with binary/type markers.
// It is also the portable recovery format (including HTTP origins without crypto.subtle).
export async function encodeStorageValue(value) {
    if (value === undefined) return ['undefined'];
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return ['scalar', value];
    if (typeof value === 'number') return ['number', Object.is(value, -0) ? '-0' : String(value)];
    if (value instanceof Date) return ['date', value.toISOString()];
    if (value instanceof Blob || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        const bytes = value instanceof Blob ? new Uint8Array(await value.arrayBuffer())
            : value instanceof ArrayBuffer ? new Uint8Array(value)
                : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
        return ['binary', value instanceof Blob ? 'Blob' : value.constructor.name, value.type || '', btoa(binary)];
    }
    if (Array.isArray(value)) return ['array', await Promise.all(value.map(encodeStorageValue))];
    if (typeof value !== 'object') throw new Error('Tipo de dado não suportado pela recuperação.');
    const entries = [];
    for (const key of Object.keys(value).sort()) entries.push([key, await encodeStorageValue(value[key])]);
    return ['object', entries];
}

export function decodeStorageValue(encoded) {
    const [tag, value, mime, data] = encoded;
    if (tag === 'undefined') return undefined;
    if (tag === 'scalar') return value;
    if (tag === 'number') return Number(value);
    if (tag === 'date') return new Date(value);
    if (tag === 'array') return value.map(decodeStorageValue);
    if (tag === 'object') return Object.fromEntries(value.map(([key, item]) => [key, decodeStorageValue(item)]));
    if (tag === 'binary') {
        const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0));
        if (value === 'Blob') return new Blob([bytes], { type: mime });
        if (value === 'ArrayBuffer') return bytes.buffer;
        const types = { Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int16Array,
            Uint32Array, Int32Array, Float32Array, Float64Array, DataView };
        if (Object.hasOwn(types, value)) return new types[value](bytes.buffer);
    }
    throw new Error('Formato de recuperação não reconhecido.');
}

// SHA-256, with the standard constants derived from the first 64 primes. A synchronous
// fallback is needed on internal HTTP deployments, where SubtleCrypto is unavailable.
const initial = [];
const constants = [];
for (let candidate = 2; constants.length < 64; candidate++) {
    let prime = true;
    for (let divisor = 2; divisor * divisor <= candidate; divisor++) {
        if (candidate % divisor === 0) { prime = false; break; }
    }
    if (!prime) continue;
    if (initial.length < 8) initial.push((Math.sqrt(candidate) % 1 * 0x100000000) >>> 0);
    constants.push((Math.cbrt(candidate) % 1 * 0x100000000) >>> 0);
}
const rotate = (value, n) => (value >>> n) | (value << (32 - n));

export function sha256(text) {
    const bytes = new TextEncoder().encode(text);
    const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
    padded.set(bytes);
    padded[bytes.length] = 128;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, Math.floor(bytes.length / 0x20000000));
    view.setUint32(padded.length - 4, (bytes.length * 8) >>> 0);
    const hash = [...initial];
    const w = new Uint32Array(64);
    for (let offset = 0; offset < padded.length; offset += 64) {
        for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
        for (let i = 16; i < 64; i++) {
            const x = w[i - 15], y = w[i - 2];
            w[i] = w[i - 16] + (rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3)) + w[i - 7]
                + (rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10));
        }
        let [a, b, c, d, e, f, g, h] = hash;
        for (let i = 0; i < 64; i++) {
            const t1 = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25))
                + ((e & f) ^ (~e & g)) + constants[i] + w[i]) >>> 0;
            const t2 = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
            h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
        }
        [a, b, c, d, e, f, g, h].forEach((value, i) => { hash[i] = (hash[i] + value) >>> 0; });
    }
    return hash.map(value => value.toString(16).padStart(8, '0')).join('');
}

export async function fingerprint(value) {
    return sha256(JSON.stringify(await encodeStorageValue(value)));
}

export async function sameStorageValue(left, right) {
    return JSON.stringify(await encodeStorageValue(left)) === JSON.stringify(await encodeStorageValue(right));
}
