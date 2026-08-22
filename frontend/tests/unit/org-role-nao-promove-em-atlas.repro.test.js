// Path: tests/unit/org-role-nao-promove-em-atlas.repro.test.js
//
// D7 (2026-08-20): o eixo de papel DENTRO da organização (`users.org_role`, valores
// owner|admin|editor|viewer) sai do código inteiro. Este arquivo é o repro da razão de
// a remoção ser urgente e não cosmética, e ele mede pela porta que o usuário sente: o
// guarda de permissão do cliente.
//
// A CAUSA RAIZ, em uma linha: a função única de hidratação de sessão
// (`sessionUserInfoFromMe`, compartilhada pelos cinco sítios que criam sessão) fazia
// `role: user.org_role || UserRole.VIEWER`. Os dois eixos escrevem os dois valores mais
// altos com as MESMAS palavras (`owner`, `admin`), então um crachá dentro de uma OM
// virava, sem conversão nenhuma, o papel POR ATLAS. Quem tivesse `org_role: 'admin'`
// abria o app com a interface de Administrador de atlas — barra de ferramentas inteira,
// apagar mapa, gerir usuários — tendo papel global `user` e nenhuma permissão em atlas
// nenhum. O servidor recusava cada uma dessas ações, então o custo era afordância que
// mente (botão que existe e falha), não vazamento.
//
// E o eixo nunca poderia autorizar, que é o motivo de a remoção ser total em vez de uma
// conversão: a lotação (`users.organization_id`) é AUTO-DECLARADA no auto-cadastro, e
// autoridade derivada de campo que o próprio interessado escolhe não é autoridade.
//
// AS DUAS METADES, e a segunda é o que impede o verde fácil:
//   PISO         — o registro (ou token legado) com `org_role: 'admin'` hidrata em LEITOR
//                  e é RECUSADO nas três ações que ele antes ganhava.
//   DISCRIMINAÇÃO — quem tem gestão de verdade no atlas (o papel chega do servidor, no
//                  payload de `connect`) continua com gestão. Sem esta metade, o arquivo
//                  passaria verde com o cliente inteiro rebaixado a Leitor, que é o
//                  defeito oposto e igualmente ruim.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

vi.mock('../../src/js/store/sync/operation-factory.js', () => ({
    getClientId: vi.fn(() => 'mock-client-id-123')
}));

// O GUARDA SÓ EXISTE EM ATLAS REMOTO CONECTADO: sobre a store local ele devolve
// `{ allowed: true }` para tudo (offline-first). Sem este dublê, TODOS os casos abaixo
// passariam verdes por um motivo que não tem nada a ver com papel, e o arquivo mediria
// o vazio. O caso 'o dublê de origem está mesmo ligado' é o controle disso.
vi.mock('../../src/js/store/store-origin.js', () => ({
    isRemoteStoreSync: () => true
}));

import { sessionContext, sessionUserInfoFromMe, UserRole } from '../../src/js/store/sync/session-context.js';
import { checkPermission } from '../../src/js/store/sync/permission-guard.js';

/** As três ações que o crachá de OM abria indevidamente, uma por família de permissão. */
const ACOES_DE_GESTAO = ['CREATE_FEATURE', 'DELETE_MAP', 'MANAGE_USERS'];

const permitidas = () => Object.fromEntries(ACOES_DE_GESTAO.map((a) => [a, checkPermission(a).allowed]));

beforeEach(() => {
    sessionContext.clearSession();
});

describe('o crachá de OM não promove ninguém no eixo por atlas (D7)', () => {
    it('PISO: um registro com org_role=admin hidrata em LEITOR e é recusado nas três ações', () => {
        // O registro chega COM o campo de propósito: um backend antigo, uma aba em cache e um
        // token legado continuam mandando `org_role`, e o contrato de hoje é que ele seja
        // IGNORADO. Um registro já sem o campo mediria a ausência dele, não a indiferença a ele.
        sessionContext.setSession(sessionUserInfoFromMe({
            id: 'u-cracha', org_role: 'admin', role: 'user', username: 'ana'
        }));

        expect(sessionContext.role).toBe(UserRole.VIEWER);
        expect(permitidas()).toEqual({ CREATE_FEATURE: false, DELETE_MAP: false, MANAGE_USERS: false });
    });

    it('PISO: o mesmo vale para org_role=owner, que era o outro valor homônimo', () => {
        sessionContext.setSession(sessionUserInfoFromMe({ id: 'u-cracha2', org_role: 'owner', role: 'user' }));

        expect(sessionContext.role).toBe(UserRole.VIEWER);
        expect(permitidas()).toEqual({ CREATE_FEATURE: false, DELETE_MAP: false, MANAGE_USERS: false });
    });

    it('PISO: e org_role=editor não abre a edição, que era a forma barata do mesmo defeito', () => {
        sessionContext.setSession(sessionUserInfoFromMe({ id: 'u-cracha3', org_role: 'editor', role: 'user' }));

        expect(sessionContext.role).toBe(UserRole.VIEWER);
        expect(checkPermission('CREATE_FEATURE').allowed).toBe(false);
    });

    it('DISCRIMINAÇÃO: quem tem gestão REAL no atlas continua com gestão', () => {
        // É assim que o papel por atlas chega hoje, e é o único caminho: o servidor o resolve
        // e o manda no payload de `connect` (`sync-engine.js`), que faz este `setSession`.
        sessionContext.setSession({ userId: 'u-gestor', role: UserRole.MANAGER });

        expect(permitidas()).toEqual({ CREATE_FEATURE: true, DELETE_MAP: true, MANAGE_USERS: true });

        // E o Dono, que é o outro papel que a hidratação promovia por engano.
        sessionContext.setSession({ userId: 'u-dono', role: UserRole.OWNER });
        expect(permitidas()).toEqual({ CREATE_FEATURE: true, DELETE_MAP: true, MANAGE_USERS: true });
    });

    it('DISCRIMINAÇÃO: o Editor de verdade edita e continua sem apagar mapa', () => {
        // Piso intermediário: sem ele, "recusa tudo" e "recusa só o que deve" ficariam
        // indistinguíveis, e o rebaixamento geral passaria pelos casos acima.
        sessionContext.setSession({ userId: 'u-editor', role: UserRole.EDITOR });

        expect(permitidas()).toEqual({ CREATE_FEATURE: true, DELETE_MAP: false, MANAGE_USERS: false });
    });

    it('CONTROLE: o dublê de origem está mesmo ligado, senão tudo acima seria verde por engano', () => {
        // Com a store local o guarda libera tudo, inclusive para Leitor. Se o `vi.mock` de
        // `store-origin.js` parasse de valer, este caso seria o único a ficar vermelho, porque
        // ele é o único que exige uma RECUSA de quem tem papel.
        sessionContext.setSession({ userId: 'u-leitor', role: UserRole.VIEWER });
        const negado = checkPermission('CREATE_FEATURE');
        expect(negado.allowed).toBe(false);
        expect(negado.reason, 'o guarda precisa dizer o papel em que recusou').toContain('viewer');
    });
});

// ---------------------------------------------------------------------------
// Censo estrutural: o eixo não pode voltar por analogia
// ---------------------------------------------------------------------------

const RAIZ = fileURLToPath(new URL('../../../', import.meta.url));

/** Apaga o CONTEÚDO dos comentários (JS e SQL); prosa que NOMEIA o eixo morto não é violação. */
function semComentarios(texto, arquivo) {
    let t = texto
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/(^|[^:])\/\/[^\n]*/g, (m, antes) => antes + ' '.repeat(m.length - antes.length));
    if (arquivo.endsWith('.sql')) t = t.replace(/--[^\n]*/g, (m) => ' '.repeat(m.length));
    return t;
}

function coletar(dir, acc = []) {
    const abs = join(RAIZ, dir);
    if (!existsSync(abs)) return acc;
    for (const nome of readdirSync(abs)) {
        if (['node_modules', 'coverage', 'dist', 'vendors'].includes(nome)) continue;
        const rel = `${dir}/${nome}`;
        if (statSync(join(RAIZ, rel)).isDirectory()) coletar(rel, acc);
        else if (/\.(js|sql)$/.test(nome)) acc.push(rel);
    }
    return acc;
}

describe('censo: org_role não sobrevive em código de produção', () => {
    const FONTES = [...coletar('frontend/src'), ...coletar('backend/src')];
    const COM_EIXO = FONTES.filter((f) => /org_role/.test(semComentarios(readFileSync(join(RAIZ, f), 'utf8'), f)));

    it('guarda: a varredura enxerga os dois pacotes', () => {
        // Varredura vazia passa verde afirmando qualquer coisa. Aqui o tamanho é asserido.
        expect(FONTES.length).toBeGreaterThan(500);
        expect(FONTES.some((f) => f.startsWith('frontend/src'))).toBe(true);
        expect(FONTES.some((f) => f.startsWith('backend/src'))).toBe(true);
    });

    it('org_role não aparece em NENHUM arquivo de código', () => {
        // Asserção ABSOLUTA, e ela ficou VAZIA na consolidação do schema: enquanto havia uma
        // migração que criava a coluna e outra que a apagava, esta lista tinha as duas e a
        // história do eixo se lia aqui. Com as baselines escritas no estado final, a coluna
        // nunca nasce, e o eixo sumiu do disco.
        //
        // Lista vazia não discrimina sozinha — é a "cobertura vazia passa verde" que a
        // constituição nomeia. Quem lhe dá sentido é o CONTROLE DE VÁCUO logo abaixo: a MESMA
        // varredura, sobre a MESMA lista de fontes, precisa achar o eixo que continua vivo.
        // Qualquer arquivo aqui é o eixo voltando, por consulta, por claim ou por formulário.
        expect(COM_EIXO.sort()).toEqual([]);
    });

    it('CONTROLE DE VÁCUO: a mesma varredura ACHA o eixo que continua vivo', () => {
        // Sem isto, uma varredura quebrada (caminho errado, `semComentarios` engolindo tudo)
        // devolveria lista vazia e o caso acima passaria provando nada. O eixo de PRODUÇÃO é
        // quem herdou a autorização que o de OM nunca teve.
        const comProducao = FONTES.filter(
            (f) => /producer_org_id/.test(semComentarios(readFileSync(join(RAIZ, f), 'utf8'), f))
        );
        expect(comProducao.length).toBeGreaterThan(5);
    });

    it('a hidratação não lê campo nenhum do registro para o papel por atlas', () => {
        const fonte = semComentarios(
            readFileSync(join(RAIZ, 'frontend/src/js/store/sync/session-context.js'), 'utf8'),
            'session-context.js'
        );
        // O corpo do helper, isolado: o `role:` dele tem de ser a constante fechada.
        const corpo = fonte.slice(fonte.indexOf('export function sessionUserInfoFromMe'));
        expect(corpo).toMatch(/role:\s*UserRole\.VIEWER/);
        expect(corpo, 'o papel por atlas voltou a sair do registro do backend').not.toMatch(/role:\s*user\./);
    });
});
