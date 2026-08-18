// Path: tests/unit/cache-projetos-consumidores.test.js
//
// O CENSO DE QUEM LÊ O CACHE DE PROJETOS 360, e por que ele existe.
//
// Desde a F9 o cache de `streetview-api.service.js` é CHAVEADO POR ESCOPO DE ACESSO: a lista
// pertence ao par (quem pergunta, qual atlas está em foco), e um login, uma troca de atlas ou um
// logout a invalidam. Isso fecha o vazamento (o projeto emprestado por um atlas não pode vazar
// para fora dele), mas cria um segundo modo de falha, silencioso na direção oposta: quem lê
// `getCachedProjects()` e trata o MISS como "não existe 360" passa a mostrar uma tela VAZIA a cada
// troca de escopo. Foi exatamente o que aconteceu com três consumidores na primeira versão desta
// mudança — o catálogo, o validador de briefing e a aba de restrição do atlas — e nenhuma suíte
// ficou vermelha, porque lista vazia é uma resposta bem-formada.
//
// A VARREDURA VEM DO VERSIONAMENTO (`git ls-files`), nunca de uma lista escrita à mão: conferir um
// subconjunto e tratá-lo como o conjunto é a lição mais repetida do livro-razão. Todo arquivo de
// `src/js/` que mencione `getCachedProjects(` ou `fetchProjects(` precisa de entrada aqui.
//
// O QUE ESTE ARQUIVO NÃO PRENDE: comportamento. Que o miss realmente busque a lista do escopo novo
// é `cache-projetos-escopo.test.js`. Aqui se prende EXISTÊNCIA e CLASSE — consumidor novo reprova
// até ser classificado, e consumidor que perde o refetch reprova nomeando o arquivo.
//
// FRAGILIDADE ACEITA: a varredura precisa de `git`; se o comando falhar, o caso de piso diz isso
// nessas palavras, porque falha de ambiente lida como regressão custa mais do que o guarda salva.

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const URL_JS = new URL('../../src/js/', import.meta.url);
const DIR_JS = fileURLToPath(URL_JS);

/** O par de nomes que define a varredura. */
const GATILHO = /getCachedProjects\(|fetchProjects\(/;

/** O miss precisa BUSCAR: `getCachedProjects() ?? await fetchProjects()` (ou com `||`). */
const MISS_BUSCA = /getCachedProjects\(\)\s*(\?\?|\|\|)\s*await\s+fetchProjects\(/;

/**
 * @typedef {Object} Entrada
 * @property {string} arquivo - Caminho relativo a `src/js/`.
 * @property {'DONO'|'MISS-BUSCA'|'MISS-NULO'|'OUTRO-MODULO'} classe
 * @property {string} motivo
 */

/** @type {Entrada[]} */
const CENSO = [
    {
        arquivo: 'street_view_tool/streetview-api.service.js', classe: 'DONO',
        motivo: 'Dono do cache e da guarda de escopo (`adoptCurrentScope`). É ele que transforma carimbo divergente em miss, e é por isso que nenhum outro arquivo precisa saber que escopo existe.',
    },
    {
        arquivo: 'search/search-bar.search-providers.js', classe: 'MISS-BUSCA',
        motivo: 'A busca por panorama. Já era assim antes da F9, e é o modelo que os outros três passaram a seguir.',
    },
    {
        arquivo: 'catalog/catalog.service.js', classe: 'MISS-BUSCA',
        motivo: 'A seção 360 do catálogo. O JSDoc dizia "never makes a network request"; com o cache por escopo isso virava catálogo vazio a cada troca de atlas.',
    },
    {
        arquivo: 'briefing/validation/reference-validator.js', classe: 'MISS-BUSCA',
        motivo: 'O conjunto de fotos que existem, usado para validar referência de slide. Miss lido como vazio marcaria TODA referência 360 do briefing como quebrada.',
    },
    {
        arquivo: 'modals/atlas-settings.modal.js', classe: 'MISS-BUSCA',
        motivo: 'A aba de restrição do atlas. Ela abre depois de entrar no atlas, ou seja, quase sempre depois de uma troca de escopo: miss vazio deixaria o Gestor sem nada para restringir.',
    },
    {
        arquivo: 'street_view_tool/streetview_markers.js', classe: 'MISS-NULO',
        motivo: 'A camada de marcadores 2D. `loadMarkers` chama `fetchProjects()` direto (e portanto rebusca no escopo novo); a única leitura do cache é `_resolveMarkerFromAPI`, que já É o caminho de emergência de quando a fonte GeoJSON não responde, e devolver null ali é a degradação certa.',
    },
    {
        arquivo: 'calibration/api.js', classe: 'OUTRO-MODULO',
        motivo: 'HOMÔNIMO, não consumidor: a página de calibração tem cliente próprio, sem cache nenhum, e não importa o serviço do 360. Está no censo justamente para que a colisão de nome fique declarada em vez de descoberta.',
    },
    {
        arquivo: 'calibration/app.js', classe: 'OUTRO-MODULO',
        motivo: 'Chama o `fetchProjects` da linha acima, o da calibração.',
    },
];

/** Remove comentários de linha e de bloco (a varredura mede código, não prosa). */
function semComentarios(texto) {
    return texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Os arquivos versionados de `src/js/` que tocam o par de nomes. */
function varrer() {
    const saida = execSync('git ls-files "*.js"', { cwd: DIR_JS, encoding: 'utf8' });
    const arquivos = saida.split('\n').map((l) => l.trim().replace(/\\/g, '/')).filter(Boolean);
    return arquivos.filter((rel) => {
        const texto = semComentarios(readFileSync(new URL(rel, URL_JS), 'utf8'));
        return GATILHO.test(texto);
    }).sort();
}

const VARRIDOS = varrer();
const porArquivo = new Map(CENSO.map((e) => [e.arquivo, e]));
const textoDe = (rel) => semComentarios(readFileSync(new URL(rel, URL_JS), 'utf8'));

describe('censo dos consumidores do cache de projetos 360', () => {
    it('a varredura encontra alguma coisa (piso: git vivo e padrão que casa)', () => {
        // Cobertura vazia passa verde: sem este piso, um `git ls-files` que falhasse ou um
        // padrão que deixasse de casar deixariam o censo inteiro trivialmente satisfeito.
        expect(VARRIDOS.length, 'a varredura não achou arquivo nenhum — git falhou ou o padrão parou de casar')
            .toBeGreaterThanOrEqual(6);
    });

    it('todo arquivo que toca o cache está classificado', () => {
        const naoDeclarados = VARRIDOS.filter((rel) => !porArquivo.has(rel));
        expect(naoDeclarados, 'consumidor novo do cache de projetos 360: classifique-o no censo. '
            + 'Se ele lê `getCachedProjects()`, decida o que fazer no MISS — o cache é por escopo de '
            + 'acesso, e miss lido como "não há 360" esvazia a tela a cada troca de atlas').toEqual([]);
    });

    it('o censo não guarda entrada morta', () => {
        const fantasmas = CENSO.map((e) => e.arquivo).filter((rel) => !VARRIDOS.includes(rel));
        expect(fantasmas, 'entrada de censo sem arquivo correspondente na varredura').toEqual([]);
    });

    it('todo consumidor MISS-BUSCA rebusca no miss, e não devolve vazio', () => {
        const semFallback = CENSO
            .filter((e) => e.classe === 'MISS-BUSCA')
            .filter((e) => !MISS_BUSCA.test(textoDe(e.arquivo)))
            .map((e) => e.arquivo);
        expect(semFallback, 'declarado MISS-BUSCA e sem `getCachedProjects() ?? await fetchProjects()`')
            .toEqual([]);
    });

    it('os homônimos da calibração não falam com o serviço do 360', () => {
        // Discriminação: sem isto, "OUTRO-MODULO" viraria a gaveta onde se joga o que não se
        // quis classificar, e um consumidor de verdade entraria por ali.
        for (const e of CENSO.filter((x) => x.classe === 'OUTRO-MODULO')) {
            expect(textoDe(e.arquivo), `${e.arquivo} importa o serviço do 360: não é homônimo`)
                .not.toMatch(/streetview-api\.service/);
        }
    });

    it('o dono do cache é quem carrega a guarda de escopo', () => {
        const dono = CENSO.filter((e) => e.classe === 'DONO');
        expect(dono).toHaveLength(1);
        const texto = textoDe(dono[0].arquivo);
        expect(texto).toMatch(/currentResourceScope/);
        expect(texto).toMatch(/adoptCurrentScope\(\)/);
    });

    it('toda entrada diz por quê', () => {
        for (const e of CENSO) {
            expect(e.motivo.length, `${e.arquivo} sem motivo`).toBeGreaterThan(40);
        }
    });
});
