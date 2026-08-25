// Path: tests/unit/auditoria-filtros-da-aba.test.js

/**
 * @fileoverview O QUE A BARRA DE FILTROS DA ABA "AUDITORIA" OFERECE, medido contra o que o
 * SERVIDOR aceita — nunca contra outra cópia da mesma lista escrita no cliente.
 *
 * A CLASSE DE DEFEITO QUE ESTE ARQUIVO EXISTE PARA IMPEDIR já aconteceu duas vezes, e as duas
 * pelo mesmo motivo (a lista morava dentro do construtor de DOM, onde nenhum teste a
 * alcançava):
 *
 *   - `RANK` ganhou emissor em 2026-08-24 (`backend/src/modules/ranks/ranks.controller.js`),
 *     entrou no CHECK da migração e ganhou rótulo de tela, e ficou de FORA do filtro. Uma
 *     família inteira de atos (renumerar a hierarquia militar, que alimenta o cadastro da base
 *     toda) não era interrogável;
 *   - o parâmetro `to` está em `listAuditSchema` desde sempre e a tela só sabia calcular
 *     `from`, então não existia intervalo FECHADO: toda consulta ia de um ponto do passado
 *     até agora, e "o que aconteceu no dia 12" não era uma pergunta formulável.
 *
 * O INVENTÁRIO VEM DA MIGRAÇÃO VIGENTE, com a mesma leitura de `auditoria-rotulos.test.js` e
 * pela mesma razão: o vocabulário deixou de morar num arquivo só quando uma migração alargou o
 * CHECK da baseline, e um leitor que fixasse o nome da baseline ficaria cego para o que veio
 * depois.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    ALVOS_RESERVADOS,
    ALVOS_SEM_OM,
    FILTROS_DE_APURACAO,
    TIPOS_DE_ALVO,
    contarFiltrosDeApuracao,
    janelaDoPeriodo,
    resumoDaPagina,
    temFiltroAtivo,
    tiposDeAlvoVisiveis,
} from '../../src/js/admin/audit-phrases.js';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RAIZ = resolve(FRONT, '..');
const MIGRACOES = resolve(RAIZ, 'backend/src/database/migrations');

/** Os `target_type` do CHECK vigente: a migração de MAIOR número que o declara vence. */
function alvosDoBanco() {
    const arquivos = readdirSync(MIGRACOES).filter((f) => f.endsWith('.sql')).sort().reverse();
    for (const nome of arquivos) {
        const sql = readFileSync(resolve(MIGRACOES, nome), 'utf8');
        const m = sql.match(/CHECK \(target_type IN \(([\s\S]*?)\)\)/);
        if (m) return [...m[1].matchAll(/'([A-Z0-9_]+)'/g)].map((x) => x[1]);
    }
    return [];
}

const ALVOS_DO_BANCO = alvosDoBanco();

describe('o filtro de tipo de alvo é um CENSO do CHECK, não uma lista à mão', () => {
    it('piso: a leitura achou o vocabulário do banco', () => {
        // Sem isto, um regex que parasse de casar compararia vazio com vazio para sempre.
        expect(ALVOS_DO_BANCO.length).toBeGreaterThanOrEqual(15);
        // O piso do piso: a leitura alcançou a migração NOVA, e não só a baseline.
        expect(ALVOS_DO_BANCO).toContain('RANK');
    });

    it('todo tipo declarado está OFERECIDO ou declarado RESERVADO, e nunca nos dois', () => {
        // É esta igualdade que reprova o próximo `RANK`: um tipo novo no banco obriga alguém a
        // decidir de que lado ele cai, em vez de sumir por omissão.
        const decididos = [...TIPOS_DE_ALVO, ...ALVOS_RESERVADOS].sort();
        expect(decididos).toEqual([...ALVOS_DO_BANCO].sort());
        // E as duas listas não se cruzam: um tipo em ambas seria oferecido e negado ao mesmo
        // tempo, e a igualdade acima sozinha não pegaria isso (ela pegaria pelo tamanho, mas
        // só por acidente).
        const nosDois = TIPOS_DE_ALVO.filter((t) => ALVOS_RESERVADOS.includes(t));
        expect(nosDois).toEqual([]);
    });

    it('`RANK` está no filtro, e o caso o nomeia para a regressão ficar legível', () => {
        // O defeito medido, por extenso. Num laço ele reprovaria sem dizer qual era.
        expect(TIPOS_DE_ALVO).toContain('RANK');
    });

    it('os RESERVADOS são exatamente os quatro sem emissor', () => {
        // Eles existem no banco para que uma linha JÁ GRAVADA saiba dizer o que era, e é por
        // isso que `rotuloDeAlvo` os conhece. Oferecê-los no filtro seria oferecer quatro
        // opções que só produzem lista vazia.
        expect([...ALVOS_RESERVADOS].sort())
            .toEqual(['GROUP', 'MODEL', 'STREETVIEW_MARKER', 'SYSTEM']);
    });
});

describe('o recorte de tipos por audiência', () => {
    it('quem administra vê todos os oferecidos', () => {
        expect(tiposDeAlvoVisiveis(true)).toEqual([...TIPOS_DE_ALVO]);
    });

    it('quem não administra não recebe filtro que só produz lista vazia', () => {
        const dele = tiposDeAlvoVisiveis(false);
        // PISO: sobrou alguma coisa. Um recorte que zerasse tudo passaria em toda ausência.
        expect(dele.length).toBeGreaterThanOrEqual(5);
        for (const t of ALVOS_SEM_OM) {
            expect(dele, `${t} nunca devolve linha para quem não administra`).not.toContain(t);
        }
        // DISCRIMINAÇÃO: o que o produtor de fato alcança continua lá. O recorte por OM só
        // carimba catálogo, acesso a recurso e 360.
        for (const t of ['BASEMAP', 'DATA_LAYER', 'ANALYSIS_LAYER', 'TILESET', 'SV360_PROJECT']) {
            expect(dele).toContain(t);
        }
        // Só o booleano `true` administra: um valor solto não pode alargar o recorte.
        expect(tiposDeAlvoVisiveis(undefined)).toEqual(dele);
        expect(tiposDeAlvoVisiveis('sim')).toEqual(dele);
    });

    it('`RANK` cai no recorte, e a fonte disso é o EMISSOR, não esta lista', () => {
        // A medida, e não a afirmação: o controlador de postos diz por extenso que não passa
        // `targetOrgId`, então o predicado `a.target_org_id = $5` nunca casa uma linha de
        // posto. Se um dia ele passar a carimbar OM, este caso fica vermelho e a decisão
        // volta à mesa em vez de a tela seguir escondendo um filtro que passou a funcionar.
        const emissor = readFileSync(
            resolve(RAIZ, 'backend/src/modules/ranks/ranks.controller.js'), 'utf8',
        );
        const semComentarios = emissor.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        expect(semComentarios).toMatch(/targetType: 'RANK'/);
        expect(semComentarios, 'o posto passou a carimbar OM: `ALVOS_SEM_OM` mudou de resposta')
            .not.toMatch(/targetOrgId/);
        expect(ALVOS_SEM_OM).toContain('RANK');
    });
});

describe('janelaDoPeriodo — o intervalo FECHADO que a tela não sabia pedir', () => {
    const AGORA = new Date(2026, 7, 25, 15, 0, 0);

    it('o atalho de período calcula só o `from`: "os últimos N dias" não tem fim', () => {
        const { from, to } = janelaDoPeriodo({ dias: 7 }, AGORA);
        expect(to).toBeUndefined();
        expect(new Date(from).getTime()).toBe(AGORA.getTime() - 7 * 86400000);
    });

    it('"Tudo" não manda janela nenhuma', () => {
        expect(janelaDoPeriodo({ dias: null }, AGORA)).toEqual({ from: undefined, to: undefined });
        expect(janelaDoPeriodo({}, AGORA)).toEqual({ from: undefined, to: undefined });
    });

    it('a data absoluta VENCE o atalho na ponta que ela nomeia, e fecha o intervalo', () => {
        // A pergunta que não existia: "o que aconteceu no dia 12". Com o atalho vencendo, ela
        // viraria "os últimos 7 dias", que é outra pergunta.
        const { from, to } = janelaDoPeriodo({ dias: 7, de: '2026-08-12', ate: '2026-08-12' }, AGORA);
        expect(new Date(from)).toEqual(new Date(2026, 7, 12));
        // O PERÍODO É MEIO-ABERTO NO SERVIDOR (`>= from`, `< to`): o fim é o começo do dia
        // SEGUINTE, senão o dia 12 sairia de fora do próprio recorte que o nomeia.
        expect(new Date(to)).toEqual(new Date(2026, 7, 13));
    });

    it('uma ponta só refina AQUELA ponta, e a outra continua vindo do atalho', () => {
        // ESTE CASO AFIRMAVA O DEFEITO até 2026-08-25: ele cobrava `soAte.from` INDEFINIDO,
        // isto é, o atalho de 30 dias virando "desde sempre" porque alguém preencheu o fim da
        // janela. O que a tela mostrava nesse estado era uma barra sem atalho nenhum aceso,
        // "Tudo" inclusive, sobre uma consulta que era exatamente "Tudo". A regra nova está em
        // `janelaDoPeriodo`, e o vermelho está em `auditoria-eixo-de-tempo.test.js`.
        const soDe = janelaDoPeriodo({ dias: 30, de: '2026-08-01' }, AGORA);
        expect(new Date(soDe.from)).toEqual(new Date(2026, 7, 1));
        expect(soDe.to, 'sem "até", a janela continua aberta no futuro').toBeUndefined();

        const soAte = janelaDoPeriodo({ dias: 30, ate: '2026-08-01' }, AGORA);
        expect(new Date(soAte.from).getTime(), 'o atalho continua segurando o começo')
            .toBe(AGORA.getTime() - 30 * 86400000);
        expect(new Date(soAte.to)).toEqual(new Date(2026, 7, 2));
    });

    it('data ilegível não vira `Invalid Date` na query string', () => {
        // O campo é `<input type="date">`, mas o estado é uma string e a tela o serializa.
        // Uma data quebrada precisa degradar para "sem filtro", nunca para um ISO inválido.
        const { from, to } = janelaDoPeriodo({ dias: 7, de: 'lixo', ate: '' }, AGORA);
        expect(to).toBeUndefined();
        expect(new Date(from).getTime()).toBe(AGORA.getTime() - 7 * 86400000);
    });
});

describe('resumoDaPagina — o rodapé diz o INTERVALO, não só a página', () => {
    it('a primeira página de uma trilha grande', () => {
        const r = resumoDaPagina({ total: 213, page: 1, limit: 50 });
        expect(r.texto).toBe('1 a 50 de 213 eventos · página 1 de 5');
        expect(r).toMatchObject({ pagina: 1, paginas: 5, primeiro: 1, ultimo: 50 });
    });

    it('a ÚLTIMA página vem curta, e o intervalo mostra isso', () => {
        // "Página 5 de 5" não diz que ali só há 13 linhas. O intervalo diz.
        const r = resumoDaPagina({ total: 213, page: 5, limit: 50 });
        expect(r.texto).toBe('201 a 213 de 213 eventos · página 5 de 5');
    });

    it('lista vazia não vira "1 a 0 de 0"', () => {
        const r = resumoDaPagina({ total: 0, page: 1, limit: 50 });
        expect(r.texto).toBe('Nenhum evento');
        expect(r).toMatchObject({ paginas: 1, primeiro: 0, ultimo: 0 });
    });

    it('um evento só concorda no singular', () => {
        expect(resumoDaPagina({ total: 1, page: 1, limit: 50 }).texto)
            .toBe('1 a 1 de 1 evento · página 1 de 1');
    });

    it('a página é PRESA ao intervalo válido', () => {
        // Apertar um filtro estando na página 5 produziria "página 5 de 1", que se lê como
        // defeito da tela em vez de lista vazia.
        const r = resumoDaPagina({ total: 3, page: 5, limit: 50 });
        expect(r.pagina).toBe(1);
        expect(r.texto).toBe('1 a 3 de 3 eventos · página 1 de 1');
    });

    it('resposta sem números cai no limite que a TELA pediu, e não num zero mudo', () => {
        const r = resumoDaPagina(undefined, 200);
        expect(r.limite).toBe(200);
        expect(r.texto).toBe('Nenhum evento');
    });
});

describe('temFiltroAtivo — o botão "Limpar filtros" só existe quando há o que limpar', () => {
    const VAZIO = { action: '', targetType: '', targetId: '', targetOrgId: '', actorId: '' };

    it('o estado inicial da aba não tem filtro nenhum', () => {
        // O PERÍODO FICA DE FORA de propósito: ele nunca está vazio (a aba abre em 7 dias),
        // então contá-lo faria o botão aparecer numa tela sem filtro.
        expect(temFiltroAtivo(VAZIO)).toBe(false);
        expect(temFiltroAtivo({})).toBe(false);
        expect(temFiltroAtivo(null)).toBe(false);
    });

    it('qualquer um dos cinco acende o botão', () => {
        for (const chave of Object.keys(VAZIO)) {
            expect(temFiltroAtivo({ ...VAZIO, [chave]: 'x' }), chave).toBe(true);
        }
        // Espaço em branco não é filtro: ele não viaja na query string (`listAudit` descarta
        // o vazio, e a rota recusaria a string vazia com 422).
        expect(temFiltroAtivo({ ...VAZIO, targetId: '   ' })).toBe(false);
    });
});

describe('o que a aba MANDA ao servidor: os parâmetros que a rota sempre aceitou', () => {
    const semComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const aba = semComentarios(readFileSync(resolve(FRONT, 'src/js/admin/audit-tab.js'), 'utf8'));
    const schema = readFileSync(
        resolve(RAIZ, 'backend/src/modules/audit/audit.schemas.js'), 'utf8',
    );

    it('o schema da rota aceita os nove, e é dele que sai o inventário', () => {
        // PISO: a leitura do schema achou mesmo os campos. Sem isto, um regex quebrado
        // deixaria as asserções abaixo comparando vazio com vazio.
        const aceitos = [...schema.matchAll(/^ {2}(\w+): Joi\./gm)].map((m) => m[1]);
        expect(aceitos.sort()).toEqual([
            'action', 'actorId', 'from', 'limit', 'page',
            'targetId', 'targetOrgId', 'targetType', 'to',
        ]);
        // `to` por extenso, porque é o que faltava na tela: num laço ele reprovaria sem dizer
        // qual dos nove era.
        expect(schema).toMatch(/^ {2}to: Joi\.date\(\)\.iso\(\),$/m);
    });

    it('a aba EXPÕE todos eles, `to`, `limit` e `actorId` inclusive', () => {
        // Os três que faltavam. `actorId` é o mais grave dos três: ele existia no estado de
        // filtros e o campo só era desenhado para quem administra, apesar de o serviço o
        // repassar nos DOIS ramos.
        expect(aba, 'o intervalo fechado precisa mandar `to`').toMatch(/\bp\.to = to;/);
        expect(aba, 'o tamanho da página deixou de ser fixo').toMatch(/limit: this\._porPagina/);
        expect(aba).toMatch(/data-?testid|admin-audit-ator/);
        // O CAMPO DO ATOR ESTÁ FORA DO GATE de `_administra`, e é esta a asserção que
        // reprovaria a volta do defeito. O gate por `administra` continua existindo, e o que
        // se mede é que ele não alcança mais o ator.
        const gateDoAtor = aba.match(/if \(this\._administra\)[\s\S]{0,400}?admin-audit-ator/);
        expect(gateDoAtor, 'o campo de ator voltou para dentro do gate de administrador')
            .toBeNull();
        expect(aba).toMatch(/'admin-audit-ator'/);
    });

    it('o limite oferecido cabe no teto do servidor (1 a 200)', () => {
        // Oferecer 500 faria a rota responder 422 no clique, e o defeito apareceria como
        // "Falha ao carregar a trilha".
        expect(schema).toMatch(/limit: Joi\.number\(\)\.integer\(\)\.min\(1\)\.max\(200\)/);
        const oferecidos = aba.match(/const PAGINACOES = Object\.freeze\(\[([^\]]*)\]\)/);
        expect(oferecidos, 'a lista de tamanhos de página sumiu do arquivo').not.toBeNull();
        const numeros = [...oferecidos[1].matchAll(/\d+/g)].map((m) => Number(m[0]));
        expect(numeros.length).toBeGreaterThanOrEqual(3);
        for (const n of numeros) {
            expect(n, `${n} está fora do que a rota aceita`).toBeGreaterThanOrEqual(1);
            expect(n).toBeLessThanOrEqual(200);
        }
    });
});

describe('contarFiltrosDeApuracao — o selo que impede o recolhimento de esconder recorte', () => {
    const vazio = { action: '', targetType: '', targetId: '', targetOrgId: '', actorId: '' };

    it('sem nada preenchido, não há selo', () => {
        expect(contarFiltrosDeApuracao(vazio)).toBe(0);
        expect(contarFiltrosDeApuracao(undefined)).toBe(0);
    });

    it('conta os três que moram atrás do recolhimento', () => {
        expect(contarFiltrosDeApuracao({ ...vazio, actorId: 'u1' })).toBe(1);
        expect(contarFiltrosDeApuracao({ ...vazio, actorId: 'u1', targetId: 'r2' })).toBe(2);
        expect(contarFiltrosDeApuracao({ ...vazio, actorId: 'u1', targetId: 'r2', targetOrgId: 'o3' })).toBe(3);
    });

    it('e NÃO conta os que ficam à vista', () => {
        // Período e ação são a consulta do dia a dia e continuam na primeira fileira. Contá-los
        // faria o selo acender sobre filtros que ninguém precisa procurar.
        expect(contarFiltrosDeApuracao({ ...vazio, action: 'LOGIN', targetType: 'USER' })).toBe(0);
        expect(FILTROS_DE_APURACAO).not.toContain('action');
        expect(FILTROS_DE_APURACAO).not.toContain('targetType');
    });

    it('espaço em branco não é filtro', () => {
        // O campo aplica com `trim()`, então um id de espaços não recorta nada. Um selo aceso
        // sobre uma lista inteira mentiria na direção oposta.
        expect(contarFiltrosDeApuracao({ ...vazio, targetId: '   ' })).toBe(0);
    });
});
