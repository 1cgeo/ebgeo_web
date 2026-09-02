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
