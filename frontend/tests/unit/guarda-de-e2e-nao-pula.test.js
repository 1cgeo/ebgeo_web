// Path: tests/unit/guarda-de-e2e-nao-pula.test.js
//
// META-GUARDA: quem vigia o vigia do "verde por skip".
//
// As duas camadas de e2e degradam para `skip` quando o backend não sobe, e nas duas TODOS
// os specs são `describe.skipIf(...)`. Se fosse só isso, um ambiente sem Postgres daria
// verde tendo exercitado zero. O que impede isso são dois arquivos que NÃO se gateiam e
// reprovam nessa condição: `frontend/tests/e2e/_backend-required.e2e.test.js` e
// `frontend/tests/e2e-ui/_backend-required.spec.js`.
//
// POR QUE ESTE ARQUIVO EXISTE: aqueles dois não eram protegidos por nada. Apagar um, ou
// acrescentar `.skipIf` nele, restaurava o falso verde em SILÊNCIO, e a única testemunha
// seria a ausência de um nome numa lista que ninguém lê. É a mesma classe do episódio do
// `ALVOS.filter(existsSync)`, em que um filtro passou por verificação e dois documentos
// saíram da vigilância sem nada ficar vermelho: guarda que some não deixa rastro, porque
// o sintoma de um guarda ausente é exatamente o de um guarda satisfeito.
//
// A ARMADILHA DESTE ARQUIVO, e ela é literal: o `@fileoverview` dos dois guardas CITA
// `describe.skipIf(E2E_SKIP)` em prosa, para explicar o que eles existem para impedir. Uma
// varredura ingênua acusaria os dois de estarem gateados, ou seja, o token proibido mora no
// lugar mais desejável possível, que é o texto que o proíbe. Por isso tudo aqui lê CÓDIGO,
// nunca o arquivo cru, e a remoção de comentários tem o seu próprio par de controle.
//
// O QUE ISTO NÃO ALCANÇA: o opt-out deliberado `EBGEO_E2E_ALLOW_SKIP=1`, que continua
// legítimo (esteira sem Postgres) e continua sem cobrança automática. Nenhum script do
// repositório o define; se alguém o definir, este guarda não vê.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ_PACOTE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Os dois guardas, e a camada de cada um. */
const GUARDAS = [
    { camada: 'contrato (vitest)', arquivo: 'tests/e2e/_backend-required.e2e.test.js', bandeira: 'E2E_SKIP' },
    { camada: 'navegador (playwright)', arquivo: 'tests/e2e-ui/_backend-required.spec.js', bandeira: 'state.skip' },
];

const ler = (rel) => readFileSync(join(RAIZ_PACOTE, rel), 'utf8');

/** O mesmo despimento usado pelos outros guardas da casa: bloco primeiro, linha depois. */
const semComentarios = (fonte) => fonte
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const lerCodigo = (rel) => semComentarios(ler(rel));

/** Specs irmãos de uma pasta, fora os guardas e os helpers. */
function irmaos(pasta, sufixo) {
    return readdirSync(join(RAIZ_PACOTE, pasta))
        .filter((n) => n.endsWith(sufixo) && !n.startsWith('_'));
}

describe('os guardas de "o e2e não pulou" continuam existindo e continuam sem gate', () => {
    it('o despimento de comentários funciona: vê o código e deixa de ver a prosa', () => {
        // O PAR DE CONTROLE. Sem ele, um `semComentarios` que devolvesse string vazia faria
        // TODA asserção de ausência desta suíte passar, e as de presença falhariam de um jeito
        // que se conserta afrouxando, que é como um guarda morre.
        //
        // A SONDA É SINTÉTICA DE PROPÓSITO. A versão anterior deste caso media o token
        // `describe.skipIf` no arquivo REAL, e isso o acoplava à regra que ele deveria apenas
        // habilitar: no dia em que o guarda ganhasse um gate de verdade, este caso ficaria
        // vermelho junto, apontando para "o despimento quebrou" quando o fato era outro. Um
        // controle precisa falhar por UM motivo só.
        const sonda = ['/* fora: alvo */', 'const dentro = 1; // fora: alvo'].join(String.fromCharCode(10));
        expect(semComentarios(sonda)).toContain('const dentro = 1;');
        expect(semComentarios(sonda)).not.toContain('alvo');
        expect(semComentarios('const a = "http://x";')).toContain('http://x');

        // E a prova de que ele é aplicado AO ARQUIVO REAL, por um token que só existe na
        // prosa dele e que nenhuma mudança de código legítima criaria.
        const fonte = ler(GUARDAS[0].arquivo);
        expect(fonte).toContain('green-but-skipped');
        expect(semComentarios(fonte)).not.toContain('green-but-skipped');
        expect(semComentarios(fonte)).toMatch(/import \{ describe, it, expect \}/);
    });

    it('os dois arquivos existem, e é isso que apagar um deles quebra', () => {
        for (const g of GUARDAS) {
            expect(existsSync(join(RAIZ_PACOTE, g.arquivo)), `sumiu o guarda da camada ${g.camada}`).toBe(true);
        }
        expect(GUARDAS.length).toBe(2);
    });

    it('nenhum dos dois se gateia pela própria bandeira, e cada um a exige FALSA', () => {
        for (const g of GUARDAS) {
            const codigo = lerCodigo(g.arquivo);
            expect(/\.skipIf\s*\(/.test(codigo), `${g.arquivo} passou a se gatear: volta a ser verde por skip`).toBe(false);
            expect(codigo, `${g.arquivo} deixou de citar a bandeira ${g.bandeira}`).toContain(g.bandeira);
            // A asserção precisa cobrar FALSO. Um guarda que só LEIA a bandeira e não a asserte
            // é um arquivo que roda e não decide nada.
            expect(/toBe\(false\)|toBeFalsy\(\)/.test(codigo), `${g.arquivo} não cobra mais que a bandeira seja falsa`).toBe(true);
        }
    });

    it('DISCRIMINAÇÃO: os specs irmãos SE gateiam, logo a ausência acima não é vacuidade', () => {
        // Se ninguém usasse `skipIf`, a asserção de ausência do caso anterior seria verdadeira
        // por vacuidade e não estaria provando nada. Os pisos abaixo medem que o padrão existe,
        // e em volume, dos dois lados.
        const contrato = irmaos('tests/e2e', '.e2e.test.js');
        const navegador = irmaos('tests/e2e-ui', '.spec.js');
        expect(contrato.length).toBeGreaterThan(30);
        expect(navegador.length).toBeGreaterThan(60);

        const gateados = contrato.filter((n) => /\.skipIf\s*\(/.test(lerCodigo(join('tests/e2e', n))));
        expect(gateados.length).toBeGreaterThan(30);
        expect(gateados.length).toBe(contrato.length);

        // O LADO PLAYWRIGHT MEDIA SÓ `navegador.length > 0`, e isso NÃO era discriminação: um
        // piso de existência de arquivo é verdadeiro num mundo em que ninguém gateia, que é
        // exatamente o mundo em que a ausência de gate no `_backend-required.spec.js` deixa de
        // significar coisa alguma. Metade do guarda provava a sua metade e a outra não provava
        // nada, com as duas dentro do mesmo `it` verde.
        //
        // SÃO DOIS IDIOMAS DE GATE NESSA CAMADA, e reconhecer só um seria reintroduzir a
        // vacuidade pela porta estreita (a família de collab, a mais cara de mascarar, é toda do
        // segundo). Nenhum dos dois é `describe.skipIf`, que não existe no Playwright: por isso a
        // regex do lado de contrato não serve aqui, e por isso a `bandeira` da tabela de GUARDAS
        // é `state.skip` e não `E2E_SKIP`.
        const IDIOMAS_DE_GATE = [
            // `const describeOrSkip = state.skip ? test.describe.skip : test.describe;`
            /state\s*\.\s*skip/,
            // `collabTest` (helpers/collab.fixtures.js) já traz o mesmo gate assado no fixture.
            /helpers\/collab\.fixtures/,
        ];
        const gateadosNavegador = navegador.filter((n) => {
            const codigo = lerCodigo(join('tests/e2e-ui', n));
            return IDIOMAS_DE_GATE.some((re) => re.test(codigo));
        });
        expect(gateadosNavegador.length).toBeGreaterThan(60);
        expect(
            gateadosNavegador.length,
            'spec de navegador sem gate de backend: '
            + navegador.filter((n) => !gateadosNavegador.includes(n)).join(', ')
            + '. Gateie por `state.skip` ou pelo fixture `collabTest`; não afrouxe este piso, '
            + 'porque é ele que impede a ausência de gate no _backend-required.spec.js de virar vacuidade.',
        ).toBe(navegador.length);

        // CONTROLE DA DISCRIMINAÇÃO NOVA, sintético pelo mesmo motivo do caso do despimento: os
        // dois idiomas precisam ser capazes de NÃO casar, senão o filtro acima é um `true`
        // disfarçado e a asserção de igualdade passa sozinha.
        const semGate = 'test.describe("x", () => { test("y", () => {}); });';
        expect(IDIOMAS_DE_GATE.some((re) => re.test(semGate))).toBe(false);
        expect(IDIOMAS_DE_GATE.some((re) => re.test('const d = state.skip ? a : b;'))).toBe(true);
        expect(IDIOMAS_DE_GATE.some((re) => re.test("import { collabTest } from './helpers/collab.fixtures.js';"))).toBe(true);
    });
});
