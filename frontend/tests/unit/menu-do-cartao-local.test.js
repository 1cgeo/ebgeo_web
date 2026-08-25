// Path: tests/unit/menu-do-cartao-local.test.js

/**
 * @fileoverview O menu `⋯` do cartão de atlas LOCAL, em `atlas.html`.
 *
 * TRÊS PROPRIEDADES, e cada uma é medida no lugar onde ela pode mentir:
 *
 *   1. O RÓTULO DA CÓPIA. O item lia `Copiar neste computador`, e o irmão de servidor lê
 *      `Copiar no servidor`. O par distinguia as duas ações pela ORIGEM da cópia; o rótulo novo,
 *      `Duplicar`, distingue pela PALAVRA. A propriedade que sobrevive à troca é a distinção, não
 *      a string, então o teste cobra as duas pontas: o local diz `Duplicar` e o de servidor
 *      continua dizendo `Copiar no servidor`.
 *   2. O ITEM "ENVIAR AO SERVIDOR" APARECE SÓ COM SESSÃO. Um item que aparece deslogado é um
 *      comando que a página não pode cumprir, e o clique só descobriria isso depois do gesto.
 *   3. O DESFECHO DO ENVIO. Terminado o envio, a aplicação passa a apontar para o atlas NOVO do
 *      servidor. `sendToServerNotice` é a decisão pura (a frase MAIS o destino), e a fiação que a
 *      consome é lida do arquivo. O destino mora na função pura porque é a metade que pode mentir:
 *      um id construído na fiação seria uma decisão sem teste.
 *
 * POR QUE O DOBRO (função pura MAIS montagem). Asserir que `localCardMenuActions` devolve um item
 * não prova que o item CHEGA À TELA: o menu é desenhado imperativamente por `addItem(...)`, e uma
 * fiação que ignorasse a função pura deixaria toda a metade pura verde. Por isso cada gate aqui
 * tem o par: a asserção sobre a lista e a asserção sobre o menu MONTADO, com o clique real.
 *
 * O QUE ESTE ARQUIVO NÃO ALCANÇA, dito para não ser lido como cobertura completa: `projects-page.js`
 * boota no import e não pode ser carregado por um teste, então a fiação que mora nele
 * (o título do diálogo, o `onSendToServer`, o desfecho) é prendida por LEITURA do arquivo. Leitura
 * de fonte prova que a linha existe, nunca que ela roda.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fire, byTestid, makeDocumentStub } from '../helpers/dom-double.js';

vi.mock('@utils/toast_service.js', () => ({
    showToast: vi.fn(),
    showSuccess: vi.fn(),
    showWarning: vi.fn(),
    showError: vi.fn(),
}));

const {
    LocalAtlasSection, cardMenuActions, localCardMenuActions,
} = await import('../../src/js/projects/atlas-drive.js');
const {
    NoticeKind, sendToServerNotice,
} = await import('../../src/js/projects/local-atlas-notices.js');

const PAGE_SRC = readFileSync(
    fileURLToPath(new URL('../../src/js/projects/projects-page.js', import.meta.url)), 'utf8'
);
const DRIVE_SRC = readFileSync(
    fileURLToPath(new URL('../../src/js/projects/atlas-drive.js', import.meta.url)), 'utf8'
);

let originalDocument;
let host;
let mounted;

beforeEach(() => {
    originalDocument = globalThis.document;
    globalThis.document = makeDocumentStub();
    host = globalThis.document.body;
    mounted = [];
    vi.clearAllMocks();
});

afterEach(() => {
    // O menu arma um `setTimeout` que, disparando depois do teste, leria o `document` real.
    for (const section of mounted) section.destroy();
    globalThis.document = originalDocument;
});

const UM_ATLAS = [{ id: 'id-0', name: 'Atlas 0', createdAt: 1, updatedAt: 1 }];

/** Monta a seção local com callbacks espiões e abre o menu do primeiro cartão. */
function abrirMenu(options = {}) {
    const spies = {
        onOpen: vi.fn(), onCreate: vi.fn(), onRename: vi.fn(), onDuplicate: vi.fn(),
        onDelete: vi.fn(), onRetry: vi.fn(), onSendToServer: vi.fn(),
    };
    const section = new LocalAtlasSection({
        atlases: UM_ATLAS, max: 10, ...spies, ...options,
    });
    section.mount(host);
    mounted.push(section);
    fire(byTestid(host, 'local-atlas-menu'), 'click');
    const menu = byTestid(host, 'local-atlas-menu-popup');
    expect(menu, 'o menu do cartão não abriu').not.toBeNull();
    return { section, spies, menu };
}

/** Os rótulos do menu montado, na ordem em que ele os desenha. */
const rotulosDoMenu = (menu) => menu.children.map((c) => c.textContent);

// ============================================================================
// 1 — "Duplicar" no cartão local, "Copiar no servidor" no de servidor
// ============================================================================

describe('1 — o rótulo da cópia local', () => {
    it('o item de cópia do cartão local lê "Duplicar"', () => {
        const { menu } = abrirMenu();
        const item = byTestid(menu, 'local-atlas-duplicate');
        expect(item).not.toBeNull();
        expect(item.textContent).toBe('Duplicar');
    });

    it('A METADE QUE PRENDE A RAZÃO: o irmão de servidor continua dizendo onde a cópia nasce', () => {
        // Trocar os DOIS para `Duplicar` apagaria a distinção que o rótulo antigo existia para
        // fazer, e passaria na asserção acima. Esta linha é o que reprova essa troca.
        const duplicate = cardMenuActions({ permission: 'read' }).find((a) => a.id === 'duplicate');
        expect(duplicate.label).toBe('Copiar no servidor');
    });

    it('a string velha não sobrou em lugar nenhum das duas fontes, comentário incluído', () => {
        // O comentário é metade do achado: ele explicava a escolha CITANDO a string, então
        // deixá-lo ao lado do rótulo novo faria a prosa mentir sobre o código que ela documenta.
        expect(DRIVE_SRC).not.toContain('Copiar neste computador');
        expect(PAGE_SRC).not.toContain('Copiar neste computador');
    });

    it('o título do diálogo casa com o rótulo do menu que o abre', () => {
        // `projects-page.js` boota no import: o par rótulo/título é lido da fonte. O recorte é a
        // função, e não o arquivo, para que um `Duplicar` solto em outro lugar não pague por ela.
        const corpo = PAGE_SRC.slice(
            PAGE_SRC.indexOf('async function duplicateLocalAtlasFromPage(atlas)'),
            PAGE_SRC.indexOf('/** Card click / "Abrir"'),
        );
        expect(corpo).toContain("title: 'Duplicar'");
    });
});

// ============================================================================
// 2 — "Enviar ao servidor" no cartão local, só com sessão
// ============================================================================

/** Os ids das ações locais, na ordem em que o menu as desenha. */
const idsLocais = (options) => localCardMenuActions(options).map((a) => a.id);

describe('2 — o item "Enviar ao servidor" e o seu gate de sessão', () => {
    it('deslogado NÃO vê o item: a página não teria como cumpri-lo', () => {
        expect(idsLocais({ signedIn: false })).toEqual(['open', 'rename', 'duplicate', 'delete']);
    });

    it('logado vê o item, entre duplicar e excluir', () => {
        expect(idsLocais({ signedIn: true }))
            .toEqual(['open', 'rename', 'duplicate', 'send', 'delete']);
    });

    it('falha FECHADO para sessão ausente ou não-booleana', () => {
        // Sem esta linha, um `if (signedIn !== false)` passaria nos dois casos acima e ofereceria
        // o envio a quem chega sem sessão nenhuma, que é o estado padrão desta página.
        for (const s of [undefined, null, '', 0, 'sim', {}]) {
            expect(idsLocais({ signedIn: s })).not.toContain('send');
        }
        expect(idsLocais()).not.toContain('send');
    });

    it('excluir continua por último e é a ÚNICA ação destrutiva', () => {
        // O item novo entrou no meio da lista: se ele tivesse entrado depois de "Excluir", a ação
        // destrutiva deixaria de ser a última, que é a convenção dos dois menus desta tela.
        const acoes = localCardMenuActions({ signedIn: true });
        expect(acoes[acoes.length - 1].id).toBe('delete');
        expect(acoes.filter((a) => a.danger).map((a) => a.id)).toEqual(['delete']);
    });

    it('carrega o testid por extenso, igual ao que os specs de navegador miram', () => {
        const porId = Object.fromEntries(
            localCardMenuActions({ signedIn: true }).map((a) => [a.id, a.testid]),
        );
        expect(porId).toEqual({
            open: 'local-atlas-open',
            rename: 'local-atlas-rename',
            duplicate: 'local-atlas-duplicate',
            send: 'local-atlas-send-to-server',
            delete: 'local-atlas-delete',
        });
    });

    it('devolve um array NOVO a cada chamada', () => {
        expect(localCardMenuActions({ signedIn: true }))
            .not.toBe(localCardMenuActions({ signedIn: true }));
    });
});

describe('2 — e o item CHEGA à tela, com o clique ligado', () => {
    it('logado: o menu montado desenha o item e o clique chama `onSendToServer` com o atlas', () => {
        const { spies, menu } = abrirMenu({ signedIn: true });
        const item = byTestid(menu, 'local-atlas-send-to-server');
        expect(item, 'o item não foi desenhado').not.toBeNull();
        expect(item.textContent).toBe('Enviar ao servidor');
        fire(item, 'click');
        expect(spies.onSendToServer).toHaveBeenCalledTimes(1);
        expect(spies.onSendToServer).toHaveBeenCalledWith(UM_ATLAS[0]);
    });

    it('deslogado: o item não existe no menu montado', () => {
        const { menu } = abrirMenu({ signedIn: false });
        expect(byTestid(menu, 'local-atlas-send-to-server')).toBeNull();
        expect(rotulosDoMenu(menu)).not.toContain('Enviar ao servidor');
    });

    it('sem `onSendToServer`, o item não aparece nem para quem tem sessão', () => {
        // Um comando desenhado sem nada atrás é um botão morto, e o clique só descobriria isso
        // depois do gesto. `renderWithoutServer` é o caso real: monta a mesma seção sem o callback.
        const { menu } = abrirMenu({ signedIn: true, onSendToServer: null });
        expect(byTestid(menu, 'local-atlas-send-to-server')).toBeNull();
    });

    it('a ordem do menu montado é a da função pura, e não uma segunda lista', () => {
        const { menu } = abrirMenu({ signedIn: true });
        expect(menu.children.map((c) => c.dataset.testid))
            .toEqual(localCardMenuActions({ signedIn: true }).map((a) => a.testid));
    });
});

describe('2 — a página passa a sessão e o callback para a seção', () => {
    it('`buildLocalSection` liga `signedIn` ao predicado de sessão e o `onSendToServer`', () => {
        const corpo = PAGE_SRC.slice(
            PAGE_SRC.indexOf('function buildLocalSection(local)'),
            PAGE_SRC.indexOf('The page WITHOUT a server'),
        );
        expect(corpo).toContain('signedIn: sessionContext.isAuthenticated()');
        expect(corpo).toContain('onSendToServer:');
    });
});

// ============================================================================
// 3 — terminado o envio, a aplicação aponta para o atlas NOVO do servidor
// ============================================================================

describe('3 — o desfecho do envio', () => {
    const RESULTADO = {
        atlasId: 'srv-9',
        name: 'Operação Alfa',
        stats: { maps: 2, features: 7 },
        imageStats: { total: 3, uploaded: 3, skipped: 0, failed: 0 },
    };

    it('o aviso aponta para o id do atlas de SERVIDOR, nunca para o local', () => {
        const notice = sendToServerNotice(RESULTADO);
        expect(notice.openAtlasId).toBe('srv-9');
        expect(notice.kind).toBe(NoticeKind.SUCCESS);
        expect(notice.message).toContain('Operação Alfa');
        expect(notice.message).toContain('2 mapa');
        expect(notice.message).toContain('7 feição');
    });

    it('diz o que NÃO subiu, quando algo não subiu', () => {
        const notice = sendToServerNotice({
            ...RESULTADO,
            imageStats: { total: 3, uploaded: 1, skipped: 1, failed: 1 },
        });
        expect(notice.kind).toBe(NoticeKind.WARNING);
        expect(notice.message).toContain('2 imagem');
    });

    it('o AVISO fica na tela: quem tem algo a dizer não navega por cima da própria frase', () => {
        // O ACHADO, medido no navegador em 2026-08-25: a navegação partia 543 ms depois do clique,
        // e o toast morre com a página que o desenhou. Amostrando a tela a cada 20 ms por 5 s,
        // NENHUM toast apareceu. No sucesso a perda é barata (o atlas novo na tela diz o mesmo);
        // aqui a frase perdida é a única que nomeia as imagens que ficaram para trás.
        const aviso = sendToServerNotice({
            ...RESULTADO,
            imageStats: { total: 3, uploaded: 1, skipped: 1, failed: 1 },
        });
        expect(aviso.kind).toBe(NoticeKind.WARNING);
        expect(aviso.openAtlasId).toBeNull();
        // E ela diz onde o atlas está, senão ficar seria abandonar a pessoa na lista.
        expect(aviso.message).toContain('já está no servidor');

        // CONTROLE POSITIVO, e ele é o que impede o conserto de virar "nunca navegue": o mesmo
        // resultado SEM perda continua mandando a pessoa para o atlas de servidor.
        const ok = sendToServerNotice(RESULTADO);
        expect(ok.kind).toBe(NoticeKind.SUCCESS);
        expect(ok.openAtlasId).toBe('srv-9');
    });

    it('sem id de servidor não manda ninguém para lugar nenhum', () => {
        // O controle negativo do achado: um `openAtlasId` inventado levaria a página a navegar
        // para `./?atlas=undefined`, que é uma tela de erro em vez de um desfecho.
        for (const ruim of [undefined, null, {}, { atlasId: '' }, { atlasId: 42 }]) {
            expect(sendToServerNotice(ruim).openAtlasId).toBeNull();
        }
    });

    it('a fiação ABRE o atlas de servidor, e não mexe no ponteiro local', () => {
        const corpo = PAGE_SRC.slice(
            PAGE_SRC.indexOf('async function sendLocalAtlasToServerFromPage(atlas)'),
            PAGE_SRC.indexOf('/** Card click / "Abrir"'),
        );
        expect(corpo).toContain('sendToServerNotice(');
        expect(corpo).toContain('openAtlas(');
        // O envio é NÃO DESTRUTIVO e não troca o atlas local: o cartão continua existindo.
        expect(corpo).not.toContain('deleteLocalAtlas(');
        expect(corpo).not.toContain('setCurrentLocalAtlas(');
        expect(corpo).not.toContain('pointAtLocalAtlasAndGo(');
    });
});
