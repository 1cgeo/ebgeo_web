// Path: tests/unit/auditoria-tabela-acessivel.test.js

/**
 * @fileoverview A ABA "AUDITORIA" VOLTOU AO PADRÃO DA CASA, e este arquivo prende as quatro
 * propriedades que a mudança comprou.
 *
 * ELA ERA A ÚNICA DAS SETE ABAS SEM `<table>`. As outras cinco listas reusam
 * `.admin-users__table` (usuários, catálogo, grupos, concessões, pessoal); a auditoria usava
 * `<section>` por dia e `<div>` com flex por linha. O preço não era estético: sem um único
 * `<th>`, quem lê por leitor de tela recebia cinco pedaços de texto por linha sem nenhum dizer
 * o que era. Hora, ator, ação e alvo eram indistinguíveis de cor de fundo.
 *
 * O ALVO CLICÁVEL ERA UM CONTROLE INVISÍVEL. Ele tinha `role="button"` e `tabIndex = 0`, e a
 * classe que o marcava (`admin-audit__alvo--clicavel`) não tinha UMA regra em `src/css/`:
 * nem cursor, nem estado de passagem, nem foco visível. E como só havia listener de `click`,
 * o Enter e o espaço não o acionavam, apesar de o `role` prometer que sim. Hoje é um
 * `<button>` nativo, que entrega os quatro sem ninguém prometer nada à mão.
 *
 * O ERRO APARECIA EM DUAS SUPERFÍCIES. A mesma falha desenhava o estado inline (que fica, e
 * tem o botão de tentar de novo) e disparava um toast (que some sozinho). Dizer a mesma coisa
 * em dois lugares não informa em dobro: ensina a fechar avisos sem ler, e o toast é justamente
 * o que rouba a atenção do único dos dois que oferece a saída.
 *
 * DOIS CLIQUES DISPARAVAM DUAS BUSCAS, e a última a responder pintava a tela. Com a rede fora
 * de ordem, a lista mostrada podia ser a do filtro que a pessoa já tinha abandonado, sem nada
 * dizendo isso.
 *
 * O ALCANCE DESTE ARQUIVO, dito em voz alta: não há jsdom neste pacote (o ambiente do vitest é
 * `node`), então nada aqui prova que a tabela DESENHA. Isso é matéria do Playwright
 * (`tests/e2e-ui/browser-admin-auditoria.spec.js`). O que fica preso aqui é a FIAÇÃO, que é
 * onde cada um dos quatro defeitos morava. Asserção sobre fonte é fraca por natureza; o
 * controle negativo de cada caso apagou o elo, não a explicação.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Remove comentários: a varredura mede CÓDIGO. O `@fileoverview` da própria aba NOMEIA os
 * defeitos para explicá-los, e acusar a explicação ensinaria a apagá-la — o contrário do que
 * este guarda quer (mesmo raciocínio de `admin-audiencia.test.js`).
 */
const semComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ABA = semComentarios(readFileSync(resolve(FRONT, 'src/js/admin/audit-tab.js'), 'utf8'));
const CSS = readFileSync(resolve(FRONT, 'src/css/admin.css'), 'utf8');

/**
 * O CSS SEM COMENTÁRIOS, para as asserções de AUSÊNCIA.
 *
 * Pela mesma razão de `semComentarios` acima, e o caso é o mesmo: o cabeçalho do bloco de
 * Auditoria NOMEIA as classes que saíram (`.admin-audit__select`, `.admin-audit__input`,
 * `admin-audit__alvo--clicavel`) para contar por que saíram. Medir a prosa faria o guarda
 * cobrar o apagamento da própria explicação.
 */
const CSS_CODIGO = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

describe('a lista é uma TABELA, com o desenho da casa', () => {
    it('piso: a varredura está lendo o arquivo certo', () => {
        // Sem isto, um `readFileSync` que devolvesse vazio deixaria todo `not.toMatch` abaixo
        // trivialmente verde.
        expect(ABA.length).toBeGreaterThan(2000);
        expect(ABA).toContain('class AuditTab');
    });

    it('reusa `admin-users__table`, em vez de um segundo desenho de tabela', () => {
        // A classe da casa carrega o desenho que as outras cinco abas já usam. Uma cópia
        // própria divergiria no dia em que alguém mexesse numa só — que foi exatamente o que
        // aconteceu com `.admin-audit__select` e `.admin-audit__input`.
        expect(ABA).toMatch(/createElement\('table'\)/);
        expect(ABA).toMatch(/admin-users__table admin-audit__table/);
    });

    it('tem `<thead>` com cabeçalho de COLUNA, que é o que faltava', () => {
        expect(ABA).toMatch(/createElement\('thead'\)/);
        const ths = [...ABA.matchAll(/createElement\('th'\)/g)];
        expect(ths.length, 'a tabela precisa criar `<th>`, e não só `<td>`')
            .toBeGreaterThanOrEqual(2);
        expect(ABA, 'sem `scope`, um `<th>` não diz de que célula ele é cabeçalho')
            .toMatch(/setAttribute\('scope', 'col'\)/);
        // As quatro colunas comuns às duas audiências, mais a de OM, que só o administrador vê.
        expect(ABA).toMatch(/\['Hora', 'Ator', 'Ação', 'Alvo'\]/);
        expect(ABA).toMatch(/colunas\.push\('OM do acervo'\)/);
    });

    it('o AGRUPAMENTO POR DIA sobrevive, como `<tbody>` e `<th scope="colgroup">`', () => {
        // O agrupamento é o principal remédio anti-dump e não podia ser o preço da tabela.
        // Um `<tbody>` por dia é grupo de linhas de verdade: o leitor de tela o percorre como
        // grupo, em vez de topar com um cabeçalho solto no meio das linhas.
        expect(ABA).toMatch(/agruparPorDia\(linhas\)/);
        expect(ABA).toMatch(/createElement\('tbody'\)/);
        expect(ABA).toMatch(/setAttribute\('scope', 'colgroup'\)/);
        expect(ABA).toMatch(/admin-audit__day-header/);
    });

    it('o cabeçalho do dia continua PEGAJOSO, e agora abaixo do de coluna', () => {
        // Com os dois em `top: 0` um cobre o outro, e a tela perde justamente o que estava
        // sendo lido. O deslocamento sai de uma variável, e não de um número solto que
        // viraria mentira na primeira mudança de tipografia.
        expect(CSS).toMatch(/--admin-audit-cabecalho:/);
        const dia = CSS.match(/\.admin-audit__day-header \{([\s\S]*?)\}/);
        expect(dia).not.toBeNull();
        expect(dia[1]).toMatch(/position:\s*sticky/);
        expect(dia[1]).toMatch(/top:\s*var\(--admin-audit-cabecalho\)/);
        const cabecalho = CSS.match(/\.admin-audit__table thead th \{([\s\S]*?)\}/);
        expect(cabecalho).not.toBeNull();
        expect(cabecalho[1]).toMatch(/position:\s*sticky/);
        expect(cabecalho[1]).toMatch(/height:\s*var\(--admin-audit-cabecalho\)/);
    });

    it('a coluna do botão tem cabeçalho INVISÍVEL, e não vazio', () => {
        // Um `<th>` vazio é anunciado como coluna sem nome, e a coluna carrega o único
        // controle de cada linha.
        expect(ABA).toMatch(/admin-audit__oculto/);
        const oculto = CSS.match(/\.admin-audit__oculto \{([\s\S]*?)\}/);
        expect(oculto, 'a classe de texto só para leitor de tela sumiu do CSS').not.toBeNull();
        // `clip-path` e não `display: none`, que tiraria o texto da árvore de acessibilidade
        // junto — isto é, esconderia dele exatamente quem ele serve.
        expect(oculto[1]).toMatch(/clip-path:/);
        expect(oculto[1]).not.toMatch(/display:\s*none/);
    });

    it('a gaveta é irmã da linha: o botão e o painel deixaram de ter pais diferentes', () => {
        // A incoerência que ninguém tinha nomeado: o botão entrava num pai e a gaveta em
        // OUTRO, então o botão saía à direita da sigla da OM e o painel abria embaixo, à
        // esquerda. Agora os dois pertencem à mesma linha lógica, e a ordem do DOM é a da
        // tela: a linha, e logo abaixo a gaveta dela.
        expect(ABA).toMatch(/corpo\.appendChild\(tr\);\s*corpo\.appendChild\(gaveta\);/);
        expect(ABA).toMatch(/tdGaveta\.colSpan = this\._colunas\(\)/);
    });
});

describe('o nome clicável é um BOTÃO, e ele é visível', () => {
    it('a classe fantasma não voltou, e o controle é nativo', () => {
        // `admin-audit__alvo--clicavel` era marcada no JS e não existia no CSS: um controle
        // sem cursor, sem passagem e sem foco.
        expect(ABA, 'a classe sem regra nenhuma voltou ao JS')
            .not.toContain('admin-audit__alvo--clicavel');
        expect(CSS_CODIGO).not.toContain('admin-audit__alvo--clicavel');
        // E a promessa feita à mão saiu junto: `role="button"` num `<span>` prometia teclado
        // que nunca existiu (não havia `keydown`).
        expect(ABA).not.toMatch(/setAttribute\('role', 'button'\)/);
        expect(ABA).toMatch(/_botaoDeFiltro\(/);
    });

    it('a classe que ficou TEM regra, com os quatro sinais', () => {
        for (const parte of ['.admin-audit__filtro-rapido', '.admin-audit__filtro-rapido:hover',
            '.admin-audit__filtro-rapido:focus-visible']) {
            expect(CSS, `${parte} não tem regra: o controle volta a ser invisível`)
                .toContain(parte);
        }
        const base = CSS.match(/\.admin-audit__filtro-rapido \{([\s\S]*?)\}/);
        expect(base[1]).toMatch(/cursor:\s*pointer/);
        expect(base[1], 'sem sublinhado, o nome não se distingue do texto ao lado')
            .toMatch(/text-decoration:/);
        const foco = CSS.match(/\.admin-audit__filtro-rapido:focus-visible \{([\s\S]*?)\}/);
        expect(foco[1], 'foco invisível é a metade que o teclado paga').toMatch(/outline:/);
    });

    it('o ATOR também é clicável, e é ele que substitui a busca em texto', () => {
        // A aba é a única sem `<input type="search">`, e a ausência é decisão: a lista é
        // paginada no SERVIDOR, então uma busca no cliente filtraria as 50 linhas em mãos e
        // diria "nada encontrado" sobre uma trilha de milhares. A afordância que a substitui
        // é o clique — chegar a "tudo que fulano fez" sem digitar um UUID.
        expect(ABA).toMatch(/this\._filtros\.actorId = String\(linha\.actor_id\)/);
        expect(ABA).toMatch(/this\._filtros\.targetId = String\(linha\.target_id\)/);
    });

    it('o botão de detalhes tem nome ACESSÍVEL próprio', () => {
        // Cinquenta botões chamados "Detalhes" são cinquenta controles indistinguíveis para
        // quem navega por lista de controles, que é onde o botão é alcançado fora da linha.
        expect(ABA).toMatch(/setAttribute\('aria-label', `Detalhes: \$\{alvoDoEvento\(linha\)\}`\)/);
        expect(ABA).toMatch(/setAttribute\('aria-expanded'/);
        expect(ABA).toMatch(/setAttribute\('aria-controls', alvoId\)/);
    });
});

describe('o erro tem UMA superfície, e a busca tem UM dono', () => {
    it('a falha de carregamento não dispara mais o toast', () => {
        // O estado inline FICA e tem o botão de tentar de novo; o toast some sozinho e rouba a
        // atenção do único dos dois que oferece a saída.
        expect(ABA, 'o toast voltou a duplicar o estado inline').not.toContain('showError');
        expect(ABA).toContain('failureState(');
        // E A MENSAGEM DO SERVIDOR NÃO SE PERDE: ela migrou para dentro do estado inline, que
        // é onde a pessoa está olhando. Sem esta asserção, apagar o toast teria custado o
        // motivo da falha.
        expect(ABA).toMatch(/failureState\(\s*err\?\.message \|\| 'Falha ao carregar a trilha/);
        expect(ABA).toMatch(/onRetry:/);
    });

    it('a resposta VELHA é descartada: dois cliques não deixam a última pintar a tela', () => {
        // O contador de geração é o que decide a correção. `apiClient._request` não tem
        // costura de `signal`, então abortar de fora exigiria alargar o cliente HTTP que serve
        // outras seis abas; cancelar a requisição pouparia rede e não mudaria o que se vê.
        expect(ABA).toMatch(/const geracao = \+\+this\._geracao;/);
        const guardas = [...ABA.matchAll(/geracao !== this\._geracao/g)];
        expect(guardas.length, 'os DOIS caminhos (sucesso e falha) precisam da guarda')
            .toBeGreaterThanOrEqual(2);
    });

    it('e a barra DESLIGA enquanto a busca está em voo, para o segundo clique nem existir', () => {
        expect(ABA).toMatch(/_ocupado\(true\)/);
        expect(ABA).toMatch(/_ocupado\(false\)/);
        expect(ABA).toMatch(/setAttribute\('aria-busy'/);
        // A metade visível: sem ela, o `disabled` dos controles se lê como tela travada.
        expect(CSS).toMatch(/\.admin-audit__toolbar\[aria-busy="true"\]/);
    });
});

describe('a barra de filtros parou de reescrever o que `.admin-input` já resolve', () => {
    it('os dois namespaces paralelos sumiram do CSS e do JS', () => {
        // `.admin-audit__select` e `.admin-audit__input` redeclaravam altura, borda, raio e
        // foco: duas cópias do mesmo desenho, que divergiriam no dia em que alguém mexesse
        // numa só.
        expect(CSS_CODIGO).not.toContain('.admin-audit__select');
        expect(CSS_CODIGO).not.toContain('.admin-audit__input');
        expect(ABA).not.toMatch(/'admin-audit__select'/);
        expect(ABA).not.toMatch(/'admin-audit__input'/);
    });

    it('e a barra usa a classe da casa', () => {
        const usos = [...ABA.matchAll(/className = 'admin-input admin-audit__controle'/g)];
        expect(usos.length, 'os três tipos de controle (select, texto, data) usam a mesma base')
            .toBeGreaterThanOrEqual(3);
    });

    it('a nota de ESCOPO por audiência continua de pé', () => {
        // Ela é o que impede o produtor de ler ausência como "não aconteceu", e o
        // administrador de não saber que a lista dele não tem recorte. As duas frases ficam.
        expect(ABA).toMatch(/escopoDaTrilhaNotice\(this\._escopoOrgId\)/);
        expect(ABA).toMatch(/Você vê a trilha inteira do sistema/);
        expect(ABA).toMatch(/admin-audit__nota/);
    });

    it('e a barra é redesenhada quando o ESCOPO chega, não só quando `administra` muda', () => {
        // MEDIDO NO NAVEGADOR: para o produtor, `administra` chega `false` e a tela já nascia
        // `false`, então a redesenha nunca disparava e a barra ficava com a versão montada
        // ANTES da resposta — com `_escopoOrgId` ainda nulo. A nota do recorte existia no
        // código e não existia na tela. Um gatilho de um campo só não pega isto.
        expect(ABA).toMatch(/const escopoAntes = this\._escopoOrgId;/);
        expect(ABA).toMatch(
            /escopoMudou = administravaAntes !== this\._administra \|\| escopoAntes !== this\._escopoOrgId/,
        );
        expect(ABA).toMatch(/_renderLista\(escopoMudou \? this\._esqueleto\(\) : wrap, resposta\)/);
    });

    it('a frase do VAZIO continua dizendo a coisa certa', () => {
        // "Nada casou o filtro" nunca é a mesma afirmação que "nada aconteceu", e numa trilha
        // confundir as duas é o pior erro possível.
        expect(ABA).toMatch(/"nada casou o filtro", nunca "nada aconteceu"/);
    });
});
