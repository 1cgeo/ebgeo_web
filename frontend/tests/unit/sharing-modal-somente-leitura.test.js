// Path: tests/unit/sharing-modal-somente-leitura.test.js
//
// O MODO PARTICIPANTES do modal de compartilhar: a metade verificável em node.
//
// POR QUE ELE EXISTE. A cláusula 5.7 do estatuto do produto diz que todo participante vê quem
// mais participa e com que nível. O cartão do atlas em `atlas.html` já cumpria; dentro do MAPA
// não havia nada equivalente, e desde 2026-08-23 o botão "Compartilhar" some para quem não gere,
// o que deixaria a pergunta sem porta nenhuma.
//
// A DECISÃO QUE ESTE ARQUIVO PRENDE, e que é a parte cara de acertar: a fonte NÃO pode ser
// `GET /atlas/:atlasId/sharing`, porque as quatro rotas daquele grupo exigem `manage` e um modo
// de leitura que a chamasse tomaria 403 de exatamente quem ele serve. A fonte escolhida é
// `GET /atlas/overview`, que pede só uma conta e traz `permission` por membro. As três fontes
// medidas estão no cabeçalho de `participantsFromOverview`.
//
// O QUE ESTE ARQUIVO NÃO ALCANÇA, dito para ninguém confundir verde com pronto: o render, o
// título do modal e a ausência de controles na tela só se verificam por captura do Playwright,
// que fica FORA do `npm test`. O que se mede aqui é o PARSE do payload e as FRASES.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    participantsFromOverview,
    readOnlySharingNotice,
    hiddenParticipantsLabel,
} from '../../src/js/modals/sharing.modal.core.js';

const ATLAS = '11111111-2222-3333-4444-555555555555';

/** Uma linha de `GET /atlas/overview` como o servidor a monta (`LIST_USER_ATLAS_MEMBERS`). */
const linha = (over = {}) => ({
    id: ATLAS,
    member_count: 3,
    members: [
        { id: 'u0', nome: 'Ana Lima', posto_graduacao: 'Cap', permission: 'owner' },
        { id: 'u1', nome: 'Bruno Sá', posto_graduacao: 'Sd', permission: 'write' },
        { id: 'u2', nome: 'Carla Reis', posto_graduacao: '1º Ten', permission: 'read' },
    ],
    ...over,
});

const payload = (over = {}) => ({ atlases: [linha(over)], covers: {}, presence: {} });

describe('participantsFromOverview', () => {
    it('PISO: acha a linha do atlas e traduz cada membro em nome, posto e nível', () => {
        const out = participantsFromOverview(payload(), ATLAS);
        expect(out).not.toBeNull();
        expect(out.total).toBe(3);
        expect(out.hidden).toBe(0);
        expect(out.participants).toHaveLength(3);
        expect(out.participants[0]).toEqual({
            userId: 'u0', label: 'Cap Ana Lima', permission: 'owner', levelLabel: 'Proprietário',
        });
        expect(out.participants.map((p) => p.levelLabel))
            .toEqual(['Proprietário', 'Edição', 'Leitura']);
    });

    it('a ordem é a da ESCADA, do topo para baixo, e não a do payload', () => {
        const embaralhado = payload({
            members: [
                { id: 'u2', nome: 'Carla', permission: 'read' },
                { id: 'u0', nome: 'Ana', permission: 'owner' },
                { id: 'u3', nome: 'Davi', permission: 'manage' },
                { id: 'u1', nome: 'Bruno', permission: 'comment' },
            ],
            member_count: 4,
        });
        // ABSOLUTA: `read < comment < write < manage < owner`, lida de cima para baixo.
        expect(participantsFromOverview(embaralhado, ATLAS).participants.map((p) => p.permission))
            .toEqual(['owner', 'manage', 'comment', 'read']);

        // DISCRIMINAÇÃO: uma implementação que devolvesse o payload como veio daria outra coisa.
        expect(embaralhado.atlases[0].members.map((m) => m.permission))
            .toEqual(['read', 'owner', 'manage', 'comment']);
    });

    it('nível DESCONHECIDO vai para o FIM e mantém o rótulo cru', () => {
        const out = participantsFromOverview(payload({
            members: [
                { id: 'u9', nome: 'Zeca', permission: 'superuser' },
                { id: 'u1', nome: 'Bruno', permission: 'read' },
            ],
            member_count: 2,
        }), ATLAS);

        expect(out.participants.map((p) => p.label)).toEqual(['Bruno', 'Zeca']);
        // Um selo escrito `superuser` é uma surpresa legível; selo nenhum é uma silenciosa.
        expect(out.participants[1].levelLabel).toBe('superuser');
        // DISCRIMINAÇÃO: o conhecido continua traduzido.
        expect(out.participants[0].levelLabel).toBe('Leitura');
    });

    it('a lista CORTADA em dez é dita, nunca disfarçada', () => {
        const dez = Array.from({ length: 10 }, (_, i) => ({
            id: `u${i}`, nome: `Pessoa ${i}`, permission: 'read',
        }));
        const out = participantsFromOverview(payload({ members: dez, member_count: 27 }), ATLAS);
        expect(out.participants).toHaveLength(10);
        expect(out.total).toBe(27);
        expect(out.hidden).toBe(17);

        // DISCRIMINAÇÃO: quando o servidor não cortou nada, não há excedente a dizer.
        expect(participantsFromOverview(payload(), ATLAS).hidden).toBe(0);
    });

    it('atlas SEM LINHA devolve null, que é outro fato de "ninguém mais participa"', () => {
        // A distinção importa: `null` é "não consegui saber" (o atlas não veio no overview, por
        // exemplo porque o pedido falhou ou porque este principal não o alcança pela rota), e a
        // tela precisa dizer isso em vez de desenhar uma lista vazia com cara de resposta.
        expect(participantsFromOverview(payload(), 'outro-id')).toBeNull();
        expect(participantsFromOverview({ atlases: [] }, ATLAS)).toBeNull();
        expect(participantsFromOverview(null, ATLAS)).toBeNull();
        expect(participantsFromOverview(undefined, ATLAS)).toBeNull();
        expect(participantsFromOverview(payload(), '')).toBeNull();
        expect(participantsFromOverview(payload(), null)).toBeNull();

        // DISCRIMINAÇÃO: com o id certo ela não devolve null.
        expect(participantsFromOverview(payload(), ATLAS)).not.toBeNull();
    });

    it('payload degradado não derruba a tela: membros ausentes viram lista vazia', () => {
        const semMembros = participantsFromOverview(
            { atlases: [{ id: ATLAS, member_count: 4 }] }, ATLAS,
        );
        expect(semMembros.participants).toEqual([]);
        expect(semMembros.total).toBe(4);
        expect(semMembros.hidden).toBe(4);

        // `member_count` ausente ou absurdo cai para o tamanho da lista, nunca para NaN.
        const semContagem = participantsFromOverview(payload({ member_count: undefined }), ATLAS);
        expect(semContagem.total).toBe(3);
        expect(semContagem.hidden).toBe(0);
        const contagemLixo = participantsFromOverview(payload({ member_count: 'muitos' }), ATLAS);
        expect(contagemLixo.total).toBe(3);
        expect(Number.isNaN(contagemLixo.hidden)).toBe(false);
        // Contagem MENOR que a lista não pode virar excedente negativo.
        expect(participantsFromOverview(payload({ member_count: 1 }), ATLAS).hidden).toBe(0);
    });

    it('uma pessoa SEM NOME continua na lista, nomeada como tal', () => {
        // Apagá-la encurtaria a lista sem baixar a contagem ao lado, que é a forma de erro em
        // que a tela se contradiz sozinha.
        const out = participantsFromOverview(payload({
            members: [{ id: 'u7', permission: 'write' }, { id: 'u8', nome: '   ', permission: 'read' }],
            member_count: 2,
        }), ATLAS);
        expect(out.participants.map((p) => p.label)).toEqual(['Alguém', 'Alguém']);
        expect(out.hidden).toBe(0);

        // DISCRIMINAÇÃO: quem TEM nome não vira "Alguém", e o posto entra antes dele.
        expect(participantsFromOverview(payload(), ATLAS).participants.map((p) => p.label))
            .toEqual(['Cap Ana Lima', 'Sd Bruno Sá', '1º Ten Carla Reis']);
    });

    it('NENHUM GRUPO aparece como participante: a função só lê `members`', () => {
        // A cláusula 5.7 reserva o CAMINHO de acesso, e nomear o coletivo entregaria adesão de
        // terceiro. O payload do overview não traz grupo, e esta asserção existe para que um
        // "enriquecimento" futuro não o traga por engano.
        const comGrupo = participantsFromOverview(payload({
            groups: [{ groupId: 'g1', name: 'Equipe Alfa', permission: 'write' }],
        }), ATLAS);
        expect(comGrupo.participants).toHaveLength(3);
        expect(JSON.stringify(comGrupo)).not.toContain('Equipe Alfa');
    });
});

describe('as frases do modo somente leitura', () => {
    it('a nota DIZ por que nada muda ali, e nomeia o nível que faltaria', () => {
        const frase = readOnlySharingNotice();
        // Uma tela cheia de nomes e nenhum controle lê como quebrada; a frase é o que desfaz
        // essa leitura, então ela precisa dizer o QUE falta e A QUEM pedir.
        expect(frase).toContain('Gestão');
        expect(frase).toMatch(/peça/i);
        expect(frase.length).toBeGreaterThan(60);

        // DISCRIMINAÇÃO: não é uma recusa seca. "Você não tem permissão" sem remédio é a forma
        // de mensagem que esta casa já pagou antes.
        expect(frase).not.toMatch(/^Você não tem permissão\.?$/);
        // Sem em-dash na prosa (convenção da casa, e a frase é prosa de produto).
        expect(frase).not.toContain('—');
    });

    it('o excedente conjuga com a contagem, e cala quando não há excedente', () => {
        expect(hiddenParticipantsLabel(1)).toBe('E mais 1 participante que esta lista não detalha.');
        expect(hiddenParticipantsLabel(17))
            .toBe('E mais 17 participantes que esta lista não detalha.');

        // DISCRIMINAÇÃO: zero, negativo e lixo não podem virar "E mais 0 participantes", que
        // afirmaria uma omissão inexistente.
        for (const nada of [0, -3, null, undefined, NaN, Infinity, 'muitos', {}]) {
            expect(hiddenParticipantsLabel(nada), `\`${String(nada)}\` falou quando devia calar`)
                .toBe('');
        }
        // Fracionário trunca em vez de imprimir "2.5".
        expect(hiddenParticipantsLabel(2.5)).toBe('E mais 2 participantes que esta lista não detalha.');
    });
});

// ============================================================================
// A FIAÇÃO DO MODO, que as funções puras acima não alcançam
// ============================================================================
//
// POR QUE ESTE BLOCO EXISTE, e ele nasceu de um controle negativo que FALHOU em ficar vermelho:
// apagar o `if (this._readOnly) return this._loadParticipants();` de `_load()` deixava os dez
// casos acima verdes. Sem aquela linha o modo participantes chama `getSharing`, toma 403 e
// desenha a tela de erro para exatamente quem ele serve — o defeito inteiro de volta, sem um
// vermelho. As funções puras estavam medidas; o caminho até elas não estava.
//
// É leitura de TEXTO porque a classe monta DOM no construtor e o ambiente aqui é node puro.

const FONTE_BRUTA = readFileSync(
    new URL('../../src/js/modals/sharing.modal.core.js', import.meta.url), 'utf8',
);

/**
 * Apaga comentário preservando literais de string (um `//` dentro de aspas sobrevive).
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
                saida += fonte[i];
                const fechou = fonte[i] === atual;
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

const FONTE = semComentarios(FONTE_BRUTA);

/**
 * Corpo de um método de classe, casado por chaves a partir da DEFINIÇÃO (nunca de uma chamada).
 * @param {string} nome
 * @returns {string}
 */
function corpoDeMetodo(nome) {
    const definicao = new RegExp(`^ {4}(?:async )?${nome}\\s*\\([^)]*\\)\\s*\\{`, 'gm');
    const achados = [...FONTE.matchAll(definicao)];
    expect(achados, `a definição de \`${nome}\` não casou uma única vez`).toHaveLength(1);
    const inicio = achados[0].index + achados[0][0].length - 1;
    let nivel = 0;
    for (let j = inicio; j < FONTE.length; j++) {
        if (FONTE[j] === '{') {
            nivel++;
        } else if (FONTE[j] === '}') {
            nivel--;
            if (nivel === 0) return FONTE.slice(inicio, j + 1);
        }
    }
    throw new Error(`o corpo de \`${nome}\` não fechou`);
}

describe('a fiação do modo participantes', () => {
    it('CONTROLE: a varredura enxerga o CÓDIGO e deixou de enxergar a PROSA', () => {
        const PROSA = 'O QUE ELE NÃO TEM, e a lista é o contrato desta tela';
        expect(FONTE_BRUTA, 'a prosa de controle sumiu do arquivo').toContain(PROSA);
        expect(FONTE, 'a PROSA sobreviveu à remoção de comentários').not.toContain(PROSA);
        expect(FONTE, 'a remoção de comentários comeu CÓDIGO').toContain('_renderReadOnlyBody');
    });

    it('`_load` DESVIA para os participantes antes de tocar em `getSharing`', () => {
        const corpo = corpoDeMetodo('_load');
        // A ordem importa: o desvio tem de vir ANTES da chamada que exige `manage`.
        const desvio = corpo.indexOf('this._loadParticipants()');
        const gestao = corpo.indexOf('apiClient.getSharing(');
        expect(desvio, '`_load` não desvia para o modo participantes').toBeGreaterThan(-1);
        expect(gestao, 'o parser não achou a chamada de gestão').toBeGreaterThan(-1);
        expect(desvio).toBeLessThan(gestao);
        expect(corpo).toMatch(/if\s*\(this\._readOnly\)\s*return this\._loadParticipants\(\)/);
    });

    it('o carregamento do modo lê o OVERVIEW e nunca a rota gateada em `manage`', () => {
        const corpo = corpoDeMetodo('_loadParticipants');
        expect(corpo).toContain('apiClient.getAtlasOverview()');
        expect(corpo).toContain('participantsFromOverview(');
        // DISCRIMINAÇÃO, e é a decisão inteira: `GET /atlas/:atlasId/sharing` exige `manage` nos
        // quatro verbos, então chamá-la aqui devolve 403 a quem esta tela existe para servir.
        expect(corpo, 'o modo de leitura voltou a chamar a rota de gestão')
            .not.toContain('getSharing');
        expect(corpo, 'o modo de leitura voltou a chamar a rota de grupos')
            .not.toContain('listAccessGroups');
    });

    it('`_renderBody` sai pelo corpo de leitura ANTES de desenhar seção de gestão', () => {
        const corpo = corpoDeMetodo('_renderBody');
        const saida = corpo.indexOf('this._renderReadOnlyBody()');
        const publico = corpo.indexOf('this._renderPublicSection()');
        expect(saida).toBeGreaterThan(-1);
        expect(publico).toBeGreaterThan(-1);
        expect(saida).toBeLessThan(publico);
        // E ele RETORNA: sem o `return` as duas metades sairiam, a segunda por cima da primeira.
        expect(corpo).toMatch(/this\._renderReadOnlyBody\(\);[\s\S]{0,40}return;/);
    });

    it('o corpo de leitura NÃO desenha controle nenhum, item por item', () => {
        const corpo = corpoDeMetodo('_renderReadOnlyBody') + corpoDeMetodo('_renderParticipantItem');

        // A lista do que o modo NÃO faz, cobrada uma a uma para que a mensagem diga QUAL voltou.
        const PROIBIDOS = {
            'um <select> de nível': '<select',
            'um botão de remover': 'data-action="remove"',
            'o botão "Tornar dono"': 'sharing-member__transfer',
            'o seletor de grupo': 'sharing-group__select',
            'o toggle de link público': 'data-action="toggle-public"',
            'a busca de pessoas': 'sharing-search__input',
            'qualquer gancho de ação': 'data-action=',
        };
        for (const [oQue, marca] of Object.entries(PROIBIDOS)) {
            expect(corpo, `o modo somente leitura voltou a desenhar ${oQue}`).not.toContain(marca);
        }

        // PISO: as marcas acima EXISTEM no arquivo, no modo de gestão. Sem isto, a lista poderia
        // estar procurando strings que ninguém escreve, e o verde não provaria nada.
        for (const marca of Object.values(PROIBIDOS)) {
            expect(FONTE, `a marca \`${marca}\` não existe no arquivo: a varredura está vazia`)
                .toContain(marca);
        }

        // E o que ele DESENHA, dito pelo nome, com os testids literais que o Playwright procura.
        for (const marca of [
            'sharing-readonly-note', 'sharing-participants', 'sharing-participant-item',
            'sharing-participant-level', 'sharing-participants-overflow',
            'sharing-participants-empty', 'readOnlySharingNotice()', 'hiddenParticipantsLabel(',
        ]) {
            expect(corpo).toContain(marca);
        }
        // Nome de pessoa vindo do servidor passa por `escapeHtml`, sem exceção.
        expect(corpo).toMatch(/escapeHtml\(nome\)/);
    });

    it('`_renderBody` NÃO liga a fiação de controles no modo de leitura', () => {
        // Fiação pendurada num corpo sem controle é a porta pela qual o primeiro controle
        // acrescentado por engano ficaria vivo sem ninguém decidir isso.
        const corpo = corpoDeMetodo('_renderBody');
        const saida = corpo.indexOf('return;');
        const fiacao = corpo.indexOf('this._setupBodyListeners()');
        expect(saida).toBeGreaterThan(-1);
        expect(fiacao).toBeGreaterThan(saida);
    });

    it('o TÍTULO do modal muda com o modo', () => {
        const corpo = corpoDeMetodo('constructor');
        // Chamar a tela de "Compartilhar" e não oferecer nada para compartilhar é a leitura de
        // "quebrado" que a nota do corpo existe para desfazer; começar pelo nome certo resolve
        // metade dela antes de qualquer frase.
        expect(corpo).toContain('Participantes de ');
        expect(corpo).toContain('Compartilhar ');
        expect(corpo).toContain('readOnly === true');
    });
});
