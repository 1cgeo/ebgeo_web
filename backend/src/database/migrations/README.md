# Bases para a primeira implantação

Consolidação autorizada em 12/09/2026, antes da primeira implantação deste backend. Os arquivos criam diretamente o estado final de cada domínio. A ordem respeita as dependências entre tabelas e funções.

| Arquivo | Responsabilidade |
| --- | --- |
| [001_identidade_e_credenciais.sql](001_identidade_e_credenciais.sql) | Organizações, postos, contas (com nome de guerra), tokens (com o vínculo da confirmação ao destinatário e o da recuperação ao corte de sessões), chaves de API e grupos de usuários. |
| [002_auditoria.sql](002_auditoria.sql) | Trilha administrativa, vocabulário de ações e índices de consulta. |
| [003_atlas.sql](003_atlas.sql) | Atlas, compartilhamentos e conteúdo colaborativo: imagens com identidade de tentativa e de conteúdo, slides com a vista e os controles de apresentação, e as importações atômicas. |
| [004_sync.sql](004_sync.sql) | Operações (com a identidade do lote lógico), versões e índices de sincronização e produção. |
| [005_catalogo.sql](005_catalogo.sql) | Bases, camadas, modelos publicados e configuração. |
| [006_ng.sql](006_ng.sql) | Gazetteer, busca e agrupamentos geográficos. |
| [007_sv360.sql](007_sv360.sql) | Projetos 360, metadados, faixas, fotos, alvos e pirâmides. |
| [008_acesso_a_recurso.sql](008_acesso_a_recurso.sql) | Concessões, empréstimos e funções de autorização. |
| [009_a3d.sql](009_a3d.sql) | Acervo 3D convertido e registro de importações. |
| [010_observabilidade.sql](010_observabilidade.sql) | Defeitos, ciclo de vida e evidências individuais limitadas. |
| [011_uso_e_presenca.sql](011_uso_e_presenca.sql) | Uso agregado, sessões, presença e deduplicação da coleta. |

## Migrações incrementais (depois do congelamento de 2026-09-22)

| Arquivo | Mudança |
| --- | --- |
| [012_presenca_aba_e_miniaturas.sql](012_presenca_aba_e_miniaturas.sql) | Coluna `aba_id` na presença (a saída explícita só apaga a linha do mesmo documento) e as três miniaturas semeadas de `.png` para `.webp`. |
| [013_simbolos_engenharia.sql](013_simbolos_engenharia.sql) | O CHECK de tipos de feição alargado para `engineering_symbol`, sem tocar em feição existente. |
| [014_ambiente_do_navegador.sql](014_ambiente_do_navegador.sql) | O ambiente do navegador na telemetria: `ambiente` na ocorrência de defeito, o conjunto `navegadores` no defeito, e `navegador_versao` e `so` na sessão de uso, com os três CHECK do vocabulário espelhado. |
| [015_uso_luminosidade.sql](015_uso_luminosidade.sql) | O CHECK de evento de uso alargado para `luminosidade.aberta` (o painel de dados solares e lunares do PITCIC), sem tocar em linha existente. |
| [016_uso_meteorologia.sql](016_uso_meteorologia.sql) | O CHECK de evento de uso alargado para `meteorologia.aberta` (o painel de previsão da matriz do PITCIC), redeclarado com todos os eventos anteriores, `luminosidade.aberta` inclusive, sem tocar em linha existente. |

**As bases acima CONGELARAM em 2026-09-22, antes da primeira implantação de produção, por decisão do dono.** O stack de teste publicado no servidor aplicou as onze e guarda o trabalho dos testadores, e o migrador recusa arquivo já aplicado com conteúdo alterado: editar uma base passaria a exigir recriar aquele banco. Daqui em diante, toda mudança de schema ou de dado semeado entra por arquivo numerado novo, aditivo e idempotente, e o que a seção seguinte diz sobre bases editáveis deixou de valer.

**A contagem não se escreve em prosa aqui, e a tabela acima é a lista.** Esta seção disse "onze bases" e depois "doze", e as duas envelheceram no arquivo seguinte que nasceu, sem nada ficar vermelho: `frontend/tests/unit/docs-integridade.test.js` valida caminho, link e símbolo, nunca aritmética. Quem precisar do número conta a tabela ou roda `ls`.

Colunas, índices e CHECK nascem completos. Não há cadeia de criação seguida de renomeação, remoção de índice ou substituição de CHECK. O nome inicial de identidade foi alterado deliberadamente para distinguir esta base dos históricos anteriores, inclusive os que tinham aplicado apenas parte da sequência antiga.

## Banco novo e banco de desenvolvimento antigo

Em um banco novo, use o migrador normal, com PostgreSQL e PostGIS disponíveis. Ele aplica uma transação por arquivo e registra o nome em _migrations. Executá-lo novamente preserva o schema e os dados semeados.

Um histórico com nomes que não existem nesta sequência é recusado antes de aplicar arquivos pendentes. Não apague o histórico, não marque arquivos manualmente como aplicados e não rode estas bases por cima de dados antigos: isso esconderia uma atualização incompleta. Preserve backup e use um banco novo para a instalação consolidada. Dados de desenvolvimento que precisem ser conservados exigem transferência explícita e validada para esse banco. Nenhum banco existente foi apagado ou recriado nesta consolidação.

Esta mudança organiza apenas o banco do backend. A migração dos atlas locais do navegador continua no fluxo próprio do cliente.

Depois que estas bases forem aplicadas em produção, ficam imutáveis. Alterações posteriores usam o próximo número livre, com migrações incrementais e testes de compatibilidade.

## Até quando estas bases são editáveis (decisão de 2026-09-13)

Esta linha do backend nunca foi implantada, então a baseline consolidada continua editável até a primeira implantação, e a primeira implantação é uma instalação nova a partir das bases da tabela acima. Não há script de transição porque não há banco a transitar: banco de desenvolvimento aplicado antes de uma edição de baseline se recria.

O migrador registra o checksum do conteúdo de cada arquivo aplicado desde 2026-09-13 e recusa, nomeando arquivo e hash, um arquivo já aplicado cujo conteúdo tenha mudado. Em desenvolvimento essa recusa se resolve recriando o banco a partir das bases atuais. A partir do SHA implantado a mesma recusa é o congelamento: toda mudança de schema passa a entrar por um arquivo numerado novo, e nenhuma das bases volta a ser tocada.

## A segunda consolidação (2026-09-20)

Entre 12/09 e 20/09 a sequência cresceu de onze bases para vinte arquivos: oito incrementos de DDL (colunas de `images`, `operations`, `users`, `email_verification_tokens` e `slides`, mais as duas tabelas de importação) e uma regularização só de dados. O dono pediu a dobra de volta, pela mesma razão da primeira: nada foi implantado, e uma instalação nova não precisa da história de como cada coluna chegou.

Cada incremento entrou na base do domínio dele, e as colunas novas ficaram no FIM de cada `CREATE TABLE`, na ordem em que os `ALTER` as tinham criado, para que até a posição física coincida. A regularização de dados saiu sem substituto: ela consertava mapas sem camada e feições sem `layer_id` de bancos anteriores à camada padrão persistida, e um banco novo não tem linha para consertar ([`docs/wiki/camada-padrao-remota.md`](../../../../docs/wiki/camada-padrao-remota.md) guarda o que ela fazia).

A prova foi a mesma da primeira vez, com o mesmo método: dois bancos descartáveis, um pela sequência de vinte arquivos e outro pelas onze bases, e comparação dos catálogos do PostgreSQL, desta vez SEM ignorar a ordem das colunas. Coincidiram 564 colunas (com `ordinal_position`), 196 constraints, 176 índices, 19 funções próprias (por hash do corpo), seis triggers, três sequências, 28 comentários de coluna e a contagem das seis tabelas semeadas. O comparador passou por controle negativo antes de o verde valer: com uma coluna retirada da base nova ele acusou a coluna pelo nome.

**Banco de desenvolvimento aplicado pela sequência de vinte arquivos.** O schema dele é idêntico ao destas bases, e o que difere é só o tracking: `_migrations` guarda nove nomes que não existem mais e o checksum antigo de três bases. O migrador recusa esse histórico, como recusa qualquer outro, e a recusa não estraga nada: o servidor não migra no boot, então o banco continua servindo. Ele só precisa ser recriado (`npm run db:setup` e `npm run db:migrate` num banco novo) quando a próxima migração tiver de ser aplicada nele.

## Verificação da primeira consolidação

Dois bancos descartáveis foram criados: um pela sequência anterior de 21 arquivos e outro pelas onze primeiras bases desta tabela. A comparação de catálogos do PostgreSQL confirmou equivalência de 531 colunas, 186 constraints, 169 índices, 19 funções próprias, quatro triggers e duas sequências, excluindo o tracking do migrador. A comparação ignora a ordem física das colunas e comentários, preservando tipos, defaults, nulabilidade e definições SQL. Os dados iniciais de organizações, postos e catálogo também coincidiram, desconsiderando IDs gerados e timestamps de criação.

Os testes de higiene proíbem reparos dentro destas bases. Os testes de tracking verificam reaplicação sem duplicação, recusa do histórico antigo sem alterar dados (incluindo liberação do lock após a recusa), recusa de arquivo aplicado cujo conteúdo mudou e adoção do checksum em linha rastreada antes desta coluna existir.
