// Path: src/middleware/require-admin.js
import { ForbiddenError, UnauthorizedError } from '../utils/errors.js';
import { apiKeyReaches } from '../modules/users/api-key-terms.js';

/**
 * Middleware that requires the authenticated user to have admin role.
 * Must be used after the auth middleware.
 *
 * DESDE 2026-08-24 ELE RECUSA TODA CHAVE DE API, e essa é a AMARRA 2 da cláusula 10.7,
 * na sua forma mínima: "uma chave usada para buscar tile não precisa configurar o
 * sistema".
 *
 * A RECUSA É POR CREDENCIAL, NÃO POR ESCOPO, e a diferença importa: a tabela
 * `API_KEY_SCOPE_REACH` (`modules/users/api-key-terms.js`) declara `administracao:
 * false` em TODA linha, então não existe escopo que passe daqui, nem o legado, nem um
 * que alguém acrescente sem reler aquela tabela. Ler o alcance em vez de escrever
 * `return 403` é o que obriga quem criar o próximo escopo a responder a pergunta.
 *
 * A ORDEM É DELIBERADA: a recusa vem ANTES da checagem de papel. Com ela depois, a
 * mensagem de erro do administrador com chave seria a de papel insuficiente, que é
 * falsa e manda a pessoa procurar o problema no lugar errado.
 *
 * A FRASE DA RECUSA NOMEIA A CREDENCIAL, e não o papel, porque quem chegou aqui pode
 * ser um administrador legítimo: o que falta é a sessão, não o posto.
 */
export function requireAdmin(req, res, next) {
  // No credential is an authentication problem (401), not authorization (403).
  if (!req.user) {
    return next(new UnauthorizedError('Authentication required'));
  }

  if (req.authVia === 'api_key' && !apiKeyReaches(req.user.apiKeyScope, 'administracao')) {
    return next(new ForbiddenError(
      'Uma chave de API não configura o sistema: esta rota exige uma sessão autenticada'
    ));
  }

  if (req.user.role !== 'admin') {
    return next(new ForbiddenError('Admin access required'));
  }

  next();
}
