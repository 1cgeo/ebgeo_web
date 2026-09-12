# Bases para a primeira implantação

Consolidação autorizada em 12/09/2026, antes da primeira implantação deste backend. Os arquivos criam diretamente o estado final de cada domínio. A ordem respeita as dependências entre tabelas e funções.

| Arquivo | Responsabilidade |
| --- | --- |
| [001_identidade_e_credenciais.sql](001_identidade_e_credenciais.sql) | Organizações, postos, contas, tokens, chaves de API e grupos de usuários. |
| [002_auditoria.sql](002_auditoria.sql) | Trilha administrativa, vocabulário de ações e índices de consulta. |
| [003_atlas.sql](003_atlas.sql) | Atlas, compartilhamentos e conteúdo colaborativo. |
| [004_sync.sql](004_sync.sql) | Operações, versões e índices de sincronização e produção. |
| [005_catalogo.sql](005_catalogo.sql) | Bases, camadas, modelos publicados e configuração. |
| [006_ng.sql](006_ng.sql) | Gazetteer, busca e agrupamentos geográficos. |
| [007_sv360.sql](007_sv360.sql) | Projetos 360, metadados, faixas, fotos, alvos e pirâmides. |
| [008_acesso_a_recurso.sql](008_acesso_a_recurso.sql) | Concessões, empréstimos e funções de autorização. |
| [009_a3d.sql](009_a3d.sql) | Acervo 3D convertido e registro de importações. |
| [010_observabilidade.sql](010_observabilidade.sql) | Defeitos, ciclo de vida e evidências individuais limitadas. |
| [011_uso_e_presenca.sql](011_uso_e_presenca.sql) | Uso agregado, sessões, presença e deduplicação da coleta. |

Colunas, índices e CHECK nascem completos. Não há cadeia de criação seguida de renomeação, remoção de índice ou substituição de CHECK. O nome inicial de identidade foi alterado deliberadamente para distinguir esta base dos históricos anteriores, inclusive os que tinham aplicado apenas parte da sequência antiga.

## Banco novo e banco de desenvolvimento antigo

Em um banco novo, use o migrador normal, com PostgreSQL e PostGIS disponíveis. Ele aplica uma transação por arquivo e registra o nome em _migrations. Executá-lo novamente preserva o schema e os dados semeados.

Um histórico com nomes que não existem nesta sequência é recusado antes de aplicar arquivos pendentes. Não apague o histórico, não marque arquivos manualmente como aplicados e não rode estas bases por cima de dados antigos: isso esconderia uma atualização incompleta. Preserve backup e use um banco novo para a instalação consolidada. Dados de desenvolvimento que precisem ser conservados exigem transferência explícita e validada para esse banco. Nenhum banco existente foi apagado ou recriado nesta consolidação.

Esta mudança organiza apenas o banco do backend. A migração dos atlas locais do navegador continua no fluxo próprio do cliente.

Depois que estas bases forem aplicadas em produção, ficam imutáveis. Alterações posteriores usam o próximo número livre, com migrações incrementais e testes de compatibilidade.

## Verificação da consolidação

Dois bancos descartáveis foram criados: um pela sequência anterior de 21 arquivos e outro por estas 11 bases. A comparação de catálogos do PostgreSQL confirmou equivalência de 531 colunas, 186 constraints, 169 índices, 19 funções próprias, quatro triggers e duas sequências, excluindo o tracking do migrador. A comparação ignora a ordem física das colunas e comentários, preservando tipos, defaults, nulabilidade e definições SQL. Os dados iniciais de organizações, postos e catálogo também coincidiram, desconsiderando IDs gerados e timestamps de criação.

Os testes de higiene proíbem reparos dentro destas bases. Os testes de tracking verificam reaplicação sem duplicação e recusa do histórico antigo sem alterar dados, incluindo liberação do lock após a recusa.
