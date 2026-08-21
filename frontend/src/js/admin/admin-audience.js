// Path: js/admin/admin-audience.js

/**
 * @fileoverview QUEM ABRE `admin.html`, o que a porta se chama e quais abas aparecem — numa
 * definição só.
 *
 * A mesma decisão estava escrita em QUATRO sítios (`admin/index.js`, `admin-page.js`,
 * `account/account.control.js` e `projects/projects-page.js`), cada um com um comentário
 * dizendo que a ordem dos testes repetia a do vizinho por necessidade. Quatro cópias de uma
 * regra que muda produzem a divergência barata de cometer e cara de ver: a entrada aparece na
 * barra do mapa e não em `atlas.html`, ou aparece com um rótulo em cada tela. Desde 2026-08-20
 * a regra mora aqui e os quatro sítios a consomem.
 *
 * AS QUATRO AUDIÊNCIAS, e a novidade é a última:
 *
 *   | principal                      | rótulo         | abas                                             |
 *   |--------------------------------|----------------|--------------------------------------------------|
 *   | anônimo                        | (nenhum)       | (nenhuma)                                        |
 *   | administrador global           | Administração  | users, groups, config, catalog, personnel, audit |
 *   | produtor                       | Catálogo       | catalog, groups, audit                           |
 *   | qualquer outro autenticado     | Grupos         | groups                                           |
 *
 * O CREDENCIADO NÃO TEM LINHA PRÓPRIA, e a ausência é a decisão: desde 2026-08-20 o grupo de
 * acesso é entidade de USUÁRIO, com dono, e a autoridade sobre ele deixou de ser papel global
 * (`fn_can_administer_group`, no servidor). O credenciado mantém o eixo de RECURSO (lê todo
 * privado, concede e revoga) e sobre grupo pode o que qualquer autenticado pode: os dele. Isso
 * SUPERA por escrito a decisão de 2026-08-19 que lhe dava a aba Grupos como privilégio. E ele
 * continua SEM a aba Auditoria: a trilha do sistema não é acervo privado nem grupo próprio, e
 * como o gate do servidor lhe dá 403, oferecê-la seria a pior forma de dizer não.
 *
 * O RÓTULO NOMEIA O QUE A PESSOA RECEBE, nunca a página: chamar de "Administração" o painel de
 * uma aba prometeria um poder que o primeiro clique nega. É a mesma razão de a lista de abas
 * ser recortada aqui em vez de deixar o servidor recusar: `users`, `config` e `personnel` batem
 * numa rota `requireAdmin` já na montagem, e 403 na montagem é a pior forma de dizer não.
 *
 * DUAS PROPRIEDADES SÃO CONTRATO, não estilo:
 *
 *   1. **Função pura, sem `sessionContext` dentro.** Ela recebe os três booleanos já lidos.
 *      Importar a sessão daqui arrastaria `@store` para `atlas.html` e `admin.html`, que bootam
 *      sem a store, e para a barra do mapa; o módulo tem ZERO imports por isso.
 *   2. **`tabIds` é ordem de renderização**, e a ordem é a que o painel monta. Cada chamada
 *      devolve um array novo: quem consome pode filtrar sem contaminar o próximo chamador.
 *
 * Nada aqui é fronteira de segurança. O servidor gateia toda rota de administração
 * (`requireAdmin`), as escritas de catálogo pelo gate de produção e as de grupo por posse.
 */

/**
 * As abas do administrador global, na ordem em que o painel as monta.
 *
 * `audit` entrou POR ÚLTIMO em 2026-08-21, e a posição é a decisão: a trilha é consulta,
 * não gestão, e quem abre o painel vem quase sempre para agir.
 * @type {ReadonlyArray<string>}
 */
const ABAS_DO_ADMINISTRADOR = Object.freeze([
    'users', 'groups', 'config', 'catalog', 'personnel', 'audit',
]);

/**
 * As do produtor: o catálogo que ele mantém, os grupos dele, e a trilha DA OM DELE.
 *
 * A aba de auditoria é a mesma, e quem a recorta é o SERVIDOR (`requireAuditReader` mais
 * o recorte imposto em `listAudit`): o produtor recebe os atos sobre o acervo da OM dele e
 * nada além disso. Dar-lhe a aba não é dar-lhe a trilha do sistema.
 * @type {ReadonlyArray<string>}
 */
const ABAS_DO_PRODUTOR = Object.freeze(['catalog', 'groups', 'audit']);

/** A de todo o resto de quem entrou. @type {ReadonlyArray<string>} */
const ABAS_DE_QUEM_ENTROU = Object.freeze(['groups']);

/**
 * @typedef {Object} AdminAudience
 * @property {string|null} label - O rótulo da porta, ou `null` para quem não a abre.
 * @property {string[]} tabIds - Os ids das abas, na ordem de montagem (vazio para quem não abre).
 */

/**
 * A audiência da página de administração para este principal.
 *
 * @param {Object} [principal]
 * @param {boolean} [principal.isAuthenticated] - Há sessão com conta. `false` para o anônimo E
 *   para o visitante de link público, que tem sessão online sem conta e não cria grupo nenhum.
 * @param {boolean} [principal.isAdmin] - Papel GLOBAL `admin` (não o `admin` do eixo por atlas).
 * @param {boolean} [principal.isProducer] - Papel GLOBAL `producer`.
 * @returns {AdminAudience}
 */
export function adminAudience({ isAuthenticated = false, isAdmin = false, isProducer = false } = {}) {
    // O administrador primeiro: os papéis globais não são uma escada, mas um administrador que
    // também produza cairia no ramo do produtor se a ordem fosse outra, e perderia três abas.
    if (isAdmin) return { label: 'Administração', tabIds: [...ABAS_DO_ADMINISTRADOR] };
    // `isAuthenticated` só é cobrado DEPOIS dos papéis por robustez de leitura: papel global sem
    // sessão é estado impossível, e um `false` acidental ali não pode esconder o painel de um
    // administrador. Para o anônimo, nenhum dos três é verdadeiro e a porta some.
    if (!isAuthenticated) return { label: null, tabIds: [] };
    if (isProducer) return { label: 'Catálogo', tabIds: [...ABAS_DO_PRODUTOR] };
    return { label: 'Grupos', tabIds: [...ABAS_DE_QUEM_ENTROU] };
}
