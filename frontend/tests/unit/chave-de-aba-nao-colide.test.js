// Path: tests/unit/chave-de-aba-nao-colide.test.js
//
// DUAS COISAS COM O MESMO NOME, PELA TERCEIRA VEZ NESTE REPOSITORIO.
//
// O defeito que este arquivo existe para impedir foi medido, nao imaginado. A entrega de um
// arquivo `.ebgeo` entre a tela de atlas e o mapa passou a carregar um carimbo de aba, gravado
// em `sessionStorage` sob `ebgeo_tab_id`. Aquele nome ja tinha dono: `operation-factory.js` o
// usa desde muito antes para o SUFIXO POR ABA do `clientId` de sync.
//
// A colisao so aparece numa navegacao especifica, e e isso que a torna cara: `atlas.html` boota
// SEM a store, entao ele nunca carrega `operation-factory.js` e escreve um UUID na chave. O mapa
// carrega o sync, que cunha o proprio sufixo base36 por cima. O consumidor entao le um id
// diferente do que o produtor escreveu, conclui que a entrega e de OUTRA aba e descarta o
// arquivo. Abrir um `.ebgeo` produzia um atlas com UM mapa em vez de onze, sem erro em lugar
// nenhum. Cinco rodadas em serie, cinco vermelhos.
//
// POR QUE UM TESTE DE CHAVE E NAO DE COMPORTAMENTO. O comportamento ja tem dono
// (`tests/e2e-ui/atlas-local-ebgeo-e-teardown.spec.js`), e ele leva minutos e um navegador. Este
// aqui custa milissegundos e responde a pergunta que o proximo autor vai errar: "esta chave esta
// livre?". Os dois sao necessarios, e nenhum substitui o outro.
//
// A VARREDURA E POR TEXTO, sobre os arquivos de `src/`, e nao pela importacao das constantes.
// Importar so alcanca quem EXPORTA: `TAB_STORAGE_KEY` de `operation-factory.js` e privado do
// modulo, e foi exatamente o lado privado que colidiu. Uma varredura que so olhasse o que e
// exportado teria passado verde no dia do defeito.
//
// O QUE ELE NAO PEGA, dito em voz alta: chave montada por concatenacao ou por template
// (`'ebgeo_' + algo`), e chave gravada por biblioteca de terceiro. A direcao do erro e perder um
// sitio, nunca inventar um.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Todo `.js` de `src/`, VERSIONADO OU NAO. As duas bandeiras nao sao detalhe: com `git ls-files`
 * puro o inventario e so o rastreado, e o guarda ficaria cego exatamente onde o trabalho novo
 * aparece, que e o arquivo escrito ha cinco minutos e ainda sem `git add`.
 * @returns {string[]} Caminhos relativos a `frontend/`.
 */
function fontesDeSrc() {
    const saida = execFileSync('git', ['ls-files', '-co', '--exclude-standard', 'src'], {
        cwd: RAIZ, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    });
    return saida.split('\n').map((l) => l.trim()).filter((l) => l.endsWith('.js'));
}

/** Toda string literal `'ebgeo_...'` atribuida a uma constante, por arquivo. */
function chavesPorArquivo() {
    const mapa = new Map();
    for (const rel of fontesDeSrc()) {
        const texto = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
        // `const NOME = 'ebgeo_x'` — declaracao de constante, exportada ou nao.
        for (const m of texto.matchAll(/^\s*(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*=\s*'(ebgeo_[a-z0-9_]+)'/gm)) {
            if (!mapa.has(rel)) mapa.set(rel, []);
            mapa.get(rel).push({ constante: m[1], chave: m[2] });
        }
    }
    return mapa;
}

/**
 * As chaves declaradas em MAIS DE UM arquivo, com quem as declara.
 * @param {Map<string, Array<{constante: string, chave: string}>>} mapa
 * @returns {Array<{chave: string, donos: string[]}>}
 */
function colisoes(mapa) {
    const donosPorChave = new Map();
    for (const [arquivo, lista] of mapa) {
        for (const { constante, chave } of lista) {
            if (!donosPorChave.has(chave)) donosPorChave.set(chave, []);
            donosPorChave.get(chave).push(`${arquivo}:${constante}`);
        }
    }
    return [...donosPorChave.entries()]
        .filter(([, donos]) => donos.length > 1)
        .map(([chave, donos]) => ({ chave, donos: donos.sort() }));
}

// COMPARTILHAMENTO DELIBERADO. Uma chave pode legitimamente ter dois declarantes quando os dois
// falam da MESMA coisa (um produtor e um consumidor que nao podem se importar). Cada caso entra
// aqui com o motivo escrito, e a contagem e cobrada: uma entrada que sobrevive ao codigo que a
// justificava e convencao apodrecendo em silencio.
const COMPARTILHADAS = [];

describe('chave de sessionStorage/localStorage nao tem dois donos', () => {
    it('piso: a varredura alcanca src/ e acha chaves de verdade', () => {
        const fontes = fontesDeSrc();
        expect(fontes.length, 'a varredura de src/ voltou vazia: git falhou ou o padrao quebrou')
            .toBeGreaterThanOrEqual(300);

        const mapa = chavesPorArquivo();
        const total = [...mapa.values()].reduce((n, l) => n + l.length, 0);
        // Sem este piso, um regex quebrado deixaria o caso principal verde sobre zero achados,
        // que e a "cobertura vazia passa verde" que a constituicao nomeia.
        expect(total, 'nenhuma chave `ebgeo_*` encontrada: o padrao quebrou')
            .toBeGreaterThanOrEqual(8);
    });

    it('nenhuma chave `ebgeo_*` e declarada por dois arquivos', () => {
        const achadas = colisoes(chavesPorArquivo());
        const naoDeclaradas = achadas.filter((c) => !COMPARTILHADAS.some((e) => e.chave === c.chave));

        expect(
            naoDeclaradas.map((c) => `${c.chave} <- ${c.donos.join(' + ')}`),
            'duas coisas diferentes gravando a mesma chave. Se o compartilhamento for deliberado, '
            + 'declare-o em COMPARTILHADAS com o motivo; senao, renomeie a mais NOVA das duas',
        ).toEqual([]);

        // A contagem fecha nos dois sentidos: exececao declarada sem colisao correspondente
        // significa que o codigo mudou e a lista nao.
        expect(achadas.length, 'excecao declarada sem colisao no codigo, ou colisao a mais')
            .toBe(COMPARTILHADAS.length);
    });

    it('as duas identidades de aba continuam SEPARADAS, por nome', () => {
        // O caso concreto que originou este arquivo, afirmado de forma ABSOLUTA e nao so por
        // desigualdade: comparar as duas entre si passaria verde se ambas virassem a mesma
        // terceira coisa por um rename descuidado.
        const ns = fs.readFileSync(path.join(RAIZ, 'src/js/store/atlas-namespace.js'), 'utf8');
        const of = fs.readFileSync(path.join(RAIZ, 'src/js/store/sync/operation-factory.js'), 'utf8');

        expect(ns, 'a chave da entrega de .ebgeo mudou de nome').toContain("TAB_ID_KEY = 'ebgeo_handover_tab'");
        expect(of, 'o sufixo por aba do clientId mudou de nome').toContain("TAB_STORAGE_KEY = 'ebgeo_tab_id'");
        expect(ns, 'a entrega de .ebgeo voltou a reivindicar a chave do clientId de sync')
            .not.toContain("TAB_ID_KEY = 'ebgeo_tab_id'");
    });

    it('controle negativo: a deteccao PEGA a colisao quando ela existe', () => {
        // Sem isto, o caso principal e uma lista vazia comparada com outra lista vazia, e passaria
        // identico com o regex quebrado.
        const forjado = new Map([
            ['a.js', [{ constante: 'X', chave: 'ebgeo_tab_id' }]],
            ['b.js', [{ constante: 'Y', chave: 'ebgeo_tab_id' }]],
            ['c.js', [{ constante: 'Z', chave: 'ebgeo_outra' }]],
        ]);
        const achadas = colisoes(forjado);
        expect(achadas).toHaveLength(1);
        expect(achadas[0].chave).toBe('ebgeo_tab_id');
        expect(achadas[0].donos).toEqual(['a.js:X', 'b.js:Y']);
    });
});
