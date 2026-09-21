// Path: tests/unit/documento-de-mapa-vazio-uma-fonte.test.js

/**
 * O DOCUMENTO DE MAPA VAZIO TEM UMA FONTE SÓ.
 *
 * Defeito latente (fechado em 2026-09-21): o conteúdo do mapa vazio (mapa base de nascimento, os
 * baldes de feição, a posição salva, as notas) estava escrito DUAS vezes, em `getEmptyMapData` de
 * `src/js/store/repository.utils.js` e em `getEmptyMapData` de
 * `src/js/store/repositories/local.repository.js`, e cada cópia tinha consumidor próprio: a
 * leitura tolerante (`getMapDataCompat`) e o import usam a do repositório, e "limpar posição
 * salva" lê o mapa base de NASCIMENTO na outra (`birthBaseLayer`, `store/map-view.operations.js`).
 * Só os BALDES DE FEIÇÃO estavam presos, e indiretamente: o censo de cobertura do registro de tipos
 * (`registro-tipos-cobertura.test.js`) cobrava de cada cópia a lista completa de tipos. O resto do
 * documento (mapa base, posição salva, notas) era igual POR ACASO. Mudar o mapa base padrão numa
 * cópia só faria limpar a vista salva devolver uma base que um mapa recém-nascido não recebe, sem
 * erro em lugar nenhum.
 *
 * A do repositório passou a DERIVAR da outra, acrescentando só os três campos que um registro
 * guardado carrega (`id`, `name`, `sync`). Conferido antes de apagar: a cópia apagada era idêntica
 * à outra, linha a linha, fora esses três.
 *
 * O teste prende as duas metades: o COMPORTAMENTO (o conteúdo é o mesmo objeto estrutural, a ordem
 * das chaves é a de sempre) e a FORMA (a segunda cópia não volta a ser escrita à mão).
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// `local.repository.js` abre IndexedDB por `atlas-namespace.js`; este teste só quer a função pura.
vi.mock('../../src/js/store/atlas-namespace.js', () => ({
    StoreName: new Proxy({}, { get: (_, k) => String(k) }),
    getStoreFor: vi.fn(),
    getStore: vi.fn(),
    getActiveScope: vi.fn(() => null),
    legacyScope: vi.fn(() => ({ kind: 'local', dbSuffix: '' }))
}));

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('o documento de mapa vazio deriva do conteúdo vazio', () => {
    it('o conteúdo é o MESMO nas duas funções, chave a chave e em profundidade', async () => {
        const { getEmptyMapData: conteudo } = await import('../../src/js/store/repository.utils.js');
        const { getEmptyMapData: documento } = await import('../../src/js/store/repositories/local.repository.js');

        const { id, name, sync, ...resto } = documento();
        expect(resto).toEqual(conteudo());
        // Os três campos que só o registro guardado carrega, e que a outra função NÃO tem.
        expect(id).toBeNull();
        expect(name).toBe('Novo Mapa');
        expect(sync).toEqual(expect.objectContaining({ version: expect.any(Number) }));
        for (const chave of ['id', 'name', 'sync']) expect(conteudo()).not.toHaveProperty(chave);
    });

    it('a ordem das chaves do documento é a de sempre: id, name, sync, e só então o conteúdo', async () => {
        const { getEmptyMapData: conteudo } = await import('../../src/js/store/repository.utils.js');
        const { getEmptyMapData: documento } = await import('../../src/js/store/repositories/local.repository.js');
        expect(Object.keys(documento())).toEqual(['id', 'name', 'sync', ...Object.keys(conteudo())]);
    });

    it('PISO: o conteúdo vazio não é vazio de verdade (o teste acima compararia dois nadas)', async () => {
        const { getEmptyMapData: conteudo } = await import('../../src/js/store/repository.utils.js');
        const c = conteudo();
        expect(c.baseLayer).toBe('carta-topografica');
        expect(Object.keys(c.features).length).toBeGreaterThan(15);
    });

    it('cada chamada devolve um objeto NOVO, em profundidade (o documento é mutado por quem o recebe)', async () => {
        const { getEmptyMapData: documento } = await import('../../src/js/store/repositories/local.repository.js');
        const a = documento();
        const b = documento();
        expect(a).not.toBe(b);
        expect(a.features).not.toBe(b.features);
        expect(a.features.points).not.toBe(b.features.points);
        a.features.points.push({ id: 'x' });
        expect(b.features.points).toEqual([]);
    });

    it('FORMA: a cópia do repositório não volta a escrever o conteúdo à mão', () => {
        const texto = readFileSync(path.join(RAIZ, 'src/js/store/repositories/local.repository.js'), 'utf8')
            .replace(/\r\n/g, '\n');
        const inicio = texto.indexOf('export function getEmptyMapData() {');
        expect(inicio).toBeGreaterThan(-1);
        const corpo = texto.slice(inicio, texto.indexOf('\n}\n', inicio));
        expect(corpo).toContain('...getEmptyMapContent()');
        // A forma exata do defeito: o mapa base e os baldes escritos de novo aqui dentro.
        expect(corpo).not.toMatch(/baseLayer:|features:\s*\{|polygons:/);
        expect(texto).toMatch(/getEmptyMapData as getEmptyMapContent/);
    });
});
