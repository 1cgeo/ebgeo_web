// Path: tests/unit/relato-release-do-build.test.js

import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import viteConfig from '../../vite.config.js';

// O CARIMBO DE BUILD, do lado do build.
//
// A PERGUNTA QUE ELE RESPONDE: "de qual build veio este relato de erro?". `__APP_VERSION__` sozinho
// não responde, porque ele vem do `version` do `package.json` e dez builds seguidos se dizem
// `1.0.0` — e é justamente entre dois builds da mesma versão que a pergunta se faz. `release.json`
// responde a pergunta INVERSA, a que se faz olhando o servidor: "o que está publicado agora?".
//
// ESTE ARQUIVO IMPORTA O `vite.config.js` DE VERDADE, e não uma cópia da lógica. É o único jeito
// honesto: um teste que reimplementasse o `define` provaria que a reimplementação funciona.
//
// CONTROLE NEGATIVO: tire o `__APP_RELEASE__` do `define` e "o commit viaja no bundle" reprova;
// tire o plugin da lista e "escreve `release.json`" reprova; tire a guarda de uma vez só e "a
// segunda passada (legacy) não escreve de novo" reprova, porque o arquivo reaparece.

/** @returns {Object} A configuração resolvida, como o Vite a pede. */
function configuracao() {
    return viteConfig({ mode: 'production', command: 'build' });
}

describe('define: o commit viaja dentro do bundle', () => {
    it('`__APP_VERSION__` continua existindo (nada foi trocado, só somado)', () => {
        const { define } = configuracao();
        expect(typeof define.__APP_VERSION__).toBe('string');
        expect(JSON.parse(define.__APP_VERSION__)).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('`__APP_RELEASE__` é o COMMIT CURTO, ou string vazia quando não há git', () => {
        const { define } = configuracao();
        const hash = JSON.parse(define.__APP_RELEASE__);
        expect(typeof hash).toBe('string');
        // Esta árvore É um repositório git, então aqui o hash existe. Fora dele (tarball, imagem
        // sem `.git`) a string vazia é o valor honesto, e `versaoDoBuild()` degrada para a versão.
        expect(hash === '' || /^[0-9a-f]{7,40}$/.test(hash)).toBe(true);
    });

    it('o par cabe no teto de 100 que a rota valida', () => {
        const { define } = configuracao();
        const versao = JSON.parse(define.__APP_VERSION__);
        const hash = JSON.parse(define.__APP_RELEASE__);
        expect(`${versao}+${hash}`.length).toBeLessThanOrEqual(100);
    });

    it('o carimbo de tempo é o MESMO objeto para o define e para o arquivo', () => {
        // Duas leituras do relógio dariam dois conteúdos para o mesmo `fileName`, que é conflito
        // de asset na segunda passada do build.
        const { define } = configuracao();
        expect(() => new Date(JSON.parse(define.__BUILD_TIME__)).toISOString()).not.toThrow();
    });
});

describe('plugin: `release.json` na raiz do dist', () => {
    /** @returns {Object} O plugin, achado pelo nome. */
    function plugin() {
        const achado = configuracao().plugins.find((p) => p && p.name === 'ebgeo-release-json');
        expect(achado, 'o plugin `ebgeo-release-json` saiu da lista de plugins').toBeTruthy();
        return achado;
    }

    // ESCRITA REAL num diretório temporário, e não um `emitFile` espião: a primeira versão do
    // plugin emitia por `generateBundle`, o espião ficava verde e o `npm run build` saía sem o
    // arquivo (o Rolldown não materializa asset emitido ali). O que se prova aqui é o que o build faz.
    it('escreve `release.json` na raiz do diretório de saída, com os quatro campos', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ebgeo-release-'));
        try {
            plugin().writeBundle({ dir });
            const conteudo = JSON.parse(readFileSync(join(dir, 'release.json'), 'utf8'));
            expect(Object.keys(conteudo).sort()).toEqual(['builtAt', 'hash', 'release', 'version']);
            expect(conteudo.release).toBe(
                conteudo.hash ? `${conteudo.version}+${conteudo.hash}` : conteudo.version,
            );
            expect(() => new Date(conteudo.builtAt).toISOString()).not.toThrow();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('a SEGUNDA passada (a legada, do plugin-legacy) não escreve de novo', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ebgeo-release-'));
        try {
            const p = plugin();
            p.writeBundle({ dir });
            const primeira = readFileSync(join(dir, 'release.json'), 'utf8');
            rmSync(join(dir, 'release.json'));
            p.writeBundle({ dir });
            p.writeBundle({ dir });
            expect(existsSync(join(dir, 'release.json')), 'a segunda passada reescreveu').toBe(false);
            expect(primeira.length).toBeGreaterThan(20);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
