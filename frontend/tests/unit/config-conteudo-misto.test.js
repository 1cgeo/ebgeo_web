// Path: tests/unit/config-conteudo-misto.test.js
//
// A ABA SISTEMA NÃO SALVA UM ENDEREÇO QUE O NAVEGADOR VAI BLOQUEAR (2026-09-24, frente producao).
//
// Medido no pacote de produção servido em https: o servidor aceita `http://` na fonte da previsão
// meteorológica e no servidor de tiles (e precisa aceitar, porque não sabe em que esquema o app é
// servido), e o navegador bloqueia todo `fetch` a `http://` numa página https como conteúdo misto,
// antes de o pedido sair. O painel meteorológico lia isso como "sem conexão" e a grade UTM não
// desenhava, sem uma palavra na tela do administrador que salvou o valor.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bloqueadaPorConteudoMisto, fraseDeConteudoMisto } from '../../src/js/admin/conteudo-misto.js';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('bloqueadaPorConteudoMisto', () => {
    it('bloqueia http:// de outro host numa página https', () => {
        expect(bloqueadaPorConteudoMisto('http://api.open-meteo.com', 'https:')).toBe(true);
        expect(bloqueadaPorConteudoMisto('http://tiles.eb.mil.br/tiles', 'https:')).toBe(true);
        expect(bloqueadaPorConteudoMisto('HTTP://Tiles.EB.mil.br', 'https:')).toBe(true);
    });

    it('não bloqueia https://, nem página http', () => {
        expect(bloqueadaPorConteudoMisto('https://api.open-meteo.com', 'https:')).toBe(false);
        expect(bloqueadaPorConteudoMisto('http://api.open-meteo.com', 'http:')).toBe(false);
    });

    it('não bloqueia as origens que o navegador trata como confiáveis', () => {
        for (const url of ['http://localhost/tiles', 'http://127.0.0.1:9/tiles', 'http://[::1]:8080',
            'http://tiles.localhost']) {
            expect(bloqueadaPorConteudoMisto(url, 'https:'), url).toBe(false);
        }
    });

    it('endereço relativo é da mesma origem e nunca misto; entrada ausente não bloqueia', () => {
        expect(bloqueadaPorConteudoMisto('/tiles', 'https:')).toBe(false);
        expect(bloqueadaPorConteudoMisto('', 'https:')).toBe(false);
        expect(bloqueadaPorConteudoMisto(null, 'https:')).toBe(false);
        expect(bloqueadaPorConteudoMisto(undefined, undefined)).toBe(false);
    });

    it('a frase nomeia o campo e o que digitar', () => {
        const frase = fraseDeConteudoMisto('A fonte da previsão meteorológica');
        expect(frase.startsWith('A fonte da previsão meteorológica precisa começar com https://.')).toBe(true);
    });
});

describe('a aba Sistema consulta o predicado nos dois campos que o navegador busca', () => {
    const fonte = readFileSync(join(FRONT, 'src/js/admin/config-tab.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

    it('a fonte meteorológica', () => {
        expect(fonte).toMatch(/bloqueadaPorConteudoMisto\(\s*meteoVal\s*,/);
    });

    it('o servidor de tiles', () => {
        expect(fonte).toMatch(/bloqueadaPorConteudoMisto\(\s*tileVal\s*,/);
    });

    it('com o protocolo da PÁGINA, que é o único que sabe em que esquema o app é servido', () => {
        const chamadas = fonte.match(/bloqueadaPorConteudoMisto\([^)]*\)/g) ?? [];
        expect(chamadas.length).toBe(2);
        for (const chamada of chamadas) expect(chamada).toMatch(/location\??\.protocol/);
    });
});
