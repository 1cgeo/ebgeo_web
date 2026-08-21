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
 */

import { readState } from '../state.js';
import { pgPromise, appDbUrl } from '../backend.js';

/** A senha que todos os specs desta camada usam. Não invente outra. */
export const E2E_PASSWORD = 'Sup3r-Secret-Pw!';

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
 * O token de verificação vivo (não consumido, não expirado) mais NOVO de um username.
 *
 * Mais novo primeiro porque `POST /auth/resend-verification` emite uma linha ADICIONAL para
 * o mesmo usuário: pegar uma qualquer confirmaria com um token que o usuário não tem mais.
 * @private
 */
async function pendingVerificationToken(dbName, username) {
    const pgp = pgPromise({ noWarnings: true });
    const conn = pgp(appDbUrl(dbName));
    try {
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
    } finally {
        await pgp.end();
    }
}

/**
 * Cria uma conta USÁVEL: registra, confirma o e-mail pela rota pública e faz um login de
 * prova (que é também de onde sai o `id` — `register()` responde `{success:true}` sem dado
 * de conta, de propósito, para não servir de enumerador de contas).
 *
 * TRÊS chamadas, e a do meio não é opcional. Sem ela o `login` do browser responde 401 e o
 * spec falha no primeiro clique, longe da causa.
 *
 * @param {Object} [opts]
 * @param {string} [opts.prefix='e2e'] - Prefixo do username, para a linha no banco dizer de
 *   qual spec a conta veio. Só `[a-zA-Z0-9._-]` (o `registerSchema` recusa o resto).
 * @param {string} [opts.nome='E2E User'] - Nome de exibição.
 * @param {string} [opts.password=E2E_PASSWORD]
 * @returns {Promise<{username:string, password:string, nome:string, email:string, id:string}>}
 */
export async function createVerifiedUser({ prefix = 'e2e', nome = 'E2E User', password = E2E_PASSWORD } = {}) {
    const state = readState();
    if (state.skip) {
        throw new Error(`createVerifiedUser: backend indisponível (${state.reason})`);
    }
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

    const { user } = await postJson(`${api}/auth/login`, { username, password });
    return { username, password, nome, email, id: user.id };
}
