// Path: tests/unit/conceder-pelo-painel.test.js

/**
 * @fileoverview CONCEDER PELA ABA CONCESSÕES, e a lista do modal que passou a ser só a autoria de
 * quem olha (decisão do dono, 2026-09-22, itens 19b e 19c).
 *
 * TRÊS METADES, e cada uma prende uma decisão diferente:
 *
 *   1. `shareableResources` (`admin/shareable-resources.js`): QUAIS recursos o comando "Conceder
 *      acesso" oferece. A regra é a do gate de repasse do servidor (`requireResourceShare`), lida
 *      do payload que ele mesmo manda, e é ESPELHADA contra o vocabulário do servidor
 *      (`PAYLOAD_KEY_BY_TYPE`), importado no mesmo processo.
 *   2. `grantCascade` e `ownRevocationWarning` (`catalog/grant-tree.js`): o aviso de revogar deixou
 *      de percorrer a árvore (que não vem mais) e passou a ler a contagem do servidor. O ramo SEM
 *      contagem é o que não pode dizer "ninguém cai".
 *   3. A fiação da aba (`admin/grants-tab.js`), por TEXTO, porque ela monta DOM e a suíte roda em
 *      node: o comando nasce só com lista, o modal entra pelo NÚCLEO sem store e por `import()`, e
 *      o efeito injetado é reler a aba.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    SHAREABLE_GROUPS,
    shareableKey,
    shareableResources,
} from '../../src/js/admin/shareable-resources.js';
import {
    grantCascade,
    isOwnGrant,
    ownRevocationWarning,
} from '../../src/js/catalog/grant-tree.js';
import {
    RESOURCE_TYPE_LABELS,
    issuedEmptyHint,
    resourceTypeLabel,
    shareableEmptyNotice,
    shareableFailureNotice,
} from '../../src/js/admin/grant-phrases.js';
import {
    PAYLOAD_KEY_BY_TYPE,
    RESOURCE_TYPES,
} from '../../../backend/src/modules/resource-access/resource-access.types.js';

const PACOTE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ABA = readFileSync(join(PACOTE, 'src/js/admin/grants-tab.js'), 'utf8');

/** O corpo de um método da aba, do cabeçalho até o fechamento na indentação de classe. */
function corpoDeMetodo(texto, assinatura) {
    const inicio = texto.indexOf(assinatura);
    expect(inicio, `âncora ausente: ${assinatura}`).toBeGreaterThan(-1);
    const fim = texto.indexOf('\n    }', inicio);
    expect(fim).toBeGreaterThan(inicio);
    return texto.slice(inicio, fim);
}

/** Um payload aditivo mínimo, com os cinco grupos presentes e vazios. */
function payload(extra = {}) {
    return {
        basemaps: [], tilesets: [], dataLayers: [], analysisLayers: [], views360: [],
        shareable: { basemaps: [], tilesets: [], dataLayers: [], analysisLayers: [], views360: [] },
        origins: { basemaps: {}, tilesets: {}, dataLayers: {}, analysisLayers: {}, views360: {} },
        ...extra,
    };
}

describe('shareableResources — o que o comando "Conceder acesso" oferece', () => {
    it('espelha o vocabulário do SERVIDOR: cinco grupos, um tipo cada, a mesma relação', () => {
        // Comparado com o módulo do backend importado AQUI, e não com uma cópia escrita neste
        // teste: um sexto tipo lá sem grupo cá reprova, em vez de sumir da lista em silêncio.
        expect(SHAREABLE_GROUPS).toHaveLength(RESOURCE_TYPES.length);
        for (const { grupo, tipo } of SHAREABLE_GROUPS) {
            expect(PAYLOAD_KEY_BY_TYPE[tipo], tipo).toBe(grupo);
        }
        expect(SHAREABLE_GROUPS.map((g) => g.tipo).sort()).toEqual([...RESOURCE_TYPES].sort());
    });

    it('entra quem o servidor diz que se REPASSA (produção e `view_share`)', () => {
        const lista = shareableResources(payload({
            tilesets: [{ id: 'm1', name: 'Modelo A' }, { id: 'm2', name: 'Modelo B' }],
            shareable: { ...payload().shareable, tilesets: ['m1'] },
        }));
        expect(lista).toEqual([{ resourceType: 'tileset', resourceId: 'm1', name: 'Modelo A' }]);
    });

    it('e quem vê por PAPEL (papel global ou produção), que concede de raiz', () => {
        // O administrador e o credenciado ficam FORA de `shareable` no servidor; o que os delata é
        // a procedência `papel`. Sem este ramo, o credenciado, cujo papel é conceder, veria a
        // frase de "nada a compartilhar".
        const lista = shareableResources(payload({
            dataLayers: [{ id: 'd1', name: 'Hidrografia' }],
            origins: { ...payload().origins, dataLayers: { d1: 'papel' } },
        }));
        expect(lista).toEqual([{ resourceType: 'data_layer', resourceId: 'd1', name: 'Hidrografia' }]);
    });

    it('NÃO entra quem só recebeu para VER, nem o emprestado pelo atlas', () => {
        const lista = shareableResources(payload({
            tilesets: [{ id: 'ver', name: 'Só vê' }, { id: 'emp', name: 'Emprestado' }],
            origins: { ...payload().origins, tilesets: { ver: 'concessao', emp: 'emprestimo' } },
        }));
        expect(lista).toEqual([]);
    });

    it('a ordem é por tipo e, dentro dele, por nome em pt-BR, sem diferenciar maiúscula', () => {
        const lista = shareableResources(payload({
            basemaps: [{ id: 'b1', name: 'Ortofoto' }],
            tilesets: [{ id: 't2', name: 'zulu' }, { id: 't1', name: 'Alfa' }, { id: 't3', name: 'Ébano' }],
            origins: {
                ...payload().origins,
                basemaps: { b1: 'papel' },
                tilesets: { t1: 'papel', t2: 'papel', t3: 'papel' },
            },
        }));
        expect(lista.map((r) => r.resourceId)).toEqual(['t1', 't3', 't2', 'b1']);
    });

    it('o mapa base entra com o tipo de concessão dele, e o 360 com o dele', () => {
        const lista = shareableResources(payload({
            basemaps: [{ id: 'b1', name: 'Base' }],
            views360: [{ id: 'p1', name: 'Quartel' }],
            shareable: { ...payload().shareable, basemaps: ['b1'], views360: ['p1'] },
        }));
        expect(lista.map((r) => r.resourceType)).toEqual(['sv360_project', 'basemap']);
    });

    it('sem nome, o id; id repetido, uma linha só', () => {
        const lista = shareableResources(payload({
            tilesets: [{ id: 'm1', name: '   ' }, { id: 'm1', name: 'Duplicado' }],
            shareable: { ...payload().shareable, tilesets: ['m1'] },
        }));
        expect(lista).toEqual([{ resourceType: 'tileset', resourceId: 'm1', name: 'm1' }]);
    });

    it('entrada suja degrada para vazio, nunca para exceção nem para um recurso a mais', () => {
        for (const sujo of [null, undefined, 7, 'x', {}, { tilesets: 'nao-e-lista' },
            { tilesets: [{ id: 'm1' }], shareable: null, origins: null },
            { tilesets: [null, { name: 'sem id' }, { id: '' }], shareable: { tilesets: ['m1'] } }]) {
            expect(shareableResources(sujo), JSON.stringify(sujo)).toEqual([]);
        }
    });

    it('procedência herdada do protótipo não conta como papel', () => {
        // `Object.hasOwn`, e não `in`: um id chamado `toString` não pode herdar uma procedência.
        const lista = shareableResources(payload({
            tilesets: [{ id: 'toString', name: 'Armadilha' }],
            origins: { ...payload().origins, tilesets: Object.create({ toString: 'papel' }) },
        }));
        expect(lista).toEqual([]);
    });

    it('a chave junta tipo e id, e dois tipos com o mesmo id não colidem', () => {
        const a = shareableKey({ resourceType: 'tileset', resourceId: 'x' });
        const b = shareableKey({ resourceType: 'data_layer', resourceId: 'x' });
        expect(a).not.toBe(b);
        expect(a).toBe('tileset|x');
    });
});

describe('as frases do comando', () => {
    it('todo tipo do servidor tem rótulo, e o mapa base deixou de sair cru', () => {
        for (const tipo of RESOURCE_TYPES) {
            expect(Object.hasOwn(RESOURCE_TYPE_LABELS, tipo), tipo).toBe(true);
        }
        expect(resourceTypeLabel('basemap')).toBe('Mapa base');
    });

    it('a dica do vazio só aponta para "Conceder acesso" quando o comando existe', () => {
        expect(issuedEmptyHint(true)).toContain('Conceder acesso');
        expect(issuedEmptyHint(false)).not.toContain('Conceder acesso');
        expect(issuedEmptyHint()).not.toContain('Conceder acesso');
        // E nenhuma das duas manda mais para o cartão do mapa como caminho único.
        expect(issuedEmptyHint(true)).not.toContain('cartão do recurso');
    });

    it('"não há o que compartilhar" e "não carregou" são frases diferentes', () => {
        expect(shareableEmptyNotice().length).toBeGreaterThan(10);
        expect(shareableFailureNotice()).not.toBe(shareableEmptyNotice());
        expect(shareableFailureNotice()).toContain('Não foi possível');
        expect(shareableEmptyNotice()).not.toContain('Não foi possível');
    });
});

describe('grantCascade — a queda contada pelo servidor', () => {
    it('lê os dois campos e soma', () => {
        expect(grantCascade({ cascade_people: 2, cascade_groups: 1 }))
            .toEqual({ pessoas: 2, grupos: 1, total: 3 });
        expect(grantCascade({ cascade_people: 0, cascade_groups: 0 }))
            .toEqual({ pessoas: 0, grupos: 0, total: 0 });
    });

    it('ausência NÃO é zero: sem os dois campos inteiros, a resposta é `null`', () => {
        // Zero afirma "ninguém cai"; null é "o servidor não contou", e o modal volta para a
        // árvore. Confundir os dois é o aviso tranquilizando antes de um ato irreversível.
        for (const sujo of [null, undefined, {}, { cascade_people: 1 }, { cascade_groups: 1 },
            { cascade_people: -1, cascade_groups: 0 }, { cascade_people: 1.5, cascade_groups: 0 },
            { cascade_people: '2', cascade_groups: 0 }, { cascade_people: NaN, cascade_groups: 0 }]) {
            expect(grantCascade(sujo), JSON.stringify(sujo)).toBeNull();
        }
    });
});

describe('ownRevocationWarning — revogar uma concessão SUA', () => {
    const ana = { grantee_id: 'u1', grantee_nome: 'Ana Souza', grantee_username: 'ana' };

    it('com queda, conta por tipo e concorda o verbo, sem nomear ninguém da subárvore', () => {
        const aviso = ownRevocationWarning({ ...ana, cascade_people: 2, cascade_groups: 1 });
        expect(aviso).toContain('Remover o acesso de Ana Souza a este recurso?');
        expect(aviso).toContain('2 pessoas e 1 grupo perdem o acesso');
        expect(ownRevocationWarning({ ...ana, cascade_people: 1, cascade_groups: 0 }))
            .toContain('1 pessoa perde o acesso');
    });

    it('sem queda, é só a pergunta', () => {
        expect(ownRevocationWarning({ ...ana, cascade_people: 0, cascade_groups: 0 }))
            .toBe('Remover o acesso de Ana Souza a este recurso?');
    });

    it('sem contagem, diz que o repasse PODE cair, em vez de calar sobre ele', () => {
        const aviso = ownRevocationWarning(ana);
        expect(aviso).toContain('também pode cair');
        expect(aviso).not.toMatch(/\d/);
    });

    it('a concessão a GRUPO sai preposicionada como grupo', () => {
        const aviso = ownRevocationWarning({
            grantee_group_id: 'g1', grantee_group_name: 'Equipe Alfa', cascade_people: 0, cascade_groups: 0,
        });
        expect(aviso).toContain('do grupo Equipe Alfa');
    });
});

describe('isOwnGrant — a linha é de quem olha?', () => {
    it('compara por texto, e sem concedente ou sem sessão é falso', () => {
        expect(isOwnGrant({ granted_by: 'a1' }, 'a1')).toBe(true);
        expect(isOwnGrant({ granted_by: 42 }, '42')).toBe(true);
        expect(isOwnGrant({ granted_by: 'a1' }, 'b2')).toBe(false);
        expect(isOwnGrant({ granted_by: null }, 'a1')).toBe(false);
        expect(isOwnGrant({ granted_by: 'a1' }, null)).toBe(false);
        expect(isOwnGrant(null, 'a1')).toBe(false);
    });
});

describe('a aba Concessões: a fiação do comando', () => {
    it('a lista vem do payload aditivo SEM atlas em foco, pedida junto das outras duas', () => {
        const corpo = corpoDeMetodo(ABA, 'async _render() {');
        expect(corpo).toContain('apiClient.getVisibleResources(null)');
        expect(corpo).toContain('this._renderIssued(concedidos, emitidas, visiveis)');
        // A releitura superada não desenha: o modal pede render a cada escrita, sem esperar.
        expect(corpo).toMatch(/meu !== this\._renderSeq/);
    });

    it('o POSTO SOME: o botão só nasce com lista, e a lista vazia vira frase', () => {
        const corpo = corpoDeMetodo(ABA, '_grantCommand(visiveis) {');
        expect(corpo).toContain('shareableResources(visiveis.value)');
        expect(corpo).toMatch(/if \(lista\.length === 0\)[\s\S]{0,400}?actions: \[\]/);
        expect(corpo).toContain('shareableEmptyNotice()');
        // A falha de leitura é outro ramo, com saída, e também sem botão.
        expect(corpo).toContain('shareableFailureNotice()');
        expect(corpo).toMatch(/'Conceder acesso'/);
    });

    it('o modal entra pelo NÚCLEO sem store, sob demanda, e o efeito é reler a aba', () => {
        const corpo = corpoDeMetodo(ABA, 'async _openShare(recurso) {');
        expect(corpo).toContain("import('@js/catalog/resource-share.modal.core.js')");
        expect(corpo).toContain('onAccessChanged: () => { if (this._alive) this._render(); }');
        // A ENTRADA DO MAPA é a pesada (motor de sync), e não pode aparecer na aba.
        expect(ABA).not.toMatch(/resource-share\.modal\.js'/);
        expect(ABA).not.toMatch(/^import[^\n]*resource-share\.modal\.core\.js/m);
    });

    it('o combo tem dono: é destruído a cada releitura e ao sair da aba', () => {
        // A lista do combo é um portal em `document.body`: sem destruir, cada releitura deixaria
        // uma listbox e os ouvintes de documento para trás.
        expect(corpoDeMetodo(ABA, 'async _render() {')).toContain('this._destroyPicker();');
        expect(ABA).toMatch(/this\._alive = false;\s*this\._destroyPicker\(\);/);
    });
});
