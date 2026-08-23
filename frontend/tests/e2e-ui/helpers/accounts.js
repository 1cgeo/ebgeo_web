// Path: e2e-ui/helpers/accounts.js

/**
 * @fileoverview ONDE A CONTA NASCE nesta camada, e a resposta é: **no processo Node do
 * Playwright**, nunca dentro de `page.evaluate`.
 *
 * O motivo é estrutural, não estilístico. Desde que o auto-cadastro passou a EXIGIR e-mail
 * (`registerSchema`), toda conta criada por `POST /auth/register` nasce PENDENTE, e o login
 * é recusado até o link `?verify=` ser seguido. O token desse link é entregue por e-mail;
 * aqui não há relay, então o único lugar onde ele existe é a linha em
 * `email_verification_tokens`. Essa linha se lê por Postgres, que é alcançável do lado NODE
 * e não do lado browser. Registrar dentro de `page.evaluate` deixa a conta trancada num
 * contexto que não tem como destrancá-la — foi assim que 56 arquivos desta pasta passaram a
 * morrer no setup, todos com o mesmo "Informe e-mail." vindo do cliente REST.
 *
 * Então o cadastro sobe para o Node (onde HTTP e SQL coexistem) e o browser recebe
 * CREDENCIAIS PRONTAS, fazendo só o `login()` — que é o que os specs de fato querem exercitar.
 *
 * DESENHO PROIBIDO, dito aqui para ninguém o propor de novo: uma variável de ambiente do
 * backend que PULE a verificação em teste. Seria um interruptor alcançável em produção capaz
 * de desligar o portão que a onda 0a acabou de instalar. O portão é o produto agora.
 *
 * O QUE ESTE MÓDULO DELIBERADAMENTE NÃO FAZ: escrever `users.email_verified = true` na mão.
 * Isso contornaria a rota de que ele depende e deixaria `POST /auth/verify-email` sem
 * exercício em toda a camada. Ele só LÊ o token e o gasta pela rota pública.
 *
 * Mesma ideia já provada na perna de contrato (`registerAndLogin`,
 * `frontend/tests/e2e/helpers/harness.js`). Duas diferenças: o `baseUrl`/`dbName` vêm do
 * `state.json` que o `global-setup` escreveu, e não há ApiClient no Node, então as três
 * chamadas HTTP são `fetch` cru.
 *
 * CONEXÃO ABERTA E FECHADA POR CHAMADA, de propósito, em vez da conexão memoizada de
 * `helpers/db.js`: aquela exige um `closeDb()` num `afterAll`, e um helper usado por dezenas
 * de arquivos não pode depender de um passo que se esquece — o esquecimento não dá erro,
 * deixa um socket vivo segurando o processo do worker no fim da rodada. Custo medido do
 * câmbio: uma dezena de milissegundos por conta.
 *
 * O PAPEL GLOBAL ENTROU AQUI EM 2026-08-23, e a razão foi medida: o módulo só sabia criar
 * `role='user'`, então CINCO specs escreviam o mesmo `UPDATE users SET role = 'admin'` à mão,
 * cada uma com o seu comentário, e NENHUMA spec desta camada jamais logou como PRODUTOR — as
 * três ocorrências da palavra na pasta eram comentário. O recorte de abas do produtor, a
 * legenda por papel do catálogo e o campo "OM dona" nunca foram desenhados num navegador.
 *
 * A PROMOÇÃO CONTINUA SENDO SQL, e a explicação acima continua valendo inteira: a conta NASCE
 * pela rota pública e tem o e-mail confirmado pela rota pública; o que não tem rota é o
 * crachá, porque criar administrador exige administrador e esta camada parte de banco vazio.
 * O que mudou é que a escrita passou a morar em UM lugar, com o bicondicional do banco
 * imposto ANTES de a linha ser escrita.
 *
 * O BICONDICIONAL É DO BANCO, e o helper não oferece o estado que ele recusa.
 * `users_producer_scope_check` (`backend/src/database/migrations/001_identidade.sql`) diz
 * `(role = 'producer') = (producer_org_id IS NOT NULL)`: crachá sem escopo e escopo sem
 * crachá são os DOIS estados impossíveis. Então `role: 'producer'` sem OM resolve a OM
 * semeada, e OM com qualquer outro papel é erro de chamador, levantado aqui. Se o helper
 * aceitasse o par impossível, o sintoma seria um 23514 vindo como 500 vinte passos adiante.
 */

import { readState } from '../state.js';
import { pgPromise, appDbUrl } from '../backend.js';

/** A senha que todos os specs desta camada usam. Não invente outra. */
export const E2E_PASSWORD = 'Sup3r-Secret-Pw!';

/**
 * A organização de id FIXO semeada pela migração de identidade (slug `default`).
 *
 * Id literal e não consulta por slug porque a própria migração o escreve literal, dizendo
 * que ele é "alvo de backfill idempotente e de fixture de teste". Ainda assim nada aqui
 * PRESSUPÕE que ele exista: `resolveOrganizationId` confere e falha alto.
 */
export const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';

/** Os quatro papéis globais. NÃO são uma escada: nenhum contém o outro. */
const GLOBAL_ROLES = Object.freeze(['user', 'producer', 'credenciado', 'admin']);

/** O papel — e o único — de que o banco exige escopo de produção. */
const PRODUCER_ROLE = 'producer';

/**
 * POST JSON no backend descartável, devolvendo o `data` desembrulhado.
 * Erro vira exceção com status + corpo: um 422 do `registerSchema` precisa aparecer como
 * ele mesmo, e não como um timeout de UI vinte passos adiante.
 * @private
 */
async function postJson(url, body) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
        throw new Error(`POST ${url} → ${res.status}: ${text.slice(0, 300)}`);
    }
    return text ? JSON.parse(text)?.data : null;
}

/**
 * Roda `fn` com uma conexão PRÓPRIA ao banco descartável, e a fecha sempre.
 *
 * SÓ O POOL DESTA CONEXÃO no fim. `pgp.end()` derruba TODOS os pools do processo, e não
 * apenas os desta instância: enquanto era ele aqui, criar uma conta no meio de um spec
 * matava a conexão memoizada de `db.js` e a leitura seguinte voltava "Connection pool of
 * the database object has been destroyed" — longe da causa.
 * @private
 * @param {string} dbName
 * @param {(conn: any) => Promise<any>} fn
 */
async function withConn(dbName, fn) {
    const pgp = pgPromise({ noWarnings: true });
    const conn = pgp(appDbUrl(dbName));
    try {
        return await fn(conn);
    } finally {
        await conn.$pool.end();
    }
}

/**
 * O token de verificação vivo (não consumido, não expirado) mais NOVO de um username.
 *
 * Mais novo primeiro porque `POST /auth/resend-verification` emite uma linha ADICIONAL para
 * o mesmo usuário: pegar uma qualquer confirmaria com um token que o usuário não tem mais.
 * @private
 */
async function pendingVerificationToken(dbName, username) {
    return withConn(dbName, async (conn) => {
        const row = await conn.oneOrNone(
            `SELECT t.token
               FROM email_verification_tokens t
               JOIN users u ON u.id = t.user_id
              WHERE LOWER(u.username) = LOWER($1)
                AND t.consumed_at IS NULL
                AND t.expires_at > NOW()
              ORDER BY t.created_at DESC
              LIMIT 1`,
            [username]
        );
        return row?.token ?? null;
    });
}

/**
 * A OM ATIVA de um slug (ou de um id), como `{ id, nome, sigla, slug }`.
 *
 * FALHA ALTO, e é o ponto: um produtor precisa de uma OM existente, e a base semeada tem
 * oito (a `default` de id fixo mais as sete da lista controlada da migração de identidade).
 * Se a semeadura mudar e o slug pedido sumir, o sintoma natural seria um 401 ou um 403 vinte
 * passos adiante, que se lê como bug do app; aqui ele vira uma frase que nomeia a causa.
 *
 * @param {{slug?: string, id?: string, dbName?: string}} [alvo]
 * @returns {Promise<{id: string, nome: string, sigla: string, slug: string}>}
 */
export async function resolveOrganization({ slug, id, dbName } = {}) {
    const state = readState();
    if (state.skip) {
        throw new Error(`resolveOrganization: backend indisponível (${state.reason})`);
    }
    const alvo = id ?? null;
    const porSlug = alvo ? null : (slug ?? 'default');
    return withConn(dbName ?? state.dbName, async (conn) => {
        const row = await conn.oneOrNone(
            `SELECT id, nome, sigla, slug FROM organizations
              WHERE is_active = true AND ($1::uuid IS NULL OR id = $1::uuid)
                AND ($2::text IS NULL OR slug = $2::text)
              LIMIT 1`,
            [alvo, porSlug]
        );
        if (!row) {
            const disponiveis = await conn.any(
                'SELECT slug FROM organizations WHERE is_active = true ORDER BY slug'
            );
            throw new Error(
                `resolveOrganization: nenhuma OM ativa para ${alvo ? `id=${alvo}` : `slug="${porSlug}"`}. `
                + `A base semeada tem: ${disponiveis.map((o) => o.slug).join(', ') || '(nenhuma)'}. `
                + 'Sem OM existente não há como criar produtor: o CHECK users_producer_scope_check '
                + 'exige o par (papel, OM) coerente.'
            );
        }
        return row;
    });
}

/**
 * Escreve o par (papel, escopo de produção) numa conta que já nasceu pela rota pública.
 *
 * UM ÚNICO `UPDATE` com as DUAS colunas, sempre, mesmo quando o escopo é `null`: o CHECK é
 * bicondicional, então escrever uma coluna de cada vez passa por um estado que o banco
 * recusa. Escrever as duas juntas é o que torna a promoção e o rebaixamento simétricos.
 * @private
 */
async function applyGlobalRole(dbName, username, role, producerOrgId) {
    await withConn(dbName, (conn) => conn.none(
        'UPDATE users SET role = $1, producer_org_id = $2 WHERE LOWER(username) = LOWER($3)',
        [role, producerOrgId, username]
    ));
}

/**
 * Cria uma conta USÁVEL: registra, confirma o e-mail pela rota pública e faz um login de
 * prova (que é também de onde sai o `id` — `register()` responde `{success:true}` sem dado
 * de conta, de propósito, para não servir de enumerador de contas).
 *
 * TRÊS chamadas, e a do meio não é opcional. Sem ela o `login` do browser responde 401 e o
 * spec falha no primeiro clique, longe da causa.
 *
 * O PAPEL É OPCIONAL E O ESCOPO SEGUE DELE. `role` fora dos quatro globais, ou OM em papel
 * que não seja Produtor, são erro de CHAMADOR e levantam aqui: são exatamente os pares que o
 * banco recusa, e recusá-los antes da rede é o que impede um 23514 disfarçado de 500.
 *
 * @param {Object} [opts]
 * @param {string} [opts.prefix='e2e'] - Prefixo do username, para a linha no banco dizer de
 *   qual spec a conta veio. Só `[a-zA-Z0-9._-]` (o `registerSchema` recusa o resto).
 * @param {string} [opts.nome='E2E User'] - Nome de exibição.
 * @param {string} [opts.password=E2E_PASSWORD]
 * @param {'user'|'producer'|'credenciado'|'admin'} [opts.role='user'] - O papel GLOBAL. Tudo
 *   que não é `user` é escrito por SQL depois do cadastro, porque não há rota (ver o
 *   `fileoverview`).
 * @param {string} [opts.producerOrgSlug] - A OM que o Produtor mantém, por slug (`dsg`,
 *   `1-cgeo`, …). Só com `role: 'producer'`. Sem ela, a OM padrão da migração.
 * @param {string} [opts.producerOrgId] - A mesma coisa, por id. Precede o slug.
 * @returns {Promise<{username:string, password:string, nome:string, email:string, id:string,
 *   role:string, producerOrgId:(string|null), accessToken:string}>}
 */
export async function createVerifiedUser({
    prefix = 'e2e',
    nome = 'E2E User',
    password = E2E_PASSWORD,
    role = 'user',
    producerOrgSlug,
    producerOrgId,
} = {}) {
    const state = readState();
    if (state.skip) {
        throw new Error(`createVerifiedUser: backend indisponível (${state.reason})`);
    }
    if (!GLOBAL_ROLES.includes(role)) {
        throw new Error(
            `createVerifiedUser: papel global "${role}" não existe. Os quatro são: `
            + `${GLOBAL_ROLES.join(', ')}. Eles NÃO são uma escada.`
        );
    }
    const pediuOm = producerOrgId != null || producerOrgSlug != null;
    if (pediuOm && role !== PRODUCER_ROLE) {
        throw new Error(
            `createVerifiedUser: OM de produção pedida com papel "${role}". O banco recusa esse par `
            + '(users_producer_scope_check): escopo sem crachá é um dos dois estados impossíveis.'
        );
    }
    // A OM é resolvida ANTES do cadastro: falhar depois deixaria uma conta órfã no banco e,
    // pior, um `role='user'` com cara de produtor para o resto do spec.
    const om = role === PRODUCER_ROLE
        ? await resolveOrganization({ id: producerOrgId, slug: producerOrgSlug, dbName: state.dbName })
        : null;

    const api = `${state.baseUrl}/api/v1`;
    const safePrefix = String(prefix).replace(/[^a-zA-Z0-9._-]/g, '') || 'e2e';
    const username = `${safePrefix}_${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const email = `${username}@example.mil`;

    await postJson(`${api}/auth/register`, { username, password, nome, email });

    const token = await pendingVerificationToken(state.dbName, username);
    if (!token) {
        // Falha ALTO: sem token não há confirmação, e o sintoma natural seria um 401 no login
        // lá adiante, que se lê como bug do app em vez de buraco do harness.
        throw new Error(`createVerifiedUser: nenhum token de verificação vivo para "${username}"`);
    }
    await postJson(`${api}/auth/verify-email`, { token });

    // O CRACHÁ VEM ANTES DO LOGIN DE PROVA, de propósito: o token que sai daqui é o mesmo que
    // um spec pode reusar para falar com a API, e um token cunhado antes da promoção carrega
    // o papel velho até expirar (`flexibleAuth` não reconcilia).
    if (role !== 'user' || om) {
        await applyGlobalRole(state.dbName, username, role, om?.id ?? null);
    }

    const { user, accessToken } = await postJson(`${api}/auth/login`, { username, password });
    return {
        username, password, nome, email, id: user.id,
        role,
        producerOrgId: om?.id ?? null,
        // O token de prova, devolvido em vez de descartado: o spec que precisa falar com a
        // API pelo lado Node (semear uma concessão, por exemplo) faria outro login para tê-lo.
        accessToken,
    };
}
