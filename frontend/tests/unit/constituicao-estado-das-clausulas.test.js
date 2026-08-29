// Path: tests/unit/constituicao-estado-das-clausulas.test.js
//
// O guarda do estado das cláusulas da CONSTITUICAO.md.
//
// POR QUE ELE EXISTE, com a data e o tamanho do estrago: em 2026-08-21 uma auditoria por
// seções mediu as 55 cláusulas contra o código e achou que o commit que transformara cinco
// ondas de decisão em código havia virado o estado de UMA. Vinte e três cláusulas diziam
// "em obra" sobre coisas entregues, e DOZE delas carregavam uma frase começando em "Hoje"
// que afirmava o oposto do código: "não existe eixo de grupo em atlas em lugar nenhum do
// servidor" quando existiam coluna, CHECK, índice, três funções e três rotas; "não há
// filtragem nenhuma nesse caminho" quando a poda de saída já existia com teste estrutural
// de fiação. O próprio cabeçalho do documento manda mudar o estado no mesmo commit, e a
// regra escrita não segurou, como regra escrita nunca segura.
//
// O QUE FAZ DESTE DOCUMENTO O PIOR LUGAR PARA ISSO ACONTECER: uma negação absoluta e falsa
// numa especificação não é ruído, é instrução. Um agente que leia "não existe X em lugar
// nenhum" vai IMPLEMENTAR X uma segunda vez, ou escrever mitigação de aplicação em cima de
// um predicado que já fecha no SQL.
//
// SÃO DOIS MECANISMOS, e eles cobrem metades diferentes:
//
//   (1) TODA cláusula vigente cita, entre crases, o arquivo de teste que a prende. Isto dá
//       dentes à definição do cabeçalho ("o código já faz isso hoje, E HÁ TESTE"), que antes
//       era honra. O acoplamento REAL vem de graça: `docs-integridade.test.js` valida que
//       todo caminho citado entre crases existe, então apagar ou renomear o teste que prova
//       uma cláusula fica VERMELHO apontando para a cláusula. É a única metade que liga o
//       documento ao código; sem ela, tudo aqui seria arrumação de texto.
//
//   (2) CENSO das cláusulas que NÃO estão vigentes, com o motivo escrito. Fechar uma, abrir
//       uma nova ou mudar a natureza de uma exige tocar nesta lista, então a mudança é
//       deliberada e visível num diff, em vez de sumir dentro de um arquivo de 300 linhas.
//
// O QUE ISTO NÃO ALCANÇA, dito antes que alguém conclua o contrário de um verde: nada aqui
// verifica que a cláusula é VERDADE. Um teste citado pode não provar o que a cláusula
// afirma, e nenhuma varredura sabe disso. O que este arquivo garante é mais estreito e
// ainda assim é o que faltava: que exista uma citação, que ela aponte para arquivo que
// existe, e que a lista do que está aberto seja curta e declarada.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Raiz do MONOREPO, três níveis acima: a constituição é do produto, não do pacote web.
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const TEXTO = readFileSync(join(RAIZ, 'CONSTITUICAO.md'), 'utf8');

const ESTADOS = ['vigente', 'em obra', 'pendente'];

/**
 * As cláusulas, cada uma do seu marcador até o próximo (ou até o fim). O corpo inclui as
 * listas e os parágrafos que pendem da cláusula, que é onde vários estados moram.
 * @returns {Array<{numero: string, corpo: string, estados: string[]}>}
 */
function clausulas() {
    const marcador = /^\*\*(\d+\.\d+)\*\*/gm;
    const pontos = [...TEXTO.matchAll(marcador)].map((m) => ({ numero: m[1], em: m.index }));
    return pontos.map((p, i) => {
        const corpo = TEXTO.slice(p.em, i + 1 < pontos.length ? pontos[i + 1].em : TEXTO.length);
        const estados = [...corpo.matchAll(/\*\*\[(vigente|em obra|pendente)\]\*\*/g)].map((m) => m[1]);
        return { numero: p.numero, corpo, estados };
    });
}

/** Caminhos de arquivo de teste citados entre crases dentro de um corpo de cláusula. */
function testesCitados(corpo) {
    return [...corpo.matchAll(/`([^`]+\.(?:test|spec)\.js)`/g)].map((m) => m[1]);
}

// -----------------------------------------------------------------------------------
// (2) O CENSO. Uma linha por cláusula que NÃO está inteiramente vigente, com o motivo.
//
// `natureza` separa o que espera DECISÃO do que espera TRABALHO, porque as duas envelhecem
// diferente: a segunda some quando alguém a faz, a primeira só some quando o dono responde.
// -----------------------------------------------------------------------------------
const ABERTAS = [
    {
        numero: '1.5',
        estado: 'pendente',
        natureza: 'dependência externa',
        motivo: 'auto-cadastro: o endurecimento está feito e a abertura da rota espera o relay de e-mail existir',
    },
    {
        numero: '6.6',
        estado: 'em obra',
        natureza: 'trabalho',
        motivo: 'o CONSENTIMENTO do empréstimo ao link público: o predicado foi reexaminado em'
            + ' 2026-08-29 e MANTIDO (restringi-lo a quem tem conta não protegeria nada, porque o'
            + ' auto-cadastro é aberto), então o que falta é a tela nomear, ao publicar o link, os'
            + ' recursos privados que o atlas empresta',
    },
    {
        numero: '9.3',
        estado: 'em obra',
        natureza: 'trabalho',
        motivo: 'o de-para vale para catálogo, 360 e usuários; atlas, permissões e grupos seguem com'
            + ' registro próprio, sem antes e depois',
    },
    {
        numero: '10.1',
        estado: 'em obra',
        natureza: 'trabalho',
        motivo: 'o gate por recurso no tile FOI FEITO em 2026-08-29 e a cláusula deixou de descrever um'
            + ' defeito; o que resta é a sonda com data no deploy (nada no repositório prova o que o'
            + ' nginx do host faz) e o 422 que recusa marcar privada uma linha de terceiro',
    },
    {
        numero: '10.7',
        estado: 'em obra',
        natureza: 'trabalho',
        motivo: 'as três amarras da chave de API (prazo, escopo e revogação individual) entraram em'
            + ' 2026-08-24; falta o `location` do nginx, que não tem teste aqui e vira sonda com data no'
            + ' deploy, e falta aposentar o slot antigo de `users.api_key`',
    },
];

describe('CONSTITUICAO.md: o estado das cláusulas não apodrece em silêncio', () => {
    it('a varredura acha as cláusulas, e o piso não olha para o resultado dela', () => {
        // O PISO PRIMEIRO, e ele é sobre a varredura, não sobre o documento: uma regex que
        // deixasse de casar devolveria lista vazia, e TODA asserção de "para toda cláusula"
        // abaixo passaria verde sem ter lido cláusula nenhuma. É a forma de cobertura vazia
        // que este projeto mais paga.
        const lista = clausulas();
        expect(lista.length).toBeGreaterThan(50);
        expect(lista[0].numero).toBe('1.1');
        expect(lista.map((c) => c.numero)).toContain('10.5');
        // E o corpo é corpo mesmo: a primeira cláusula precisa ter texto além do marcador.
        expect(lista[0].corpo.length).toBeGreaterThan(80);
    });

    it('toda cláusula NORMATIVA declara um estado, e só estados conhecidos', () => {
        // A SEÇÃO 10 É EXCEÇÃO, e por natureza e não por preguiça: ela não promete nada, ela
        // registra LIMITE ACEITO ("o grafo de concessões é um grafo, não uma árvore"). Limite
        // não tem estado de trabalho, e exigir um faria alguém carimbar "vigente" num
        // parágrafo que diz o que o produto NÃO faz, o que é pior que a ausência. A 10.1 é a
        // única de lá que carrega estado, porque ela está PARADA por decisão do dono e volta
        // a andar quando ele decidir, e por isso ela conta no censo abaixo como as outras.
        const normativas = clausulas().filter((c) => !c.numero.startsWith('10.'));
        expect(normativas.length).toBeGreaterThan(45);
        const semEstado = normativas.filter((c) => c.estados.length === 0).map((c) => c.numero);
        expect(
            semEstado,
            'cláusula sem estado declarado: quem lê não sabe se é promessa ou fato',
        ).toEqual([]);
        for (const c of clausulas()) {
            for (const e of c.estados) expect(ESTADOS).toContain(e);
        }
    });

    it('toda cláusula VIGENTE cita o teste que a prende, e o arquivo existe', () => {
        // É esta a asserção que liga o documento ao código. As outras arrumam texto.
        const faltando = [];
        const inexistente = [];
        for (const c of clausulas()) {
            if (!c.estados.includes('vigente')) continue;
            const citados = testesCitados(c.corpo);
            if (citados.length === 0) { faltando.push(c.numero); continue; }
            for (const t of citados) {
                if (!existsSync(join(RAIZ, t))) inexistente.push(`${c.numero} -> ${t}`);
            }
        }
        expect(
            faltando,
            'cláusula vigente sem teste citado. O cabeçalho define vigente como "o código já faz isso hoje, '
            + 'E HÁ TESTE": sem a citação, o estado é uma afirmação sobre a qual nada pode ficar vermelho. '
            + 'Cite o arquivo de teste entre crases, ou baixe o estado.',
        ).toEqual([]);
        expect(
            inexistente,
            'cláusula que cita teste inexistente (renomeado ou apagado)',
        ).toEqual([]);
    });

    it('DISCRIMINAÇÃO: a extração de citação não casa com qualquer crase', () => {
        // Sem isto, um `testesCitados` que devolvesse o primeiro trecho entre crases faria a
        // asserção acima passar para qualquer cláusula que cite QUALQUER coisa, e o verde não
        // significaria "há teste" e sim "há crase".
        expect(testesCitados('veja `backend/src/config.js` e nada mais')).toEqual([]);
        expect(testesCitados('prova em `backend/tests/unit/x.test.js`')).toEqual(['backend/tests/unit/x.test.js']);
        expect(testesCitados('e `frontend/tests/e2e-ui/y.spec.js` também')).toEqual(['frontend/tests/e2e-ui/y.spec.js']);
        expect(testesCitados('sem crase nenhuma aqui')).toEqual([]);
    });

    it('o censo do que está aberto casa, cláusula a cláusula, com o documento', () => {
        const abertasNoTexto = clausulas()
            .filter((c) => c.estados.some((e) => e !== 'vigente'))
            .map((c) => c.numero)
            .sort();
        const abertasNoCenso = ABERTAS.map((a) => a.numero).sort();
        expect(
            abertasNoTexto,
            'a lista de cláusulas não-vigentes mudou. Se você FECHOU uma, tire-a de ABERTAS; se ABRIU, '
            + 'acrescente-a com o motivo. Esta lista é curta de propósito: é o que impede que uma cláusula '
            + 'aberta se esconda dentro de um documento de trezentas linhas.',
        ).toEqual(abertasNoCenso);

        // E o censo não pode ser lista de números: cada entrada carrega motivo de verdade.
        for (const a of ABERTAS) {
            expect(ESTADOS).toContain(a.estado);
            expect(['decisão', 'trabalho', 'dependência externa']).toContain(a.natureza);
            expect(a.motivo.length, `motivo raso em ${a.numero}`).toBeGreaterThan(40);
            // O estado declarado no censo tem de ser um dos que o texto realmente carrega.
            const c = clausulas().find((x) => x.numero === a.numero);
            expect(c.estados, `censo diz "${a.estado}" e o texto de ${a.numero} não`).toContain(a.estado);
        }
    });

    it('DISCRIMINAÇÃO: uma cláusula fechada de mentira seria acusada pelo censo', () => {
        // O controle do caso acima. Ele prova que a comparação de listas discrimina, em vez de
        // ser um `toEqual` entre dois vazios ou entre duas cópias da mesma fonte.
        //
        // TIRA A PRIMEIRA ENTRADA, SEJA QUAL FOR, e não um número escrito à mão. A primeira
        // versão deste caso removia `'8.5'` pelo nome e ficou VERMELHA no dia em que a 8.5
        // fechou: com o número ausente, o filtro não removia nada, as duas listas voltavam a
        // ser iguais e o controle acusava a si mesmo. Controle ancorado num dado que o próprio
        // sujeito pode mudar é controle com prazo de validade.
        expect(ABERTAS.length, 'sem entrada nenhuma, este controle não teria o que remover').toBeGreaterThan(0);
        const semUma = ABERTAS.slice(1).map((a) => a.numero).sort();
        const abertasNoTexto = clausulas()
            .filter((c) => c.estados.some((e) => e !== 'vigente'))
            .map((c) => c.numero)
            .sort();
        expect(abertasNoTexto).not.toEqual(semUma);
    });
});
