// Path: tests/unit/link-publico-com-sessao-abre-pela-conta.test.js
//
// O LINK PÚBLICO ABERTO POR QUEM ESTÁ LOGADO (dono, 2026-09-20).
//
// O DEFEITO MEDIDO. `openPublicAtlasFromUrl` devolvia falso na PRIMEIRA linha quando havia sessão.
// O link era engolido, a cadeia de boot seguia até o seletor e o navegador terminava em
// `atlas.html`, sem uma palavra. O dono colou o link noutro navegador, viu "não carregou" e só
// achou a causa ao sair da conta. Reproduzido com uma conta sem relação com o atlas: nenhum
// pedido a `/atlas/public/`, nenhum aviso, URL final `atlas.html`.
//
// O CONSERTO. Com sessão, o link resolve para o ID e abre PELA CONTA, pelo mesmo pipeline de
// `?atlas=`. O servidor já dá a toda conta viva a leitura de um atlas público, e a quem é dono
// ou tem share o nível que já tinha. Medido depois: a conta sem relação abre somente leitura, o
// dono abre com edição, e a barra de endereços troca `?atlasPublico=` por `?atlas=`.
//
// ESTE ARQUIVO prende a frase (pura) e a ORDEM dentro da função, que é o que quebra calado: a
// recusa antiga era uma linha, e uma linha volta fácil.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { publicLinkOpenedWithAccountNotice } from '../../src/js/deep-link/public-link-phrases.js';

describe('publicLinkOpenedWithAccountNotice', () => {
    it('quem NÃO é dono lê que abriu pela conta, e qual é o piso do nível dele', () => {
        const aviso = publicLinkOpenedWithAccountNotice({ name: 'teste', isOwner: false });
        expect(aviso.tone).toBe('info');
        expect(aviso.message).toContain('O atlas "teste" abriu pela sua conta');
        expect(aviso.message).toContain('não como visita pública');
        expect(aviso.message).toContain('somente leitura');
    });

    it('o DONO lê que o atlas é dele e que pode editar: a tela mudou de natureza', () => {
        const aviso = publicLinkOpenedWithAccountNotice({ name: 'teste', isOwner: true });
        expect(aviso.message).toBe('O atlas "teste" é seu: ele abriu pela sua conta, com edição, e não como visita pública.');
    });

    it.each([undefined, null, '', '   '])('nome %j: a frase não imprime aspas vazias', (name) => {
        const aviso = publicLinkOpenedWithAccountNotice({ name, isOwner: false });
        expect(aviso.message.startsWith('O atlas deste link abriu pela sua conta')).toBe(true);
        expect(aviso.message).not.toContain('""');
    });

    it('sem argumento nenhum não lança', () => {
        expect(publicLinkOpenedWithAccountNotice().message.length).toBeGreaterThan(0);
    });
});

describe('a ordem dentro de `openPublicAtlasFromUrl`', () => {
    const fonte = readFileSync(new URL('../../src/js/index.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const inicio = fonte.indexOf('async function openPublicAtlasFromUrl(');
    const corpo = fonte.slice(inicio, fonte.indexOf('\n}\n', inicio));

    it('a recusa de uma linha por sessão NÃO voltou', () => {
        expect(inicio).toBeGreaterThan(-1);
        expect(corpo).not.toContain('if (!link || sessionContext.isAuthenticated()) return false;');
        expect(corpo).toContain('if (!link) return false;');
    });

    it('resolve o link ANTES de perguntar pela sessão: o link morto fala nos dois casos', () => {
        const resolve = corpo.indexOf('apiClient.getPublicAtlas(link)');
        const ramoDaConta = corpo.indexOf('if (sessionContext.isAuthenticated()) {');
        expect(resolve).toBeGreaterThan(-1);
        expect(ramoDaConta).toBeGreaterThan(resolve);
    });

    it('o ramo da conta entra pelo pipeline de `?atlas=`, tira o parâmetro da barra e AVISA', () => {
        const ramo = corpo.slice(corpo.indexOf('if (sessionContext.isAuthenticated()) {'));
        const tiraDaBarra = ramo.indexOf('forgetPublicAtlasUrl();');
        const abre = ramo.indexOf('openAtlasFromUrl({ atlasId: atlas.id, mapId: null })');
        expect(tiraDaBarra).toBeGreaterThan(-1);
        expect(abre).toBeGreaterThan(tiraDaBarra);
        expect(ramo).toContain('publicLinkOpenedWithAccountNotice({');
        // E ele VEM ANTES do token efêmero: visita e conta não coexistem no mesmo cliente.
        expect(corpo.indexOf('if (sessionContext.isAuthenticated()) {'))
            .toBeLessThan(corpo.indexOf('apiClient.setEphemeralToken(atlas.publicToken)'));
    });

    it('a visita anônima avisa UMA vez por toast, e a faixa persistente não voltou', () => {
        expect(corpo).toContain('Visita pública ao atlas');
        expect(fonte).not.toContain('visitor-banner');
        expect(fonte).not.toContain('showVisitorBanner');
        const manifesto = readFileSync(new URL('../../src/css/style.css', import.meta.url), 'utf8');
        expect(manifesto).not.toContain('visitor-banner');
    });
});
