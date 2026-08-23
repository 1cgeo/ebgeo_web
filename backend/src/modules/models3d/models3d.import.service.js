// Path: src/modules/models3d/models3d.import.service.js
// O REGISTRO DE UMA IMPORTAÇÃO em `a3d.imports`, e a pergunta que o importador faz antes
// de começar. Substitui o `openImport`/`closeImport` do `index.db` do `ebgeo_3d`.
//
// A IMPORTAÇÃO ABRE O REGISTRO ANTES DE CONVERTER, e essa ordem é o motivo de `imports`
// não ter FK para `models`: o modelo pode não existir ainda, e o que se perderia com a FK
// é exatamente o registro das importações que NÃO terminaram, que é a pergunta que o
// histórico existe para responder ("quando este modelo entrou, de onde veio, e o que a
// conferência disse").
import { query, one } from '../../database/index.js';
import { OPEN_IMPORT_3D, CLOSE_IMPORT_3D, LAST_IMPORTS_3D, GET_MODEL_3D } from './models3d.queries.js';

/**
 * Abre o registro de uma importação.
 * @param {string} modelId
 * @param {string} sourcePath - a árvore de origem, como o operador a informou
 * @returns {Promise<number>} o id do registro, para fechá-lo depois
 */
export async function abrirImportacao(modelId, sourcePath) {
  const linha = await one(OPEN_IMPORT_3D, { modelId, sourcePath: sourcePath ?? null });
  return linha.id;
}

/**
 * Fecha o registro, com sucesso ou sem.
 *
 * Todo campo de contagem aceita null: uma importação que morreu no passo 1 não tem número
 * nenhum para dar, e inventar zero ali faria o histórico afirmar que zero tiles entraram
 * quando o que houve foi não ter chegado a contar.
 *
 * @param {Object} dados
 * @param {number} dados.id
 * @param {'ok'|'falhou'} dados.status
 * @returns {Promise<void>}
 */
export async function fecharImportacao(dados) {
  await query(CLOSE_IMPORT_3D, {
    id: dados.id,
    status: dados.status,
    tilesIn: dados.tilesIn ?? null,
    tilesOut: dados.tilesOut ?? null,
    textures: dados.textures ?? null,
    failures: dados.failures ?? null,
    seconds: dados.seconds ?? null,
    ratio: dados.ratio ?? null,
    notes: dados.notes ?? null,
  });
}

/**
 * O registro de produção de um modelo, ou null.
 *
 * SEM PREDICADO DE VISIBILIDADE, e é deliberado: quem pergunta é o importador, que roda
 * como operação local, e a pergunta é "este id já está tomado". Um modelo privado que
 * respondesse "não existe" aqui faria a importação seguinte sobrescrevê-lo sem aviso.
 * @param {string} modelId
 * @returns {Promise<Object|null>}
 */
export async function obterModelo3d(modelId) {
  const { rows } = await query(GET_MODEL_3D, [modelId]);
  return rows[0] ?? null;
}

/**
 * As últimas importações de um modelo, mais recentes primeiro.
 * @param {string} modelId @param {number} [limite=3]
 * @returns {Promise<Array<Object>>}
 */
export async function ultimasImportacoes(modelId, limite = 3) {
  const { rows } = await query(LAST_IMPORTS_3D, [modelId, limite]);
  return rows;
}
