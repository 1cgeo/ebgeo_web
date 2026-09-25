// Path: e2e-ui/cobertura-desenho-forma.spec.js

/**
 * @fileoverview COBERTURA: editar a FORMA de cada ferramenta de desenho pelas alças, entre dois
 * usuários num atlas de servidor, e depois do F5 nos dois (campanha de 2026-09-24).
 *
 * Para cada ferramenta com fonte de alças (`alca` em `FERRAMENTAS`), A desenha com a ferramenta real,
 * seleciona e, para CADA TIPO de alça que a ferramenta desenha (vértice, ponto médio, largura, altura,
 * rotação, raio, abertura, cabeça da seta...), arrasta uma alça daquele tipo com o ponteiro real e mede:
 *
 *  - que o arraste mudou a feição no store de A (uma alça desenhada que não edita nada REPROVA);
 *  - que o servidor e o store de B chegam IGUAIS ao de A (propriedades e geometria).
 *
 * Nas ferramentas de vértice, arrastar o ponto médio INSERE um vértice; depois o botão direito sobre
 * um vértice o REMOVE, e as duas contagens são afirmadas. Nas quatro que continuam pela ponta (linha,
 * seta, limite, linha de coordenação), a alça de ponta final abre o modo, um clique novo e o botão
 * direito concluem, e a MESMA feição ganha um vértice. No fim, F5 nos dois e as três cópias iguais.
 *
 * O arraste traz a alça para a parte do mapa que o painel da feição não cobre
 * (`trazerParaAreaLivre`): selecionar abre o painel, e ele cobre a faixa esquerda. E cada seleção pela
 * árvore devolve a câmera do desenho (`vistaDoDesenho`), porque a árvore enquadra a feição e o quadro
 * deixa alças fora da vista.
 */

import { collabTest, expect, selectFeatureUI } from './helpers/collab.fixtures.js';
import { clicarNoMapaUI } from './helpers/collab-helpers.js';
import { FERRAMENTAS, desenhar, feicaoNoStore, idsDoBalde, semEscrituracao } from './helpers/cobertura-desenho.js';
import { trazerParaAreaLivre } from './helpers/cobertura-desenho-ciclo.js';
import {
    esperarAlcas, alcasNaTela, alcaDoTipo, arrastarAlca, botaoDireitoNaAlca, verticesDaFeicao, pontaFinal, vistaDoDesenho,
} from './helpers/cobertura-desenho-forma.js';

collabTest.describe.configure({ retries: 0 });

/** As ferramentas que continuam pela alça de ponta (`EXTENDABLE_SOURCES`, `line-extension.model.js`). */
const CONTINUAM = new Set(['line', 'arrow', 'boundary', 'coordinationLine']);

async function linha(collab, id) {
    const row = await collab.db.queryFeatureRow(id);
    return row && !row.deleted_at ? { properties: semEscrituracao(row.properties), geometry: row.geometry } : null;
}

async function noCliente(page, balde, id) {
    const f = await feicaoNoStore(page, balde, id);
    return f ? { properties: semEscrituracao(f.properties), geometry: f.geometry } : null;
}

async function convergem(collab, A, B, balde, id, passo) {
    const esperado = await noCliente(A, balde, id);
    await expect.poll(() => linha(collab, id), { timeout: 30000, message: `${passo}: o servidor diverge de A` }).toEqual(esperado);
    await expect.poll(() => noCliente(B, balde, id), { timeout: 30000, message: `${passo}: B diverge de A` }).toEqual(esperado);
}

/**
 * Seleciona pela árvore e devolve a câmera do desenho, porque a árvore ENQUADRA a feição e o quadro
 * deixa alças fora da vista (`vistaDoDesenho`).
 */
async function selecionar(page, ferramenta, id) {
    await selectFeatureUI(page, id);
    await vistaDoDesenho(page, ferramenta.alca, id);
}

/** Seleciona a feição e devolve as alças dela, re-selecionando se a seleção caiu. */
async function alcasSelecionadas(page, ferramenta, id) {
    let alcas = await alcasNaTela(page, ferramenta.alca, id);
    if (alcas.length === 0) {
        await selecionar(page, ferramenta, id);
        alcas = await esperarAlcas(page, ferramenta.alca, id);
    }
    return alcas;
}

for (const ferramenta of FERRAMENTAS.filter((f) => f.alca)) {
    collabTest(`forma de ${ferramenta.id}: cada alca edita, chega ao par e ao servidor, e sobrevive ao F5`, async ({ collab }, testInfo) => {
        collabTest.setTimeout(480000);
        const A = collab.author;
        const B = collab.peers[0];
        const { balde } = ferramenta;
        const passo = (n) => `${ferramenta.id} / ${n}`;

        const id = await desenhar(A, ferramenta);
        await convergem(collab, A, B, balde, id, passo('desenhar'));

        await selecionar(A, ferramenta, id);
        const tipos = [...new Set((await esperarAlcas(A, ferramenta.alca, id)).map((a) => a.tipo))].sort();
        const tabela = [];
        for (const tipo of tipos) {
            await alcasSelecionadas(A, ferramenta, id);
            const alca = await alcaDoTipo(A, ferramenta.alca, id, tipo);
            if (!alca) { tabela.push({ tipo, efeito: 'sumiu' }); continue; }
            const vAntes = await verticesDaFeicao(A, balde, id);
            const mudou = await arrastarAlca(A, balde, id, alca);
            const vDepois = await verticesDaFeicao(A, balde, id);
            tabela.push({ tipo, efeito: mudou ? `editou (vertices ${vAntes} -> ${vDepois})` : 'NADA' });
            if (mudou) await convergem(collab, A, B, balde, id, passo(`alca ${tipo}`));
            if (tipo === 'midpoint' && mudou) {
                expect(vDepois, passo('arrastar o ponto medio insere um vertice')).toBe(vAntes + 1);
            }
        }

        // Remover um vértice pelo botão direito, nas ferramentas de vértice.
        if (tipos.includes('vertex') && tipos.includes('midpoint')) {
            const vertices = (await alcasSelecionadas(A, ferramenta, id)).filter((a) => a.tipo === 'vertex');
            const alvo = vertices.find((a) => a.indice === 1) ?? vertices[1] ?? vertices[0];
            const vAntes = await verticesDaFeicao(A, balde, id);
            const mudou = await botaoDireitoNaAlca(A, balde, id, alvo);
            const vDepois = await verticesDaFeicao(A, balde, id);
            tabela.push({ tipo: 'remover vertice (botao direito)', efeito: mudou ? `vertices ${vAntes} -> ${vDepois}` : 'NADA' });
            expect(mudou, passo('o botao direito no vertice nao removeu nada')).toBe(true);
            expect(vDepois).toBe(vAntes - 1);
            await convergem(collab, A, B, balde, id, passo('remover vertice'));
        }

        // Continuar pela ponta final.
        if (CONTINUAM.has(ferramenta.id)) {
            await alcasSelecionadas(A, ferramenta, id);
            const idsAntes = (await idsDoBalde(A, balde)).sort();
            const vAntes = await verticesDaFeicao(A, balde, id);
            await trazerParaAreaLivre(A, await pontaFinal(A, balde, id));
            await expect(A.locator('.line-extension-handle--end')).toHaveCount(1, { timeout: 10000 });
            await A.locator('.line-extension-handle--end').dispatchEvent('click');
            await expect(A.locator('.toast', { hasText: /continuar/i })).toBeVisible({ timeout: 8000 });
            const novo = await A.evaluate((ll) => {
                const map = globalThis.__ebgeoMap;
                const p = map.project(ll);
                const c = map.unproject([p.x + 70, p.y + 45]);
                return [c.lng, c.lat];
            }, await pontaFinal(A, balde, id));
            await clicarNoMapaUI(A, novo);
            await A.waitForTimeout(300);
            await clicarNoMapaUI(A, novo, { button: 'right' });
            await expect.poll(() => verticesDaFeicao(A, balde, id), { timeout: 15000, message: passo('a continuacao nao acrescentou vertice') })
                .toBe(vAntes + 1);
            expect((await idsDoBalde(A, balde)).sort(), passo('continuar criou feicao nova')).toEqual(idsAntes);
            tabela.push({ tipo: 'continuar pela ponta', efeito: `vertices ${vAntes} -> ${vAntes + 1}` });
            await convergem(collab, A, B, balde, id, passo('continuar pela ponta'));
        }

        const resumo = tabela.map((l) => `${l.tipo} -> ${l.efeito}`).join('\n');
        console.log(`[cobertura-forma] ${ferramenta.id}\n${resumo}`);
        testInfo.annotations.push({ type: 'alcas', description: resumo });
        expect(tabela.filter((l) => l.efeito === 'NADA' || l.efeito === 'sumiu').map((l) => l.tipo),
            passo('alcas desenhadas que nao editam nada')).toEqual([]);

        await A.reload();
        await B.reload();
        const servidor = await linha(collab, id);
        for (const [quem, page] of [['A', A], ['B', B]]) {
            await expect.poll(() => noCliente(page, balde, id), { timeout: 30000, message: passo(`F5: ${quem} diverge do servidor`) })
                .toEqual(servidor);
        }
    });
}
