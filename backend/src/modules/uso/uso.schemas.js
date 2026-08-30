// Path: src/modules/uso/uso.schemas.js
/**
 * @fileoverview Joi da borda do relatório de uso.
 *
 * A GRAMÁTICA DA JANELA É IMPORTADA, NUNCA REESCRITA: `parseJanela`
 * (`src/utils/diag-consulta.js`) é a mesma que o comando `npm run diag` e as quatro rotas
 * de `/diag` usam. Uma segunda implementação de "o que 30d significa" é uma segunda verdade
 * sobre o mesmo período, e ela diverge no dia em que alguém corrigir uma das duas. O que
 * NÃO se compartilha é o esquema pronto do `diag` — o teto é outro (ver abaixo), e importar
 * o dele para depois relaxá-lo faria a rota de lá parecer responsável por um limite que não
 * é dela.
 *
 * O TETO É 365d AQUI E 7d NO DIAGNÓSTICO, e a diferença é de CUSTO, não de generosidade. Lá
 * a janela decide quantos ARQUIVOS `.jsonl` a requisição abre e quantos milhões de linhas
 * ela desserializa no heap de um processo que também atende sync; aqui ela é um predicado
 * de data em consultas agregadas, cujo trabalho cresce com o número de LINHAS da janela e
 * não com o da janela em si. Um ano de agregação é caro (ver o relatório de índices), e é
 * caro de um jeito que o Postgres gerencia; um ano de log em arquivo é uma forma de
 * derrubar o servidor pela porta do diagnóstico.
 *
 * O TETO TAMBÉM É UM LIMITE DE HONESTIDADE, e essa é a parte que se perde numa reescrita:
 * pedir mais de um ano não daria mais informação, daria um `horizonte` cada vez mais
 * distante do `desde`, ou seja, um relatório majoritariamente vazio com aparência de série
 * longa.
 */

import Joi from 'joi';
import { parseJanela } from '../../utils/diag-consulta.js';

/** O maior período que este relatório aceita. Ver o cabeçalho. */
export const TETO_DA_JANELA_MS = 365 * 86_400_000;

export const resumoQuerySchema = Joi.object({
  // Devolve a STRING original, e não os milissegundos, pelo mesmo motivo do `diag`: é ela
  // que o serviço volta a passar por `parseJanela` e é ela que a mensagem de erro cita.
  desde: Joi.string()
    .default('30d')
    .custom((valor, helpers) => {
      const ms = parseJanela(valor);
      if (ms === null) return helpers.error('janela.forma');
      if (ms > TETO_DA_JANELA_MS) return helpers.error('janela.teto');
      return valor;
    })
    .messages({
      'janela.forma': 'Janela inválida: use um número seguido de m, h ou d (por exemplo 30m, 24h, 30d).',
      'janela.teto': 'A janela máxima deste relatório é 365d.',
    }),
});
