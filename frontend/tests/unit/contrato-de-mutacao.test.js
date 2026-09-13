// Path: tests/unit/contrato-de-mutacao.test.js

/**
 * @fileoverview O que uma operação DECLARA: a revisão que observou e as unidades que mudou.
 *
 * A DECLARAÇÃO É O GATILHO, e é por isso que estes casos são finos. O servidor liga a verificação
 * de base por entidade quando, e só quando, a operação DECLARA uma base (`hasDeclaredBase`,
 * `backend/src/modules/sync/entity-conflicts.js`); enquanto só a feição declarava, todas as outras
 * entidades eram aplicadas por ordem de chegada. Um `baseVersion` a mais liga a verificação para
 * uma entidade inteira, um a menos a desliga, e nenhum dos dois erros aparece em tela.
 *
 * O CASO QUE MAIS IMPORTA É O DA BASE AUSENTE. Sem revisão confirmada (atlas local, documento que
 * nunca voltou do servidor, snapshot de um build anterior ao campo) a operação tem de sair como
 * saía antes: sem base e sem patch. Essa é a degradação, e ela precisa continuar barata, porque a
 * alternativa (recusar-se a enviar) transformaria um número ausente em trabalho perdido.
 */

import { describe, it, expect } from 'vitest';
import { entityMutationContract, mutationContract, claimedUnits } from '../../src/js/store/sync/mutation-contract.js';

const camada = (extra = {}) => ({
    id: 'l1', name: 'Alfa', visible: true, locked: false, opacity: 1, order: 0,
    version: 3, createdAt: 1, updatedAt: 2, ...extra,
});

describe('o contrato de mutação por entidade', () => {
    it('declara a base observada e SÓ os campos que mudaram', () => {
        const antes = camada({ confirmedVersion: 7 });
        const depois = camada({ confirmedVersion: 7, name: 'Bravo', version: 4, updatedAt: 99 });

        expect(entityMutationContract('layer', 'update', depois, antes)).toEqual({
            protocolVersion: 2, baseVersion: 7,
            patch: [{ op: 'set', path: ['name'], value: 'Bravo' }],
        });
    });

    it('a escrituração local NÃO é mudança: version, updatedAt e a própria base ficam de fora', () => {
        // `version` conta as escritas DESTE cliente e anda em toda edição; se entrasse no patch,
        // toda operação reivindicaria uma unidade que ninguém tocou.
        const antes = camada({ confirmedVersion: 7 });
        const depois = camada({ confirmedVersion: 9, version: 4, updatedAt: 99, createdAt: 5 });
        expect(entityMutationContract('layer', 'update', depois, antes).patch).toEqual([]);
    });

    it('campo que SAIU do documento vira remoção, não some do patch', () => {
        const antes = camada({ confirmedVersion: 7, style: { cor: 'azul' } });
        const depois = camada({ confirmedVersion: 7 });
        expect(entityMutationContract('layer', 'update', depois, antes).patch)
            .toEqual([{ op: 'remove', path: ['style'] }]);
    });

    it('sem base conhecida a operação sai SEM base e SEM patch', () => {
        const antes = camada();
        const depois = camada({ name: 'Bravo' });
        expect(entityMutationContract('layer', 'update', depois, antes))
            .toEqual({ protocolVersion: 2, baseVersion: null, patch: null });
    });

    it('criar e excluir não carregam patch, e o excluir ainda declara a base', () => {
        const antes = camada({ confirmedVersion: 7 });
        expect(entityMutationContract('layer', 'create', camada(), null))
            .toEqual({ protocolVersion: 2, baseVersion: null, patch: null });
        // Uma exclusão reivindica a entidade INTEIRA: nada pode ter se mexido desde a versão que
        // a pessoa estava vendo quando decidiu remover. É o que o servidor cobra.
        expect(entityMutationContract('layer', 'delete', null, antes))
            .toEqual({ protocolVersion: 2, baseVersion: 7, patch: null });
    });

    it('as unidades reivindicadas saem do patch, e a posição do mapa é UMA', () => {
        const antes = { confirmedVersion: 2, zoom: 5, bearing: 0, pitch: 0, name: 'Mapa' };
        const depois = { confirmedVersion: 2, zoom: 9, bearing: 30, pitch: 0, name: 'Mapa' };
        const contrato = entityMutationContract('mapPosition', 'update', depois, antes);
        expect(contrato.patch.map((e) => e.path[0])).toEqual(['zoom', 'bearing']);
        expect(claimedUnits('mapPosition', contrato.patch)).toEqual(['posicao']);
    });

    it('renomear um mapa reivindica só `nome`, e travar só `travado`', () => {
        const renomear = entityMutationContract('map', 'update',
            { name: 'Novo', confirmedVersion: 4 }, { name: 'Velho', confirmedVersion: 4 });
        expect(claimedUnits('map', renomear.patch)).toEqual(['nome']);
        const travar = entityMutationContract('map', 'update',
            { locked: true, confirmedVersion: 4 }, { locked: false, confirmedVersion: 4 });
        expect(claimedUnits('map', travar.patch)).toEqual(['travado']);
    });

    it('a entidade de documento inteiro reivindica UMA unidade, mudem quantos campos mudarem', () => {
        const antes = { confirmedVersion: 3, tilesetId: 'a', nome: 'X', cor: '#fff' };
        const depois = { confirmedVersion: 3, tilesetId: 'a', nome: 'Y', cor: '#000' };
        const contrato = entityMutationContract('marker3d', 'update', depois, antes);
        expect(contrato.patch).toHaveLength(2);
        expect(claimedUnits('marker3d', contrato.patch)).toEqual(['documento']);
    });

    it('o payload inteiro de uma camada reivindica TODAS as unidades que carrega', () => {
        // É o veredito honesto, não uma aproximação: a escrita realmente é dessa largura, então
        // uma base velha sobrescreveria todas elas. Quem manda payload estreito (mapa, sub-tipos)
        // ganha a precisão da tabela; quem manda documento inteiro, não.
        const antes = camada({ confirmedVersion: 7 });
        const depois = camada({ confirmedVersion: 7, name: 'B', visible: false, opacity: 0.5 });
        expect(claimedUnits('layer', entityMutationContract('layer', 'update', depois, antes).patch))
            .toEqual(['nome', 'visivel', 'opacidade']);
    });

    it('entidade sem unidade de disputa não declara nada', () => {
        // Membresia de grupo (junção idempotente) e preferência de atlas (merge por chave) não
        // têm perdedor. Declarar base ali ligaria uma verificação que o servidor não sabe fazer.
        expect(mutationContract('groupFeature', 'create', { group_id: 'g' }, null)).toEqual({});
        expect(mutationContract('setting', 'update', { colorUsage: {} }, { colorUsage: {} })).toEqual({});
    });

    it('a feição continua pelo contrato dela, com o patch dentro de `properties`', () => {
        const feicao = (nome, props = {}) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] },
            properties: { id: 'f1', source: 'point', nome, ...props } });
        const contrato = mutationContract('feature', 'update',
            feicao('Novo', { confirmedVersion: 5 }), feicao('Velho', { confirmedVersion: 5 }));
        expect(contrato).toEqual({
            protocolVersion: 2, baseVersion: 5,
            patch: [{ op: 'set', path: ['properties', 'nome'], value: 'Novo' }],
        });
    });

    it('não quebra com documento ausente dos dois lados', () => {
        expect(entityMutationContract('layer', 'update', null, null))
            .toEqual({ protocolVersion: 2, baseVersion: null, patch: null });
        expect(claimedUnits('layer', null)).toEqual([]);
    });
});
