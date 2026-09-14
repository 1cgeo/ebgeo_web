// Path: tests/unit/mapa-declara-base-censo.test.js

/**
 * @fileoverview O MAPA ERA A ÚNICA ENTIDADE APLICADA POR ORDEM DE CHEGADA, e este censo é o que
 * impede que ele volte a ser (B5, item 2).
 *
 * O MECANISMO, em uma frase: uma operação declara a revisão que observou carregando
 * `confirmedVersion` dentro do `previousData` (`entityMutationContract`,
 * `src/js/store/sync/mutation-contract.js`), e é ESSA declaração que liga a verificação por base no
 * servidor (`hasDeclaredBase`, `backend/src/modules/sync/entity-conflicts.js`). Toda outra entidade
 * ganha isso de graça, porque a store entrega como `previousData` o documento que acabou de ler. O
 * mapa não: os sítios de escrita dele registram o CAMPO que mudaram (`{name: oldName}`,
 * `{locked: false}`, a posição anterior, as notas anteriores), e um fragmento de mapa não carrega
 * revisão nenhuma.
 *
 * POR QUE UM CENSO E NÃO SÓ CASOS DE COMPORTAMENTO. Os casos de comportamento vivem em
 * `tests/store/map-operations.test.js` e medem que a declaração CHEGA no envelope; eles são cegos
 * para o sítio que alguém escrever depois. Um sítio novo de escrita de mapa que esqueça a
 * declaração não quebra nada, não emite erro e não fica vermelho em lugar nenhum: ele apenas volta
 * aquela edição para LWW por chegada, em silêncio, que é a classe de defeito que este bloco inteiro
 * existe para fechar. O inventário vem de `git ls-files`, nunca de uma lista escrita à mão, para
 * que o arquivo novo entre na varredura sozinho.
 *
 * O QUE ELE NÃO PROVA: que a revisão lida esteja CERTA. Ele prova que o sítio a busca. Que ela
 * valha alguma coisa depende de o documento do mapa carregar `confirmedVersion`, o que é assunto de
 * `confirmed-version.js` e do carimbo do snapshot e do recibo.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Os seis tipos de entidade do cliente que o servidor resolve para o alvo `map`. */
const FAMILIA_DO_MAPA = ['MAP', 'MAP_POSITION', 'BASE_LAYER', 'MAP_NOTES', 'GRID_STYLE', 'MAP_TEMPORAL'];

/**
 * Como cada sítio declara a revisão observada.
 * - `documento`: o `previousData` JÁ é o documento do mapa, que a carrega por si.
 * - `daMemoria`: o sítio tem o documento em mãos e usa `mapRevisionOf`, sem custo de leitura.
 * - `doDisco`: o sítio não tem o documento e paga uma leitura, por `readMapRevision`.
 * - `criacao`: um create não observa revisão nenhuma, então não declara e não deve declarar.
 */
const DOCUMENTO = 'documento';
const DA_MEMORIA = 'daMemoria';
const DO_DISCO = 'doDisco';
const CRIACAO = 'criacao';

/**
 * Um registro por SÍTIO de escrita, na ordem em que aparecem no arquivo. A ordem importa porque é
 * ela que casa o registro com a ocorrência, e é o que torna o censo capaz de acusar um sítio novo
 * em vez de só contar o total.
 */
const CENSO = [
    // map.operations.js
    { arquivo: 'src/js/store/map.operations.js', tipo: 'MAP', como: CRIACAO, sitio: 'addMap' },
    { arquivo: 'src/js/store/map.operations.js', tipo: 'MAP_NOTES', como: CRIACAO, sitio: 'addMap (notas iniciais)' },
    { arquivo: 'src/js/store/map.operations.js', tipo: 'MAP', como: DOCUMENTO, sitio: 'removeMap' },
    { arquivo: 'src/js/store/map.operations.js', tipo: 'MAP', como: DO_DISCO, sitio: 'renameMap' },
    { arquivo: 'src/js/store/map.operations.js', tipo: 'BASE_LAYER', como: DA_MEMORIA, sitio: 'setBaseLayer' },
    { arquivo: 'src/js/store/map.operations.js', tipo: 'MAP_POSITION', como: DA_MEMORIA, sitio: 'updateMapPosition' },
    { arquivo: 'src/js/store/map.operations.js', tipo: 'MAP_POSITION', como: DA_MEMORIA, sitio: 'clearMapPosition' },
    { arquivo: 'src/js/store/map.operations.js', tipo: 'MAP', como: DO_DISCO, sitio: 'toggleMapLock' },
    // settings.operations.js
    { arquivo: 'src/js/store/settings.operations.js', tipo: 'MAP_NOTES', como: DO_DISCO, sitio: 'setMapNotes' },
    { arquivo: 'src/js/store/settings.operations.js', tipo: 'GRID_STYLE', como: DO_DISCO, sitio: 'setGridStyle' },
    // temporal.operations.js
    { arquivo: 'src/js/store/temporal.operations.js', tipo: 'MAP_TEMPORAL', como: DO_DISCO, sitio: 'setMapTemporalConfig' },
];

/** Todo `.js` de `src/js/`, pelo git, para que arquivo novo entre sozinho. */
function arquivosDoInventario() {
    return execFileSync('git', ['ls-files', 'src/js'], { cwd: RAIZ, encoding: 'utf8' })
        .split('\n')
        .map((linha) => linha.trim())
        .filter((linha) => linha.endsWith('.js'));
}

/**
 * Cada chamada de `tx.recordOperation` cujo tipo de entidade seja da família do mapa, com a REGIÃO
 * de código que pertence àquele sítio.
 *
 * A REGIÃO VAI DO FIM DO SÍTIO ANTERIOR ATÉ O `);` DESTE, e não uma janela de N linhas, porque a
 * declaração nem sempre mora dentro dos parênteses: em `updateMapPosition` e em `clearMapPosition`
 * o `previousData` é montado umas dezenas de linhas antes e só então entregue. Uma janela fixa ou
 * acertaria por sorte ou emprestaria a declaração do sítio vizinho, que é um verde falso; a
 * fronteira no sítio anterior é exata e não tem número mágico para envelhecer.
 *
 * @param {string} arquivo - Caminho relativo à raiz do pacote.
 * @returns {Array<{arquivo: string, tipo: string, texto: string, linha: number}>}
 */
function sitiosDoMapa(arquivo) {
    const fonte = readFileSync(path.join(RAIZ, arquivo), 'utf8');
    const re = new RegExp(String.raw`tx\.recordOperation\(\s*EntityType\.(${FAMILIA_DO_MAPA.join('|')})\b`, 'g');
    const achados = [];
    let inicioDaRegiao = 0;
    let m;
    while ((m = re.exec(fonte)) !== null) {
        const fim = fonte.indexOf(');', m.index);
        const limite = fim === -1 ? fonte.length : fim;
        achados.push({
            arquivo,
            tipo: m[1],
            texto: fonte.slice(inicioDaRegiao, limite),
            linha: fonte.slice(0, m.index).split('\n').length,
        });
        inicioDaRegiao = limite;
    }
    return achados;
}

/** Todos os sítios da árvore, na ordem de arquivo e depois de posição. */
function todosOsSitios() {
    return arquivosDoInventario().flatMap(sitiosDoMapa);
}

describe('Censo: todo sítio de escrita de MAPA declara a revisão que observou', () => {
    it('piso: o inventário vem do git e alcança os três donos de escrita de mapa', () => {
        const arquivos = arquivosDoInventario();
        expect(arquivos.length).toBeGreaterThanOrEqual(300);
        for (const alvo of [
            'src/js/store/map.operations.js',
            'src/js/store/settings.operations.js',
            'src/js/store/temporal.operations.js',
        ]) {
            expect(arquivos, `o inventário precisa alcançar ${alvo}`).toContain(alvo);
        }
        // Sem este piso, uma regex que deixasse de casar devolveria zero sítios e o caso seguinte
        // ficaria verde sem ter olhado nada, que é a cobertura vazia da constituição.
        expect(todosOsSitios().length).toBe(CENSO.length);
    });

    it('cada sítio está no censo, com o mesmo tipo de entidade e na mesma ordem', () => {
        const encontrados = todosOsSitios().map((s) => `${s.arquivo}\t${s.tipo}`);
        const esperados = CENSO.map((e) => `${e.arquivo}\t${e.tipo}`);
        expect(encontrados).toEqual(esperados);
    });

    it('todo sítio que NÃO é criação busca a revisão, e a criação NÃO a busca', () => {
        const sitios = todosOsSitios();
        const semDeclaracao = [];
        const declaramSemPrecisar = [];

        sitios.forEach((sitio, i) => {
            const entrada = CENSO[i];
            const daMemoria = sitio.texto.includes('mapRevisionOf(');
            const doDisco = sitio.texto.includes('readMapRevision(');

            if (entrada.como === CRIACAO) {
                if (daMemoria || doDisco) {
                    declaramSemPrecisar.push(`${entrada.arquivo}:${sitio.linha} (${entrada.sitio})`);
                }
                return;
            }
            if (entrada.como === DOCUMENTO) return;
            const declara = entrada.como === DA_MEMORIA ? daMemoria : doDisco;
            if (!declara) semDeclaracao.push(`${entrada.arquivo}:${sitio.linha} (${entrada.sitio})`);
        });

        expect(semDeclaracao, 'sítio de escrita de mapa sem revisão observada: aquela edição volta '
            + 'a ser aplicada por ordem de chegada, sem erro em lugar nenhum').toEqual([]);
        expect(declaramSemPrecisar, 'uma criação não observa revisão nenhuma; declarar uma ali '
            + 'convida a lê-la como se houvesse').toEqual([]);
    });

    it('CONTROLE ABSOLUTO: os dois leitores de revisão existem e são os únicos', () => {
        // Sem isto, renomear `mapRevisionOf` deixaria o caso acima verde e mudo (a condição
        // simplesmente pararia de casar), que é o modo de falha da varredura por literal.
        const fonte = readFileSync(path.join(RAIZ, 'src/js/store/map-revision.js'), 'utf8');
        expect(fonte).toMatch(/export function mapRevisionOf\(/);
        expect(fonte).toMatch(/export async function readMapRevision\(/);

        // IMPORTA, não apenas CITA: o cabeçalho de `sync/mutation-contract.js` aponta para este
        // módulo em prosa, e uma varredura por menção o contaria como consumidor.
        const consumidores = arquivosDoInventario().filter((arquivo) => {
            if (arquivo === 'src/js/store/map-revision.js') return false;
            return /from '\.{1,2}\/map-revision\.js'/.test(readFileSync(path.join(RAIZ, arquivo), 'utf8'));
        });
        expect(consumidores.sort()).toEqual([
            'src/js/store/map.operations.js',
            'src/js/store/settings.operations.js',
            'src/js/store/temporal.operations.js',
        ]);
    });
});
