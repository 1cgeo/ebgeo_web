// Path: e2e-ui/resource-share-criar-grupo.spec.js

/**
 * CRIAR UM GRUPO NO PONTO DE USO, dentro do modal de compartilhar recurso, em Chromium real
 * contra o backend real.
 *
 * O QUE A FATIA ENTREGOU. Até 2026-08-23, conceder um recurso a um grupo que ainda não existia
 * custava fechar o modal, ir a outra página, criar o grupo, voltar e REABRIR o modal — o
 * seletor nem sequer relia a lista, então nem fechar bastava se o modal já estivesse aberto. O
 * servidor sempre permitiu (`POST /access-groups` é gateado só por sessão): o que faltava era a
 * tela. E o ganho não é o botão, é o ESTADO: depois de criar, o grupo volta já ESCOLHIDO no
 * seletor, com o botão de conceder habilitado, sem recarregar nada.
 *
 * É por isso que a asserção central deste arquivo é sobre a opção SELECIONADA, e não sobre a
 * existência da opção. Uma versão que criasse o grupo e recarregasse a lista sem pré-selecioná-lo
 * passaria num teste que só perguntasse "o grupo apareceu?", e devolveria ao usuário exatamente
 * o clique a mais que a mudança existe para remover.
 *
 * A SEGUNDA METADE É A DISTINÇÃO ENTRE DUAS APARÊNCIAS. A leitura dos grupos FALHAR e a lista
 * VIR VAZIA produziam a mesma tela (o seletor sumia), e a dica de lista vazia AFIRMA que a
 * pessoa não tem grupo nenhum — dizer isso depois de um erro de rede é afirmar algo falso com
 * cara de estado. Aqui a falha é provocada de verdade, abortando a requisição no navegador, e o
 * que se assere é que as duas telas são DIFERENTES e que a falha oferece saída.
 *
 * POR QUE A CAMADA BASE, e não um modelo 3D: ela é o tipo de recurso cuja superfície de
 * compartilhamento fica a dois cliques do mapa (`base-layer-share`, provado em
 * `browser-basemap-privado.spec.js`), sem passar pela grade do catálogo. O sujeito aqui é o
 * modal, não o caminho até ele.
 *
 * O ADMINISTRADOR VÊ TODOS OS GRUPOS do sistema (`listAccessGroups`), e o banco desta camada é
 * compartilhado pela rodada inteira. Por isso NENHUM caso deste arquivo assere lista vazia: o
 * que se assere é o efeito do gesto sobre um nome único, que é verdade com zero ou com trinta
 * grupos preexistentes.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { closeDb } from './helpers/db.js';
import { createVerifiedUser, resolveOrganization } from './helpers/accounts.js';
import { seedBasemap } from './helpers/catalog-seed.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Boota anônimo, entra pela interface e fica no mapa (que é onde vive o seletor). */
async function entrarNoMapa(page, creds) {
    await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
    await page.goto('/');
    await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
    await page.goto('/');
    await expect(page.locator('[data-testid="account-control"]')).toBeAttached({ timeout: 20000 });
    await page.locator('[data-testid="account-login-btn"]').click();
    await page.locator('[data-testid="login-username"]').fill(creds.username);
    await page.locator('[data-testid="login-password"]').fill(creds.password);
    await page.locator('[data-testid="login-submit"]').click();
    await page.waitForURL('**/atlas.html', { timeout: 20000 });
    await page.locator('[data-testid="projects-local-map"]').click();
    await expect(page.locator('[data-testid="account-control"]')).toBeAttached({ timeout: 20000 });
}

/** Abre o seletor de camada base e clica no "Compartilhar" daquela camada privada. */
async function abrirCompartilhamento(page, basemapId) {
    await expect(page.locator('#base-layer-selector')).toBeVisible({ timeout: 20000 });
    await page.locator('#base-layer-selector .base-layer-collapsed').click();
    const opcao = page.locator(`.base-layer-option[data-layer-id="${basemapId}"]`);
    await expect(opcao).toBeVisible({ timeout: 15000 });
    await opcao.locator('[data-testid="base-layer-share"]').click();
    await expect(page.locator('[data-testid="resource-share-modal"]')).toBeVisible({ timeout: 15000 });
    // A lista de concessões chegou: o corpo saiu do estado de carregamento e a seção de
    // conceder já existe. Sem esta espera, o clique seguinte cairia no HTML do spinner.
    await expect(page.locator('[data-testid="resource-share-loading"]')).toHaveCount(0, { timeout: 15000 });
}

describeOrSkip('Modal de compartilhar recurso — criar grupo no ponto de uso', () => {
    test.afterAll(async () => { await closeDb(); });

    test('o grupo criado aqui volta ESCOLHIDO no seletor, pronto para receber, sem recarregar', async ({ page }) => {
        const admin = await createVerifiedUser({ prefix: 'grpadm', nome: 'Grupo Admin', role: 'admin' });
        const basemapId = await seedBasemap(state.dbName, { name: 'Base para conceder' });

        await entrarNoMapa(page, admin);
        await abrirCompartilhamento(page, basemapId);
        const urlAntes = page.url();

        const nomeGrupo = `Celula ${Math.random().toString(36).slice(2, 8)}`;
        await page.locator('[data-testid="resource-share-new-group"]').click();
        const campo = page.locator('[data-testid="resource-share-new-group-name"]');
        await expect(campo).toBeVisible({ timeout: 5000 });
        await campo.fill(nomeGrupo);
        await page.locator('[data-testid="resource-share-create-group"]').click();

        await expect(page.locator('.toast--success', { hasText: `Grupo "${nomeGrupo}" criado.` }))
            .toBeVisible({ timeout: 15000 });

        // O ESTADO, que é o ponto: a opção SELECIONADA do seletor é o grupo recém-criado, e o
        // botão de conceder já aceita o clique. `option:checked` e não `inputValue()` porque o
        // que se quer provar é que a tela mostra o nome, não que uma variável guarda um id.
        const seletor = page.locator('[data-testid="resource-share-group-select"]');
        await expect(seletor).toBeVisible({ timeout: 10000 });
        // UMA opção marcada, e é a do grupo novo. A contagem vem antes porque `toContainText`
        // sobre um conjunto vazio de opções marcadas falharia por motivo errado, e sobre um
        // conjunto de duas passaria com a segunda. O texto é CONTIDO e não igual: o rótulo do
        // seletor carrega o tamanho do grupo ("Celula X (sem membros)"), que é decisão de
        // `groupOptionLabel` e não deste teste.
        await expect(seletor.locator('option:checked')).toHaveCount(1);
        await expect(seletor.locator('option:checked')).toContainText(nomeGrupo);
        await expect(page.locator('[data-testid="resource-share-grant-group"]')).toBeEnabled();

        // SEM RECARREGAR: nenhuma navegação aconteceu entre a abertura do modal e agora, e o
        // modal é o mesmo (ele nunca voltou ao estado de carregamento inicial do `render()`).
        expect(page.url()).toBe(urlAntes);
        await expect(page.locator('[data-testid="resource-share-modal"]')).toBeVisible();

        // E o botão habilitado não é decoração: o clique concede de verdade, e a linha do
        // grupo entra na lista de quem tem acesso.
        await page.locator('[data-testid="resource-share-grant-group"]').click();
        await expect(page.locator('.toast--success', { hasText: 'Acesso concedido ao grupo.' }))
            .toBeVisible({ timeout: 15000 });
        const linha = page.locator('[data-testid="resource-share-grant"][data-grantee-kind="grupo"]',
            { hasText: nomeGrupo });
        await expect(linha).toBeVisible({ timeout: 15000 });
    });

    test('a FALHA de rede ao ler os grupos tem aparência diferente de lista vazia', async ({ page }) => {
        const admin = await createVerifiedUser({ prefix: 'grpadm', nome: 'Grupo Admin', role: 'admin' });
        const basemapId = await seedBasemap(state.dbName, { name: 'Base com leitura quebrada' });

        await entrarNoMapa(page, admin);

        // A falha é PROVOCADA na rede do navegador, e só na LEITURA: a rota de criação
        // continua viva, senão o caso mediria duas coisas quebradas de uma vez.
        await page.route('**/api/v1/access-groups', async (route) => {
            if (route.request().method() === 'GET') return route.abort('failed');
            return route.fallback();
        });

        await abrirCompartilhamento(page, basemapId);

        const falhou = page.locator('[data-testid="resource-share-groups-failed"]');
        await expect(falhou).toBeVisible({ timeout: 15000 });
        await expect(falhou).toContainText('Tentar de novo');
        // AS DUAS APARÊNCIAS NÃO PODEM SE CONFUNDIR: a dica de lista vazia AFIRMA que a pessoa
        // não tem grupo, e é justamente essa afirmação falsa que a fatia removeu. O seletor
        // também não pode estar lá, oferecendo escolha sobre um estado não confirmado.
        await expect(page.locator('[data-testid="resource-share-groups-empty"]')).toHaveCount(0);
        await expect(page.locator('[data-testid="resource-share-group-select"]')).toHaveCount(0);

        // "Tentar de novo" resolve, e é isso que separa um estado de erro de um beco sem saída.
        await page.unroute('**/api/v1/access-groups');
        await page.locator('[data-testid="resource-share-groups-retry"]').click();
        await expect(falhou).toHaveCount(0, { timeout: 15000 });
        // Com a leitura de pé, a tela volta a ser UMA das duas normais (há grupos, ou não há).
        // Asserir "qual" seria asserir o conteúdo do banco compartilhado da rodada.
        const seletor = page.locator('[data-testid="resource-share-group-select"]');
        const vazio = page.locator('[data-testid="resource-share-groups-empty"]');
        const esgotado = page.locator('[data-testid="resource-share-groups-exhausted"]');
        await expect.poll(
            async () => (await seletor.count()) + (await vazio.count()) + (await esgotado.count()),
            { timeout: 15000 },
        ).toBe(1);
        // E a saída "criar um grupo" continua oferecida nos três estados normais, que é o que
        // impede o caso vazio de virar um beco sem saída também.
        await expect(page.locator('[data-testid="resource-share-new-group"]')).toBeVisible();
    });

    test('um PRODUTOR compartilha o que a OM dele mantém, e a dica o manda à porta DELE', async ({ page }) => {
        // A PRIMEIRA SESSÃO DE PRODUTOR DESTA CAMADA. Até 2026-08-23 o harness só sabia criar
        // `role='user'`, e as três ocorrências da palavra "produtor" nesta pasta eram
        // comentário: nenhuma tela do produtor tinha sido desenhada num navegador.
        //
        // Ele entra aqui por duas propriedades que o administrador não tem, e as duas são
        // asserção deste caso: a autoridade de repasse vem da PRODUÇÃO e não do papel global
        // (`fn_produced_private_resource_ids` alimenta a lista `shareable`), e a lista de
        // grupos dele começa VAZIA de verdade (`listAccessGroups` devolve só os PRÓPRIOS), o
        // que torna o estado vazio determinístico num banco compartilhado pela rodada.
        const om = await resolveOrganization({ slug: 'dsg' });
        const produtor = await createVerifiedUser({
            prefix: 'grpprod', nome: 'Produtor da DSG', role: 'producer', producerOrgSlug: 'dsg',
        });
        expect(produtor.producerOrgId).toBe(om.id);
        const basemapId = await seedBasemap(state.dbName, {
            name: 'Base da DSG', accessLevel: 'private', ownerOrgId: om.id,
        });

        await entrarNoMapa(page, produtor);
        await abrirCompartilhamento(page, basemapId);

        // A DICA NOMEIA A PORTA DELE, e não uma página fixa: `adminAudience` chama a porta de
        // "Catálogo" para o produtor e de "Administração" para o administrador. Um texto fixo
        // mandava dois dos quatro papéis procurar uma página com outro nome.
        const vazio = page.locator('[data-testid="resource-share-groups-empty"]');
        await expect(vazio).toBeVisible({ timeout: 15000 });
        await expect(vazio).toContainText('Você ainda não tem grupos de acesso');
        await expect(vazio).toContainText('Catálogo');
        await expect(vazio).not.toContainText('Administração');

        // E o ponto de uso funciona igual para ele: criar aqui e sair já escolhido.
        const nomeGrupo = `Equipe ${Math.random().toString(36).slice(2, 8)}`;
        await page.locator('[data-testid="resource-share-new-group"]').click();
        // A dica do formulário ABERTO desmente o mal-entendido que o atalho introduz (o grupo
        // nasce VAZIO, então conceder a ele não alcança ninguém) e nomeia a porta do produtor.
        // Ela vive enquanto o formulário está aberto: depois de criar, o formulário fecha e a
        // dica sai com ele, que foi o que esta asserção mediu ao ser escrita no lugar errado.
        await expect(page.locator('[data-testid="resource-share-new-group-hint"]'))
            .toContainText('Catálogo');
        await page.locator('[data-testid="resource-share-new-group-name"]').fill(nomeGrupo);
        await page.locator('[data-testid="resource-share-create-group"]').click();
        await expect(page.locator('.toast--success', { hasText: `Grupo "${nomeGrupo}" criado.` }))
            .toBeVisible({ timeout: 15000 });
        const seletor = page.locator('[data-testid="resource-share-group-select"]');
        await expect(seletor.locator('option:checked')).toHaveCount(1);
        await expect(seletor.locator('option:checked')).toContainText(nomeGrupo);
    });
});
