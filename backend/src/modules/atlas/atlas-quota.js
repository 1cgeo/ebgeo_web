// Path: src/modules/atlas/atlas-quota.js

/**
 * @fileoverview OS DOIS TETOS DE RECURSO DO ATLAS (decisão D12 de 2026-09-14, em
 * `docs/decisions/decisions-2026.md`): quantos atlas VIVOS uma conta pode ter, e quantos mapas um
 * `.ebgeo` pode trazer numa importação. Era o último limite de recurso sem dono depois do teto de
 * sockets por principal.
 *
 * POR QUE ESTE ARQUIVO EXISTE em vez de dois `if` dentro de `atlas.service.js`: os três caminhos
 * que criam atlas (`createAtlas`, `importAtlas`, `cloneAtlas`) precisam da MESMA pergunta e da
 * MESMA frase, e três cópias da frase é como duas telas do mesmo produto passam a dizer números
 * diferentes sobre o mesmo teto. As frases também ficam testáveis sem banco.
 *
 * A COTA É POR CONTA, NUNCA POR PAPEL, e o administrador global NÃO fica isento. No eixo de
 * consumo de disco ele é uma conta como as outras; isentá-lo seria misturar o eixo GLOBAL (que
 * não é uma escada) com o de consumo. A alternativa recusada na decisão foi cota por OM: a
 * lotação é auto-declarada no cadastro e não autoriza nada, então uma cota por OM se contorna
 * trocando a lotação.
 *
 * O QUE A CONTAGEM CONTA, e cada recorte é uma decisão: atlas VIVO (`deleted_at IS NULL`, de modo
 * que mover para a lixeira LIBERA a vaga, que é o que a frase manda fazer) de que a conta é DONA
 * (`owner_id`, porque quem responde pelo espaço de um atlas compartilhado é o dono dele, e não
 * cada membro).
 *
 * O QUE ELE NÃO É: uma invariante serializada. A contagem roda dentro da transação de criação,
 * mas duas criações CONCORRENTES da mesma conta leem a mesma contagem e as duas passam, de modo
 * que uma rajada pode estourar o teto pelo número de pedidos em voo. Isso é aceito: o teto existe
 * para limitar crescimento sem dono, não para ser uma fronteira de segurança, e serializar por
 * conta cobraria contenção em toda criação para comprar uma exatidão que ninguém observa. Está
 * escrito aqui para que a próxima leitura não o trate como defeito.
 *
 * ZERO DESLIGA os dois tetos (`config.atlas`), que é a válvula de reverter sem deploy.
 */

import config from '../../config.js';
import { QuotaExceededError, BadRequestError } from '../../utils/errors.js';
import * as Q from './atlas.queries.js';

/**
 * A frase da cota, em pt-BR, nomeando o número que o servidor de fato usou.
 *
 * Ela diz o que FAZER, e a ação nomeada é a que funciona: a lixeira não conta, então mover um
 * atlas para lá libera a vaga na hora. "Peça a um administrador" seria falso, porque não há rota
 * que levante a cota de uma conta; o que existe é a variável de ambiente da instalação.
 * @param {number} count - atlas vivos que a conta já tem
 * @param {number} max - o teto em vigor
 * @returns {string}
 */
export function atlasQuotaNotice(count, max) {
  return `Você já tem ${count} atlas, e o máximo por conta é ${max}. `
    + 'Mova algum para a lixeira antes de criar outro: o que está na lixeira não ocupa vaga.';
}

/**
 * A frase do teto de mapas por importação, em pt-BR.
 *
 * Diferente da de cima, esta fala do ARQUIVO e não da conta, e a ação que ela nomeia é sobre o
 * arquivo: nada que a pessoa apague no servidor faz este `.ebgeo` caber.
 * @param {number} count - mapas que o arquivo traz
 * @param {number} max - o teto em vigor
 * @returns {string}
 */
export function importMapsNotice(count, max) {
  return `Este arquivo traz ${count} mapas, e o máximo por importação é ${max}. `
    + 'Divida-o em arquivos menores e importe um de cada vez.';
}

/**
 * Recusa a criação de mais um atlas quando a conta já bateu o teto.
 *
 * Recebe o executor da transação (`t`) porque as três chamadas acontecem DENTRO da transação que
 * cria o atlas: perguntar fora dela deixaria uma janela entre a resposta e a escrita, e a
 * pergunta é barata (uma contagem sobre o índice de `owner_id`).
 * @param {Object} t - executor de transação (pg-promise)
 * @param {string} userId - o dono que o atlas vai ter
 * @throws {QuotaExceededError} 429, com a frase que nomeia o teto
 */
export async function assertAtlasQuota(t, userId) {
  const max = config.atlas.maxPerAccount;
  if (!(max > 0)) return; // zero DESLIGA; NaN nunca chega aqui (NUMERIC_ENV_RULES recusa no boot)
  const { total } = await t.one(Q.COUNT_LIVE_OWNED_ATLAS, [userId]);
  const count = parseInt(total, 10);
  if (count >= max) {
    throw new QuotaExceededError(atlasQuotaNotice(count, max));
  }
}

/**
 * Recusa uma importação cujo arquivo traga mapas demais.
 *
 * NÃO é 429: o 429 desta família significa "a sua CONTA já tem demais", e esperar ou apagar não
 * muda nada aqui — o pedido é grande demais em si mesmo, o que é um 400. A recusa acontece ANTES
 * de qualquer escrita, e antes da transação, porque não precisa do banco para nada.
 * @param {Array} maps - a lista de mapas do payload
 * @throws {BadRequestError} 400, com a frase que nomeia o teto
 */
export function assertImportMapCeiling(maps) {
  const max = config.atlas.importMaxMaps;
  if (!(max > 0)) return; // zero DESLIGA
  const count = Array.isArray(maps) ? maps.length : 0;
  if (count > max) {
    throw new BadRequestError(importMapsNotice(count, max));
  }
}
