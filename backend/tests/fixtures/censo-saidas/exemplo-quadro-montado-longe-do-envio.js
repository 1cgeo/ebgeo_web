// Path: tests/fixtures/censo-saidas/exemplo-quadro-montado-longe-do-envio.js
//
// FIXTURE — prova as duas formas de emissão que o recorte de presença por destinatário trouxe em
// 2026-09-22, e que a varredura 4 do censo não enxergava:
//
//   1. o quadro MONTADO numa função e serializado uma vez por classe de acesso, escrito no socket
//      depois (a forma de `src/modules/collab/collab.viewer.js`). O `type` vem ANTES do `.send(`, e
//      a janela a partir da chamada não o alcança: só a regra do módulo do socket o vê;
//   2. o quadro entregue a `difundirRecortado`, o emissor novo do módulo de salas, que a janela vê
//      desde que o nome esteja na lista de emissores.
//
// Nunca é importada nem executada: o censo só a lê.

import { difundirRecortado } from '../../../src/modules/collab/collab.rooms.js';

function quadroMontadoLonge(par, podeVer) {
  return {
    type: 'quadro_montado_sem_classificacao',
    userId: par.userId,
    recurso: podeVer ? par.recurso : null,
  };
}

export function enviaPorClasse(destinatarios, par, permitidos) {
  const completo = JSON.stringify(quadroMontadoLonge(par, true));
  const oculto = JSON.stringify(quadroMontadoLonge(par, false));
  for (const client of destinatarios) {
    client.send(permitidos.has(client) ? completo : oculto);
  }
}

export async function difundeSemClassificacao(ws, recurso) {
  await difundirRecortado(ws, { type: 'difundido_sem_classificacao', userId: ws.userId }, recurso, (m) => m);
}
