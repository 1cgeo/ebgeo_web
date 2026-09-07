// Path: tests/unit/recusa-de-arquivo-corrompido-fala-portugues.test.js

/**
 * @fileoverview A frase que o produto diz quando o arquivo escolhido nao abre.
 *
 * O DEFEITO, MEDIDO NO NAVEGADOR EM 2026-09-07 (achado D8 da bancada escalada). Arrastar um
 * arquivo corrompido sobre o mapa devolvia um toast com a mensagem CRUA do JSZip: `Erro ao
 * carregar arquivo .ebgeo: Can't find end of central directory : is this a zip file ? If it is,
 * see https://stuk.github.io/jszip/documentation/howto/read_zip.html`. So o prefixo era da casa.
 * O usuario le ingles, jargao de formato de arquivo e um link para a documentacao de uma
 * biblioteca, num dialogo cuja pergunta e "e agora?".
 *
 * O QUE ESTE ARQUIVO PRENDE. `readEbgeoArchive` (`import_export/ebgeo-file-gate.js`) traduz a
 * falha de ABERTURA para uma frase da casa, e nenhuma palavra da dependencia atravessa. As
 * outras duas recusas do leitor ficam como estao, e os controles abaixo dizem por que: o
 * `data.json` ausente ja tinha frase propria, e o JSON invalido devolve o `SyntaxError` do
 * runtime, que nomeia a posicao do caractere num arquivo que ABRIU.
 *
 * O INSUMO DEGENERADO E DE DUAS FORMAS, e a segunda existe porque a primeira sozinha exercita um
 * eixo so. Bytes aleatorios nao sao ZIP nenhum; o segundo caso e um ZIP DE VERDADE atras do
 * cabecalho `EBGXOR` cujo corpo nao foi mascarado, entao o desmascaramento do leitor e que
 * estraga os bytes. Sao os dois jeitos de um arquivo chegar aqui quebrado (o arquivo truncado no
 * disco e o arquivo montado errado), e os dois caem no mesmo `catch`.
 *
 * O CONTROLE E O ARQUIVO BOM, nas duas formas que o leitor aceita (mascarado e cru): sem ele, um
 * leitor que recusasse TUDO passaria em cada caso negativo acima.
 */

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';

import { readEbgeoArchive } from '@js/import_export/ebgeo-file-gate.js';
import { ATLAS_SCHEMA_VERSION } from '@store/atlas/atlas.entity.js';

/** O prefixo magico que o exportador escreve na frente do ZIP mascarado. */
const CABECALHO = 'EBGXOR';

/** As palavras da DEPENDENCIA, que nenhuma recusa desta casa pode conter. */
const PALAVRAS_DA_BIBLIOTECA = ['jszip', 'http', 'central directory', 'is this a zip file'];

/** O documento minimo que o portao aceita, na versao corrente do esquema. */
function documentoBom() {
    return { version: ATLAS_SCHEMA_VERSION, maps: {}, mapOrder: [], currentMap: null };
}

/**
 * Os bytes de um ZIP com `data.json` dentro, sem mascara nenhuma.
 * @param {Object} documento - O conteudo de `data.json`.
 * @returns {Promise<Uint8Array>}
 */
async function zipCru(documento) {
    const zip = new JSZip();
    zip.file('data.json', JSON.stringify(documento));
    return zip.generateAsync({ type: 'uint8array' });
}

/**
 * Um arquivo com o cabecalho `EBGXOR` na frente dos bytes que vierem, mascarados ou nao.
 * @param {Uint8Array} bytes - O corpo.
 * @param {boolean} mascarar - Se o corpo leva o XOR 0xAA que o exportador aplica.
 * @returns {Uint8Array}
 */
function comCabecalho(bytes, mascarar) {
    const prefixo = new TextEncoder().encode(CABECALHO);
    const saida = new Uint8Array(prefixo.length + bytes.length);
    saida.set(prefixo, 0);
    saida.set(mascarar ? bytes.map((b) => b ^ 0xAA) : bytes, prefixo.length);
    return saida;
}

/**
 * Um `File` de verdade, que e o que o produto entrega ao leitor.
 * @param {Uint8Array} bytes - Conteudo.
 * @param {string} nome - Nome do arquivo.
 * @returns {File}
 */
function arquivo(bytes, nome) {
    return new File([bytes], nome);
}

/**
 * Roda o leitor e devolve o erro. Falhar em falhar e um resultado, e ele tem de aparecer como
 * tal: sem isto, um leitor que ACEITASSE o insumo degenerado passaria por "nao lancou nada".
 * @param {File|Blob} entrada - O arquivo.
 * @returns {Promise<Error>}
 */
async function recusaDe(entrada) {
    try {
        await readEbgeoArchive(entrada);
    } catch (error) {
        return error;
    }
    throw new Error('o leitor ACEITOU o insumo degenerado: nao ha recusa a medir');
}

describe('arquivo que nao abre: a frase e da casa, em portugues', () => {
    const QUEBRADOS = [
        {
            nome: 'bytes aleatorios (nao e ZIP nenhum)',
            bytes: async () => new TextEncoder().encode('isto nao e um zip, e so texto solto'),
        },
        {
            nome: 'ZIP de verdade atras do EBGXOR, mas SEM o XOR aplicado',
            bytes: async () => comCabecalho(await zipCru(documentoBom()), false),
        },
    ];

    it.each(QUEBRADOS)('$nome: nenhuma palavra da biblioteca sai na frase', async ({ bytes }) => {
        const erro = await recusaDe(arquivo(await bytes(), 'acervo.ebgeo'));

        const mensagem = erro.message.toLowerCase();
        for (const palavra of PALAVRAS_DA_BIBLIOTECA) {
            expect(mensagem, `a frase carrega "${palavra}"`).not.toContain(palavra);
        }
        expect(erro.message).toContain('não é um .ebgeo válido, ou está corrompido');
    });

    it.each(QUEBRADOS)('$nome: a frase nomeia o arquivo', async ({ bytes }) => {
        const erro = await recusaDe(arquivo(await bytes(), 'Operação Alfa.ebgeo'));

        expect(erro.message).toContain('Operação Alfa.ebgeo');
    });

    it('sem nome (um Blob, que e o que a entrega entre paginas guarda) a frase sai inteira', async () => {
        const bytes = new TextEncoder().encode('isto nao e um zip');

        const erro = await recusaDe(new Blob([bytes]));

        // Nem `"undefined"` nem `""` no meio da frase: a versao sem nome e uma frase propria.
        expect(erro.message).not.toContain('undefined');
        expect(erro.message).not.toContain('""');
        expect(erro.message).toBe('O arquivo não é um .ebgeo válido, ou está corrompido');
    });

    it('o erro original vai em `cause`, para o console e para quem depura', async () => {
        const erro = await recusaDe(arquivo(new TextEncoder().encode('nada'), 'x.ebgeo'));

        // A traducao nao pode APAGAR o diagnostico: ela o tira da tela e o deixa no lugar certo.
        expect(erro.cause).toBeInstanceOf(Error);
        expect(String(erro.cause.message).toLowerCase()).toContain('central directory');
    });
});

describe('os controles: o que a traducao NAO pode ter mexido', () => {
    it('o `.ebgeo` BOM mascarado passa, e o documento chega inteiro', async () => {
        const bytes = comCabecalho(await zipCru(documentoBom()), true);

        const { zip, data } = await readEbgeoArchive(arquivo(bytes, 'acervo.ebgeo'));

        expect(data).toEqual(documentoBom());
        expect(zip.file('data.json')).not.toBeNull();
    });

    it('o ZIP CRU, sem cabecalho nenhum, tambem passa (o leitor aceita as duas formas)', async () => {
        const { data } = await readEbgeoArchive(arquivo(await zipCru(documentoBom()), 'cru.ebgeo'));

        expect(data).toEqual(documentoBom());
    });

    it('ZIP sem `data.json` continua com a frase DELE, que ja era da casa', async () => {
        const zip = new JSZip();
        zip.file('leiame.txt', 'nada aqui');
        const bytes = await zip.generateAsync({ type: 'uint8array' });

        const erro = await recusaDe(arquivo(bytes, 'vazio.ebgeo'));

        expect(erro.message).toBe('Arquivo data.json não encontrado no .ebgeo');
    });

    it('`data.json` com JSON invalido continua devolvendo o erro do runtime', async () => {
        // DELIBERADO, e escrito para nao ser "esquecido depois": o arquivo ABRIU, e a posicao do
        // caractere e a unica pista util. Se um dia esta frase tambem virar da casa, este caso e
        // que avisa que a decisao mudou.
        const zip = new JSZip();
        zip.file('data.json', '{ isto nao e json');
        const bytes = await zip.generateAsync({ type: 'uint8array' });

        const erro = await recusaDe(arquivo(bytes, 'quebrado.ebgeo'));

        expect(erro).toBeInstanceOf(SyntaxError);
    });
});
