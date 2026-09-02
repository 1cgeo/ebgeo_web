// Path: src/modules/diag/diag.schemas.js
/**
 * @fileoverview Joi da borda do diagnóstico.
 *
 * A JANELA É VALIDADA CONTRA A MESMA GRAMÁTICA DO COMANDO, e isso não é elegância: se a
 * rota aceitasse uma forma que `parseJanela` não entende, ela cairia num default e
 * responderia sobre OUTRO período sem avisar — que é exatamente o modo de falha que o
 * `fileoverview` de `src/utils/diag-consulta.js` recusa para o terminal. Uma segunda
 * gramática aqui seria uma segunda verdade sobre o que "24h" significa.
 *
 * O TETO DE 7 DIAS É A ÚNICA DIFERENÇA ENTRE AS DUAS PORTAS, e ele existe porque as duas
 * têm custo diferente. No terminal, `--desde 30d` abre trinta arquivos e demora; numa
 * requisição HTTP, a mesma coisa é um jeito de derrubar o servidor pela porta do
 * diagnóstico, e o diagnóstico é justamente o que não pode faltar quando o servidor já
 * está sofrendo. Quem precisa de mais que sete dias tem o comando, que roda no servidor,
 * fora do ciclo de requisição e sem competir com o tráfego.
 */

import Joi from 'joi';
import { parseJanela } from '../../utils/diag-consulta.js';
import { ORIGENS_DE_ERRO, ORIGENS_DO_CLIENTE } from './origens-de-erro.js';
import { ESTADOS_DE_DEFEITO, ESTADOS_MANUAIS } from './estados-de-defeito.js';

/** O maior período que uma requisição HTTP pode pedir. Ver o cabeçalho. */
export const TETO_DA_JANELA_MS = 7 * 86_400_000;

/**
 * O parâmetro `desde`, com o padrão de cada rota.
 *
 * Devolve a STRING original, não os milissegundos: o serviço chama `parseJanela` de novo,
 * e ter a forma crua no `req.query` é o que deixa a mensagem de erro citar o que a pessoa
 * escreveu. A conversão dupla custa uma regex.
 *
 * @param {string} padrao - a janela usada quando o parâmetro não vem
 * @returns {Joi.StringSchema}
 */
function janela(padrao) {
  return Joi.string()
    .default(padrao)
    .custom((valor, helpers) => {
      const ms = parseJanela(valor);
      if (ms === null) return helpers.error('janela.forma');
      if (ms > TETO_DA_JANELA_MS) return helpers.error('janela.teto');
      return valor;
    })
    .messages({
      'janela.forma': 'Janela inválida: use um número seguido de m, h ou d (por exemplo 30m, 24h, 7d).',
      'janela.teto': 'A janela máxima nesta tela é 7d. Para ir além, use "npm run diag" no servidor.',
    });
}

export const errosQuerySchema = Joi.object({
  desde: janela('24h'),
  limite: Joi.number().integer().min(1).max(100).default(20),
});

export const lentoQuerySchema = Joi.object({
  desde: janela('24h'),
  limite: Joi.number().integer().min(1).max(100).default(15),
});

export const statusQuerySchema = Joi.object({
  desde: janela('1h'),
});

export const errosDeClienteQuerySchema = Joi.object({
  desde: janela('7d'),
  limite: Joi.number().integer().min(1).max(200).default(50),
});

/**
 * Os filtros de `GET /diag/defeitos`.
 *
 * TODO FILTRO É OPCIONAL E NENHUM TEM DEFAULT (salvo `novos` e `limite`), porque a ausência
 * já significa "não filtre por isto" no SQL (`LIST_DEFEITOS` compara `$n::text IS NULL`).
 * Dar default a `estado` seria decidir pela tela qual recorte é o normal, e o recorte normal
 * muda com o incidente.
 *
 * `estado` e `origem` SAEM DOS ESPELHOS, nunca escritos à mão aqui: uma segunda cópia
 * divergiria do CHECK e o sintoma seria uma lista VAZIA (o valor não casa com linha nenhuma),
 * que é indistinguível de "não há defeito nesse estado" e não acusa nada.
 *
 * `novos` É BOOLEANO COM `truthy('1')` porque a tela manda `?novos=1`, que é o que uma query
 * string escreve naturalmente. Sem isso o Joi de boolean recusaria `'1'` com 422, e a tela
 * teria de mandar `novos=true`, forma que ninguém digita à mão. O default é `false`
 * explícito e não a ausência: o SQL faz `NOT $6::boolean`, e `undefined` ali avaliaria NULL,
 * o que devolveria ZERO linhas, calado.
 */
export const defeitosQuerySchema = Joi.object({
  desde: janela('7d'),
  estado: Joi.string().valid(...ESTADOS_DE_DEFEITO),
  origem: Joi.string().valid(...ORIGENS_DE_ERRO),
  release: Joi.string().max(100),
  pagina: Joi.string().max(500),
  novos: Joi.boolean().truthy('1').falsy('0').default(false),
  limite: Joi.number().integer().min(1).max(200).default(50),
});

/**
 * O id do defeito, em `GET /diag/defeitos/:id/ocorrencias`.
 *
 * `guid()` e não `string()`: a coluna é UUID, e um valor com outra forma derrubaria a
 * consulta com 22P02, que a borda traduz num 400 genérico sem relação aparente com o
 * assunto. Com o schema, a recusa é 422 e nomeia o campo.
 */
export const ocorrenciasParamsSchema = Joi.object({
  id: Joi.string().guid().required(),
});

/**
 * O corpo de `PATCH /diag/defeitos/:id`: os TRÊS atos de ciclo de vida.
 *
 * `ESTADOS_MANUAIS` E NÃO `ESTADOS_DE_DEFEITO`, e a diferença é a linha inteira deste
 * schema: `regrediu` está no CHECK do banco (a máquina o escreve, pelo CASE de
 * `UPSERT_DEFEITO`) e é RECUSADO aqui com 422. É o mesmo recorte, pelo mesmo motivo, de
 * `ORIGENS_DO_CLIENTE` na rota anônima: uma coluna cujo valor significa um FATO apurado pelo
 * produto não pode aceitar esse valor como opinião de quem chama. Marcado à mão, `regrediu`
 * seria um rótulo sem os dois `release` por trás, e a tela passaria a mostrar regressão onde
 * não houve nenhuma. A lista é DERIVADA da completa, então estado novo entra nas duas de
 * graça (ver `estados-de-defeito.js`).
 *
 * `commit` SÓ FAZ SENTIDO COM `resolvido`, e mesmo assim ele NÃO é condicionado por Joi. A
 * dependência é fácil de escrever (`Joi.when`) e paga mal: um `commit` enviado junto de
 * `ignorado` é inofensivo (o CASE de `UPDATE_ESTADO_DE_DEFEITO` simplesmente não o usa), e
 * trocar isso por um 422 daria ao cliente uma recusa sobre um campo que ele mandou por
 * excesso de zelo. O que a borda precisa garantir é o TETO, e esse ela garante.
 *
 * O TETO É 64 E ELE ESPELHA O CHECK DA COLUNA (`018_defeitos_e_ocorrencias.sql`), que é o
 * comprimento de um SHA-256 em hexadecimal. Sem ele a recusa viria do banco como 23514, que
 * a borda traduz num erro sem relação aparente com o campo; com ele, o 422 nomeia `commit`.
 *
 * `allow('', null)` porque "resolvi e não sei o commit" é o caso comum, e um campo vazio
 * vindo de um formulário é a forma que ele toma. `vazioVirando` (`defeitos.service.js`) o
 * transforma em NULL antes do UPDATE, que é o que a coluna guarda.
 */
export const estadoDeDefeitoSchema = Joi.object({
  estado: Joi.string().valid(...ESTADOS_MANUAIS).required(),
  commit: Joi.string().trim().max(64).allow('', null),
});

/**
 * O corpo do relato de erro do navegador.
 *
 * TODO CAMPO TEM TETO, e o teto é a diferença entre 422 e 500. Este é o único endpoint
 * anônimo que ESCREVE no banco, e o que chega nele é texto que um cliente qualquer montou
 * (uma pilha de um laço infinito passa fácil dos megabytes). Sem os tetos, o texto grande
 * viraria erro do driver no meio do INSERT, ou seja, a rota que existe para registrar
 * falhas produziria a sua.
 *
 * `assinatura` tem teto POR MOTIVO ESTRUTURAL, não por gosto: ela é a chave única em
 * btree, e o índice recusa valor acima de ~2.700 bytes. 300 é folgado para
 * "TypeError | /atlas/:id/sync | mensagem" e barato de indexar.
 *
 * NÃO EXISTE CAMPO DE IDENTIDADE DE PESSOA AQUI, e a ausência é o gate: `user_id` sai de
 * `req.user`, e como `validate()` roda com `stripUnknown`, um `userId` no corpo é
 * descartado antes de chegar ao controller — não há caminho por onde um relato anônimo se
 * atribua a outra pessoa. `userAgent` é aceito, mas o controller prefere o CABEÇALHO quando
 * ele existe, porque o cabeçalho é o que o navegador diz de si e o corpo é o que o cliente
 * escolheu dizer.
 *
 * `sessaoId` NÃO É EXCEÇÃO A ISSO, e a distinção é a linha inteira: ele identifica a ABA,
 * não a pessoa. É um UUID que o próprio cliente cunha, não autoriza nada, não é reconciliado
 * contra tabela nenhuma e não vira `user_id` em lugar nenhum; forjá-lo só permite atribuir o
 * próprio erro a uma aba inventada. Aceitá-lo do corpo é, portanto, do mesmo tipo que
 * aceitar `assinatura`: é o cliente relatando o que ele viu.
 */
export const erroDeClienteSchema = Joi.object({
  assinatura: Joi.string().trim().max(300).required(),
  mensagem: Joi.string().trim().max(500).required(),
  stack: Joi.string().max(4000).allow('', null),
  url: Joi.string().max(500).allow('', null),
  pagina: Joi.string().max(500).allow('', null),
  release: Joi.string().max(100).allow('', null),
  userAgent: Joi.string().max(300).allow('', null),
  // `uuid` e não `string`: a coluna é UUID (sem FK, ver a migração). Um atlas LOCAL pode
  // não ter id nenhum, e por isso o campo é opcional em vez de obrigatório.
  atlasId: Joi.string().uuid().allow(null),

  // ── a identidade e o estado, de `017_erro_cliente_identidade.sql` ──
  //
  // OS QUATRO SÃO OPCIONAIS, e isso é o contrato da rota anônima: um cliente que não mande
  // nenhum deles continua sendo aceito com 204, exatamente como antes. A ausência de todos
  // é o caso de um navegador com script antigo em cache, que é justamente quem mais tem
  // erro para relatar.

  // A ABA que produziu o erro. `guid()` e não `string()`: a coluna é UUID, e um valor com
  // outra forma derrubaria o INSERT com 22P02 — um 500 no caminho que existe para registrar
  // falhas. É o MESMO id que viaja no cabeçalho `X-EBGeo-Sessao`, e é ele que costura este
  // relato às linhas que o servidor escreveu no mesmo instante.
  sessaoId: Joi.string().guid(),

  // A pilha ANTES da normalização (a de `stack` é a que casa com a assinatura). Mesmo teto
  // de `stack`, pelo mesmo motivo: é o campo que uma recursão infinita faz crescer sem
  // limite, e o teto é o que separa um 422 de um erro do driver.
  stackBruta: Joi.string().max(4000),

  // A lista vem do espelho do CHECK (`origens-de-erro.js`), NUNCA escrita à mão aqui: uma
  // segunda cópia divergiria do banco e o sintoma seria um 400 opaco vindo do 23514, em vez
  // do 422 que nomeia o campo.
  //
  // `ORIGENS_DO_CLIENTE` E NÃO `ORIGENS_DE_ERRO`, e a diferença é UMA palavra que muda o
  // sentido da coluna: `'servidor'` é aceito pelo CHECK (a mesma coluna guarda o 5xx que o
  // backend registra sobre si) e RECUSADO aqui. Esta é a rota anônima; sem o recorte,
  // qualquer visitante carimbaria um relato como se fosse o servidor falando, e o filtro
  // `origem=servidor` da tela deixaria de significar procedência. As duas listas são
  // derivadas uma da outra, então a origem nova entra nas duas de graça.
  origem: Joi.string().valid(...ORIGENS_DO_CLIENTE),

  // O ESTADO DO APP no instante do erro. A forma é FECHADA campo a campo, e a coluna é
  // JSONB só porque o conjunto útil ainda está sendo descoberto: livre no armazenamento não
  // significa livre na entrada, senão o cliente decidiria sozinho o tamanho da linha.
  //
  // `unknown(false)` NÃO É DECORATIVO AQUI, E O EFEITO É O CONTRÁRIO DO ESPERADO — medido,
  // não suposto. `VALIDATION_OPTIONS` (`middleware/validate.js`) roda com `stripUnknown`,
  // que recursa e DESCARTA chave não declarada em silêncio; a leitura natural é que a
  // bandeira acima seja só documentação. Ela não é: no Joi 17 o `unknown(false)` explícito
  // VENCE o `stripUnknown` e a chave extra vira 422 (`"contexto.x" is not allowed`), o que
  // se confere trocando uma coisa e rodando
  // `tests/integration/diag-erro-de-cliente-identidade.test.js`.
  //
  // A ESCOLHA, então, é DELIBERADA e tem um preço que precisa ser dito: um cliente que
  // invente um campo de contexto perde o relato INTEIRO, e não só o campo. Vale porque os
  // dois pacotes são versionados juntos neste repositório (o cliente que manda o campo novo
  // é do mesmo commit que o declara aqui) e porque o 422 nomeia o campo, enquanto o descarte
  // silencioso produziria telemetria que chega pela metade sem ninguém saber. Quem
  // acrescentar campo de contexto no cliente PRECISA acrescentá-lo aqui no mesmo commit.
  contexto: Joi.object({
    // Os três tipos de atlas do produto. Fechado porque é o campo que separa "quebrou
    // offline" de "quebrou no servidor", e um quarto valor inventado pelo cliente tornaria
    // o agrupamento inútil justamente nessa pergunta.
    atlasKind: Joi.string().valid('local', 'servidor', 'publico'),
    conexao: Joi.string().max(20),
    causa: Joi.string().max(40),
    camada: Joi.string().max(80),
    // Status HTTP: a faixa é a do protocolo, e o inteiro fora dela é dado inventado.
    status: Joi.number().integer().min(100).max(599),
  }).unknown(false),

  // ── as MIGALHAS, de `018_defeitos_e_ocorrencias.sql` ──
  //
  // O RASTRO DOS ÚLTIMOS PASSOS antes do erro, na ideia do breadcrumb do Sentry: a pergunta
  // que nem a mensagem nem a pilha respondem é "o que a pessoa estava fazendo". Elas só
  // existem na OCORRÊNCIA, nunca na linha do defeito, e o motivo está em
  // `defeitos.service.js`: agregar migalha por assinatura guardaria as do último relato e
  // jogaria fora as das outras dezenove, que é justamente a informação.
  //
  // O TETO É DUPLO E OS DOIS LADOS IMPORTAM: 30 itens, e cada item com tetos próprios. O
  // pior caso é da ordem de 4 kB, a mesma grandeza do `stack`, e sem o teto de ITENS um
  // cliente com defeito mandaria a sessão inteira num JSONB por ocorrência, com vinte
  // ocorrências por defeito. Errar para cima aqui transformaria a telemetria no segundo
  // incidente, que é o que o cabeçalho de `014_observabilidade.sql` recusa por extenso.
  //
  // `unknown(false)` NO ITEM, pelo mesmo argumento (e com o mesmo preço) do `contexto`
  // acima: chave desconhecida dentro de uma migalha RECUSA O RELATO INTEIRO com 422, em vez
  // de ser descartada em silêncio pelo `stripUnknown`. Os dois pacotes saem do mesmo commit,
  // e o 422 nomeia o campo; o descarte produziria telemetria pela metade sem ninguém saber.
  // As duas bordas precisam ser IGUAIS nisto: se uma recusasse e a outra descartasse, a
  // mesma migalha teria dois destinos dependendo de qual campo ela sujasse.
  //
  // OS TRÊS CAMPOS SÃO OPCIONAIS, e isso NÃO é frouxidão. A alternativa (exigir `texto`)
  // faria uma migalha malformada custar o RELATO INTEIRO, e o relato vale muito mais que o
  // rastro: perder o erro para salvar a coerência da decoração é o câmbio errado. O
  // `unknown(false)` já pega o erro que de fato acontece, que é o campo com nome trocado
  // (`tempo` no lugar de `t`), porque ele chega como chave desconhecida e não como campo
  // ausente.
  //
  //  - `t`     — o instante em EPOCH MS ABSOLUTO, o mesmo relógio do `time` das linhas do
  //              `.jsonl`, e é isso que permite pôr a migalha lado a lado com o que o
  //              servidor escreveu naquele instante. Relativo à carga da página seria mais
  //              barato de produzir e não casaria com nada. `min(0)` porque não existe
  //              instante antes da época; sem teto superior, porque um teto em anos seria
  //              número inventado e o relógio do cliente pode estar adiantado;
  //  - `tipo`  — a categoria (navegação, clique, rede, store...). Teto de 20, e o
  //              vocabulário NÃO é fechado de propósito: fechá-lo obrigaria uma migração a
  //              cada categoria nova do cliente, para um campo que não gateia nada e não
  //              agrupa nada;
  //  - `texto` — a descrição curta. Teto de 120 porque migalha é rótulo, não mensagem: o que
  //              não couber ali pertence ao `contexto` ou à `mensagem`.
  migalhas: Joi.array().max(30).items(Joi.object({
    t: Joi.number().integer().min(0),
    tipo: Joi.string().max(20),
    texto: Joi.string().max(120),
  }).unknown(false)),
});
