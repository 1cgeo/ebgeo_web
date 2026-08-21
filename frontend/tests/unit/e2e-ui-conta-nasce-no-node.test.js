// Path: tests/unit/e2e-ui-conta-nasce-no-node.test.js
//
// ONDE A CONTA NASCE NA CAMADA DE PLAYWRIGHT, E POR QUE ISSO PRECISA DE GUARDA.
//
// Desde que o auto-cadastro passou a EXIGIR e-mail, `POST /auth/register` cria uma conta
// PENDENTE e o login e recusado ate o link `?verify=` ser seguido. O token desse link so
// existe como linha em `email_verification_tokens`, legivel do lado NODE. Uma chamada de
// cadastro dentro de `page.evaluate` cria, portanto, uma conta que o proprio contexto que a
// criou nao tem como destrancar: foi assim que 56 arquivos de `tests/e2e-ui/` passaram a
// morrer no setup de uma vez so, com o mesmo "Informe e-mail." vindo do cliente REST.
//
// O conserto tem UMA forma, `createVerifiedUser()` em `helpers/accounts.js`, e este arquivo
// existe para que a segunda forma nao apareca. Ele e um CENSO com piso decrescente: a lista
// PENDENTES abaixo e o estado MEDIDO por varredura, e cada conversao a encurta em uma linha.
// Ela chegou a ZERO em 2026-08-21, quando os 56 arquivos que a varredura acusava em
// `0a4dc226` passaram todos a `createVerifiedUser`. As tres direcoes em que ele reprova:
//
//   1. arquivo novo que cadastre no browser e nao esteja no censo, vermelho (a varredura vem
//      de `git ls-files`, nunca de uma lista de alvos escrita a mao);
//   2. arquivo do censo que ja NAO cadastra mais no browser, vermelho, obrigando a lista a
//      encolher em vez de envelhecer mentindo;
//   3. arquivo declarado CONVERTIDO que nao importe `createVerifiedUser`, vermelho. Essa e a
//      DISCRIMINACAO que impede o verde vazio: sem ela, apagar a linha do cadastro sem por
//      nada no lugar (spec sem conta nenhuma) passaria por conversao.
//
// E O VIZINHO QUE NAO PODE MUDAR e o desenho PROIBIDO. Nenhum arquivo desta pasta pode
// escrever `email_verified` (o atalho por SQL que contornaria a rota publica), e o helper tem
// de gastar o token em `/auth/verify-email`. Sem esses dois, um "conserto" que ligasse o campo
// na mao deixaria a rota de confirmacao sem exercicio em toda a camada e ainda assim pintaria
// este censo de verde. (O outro desenho proibido, uma variavel de ambiente do backend que pule
// a verificacao em teste, nao tem guarda aqui: ele nao mora nesta pasta. Esta escrito no
// `@fileoverview` de `helpers/accounts.js`, que e onde quem fosse propo-lo estaria lendo.)
//
// FRAGILIDADE ACEITA: o inventario precisa de `git`; se o comando falhar, o teste diz isso
// nessas palavras, porque falha de ambiente lida como regressao custa mais do que a guarda
// economiza.

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const URL_E2E_UI = new URL('../e2e-ui/', import.meta.url);
const DIR_E2E_UI = fileURLToPath(URL_E2E_UI);

/** Chamada de cadastro pelo lado do BROWSER (`api.register({...})` dentro de page.evaluate). */
const CADASTRO_NO_BROWSER = /\.register\(/;

/**
 * Os cinco arquivos convertidos quando o padrao foi projetado e provado. Cada um foi escolhido
 * por ser DIFERENTE dos outros: um simples, um de colaboracao com dois usuarios, um que depende
 * de papel global, um com fabrica de usuario dentro do proprio `evaluate`, e o helper
 * compartilhado de colaboracao (que sozinho destranca as duas dezenas de specs de collab).
 */
const CONVERTIDOS = [
    'helpers/collab-helpers.js',
    'login-flow.spec.js',
    'browser-admin-users.spec.js',
    'browser-p11-roundtrip.spec.js',
    'browser-sharing-lifecycle.spec.js',
];

/**
 * Classificado, nao esquecido: este spec cadastra pelo FORMULARIO da UI (o assunto dele e
 * justamente o cadastro mais a confirmacao), entao nao passa por `createVerifiedUser` e ja le o
 * token do Postgres por conta propria. Ele nao aparece na varredura porque nao ha chamada
 * `.register(` nele, e esta entrada existe para que essa ausencia seja decisao escrita.
 */
const ISENTOS = ['browser-signup.spec.js'];

/**
 * PISO: os arquivos que AINDA fazem a conta nascer dentro do browser, medidos por varredura em
 * 2026-08-21. Esta lista so encolhe. Ao converter um arquivo, apague a linha dele daqui.
 *
 * ELA ESTA VAZIA, e a lista vazia e o ESTADO DE CHEGADA, nao um censo que deixou de casar: por
 * um momento este arquivo cobrou `achados.length > 0` contra a arvore de producao, e no commit
 * em que o ultimo dos 56 foi convertido essa cobranca virou uma contradicao consigo mesma
 * (exigia que sobrasse pelo menos um pendente para poder afirmar que nao sobrava nenhum). O que
 * aquele piso protegia continua protegido, e por dois caminhos que NAO dependem de a arvore
 * estar suja: `AMOSTRA_PROIBIDA` prova que a regra ainda reconhece a forma, e o inventario e
 * cobrado nao-vazio. Substituir varredura vazia por lista vazia sem esses dois seria trocar um
 * verde vazio por outro.
 */
const PENDENTES = [
];

/**
 * CONTROLE POSITIVO da regra. Enquanto a varredura acusar zero arquivos, e ESTA amostra que
 * responde "o que este verde estaria provando se o codigo estivesse errado": trocar
 * `CADASTRO_NO_BROWSER` por algo que nao casa com nada reprova aqui, mesmo com a pasta inteira
 * limpa. O texto e literalmente a forma que os 56 arquivos tinham antes da conversao.
 */
const AMOSTRA_PROIBIDA = 'await api.register({ username, password, nome: \'CRUD User\' });';

/** Inventario versionado da pasta (fonte: git, nunca alvos escritos a mao). */
function inventario() {
    let saida;
    try {
        saida = execSync('git ls-files', { cwd: DIR_E2E_UI, encoding: 'utf8' });
    } catch (err) {
        throw new Error(`o inventario precisa de "git ls-files" e ele falhou: ${err.message}`);
    }
    return saida.split(/\r?\n/).filter((f) => f.endsWith('.js'));
}

const ler = (rel) => readFileSync(new URL(rel, URL_E2E_UI), 'utf8');

describe('e2e-ui: a conta nasce no Node, nunca dentro de page.evaluate', () => {
    it('a varredura acha exatamente os arquivos que o censo declara pendentes', () => {
        // Os DOIS pisos, e nenhum dos dois olha para o resultado da varredura: sem eles um
        // censo que deixasse de casar com qualquer coisa, ou um inventario que voltasse vazio
        // por `git` mudo, pintariam de verde a mesma tela em branco.
        expect(CADASTRO_NO_BROWSER.test(AMOSTRA_PROIBIDA)).toBe(true);
        const arquivos = inventario();
        expect(arquivos.length).toBeGreaterThan(0);

        const achados = arquivos.filter((f) => CADASTRO_NO_BROWSER.test(ler(f)));
        expect([...achados].sort()).toEqual([...PENDENTES].sort());
    });

    it('cada arquivo convertido importa createVerifiedUser e nao cadastra mais no browser', () => {
        expect(CONVERTIDOS.length).toBe(5);
        for (const rel of CONVERTIDOS) {
            const texto = ler(rel);
            expect(CADASTRO_NO_BROWSER.test(texto), `${rel} ainda cadastra dentro do browser`).toBe(false);
            expect(texto.includes('createVerifiedUser'), `${rel} nao usa createVerifiedUser`).toBe(true);
        }
    });

    it('o spec de cadastro pela UI segue sendo o unico isento, e segue sendo o que ele diz', () => {
        expect(ISENTOS.length).toBe(1);
        for (const rel of ISENTOS) {
            const texto = ler(rel);
            expect(texto.includes('signup-submit'), `${rel} deixou de cadastrar pelo formulario`).toBe(true);
            expect(
                texto.includes('email_verification_tokens'),
                `${rel} deixou de ler o token pela tabela`
            ).toBe(true);
        }
    });

    it('o helper gasta o token pela rota publica, e ninguem escreve email_verified na mao', () => {
        const helper = ler('helpers/accounts.js');
        expect(helper.includes('/auth/verify-email')).toBe(true);
        expect(helper.includes('email_verification_tokens')).toBe(true);
        const arquivos = inventario();
        expect(arquivos.length).toBeGreaterThan(0);
        for (const f of arquivos) {
            expect(
                /email_verified/.test(ler(f)),
                `${f} escreve email_verified: o atalho por SQL contorna POST /auth/verify-email`
            ).toBe(false);
        }
    });
});
