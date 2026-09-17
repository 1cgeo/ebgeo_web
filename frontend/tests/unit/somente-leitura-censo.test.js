// Path: tests/unit/somente-leitura-censo.test.js
//
// O CENSO DAS SUPERFÍCIES QUE SOMEM EM SOMENTE LEITURA (2026-09-16).
//
// POR QUE ELE EXISTE. Um inventário das superfícies de edição encontrou QUINZE que consultavam
// apenas a trava do mapa (`isCurrentMapLockedSync`) e nada sabiam do papel no atlas: quem entrava
// com compartilhamento `read` ou por link público via o comando, clicava, e a escrita morria no
// guarda da store. Em oito delas a TELA AFIRMAVA O CONTRÁRIO — "Briefing X excluído" sobre uma
// exclusão recusada, a linha do catálogo sumindo da lista, "Configurações salvas.", e uma feição
// desenhada por atalho de teclado que virava fantasma na tela.
//
// A DECISÃO DO DONO (2026-09-16) é que em somente leitura o comando de edição SOME, como já manda a
// regra do POSTO no CLAUDE.md da raiz. Há dois jeitos legítimos de fazer isso somer, e o censo
// aceita os dois:
//   - `marca`: o elemento leva a classe `edit-affordance`, que `css/view-mode.css` esconde;
//   - `pergunta`: o código consulta `semEdicaoSync`/`edicaoIndisponivelSync` antes de desenhar ou
//     de gastar o gesto.
//
// O QUE ELE NÃO PROVA, e a lista é deliberada: que a superfície esteja no lugar certo da tela, que
// o CSS de fato esconda (isso é `view-mode.css` mais o Playwright), e que não exista uma DÉCIMA
// SEXTA superfície ainda não descoberta. É lista de sítios conhecidos, como
// `criacao-recusa-na-entrada.test.js` declara do lado dele: ela cresce quando alguém achar o
// próximo, e o que ela garante é que nenhum destes REGRIDA em silêncio.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/** Lê um arquivo de `src/` pelo caminho relativo ao pacote. */
const fonte = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

/** Remove comentários de linha e de bloco, para o censo medir CÓDIGO e não prosa. */
function semComentarios(texto) {
    return texto
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((linha) => linha.replace(/(^|[^:])\/\/.*$/, '$1'))
        .join('\n');
}

const PERGUNTA = 'pergunta';
const MARCA = 'marca';

/**
 * Os quinze sítios do inventário, com a classe e a âncora que amarra o caso ao lugar certo.
 * Sem a âncora, o caso passaria com o gate em qualquer outro ponto do arquivo.
 */
const SITIOS = Object.freeze([
    { nome: 'Painel de feição (nome, cor, tamanho, fotos, excluir)', classe: PERGUNTA,
        arquivo: 'src/js/sidebar/panels/feature-panel-content.js', ancora: 'const mapLocked = semEdicaoSync();' },
    { nome: 'Painel do marcador 3D e do 360', classe: PERGUNTA,
        arquivo: 'src/js/sidebar/handlers/feature-3d-handlers.js', ancora: 'if (semEdicaoSync()) {' },
    { nome: 'Tabela de atributos (célula editável)', classe: PERGUNTA,
        arquivo: 'src/js/attribute_table/attribute-table.control.js', ancora: 'readOnly: semEdicaoSync(),' },
    { nome: 'Renomear camada por duplo clique', classe: PERGUNTA,
        arquivo: 'src/js/features_tab/layer-list.component.js', ancora: 'if (!semEdicaoSync()) {' },
    { nome: 'Menu de contexto: grupos, setas, cortar, mover para camada e para mapa', classe: PERGUNTA,
        arquivo: 'src/js/context-menu/context-menu.control.js', ancora: 'const locked = semEdicaoSync();' },
    { nome: 'Teclas de ferramenta de desenho (o fantasma na tela)', classe: PERGUNTA,
        arquivo: 'src/js/keyboard/keyboard-shortcuts.js', ancora: "const locked = semEdicaoSync();" },
    { nome: 'Catálogo: remover camada', classe: MARCA,
        arquivo: 'src/js/features_tab/catalog-layers.component.js', ancora: 'catalog-layer-remove edit-affordance' },
    { nome: 'Briefing: editar', classe: MARCA,
        arquivo: 'src/js/sidebar/tabs/briefings.tab.js', ancora: 'edit-btn edit-affordance' },
    { nome: 'Briefing: excluir', classe: MARCA,
        arquivo: 'src/js/sidebar/tabs/briefings.tab.js', ancora: 'delete-btn edit-affordance' },
    { nome: 'Configurações do atlas', classe: MARCA,
        arquivo: 'src/js/sidebar/tabs/maps.tab.js', ancora: "'sidebar-settings-btn edit-affordance'" },
    { nome: 'Temporal: engrenagem de configuração', classe: MARCA,
        arquivo: 'src/js/temporal/temporal-timeline-bar.js', ancora: 'temporal-bar__settings edit-affordance' },
]);

describe('somente leitura: as superfícies de edição somem', () => {
    it.each(SITIOS)('$nome', ({ arquivo, ancora, classe }) => {
        const texto = semComentarios(fonte(arquivo));
        expect(texto).toContain(ancora);
        if (classe === PERGUNTA) {
            // A pergunta tem de vir do módulo único, e não de uma conta refeita no arquivo.
            expect(texto).toMatch(/from '@store\/edicao-indisponivel\.js'/);
        }
    });

    it('a marca `edit-affordance` é de fato escondida pelo modo de visualização', () => {
        // Sem esta linha o censo inteiro seria vacuidade: marcar a classe não esconde nada se o CSS
        // não a conhecer.
        const css = fonte('src/css/view-mode.css');
        expect(css).toMatch(/body\.is-view-only[\s\S]*\.edit-affordance/);
        expect(css).toMatch(/display:\s*none/);
    });

    it('o módulo da conta única soma os DOIS eixos, e não só a trava', () => {
        // Discriminação do censo: se `edicao-indisponivel.js` passasse a consultar apenas a trava,
        // todos os casos acima continuariam verdes e o defeito estaria de volta inteiro.
        const texto = semComentarios(fonte('src/js/store/edicao-indisponivel.js'));
        expect(texto).toContain('checkPermission');
        expect(texto).toContain('isCurrentMapLockedSync');
    });

    it('o COMENTARISTA continua comentando: a superfície de comentário não pergunta pelo gate de EDIÇÃO', () => {
        // O Comentarista é o somente leitura MAIS uma função (decisão do dono, 2026-09-16): ele tem
        // `canComment` e não tem `canEdit`, então `semEdicaoSync` o bloqueia em toda superfície de
        // edição — e é justamente por isso que ela não pode encostar no comentário, ou ele perderia
        // a única coisa que sabe fazer. O gate do comentário é `CREATE_COMMENT`, e mora no overlay.
        for (const arquivo of ['src/js/comment_tool/comment-overlay.js', 'src/js/comment_tool/comments-panel.js']) {
            expect(semComentarios(fonte(arquivo))).not.toMatch(/edicao-indisponivel/);
        }
        expect(semComentarios(fonte('src/js/comment_tool/comment-overlay.js'))).toContain('GuardAction.CREATE_COMMENT');

        // E o Shift+C não passa pelo `locked` das ferramentas de desenho: ele é tratado antes, em
        // `handleSystemShortcuts`, e quem recusa é o overlay.
        const teclado = semComentarios(fonte('src/js/keyboard/keyboard-shortcuts.js'));
        const shiftC = teclado.indexOf("key === 'c'");
        const gateDeDesenho = teclado.indexOf('const locked = semEdicaoSync();');
        expect(shiftC).toBeGreaterThan(-1);
        expect(gateDeDesenho).toBeGreaterThan(-1);
        expect(shiftC).toBeLessThan(gateDeDesenho);
    });

    it('a tela segue o RESULTADO da escrita, e não a intenção', () => {
        // Os dois sítios que anunciavam sucesso sobre uma recusa. A forma é a mesma de
        // `colar-nao-anuncia-sucesso-recusado.repro.test.js`.
        const briefings = semComentarios(fonte('src/js/sidebar/tabs/briefings.tab.js'));
        expect(briefings).toContain('const excluido = await deleteBriefing(briefingId);');
        expect(briefings).toMatch(/if \(excluido === false\) return;/);

        const catalogo = semComentarios(fonte('src/js/features_tab/catalog-layers.component.js'));
        expect(catalogo).toContain('const removida = await removeCatalogLayer(layer.id);');
        expect(catalogo).toMatch(/if \(!removida\) return;/);
    });
});
