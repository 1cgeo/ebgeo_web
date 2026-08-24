// Path: src/modules/users/users.service.js
import bcrypt from 'bcrypt';
import { query, tx } from '../../database/index.js';
import {
  NotFoundError, UnauthorizedError, ConflictError, ForbiddenError, BadRequestError,
} from '../../utils/errors.js';
import { createAudit, createAuditBestEffort } from '../../utils/audit.js';
// O MECANISMO DE TOKEN DE CONTA TEM UMA IMPLEMENTACAO SO, e ela e a do modulo de auth: mesma
// tabela, mesmo resgate atomico de uso unico, mesmo link `?verify=`. A troca de e-mail e uma
// rota de `/users/me`, mas o portao pelo qual o endereco novo passa e literalmente o do
// cadastro. Escrever um segundo emissor de token aqui seria a segunda copia da regra mais
// sensivel da casa.
import { issueAndSendEmailChange } from '../auth/auth.service.js';
// A UNICIDADE DE E-MAIL tambem tem uma definicao so, ao lado do fluxo que confirma o endereco.
import { CHECK_EMAIL_EXISTS_EXCLUDING } from '../auth/auth.queries.js';
import { sendEmailInUseNotice, buildAppLink } from '../../utils/mailer.js';
import logger from '../../utils/logger.js';
// O DE-PARA DA TRILHA (clausula 9.3) tem UMA implementacao, e ela e a mesma do catalogo
// e do 360: tres regimes por lista fechada, com o nome-so como piso do desconhecido. A
// familia de usuarios entrou nela em 2026-08-23 acrescentando os campos de conta as
// listas daquele arquivo, e nao um segundo motor aqui.
import { diffAuditavel } from '../../utils/audit-diff.js';
import * as Q from './users.queries.js';
// D8(b): desativar uma conta derruba o que ela concedeu. A semantica de queda tem UMA
// definicao, e ela mora no modulo de acesso a recurso: importar a funcao e o que impede
// a segunda copia da regra de nascer aqui.
import { podarConcessoesDeQuemFoiDesativado, podarPorRaizes } from '../resource-access/resource-access.service.js';
// O CONJUNTO DE RAIZES DE UMA PESSOA tem UMA definicao, e ela e a mesma que a
// desativacao usa. Reescrever o `WHERE granted_by = $1 AND revoked_at IS NULL` aqui
// seria a segunda copia, e a segunda e a que envelhece quando a coluna mudar.
import { LIVE_GRANT_IDS_BY_GRANTER } from '../resource-access/resource-access.queries.js';
// O predicado do veredito, num modulo FOLHA e sem imports, para que o teste-espelho possa
// carregar os dois lados no mesmo processo. Ver o `fileoverview` daquele arquivo.
import { fundamentoDeRaizPerdido } from './producer-scope-verdict.js';

const SALT_ROUNDS = 12;


/**
 * REBAIXAMENTO = PERDA DE UM FUNDAMENTO DE CONCESSAO DE RAIZ. Devolve o nome do
 * fundamento perdido, ou `null` quando nada foi perdido.
 *
 * POR QUE ISTO PRECISA DE UMA DEFINICAO ESCRITA. Os quatro papeis globais NAO formam
 * escada (`user`, `producer`, `credenciado`, `admin`), entao "rebaixar" nao e "ficou
 * menor" e nao existe comparacao que responda a pergunta. O que interessa aqui e uma
 * pergunta mais estreita: a pessoa continua tendo de onde tirar uma concessao de RAIZ?
 * `grantResource` responde isso com dois fundamentos, e sao esses dois que esta funcao
 * mede: `hasGlobalAccess` (papel `admin`/`credenciado`) e `producesResource` (a OM de
 * `users.producer_org_id`).
 *
 * (1) QUEM TERMINA COM ACESSO GLOBAL DE DADO NAO PERDEU NADA, e este ramo vem primeiro
 *     de proposito. `admin` e `credenciado` concedem QUALQUER recurso privado, o que
 *     COBRE tudo o que os dois fundamentos anteriores cobriam. Sem ele, promover um
 *     produtor a administrador seria lido como perda (o `producer_org_id` cai junto, por
 *     forca do CHECK bicondicional) e a promocao derrubaria o acervo dele — poda no ato
 *     que AUMENTA a autoridade, que e o contrario do que a decisao quis.
 *
 * (2) DEIXAR DE TER PAPEL GLOBAL DE DADO e perda, e nao ha o que compensar: o escopo de
 *     producao, quando ele existe, cobre uma OM, nunca o acervo inteiro.
 *
 * (3) TROCAR A OM DE PRODUCAO E PERDA, e a decisao aqui e do dono: em relacao ao acervo
 *     ANTIGO a pessoa deixou de produzir, e uma concessao viva sobre um tileset da OM A
 *     dada por quem hoje so mantem a OM B nao tem mais fundamento nenhum. Por isso a
 *     comparacao e `omAntes !== omDepois`, e nao `omDepois === null`.
 *
 * O QUE ESTA FUNCAO DELIBERADAMENTE NAO FAZ: distinguir sob qual autoridade cada
 * concessao nasceu. Essa e a forma SIMPLES escolhida pelo dono (2026-08-21), de olhos
 * abertos: quem for rebaixado perde tambem o que poderia manter pelo fundamento que
 * sobrou. Numa revogacao a direcao de falha correta e a fechada, e a forma alternativa
 * (carimbar o fundamento na linha da concessao) custa coluna nova e uma segunda
 * definicao de autoridade, escrita no INSERT, para envelhecer separada desta.
 *
 * O PREDICADO MUDOU DE ARQUIVO em 2026-08-24: ele vive em `producer-scope-verdict.js`, folha e
 * sem imports, e este servico o importa. A razao e o ESPELHO no cliente
 * (`frontend/src/js/admin/producer-scope-phrases.js`, `verdictOfChange`), que reimplementa a
 * decisao para saber SE deve pedir confirmacao antes do PUT. Enquanto o predicado morava aqui,
 * nao havia teste ligando os dois lados, e o motivo escrito era verdadeiro (este arquivo puxa
 * banco e bcrypt, o espelho e folha) mas a conclusao era evitavel: o que precisava ficar leve era
 * o PREDICADO, nao o servico. Hoje
 * `frontend/tests/unit/escopo-de-producao-espelha-backend.test.js` importa os DOIS.
 *
 * `is_active` NAO ENTRA AQUI: desativar por este PUT e recusado com 409 mais acima, e
 * quem desativa (`deleteUser`) tem a poda dele, com origem propria.
 * `organization_id` tambem nao: lotacao e auto-declarada no cadastro e nao autoriza nada.
 *
 * @param {{role: string, producer_org_id?: string|null}} antes - A linha ANTES do UPDATE.
 * @param {{role: string, producer_org_id?: string|null}} depois - A linha GRAVADA.
 * @returns {'acesso_global_de_dado'|'escopo_de_producao'|null}
 */

/**
 * Normaliza um campo opcional de uuid: `''` e `undefined` viram null.
 * @param {*} v
 * @returns {string|null}
 */
function uuidOuNulo(v) {
  return v === '' || v === undefined ? null : (v ?? null);
}

/**
 * Cobra o BICONDICIONAL do escopo de producao sobre o estado EFETIVO da conta, e
 * devolve o par (papel, escopo) que deve ir para o banco.
 *
 * POR QUE AQUI E NAO SO NO CHECK. `users_producer_scope_check` e a guarda que vale,
 * e ela nao pode sair; mas quando ela dispara o driver levanta 23514, que o
 * `errorHandler` traduz num 400 generico ("Value violates a constraint") de
 * proposito, porque o texto do driver expoe nome de coluna e de constraint. O
 * administrador que tentasse promover alguem a Produtor sem OM leria um erro que nao
 * diz o que corrigir. Esta funcao devolve a mesma recusa com a frase certa.
 *
 * POR QUE O REBAIXAMENTO LIMPA EM VEZ DE RECUSAR. Trocar o papel para qualquer outro
 * significa "esta pessoa nao produz mais"; exigir que quem edita tambem se lembre de
 * mandar `producer_org_id: null` transformaria a operacao mais comum (rebaixar) num
 * 400. O caminho inverso NAO tem simetria: promover a Produtor exige a OM, porque
 * nao ha valor que o servidor possa adivinhar sem escolher a OM de alguem.
 *
 * @param {{role?: string, producer_org_id?: string|null}} data - O corpo (parcial).
 * @param {{role: string, producer_org_id?: string|null}} existing - A linha atual.
 * @returns {{role: string|null, producerOrgId: string|null, producerProvided: boolean}}
 */
function resolveProducerScope(data, existing) {
  const papel = data.role || null;
  const papelEfetivo = papel ?? existing.role;
  const pediuEscopo = data.producer_org_id !== undefined;
  const escopoPedido = uuidOuNulo(data.producer_org_id);
  const escopoEfetivo = pediuEscopo ? escopoPedido : (existing.producer_org_id ?? null);

  if (papelEfetivo === 'producer') {
    if (!escopoEfetivo) {
      throw new BadRequestError('O papel Produtor exige uma OM de produção.');
    }
    return { role: papel, producerOrgId: escopoEfetivo, producerProvided: pediuEscopo };
  }

  if (escopoEfetivo && pediuEscopo) {
    throw new BadRequestError('A OM de produção só se define para o papel Produtor.');
  }
  // Rebaixou (ou ja nao era produtor): o escopo cai junto, sempre.
  return { role: papel, producerOrgId: null, producerProvided: true };
}

/**
 * Normaliza um endereco de e-mail para comparacao e armazenamento.
 *
 * Guarda o que a pessoa escreveu, so sem espaco em volta: o indice unico e sobre `LOWER(email)`
 * (`001_identidade.sql`), entao a unicidade nao depende de o valor ser gravado em minusculas, e
 * gravar minusculado descaracterizaria enderecos cujo provedor distingue caixa na parte local.
 * @param {*} valor
 * @returns {string|null}
 */
function normalizaEmail(valor) {
  if (typeof valor !== 'string') return null;
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
}

/** @returns {boolean} Se os dois enderecos sao o MESMO pelo criterio do indice unico. */
function mesmoEmail(a, b) {
  if (!a || !b) return a === b || (!a && !b);
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Resolve o trio (endereco, bandeira, confirmado) que o UPDATE administrativo deve gravar.
 *
 * A REGRA QUE ESTA FUNCAO EXISTE PARA IMPOR: **trocar o endereco derruba a confirmacao**, salvo
 * se o MESMO pedido disser o contrario. Sem ela, um administrador que corrigisse um e-mail
 * digitado errado deixaria a conta marcada como CONFIRMADA num endereco que ninguem provou
 * possuir, e o gate de login (`user.email && !user.email_verified`) passaria a nao valer para
 * ela — a confirmacao viraria decoracao.
 *
 * O SALVO-SE E DELIBERADO e nao um furo: e ele que preserva o caminho SEM RELAY, em que o
 * administrador e a unica autoridade de confirmacao possivel. Mandar `email` e
 * `email_verified: true` no mesmo pedido e um ato explicito de quem administra, e fica na
 * trilha como tal; o que se recusa e a confirmacao por INERCIA.
 *
 * LIMPAR o endereco (`null`) tambem zera a confirmacao, e ai o efeito e o oposto e igualmente
 * certo: sem endereco o gate de login nao se aplica, e uma linha marcada como confirmada sobre
 * um `NULL` e um estado que so confunde a proxima leitura.
 *
 * @param {{email?: *, email_verified?: boolean}} data - O corpo (parcial).
 * @param {{email?: string|null}} existing - A linha atual.
 * @returns {{email: string|null, provided: boolean, verified: boolean|null}} `verified` null
 *   significa "nao mexa", que e o que o COALESCE do SQL le.
 */
function resolveAdminEmail(data, existing) {
  const provided = data.email !== undefined;
  const email = provided ? normalizaEmail(data.email) : null;
  const pedidoExplicito = data.email_verified !== undefined ? data.email_verified : null;

  if (!provided) {
    return { email: null, provided: false, verified: pedidoExplicito };
  }
  const trocou = !mesmoEmail(email, existing.email ?? null);
  if (trocou && pedidoExplicito === null) {
    return { email, provided: true, verified: false };
  }
  return { email, provided: true, verified: pedidoExplicito };
}

/**
 * Gets user profile by ID.
 */
export async function getProfile(userId) {
  const { rows } = await query(Q.FIND_USER_BY_ID, [userId]);

  if (rows.length === 0) {
    throw new NotFoundError('User');
  }

  return rows[0];
}

/**
 * Updates user profile.
 */
export async function updateProfile(userId, data, req = null) {
  // A LINHA DE ANTES, lida antes da escrita, e é o custo do de-para neste caminho: uma
  // consulta a mais numa rota que não é caminho quente. A projeção de `FIND_USER_BY_ID`
  // é um SUBCONJUNTO da que o UPDATE devolve (as duas trazem `username`, `nome`,
  // `rank_id` e `organization_id`, que são os campos classificados aqui), então o
  // de-para compara maçã com maçã.
  //
  // AUSENTE, NÃO NULO: se a leitura não achar linha (conta inativa é filtrada por essa
  // consulta), o de-para não é calculado. `diffAuditavel(null, depois)` reportaria TODO
  // campo como mudado, o que seria uma linha de trilha falsa — e falsa exatamente na
  // direção que assusta quem investiga.
  const { rows: anteriores } = await query(Q.FIND_USER_BY_ID, [userId]);
  const antes = anteriores[0] ?? null;

  // For nullable fields, pass [value, provided?]: an explicit null/'' clears the
  // column (value normalized to null), an omitted field leaves it unchanged.
  const { rows } = await query(Q.UPDATE_USER_PROFILE, [
    userId,
    data.nome || null,
    data.rank_id === '' ? null : (data.rank_id ?? null),
    data.rank_id !== undefined,
    data.organization_id === '' ? null : (data.organization_id ?? null),
    data.organization_id !== undefined,
  ]);

  if (rows.length === 0) {
    throw new NotFoundError('User');
  }

  // A AUTO-EDIÇÃO PASSA A DEIXAR RASTRO, e isto fecha metade de uma assimetria que o
  // censo de auditoria nomeava por escrito: a edição PELO ADMINISTRADOR emitia
  // `USER_UPDATE` e a do próprio titular não emitia nada, então quem investigava uma
  // conta via o que o admin fez com ela e não o que o titular fez consigo.
  //
  // `self: true` É O QUE DISCRIMINA os dois emissores da MESMA ação. `actor_id` igual a
  // `target_id` já diria isso, mas exige que o leitor compare duas colunas para
  // descobrir de que caminho a linha veio; o campo torna a pergunta filtrável.
  //
  // O DE-PARA vale aqui pela MESMA lista do caminho administrativo (cláusula 9.3), e o
  // efeito prático é que `nome` sai por IMPRESSÃO: a auto-edição responde "mudou? voltou
  // ao que era?" sem gravar o nome civil da pessoa numa trilha que não se edita. O
  // `fields` continua, como piso.
  //
  // FORA DE TRANSAÇÃO porque a escrita é uma query só: não há transação a que aderir.
  // A consequência honesta é que uma falha da trilha responde 500 sobre um perfil que
  // já mudou, o mesmo comportamento do catálogo, e melhor que escrita sem rastro.
  await createAudit(req, {
    action: 'USER_UPDATE',
    actorId: userId,
    targetType: 'USER',
    targetId: userId,
    targetName: rows[0].nome,
    details: {
      fields: Object.keys(data || {}),
      self: true,
      ...(antes ? diffAuditavel(antes, rows[0]) : {}),
    },
  });

  return rows[0];
}

/**
 * Changes user password.
 *
 * Since 2026-07-25 (bugs-backend #35) `REVOKE_ALL_USER_TOKENS` also stamps the session
 * cut-off `users.sessions_valid_from`, so this ends EVERY session of the user — the
 * caller's included, not just "elsewhere" as the old comment below promised. That is
 * the point: a password change made because the account may be compromised has to
 * reach the compromised session, and the compromised session is the one holding a live
 * access token, not a refresh token.
 *
 * The route does NOT hand back a new pair, so the caller's own access token dies with
 * the rest and the client re-authenticates. This is deliberate rather than an
 * oversight: issuing a replacement here would mean minting a token in the same second
 * as the cut-off, i.e. exactly the ambiguity `tokenPredatesSessionCut` had to resolve
 * (utils/org-status.js). This app's UI does not call the route at all — no
 * `/users/me/password` call site exists in frontend/src — so nothing regresses.
 */
export async function updatePassword(userId, currentPassword, newPassword, req = null) {
  // Get current password hash
  const { rows } = await query(Q.FIND_USER_WITH_PASSWORD, [userId]);

  if (rows.length === 0) {
    throw new NotFoundError('User');
  }

  // Verify current password
  const isValid = await bcrypt.compare(currentPassword, rows[0].password_hash);
  if (!isValid) {
    throw new UnauthorizedError('A senha atual está incorreta.');
  }

  // Hash new password
  const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  // Update password, revoke the refresh family and cut every session (one statement).
  await query(Q.UPDATE_USER_PASSWORD, [userId, newHash]);
  await query(Q.REVOKE_ALL_USER_TOKENS, [userId]);

  // A OUTRA METADE DA ASSIMETRIA: o reset PELO ADMINISTRADOR emitia `PASSWORD_RESET` e a
  // troca pelo próprio titular não emitia nada, no único fator de autenticação da casa.
  // A ação é reusada de propósito (criar uma segunda para o mesmo fato partiria a
  // história de uma senha em duas listas que não se cruzam), e `self` discrimina.
  //
  // `details` NÃO CARREGA SENHA NENHUMA, nem o nome dos campos: aqui os nomes dos campos
  // seriam `currentPassword`/`newPassword`, que não informam nada e convidam a próxima
  // revisão a "melhorar" pondo os valores.
  await createAudit(req, {
    action: 'PASSWORD_RESET',
    actorId: userId,
    targetType: 'USER',
    targetId: userId,
    details: { self: true },
  });

  return { success: true };
}

/**
 * Pede a troca do e-mail da PROPRIA conta. Nada muda na linha da conta aqui: o que sai daqui e um
 * convite ao endereco NOVO, e so o clique nele troca o endereco (`verifyEmail`, no modulo de auth).
 *
 * AS QUATRO DECISOES DESTE FLUXO, todas medidas contra o que o servidor ja faz:
 *
 *  1. RE-VERIFICACAO, SEM PASSAR PELA CONTA. O endereco pretendido fica no TOKEN
 *     (`email_verification_tokens.new_email`), nunca em `users.email`. Escrever o endereco novo
 *     na conta e zerar `email_verified` seria o caminho curto e teria um custo real: um erro de
 *     digitacao trancaria a pessoa FORA da propria conta na hora (o gate de `login()` recusa
 *     `email && !email_verified`) e so um administrador a tiraria de la. Do jeito que esta, uma
 *     troca mal digitada nao custa nada: a conta segue com o endereco antigo, confirmado.
 *
 *  2. A SESSAO NAO E TOCADA, nem no pedido nem na confirmacao, e a assimetria com a troca de
 *     SENHA e deliberada. A credencial de entrada e (username, senha), e nenhum dos dois muda
 *     aqui; `sessions_valid_from` existe para cortar sessao quando a credencial cai, e derrubar
 *     as sessoes por uma troca de endereco puniria a operacao correta sem fechar ataque nenhum
 *     (quem esta dentro ja esta dentro). O que protege este fluxo de uma sessao sequestrada e a
 *     senha atual, cobrada abaixo, e o aviso que sai para o endereco ANTIGO nao existe hoje: fica
 *     dito como o proximo passo, e nao como algo que ja acontece.
 *
 *  3. E-MAIL JA EM USO NAO VOLTA NA RESPOSTA. O desfecho e o MESMO 200 dos dois lados, e a
 *     colisao viaja so para a caixa que a possui (`sendEmailInUseNotice`). E a mesma decisao
 *     anti-enumeracao de `register` (clausula 5.6), e ela continua valendo com o chamador
 *     autenticado: hoje nenhuma rota deste servidor responde "existe conta com este e-mail?" para
 *     uma conta comum, e um 409 aqui seria a primeira.
 *
 *  4. NADA E RESERVADO. O endereco pretendido nao vira posse de ninguem enquanto o token estiver
 *     de pe: a unicidade e conferida aqui e DE NOVO no resgate. E por isso que esta rota nao
 *     acrescenta um cativeiro novo ao que a clausula 10.6 ja aceita.
 *
 * @param {string} userId - O titular (sempre o proprio chamador).
 * @param {{ email: string, currentPassword: string }} data
 * @param {object} [req] - Express req (ip/user-agent da trilha e origem do link).
 * @param {string} [origin] - Origem da requisicao, honrada so quando confiavel.
 * @returns {Promise<{ success: true }>} Identico nos dois desfechos.
 */
export async function requestEmailChange(userId, data, req = null, origin = '') {
  const { rows } = await query(Q.FIND_USER_FOR_EMAIL_CHANGE, [userId]);
  const user = rows[0];
  if (!user) {
    throw new NotFoundError('User');
  }

  // A SENHA ATUAL E A PROVA, e ela e cobrada ANTES de qualquer ramo: o e-mail e o canal de
  // recuperacao da conta, entao trocar o endereco a partir de uma sessao aberta e sem mais nada
  // entrega a conta inteira a quem apanhar um navegador destrancado. Mesma exigencia, e mesma
  // razao, de `updatePassword`.
  const senhaConfere = await bcrypt.compare(data.currentPassword, user.password_hash);
  if (!senhaConfere) {
    throw new UnauthorizedError('A senha atual está incorreta.');
  }

  const novoEmail = normalizaEmail(data.email);
  if (!novoEmail) {
    throw new BadRequestError('Informe um e-mail válido.');
  }

  // O PROPRIO ENDERECO NAO E COLISAO, e recusar aqui e certo: dizer "ja esta em uso" sobre o
  // e-mail que a pessoa JA tem nao revela nada a ninguem e evita um convite inutil. O caso
  // legitimo vizinho (endereco igual, ainda nao confirmado) tem rota propria e anonima,
  // `POST /auth/resend-verification`.
  if (mesmoEmail(novoEmail, user.email ?? null)) {
    throw new BadRequestError('Este já é o e-mail da sua conta.');
  }

  const { rows: emUso } = await query(CHECK_EMAIL_EXISTS_EXCLUDING, [novoEmail, userId]);

  if (emUso.length > 0) {
    // BEST-EFFORT, e pelo motivo mais afiado do arquivo: este envio existe SO neste ramo, entao
    // uma excecao escapando daqui responderia 500 para um endereco tomado e 200 para um livre,
    // reabrindo por excecao o oraculo que a resposta uniforme fecha. Mesma contencao de
    // `register`.
    try {
      await sendEmailInUseNotice({ to: novoEmail, appLink: buildAppLink(origin) });
    } catch (err) {
      logger.error({ err }, 'E-mail-in-use notice failed (nothing was changed)');
    }
  } else {
    await issueAndSendEmailChange(user, novoEmail, origin);
  }

  // A TRILHA REGISTRA O PEDIDO, e ela e a MESMA nos dois ramos, de proposito: os dois ramos
  // precisam ser indistinguiveis para o chamador, e a trilha so e lida por quem administra. O
  // endereco pretendido NAO entra na linha, nem por impressao: ele ainda nao e um fato da conta,
  // e a confirmacao vai gravar a troca de verdade (`email` e regime de IMPRESSAO no de-para,
  // `utils/audit-diff.js`).
  //
  // BEST-EFFORT pelo mesmo motivo do envio acima: uma falha de trilha que virasse 500 sairia de
  // um ramo so se fosse bloqueante em qualquer ponto assimetrico. Aqui ela e simetrica, e o
  // best-effort e o que garante que continue sendo, aconteca o que acontecer com a tabela.
  await createAuditBestEffort(req, {
    action: 'USER_UPDATE',
    actorId: userId,
    targetType: 'USER',
    targetId: userId,
    targetName: user.nome,
    details: { self: true, fields: ['email'], emailChangeRequested: true },
  });

  return { success: true };
}

/**
 * Searches users by name or username.
 */
/**
 * Escapes the LIKE wildcards so the search is LITERAL.
 *
 * Not SQL injection — the value travels as $1 — but PATTERN injection: a `%` or `_`
 * typed by the user acquired wildcard meaning. It broke ordinary searches (usernames
 * here routinely contain `_`, e.g. the `share_owner` fixtures) and turned `q = '%%'`
 * into a full-table scan bounded only by LIMIT 20. Backslash is escaped first, or it
 * would double-escape the escapes that follow.
 */
function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function searchUsers(searchQuery) {
  const pattern = `%${escapeLike(searchQuery)}%`;
  const { rows } = await query(Q.SEARCH_USERS, [pattern]);
  return rows;
}

// ============================================
// Admin functions
// ============================================

/**
 * Lists all users (admin only).
 */
export async function listUsers(includeInactive = false) {
  const queryStr = includeInactive ? Q.LIST_ALL_USERS : Q.LIST_ACTIVE_USERS;
  const { rows } = await query(queryStr);
  return rows;
}

/**
 * Gets a user by ID (admin view - includes inactive users).
 */
export async function getUserById(userId) {
  const { rows } = await query(Q.FIND_USER_BY_ID_ADMIN, [userId]);

  if (rows.length === 0) {
    throw new NotFoundError('User');
  }

  return rows[0];
}

/**
 * Creates a new user (admin only).
 */
export async function createUser(data, req = null, actorId = null) {
  // Check if username already exists
  const { rows: existing } = await query(Q.CHECK_USERNAME_EXISTS, [data.username]);
  if (existing.length > 0) {
    throw new ConflictError('Nome de usuário já existe.');
  }

  // Hash password
  const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);

  // A auditoria participa da MESMA transação da escrita: ou a conta existe e há
  // linha de trilha, ou nenhuma das duas coisas. `USER_CREATE` está reservado no
  // CHECK de `audit_trail.action` (`002_auditoria.sql`) e não tinha emissor
  // nenhum — filtro que por construção nunca casa se lê como "nada aconteceu",
  // não como "nunca foi ligado", que é a forma mais silenciosa de lacuna.
  return tx(async (t) => {
    const criado = await t.one(Q.INSERT_USER_ADMIN, [
      data.username,
      passwordHash,
      data.nome,
      data.rank_id || null,
      data.organization_id || null,
      data.role || 'user',
      // O bicondicional ja foi cobrado pelo Joi da criacao (onde o corpo e completo
      // e o `when` alcanca os dois lados); aqui basta normalizar '' para null.
      uuidOuNulo(data.producer_org_id),
    ]);

    if (actorId) {
      await createAudit(req, {
        action: 'USER_CREATE', actorId, targetType: 'USER',
        targetId: criado.id, targetName: criado.nome,
        // O papel criado é o dado que interessa numa revisão: uma conta nascida
        // 'admin' é o evento que se quer achar depois.
        details: {
          role: criado.role,
          organization_id: criado.organization_id,
          producer_org_id: criado.producer_org_id,
        },
      }, t);
    }

    return criado;
  });
}

/**
 * Updates a user (admin only).
 */
export async function updateUser(userId, data, actingUserId = null, req = null) {
  // Check if user exists
  const existing = await getUserById(userId);

  // Self-guard (defense-in-depth alongside the UI): an admin cannot deactivate or demote their OWN
  // account — that is a last-admin lockout the disabled "Desativar" button is meant to prevent.
  if (actingUserId && userId === actingUserId) {
    if (data.is_active === false) {
      throw new ConflictError('Você não pode desativar a própria conta.');
    }
    if (data.role && data.role !== 'admin' && existing.role === 'admin') {
      throw new ConflictError('Você não pode remover seu próprio papel de admin.');
    }
  }

  // Desativar por PUT era uma porta dos fundos. `deleteUser` (a rota de
  // desativação) roda três coisas que este caminho não roda: conta os atlas do
  // usuário e EXIGE um destinatário antes de soltar a posse, audita, e revoga os
  // refresh tokens. O PUT escrevia `is_active` direto no UPDATE, então desmarcar
  // o checkbox "Ativo" do formulário de edição (`frontend/src/js/admin/users-tab.js:357`)
  // desativava a conta deixando os atlas dela órfãos — donos inativos são
  // recusados no middleware `auth`, e só um admin global consegue mexer neles
  // depois. É exatamente o estado que o ConflictError de `deleteUser` existe para
  // impedir, alcançado pela porta ao lado.
  //
  // Recusar é a correção certa e não "faltou implementar a guarda aqui": o PUT não
  // tem como receber o destinatário da transferência, então não existe forma de
  // ele completar a operação com segurança. Reativar (`is_active: true`) segue
  // livre, e reenviar `false` para quem JÁ está inativo não é transição e passa —
  // senão editar o nome de um usuário inativo quebraria.
  if (data.is_active === false && existing.is_active) {
    throw new ConflictError(
      'Desative pela ação de desativação, não pela edição: ela exige um destinatário para os atlas do usuário e revoga as sessões dele.'
    );
  }

  // If changing username, check it's not taken
  if (data.username && data.username.toLowerCase() !== existing.username.toLowerCase()) {
    const { rows: usernameCheck } = await query(Q.CHECK_USERNAME_EXISTS_EXCLUDING, [data.username, userId]);
    if (usernameCheck.length > 0) {
      throw new ConflictError('Nome de usuário já existe.');
    }
  }

  // O par (papel, escopo) e resolvido ANTES do UPDATE, sobre o estado efetivo: o
  // corpo e parcial, e so a mistura dele com a linha existente diz se a conta vai
  // terminar com cracha sem escopo ou escopo sem cracha.
  const escopo = resolveProducerScope(data, existing);

  // O E-MAIL, pelo mesmo metodo e pela mesma razao: a decisao depende de comparar o valor
  // NOVO com o da LINHA, e o Joi so enxerga o corpo.
  const emailAlvo = resolveAdminEmail(data, existing);
  if (emailAlvo.provided && emailAlvo.email) {
    const { rows: emailCheck } = await query(CHECK_EMAIL_EXISTS_EXCLUDING, [emailAlvo.email, userId]);
    // 409 COM O MOTIVO, e nao a resposta uniforme do auto-servico: quem chama aqui e
    // administrador, ja le a lista inteira de contas com e-mail em `GET /users`, e esconder
    // dele a colisao so produziria um salvamento que nao salva. O anti-enumeracao da clausula
    // 5.6 protege quem NAO tem essa leitura.
    if (emailCheck.length > 0) {
      throw new ConflictError('Este e-mail já está em uso por outra conta.');
    }
  }

  return tx(async (t) => {
    const rows = await t.any(Q.UPDATE_USER_ADMIN, [
      userId,
      data.username || null,
      data.nome || null,
      data.rank_id === '' ? null : (data.rank_id ?? null),
      data.rank_id !== undefined,
      data.organization_id === '' ? null : (data.organization_id ?? null),
      data.organization_id !== undefined,
      escopo.role,
      data.is_active !== undefined ? data.is_active : null,
      emailAlvo.verified,
      escopo.producerOrgId,
      escopo.producerProvided,
      emailAlvo.email,
      emailAlvo.provided,
    ]);

    if (rows.length === 0) {
      throw new NotFoundError('User');
    }
    const atualizado = rows[0];

    if (actingUserId) {
      // ROLE_CHANGE é emitido À PARTE de USER_UPDATE, e não como um detalhe dele:
      // promoção a admin é o evento que uma revisão procura primeiro, e procurar
      // por ação é o que o índice `idx_audit_action` serve. Os dois valores vão
      // no detalhe — mudança de nível só é auditável se disser DE ONDE veio, que
      // é a mesma lição do `previous_permission` da auditoria de sharing.
      const mudouPapel = data.role && data.role !== existing.role;
      if (mudouPapel) {
        await createAudit(req, {
          action: 'ROLE_CHANGE', actorId: actingUserId, targetType: 'USER',
          targetId: userId, targetName: atualizado.nome,
          details: { from: existing.role, to: atualizado.role },
        }, t);
      }

      // PRODUCER_SCOPE_CHANGE é ação PRÓPRIA, e não um detalhe de ROLE_CHANGE, por
      // uma razão que o CHECK `users_producer_scope_check` torna concreta: transferir um
      // produtor de uma OM para outra é mudança de ESCOPO sem mudança de PAPEL, e
      // nesse evento não existe ROLE_CHANGE nenhum para carregar o detalhe. Como
      // `producer_org_id` decide todo recurso que a conta MANTÉM, isso ficaria sem
      // nada para filtrar — que é o mesmo buraco de LOGIN/ATLAS_DELETE, só que
      // silencioso desde o primeiro dia.
      //
      // A comparação é contra a LINHA GRAVADA (`atualizado`), nunca contra o corpo
      // do request: rebaixar de Produtor limpa o escopo como EFEITO (o serviço
      // resolve o par), sem `producer_org_id` no corpo, e comparar com o corpo
      // perderia exatamente essa revogação.
      if ((existing.producer_org_id ?? null) !== (atualizado.producer_org_id ?? null)) {
        await createAudit(req, {
          action: 'PRODUCER_SCOPE_CHANGE', actorId: actingUserId, targetType: 'USER',
          targetId: userId, targetName: atualizado.nome,
          details: {
            from: existing.producer_org_id ?? null,
            to: atualizado.producer_org_id ?? null,
            role: atualizado.role,
          },
        }, t);
      }

      // O DE-PARA (cláusula 9.3), sobre a LINHA LIDA e a LINHA GRAVADA, nunca sobre o
      // corpo do request: rebaixar de Produtor limpa o escopo como EFEITO, e comparar
      // com o corpo perderia exatamente a mudança que mais importa. As duas projeções
      // são a MESMA (`FIND_USER_BY_ID_ADMIN` e o SELECT final de `UPDATE_USER_ADMIN`),
      // então nenhum campo aparece como mudado só por existir de um lado.
      //
      // A REGRA ANTIGA ("só os nomes dos campos") continua sendo o PISO e não sumiu:
      // `fields` viaja junto, e o que a lista de `audit-diff.js` não classifica entra
      // por nome, sem valor. O que mudou é que `role` e `producer_org_id`, que decidem
      // TODO recurso que a conta mantém e derrubam concessão viva ao mudar, passam a
      // dizer o que virou o quê; e `nome`/`username`/`email` entram por IMPRESSÃO, que
      // responde "voltou ao que era?" sem gravar dado pessoal para sempre.
      const dePara = diffAuditavel(existing, atualizado);
      const oDeParaDisseAlgo = dePara.mudou.length > 0 || dePara.outros.length > 0;
      const campos = Object.keys(data).filter((k) => k !== 'role');
      // O TERCEIRO DISJUNTO É NOVO, e sem ele a família ficaria fechada em todo lugar
      // menos no campo mais importante: um PUT que traga SÓ `role` tem `campos` vazio e
      // `mudouPapel` verdadeiro, então nenhuma linha de `USER_UPDATE` nascia e o de-para
      // não tinha onde morar. `ROLE_CHANGE` continua sendo a ação que se FILTRA (é ela
      // que o índice `idx_audit_action` serve); esta é a linha que diz o estado inteiro
      // da conta antes e depois, e a redundância entre as duas é a mesma que o catálogo
      // já carrega entre `fields` e o de-para.
      if (campos.length > 0 || !mudouPapel || oDeParaDisseAlgo) {
        await createAudit(req, {
          action: 'USER_UPDATE', actorId: actingUserId, targetType: 'USER',
          targetId: userId, targetName: atualizado.nome,
          details: { fields: campos, ...dePara },
        }, t);
      }
    }

    // O REBAIXAMENTO DERRUBA O QUE A PESSOA CONCEDEU (decisao do dono, 2026-08-21).
    //
    // E O IRMAO DE D8(b) NO OUTRO ATO: la a autoridade morre com a CONTA, aqui ela morre
    // com o CRACHA. Ate esta linha, `fn_principal_vivo(g.granted_by)` era a unica coisa
    // que reavaliava a raiz depois de criada, e ela pergunta se a conta esta ATIVA, nunca
    // se a autoridade continua de pe: um administrador rebaixado a `user`, ou um produtor
    // que perdeu a OM, seguia com conta ativa e com todo o acervo privado que distribuiu
    // vivo por ate um ano. `tests/integration/produtor-concede-de-raiz.test.js` media essa
    // lacuna como comportamento; agora mede o contrario, e um caso por SQL cru continua la
    // para separar o PREDICADO (que nao mudou) deste GANCHO (que e quem derruba).
    //
    // A COMPARACAO E ANTES x LINHA GRAVADA, nunca contra o corpo da requisicao, pela mesma
    // razao que `PRODUCER_SCOPE_CHANGE` acima: rebaixar de Produtor limpa o escopo como
    // EFEITO (`resolveProducerScope` resolve o par), sem `producer_org_id` no corpo, e
    // comparar com o corpo perderia exatamente essa perda.
    //
    // NA MESMA TRANSACAO, com o `t` passado adiante: se o UPDATE der rollback, a poda
    // volta junto — senao a conta continua com o papel antigo e o acesso que ela concedeu
    // teria desaparecido.
    //
    // NAO E GATEADA POR `actingUserId`, e a diferenca com o bloco de auditoria acima e
    // deliberada: uma revogacao nao pode depender de haver ou nao quem auditar. Este
    // caminho tem SEMPRE um administrador autenticado (`auth` + `requireAdmin` na rota);
    // se um chamador futuro omitir o ator, `audit_trail.actor_id` e NOT NULL e a
    // transacao inteira falha em voz alta, que e a direcao certa do erro — nunca podar
    // sem deixar registro.
    //
    // O EFEITO VOLTA NA RESPOSTA, e nao so na trilha. Ate 2026-08-23 este PUT devolvia a
    // linha atualizada e mais nada: a tela dizia "Usuario atualizado." depois de ter
    // destruido N concessoes, e o administrador nao tinha como saber. Os numeros sao os
    // que `podarPorRaizes` ja devolve, propagados pelas MESMAS chaves do irmao que ja faz
    // isso certo (`deleteGroup`, em `access-groups.service.js`): `grantsAffected` conta a
    // poda inteira (raizes mais descendentes) e `grantsReparented` conta quem MANTEVE o
    // acesso por outro caminho, com prazo igual ou aparado. Sem o segundo, um
    // `grantsAffected` menor que o esperado parece poda incompleta.
    //
    // ELES VIAJAM SEMPRE, com zero quando nao houve poda: a tela precisa distinguir
    // "nenhuma caiu" de "o servidor nao me disse", e um campo que so aparece as vezes faz
    // as duas coisas terem a mesma cara do lado do cliente.
    const fundamentoPerdido = fundamentoDeRaizPerdido(existing, atualizado);
    const efeitoDaPoda = { grantsAffected: 0, grantsReparented: 0, fundamentoPerdido };
    if (fundamentoPerdido) {
      const raizes = await t.any(LIVE_GRANT_IDS_BY_GRANTER, [userId]);
      // `origem` E O QUE SEPARA ISTO DE UMA REVOGACAO DELIBERADA na trilha, no espirito
      // de `USER_DELETE`/`ACCESS_GROUP_DELETE`: sem ela, a leitura seria "o administrador
      // X revogou 40 concessoes que ele nunca deu", e nada explicaria a autoridade dele
      // para isso. Ela e detalhe (`details.origem`), nao `action`: as acoes emitidas
      // continuam sendo `PERMISSION_REVOKE`/`PERMISSION_REPARENT`, que ja estao no CHECK
      // de `audit_trail.action` e no censo — nao ha valor novo de CHECK, logo nao ha
      // migracao. O fundamento perdido nao entra aqui de proposito: quem quer saber O QUE
      // mudou tem `ROLE_CHANGE`/`PRODUCER_SCOPE_CHANGE` na MESMA transacao, com from/to.
      const { revoked, reparented, trimmed } = await podarPorRaizes({
        raizes, actor: { id: actingUserId }, req, trx: t, origem: 'USER_DEMOTION',
      });
      efeitoDaPoda.grantsAffected = revoked.length;
      efeitoDaPoda.grantsReparented = reparented.length + trimmed.length;
    }

    return { ...atualizado, ...efeitoDaPoda };
  });
}

/**
 * Resets a user's password (admin only).
 */
export async function resetPassword(userId, newPassword, req = null, actorId = null) {
  // Check if user exists
  const alvo = await getUserById(userId);

  // Hash new password
  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  // Tudo na MESMA transação: trocar a senha, matar as sessões antigas e registrar.
  // Antes a revogação era uma segunda query solta — uma falha entre as duas
  // deixava senha nova com sessões velhas ainda válidas.
  return tx(async (t) => {
    const rows = await t.any(Q.RESET_USER_PASSWORD, [userId, passwordHash]);
    if (rows.length === 0) {
      throw new NotFoundError('User');
    }

    // Revoke existing refresh tokens so the old password's sessions die.
    await t.none(Q.REVOKE_ALL_USER_TOKENS, [userId]);

    if (actorId) {
      // NUNCA a senha, nem seu tamanho, nem hash: a trilha é lida por qualquer
      // admin, e senha em log já foi defeito real neste projeto (duas vezes).
      await createAudit(req, {
        action: 'PASSWORD_RESET', actorId, targetType: 'USER',
        targetId: userId, targetName: alvo.nome,
        details: { by: 'admin', sessionsRevoked: true },
      }, t);
    }

    return { success: true };
  });
}

/**
 * Deactivates a user (soft delete). Optionally transfers atlas ownership.
 * @param {string} userId - User to deactivate
 * @param {string} adminId - Admin performing the action
 * @param {string} transferToUserId - User to transfer atlas to (optional)
 */
export async function deleteUser(userId, adminId, transferToUserId = null, req = null) {
  // Can't delete yourself
  if (userId === adminId) {
    throw new ForbiddenError('Você não pode desativar a própria conta.');
  }

  // Fast-fail existence check (read) before opening the transaction.
  const user = await getUserById(userId);

  // Atomic: count atlas -> (transfer) -> soft-delete -> revoke tokens.
  // If any step fails, the whole thing rolls back (no orphaned transfer).
  return tx(async (t) => {
    const atlasCount = await t.one(Q.COUNT_USER_ATLAS, [userId]);
    const count = parseInt(atlasCount.count, 10);

    if (count > 0) {
      if (!transferToUserId) {
        throw new ConflictError(
          `O usuário possui ${count} atlas. Informe um destinatário para transferir a propriedade, senão os atlas ficariam órfãos.`
        );
      }
      // Transferring to the user being deactivated is a no-op that LOOKS like a
      // success: `TRANSFER_ATLAS_OWNERSHIP` runs `SET owner_id = $2 WHERE owner_id =
      // $1` with $1 === $2, and the target still reads is_active = true because the
      // soft delete happens further down. The service then reported N transfers that
      // never occurred, leaving a live atlas owned by an inactive account — exactly
      // what the ConflictError above exists to prevent. Nobody but a global admin
      // could act on it afterwards, since only the owner may transfer or delete an
      // atlas and an inactive owner is refused at the `auth` middleware.
      // Mirrors atlas.service.js:499, which rejects newOwnerId === currentOwnerId.
      if (transferToUserId === userId) {
        throw new ConflictError(
          'O destinatário não pode ser o próprio usuário que está sendo desativado: '
          + 'os atlas ficariam órfãos.'
        );
      }

      const target = await t.oneOrNone(Q.FIND_USER_BY_ID_ADMIN, [transferToUserId]);
      if (!target) throw new NotFoundError('User');
      if (!target.is_active) throw new ForbiddenError('Não é possível transferir o atlas para um usuário inativo.');
      // RETURNING rows -> use t.any (t.none would reject on returned rows).
      const transferred = await t.any(Q.TRANSFER_ATLAS_OWNERSHIP, [userId, transferToUserId]);

      // Drop any share the recipient already held on the atlases they just
      // inherited. Ownership comes from `owner_id` alone, but `LIST_USER_ATLAS`
      // resolves `COALESCE(s.permission, ...owner...)`, so a surviving share OUTRANKS
      // the synthesized 'owner' and the new owner is listed with their old, lesser
      // permission. The server gate stays correct (resolvePermission checks owner
      // first), but the listing lies and the frontend reads it with a closed equality
      // (`user_permission === 'owner'`), so the atlas disappears from "Meus atlas"
      // and shows as read-only under "Compartilhados".
      // Mirrors atlas.service.js:529-532, same reasoning.
      if (transferred.length > 0) {
        await t.none(Q.DELETE_SHARES_FOR_NEW_OWNER, [
          transferred.map((a) => a.id),
          transferToUserId,
        ]);
      }
    }

    const deleted = await t.oneOrNone(Q.SOFT_DELETE_USER, [userId]);
    if (!deleted) throw new NotFoundError('User');

    await t.none(Q.REVOKE_ALL_USER_TOKENS, [userId]);

    // D8(b): A AUTORIDADE MORRE COM QUEM A EXERCIA. Ate 2026-08-21 desativar quem
    // concedeu nao propagava para o que ele concedeu, e o motivo era estrutural: a
    // cascata derruba filhos quando o PAI e revogado, e a concessao de quem tem papel
    // global (ou de quem produz) e RAIZ, sem pai. Sem esta linha, desativar um
    // administrador deixava de pe todo o acervo privado que ele distribuiu, ate um ano.
    //
    // NA MESMA TRANSACAO, DEPOIS do soft-delete e de proposito: se a desativacao der
    // rollback, a poda volta junto. E ela usa `podarPorRaizes`, a MESMA cascata da
    // revogacao, entao a preservacao de alcancabilidade (D3) vale aqui igual — quem
    // alcancar o recurso por outro concedente vivo e repai-ado, nao derrubado.
    //
    // O QUE ISTO NAO FAZ: nao transfere autoridade. Reativar a conta NAO ressuscita o que
    // ela concedeu, porque `revoked_at` nao se desfaz. A consequencia foi aceita: quem
    // desativar uma conta que concedeu muito deve reconceder antes.
    const podada = await podarConcessoesDeQuemFoiDesativado({
      userId, actor: { id: adminId }, req, trx: t,
    });

    // Audit participates in the same transaction (rolls back together).
    await createAudit(req, {
      action: 'USER_DELETE', actorId: adminId, targetType: 'USER',
      targetId: userId,
      targetName: user.nome,
      details: {
        atlasTransferred: count,
        // As DUAS contagens da poda, e nao so a primeira: `grantsRevoked` responde "o que
        // caiu junto com esta conta" e `grantsReparented` responde "o que sobreviveu, e
        // por isso a conta nao derrubou tudo". Sem a segunda, um numero menor que o
        // esperado parece poda incompleta.
        grantsRevoked: podada.revoked.length,
        grantsReparented: podada.reparented.length + podada.trimmed.length,
      },
    }, t);

    return {
      success: true,
      atlasTransferred: count > 0 ? count : 0,
      grantsRevoked: podada.revoked.length,
      grantsReparented: podada.reparented.length + podada.trimmed.length,
    };
  });
}

/**
 * Atomically rotates a user's API key (old key archived to api_key_history),
 * auditing within the same transaction.
 */
export async function rotateApiKey(userId, actorId, req = null) {
  return tx(async (t) => {
    // oneOrNone (not one): a nonexistent user matches 0 rows; map that to a
    // clean 404 instead of letting pg-promise's QueryResultError surface as 500.
    const row = await t.oneOrNone(Q.ROTATE_API_KEY, [userId, actorId]);
    if (!row) throw new NotFoundError('User');
    await createAudit(req, {
      action: 'API_KEY_ROTATE',
      actorId,
      targetType: 'USER',
      targetId: userId,
    }, t);
    return { apiKey: row.api_key };
  });
}

/**
 * Reactivates a previously deactivated user.
 *
 * AUDITA, e a assimetria que isso corrige é literal: `deleteUser` (a desativação)
 * emite `USER_DELETE` desde sempre, e o ato que devolve a conta ao ar não deixava
 * nada. Meia história é pior do que nenhuma numa trilha de acesso — quem filtra por
 * `USER_DELETE` conclui que a conta continua desativada.
 *
 * Uma query só, então não há transação a que aderir; a trilha vem depois do UPDATE.
 * @param {string} userId
 * @param {string|null} [actorId] - Administrador que reativou.
 * @param {object} [req]
 */
export async function reactivateUser(userId, actorId = null, req = null) {
  const { rows } = await query(Q.REACTIVATE_USER, [userId]);

  if (rows.length === 0) {
    throw new NotFoundError('User');
  }

  if (actorId) {
    await createAudit(req, {
      action: 'USER_REACTIVATE', actorId, targetType: 'USER',
      targetId: userId, targetName: rows[0].nome,
      details: { role: rows[0].role },
    });
  }

  return rows[0];
}
