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
 *  2. O FIM DA JANELA É UM PARÂMETRO E NÃO `NOW()`. Cada consulta daqui é uma ida ao banco, e
 *     com `NOW()` cada uma teria um fim próprio, alguns milissegundos à frente da anterior. O
 *     relatório deixaria de ser um retrato de um período e passaria a ser um retrato por
 *     consulta, de períodos quase iguais: a soma da série diária poderia divergir do total
 *     por uma operação que chegou no meio da leitura, e ninguém saberia dizer se a
 *     divergência é do relógio ou de um defeito de agregação. Com o fim fixado em JS todas
 *     respondem sobre o MESMO intervalo, e a igualdade vira invariante conferível. (A
 *     contagem de consultas morava nesta linha e envelheceu na primeira que se acrescentou;
 *     o que vale é a propriedade, e a lista viva são os `export` deste arquivo.)
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
 * igual ao total da produção, propriedade que o serviço usa em vez de mais uma ida ao banco.
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

/**
 * O FUNIL DE ENTRADA: de quem criou conta no período, quantos chegaram ao primeiro atlas e
 * quantos chegaram à primeira edição.
 *
 * ELE É ANINHADO, E ISSO É A DECISÃO INTEIRA. `com_producao` sai de `com_atlas`, e não de
 * `novos`: o terceiro passo é um SUBCONJUNTO do segundo, por construção. A alternativa
 * (contar as duas etapas contra a coorte inteira) é a que se escreve sem pensar, e ela
 * produz um número maior no passo 3 que no passo 2 assim que uma pessoa editar o atlas de
 * outra sem nunca ter criado o seu, que é caso comum: `write` num atlas compartilhado é o
 * modo normal de trabalhar aqui. O funil deixaria de ser monotônico e a conversão da tela
 * passaria de 100% sem nada estar errado no dado. O preço, dito em voz alta: quem só edita
 * atlas alheio não aparece no terceiro passo. É a leitura certa para a pergunta que o funil
 * faz, que é se o cadastro leva à produção PRÓPRIA.
 *
 * O RECORTE DA JANELA É SÓ DA COORTE. `novos` é quem nasceu entre `$1` e `$2`; os passos 2 e
 * 3 NÃO têm teto de tempo, porque a pergunta é "dos que entraram naquele período, quantos
 * chegaram lá", e a conversão acontece depois. Em produção `$2` é agora, então não existe
 * nada à direita dele e as duas leituras coincidem; o que muda é o SENTIDO, e ele precisa
 * ser o do funil, senão a coorte da última semana pareceria a que menos converte só por ter
 * tido menos tempo.
 *
 * OS DOIS PISOS DE TEMPO (`a.created_at >= n.created_at` e `o.created_at >= c.created_at`)
 * existem para que a MEDIANA não possa ser negativa. O dono de um atlas pode mudar (a
 * transferência obrigatória antes do hard-delete de conta reescreve `atlas.owner_id`), e sem
 * o piso um atlas de 2024 adotado por uma conta de 2026 entraria como "criou o primeiro
 * atlas dezessete mil horas ANTES de se cadastrar". Um negativo ali não quebra nada: sai na
 * tela como se fosse medida.
 *
 * `o.created_at >= $1` É REDUNDANTE E É O QUE PAGA O ÍNDICE. Toda op que interessa é de uma
 * conta nascida na janela e vem depois dela, logo já é `>= $1`; a cláusula não muda uma linha
 * do resultado. O que ela muda é o PLANO: `operations` não tem índice em `user_id`
 * (conferido em `004_sync.sql`), então sem uma constante de faixa o planejador varre a tabela
 * inteira, e com ela usa o índice de `015_uso_indice_operations.sql` para se restringir à
 * janela, que é a mesma leitura que as outras consultas deste módulo já fazem.
 *
 * MEDIDO em 2026-09-02 com `EXPLAIN (ANALYZE, BUFFERS)` sobre 100.000 operações, 2.000 contas
 * e 1.500 atlas, janela de 90 dias, no schema real (mesmos índices):
 *   sem a cláusula -> `Seq Scan on operations`, 100.000 linhas lidas, 10,35 ms
 *   com a cláusula -> `Bitmap Index Scan on idx_operations_created`, 10.195 linhas, 2,52 ms
 * É por isso que esta fase NÃO acrescenta migração nenhuma: o índice que resolve já existe, e
 * o que faltava era dar ao planejador a constante com que usá-lo. Um índice em
 * `operations(user_id)` também fecharia o caso, e seria pagar um `CREATE INDEX` com lock de
 * escrita na maior tabela do sistema (ver o cabeçalho de `015_uso_indice_operations.sql`)
 * para comprar o que uma linha de SQL já compra.
 *
 * `percentile_cont` SOBRE CONJUNTO VAZIO DEVOLVE NULL, e o `null` precisa sobreviver até o
 * payload: zero hora é uma medida ("criou o atlas no mesmo instante"), e nenhuma medida é
 * outra coisa. Quem preserva isso é `decimalOuNulo`; `inteiro()` NÃO serve aqui, porque ele
 * devolveria 0.
 */
export const FUNIL_DE_ENTRADA = `
  WITH novos AS (
    SELECT id, created_at
      FROM users
     WHERE created_at >= $1 AND created_at < $2
  ),
  com_atlas AS (
    SELECT n.id, n.created_at, MIN(a.created_at) AS em
      FROM novos n
      JOIN atlas a ON a.owner_id = n.id
                  AND a.created_at >= n.created_at
     GROUP BY n.id, n.created_at
  ),
  com_producao AS (
    SELECT c.id, c.created_at, MIN(o.created_at) AS em
      FROM com_atlas c
      JOIN operations o ON o.user_id = c.id
                       AND o.created_at >= c.created_at
                       AND o.created_at >= $1
     GROUP BY c.id, c.created_at
  )
  SELECT
    (SELECT COUNT(*) FROM novos)        AS cadastraram,
    (SELECT COUNT(*) FROM com_atlas)    AS criaram_atlas,
    (SELECT COUNT(*) FROM com_producao) AS produziram,
    (SELECT percentile_cont(0.5) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM (em - created_at)) / 3600.0)
       FROM com_atlas)                  AS horas_ate_atlas,
    (SELECT percentile_cont(0.5) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM (em - created_at)) / 3600.0)
       FROM com_producao)               AS horas_ate_producao
`;

/**
 * A COORTE DE RETENÇÃO: de quem criou conta em cada semana do período, quantos voltaram a
 * entrar na semana seguinte, na segunda, na terceira e na quarta.
 *
 * A ÂNCORA É A SEMANA DA COORTE, NUNCA O INSTANTE DE CADA CADASTRO, e essa escolha decide se
 * a tabela pode ser lida. `date_trunc('week', …)` do Postgres corta na SEGUNDA (semana ISO),
 * e a janela "S+1" de uma coorte é `[semana + 7d, semana + 14d)` para todos os membros dela.
 * A alternativa por pessoa (de 7 a 13 dias depois DAQUELE cadastro) é mais precisa e é
 * impossível de rotular: os membros da mesma coorte atravessariam a fronteira em dias
 * diferentes, então a célula estaria fechada para uns e aberta para outros, e nenhuma frase
 * honesta cabe num número assim. Com a âncora comum, a célula ou está inteira no passado ou
 * não está, e é isso que `semanas_completas` decide.
 *
 * `semanas_completas` É ARITMÉTICA, E NÃO QUATRO BOOLEANOS, e ela é calculada AQUI e não em
 * JS por uma razão de fuso: `semana` viaja como a string 'AAAA-MM-DD' do contrato (mesma
 * decisão de `PRODUCAO_POR_DIA`, pelo mesmo motivo), e refazer a fronteira a partir daquela
 * string do outro lado exigiria adivinhar o fuso do servidor. A célula `n` está fechada quando
 * `semana + 7*(n+1) dias <= $2`, e o par `LEAST`/`GREATEST` prende o resultado entre 0 e 4.
 *
 * TUDO AQUI CONTA SEMANA DE CALENDÁRIO, E NADA CONTA 604800 SEGUNDOS, e essa é a correção que
 * a primeira versão não tinha. A faixa do `JOIN` sempre foi de calendário, porque somar
 * `interval '7 days'` a um `timestamptz` no Postgres preserva a hora local e portanto atravessa
 * o horário de verão como a pessoa o vive; o `n` daquela versão vinha de
 * `EXTRACT(EPOCH …) / 604800`, que são 168 horas EXATAS. Nas semanas em que o relógio anda uma
 * hora, as duas grades divergem: um login perto da fronteira entra na faixa por calendário e é
 * classificado no `n` anterior, ou seja, cai numa célula onde não pertence, ou some das quatro.
 * Não há fuso com horário de verão em produção HOJE, o que torna o defeito invisível e não o
 * torna inexistente: `TZ` é do ambiente, não do código. A grade única é `date_trunc('week', …)`
 * dos dois lados, subtraída como DATA (`::date`), porque `date - date` devolve um inteiro de
 * dias e a diferença entre duas segundas-feiras locais é múltipla de sete em qualquer regime.
 * Dividir INTERVALO por intervalo não é opção: o Postgres não define o operador.
 *
 * CÉLULA ABERTA É `null` NO PAYLOAD, E NUNCA ZERO. Uma semana que ainda corre subconta por
 * construção, e um zero ali se lê como abandono, que é a afirmação oposta à verdadeira. É a
 * mesma armadilha do buraco na série diária, pelo outro lado.
 *
 * SEMANA SEM CADASTRO NÃO VIRA LINHA, e isso é o AVESSO do preenchimento de dias. Lá o zero é
 * fato ("ninguém produziu naquele dia"); aqui não há coorte, e uma linha de denominador zero
 * não tem retenção nenhuma para mostrar, porque 0 de 0 não é 0%.
 *
 * `a.created_at >= $1` É REDUNDANTE E PAGA O ÍNDICE, como no funil: `semana` é no máximo a
 * segunda-feira anterior ao cadastro, então `semana + 7d` é sempre posterior a `$1`, e a
 * cláusula não muda uma linha do resultado. A intuição diz que aqui ela é só folga, porque
 * `idx_audit_actor` existe e a coorte é pequena; a MEDIÇÃO diz o contrário, e é por isso que
 * ela fica: em 2026-09-02, com 100.000 linhas de trilha e 2.000 contas, o planejador escolheu
 * `Bitmap Index Scan on idx_audit_created` (9.836 linhas, 3,54 ms no total da consulta), ou
 * seja, é a faixa de tempo que ele usa e não o ator. Palpite sobre plano não substitui
 * `EXPLAIN`.
 *
 * O `DISTINCT` DE `retencao` É O QUE FAZ A CONTA SER DE PESSOAS: três logins da mesma pessoa
 * na mesma semana são uma linha só. O `COUNT(r.id) FILTER (…)` sobre ela conta contas
 * distintas, e o `LEFT JOIN` mantém com zero a coorte que não teve nenhum retorno, em vez de
 * sumir com a linha.
 *
 * A SEMANA ZERO É EXCLUÍDA DUAS VEZES, e saber disso é o que impede uma "simplificação" de
 * parecer segura. O login dentro da PRÓPRIA semana do cadastro não é retorno, e quem o barra
 * é o `>= c.semana + interval '7 days'` E o `FILTER (WHERE r.n = 1)`, cada um sozinho já
 * bastando. Medido revertendo: tirar UMA das duas deixa a suíte verde, e só tirar as DUAS
 * muda o número (a célula S+1 do teste vai de 2 para 4). A consequência prática é que nenhuma
 * das duas serve como controle negativo sozinha, e é por isso que
 * `tests/integration/uso-funil-e-retencao.test.js` declara a redundância em vez de fingir uma
 * guarda única.
 *
 * A ORDEM AQUI É DECRESCENTE E A DA TELA É CRESCENTE, e a inversão é deliberada: quem reverte
 * é o serviço, e o `ORDER BY` existe para escolher QUEM O `LIMIT` CORTA. Com `ASC` o corte
 * apaga a coorte mais RECENTE, que é a que a pessoa está olhando e a única que ela não tem como
 * suspeitar que falta; com `DESC` ele apaga a mais antiga, que é a que já rendeu o que tinha a
 * render. O teto não deveria morder nunca (ver `MAX_SEMANAS_DE_COORTE`), e é por isso mesmo que
 * a escolha precisa estar certa: um corte que nunca acontece é um corte que ninguém vai depurar
 * no dia em que acontecer.
 *
 * O NÚMERO É UM PISO, e a razão NÃO é poda: `audit_trail` não é podada. É o `LOGIN` ser
 * best-effort (ver `PESSOAS`), então uma falha de escrita da trilha some da conta. A tela diz
 * "pelo menos" por causa disto, e não por causa do horizonte.
 */
export const COORTE_DE_RETENCAO = `
  WITH coortes AS (
    SELECT date_trunc('week', created_at) AS semana, id
      FROM users
     WHERE created_at >= $1 AND created_at < $2
  ),
  tamanho AS (
    SELECT semana, COUNT(*) AS cadastrados
      FROM coortes
     GROUP BY semana
  ),
  retencao AS (
    SELECT DISTINCT c.semana, c.id,
           ((date_trunc('week', a.created_at)::date - c.semana::date) / 7)::int AS n
      FROM coortes c
      JOIN audit_trail a ON a.actor_id = c.id
                        AND a.action = 'LOGIN'
                        AND a.created_at >= c.semana + interval '7 days'
                        AND a.created_at <  c.semana + interval '35 days'
                        AND a.created_at >= $1
  )
  SELECT to_char(t.semana, 'YYYY-MM-DD') AS semana,
         t.cadastrados,
         COUNT(r.id) FILTER (WHERE r.n = 1) AS w1,
         COUNT(r.id) FILTER (WHERE r.n = 2) AS w2,
         COUNT(r.id) FILTER (WHERE r.n = 3) AS w3,
         COUNT(r.id) FILTER (WHERE r.n = 4) AS w4,
         LEAST(4, GREATEST(0,
           ((date_trunc('week', $2::timestamptz)::date - t.semana::date) / 7)::int - 1
         )) AS semanas_completas
    FROM tamanho t
    LEFT JOIN retencao r ON r.semana = t.semana
   GROUP BY t.semana, t.cadastrados
   ORDER BY t.semana DESC
   LIMIT $3
`;

/* =========================================================================
 * O USO DE PRODUTO, desde 2026-09-02: a metade que NÃO é derivada de outra coisa.
 *
 * Tudo acima desta linha é consulta sobre tabelas que já existiam por outros motivos. O que
 * segue lê e escreve as três tabelas de `020_uso_de_produto.sql`, que são instrumentação
 * NOVA, e por isso a régua muda: aqui há UPSERT vindo de rota anônima, e há uma passada de
 * manutenção que APAGA linha. As decisões de forma (contador em vez de evento, dia do
 * servidor, saturação em vez de estouro) estão no cabeçalho daquela migração, que é a fonte;
 * o que segue é só o que morde quem lê o SQL sem abri-la.
 *
 * A JANELA CONTINUA CHEGANDO PRONTA, mas ela encosta em colunas `date` e não em
 * `timestamptz`, então a comparação é `dia >= $1::date AND dia <= $2::date`, INCLUSIVA nas
 * duas pontas. É a única família de consultas do módulo que não usa `>=`/`<`, e a diferença
 * não é descuido: um `<` sobre o dia do FIM apagaria o dia corrente da resposta inteira, que
 * é justamente o dia que alguém está olhando quando abre a tela.
 * ========================================================================= */

/**
 * A ESCRITA DAS CONTAGENS: um lote inteiro em UMA instrução.
 *
 * `unnest` DE TRÊS ARRAYS, e não uma instrução por evento: cinquenta idas ao banco dentro de
 * uma transação aberta por rota ANÔNIMA é o jeito de a telemetria competir com o sync pelo
 * pool de dez conexões. Os três arrays viajam como parâmetro, então o SQL continua 100%
 * parametrizado e não há montagem de texto com dado de chamador.
 *
 * O `GROUP BY` NÃO É OTIMIZAÇÃO, É CORREÇÃO, e sem ele a rota quebra com um erro que não tem
 * relação aparente com o assunto: `ON CONFLICT DO UPDATE` recusa afetar a MESMA linha duas
 * vezes na mesma instrução (`21000`, "cannot affect row a second time"), e um cliente que
 * mande duas entradas com o mesmo par (evento, qualificador) no mesmo lote produz exatamente
 * isso. Agregar antes torna a instrução correta para QUALQUER lote, em vez de correta para
 * os lotes que o nosso cliente costuma montar.
 *
 * A SOMA SATURA EM `INT_MAX` EM VEZ DE ESTOURAR. `contagem + EXCLUDED.contagem` em `integer`
 * é um `22003` alcançável por chamador anônimo (ver o cabeçalho da migração), ou seja um 500
 * na rota que existe para medir. A soma é feita em `bigint` e presa por `LEAST`: um contador
 * que satura diz "muitíssimas", e um erro do driver não diz nada.
 *
 * O `dia` SAI DO `ultimoSinal` DO LOTE, já aparado contra o relógio do servidor, e é o dia do
 * FUSO DA SESSÃO do Postgres, o mesmo de `PRODUCAO_POR_DIA`. Um lote que atravesse a
 * meia-noite cai no dia em que foi DESCARREGADO, e não no dia de cada gesto: o cliente não
 * carimba instante por evento, de propósito (é o que impediria de reconstruir a sequência de
 * uma pessoa), então essa precisão não existe para ser preservada.
 */
export const UPSERT_EVENTOS_DIA = `
  INSERT INTO uso_eventos_dia (dia, pagina, evento, prop, contagem)
  SELECT ($1::timestamptz)::date, $2::text, e.evento, e.prop, SUM(e.contagem)::int
    FROM unnest($3::text[], $4::text[], $5::int[]) AS e(evento, prop, contagem)
   GROUP BY e.evento, e.prop
  ON CONFLICT (dia, pagina, evento, prop) DO UPDATE
     SET contagem = LEAST(uso_eventos_dia.contagem::bigint + EXCLUDED.contagem, 2147483647)::int
`;

/**
 * A ESCRITA DA SESSÃO, e as regras de conflito NÃO são todas a mesma regra.
 *
 * Cada coluna tem uma razão própria para escolher entre o valor que já está lá e o que
 * chegou, e escrever "o último vence" para todas seria perder três medidas diferentes:
 *
 *  - `ultimo_sinal` é `GREATEST`, nunca `EXCLUDED`: lotes podem chegar fora de ordem (rede,
 *    fila offline), e um lote atrasado empurraria a sessão para TRÁS, encurtando a duração;
 *  - `eventos` SOMA, com a mesma saturação da tabela de contagens, porque cada lote traz os
 *    eventos daquela descarga e não o acumulado da aba;
 *  - `erros` é `GREATEST` e não soma, porque o cliente manda o acumulado da sessão: somar
 *    contaria o mesmo erro uma vez por descarga, e a taxa "sessões com erro" que a saúde de
 *    release publica passaria a crescer com a duração da sessão em vez de com o defeito;
 *  - `user_id` é `COALESCE(EXCLUDED, atual)`, ou seja o ÚLTIMO não nulo vence: a aba começa
 *    anônima e a pessoa entra no meio, que é o caminho normal deste produto. O contrário
 *    (primeiro vence) deixaria toda sessão que começou deslogada contada como anônima para
 *    sempre, e `usuarios_distintos` mediria só quem já chegou logado;
 *  - `release` e `navegador` são `COALESCE(atual, EXCLUDED)`, o PRIMEIRO não nulo: eles
 *    identificam a build e o navegador em que a sessão COMEÇOU, e é essa a pergunta da saúde
 *    de release;
 *  - os quatro VITAIS se dividem em dois pares, e a divisão é a natureza da métrica. `lcp_ms`
 *    e `tempo_ate_mapa_ms` são números de CARGA: acontecem uma vez, e o valor certo é o
 *    primeiro que chegou (`COALESCE(atual, EXCLUDED)`). `inp_ms` e `cls` CRESCEM ao longo da
 *    sessão (o pior atraso de interação até agora, o deslocamento acumulado até agora), e o
 *    valor certo é o mais recente (`COALESCE(EXCLUDED, atual)`). Trocar os pares faz o
 *    percentil de dois deles congelar no instante da carga.
 *
 * `dia` E `pagina_inicial` NÃO SÃO ATUALIZADOS, e é por isso que a segunda se chama assim: a
 * sessão pertence ao dia e à página em que o servidor ouviu falar dela pela primeira vez.
 * Deixá-los mover faria uma aba longa migrar de dia no meio do caminho, e o agregado do dia
 * fechado deixaria de bater com a soma que já foi publicada.
 */
export const UPSERT_SESSAO = `
  INSERT INTO uso_sessoes (
    sessao_id, dia, user_id, pagina_inicial, release, navegador,
    inicio, ultimo_sinal, eventos, erros, lcp_ms, inp_ms, cls, tempo_ate_mapa_ms
  ) VALUES (
    $1, ($7::timestamptz)::date, $2, $3, $4, $5,
    $6, $7, $8, $9, $10, $11, $12, $13
  )
  ON CONFLICT (sessao_id) DO UPDATE SET
    ultimo_sinal      = GREATEST(uso_sessoes.ultimo_sinal, EXCLUDED.ultimo_sinal),
    eventos           = LEAST(uso_sessoes.eventos::bigint + EXCLUDED.eventos, 2147483647)::int,
    erros             = GREATEST(uso_sessoes.erros, EXCLUDED.erros),
    user_id           = COALESCE(EXCLUDED.user_id, uso_sessoes.user_id),
    release           = COALESCE(uso_sessoes.release, EXCLUDED.release),
    navegador         = COALESCE(uso_sessoes.navegador, EXCLUDED.navegador),
    lcp_ms            = COALESCE(uso_sessoes.lcp_ms, EXCLUDED.lcp_ms),
    tempo_ate_mapa_ms = COALESCE(uso_sessoes.tempo_ate_mapa_ms, EXCLUDED.tempo_ate_mapa_ms),
    inp_ms            = COALESCE(EXCLUDED.inp_ms, uso_sessoes.inp_ms),
    cls               = COALESCE(EXCLUDED.cls, uso_sessoes.cls)
`;

/**
 * A AGREGAÇÃO DO DIA FECHADO, que é o que sobrevive à poda.
 *
 * ELA CONVERGE, E ATÉ 2026-09-02 ELA NÃO CONVERGIA. A primeira versão usava
 * `ON CONFLICT DO NOTHING`, o que tirava o agregado de um dia UMA vez e nunca mais: uma sessão
 * que chegasse tarde para um dia já agregado (a fila offline descarregando de manhã, que é o
 * caso normal e não o excêntrico) sumia dos DOIS lados, porque `SESSOES_POR_DIA` deixa
 * `uso_diario` vencer onde ele existe. O dado entrava no banco e não aparecia em lugar nenhum.
 *
 * HOJE É `DO UPDATE`, e o dia é RE-AGREGADO a cada passada enquanto ainda tiver sessão viva.
 * A poda só remove depois da retenção, então a linha converge para o valor final e para de
 * mudar. A única perda que sobra, e ela está aqui em voz alta: uma sessão que chegue DEPOIS de
 * a poda ter levado as sessões daquele dia não entra mais, porque não há mais com o que
 * re-agregar. Isso exige um lote atrasado por mais tempo que `LOG_RETENTION_DAYS`, que é a
 * mesma janela em que `instantesDoLote` já para de aceitar o instante.
 *
 * O `WHERE EXCLUDED.sessoes >= uso_diario.sessoes` NÃO É ZELO, É O QUE IMPEDE A CONVERGÊNCIA
 * DE ANDAR PARA TRÁS. A poda é por `ultimo_sinal` e a agregação agrupa por `dia`, então na
 * fronteira da retenção um dia pode ter PARTE das sessões apagada; sem a condição, a passada
 * seguinte recomputaria aquele dia a partir do subconjunto sobrevivente e sobrescreveria um
 * número correto por um menor, plausível e definitivo. Com ela, a atualização só ACRESCE.
 *
 * O PISO fecha a outra ponta: sem ele a varredura reagregaria o histórico inteiro a cada
 * passada, e um dia de onde a poda já levou tudo teria sua linha recomputada a partir de zero
 * sessões (a condição acima o impediria de encolher, mas o trabalho seria pago mesmo assim).
 * Com o piso, a passada olha só a janela em que ainda pode haver sessão.
 *
 * O PISO É `retenção + 1` DIAS, E O DIA A MAIS NÃO É FOLGA. A poda mira um INSTANTE
 * (`ultimo_sinal < NOW() - retenção`) e a agregação agrupa por DIA, então os dois recortes não
 * coincidem: com o piso em `hoje - retenção` existiria uma faixa de um dia que a poda apaga e
 * que a agregação já parou de olhar, ou seja sessões destruídas sem nunca terem virado número.
 * Com o dia extra, todo dia que a poda alcança ainda está dentro do alcance da agregação na
 * MESMA passada, e é isso que torna a ordem "agregar, depois podar" uma garantia e não uma
 * coincidência de calendário.
 *
 * O QUE O PISO CUSTA, declarado: um dia que saia da retenção sem que nenhuma passada tenha
 * rodado no meio (servidor calado por mais tempo que `LOG_RETENTION_DAYS`) perde as sessões
 * sem virar agregado. Nesse cenário não houve escrita nenhuma, logo não havia sessão nova para
 * agregar; o caso é declarado por ser o único em que a convergência não acontece.
 *
 * `percentile_cont` IGNORA NULO, e é isso que permite `lcp_ms` só existir na página que
 * carrega mapa: a mediana de uma coluna vazia é NULL, e o NULL sobrevive até o payload
 * porque zero milissegundo é uma MEDIDA. Ver `decimalOuNulo` em `uso.horizonte.js`.
 *
 * O `GREATEST(0, ...)` NA DURAÇÃO É CINTO, e não a regra: `instantesDoLote` (`uso.lote.js`)
 * já prende `inicio` ao teto de `ultimoSinal` na escrita, então a linha nasce com duração não
 * negativa. Ele fica porque a linha pode ter nascido de um lote e recebido `ultimo_sinal` de
 * outro, e uma mediana negativa não se lê como defeito, se lê como medida.
 *
 * `COUNT(DISTINCT user_id)` IGNORA NULO DE GRAÇA, que é o comportamento certo: uma sessão
 * anônima não é uma pessoa a mais. Ela continua contada em `sessoes`, que é outra pergunta.
 */
export const AGREGAR_DIAS_FECHADOS = `
  INSERT INTO uso_diario (
    dia, pagina, sessoes, sessoes_autenticadas, usuarios_distintos, sessoes_com_erro,
    duracao_mediana_s, lcp_p75_ms, inp_p75_ms, cls_p75, tempo_ate_mapa_p75_ms
  )
  SELECT s.dia,
         s.pagina_inicial,
         COUNT(*)::int,
         COUNT(*) FILTER (WHERE s.user_id IS NOT NULL)::int,
         COUNT(DISTINCT s.user_id)::int,
         COUNT(*) FILTER (WHERE s.erros > 0)::int,
         percentile_cont(0.5) WITHIN GROUP (
           ORDER BY GREATEST(0, EXTRACT(EPOCH FROM (s.ultimo_sinal - s.inicio)))::double precision
         )::int,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY s.lcp_ms::double precision)::int,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY s.inp_ms::double precision)::int,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY s.cls::double precision)::numeric(6,3),
         percentile_cont(0.75) WITHIN GROUP (ORDER BY s.tempo_ate_mapa_ms::double precision)::int
    FROM uso_sessoes s
   WHERE s.dia < ($1::timestamptz)::date
     AND s.dia >= (($1::timestamptz)::date - ($2::int + 1))
   GROUP BY s.dia, s.pagina_inicial
  ON CONFLICT (dia, pagina) DO UPDATE SET
    sessoes               = EXCLUDED.sessoes,
    sessoes_autenticadas  = EXCLUDED.sessoes_autenticadas,
    usuarios_distintos    = EXCLUDED.usuarios_distintos,
    sessoes_com_erro      = EXCLUDED.sessoes_com_erro,
    duracao_mediana_s     = EXCLUDED.duracao_mediana_s,
    lcp_p75_ms            = EXCLUDED.lcp_p75_ms,
    inp_p75_ms            = EXCLUDED.inp_p75_ms,
    cls_p75               = EXCLUDED.cls_p75,
    tempo_ate_mapa_p75_ms = EXCLUDED.tempo_ate_mapa_p75_ms
  WHERE EXCLUDED.sessoes >= uso_diario.sessoes
  RETURNING dia, pagina
`;

/**
 * A PODA DAS SESSÕES, com o mesmo desenho de `DELETE_DEFEITOS_EXPIRADOS`.
 *
 * O TETO POR PASSADA EXISTE PELO LOCK: um `DELETE` sem limite sobre uma tabela grande segura
 * a transação e as linhas por tempo indefinido, e o que sobrar sai na passada seguinte. A
 * ordenação por `ultimo_sinal` faz a passada apagar sempre o mais velho primeiro, de modo que
 * o atraso se concentra no que menos importa.
 *
 * A ORDEM COM A AGREGAÇÃO É O CONTRATO INTEIRO, e ela é imposta pelo chamador
 * (`uso.eventos.service.js`): agregar e SÓ ENTÃO apagar. Invertida, a poda leva embora as
 * sessões de um dia que ainda não virou linha em `uso_diario`, e o dia some do relatório sem
 * erro nenhum e sem nada ficar vermelho.
 */
export const DELETE_SESSOES_EXPIRADAS = `
  DELETE FROM uso_sessoes
   WHERE sessao_id IN (
     SELECT sessao_id
       FROM uso_sessoes
      WHERE ultimo_sinal < NOW() - ($1::int * INTERVAL '1 day')
      ORDER BY ultimo_sinal
      LIMIT $2
   )
  RETURNING sessao_id
`;

/**
 * A SÉRIE DIÁRIA DE SESSÕES, E A COSTURA ENTRE O DIA FECHADO E O DIA ABERTO.
 *
 * ESTA É A CONSULTA QUE PRECISA SER LIDA ANTES DE MEXER EM QUALQUER OUTRA DESTA FAMÍLIA. O
 * mesmo dia pode ter DUAS fontes (a linha de `uso_diario`, escrita quando ele fechou, e as
 * linhas de `uso_sessoes`, que sobrevivem até a retenção), e somar as duas contaria tudo em
 * dobro. A regra é: `uso_diario` VENCE onde existir, e as sessões cobrem o resto.
 *
 * O `NOT EXISTS` É POR (dia, PÁGINA), e não por dia, e a diferença importa num caso real: a
 * agregação insere todas as páginas de um dia na mesma instrução, mas `ON CONFLICT DO
 * NOTHING` significa que uma página cuja primeira sessão só apareceu DEPOIS da passada nunca
 * entra em `uso_diario`. Com o teste por dia, aquelas sessões seriam descartadas e a página
 * sumiria do relatório; com o teste por par, elas entram pelo ramo aberto.
 *
 * POR QUE O RAMO ABERTO TAMBÉM AGRUPA POR PÁGINA, mesmo devolvendo série por DIA: para que os
 * dois lados da costura sejam a MESMA grandeza. `usuarios_distintos` de `uso_diario` é
 * distinto DENTRO da página, então a soma do dia conta duas vezes quem usou duas páginas;
 * fazer o ramo aberto contar distinto no dia inteiro produziria um número menor pela mesma
 * pessoa, e a série teria um degrau na fronteira entre o dia fechado e o aberto, que se lê
 * como queda de uso. Consistência dos dois lados vale mais que precisão de um só.
 *
 * O `generate_series` PREENCHE OS BURACOS, pela mesma razão de `PRODUCAO_POR_DIA`: um dia sem
 * sessão é zero, e uma série que pula dias é lida como queda quando é ausência de linha.
 */
export const SESSOES_POR_DIA = `
  WITH dias AS (
    SELECT generate_series(
             date_trunc('day', $1::timestamptz),
             date_trunc('day', $2::timestamptz),
             interval '1 day'
           )::date AS dia
  ),
  fechados AS (
    SELECT d.dia, d.sessoes, d.sessoes_autenticadas, d.usuarios_distintos, d.sessoes_com_erro
      FROM uso_diario d
     WHERE d.dia >= ($1::timestamptz)::date
       AND d.dia <= ($2::timestamptz)::date
  ),
  abertos AS (
    SELECT s.dia,
           COUNT(*)::int                                     AS sessoes,
           COUNT(*) FILTER (WHERE s.user_id IS NOT NULL)::int AS sessoes_autenticadas,
           COUNT(DISTINCT s.user_id)::int                     AS usuarios_distintos,
           COUNT(*) FILTER (WHERE s.erros > 0)::int           AS sessoes_com_erro
      FROM uso_sessoes s
     WHERE s.dia >= ($1::timestamptz)::date
       AND s.dia <= ($2::timestamptz)::date
       AND NOT EXISTS (
         SELECT 1 FROM uso_diario d
          WHERE d.dia = s.dia AND d.pagina = s.pagina_inicial
       )
     GROUP BY s.dia, s.pagina_inicial
  ),
  unido AS (
    SELECT * FROM fechados
    UNION ALL
    SELECT * FROM abertos
  )
  SELECT to_char(d.dia, 'YYYY-MM-DD')                  AS dia,
         COALESCE(SUM(u.sessoes), 0)::int              AS sessoes,
         COALESCE(SUM(u.sessoes_autenticadas), 0)::int AS sessoes_autenticadas,
         COALESCE(SUM(u.usuarios_distintos), 0)::int   AS usuarios_distintos,
         COALESCE(SUM(u.sessoes_com_erro), 0)::int     AS sessoes_com_erro
    FROM dias d
    LEFT JOIN unido u ON u.dia = d.dia
   GROUP BY d.dia
   ORDER BY d.dia
`;

/**
 * As DUAS medidas da janela que NÃO se derivam do agregado diário.
 *
 * "Quantas PESSOAS distintas" e "qual a duração MEDIANA" são as duas perguntas que somar
 * linhas de `uso_diario` não responde: contagem distinta não se soma entre dias, e mediana
 * não se re-agrega a partir de medianas. Elas saem, portanto, das SESSÕES RETIDAS, e isso
 * tem uma consequência que a tela precisa dizer: quando a janela pedida ultrapassa
 * `LOG_RETENTION_DAYS`, os dois números cobrem só a parte retida da janela, ou seja são um
 * PISO. Quem permite ao consumidor perceber isso é `horizonte.usoSessoesDesde`, que viaja no
 * mesmo payload e na mesma unidade, pela mesma razão de o horizonte de `operations` viajar ao
 * lado de `desde`: dois instantes dão quatro desfechos, um booleano daria dois.
 */
export const USO_NA_JANELA = `
  SELECT COUNT(*)::int                  AS sessoes_retidas,
         COUNT(DISTINCT s.user_id)::int AS usuarios_distintos,
         percentile_cont(0.5) WITHIN GROUP (
           ORDER BY GREATEST(0, EXTRACT(EPOCH FROM (s.ultimo_sinal - s.inicio)))::double precision
         ) AS duracao_mediana_s
    FROM uso_sessoes s
   WHERE s.dia >= ($1::timestamptz)::date
     AND s.dia <= ($2::timestamptz)::date
`;

/**
 * OS GESTOS MAIS FREQUENTES DA JANELA, do mais para o menos.
 *
 * O NOME DO BLOCO NO PAYLOAD É `ferramentas` E A CONSULTA NÃO FILTRA POR FERRAMENTA, e isso é
 * deliberado: o bloco responde "o que as pessoas fazem", e cortar tudo o que não é
 * `ferramenta.ativada` esconderia justamente os desfechos caros (o 3D que subiu, o PDF que
 * saiu, o `.ebgeo` que entrou), que são poucos e são os que decidem prioridade. O nome é o da
 * TELA, não o do recorte.
 *
 * O DESEMPATE POR (evento, qualificador) não é enfeite, e a lição é a mesma de `TOP_ATLAS`:
 * sem ele, duas linhas de contagem igual trocam de lugar entre execuções e o corte em `$3`
 * faz uma delas entrar ou sair a cada carga da tela, com o relatório parecendo instável sem
 * que nada tenha mudado.
 */
export const EVENTOS_TOP = `
  SELECT evento, prop, SUM(contagem)::bigint AS contagem
    FROM uso_eventos_dia
   WHERE dia >= ($1::timestamptz)::date
     AND dia <= ($2::timestamptz)::date
   GROUP BY evento, prop
   ORDER BY SUM(contagem) DESC, evento ASC, prop ASC
   LIMIT $3
`;

/**
 * O DESEMPENHO POR PÁGINA, calculado sobre as SESSÕES RETIDAS.
 *
 * ESTE É O NÚMERO VERDADEIRO, e é ele que o serviço prefere sempre que existir amostra: um
 * percentil se calcula sobre a distribuição, e a distribuição são as sessões. O irmão
 * (`DESEMPENHO_DIARIO`) só entra quando não há nenhuma sessão retida da página na janela, e o
 * payload DIZ qual dos dois respondeu, no campo `origem`.
 */
export const DESEMPENHO_POR_SESSAO = `
  SELECT s.pagina_inicial AS pagina,
         COUNT(*)::int    AS amostras,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY s.lcp_ms::double precision)::int AS lcp_p75_ms,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY s.inp_ms::double precision)::int AS inp_p75_ms,
         percentile_cont(0.75) WITHIN GROUP (
           ORDER BY s.cls::double precision
         )::numeric(6,3) AS cls_p75,
         percentile_cont(0.75) WITHIN GROUP (
           ORDER BY s.tempo_ate_mapa_ms::double precision
         )::int AS tempo_ate_mapa_p75_ms
    FROM uso_sessoes s
   WHERE s.dia >= ($1::timestamptz)::date
     AND s.dia <= ($2::timestamptz)::date
   GROUP BY s.pagina_inicial
   ORDER BY s.pagina_inicial
`;

/**
 * O DESEMPENHO POR PÁGINA quando as sessões já foram podadas: a MEDIANA DAS P75 DIÁRIAS.
 *
 * ELA NÃO É O P75 DA JANELA, E NÃO PODE SER APRESENTADA COMO SE FOSSE. Um percentil não se
 * re-agrega a partir de percentis: a mediana de trinta p75 diários é uma medida de TENDÊNCIA
 * CENTRAL DOS DIAS, não o percentil 75 da distribuição de sessões daqueles trinta dias, e os
 * dois divergem tanto mais quanto mais desiguais forem os dias. Ela é útil (responde "como os
 * dias costumavam estar"), e por isso existe; o que ela não pode é chegar ao consumidor sem
 * etiqueta, e é o `origem: 'diario'` do payload que a etiqueta.
 *
 * A MEDIANA E NÃO A MÉDIA, porque um único dia patológico (um deploy ruim, um incidente de
 * rede) desloca a média de um mês inteiro e não desloca a mediana, e a pergunta desta linha é
 * "como os dias costumavam estar", não "quanto a soma dos dias vale".
 *
 * `amostras` AQUI CONTA DIAS, e no irmão conta SESSÕES. Os dois campos têm o mesmo nome e
 * grandezas diferentes, e é por isso que `origem` viaja junto: sem ele, "amostras: 30"
 * pareceria trinta sessões.
 */
export const DESEMPENHO_DIARIO = `
  SELECT d.pagina,
         COUNT(*)::int AS amostras,
         percentile_cont(0.5) WITHIN GROUP (
           ORDER BY d.lcp_p75_ms::double precision
         )::int AS lcp_p75_ms,
         percentile_cont(0.5) WITHIN GROUP (
           ORDER BY d.inp_p75_ms::double precision
         )::int AS inp_p75_ms,
         percentile_cont(0.5) WITHIN GROUP (
           ORDER BY d.cls_p75::double precision
         )::numeric(6,3) AS cls_p75,
         percentile_cont(0.5) WITHIN GROUP (
           ORDER BY d.tempo_ate_mapa_p75_ms::double precision
         )::int AS tempo_ate_mapa_p75_ms
    FROM uso_diario d
   WHERE d.dia >= ($1::timestamptz)::date
     AND d.dia <= ($2::timestamptz)::date
   GROUP BY d.pagina
   ORDER BY d.pagina
`;

/**
 * QUANTAS PESSOAS BATERAM NA TELA DE INDISPONIBILIDADE, por dia.
 *
 * É a única medida de disponibilidade VISTA DA PONTA que este produto tem, e ela não é
 * derivável de nada no servidor: o boot do mapa é fail-fast em `GET /api/config`, e quando o
 * backend está fora não existe requisição para o log em arquivo registrar. O evento é
 * relatado quando o servidor VOLTA (o cliente guarda a contagem e a descarrega depois), então
 * ele mede a ausência pelo único caminho possível.
 *
 * A SÉRIE É PREENCHIDA COM ZERO, pela razão de sempre, e aqui ela tem uma leitura invertida
 * que vale dizer: o zero é a BOA notícia. Um dia sem linha não pode aparecer como buraco,
 * porque um buraco ao lado de um pico se lê como "não sabemos", e aqui sabemos.
 */
export const DISPONIBILIDADE_POR_DIA = `
  WITH dias AS (
    SELECT generate_series(
             date_trunc('day', $1::timestamptz),
             date_trunc('day', $2::timestamptz),
             interval '1 day'
           )::date AS dia
  ),
  vistos AS (
    SELECT dia, SUM(contagem)::bigint AS total
      FROM uso_eventos_dia
     WHERE evento = 'indisponivel.visto'
       AND dia >= ($1::timestamptz)::date
       AND dia <= ($2::timestamptz)::date
     GROUP BY dia
  )
  SELECT to_char(d.dia, 'YYYY-MM-DD') AS dia,
         COALESCE(v.total, 0)         AS vistos
    FROM dias d
    LEFT JOIN vistos v ON v.dia = d.dia
   ORDER BY d.dia
`;

/**
 * ATÉ ONDE O DADO DE USO ALCANÇA, e são DUAS fontes que limitam metades diferentes.
 *
 * `sessoes_desde` é o instante da sessão retida mais antiga, e ele limita tudo o que se
 * calcula sobre sessões: pessoas distintas na janela, duração mediana e o desempenho quando a
 * origem é `sessoes`. `diario_desde` é o dia agregado mais antigo, e ele limita a série e os
 * totais, que sobrevivem à poda.
 *
 * SEM `WHERE`: a pergunta não é sobre a janela, é sobre a tabela. É a mesma decisão, e o
 * mesmo argumento, de `HORIZONTE` lá em cima: o registro mais antigo que ainda EXISTE é o que
 * diz se um pedido de 90 dias está sendo respondido sobre 90 dias ou sobre 20.
 *
 * `MIN(dia)` VIRA `timestamptz` AQUI e não no JS: o dia é uma data local do servidor, e
 * convertê-la fora do banco exigiria adivinhar o fuso dele. É a mesma razão pela qual a
 * semana da coorte viaja como string.
 */
export const HORIZONTE_DE_USO = `
  SELECT
    (SELECT MIN(inicio) FROM uso_sessoes)          AS sessoes_desde,
    (SELECT MIN(dia)::timestamptz FROM uso_diario) AS diario_desde
`;

/**
 * A SAÚDE POR RELEASE: das builds que estiveram no ar na janela, quantas sessões, quantas com
 * erro, quantos defeitos NASCERAM nelas e quantas REGRESSÕES foram atribuídas a elas.
 *
 * ELA CRUZA AS DUAS METADES DA OBSERVABILIDADE, e é a única consulta do repositório que faz
 * isso: `uso_sessoes` é telemetria de USO e `defeitos` é telemetria de ERRO, e a pergunta que
 * só o cruzamento responde é "esta build está pior que a anterior". Nem o número de defeitos
 * sozinho responde (uma build usada por dez pessoas tem menos defeitos que uma usada por
 * mil), nem o número de sessões.
 *
 * O RECORTE É POR SOBREPOSIÇÃO, E NÃO POR INÍCIO, e a diferença tem nome: a pergunta é quais
 * builds ESTIVERAM NO AR na janela, e uma sessão que começou antes dela e ainda respirava
 * dentro dela é a resposta mais literal possível para isso. A primeira versão comparava só
 * `s.inicio`, e com o `desde` curto que a rota do pulso usa por padrão (1h) isso significava
 * "builds em que alguém ABRIU uma aba na última hora", que é outra coisa e é a mais frágil das
 * duas: numa madrugada sem ninguém abrindo aba nova, a build no ar sumiria da tela. A condição
 * de sobreposição de dois intervalos é `fim_a >= inicio_b AND inicio_a < fim_b`, e é ela que
 * está escrita abaixo.
 *
 * A ORDEM CONTINUA POR `MAX(s.inicio)`, e não pelo último sinal, e a assimetria é deliberada:
 * o que se quer no topo é a build mais NOVA (a recém-implantada), e o sinal mais recente é da
 * build mais USADA, que pode ser a velha com muitas abas abertas.
 *
 * A JANELA SELECIONA QUAIS RELEASES, E NÃO QUAIS DEFEITOS, e essa assimetria é deliberada.
 * `sessoes` e `sessoes_com_erro` são da janela, porque são medida de tráfego; `defeitos_novos`
 * e `regressoes` NÃO têm recorte de tempo, porque "quantos defeitos nasceram nesta build" é
 * uma propriedade da BUILD e não do período em que se olha. Recortar os dois pela mesma
 * janela faria uma build recém-implantada parecer limpa por não ter tido tempo, que é a
 * afirmação oposta à útil.
 *
 * A ORDEM É PELO ÚLTIMO SINAL, E NÃO PELA CONTAGEM, e o `LIMIT` corta as mais ANTIGAS: a
 * pergunta é sobre as builds que estão no ar AGORA, e ordenar por volume poria a build velha
 * e muito usada acima da recém-implantada, que é exatamente a que se quer olhar.
 *
 * A CADEIA `release IS NOT NULL AND <> ''` existe porque `EBGEO_RELEASE` é opcional: uma
 * instalação que não o declara manda `null`, e agrupar por isso produziria uma linha "sem
 * release" que não responde nada e ocuparia uma das três vagas.
 */
export const SAUDE_POR_RELEASE = `
  WITH releases AS (
    SELECT s.release,
           MAX(s.inicio)                            AS ultima,
           COUNT(*)::int                            AS sessoes,
           COUNT(*) FILTER (WHERE s.erros > 0)::int AS sessoes_com_erro
      FROM uso_sessoes s
     WHERE s.release IS NOT NULL
       AND s.release <> ''
       AND s.ultimo_sinal >= $1
       AND s.inicio < $2
     GROUP BY s.release
     ORDER BY MAX(s.inicio) DESC
     LIMIT $3
  )
  SELECT r.release,
         r.sessoes,
         r.sessoes_com_erro,
         (SELECT COUNT(*) FROM defeitos d
           WHERE d.primeira_release = r.release)::int AS defeitos_novos,
         (SELECT COUNT(*) FROM defeitos d
           WHERE d.estado = 'regrediu'
             AND d.ultima_release = r.release)::int   AS regressoes
    FROM releases r
   ORDER BY r.ultima DESC
`;
