// Path: src/modules/uso/uso.lote.js
/**
 * @fileoverview As decisões PURAS do lote de uso: o que fazer com os dois instantes que o
 * cliente declara, e quando a passada de manutenção deve rodar.
 *
 * ELE IMPORTA SÓ O ESPELHO (`eventos-de-uso.js`, que tem zero imports), e é isso que o
 * mantém exercível em node puro, sem `DATABASE_URL` nem `JWT_SECRET`. A razão é a mesma de
 * `uso.horizonte.js`: a regra que decide o que entra na tabela precisa ser testável sem
 * subir banco, senão ela só é conferida pelo caminho que ela mesma alimenta.
 *
 * O RELÓGIO DO LOTE É DO CLIENTE, E ISSO É UM FATO DA ROTA, NÃO UM DESCUIDO. `inicio` e
 * `ultimoSinal` chegam do navegador, como o `t` das migalhas do relato de erro, porque só o
 * navegador sabe quando a sessão dele começou. O servidor não pode adotá-los como verdade, e
 * a apara é uma JANELA e não um teto: o instante é preso entre o relógio do servidor e a
 * retenção. As duas bordas existem por motivos diferentes, e a segunda entrou em 2026-09-02,
 * quando uma revisão apontou que só metade do problema estava fechada:
 *
 *  - um instante no FUTURO cria uma linha que nenhuma poda alcança (a poda mira `ultimo_sinal
 *    < NOW() - retenção`) e um `dia` que nunca fecha, ou seja lixo permanente escrito por
 *    chamador anônimo;
 *  - um instante no PASSADO REMOTO cria linha em `uso_eventos_dia` e em `uso_diario`, e
 *    NENHUMA DAS DUAS É PODADA. A frase anterior desta linha dizia que o passado se resolvia
 *    sozinho porque a poda o alcança, e isso valia só para `uso_sessoes`: um chamador anônimo
 *    podia escrever um contador datado de 1970 e uma linha de agregado que ficariam para
 *    sempre, ou seja exatamente a cardinalidade aberta que o desenho das contagens existe
 *    para não ter. O piso é `agora` menos a retenção, o mesmo horizonte das sessões.
 *
 * O PISO NÃO QUEBRA O LOTE OFFLINE, que é o caso legítimo que a versão anterior protegia: uma
 * fila enfileirada chega minutos, horas ou dias depois do gesto, e `LOG_RETENTION_DAYS` é
 * trinta por padrão. O que ele recusa é a data que nenhum navegador honesto produz.
 *
 * A DURAÇÃO NEGATIVA MORRE AQUI, e não na consulta: com `inicio` preso ao teto de
 * `ultimoSinal`, `ultimo_sinal - inicio` nunca é negativo na linha recém-nascida. A
 * agregação ainda aplica um `GREATEST(0, …)` porque a linha pode ter nascido de um lote e
 * ganhado `ultimo_sinal` de outro, e o piso lá custa nada; aqui é onde a regra se lê.
 */

import { PROPS_PERMITIDAS } from './eventos-de-uso.js';

/**
 * A forma de um qualificador LIVRE (hoje só o id de ferramenta).
 *
 * Minúscula, dígito, hífen e sublinhado, de 1 a 40. Ela não existe para autorizar nada: ela
 * existe para que a cardinalidade da única dimensão aberta da tabela de contagens seja
 * limitada em ALFABETO e em COMPRIMENTO, além de em volume pelo limitador. Um id de
 * ferramenta desta casa (`point_tool`, `military-symbol`) cabe folgado.
 */
export const FORMA_DE_PROP_LIVRE = /^[a-z0-9_-]{1,40}$/;

/**
 * O veredito sobre um par (evento, qualificador).
 *
 * TRÊS ESTADOS DE ENTRADA e não dois, porque `PROPS_PERMITIDAS[evento]` pode ser `null`
 * (livre), lista vazia (proibido) ou lista fechada. Ver o cabeçalho do espelho: confundir
 * `null` com "sem qualificador" é o erro que esta função existe para não deixar espalhar
 * por três pontos de uso.
 *
 * @param {string} evento - um valor de `EVENTOS_DE_USO` (não validado aqui)
 * @param {string} [prop] - o qualificador, possivelmente ausente ou vazio
 * @returns {{ok: true}|{ok: false, motivo: 'proibida'|'forma'|'desconhecida'}}
 */
export function propAceita(evento, prop) {
  const valor = prop ?? '';
  // Vazio é sempre aceito, inclusive nos eventos de lista fechada: a linha sem qualificador
  // é o total daquele gesto, que continua sendo uma contagem verdadeira. Ver o espelho.
  if (valor === '') return { ok: true };

  const permitidas = PROPS_PERMITIDAS[evento];
  if (permitidas === null) {
    return FORMA_DE_PROP_LIVRE.test(valor) ? { ok: true } : { ok: false, motivo: 'forma' };
  }
  if (!Array.isArray(permitidas)) return { ok: false, motivo: 'desconhecida' };
  if (permitidas.length === 0) return { ok: false, motivo: 'proibida' };
  return permitidas.includes(valor) ? { ok: true } : { ok: false, motivo: 'desconhecida' };
}

/**
 * A retenção assumida quando o chamador não passa uma utilizável.
 *
 * Ela repete o default de `LOG_RETENTION_DAYS` em `config.js`, e a repetição é DELIBERADA:
 * este módulo é folha e não importa `config`, que é o que o mantém exercível em node puro. O
 * que NÃO se pode fazer é degradar para "sem piso" quando a variável vem torta, porque um piso
 * que desaparece com um erro de digitação no ambiente não é um piso. Errar para trinta dias é
 * a única direção segura.
 */
export const RETENCAO_PADRAO_DIAS = 30;

/** Um dia em milissegundos. Só para derivar o piso a partir da retenção. */
const DIA_MS = 86_400_000;

/**
 * Os dois instantes do lote, presos à JANELA do servidor: nem no futuro, nem antes da retenção.
 *
 * A ORDEM DAS TRÊS APARAS É O CONTRATO, e cada troca produz um defeito diferente:
 *  1. `ultimoSinal` é preso ao teto `agora` e ao piso `agora - retenção`;
 *  2. `inicio` é preso ao teto do `ultimoSinal` JÁ APARADO, e não a `agora`: aparar contra
 *     `agora` deixaria passar `inicio > ultimoSinal` no caso em que os dois estão no futuro,
 *     ou seja duração negativa;
 *  3. `inicio` recebe o MESMO piso, senão uma sessão datada de 1970 continuaria produzindo
 *     `ultimo_sinal - inicio` de décadas, e a mediana de duração do dia viraria isso.
 *
 * @param {{inicio: number, ultimoSinal: number}} lote - epoch ms, já validados por Joi
 * @param {number} agoraMs - o relógio do servidor
 * @param {number} [retencaoDias] - o horizonte além do qual nada é aceito. Ver o cabeçalho.
 * @returns {{inicio: Date, ultimoSinal: Date}}
 */
export function instantesDoLote({ inicio, ultimoSinal }, agoraMs, retencaoDias) {
  const dias = Number.isFinite(retencaoDias) && retencaoDias > 0
    ? retencaoDias
    : RETENCAO_PADRAO_DIAS;
  const piso = agoraMs - dias * DIA_MS;
  const ultimo = Math.max(Math.min(ultimoSinal, agoraMs), piso);
  return {
    inicio: new Date(Math.max(Math.min(inicio, ultimo), piso)),
    ultimoSinal: new Date(ultimo),
  };
}

/**
 * Decide se a passada de manutenção (agregar e depois podar) deve rodar agora.
 *
 * GÊMEA DE `devePodar` (`src/modules/diag/defeitos.service.js`), e a duplicação é
 * deliberada, não descuido: as duas guardam relógios de módulo DIFERENTES, e compartilhar a
 * função obrigaria a compartilhar o estado ou a passar o relógio de fora, que é o que já
 * acontece. O que se compartilharia é uma comparação de três linhas; o que se ganharia é um
 * acoplamento entre a poda de telemetria de erro e a de telemetria de uso, que precisam
 * poder mudar de cadência separadamente.
 *
 * `emTeste` é o mesmo gate de ambiente de `deveAmostrar` e do log em arquivo, pela mesma
 * razão: a suíte não pode ganhar um DELETE que ninguém pediu no meio de uma asserção sobre a
 * tabela. Um teste que QUEIRA a passada chama com `{ emTeste: false }`, que é o explícito.
 *
 * A PRIMEIRA PASSADA RODA NA PRIMEIRA ESCRITA depois do boot, e não uma hora depois dela: um
 * processo que sobe, recebe um lote e cai nunca teria agregado nada.
 *
 * @param {Object} opts
 * @param {number} opts.agoraMs
 * @param {number} opts.ultimaPassadaEm - 0 quando ainda não houve passada neste processo
 * @param {number} opts.intervaloMs
 * @param {boolean} opts.emTeste
 * @returns {{passar: boolean, motivo?: string}}
 */
export function devePassar({ agoraMs, ultimaPassadaEm, intervaloMs, emTeste }) {
  if (emTeste) return { passar: false, motivo: 'teste' };
  if (!Number.isFinite(intervaloMs) || intervaloMs <= 0) {
    return { passar: false, motivo: 'intervalo-invalido' };
  }
  if (ultimaPassadaEm > 0 && agoraMs - ultimaPassadaEm < intervaloMs) {
    return { passar: false, motivo: 'intervalo' };
  }
  return { passar: true };
}
