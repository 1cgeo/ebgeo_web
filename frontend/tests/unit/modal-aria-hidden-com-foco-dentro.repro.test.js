// Path: tests/unit/modal-aria-hidden-com-foco-dentro.repro.test.js

/**
 * @fileoverview Fechar um modal não pode deixar o foco DENTRO do overlay que recebe
 * `aria-hidden="true"`.
 *
 * O DEFEITO, relatado pelo dono em 2026-09-23 no seletor de símbolo militar: Cancelar fechava o
 * modal e o Chrome acusava "Blocked aria-hidden on an element because its descendant retained
 * focus", com o foco no botão Cancelar e o `aria-hidden` no overlay. `ModalBase.hide` já movia o
 * foco antes do atributo, porém em dois ramos exclusivos: devolvia o foco ao elemento guardado
 * na abertura OU, só quando nada tinha sido guardado, tirava o foco do elemento ativo. O
 * `focus()` do elemento guardado falha calado quando ele é `document.body` ou saiu do DOM com o
 * modal aberto, e nesse caso o segundo ramo não rodava.
 *
 * O teste lê o foco no INSTANTE em que o atributo é escrito, que é o instante que o navegador
 * julga, e não depois de `hide()` terminar.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ModalBase } from '@/js/modals/modal.base.js';

let documentOriginal;

/**
 * Monta um modal aberto sobre um DOM mínimo e devolve o que o teste observa.
 * @param {(fake: object) => object|null} opener - Fabrica o elemento guardado na abertura.
 */
function montar(opener) {
    const fake = {};
    fake.body = { style: {} };
    fake.cancelar = {
        blurs: 0,
        blur() {
            this.blurs++;
            fake.activeElement = fake.body;
        }
    };
    fake.activeElement = fake.cancelar;
    fake.focoDentroNoAtributo = null;
    fake.overlay = {
        dataset: { visible: 'true' },
        contains: (el) => el === fake.cancelar,
        setAttribute(nome, valor) {
            if (nome === 'aria-hidden' && valor === 'true') {
                fake.focoDentroNoAtributo = this.contains(fake.activeElement);
            }
        }
    };
    globalThis.document = fake;

    const modal = new ModalBase({ id: 'teste' });
    modal._overlay = fake.overlay;
    modal._isOpen = true;
    modal._previousActiveElement = opener(fake);
    return { modal, fake };
}

describe('ModalBase.hide nunca esconde um overlay com o foco dentro', () => {
    beforeEach(() => {
        documentOriginal = globalThis.document;
    });

    afterEach(() => {
        globalThis.document = documentOriginal;
    });

    it('o elemento guardado NÃO aceita o foco (body, ou botão que saiu do DOM): o foco sai mesmo assim', () => {
        const { modal, fake } = montar(() => ({ focus() { /* falha calada, como no navegador */ } }));

        modal.hide();

        // Controle do instrumento: o atributo foi de fato escrito, senão o `false` abaixo seria
        // o valor inicial e não uma medição.
        expect(fake.focoDentroNoAtributo).not.toBeNull();
        expect(fake.focoDentroNoAtributo).toBe(false);
        expect(fake.cancelar.blurs).toBe(1);
    });

    it('o elemento guardado aceita o foco: ele o recebe e nada é desfocado à força', () => {
        const abridor = {};
        const { modal, fake } = montar((f) => {
            abridor.focus = () => { f.activeElement = abridor; };
            return abridor;
        });

        modal.hide();

        expect(fake.focoDentroNoAtributo).toBe(false);
        expect(fake.activeElement).toBe(abridor);
        expect(fake.cancelar.blurs).toBe(0);
        expect(modal._previousActiveElement).toBeNull();
    });

    it('nada foi guardado na abertura: o foco sai do overlay', () => {
        const { modal, fake } = montar(() => null);

        modal.hide();

        expect(fake.focoDentroNoAtributo).toBe(false);
        expect(fake.cancelar.blurs).toBe(1);
    });
});
