// Path: tests/unit/nome-militar-na-conta.test.js
//
// O CANTO DA CONTA ESCREVE `Maj Diniz`, não o login (dono, 2026-09-20).
//
// O rótulo ao lado do avatar e o `title` do botão do avatar mostravam `sessionContext.username`,
// que é o LOGIN. No Exército ninguém é chamado pelo login: a forma é posto mais nome de guerra, a
// mesma que a tela de compartilhamento já usava para todo mundo MENOS para quem está logado.
//
// TRÊS COISAS QUE ESTE ARQUIVO PRENDE, e que erram em silêncio:
//
//   1. A PRESERVAÇÃO. O papel por atlas é re-posto a cada `connect` por um payload que sabe o
//      papel e nada sobre a pessoa (`sync-engine.js`). Se `setSession` sobrescrevesse o nome na
//      ausência, `Maj Diniz` voltaria a ser o login no instante em que um atlas abre, e só ali;
//   2. O NOME NÃO SOBREVIVE À PESSOA. Outro `userId` sem nome declarado limpa o anterior;
//   3. A CHAVE DO AVATAR CONTINUA SENDO O LOGIN. Iniciais e cor são as mesmas do cursor e da lista
//      de quem está online, calculadas a partir do login em todo par.
//
// O QUE ELE NÃO PROVA: o DOM. O ambiente é `node`, então a fiação do controle é conferida no TEXTO
// do arquivo, dentro do corpo de `_render`, e a tela em si por captura.

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    SessionContext,
    UserRole,
    displayNameFromUser,
    sessionUserInfoFromMe,
} from '../../src/js/store/sync/session-context.js';

const ler = (rel) => readFileSync(new URL(`../../src/js/${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const MAJ = Object.freeze({
    id: 'u1', username: 'diniz', nome: 'Felipe Diniz', nome_guerra: 'Diniz', posto_graduacao: 'Maj',
});

describe('displayNameFromUser', () => {
    it('posto mais nome de guerra é a forma pedida', () => {
        expect(displayNameFromUser(MAJ)).toBe('Maj Diniz');
    });

    it.each([
        ['sem nome de guerra, cai no nome completo com o posto', { ...MAJ, nome_guerra: null }, 'Maj Felipe Diniz'],
        ['sem posto, o nome de guerra sozinho', { ...MAJ, posto_graduacao: null }, 'Diniz'],
        ['conta civil só com nome', { id: 'u2', username: 'ana', nome: 'Ana Lima' }, 'Ana Lima'],
        ['espaço em branco não é nome', { ...MAJ, nome_guerra: '   ' }, 'Maj Felipe Diniz'],
    ])('%s', (_rotulo, user, esperado) => {
        expect(displayNameFromUser(user)).toBe(esperado);
    });

    it.each([
        ['só o login', { id: 'u3', username: 'jsouza' }],
        ['posto sem nome nenhum', { id: 'u3', username: 'jsouza', posto_graduacao: 'Cap' }],
        ['registro vazio', {}],
        ['nulo', null],
        ['indefinido', undefined],
    ])('%s: NULO, porque o login já é para onde a tela cai (nunca `@login`, nunca `Alguém`)', (_r, user) => {
        expect(displayNameFromUser(user)).toBeNull();
    });
});

describe('sessionUserInfoFromMe', () => {
    it('carrega a forma militar, e o login continua no campo dele', () => {
        const info = sessionUserInfoFromMe(MAJ);
        expect(info.displayName).toBe('Maj Diniz');
        expect(info.username).toBe('diniz');
    });

    it('emite a chave SEMPRE, e é isso que deixa um nome apagado no servidor sair da tela', () => {
        expect(Object.keys(sessionUserInfoFromMe({ id: 'u3', username: 'jsouza' }))).toContain('displayName');
    });
});

describe('SessionContext.displayName', () => {
    let ctx;
    beforeEach(() => { ctx = new SessionContext(); });

    it('deslogado é nulo', () => {
        expect(ctx.displayName).toBeNull();
    });

    it('PRESERVADO quando o papel por atlas é re-posto sem dizer nada sobre a pessoa', () => {
        ctx.setSession(sessionUserInfoFromMe(MAJ));
        // A forma exata das duas chamadas de `sync-engine.js` no `connect`.
        ctx.setSession({ userId: 'u1', role: UserRole.OWNER, username: ctx.username });
        expect(ctx.displayName).toBe('Maj Diniz');
        expect(ctx.role).toBe(UserRole.OWNER);
    });

    it('uma hidratação nova SEM nome apaga o anterior: a chave veio, e veio nula', () => {
        ctx.setSession(sessionUserInfoFromMe(MAJ));
        ctx.setSession(sessionUserInfoFromMe({ id: 'u1', username: 'diniz' }));
        expect(ctx.displayName).toBeNull();
    });

    it('OUTRA pessoa sem nome declarado não herda o nome de quem saiu', () => {
        ctx.setSession(sessionUserInfoFromMe(MAJ));
        ctx.setSession({ userId: 'u2', role: UserRole.VIEWER, username: 'ana' });
        expect(ctx.displayName).toBeNull();
    });

    it.each([
        ['clearSession', (c) => c.clearSession()],
        ['setVisitorSession', (c) => c.setVisitorSession()],
        ['_reset', (c) => c._reset()],
    ])('%s limpa o nome junto com o login', (_nome, sair) => {
        ctx.setSession(sessionUserInfoFromMe(MAJ));
        sair(ctx);
        expect(ctx.displayName).toBeNull();
        expect(ctx.username).toBeNull();
    });
});

describe('a fiação nas duas superfícies que desenham a conta', () => {
    /** O corpo de um método de classe, para a asserção não vazar para o arquivo inteiro. */
    function corpo(texto, assinatura) {
        const inicio = texto.indexOf(assinatura);
        expect(inicio, `âncora ausente: ${assinatura}`).toBeGreaterThan(-1);
        const fim = texto.indexOf('\n    }\n', inicio);
        expect(fim).toBeGreaterThan(inicio);
        return texto.slice(inicio, fim);
    }

    it('o controle do mapa DESENHA o nome militar no rótulo e no `title` do avatar', () => {
        const render = corpo(ler('account/account.control.js'), '    _render() {');
        expect(render).toContain('const shown = sessionContext.displayName || name;');
        expect(render).toContain("this._userLabel.textContent = loggedIn ? shown : '';");
        expect(render).toContain("this._avatarBtn.setAttribute('title', loggedIn ? shown : '');");
    });

    it('e continua CHAVEANDO iniciais e cor pelo login, como o cursor e a lista de online', () => {
        const render = corpo(ler('account/account.control.js'), '    _render() {');
        expect(render).toContain('this._avatar.textContent = getInitials(name);');
        expect(render).not.toContain('getInitials(shown)');
    });

    it('a barra das páginas sem mapa lê o MESMO campo da sessão', () => {
        const barra = ler('ui/app-bar.js');
        expect(barra).toContain('const shown = sessionContext.displayName || name;');
        expect(barra).toContain('label.textContent = shown;');
        expect(barra).toContain('avatar.textContent = getInitials(name);');
    });

    it('a sessão importa a folha POR ARQUIVO, nunca pelo barril que arrasta a store', () => {
        const sessao = ler('store/sync/session-context.js');
        expect(sessao).toContain("import { militaryPersonLabel } from '../../utilities/person-label.js';");
        expect(sessao).not.toMatch(/from '@utils'|from '@utils\/index/);
    });
});
