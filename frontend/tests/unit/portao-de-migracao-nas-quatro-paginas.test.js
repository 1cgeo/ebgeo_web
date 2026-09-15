// Path: tests/unit/portao-de-migracao-nas-quatro-paginas.test.js

/**
 * @fileoverview O PORTÃO DE MIGRAÇÃO RODA NAS QUATRO PÁGINAS, e a varredura de logout de nenhuma
 * delas é crua (achado F17 do plano de lançamento).
 *
 * O DEFEITO: `runLegacyUpgradeGate` rodava só em `index.js` e em `projects/projects-page.js`.
 * `admin.html` e `calibracao.html` leem e escrevem o MESMO acervo local (registro de atlas, escopo
 * ativo, chaves globais), então abrir uma delas primeiro operava sobre bancos que a atualização
 * ainda não tinha copiado, e sem a tela de recuperação que é a única saída quando a cópia falha.
 * Junto disso, as três páginas sem mapa chamavam `purgeAllRemoteAtlases()` cru: destruíam namespace
 * de servidor sem aviso às irmãs e deixavam a aba sem escopo ativo, e escopo ausente manda a
 * escrita seguinte para os bancos LEGADOS, isto é, para o slot local do próprio usuário.
 *
 * POR QUE ESTRUTURAL. Os quatro módulos de entrada bootam no import e falam com um backend, então
 * não há como carregá-los em node e perguntar o que eles chamaram; o texto-fonte é a evidência
 * disponível, e é a mesma escolha (com a mesma limitação declarada) de
 * `tests/unit/paginas-sem-mapa-nao-arrastam-a-store.test.js` e da seção estrutural de
 * `tests/integration/tab-lock-atlas-integration.test.js`. Ele prova o SÍTIO DE CHAMADA e a ordem,
 * nunca que o portão faça a coisa certa: o comportamento dele está medido em
 * `tests/integration/migracao-main-riscos-abertos.repro.test.js` e vizinhos.
 *
 * O INVENTÁRIO VEM DO DISCO, nunca de uma lista escrita à mão: as entradas são lidas dos próprios
 * arquivos HTML, então uma quinta página nasce reprovada até ser classificada aqui, que é o modo
 * silencioso desta classe de teste envelhecer.
 *
 * A QUINTA PÁGINA CHEGOU EM 2026-09-15 E FOI CLASSIFICADA FORA, e o mecanismo acima funcionou
 * exatamente como prometido: `tutorial.html` nasceu vermelha aqui. O nome do arquivo continua
 * dizendo QUATRO porque quatro continua sendo o número de páginas que tocam o acervo local; a
 * quinta não abre banco nenhum, e o que a mantém assim é um caso próprio, não a boa vontade de
 * quem a escreveu.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Apaga o conteúdo dos comentários preservando as linhas, para que a prosa que EXPLICA uma chamada
 * não seja lida como a chamada. Sem isto, os comentários que este lote escreveu ao lado de cada
 * portão fariam o teste passar mesmo com o código removido.
 * @param {string} texto
 * @returns {string}
 */
function semComentarios(texto) {
    return texto
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/(^|[^:])\/\/[^\n]*/g, (m, antes) => antes + ' '.repeat(m.length - antes.length));
}

/** @returns {Array<{html: string, entrada: string}>} As páginas e seus módulos de entrada. */
function paginasDoDisco() {
    return readdirSync(FRONT)
        .filter((f) => f.endsWith('.html'))
        .sort()
        .map((html) => {
            const modulo = readFileSync(join(FRONT, html), 'utf8')
                .match(/<script\s+type="module"\s+src="\/(src\/js\/[^"]+)"/);
            expect(modulo, `${html} não declara um módulo de entrada`).not.toBeNull();
            return { html, entrada: modulo[1] };
        });
}

const TODAS = paginasDoDisco();

/**
 * A QUINTA PÁGINA NÃO TEM PORTÃO, e a exceção é de desenho, não esquecimento.
 *
 * `tutorial.html` nasceu em 2026-09-15 (decisão D16) e é a única página do produto que não abre
 * banco nenhum: ela renderiza `frontend/public/docs/README.md` com o docsify e acaba aí. O portão
 * existe para quem LÊ E ESCREVE os bancos locais antes de a atualização copiá-los; numa página que
 * não os toca, chamá-lo significaria importar a store inteira para desenhar documentação.
 *
 * A classificação não é isenção gratuita: o caso `a quinta página não toca no acervo` cobra o outro
 * lado, e é ele que reprova no dia em que alguém puser acesso a banco ali. Sem esse par, "não
 * precisa de portão" seria uma afirmação sobre o passado.
 */
const SEM_ACERVO = Object.freeze(['tutorial.html']);

/** As quatro que tocam o acervo local, e que por isso passam pelo portão. */
const PAGINAS = TODAS.filter((p) => !SEM_ACERVO.includes(p.html));

/** As três que bootam sem a store do mapa, e que fazem a varredura de logout elas mesmas. */
const SEM_MAPA = Object.freeze(['atlas.html', 'admin.html', 'calibracao.html']);

/**
 * O que uma página que "não toca no acervo" não pode citar.
 *
 * São as portas do disco, não uma lista de estilo: o portão, a varredura de namespaces remotos, a
 * fábrica de stores por escopo e a biblioteca de IndexedDB. Qualquer uma delas numa página desta
 * classe significa que ela passou a ler ou escrever o acervo, e nesse instante a ausência do portão
 * deixa de ser desenho e vira defeito.
 */
const PORTAS_DO_ACERVO = Object.freeze([
    'runLegacyUpgradeGate',
    'purgeAllRemoteAtlases',
    'getStore(',
    'localforage'
]);

/**
 * @param {string} relativo - Caminho relativo ao pacote.
 * @returns {string} Código sem comentários.
 */
function codigoDe(relativo) {
    return semComentarios(readFileSync(join(FRONT, relativo), 'utf8'));
}

describe('o portão de migração roda nas quatro páginas', () => {
    it('as cinco páginas do produto estão CLASSIFICADAS, e quatro delas tocam o acervo', () => {
        // Controle de vácuo: com uma página a mais (ou a menos) as classificações abaixo deixariam
        // de cobrir o conjunto, e o verde passaria a ser sobre outra coisa. São CINCO desde
        // 2026-09-15, e a divisão é o que este caso guarda: quem toca o acervo passa pelo portão,
        // quem não toca fica de fora e é cobrado pelo caso seguinte.
        expect(TODAS.map((p) => p.html))
            .toEqual(['admin.html', 'atlas.html', 'calibracao.html', 'index.html', 'tutorial.html']);
        expect(PAGINAS.map((p) => p.html))
            .toEqual(['admin.html', 'atlas.html', 'calibracao.html', 'index.html']);
    });

    it.each(SEM_ACERVO)('%s não toca no acervo, e é isso que a dispensa do portão', (html) => {
        const entrada = TODAS.find((p) => p.html === html).entrada;
        const codigo = codigoDe(entrada);
        const achadas = PORTAS_DO_ACERVO.filter((porta) => codigo.includes(porta));
        expect(
            achadas,
            `${html} passou a citar ${achadas.join(', ')}: ou ela chama o portão, ou não abre banco`
        ).toEqual([]);
    });

    it.each(PAGINAS)('$html chama o portão e NÃO monta quando ele recusa', ({ entrada }) => {
        const codigo = codigoDe(entrada);
        // A MESMA forma nas quatro, e ela carrega as três propriedades de uma vez: é aguardado
        // (`await`), decide pelo valor (`!`) e ABANDONA o boot (`return`). O `false` já desenhou a
        // tela de recuperação dentro do portão, então voltar aqui é o desfecho completo.
        expect(codigo).toMatch(/if\s*\(!\s*await\s+runLegacyUpgradeGate\(\)\)\s*return;/);
        expect(codigo).toContain('watchLegacyChanges()');
    });

    it.each(SEM_MAPA)('%s não varre os namespaces remotos sem reapontar o escopo local', (html) => {
        const entrada = PAGINAS.find((p) => p.html === html).entrada;
        const codigo = codigoDe(entrada);
        const varredura = codigo.indexOf('purgeAllRemoteAtlases(');
        // Asserido como ENCONTRADO antes de qualquer comparação: -1 passaria por "veio antes".
        expect(varredura).toBeGreaterThan(-1);
        const reativa = codigo.indexOf('activateCurrentLocalAtlasScope(', varredura);
        expect(reativa).toBeGreaterThan(varredura);
        // E a reativação é CONDICIONAL ao que a varredura relatou: reativar sempre roubaria o
        // escopo de uma varredura que poupou o namespace de outra aba.
        expect(codigo.slice(varredura, reativa)).toContain('report.deactivated');
    });

    it('CONTROLE: a página do MAPA não faz a varredura ela mesma', () => {
        // Ela passa por `discardRemoteAtlasNamespaces` (`store/store.js`), que é quem avisa, varre e
        // reaponta o escopo. Se este controle cair, é porque alguém duplicou aquela política aqui.
        expect(codigoDe('src/js/index.js')).not.toContain('purgeAllRemoteAtlases(');
    });
});
