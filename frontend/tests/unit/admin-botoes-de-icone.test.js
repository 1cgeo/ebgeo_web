// Path: tests/unit/admin-botoes-de-icone.test.js

/**
 * @fileoverview OS BOTÕES DE LINHA DA TABELA DE USUÁRIOS VIRARAM ÍCONES, e o NOME ACESSÍVEL não
 * podia ir junto com o texto (pedido do dono, 2026-09-22).
 *
 * O que esta suíte prende, e por que cada parte mede alguma coisa:
 *
 * 1. A TABELA INTEIRA em igualdade absoluta (rótulo, variante e `data-testid` de cada ação). Um
 *    `toContain` passaria com um rótulo apagado; a igualdade reprova. Os `data-testid` são os que
 *    os specs do Playwright clicam (`admin-user-deactivate`, `admin-user-edit`), então trocá-los
 *    quebraria a camada de navegador sem nada vermelho aqui, se esta asserção não existisse.
 * 2. O ÍCONE É DECORAÇÃO: todo SVG leva `aria-hidden="true"` e `focusable="false"` e não
 *    interpola nada. Sem o primeiro, o leitor de tela soma o desenho ao nome.
 * 3. DESATIVAR E REATIVAR TÊM DESENHOS DIFERENTES. O mesmo interruptor em duas cores
 *    distinguiria as duas ações só pela cor.
 * 4. O CONSTRUTOR, sob um `document` falso de duas funções: `type="button"`, `aria-label` e
 *    `title` com o verbo, e o clique ligado. É o que um reescritor desatento perde primeiro.
 * 5. A FIAÇÃO, lida do fonte, porque o ambiente é node e a aba não monta aqui: a célula de ações
 *    usa o construtor para as CINCO ações, o formulário de criação e o de redefinir senha ligam o
 *    olho da senha nos três campos, e o manifesto de `admin.html` importa a folha de estilo do
 *    olho (sem ela o botão nasce sem posição, fora do campo, e nada acusa).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    USER_ROW_ACTION,
    IconButtonVariant,
    iconButtonClassName,
    createIconButton,
} from '../../src/js/admin/admin-icon-button.js';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fonte = (rel) => readFileSync(resolve(FRONT, rel), 'utf8');

describe('USER_ROW_ACTION — a tabela das ações de linha', () => {
    it('tem exatamente as cinco ações, com rótulo, variante e testid esperados', () => {
        const resumo = Object.fromEntries(Object.entries(USER_ROW_ACTION).map(
            ([chave, { label, variant, testid }]) => [chave, { label, variant, testid }],
        ));
        expect(resumo).toEqual({
            EDIT: { label: 'Editar', variant: 'ghost', testid: 'admin-user-edit' },
            PASSWORD: { label: 'Redefinir senha', variant: 'ghost', testid: 'admin-user-password' },
            APPROVE: { label: 'Aprovar', variant: 'ghost', testid: 'admin-user-approve' },
            DEACTIVATE: { label: 'Desativar', variant: 'danger', testid: 'admin-user-deactivate' },
            REACTIVATE: { label: 'Reativar', variant: 'ghost', testid: 'admin-user-reactivate' },
        });
    });

    it('todo ícone é SVG estático, escondido da árvore de acessibilidade e fora do foco', () => {
        const acoes = Object.values(USER_ROW_ACTION);
        expect(acoes).toHaveLength(5);
        for (const { icon } of acoes) {
            expect(icon.startsWith('<svg ')).toBe(true);
            expect(icon.endsWith('</svg>')).toBe(true);
            expect(icon).toContain('aria-hidden="true"');
            expect(icon).toContain('focusable="false"');
            expect(icon).not.toContain('${');
        }
    });

    it('cada ação tem desenho próprio, e desativar não é reativar em outra cor', () => {
        const icones = Object.values(USER_ROW_ACTION).map((a) => a.icon);
        expect(new Set(icones).size).toBe(icones.length);
        expect(USER_ROW_ACTION.DEACTIVATE.icon).not.toBe(USER_ROW_ACTION.REACTIVATE.icon);
    });

    it('a tabela é congelada, por inteiro e por linha', () => {
        expect(Object.isFrozen(USER_ROW_ACTION)).toBe(true);
        for (const acao of Object.values(USER_ROW_ACTION)) expect(Object.isFrozen(acao)).toBe(true);
    });
});

describe('iconButtonClassName', () => {
    it('monta a classe das duas variantes conhecidas', () => {
        expect(iconButtonClassName(IconButtonVariant.GHOST)).toBe('admin-btn admin-btn--ghost admin-btn--icon');
        expect(iconButtonClassName(IconButtonVariant.DANGER)).toBe('admin-btn admin-btn--danger admin-btn--icon');
    });

    it('variante desconhecida ou ausente cai no fantasma, nunca em admin-btn--undefined', () => {
        for (const v of [undefined, null, '', 'primary', 'DANGER', NaN]) {
            expect(iconButtonClassName(v)).toBe('admin-btn admin-btn--ghost admin-btn--icon');
        }
    });
});

describe('createIconButton — sob um document falso', () => {
    const original = globalThis.document;
    afterEach(() => { globalThis.document = original; });

    /** O mínimo de elemento que o construtor toca. */
    function instalarDocumentoFalso() {
        globalThis.document = {
            createElement(tag) {
                const attrs = {};
                const ouvintes = [];
                return {
                    tagName: tag.toUpperCase(),
                    dataset: {},
                    attrs,
                    ouvintes,
                    setAttribute(nome, valor) { attrs[nome] = String(valor); },
                    addEventListener(tipo, fn) { ouvintes.push([tipo, fn]); },
                };
            },
        };
    }

    it('desenha um botão que não submete, com o verbo no nome acessível e no title', () => {
        instalarDocumentoFalso();
        let clicou = 0;
        const btn = createIconButton(USER_ROW_ACTION.DEACTIVATE, () => { clicou += 1; });
        expect(btn.tagName).toBe('BUTTON');
        expect(btn.type).toBe('button');
        expect(btn.className).toBe('admin-btn admin-btn--danger admin-btn--icon');
        expect(btn.dataset.testid).toBe('admin-user-deactivate');
        expect(btn.attrs['aria-label']).toBe('Desativar');
        expect(btn.title).toBe('Desativar');
        expect(btn.innerHTML).toBe(USER_ROW_ACTION.DEACTIVATE.icon);
        expect(btn.ouvintes).toHaveLength(1);
        expect(btn.ouvintes[0][0]).toBe('click');
        btn.ouvintes[0][1]();
        expect(clicou).toBe(1);
    });

    it('sem onClick não liga ouvinte nenhum', () => {
        instalarDocumentoFalso();
        const btn = createIconButton(USER_ROW_ACTION.EDIT, null);
        expect(btn.ouvintes).toHaveLength(0);
        expect(btn.attrs['aria-label']).toBe('Editar');
    });
});

describe('a fiação, lida do fonte', () => {
    it('o módulo dos botões tem zero imports (admin.html boota sem a store)', () => {
        const src = fonte('src/js/admin/admin-icon-button.js');
        expect(src).not.toMatch(/^\s*import\s/m);
    });

    it('a célula de ações da aba Usuários usa o construtor para as cinco ações', () => {
        const src = fonte('src/js/admin/users-tab.js');
        for (const chave of Object.keys(USER_ROW_ACTION)) {
            expect(src).toContain(`createIconButton(USER_ROW_ACTION.${chave}`);
        }
        // O CONTROLE NEGATIVO: nenhum dos cinco textos antigos sobrou como botão de texto.
        for (const texto of ['Editar', 'Senha', 'Aprovar', 'Desativar', 'Reativar']) {
            expect(src).not.toContain(`button('${texto}'`);
        }
    });

    it('o olho da senha está nos três campos de senha da aba', () => {
        const src = fonte('src/js/admin/users-tab.js');
        expect(src).toContain("from '@ui/password-visibility.js'");
        for (const testid of [
            'admin-userform-password-reveal',
            'admin-pwform-new-reveal',
            'admin-pwform-confirm-reveal',
        ]) {
            expect(src).toContain(`testid: '${testid}'`);
        }
    });

    it('o manifesto de admin.html importa a folha do olho', () => {
        const css = fonte('src/css/admin-page.css');
        expect(css).toContain("@import url('./password-field.css');");
    });

    // A REGRA PRÓPRIA DO PAINEL, e ela existe porque `.admin-form__field input` (0,1,1) vence
    // `.password-field__input` (0,1,0): sem ela o recuo do olho vira o de todo campo e a senha
    // longa corre por baixo do ícone. E o campo, dentro do invólucro de bloco que o olho cria,
    // deixa de ser esticado pela coluna flexível e encolhe para a largura natural.
    it('admin.css dá ao campo com olho a largura inteira e o recuo do ícone', () => {
        const css = fonte('src/css/admin.css');
        const regra = css.match(/\.admin-form__field \.password-field__input\s*\{([^}]*)\}/);
        expect(regra).not.toBeNull();
        expect(regra[1]).toMatch(/width:\s*100%/);
        expect(regra[1]).toMatch(/padding-right:\s*var\(--space-8\)/);
    });
});
