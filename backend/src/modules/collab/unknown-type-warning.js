// Path: src/modules/collab/unknown-type-warning.js
//
// UM AVISO POR TIPO DESCONHECIDO, POR SOCKET. Decisão PURA (sem logger, sem `ws`, sem import
// nenhum), para que a borda do roteador de mensagens fique com uma linha de efeito e o
// comportamento inteiro seja testável em node.
//
// O DEFEITO QUE ISTO FECHA É DE VOLUME, e ele nasceu de uma remoção legítima. Em 2026-09-21 o
// quadro de presença da linha do tempo saiu dos dois pacotes (o instante de uma pessoa não se
// propaga). A fila de saída do cliente é append-only e uma aba carregada ANTES do deploy segue
// mandando aquele quadro a cada mudança de cursor da régua, cerca de doze por segundo em
// reprodução. O `default` do roteador escrevia UMA LINHA DE LOG POR QUADRO, por cliente, no
// arquivo do dia: o cliente antigo, que o contrato manda tolerar, virava um gerador de log. O
// aviso continua existindo (tipo desconhecido é informação), mas passa a sair uma vez.
//
// AS DUAS BORDAS, e nenhuma é hipotética, porque `data.type` vem do cliente e é ARBITRÁRIO:
//
//   1. O CONJUNTO TEM TETO (`MAX_TIPOS_POR_SOCKET`). Sem ele, um cliente que sorteasse o tipo a
//      cada quadro trocaria volume de LOG por volume de MEMÓRIA, que é a troca pior: o log tem
//      rodízio diário e o conjunto vive enquanto o socket viver. Estourado o teto sai UM último
//      aviso e o silêncio é definitivo para aquele socket. O sentinela `TETO_ATINGIDO` é um
//      Symbol de propósito: ele mora no mesmo conjunto (nada de segunda estrutura a manter em
//      sincronia) e não pode colidir com rótulo nenhum, porque rótulo é sempre string.
//   2. O RÓTULO TEM TAMANHO (`MAX_CHARS_DO_TIPO`) E TIPO NÃO-STRING COLAPSA. Guardar o valor cru
//      poria uma string de megabytes no conjunto e na linha de log; e um número, um objeto ou um
//      booleano diferentes a cada quadro gastariam uma vaga cada. Colapsar por `typeof` gasta UMA
//      vaga para todos eles, que é o que fecha o vetor. O preço está declarado: dois tipos-string
//      que só diferem DEPOIS do corte compartilham a vaga, e o segundo não é avisado.
//
// O QUE ESTE MÓDULO NÃO FAZ, e a ausência é o contrato (dono, 2026-09-21): não responde ao
// remetente, não fecha o socket e não conhece tipo nenhum em particular. Tipo desconhecido é
// TOLERADO por desenho, porque é assim que um cliente à frente ou atrás do servidor se comporta.

/**
 * Quantos tipos desconhecidos DISTINTOS um socket pode fazer o servidor registrar.
 *
 * Dezesseis é generoso para o caso legítimo (um cliente de outra versão manda um punhado de tipos
 * que este servidor não conhece) e barato para o caso hostil: o custo máximo por socket é este
 * número vezes `MAX_CHARS_DO_TIPO`, isto é, cerca de um kilobyte.
 */
export const MAX_TIPOS_POR_SOCKET = 16;

/** Tamanho máximo do rótulo que vai para o log E para o conjunto, o corte incluído. */
export const MAX_CHARS_DO_TIPO = 64;

/**
 * Sentinela de "este socket já gastou o teto". Symbol, nunca string, para que nenhum valor que um
 * cliente consiga enviar o produza por acidente.
 */
export const TETO_ATINGIDO = Symbol('teto de tipos desconhecidos avisados neste socket');

/** Mensagem do primeiro aviso de um tipo. */
export const MSG_TIPO_DESCONHECIDO = 'Unknown message type';

/** Mensagem do último aviso de um socket, quando o teto de tipos distintos estoura. */
export const MSG_TETO_DE_TIPOS = 'Unknown message type: per-socket warning cap reached, silencing';

/**
 * O rótulo com que um `data.type` qualquer entra no log e no conjunto.
 *
 * As formas não-string colapsam num rótulo por `typeof` (e não no valor) porque é isso que impede
 * um cliente de gastar uma vaga por quadro mandando `1`, `2`, `3`. String vazia ganha rótulo
 * próprio para não virar uma linha de log com o campo em branco, que se lê como defeito do
 * servidor e não como quadro malformado do cliente.
 *
 * @param {unknown} bruto - O `data.type` como chegou do cliente.
 * @returns {string} Rótulo de no máximo `MAX_CHARS_DO_TIPO` caracteres.
 */
export function rotuloDeTipo(bruto) {
  if (typeof bruto === 'string') {
    if (bruto === '') return '<vazio>';
    if (bruto.length <= MAX_CHARS_DO_TIPO) return bruto;
    return `${bruto.slice(0, MAX_CHARS_DO_TIPO - 1)}…`;
  }
  if (bruto === undefined) return '<ausente>';
  if (bruto === null) return '<nulo>';
  return `<${typeof bruto}>`;
}

/**
 * Decide se ESTE quadro merece uma linha de log, e MARCA o conjunto do socket.
 *
 * A função é a única dona da marcação: o chamador só apresenta o conjunto daquele socket e o tipo
 * cru. Ela devolve o rótulo já normalizado, para que a borda nunca precise tocar no valor do
 * cliente.
 *
 * @param {Set<string|symbol>} avisados - O conjunto DESTE socket (criado preguiçosamente lá).
 * @param {unknown} bruto - O `data.type` como chegou do cliente.
 * @returns {{ avisar: boolean, tipo: string, tetoAtingido: boolean }}
 *   `avisar` é a única coisa que a borda precisa consultar; `tipo` é o rótulo seguro para o log;
 *   `tetoAtingido` distingue o último aviso (e todo silêncio posterior) do caso comum.
 */
export function decidirAvisoDeTipoDesconhecido(avisados, bruto) {
  const tipo = rotuloDeTipo(bruto);

  // Teto já gasto: silêncio definitivo para este socket, sem crescer o conjunto nem mais um byte.
  if (avisados.has(TETO_ATINGIDO)) return { avisar: false, tipo, tetoAtingido: true };

  // Já avisado: o caso comum do cliente antigo em rajada.
  if (avisados.has(tipo)) return { avisar: false, tipo, tetoAtingido: false };

  if (avisados.size >= MAX_TIPOS_POR_SOCKET) {
    avisados.add(TETO_ATINGIDO);
    return { avisar: true, tipo, tetoAtingido: true };
  }

  avisados.add(tipo);
  return { avisar: true, tipo, tetoAtingido: false };
}
