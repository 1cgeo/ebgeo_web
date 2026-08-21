// Path: tests/unit/auditoria-rotulos.test.js

/**
 * @fileoverview TODA AÇÃO DO VOCABULÁRIO VIGENTE TEM FRASE EM pt-BR — e o inventário vem
 * do BANCO, não deste arquivo nem do mapa que ele testa.
 *
 * O modo de falha que este guarda existe para impedir: uma ação NOVA entra no CHECK de
 * `audit_trail.action` numa migração e a aba de Auditoria a mostra como `ACAO_NOVA`, sem
 * que nada fique vermelho. Comparar o mapa de rótulos consigo mesmo seria cobertura vazia;
 * comparar contra uma lista escrita à mão aqui seria a mesma coisa com um passo a mais.
 *
 * O INVENTÁRIO É LIDO DA MIGRAÇÃO MAIS RECENTE QUE DECLARA O CHECK, exatamente como o
 * censo do backend faz, e pela mesma razão: o vocabulário deixou de morar num arquivo só
 * quando a 009 alargou o CHECK da baseline, e um leitor que fixasse o nome da baseline
 * ficaria cego para tudo que veio depois — a classe de defeito "ação declarada sem
 * emissor" reentrando pela porta do guarda.
 *
 * O PISO: o arquivo afirma primeiro que ACHOU pelo menos 29 ações. Sem ele, um regex que
 * parasse de casar compararia vazio com vazio e passaria verde para sempre.
 *
 * A DISCRIMINAÇÃO: uma ação inventada devolve o PRÓPRIO CÓDIGO como rótulo e família
 * `sistema`, nunca string vazia e nunca "Desconhecido". O fallback pelo código cru é
 * deliberado — um rótulo genérico esconderia a ação sem tradução, que é o defeito que este
 * arquivo mede.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    FAMILIAS,
    acoesPorFamilia,
    agruparPorDia,
    alvoDoEvento,
    chaveDoDia,
    familiaDeAcao,
    fraseDoEvento,
    horaDoEvento,
    linhasDoDePara,
    nomeDaOm,
    nomeDoAlvo,
    nomeDoAtor,
    rotuloDeAcao,
    rotuloDeAlvo,
    rotuloDeCampo,
    chavesJaDitasPeloDePara,
    rotuloDeFamilia,
    rotuloDoDia,
} from '../../src/js/admin/audit-phrases.js';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MIGRACOES = resolve(RAIZ, 'backend/src/database/migrations');

/**
 * As ações do CHECK vigente: a migração de MAIOR número que o declara vence, que é o que
 * o banco faz.
 * @param {RegExp} marcador
 * @returns {string[]}
 */
function vocabularioVigente(marcador) {
    const arquivos = readdirSync(MIGRACOES)
        .filter((f) => f.endsWith('.sql'))
        .sort()
        .reverse();
    for (const nome of arquivos) {
        const sql = readFileSync(resolve(MIGRACOES, nome), 'utf8');
        const m = sql.match(marcador);
        if (m) return [...m[1].matchAll(/'([A-Z0-9_]+)'/g)].map((x) => x[1]);
    }
    return [];
}

const ACOES = vocabularioVigente(/CHECK \(action IN \(([\s\S]*?)\)\)/);
const ALVOS = vocabularioVigente(/CHECK \(target_type IN \(([\s\S]*?)\)\)/);

describe('audit-phrases — o vocabulário do banco tem frase na tela', () => {
    it('piso: o inventário vem da migração vigente e não está vazio', () => {
        expect(ACOES.length, 'nenhuma ação lida: o regex parou de casar e o resto seria vácuo')
            .toBeGreaterThanOrEqual(29);
        expect(ALVOS.length).toBeGreaterThanOrEqual(13);
        // O piso do piso: a leitura precisa ter alcançado a migração NOVA, não a baseline.
        expect(ACOES).toContain('PERMISSION_REPARENT');
    });

    it('toda ação declarada tem rótulo em pt-BR e família conhecida', () => {
        const semFrase = ACOES.filter((a) => rotuloDeAcao(a) === a);
        expect(semFrase, `ações sem frase na aba Auditoria: ${semFrase.join(', ')}`).toEqual([]);

        const foraDaFamilia = ACOES.filter((a) => !FAMILIAS.includes(familiaDeAcao(a)));
        expect(foraDaFamilia).toEqual([]);
    });

    it('todo `target_type` declarado tem rótulo, inclusive os quatro reservados', () => {
        const semRotulo = ALVOS.filter((t) => rotuloDeAlvo(t) === t);
        expect(semRotulo, `tipos de alvo sem rótulo: ${semRotulo.join(', ')}`).toEqual([]);
        // Os quatro sem emissor NÃO saem daqui: linha já gravada pode carregá-los.
        for (const reservado of ['GROUP', 'MODEL', 'SYSTEM', 'STREETVIEW_MARKER']) {
            expect(ALVOS).toContain(reservado);
            expect(rotuloDeAlvo(reservado)).not.toBe(reservado);
        }
    });

    it('ação desconhecida devolve o PRÓPRIO CÓDIGO, nunca "Desconhecido" nem vazio', () => {
        expect(rotuloDeAcao('ACAO_QUE_NAO_EXISTE')).toBe('ACAO_QUE_NAO_EXISTE');
        expect(familiaDeAcao('ACAO_QUE_NAO_EXISTE')).toBe('sistema');
        expect(rotuloDeAlvo('ALVO_QUE_NAO_EXISTE')).toBe('ALVO_QUE_NAO_EXISTE');
        // Vazio e nulo degradam para o travessão, que é o único caso em que não há código
        // nenhum a mostrar.
        expect(rotuloDeAcao('')).toBe('—');
        expect(rotuloDeAcao(null)).toBe('—');
    });

    it('o `<select>` de ação oferece TODAS as ações conhecidas, agrupadas', () => {
        const oferecidas = acoesPorFamilia().flatMap((g) => g.acoes.map((a) => a.valor));
        expect(new Set(oferecidas).size).toBe(oferecidas.length, 'ação repetida em duas famílias');
        for (const a of ACOES) expect(oferecidas).toContain(a);
    });
});

describe('audit-phrases — a linha colapsada', () => {
    const linha = {
        action: 'CATALOG_UPDATE',
        target_type: 'TILESET',
        target_id: 'modelo-x',
        target_name: 'Modelo X',
        actor_nome: 'Fulano de Tal',
        actor_username: 'fulano',
        actor_id: 'a1b2',
        created_at: '2026-08-20T13:45:00.000Z',
    };

    it('a frase nomeia ator, ato, tipo e alvo', () => {
        const f = fraseDoEvento(linha);
        expect(f).toContain('Fulano de Tal (fulano)');
        expect(f).toContain('Item de catálogo alterado');
        expect(f).toContain('Modelo 3D');
        expect(f).toContain('Modelo X');
    });

    it('ator apagado degrada para o id truncado, e não some da linha', () => {
        // `actor_id` não tem FK (a trilha sobrevive ao delete da conta) e a junta vem
        // vazia — justamente na linha que mais importa numa investigação.
        const orfa = { ...linha, actor_nome: null, actor_username: null };
        expect(nomeDoAtor(orfa)).toBe('Conta removida (a1b2)');
        // A discriminação: com nome, o nome vence.
        expect(nomeDoAtor(linha)).toBe('Fulano de Tal (fulano)');
        // Sem ator nenhum a linha é do sistema.
        expect(nomeDoAtor({})).toBe('Sistema');
    });

    it('alvo sem nome cai no id, e sem id cai no tipo', () => {
        expect(nomeDoAlvo({ ...linha, target_name: null })).toBe('modelo-x');
        expect(nomeDoAlvo({ target_type: 'ATLAS' })).toBe('Atlas');
    });

    it('evento sem alvo nenhum para no ato, sem inventar um alvo', () => {
        const login = { action: 'LOGIN', actor_nome: 'Fulano', actor_username: 'fulano' };
        expect(fraseDoEvento(login)).toBe('Fulano (fulano) — Entrada no sistema');
    });

    it('a LINHA da lista não repete a ação: o chip a carrega, `alvoDoEvento` não', () => {
        // A tela põe DOIS nós irmãos na mesma linha: o chip (`rotuloDeAcao`) e o texto.
        // Enquanto o texto era `fraseDoEvento`, "Item de catálogo alterado" saía duas
        // vezes lado a lado — os dois desenhos foram escritos e ambos ficaram. Esta
        // asserção é a que teria pegado, e ela é NEGATIVA de propósito: o par positivo
        // logo abaixo é o que impede um `alvoDoEvento` vazio de passar verde aqui.
        const acao = rotuloDeAcao(linha.action);
        expect(acao).toBe('Item de catálogo alterado');
        expect(alvoDoEvento(linha)).not.toContain(acao);

        // O PISO: o texto da linha continua nomeando ator, tipo e alvo — é ele que
        // responde "quem fez com o quê" quando o chip já disse "o quê".
        const texto = alvoDoEvento(linha);
        expect(texto).toContain('Fulano de Tal (fulano)');
        expect(texto).toContain('Modelo 3D');
        expect(texto).toContain('Modelo X');

        // E a frase INTEIRA sobrevive, porque a tela a usa no `title`: sem ela, ler o
        // evento fora do contexto do chip perderia a ação.
        expect(fraseDoEvento(linha)).toContain(acao);

        // O ramo "sem alvo nenhum" é o mesmo dos dois: numa linha de LOGIN o chip diz
        // tudo, e inventar um alvo diria mais do que a linha sabe.
        const login = { action: 'LOGIN', actor_nome: 'Fulano', actor_username: 'fulano' };
        expect(alvoDoEvento(login)).toBe('Fulano (fulano)');
    });

    it('a OM mostra a sigla, e a ausência dela NÃO vira texto inventado', () => {
        expect(nomeDaOm({ target_org_sigla: 'OM1', target_org_nome: 'Organização Um' })).toBe('OM1');
        expect(nomeDaOm({ target_org_nome: 'Organização Um' })).toBe('Organização Um');
        // NULO significa duas coisas (alvo sem OM dona e acervo institucional) e a frase
        // não escolhe entre elas: o dado não as distingue.
        expect(nomeDaOm({})).toBe('—');
    });
});

describe('audit-phrases — as famílias têm rótulo de TELA, não chave de código', () => {
    it('toda família do enum tem um rótulo diferente da própria chave', () => {
        // A chave é código: ela colore o chip (`admin-audit__chip--acesso`) e agrupa o
        // filtro. Ela saía CRUA no `<optgroup>` do `<select>` de ação — "acesso",
        // "identidade", "acervo" em minúscula —, contra a convenção de string de UI em
        // pt-BR, e nada pegava: rótulo não é símbolo para o lint, e este arquivo só
        // conhecia ação e alvo.
        expect(FAMILIAS.length).toBeGreaterThanOrEqual(5);
        for (const f of FAMILIAS) {
            expect(rotuloDeFamilia(f), `família \`${f}\` sem rótulo de tela`).not.toBe(f);
            expect(rotuloDeFamilia(f)).toMatch(/^[A-ZÀ-Ú]/);
        }
    });

    it('família desconhecida devolve o PRÓPRIO código, como ação e alvo', () => {
        // Mesmo fallback honesto do resto do arquivo: um rótulo genérico esconderia a
        // família nova sem tradução.
        expect(rotuloDeFamilia('familia_nova')).toBe('familia_nova');
        expect(rotuloDeFamilia('')).toBe('—');
        expect(rotuloDeFamilia(undefined)).toBe('—');
    });
});

describe('audit-phrases — o agrupamento por dia', () => {
    it('a chave do dia é LOCAL, não UTC', () => {
        // Um evento às 22h de Brasília cairia no dia seguinte com `toISOString()`, e a
        // lista mostraria "amanhã" para o que acabou de acontecer.
        const local = new Date(2026, 7, 20, 22, 30);
        expect(chaveDoDia(local)).toBe('2026-08-20');
        expect(chaveDoDia('não é data')).toBe('');
    });

    it('linhas do mesmo dia caem no mesmo grupo, e a ordem é preservada', () => {
        const linhas = [
            { created_at: new Date(2026, 7, 20, 10) },
            { created_at: new Date(2026, 7, 20, 9) },
            { created_at: new Date(2026, 7, 19, 23) },
        ];
        const grupos = agruparPorDia(linhas);
        expect(grupos.map((g) => g.dia)).toEqual(['2026-08-20', '2026-08-19']);
        expect(grupos[0].linhas.length).toBe(2);
        expect(grupos[1].linhas.length).toBe(1);
        // Lista vazia não vira um grupo vazio: um cabeçalho de dia sem linha nenhuma é
        // pior que nada.
        expect(agruparPorDia([])).toEqual([]);
        expect(agruparPorDia(null)).toEqual([]);
    });

    it('o cabeçalho diz Hoje, Ontem, ou a data por extenso', () => {
        const hoje = new Date(2026, 7, 21, 15);
        expect(rotuloDoDia('2026-08-21', hoje)).toBe('Hoje');
        expect(rotuloDoDia('2026-08-20', hoje)).toBe('Ontem');
        const antigo = rotuloDoDia('2026-08-01', hoje);
        expect(antigo).not.toBe('Hoje');
        expect(antigo).toContain('2026');
        // Chave inválida não explode nem vira "Invalid Date".
        expect(rotuloDoDia('')).toBe('');
    });

    it('hora inválida degrada para `--:--`, nunca para "Invalid Date"', () => {
        expect(horaDoEvento('lixo')).toBe('--:--');
        expect(horaDoEvento(new Date(2026, 7, 20, 9, 5))).toMatch(/^\d{2}:\d{2}$/);
    });
});

describe('audit-phrases — o DE-PARA em frases', () => {
    it('os três regimes viram frases DIFERENTES, e a impressão se anuncia como impressão', () => {
        // PISO — o de-para existe e produz uma linha por campo. Sem esta contagem, todas as
        // asserções de conteúdo abaixo passariam num array vazio.
        const linhas = linhasDoDePara({
            table: 'tilesets',
            mudou: [
                { campo: 'name', de: 'Modelo A', para: 'Modelo B' },
                { campo: 'config.heightOffset', de: null, para: 12 },
                {
                    campo: 'config.previewVideo', regime: 'impressao',
                    de: null, para: 'a1b2c3d4e5f6', bytesDe: 0, bytesPara: 61,
                },
            ],
            outros: ['config.chaveInventada'],
            truncado: false,
        });
        expect(linhas.length).toBe(4);

        const porCampo = Object.fromEntries(linhas.map((l) => [l.campo, l.texto]));
        // VALOR: o valor aparece, entre aspas quando é texto.
        expect(porCampo.Nome).toBe('“Modelo A” → “Modelo B”');
        // VALOR ausente antes: "(vazio)" e não "null", que é ruído de implementação.
        expect(porCampo['Deslocamento de altura']).toBe('(vazio) → 12');
        // IMPRESSÃO: o texto DIZ que é impressão. É a discriminação que importa nesta
        // função — sem a palavra, doze hexadecimais leem-se como um valor gravado.
        expect(porCampo['Vídeo de prévia']).toContain('impressão');
        expect(porCampo['Vídeo de prévia']).toContain('a1b2c3d4e5f6');
        expect(porCampo['Vídeo de prévia']).toContain('(vazio)');
        // NOME-SÓ: o campo desconhecido mantém o nome CRU (sem o prefixo `config.`) e diz
        // em voz alta que o valor não foi registrado.
        expect(porCampo.chaveInventada).toBe('alterado (valor não registrado)');
    });

    it('o rótulo de campo cai no nome cru quando ninguém o traduziu', () => {
        // Mesmo fallback honesto do resto do arquivo. Um "Campo" genérico apagaria a única
        // informação que a linha tem sobre um campo sem tradução.
        expect(rotuloDeCampo('config.url')).toBe('Endereço do serviço');
        expect(rotuloDeCampo('config.sourceLayer')).toBe('sourceLayer');
        expect(rotuloDeCampo('inventado')).toBe('inventado');
        expect(rotuloDeCampo(undefined)).toBe('');
    });

    it('a linha TRUNCADA diz que truncou, em vez de parecer uma linha sem mudanças', () => {
        // A distinção que uma investigação precisa: "nada mudou de classificado" e "mudou
        // tanto que só os nomes couberam" são fatos diferentes, e a segunda sem aviso lê-se
        // como a primeira.
        const semDePara = linhasDoDePara({ table: 'tilesets', fields: ['name'] });
        expect(semDePara).toEqual([]);

        const truncada = linhasDoDePara({ mudou: [], outros: ['name'], truncado: true });
        expect(truncada.length).toBe(2);
        expect(truncada[1].texto).toContain('só os nomes dos campos foram gravados');
    });

    it('`fields` sai da segunda seção SÓ quando o de-para falou, e nunca na linha antiga', () => {
        // A gaveta tem duas seções: as FRASES do de-para em cima, o resto do `details` em
        // JSON cru embaixo. `fields` é a lista crua de nomes de campo, e numa linha COM
        // de-para ela é o mesmo conjunto dito duas vezes — `["config","name"]` logo abaixo
        // de `Nome: … → …` e `Endereço do serviço: alterado (impressão …)`.
        const comDePara = chavesJaDitasPeloDePara({
            table: 'tilesets', fields: ['config', 'name'],
            mudou: [{ campo: 'name', de: 'A', para: 'B' }], outros: [], truncado: false,
        });
        // PISO — as três chaves que o de-para consome sempre saem.
        for (const chave of ['mudou', 'outros', 'truncado']) {
            expect(comDePara.has(chave), `${chave} é matéria-prima do de-para`).toBe(true);
        }
        expect(comDePara.has('fields')).toBe(true);
        // E `table` NÃO sai: ele é informação que só a segunda seção tem.
        expect(comDePara.has('table')).toBe(false);

        // DISCRIMINAÇÃO — numa linha ANTIGA (sem de-para) `fields` é a ÚNICA informação de
        // campo que a trilha guarda, e apagá-la incondicionalmente perderia dado. É a
        // metade que uma constante fixa erraria.
        const semDePara = chavesJaDitasPeloDePara({ table: 'tilesets', fields: ['config'] });
        expect(semDePara.has('fields')).toBe(false);
        expect(semDePara.has('mudou')).toBe(true);

        // E a linha TRUNCADA conta como "o de-para falou": ela produz frases a partir de
        // `outros`, então `fields` seria repetição ali também.
        const truncada = chavesJaDitasPeloDePara({ fields: ['name'], mudou: [], outros: ['name'], truncado: true });
        expect(truncada.has('fields')).toBe(true);
    });

    it('todo campo classificado pelo SERVIDOR tem rótulo pt-BR, salvo os três declarados', () => {
        // O guarda estrutural: a lista de campos vem de `backend/src/utils/audit-diff.js`,
        // lida do arquivo, e não de uma cópia escrita aqui.
        //
        // ESTE CASO JÁ FOI TAUTOLÓGICO, e é a razão de ele estar escrito assim. Ele
        // perguntava se `linhasDoDePara` devolvia campo e texto NÃO VAZIOS para cada
        // caminho classificado — e `rotuloDeCampo` cai no nome cru quando não há tradução,
        // então `campo` era truthy por construção, para qualquer nome não vazio. MEDIDO:
        // apagar SEIS dos rótulos de `CAMPOS` deixava os 21 casos deste arquivo verdes.
        // Dos 26 caminhos classificados, só quatro tinham rótulo cobrado (pelos dois casos
        // acima); os outros podiam sumir sem vermelho.
        //
        // O predicado agora é de IGUALDADE EXATA entre "o que o servidor classifica sem
        // tradução aqui" e a lista declarada abaixo. Ele reprova nos dois sentidos: campo
        // novo classificado lá sem frase aqui, e rótulo apagado aqui. CONTROLE NEGATIVO
        // EXECUTADO: apagar três rótulos (`url`, `bounds`, `locate`) deixa DOIS casos
        // vermelhos deste arquivo, este e o do fallback.
        const fonte = readFileSync(
            resolve(RAIZ, 'backend/src/utils/audit-diff.js'), 'utf8',
        );
        const campos = [...fonte.matchAll(/^ {2}'([A-Za-z0-9_.]+)',$/gm)].map((m) => m[1]);
        // PISO — a regex ainda casa a fonte do backend. Uma lista vazia passaria em tudo
        // o que vem abaixo sem verificar nada.
        expect(campos.length).toBeGreaterThanOrEqual(20);

        // Os que ficam com o NOME CRU por decisão: são chaves técnicas de MapLibre, cujo
        // nome já é o vocabulário de quem investiga, e um rótulo inventado ("Camada de
        // origem") seria menos preciso que o original.
        const SEM_TRADUCAO_POR_DECISAO = ['config.labelSource', 'config.sourceLayer', 'config.tileSize'];
        // E a lista de exceções precisa ser SUBCONJUNTO do que o servidor classifica:
        // exceção para campo que já saiu de lá é linha morta que passa verde para sempre.
        expect(campos).toEqual(expect.arrayContaining(SEM_TRADUCAO_POR_DECISAO));

        const curto = (c) => (c.startsWith('config.') ? c.slice('config.'.length) : c);
        const semRotulo = campos.filter((c) => rotuloDeCampo(c) === curto(c));
        expect(semRotulo.sort()).toEqual(SEM_TRADUCAO_POR_DECISAO);

        // DISCRIMINAÇÃO — e o piso antigo, que continua valendo: traduzido ou cru, todo
        // caminho classificado vira uma linha com campo E texto não vazios.
        const semFrase = campos.filter((c) => {
            const [{ campo, texto } = {}] = linhasDoDePara({
                mudou: [{ campo: c, de: 'a', para: 'b' }], outros: [],
            });
            return !campo || !texto;
        });
        expect(semFrase).toEqual([]);
    });
});
