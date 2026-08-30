// Path: src/modules/uso/uso.queries.js
/**
 * @fileoverview O SQL do relatório de uso. Nenhuma instrumentação nova: tudo aqui é
 * consulta sobre o que `operations`, `audit_trail`, `users` e `atlas` já guardam.
 *
 * A JANELA É MEIO-ABERTA E CHEGA PRONTA, `>= $1 AND < $2`, em TODA consulta. Duas razões,
 * e a segunda é a que não se adivinha:
 *
 *  1. `>=`/`<` é a convenção que `audit.queries.js` já usa, e pelo mesmo motivo: um `<=` no
 *     fim faria a linha nascida exatamente na virada cair em dois baldes.
 *  2. O FIM DA JANELA É UM PARÂMETRO E NÃO `NOW()`. São cinco consultas em cinco idas ao
 *     banco, e com `NOW()` cada uma teria um fim próprio, alguns milissegundos à frente da
 *     anterior. O relatório deixaria de ser um retrato de um período e passaria a ser cinco
 *     retratos de cinco períodos quase iguais: a soma da série diária poderia divergir do
 *     total por uma operação que chegou no meio da leitura, e ninguém saberia dizer se a
 *     divergência é do relógio ou de um defeito de agregação. Com o fim fixado em JS as
 *     cinco respondem sobre o MESMO intervalo, e a igualdade vira invariante conferível.
 *
 * NENHUMA CONSULTA AQUI TOCA TABELA DE RECURSO (catálogo, `sv360`, `a3d`) nem devolve id de
 * recurso: o que sai é contagem, nome de atlas e nome de dono. Por isso o módulo não tem
 * predicado de acesso embutido — o gate é `requireAdmin`, na rota.
 */

/**
 * ATÉ ONDE O DADO ALCANÇA. É a consulta mais importante do módulo e a mais cara.
 *
 * `MIN(created_at)` GLOBAL, sem `WHERE`: a pergunta não é sobre a janela, é sobre a tabela.
 * O registro mais antigo que ainda EXISTE é o que diz se um pedido de 90 dias está sendo
 * respondido sobre 90 dias ou sobre 20.
 *
 * CUSTO, MEDIDO em 2026-08-30 com 100.000 linhas em cada tabela (`EXPLAIN ANALYZE`), e a
 * assimetria é o achado: `MIN` sobre `audit_trail` sai em `Index Only Scan Backward using
 * idx_audit_created`, 0,06 ms, porque existe índice em `created_at` sozinho; `MIN` sobre
 * `operations` é `Seq Scan`, 19 ms, porque o único índice com aquela coluna é
 * `idx_operations_atlas_created (atlas_id, created_at)` e um `MIN` sobre a SEGUNDA coluna
 * de um composto não vira busca do menor.
 *
 * Um índice em `operations(created_at)` fecharia esta consulta E as outras três que varrem
 * a mesma tabela por janela, mas criar migração não é decisão deste módulo: fica relatado,
 * porque índice acrescentado sem pedido é escrita em schema que ninguém reviu.
 */
export const HORIZONTE = `
  SELECT
    (SELECT MIN(created_at) FROM operations)  AS operacoes_desde,
    (SELECT MIN(created_at) FROM audit_trail) AS trilha_desde
`;

/**
 * As quatro contagens de PESSOAS, em uma ida ao banco.
 *
 * `contas_ativas` NÃO TEM JANELA, e a diferença é de pergunta, não de descuido: "quantas
 * contas existem hoje" é estado, enquanto as outras três são fluxo. Misturá-las numa
 * cláusula só produziria "contas ativas no período", que não significa nada.
 *
 * `entraram` LÊ A TRILHA, E A AÇÃO TEM EMISSOR: `LOGIN` é escrito por
 * `auth.controller.js` (best-effort, ver o comentário longo de lá). Isto foi CONFERIDO no
 * código antes de a consulta existir, porque a armadilha desta tabela é conhecida e
 * documentada em `002_auditoria.sql`: ação declarada no CHECK sem emissor devolve zero e o
 * zero se lê como resposta. `LOGIN` viveu assim desde o primeiro dia e ganhou emissor
 * depois; se ele voltar a perdê-lo, este número volta a mentir em silêncio, e é por isso
 * que o teste de integração semeia login REAL pela rota em vez de inserir a linha à mão.
 *
 * O `best-effort` cobra um preço que precisa estar dito: uma falha de escrita da trilha no
 * login some do caminho da requisição, então `entraram` é um PISO, nunca um número exato.
 *
 * `editaram` conta `user_id` DISTINTO em `operations`, e `COUNT(DISTINCT)` ignora NULL de
 * graça — que é o comportamento certo: a coluna é nullable e uma op sem autor identificado
 * não é uma pessoa a mais.
 */
export const PESSOAS = `
  SELECT
    (SELECT COUNT(*) FROM users WHERE is_active)                      AS contas_ativas,
    (SELECT COUNT(*) FROM users
       WHERE created_at >= $1 AND created_at < $2)                    AS novas_contas,
    (SELECT COUNT(DISTINCT actor_id) FROM audit_trail
       WHERE action = 'LOGIN'
         AND created_at >= $1 AND created_at < $2)                    AS entraram,
    (SELECT COUNT(DISTINCT user_id) FROM operations
       WHERE created_at >= $1 AND created_at < $2)                    AS editaram
`;

/**
 * As quatro contagens de ATLAS.
 *
 * `vivos` é estado (não excluído, hoje) pelo mesmo motivo de `contas_ativas`.
 *
 * `criados` conta TODO atlas nascido na janela, o que foi excluído depois inclusive, e
 * `excluidos` conta pela data do soft-delete. Os dois se sobrepõem de propósito: um atlas
 * criado e apagado no mesmo período aparece nas duas contagens, porque os dois fatos
 * aconteceram. Descontar um do outro seria inventar uma terceira pergunta.
 *
 * `com_edicao` é atlas DISTINTO com operação na janela, e é o número que responde "quantos
 * atlas estão vivos de verdade", que `vivos` não responde: um acervo pode ter cem atlas e
 * três em uso.
 */
export const ATLAS_RESUMO = `
  SELECT
    (SELECT COUNT(*) FROM atlas WHERE deleted_at IS NULL)             AS vivos,
    (SELECT COUNT(*) FROM atlas
       WHERE created_at >= $1 AND created_at < $2)                    AS criados,
    (SELECT COUNT(*) FROM atlas
       WHERE deleted_at >= $1 AND deleted_at < $2)                    AS excluidos,
    (SELECT COUNT(DISTINCT atlas_id) FROM operations
       WHERE created_at >= $1 AND created_at < $2)                    AS com_edicao
`;

/**
 * Os atlas mais ativos da janela, por número de operações.
 *
 * O `LEFT JOIN users` É CONTRATO, não estilo, e a lição é a mesma de `audit.queries.js`:
 * `atlas.owner_id` é FK **sem `ON DELETE`**, então a linha do dono não some sozinha — mas
 * se algum caminho de manutenção a fizer sumir, um `INNER JOIN` apagaria da lista
 * justamente o atlas cujo dono se perdeu, que é o que alguém estaria investigando. Com
 * `LEFT`, `dono` fica nulo e a linha continua lá.
 *
 * O `JOIN atlas` É INTERNO de propósito, e a assimetria com o de cima tem fundamento no
 * schema: `operations.atlas_id` é `NOT NULL REFERENCES atlas(id) ON DELETE CASCADE`, então
 * op órfã não é um estado alcançável. Atlas SOFT-deletado continua com linha e continua
 * aparecendo aqui, o que é o desejado: ele foi usado na janela.
 *
 * O DESEMPATE POR NOME não é enfeite. Sem ele, dois atlas com a mesma contagem trocam de
 * lugar entre execuções (a ordem de um `GROUP BY` sem critério total é livre), e o corte em
 * `$3` faria um deles entrar ou sair a cada carga da tela, com o relatório parecendo
 * instável sem que nada tivesse mudado.
 */
export const TOP_ATLAS = `
  SELECT a.id, a.name AS nome, u.nome AS dono, COUNT(*) AS operacoes
    FROM operations o
    JOIN atlas a ON a.id = o.atlas_id
    LEFT JOIN users u ON u.id = a.owner_id
   WHERE o.created_at >= $1 AND o.created_at < $2
   GROUP BY a.id, a.name, u.nome
   ORDER BY COUNT(*) DESC, a.name ASC
   LIMIT $3
`;

/**
 * A produção por tipo de entidade.
 *
 * SEM `LIMIT`, ao contrário do ranking de atlas: `entity_type` é vocabulário FECHADO do
 * protocolo de sync (algumas dezenas de valores, não uma dimensão que cresce com o uso), e
 * cortar a cauda esconderia justamente o tipo raro. É também o que torna a soma desta lista
 * igual ao total da produção, propriedade que o serviço usa em vez de uma sexta ida ao
 * banco.
 */
export const PRODUCAO_POR_ENTIDADE = `
  SELECT entity_type AS entidade, COUNT(*) AS total
    FROM operations
   WHERE created_at >= $1 AND created_at < $2
   GROUP BY entity_type
   ORDER BY COUNT(*) DESC, entity_type ASC
`;

/**
 * A série diária, SEM BURACOS.
 *
 * O `generate_series` é a peça inteira, e o `LEFT JOIN` contra ele é o que faz um dia sem
 * operação aparecer com zero. Um `GROUP BY` direto sobre `operations` devolveria só os dias
 * que TÊM linha, e uma série que pula dias é lida como queda de uso quando é ausência de
 * linha — o gráfico encosta os dois lados do buraco e desenha uma continuidade que não
 * existiu. É o mesmo defeito que a amostra de saúde documenta pelo outro lado: o que revela
 * a queda é o buraco na série, então o buraco precisa ser visível como ZERO e não como
 * ausência.
 *
 * O FUSO É O DO SERVIDOR, por construção: `date_trunc('day', timestamptz)` corta no fuso da
 * SESSÃO. Não há conversão para UTC nem para fuso do chamador, e isso é decisão: quem lê
 * este relatório é o administrador da instalação, e "segunda-feira" para ele é a
 * segunda-feira da máquina, não a de Greenwich.
 *
 * O PRIMEIRO DIA É PARCIAL, e é por isso que a janela é aplicada no `WHERE` do agregado.
 * Sem ela o primeiro balde pegaria o dia de calendário inteiro, incluindo horas anteriores
 * ao início da janela, e a soma da série passaria do total — dois números da mesma tela
 * discordando, com o mais visível sendo o errado. O último dia é parcial pela mesma razão.
 *
 * AGREGAR ANTES DE JUNTAR, E ISSO FOI MEDIDO. A forma óbvia é pendurar `operations` direto
 * no `LEFT JOIN` contra a série, com as fronteiras do dia na condição de junção. Ela é
 * correta e é QUADRÁTICA no par (dias, operações): sem igualdade para casar, o planejador
 * cai em `Nested Loop Left Join` e compara cada operação com cada dia. Medido em 2026-08-30
 * com 86.398 operações na janela: 31 dias custaram 512 ms e 2.591.940 linhas descartadas
 * pelo filtro de junção, e o teto de 365d multiplicaria as duas coisas por doze. Agregando
 * primeiro, a varredura acontece UMA vez e a junção é de trinta linhas contra trinta, por
 * IGUALDADE de `date_trunc`. É a mesma leitura de tabela que as outras consultas já fazem.
 *
 * O `COALESCE` É REDUNDANTE, E A REDUNDÂNCIA ESTÁ DECLARADA porque metade dela não tem
 * guarda. Com o agregado do lado direito de um `LEFT JOIN`, o dia sem operação vem com
 * `total` NULO; quem transforma isso em zero no payload é `inteiro()`, no serviço, e é ELE
 * a garantia. Tirar o `COALESCE` daqui foi MEDIDO em 2026-08-30 e a suíte segue verde, ou
 * seja: nenhum caso deste repositório o discrimina. Ele fica por uma razão só, dita em voz
 * alta para não ser lida como proteção que não é — esta consulta é colada num `psql` para
 * conferir a série à mão, e ali o `null` no lugar do zero é justamente o buraco que ela
 * existe para não ter.
 *
 * `to_char` E NÃO `::date`: a coluna precisa chegar ao cliente como a string 'AAAA-MM-DD'
 * do contrato. Um `date` viraria `Date` no driver e depois ISO-8601 em UTC no `JSON.stringify`,
 * ou seja, o dia poderia RECUAR na serialização — a data local 2026-08-30 sairia
 * "2026-08-29T03:00:00.000Z" num servidor em UTC-3. O fuso que o `date_trunc` acertou seria
 * desfeito na última linha do caminho.
 */
export const PRODUCAO_POR_DIA = `
  WITH dias AS (
    SELECT generate_series(
             date_trunc('day', $1::timestamptz),
             date_trunc('day', $2::timestamptz),
             interval '1 day'
           ) AS dia
  ),
  producao AS (
    SELECT date_trunc('day', created_at) AS dia, COUNT(*) AS total
      FROM operations
     WHERE created_at >= $1 AND created_at < $2
     GROUP BY 1
  )
  SELECT to_char(d.dia, 'YYYY-MM-DD') AS dia,
         COALESCE(p.total, 0) AS total
    FROM dias d
    LEFT JOIN producao p ON p.dia = d.dia
   ORDER BY d.dia
`;
