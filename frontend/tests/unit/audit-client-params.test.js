// Path: tests/unit/audit-client-params.test.js

/**
 * @fileoverview A QUERY STRING DE `apiClient.listAudit`, QUE É LOAD-BEARING PARA A ABERTURA
 * DA ABA — e que não tinha nenhum teste dos dois lados da fronteira.
 *
 * `audit-tab.js` monta `_filtros = { action: '', targetType: '', targetId: '', targetOrgId: '' }`
 * e espalha os quatro em `_params()`, então TODA primeira carga da aba manda quatro strings
 * vazias. O descarte de valor vazio em `listAudit` é o que impede isso de virar uma
 * requisição malformada.
 *
 * O MODO DE FALHA FOI MEDIDO CONTRA O SCHEMA VIVO, e ele é pior do que o comentário do
 * cliente afirmava antes desta revisão. `listAuditSchema` usa `Joi.string()`, que RECUSA a
 * string vazia:
 *
 *     listAuditSchema.validate({ action: '' })   -> "action" is not allowed to be empty
 *     listAuditSchema.validate({ targetId: '' }) -> "targetId" is not allowed to be empty
 *
 * Ou seja, apagar aquela linha não devolve "lista vazia sem erro": devolve **422 em toda
 * abertura da aba**, para as duas audiências, com o toast "Falha ao carregar a trilha de
 * auditoria". Razão errada escrita num comentário é o que faz a próxima pessoa remover a
 * linha, e por isso a razão foi corrigida junto com este arquivo.
 *
 * O PISO E A DISCRIMINAÇÃO andam juntos em cada caso: um cliente que descartasse TUDO
 * passaria em toda asserção de ausência, então cada uma vem com o par que exige o filtro
 * de verdade na URL.
 *
 * POR QUE UM `_request` ESPIADO e não um `fetch` falso: o alvo da medição é a URL que o
 * método monta, não o transporte. Espiar o transporte mediria também `_ensureFreshAccessToken`
 * e a política de retry, que não são o assunto.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ApiClient } from '../../src/js/store/sync/api-client.js';

describe('apiClient.listAudit — a query string que a aba realmente manda', () => {
    let api;
    let chamadas;

    beforeEach(() => {
        api = new ApiClient({ baseUrl: 'http://x/api/v1' });
        chamadas = [];
        api._request = async (method, path) => {
            chamadas.push({ method, path });
            return { total: 0, page: 1, limit: 50, administra: false, data: [] };
        };
    });

    it('o estado INICIAL da aba (quatro filtros vazios) vira uma URL sem eles', async () => {
        // É esta chamada, e só ela, que acontece em toda montagem da aba. Ver o
        // `@fileoverview`: com as strings vazias na URL, a rota responde 422.
        await api.listAudit({
            page: 1, limit: 50, action: '', targetType: '', targetId: '', targetOrgId: '',
        });
        expect(chamadas).toHaveLength(1);
        expect(chamadas[0].method).toBe('GET');
        expect(chamadas[0].path).toBe('/audit?page=1&limit=50');
    });

    it('e um filtro REAL viaja: o descarte não pode ser "descarta tudo"', async () => {
        // A discriminação do caso acima. Sem ela, um cliente que jogasse fora todo
        // parâmetro passaria idêntico, e o filtro da tela seria decorativo.
        await api.listAudit({ action: 'LOGIN', page: 2, limit: 25 });
        expect(chamadas[0].path).toBe('/audit?action=LOGIN&page=2&limit=25');
    });

    it('`null` e `undefined` também saem, e o zero NÃO sai', async () => {
        // `0` é falsy e um descarte escrito com `if (!valor)` o comeria junto. Ele não é
        // um valor legítimo de `page`/`limit` hoje, mas o teste prende a REGRA (vazio,
        // nulo e indefinido) em vez do efeito, que é o que sobrevive ao próximo campo.
        await api.listAudit({ action: null, targetId: undefined, limit: 0, page: 1 });
        expect(chamadas[0].path).toBe('/audit?limit=0&page=1');
    });

    it('sem parâmetro nenhum a URL não ganha um `?` solto', async () => {
        await api.listAudit();
        expect(chamadas[0].path).toBe('/audit');
    });

    it('o valor é ESCAPADO: um alvo com `&` não parte a query em dois', async () => {
        // `targetId` é TEXT no banco e aceita slug digitado por gente. `URLSearchParams`
        // faz o escape; a asserção existe para que trocá-lo por concatenação de string
        // fique vermelho.
        await api.listAudit({ targetId: 'a&b=c', page: 1 });
        expect(chamadas[0].path).toBe('/audit?targetId=a%26b%3Dc&page=1');
    });

    it('o ENVELOPE volta desempacotado UMA vez: as linhas estão em `.data`', async () => {
        // O JSDoc do método nomeia o envelope duplo (`{data:{total,page,limit,data}}`)
        // como o erro de integração mais provável desta rota, e `_request` desembrulha um
        // nível. Aqui isso é afirmado sobre a forma que o método promete devolver; a
        // outra metade (o que o SERVIDOR realmente manda) é medida pela spec de contrato
        // `tests/e2e/audit-trail.e2e.test.js`, contra o backend real.
        const resposta = await api.listAudit({ page: 1 });
        expect(Array.isArray(resposta.data)).toBe(true);
        expect(resposta).toHaveProperty('administra');
        expect(resposta).toHaveProperty('total');
    });
});
