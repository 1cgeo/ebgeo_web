// Path: tests/unit/ebgeo-exporta-com-imagem-orfa.test.js

/**
 * UMA IMAGEM SEM ARQUIVO NÃO IMPEDE A EXPORTAÇÃO DO ATLAS INTEIRO, E A PERDA NUNCA É MUDA.
 *
 * Defeito (2026-09-19 a 2026-09-21): o exportador de `.ebgeo` passou a LANÇAR quando uma feição de
 * imagem ou um ícone personalizado não tinha o blob ("Imagem <id> indisponível. Aguarde a conexão e
 * tente exportar novamente."). A intenção era boa, fechar a perda silenciosa de antes; o efeito foi
 * que UMA imagem órfã tornava o atlas inteiro impossível de exportar, para sempre, e em atlas LOCAL
 * a frase prometia uma saída que não existe (nenhuma conexão traz de volta um blob que só existiria
 * neste disco). Órfã existe em campo: a fixture `tests/fixtures/ebgeo-2.2/01-completo.ebgeo`, cópia
 * byte a byte de um arquivo da outra linha do produto, traz quatro feições de imagem e o blob de
 * três (conferido abrindo o arquivo). Quem acusou foi
 * `tests/e2e-ui/ebgeo-round-trip-arquivo.spec.js`, vermelho no HEAD limpo desde aquele commit.
 *
 * A regra que guarda as duas intenções: a perda NUNCA é muda e NUNCA é armadilha. O exportador lê
 * os blobs ANTES de escrever o arquivo, conta o que falta, nomeia, e a pessoa decide.
 *
 * Aqui ficam a parte PURA (`src/js/import_export/ebgeo-missing-images.js`) e a FIAÇÃO do
 * exportador por leitura do texto (ele arrasta JSZip, a store e o DOM). O comportamento de ponta a
 * ponta está no spec de round-trip acima, que confirma o diálogo e reimporta o arquivo produzido.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { requiredImagesOf, missingImagesConfirm } from '../../src/js/import_export/ebgeo-missing-images.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const DADOS = {
    customIcons: [{ id: 'icone-1' }, { id: 'icone-2' }],
    maps: {
        Principal: { features: { images: [{ properties: { id: 'img-orfa' } }], points: [{ properties: { id: 'p1' } }] } },
        '04 Imagens': { features: { images: [{ properties: { id: 'img-a' } }, { properties: { id: 'img-b' } }] } },
    },
};

describe('requiredImagesOf: o que um .ebgeo não pode perder calado', () => {
    it('lista ícones personalizados e feições de IMAGEM, com o mapa de cada uma, e nada mais', () => {
        expect(requiredImagesOf(DADOS)).toEqual([
            { id: 'icone-1', kind: 'icone', mapName: null },
            { id: 'icone-2', kind: 'icone', mapName: null },
            { id: 'img-orfa', kind: 'imagem', mapName: 'Principal' },
            { id: 'img-a', kind: 'imagem', mapName: '04 Imagens' },
            { id: 'img-b', kind: 'imagem', mapName: '04 Imagens' },
        ]);
    });

    it('um ponto NÃO é exigido: o bitmap de símbolo é regenerado das propriedades na carga', () => {
        expect(requiredImagesOf(DADOS).some((i) => i.id === 'p1')).toBe(false);
    });

    it('BORDA: id repetido entra uma vez; id ausente, vazio ou não textual não entra', () => {
        const dados = {
            customIcons: [{ id: 'x' }, { id: 'x' }, { id: '' }, {}, null, { id: 7 }],
            maps: { M: { features: { images: [{ properties: { id: 'x' } }, { properties: {} }, null] } } },
        };
        expect(requiredImagesOf(dados)).toEqual([{ id: 'x', kind: 'icone', mapName: null }]);
    });

    it('BORDA: dado nulo, sem mapas, ou com coleções que não são lista devolve vazio sem lançar', () => {
        for (const dados of [null, undefined, {}, { maps: null }, { customIcons: 'x', maps: { M: { features: { images: {} } } } }]) {
            expect(requiredImagesOf(dados)).toEqual([]);
        }
    });
});

describe('missingImagesConfirm: a pergunta, e só quando há o que perguntar', () => {
    it('nada faltando devolve null, e o exportador então não pergunta nada', () => {
        expect(missingImagesConfirm([])).toBeNull();
        expect(missingImagesConfirm(null)).toBeNull();
    });

    it('atlas LOCAL: nomeia a contagem e o mapa, e NÃO promete conexão', () => {
        const p = missingImagesConfirm([{ id: 'img-orfa', kind: 'imagem', mapName: 'Principal' }], { remote: false });
        expect(p.title).toBe('Este arquivo sai sem 1 figura');
        expect(p.message).toContain('não está guardado neste computador');
        expect(p.message).toContain('1 imagem (no mapa "Principal")');
        expect(p.message).toContain('Não há de onde recuperá-lo');
        expect(p.message).not.toMatch(/conex[ãa]o/i);
        expect(p.confirmText).toBe('Exportar assim');
        expect(p.cancelText).toBe('Cancelar');
    });

    it('atlas de SERVIDOR: a saída real (cancelar e tentar com conexão) é dita', () => {
        const p = missingImagesConfirm([{ id: 'a', kind: 'imagem', mapName: 'M' }], { remote: true });
        expect(p.message).toContain('Não foi possível obter do servidor');
        expect(p.message).toContain('cancele e exporte de novo quando ela voltar');
    });

    it('plural, vários mapas sem repetição, e ícones ao lado das imagens', () => {
        const p = missingImagesConfirm([
            { id: 'a', kind: 'imagem', mapName: 'Alfa' },
            { id: 'b', kind: 'imagem', mapName: 'Alfa' },
            { id: 'c', kind: 'imagem', mapName: 'Bravo' },
            { id: 'i', kind: 'icone', mapName: null },
        ]);
        expect(p.title).toBe('Este arquivo sai sem 4 figuras');
        expect(p.message).toContain('3 imagens (nos mapas "Alfa", "Bravo") e 1 ícone personalizado');
        expect(p.message).toContain('o que usa essas figuras continua no arquivo, sem elas');
    });

    it('só ícones: a frase não inventa mapa', () => {
        const p = missingImagesConfirm([{ id: 'i', kind: 'icone', mapName: null }, { id: 'j', kind: 'icone', mapName: null }]);
        expect(p.message).toContain('2 ícones personalizados');
        expect(p.message).not.toContain('mapa');
    });
});

describe('o exportador pergunta ANTES de escrever o arquivo, e não lança mais por imagem sem blob', () => {
    const texto = readFileSync(path.join(RAIZ, 'src/js/import_export/export-import.service.js'), 'utf8').replace(/\r\n/g, '\n');

    it('PISO: o exportador ainda coleta as imagens usadas e ainda escreve o data.json', () => {
        expect(texto).toContain('const usedImages = this.collectUsedImageIds(data);');
        expect(texto).toContain("zip.file('data.json'");
    });

    it('a forma exata do defeito não volta: nenhuma recusa por "indisponível. Aguarde a conexão"', () => {
        expect(texto).not.toContain('indisponível. Aguarde a conexão');
        expect(texto).not.toMatch(/if \(requiredImages\.has\(imageId\)\) throw/);
    });

    it('os blobs são lidos e a pergunta é feita ANTES de o data.json entrar no zip', () => {
        const leitura = texto.indexOf('const blob = await getImage(imageId);');
        const pergunta = texto.indexOf('const pergunta = missingImagesConfirm(semArquivo, { remote: writingIntoServerAtlas() });');
        const dataJson = texto.indexOf("zip.file('data.json'");
        expect(leitura).toBeGreaterThan(-1);
        expect(pergunta).toBeGreaterThan(leitura);
        expect(dataJson).toBeGreaterThan(pergunta);
    });

    it('cancelar SAI sem produzir arquivo, e a perda nunca é decidida sem a pessoa', () => {
        const pergunta = texto.indexOf('const pergunta = missingImagesConfirm(');
        const trecho = texto.slice(pergunta, texto.indexOf("zip.file('data.json'", pergunta));
        expect(trecho).toContain('const seguir = await showConfirm(pergunta.title, {');
        expect(trecho).toContain('if (!seguir) return;');
        // O conjunto exigido vem do módulo puro, não de uma segunda lista escrita aqui.
        expect(texto).toContain('requiredImagesOf(data).filter(imagem => !blobs.has(imagem.id))');
    });
});
