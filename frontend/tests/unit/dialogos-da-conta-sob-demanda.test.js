// Path: tests/unit/dialogos-da-conta-sob-demanda.test.js

/**
 * @fileoverview O que a carga sob demanda dos três diálogos do menu da conta CRIA, que é o que
 * precisa de teste.
 *
 * Em 2026-09-21 `account/account.control.js` deixou de importar estaticamente
 * `modals/login.modal.js`, `modals/create-atlas.modal.js` e `modals/sharing.modal.js`: são telas
 * que só existem depois de um clique e só fazem sentido com servidor, e o controle é um `IControl`
 * que `map_sig.js` instancia, então tudo o que ele importa viaja no BOOT do mapa. Medido com build
 * fresco dos dois lados e a régua de `tests/unit/teto-de-peso-da-pagina-do-mapa.test.js`: 78
 * arquivos / 4286417 bytes no payload ansioso do mapa antes, 77 / 4218590 depois.
 *
 * TROCAR UM IMPORT ESTÁTICO POR `import()` NÃO PRECISARIA DE TESTE NENHUM. O que precisa é o que a
 * troca cria: três gestos capazes de falhar. E a falha aqui não tem segunda chance, porque o
 * navegador guarda o módulo que falhou como falho no MAPA DE MÓDULOS da página, de modo que todo
 * `import()` seguinte do MESMO especificador é recusado sem tocar na rede (medido em Chromium em
 * 2026-09-20 e preso por `tests/e2e-ui/painel-de-pendencias-volta-com-a-rede.spec.js`). Daí as
 * duas coisas que este arquivo prende:
 *
 *   1. A FRASE, que tem de nomear a tela que a pessoa clicou e mandar RECARREGAR, nunca "tente de
 *      novo" (que não pode funcionar) e nunca calar (que deixa um item de menu que não faz nada).
 *      A metade offline não manda recarregar AGORA: o boot do mapa é fail-fast em
 *      `GET /api/config`, então recarregar sem rede troca a tela que a pessoa tem pela de
 *      indisponibilidade.
 *   2. A ORDEM do gate de gesto abandonado, que é o oposto do que a intuição escreve: a pergunta
 *      vem DEPOIS da carga, porque é durante a carga que o atlas pode fechar.
 *
 * ELE RODA EM NODE porque os três modais são MOCKADOS: os de verdade alcançam a store e o
 * MapLibre. `modals/account-modals-launcher.js` só os toca por `import()` dentro de uma closure,
 * então nada do grafo pesado é avaliado aqui.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const espioes = vi.hoisted(() => ({
    showLoginModal: vi.fn(() => ({ tela: 'login' })),
    showCreateAtlasModal: vi.fn(() => ({ tela: 'criarAtlas' })),
    showSharingModal: vi.fn(() => ({ tela: 'compartilhamento' })),
}));

vi.mock('../../src/js/modals/login.modal.js', () => ({
    showLoginModal: espioes.showLoginModal,
}));
vi.mock('../../src/js/modals/create-atlas.modal.js', () => ({
    showCreateAtlasModal: espioes.showCreateAtlasModal,
}));
vi.mock('../../src/js/modals/sharing.modal.js', () => ({
    showSharingModal: espioes.showSharingModal,
}));

const {
    abrirLogin,
    abrirCriarAtlas,
    abrirCompartilhamento,
    carregarLogin,
    telaIndisponivelTexto,
} = await import('../../src/js/modals/account-modals-launcher.js');

const AQUI = dirname(fileURLToPath(import.meta.url));
const ler = (rel) => readFileSync(resolve(AQUI, '../../src/js', rel), 'utf8');
const LANCADOR = ler('modals/account-modals-launcher.js');
const CONTROLE = ler('account/account.control.js');

/** As três chaves que o produto usa, com a palavra do comando que foi clicado. */
const TELAS = ['login', 'criarAtlas', 'compartilhamento'];

beforeEach(() => {
    espioes.showLoginModal.mockClear();
    espioes.showCreateAtlasModal.mockClear();
    espioes.showSharingModal.mockClear();
});

describe('abrir os três diálogos sob demanda', () => {
    it('o login carrega e abre, com as opções intactas', async () => {
        const opcoes = { onSubmit: () => {}, onRegister: undefined };
        const modal = await abrirLogin(opcoes);
        expect(espioes.showLoginModal).toHaveBeenCalledTimes(1);
        expect(espioes.showLoginModal).toHaveBeenCalledWith(opcoes);
        expect(modal).toEqual({ tela: 'login' });
    });

    it('o "novo atlas" carrega e abre, com as opções intactas', async () => {
        const opcoes = { defaultName: 'Acervo', onCreate: () => {} };
        const modal = await abrirCriarAtlas(opcoes);
        expect(espioes.showCreateAtlasModal).toHaveBeenCalledTimes(1);
        expect(espioes.showCreateAtlasModal).toHaveBeenCalledWith(opcoes);
        expect(modal).toEqual({ tela: 'criarAtlas' });
    });

    it('o compartilhamento carrega e abre, com o id do atlas e as opções', async () => {
        const modal = await abrirCompartilhamento('atlas-1', { atlasName: 'Acervo' });
        expect(espioes.showSharingModal).toHaveBeenCalledWith('atlas-1', { atlasName: 'Acervo' });
        expect(modal).toEqual({ tela: 'compartilhamento' });
    });

    it('o gesto abandonado NÃO abre a tela, e o gate é consultado', async () => {
        // O caso que o `aindaQuerido` existe para pegar: o módulo viaja pela rede, e o atlas pode
        // fechar, ser excluído por um dono ou ser trocado por outro enquanto isso. Sem a pergunta,
        // a resposta chega tarde e a tela de compartilhamento abre sobre um atlas que ninguém tem.
        const gate = vi.fn(() => false);
        const modal = await abrirCompartilhamento('atlas-1', {}, { aindaQuerido: gate });
        expect(gate).toHaveBeenCalledTimes(1);
        expect(espioes.showSharingModal).not.toHaveBeenCalled();
        expect(modal).toBe(null);
    });

    it('o gate ausente não impede nada (o caminho de quem não passa gate)', async () => {
        // Controle de vácuo do caso acima: se a função recusasse sempre, o `null` de lá não
        // provaria que o gate foi respeitado, só que a função não abre nunca.
        const modal = await abrirCompartilhamento('atlas-2', {});
        expect(espioes.showSharingModal).toHaveBeenCalledTimes(1);
        expect(modal).toEqual({ tela: 'compartilhamento' });
    });

    it('o memo é UM só, e duas cargas devolvem o mesmo módulo', async () => {
        const [a, b] = await Promise.all([carregarLogin(), carregarLogin()]);
        expect(a).toBe(b);
    });
});

describe('a frase de quando a tela não chega', () => {
    for (const tela of TELAS) {
        it(`${tela}: sem rede, nomeia a rede e CONDICIONA o recarregamento à volta dela`, () => {
            const texto = telaIndisponivelTexto(tela, false);
            expect(texto).toContain('Sem conexão');
            expect(texto).toContain('Quando a rede voltar');
            expect(texto).toContain('atualize a página');
        });

        it(`${tela}: com rede, nomeia o build trocado e manda recarregar agora`, () => {
            const texto = telaIndisponivelTexto(tela, true);
            expect(texto).toContain('Não foi possível carregar');
            expect(texto).toContain('atualize a página');
            // A metade que separa os dois ramos: com rede, esperar não resolve nada.
            expect(texto).not.toContain('Quando a rede voltar');
        });

        it(`${tela}: nenhum dos dois ramos oferece nova tentativa nem fala de módulo`, () => {
            // O `import()` que falhou fica envenenado pelo resto da vida da página, então um
            // "tente de novo" ensina a pessoa a clicar num botão que não pode funcionar. E ela não
            // pediu um módulo, pediu uma tela: o substantivo tem de ser o que ela clicou.
            for (const online of [false, true]) {
                const texto = telaIndisponivelTexto(tela, online);
                expect(texto).not.toMatch(/tente de novo|clique de novo|tentar novamente/i);
                expect(texto).not.toMatch(/chunk|módulo|import|javascript/i);
            }
        });
    }

    it('as três frases são DIFERENTES entre si', () => {
        // Sem este caso, um copiar-e-colar que desse a mesma tela às três chaves passaria em todos
        // os casos acima, que só perguntam por trechos comuns.
        const frases = TELAS.map((t) => telaIndisponivelTexto(t, true));
        expect(new Set(frases).size).toBe(3);
    });

    it('cada frase nomeia a tela E o ato, em pt-BR com acento', () => {
        expect(telaIndisponivelTexto('login', true)).toContain('formulário de login');
        expect(telaIndisponivelTexto('login', true)).toContain('entrar na sua conta');
        expect(telaIndisponivelTexto('criarAtlas', true)).toContain('tela de novo atlas');
        expect(telaIndisponivelTexto('criarAtlas', true)).toContain('enviar o seu atlas ao servidor');
        expect(telaIndisponivelTexto('compartilhamento', true)).toContain('tela de compartilhamento');
        expect(telaIndisponivelTexto('compartilhamento', true)).toContain('compartilhar o atlas');
    });

    it('uma chave desconhecida degrada, e NUNCA interpola `undefined`', () => {
        // O desfecho que uma tabela de frases nunca pode produzir. `Object.hasOwn` e não
        // `TELAS[tela] ?? padrao`: `?? ` devolveria `Object.prototype.toString` para
        // `telaIndisponivelTexto('toString')`, e `Object.freeze` não protege disso.
        for (const chave of ['inexistente', 'toString', 'constructor', '__proto__', undefined]) {
            const texto = telaIndisponivelTexto(chave, true);
            expect(texto).not.toContain('undefined');
            expect(texto).toContain('atualize a página');
            expect(texto).toContain('esta tela');
        }
    });

    it('um `navigator.onLine` ausente cai no ramo ONLINE, que é o que age agora', () => {
        // Degradar para o ramo offline mandaria a pessoa ESPERAR uma rede que talvez já esteja de
        // pé. Só o `false` literal é sinal; todo o resto é ausência de sinal.
        for (const valor of [undefined, null, true, 1, 'sim']) {
            expect(telaIndisponivelTexto('login', valor)).toContain('Não foi possível carregar');
        }
    });
});

describe('a forma do lançador, que é o que o guarda de peso enxerga', () => {
    it('o ÚNICO import estático é o memo do vizinho, e não uma segunda cópia dele', () => {
        // Duas cópias da regra de esquecimento é como "a carga que falhou é esquecida" fica
        // verdadeira num lançador e falsa no outro. E um import estático a mais aqui é peso de
        // volta no boot do mapa, que é a coisa inteira que este arquivo existe para evitar.
        const estaticos = [...LANCADOR.matchAll(/^import\s[^;]*?from\s+'([^']+)';/gm)]
            .map((m) => m[1]);
        expect(estaticos).toEqual(['./signup-launcher.js']);
        expect(LANCADOR).toContain('memoizarCarga');
    });

    it('os três especificadores de `import()` são LITERAIS, e são os três modais', () => {
        // O guarda de peso (`teto-de-peso-da-pagina-do-mapa.test.js`) caminha o grafo com uma
        // regex e só enxerga literal: um especificador montado numa variável apagaria a aresta e
        // deixaria aquele guarda medindo um grafo que não existe.
        const dinamicos = [...LANCADOR.matchAll(/import\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]);
        expect(dinamicos.sort()).toEqual([
            './create-atlas.modal.js',
            './login.modal.js',
            './sharing.modal.js',
        ]);
    });

    it('a pergunta do gesto abandonado vem DEPOIS do `await` da carga', () => {
        // A ordem É a decisão, e ela se lê ao contrário: perguntar antes é grátis e não serve para
        // nada, porque o tempo que o gesto tem para ser abandonado é justamente o da viagem.
        const corpo = LANCADOR.slice(LANCADOR.indexOf('export async function abrirCompartilhamento'));
        const carga = corpo.indexOf('await carregarCompartilhamento()');
        const gate = corpo.indexOf('aindaQuerido()');
        expect(carga, 'a carga existe').toBeGreaterThan(-1);
        expect(gate, 'o gate existe').toBeGreaterThan(-1);
        expect(carga).toBeLessThan(gate);
    });
});

describe('o controle da conta não traz os três de volta', () => {
    it('nenhum dos três é import ESTÁTICO de `account.control.js`', () => {
        // O caso que reprova a regressão no commit em que ela for escrita, e não meses depois
        // quando alguém remedir o `dist/`. Os 66 kB que voltariam cabem na folga do teto de kB.
        for (const modal of ['login.modal.js', 'create-atlas.modal.js', 'sharing.modal.js']) {
            expect(CONTROLE, `${modal} voltou a ser import estático do controle`)
                .not.toMatch(new RegExp(`from\\s+'@modals/${modal.replace('.', '\\.')}'`));
        }
    });

    it('e o lançador É importado por ele, senão a afirmação acima é vazia', () => {
        expect(CONTROLE).toContain("from '@modals/account-modals-launcher.js'");
        // As três portas, cada uma no seu gesto.
        expect(CONTROLE).toContain('abrirLogin(');
        expect(CONTROLE).toContain('abrirCriarAtlas(');
        expect(CONTROLE).toContain('abrirCompartilhamento(');
    });

    it('cada um dos três gestos DIZ a falha de carga, e nenhum a engole', () => {
        // Três pontos novos de falha, três frases. Um `catch` vazio (ou um `await` sem `catch`,
        // que vira rejeição não tratada) deixa um item de menu que não faz nada, que é pior que o
        // peso que a troca economizou.
        for (const chave of TELAS) {
            expect(CONTROLE, `o gesto de ${chave} não nomeia a falha de carga`)
                .toContain(`telaIndisponivelTexto('${chave}'`);
        }
        expect(CONTROLE.match(/telaIndisponivelTexto\(/g)).toHaveLength(3);
    });
});
