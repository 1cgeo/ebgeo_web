// Path: tests/unit/ferramenta-de-imagem-envia-depois-de-gravar.test.js
//
// A ORDEM DO GESTO DA FERRAMENTA DE IMAGEM, lida na fonte (2026-09-24, revisão).
//
// A ferramenta registra a pendência do blob ANTES de gravar a feição (é o que faz a op nascer
// retida até os bytes chegarem) e só depois de gravar começa a transferência. Com a transferência
// começando no registro, um save recusado no meio (o mapa travado por um colega entre o clique e a
// gravação) subia os bytes de uma feição que não existe, deixava a pendência retentando por minutos
// e, numa recusa, avisava de uma figura que nunca esteve no mapa.
//
// `add_image_control.js` não roda em node (MapLibre, DOM, FileReader), então a ordem é cobrada no
// texto: é a única forma barata de prender uma sequência de três chamadas numa função de 60 linhas.
// O comportamento das duas saídas (`enviar`, `descartar`) é medido de verdade em
// `tests/integration/blob-upload-queue.test.js`.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FONTE = readFileSync(fileURLToPath(
    new URL('../../src/js/draw_tools/image_tool/add_image_control.js', import.meta.url),
), 'utf8');

describe('ferramenta de imagem: registrar, gravar, só então enviar', () => {
    it('a ordem é registro, save, envio; e o save recusado descarta o registro', () => {
        const registro = FONTE.indexOf('await registrarEnvioDeImagem(');
        const save = FONTE.indexOf('await creation.save("images", feature)');
        const descarte = FONTE.indexOf('await envio.descartar()');
        const envio = FONTE.indexOf('envio.enviar()');
        expect(registro, 'o registro existe').toBeGreaterThan(-1);
        expect(save, 'o registro vem antes do save').toBeGreaterThan(registro);
        expect(descarte, 'o save recusado descarta').toBeGreaterThan(save);
        expect(envio, 'o envio vem depois do save e do ramo de descarte').toBeGreaterThan(descarte);
        // O descarte mora no ramo do save recusado, e não depois dele.
        const ramo = FONTE.slice(FONTE.lastIndexOf('if (', save), envio);
        expect(ramo).toMatch(/if \(!\(await creation\.save\("images", feature\)\)\) \{\s*await envio\.descartar\(\);\s*return;\s*\}/);
    });

    it('a transferência não é esperada: a figura aparece antes de os bytes subirem', () => {
        expect(FONTE).not.toMatch(/await\s+envio\.enviar\(\)/);
        expect(FONTE).not.toMatch(/await\s+uploadImageBlob\(/);
    });
});
