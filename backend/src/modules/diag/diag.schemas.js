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
import { parseJanela, parseIntervalo } from '../../utils/diag-consulta.js';
import { ORIGENS_DE_ERRO, ORIGENS_DO_CLIENTE } from './origens-de-erro.js';
import { ESTADOS_DE_DEFEITO, ESTADOS_MANUAIS } from './estados-de-defeito.js';
// O PADRÃO E O TETO DO `limite` DO RESUMO VÊM DA CONSTANTE, nunca de um literal repetido aqui.
// Este arquivo é avaliado por `app.js` e por `scripts/diag.js`, e o import é seguro porque o
// grafo ESTÁTICO de `resumo.service.js` não alcança `config.js` nem o pool (ele carrega
// `defeitos.service.js` por `import()` tardio, e é o `fileoverview` de lá que guarda a razão).
import { DEFEITOS_DO_RESUMO } from './resumo.service.js';

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

/**
 * O parâmetro `intervalo`, lido por `saude` e por `resumo`.
 *
 * UM HELPER E NÃO DUAS DECLARAÇÕES, pela mesma razão de `janela()`: as duas rotas alimentam o
 * MESMO `resumirAmostras`, e o valor é o DENOMINADOR da contagem de amostras faltando. Duas
 * cópias divergiriam num aceite (uma passa `90s`, a outra não) sem nada ficar vermelho, e o
 * sintoma seria um número de faltantes diferente nas duas telas sobre a mesma série.
 *
 * A GRAMÁTICA É A DE `parseIntervalo`, e não a de `parseJanela`: ela aceita SEGUNDOS (`30s`),
 * porque a cadência de um amostrador pode ser menor que um minuto e a janela nunca é.
 *
 * O NÚMERO NU É RECUSADO, como no comando: `300000` seria ambíguo com
 * `HEALTH_SAMPLE_INTERVAL_MS`, que é em milissegundos, e um sufixo esquecido faria a conta sair
 * sobre uma premissa cinco ordens de grandeza errada.
 *
 * SEM DEFAULT, e a ausência é o contrato: sem o parâmetro, `resumirAmostras` INFERE o intervalo
 * da própria série (pelo p10 das distâncias) e DIZ na resposta que inferiu, com que percentil e
 * sobre quantas distâncias. Um default esconderia a inferência atrás de um número que ninguém
 * pediu, que é exatamente a premissa invisível que aquela função existe para não ter.
 *
 * @returns {Joi.StringSchema}
 */
function intervalo() {
  return Joi.string()
    .custom((valor, helpers) => (parseIntervalo(valor) === null ? helpers.error('intervalo.forma') : valor))
    .messages({
      'intervalo.forma': 'Intervalo inválido: use um número seguido de s, m ou h (por exemplo 30s, 5m, 1h). '
        + 'O sufixo é obrigatório: um número nu seria ambíguo com HEALTH_SAMPLE_INTERVAL_MS, que é em ms.',
    });
}

export const errosQuerySchema = Joi.object({
  desde: janela('24h'),
  limite: Joi.number().integer().min(1).max(100).default(20),
});

/**
 * `GET /diag/lento`: latência por rota.
 *
 * `porRelease` É O `--por-release` DO COMANDO, e ele entrou aqui em 2026-09-02 porque a wiki
 * passou a afirmar que a porta HTTP cobre o comando inteiro: uma afirmação dessas só é
 * verdadeira se ninguém precisar do terminal para uma pergunta que a tela já faz. A pergunta é
 * a de todo deploy ("isto ficou mais lento depois de subir?"), e a média de duas builds numa
 * linha só a ESCONDE, em proporção ao tempo que a build antiga dominou a janela.
 *
 * `truthy('1')` PORQUE `?porRelease=1` É O QUE UMA QUERY STRING ESCREVE NATURALMENTE, e é a
 * mesma decisão (e o mesmo motivo) do `novos` de `defeitosQuerySchema`: sem isso o Joi de
 * boolean recusaria `'1'` com 422 e o chamador teria de escrever `porRelease=true`, forma que
 * ninguém digita à mão. O default é `false` EXPLÍCITO e não a ausência, porque o valor
 * atravessa até `criarResumoDeLatencia`, onde `undefined` e `false` levam ao mesmo lugar hoje
 * e não há razão para depender disso.
 */
export const lentoQuerySchema = Joi.object({
  desde: janela('24h'),
  limite: Joi.number().integer().min(1).max(100).default(15),
  porRelease: Joi.boolean().truthy('1').falsy('0').default(false),
});

export const statusQuerySchema = Joi.object({
  desde: janela('1h'),
});

/** `GET /diag/saude`: os buracos na série de amostras. Ver `intervalo()` acima. */
export const saudeQuerySchema = Joi.object({
  desde: janela('24h'),
  intervalo: intervalo(),
});

/**
 * `GET /diag/linhas`: o despejo cru filtrado.
 *
 * `filtro` É OBRIGATÓRIO AQUI E OPCIONAL NO COMANDO, e essa é a única divergência de contrato
 * entre as duas portas. A razão é a mesma do teto de 7 dias: sem filtro, a resposta é a janela
 * INTEIRA atravessando o ciclo HTTP, e o `limite` não salva porque a leitura acontece de
 * qualquer jeito. No terminal isso é uma rolagem; aqui é um jeito de derrubar o servidor pela
 * porta do diagnóstico.
 *
 * O PISO DE DOIS CARACTERES não é higiene, é a mesma aritmética da busca de atlas do
 * administrador: um filtro de um caractere casa quase toda linha de JSON (`e`, `:`, `1`), e o
 * que ele devolve não é um recorte, é o teto do `limite` sobre a janela, com cara de resposta.
 * O `casouTudo` do payload cobre o caso geral; este piso tira o caso degenerado da mesa.
 *
 * O TETO DE 200 CARACTERES espelha os campos de texto curto do relato: é entrada externa
 * entrando num `String.prototype.includes` executado uma vez por linha da janela.
 *
 * `limite` VAI ATÉ 2000 e não 100 como o das rotas de agregação, e a diferença é a natureza do
 * item: lá cada item é um GRUPO (uma assinatura com contagem), e cem grupos já são mais do que
 * alguém lê; aqui cada item é uma LINHA, e a pergunta típica ("o que aconteceu em volta desta
 * sessão") tem dezenas a centenas de linhas de resposta.
 *
 * O `limite` NÃO É O ÚNICO CORTE, e o outro não cabe num parâmetro: um `limite` de 2000 linhas
 * de tamanho patológico é uma resposta de dezenas de MB, e quem escolhe o tamanho da linha é
 * quem escreveu o log, não quem consulta. Existe por isso um ORÇAMENTO DE BYTES em `linhas()`
 * (`diag.service.js`), aplicado depois do `limite` e a partir das linhas mais RECENTES, e o
 * payload diz `truncadoPorBytes: true` quando ele morde. Contar item e não byte é o erro
 * clássico desta família de rotas.
 *
 * O PADRÃO É `24h`, O MESMO DO COMANDO, e o alinhamento é o ponto: as duas portas respondem à
 * mesma pergunta, e um default diferente faria o MESMO comando com os MESMOS argumentos
 * devolver janelas diferentes conforme a porta, o que tira todo valor de comparar as duas
 * saídas.
 */
export const linhasQuerySchema = Joi.object({
  desde: janela('24h'),
  filtro: Joi.string().min(2).max(200).required(),
  limite: Joi.number().integer().min(1).max(2000).default(200),
});

export const errosDeClienteQuerySchema = Joi.object({
  desde: janela('7d'),
  limite: Joi.number().integer().min(1).max(200).default(50),
});

/**
 * `GET /diag/resumo`: o relatório de UMA TELA, das duas fontes.
 *
 * O PADRÃO É `7d` E O DO COMANDO CONTINUA SENDO `24h`, e a divergência é escolha, não
 * descuido. O terminal responde a uma pergunta de INCIDENTE ("o que aconteceu desde ontem"),
 * digitada por quem já sabe que algo está errado e que muda a janela num argumento. A aba é
 * lida por rotina, e o que ela precisa mostrar é a SEMANA: um defeito nascido na terça e uma
 * regressão de quinta não cabem em 24 horas, e uma tela que abrisse com a janela curta
 * ensinaria que "não há nada" quando há. Sete dias é também o teto desta porta, então o padrão
 * é o maior que ela aceita, e quem quiser mais tem o comando. `desde` continua sendo a MESMA
 * gramática e o MESMO teto das outras rotas, por `janela()`: o que muda é só o padrão.
 *
 * O `limite` É O DA CONSULTA DE DEFEITOS, e ele decide `premissa.parcial` dos dois blocos de
 * banco. O teto E o padrão são `DEFEITOS_DO_RESUMO` (`resumo.service.js`), a MESMA constante
 * que o comando usa, IMPORTADA e não redigitada: dois literais 200 aqui fariam a MESMA janela
 * sair "parcial" numa porta e completa na outra no dia em que um dos dois mudasse, e o
 * comentário que prometia a constante teria continuado verde enquanto isso.
 *
 * O TETO ACOMPANHAR O PADRÃO é o que faz `parcial` significar alguma coisa: pedir mais que o
 * padrão não estreita nada (a consulta já traz o máximo) e um teto MAIOR convidaria a puxar
 * mais linhas por requisição do que a tela usa, dentro do ciclo HTTP.
 */
export const resumoQuerySchema = Joi.object({
  desde: janela('7d'),
  limite: Joi.number().integer().min(1).max(DEFEITOS_DO_RESUMO).default(DEFEITOS_DO_RESUMO),
  // `--intervalo` DO COMANDO, que o bloco de saúde do resumo lê exatamente como `GET
  // /diag/saude` o lê. Ele entrou em 2026-09-02 junto com `porRelease` do `lento`, e pela
  // mesma razão: enquanto faltasse, a afirmação de que a porta HTTP cobre o comando inteiro
  // era falsa por duas bandeiras, e uma delas decide a contagem de amostras faltando do
  // relatório que a sessão remota abre lendo.
  intervalo: intervalo(),
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
