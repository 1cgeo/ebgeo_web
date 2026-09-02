// Path: src/modules/uso/uso.schemas.js
/**
 * @fileoverview Joi das DUAS bordas do módulo de uso, e elas não se parecem.
 *
 * A primeira metade deste arquivo é a LEITURA (`GET /uso/resumo`), atrás de `auth` estrito e
 * `requireAdmin`, cuja única entrada é uma janela de tempo. A segunda é a ESCRITA
 * (`POST /uso/eventos`), ANÔNIMA por desenho, e ali toda a superfície de ataque do módulo
 * mora: o corpo chega de um navegador qualquer, sem credencial, e vira linha em três tabelas.
 * As duas convivem no mesmo arquivo porque são o mesmo módulo, mas a régua é outra, e o que
 * vale para a segunda está dito no cabeçalho de `eventosDeUsoSchema` e no de
 * `020_uso_de_produto.sql`.
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
import { EVENTOS_DE_USO, PAGINAS } from './eventos-de-uso.js';
import { propAceita } from './uso.lote.js';

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

/**
 * O TETO DE EVENTOS POR LOTE.
 *
 * Cinquenta, e o número sai do vocabulário e não de um palpite: são treze eventos e quatro
 * páginas, e um lote é de UMA página, então o pior caso HONESTO é treze linhas mais os
 * qualificadores livres de `ferramenta.ativada`. Cinquenta é folga para uma sessão longa que
 * tenha ligado dezenas de ferramentas diferentes antes da descarga, e é pequeno o bastante
 * para que o pior caso da rota anônima seja uma transação de tamanho conhecido.
 */
export const MAX_EVENTOS_POR_LOTE = 50;

/**
 * O TETO DE UMA CONTAGEM. Cem mil por lote e por chave.
 *
 * Ele não protege a coluna (o UPSERT satura em `INT_MAX`, ver `020_uso_de_produto.sql`): ele
 * protege o SENTIDO. Uma contagem de cem mil ativações da mesma ferramenta numa descarga é
 * um cliente em laço, não uma pessoa, e aceitar um número maior seria deixar um chamador
 * anônimo escolher sozinho a escala do gráfico de todo mundo.
 */
export const MAX_CONTAGEM = 100_000;

/**
 * Uma entrada do lote: o gesto, o qualificador e quantas vezes ele aconteceu.
 *
 * `unknown(false)` EXPLÍCITO, e ele NÃO é decorativo: `VALIDATION_OPTIONS`
 * (`middleware/validate.js`) roda com `stripUnknown`, que recursa e DESCARTA chave não
 * declarada em silêncio, mas no Joi 17 o `unknown(false)` explícito VENCE o `stripUnknown` e
 * a chave extra vira 422. É a mesma escolha, medida no mesmo lugar, de `contexto` e
 * `migalhas` em `diag.schemas.js`, e ela tem o mesmo preço declarado: um cliente que invente
 * um campo perde o LOTE inteiro, e não só o campo. Vale porque os dois pacotes saem do mesmo
 * commit deste repositório e porque o 422 nomeia a chave, enquanto o descarte silencioso
 * produziria telemetria que chega pela metade sem ninguém saber.
 *
 * A REGRA DO QUALIFICADOR É `propAceita` (`uso.lote.js`), E ELA RECUSA EM VEZ DE DESCARTAR.
 * A alternativa (aceitar tudo e gravar `''` no que não casa) é a que se escreve sem pensar, e
 * ela é pior de um jeito específico: a linha resultante é bem formada, entra na contagem e
 * some no total, então o agrupamento passa a mentir sem que exista qualquer sinal de que
 * mentiu. A recusa NOMEIA O EVENTO, porque num lote de cinquenta entradas "prop inválido" sem
 * o evento não diz qual delas consertar.
 *
 * A GUARDA DO `evento` VEM ANTES: quando o próprio evento não está no espelho, o `valid()`
 * já reprovou, e rodar a regra do qualificador em cima disso acrescentaria um segundo erro
 * sobre a mesma entrada, apontando para o campo errado.
 */
const itemDeEvento = Joi.object({
  evento: Joi.string().valid(...EVENTOS_DE_USO).required(),
  prop: Joi.string().max(40).allow(''),
  contagem: Joi.number().integer().min(1).max(MAX_CONTAGEM).required(),
})
  .unknown(false)
  .custom((item, helpers) => {
    if (!EVENTOS_DE_USO.includes(item?.evento)) return item;
    const veredito = propAceita(item.evento, item.prop);
    if (veredito.ok) return item;
    return helpers.error(`uso.prop.${veredito.motivo}`, { evento: item.evento });
  })
  .messages({
    'uso.prop.proibida': 'O evento "{{#evento}}" não aceita qualificador.',
    'uso.prop.desconhecida': 'Qualificador fora da lista do evento "{{#evento}}".',
    'uso.prop.forma': 'Qualificador do evento "{{#evento}}" fora da forma [a-z0-9_-] de até 40.',
  });

/**
 * O corpo de `POST /uso/eventos`: um lote de contagens de UMA aba, de UMA página.
 *
 * NÃO EXISTE CAMPO DE IDENTIDADE DE PESSOA AQUI, e a ausência é o gate, exatamente como no
 * relato de erro do navegador: `user_id` sai de `req.user`, e como `validate()` roda com
 * `stripUnknown`, um `userId` no corpo é DESCARTADO antes de chegar ao controller. Não há
 * caminho por onde um lote anônimo se atribua a outra pessoa, e o descarte (em vez do 422) é
 * o que mantém a rota tolerante a um cliente de outra versão.
 *
 * `sessaoId` NÃO É EXCEÇÃO A ISSO, e a distinção é a mesma de `defeito_ocorrencias.sessao_id`:
 * ele identifica a ABA, não a pessoa. É um UUID que o próprio cliente cunha, não autoriza
 * nada, não é reconciliado contra tabela nenhuma e não vira `user_id` em lugar nenhum;
 * forjá-lo só permite inventar uma aba. Ele é OBRIGATÓRIO porque é a chave da linha de
 * sessão: sem ele o lote não teria onde somar duração e vitais, e cada descarga viraria uma
 * sessão nova, inflando "sessões" por um fator igual ao número de descargas.
 *
 * OS DOIS INSTANTES SÃO EPOCH MS ABSOLUTOS, do relógio do CLIENTE, e o servidor os apara
 * antes de gravar (`instantesDoLote`, `uso.lote.js`). `min(0)` porque não existe instante
 * antes da época; sem teto superior AQUI, porque o teto é o relógio do servidor no momento
 * da escrita e um número escrito no Joi seria um limite inventado que envelhece sozinho.
 *
 * `eventos` PODE VIR VAZIO, e isso é um caso legítimo e frequente, não um lote inútil: uma
 * aba que só ficou aberta ainda tem duração, vitais e contagem de erros para reportar. Um
 * `min(1)` aqui apagaria justamente a sessão passiva, que é metade da medida de sessão.
 *
 * `vitais` É FECHADO CAMPO A CAMPO pela mesma razão do `contexto` do relato de erro, e as
 * quatro medidas são as três Web Vitals que o navegador expõe mais uma nossa
 * (`tempoAteMapaMs`), que é a única que responde a pergunta do produto ("quanto tempo até o
 * mapa aparecer"). `cls` tem teto 100 porque ele é uma fração acumulada: qualquer coisa
 * acima disso é um número inventado, e sem o teto ele entraria no percentil do dia.
 */
export const eventosDeUsoSchema = Joi.object({
  sessaoId: Joi.string().guid().required(),
  pagina: Joi.string().valid(...PAGINAS).required(),
  release: Joi.string().max(100).allow('', null),
  // O NOME curto do navegador, não o `user-agent`. Ele vem do corpo e não do cabeçalho, ao
  // contrário do que o relato de erro faz, e a razão é a pergunta: ali o cabeçalho serve para
  // reproduzir um defeito, e por isso vale mais o que o navegador diz de si; aqui a coluna é
  // uma DIMENSÃO de agrupamento, e um `user-agent` cru como dimensão tem cardinalidade de
  // milhares (cada build de cada versão é um valor) e não agrupa nada.
  navegador: Joi.string().max(40).allow('', null),
  inicio: Joi.number().integer().min(0).required(),
  ultimoSinal: Joi.number().integer().min(0).required(),
  eventos: Joi.array().max(MAX_EVENTOS_POR_LOTE).items(itemDeEvento).required(),
  // Quantos erros a aba viu, para cruzar com `defeitos`. É o que permite dizer "esta release
  // teve 3% das sessões com erro" sem nenhuma linha por pessoa.
  erros: Joi.number().integer().min(0).max(MAX_CONTAGEM),
  vitais: Joi.object({
    lcpMs: Joi.number().min(0),
    inpMs: Joi.number().min(0),
    cls: Joi.number().min(0).max(100),
    tempoAteMapaMs: Joi.number().min(0),
  }).unknown(false),
});
