// Path: src/modules/resource-access/resource-access.notify.js
// O AVISO AO VIVO DA PODA, num módulo que TODO podador alcança.
//
// POR QUE ELE SAIU DO CONTROLLER (M15, decisão do dono em 2026-08-24). A função morava em
// `resource-access.controller.js`, e o efeito dessa moradia era estrutural, não estético:
// `podarPorRaizes` tem CINCO chamadores e só um deles é um controller de resource-access.
// Os outros quatro vivem em SERVIÇOS (`podarConcessoesDeQuemFoiDesativado` aqui ao lado, o
// rebaixamento em `users.service.js`, e os dois de `access-groups.service.js`), e serviço que
// importa controller inverte a camada: o controller existe para ler `req` e escrever `res`, e
// puxá-lo de dentro de um serviço arrastaria `asyncHandler` e a borda HTTP inteira para um
// caminho que não tem requisição nenhuma. A alternativa que sobrava era copiar o corpo em
// cada podador, e a segunda cópia é a que envelhece.
//
// ENTÃO ELE É IRMÃO DO SERVIÇO, E É A FOLHA DOS DOIS. O sentido dos imports é o que o
// mantém sem ciclo: `resource-access.service.js` importa ESTE arquivo (é ele que poda), então
// este não pode importar aquele de volta. Foi por isso que `atlasesLendingResource` mudou de
// casa e mora aqui: ela existe para ENDEREÇAR SALA, que é o assunto deste módulo, e deixá-la
// no serviço obrigaria a um ciclo ou a uma segunda cópia da consulta. O serviço a REEXPORTA,
// para que o teste que já a exercita e qualquer chamador futuro não precisem saber disso.
//
// O QUE ELE NÃO É: uma etapa de `podarPorRaizes`. Ver `avisarAtlasQueEmprestam` abaixo — o
// aviso é POR TRANSAÇÃO COMMITADA, e a poda roda dentro da transação de outra pessoa.

import { query } from '../../database/index.js';
import { broadcastToRoom } from '../collab/collab.rooms.js';
import logger from '../../utils/logger.js';
import * as Q from './resource-access.queries.js';

/**
 * A pergunta inversa do empréstimo por atlas: que atlas emprestam este recurso.
 *
 * Sem transação, sem auditoria e sem gate, de propósito: o único consumidor é o aviso ao
 * vivo da poda, que precisa de ENDEREÇO DE SALA e não de autorização. Quem decide o que
 * cada receptor pode ver é o payload aditivo que ele mesmo re-pede depois do frame.
 *
 * @param {string} type - Tipo de recurso já validado pelo chamador.
 * @param {string} resourceId
 * @returns {Promise<string[]>} Ids de atlas, sem repetição.
 */
export async function atlasesLendingResource(type, resourceId) {
  const { rows } = await query(Q.ATLASES_LENDING_RESOURCE, [type, resourceId]);
  return rows.map((r) => r.atlas_id);
}

/**
 * Avisa AO VIVO as salas dos atlas que EMPRESTAM cada recurso tocado pela poda.
 *
 * O frame é `atlas_resources_updated`, reusado e não inventado: ele já é "só um aviso,
 * sem payload", e o receptor já faz exatamente o certo (re-pede o PRÓPRIO payload
 * aditivo). Como o conjunto visível é diferente por pessoa, mandar conteúdo no frame de
 * todos seria vazamento; por isso ele não carrega tipo nem id de recurso, e é isso que
 * o teste de fronteira afirma pelas chaves da mensagem.
 *
 * ENDEREÇAMENTO. A sala do atlas que empresta é o único subconjunto de afetados que os
 * frames existentes alcançam corretamente, e é onde o dano é COLETIVO (revogar a
 * concessão do dono derruba o empréstimo de todos de uma vez). O beneficiário PESSOAL ou
 * de grupo fora de um atlas que empresta continua sem push: o socket dele pode estar
 * noutra sala ou não existir. Falho ABERTO na notificação de propósito: um aviso a mais é
 * um GET a mais, um aviso a menos é o defeito.
 *
 * OS CINCO PODADORES PASSAM POR AQUI desde 2026-08-24, e antes disso só a revogação
 * deliberada passava. Os quatro que faltavam podavam calados: apagar grupo, tirar membro,
 * desativar conta (`USER_DELETE`) e REBAIXAR o papel de quem concedeu (`USER_DEMOTION`). O
 * último é o que mais custava, e a razão é aritmética: ele derruba de uma vez TUDO o que o
 * produtor ou o administrador rebaixado distribuiu, para gente que segue com o catálogo
 * antigo na tela. Descubra a lista viva com um grep por `avisarAtlasQueEmprestam`, nunca
 * por esta frase.
 *
 * CHAME-ME DEPOIS DO COMMIT, E SÓ DE QUEM É DONO DA TRANSAÇÃO. Esta é a regra que decide o
 * ponto de chamada, e ela é o motivo de o aviso NÃO estar dentro de `podarPorRaizes`:
 * aquela função roda dentro da transação de quem a chamou (`trx`), e um frame emitido ali
 * é um convite a re-pedir o payload ANTES de a escrita existir. O receptor obedeceria, leria
 * o estado velho, e nunca receberia um segundo aviso — trocando um catálogo obsoleto por um
 * catálogo obsoleto que ninguém mais vai corrigir. Um rollback depois do frame é o caso
 * benigno (um GET a mais); a corrida acima é o caso que morde. Por isso cada podador chama
 * daqui de fora, com o resultado que a transação dele devolveu.
 *
 * SÓ OS REVOGADOS ENTRAM. Quem foi REPAI-ADO ou teve o prazo aparado não perdeu acesso
 * nenhum, e acordar a sala por ele diria "algo que você via mudou" a quem nada mudou. A
 * normalização abaixo lê `revoked` nas duas formas (lista nua ou o objeto de três listas)
 * para que todo chamador possa entregar o que tem em mãos.
 *
 * O par (tipo, recurso) vem das LINHAS PODADAS e não do alvo de nenhuma rota: a subárvore
 * não é, necessariamente, de um recurso só, e nos podadores novos ela quase nunca é (apagar
 * um grupo derruba concessões espalhadas por vários recursos de uma vez).
 *
 * @param {Array|{ revoked?: Array }} podadas - O que a poda devolveu.
 * @returns {Promise<void>} Best-effort: nunca lança (a escrita já foi commitada).
 */
export async function avisarAtlasQueEmprestam(podadas) {
  const revogadas = Array.isArray(podadas) ? podadas : (podadas?.revoked ?? []);
  if (revogadas.length === 0) return;
  try {
    const pares = new Map();
    for (const linha of revogadas) {
      pares.set(`${linha.resource_type}|${linha.resource_id}`, [linha.resource_type, linha.resource_id]);
    }
    const salas = new Set();
    for (const [tipo, id] of pares.values()) {
      for (const atlasId of await atlasesLendingResource(tipo, id)) salas.add(atlasId);
    }
    // Sem `minPermission`: o frame não carrega nada que precise de nível, e um gate por
    // nível aqui deixaria de acordar justamente o Leitor, que é quem mais depende de o
    // catálogo estar certo. O aviso vale para a sala inteira.
    for (const atlasId of salas) broadcastToRoom(atlasId, { type: 'atlas_resources_updated' });
  } catch (error) {
    logger.warn({ err: error }, 'poda de concessão: falha ao avisar as salas dos atlas que emprestam');
  }
}
