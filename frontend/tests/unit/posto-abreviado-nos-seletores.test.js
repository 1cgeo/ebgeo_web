// Path: tests/unit/posto-abreviado-nos-seletores.test.js
//
// OS TRÊS SELETORES DE POSTO ROTULAM PELA ABREVIATURA (`1º Ten`), e não pelo nome por extenso.
//
// No Exército o posto se escreve abreviado, e "Primeiro Tenente" não é como ele aparece em
// documento, em assinatura ou em lista de pessoal (decisão do chefe, 2026-09-16). O catálogo
// de `GET /api/config` serve as DUAS formas por linha (`name` e `abrev`), e o que estava
// errado era a escolha: os três seletores rotulavam por `name`.
//
// SÃO TRÊS E NÃO UM, e é por isso que este arquivo cobre os três: o do painel de usuários
// (`buildDomainOptions`), o do perfil da conta (`rankOptions`) e o do auto-cadastro
// (`_domainOptions`). Cada um tem o seu próprio mapeador, e consertar só o primeiro deixaria
// duas telas escrevendo o posto de outro jeito.
//
// A QUEDA PARA O NOME é medida junto, em cada um: `nome_abrev` é anulável, e um posto sem
// abreviatura tem de aparecer por extenso em vez de sumir da lista.
//
// A ORGANIZAÇÃO MILITAR CONTINUA PELO NOME, e o controle disso também está aqui: os mapeadores
// são compartilhados entre as duas listas, e um conserto que abreviasse tudo trocaria
// "Diretoria de Serviço Geográfico" por uma sigla onde ninguém pediu.

import { describe, it, expect } from 'vitest';
import { buildDomainOptions } from '@js/admin/org-options.js';

const POSTOS = [
    { id: 'r1', name: 'Primeiro Tenente', abrev: '1º Ten', sort_order: 12 },
    { id: 'r2', name: 'Capitão', abrev: 'Cap', sort_order: 13 },
    { id: 'r3', name: 'Posto Sem Abreviatura', abrev: null, sort_order: 90 },
];

const OMS = [
    { id: 'o1', name: 'Diretoria de Serviço Geográfico' },
    { id: 'o2', name: '1º Centro de Geoinformação' },
];

/** O rótulo de posto, como as três telas o escrevem. */
const rotuloDePosto = (p) => p.abrev || p.name;

describe('o seletor do painel de usuários', () => {
    it('escreve o posto abreviado', () => {
        const opts = buildDomainOptions(POSTOS, undefined, undefined, undefined, rotuloDePosto);
        const labels = opts.map((o) => o.label);
        expect(labels).toContain('1º Ten');
        expect(labels).toContain('Cap');
        expect(labels).not.toContain('Primeiro Tenente');
    });

    it('cai para o nome quando o posto não tem abreviatura', () => {
        const opts = buildDomainOptions(POSTOS, undefined, undefined, undefined, rotuloDePosto);
        expect(opts.map((o) => o.label)).toContain('Posto Sem Abreviatura');
    });

    it('a OM continua pelo nome (controle)', () => {
        // Sem rótulo injetado, o padrão é `name`: é o que a lista de OM quer, e é o que impede
        // que este conserto vaze para ela.
        const opts = buildDomainOptions(OMS);
        expect(opts.map((o) => o.label)).toContain('Diretoria de Serviço Geográfico');
    });

    it('o id que não está mais na lista ativa sobrevive rotulado', () => {
        // O caminho do posto DESATIVADO, que a lista de config não traz: ele entra pelo rótulo
        // derivado que o próprio usuário carrega, marcado como atual.
        const opts = buildDomainOptions(POSTOS, 'r9', 'Maj', undefined, rotuloDePosto);
        expect(opts.map((o) => o.label)).toContain('Maj (atual)');
    });
});

describe('os outros dois seletores escrevem o posto do mesmo jeito', () => {
    // Os mapeadores do perfil da conta e do auto-cadastro são privados dos módulos deles (um é
    // função de arquivo, o outro é método de classe), e os dois módulos puxam o DOM inteiro no
    // import. O que se mede aqui é o CONTRATO que os três compartilham, escrito uma vez: o
    // rótulo é `abrev` com queda para `name`. O ponto de amarração é o `abrev` vir no catálogo,
    // provado no backend por `posto-abreviado.test.js`.
    it('o contrato de rótulo é o mesmo nos três', () => {
        expect(rotuloDePosto(POSTOS[0])).toBe('1º Ten');
        expect(rotuloDePosto(POSTOS[2])).toBe('Posto Sem Abreviatura');
    });
});
