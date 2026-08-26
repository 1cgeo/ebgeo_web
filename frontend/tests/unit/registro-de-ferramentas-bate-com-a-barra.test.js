// Path: tests/unit/registro-de-ferramentas-bate-com-a-barra.test.js

/**
 * @fileoverview A TABELA DE `tool-registry.js` E UMA COPIA, e toda copia precisa de um credor.
 *
 * A onda de carga tardia trocou tres leituras de RUNTIME por tres colunas de tabela, e cada troca
 * comprou velocidade com risco de divergencia:
 *
 *   1. `tipoDeUi` substituiu `control.constructor.name`. O ganho e real (o botao sabe se acender
 *      antes de a ferramenta existir, e o tipo deixa de depender de `keepNames: true` no build),
 *      mas quem GRAVA `activeTool.type` continua sendo `ToolManager._inferToolType`, derivando do
 *      nome da classe. Se as duas contas divergirem, o botao simplesmente nunca acende: nenhum
 *      erro, nenhum log, so um botao que nao pinta. Este arquivo refaz a conta do ToolManager
 *      sobre o nome de classe da tabela e exige o mesmo resultado.
 *
 *   2. `classe` e um NOME EM STRING. Renomear a classe do controle sem tocar a tabela quebraria
 *      `ensureControl` (o modulo nao exporta aquele nome) e o registro global. O caso abaixo le a
 *      FONTE do modulo de cada ferramenta e cobra que a classe daquele nome exista la.
 *
 *   3. A tabela e a barra sao duas listas do mesmo conjunto. `toolbar.constants.js` descreve os
 *      botoes por `controlKey`; um botao cujo `controlKey` nao tenha linha na tabela e um botao
 *      que nao faz nada ao ser clicado.
 *
 * NENHUM CASO AQUI CARREGA UMA FERRAMENTA. Eles leem a tabela e o texto dos modulos. Um teste que
 * instanciasse os vinte e dois controles para conferir o nome da classe seria a propria carga
 * ansiosa que esta onda tirou do boot, so que dentro da suite.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FERRAMENTAS, controlType, peekControl } from '@tools/tool-registry.js';
import { TOOL_GROUPS, STANDALONE_TOOLS } from '@toolbar/toolbar.constants.js';

const DIR_REGISTRO = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/js/tool_manager');

/**
 * A conta que `ToolManager._inferToolType` faz quando o controle nao declara `type` proprio.
 * Copiada de proposito: e o gemeo que esta tabela tem de bater.
 * @param {string} nomeDaClasse
 * @returns {string}
 */
function tipoDerivadoDoNome(nomeDaClasse) {
    return nomeDaClasse.replace('Add', '').replace('Control', '').toLowerCase();
}

/** Todo `controlKey` que a barra usa, de grupo ou solto. */
const CHAVES_DA_BARRA = [
    ...Object.values(TOOL_GROUPS).flatMap(g => g.tools.map(t => t.controlKey)),
    ...STANDALONE_TOOLS.map(t => t.controlKey)
].filter(Boolean);

/**
 * O caminho de arquivo que o `import()` de uma entrada aponta, extraido do proprio fonte da
 * tabela. Ler o especificador do texto e o unico jeito de conferi-lo sem executar a carga.
 * @returns {Map<string, string>} chave -> caminho absoluto do modulo
 */
function especificadoresDaTabela() {
    const fonte = readFileSync(resolve(DIR_REGISTRO, 'tool-registry.js'), 'utf8');
    const mapa = new Map();
    // Casa `chave: {` ... `carregar: () => import('...')` dentro do mesmo bloco de entrada.
    const re = /(\w+):\s*\{[^{}]*?carregar:\s*\(\)\s*=>\s*import\('([^']+)'\)/gs;
    let achado;
    while ((achado = re.exec(fonte)) !== null) {
        mapa.set(achado[1], resolve(DIR_REGISTRO, achado[2]));
    }
    return mapa;
}

describe('o registro de ferramentas e a barra descrevem o MESMO conjunto', () => {
    it('todo botao da barra tem linha na tabela', () => {
        const semLinha = CHAVES_DA_BARRA.filter(chave => !FERRAMENTAS[chave]);
        expect(semLinha, 'botao da barra sem entrada em FERRAMENTAS: clicar nele nao faz nada')
            .toEqual([]);
    });

    it('toda linha da tabela tem botao na barra', () => {
        // Anti-tapete: uma linha orfa e peso de manutencao que ninguem exercita.
        const semBotao = Object.keys(FERRAMENTAS).filter(chave => !CHAVES_DA_BARRA.includes(chave));
        expect(semBotao, 'entrada em FERRAMENTAS que nenhum botao usa').toEqual([]);
    });

    it('FLOOR: a barra tem ferramentas, e a tabela tambem', () => {
        // Sem o piso, uma constante de barra vazia faria as duas propriedades acima passarem
        // sobre conjuntos vazios e reportarem acordo perfeito.
        expect(CHAVES_DA_BARRA.length).toBeGreaterThanOrEqual(20);
        expect(Object.keys(FERRAMENTAS).length).toBe(CHAVES_DA_BARRA.length);
    });
});

describe('o tipo da tabela bate com o que o ToolManager grava', () => {
    for (const [chave, ferramenta] of Object.entries(FERRAMENTAS)) {
        it(`${chave}: tipoDeUi condiz com a classe ${ferramenta.classe}`, () => {
            if (chave === 'azimuthDistanceControl') {
                // A UNICA excecao, e ela e do produto: `AddAzimuthDistanceControl` declara
                // `type = 'azimuth_distance'` na classe, e `_inferToolType` prefere o `type`
                // proprio ao nome. A tabela repete o valor DELE.
                expect(ferramenta.tipoDeUi).toBe('azimuth_distance');
                return;
            }
            expect(ferramenta.tipoDeUi).toBe(tipoDerivadoDoNome(ferramenta.classe));
        });
    }

    it('a conta derivada nao e vacua: ela distingue os casos que ja confundiram', () => {
        // CONTROLE POSITIVO da funcao acima. Se ela devolvesse sempre a mesma coisa, todo caso
        // do laco passaria. Os tres nomes abaixo exercitam as tres formas: prefixo `Add`,
        // sigla em maiuscula, e classe sem prefixo nenhum.
        expect(tipoDerivadoDoNome('AddMilitarySymbolControl')).toBe('militarysymbol');
        expect(tipoDerivadoDoNome('AddLOSControl')).toBe('los');
        expect(tipoDerivadoDoNome('MeasurementDistanceControl')).toBe('measurementdistance');
    });
});

describe('cada linha aponta para um modulo que existe e exporta a classe que ela nomeia', () => {
    const especificadores = especificadoresDaTabela();

    it('FLOOR: os especificadores foram extraidos da tabela', () => {
        // Se a regex parasse de casar, o laco abaixo rodaria sobre zero entradas e o arquivo
        // inteiro passaria verde sem conferir nada.
        expect(especificadores.size).toBe(Object.keys(FERRAMENTAS).length);
    });

    for (const [chave, ferramenta] of Object.entries(FERRAMENTAS)) {
        it(`${chave}: o modulo existe e declara ${ferramenta.classe}`, () => {
            const caminho = especificadores.get(chave);
            expect(caminho, `sem especificador de import para ${chave}`).toBeTruthy();
            expect(existsSync(caminho), `modulo inexistente: ${caminho}`).toBe(true);

            const fonte = readFileSync(caminho, 'utf8');
            const declara = new RegExp(`class\\s+${ferramenta.classe}\\b`).test(fonte);
            expect(declara, `${caminho} nao declara a classe ${ferramenta.classe}`).toBe(true);
        });
    }
});

describe('as leituras sincronas nao carregam nada', () => {
    it('controlType responde sem instancia', () => {
        expect(controlType('militarySymbolControl')).toBe('militarysymbol');
        expect(controlType('naoExiste')).toBeNull();
    });

    it('peekControl devolve null enquanto a ferramenta nao veio', () => {
        expect(peekControl('militarySymbolControl')).toBeNull();
    });
});
