// Path: tests/unit/convergence-guarded-decisao-por-tipo.test.js
//
// Cada um dos 21 `EntityType` tem uma DECISÃO ESCRITA sobre entrar ou não em
// `CONVERGENCE_GUARDED`.
//
// A classe, e o preço que ela já cobrou aqui: `CONVERGENCE_GUARDED`
// (`frontend/src/js/store/sync/remote-operation-handler.js`) reúne os tipos cujo
// update substitui o objeto inteiro e que por isso precisam de last-write-wins por
// `serverVersion`. O `briefing` ficou de fora até 2026-07-25 e, como o inbound grava
// o briefing INTEIRO com o array de slides, dois usuários editando slides do mesmo
// briefing não tinham proteção nenhuma: o último a chegar apagava o trabalho do
// outro, sem erro em lugar nenhum. Ficar de fora não gera exceção, não gera log,
// não gera teste vermelho. Gera divergência entre pares.
//
// O Set governa as DUAS metades do guarda (o defer de edição local pendente, gateado
// no despachante pelo MESMO Set, e a checagem de versão no handler), então uma
// omissão desliga as duas de uma vez.
//
// O QUE ESTE TESTE FAZ: converte omissão silenciosa em afirmação escrita. Toda
// entrada do enum tem de estar em UMA das três tabelas congeladas abaixo, com motivo.
//
// O QUE O VERDE NÃO PROVA, e é importante: que a decisão esteja CERTA. Este arquivo
// não adjudica nada. Ele só torna impossível que um tipo novo apareça sem que alguém
// tenha escrito de que lado ele está e por quê, e torna impossível fechar uma das
// lacunas conhecidas em silêncio.
//
// DUAS ARMADILHAS DE FORMA, ambas fechadas aqui:
//   - O Set NÃO é reexportado por `frontend/src/js/store/sync/index.js`. Importar
//     pelo barrel devolve `undefined`, e `undefined.has` nunca seria chamado porque
//     as asserções seriam feitas sobre conjuntos vazios: TODAS passariam em vazio.
//     Por isso o import é DIRETO do arquivo e o primeiro caso assere que o que
//     chegou é um Set povoado.
//   - Aqui não existe ramo padrão que absorva o tipo esquecido. Um tipo fora das três
//     tabelas não produz nada; é só ausência. Daí a asserção de cobertura do universo.

import { describe, it, expect } from 'vitest';
import { CONVERGENCE_GUARDED } from '../../src/js/store/sync/remote-operation-handler.js';
import { EntityType } from '../../src/js/store/sync/operation-types.js';

/**
 * Tipos que PRECISAM do guarda de convergência, com o motivo medido: a escrita
 * inbound que substitui o objeto em bloco.
 */
const DENTRO = new Map([
    [EntityType.FEATURE,
        '`applyRemoteFeatureOpLocked` faz `features[index] = data` no UPDATE: a feição do par'
        + ' é trocada pelo objeto inteiro que chegou, geometria, estilo e propriedades juntos.'],
    [EntityType.LAYER,
        '`applyRemoteLayerOp` reaplica o CREATE substituindo a camada por id, e a ordem entre'
        + ' create/update/delete da MESMA camada decide o resultado final no par.'],
    [EntityType.GROUP,
        '`applyRemoteGroupOp` faz `groups[groupId] = data`: o grupo inteiro, com a lista de'
        + ' membros, é trocado pelo que chegou.'],
    [EntityType.MARKER_3D,
        '`applyRemoteCesium3dEntityOp` faz `c3d.markers[idx] = data`: item inteiro por id.'],
    [EntityType.MEASUREMENT_3D,
        '`applyRemoteCesium3dEntityOp` faz `c3d.measurements[idx] = data`: item inteiro por id.'],
    [EntityType.VIEWSHED_3D,
        '`applyRemoteCesium3dEntityOp` faz `c3d.viewsheds[idx] = data`: item inteiro por id.'],
    [EntityType.CAMERA_POSITION_3D,
        '`applyRemoteCameraOp` faz `c3d.cameraPositions[data.tilesetId] = data`: a câmera salva'
        + ' daquele tileset é trocada inteira.'],
    [EntityType.ORIENTATION_360,
        '`applyRemoteOrientation360Op` faz `sv.orientations[data.photoName] = data`: a'
        + ' orientação daquela foto é trocada inteira.'],
    [EntityType.MARKER_360,
        '`applyRemoteMarker360Op` faz `sv.markers[idx] = data`: item inteiro por id.'],
    [EntityType.BRIEFING,
        'entrou em 2026-07-25, e a ausência custou trabalho real: `applyRemoteBriefingOp` faz'
        + ' `saveBriefing(briefingId, data)` com o objeto INTEIRO, array de slides incluído.'
        + ' Como o slide isolado é no-op inbound, dois usuários editando slides do mesmo'
        + ' briefing não tinham proteção nenhuma.'],
]);

/**
 * Tipos que NÃO precisam do guarda, com o motivo pelo qual a ausência é segura.
 */
const FORA = new Map([
    [EntityType.ATLAS,
        'membro morto do enum: nenhum emissor e nenhum `case` inbound (ver'
        + ' tests/unit/entitytype-com-case-inbound.test.js). Sem inbound não há o que guardar.'],
    [EntityType.MAP_POSITION,
        'sub-entidade de mapa, e a razão de ficar fora é ESTRUTURAL, não de conveniência: as'
        + ' cinco compartilham `entityId === mapId` (`createMapSettingLogger`), enquanto'
        + ' `shouldApplyVersion` e `lastAppliedVersion` são chaveados por `entityId`. Pôr as'
        + ' cinco no Set faria os cinco fluxos disputarem UM contador de versão, e uma nota nova'
        + ' passaria a descartar uma posição nova. O guarda pioraria a convergência.'],
    [EntityType.BASE_LAYER,
        'mesma razão estrutural das cinco sub-entidades de mapa: `entityId === mapId`, e o'
        + ' contador de versão do guarda é por `entityId`. Além disso o inbound escreve UM campo'
        + ' (`mapData.baseLayer`), não um documento.'],
    [EntityType.MAP_NOTES,
        'mesma razão estrutural das cinco sub-entidades de mapa. O inbound escreve o side-store'
        + ' de notas daquele mapa, que é o valor inteiro daquele campo, e o último a chegar é o'
        + ' que o usuário espera ver.'],
    [EntityType.GRID_STYLE,
        'mesma razão estrutural das cinco sub-entidades de mapa. O inbound escreve o side-store'
        + ' de estilo de grade, valor único por mapa.'],
    [EntityType.MAP_TEMPORAL,
        'mesma razão estrutural das cinco sub-entidades de mapa. A exclusão mútua que ele precisa'
        + ' já existe e é outra: `withSideDocument(\'temporal\', ...)`, contra o merge de patch'
        + ' do lado local.'],
    [EntityType.SLIDE,
        'no-op inbound de propósito: o `case` existe só para não cair no `warn`, e não escreve'
        + ' nada. Slides convergem pela op do `briefing` pai, que ESTÁ no Set. Guardar um handler'
        + ' que não escreve não guardaria nada.'],
    [EntityType.GROUP_FEATURE,
        'a razão é ESTRUTURAL e é o inverso das sub-entidades de mapa: lá cinco fluxos'
        + ' dividem um `entityId`, aqui CADA OP tem o seu, um UUID descartável cunhado por'
        + ' `logGroupFeatureOperation` (a entidade de que a op fala viaja em `data`). Um guarda'
        + ' por `entityId` nunca reconheceria duas ops como sendo da mesma entidade: a checagem'
        + ' de versão jamais casaria e `lastAppliedVersion` cresceria sem limite, um por op'
        + ' recebida. E ele não é necessário: `applyRemoteGroupFeatureOp` edita a lista de'
        + ' membros EM SEPARADO (tira ou põe um id), nunca substitui o documento do grupo, então'
        + ' não existe a escrita em bloco que é o critério do Set. Duas remoções concorrentes de'
        + ' membros DIFERENTES comutam; a mesma remoção duas vezes é idempotente.'],
    [EntityType.SETTING,
        'o payload é patch parcial de preferências de atlas e o inbound aplica chave a chave'
        + ' (`applyRemoteAppStateSettings`), sem substituir o objeto de settings. Um guarda por'
        + ' versão descartaria patches de chaves DIFERENTES, que não competem entre si.'],
]);

/**
 * Lacunas conhecidas: tipos cuja LEITURA do inbound satisfaz o critério declarado
 * ("o update substitui em bloco") e que mesmo assim estão fora do Set.
 *
 * Isto NÃO é allowlist, e a diferença é o ponto do item: allowlist fica verde para
 * sempre; um marcador de lacuna QUEBRA quando alguém fecha o buraco, obrigando a
 * revisão da decisão no mesmo commit. Registrar comportamento observado como
 * esperado é uma recorrência do `docs/livro-razao.md`; o idioma da casa é o marcador
 * que reprova ao ser fechado.
 *
 * NENHUMA das três está decidida. Este arquivo não as decide; ele só impede que
 * sejam fechadas (ou esquecidas) em silêncio.
 */
const LACUNA_CONHECIDA = new Map([
    [EntityType.MAP,
        'candidato ao MESMO defeito que custou o briefing: `applyRemoteMapOp` no UPDATE faz'
        + ' `repo.saveMap(mapId, reshaped)`, o documento de mapa INTEIRO, que é a definição de'
        + ' "substitui em bloco" usada como critério do Set. `entityId` é o id do mapa e é único,'
        + ' então não há o impedimento estrutural das cinco sub-entidades. Decisão de produto'
        + ' pendente e sem dono.'],
    [EntityType.CATALOG_LAYER,
        '`applyRemoteCatalogLayerOp` faz `mapData.catalogLayers[idx] = data`, que é exatamente a'
        + ' forma "item inteiro por id" pela qual `marker3d`, `marker360` e irmãos ESTÃO no Set.'
        + ' A assimetria não tem motivo registrado em lugar nenhum; foi encontrada ao escrever'
        + ' este guarda. Decisão pendente.'],
    [EntityType.COMMENT,
        '`applyRemoteCommentOp` faz `collection[commentId] = data`, o comentário inteiro. A'
        + ' exposição é menor que a dos outros (root e reply são entidades com ids próprios,'
        + ' então dois usuários não editam a mesma linha no curso normal) e ele já tem exclusão'
        + ' mútua de OUTRA ordem (`withSideDocument`, contra o co-escritor local da mesma'
        + ' coleção), mas nenhuma das duas coisas é o critério escrito. Decisão pendente.'],
]);

const VALORES = new Set(Object.values(EntityType));
const DECLARADOS = [...DENTRO.keys(), ...FORA.keys(), ...LACUNA_CONHECIDA.keys()];

describe('CONVERGENCE_GUARDED: decisão registrada para cada EntityType', () => {
    it('PISO: o import direto trouxe um Set povoado, e o enum não está vazio', () => {
        // Sem este piso, um import que devolvesse `undefined` (é o que o BARREL devolve:
        // o Set não é reexportado por store/sync/index.js) faria toda comparação abaixo
        // rodar sobre conjunto vazio e passar em vazio.
        expect(CONVERGENCE_GUARDED,
            'CONVERGENCE_GUARDED não é um Set. Se o import foi trocado para o barrel'
            + ' (`store/sync/index.js`), ele devolve undefined: o Set não é reexportado lá.')
            .toBeInstanceOf(Set);
        expect(CONVERGENCE_GUARDED.size,
            'CONVERGENCE_GUARDED chegou vazio: o import quebrou ou o Set foi esvaziado')
            .toBeGreaterThan(5);
        expect(VALORES.size, 'EntityType chegou vazio (import quebrado?)').toBeGreaterThan(15);
        expect(DECLARADOS.length,
            'as tabelas congeladas deste teste estão vazias').toBeGreaterThan(15);
    });

    it('as três tabelas cobrem o universo do enum, sem interseção', () => {
        // Não existe ramo padrão aqui: um tipo fora das três tabelas não produz erro
        // nenhum, só ausência de decisão. Esta é a asserção que transforma essa
        // ausência em vermelho.
        const semDecisao = [...VALORES].filter((v) => !DECLARADOS.includes(v));
        expect(
            semDecisao,
            'EntityType sem decisão escrita sobre CONVERGENCE_GUARDED. Não há ramo padrão que'
            + ' pegue isso: ficar de fora do Set não gera erro, só divergência entre pares.'
            + ' Decida e registre em DENTRO, FORA ou LACUNA_CONHECIDA, com o motivo.\n'
            + `Tipos: ${semDecisao.join(', ')}`
        ).toEqual([]);

        const duplicados = DECLARADOS.filter((v, i) => DECLARADOS.indexOf(v) !== i);
        expect(duplicados,
            `tipo declarado em mais de uma tabela: ${duplicados.join(', ')}`).toEqual([]);

        const fantasmas = DECLARADOS.filter((v) => !VALORES.has(v));
        expect(fantasmas,
            'entrada apontando para valor que não é membro de EntityType (tipo removido e'
            + ` tabela não atualizada): ${fantasmas.join(', ')}`).toEqual([]);
    });

    it('paridade com o código, nos DOIS sentidos', () => {
        const soNoCodigo = [...CONVERGENCE_GUARDED].filter((v) => !DENTRO.has(v));
        expect(
            soNoCodigo,
            'tipo que ESTÁ em CONVERGENCE_GUARDED e não está declarado em DENTRO neste teste.'
            + ' Se ele acabou de entrar no Set, escreva aqui o motivo (qual escrita inbound'
            + ' substitui em bloco); se ele saiu de uma lacuna conhecida, a decisão foi tomada e'
            + ' precisa ser registrada.\n'
            + `Tipos: ${soNoCodigo.join(', ')}`
        ).toEqual([]);

        const soNoTeste = [...DENTRO.keys()].filter((v) => !CONVERGENCE_GUARDED.has(v));
        expect(
            soNoTeste,
            'tipo declarado em DENTRO e AUSENTE de CONVERGENCE_GUARDED. É a forma exata do defeito'
            + ' do briefing: o inbound substitui o objeto inteiro e não há LWW por serverVersion,'
            + ' então o último a chegar apaga o trabalho do outro sem erro. Acrescente-o ao Set em'
            + ' `frontend/src/js/store/sync/remote-operation-handler.js`, ou mova a entrada para'
            + ' FORA com o motivo.\n'
            + `Tipos: ${soNoTeste.join(', ')}`
        ).toEqual([]);
    });

    it('as lacunas conhecidas quebram nos DOIS sentidos', () => {
        for (const [valor, motivo] of LACUNA_CONHECIDA) {
            expect(VALORES.has(valor),
                `LACUNA_CONHECIDA cita "${valor}", que não é mais membro de EntityType:`
                + ' a lacuna sumiu, remova a entrada').toBe(true);
            expect(CONVERGENCE_GUARDED.has(valor),
                `"${valor}" ENTROU em CONVERGENCE_GUARDED e continua declarado como lacuna.`
                + ' A decisão pendente foi fechada: mova a entrada para DENTRO com o motivo'
                + ' medido, e registre a decisão onde decisões moram.').toBe(false);
            expect(motivo.length,
                `lacuna "${valor}" declarada sem motivo escrito`).toBeGreaterThan(80);
        }
        expect(LACUNA_CONHECIDA.size,
            'LACUNA_CONHECIDA vazio. Fechar as três é uma decisão registrada, não uma linha'
            + ' apagada deste teste.').toBe(3);
    });

    it('anti-tapete: toda entrada tem motivo próprio e não-genérico', () => {
        // Sem isto, a saída barata para um vermelho seria acrescentar a entrada com um
        // motivo em branco, que é omissão silenciosa com outra roupa.
        const magros = [];
        for (const [tabela, mapa] of [['DENTRO', DENTRO], ['FORA', FORA]]) {
            for (const [valor, motivo] of mapa) {
                if (typeof motivo !== 'string' || motivo.length < 60) {
                    magros.push(`${tabela}[${valor}]: motivo com ${String(motivo).length} chars`);
                }
            }
        }
        expect(magros,
            `entrada sem motivo escrito de verdade:\n${magros.join('\n')}`).toEqual([]);

        // Motivo copiado e colado idêntico entre tipos que não são a mesma família é
        // como uma tabela deixa de dizer alguma coisa. As cinco sub-entidades de mapa
        // compartilham a razão de propósito e dizem isso no texto ("mesma razão").
        const textos = [...DENTRO.values()];
        expect(new Set(textos).size,
            'motivos repetidos literalmente em DENTRO: cada tipo tem uma escrita inbound própria')
            .toBe(textos.length);
    });
});
