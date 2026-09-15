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
        //
        // DESDE 2026-09-14 ESTE CONJUNTO E VAZIO, e a troca de `toBeGreaterThan(0)` por `toBe(0)`
        // e deliberada: as duas migracoes para o npm daquele dia (o Cesium e o GDAL) levaram o
        // ultimo binario das pastas cobertas, entao a invariante ficou SEM SUJEITO na arvore. Ela
        // continua escrita porque reganha sujeito no dia em que um binario voltar; quem prova que
        // o classificador continua discriminando sao os casos sinteticos de `ehTexto` e o
        // controle negativo do eixo, que desde a mesma data FABRICA o binario que o disco nao
        // oferece mais.
        const doc = JSON.parse(readFileSync(join(RAIZ, CAMINHO_DO_MANIFESTO), 'utf8'));
        const arquivos = doc[CHAVE_DO_BLOCO][CHAVE_DO_INVENTARIO].manifestoCompleto.arquivos;
        const binarios = new Set(medicoes.filter((m) => m.binario).map((m) => m.path));
        expect(binarios.size).toBe(0);
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
    it('classifica binario e texto, e hoje nao ha um binario sequer nas pastas cobertas', () => {
        // O eixo nao morreu com o ultimo binario: sobre TEXTO ele continua decidindo quem ganha
        // hash normalizado e quem nao tem o que normalizar. Escrever o caso assim e o que o
        // mantem com sujeito vivo depois das duas migracoes de 2026-09-14; `every` sobre uma
        // lista vazia seria verde sem medir nada.
        expect(medicoes.filter((m) => m.binario)).toEqual([]);
        for (const m of medicoes) {
            const bruto = readFileSync(join(RAIZ, m.path));
            expect(m.sha256Lf === null, `${m.path}: sha256Lf nao casa com a presenca de CRLF`)
                .toBe(normalizarCrlf(bruto) === null);
        }
        // CONTROLE DE VACUO do laco acima. Ate 2026-09-14 ele era uma contagem: os DOIS lados da
        // implicacao existiam no disco (dois arquivos em CRLF e um em LF), e era isso que impedia
        // o laco de medir um lado so. EM 2026-09-15 O LADO LF FICOU SEM OCUPANTE, quando o docsify
        // saiu para o npm (decisao D16) e levou `vue.css`, que era o unico arquivo em LF das
        // pastas cobertas; sobrou UM arquivo, em CRLF. O controle entao mudou de forma em vez de
        // sumir, pelo mesmo caminho que o eixo BINARIO ja tinha percorrido no dia anterior: o lado
        // que o disco nao oferece mais e FABRICADO. Uma contagem `toHaveLength(0)` sobre o lado LF
        // seria verde sem discriminar nada.
        expect(medicoes.filter((m) => m.sha256Lf !== null)).toHaveLength(1);
        expect(normalizarCrlf(Buffer.from('uma linha\noutra linha\n', 'utf8'))).toBeNull();
        expect(normalizarCrlf(Buffer.from('uma linha\r\noutra linha\r\n', 'utf8'))).not.toBeNull();
    });

    it('0 do 1 sao binarios que CARREGAM o par 0D 0A, e o zero e o fim da serie', () => {
        // Este numero e a razao de o eixo existir: sem a classificacao, cada um deles e uma
        // divergencia fantasma. Se ele mudar, a poda ou a entrada de um vendor mexeu na
        // composicao da arvore, e a conferencia quer saber disso.
        //
        // O DENOMINADOR CAIU DUAS VEZES EM 2026-09-14 E O NUMERADOR NAO SE MEXEU, e a leitura
        // dos dois juntos e a prova de que a adocao e as podas foram o que dizem ser. A adocao do
        // cesium-measure e a saida do snapshot do Three.js tiraram seis arquivos de TEXTO em CRLF
        // (408 -> 402, e 166 -> 160 de texto em CRLF); a poda dos vendors sem consumidor tirou
        // quatro (402 -> 398), tres de texto em CRLF e um de texto em LF. Nenhuma tocou num
        // binario. Fosse um binario junto, este numero cairia, e a mudanca estaria alcancando
        // mais do que anunciava.
        //
        // NA TERCEIRA MUDANCA DO MESMO DIA O NUMERADOR CAIU, E CAIU PORQUE DEVIA (V9, o
        // Cesium vindo do npm): 398 -> 8 arquivos e 166 -> 2 binarios com o par. Os 390 que
        // sairam sao a distribuicao 1.138.0 inteira, cujos `Assets/`, `ThirdParty/` e
        // `Widgets/Images/` sao PNG, JPG e WASM, ou seja, exatamente a familia que este caso
        // conta. Sobra `frontend/public/vendors/cesium/cesium-viewshed.js`, que e TEXTO e
        // continua sendo carregado por `<script>` em runtime porque le e escreve
        // `window.Cesium`.
        //
        // NA QUARTA O NUMERADOR ZEROU, pela mesma razao e num commit independente: o GDAL
        // tambem passou a vir do npm (2026-09-14) e `frontend/public/vendors/gdal/` foi apagada
        // inteira, tres arquivos, dos quais DOIS eram os binarios que restavam (o `.wasm` de
        // 28,2 MB e o `.data` de 11,6 MB, que carregam 0D 0A dentro de conteudo comprimido); o
        // terceiro e o wrapper, texto em LF. Dai 8 -> 5 e 2 -> 0. As duas contas fecham pelos
        // dois lados: 398 - 390 - 3 = 5 arquivos, e 166 - 164 - 2 = 0 binarios com o par. Ele
        // nao e um teto que se empurra, e sim uma segunda leitura das mesmas podas; quem o
        // editar sem saber quais binarios sairam esta apagando a unica coisa que ele mede.
        //
        // NA QUINTA O DENOMINADOR CAIU E O NUMERADOR FICOU EM ZERO, que e a unica combinacao
        // possivel depois da quarta: a fusao de plano/npmc sobre a arvore que ja trazia o GDAL do
        // npm tirou `turf.min.js` (633.973 bytes) e `milsymbol.min.js` (855.090), os dois TEXTO em
        // CRLF, que passaram a vir do npm pelos pontos unicos `src/js/vendor/turf.js` e
        // `src/js/vendor/milsymbol.js`. Dai 5 -> 3. Sobram `cesium/cesium-viewshed.js` e
        // `docsify.min.js`, texto em CRLF, mais `vue.css`, texto em LF; o docsify fica porque TEM
        // consumidor (`frontend/public/docs/doc.html`, servido estatico, fora do Vite), que e o
        // achado que impediu a poda dele.
        //
        // A leitura que este par de numeros permite e a que interessa: uma poda que deixasse um
        // binario de OUTRO vendor para tras apareceria aqui como 1, e nao como 0.
        // NA SEXTA O DENOMINADOR CHEGOU A UM, e o numerador continuou em zero (2026-09-15, decisao
        // D16): o docsify passou a vir do npm e `docsify.min.js` (160.921 bytes, CRLF) e `vue.css`
        // (13.061, LF) foram apagados, que eram o ULTIMO vendor com consumidor. Os dois eram texto,
        // entao a parcela de binarios nao tinha como se mover: 3 -> 1 e 0 -> 0. Sobra
        // `cesium/cesium-viewshed.js`, o unico artefato sem versao, sem licenca e sem upstream a
        // que perguntar por aviso (item V3), e e por isso que este numero chegou ao fim da serie:
        // abaixo de um so ha zero, e zero aqui significaria que a pasta inteira saiu.
        const comParCrLf = medicoes.filter((m) => m.binario && normalizarCrlf(readFileSync(join(RAIZ, m.path))) !== null);
        expect(comParCrLf).toEqual([]);
        expect(medicoes).toHaveLength(1);
        // ZERO DE ARVORE LIMPA E ZERO DE FILTRO QUEBRADO SAO A MESMA SAIDA, e o disco nao
        // oferece mais o positivo: ele e fabricado. Uma sequencia com byte NUL (logo binaria)
        // que carrega o par tem de ser classificada como binaria E ter o par encontrado, que
        // sao as duas metades do predicado do filtro acima.
        const fabricado = Buffer.from([0x00, 0x1f, 0x0d, 0x0a, 0x8b]);
        expect(ehTexto(fabricado)).toBe(false);
        expect(normalizarCrlf(fabricado)).not.toBeNull();
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
        //
        // AS TRES MEDICOES SAO FABRICADAS DESDE 2026-09-15, e antes eram `medicoes.slice(0, 3)`.
        // A poda do docsify (decisao D16) deixou UM arquivo nas pastas cobertas, e um `slice(0, 3)`
        // sobre uma lista de um devolve uma lista de um: o caso do sumico compararia contra uma
        // base vazia e o dos bytes nao teria segundo elemento para alterar, ou seja, duas das
        // quatro classes parariam de ter sujeito. `compararManifestos` e pura sobre (tuplas,
        // medicoes), entao o que ela decide nao depende de o arquivo existir no disco, e fabricar
        // e o que mantem as quatro classes vivas independentemente do que sobrar na pasta. E o
        // mesmo caminho que o eixo binario deste arquivo ja tinha percorrido no dia anterior.
        const medidas = [
            { path: 'frontend/public/vendors/um.js', bytes: 10, sha256: '1'.repeat(64), sha256Lf: '2'.repeat(64), binario: false },
            { path: 'frontend/public/vendors/dois.css', bytes: 20, sha256: '3'.repeat(64), sha256Lf: null, binario: false },
            { path: 'frontend/public/vendors/tres.wasm', bytes: 30, sha256: '4'.repeat(64), sha256Lf: null, binario: true },
        ];
        const base = medidas.map((m) => [m.path, m.bytes, m.sha256, m.sha256Lf]);

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
        //
        // O lado BINARIO passou a ser FABRICADO em 2026-09-14: as duas migracoes para o npm
        // daquele dia levaram o ultimo binario das pastas cobertas, e um controle negativo que
        // dependesse de achar um no disco viraria um `undefined` silencioso, que e a forma exata
        // do defeito que este bloco existe para impedir. Quem responde se a CLASSIFICACAO esta
        // certa e `medirArquivos`, cobrado acima; aqui o que se mede e o COMPORTAMENTO de
        // `compararManifestos` diante dela.
        const bin = {
            path: 'frontend/public/vendors/fabricado.wasm',
            bytes: 5,
            sha256: 'b'.repeat(64),
            sha256Lf: null,
            binario: true,
        };
        const txt = medicoes.find((m) => !m.binario && m.sha256Lf !== null);
        expect(txt).toBeTruthy();

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
            // `.md` nao e codigo, e este arquivo e o TUTORIAL: desde 2026-09-15 ele e a unica
            // coisa que resta em `public/docs/`, porque `doc.html` (que morava aqui nesta amostra)
            // virou `frontend/tutorial.html`, entrada do bundler.
            'frontend/public/docs/README.md',                         // nao e codigo
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
