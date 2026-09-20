// Path: tests/unit/colagem-de-imagem-no-quill.test.js

/**
 * @fileoverview As TRÊS portas de imagem do editor de briefing, e a que só se mede por bytes.
 *
 * O botão da barra sempre teve teto; colar e soltar não tinham nenhum, e são as portas por onde a
 * figura GRANDE entra (um print de tela). O HTML do slide viaja por op de sync a cada edição, de
 * modo que um print de 20 MB vira payload de operação.
 *
 * Duas metades, testadas de jeitos diferentes porque falham de jeitos diferentes: a DECISÃO é pura
 * e se prende em node (este bloco de cima), e a FIAÇÃO com o Quill precisa de DOM, então é afirmada
 * estruturalmente (o bloco de baixo). A segunda metade é a que some calada: um `modules: { toolbar }`
 * sem `uploader` devolve o editor ao módulo padrão do Quill sem nada ficar vermelho.
 */

import { describe, it, expect } from 'vitest';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    QUILL_PASTE_MIME_TYPES,
    QUILL_IMAGE_ACCEPT,
    dataUrlByteCount,
    dataUrlToBytes,
    pastedHtmlImageVerdict,
    withoutRefusedImages,
} from '../../src/js/utilities/quill-image-paste.model.js';
import { acceptedImageTypes } from '../../src/js/utilities/image_utils.js';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Um data URL de exatamente `n` bytes, para que o caso afirme o número e não uma aproximação. */
function dataUrlDe(n, mime = 'image/png') {
    return `data:${mime};base64,${Buffer.alloc(n, 7).toString('base64')}`;
}

describe('dataUrlByteCount: bytes de verdade, não comprimento de string', () => {
    it('conta os bytes exatos, incluindo os três restos de padding', () => {
        // O ponto do caso: base64 são 4 caracteres para cada 3 bytes, e o `=` final representa
        // byte que não existe. Tratar o comprimento como tamanho superestima em um terço, o que
        // num teto de 5 MB recusa figura de 3,75 MB com uma frase que cita um número que o
        // arquivo da pessoa não tem.
        for (const n of [1, 2, 3, 4, 5, 100, 1024, 3 * 4096 + 1]) {
            expect(dataUrlByteCount(dataUrlDe(n)), `${n} bytes`).toBe(n);
        }
    });

    it('sobrevive ao payload quebrado em linhas', () => {
        const cru = Buffer.alloc(300, 3).toString('base64');
        const quebrado = cru.replace(/(.{76})/g, '$1\n');
        expect(dataUrlByteCount(`data:image/png;base64,${quebrado}`)).toBe(300);
    });

    it('devolve 0 para um data URL de corpo vazio', () => {
        expect(dataUrlByteCount('data:image/png;base64,')).toBe(0);
    });

    it('devolve null, nunca 0, para o que não carrega bytes embutidos', () => {
        // `null` obriga o chamador a dizer o que faz com uma fonte que não sabe medir; 0 se leria
        // como "figura vazia" e passaria por baixo de todo teto.
        const semBytes = [
            'https://exemplo.mil.br/foto.png',
            'blob:http://localhost/9f8e',
            '//:0',
            'data:image/png',                   // sem vírgula nenhuma
            '', 'lixo', undefined, null, 42, {},
        ];
        for (const src of semBytes) {
            expect(dataUrlByteCount(src), String(src)).toBeNull();
        }
    });

    it('aceita o cabeçalho em maiúsculas, que é legal no esquema data:', () => {
        expect(dataUrlByteCount(`DATA:IMAGE/PNG;BASE64,${Buffer.alloc(9).toString('base64')}`))
            .toBe(9);
    });
});

describe('pastedHtmlImageVerdict: o teto de bytes na única porta síncrona', () => {
    const TETO = 5 * 1024 * 1024;

    it('mantém a figura exatamente no teto e recusa um byte acima', () => {
        expect(pastedHtmlImageVerdict(dataUrlDe(TETO), TETO).keep).toBe(true);
        expect(pastedHtmlImageVerdict(dataUrlDe(TETO + 1), TETO).keep).toBe(false);
    });

    it('a recusa nomeia os DOIS números, medido e teto', () => {
        const veredito = pastedHtmlImageVerdict(dataUrlDe(7 * 1024 * 1024), TETO);
        expect(veredito.keep).toBe(false);
        expect(veredito.bytes).toBe(7 * 1024 * 1024);
        expect(veredito.reason).toBe(
            'A imagem não foi carregada: o arquivo tem 7 MB e o máximo é 5 MB.',
        );
    });

    it('mantém o que não embute bytes: não há payload a limitar', () => {
        // Recusar um `https://` apagaria a figura por um motivo sobre o qual a pessoa não pode
        // fazer nada, e nada estaria sendo embutido no slide.
        expect(pastedHtmlImageVerdict('https://exemplo.mil.br/enorme.png', 1).keep).toBe(true);
        expect(pastedHtmlImageVerdict('blob:http://localhost/x', 1).keep).toBe(true);
    });

    it('teto não finito não recusa nada: falha ABERTO de propósito, e só aqui', () => {
        // Este é o único lugar do lote em que o desconhecido passa, e a razão é o dano: apagar a
        // figura de alguém por causa de uma config malformada é pior que embutir uma figura
        // grande. Os gates de PERMISSÃO fazem o contrário, e por isso este caso está escrito.
        for (const teto of [NaN, undefined, null, Infinity]) {
            expect(pastedHtmlImageVerdict(dataUrlDe(50), teto).keep, String(teto)).toBe(true);
        }
    });
});

describe('withoutRefusedImages: tira a figura recusada e não encosta no resto', () => {
    /** Duplo mínimo de Delta: o suficiente para que `delta.constructor` devolva a mesma classe. */
    class DeltaFalso {
        constructor(ops = []) { this.ops = ops; }
    }
    const delta = (ops) => new DeltaFalso(ops);

    it('remove só o embed de imagem que o veredito recusou', () => {
        const entrada = delta([
            { insert: 'Antes' },
            { insert: { image: 'data:image/png;base64,GRANDE' } },
            { insert: { image: 'https://ok.png' } },
            { insert: '\n' },
        ]);
        const saida = withoutRefusedImages(entrada, (src) => src.includes('GRANDE'));

        expect(saida).toBeInstanceOf(DeltaFalso);
        expect(saida.ops).toEqual([
            { insert: 'Antes' },
            { insert: { image: 'https://ok.png' } },
            { insert: '\n' },
        ]);
    });

    it('devolve a MESMA instância quando não há nada a tirar', () => {
        // Importa porque o matcher roda para todo `<img>` do HTML colado: reconstruir o Delta à
        // toa jogaria fora os atributos que os matchers anteriores já haviam posto nas ops.
        const entrada = delta([{ insert: { image: 'https://ok.png' } }]);
        expect(withoutRefusedImages(entrada, () => false)).toBe(entrada);
    });

    it('não confunde outro tipo de embed com imagem', () => {
        const entrada = delta([{ insert: { video: 'data:x' } }, { insert: { image: 9 } }]);
        expect(withoutRefusedImages(entrada, () => true)).toBe(entrada);
    });

    it('sobrevive a um Delta sem ops', () => {
        const vazio = delta();
        expect(withoutRefusedImages(vazio, () => true)).toBe(vazio);
        expect(withoutRefusedImages({}, () => true)).toEqual({});
    });
});

describe('data URL SEM `;base64`: embute bytes, e já foi lido como se não embutisse', () => {
    // `data:image/svg+xml,%3Csvg…` é a grafia mais comum de SVG embutido numa página. Este arquivo
    // a listava entre as fontes "sem bytes", ao lado de `https://`, e por isso ela FICAVA no Delta
    // colado inteira: sem teto de bytes, sem teto de pixels, sem peneira de MIME.
    const svg = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E';

    it('conta bytes: cada %XX vale UM byte, não três caracteres', () => {
        expect(dataUrlByteCount('data:image/svg+xml,<svg/>')).toBe(6);
        expect(dataUrlByteCount('data:image/png,%89PNG')).toBe(4);
        expect(dataUrlByteCount(svg)).toBe(dataUrlToBytes(svg).bytes.length);
        expect(dataUrlByteCount('data:image/png,')).toBe(0);
    });

    it('decodifica para os bytes crus, inclusive os que não são UTF-8 válido', () => {
        const r = dataUrlToBytes('data:image/png,%89PNG%0D%0A');
        expect(r.type).toBe('image/png');
        expect([...r.bytes]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
        // Um `%` que não abre dois hexadecimais fica literal, como no navegador, e nunca lança.
        expect([...dataUrlToBytes('data:image/png,100%').bytes]).toEqual([0x31, 0x30, 0x30, 0x25]);
    });

    it('passa a ter VEREDITO, e acima do teto é recusado com a frase', () => {
        const grande = `data:image/svg+xml,${'a'.repeat(2048)}`;
        const v = pastedHtmlImageVerdict(grande, 1024);
        expect(v.keep).toBe(false);
        expect(v.bytes).toBe(2048);
        expect(v.reason).toMatch(/não foi carregada/i);
        // Abaixo do teto ele vem MEDIDO (`bytes` definido), que é o que manda o chamador retirá-lo
        // do Delta síncrono; `bytes` indefinido é só o que não é data URL.
        expect(pastedHtmlImageVerdict(svg, 1024 * 1024))
            .toEqual({ keep: true, bytes: dataUrlByteCount(svg) });
        expect(pastedHtmlImageVerdict('https://exemplo.mil.br/f.png', 1).bytes).toBeUndefined();
    });

    it('o tipo do SVG sai legível para a lista de MIME, que é quem o recusa', () => {
        expect(dataUrlToBytes(svg).type).toBe('image/svg+xml');
        expect(QUILL_PASTE_MIME_TYPES).not.toContain(dataUrlToBytes(svg).type);
    });
});

describe('dataUrlToBytes: o que devolve a figura colada ao caminho assíncrono', () => {
    it('decodifica tipo e bytes, e o tamanho casa com `dataUrlByteCount`', () => {
        for (const n of [1, 2, 3, 4, 1000]) {
            const src = dataUrlDe(n, 'image/webp');
            const r = dataUrlToBytes(src);
            expect(r.type).toBe('image/webp');
            expect(r.bytes).toBeInstanceOf(Uint8Array);
            expect(r.bytes.length, `n=${n}`).toBe(n);
            expect(r.bytes.length).toBe(dataUrlByteCount(src));
            expect([...r.bytes].every((b) => b === 7)).toBe(true);
        }
    });

    it('o tipo sai em minúsculas e sem parâmetros, que é como a lista de MIME o compara', () => {
        const src = `data:IMAGE/PNG;charset=x;base64,${Buffer.from([1, 2, 3]).toString('base64')}`;
        expect(dataUrlToBytes(src).type).toBe('image/png');
        expect(QUILL_PASTE_MIME_TYPES).toContain(dataUrlToBytes(src).type);
    });

    it('aguenta payload quebrado em linhas', () => {
        const b64 = Buffer.alloc(90, 7).toString('base64');
        const quebrado = `data:image/png;base64,${b64.slice(0, 40)}\r\n${b64.slice(40)}`;
        expect(dataUrlToBytes(quebrado).bytes.length).toBe(90);
    });

    it('devolve null para o que não embute bytes ou não decodifica, e nunca lança', () => {
        const casos = [
            null, undefined, 42, '', 'https://exemplo.mil/foto.png', 'blob:abc',
            'data:image/png;base64,@@@nao-e-base64@@@',
        ];
        for (const caso of casos) {
            expect(dataUrlToBytes(caso), String(caso)).toBeNull();
        }
    });

    it('SVG embutido decodifica, e é a LISTA que o recusa: os dois fatos ficam separados', () => {
        const svg = `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`;
        expect(dataUrlToBytes(svg).type).toBe('image/svg+xml');
        expect(QUILL_PASTE_MIME_TYPES).not.toContain('image/svg+xml');
    });
});

describe('a lista de MIME do Quill anda junto com a da casa', () => {
    it('é o MESMO conjunto de `acceptedImageTypes({ allowReencodable: true })`', () => {
        // A porta do Quill re-encoda por canvas e aceita GIF e BMP, como a ferramenta de imagem e a
        // solta, mas escreve a lista por extenso em vez de pedir `allowReencodable`. Isso a deixa
        // INVISÍVEL para `portas-de-imagem-censo.test.js`, que mede quem pede a opção. Esta igualdade
        // é o que impede as duas listas de divergirem no dia em que a casa aceitar um formato novo.
        expect([...QUILL_PASTE_MIME_TYPES].sort())
            .toEqual([...acceptedImageTypes({ allowReencodable: true })].sort());
    });
});

describe('a lista de MIME cobre o buraco do padrão do Quill', () => {
    it('inclui WebP, que o uploader de fábrica descarta CALADO', () => {
        // `Uploader.DEFAULTS.mimetypes` é `['image/png','image/jpeg']`, e `upload()` simplesmente
        // não chama o handler para o que está fora: não há o que recusar, nem frase a mostrar.
        expect(QUILL_PASTE_MIME_TYPES).toContain('image/webp');
        expect(QUILL_PASTE_MIME_TYPES).toContain('image/gif');
        expect(QUILL_PASTE_MIME_TYPES).toContain('image/png');
        expect(QUILL_PASTE_MIME_TYPES).toContain('image/jpeg');
    });

    it('o `accept` do botão é a MESMA lista, não uma cópia', () => {
        expect(QUILL_IMAGE_ACCEPT).toBe(QUILL_PASTE_MIME_TYPES.join(','));
    });
});

describe('a fiação com o Quill (estrutural: as três portas precisam existir no config)', () => {
    const fonte = readFileSync(join(FRONT, 'src/js/utilities/quill-helpers.js'), 'utf8');

    it('o editor configura o módulo `uploader` com a nossa lista e o nosso handler', () => {
        // Sem isto o Quill usa o `Uploader.DEFAULTS`, que lê o arquivo com `FileReader` e insere o
        // base64 inteiro. Nada estoura, nada avisa: o teto volta a existir só para quem usa o botão.
        expect(fonte).toMatch(/uploader:\s*\{/);
        // A string VAZIA entra de propósito: o `Uploader` do Quill descarta calado o arquivo cujo
        // `type` não está na lista, e um arrasto do Explorer entrega tipo vazio para um .jpg bom.
        expect(fonte).toMatch(/mimetypes:\s*\[\.\.\.QUILL_PASTE_MIME_TYPES,\s*''\]/);
        expect(fonte).toMatch(/handler:\s*\(range,\s*files\)/);
    });

    it('colar, soltar e o botão terminam todos em `insertQuillImages`', () => {
        const chamadas = fonte.match(/insertQuillImages\(/g) ?? [];
        // A definição, a chamada do uploader (colar e soltar) e a do botão.
        expect(chamadas.length).toBeGreaterThanOrEqual(3);
        expect(fonte).toMatch(/await insertQuillImages\(quillInstance, quillInstance\.getSelection/);
    });

    it('o matcher de `img` do clipboard está instalado, que é a terceira porta', () => {
        expect(fonte).toMatch(/clipboard:\s*\{\s*matchers:\s*\[\['img',\s*createPastedImageMatcher\(editor,/);
    });

    it('a figura embutida em HTML colado NUNCA fica no Delta síncrono, nem abaixo do teto', () => {
        // Era o limite declarado desta porta: `convert` é síncrono, então a figura abaixo de 5 MB
        // entrava inteira, sem compressão e sem teto de pixels. O matcher a retira SEMPRE e a
        // devolve pelo caminho assíncrono das outras portas. Os dois lados precisam existir: a
        // retirada (senão ela entra crua) e o reenvio (senão a pessoa perde a figura calada).
        const corpo = fonte.slice(fonte.indexOf('function createPastedImageMatcher'));
        expect(corpo).toContain('dataUrlToBytes(src)');
        expect(corpo).toMatch(/pendentes\.push\(new File\(/);
        expect(corpo).toMatch(/insertQuillImages\(quill, range, files, options\)\.catch\(reportImageRefusal\)/);
        // O único `return delta` intocado é o da fonte SEM bytes embutidos (`https://`, `blob:`).
        expect(corpo.match(/return delta;/g) ?? []).toHaveLength(1);
        expect(corpo).toMatch(/verdict\.bytes === undefined\) return delta;/);
        // SVG embutido é o tipo que carrega script: recusado por MIME, antes de qualquer decode.
        expect(corpo).toContain('QUILL_PASTE_MIME_TYPES.includes(decoded.type)');
    });

    it('o compressor continua medindo PIXELS, e o sanitizador segue intacto', () => {
        // Nada deste lote pode afrouxar `sanitizeQuillHtml`: o slide chega por sync, escrito por
        // outro usuário. O matcher só APAGA figura; o que fica passa pelo DOMPurify como antes.
        expect(fonte).toContain('validateImageDimensions(img.naturalWidth, img.naturalHeight)');
        expect(fonte).toMatch(/DOMPurify\.sanitize\(html, config\)/);
    });
});
