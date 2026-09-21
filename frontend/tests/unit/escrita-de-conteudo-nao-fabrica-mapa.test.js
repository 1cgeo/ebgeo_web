// Path: tests/unit/escrita-de-conteudo-nao-fabrica-mapa.test.js
//
// O CENSO DA LEITURA QUE PRECEDE UMA ESCRITA DE DOCUMENTO DE MAPA (ponto D2).
//
// ================= O QUE ELE EXISTE PARA COBRIR ==============================
//
// `getMapDataCompat` (`src/js/store/repositories/index.js`) responde a um mapa AUSENTE com
// `getEmptyMapData()`: um documento COMPLETO e `id` vazio. Nada nele diz "não existe". Quem lê,
// muta e grava de volta cai em `LocalRepository.saveMap`, cujo `_resolveMapKey` devolve o PRÓPRIO
// NOME quando não resolve nada: nasce um registro com a CHAVE e o `id` iguais ao nome. É o mapa
// FANTASMA, e em atlas de SERVIDOR a op que o gesto enfileira sai com contexto que não é UUID e é
// descartada pelo anti-vazamento antes do envio, sem erro em lugar nenhum.
//
// A leitura tolerante NÃO é o defeito: ela tem dezenas de leitores legítimos, para os quais um
// documento vazio é a resposta certa. O defeito é a leitura tolerante que termina GRAVANDO. Por
// isso o censo é sobre o PAR (lê tolerante, escreve documento) e não sobre a leitura sozinha.
//
// ================= AS TRÊS CLASSES ==========================================
//
// (G) GESTO: alguém apertou algo (desenhar, colar, duplicar, importar, converter, mover camada,
//     editar grupo). Tem de RECUSAR, nomeando o estado, porque o clique é como o motivo chega.
// (D) DERIVADA: não há gesto a quem responder (contagem de cores, ponteiro de mapa corrente, PNG
//     regenerado, persistência adiada de camada). Tem de PULAR EM SILÊNCIO. Medido em 2026-09-21:
//     abrir um atlas e trocar de mapa já grava contagem de cores e ponteiro sem edição nenhuma, e
//     um aviso ali apareceria a cada troca de mapa, dizendo que falhou o que não falhou.
// (C) CRIAÇÃO: é exatamente quem PODE escrever um mapa que ainda não existe (`addMap`, o import, o
//     clone, o boot do atlas local, a migração). Guardar aqui seria fechar a porta da frente.
//
// ================= SÃO DOIS PARES, E O SEGUNDO É O MAIS DIFÍCIL DE ACHAR ====
//
// O par do DOCUMENTO é o de cima. O par LATERAL é o de 3D e 360: marcador, medição, viewshed,
// posição de câmera salva, orientação e marcador 360 não tocam o documento do mapa, eles leem e
// gravam `cesium3d_<chave>` e `streetview360_<chave>`, que `_resolveMapKey` chaveia pelo MESMO
// nome não resolvido. O prejuízo é da mesma classe (gesto aceito e jogado fora em silêncio, op
// com contexto que não é UUID descartada pelo anti-vazamento), e o que muda é só a evidência:
// ali sobra um cartão fantasma na aba Mapas, aqui não sobra NADA na tela. Não ter sintoma torna o
// caso mais difícil de achar, não menor, e por isso o censo cobre os dois.
//
// ================= O QUE ESTE ARQUIVO PROÍBE =================================
//
// Duas coisas mecânicas:
//
//   1. um arquivo de `src/js/store/` que leia pela porta TOLERANTE e escreva (documento de mapa OU
//      store lateral de 3D/360) e NÃO esteja classificado aqui, com motivo escrito (arquivo novo
//      nasce vermelho);
//   2. um classificado (G) cujo texto não cite nenhuma das guardas declaradas, isto é, que diga
//      "recuso quando o mapa não existe" sem ter por onde saber que ele não existe.
//
// ================= A ARMADILHA DO NOME SOLTO, E POR QUE A ÂNCORA É O IMPORT ==
//
// A varredura resolve os nomes A PARTIR DO `import` de `repositories/index.js`, incluindo os
// apelidos (`getMapDataCompat as getMapData`, em `map.operations.js` e `store-state-manager.js`) e
// os apelidos LOCAIS (`const getMapData = getMapDataCompat;`). Nunca pelo nome solto. O motivo tem
// nome nesta árvore: `src/js/store/migration/late-legacy-plan.js` declara uma FUNÇÃO LOCAL chamada
// `mapResolver`, homônima do serviço `services/map-resolver.service.js` que meio store importa. Um
// censo ancorado em texto solto conta homônimo como uso e deixa de contar apelido como uso, e erra
// nos DOIS sentidos.
//
// ================= O ALCANCE, E O QUE ELE NÃO PROVA ==========================
//
// EXISTÊNCIA e FORMA, por ARQUIVO, nunca comportamento. Um arquivo que guarde uma função e esqueça
// a irmã passa aqui: quem mede isso é o repro,
// `tests/store/escrita-de-conteudo-em-mapa-inexistente.repro.test.js`, que põe um mapa corrente que
// o disco não tem e exige que a escrita recuse, que NENHUMA chave nasça no store de mapas e que
// nenhuma intenção seja registrada. Os dois juntos são a cobertura; nenhum dos dois sozinho é.
//
// FICAM DE FORA, declarados, dois vizinhos que a intuição traria para cá:
//
//   - `store/sync/remote-operation-handler.js` escreve documento de mapa (`repo.saveMap`) e NÃO lê
//     pela porta tolerante: ele é o caminho de ENTRADA (a op de um par, o retrato do servidor), e
//     criar um mapa que este cliente não tinha é literalmente o trabalho dele. Classe (C) por
//     natureza, fora do par que este censo vigia;
//   - as escritas de CAMADA e de GRUPO (`layers_`, `groups_`) e os app settings de cor e de
//     ponteiro passam pelo MESMO `_resolveMapKey` e também deixam entrada órfã, e continuam fora.
//     A razão é a CLASSE delas, não o sintoma: a escrita de camada por gesto já é guardada pelo
//     lado da feição (`transferLayerToMap` relê o destino e desfaz quando `addFeatures` recusa), a
//     persistência adiada de camada é (D) por construção, e a contagem de cores e o ponteiro de
//     mapa corrente são as duas escritas (D) que a medição de 2026-09-21 nomeia. Nenhuma delas é
//     um gesto sem guarda; se alguma virar, ela entra aqui.
//
// O inventário vem do VERSIONAMENTO (`git ls-files --cached --others --exclude-standard`), e as
// duas bandeiras não são detalhe: sem `--others` o arquivo escrito há cinco minutos, que é
// justamente o que ninguém classificou, fica fora da varredura.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));

// ============================================================================
// AS CLASSES E AS GUARDAS
// ============================================================================

/** Escrita de GESTO: recusa nomeando o estado. */
const GESTO = 'gesto';
/** Escrita DERIVADA: pula em silêncio. */
const DERIVADA = 'derivada';
/** CRIAÇÃO legítima: é quem pode escrever um mapa que não existia. */
const CRIACAO = 'criacao';

/**
 * AS GUARDAS LEGÍTIMAS, e a lista é FECHADA de propósito: um arquivo (G) tem de citar uma delas,
 * e acrescentar uma quinta é uma edição deliberada deste arquivo, não um efeito colateral.
 *
 * As quatro primeiras são as portas de `store/mapa-inexistente.js` e a leitura crua que elas usam;
 * a quinta é a guarda IRMÃ que já existia em `map.operations.js` antes deste ponto, sobre a
 * identidade remota do documento, e que cobre as três escritas de ajuste de mapa daquele arquivo.
 */
const GUARDAS = Object.freeze({
    PORTA_DE_GESTO: 'mapDocumentForGesture',
    PORTA_DERIVADA: 'mapDocumentForDerivedWrite',
    PORTA_DE_EXISTENCIA: 'mapExistsForGesture',
    LEITURA_ESTRITA: 'getExistingMapData',
    IDENTIDADE_REMOTA: 'refusesMissingRemoteMap'
});

/**
 * @typedef {Object} Entrada
 * @property {string} arquivo - Caminho relativo a `frontend/`.
 * @property {string} classe
 * @property {string[]} [guardas] - Símbolos que o arquivo tem de citar. Obrigatório na classe (G).
 * @property {string} motivo
 */

/** @type {Entrada[]} */
const CENSO = [
    {
        arquivo: 'src/js/store/feature.operations.js',
        classe: GESTO,
        guardas: [GUARDAS.PORTA_DE_GESTO, GUARDAS.PORTA_DERIVADA],
        motivo: 'O arquivo do defeito. Onze escritas leem o documento do mapa e gravam de volta, e '
            + 'três delas EMPILHAM em balde de feição (`addFeature`, `addFeatures`, '
            + '`addFeatureSilent`), que é a forma que cria o registro fantasma; as outras oito '
            + 'voltavam por acaso, achando índice -1 num documento fabricado. As de GESTO passaram '
            + 'a ler por `mapDocumentForGesture`; as três DERIVADAS (`stampGeneratedBitmap`, que é '
            + 'cache de PNG por cliente, e as duas `*Silent`, que não consultam papel nem gravam '
            + 'desfazer) leem por `mapDocumentForDerivedWrite` e somem caladas. `moveFeaturesToMap` '
            + 'é o caso puro: ela JÁ tinha a checagem, escrita como '
            + '`Object.keys(targetMapData).length === 0`, e a condição era falsa por construção.',
    },
    {
        arquivo: 'src/js/store/catalog.operations.js',
        classe: GESTO,
        guardas: [GUARDAS.PORTA_DE_GESTO],
        motivo: 'Ligar, desligar e restilizar uma camada de catálogo num mapa. Das três edições, só '
            + '`addCatalogLayer` escreve numa lista vazia (as outras acham índice -1), então era ela '
            + 'que cunhava o fantasma. `editCatalogLayers` lê por `mapDocumentForGesture` e mantém a '
            + 'guarda de identidade remota logo abaixo, que responde a outra pergunta (o `id` do '
            + 'documento) e estoura em vez de emitir. `revalidateCatalogLayers` fica na leitura '
            + 'tolerante de propósito: é derivada e segura por construção, porque num mapa ausente a '
            + 'lista é vazia, `hasChanges` fica falso e nada é gravado.',
    },
    {
        arquivo: 'src/js/store/map.operations.js',
        classe: GESTO,
        guardas: [GUARDAS.IDENTIDADE_REMOTA],
        motivo: 'Os três ajustes do PRÓPRIO mapa (posição salva, camada base, notas na criação) leem '
            + 'o documento pelos apelidos `getMapData`/`updateMapData` e gravam de volta. Eles já '
            + 'têm a guarda IRMÃ, `refusesMissingRemoteMap` (nascida como uma asserção que estourava), que recusa o '
            + 'documento sem identidade remota válida: é a mesma condição vista pelo `id` em vez de '
            + 'pela ausência, e cobre o mesmo caso em atlas de servidor. A dívida de FORMA que este '
            + 'motivo declarava (ela ESTOURA, e uma recusa que lança não chega à pessoa) foi fechada '
            + 'no mesmo dia: ela passou a EMITIR `map_missing` e devolver uma persistência vazia, '
            + 'DENTRO da transação, sobre o documento que a própria transação leu (perguntar antes da '
            + 'transação tirava a primeira leitura de dentro do carimbo de escopo, e o guarda de troca '
            + 'de atlas reprovou no mesmo dia; fiação presa em '
            + '`tests/unit/ajuste-de-mapa-recusa-mapa-inexistente.test.js`). `addMap` está no mesmo arquivo e é (C): ele grava '
            + 'um mapa que acabou de nascer, e perguntar se ele existe fecharia a porta da frente.',
    },
    {
        arquivo: 'src/js/store/cesium3d.operations.js',
        classe: GESTO,
        guardas: [GUARDAS.PORTA_DE_EXISTENCIA],
        motivo: 'O par LATERAL: marcador 3D, medição, viewshed, posição de câmera salva e as imagens '
            + 'embutidas dos três. Todo escritor passa pelo funil `editCesium3d`, e é lá que mora a '
            + 'pergunta, DENTRO da transação e antes da leitura do lateral. CONFERIDOS UM A UM em 2026-09-21: NENHUM deles '
            + 'é (D). `saveCameraPosition`/`clearCameraPosition` são o caso que a intuição classifica '
            + 'errado, e a medição diz o contrário: nada grava a câmera ao navegar, os dois únicos '
            + 'chamadores são os botões "salvar-camera" e "limpar-camera" de '
            + '`3d_models_viewer_tool/map_3d.js` mais a lixeira da aba de feições. Fica fora do funil '
            + 'só `setCesium3dDataForImport`, que é (C).',
    },
    {
        arquivo: 'src/js/store/streetview360.operations.js',
        classe: GESTO,
        guardas: [GUARDAS.PORTA_DE_EXISTENCIA],
        motivo: 'O irmão do lateral: orientação da foto, marcador 360 e as imagens embutidas dele. '
            + 'Mesma forma e mesmo funil (`editStreetview360`), mesma classificação conferida uma a '
            + 'uma: `saveOrientation` e `clearOrientation` chegam dos botões do visualizador 360 '
            + '(`street_view_tool/street_view_viewer.js`) e da lixeira da aba de feições, nunca de '
            + 'quem apenas olha em volta, então são gesto e não derivada. Fica fora do funil só '
            + '`setStreetview360DataForImport`, que é (C).',
    },
];

// ============================================================================
// A VARREDURA
// ============================================================================

/**
 * Remove comentário de bloco e de linha, preservando a contagem de linhas.
 *
 * A NORMALIZAÇÃO DE CRLF NÃO É COSMÉTICA: os arquivos deste repositório terminam em `\r\n`, e em
 * regex de JavaScript `\r` é TERMINADOR DE LINHA, então `.` não o casa. Sem ela a remoção rodaria
 * devolvendo o texto intacto, sem erro, e o censo cobraria prosa.
 * @param {string} src
 * @returns {string}
 */
function semComentarios(src) {
    const normalizado = src.replace(/\r\n?/g, '\n');
    const semBloco = normalizado.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    return semBloco.split('\n').map((linha) => linha.replace(/\/\/.*/, '')).join('\n');
}

const lerCodigo = (arquivo) => semComentarios(readFileSync(path.join(RAIZ, arquivo), 'utf8'));

/**
 * O INVENTÁRIO: rastreado MAIS não rastreado não ignorado.
 * @param {string} [pathspec] - Relativo a `frontend/`.
 * @returns {string[]}
 */
function arquivosDoInventario(pathspec = 'src/js/store') {
    return execFileSync(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard', pathspec],
        { cwd: RAIZ, encoding: 'utf8' },
    ).split('\n').map((s) => s.trim()).filter((s) => s.endsWith('.js'));
}

/** Todo `import { ... } from '<algo>/repositories/index.js'` de um arquivo. */
const IMPORTA_REPOSITORIO = /import\s*\{([^}]*)\}\s*from\s*['"][^'"]*repositories\/index\.js['"]/g;

/**
 * Os nomes LOCAIS sob os quais este arquivo alcança um export de `repositories/index.js`.
 *
 * Cobre as três formas vivas na árvore: o nome direto (`getMapDataCompat`), o apelido de import
 * (`getMapDataCompat as getMapData`) e o apelido LOCAL logo abaixo do import
 * (`const getMapData = getMapDataCompat;`, que é o que `map.operations.js` faz).
 * @param {string} codigo - Já sem comentários.
 * @param {string} exportado - O nome como `repositories/index.js` o exporta.
 * @returns {string[]} Nomes locais, possivelmente vazio.
 */
function nomesLocaisDe(codigo, exportado) {
    const locais = new Set();
    for (const m of codigo.matchAll(IMPORTA_REPOSITORIO)) {
        for (const parte of m[1].split(',')) {
            const [origem, apelido] = parte.split(/\s+as\s+/).map((s) => s.trim());
            if (origem === exportado) locais.add(apelido || origem);
        }
    }
    // Apelido local: `const X = <um dos nomes já conhecidos>;`
    for (const local of [...locais]) {
        const apelidoLocal = new RegExp(`\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${local}\\s*;`, 'g');
        for (const m of codigo.matchAll(apelidoLocal)) locais.add(m[1]);
    }
    return [...locais];
}

/** Se algum dos nomes é CHAMADO no código. */
function chamaAlgum(codigo, nomes) {
    return nomes.some((nome) => new RegExp(`\\b${nome}\\s*\\(`).test(codigo));
}

/**
 * OS DOIS PARES, e cada um é `[leitores tolerantes, escritores]` como `repositories/index.js` os
 * exporta. A varredura resolve os nomes locais de cada um pelo import, e um arquivo entra no censo
 * quando algum par casa INTEIRO: ler sem escrever é leitura pura, e escrever sem ler é outra
 * família (a porta de import, o caminho de entrada do sync).
 */
const PARES = Object.freeze([
    { nome: 'documento do mapa', leitores: ['getMapDataCompat'], escritores: ['updateMapDataCompat', 'createMapCompat'] },
    { nome: 'lateral 3D', leitores: ['getCesium3dCompat'], escritores: ['setCesium3dCompat'] },
    { nome: 'lateral 360', leitores: ['getStreetview360Compat'], escritores: ['setStreetview360Compat'] }
]);

/**
 * Um arquivo está no censo quando LÊ pela porta tolerante E ESCREVE, em algum dos pares.
 *
 * O par do documento tem um quarto escritor que não é um export nomeado: o `repo.saveMap(`
 * alcançado por `getRepository` DO MESMO módulo, que é a porta crua.
 * @param {string} arquivo
 * @returns {boolean}
 */
function leToleranteEEscreve(arquivo) {
    const codigo = lerCodigo(arquivo);
    const casaPar = ({ leitores, escritores }) =>
        chamaAlgum(codigo, leitores.flatMap((n) => nomesLocaisDe(codigo, n)))
        && chamaAlgum(codigo, escritores.flatMap((n) => nomesLocaisDe(codigo, n)));

    if (PARES.some(casaPar)) return true;

    return chamaAlgum(codigo, nomesLocaisDe(codigo, 'getMapDataCompat'))
        && nomesLocaisDe(codigo, 'getRepository').length > 0
        && /\.saveMap\s*\(/.test(codigo);
}

/** Os arquivos do par, no inventário dado. */
const doPar = (arquivos) => arquivos.filter(leToleranteEEscreve);

/** Os não classificados, no formato de mensagem de erro. */
function naoClassificados(arquivos) {
    const declarados = new Set(CENSO.map((e) => e.arquivo));
    return doPar(arquivos)
        .filter((a) => !declarados.has(a))
        .map((a) => `${a} lê pela porta TOLERANTE e escreve documento de mapa, e não está classificado`);
}

/**
 * Os (G) que não CHAMAM guarda nenhuma, no formato de mensagem de erro.
 *
 * CHAMAR, e não apenas citar: a linha de `import` traz o símbolo para dentro do arquivo, então uma
 * conferência por `includes` fica verde com a guarda importada e nunca invocada. O ESLint desta
 * casa pega esse caso pelo `no-unused-vars` com `--max-warnings 0`, e é justamente por isso que o
 * censo não pode depender dele: ele é outro verificador, e um censo que só vale quando o vizinho
 * roda é um censo que não vale.
 */
function gestosSemGuarda(arquivos) {
    const presentes = new Set(doPar(arquivos));
    return CENSO
        .filter((e) => e.classe === GESTO && presentes.has(e.arquivo))
        .flatMap((e) => {
            const codigo = lerCodigo(e.arquivo);
            const faltando = (e.guardas || []).filter((g) => !chamaAlgum(codigo, [g]));
            return faltando.length
                ? [`${e.arquivo} é escrita de GESTO e não chama ${faltando.join(' nem ')}`]
                : [];
        });
}

describe('Censo: escrita de conteúdo não fabrica mapa', () => {
    it('piso: a varredura acha o par que já existe', () => {
        let arquivos;
        try {
            arquivos = arquivosDoInventario();
        } catch (err) {
            throw new Error(
                `o inventário deste censo vem de \`git ls-files\` e o comando FALHOU (${err.message}). `
                + 'Isto é falha de ambiente, não regressão de código: rode dentro do repositório.',
            );
        }
        // O store inteiro, e não só os três: um pathspec errado devolveria lista curta e o censo
        // ficaria verde sem ter varrido nada.
        expect(arquivos.length).toBeGreaterThanOrEqual(50);
        expect(arquivos).toContain('src/js/store/feature.operations.js');

        // OS CINCO ARQUIVOS MEDIDOS EM 2026-09-21, três no par do documento e dois no lateral. A
        // lista é ABSOLUTA: um sexto arquivo entrando em qualquer dos pares reprova aqui antes de
        // reprovar no caso de classificação, com a lista à vista.
        expect(doPar(arquivos).sort()).toEqual([
            'src/js/store/catalog.operations.js',
            'src/js/store/cesium3d.operations.js',
            'src/js/store/feature.operations.js',
            'src/js/store/map.operations.js',
            'src/js/store/streetview360.operations.js'
        ]);
    });

    it('o par LATERAL é alcançado pelos apelidos do 360, que não citam o export uma vez sequer', () => {
        // `streetview360.operations.js` renomeia os DOIS na entrada
        // (`const setStreetview360Data = setStreetview360Compat;`) e nunca mais escreve o nome
        // exportado. Sem seguir o apelido, o arquivo com mais escritas de gesto do 360 ficaria
        // invisível para o censo, que é a forma exata de cobertura vazia.
        const codigo = lerCodigo('src/js/store/streetview360.operations.js');
        expect(/\bsetStreetview360Compat\s*\(/.test(codigo), 'o apelido sumiu: reconfira a âncora').toBe(false);
        expect(nomesLocaisDe(codigo, 'setStreetview360Compat')).toContain('setStreetview360Data');
        expect(nomesLocaisDe(codigo, 'getStreetview360Compat')).toContain('getStreetview360Data');
        expect(leToleranteEEscreve('src/js/store/streetview360.operations.js')).toBe(true);
    });

    it('a varredura enxerga os APELIDOS, e não só o nome direto', () => {
        // `map.operations.js` não escreve `getMapDataCompat(` uma única vez: ele importa o símbolo e
        // o rebatiza em `const getMapData = getMapDataCompat;`. Um censo ancorado no nome solto o
        // perderia inteiro, e ele é justamente o arquivo com a guarda de forma DIFERENTE.
        const codigo = lerCodigo('src/js/store/map.operations.js');
        expect(/\bgetMapDataCompat\s*\(/.test(codigo), 'o apelido sumiu: reconfira a âncora').toBe(false);
        expect(nomesLocaisDe(codigo, 'getMapDataCompat')).toContain('getMapData');
        expect(nomesLocaisDe(codigo, 'updateMapDataCompat')).toContain('updateMapData');
        expect(leToleranteEEscreve('src/js/store/map.operations.js')).toBe(true);
    });

    it('todo arquivo do par está classificado, com motivo escrito', () => {
        const arquivos = arquivosDoInventario();

        expect(
            naoClassificados(arquivos),
            'arquivo novo que lê o documento do mapa pela porta TOLERANTE (`getMapDataCompat`) e o '
            + 'grava de volta. Classifique-o aqui: '
            + `'${GESTO}' (alguém apertou algo: tem de RECUSAR pela porta de `
            + `\`store/mapa-inexistente.js\`), '${DERIVADA}' (não há gesto a quem responder: tem de `
            + `PULAR EM SILÊNCIO) ou '${CRIACAO}' (é quem PODE criar o mapa), com motivo escrito.`,
        ).toEqual([]);

        const ruins = CENSO
            .filter((e) => !e.motivo || e.motivo.length < 60 || typeof e.arquivo !== 'string')
            .map((e) => String(e.arquivo));
        expect(ruins).toEqual([]);

        // Uma entrada por arquivo: duas classificações do mesmo arquivo é como um censo passa a
        // dizer duas coisas.
        const nomes = CENSO.map((e) => e.arquivo);
        expect(new Set(nomes).size).toBe(nomes.length);

        // E O INVERSO: entrada que sobreviveu ao código. Um censo verde apontando para o vazio é
        // dispensa que sobrevive ao beneficiário.
        const vivos = new Set(doPar(arquivos));
        expect(CENSO.filter((e) => !vivos.has(e.arquivo)).map((e) => e.arquivo)).toEqual([]);

        // Classe fora do vocabulário, e (G) sem guarda declarada.
        const classes = new Set([GESTO, DERIVADA, CRIACAO]);
        expect(CENSO.filter((e) => !classes.has(e.classe)).map((e) => e.arquivo)).toEqual([]);
        expect(
            CENSO.filter((e) => e.classe === GESTO && !(e.guardas?.length > 0)).map((e) => e.arquivo)
        ).toEqual([]);
    });

    it('toda guarda declarada pertence à lista FECHADA', () => {
        // Sem isto, um arquivo (G) novo poderia declarar `guardas: ['algumaCoisa']` e passar verde
        // citando uma palavra qualquer do próprio texto.
        const legitimas = new Set(Object.values(GUARDAS));
        const inventadas = CENSO.flatMap((e) => (e.guardas || []).filter((g) => !legitimas.has(g)));
        expect(inventadas, 'guarda fora da lista fechada de GUARDAS').toEqual([]);
    });

    it('todo classificado como GESTO cita a leitura estrita', () => {
        const arquivos = arquivosDoInventario();

        expect(
            gestosSemGuarda(arquivos),
            'este arquivo escreve por GESTO e não tem por onde saber que o mapa não existe. Leia por '
            + '`mapDocumentForGesture(mapa, operacao)` (`store/mapa-inexistente.js`) e volte quando '
            + 'ela devolver `null`: papel e trava continuam sendo perguntados ANTES, porque um gesto '
            + 'merece UMA recusa.',
        ).toEqual([]);
    });

    it('a varredura REPROVA um escritor novo sem guarda (provado com fixture)', () => {
        // AS MESMAS FUNÇÕES dos casos acima, apontadas para três fixtures. Sem esta prova a
        // varredura poderia não casar nada e reportar verde sem verificar coisa alguma.
        const dir = 'tests/fixtures/censo-mapa-fantasma';
        const abs = path.join(RAIZ, dir);
        mkdirSync(abs, { recursive: true });

        const semGuarda = `${dir}/escritor-sem-guarda.js`;
        const comApelido = `${dir}/escritor-por-apelido.js`;
        const soLeitura = `${dir}/leitor-puro.js`;
        const lateral = `${dir}/escritor-lateral.js`;

        writeFileSync(path.join(RAIZ, semGuarda), [
            `// Path: ${semGuarda}`,
            '// Temporário: criado e apagado pelo controle negativo deste censo.',
            "import { getMapDataCompat, updateMapDataCompat } from '../../src/js/store/repositories/index.js';",
            'export async function gravarNota(mapa, nota) {',
            '    const doc = await getMapDataCompat(mapa);',
            '    doc.nota = nota;',
            '    await updateMapDataCompat(mapa, doc);',
            '}',
            '',
        ].join('\n'));

        writeFileSync(path.join(RAIZ, comApelido), [
            `// Path: ${comApelido}`,
            '// Temporário: a MESMA escrita, escondida atrás de dois apelidos.',
            'import {',
            '    getMapDataCompat as lerMapa,',
            '    updateMapDataCompat,',
            "} from '../../src/js/store/repositories/index.js';",
            'const gravarMapa = updateMapDataCompat;',
            'export async function gravarOutraNota(mapa, nota) {',
            '    const doc = await lerMapa(mapa);',
            '    doc.nota = nota;',
            '    await gravarMapa(mapa, doc);',
            '}',
            '',
        ].join('\n'));

        writeFileSync(path.join(RAIZ, soLeitura), [
            `// Path: ${soLeitura}`,
            '// Temporário: leitura PURA, que fica de fora do par de propósito.',
            "import { getMapDataCompat } from '../../src/js/store/repositories/index.js';",
            'export async function contarFeicoes(mapa) {',
            '    const doc = await getMapDataCompat(mapa);',
            '    return Object.keys(doc.features || {}).length;',
            '}',
            '',
        ].join('\n'));

        writeFileSync(path.join(RAIZ, lateral), [
            `// Path: ${lateral}`,
            '// Temporário: o par LATERAL, que não toca o documento do mapa uma única vez.',
            'import {',
            '    getCesium3dCompat,',
            '    setCesium3dCompat,',
            "} from '../../src/js/store/repositories/index.js';",
            'export async function fixarMarcador(mapa, marcador) {',
            '    const dados = await getCesium3dCompat(mapa);',
            '    dados.markers.push(marcador);',
            '    await setCesium3dCompat(mapa, dados);',
            '}',
            '',
        ].join('\n'));

        try {
            const inventario = arquivosDoInventario(dir);
            expect(inventario.sort()).toEqual([comApelido, lateral, semGuarda, soLeitura].sort());

            // 1. os TRÊS escritores entram no censo, o apelidado e o LATERAL inclusive. O lateral é
            //    o caso que o par único não pegava: ele não cita `getMapDataCompat` nem
            //    `updateMapDataCompat` uma vez sequer.
            expect(doPar(inventario).sort()).toEqual([comApelido, lateral, semGuarda].sort());

            // 2. e a leitura PURA fica de fora, que é a discriminação que importa: um censo que
            //    acusasse todo leitor tolerante acusaria meia store e seria desligado.
            expect(doPar(inventario)).not.toContain(soLeitura);

            // 3. os três são acusados por falta de classificação;
            expect(naoClassificados(inventario)).toHaveLength(3);

            // 4. e um deles, se fosse classificado como GESTO, seria acusado por falta de guarda.
            const comoGesto = [{
                arquivo: semGuarda, classe: GESTO, guardas: [GUARDAS.PORTA_DE_GESTO],
                motivo: 'fixture'
            }];
            const faltando = comoGesto
                .filter((e) => !chamaAlgum(lerCodigo(e.arquivo), [e.guardas[0]]))
                .map((e) => e.arquivo);
            expect(faltando).toEqual([semGuarda]);

            // E SOBRE O CÓDIGO REAL as duas funções não acusam ninguém, que é o que separa "a regra
            // discrimina" de "a regra acusa tudo".
            const reais = arquivosDoInventario();
            expect(naoClassificados(reais)).toEqual([]);
            expect(gestosSemGuarda(reais)).toEqual([]);
        } finally {
            rmSync(abs, { recursive: true, force: true });
        }
    });

    it('a porta ESTRITA existe, e a TOLERANTE continua fabricando (o piso do mecanismo)', () => {
        // O censo mede FORMA, e forma sobre um mecanismo que não existe mais é cobertura vazia.
        // Estas duas linhas são o que ancora tudo acima no código real.
        const repositorio = lerCodigo('src/js/store/repositories/index.js');
        expect(repositorio).toMatch(/export async function getExistingMapData\(/);
        expect(repositorio).toMatch(/export async function getMapDataCompat\(/);
        expect(repositorio).toMatch(/getEmptyMapData\(\)/);

        const ajudante = lerCodigo('src/js/store/mapa-inexistente.js');
        expect(ajudante).toMatch(/export async function mapDocumentForGesture\(/);
        expect(ajudante).toMatch(/export async function mapDocumentForDerivedWrite\(/);
        expect(ajudante).toMatch(/export async function mapExistsForGesture\(/);
        // A recusa é `emit` + `return`, nunca `throw`: é a linha do meio da tabela de
        // `store/store-errors.js` (falha ESPERADA).
        expect(ajudante).toMatch(/emitStoreError\(StoreErrorEvents\.STORE_OPERATION_BLOCKED/);
        expect(ajudante).not.toMatch(/throw\s+new\s+Error/);

        // UM EMISSOR SÓ para as duas portas de gesto: duas cópias do payload é como uma delas
        // perde um campo (a frase é keyed por `reason`, o diagnóstico lê `operation`).
        expect(ajudante.match(/emitStoreError\(/g)).toHaveLength(1);
    });

    it('a pergunta de existência é feita DENTRO da transação, antes da leitura do lateral', () => {
        // A FORMA, e ela não é estética. Este caso nasceu exigindo o CONTRÁRIO (a pergunta ANTES de
        // `withSideDocument`, para poupar à recusa a trava e a transação), e o mesmo dia mostrou o
        // preço: uma leitura de disco FORA da transação fica fora do carimbo de escopo, então uma
        // troca de atlas durante ela passa despercebida e a escrita pode cair no OUTRO atlas. A guarda
        // irmã dos ajustes de mapa foi pega por `tests/integration/map-settings-write-ahead.test.js`
        // ("troca de escopo durante a leitura"); os dois funis tinham a mesma forma e nenhum teste
        // olhando para aquela leitura, porque o gancho deles está na leitura do LATERAL.
        for (const [arquivo, funil, leitura] of [
            ['src/js/store/cesium3d.operations.js', 'editCesium3d', 'getCesium3dDataWithCache(targetMap)'],
            ['src/js/store/streetview360.operations.js', 'editStreetview360', 'getStreetview360Data(targetMap)']
        ]) {
            const codigo = lerCodigo(arquivo);
            const inicio = codigo.indexOf(`async function ${funil}(`);
            expect(inicio, `${funil} saiu de ${arquivo}: reconfira o inventário`).toBeGreaterThan(-1);
            const corpo = codigo.slice(inicio, inicio + 1200);

            const guarda = corpo.indexOf('mapExistsForGesture');
            const transacao = corpo.indexOf('runTransaction(');
            const lateral = corpo.indexOf(leitura);
            expect(guarda, `${funil} não pergunta pela existência do mapa`).toBeGreaterThan(-1);
            expect(transacao, `${funil} não abre mais transação`).toBeGreaterThan(-1);
            expect(lateral, `${funil} não lê mais o lateral por ${leitura}`).toBeGreaterThan(-1);
            expect(guarda, `${funil} pergunta FORA da transação`).toBeGreaterThan(transacao);
            expect(guarda, `${funil} lê o lateral antes de saber se o mapa existe`).toBeLessThan(lateral);
        }
    });
});
