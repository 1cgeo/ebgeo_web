// Path: e2e-ui/cobertura-desenho-estilo.spec.js

/**
 * @fileoverview COBERTURA: cada campo da aba Estilo de cada ferramenta de desenho, entre dois
 * usuários num atlas de servidor, e depois do F5 nos dois (campanha de 2026-09-24).
 *
 * Para cada ferramenta de `FERRAMENTAS` (`helpers/cobertura-desenho.js`), A desenha pela ferramenta
 * real e, para CADA controle que a aba Estilo desenha (deslizante, alternância, seleção, cor, grade de
 * botões, campo numérico, texto, seletor de marcador), abre o painel pela árvore de camadas, muda o
 * controle, clica "Salvar" e mede (a aba é relida a cada volta, então o controle que só aparece
 * depois de outro mudar também entra):
 *
 *  - quais propriedades a gravação mudou no store de A (o campo tem efeito persistido?);
 *  - que essas propriedades chegam IGUAIS à linha do Postgres e ao store de B.
 *
 * No fim, F5 nos dois clientes, e as três cópias (A, B e o servidor) têm de ser iguais campo a
 * campo, geometria inclusive. A tabela campo -> propriedades vai para o console e para as anotações
 * do caso.
 *
 * O QUE SE COMPARA É O VALOR ESCOLHIDO (`valorEscolhido`, em `helpers/valor-escolhido.js`), nunca as
 * propriedades que o autor deriva do zoom depois do envio: o servidor guarda a derivação que a op
 * levou e o autor a recalcula, e as duas diferem na quarta casa decimal numa máquina carregada. O
 * porquê e a medição estão no cabeçalho daquele arquivo.
 *
 * UM CAMPO QUE NÃO GRAVA NADA REPROVA. Mudar só aquele controle e clicar "Salvar" tem de mudar alguma
 * propriedade guardada; quando não muda, a escolha da pessoa se perde calada (ou pega carona na
 * gravação seguinte de outro campo, que foi como os dois primeiros casos apareceram: a "Correção de
 * Zoom" do pincel e a "Opacidade" da linha de limite, que faltavam em `hasFeatureChanged` dos
 * controles).
 *
 * O que NÃO se mede aqui: a aparência no mapa (o pixel), os controles desabilitados pelo próprio
 * produto (o alinhamento de um texto de uma linha), e campos de outras abas (Etiqueta, Caixa de
 * Fundo, Parâmetros, Atributos).
 */

import { collabTest, expect, selectFeatureUI, savePanelUI } from './helpers/collab.fixtures.js';
import {
    FERRAMENTAS, desenhar, feicaoNoStore, camposDeEstilo, mudarCampo, chavesMudadas, valorEscolhido,
    proximoCampo, chaveDoCampo, abaEstilo,
} from './helpers/cobertura-desenho.js';

collabTest.describe.configure({ retries: 0 });

async function linhaNoServidor(collab, id) {
    const row = await collab.db.queryFeatureRow(id);
    return row ? { properties: row.properties, geometry: row.geometry } : null;
}

/** O Salvar do painel, quando o painel tem um; alguns gravam ao vivo e não desenham o botão. */
async function salvarSeHouver(page) {
    const botao = page.locator('.feature-panel[data-expanded="true"] .attr-modern-btn-save').first();
    if (await botao.count()) await savePanelUI(page);
}

for (const ferramenta of FERRAMENTAS) {
    collabTest(`estilo de ${ferramenta.id}: cada campo grava, chega ao par e ao servidor, e sobrevive ao F5`, async ({ collab }, testInfo) => {
        collabTest.setTimeout(600000);
        const A = collab.author;
        const B = collab.peers[0];

        const id = await desenhar(A, ferramenta);
        await expect.poll(async () => (await linhaNoServidor(collab, id)) !== null, { timeout: 30000 }).toBe(true);
        await expect.poll(async () => (await feicaoNoStore(B, ferramenta.balde, id)) !== null, { timeout: 30000 }).toBe(true);

        await selectFeatureUI(A, id);
        const campos = await camposDeEstilo(A);
        expect(campos.length, `a aba Estilo de ${ferramenta.id} desenha algum controle`).toBeGreaterThan(0);

        const tabela = [];
        const feitos = new Set();
        // A aba é RELIDA depois de cada campo (`proximoCampo`): um controle que só se desenha depois de
        // outro mudar (as sub-opções da hachura, por exemplo) entra na volta seguinte.
        for (let volta = 0; volta < 80; volta++) {
            await selectFeatureUI(A, id);
            await expect(abaEstilo(A)).toBeVisible({ timeout: 10000 });
            const campo = await proximoCampo(A, abaEstilo(A), feitos);
            if (!campo) break;
            feitos.add(chaveDoCampo(campo));
            const antes = (await feicaoNoStore(A, ferramenta.balde, id)).properties;
            console.log(`[cobertura-estilo] ${ferramenta.id}: ${campo.tipo}:${campo.rotulo}#${campo.ordem}`);
            await mudarCampo(A, campo);
            await salvarSeHouver(A);
            let mudou = [];
            try {
                await expect.poll(async () => {
                    mudou = chavesMudadas(antes, (await feicaoNoStore(A, ferramenta.balde, id)).properties);
                    return mudou.length;
                }, { timeout: 5000 }).toBeGreaterThan(0);
            } catch {
                mudou = [];
            }
            tabela.push({ campo: `${campo.tipo}:${campo.rotulo}#${campo.ordem}`, propriedades: mudou });
            if (mudou.length === 0) continue;

            const esperado = (await feicaoNoStore(A, ferramenta.balde, id)).properties;
            const recorte = (props) => Object.fromEntries(mudou.map((k) => [k, props?.[k] ?? null]));
            await expect.poll(async () => recorte((await linhaNoServidor(collab, id))?.properties), {
                timeout: 30000, message: `${ferramenta.id} ${campo.rotulo}: o servidor nao recebeu ${mudou.join(',')}`,
            }).toEqual(recorte(esperado));
            await expect.poll(async () => recorte((await feicaoNoStore(B, ferramenta.balde, id))?.properties), {
                timeout: 30000, message: `${ferramenta.id} ${campo.rotulo}: o par nao recebeu ${mudou.join(',')}`,
            }).toEqual(recorte(esperado));
        }

        const resumo = tabela.map((l) => `${l.campo} -> ${l.propriedades.join(',') || '(nada gravado)'}`).join('\n');
        console.log(`[cobertura-estilo] ${ferramenta.id}\n${resumo}`);
        testInfo.annotations.push({ type: 'campos', description: resumo });
        const semEfeito = tabela.filter((l) => l.propriedades.length === 0).map((l) => l.campo);
        expect(semEfeito, `${ferramenta.id}: campos cujo Salvar nao grava nada`).toEqual([]);

        // F5 nos dois: as três cópias iguais, campo a campo e na geometria.
        await A.reload();
        await B.reload();
        const servidor = await linhaNoServidor(collab, id);
        for (const [quem, page] of [['A', A], ['B', B]]) {
            await expect.poll(async () => {
                const f = await feicaoNoStore(page, ferramenta.balde, id);
                return f ? { properties: valorEscolhido(f.properties), geometry: f.geometry } : null;
            }, { timeout: 30000, message: `${quem} diverge do servidor depois do F5` })
                .toEqual({ properties: valorEscolhido(servidor.properties), geometry: servidor.geometry });
        }
    });
}
