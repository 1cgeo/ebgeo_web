// Path: e2e-ui/cobertura-desenho-abas.spec.js

/**
 * @fileoverview COBERTURA: os campos das abas do painel da feição que o spec de estilo
 * (`cobertura-desenho-estilo.spec.js`) não abre, entre dois usuários num atlas de servidor, e depois
 * do F5 nos dois (campanha de 2026-09-24).
 *
 * O spec de estilo exercita a aba Estilo como ela abre: a sub-aba padrão (Estilo, Marcador ou Texto).
 * Aqui, para cada ferramenta, abrem-se as OUTRAS abas que o painel desenha, descobertas no DOM e não
 * escritas à mão: a Etiqueta das formas e do ponto (`label`, `label-tab.helpers.js`), a Caixa de Fundo
 * do texto (`background`), e as abas Azimutes (observações por perna, `obs-editor`) e Coordenadas.
 * A de Atributos tem spec próprio (`cobertura-desenho-ciclo.spec.js`).
 *
 * Para cada controle visível e habilitado de cada uma, a mesma medida do spec de estilo: mudar só
 * aquele controle, "Salvar", e exigir que alguma propriedade guardada mude e chegue igual ao servidor
 * e ao par. UM CAMPO QUE NÃO GRAVA NADA REPROVA. No fim, F5 nos dois e as três cópias iguais.
 *
 * O instrumento também NOMEIA o que não sabe exercitar (`controlesDesconhecidos`), em todas as abas,
 * inclusive a de estilo padrão: o resumo vai para o console e para as anotações do caso.
 */

import { collabTest, expect, selectFeatureUI, savePanelUI } from './helpers/collab.fixtures.js';
import {
    FERRAMENTAS, desenhar, feicaoNoStore, mudarCampo, chavesMudadas, valorEscolhido,
    controlesDesconhecidos, proximoCampo, chaveDoCampo,
} from './helpers/cobertura-desenho.js';

collabTest.describe.configure({ retries: 0 });

/** Abas que outro spec cobre: a Estilo com a sub-aba padrão (spec de estilo) e Atributos (ciclo). */
const COBERTAS_EM_OUTRO_SPEC = new Set(['estilo', 'style', 'marker', 'text', 'atributos']);

/**
 * Abas de LEITURA: a tabela de vértices e de pernas (`buildAzimutesTabContent` e
 * `buildCoordinatesTabContent`, em `sidebar/panels/feature-panel-content.js`). O formato de coordenadas
 * e o norte magnético delas são LENTES de exibição, estado local da aba que não é propriedade da
 * feição; o único campo que grava é a observação por perna (`perna`, `obs-editor`).
 */
const ABAS_DE_LEITURA = new Set(['azimutes', 'coordenadas']);

const painel = (page) => page.locator('.feature-panel[data-expanded="true"]');

/** As abas do painel aberto, como `{ tipo, id }`: `feature` (painel e sub-aba de etiqueta) ou `modern`. */
async function abasDoPainel(page) {
    return painel(page).evaluate((el) => [
        ...[...el.querySelectorAll('.feature-tab-btn[data-tab-id]')].map((b) => ({ tipo: 'feature', id: b.dataset.tabId })),
        ...[...el.querySelectorAll('.attr-modern-tab[data-tab-id]')].map((b) => ({ tipo: 'modern', id: b.dataset.tabId })),
    ]);
}

/**
 * Abre a aba (clique idempotente) e devolve o locator do conteúdo dela. As sub-abas (Estilo/Etiqueta
 * das formas, Texto/Caixa de Fundo do texto) moram DENTRO da aba Estilo do painel, e o painel reabre na
 * última aba de fora usada: vindo da Azimutes, o botão da sub-aba existe e está escondido (medido no
 * polígono, que esperou os dez minutos do caso por ele). Então a Estilo abre primeiro.
 */
async function abrirAba(page, { tipo, id }) {
    const botao = painel(page).locator(tipo === 'feature' ? `.feature-tab-btn[data-tab-id="${id}"]` : `.attr-modern-tab[data-tab-id="${id}"]`).first();
    if (!(await botao.isVisible())) await painel(page).locator('.feature-tab-btn[data-tab-id="estilo"]').first().click({ timeout: 10000 });
    await botao.click({ timeout: 10000 });
    const conteudo = tipo === 'feature'
        ? painel(page).locator(`.feature-tab-content[data-tab-id="${id}"]`).first()
        : painel(page).locator(`.attr-modern-tab-panel[data-tab-id="${id}"]`).first();
    await expect(conteudo).toBeVisible({ timeout: 10000 });
    return conteudo;
}

async function linhaNoServidor(collab, id) {
    const row = await collab.db.queryFeatureRow(id);
    return row ? { properties: row.properties, geometry: row.geometry } : null;
}

/**
 * O "Salvar" do painel. Ele mora na aba Estilo: numa aba de leitura (a das observações por perna) o
 * botão existe e está escondido, e a pessoa volta à Estilo para salvar, que é o que se faz aqui.
 */
async function salvarSeHouver(page) {
    const botao = painel(page).locator('.attr-modern-btn-save').first();
    if (!(await botao.count())) return;
    if (!(await botao.isVisible())) await painel(page).locator('.feature-tab-btn[data-tab-id="estilo"]').first().click();
    await savePanelUI(page);
}

/**
 * Seleciona pela árvore com o painel FECHADO antes. Com o painel aberto a árvore de camadas pode estar
 * desmontada, e `openLayersTab` então clica "Camadas" numa aba que a barra já dá como ativa, o que a
 * FECHA (medido na linha de coordenação: `.layer-container` nunca apareceu).
 */
async function selecionar(page, id) {
    if (await painel(page).count()) {
        await page.keyboard.press('Escape');
        await expect(painel(page)).toHaveCount(0, { timeout: 5000 }).catch(() => {});
    }
    await selectFeatureUI(page, id);
}

for (const ferramenta of FERRAMENTAS) {
    collabTest(`abas de ${ferramenta.id}: cada campo fora da aba padrao grava, chega ao par e ao servidor, e sobrevive ao F5`, async ({ collab }, testInfo) => {
        collabTest.setTimeout(600000);
        const A = collab.author;
        const B = collab.peers[0];
        const { balde } = ferramenta;

        const id = await desenhar(A, ferramenta);
        await expect.poll(async () => (await linhaNoServidor(collab, id)) !== null, { timeout: 30000 }).toBe(true);
        await expect.poll(async () => (await feicaoNoStore(B, balde, id)) !== null, { timeout: 30000 }).toBe(true);

        await selecionar(A, id);
        const abas = await abasDoPainel(A);
        const tabela = [];
        const desconhecidos = [];
        for (const aba of abas) {
            if (aba.id === 'atributos') continue;
            await selecionar(A, id);
            const conteudo = await abrirAba(A, aba);
            for (const c of await controlesDesconhecidos(A, conteudo)) desconhecidos.push(`${aba.id}: ${c}`);
            if (COBERTAS_EM_OUTRO_SPEC.has(aba.id)) continue;

            const feitos = new Set();
            // A aba é RELIDA depois de cada campo: o texto, a cor e o tamanho da etiqueta só se desenham
            // com "Mostrar Etiqueta" ligado, e uma lista tirada no começo os perderia (medido no ponto).
            for (let volta = 0; volta < 80; volta++) {
                await selecionar(A, id);
                const alvo = await abrirAba(A, aba);
                const campo = await proximoCampo(A, alvo, feitos);
                if (!campo) break;
                feitos.add(chaveDoCampo(campo));
                if (ABAS_DE_LEITURA.has(aba.id) && campo.tipo !== 'perna') {
                    tabela.push({ campo: `${aba.id}: ${chaveDoCampo(campo)}`, propriedades: ['(lente de exibicao, nao e propriedade)'] });
                    continue;
                }
                for (const d of await controlesDesconhecidos(A, alvo)) desconhecidos.push(`${aba.id}: ${d}`);
                const antes = (await feicaoNoStore(A, balde, id)).properties;
                console.log(`[cobertura-abas] ${ferramenta.id}: ${aba.id} ${campo.tipo}:${campo.rotulo}#${campo.ordem}`);
                await mudarCampo(A, campo, alvo);
                await salvarSeHouver(A);
                let mudou = [];
                try {
                    await expect.poll(async () => {
                        mudou = chavesMudadas(antes, (await feicaoNoStore(A, balde, id)).properties);
                        return mudou.length;
                    }, { timeout: 5000 }).toBeGreaterThan(0);
                } catch {
                    mudou = [];
                }
                tabela.push({ campo: `${aba.id}: ${chaveDoCampo(campo)}`, propriedades: mudou });
                if (mudou.length === 0) continue;
                const esperado = (await feicaoNoStore(A, balde, id)).properties;
                const recorte = (props) => Object.fromEntries(mudou.map((k) => [k, props?.[k] ?? null]));
                await expect.poll(async () => recorte((await linhaNoServidor(collab, id))?.properties), {
                    timeout: 30000, message: `${ferramenta.id} ${aba.id} ${campo.rotulo}: o servidor nao recebeu ${mudou.join(',')}`,
                }).toEqual(recorte(esperado));
                await expect.poll(async () => recorte((await feicaoNoStore(B, balde, id))?.properties), {
                    timeout: 30000, message: `${ferramenta.id} ${aba.id} ${campo.rotulo}: o par nao recebeu ${mudou.join(',')}`,
                }).toEqual(recorte(esperado));
            }
            if (feitos.size === 0) tabela.push({ campo: `${aba.id}: (nenhum campo editavel)`, propriedades: ['-'] });
        }

        const resumo = [
            `abas: ${abas.map((a) => a.id).join(', ')}`,
            ...tabela.map((l) => `${l.campo} -> ${l.propriedades.join(',') || '(nada gravado)'}`),
            ...[...new Set(desconhecidos)].map((d) => `DESCONHECIDO ${d}`),
        ].join('\n');
        console.log(`[cobertura-abas] ${ferramenta.id}\n${resumo}`);
        testInfo.annotations.push({ type: 'abas', description: resumo });
        expect(tabela.filter((l) => l.propriedades.length === 0).map((l) => l.campo),
            `${ferramenta.id}: campos cujo Salvar nao grava nada`).toEqual([]);

        await A.reload();
        await B.reload();
        const servidor = await linhaNoServidor(collab, id);
        for (const [quem, page] of [['A', A], ['B', B]]) {
            await expect.poll(async () => {
                const f = await feicaoNoStore(page, balde, id);
                // O valor escolhido, sem o que o autor deriva do zoom (`helpers/valor-escolhido.js`).
                return f ? { properties: valorEscolhido(f.properties), geometry: f.geometry } : null;
            }, { timeout: 30000, message: `${quem} diverge do servidor depois do F5` })
                .toEqual({ properties: valorEscolhido(servidor.properties), geometry: servidor.geometry });
        }
    });
}
