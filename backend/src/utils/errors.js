// Path: src/utils/errors.js
//
// LANGUAGE CONTRACT. `message` is HUMAN text and ships in pt-BR: the web client folds
// it straight into what the user reads (`buildApiErrorMessage`,
// frontend/src/js/store/sync/api-client.js), so an English default put English on a
// Brazilian user's screen. `code` is a MACHINE identifier and stays English forever —
// clients branch on it, so translating it would break them.
//
// The defaults below are what every `new XError()` WITHOUT an argument emits, which is
// why translating this one file moves many call sites at once.
//
// WORDING RULE: prefer a sentence that says what to DO. Where the class covers many
// unrelated causes (403, 400, the generic 422 headline) the text stays deliberately
// vague, because a message that names the WRONG cause is worse than one that names none.
//
// NOT TRANSLATED HERE, ON PURPOSE: `NotFoundError`'s `${resource} not found`. Its
// resource comes from ~98 call sites as an English noun ('Atlas', 'Photo', 'User'),
// so translating only the template yields 'Photo não encontrado' — half English, and
// with the wrong gender for every feminine noun. That one needs a resource-label table
// and is a separate, larger change.

export class AppError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true; // Expected errors (vs programming bugs)
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Você não tem permissão para esta ação.') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Faça login para continuar.') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflito com o estado atual. Recarregue a página e tente de novo.') {
    super(message, 409, 'CONFLICT');
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Falha na validação', details = null) {
    super(message, 422, 'VALIDATION_ERROR');
    this.details = details;
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Requisição inválida.') {
    super(message, 400, 'BAD_REQUEST');
  }
}

/**
 * 503 — sobrecarga TRANSITÓRIA: o cliente deve tentar de novo.
 * Distinto do 500: nada quebrou, o recurso só está temporariamente ocupado
 * (ex.: o advisory lock por atlas do push de sync estourou o `lock_timeout`).
 */
export class ServiceUnavailableError extends AppError {
  constructor(message = 'Serviço temporariamente indisponível. Tente novamente em instantes.') {
    super(message, 503, 'SERVICE_UNAVAILABLE');
  }
}
