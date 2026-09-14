// Path: tests/unit/inventario-de-vendors.test.js
//
// O manifesto de vendors so vale enquanto for REPRODUTIVEL, e ate 2026-09-13 ele
// nao era: o campo `comoRefazer` descrevia o procedimento em prosa, e quem o
// repetisse escreveria o proprio laco, com a propria decisao sobre o que
// normalizar. Duas medicoes que nunca foram a mesma medicao nao se comparam.
//
// A prosa virou `scripts/inventario-de-vendors.mjs`, e este teste e o que impede
// que o script e o arquivo versionado se separem sem ninguem notar. Ele NAO prova
// que os 407 artefatos sao seguros; prova que o que esta escrito ali e o que esta
// no disco, que e a unica pergunta que um manifesto responde.
//
// O MANIFESTO TEM MAIS DE UM BLOCO DATADO, e o que vale e `CHAVE_DO_BLOCO`. Os
// anteriores ficam como evidencia da data deles e nao sao remedidos: quem os
// reescrevesse para caber na arvore de hoje estaria datando uma medicao que
// nunca aconteceu naquele dia.
//
// O EIXO E O PONTO. Comparar pelo sha256 CRU acusa divergencia em toda maquina com
// outra configuracao de fim de linha, e comparar pelo "normalizado" cegamente acusa
// 166 arquivos BINARIOS que nunca mudaram um byte. Os dois erros ja foram cometidos
// neste repositorio, o segundo dentro do proprio manifesto: os 166 sha256Lf de PNG,
// JPG, WASM e do pacote de dados do GDAL foram produzidos por um ida e volta por
// string utf8, que devolve U+FFFD para todo byte invalido. Eles continuam no arquivo,
// rotulados como artefato do instrumento, e o teste da divergencia entre "rotulado"
// e "apagado" e este: se alguem os apagar, `a ressalva continua declarada` fica
// vermelho, porque numero errado sem rotulo volta a ser lido como evidencia.

import { describe, it, expect } from 'vitest';
import { Buffer } from 'node:buffer';
import {
    RAIZ,
    PASTAS_DE_VENDOR,
    CAMINHO_DO_MANIFESTO,
    CHAVE_DO_BLOCO,
    CHAVE_DO_INVENTARIO,
    ehTexto,
    normalizarCrlf,
    medirArquivos,
    gerarManifesto,
    lerManifestoVersionado,
    compararManifestos,
} from '../../../scripts/inventario-de-vendors.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const medicoes = medirArquivos();
const versionado = lerManifestoVersionado();

describe('inventario de vendors: o script e o manifesto versionado', () => {
    it('cobre as duas pastas de copia de terceiro', () => {
        expect(PASTAS_DE_VENDOR).toEqual(['frontend/public/vendors', 'frontend/src/vendor']);
        expect(medicoes.length).toBeGreaterThan(0);
    });

    it('mede exatamente os arquivos que o manifesto registra', () => {
        expect(medicoes.length).toBe(versionado.length);
    });

    it('nao tem arquivo faltando, novo nem divergente', () => {
        const r = compararManifestos(versionado, medicoes);
        // As tres listas entram na mensagem de falha de proposito: "igual: false"
        // sozinho manda quem le rodar o script de novo para saber o que mudou.
        expect({ faltando: r.faltando, novo: r.novo, divergente: r.divergente }).toEqual({
            faltando: [],
            novo: [],
            divergente: [],
        });
    });

    it('tambem reproduz os tamanhos em bytes, arquivo por arquivo', () => {
        const r = compararManifestos(versionado, medicoes);
        expect(r.bytesDivergentes).toEqual([]);
    });

    it('mantem o formato de tupla do arquivo versionado', () => {
        const manifesto = gerarManifesto();
        expect(manifesto).toHaveLength(versionado.length);
        for (const t of manifesto.slice(0, 5)) {
            expect(t).toHaveLength(4);
            expect(typeof t[0]).toBe('string');
            expect(typeof t[1]).toBe('number');
            expect(t[2]).toMatch(/^[0-9a-f]{64}$/);
            expect(t[3] === null || /^[0-9a-f]{64}$/.test(t[3])).toBe(true);
        }
    });

    it('a ressalva do campo sha256Lf continua declarada no manifesto', () => {
        const doc = JSON.parse(readFileSync(join(RAIZ, CAMINHO_DO_MANIFESTO), 'utf8'));
        const bloco = doc['2026-09-13'].vendorInventory2026_09_13;
        expect(bloco.manifestoCompleto.ressalvaDoCampoSha256Lf).toMatch(/artefato do instrumento/);
        expect(bloco.resumo.ressalvaComCrlfNaArvore).toMatch(/166/);
    });

    it('o bloco de 2026-09-13 continua no arquivo, com as 408 tuplas de entao', () => {
        // O bloco corrente e outro (`CHAVE_DO_BLOCO`), e o anterior fica como
        // evidencia datada. Apagá-lo seria a forma silenciosa de perder a prova
        // de que a medicao de 2026-09-12 tinha o defeito de instrumento que a
        // ressalva acima descreve: sem as tuplas, a ressalva vira uma frase
        // sobre numeros que ninguem pode mais conferir.
        const doc = JSON.parse(readFileSync(join(RAIZ, CAMINHO_DO_MANIFESTO), 'utf8'));
        expect(doc['2026-09-13'].vendorInventory2026_09_13.manifestoCompleto.arquivos).toHaveLength(408);
        expect(CHAVE_DO_BLOCO).not.toBe('2026-09-13');
    });

    it('no bloco CORRENTE nenhum arquivo binario carrega sha256Lf', () => {
        // O defeito de 2026-09-12 em forma de invariante, para que ele nao possa
        // voltar sem ficar vermelho: normalizar CRLF num binario e tratar um
        // 0D 0A de conteudo comprimido como fim de linha, e o numero que sai
        // dali nao identifica nada. O bloco anterior tem 166 desses, rotulados.
        const doc = JSON.parse(readFileSync(join(RAIZ, CAMINHO_DO_MANIFESTO), 'utf8'));
        const arquivos = doc[CHAVE_DO_BLOCO][CHAVE_DO_INVENTARIO].manifestoCompleto.arquivos;
        const binarios = new Set(medicoes.filter((m) => m.binario).map((m) => m.path));
        expect(binarios.size).toBeGreaterThan(0);
        expect(arquivos.filter((t) => binarios.has(t[0]) && t[3] !== null)).toEqual([]);
    });

    it('cesium-measure.js saiu das pastas de vendor e virou codigo da casa', () => {
        // Adocao, nao poda (decisao D9, item V2): o arquivo esta VIVO em src/js,
        // e e por isso que ele nao aparece em lista de poda nenhuma. Esta
        // asserção e dupla de proposito, porque so a metade de cima passaria
        // verde se alguem simplesmente tivesse apagado o arquivo.
        expect(medicoes.some((m) => m.path.endsWith('vendors/cesium/cesium-measure.js'))).toBe(false);
        expect(
            readFileSync(join(RAIZ, 'frontend/src/js/3d_models_viewer_tool/services/cesium-measure.js'), 'utf8')
        ).toMatch(/formatDistanceLabel/);
    });
});

describe('inventario de vendors: o eixo de comparacao', () => {
    it('classifica binario e texto, e o binario nao ganha hash normalizado', () => {
        const binarios = medicoes.filter((m) => m.binario);
        expect(binarios.length).toBeGreaterThan(0);
        expect(binarios.every((m) => m.sha256Lf === null)).toBe(true);
    });

    it('166 dos 407 sao binarios que CARREGAM o par 0D 0A por coincidencia', () => {
        // Este numero e a razao de o eixo existir: sem a classificacao, sao 166
        // divergencias fantasma. Se ele mudar, a poda ou a entrada de um vendor
        // mexeu na composicao da arvore, e a conferencia quer saber disso.
        const comParCrLf = medicoes.filter((m) => m.binario && normalizarCrlf(readFileSync(join(RAIZ, m.path))) !== null);
        expect(comParCrLf).toHaveLength(166);
    });

    it('ehTexto recusa NUL e UTF-8 invalido, e aceita texto acentuado', () => {
        expect(ehTexto(Buffer.from('linha\r\noutra\n', 'utf8'))).toBe(true);
        expect(ehTexto(Buffer.from('acentuacao: cao, arvore', 'utf8'))).toBe(true);
        expect(ehTexto(Buffer.from([0x61, 0x00, 0x62]))).toBe(false);
        expect(ehTexto(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe]))).toBe(false);
    });

    it('normalizarCrlf opera em bytes: nao toca CR sozinho e devolve null sem CRLF', () => {
        expect(normalizarCrlf(Buffer.from('a\nb\n', 'utf8'))).toBeNull();
        expect(normalizarCrlf(Buffer.from('a\rb', 'utf8'))).toBeNull();
        expect(normalizarCrlf(Buffer.from('a\r\nb', 'utf8')).toString('utf8')).toBe('a\nb');
        // CR seguido de CRLF: so o par vira LF, o CR solto sobrevive.
        expect([...normalizarCrlf(Buffer.from([0x0d, 0x0d, 0x0a]))]).toEqual([0x0d, 0x0a]);
    });

    it('CONTROLE NEGATIVO: a comparacao acusa mudanca de conteudo, sumico e entrada', () => {
        // Sem isto o verde acima poderia estar provando apenas que duas listas
        // existem. Cada classe e fabricada e tem de aparecer.
        const base = medicoes.slice(0, 3).map((m) => [m.path, m.bytes, m.sha256, m.sha256Lf]);
        const medidas = medicoes.slice(0, 3);

        const alterado = base.map((t, i) => (i === 0 ? [t[0], t[1], 'f'.repeat(64), null] : t));
        expect(compararManifestos(alterado, medidas).divergente).toHaveLength(1);

        const semUm = base.slice(1);
        expect(compararManifestos(semUm, medidas).novo).toEqual([base[0][0]]);

        const comExtra = [...base, ['frontend/public/vendors/inventado.js', 1, '0'.repeat(64), null]];
        expect(compararManifestos(comExtra, medidas).faltando).toEqual(['frontend/public/vendors/inventado.js']);

        const outroTamanho = base.map((t, i) => (i === 1 ? [t[0], t[1] + 7, t[2], t[3]] : t));
        expect(compararManifestos(outroTamanho, medidas).bytesDivergentes).toHaveLength(1);
    });

    it('CONTROLE NEGATIVO: o eixo binario ignora sha256Lf, o de texto nao', () => {
        // A metade que o manifesto de 2026-09-12 errou. Um sha256Lf mentiroso num
        // arquivo binario NAO pode reprovar; o mesmo num arquivo de texto TEM de
        // reprovar, senao o eixo estaria apenas desligado.
        const bin = medicoes.find((m) => m.binario);
        const txt = medicoes.find((m) => !m.binario && m.sha256Lf !== null);
        expect(bin && txt).toBeTruthy();

        const mentira = 'a'.repeat(64);
        expect(compararManifestos([[bin.path, bin.bytes, bin.sha256, mentira]], [bin]).divergente).toEqual([]);
        expect(compararManifestos([[txt.path, txt.bytes, txt.sha256, mentira]], [txt]).divergente).toHaveLength(1);
    });
});
