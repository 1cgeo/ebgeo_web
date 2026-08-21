// Path: tests/e2e/audit-trail.e2e.test.js

/**
 * @fileoverview A FRONTEIRA DE `GET /api/v1/audit`, contra o backend REAL.
 *
 * A constituição pede que mudança que cruza os dois pacotes seja verificada dos dois lados,
 * e nomeia esta camada como o guarda da fronteira. A rota nasceu com o eixo de OM, ganhou um
 * método no cliente (`apiClient.listAudit`) e uma aba de 495 linhas, e não tinha UM teste
 * aqui: `grep listAudit frontend/tests` devolvia zero.
 *
 * AS DUAS COISAS QUE SÓ ESTA CAMADA PODE PROVAR, e nenhuma delas é testável com um
 * `_request` falso:
 *
 *   1. **O ENVELOPE DUPLO.** O servidor manda `{ data: { total, page, limit, data } }` e
 *      `_request` desembrulha UM nível, então o que volta ao chamador é a PÁGINA e as linhas
 *      estão em `.data`. O JSDoc do método chama isso de "the most likely integration
 *      mistake on this route" — e chamava sem nada que o prendesse. Um dia a mais de
 *      envelope no servidor, ou um `data` a menos, e a aba mostra lista vazia sem erro.
 *   2. **A PRIMEIRA CARGA DA ABA NÃO É 422.** `audit-tab.js` nasce com quatro filtros em
 *      string vazia e os espalha na primeira consulta; `listAudit` os descarta. O schema
 *      vivo RECUSA string vazia (`"action" is not allowed to be empty`), então este é o
 *      caminho em que o descarte deixa de ser detalhe e vira a diferença entre a aba abrir
 *      e a aba mostrar um toast de falha. O caso reproduz o payload EXATO da montagem.
 *
 * O `promoteToAdmin` é SQL de propósito e o motivo está escrito em `helpers/db.js`: não
 * existe rota que crie o primeiro administrador, e o gate resolve o papel no banco.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { E2E_SKIP, makeApi, registerAndLogin } from './helpers/harness.js';
import { promoteToAdmin } from './helpers/db.js';

describe.skipIf(E2E_SKIP)('E2E — a trilha de auditoria pela fronteira real', () => {
    let apiAdmin;
    let apiComum;

    beforeAll(async () => {
        apiAdmin = makeApi();
        const { username } = await registerAndLogin(apiAdmin, { nome: 'Auditor E2E' });
        await promoteToAdmin(username);

        // O usuário comum existe para a DISCRIMINAÇÃO do gate: sem ele, um 200 do
        // administrador não distinguiria "a rota autoriza quem deve" de "a rota autoriza
        // qualquer um". Registrar-se já planta pelo menos um `LOGIN` na trilha.
        apiComum = makeApi();
        await registerAndLogin(apiComum, { nome: 'Comum E2E' });
    });

    it('o administrador recebe o envelope DESEMPACOTADO uma vez, com as linhas em `.data`', async () => {
        const resposta = await apiAdmin.listAudit({ page: 1, limit: 50 });

        expect(Array.isArray(resposta.data)).toBe(true);
        expect(resposta.data.length).toBeGreaterThanOrEqual(1);
        expect(resposta.administra).toBe(true);
        expect(resposta.escopoOrgId).toBeNull();
        expect(typeof resposta.total).toBe('number');
        expect(resposta.total).toBeGreaterThanOrEqual(resposta.data.length);

        // A FORMA DE UMA LINHA, e não só a da página: a aba lê estes campos por nome
        // (`audit-phrases.js`), e um `SELECT` que deixasse de trazer o nome do ator ou a
        // OM faria a tela degradar em silêncio para o id truncado e o travessão.
        const linha = resposta.data[0];
        for (const campo of [
            'id', 'action', 'actor_id', 'target_type', 'target_id', 'created_at',
            'target_org_id', 'actor_username', 'actor_nome', 'target_org_nome',
            'target_org_sigla',
        ]) {
            expect(linha, `a linha precisa carregar \`${campo}\``).toHaveProperty(campo);
        }
    });

    it('a PRIMEIRA CARGA DA ABA (quatro filtros vazios) não é 422', async () => {
        // O payload exato de `audit-tab.js` no mount, incluindo o `from` de sete dias.
        const desde = new Date(Date.now() - 7 * 86400000).toISOString();
        const resposta = await apiAdmin.listAudit({
            page: 1,
            limit: 50,
            action: '',
            targetType: '',
            targetId: '',
            targetOrgId: '',
            from: desde,
        });
        expect(Array.isArray(resposta.data)).toBe(true);

        // A DISCRIMINAÇÃO: a string vazia é MESMO recusada pela borda. Sem esta metade, o
        // caso acima passaria idêntico num servidor que aceitasse tudo, e o descarte no
        // cliente pareceria dispensável.
        await expect(
            apiAdmin._request('GET', '/audit?action=&page=1'),
        ).rejects.toThrow();
    });

    it('o filtro por ação ESTREITA de verdade, e a página respeita o `limit`', async () => {
        const tudo = await apiAdmin.listAudit({ page: 1, limit: 50 });
        expect(tudo.data.length).toBeGreaterThanOrEqual(1);

        const soLogin = await apiAdmin.listAudit({ action: 'LOGIN', page: 1, limit: 50 });
        expect(soLogin.data.length).toBeGreaterThanOrEqual(1);
        expect([...new Set(soLogin.data.map((l) => l.action))]).toEqual(['LOGIN']);
        expect(soLogin.total).toBeLessThanOrEqual(tudo.total);

        const umaSo = await apiAdmin.listAudit({ page: 1, limit: 1 });
        expect(umaSo.data).toHaveLength(1);
        expect(umaSo.limit).toBe(1);
        // O total NÃO é o tamanho da página: é o da consulta inteira, e é dele que o
        // rodapé deriva o número de páginas.
        expect(umaSo.total).toBe(tudo.total);
    });

    it('o usuário COMUM leva 403: o gate atravessa a fronteira', async () => {
        await expect(apiComum.listAudit({ page: 1 })).rejects.toThrow();

        // O par que impede a leitura errada: o token do comum funciona para o que é dele.
        const eu = await apiComum.getMe();
        expect(eu).toBeTruthy();
    });
});
