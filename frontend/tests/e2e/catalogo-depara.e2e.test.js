// Path: tests/e2e/catalogo-depara.e2e.test.js

/**
 * @fileoverview O DE-PARA DA TRILHA ATRAVESSANDO OS DOIS PACOTES, contra o backend REAL.
 *
 * A constituição pede que mudança que cruza a fronteira seja verificada dos dois lados no
 * mesmo commit, e este lote a cruza em dois pontos: uma chave nova declarada na borda de
 * escrita do catálogo (`config.previewVideo`) e uma forma nova dentro de `details`, que a
 * aba de Auditoria lê por nome (`linhasDoDePara`, `frontend/src/js/admin/audit-phrases.js`).
 *
 * AS TRÊS COISAS QUE SÓ ESTA CAMADA PODE PROVAR, e nenhuma delas é testável com um
 * `_request` falso nem com supertest sozinho:
 *
 *   1. **O SEGREDO NÃO ATRAVESSA.** O caso escreve uma URL de serviço com credencial na
 *      query string e procura a substring dela no JSON INTEIRO da resposta que o cliente
 *      recebe — não no campo onde se esperaria encontrá-la. É o controle que o lote pediu
 *      por extenso, e é o único ponto do repositório onde ele é medido de ponta a ponta.
 *   2. **A FORMA DO DE-PARA É A QUE A ABA LÊ.** `mudou` é uma lista de objetos com `campo`
 *      e, no regime de impressão, `regime: 'impressao'`. Se o servidor renomear qualquer um
 *      dos dois, a gaveta de detalhes degrada para silêncio (nenhuma linha desenhada) sem
 *      erro em lugar nenhum, porque a tela itera sobre um array que existe e está vazio.
 *   3. **A BORDA NOVA RECUSA `data:` PELO CAMINHO REAL DO CLIENTE.** `apiClient.updateResource`
 *      não valida nada; quem valida é o Joi da rota. Sem este caso, "a borda existe" é uma
 *      afirmação sobre o schema e não sobre o que o painel consegue gravar.
 *
 * O `promoteToAdmin` é SQL de propósito, pelo motivo escrito em `helpers/db.js`.
 *
 * CONTROLE NEGATIVO, EXECUTADO E MEDIDO: apagar a filtragem por allowlist em
 * `backend/src/utils/audit-diff.js` (mandar todo campo classificado para o valor literal)
 * deixa o PRIMEIRO caso vermelho e o segundo VERDE — a borda do `data:` é outra peça e
 * continua respondendo. Sem essa assimetria, os dois casos estariam medindo a mesma coisa.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { E2E_SKIP, makeApi, registerAndLogin } from './helpers/harness.js';
import { promoteToAdmin } from './helpers/db.js';

const RID = Math.random().toString(36).slice(2, 8);
const ID = `e2e-depara-${RID}`;
const SEGREDO = `TOKENSECRETO${RID}`;
const URL_COM_SEGREDO = `https://tiles.om.example.mil.br/v1/svc?api_key=${SEGREDO}`;
const VIDEO = `https://midia.om.example.mil.br/${RID}.webm?sig=${SEGREDO}`;

describe.skipIf(E2E_SKIP)('E2E — o de-para do catálogo pela fronteira real', () => {
    let api;

    beforeAll(async () => {
        api = makeApi();
        const { username } = await registerAndLogin(api, { nome: 'Curador E2E' });
        await promoteToAdmin(username);

        await api.createResource('tileset', {
            id: ID,
            name: 'De-para v1',
            config: { url: '/publico/tileset.json', heightOffset: 0 },
        });
    });

    it('a edição grava o de-para, e o segredo não aparece em lugar nenhum da trilha', async () => {
        await api.updateResource('tileset', ID, {
            name: 'De-para v2',
            config: {
                url: URL_COM_SEGREDO,
                previewVideo: VIDEO,
                heightOffset: 12,
                chaveQueNinguemClassificou: 'x',
            },
        });

        const resposta = await api.listAudit({ targetType: 'TILESET', targetId: ID, limit: 50 });
        const edicoes = resposta.data.filter((l) => l.action === 'CATALOG_UPDATE');

        // PISO — a linha chegou. Sem esta metade, todas as ausências abaixo passariam numa
        // lista vazia, que é a cobertura vazia canônica desta casa.
        expect(edicoes.length).toBe(1);
        const detalhes = edicoes[0].details;
        expect(detalhes.fields.sort()).toEqual(['config', 'name']);

        // PISO 2 — a FORMA que a aba lê, campo por campo. O regime de VALOR traz o valor,
        // o de impressão se anuncia, e o desconhecido entra só pelo nome.
        const porCampo = Object.fromEntries(detalhes.mudou.map((m) => [m.campo, m]));
        expect(porCampo.name).toEqual({ campo: 'name', de: 'De-para v1', para: 'De-para v2' });
        expect(porCampo['config.heightOffset']).toEqual(
            { campo: 'config.heightOffset', de: 0, para: 12 },
        );
        expect(porCampo['config.url'].regime).toBe('impressao');
        expect(porCampo['config.previewVideo'].regime).toBe('impressao');
        expect(porCampo['config.url'].para).toMatch(/^[0-9a-f]{12}$/);
        // EXATO, e não `toContain`: `outros` é o regime nome-só, e ele é o balde onde cai
        // tudo que ninguém classificou — inclusive, por engano, colunas que a rota nem
        // escreve. Foi assim que `id`, `active`, `created_at` e `updated_at` entraram em
        // TODA edição durante esta onda, e um `toContain` teria passado verde.
        expect(detalhes.outros).toEqual(['config.chaveQueNinguemClassificou']);
        expect(detalhes.truncado).toBe(false);

        // A DISCRIMINAÇÃO — o JSON INTEIRO da resposta que o cliente recebeu. Procurar no
        // campo esperado provaria só que aquele campo está limpo.
        const cru = JSON.stringify(resposta);
        expect(cru).not.toContain(SEGREDO);
        expect(cru).not.toContain('api_key');
        expect(cru).not.toContain(URL_COM_SEGREDO);
        expect(cru).not.toContain(VIDEO);
    });

    it('a chave do vídeo tem borda: `data:` é 422, e o resto do `config` continua livre', async () => {
        // PISO — a rota aceita a chave por um endereço normal. Sem ele, o 422 abaixo seria
        // indistinguível de "a chave não existe" ou "a rota está quebrada".
        const ok = await api.updateResource('tileset', ID, {
            config: { previewVideo: '/3d/videos/previa.webm' },
        });
        expect(ok.config.previewVideo).toBe('/3d/videos/previa.webm');

        await expect(
            api.updateResource('tileset', ID, {
                config: { previewVideo: 'data:video/webm;base64,AAAA' },
            }),
        ).rejects.toMatchObject({ status: 422 });

        // A DISCRIMINAÇÃO — declarar UMA chave não fechou o objeto. As quatro categorias
        // guardam shapes diferentes e nenhuma delas jamais foi validada; um `config`
        // fechado por acidente quebraria as quatro de uma vez.
        const livre = await api.updateResource('tileset', ID, {
            config: { outraChaveInventada: { profunda: [1, 2, 3] } },
        });
        expect(livre.config.outraChaveInventada).toEqual({ profunda: [1, 2, 3] });
    });
});
