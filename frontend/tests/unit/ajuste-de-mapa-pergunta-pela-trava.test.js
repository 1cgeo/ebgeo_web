// Path: tests/unit/ajuste-de-mapa-pergunta-pela-trava.test.js
//
// O CENSO DO AJUSTE DO PRÓPRIO MAPA, e por que ele é o único ponto de imposição que existe.
//
// ================= A ASSIMETRIA QUE ELE EXISTE PARA COBRIR ===================
//
// O servidor impõe `maps.locked` a UMA lista, e ela não é a que a intuição sugere:
// `LOCKABLE_CHILD_TARGETS` (`backend/src/modules/sync/sync.service.js`) são os alvos FILHOS
// do mapa (feature, group, layer, cesium3d, streetview360, catalog_layer, group_feature).
// As operações que ajustam o PRÓPRIO mapa (posição salva, camada base, notas, grade, config
// temporal) viajam com o MAPA como alvo, então `lockedMapDenialReason` devolve `null` para
// todas elas e a escrita é APLICADA num mapa travado.
//
// O dono decidiu em 2026-09-21 NÃO fechar isso no servidor e tratar esses ajustes como
// convenção de CLIENTE, como já são as travas de camada, de grupo e de feição (colunas que o
// servidor persiste e nunca consulta). A consequência é direta: para a convenção valer, TODO
// caminho de escrita de ajuste de mapa no cliente tem de perguntar pela trava, e um caminho
// novo que esqueça a pergunta não encontra nenhuma segunda barreira depois dele.
//
// ================= O QUE ESTE ARQUIVO PROÍBE =================================
//
// Duas coisas mecânicas, sobre o código que REGISTRA a intenção:
//
//   1. um arquivo que registre uma intenção de AJUSTE DE MAPA sem citar o gate de PAPEL
//      (`checkPermission(GuardAction.`) e o gate de TRAVA (`isTargetMapLocked`/`isMapLocked`);
//   2. um desses arquivos que chame `isCurrentMapLockedSync(`. Essa é a FORMA EXATA do
//      defeito que o ponto N3 corrigiu: ela lê `memoryStore.lockedMaps`, responde sobre o
//      mapa CORRENTE e descarta o `mapName` que a função recebeu; e em atlas LOCAL aquele
//      conjunto só chega a conter o mapa corrente, então ela responde "destravado" para um
//      mapa travado, calada (ver `.claude/rules/architecture.md`, "A TRAVA DE OUTRO MAPA").
//
// Mais uma de INVENTÁRIO: todo valor de `EntityType` (`src/js/store/sync/operation-types.js`)
// precisa estar classificado aqui. Um sub-tipo de mapa NOVO nasce vermelho até alguém dizer
// em qual classe ele cai e por quê, que é o ponto do censo.
//
// ================= O ALCANCE, E O QUE ELE NÃO PROVA ==========================
//
// EXISTÊNCIA e FORMA, por ARQUIVO, nunca comportamento. Um arquivo que cite `isMapLocked`
// numa função e o esqueça na irmã passa aqui: quem mede isso é o repro de comportamento,
// `tests/store/ajuste-de-mapa-em-mapa-travado.repro.test.js`, que trava o mapa NO DISCO com
// o conjunto em memória vazio e exige a recusa de cada operação. Os dois juntos são a
// cobertura; nenhum dos dois sozinho é.
//
// O inventário vem do VERSIONAMENTO (`git ls-files --cached --others --exclude-standard`), e
// as duas bandeiras não são detalhe: sem `--others` o arquivo escrito há cinco minutos, que é
// justamente o que ninguém classificou, fica fora da varredura.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EntityType } from '../../src/js/store/sync/operation-types.js';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));

// ============================================================================
// AS CLASSES
// ============================================================================

/** Ajuste do PRÓPRIO mapa: alvo `map` com sub-tipo. O servidor NÃO impõe a trava. */
const AJUSTE_DE_MAPA = 'ajuste-do-proprio-mapa';
/** A entidade mapa em si (criar, renomear, excluir, travar): regra própria. */
const O_MAPA = 'a-entidade-mapa';
/** Alvo FILHO do mapa: o servidor recusa por trava (`LOCKABLE_CHILD_TARGETS`). */
const FILHO_DO_MAPA = 'filho-do-mapa-imposto-pelo-servidor';
/** Não pertence a um mapa: atlas, briefing, comentário, setting. */
const FORA_DO_MAPA = 'fora-do-mapa';

/**
 * @typedef {Object} Entrada
 * @property {string} valor - O valor do `EntityType`, como o módulo o escreve.
 * @property {string} classe
 * @property {string[]} [produtores] - Arquivos que registram a intenção, relativos a
 *   `frontend/`. Obrigatório (e conferido) na classe `AJUSTE_DE_MAPA`.
 * @property {string} motivo
 */

/** @type {Entrada[]} */
const CENSO = [
    // ============ ajuste do próprio mapa: os CINCO sub-tipos ================
    {
        valor: EntityType.MAP_POSITION, classe: AJUSTE_DE_MAPA,
        produtores: ['src/js/store/map.operations.js'],
        motivo: 'A posição salva do mapa, escrita por `updateMapPosition` (gesto "salvar posição") '
            + 'e limpa por `clearMapPosition`, as duas em `map.operations.js`. Sobe como `map` com '
            + 'sub-tipo `position`, então o servidor a aplica num mapa travado. As duas perguntam '
            + 'por `isTargetMapLocked`, que lê o app setting do disco.',
    },
    {
        valor: EntityType.BASE_LAYER, classe: AJUSTE_DE_MAPA,
        produtores: ['src/js/store/map.operations.js'],
        motivo: 'A camada base SALVA com a vista do mapa (`setBaseLayer`). Trocar de base na tela '
            + 'não grava nada: quem chama esta op é o gesto de salvar a vista '
            + '(`saveMapView`/`clearMapView`, `map-view.operations.js`), que já recusa pela trava '
            + 'antes, e esta pergunta é a porta fechada para o chamador seguinte.',
    },
    {
        valor: EntityType.MAP_NOTES, classe: AJUSTE_DE_MAPA,
        produtores: ['src/js/store/settings.operations.js', 'src/js/store/map.operations.js'],
        motivo: 'As notas do mapa (`maps.notes_title`/`notes_description`). DOIS produtores: '
            + '`setMapNotes` (`settings.operations.js`) e a criação de mapa com notas dentro de '
            + '`addMap` (`map.operations.js`), que não pergunta pela trava porque o mapa dela '
            + 'acabou de nascer e não há `mapLocked_<nome>` para achar. Até 2026-09-21 '
            + '`setMapNotes` perguntava `isCurrentMapLockedSync()` e descartava o `mapName` que '
            + 'recebe: escrever as notas de outro mapa consultava a trava de um terceiro.',
    },
    {
        valor: EntityType.GRID_STYLE, classe: AJUSTE_DE_MAPA,
        produtores: ['src/js/store/settings.operations.js'],
        motivo: 'O estilo da quadrícula (`maps.grid_style`), escrito por `setGridStyle`. Mesmo '
            + 'defeito e mesma correção de `setMapNotes`, em 2026-09-21. O painel de grade '
            + '(`grid/grid.control.js`) desenha a mudança antes de gravar, então a recusa precisa '
            + 'FALAR: ela emite `STORE_OPERATION_BLOCKED` com `map_locked`, e o listener global '
            + 'tem a frase.',
    },
    {
        valor: EntityType.MAP_TEMPORAL, classe: AJUSTE_DE_MAPA,
        produtores: ['src/js/store/temporal.operations.js'],
        motivo: 'A config temporal por mapa (janela, unidade, lente, e o `ativo` SALVO). '
            + '`writeMapTemporalConfig` é o molde deste bloco: papel primeiro, trava pelo disco '
            + 'depois, recusa que emite e não estoura. Ganhou a pergunta da trava em 2026-09-21 '
            + '(achado C2 da auditoria temporal), que é o que revelou a classe inteira.',
    },

    // ============ a entidade mapa: regra própria ============================
    {
        valor: EntityType.MAP, classe: O_MAPA,
        motivo: 'Criar (`addMap`), excluir (`removeMap`), renomear (`renameMap`) e TRAVAR '
            + '(`toggleMapLock`), todas em `map.operations.js`. A troca da trava não pode '
            + 'perguntar pela trava, senão um mapa travado nunca mais se destrava; criar age '
            + 'sobre um mapa que ainda não existe; e excluir e renomear têm regra própria, '
            + 'espelhada no menu por mapa (`sidebar/tabs/map-menu-actions.js`), que desenha os '
            + 'dois comandos e recusa o clique nomeando a trava. O gate de `renameMap` pergunta ao disco desde 2026-09-21.',
    },

    // ============ filhos do mapa: o servidor impõe ==========================
    ...[
        [EntityType.FEATURE, 'A feição. `features` está em `LOCKABLE_CHILD_TARGETS`, e o cliente '
            + 'gateia por `guardWrite` (`feature.operations.js`).'],
        [EntityType.LAYER, 'A camada. Alvo lockable no servidor; `layers.locked` em si é convenção '
            + 'de cliente, mas a TRAVA DO MAPA sobre ela é imposta.'],
        [EntityType.GROUP, 'O grupo de feições, alvo lockable no servidor: uma escrita nele num '
            + 'mapa travado volta recusada, ao contrário dos cinco ajustes acima.'],
        [EntityType.GROUP_FEATURE, 'A membresia de grupo, um par grupo/feição. Alvo lockable, e o '
            + 'servidor pergunta pelo mapa do grupo E pelo da feição.'],
        [EntityType.MARKER_3D, 'Marcador 3D: alvo `cesium3d`, lockable no servidor, então a trava '
            + 'do mapa é imposta dos dois lados.'],
        [EntityType.MEASUREMENT_3D, 'Medição 3D: alvo `cesium3d`, lockable no servidor, como o '
            + 'marcador 3D ao lado.'],
        [EntityType.VIEWSHED_3D, 'Viewshed 3D: alvo `cesium3d`, lockable no servidor, como os dois '
            + 'acima. É conteúdo do mapa, não ajuste dele.'],
        [EntityType.CAMERA_POSITION_3D, 'Posição de câmera 3D: alvo `cesium3d`, lockable no '
            + 'servidor. Repare que ela é do MAPA no nome e não no alvo: o servidor a guarda na '
            + 'tabela de dados do Cesium, e por isso ela É imposta, ao contrário de `mapPosition`.'],
        [EntityType.ORIENTATION_360, 'Orientação do 360: alvo `streetview360`, lockable no '
            + 'servidor. É dado do mapa, e não uma coluna de ajuste da linha do mapa.'],
        [EntityType.MARKER_360, 'Marcador 360: alvo `streetview360`, lockable no servidor, pela '
            + 'mesma razão da orientação ao lado.'],
        [EntityType.CATALOG_LAYER, 'A camada de catálogo ligada num mapa: alvo `catalog_layer`, '
            + 'lockable no servidor desde que virou entidade própria. O cliente gateia em '
            + '`guardCatalogWrite` (`catalog.operations.js`).'],
    ].map(([valor, motivo]) => ({ valor, classe: FILHO_DO_MAPA, motivo })),

    // ============ fora do mapa ==============================================
    ...[
        [EntityType.ATLAS, 'O atlas inteiro (nome, visibilidade, ordem dos mapas). Não pertence a '
            + 'mapa nenhum, então não há trava de mapa a perguntar.'],
        [EntityType.BRIEFING, 'O briefing do atlas. Fora da lista lockable do servidor, por '
            + 'desenho: ele não é conteúdo de um mapa.'],
        [EntityType.SLIDE, 'O slide do briefing, pela mesma razão do briefing: ele é do ATLAS, e '
            + 'referencia mapas sem pertencer a nenhum.'],
        [EntityType.COMMENT, 'O comentário espacial. Fora da lista lockable de propósito: comentar '
            + 'é o que um mapa travado continua aceitando, e o degrau `comment` existe para isso.'],
        [EntityType.SETTING, 'Chave de `atlas.settings` (ordem dos mapas, cores dos cartões). É do '
            + 'ATLAS, não de um mapa, e o gate dela é `UPDATE_ATLAS_SETTINGS`.'],
    ].map(([valor, motivo]) => ({ valor, classe: FORA_DO_MAPA, motivo })),
];

/** O gate de PAPEL, citado pelo nome da porta e não pela capacidade. */
const GATE_DE_PAPEL = 'checkPermission(GuardAction.';

/**
 * OS DOIS NOMES LEGÍTIMOS DA PERGUNTA DA TRAVA. `isTargetMapLocked` (`map.operations.js`) é a
 * forma completa: disco MAIS a sobreposição de briefing, que só existe em memória.
 * `isMapLocked` é a leitura crua do app setting, e é o que `temporal.operations.js` usa.
 */
const GATES_DE_TRAVA = ['isTargetMapLocked', 'isMapLocked'];

/**
 * A FORMA PROIBIDA, e ela é proibida só nos produtores de ajuste de mapa: nos gates de FEIÇÃO
 * e de CATÁLOGO a mesma função é a resposta certa, porque ali o alvo é sempre o mapa corrente
 * ou a pergunta é repetida pelo servidor.
 */
const FORMA_PROIBIDA = /isCurrentMapLockedSync\s*\(/;

// ============================================================================
// A VARREDURA
// ============================================================================

/**
 * Remove comentário de bloco e de linha, preservando a contagem de linhas.
 *
 * A NORMALIZAÇÃO DE CRLF NÃO É COSMÉTICA: os arquivos deste repositório terminam em `\r\n`, e
 * em regex de JavaScript `\r` é TERMINADOR DE LINHA, então `.` não o casa. Sem ela a remoção
 * rodaria devolvendo o texto intacto, sem erro, e o censo cobraria prosa.
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
function arquivosDoInventario(pathspec = 'src/js') {
    return execFileSync(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard', pathspec],
        { cwd: RAIZ, encoding: 'utf8' },
    ).split('\n').map((s) => s.trim()).filter((s) => s.endsWith('.js'));
}

/** O nome da CONSTANTE do enum, por valor: `'mapNotes'` -> `'MAP_NOTES'`. */
const NOME_DA_CONSTANTE = new Map(Object.entries(EntityType).map(([k, v]) => [v, k]));

/** Os valores classificados como ajuste do próprio mapa. */
const VALORES_DE_AJUSTE = CENSO.filter((e) => e.classe === AJUSTE_DE_MAPA).map((e) => e.valor);

/** As CONSTANTES correspondentes, que é o que o código escreve. */
const CONSTANTES_DE_AJUSTE = new Set(VALORES_DE_AJUSTE.map((v) => NOME_DA_CONSTANTE.get(v)));

/** Toda citação de `recordOperation(EntityType.X`, por arquivo e linha. */
const CITACAO = /recordOperation\(\s*EntityType\.([A-Z_0-9]+)/g;

/**
 * Onde nasce cada intenção de AJUSTE DE MAPA.
 * @param {string[]} arquivos
 * @returns {Array<{arquivo: string, n: number, constante: string, texto: string}>}
 */
function sitiosDeAjuste(arquivos) {
    const achados = [];
    for (const arquivo of arquivos) {
        lerCodigo(arquivo).split('\n').forEach((linha, i) => {
            for (const m of linha.matchAll(CITACAO)) {
                if (!CONSTANTES_DE_AJUSTE.has(m[1])) continue;
                achados.push({ arquivo, n: i + 1, constante: m[1], texto: linha.trim() });
            }
        });
    }
    return achados;
}

/** Os produtores que não citam os dois gates, no formato de mensagem de erro. */
function semOsDoisGates(achados) {
    const arquivos = [...new Set(achados.map((a) => a.arquivo))];
    return arquivos.flatMap((arquivo) => {
        const codigo = lerCodigo(arquivo);
        const faltas = [];
        if (!codigo.includes(GATE_DE_PAPEL)) faltas.push('o gate de PAPEL (`checkPermission(GuardAction.X)`)');
        if (!GATES_DE_TRAVA.some((g) => codigo.includes(g))) {
            faltas.push('o gate de TRAVA (`isTargetMapLocked` ou `isMapLocked`)');
        }
        return faltas.length ? [`${arquivo} registra ajuste de mapa e não cita ${faltas.join(' nem ')}`] : [];
    });
}

/** Os produtores que usam a forma proibida, no formato de mensagem de erro. */
function comFormaProibida(achados) {
    return [...new Set(achados.map((a) => a.arquivo))].flatMap((arquivo) => lerCodigo(arquivo)
        .split('\n')
        .map((linha, i) => ({ linha, n: i + 1 }))
        .filter(({ linha }) => FORMA_PROIBIDA.test(linha) && !/function isCurrentMapLockedSync/.test(linha))
        .map(({ linha, n }) => `${arquivo}:${n} ${linha.trim()}`));
}

/** Os produtores fora do censo, no formato de mensagem de erro. */
function produtoresNaoDeclarados(achados) {
    const declarados = new Set(CENSO.filter((e) => e.classe === AJUSTE_DE_MAPA)
        .flatMap((e) => (e.produtores || []).map((p) => `${e.valor}\t${p}`)));
    return achados
        .filter((a) => !declarados.has(`${EntityType[a.constante]}\t${a.arquivo}`))
        .map((a) => `${a.arquivo}:${a.n} registra ${a.constante} e não está declarado no censo`);
}

describe('Censo do ajuste do próprio mapa', () => {
    it('piso: a varredura acha os produtores que já existem', () => {
        let arquivos;
        try {
            arquivos = arquivosDoInventario();
        } catch (err) {
            throw new Error(
                `o inventário deste censo vem de \`git ls-files\` e o comando FALHOU (${err.message}). `
                + 'Isto é falha de ambiente, não regressão de código: rode dentro do repositório.',
            );
        }
        expect(arquivos.length).toBeGreaterThanOrEqual(300);

        const achados = sitiosDeAjuste(arquivos);
        // A contagem MEDIDA em 2026-09-21: `mapPosition` x2 (salvar e limpar), `baseLayer`,
        // `mapNotes` x2 (a op e a criação de mapa com notas), `gridStyle`, `mapTemporal`.
        expect(achados.length).toBeGreaterThanOrEqual(7);
        expect([...new Set(achados.map((a) => a.arquivo))].sort()).toEqual([
            'src/js/store/map.operations.js',
            'src/js/store/settings.operations.js',
            'src/js/store/temporal.operations.js',
        ]);

        // E OS CINCO SUB-TIPOS TÊM PRODUTOR VIVO. Sem isto, um sub-tipo cujo escritor sumisse
        // continuaria classificado aqui e o censo ficaria verde apontando para nada.
        const vistos = new Set(achados.map((a) => EntityType[a.constante]));
        expect([...vistos].sort()).toEqual([...VALORES_DE_AJUSTE].sort());
    });

    it('todo valor de EntityType está classificado, com motivo escrito', () => {
        const classificados = new Set(CENSO.map((e) => e.valor));
        const fora = Object.entries(EntityType)
            .filter(([, v]) => !classificados.has(v))
            .map(([k, v]) => `${k} ('${v}')`);

        expect(
            fora,
            'tipo de entidade de sync fora do censo. Classifique-o em '
            + `'${AJUSTE_DE_MAPA}' (ajusta o PRÓPRIO mapa: o servidor NÃO impõe a trava, então o `
            + 'cliente é o único ponto de imposição e o produtor tem de perguntar), '
            + `'${O_MAPA}', '${FILHO_DO_MAPA}' (o servidor recusa por trava) ou `
            + `'${FORA_DO_MAPA}', com motivo escrito.`,
        ).toEqual([]);

        const ruins = CENSO
            .filter((e) => !e.motivo || e.motivo.length < 60 || typeof e.valor !== 'string')
            .map((e) => String(e.valor));
        expect(ruins).toEqual([]);

        // Uma entrada por valor: duas classificações do mesmo tipo é como um censo passa a
        // dizer duas coisas.
        const valores = CENSO.map((e) => e.valor);
        expect(new Set(valores).size).toBe(valores.length);

        // E o censo não classifica o que o enum não tem: entrada morta é dispensa que
        // sobrevive ao beneficiário.
        const doEnum = new Set(Object.values(EntityType));
        expect(CENSO.filter((e) => !doEnum.has(e.valor)).map((e) => e.valor)).toEqual([]);
    });

    it('todo produtor de ajuste de mapa cita o gate de PAPEL e o de TRAVA', () => {
        const achados = sitiosDeAjuste(arquivosDoInventario());
        expect(achados.length).toBeGreaterThanOrEqual(7);

        expect(
            semOsDoisGates(achados),
            'quem escreve ajuste do PRÓPRIO mapa é o único ponto de imposição que existe: o '
            + 'servidor só recusa por trava os alvos FILHOS do mapa (`LOCKABLE_CHILD_TARGETS`). '
            + 'Pergunte por `checkPermission(GuardAction.UPDATE_MAP)` e depois por '
            + '`isTargetMapLocked(mapaAlvo)`, no molde de `writeMapTemporalConfig`.',
        ).toEqual([]);
    });

    it('NENHUM produtor de ajuste de mapa pergunta pelo conjunto em memória', () => {
        const achados = sitiosDeAjuste(arquivosDoInventario());

        expect(
            comFormaProibida(achados),
            '`isCurrentMapLockedSync()` num escritor de ajuste de mapa: ela lê '
            + '`memoryStore.lockedMaps`, responde sobre o mapa CORRENTE e descarta o `mapName` '
            + 'recebido; em atlas LOCAL aquele conjunto só chega a conter o mapa corrente, então '
            + 'ela responde "destravado" para um mapa travado, calada. Use `isTargetMapLocked`.',
        ).toEqual([]);
    });

    it('todo produtor está declarado no censo, por sub-tipo', () => {
        const achados = sitiosDeAjuste(arquivosDoInventario());

        expect(
            produtoresNaoDeclarados(achados),
            'arquivo novo registrando ajuste de mapa sem entrada no censo',
        ).toEqual([]);

        // E O INVERSO: produtor declarado que não existe mais. Uma entrada que sobrevive ao
        // código é como um censo fica verde apontando para o vazio.
        const vistos = new Set(achados.map((a) => `${EntityType[a.constante]}\t${a.arquivo}`));
        const mortos = CENSO.filter((e) => e.classe === AJUSTE_DE_MAPA)
            .flatMap((e) => (e.produtores || []).map((p) => `${e.valor}\t${p}`))
            .filter((k) => !vistos.has(k));
        expect(mortos, 'produtor declarado no censo e ausente do código').toEqual([]);

        // A classe AJUSTE_DE_MAPA é a única que exige produtor declarado, e ela exige mesmo.
        const semProdutor = CENSO
            .filter((e) => e.classe === AJUSTE_DE_MAPA && !(e.produtores?.length > 0))
            .map((e) => e.valor);
        expect(semProdutor).toEqual([]);
    });

    it('quem ANUNCIA sucesso de um ajuste de mapa leu a resposta da store', () => {
        // A OUTRA METADE DO PONTO N3, do lado da TELA. As duas operações de
        // `settings.operations.js` devolviam `undefined` na recusa E no sucesso, então o editor
        // de notas (`sidebar/panels/notes-panel.js`) fechava o modo de edição e dizia "Notas
        // salvas com sucesso!" para todo Leitor que clicasse em Salvar, e para quem tivesse o
        // mapa travado por um par com o editor já aberto. As duas passaram a devolver booleano.
        //
        // A REGRA É ESTREITA DE PROPÓSITO, e a fronteira é ANUNCIAR. Um chamador que só redesenha
        // (o painel de grade, `grid/grid.control.js`) não é acusado: ele não afirma nada, e a
        // recusa da store já fala sozinha pelo listener global. Quem diz "salvo" com palavras é
        // que precisa ter lido a resposta, senão a frase é falsa metade das vezes.
        const escritores = /\bset(MapNotes|GridStyle)\s*\(/;
        const descarta = /^\s*await set(MapNotes|GridStyle)\s*\(/;
        const anuncia = /\bshow(Success|Toast)\s*\(/;

        const acusados = arquivosDoInventario()
            .filter((a) => !a.startsWith('src/js/store/'))
            .flatMap((arquivo) => {
                const codigo = lerCodigo(arquivo);
                if (!escritores.test(codigo) || !anuncia.test(codigo)) return [];
                return codigo.split('\n')
                    .map((linha, i) => ({ linha, n: i + 1 }))
                    .filter(({ linha }) => descarta.test(linha))
                    .map(({ linha, n }) => `${arquivo}:${n} ${linha.trim()}`);
            });

        expect(
            acusados,
            'esta tela anuncia sucesso e DESCARTA o retorno de `setMapNotes`/`setGridStyle`, que '
            + 'devolvem `false` quando a escrita é recusada por papel ou por mapa travado. Leia a '
            + 'resposta antes de dizer que salvou; o motivo da recusa já é anunciado pelo listener '
            + 'global de `STORE_OPERATION_BLOCKED`.',
        ).toEqual([]);

        // DISCRIMINAÇÃO: a regra precisa ACHAR o arquivo que ela vigia, senão ela é cobertura
        // vazia. O editor de notas chama e anuncia, e a leitura do retorno está lá.
        const notas = lerCodigo('src/js/sidebar/panels/notes-panel.js');
        expect(escritores.test(notas) && anuncia.test(notas)).toBe(true);
        expect(/=\s*await setMapNotes\s*\(/.test(notas)).toBe(true);
    });

    it('`renameMap` pergunta pela trava AO DISCO (o buraco declarado do N3, fechado)', () => {
        // Este caso nasceu como BURACO DECLARADO: `renameMap` recusava lendo só
        // `memoryStore.lockedMaps.has(oldName)`, o mesmo defeito das duas que o ponto N3 corrigiu,
        // e ficou preso aqui para não sumir do radar, porque a op dele é `map` (não um sub-tipo) e
        // cai fora da varredura mecânica acima. Fechado em 2026-09-21: o gate soma a pergunta ao
        // disco. O comportamento está preso em
        // `tests/store/ajuste-de-mapa-em-mapa-travado.repro.test.js`; aqui fica a forma.
        const codigo = lerCodigo('src/js/store/map.operations.js');
        const inicio = codigo.indexOf('export async function renameMap(');
        expect(inicio, 'renameMap saiu de map.operations.js: reconfira o inventário').toBeGreaterThan(-1);
        const corpo = codigo.slice(inicio, inicio + 2500);
        expect(corpo, 'renameMap deixou de perguntar pela trava ao disco').toMatch(/await isMapLocked\(oldName\)/);
        // A sobreposição de briefing fica DE FORA de propósito: ela trancaria o rename durante a
        // edição de briefing, que é outra decisão.
        expect(corpo).not.toMatch(/isTargetMapLocked\(oldName\)/);
    });

    it('a varredura REPROVA um produtor novo sem gate (provado com fixture)', () => {
        // AS MESMAS FUNÇÕES dos casos acima, apontadas para duas fixtures: uma que registra um
        // ajuste de mapa SEM gate nenhum e outra que o faz com a forma proibida. Sem esta prova
        // a varredura poderia não casar nada e reportar verde sem verificar coisa alguma.
        const dir = 'tests/fixtures/censo-ajuste-de-mapa';
        const abs = path.join(RAIZ, dir);
        mkdirSync(abs, { recursive: true });

        const semGate = `${dir}/produtor-sem-gate.js`;
        const comFormaVelha = `${dir}/produtor-com-forma-velha.js`;
        writeFileSync(path.join(RAIZ, semGate), [
            `// Path: ${semGate}`,
            '// Temporário: criado e apagado pelo controle negativo deste censo.',
            'export async function gravarGrade(tx, mapId, estilo) {',
            '    tx.recordOperation(EntityType.GRID_STYLE, OperationType.UPDATE, mapId, mapId, estilo, null);',
            '}',
            '',
        ].join('\n'));
        writeFileSync(path.join(RAIZ, comFormaVelha), [
            `// Path: ${comFormaVelha}`,
            '// Temporário: criado e apagado pelo controle negativo deste censo.',
            'export async function gravarNotas(tx, mapId, notas) {',
            '    if (!checkPermission(GuardAction.UPDATE_MAP).allowed) return;',
            '    if (isCurrentMapLockedSync()) return;',
            '    if (await isMapLocked(mapId)) return;',
            '    tx.recordOperation(EntityType.MAP_NOTES, OperationType.UPDATE, mapId, mapId, notas, null);',
            '}',
            '',
        ].join('\n'));

        try {
            const inventario = arquivosDoInventario(dir);
            expect(inventario.sort()).toEqual([comFormaVelha, semGate].sort());

            const achados = sitiosDeAjuste(inventario);
            expect(achados).toHaveLength(2);

            // 1. o sem gate nenhum é acusado pelas DUAS faltas, numa mensagem só;
            const faltas = semOsDoisGates(achados);
            expect(faltas).toHaveLength(1);
            expect(faltas[0]).toContain('produtor-sem-gate.js');
            expect(faltas[0]).toContain('PAPEL');
            expect(faltas[0]).toContain('TRAVA');

            // 2. o segundo cita os dois gates e MESMO ASSIM é acusado pela forma proibida.
            //    É a discriminação que importa: citar `isMapLocked` não absolve quem também
            //    pergunta ao conjunto em memória.
            const proibidas = comFormaProibida(achados);
            expect(proibidas).toHaveLength(1);
            expect(proibidas[0]).toContain('produtor-com-forma-velha.js');

            // 3. e os dois são produtores não declarados.
            expect(produtoresNaoDeclarados(achados)).toHaveLength(2);

            // E SOBRE O CÓDIGO REAL as três funções não acusam ninguém, que é o que separa
            // "a regra discrimina" de "a regra acusa tudo".
            const reais = sitiosDeAjuste(arquivosDoInventario());
            expect(semOsDoisGates(reais)).toEqual([]);
            expect(comFormaProibida(reais)).toEqual([]);
            expect(produtoresNaoDeclarados(reais)).toEqual([]);
        } finally {
            rmSync(abs, { recursive: true, force: true });
        }
    });
});
