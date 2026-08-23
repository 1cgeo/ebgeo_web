// Path: tests/unit/grupo-acesso-sair.test.js
//
// SAIR DO GRUPO POR CONTA PRÓPRIA (cláusula 4.7), do lado da tela.
//
// O DEFEITO MEDIDO: a seção "Grupos de que participo" mostrava nome e dono e NADA MAIS, sem
// botão nenhum, e a única remoção existente (`DELETE .../members/:userId`) passa por
// `requireGroupAuthority`, que responde 404 ao próprio membro. Participar era um estado sem
// saída pela interface: quem foi posto num grupo por outra pessoa só saía pedindo a ela.
//
// SÃO DUAS ASSERÇÕES DE NATUREZAS DIFERENTES, como em `aviso-de-retirada-de-acesso.test.js`:
//   1. UNIDADE: as frases puras de `js/admin/group-phrases.js`, com zero, um e vários, mais o
//      caso do DONO, que é a exceção estrutural (o predicado de administração exige dono VIVO,
//      então o servidor responde 409 a ele).
//   2. ESTRUTURA: a aba consome as frases, pede confirmação ANTES da escrita, e o botão é
//      GATEADO. A segunda metade importa tanto quanto a primeira: uma frase de aviso perfeita
//      que nenhum chamador exibe é cobertura vazia, e um botão oferecido ao dono é oferecer o
//      que o servidor recusa.
//
// A DISCRIMINAÇÃO QUE ESTE ARQUIVO COBRA, e sem a qual todo `toContain` passaria verde: os
// três ramos de `leaveGroupSummary` precisam ser DIFERENTES entre si (a resposta idempotente
// não pode dizer o mesmo que o ato realizado), e os três estados de `leaveGroupAvailability`
// também. Zero NÃO vira frase, pelo mesmo motivo do irmão `memberRemovalSummary`: "0 acessos
// revogados" transforma o caso comum num susto.
//
// O QUE ESTE ARQUIVO NÃO PODE COBRAR é número no aviso PRÉVIO, e isso é medição do servidor,
// não omissão: `LIST_GROUPS_OF_MEMBER` devolve `id`, `name`, `owner_id`, `owner_username` e
// `owner_nome`, e mais nada. Sem contagem na listagem, uma frase que dissesse "você perde
// acesso a N recursos" estaria fabricando aritmética. O número existe DEPOIS do ato, e vem do
// `grantsAffected` do servidor.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import {
    LEAVE_AVAILABILITY,
    leaveGroupAvailability,
    leaveGroupWarning,
    leaveGroupSummary,
    groupOwnerCannotLeaveNotice,
    participatingReachUnknownNotice,
} from '../../src/js/admin/group-phrases.js';

const URL_GROUPS_TAB = new URL('../../src/js/admin/groups-tab.js', import.meta.url);

/**
 * Comentário fora, para que a varredura estrutural veja CÓDIGO e nunca prosa que cite o
 * símbolo. Este repositório já teve duas vezes um guarda que ficou verde porque um COMENTÁRIO
 * citava o símbolo que a chamada tinha perdido.
 *
 * O SCANNER É CIENTE DE LITERAL DE STRING, e não um par de `replace`, porque a forma regex só
 * alcança o comentário de LINHA INTEIRA: um `// apiClient.leaveGroup(` no fim de uma linha de
 * código sobreviveria e faria toda asserção passar sem chamada nenhuma. Ele também precisa
 * parar dentro de string, senão um `'https://…'` engoliria o resto da linha.
 * (Mesmo desenho de `aviso-de-perda-de-recursos.test.js`, sem o modo de esvaziar literais,
 * que aqui não tem uso: nenhuma asserção deste arquivo casa chaves.)
 *
 * @param {string} fonte
 * @returns {string}
 */
function semComentarios(fonte) {
    let saida = '';
    let i = 0;
    while (i < fonte.length) {
        const atual = fonte[i];
        const proximo = fonte[i + 1];
        if (atual === '/' && proximo === '/') {
            while (i < fonte.length && fonte[i] !== '\n') i++;
            continue;
        }
        if (atual === '/' && proximo === '*') {
            i += 2;
            while (i < fonte.length && !(fonte[i] === '*' && fonte[i + 1] === '/')) i++;
            i += 2;
            continue;
        }
        if (atual === '"' || atual === "'" || atual === '`') {
            saida += atual;
            i++;
            while (i < fonte.length) {
                if (fonte[i] === '\\') {
                    saida += fonte[i] + (fonte[i + 1] ?? '');
                    i += 2;
                    continue;
                }
                const fechou = fonte[i] === atual;
                saida += fonte[i];
                i++;
                if (fechou) break;
            }
            continue;
        }
        saida += atual;
        i++;
    }
    return saida;
}

const FONTE_ABA = semComentarios(readFileSync(URL_GROUPS_TAB, 'utf8'));

// ============================================================================
// (1) A UNIDADE: as frases
// ============================================================================

describe('leaveGroupAvailability — quem pode sair, decidido com o que a listagem traz', () => {
    it('quem NÃO é dono pode sair', () => {
        expect(leaveGroupAvailability({ owner_id: 'u-outra' }, 'u-eu'))
            .toBe(LEAVE_AVAILABILITY.PODE);
    });

    it('O CASO DO DONO: ele não recebe a ação, porque o servidor lhe responde 409', () => {
        expect(leaveGroupAvailability({ owner_id: 'u-eu' }, 'u-eu'))
            .toBe(LEAVE_AVAILABILITY.DONO);
    });

    it('compara por String: um uuid vindo do JSON e outro da sessão não podem divergir por tipo', () => {
        expect(leaveGroupAvailability({ owner_id: 42 }, '42')).toBe(LEAVE_AVAILABILITY.DONO);
        expect(leaveGroupAvailability({ owner_id: '42' }, 42)).toBe(LEAVE_AVAILABILITY.DONO);
    });

    it('DISCRIMINAÇÃO: os dois ramos de ausência caem para lados OPOSTOS', () => {
        // Grupo sem dono é estado real (o backfill adota `created_by`, que pode ser nulo):
        // ninguém é dono, logo quem pergunta certamente não é, e pode sair.
        expect(leaveGroupAvailability({ owner_id: null }, 'u-eu')).toBe(LEAVE_AVAILABILITY.PODE);
        expect(leaveGroupAvailability({}, 'u-eu')).toBe(LEAVE_AVAILABILITY.PODE);
        // Sem saber quem olha, a tela não mediu nada: não oferece o ato irreversível, e
        // tampouco acusa a pessoa de ser dona.
        expect(leaveGroupAvailability({ owner_id: 'u-outra' }, null))
            .toBe(LEAVE_AVAILABILITY.INDETERMINADO);
        expect(leaveGroupAvailability({ owner_id: 'u-outra' }, undefined))
            .toBe(LEAVE_AVAILABILITY.INDETERMINADO);
        expect(leaveGroupAvailability({ owner_id: 'u-outra' }, ''))
            .toBe(LEAVE_AVAILABILITY.INDETERMINADO);
    });

    it('grupo ausente não explode e não oferece dono nenhum', () => {
        expect(leaveGroupAvailability(null, 'u-eu')).toBe(LEAVE_AVAILABILITY.PODE);
        expect(leaveGroupAvailability(undefined, undefined)).toBe(LEAVE_AVAILABILITY.PODE);
    });

    it('os três estados são valores DISTINTOS, senão o gate da tela colapsaria dois ramos', () => {
        const valores = new Set(Object.values(LEAVE_AVAILABILITY));
        expect(valores.size).toBe(3);
    });
});

describe('leaveGroupWarning — a consequência, sem número inventado', () => {
    const aviso = leaveGroupWarning({ name: 'Turma Bravo' });

    it('nomeia o grupo', () => {
        expect(aviso).toContain('"Turma Bravo"');
    });

    it('diz o que CAI: o que o grupo dava, nos DOIS eixos (recurso e atlas)', () => {
        expect(aviso).toContain('recursos privados');
        expect(aviso).toContain('atlas compartilhados');
    });

    it('diz o que SOBREVIVE: o acesso por autoridade própria', () => {
        expect(aviso).toContain('por conta própria continua valendo');
    });

    it('diz que ela NÃO VOLTA SOZINHA, que é o que torna a saída irreversível para ela', () => {
        expect(aviso).toContain('não volta sozinho');
        expect(aviso).toContain('quem administra o grupo');
    });

    it('NÃO INVENTA NÚMERO: a listagem que serve esta seção não traz contagem nenhuma', () => {
        // A discriminação é o dígito: qualquer contagem citada aqui viria de lugar nenhum.
        expect(aviso).not.toMatch(/\d/);
        expect(aviso).toContain('não sabe quantos acessos caem');
    });

    it('grupo sem nome não vira "undefined" na cara de quem vai clicar', () => {
        expect(leaveGroupWarning({})).not.toContain('undefined');
        expect(leaveGroupWarning(null)).not.toContain('undefined');
    });
});

describe('leaveGroupSummary — o efeito MEDIDO, com o número do servidor', () => {
    it('ZERO: a saída aconteceu e nada caiu, então nada é anunciado', () => {
        expect(leaveGroupSummary({ name: 'Bravo', removed: true, grantsAffected: 0 }))
            .toBe('Você saiu do grupo "Bravo".');
    });

    it('UM: singular no número, sem "1 acessos"', () => {
        expect(leaveGroupSummary({ name: 'Bravo', removed: true, grantsAffected: 1 }))
            .toBe('Você saiu do grupo "Bravo". Acessos revogados: 1.');
    });

    it('VÁRIOS, inclusive a contagem que chega como STRING do COUNT do Postgres', () => {
        expect(leaveGroupSummary({ name: 'Bravo', removed: true, grantsAffected: 7 }))
            .toBe('Você saiu do grupo "Bravo". Acessos revogados: 7.');
        expect(leaveGroupSummary({ name: 'Bravo', removed: true, grantsAffected: '7' }))
            .toBe('Você saiu do grupo "Bravo". Acessos revogados: 7.');
    });

    it('DISCRIMINAÇÃO: a resposta idempotente NÃO diz que a pessoa saiu', () => {
        // `removed: false` cobre três situações que o servidor deliberadamente não distingue:
        // grupo inexistente, "não participo" e o segundo clique. Dizer "você saiu" ali
        // afirmaria uma mudança que não houve.
        const naoParticipava = leaveGroupSummary({ name: 'Bravo', removed: false, grantsAffected: 0 });
        expect(naoParticipava).toBe('Você já não participava do grupo "Bravo".');
        expect(naoParticipava).not.toBe(leaveGroupSummary({ name: 'Bravo', removed: true, grantsAffected: 0 }));
    });

    it('um servidor que não mande `removed` cai no ramo do ato, não no da negativa', () => {
        expect(leaveGroupSummary({ name: 'Bravo', grantsAffected: 2 }))
            .toBe('Você saiu do grupo "Bravo". Acessos revogados: 2.');
    });

    it('lixo na contagem não vira NaN na tela', () => {
        expect(leaveGroupSummary({ name: 'Bravo', removed: true, grantsAffected: 'abc' }))
            .toBe('Você saiu do grupo "Bravo".');
        expect(leaveGroupSummary({ name: 'Bravo', removed: true, grantsAffected: -3 }))
            .toBe('Você saiu do grupo "Bravo".');
        expect(leaveGroupSummary(null)).not.toContain('undefined');
    });
});

describe('as duas frases de ausência — elas explicam, em vez de deixar espaço vazio', () => {
    it('a recusa ao dono nomeia os DOIS caminhos que o servidor nomeia', () => {
        const nota = groupOwnerCannotLeaveNotice();
        expect(nota).toContain('Apague o grupo');
        expect(nota).toContain('transfira a posse');
    });

    it('a ressalva de escopo impede que a ausência do número se leia como zero', () => {
        const nota = participatingReachUnknownNotice();
        expect(nota).toContain('quem o administra');
        expect(nota).toContain('não quer dizer que ele seja zero');
    });
});

// ============================================================================
// (2) A ESTRUTURA: a aba consome as frases, gateia o botão e confirma antes
// ============================================================================

describe('groups-tab.js — a estrutura da saída', () => {
    it('chama a rota pelo nome do contrato', () => {
        expect(FONTE_ABA).toContain('apiClient.leaveGroup(');
    });

    it('PEDE CONFIRMAÇÃO ANTES DA ESCRITA, e não depois', () => {
        const confirma = FONTE_ABA.indexOf('leaveGroupWarning(');
        const escreve = FONTE_ABA.indexOf('apiClient.leaveGroup(');
        expect(confirma).toBeGreaterThan(-1);
        expect(escreve).toBeGreaterThan(-1);
        expect(confirma).toBeLessThan(escreve);
    });

    it('a confirmação é DESTRUTIVA e usa a frase, nunca um "Tem certeza?"', () => {
        expect(FONTE_ABA).toMatch(/message:\s*leaveGroupWarning\(group\)/);
        expect(FONTE_ABA).toContain('destructive: true');
    });

    it('o toast pós-ação usa o número do SERVIDOR, não um "Sucesso" genérico', () => {
        expect(FONTE_ABA).toMatch(/showSuccess\(leaveGroupSummary\(/);
    });

    it('O BOTÃO É GATEADO: ele não sai sem passar pela disponibilidade', () => {
        expect(FONTE_ABA).toContain('leaveGroupAvailability(group, viewerId)');
        expect(FONTE_ABA).toContain('LEAVE_AVAILABILITY.PODE');
        expect(FONTE_ABA).toContain('LEAVE_AVAILABILITY.DONO');
    });

    it('os testids são LITERAIS por extenso, que é o que o guarda de e2e procura', () => {
        expect(FONTE_ABA).toContain("'admin-group-leave'");
        expect(FONTE_ABA).toContain("'admin-group-leave-blocked'");
        expect(FONTE_ABA).toContain("'admin-groups-participating-note'");
    });

    it('CONTROLE: o removedor de comentários continua vendo o código e deixou de ver a prosa', () => {
        // O par prova as duas metades, e o comentário está no FIM DA LINHA de propósito: é a
        // forma que a versão regex deste helper deixava passar.
        const par = semComentarios('const a = 1; // apiClient.inventado(\nconst b = 2;');
        expect(par).toContain('const a = 1;');
        expect(par).toContain('const b = 2;');
        expect(par).not.toContain('apiClient.inventado(');
        // E não pode comer código que MORA dentro de uma string.
        expect(semComentarios("const u = 'https://exemplo/x'; // fora"))
            .toContain("'https://exemplo/x'");
    });
});
