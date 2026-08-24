// Path: js/admin/catalog-delete-phrases.js

/**
 * @fileoverview As frases dos atos DESTRUTIVOS da aba Catálogo.
 *
 * ZERO IMPORTS, como as irmãs (`group-phrases.js`, `visibility-phrases.js`,
 * `producer-scope-phrases.js`): a aba mora numa página que boota sem a store, e frase pura é
 * testável em node sem montar DOM nenhum.
 *
 * POR QUE ELAS EXISTEM. Os três atos mais destrutivos desta aba eram os que menos falavam, e o
 * contraste estava dentro do mesmo arquivo: a privatização pergunta com um parágrafo inteiro
 * (`visibilityChangeWarning`), enquanto excluir um item de catálogo chamava `showConfirm` SEM
 * `message` — e `ConfirmModal` não desenha corpo nenhum quando a mensagem falta, então a pergunta
 * era só o título. Desativar um projeto 360 não perguntava nada, embora `disabled` esconda o
 * projeto de todo mundo fora da OM dona, o que é mais destrutivo que privatizar.
 *
 * O NÚMERO DE ATLAS PASSOU A EXISTIR EM 2026-08-24, e este cabeçalho dizia o contrário: que ele
 * "exigiria uma rota nova". A rota nasceu (`GET /{tabela}/:id/references`), então o aviso o traz
 * quando ele chega. Metade da observação antiga continua válida e é por isso que o número é
 * OPCIONAL aqui: ele é contado ANTES do clique e pode mudar entre a leitura e a confirmação, então
 * a frase nunca depende dele para ser honesta.
 *
 * E O QUE O NÚMERO É precisa ser dito com cuidado: ele conta quantos atlas GUARDAM o id que vai
 * ficar pendurado, não quantos vão NOTAR a falta. Os dois divergem nas superfícies de
 * `atlas.settings` que são allowlist, onde lista vazia significa SEM RESTRIÇÃO. A frase abaixo diz
 * o primeiro, e não promete o segundo.
 *
 * "IRREVERSÍVEL PELA INTERFACE" é a redação exata, e não "irreversível". A exclusão de item de
 * catálogo é `active = false` no servidor, e existe um caminho de volta: recriar com o MESMO id
 * cai no ramo de ressurreição de `createCatalogItem`. Só que a linha some da listagem no instante
 * da exclusão, então quem não souber o id de cor não reencontra o caminho. Dizer "não se desfaz"
 * seria falso; dizer "some e você precisa do id" é o que é.
 */

/**
 * O aviso antes de excluir um item de catálogo (basemap, camada de dado, de análise ou 3D).
 *
 * @param {Object} [alvo]
 * @param {string} [alvo.nome] - O nome exibido do item.
 * @param {string} [alvo.id] - O id, que é o que permite recriá-lo depois.
 * @param {number|null} [alvo.atlasCount] - `atlasCount` de `GET /{tabela}/:id/references`, quando
 *   a leitura respondeu. Nulo degrada para a frase sem número, que continua verdadeira.
 * @returns {string} O corpo da confirmação. Nunca vazio.
 */
export function catalogDeletionWarning({ nome = '', id = '', atlasCount = null } = {}) {
    const qual = nome ? `"${nome}"` : 'este item';
    const n = Number(atlasCount);
    const quantos = Number.isFinite(n) && n > 0
        ? `${n} ${n === 1 ? 'atlas guarda' : 'atlas guardam'} uma referência a ele hoje: ${n === 1 ? 'ele continua' : 'eles continuam'} abrindo, e o recurso simplesmente não desenha mais ${n === 1 ? 'nele' : 'neles'}.`
        : 'Os atlas que já o referenciam continuam abrindo, e o recurso simplesmente não desenha '
          + 'mais neles.';
    const partes = [
        `Excluir ${qual} tira o recurso do catálogo de todo mundo, e as concessões de acesso a ele `
        + 'deixam de valer.',
        quantos,
    ];
    // O ID SÓ APARECE QUANDO EXISTE, e a frase muda com ele: prometer um caminho de volta que
    // depende de um id que não estamos mostrando seria pior que não prometer nada.
    partes.push(id
        ? `Isto não se desfaz pela interface. O único caminho de volta é criar um item novo com o `
          + `mesmo id (${id}), então anote-o antes de confirmar.`
        : 'Isto não se desfaz pela interface.');
    return partes.join(' ');
}

/**
 * O aviso antes de DESATIVAR um projeto 360.
 *
 * Só o sentido destrutivo pergunta, como em `visibilityChangeWarning`: reativar não tira nada de
 * ninguém, e treinar o operador a confirmar sem ler é o custo de perguntar sempre.
 *
 * @param {Object} [alvo]
 * @param {string} [alvo.nome] - O nome do projeto.
 * @param {string} [alvo.para] - O status de destino (`disabled` desativa; qualquer outro não pergunta).
 * @returns {string|null} O corpo da confirmação, ou nulo quando não há por que perguntar.
 */
export function projectStatusChangeWarning({ nome = '', para = '' } = {}) {
    if (para !== 'disabled') return null;
    const qual = nome ? `"${nome}"` : 'este projeto';
    return `Desativar ${qual} o esconde de todo mundo fora da OM dona, inclusive de quem já o `
        + 'recebeu por concessão e de quem o vê num atlas. É o eixo mais amplo desta tela: '
        + 'privado restringe quem abre, desativado remove da vista. Reativar desfaz.';
}

/**
 * O aviso antes de excluir um projeto 360 inteiro.
 *
 * @param {Object} [alvo]
 * @param {string} [alvo.nome] - O nome do projeto.
 * @param {number|null} [alvo.fotos] - Quantas fotos ele tem, quando a listagem já sabe.
 * @returns {string} O corpo da confirmação. Nunca vazio.
 */
export function projectDeletionWarning({ nome = '', fotos = null } = {}) {
    const qual = nome ? `"${nome}"` : 'este projeto';
    // A CONTAGEM DE FOTOS ENTRA PORQUE JÁ CHEGA na listagem (`photo_count`), sem leitura
    // adicional nenhuma. Número que já se tem é número que se diz. (A contagem de atlas do irmão
    // acima custa uma leitura, e é por isso que lá ela é opcional e aqui não.)
    const quantas = Number.isFinite(fotos) && fotos > 0
        ? ` e as ${fotos} fotos dele`
        : '';
    return `Excluir ${qual}${quantas} remove o acervo do servidor, junto com a calibração de cada `
        + 'foto. Isto não se desfaz, e reenviar o bundle não devolve o alinhamento: ele teria de '
        + 'ser refeito foto a foto.';
}
