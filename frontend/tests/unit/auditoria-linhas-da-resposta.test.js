// Path: tests/unit/auditoria-linhas-da-resposta.test.js

/**
 * @fileoverview O ENVELOPE DA TRILHA TEM `data`, NUNCA `items` — e a aba de Auditoria lia os
 * dois, em sítios diferentes do mesmo arquivo.
 *
 * O DEFEITO, MEDIDO NA FONTE. `audit.service.js` devolve
 * `{ total, page, limit, escopoOrgId, administra, data }`. `audit-tab.js` desenhava a lista a
 * partir de `resposta.data` (certo) e guardava a página em `resposta.items` (inexistente), de
 * modo que a cópia guardada era SEMPRE `[]`.
 *
 * POR QUE NINGUÉM VIA. A lista aparecia normalmente, porque quem a desenha é o sítio certo. O
 * que quebrava era o rótulo do filtro "OM do acervo" para uma OM DESATIVADA: ela some de
 * `config.organizacoesMilitares` (que só traz OM ativa), `buildDomainOptions` a preserva no
 * seletor de propósito, e o nome dela só podia vir das linhas que estão na tela. Com a cópia
 * sempre vazia, a opção voltava a sair como UUID cru seguido de "(atual)" — exatamente no
 * estado que dispara investigação, que é a razão de a opção ser preservada.
 *
 * O CONSERTO É UM LEITOR SÓ (`linhasDaResposta`), e é por isso que este arquivo mede uma
 * FUNÇÃO e não um pedaço de DOM: não há jsdom neste pacote (o ambiente do vitest é `node`), e
 * a decisão "de onde saem as linhas" é aritmética de envelope, não de tela. Com um leitor só,
 * errar de novo exige errar nos dois sítios ao mesmo tempo.
 *
 * CONTROLE NEGATIVO EXECUTADO: trocar o corpo de `linhasDaResposta` de volta para
 * `Array.isArray(resposta?.items) ? resposta.items : []` deixa TRÊS casos deste arquivo
 * vermelhos, e o primeiro deles nomeia o campo.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { linhasDaResposta, nomeDeOmNasLinhas } from '../../src/js/admin/audit-phrases.js';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RAIZ = resolve(FRONT, '..');

/** Uma resposta como o servidor a monta, com as duas linhas de que os casos precisam. */
const RESPOSTA = Object.freeze({
    total: 2,
    page: 1,
    limit: 50,
    escopoOrgId: null,
    administra: true,
    data: [
        {
            id: 'l1', action: 'CATALOG_UPDATE', target_type: 'TILESET', target_id: 'modelo-x',
            target_org_id: 'om-morta', target_org_sigla: 'OMX', target_org_nome: 'OM Extinta',
            created_at: '2026-08-20T13:45:00.000Z', ip: '10.0.0.1',
        },
        {
            id: 'l2', action: 'LOGIN', actor_id: 'u1', actor_username: 'fulano',
            created_at: '2026-08-20T13:40:00.000Z', ip: '10.0.0.2',
        },
    ],
});

describe('linhasDaResposta — as linhas moram em `data`', () => {
    it('lê `data`, e um envelope com `items` devolve VAZIO', () => {
        // O PISO e a DISCRIMINAÇÃO no mesmo caso, de propósito: uma função que devolvesse
        // sempre `[]` passaria na segunda asserção sozinha, e uma que lesse os dois campos
        // passaria na primeira sozinha. Juntas, só o leitor certo passa.
        expect(linhasDaResposta(RESPOSTA)).toHaveLength(2);
        expect(linhasDaResposta(RESPOSTA)[0].id).toBe('l1');
        expect(
            linhasDaResposta({ total: 1, items: [{ id: 'l9' }] }),
            '`items` não existe no envelope desta rota: ler esse campo é ler nada',
        ).toEqual([]);
    });

    it('resposta ausente, nula ou malformada devolve array, nunca `undefined`', () => {
        // Quem consome itera direto. Um `undefined` aqui viraria "não é iterável" no meio de
        // um redesenho, longe da causa.
        for (const entrada of [undefined, null, {}, { data: null }, { data: 'texto' }]) {
            expect(Array.isArray(linhasDaResposta(entrada))).toBe(true);
            expect(linhasDaResposta(entrada)).toEqual([]);
        }
    });

    it('a aba consome UM leitor só, e não escreve `.items` em lugar nenhum', () => {
        // A metade estrutural: a função certa não conserta nada enquanto o sítio errado
        // continuar de pé ao lado dela. Varredura sobre o CÓDIGO, sem comentários — o
        // `@fileoverview` deste repositório NOMEIA o defeito para explicá-lo, e acusar a
        // explicação ensinaria a apagá-la, que é o contrário do que se quer.
        const semComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        const aba = semComentarios(
            readFileSync(resolve(FRONT, 'src/js/admin/audit-tab.js'), 'utf8'),
        );
        expect(aba, 'a aba voltou a ler um campo que a resposta não tem')
            .not.toMatch(/resposta[?.\s]*\.\s*items/);
        // PISO: a varredura precisa estar mesmo olhando o arquivo certo. Sem isto, um
        // `readFileSync` que devolvesse vazio passaria na asserção acima para sempre.
        const usos = [...aba.matchAll(/linhasDaResposta\(/g)];
        expect(usos.length, 'os DOIS sítios (a cópia guardada e a lista) usam o mesmo leitor')
            .toBeGreaterThanOrEqual(2);
    });

    it('e o servidor continua mandando `data`: a fonte é o serviço, não este arquivo', () => {
        // O elo que fecha a afirmação. Comparar a tela com uma constante escrita aqui seria
        // comparar o cliente consigo mesmo; o nome do campo é decisão do servidor.
        const servico = readFileSync(
            resolve(RAIZ, 'backend/src/modules/audit/audit.service.js'), 'utf8',
        );
        expect(servico).toMatch(/^\s*data: data\.rows,$/m);
        expect(servico, 'se o servidor passar a mandar `items`, é aqui que se descobre')
            .not.toMatch(/^\s*items:/m);
    });
});

describe('nomeDeOmNasLinhas — o nome da OM que já saiu da lista de ativas', () => {
    it('acha o nome na página que está na tela', () => {
        // É o consumidor do defeito acima: com a cópia sempre vazia, esta função devolvia
        // `undefined` SEMPRE e o filtro caía no UUID cru.
        expect(nomeDeOmNasLinhas(linhasDaResposta(RESPOSTA), 'om-morta')).toBe('OMX');
    });

    it('não achando, devolve `undefined` em vez de inventar', () => {
        // `buildDomainOptions` já cai no id nesse caso, e um nome inventado seria pior que
        // mostrar o id.
        expect(nomeDeOmNasLinhas(linhasDaResposta(RESPOSTA), 'om-que-nao-veio')).toBeUndefined();
        expect(nomeDeOmNasLinhas([], 'om-morta')).toBeUndefined();
        expect(nomeDeOmNasLinhas(null, 'om-morta')).toBeUndefined();
        // Sem filtro não há o que resolver.
        expect(nomeDeOmNasLinhas(linhasDaResposta(RESPOSTA), '')).toBeUndefined();
    });

    it('a linha sem sigla e sem nome NÃO vira um id truncado', () => {
        // O último degrau de `nomeDaOm` é o id cortado em oito caracteres — certo numa célula
        // estreita da lista, errado num seletor, onde `buildDomainOptions` já mostraria o id
        // INTEIRO. Rótulo pior que o padrão não é rótulo, então aqui a resposta é ausência.
        const so_id = [{ target_org_id: '3f2b1c4d-0000-4000-8000-000000000001' }];
        expect(nomeDeOmNasLinhas(so_id, '3f2b1c4d-0000-4000-8000-000000000001')).toBeUndefined();
        // DISCRIMINAÇÃO: com o nome longo e sem sigla, o nome vence e sai inteiro.
        expect(nomeDeOmNasLinhas(
            [{ target_org_id: 'om-1', target_org_nome: 'Organização Um' }], 'om-1',
        )).toBe('Organização Um');
    });
});
