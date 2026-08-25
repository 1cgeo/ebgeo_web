// Path: tests/unit/auditoria-gaveta-de-detalhes.test.js

/**
 * @fileoverview A GAVETA DE UMA LINHA DA TRILHA: o que ela mostra, e o que ela mostrava de
 * menos.
 *
 * QUATRO CAMPOS CHEGAVAM DO SERVIDOR E MORRIAM NO CLIENTE. `audit.queries.js` seleciona
 * `a.id`, `a.ip`, `a.user_agent` e `a.created_at`, e a varredura em `frontend/src/` não achava
 * uma única leitura dos três primeiros. Numa trilha de auditoria isso não é dado decorativo: é
 * de onde veio o ato e qual linha citar num relatório.
 *
 * OUTROS DOIS VIVIAM SÓ NO `title` (`target_id` e o nome longo da OM). `title` não existe no
 * toque, não existe no teclado, e o leitor de tela o anuncia de forma que ninguém controla:
 * dado que só mora ali é dado que metade das pessoas não tem.
 *
 * E `bytesDe`/`bytesPara` DO DE-PARA. `backend/src/utils/audit-diff.js` os grava desde que o
 * regime de impressão nasceu, dizendo por extenso para que servem — responder "encolheu ou
 * cresceu?" sem carregar um byte do valor. Era a única pergunta que a impressão sabia
 * responder além de "mudou?", e ninguém a lia.
 *
 * POR QUE FUNÇÃO PURA E NÃO DOM: não há jsdom neste pacote (o ambiente do vitest é `node`).
 * O que fica preso aqui é a decisão de vocabulário; que a gaveta ABRE de verdade é matéria do
 * Playwright (`tests/e2e-ui/browser-admin-auditoria.spec.js`).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { instanteCompleto, linhasDoDePara, linhasTecnicas } from '../../src/js/admin/audit-phrases.js';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RAIZ = resolve(FRONT, '..');
const semComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Uma linha completa, como a rota a devolve. */
const LINHA = Object.freeze({
    id: '9f1c2d3e-0000-4000-8000-000000000001',
    action: 'CATALOG_UPDATE',
    actor_id: 'a1', actor_username: 'fulano', actor_nome: 'Fulano de Tal',
    target_type: 'TILESET', target_id: 'modelo-x', target_name: 'Modelo X',
    target_org_id: 'om-1', target_org_sigla: 'OM1', target_org_nome: 'Organização Um',
    created_at: '2026-08-20T13:45:07.000Z',
    ip: '10.1.2.3',
    user_agent: 'Mozilla/5.0 (Windows NT 10.0)',
    details: { table: 'tilesets' },
});

describe('linhasTecnicas — o que o servidor mandava e a tela jogava fora', () => {
    it('os SEIS fatos aparecem, cada um com o nome dele', () => {
        const porChave = Object.fromEntries(linhasTecnicas(LINHA).map((l) => [l.chave, l]));
        // PISO — a função devolveu linhas. Um array vazio passaria em toda ausência.
        expect(Object.keys(porChave).length).toBeGreaterThanOrEqual(6);

        expect(porChave['Identificador da linha'].texto).toBe(LINHA.id);
        expect(porChave['Identificador do alvo'].texto).toBe('modelo-x');
        expect(porChave['Origem da requisição'].texto).toBe('10.1.2.3');
        expect(porChave['Cliente declarado'].texto).toBe('Mozilla/5.0 (Windows NT 10.0)');
        // O NOME LONGO da OM, que na célula da lista sai como sigla.
        expect(porChave['OM do acervo'].texto).toBe('Organização Um');
        // O CARIMBO SAI DUAS VEZES: a forma local é a que se lê, a gravada é a que se cita,
        // porque é ela que aparece igual em qualquer máquina.
        expect(porChave['Carimbo gravado'].texto).toBe('2026-08-20T13:45:07.000Z');
        expect(porChave.Instante.texto).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    });

    it('o que é CÓDIGO sai marcado, e o que é frase não', () => {
        // Mesma regra da segunda seção da gaveta: mostrar um UUID com cara de frase engana.
        const porChave = Object.fromEntries(linhasTecnicas(LINHA).map((l) => [l.chave, l]));
        expect(porChave['Identificador da linha'].ehCodigo).toBe(true);
        expect(porChave['Identificador do alvo'].ehCodigo).toBe(true);
        expect(porChave['Cliente declarado'].ehCodigo).toBe(true);
        expect(porChave['Carimbo gravado'].ehCodigo).toBe(true);
        // DISCRIMINAÇÃO — a bandeira precisa poder ser falsa, senão ela não separa nada.
        expect(porChave.Instante.ehCodigo).toBe(false);
        expect(porChave['OM do acervo'].ehCodigo).toBe(false);
    });

    it('a OM sem nome cai no id, e sai marcada como o código que ela é', () => {
        const so_id = linhasTecnicas({ ...LINHA, target_org_nome: null, target_org_sigla: null });
        const om = so_id.find((l) => l.chave === 'OM do acervo');
        expect(om.texto).toBe('om-1');
        expect(om.ehCodigo).toBe(true);
    });

    it('`system` NÃO é um endereço, e não sai marcado como código', () => {
        // `ip` é NOT NULL na tabela, e `createAudit` grava a palavra `system` quando o ato
        // não veio de requisição nenhuma. Ela é frase, não endereço.
        const doSistema = linhasTecnicas({ ...LINHA, ip: 'system' });
        const origem = doSistema.find((l) => l.chave === 'Origem da requisição');
        expect(origem.texto).toBe('system');
        expect(origem.ehCodigo).toBe(false);
    });

    it('uma linha MAGRA (um LOGIN, sem alvo e sem `details`) ainda tem o que dizer', () => {
        // É justamente a linha que antes não ganhava gaveta nenhuma, porque a gaveta só
        // existia quando `details` vinha não vazio — e é a que mais precisa do endereço.
        const login = {
            id: 'l9', action: 'LOGIN', actor_id: 'u1',
            created_at: '2026-08-20T13:40:00.000Z', ip: '200.1.2.3',
        };
        const porChave = Object.fromEntries(linhasTecnicas(login).map((l) => [l.chave, l]));
        expect(porChave['Origem da requisição'].texto).toBe('200.1.2.3');
        expect(porChave['Identificador da linha'].texto).toBe('l9');
        // O que a linha não tem NÃO é inventado.
        expect(porChave['Identificador do alvo']).toBeUndefined();
        expect(porChave['OM do acervo']).toBeUndefined();
        expect(porChave['Cliente declarado']).toBeUndefined();
    });

    it('linha vazia devolve lista vazia, sem explodir', () => {
        expect(linhasTecnicas({})).toEqual([]);
        expect(linhasTecnicas(null)).toEqual([]);
        expect(linhasTecnicas(undefined)).toEqual([]);
    });

    it('data ilegível não vira "Invalid Date" nem carimbo fantasma', () => {
        expect(instanteCompleto('lixo')).toBe('');
        const ruim = linhasTecnicas({ id: 'x', created_at: 'lixo' });
        expect(ruim.some((l) => l.chave === 'Instante')).toBe(false);
        expect(ruim.some((l) => l.chave === 'Carimbo gravado')).toBe(false);
    });
});

describe('o TAMANHO do valor no de-para, que o servidor grava e ninguém lia', () => {
    it('cresceu, encolheu e ficou igual são três frases diferentes', () => {
        const cresceu = linhasDoDePara({
            mudou: [{
                campo: 'config.previewVideo', regime: 'impressao',
                de: null, para: 'a1b2c3d4e5f6', bytesDe: 0, bytesPara: 61,
            }],
            outros: [],
        });
        expect(cresceu[0].texto).toContain('cresceu de 0 para 61 bytes');

        const encolheu = linhasDoDePara({
            mudou: [{
                campo: 'config.url', regime: 'impressao',
                de: 'aaaaaaaaaaaa', para: 'bbbbbbbbbbbb', bytesDe: 120, bytesPara: 40,
            }],
            outros: [],
        });
        expect(encolheu[0].texto).toContain('encolheu de 120 para 40 bytes');

        // O MESMO TAMANHO é um fato próprio, e não a ausência de um: numa URL, trocar o host
        // por outro do mesmo comprimento é exatamente o que a impressão sozinha não conta.
        const igual = linhasDoDePara({
            mudou: [{
                campo: 'config.url', regime: 'impressao',
                de: 'aaaaaaaaaaaa', para: 'bbbbbbbbbbbb', bytesDe: 40, bytesPara: 40,
            }],
            outros: [],
        });
        expect(igual[0].texto).toContain('mesmo tamanho (40 bytes)');
    });

    it('a frase da impressão CONTINUA dizendo "impressão": o tamanho não a substitui', () => {
        // A discriminação do caso acima. Sem esta asserção, um conserto que trocasse a
        // palavra pelo número passaria verde, e doze hexadecimais voltariam a se ler como
        // valor gravado.
        const [linha] = linhasDoDePara({
            mudou: [{
                campo: 'config.url', regime: 'impressao',
                de: null, para: 'd4e5f6a1b2c3', bytesDe: 0, bytesPara: 61,
            }],
            outros: [],
        });
        expect(linha.texto).toContain('impressão');
        expect(linha.texto).toContain('d4e5f6a1b2c3');
        expect(linha.texto).toContain('(vazio)');
    });

    it('linha ANTIGA, sem a medida, não ganha um zero inventado', () => {
        // Dizer "encolheu de 0 para 0 bytes" sobre um dado que ninguém mediu seria afirmar
        // uma apuração que não houve.
        const [linha] = linhasDoDePara({
            mudou: [{ campo: 'config.url', regime: 'impressao', de: null, para: 'd4e5f6a1b2c3' }],
            outros: [],
        });
        expect(linha.texto).toContain('impressão');
        expect(linha.texto).not.toContain('bytes');
    });

    it('o VALOR literal não ganha tamanho: ele já mostra o valor inteiro', () => {
        const [linha] = linhasDoDePara({
            mudou: [{ campo: 'name', de: 'Modelo A', para: 'Modelo B' }], outros: [],
        });
        expect(linha.texto).toBe('“Modelo A” → “Modelo B”');
    });

    it('e o SERVIDOR continua gravando os dois campos: a fonte é o de-para dele', () => {
        // O elo que fecha a afirmação. Comparar a tela com uma constante escrita aqui seria
        // comparar o cliente consigo mesmo.
        const diff = readFileSync(resolve(RAIZ, 'backend/src/utils/audit-diff.js'), 'utf8');
        expect(diff).toMatch(/^\s*bytesDe: bytesDe\(de\),$/m);
        expect(diff).toMatch(/^\s*bytesPara: bytesDe\(para\),$/m);
    });
});

describe('a gaveta, do lado da tela: teto, preguiça e as três seções', () => {
    const aba = semComentarios(readFileSync(resolve(FRONT, 'src/js/admin/audit-tab.js'), 'utf8'));
    const css = readFileSync(resolve(FRONT, 'src/css/admin.css'), 'utf8');

    it('as TRÊS seções são desenhadas, e a técnica é a que faltava', () => {
        for (const fonte of ['linhasDoDePara(', 'linhasDeDetalhe(', 'linhasTecnicas(']) {
            expect(aba, `a gaveta parou de desenhar ${fonte}`).toContain(fonte);
        }
    });

    it('a gaveta é construída SÓ quando alguém a abre', () => {
        // `details` é JSONB sem teto no servidor (`backend/src/utils/audit.js`), e a página
        // pode ter 200 linhas: montar 200 gavetas que ninguém pediu é custo sem limite
        // conhecido. A construção mora dentro do `click`.
        const dentroDoClique = aba.match(
            /'click',\s*\(\)\s*=>\s*\{[\s\S]{0,400}?this\._detalhes\(linha\)/,
        );
        expect(dentroDoClique, 'a gaveta voltou a ser montada junto com a linha').not.toBeNull();
        expect(aba).toMatch(/if \(!caixa\.hasChildNodes\(\)\)/);
    });

    it('a gaveta tem TETO e rola dentro de si', () => {
        // O defeito: sem altura máxima, uma linha com `details` grande empurrava a lista
        // inteira para fora da tela e a paginação virava rolagem.
        const regra = css.match(/\.admin-audit__details \{([\s\S]*?)\}/);
        expect(regra, 'a regra da gaveta sumiu do CSS').not.toBeNull();
        expect(regra[1]).toMatch(/max-height:/);
        expect(regra[1], 'rolar mostra tudo; truncar esconderia dado numa tela de auditoria')
            .toMatch(/overflow:\s*auto/);
    });

    it('`hidden` continua vencendo o `display` da linha da tabela', () => {
        // A gaveta virou uma `<tr>` irmã, e uma `<tr>` recebe `display: table-row` da folha
        // do navegador: sem esta regra o atributo `hidden` perde o significado e a gaveta
        // nasce aberta em todas as linhas.
        expect(css).toMatch(/\.admin-audit__details-row\[hidden\]\s*\{\s*display:\s*none;\s*\}/);
    });
});
