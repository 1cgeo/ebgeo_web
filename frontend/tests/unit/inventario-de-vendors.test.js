// Path: tests/unit/inventario-de-vendors.test.js
//
// O manifesto de vendors so vale enquanto for REPRODUTIVEL, e ate 2026-09-13 ele
// nao era: o campo `comoRefazer` descrevia o procedimento em prosa, e quem o
// repetisse escreveria o proprio laco, com a propria decisao sobre o que
// normalizar. Duas medicoes que nunca foram a mesma medicao nao se comparam.
//
// A prosa virou `scripts/inventario-de-vendors.mjs`, e este teste e o que impede
// que o script e o arquivo versionado se separem sem ninguem notar. Ele NAO prova
// que os artefatos versionados sao seguros; prova que o que esta escrito ali e o que esta
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
    RAIZ_PUBLICA,
    EXTENSOES_DE_CODIGO,
    listarPublico,
    foraDoInventario,
} from '../../../scripts/inventario-de-vendors.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const medicoes = medirArquivos();
const versionado = lerManifestoVersionado();

describe('inventario de vendors: o script e o manifesto versionado', () => {
    it('cobre as pastas de copia de terceiro que existem hoje', () => {
        // ERAM DUAS ATE 2026-09-14. `frontend/src/vendor/` guardava o snapshot do Three.js
        // (revisao 164dev) e saiu inteira quando a biblioteca passou a vir do npm em versao
        // exata, pelo ponto unico `frontend/src/js/vendor/three.js` (decisao D9, item V1). A
        // pasta nao ficou na lista "por seguranca": caminho que nao pode mais casar e allowlist
        // sem beneficiario. Este caso e a razao de a lista ser FECHADA nos dois sentidos: uma
        // pasta que entre ou saia sem passar por aqui reprova.
        expect(PASTAS_DE_VENDOR).toEqual(['frontend/public/vendors']);
        expect(medicoes.length).toBeGreaterThan(0);
        // E o outro lado, que o `toEqual` sozinho NAO cobre, e que seria cobertura vazia se fosse
        // escrito sobre `medicoes`: a lista de medicoes so pode conter o que as PASTAS cobrem,
        // entao procurar `src/vendor/` la dentro e perguntar algo cuja resposta e sempre "nao".
        // A pergunta com conteudo e sobre o DISCO: se a pasta voltar, ela volta FORA do inventario.
        expect(
            existsSync(join(RAIZ, 'frontend/src/vendor')),
            'frontend/src/vendor/ voltou a existir, e agora fora do escopo do inventario'
        ).toBe(false);
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

    it('166 dos 398 sao binarios que CARREGAM o par 0D 0A por coincidencia', () => {
        // Este numero e a razao de o eixo existir: sem a classificacao, sao 166
        // divergencias fantasma. Se ele mudar, a poda ou a entrada de um vendor
        // mexeu na composicao da arvore, e a conferencia quer saber disso.
        //
        // O DENOMINADOR CAIU DUAS VEZES EM 2026-09-14 E O NUMERADOR NAO SE MEXEU, e a leitura
        // dos dois juntos e a prova de que a adocao e as podas foram o que dizem ser. A adocao do
        // cesium-measure e a saida do snapshot do Three.js tiraram seis arquivos de TEXTO em CRLF
        // (408 -> 402, e 166 -> 160 de texto em CRLF); a poda dos vendors sem consumidor tirou
        // quatro (402 -> 398), tres de texto em CRLF e um de texto em LF. Nenhuma tocou num
        // binario. Fosse um binario junto, este numero cairia, e a mudanca estaria alcancando
        // mais do que anunciava.
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

describe('inventario de vendors: o ALCANCE, que ate 2026-09-14 falhava aberto', () => {
    // O que este bloco cobra e diferente de tudo acima. As quatro classes de
    // `compararManifestos` respondem "o que o manifesto registra continua no disco"; nenhuma
    // delas responde se existe codigo de terceiro que o manifesto NEM CONHECE. Era esse o
    // buraco: o alcance vinha de uma lista de pastas escrita a mao, e
    // `frontend/public/street_view/build/` guardou por meses uma SEGUNDA copia do Three.js
    // (revisao 164dev, byte a byte igual a do snapshot de `src/`, 3.373.610 bytes, sem um unico
    // consumidor) sem entrar em numero nenhum desta suite. Lista fechada escrita a mao falha
    // ABERTO, em silencio, para o que nascer fora dela.

    it('varre `frontend/public/` inteiro e reconhece as cinco extensoes de codigo', () => {
        expect(RAIZ_PUBLICA).toBe('frontend/public');
        expect([...EXTENSOES_DE_CODIGO].sort()).toEqual(['.cjs', '.css', '.js', '.mjs', '.wasm']);
        // CONTROLE DE VACUO da varredura: `listarPublico` tem de caminhar de verdade. Sem esta
        // linha, um `git ls-files` que devolvesse lista vazia deixaria o caso seguinte verde para
        // sempre, que e exatamente a forma do defeito que este bloco fecha.
        const publico = listarPublico();
        expect(publico.length, 'a varredura de frontend/public/ nao achou arquivo nenhum')
            .toBeGreaterThan(100);
        expect(publico.every((p) => p.startsWith('frontend/public/'))).toBe(true);
    });

    it('hoje nao ha codigo de terceiro fora das pastas cobertas', () => {
        // A poda de `frontend/public/street_view/build/` (item V7) deixou esta lista vazia. Ela e
        // a unica asercao desta suite cuja resposta certa e o VAZIO, e por isso o caso abaixo
        // existe: vazio de detector quebrado e vazio de arvore limpa sao a mesma saida.
        expect(foraDoInventario(listarPublico())).toEqual([]);
        expect(
            existsSync(join(RAIZ, 'frontend/public/street_view/build')),
            'a segunda copia do Three.js voltou a `frontend/public/street_view/build/`'
        ).toBe(false);
    });

    it('CONTROLE NEGATIVO: o detector acusa codigo fora, e so codigo', () => {
        // `foraDoInventario` e pura sobre a lista de caminhos justamente para isto: o disco nao
        // oferece mais um positivo, entao ele e fabricado.
        const amostra = [
            'frontend/public/vendors/turf.min.js',                    // coberto: nao acusa
            'frontend/public/vendors/cesium/Workers/algum.js',        // coberto, mais fundo
            'frontend/public/street_view/build/three.module.js',      // FORA: o caso que existia
            'frontend/public/algum/lugar/lib.css',                    // FORA
            'frontend/public/algum/motor.wasm',                       // FORA
            'frontend/public/images/logo_ebgeo.png',                  // nao e codigo
            'frontend/public/glyphs/0-255.pbf',                       // nao e codigo
            'frontend/public/docs/doc.html',                          // nao e codigo
        ];
        expect(foraDoInventario(amostra)).toEqual([
            'frontend/public/street_view/build/three.module.js',
            'frontend/public/algum/lugar/lib.css',
            'frontend/public/algum/motor.wasm',
        ]);
        // E o prefixo e comparado com FRONTEIRA de caminho, nunca por `startsWith` cru: uma pasta
        // irma chamada `vendors-antigo/` nao pode herdar a cobertura de `vendors/`.
        expect(foraDoInventario(['frontend/public/vendors-antigo/x.js']))
            .toEqual(['frontend/public/vendors-antigo/x.js']);
    });
});
