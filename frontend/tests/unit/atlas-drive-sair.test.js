// Path: tests/unit/atlas-drive-sair.test.js

/**
 * @fileoverview As três partes PURAS que a cláusula 5.7 e a 5.8 acrescentaram ao cartão de atlas:
 * o NÍVEL de cada participante no rodapé, o gate do item "Sair do atlas", e a frase que a tela diz
 * DEPOIS de sair.
 *
 * ELAS FORAM EXTRAÍDAS PARA SEREM VERIFICÁVEIS. O ambiente aqui é node puro, sem jsdom: o que se
 * pode asserir é o texto e a matriz, nunca o desenho. Por isso `_sharingFooter` e `_leave`
 * carregam só o DOM e a chamada de rede, e toda decisão mora em função exportada.
 *
 * O CONTROLE NEGATIVO É A METADE QUE PRENDE, e cada bloco carrega o seu:
 *
 *   - do gate de "Sair": afirmar que os QUATRO níveis abaixo do topo o veem NÃO discrimina uma
 *     implementação que o mostrasse sempre. O que reprova essa é a asserção de que o DONO não o vê
 *     (o servidor responde 409 a ele) e de que o nível desconhecido também não;
 *   - do agrupamento por nível: afirmar que os nomes aparecem não discrimina uma implementação que
 *     ignorasse `permission` e continuasse escrevendo a lista corrida. O que reprova essa é a
 *     ORDEM (topo da escada primeiro) e o fato de dois membros do mesmo nível dividirem UMA linha;
 *   - da frase pós-saída: afirmar "você saiu" no caso feliz não discrimina um toast incondicional.
 *     O que reprova esse é o caso em que `effectivePermission` volta PREENCHIDO, que é o desfecho
 *     em que a pessoa clicou em sair e continua vendo o atlas.
 *
 * A CLÁUSULA QUE ESTE ARQUIVO NÃO CONSEGUE COBRAR, e vale dizer em voz alta: nenhuma asserção aqui
 * prova que a tela não revela o CAMINHO do acesso. Ela prova que as frases produzidas não nomeiam
 * grupo nenhum, o que é a forma verificável da mesma coisa, e é o máximo que um teste de string
 * alcança.
 */

import { describe, it, expect } from 'vitest';
import {
    cardMenuActions,
    describeCardAccess,
    describeLeaveOutcome,
} from '@js/projects/atlas-drive.js';

/** Os ids das ações, na ordem em que o menu as desenha. */
const ids = (options) => cardMenuActions(options).map((a) => a.id);

/** Os quatro degraus abaixo do topo, que é quem pode sair. */
const CONVIDADOS = ['read', 'comment', 'write', 'manage'];

describe('cardMenuActions — o item "Sair do atlas"', () => {
    it('oferece a saída a TODO nível convidado, do Leitor ao co-Gestor', () => {
        for (const permission of CONVIDADOS) {
            expect(ids({ permission })).toContain('leave');
        }
    });

    it('NÃO oferece a saída ao dono: o servidor responderia 409', () => {
        // O outro lado do gate, e o que reprova um item incondicional. O dono que saísse deixaria
        // o atlas órfão; o servidor recusa nomeando transferir a posse ou a lixeira, e oferecer o
        // que o servidor recusa é o defeito que este lote corrigiu em outra tela.
        expect(ids({ permission: 'owner' })).not.toContain('leave');
    });

    it('NÃO oferece a saída a nível desconhecido, ausente ou não-string', () => {
        // Falha FECHADA num item destrutivo: quem este build não sabe descrever não recebe o
        // botão. Sem esta linha, `!serverTreatsAsAtlasOwner(x)` sozinho o mostraria para tudo.
        for (const permission of ['superuser', '', null, undefined, 3, {}]) {
            expect(ids({ permission })).not.toContain('leave');
        }
        expect(ids(undefined)).not.toContain('leave');
    });

    it('marca a saída como destrutiva e a põe por último', () => {
        const acoes = cardMenuActions({ permission: 'write' });
        expect(acoes.at(-1).id).toBe('leave');
        expect(acoes.at(-1).danger).toBe(true);
        // Só ela: um `danger` genérico pintaria renomear e copiar de vermelho junto.
        expect(acoes.filter((a) => a.danger)).toHaveLength(1);
    });

    it('nunca convive com a lixeira: os dois gates são complementares', () => {
        // `trash` é do dono e `leave` é de quem não é dono, então nenhum nível vê os dois. Se um
        // dia vissem, o cartão ofereceria duas maneiras diferentes de perder o atlas na mesma
        // lista, e a pessoa escolheria a errada.
        for (const permission of [...CONVIDADOS, 'owner']) {
            const lista = ids({ permission });
            expect(lista.includes('trash') && lista.includes('leave')).toBe(false);
        }
    });

    it('carrega o testid por extenso, igual ao que os specs de navegador miram', () => {
        // Montá-lo como `project-picker-${id}` deixa `tests/unit/e2e-testids-existem.test.js` sem
        // literal para achar, e os locators viram órfãos.
        const leave = cardMenuActions({ permission: 'read' }).find((a) => a.id === 'leave');
        expect(leave.testid).toBe('project-picker-leave');
        expect(leave.label).toBe('Sair do atlas');
    });
});

describe('describeCardAccess — o nível de cada participante no rodapé', () => {
    const linha = (members, member_count = members.length) => ({ member_count, members });

    it('não desenha nível nenhum quando não há linha de overview', () => {
        expect(describeCardAccess(null, {})).toBeNull();
    });

    it('não desenha nível no cartão solitário: não há com quem comparar', () => {
        const r = describeCardAccess(linha([{ nome: 'Eu', permission: 'owner' }], 1), {});
        expect(r.levels).toEqual([]);
        expect(r.overflowLabel).toBe('');
        expect(r.summary).toBe('Só você');
    });

    it('reparte UMA pessoa por nível em uma linha por nível, do topo da escada para baixo', () => {
        const r = describeCardAccess(linha([
            { nome: 'Lima', permission: 'read' },
            { nome: 'Silva', posto_graduacao: 'Cap', permission: 'owner' },
            { nome: 'Souza', posto_graduacao: 'Ten', permission: 'write' },
        ]), {});
        // A ORDEM é o controle negativo do agrupamento: uma implementação que só reagrupasse na
        // ordem de chegada devolveria read, owner, write, e passaria em toda asserção de conteúdo.
        expect(r.levels.map((g) => g.permission)).toEqual(['owner', 'write', 'read']);
        expect(r.levels.map((g) => g.label)).toEqual(['Proprietário', 'Edição', 'Leitura']);
        expect(r.levels.map((g) => g.names)).toEqual([['Cap Silva'], ['Ten Souza'], ['Lima']]);
    });

    it('junta VÁRIAS pessoas do mesmo nível numa linha só, na ordem em que o servidor mandou', () => {
        // O que faz o nível caber num cartão: a palavra mais longa da frase escrita UMA vez por
        // nível, e não uma vez por pessoa.
        const r = describeCardAccess(linha([
            { nome: 'Souza', permission: 'write' },
            { nome: 'Lima', permission: 'write' },
            { nome: 'Costa', permission: 'read' },
        ]), {});
        expect(r.levels).toHaveLength(2);
        expect(r.levels[0]).toMatchObject({
            permission: 'write', label: 'Edição', names: ['Souza', 'Lima'], count: 2,
        });
        expect(r.levels[1]).toMatchObject({ permission: 'read', names: ['Costa'], count: 1 });
    });

    it('percorre a escada inteira sem perder degrau, e nenhum nome se repete', () => {
        const membros = ['owner', 'manage', 'write', 'comment', 'read']
            .map((permission, i) => ({ nome: `P${i}`, permission }));
        const r = describeCardAccess(linha(membros.slice().reverse()), {});
        expect(r.levels.map((g) => g.permission)).toEqual([
            'owner', 'manage', 'write', 'comment', 'read',
        ]);
        expect(r.levels.flatMap((g) => g.names).sort()).toEqual(['P0', 'P1', 'P2', 'P3', 'P4']);
    });

    it('degrada para UMA linha SEM rótulo quando o servidor não manda nível', () => {
        // O servidor anterior a 2026-08-23 não mandava `permission`. O rodapé volta a ser a lista
        // corrida de nomes, que é o que ele desenhava antes, em vez de sumir.
        const r = describeCardAccess(linha([{ nome: 'A' }, { nome: 'B' }]), {});
        expect(r.levels).toHaveLength(1);
        expect(r.levels[0].label).toBe('');
        expect(r.levels[0].names).toEqual(['A', 'B']);
    });

    it('põe o grupo SEM rótulo por último, atrás de todo nível conhecido', () => {
        const r = describeCardAccess(linha([{ nome: 'A' }, { nome: 'B', permission: 'read' }]), {});
        expect(r.levels.map((g) => g.label)).toEqual(['Leitura', '']);
    });

    it('não perde ninguém por nível desconhecido: o valor cru vira o rótulo', () => {
        // Mesma escolha do selo do cartão: um selo escrito `superuser` é surpresa legível, e
        // nenhum selo seria a falha silenciosa.
        const r = describeCardAccess(linha([
            { nome: 'X', permission: 'superuser' },
            { nome: 'Y', permission: 'read' },
        ]), {});
        expect(r.levels.map((g) => g.label)).toEqual(['Leitura', 'superuser']);
        expect(r.levels.flatMap((g) => g.names)).toEqual(['Y', 'X']);
    });

    it('conta o excedente FORA dos níveis, porque o servidor não manda o nível de quem cortou', () => {
        const members = Array.from({ length: 10 }, (_, i) => ({ nome: `P${i}`, permission: 'read' }));
        const r = describeCardAccess({ member_count: 14, members }, {});
        expect(r.overflowLabel).toBe('e mais 4 pessoas');
        // O controle negativo: somar o excedente ao último grupo afirmaria um posto que ninguém
        // mediu, e a linha do nível continuaria dizendo "Leitura".
        expect(r.levels).toHaveLength(1);
        expect(r.levels[0].count).toBe(10);
    });

    it('conjuga o excedente e cala quando não há', () => {
        const um = describeCardAccess({
            member_count: 3, members: [{ nome: 'A' }, { nome: 'B' }],
        }, {});
        expect(um.overflowLabel).toBe('e mais 1 pessoa');

        const nenhum = describeCardAccess(linha([{ nome: 'A' }, { nome: 'B' }]), {});
        expect(nenhum.overflowLabel).toBe('');
    });

    it('nunca inventa excedente negativo quando a lista supera a contagem', () => {
        const r = describeCardAccess({
            member_count: 2, members: [{ nome: 'A' }, { nome: 'B' }, { nome: 'C' }],
        }, {});
        expect(r.overflowLabel).toBe('');
    });

    it('não nomeia caminho de acesso em lugar nenhum (cláusula 5.7)', () => {
        // O payload não diz por qual porta cada um entrou, e a tela não pode inventar: "por grupo"
        // entregaria adesão a coletivo alheio.
        const r = describeCardAccess(linha([
            { nome: 'A', permission: 'write' }, { nome: 'B', permission: 'read' },
        ]), {});
        const texto = JSON.stringify(r);
        expect(texto).not.toContain('grupo');
        expect(texto).not.toContain('Grupo');
    });
});

describe('describeLeaveOutcome — o que a tela diz depois de sair', () => {
    it('diz que saiu quando o servidor mediu que não sobrou caminho nenhum', () => {
        const r = describeLeaveOutcome({ removed: true, effectivePermission: null }, 'Operação X');
        expect(r.gone).toBe(true);
        expect(r.tone).toBe('success');
        expect(r.message).toBe('Você saiu de "Operação X". Ele não aparece mais na sua lista.');
    });

    it('NÃO diz que saiu quando sobrou nível: a pessoa continua vendo o atlas', () => {
        // O CONTROLE NEGATIVO DESTE ARQUIVO. Um toast incondicional "você saiu" passa no caso
        // acima e mente aqui, e o usuário descobre a mentira na própria lista, um segundo depois.
        const r = describeLeaveOutcome({ removed: true, effectivePermission: 'read' }, 'Operação X');
        expect(r.gone).toBe(false);
        expect(r.tone).toBe('warning');
        expect(r.message).toContain('Leitura');
        expect(r.message).not.toContain('Você saiu');
    });

    it('distingue "já não participava" de "acabei de sair"', () => {
        // Atlas inexistente e "não participo" respondem IDÊNTICO de propósito, para a rota não
        // virar oráculo de existência; repetir a chamada cai aqui.
        const r = describeLeaveOutcome({ removed: false, effectivePermission: null }, 'Operação X');
        expect(r.gone).toBe(true);
        expect(r.tone).toBe('info');
        expect(r.message).toBe('Você já não participava de "Operação X". Nada mudou.');
    });

    it('distingue o convite retirado do acesso que nunca foi convite', () => {
        const retirado = describeLeaveOutcome({ removed: true, effectivePermission: 'write' }, 'X');
        const nunca = describeLeaveOutcome({ removed: false, effectivePermission: 'write' }, 'X');
        expect(retirado.message).not.toBe(nunca.message);
        expect(retirado.message).toContain('foi retirado');
        expect(nunca.message).toContain('não tinha convite direto');
    });

    it('nomeia o nível remanescente por extenso, degrau a degrau', () => {
        const rotulos = ['read', 'comment', 'write', 'manage', 'owner']
            .map((p) => describeLeaveOutcome({ removed: true, effectivePermission: p }).message);
        expect(rotulos.map((m) => m.includes('Leitura'))).toContain(true);
        for (const [i, esperado] of [
            'Leitura', 'Comentário', 'Edição', 'Gestão', 'Proprietário',
        ].entries()) {
            expect(rotulos[i]).toContain(esperado);
        }
    });

    it('trata um nível que este build não conhece como acesso remanescente', () => {
        // Falha para o lado seguro: dizer "você saiu" para um degrau novo do servidor seria a
        // afirmação errada, e o valor cru ao menos é legível.
        const r = describeLeaveOutcome({ removed: true, effectivePermission: 'superuser' }, 'X');
        expect(r.gone).toBe(false);
        expect(r.message).toContain('superuser');
    });

    it('NUNCA nomeia a porta que sobrou (cláusula 5.7)', () => {
        // O servidor não diz qual é, e adivinhar "por um grupo" entregaria adesão a coletivo
        // alheio. A frase diz que existe outra porta, e de que tamanho ela é.
        const r = describeLeaveOutcome({ removed: true, effectivePermission: 'read' }, 'X');
        expect(r.message).not.toContain('grupo');
        expect(r.message).toContain('outro caminho');
    });

    it('contrai a preposição no atlas sem nome, em vez de deixar aspas vazias', () => {
        // "de este atlas" e "a este atlas" seriam as contrações erradas de um alvo montado por
        // concatenação, e o atlas sem nome é estado real: o servidor responde igual a atlas
        // inexistente, de propósito, para a rota não virar oráculo.
        for (const nome of ['', '   ', null, undefined]) {
            const saiu = describeLeaveOutcome({ removed: true, effectivePermission: null }, nome);
            expect(saiu.message).toBe('Você saiu deste atlas. Ele não aparece mais na sua lista.');
            expect(saiu.message).not.toContain('""');

            const sobrou = describeLeaveOutcome({ removed: true, effectivePermission: 'read' }, nome);
            expect(sobrou.message).toContain('convite direto a este atlas');
            expect(sobrou.message).not.toContain('""');
        }
    });

    it('sobrevive a resposta ausente ou malformada, sem prometer saída', () => {
        for (const entrada of [null, undefined, {}, 'não é objeto', 7]) {
            const r = describeLeaveOutcome(entrada, 'X');
            // Sem `removed: true` não houve remoção medida, então a frase é a do estado já
            // alcançado, e não a comemoração.
            expect(r.gone).toBe(true);
            expect(r.tone).toBe('info');
            expect(r.message).toContain('já não participava');
        }
    });
});
