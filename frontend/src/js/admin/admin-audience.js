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
 * AS QUATRO AUDIÊNCIAS, e "Concessões" e "Minha conta" são as DUAS abas que todas as três que
 * abrem a porta recebem:
 *
 *   | principal                  | rótulo        | abas                                                        |
 *   |----------------------------|---------------|-------------------------------------------------------------|
 *   | anônimo                    | (nenhum)      | (nenhuma)                                                   |
 *   | administrador global       | Administração | users, groups, config, catalog, personnel, grants, audit, diagnostico, uso, account |
 *   | produtor                   | Catálogo      | catalog, groups, grants, audit, account                     |
 *   | qualquer outro autenticado | Acessos       | groups, grants, account                                     |
 *
 * `account` ENTROU EM 2026-08-25, por decisão do chefe, e nas TRÊS de uma vez: "Minha conta"
 * deixou de ser modal (`modals/account-settings.modal.js`, apagado) e virou aba
 * (`admin/account-tab.js`). O critério é trivial e é por isso que ele é seguro: quem entrou tem
 * conta. Ela é a ÚLTIMA de cada lista pela régua que já pôs `audit` e `grants` no fim: a primeira
 * aba é a que o painel abre, e ninguém abre o painel para ler o próprio nome.
 *
 * ELA NÃO MEXEU EM RÓTULO NENHUM, e a razão é a mesma que o teste desta regra cobra: uma aba que
 * as TRÊS audiências recebem não distingue audiência nenhuma, então não há o que renomear. Quem
 * chega por `admin.html?aba=account` chega direto nela, sem ler o rótulo da porta.
 *
 * A ÚLTIMA LINHA MUDOU EM 2026-08-24, e o rótulo mudou COM ela, que é a regra abaixo em ação: ela
 * ganhou a aba "Concessões" (o inventário do que a pessoa concedeu e do que concederam a ela), e
 * "Grupos" deixou de nomear o que ela recebe. "Acessos" nomeia os dois: o coletivo que carrega
 * acesso e a concessão individual. O caso que motivou a aba é o do CREDENCIADO, que cai nesta
 * linha: o papel dele é definido por conceder, ele não tem trilha de auditoria (decisão
 * registrada) e, até aqui, a única superfície de concessão era o modal de UM recurso, alcançável
 * só por quem lembrasse qual recurso havia concedido.
 *
 * AS OUTRAS DUAS LINHAS A GANHARAM NO MESMO DIA, e a versão anterior desta prosa dizia o
 * contrário ("administrador e produtor já têm `audit`, que é o inventário de atos de concessão
 * deles"). Essa frase escondia a meia-cobertura que ela mesma admitia logo abaixo, e a
 * meia-cobertura era o defeito. A TRILHA E O INVENTÁRIO RESPONDEM PERGUNTAS DIFERENTES:
 *
 *   - A trilha registra ATO ("em tal dia eu concedi"), o inventário registra ESTADO ("isto ainda
 *     está de pé, e vence em tal dia"). Uma concessão revogada, vencida ou derrubada por poda de
 *     ancestral continua na trilha com a mesma cara da que está viva, e é justamente o prazo (a
 *     coluna que a trilha não tem) que morre em silêncio no predicado do servidor.
 *   - A trilha não tem botão. Revogar e renovar são os dois atos que esta aba oferece, e nenhum
 *     deles é alcançável de uma lista de linhas de log.
 *   - DO LADO RECEBIDO A TRILHA É MUDA PARA OS DOIS, e para o produtor ela é muda por
 *     construção: o recorte do servidor é por OM DONA DO RECURSO ALVO, então a concessão que
 *     alguém de OUTRA OM lhe deu tem `target_org_id` daquela outra OM e nunca aparece na trilha
 *     dele. O administrador vê a linha, e vê um log de ato, não um prazo.
 *
 * OS DOIS RÓTULOS NÃO MUDARAM, e a decisão é conservadora de propósito. A regra abaixo existe
 * contra a PROMESSA EXCESSIVA (chamar de "Administração" um painel de uma aba prometeria um poder
 * que o primeiro clique nega); "Catálogo" com quatro abas erra para o outro lado, e o centro de
 * gravidade do produtor continua sendo o acervo que ele mantém, que é a primeira aba e a única
 * onde ele cria coisa. Foi o oposto no caso do credenciado, e é o que separa os dois casos:
 * "Grupos" nomeava a metade que NÃO é a razão de ele abrir a página. "Administração" cobre a lista
 * inteira do administrador e não precisa de retoque a cada aba nova. (Esta linha dizia "sete abas"
 * e já estava errada quando `diagnostico` nasceu: contador em prosa envelhece sozinho, e nenhum
 * guarda pega aritmética. A propriedade que sobrevive é a de cima, não o número.)
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
 * não gestão, e quem abre o painel vem quase sempre para agir. `grants` entrou em
 * 2026-08-24 no degrau imediatamente anterior, pela MESMA régua: as duas são consulta, e
 * entre elas a pessoal vem antes da do sistema.
 *
 * O QUE `grants` LISTA PARA ELE É O DELE, e só. A rota `grants/issued` filtra por
 * `granted_by = <quem pergunta>`, sem ramo de papel, então o administrador vê o que ELE
 * concedeu, e não o que o sistema inteiro concedeu. Ele PODE revogar mais do que isso (o
 * ramo largo de `requireGrantRevoker` é administração do sistema, não autoria), e é essa
 * assimetria que `issuedReachNotice` (`grant-phrases.js`) diz na tela dele.
 *
 * `diagnostico` ENTROU EM 2026-08-30, entre `audit` e `account`, e a posição vem da mesma régua:
 * as abas de consulta ficam no fim, e entre elas a pessoal (`grants`) vem antes das do sistema.
 * ELA É DELE E DE MAIS NINGUÉM, e é a única aba além de `users`, `config` e `personnel` com esse
 * recorte: as quatro rotas de `/diag` exigem administração do sistema, então oferecê-la ao
 * produtor ou ao credenciado seria 403 na primeira requisição, que é a pior forma de dizer não.
 * A diferença para `audit` é o assunto, e é ela que impede a fusão das duas: a trilha registra
 * ATO de gente (quem fez o quê), o diagnóstico registra FALHA de máquina (o que quebrou, quantas
 * vezes, o que está lento), e o recorte por OM que torna `audit` compartilhável com o produtor não
 * tem sentido nenhum sobre uma pilha de exceção.
 *
 * `uso` ENTROU EM 2026-08-30, LOGO DEPOIS DE `diagnostico`, e a posição sai da mesma régua levada
 * um degrau adiante: as abas de consulta ficam no fim, e entre elas vem primeiro a pessoal
 * (`grants`), depois as do sistema. Entre as três do sistema, `uso` é a ÚLTIMA porque é a única aba
 * do painel inteiro SEM UM ÚNICO BOTÃO: `audit` e `diagnostico` levam a um ato (procurar o autor de
 * uma linha, consertar a rota lenta), e esta é panorama pelo panorama. A régua da lista é "quem
 * abre o painel vem quase sempre para agir", e uma aba sem ação nenhuma é o fim natural dela.
 * "Minha conta" continua depois de tudo por decisão própria, já registrada.
 *
 * ELA É DO ADMINISTRADOR E DE MAIS NINGUÉM, pelo mesmo motivo de `diagnostico`: a rota exige
 * administração do sistema. Mas repare que aqui o recorte não seria dispensável nem se o servidor
 * fosse permissivo, e a diferença vale ser dita: o que a aba mostra é o CENSO do produto inteiro
 * (todas as contas, todos os atlas, todo o volume), sem recorte por OM. Não existe versão desta
 * tela que faça sentido para um produtor, ao contrário de `audit`, que o servidor sabe recortar
 * pela OM dona do recurso. Uma "Uso da minha OM" seria outra aba, com outra consulta.
 * @type {ReadonlyArray<string>}
 */
const ABAS_DO_ADMINISTRADOR = Object.freeze([
    'users', 'groups', 'config', 'catalog', 'personnel', 'grants', 'audit', 'diagnostico', 'uso',
    'account',
]);

/**
 * As do produtor: o catálogo que ele mantém, os grupos dele, as concessões dele e a trilha
 * DA OM DELE.
 *
 * A aba de auditoria é a mesma, e quem a recorta é o SERVIDOR (`requireAuditReader` mais
 * o recorte imposto em `listAudit`): o produtor recebe os atos sobre o acervo da OM dele e
 * nada além disso. Dar-lhe a aba não é dar-lhe a trilha do sistema.
 *
 * É ESSE MESMO RECORTE que torna `grants` indispensável para ele, e não redundante: o
 * recorte é pela OM DONA DO RECURSO, então o acesso que outra OM lhe concedeu não tem
 * linha visível na trilha dele. Desde 2026-08-20 ele concede de RAIZ o que produz, e a
 * lista de `issued` é, para ele, exatamente a das concessões que o servidor aceita revogar
 * desta conta, porque o gate de revogação é por AUTORIA.
 * @type {ReadonlyArray<string>}
 */
const ABAS_DO_PRODUTOR = Object.freeze(['catalog', 'groups', 'grants', 'audit', 'account']);

/**
 * A de todo o resto de quem entrou: os grupos dele, as concessões dele e a conta dele, nessa ordem.
 *
 * A ORDEM É A DE MONTAGEM, e a primeira aba é a que o painel abre. "Grupos" continua na frente
 * porque é a tela que já existia e onde a pessoa AGE (cria, põe gente, tira gente); "Concessões" é
 * inventário, e quem abre o painel vem quase sempre para agir — o mesmo raciocínio que pôs `audit`
 * por último na linha do administrador.
 * @type {ReadonlyArray<string>}
 */
const ABAS_DE_QUEM_ENTROU = Object.freeze(['groups', 'grants', 'account']);

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
    return { label: 'Acessos', tabIds: [...ABAS_DE_QUEM_ENTROU] };
}
