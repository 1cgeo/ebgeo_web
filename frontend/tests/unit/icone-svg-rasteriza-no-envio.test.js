// Path: tests/unit/icone-svg-rasteriza-no-envio.test.js

/**
 * @fileoverview PRENDE A DECISÃO DE 2026-09-19 sobre o ícone personalizado em SVG: na preparação
 * do envio ele vira PNG no navegador e sobe sob o MESMO id, em vez de bloquear o atlas inteiro.
 *
 * O DEFEITO QUE ELE EXISTE PARA REPROVAR. A allowlist do servidor é png/jpeg/webp e não ganha SVG
 * (XSS armazenado). Quando as três portas passaram a recusar o envio INTEIRO diante de um
 * `skipped`, um atlas local com um ícone em SVG deixou de ter caminho nenhum para o servidor. A
 * conversão devolve o caminho sem mexer na allowlist.
 *
 * O CONTROLE NEGATIVO É METADE DO ARQUIVO, e sem ele o verde não prova nada: em node não há DOM,
 * então o rasterizador padrão SEMPRE falha e todo SVG cairia em `skipped` de qualquer modo. É por
 * isso que a conversão é exercitada com um rasterizador INJETADO e a recusa é exercitada com
 * `rasterizeSvg: null`, que é a forma anterior à decisão, escrita por extenso.
 *
 * A ARITMÉTICA DO TAMANHO é medida à parte, sobre as duas funções PURAS de `svg-to-png.js`, porque
 * a rasterização em si (Image + canvas) não roda aqui e precisa do Playwright.
 */

import { describe, it, expect, vi } from 'vitest';
import { buildImageUploads, ALLOWED_IMAGE_MIME } from '@js/import_export/atlas-image-upload.js';
import {
    parseSvgSize,
    rasterTargetSize,
    SVG_RASTER_MAX_PX,
    SVG_RASTER_MIN_PX,
    SVG_RASTER_FALLBACK_PX,
} from '@js/import_export/svg-to-png.js';

/** Cabeçalho PNG de verdade: assinatura de 8 bytes mais o começo do `IHDR`. */
const BYTES_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
/** Cabeçalho JFIF de verdade: `SOI` mais `APP0` com a etiqueta `JFIF`. */
const BYTES_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01]);

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><rect width="48" height="48"/></svg>';

// `FileReader` não é global do Node e `blobToBase64` depende dele. Sem esta ponte todo blob cairia
// no `catch` de `buildImageUploads` e o arquivo mediria uma lista vazia, verde por engano. Ela lê
// o blob de verdade, e não devolve dado fixo.
if (typeof globalThis.FileReader === 'undefined') {
    globalThis.FileReader = class {
        readAsDataURL(blob) {
            blob.arrayBuffer().then((buf) => {
                let binario = '';
                for (const byte of new Uint8Array(buf)) binario += String.fromCharCode(byte);
                this.result = `data:${blob.type || 'application/octet-stream'};base64,${btoa(binario)}`;
                this.onloadend?.();
            }).catch((e) => { this.error = e; this.onerror?.(); });
        }
    };
}

/** Um rasterizador que se comporta como o do navegador no ponto que importa: devolve PNG. */
function rasterizadorDeMentira() {
    return vi.fn(async () => new Blob([BYTES_PNG], { type: 'image/png' }));
}

describe('o ícone em SVG vira PNG na preparação do envio', () => {
    it('sobe como image/png, sob o MESMO id, e o nome do arquivo segue o tipo decidido', async () => {
        const rasterizeSvg = rasterizadorDeMentira();
        const blob = new Blob([new TextEncoder().encode(SVG)], { type: 'image/svg+xml' });

        const { uploads, skipped, skippedReasons } = await buildImageUploads(
            [['icone-1', blob]], { rasterizeSvg },
        );

        expect(skipped).toEqual([]);
        expect(skippedReasons).toEqual([]);
        expect(uploads).toHaveLength(1);
        // O ID É A METADE QUE NÃO PODE MUDAR: a rota bulk preserva o `localId` como id no servidor
        // e a feição referencia o ícone por ele. Um id novo desenharia nada no par.
        expect(uploads[0].localId).toBe('icone-1');
        expect(uploads[0].mimeType).toBe('image/png');
        expect(uploads[0].filename).toBe('icone-1.png');
        expect(rasterizeSvg).toHaveBeenCalledTimes(1);
        expect(rasterizeSvg.mock.calls[0][0]).toBe(blob);
        // OS BYTES SÃO OS DO PNG, e não os do SVG: sem esta linha um conversor que devolvesse a
        // entrada intocada passaria, e o servidor recusaria com "Content does not match declared type".
        expect(uploads[0].data.startsWith('data:image/png;base64,')).toBe(true);
        expect(atob(uploads[0].data.split(',')[1]).slice(0, 4)).toBe('\x89PNG');
    });

    it('SVG SEM TIPO declarado também converte: o faro de assinatura já o reconhecia', async () => {
        // O blob restaurado de um `.ebgeo` chega com `type` vazio (JSZip o descarta), e é por esse
        // caminho que a maioria dos ícones em SVG existe no disco.
        const rasterizeSvg = rasterizadorDeMentira();
        const blob = new Blob([new TextEncoder().encode(SVG)]);

        const { uploads, skipped } = await buildImageUploads([['icone-2', blob]], { rasterizeSvg });

        expect(skipped).toEqual([]);
        expect(uploads[0].mimeType).toBe('image/png');
    });

    it('SVG que não decodifica continua em skipped, com motivo em pt-BR', async () => {
        const rasterizeSvg = vi.fn(async () => { throw new Error('O SVG não pôde ser decodificado.'); });
        const blob = new Blob([new TextEncoder().encode('<svg')], { type: 'image/svg+xml' });

        const { uploads, skipped, skippedReasons } = await buildImageUploads(
            [['icone-3', blob]], { rasterizeSvg },
        );

        expect(uploads).toEqual([]);
        expect(skipped).toEqual(['icone-3']);
        expect(skippedReasons).toEqual([{ id: 'icone-3', reason: 'O SVG não pôde ser decodificado.' }]);
    });

    it('conversor que devolve algo que não é imagem aceita NÃO vira upload mentiroso', async () => {
        // A decisão de tipo é RE-TOMADA sobre o blob produzido. Sem isso, um conversor quebrado
        // subiria bytes de SVG anunciando-se PNG, e a recusa viria do servidor, longe daqui.
        const rasterizeSvg = vi.fn(async () => new Blob([new TextEncoder().encode(SVG)], { type: 'image/svg+xml' }));

        const { uploads, skipped, skippedReasons } = await buildImageUploads(
            [['icone-4', new Blob([new TextEncoder().encode(SVG)], { type: 'image/svg+xml' })]],
            { rasterizeSvg },
        );

        expect(uploads).toEqual([]);
        expect(skipped).toEqual(['icone-4']);
        expect(skippedReasons[0].reason).toContain('image/svg+xml');
    });

    it('PNG e JPEG atravessam INTOCADOS: o conversor nem é chamado', async () => {
        const rasterizeSvg = rasterizadorDeMentira();

        const { uploads, skipped } = await buildImageUploads([
            ['foto', new Blob([BYTES_JPEG], { type: 'image/jpeg' })],
            ['simbolo', new Blob([BYTES_PNG])],
        ], { rasterizeSvg });

        expect(skipped).toEqual([]);
        expect(rasterizeSvg).not.toHaveBeenCalled();
        const porId = Object.fromEntries(uploads.map((u) => [u.localId, u]));
        expect(porId.foto.mimeType).toBe('image/jpeg');
        expect(porId.foto.filename).toBe('foto.jpg');
        expect(porId.simbolo.mimeType).toBe('image/png');
    });

    it('CONTROLE NEGATIVO: sem rasterizador, o SVG volta a bloquear, como antes da decisão', async () => {
        const { uploads, skipped, skippedReasons } = await buildImageUploads(
            [['icone-5', new Blob([new TextEncoder().encode(SVG)], { type: 'image/svg+xml' })]],
            { rasterizeSvg: null },
        );

        expect(uploads).toEqual([]);
        expect(skipped).toEqual(['icone-5']);
        expect(skippedReasons[0].reason).toContain('image/svg+xml');
        // E a allowlist do servidor NÃO mudou: é a premissa da decisão inteira.
        expect(ALLOWED_IMAGE_MIME.has('image/svg+xml')).toBe(false);
    });
});

describe('o tamanho do PNG produzido sai do SVG, com teto e piso', () => {
    it('lê width/height absolutos', () => {
        expect(parseSvgSize('<svg width="120" height="60"></svg>')).toEqual({ width: 120, height: 60 });
        expect(parseSvgSize('<svg width="24px" height="24px"/>')).toEqual({ width: 24, height: 24 });
    });

    it('cai no viewBox quando width/height não são tamanhos absolutos', () => {
        expect(parseSvgSize('<svg viewBox="0 0 512 256"></svg>')).toEqual({ width: 512, height: 256 });
        // `100%` não é um tamanho: é uma fração de um contêiner que esta rasterização não tem.
        expect(parseSvgSize('<svg width="100%" height="100%" viewBox="0,0,10,20"/>')).toEqual({ width: 10, height: 20 });
    });

    it('completa o lado que falta pela razão do viewBox', () => {
        expect(parseSvgSize('<svg width="100" viewBox="0 0 50 25"/>')).toEqual({ width: 100, height: 50 });
        expect(parseSvgSize('<svg height="25" viewBox="0 0 50 25"/>')).toEqual({ width: 50, height: 25 });
    });

    it('devolve null quando não há tamanho declarado nenhum', () => {
        expect(parseSvgSize('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')).toBeNull();
        expect(parseSvgSize('não é svg')).toBeNull();
        expect(parseSvgSize(null)).toBeNull();
        // viewBox degenerado não é tamanho, e um zero aqui viraria divisão por zero adiante.
        expect(parseSvgSize('<svg viewBox="0 0 0 0"/>')).toBeNull();
    });

    it('entre o piso e o teto o tamanho é VERBATIM, que é o que faz o par desenhar igual ao autor', () => {
        expect(rasterTargetSize({ width: 48, height: 48 })).toEqual({ width: 48, height: 48 });
        expect(rasterTargetSize({ width: 200, height: 100 })).toEqual({ width: 200, height: 100 });
    });

    it('acima do teto encolhe preservando a razão de aspecto', () => {
        expect(rasterTargetSize({ width: 1024, height: 512 }))
            .toEqual({ width: SVG_RASTER_MAX_PX, height: SVG_RASTER_MAX_PX / 2 });
    });

    it('abaixo do piso cresce preservando a razão de aspecto', () => {
        expect(rasterTargetSize({ width: 8, height: 4 }))
            .toEqual({ width: SVG_RASTER_MIN_PX, height: SVG_RASTER_MIN_PX / 2 });
    });

    it('sem tamanho declarado usa o quadrado padrão, o mesmo do normalizador de ícone', () => {
        for (const entrada of [null, undefined, {}, { width: 0, height: 10 }, { width: NaN, height: NaN }, { width: Infinity, height: 1 }]) {
            expect(rasterTargetSize(entrada))
                .toEqual({ width: SVG_RASTER_FALLBACK_PX, height: SVG_RASTER_FALLBACK_PX });
        }
    });

    it('nunca produz um lado zero, nem para uma tira extremamente fina', () => {
        const { width, height } = rasterTargetSize({ width: 4000, height: 1 });
        expect(width).toBe(SVG_RASTER_MAX_PX);
        expect(height).toBeGreaterThanOrEqual(1);
    });
});
