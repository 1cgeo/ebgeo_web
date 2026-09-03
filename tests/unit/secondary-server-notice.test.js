/**
 * Aviso de servidor secundario: a chave `app.avisoServidorSecundario` so liga
 * a tela com o booleano `true`, e a ausencia dela vale false.
 *
 * O PIOR CASO que este teste existe para pegar e a implantacao cujo config nao
 * conhece a chave: o config gerado para o GitHub Pages (prepare-deploy.cjs) e
 * qualquer config.js de producao editado a mao antes de a chave existir. Nesses
 * a tela NAO pode abrir, e nada mais pode mudar.
 */

import { describe, it, expect } from 'vitest';
import {
    isSecondaryServerNoticeEnabled,
    NOTICE_TEXT,
    PRIMARY_SERVER_URL,
} from '../../src/js/ui/secondary-server-notice.js';

describe('isSecondaryServerNoticeEnabled', () => {
    it('o modulo importa sem DOM: o ambiente node nao tem document', () => {
        expect(typeof document).toBe('undefined');
    });

    it('config sem a chave vale false (GitHub Pages, config antigo de producao)', () => {
        const semAChave = { app: { title: 'EBGeo', tutorialUrl: './docs/doc.html' } };
        expect(isSecondaryServerNoticeEnabled(semAChave)).toBe(false);
    });

    it('config sem o bloco app, ou nulo, vale false', () => {
        expect(isSecondaryServerNoticeEnabled({})).toBe(false);
        expect(isSecondaryServerNoticeEnabled({ app: null })).toBe(false);
        expect(isSecondaryServerNoticeEnabled(null)).toBe(false);
    });

    it('false explicito vale false', () => {
        expect(isSecondaryServerNoticeEnabled({ app: { avisoServidorSecundario: false } })).toBe(false);
    });

    it('true liga a tela', () => {
        expect(isSecondaryServerNoticeEnabled({ app: { avisoServidorSecundario: true } })).toBe(true);
    });

    it('so o booleano true liga: string, numero e objeto valem false', () => {
        for (const valor of ['true', 'sim', 1, {}, [], 'false']) {
            expect(isSecondaryServerNoticeEnabled({ app: { avisoServidorSecundario: valor } })).toBe(false);
        }
    });

    it('o config do repositorio liga a tela (decisao do chefe, 2026-09-03); quem implanta no servidor principal poe false', () => {
        expect(isSecondaryServerNoticeEnabled()).toBe(true);
    });
});

describe('texto do aviso', () => {
    const texto = [NOTICE_TEXT.title, ...NOTICE_TEXT.paragraphs].join(' ');

    it('nomeia onde este servidor esta e qual e o recomendado', () => {
        expect(texto).toContain('servidor secundário');
        expect(texto).toContain('1° Centro de Geoinformação');
        expect(texto).toContain('Porto Alegre');
        expect(texto).toContain('ebgeo.dsg.eb.mil.br');
        expect(texto).toContain('Brasília');
        expect(texto).toContain('7° Centro de Telemática de Área');
    });

    it('o botao principal aponta para o servidor do 7 CTA por https', () => {
        const url = new URL(PRIMARY_SERVER_URL);
        expect(url.protocol).toBe('https:');
        expect(url.hostname).toBe('ebgeo.dsg.eb.mil.br');
        expect(NOTICE_TEXT.goToPrimary).toContain(url.hostname);
    });
});
