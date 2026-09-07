// Path: tests/unit/acervo-herdado-nome-do-mapa.test.js

/**
 * @fileoverview O NOME DO MAPA quando o atlas local veio da linha anterior do produto, medido
 * sobre IndexedDB de verdade (`fake-indexeddb`, instalado para toda esta suíte).
 *
 * O QUE MOTIVOU, e o número é o do navegador. Enviar ao servidor o acervo HERDADO (o slot de
 * sufixo vazio, adotado de uma instalação da linha `main` 2.4) entregava 2 mapas de 14 e 33
 * feições de 805, com aviso VERDE de sucesso. A causa não está no envio: a linha anterior grava
 * TODO mapa novo com a chave certa e `data.name = 'Novo Mapa'`, porque a guarda dela
 * (`if (!newMapData.name)`) nunca dispara sobre um `getEmptyMapData()` que já devolve esse nome.
 * O defeito era cosmético e inerte enquanto ninguém lia aquele campo, e este leitor é o PRIMEIRO
 * consumidor a preferi-lo à chave: os treze colidem numa entrada só de `data.maps`, e vence o
 * último iterado.
 *
 * A REGRA QUE ESTE ARQUIVO PRENDE, e ela tem duas metades que não se sustentam separadas:
 *
 *   1. NUM ATLAS LOCAL ANÔNIMO A CHAVE É O NOME, e é a fonte de verdade. A chave só deixa de
 *      sê-lo quando é um IDENTIFICADOR gerado (UUID v4, ou o id legado `<epoch>-<aleatório>`),
 *      que é o que a criação escreve com a sincronização ligada. Então: chave que não é
 *      identificador VENCE o campo; chave que é identificador cede ao campo, como antes.
 *   2. DOIS REGISTROS NO MESMO NOME RECUSAM O ENVIO, sempre. A regra 1 acerta a população
 *      medida, e não pode acertar todas: dois mapas UUID-keyed com o mesmo `data.name` ainda
 *      colidem. Sobrescrever em silêncio é o defeito; recusar com o nome e as chaves na frase é
 *      o desfecho que a pessoa pode consertar.
 *
 * O SLOT DESTE ARQUIVO É FABRICADO, e a fabricação está declarada: catorze registros com a chave
 * certa e `data.name = 'Novo Mapa'` em treze, que é EXATAMENTE o disco medido no navegador em
 * 2026-09-07. As contagens de feição por mapa somam 805, e as dos dois mapas que hoje sobrevivem
 * (o "Principal", com 23, e o "14 Bordas", com 10, que é o último por ordem de chave) somam 33.
 * É por isso que o caso reprova com um par de números e não com um "está errado".
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetIndexedDB } from '../helpers/idb-helpers.js';

let ns;
let servico;

beforeEach(async () => {
    await resetIndexedDB();
    // A fábrica de `getStoreFor` guarda um handle por (banco, escopo) no nível do módulo: sem
    // instância nova, um caso leria handles que apontam para bancos que o reset apagou.
    vi.resetModules();
    ns = await import('../../src/js/store/atlas-namespace.js');
    servico = await import('../../src/js/projects/send-local-to-server.service.js');
});

/** O escopo do slot HERDADO: sufixo VAZIO, que é o endereço dos bancos sem sufixo. */
const escopoHerdado = () => ns.localScope('atlas-herdado', '');

const gravar = (banco, scope, key, value) =>
    ns.getStoreFor(ns.StoreName[banco], scope).setItem(key, value);

/**
 * Os catorze mapas do acervo medido, com a contagem de feições de cada um.
 *
 * A ORDEM DESTA LISTA NÃO É A DA ITERAÇÃO: `iterate` percorre por chave, então "14 Bordas" é o
 * último dos treze envenenados e é ele que hoje sobrevive como "Novo Mapa". Escrever a lista em
 * ordem de leitura esconderia justamente isso.
 */
const ACERVO = Object.freeze([
    ['Principal', 23],
    ['02 Estilos', 86],
    ['03 Camadas', 40],
    ['04 Imagens', 55],
    ['05 Simbologia', 90],
    ['06 Medidas', 70],
    ['07 Temporal', 61],
    ['08 Briefing', 44],
    ['09 Modelos 3D', 58],
    ['10 Fotos 360', 77],
    ['11 Grupos', 66],
    ['12 Lote', 52],
    ['13 Notas', 73],
    ['14 Bordas', 10],
]);

/** 805, e o denominador é escrito uma vez só. */
const TOTAL_DE_FEICOES = ACERVO.reduce((soma, [, n]) => soma + n, 0);

/**
 * Semeia o slot herdado exatamente como o disco da população: a CHAVE é o nome certo, e
 * `data.name` é o literal `'Novo Mapa'` em todos menos o "Principal".
 */
async function semearAcervoHerdado(scope) {
    await gravar('ATLAS', scope, 'current_atlas', {
        id: 'atlas-herdado', name: 'Meu Atlas', schemaVersion: '2.4',
        mapOrder: ACERVO.map(([nome]) => nome), lastActiveMapId: 'Principal',
    });
    for (const [nome, quantas] of ACERVO) {
        await gravar('MAPS', scope, nome, {
            // O CAMPO ENVENENADO, e ele é o insumo: só o "Principal" tem os dois iguais.
            name: nome === 'Principal' ? 'Principal' : 'Novo Mapa',
            baseLayer: 'carta-topografica',
            features: {
                points: Array.from({ length: quantas }, (_, i) => ({
                    geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                    properties: { id: `${nome}-${i}`, source: 'point', layerId: 'default' },
                })),
            },
        });
    }
    await gravar('SETTINGS', scope, 'mapOrder', ACERVO.map(([nome]) => nome));
    await gravar('SETTINGS', scope, 'lastActiveMap', 'Principal');
}

/** As feições de todos os baldes de todos os mapas do documento. */
function contarFeicoes(data) {
    let total = 0;
    for (const mapa of Object.values(data.maps)) {
        for (const balde of Object.values(mapa.features || {})) {
            if (Array.isArray(balde)) total += balde.length;
        }
    }
    return total;
}

// ============================================================================
// 1 — O ACERVO HERDADO SOBE INTEIRO
// ============================================================================

describe('o acervo herdado, com a chave certa e o campo envenenado', () => {
    it('os CATORZE mapas chegam ao documento, com os nomes do acervo', async () => {
        // A RÉGUA DA VIRADA. Contra o leitor que prefere o campo à chave, este caso devolve DOIS
        // mapas ("Principal" e "Novo Mapa") e 33 feições, que são os números medidos no
        // navegador; os denominadores 14 e 805 são os do cartão local na mesma sessão.
        const scope = escopoHerdado();
        await semearAcervoHerdado(scope);

        const data = await servico.buildLocalAtlasExportData(scope);

        // A FEIÇÃO PRIMEIRO, e a ordem é escolhida pela evidência que ela imprime: contra o
        // código de antes esta linha reprova com "expected 33 to be 805", que é o par de números
        // medido no navegador.
        expect(TOTAL_DE_FEICOES).toBe(805);
        expect(contarFeicoes(data)).toBe(TOTAL_DE_FEICOES);
        expect(Object.keys(data.maps)).toHaveLength(14);
        expect(Object.keys(data.maps).sort())
            .toEqual(ACERVO.map(([nome]) => nome).sort());
    });

    it('o nome "Novo Mapa" não sobra em lugar nenhum do documento', async () => {
        // Sem esta linha, um conserto que só acrescentasse mapas (mantendo a entrada colidida)
        // passaria no caso acima com quinze entradas.
        const scope = escopoHerdado();
        await semearAcervoHerdado(scope);

        const data = await servico.buildLocalAtlasExportData(scope);

        expect(Object.keys(data.maps)).not.toContain('Novo Mapa');
        expect(data.mapOrder).not.toContain('Novo Mapa');
    });

    it('cada mapa leva as feições DELE, e não as do último iterado', async () => {
        // O caso acima cobra o total; este cobra a atribuição. Um leitor que empilhasse todas as
        // feições num mapa só acertaria a soma e erraria o atlas inteiro.
        const scope = escopoHerdado();
        await semearAcervoHerdado(scope);

        const data = await servico.buildLocalAtlasExportData(scope);

        for (const [nome, quantas] of ACERVO) {
            expect(data.maps[nome]?.features?.points ?? [],
                `o mapa "${nome}" perdeu as feições dele`).toHaveLength(quantas);
        }
    });

    it('a ordem dos mapas sai com catorze nomes e NENHUM repetido', async () => {
        // B3-12: o `mapOrder` traduzido chave a chave produzia uma lista com o mesmo nome treze
        // vezes, que o servidor grava verbatim e a tela desenha como catorze cartões para dois
        // mapas. A tela mostrava o número certo de mapas e escondia a perda.
        const scope = escopoHerdado();
        await semearAcervoHerdado(scope);

        const data = await servico.buildLocalAtlasExportData(scope);

        expect(data.mapOrder).toHaveLength(14);
        expect(new Set(data.mapOrder).size).toBe(14);
        expect(data.mapOrder).toEqual(ACERVO.map(([nome]) => nome));
    });

    it('o mapa corrente é um dos catorze, e é o que o slot aponta', async () => {
        const scope = escopoHerdado();
        await semearAcervoHerdado(scope);

        const data = await servico.buildLocalAtlasExportData(scope);

        expect(data.currentMap).toBe('Principal');
        expect(Object.keys(data.maps)).toContain(data.currentMap);
    });
});

// ============================================================================
// 2 — A ORDEM SEM REPETIÇÃO, e o pior caso dela
// ============================================================================

describe('a ordem dos mapas nunca repete nome', () => {
    it('chave repetida na ordem gravada não vira nome repetido', async () => {
        // O PIOR CASO DA DEDUPLICAÇÃO, e ele existe fora de qualquer colisão de nome: o setting
        // `mapOrder` é escrito por outro caminho e pode citar a mesma chave duas vezes, ou citar a
        // chave E o nome do mesmo mapa. Os dois produzem uma lista repetida na saída.
        const scope = escopoHerdado();
        await gravar('MAPS', scope, 'Alfa', { name: 'Alfa', features: {} });
        await gravar('MAPS', scope, 'Bravo', { name: 'Bravo', features: {} });
        await gravar('SETTINGS', scope, 'mapOrder', ['Alfa', 'Bravo', 'Alfa', 'Bravo', 'Alfa']);

        const data = await servico.buildLocalAtlasExportData(scope);

        expect(data.mapOrder).toEqual(['Alfa', 'Bravo']);
    });

    it('a ORDEM é preservada, e não trocada por uma alfabética', async () => {
        // Sem este controle, "deduplique" passaria contra uma implementação que jogasse a ordem
        // fora e devolvesse as chaves do documento, que é a ordem de leitura do banco.
        const scope = escopoHerdado();
        await gravar('MAPS', scope, 'Alfa', { name: 'Alfa', features: {} });
        await gravar('MAPS', scope, 'Bravo', { name: 'Bravo', features: {} });
        await gravar('MAPS', scope, 'Charlie', { name: 'Charlie', features: {} });
        await gravar('SETTINGS', scope, 'mapOrder', ['Charlie', 'Alfa', 'Bravo']);

        const data = await servico.buildLocalAtlasExportData(scope);

        expect(data.mapOrder).toEqual(['Charlie', 'Alfa', 'Bravo']);
    });
});

// ============================================================================
// 3 — A COLISÃO QUE SOBRA: RECUSA, nunca sobrescrita
// ============================================================================

const UUID_UM = 'aaaaaaaa-0000-4000-8000-000000000001';
const UUID_DOIS = 'bbbbbbbb-0000-4000-8000-000000000002';
const UUID_TRES = 'cccccccc-0000-4000-8000-000000000003';

describe('dois registros no mesmo nome recusam o envio', () => {
    it('duas chaves UUID com o mesmo `data.name` levantam, nomeando o nome e as chaves', async () => {
        // A METADE QUE A REGRA DA CHAVE NÃO ALCANÇA. Aqui as duas chaves SÃO identificadores, o
        // nome vem do campo nos dois, e os dois campos dizem a mesma coisa: sem recusa, um dos
        // dois mapas desaparece em silêncio e o outro sobe no lugar dele.
        const scope = escopoHerdado();
        await gravar('MAPS', scope, UUID_UM, { name: 'Operação Alfa', features: {} });
        await gravar('MAPS', scope, UUID_DOIS, { name: 'Operação Alfa', features: {} });

        const erro = await servico.buildLocalAtlasExportData(scope).then(
            () => null,
            (e) => e,
        );

        expect(erro, 'o leitor devolveu um documento em vez de recusar').not.toBeNull();
        expect(erro.message).toContain('Operação Alfa');
        expect(erro.message).toContain(UUID_UM);
        expect(erro.message).toContain(UUID_DOIS);
        // A frase é para uma pessoa, e diz o que ela pode fazer.
        expect(erro.message).toMatch(/renomeie/i);
    });

    it('a recusa é NOMEADA, e não um erro anônimo que a tela mostraria cru', async () => {
        const scope = escopoHerdado();
        await gravar('MAPS', scope, UUID_UM, { name: 'Repetido', features: {} });
        await gravar('MAPS', scope, UUID_DOIS, { name: 'Repetido', features: {} });

        const erro = await servico.buildLocalAtlasExportData(scope).catch((e) => e);

        expect(erro.code).toBe('NOME_DE_MAPA_REPETIDO');
        expect(erro.stage).toBe('leitura');
    });

    it('a chave que NÃO é identificador colide contra o campo do vizinho, e também recusa', async () => {
        // O caso misto, que é o que a população produz quando um mapa já foi sincronizado: um
        // registro name-keyed "Alfa" e outro UUID-keyed cujo `data.name` é "Alfa".
        const scope = escopoHerdado();
        await gravar('MAPS', scope, 'Alfa', { name: 'Novo Mapa', features: {} });
        await gravar('MAPS', scope, UUID_UM, { name: 'Alfa', features: {} });

        await expect(servico.buildLocalAtlasExportData(scope))
            .rejects.toThrow(/Alfa/);
    });

    it('RECUSA ANTES DA REDE: `importAtlas` não chega a ser chamado', async () => {
        // Uma recusa que acontecesse DEPOIS do `POST /atlas/import` deixaria um atlas mutilado no
        // servidor para ser explicado depois, que é o estado que esta regra existe para impedir.
        const scope = escopoHerdado();
        await gravar('MAPS', scope, UUID_UM, { name: 'Repetido', features: {} });
        await gravar('MAPS', scope, UUID_DOIS, { name: 'Repetido', features: {} });
        const chamadas = [];
        const apiClient = {
            async importAtlas(p) { chamadas.push(p); return { id: 'srv-1' }; },
            async bulkUploadImages() { return { mapping: {}, failed: [] }; },
        };

        await expect(servico.sendLocalAtlasToServer(
            { id: 'atlas-herdado', name: 'Meu Atlas', dbSuffix: '' },
            { apiClient, scopeOf: () => scope },
        )).rejects.toThrow(/Repetido/);
        expect(chamadas).toHaveLength(0);
    });

    it('TRÊS no mesmo nome: a frase cita as três chaves, e não só as duas primeiras', async () => {
        const scope = escopoHerdado();
        await gravar('MAPS', scope, UUID_UM, { name: 'Trio', features: {} });
        await gravar('MAPS', scope, UUID_DOIS, { name: 'Trio', features: {} });
        await gravar('MAPS', scope, UUID_TRES, { name: 'Trio', features: {} });

        const erro = await servico.buildLocalAtlasExportData(scope).catch((e) => e);

        for (const chave of [UUID_UM, UUID_DOIS, UUID_TRES]) {
            expect(erro.message).toContain(chave);
        }
    });
});

// ============================================================================
// 4 — CONTROLES: a regra da chave não pode virar "a chave sempre vence"
// ============================================================================

describe('CONTROLE: chave que é identificador continua cedendo ao campo', () => {
    it('mapa UUID-keyed sobe com o NOME do valor, e o UUID não vira nome de mapa', async () => {
        // Este é o atlas sincronizado, e o comportamento dele NÃO muda. Sem este controle, o
        // conserto poderia virar "a chave sempre vence" e passar em toda a seção 1, entregando ao
        // servidor um atlas cujos mapas se chamam `aaaaaaaa-0000-...`.
        const scope = escopoHerdado();
        await gravar('MAPS', scope, UUID_UM, { name: 'Mapa Sincronizado', features: {} });

        const data = await servico.buildLocalAtlasExportData(scope);

        expect(Object.keys(data.maps)).toEqual(['Mapa Sincronizado']);
        expect(data.maps[UUID_UM]).toBeUndefined();
    });

    it('id LEGADO (`<epoch>-<aleatório>`) também é identificador, e cede ao campo', async () => {
        // A forma antiga de id que `isValidId` reconhece. Tratá-la como nome poria um carimbo de
        // tempo na aba de mapas do servidor.
        const scope = escopoHerdado();
        await gravar('MAPS', scope, '1706123456789-abc45xy90',
            { name: 'Mapa Antigo', features: {} });

        const data = await servico.buildLocalAtlasExportData(scope);

        expect(Object.keys(data.maps)).toEqual(['Mapa Antigo']);
    });

    it('chave que não é identificador e valor SEM nome: a chave responde', async () => {
        const scope = escopoHerdado();
        await gravar('MAPS', scope, 'Sem Campo', { features: {} });

        const data = await servico.buildLocalAtlasExportData(scope);

        expect(Object.keys(data.maps)).toEqual(['Sem Campo']);
    });
});
