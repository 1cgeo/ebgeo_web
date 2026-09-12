# Ensaio com os dados externos fornecidos

Data: 2026-09-12. Complementa a [execução das correções](execucao-correcao-migracao-2026-09-12.md).
Origem: pasta _ebgeo_dados_teste indicada pelo usuário, ao lado do repositório.
Os arquivos foram lidos sem edição. Os cinco arquivos .ebgeo tiveram SHA-256
conferido antes e depois de cada cenário. O navegador e o backend usados são locais
e descartáveis; nenhuma ação foi executada no servidor interno.

## Resultado

**11 cenários Chromium aprovados em 2,6 minutos, sem retries ou skips.**
Não foi detectada perda de registros ou imagens nos caminhos verificados.

| Arquivo externo | Versão | Mapas | Feições | Imagens | Migração e recuperação | Importação e reabertura |
| --- | --- | ---: | ---: | ---: | --- | --- |
| 01-completo.ebgeo | 2.2 | 11 | 262 | 5 | Aprovado | Aprovado |
| 02-minimo.ebgeo | 2.2 | 1 | 1 | 0 | Aprovado | Aprovado |
| 03-completo-2.4.ebgeo | 2.4 | 14 | 805 | 149 | Aprovado | Aprovado |
| 04-completo-2.3.ebgeo | 2.3 | 14 | 787 | 131 | Aprovado | Aprovado |
| 05-completo-2.2.ebgeo | 2.2 | 14 | 776 | 131 | Aprovado | Aprovado |

Total entre arquivos: 54 mapas, 2.631 feições e 416 imagens. Há conteúdos repetidos
entre as versões; esses totais não representam objetos únicos.
O 11º cenário usou o acervo 2.4 com marcador global de versão 1.7, exercitando
o caso de marcador antigo acompanhado de dados mais recentes.

## O que foi conferido

1. Reconstrução dos bancos legados a partir de cada exportação, seguida da execução
   da transição real para um namespace isolado. Comparação independente de todos
   os registros semeados e dos bytes de todos os blobs, antes da abertura do editor.
   As diferenças permitidas foram apenas os marcadores de versão, o nome do atlas
   e a normalização prevista de nomes de mapa.
2. Três inicializações completas por cenário de migração, mantendo o mesmo destino,
   um único atlas no registro e os totais de feições de cada mapa. Todas as chaves
   de imagens da exportação continuaram presentes.
3. Exportação do ZIP de recuperação após as inicializações e restauração da origem
   em outro atlas isolado. Nova comparação de todos os registros e bytes, sem
   divergências inesperadas. O inventário dos bancos de origem permaneceu intacto.
4. Importação de cada arquivo pela interface, aguardando a confirmação de conclusão
   que sucede a gravação das imagens. Conferência das feições por mapa, presença
   e conteúdo das imagens, reabertura e ausência de erros JavaScript de página.

A migração e a restauração preservaram exatamente os bytes de todas as imagens.
Na importação com o editor aberto, os arquivos 04 e 05 regeneraram um PNG de símbolo
antigo cada. Esse é o comportamento existente de atualização de cache para a versão 2:
o teste verificou o novo marcador e a preservação da definição do símbolo. As demais
imagens, incluindo fotos, permaneceram idênticas. Os IDs e as diferenças observadas
estão no [registro de resultados](dados-externos-migracao-2026-09-12.json).

O README do acervo identifica o arquivo 01 como cenário com problemas visuais
conhecidos, incluindo estilos, símbolos e imagens ausentes. Sua aprovação aqui
significa preservação do conteúdo fornecido, não correção dessas inconsistências.

## Recursos auxiliares 3D e 360

A auditoria estrutural em modo de leitura terminou sem erros:

| Pasta externa | Verificações aprovadas |
| --- | --- |
| _ebgeo_360 | 657 imagens e 657 documentos JSON |
| _ebgeo_360_sqlite | 1.314 imagens e dois bancos SQLite com quick_check igual a ok |
| _ebgeo_3d | Nove imagens, cinco JSON, cabeçalhos de 1.667 B3DM e um GLB, 1.671 referências locais de conteúdo encontradas |

O [relatório estrutural](dados-externos-assets-2026-09-12.json) registra os resultados
por pasta e os bancos verificados. As imagens passaram pela verificação do Pillow;
os modelos passaram por checagens de cabeçalho e tamanho. Isso não equivale a
renderizar todas as imagens e geometrias. Os bancos foram abertos como somente
leitura e imutáveis, após conferir que não havia WAL com conteúdo.

## Automação e reprodução

A suíte externa fica em [migration-external-data.scenario.js](../../frontend/tests/e2e-ui/migration-external-data.scenario.js)
e exige uma configuração explícita. A suíte normal não depende dessa pasta pessoal.
O helper existente agora aceita também caminhos absolutos; seus 22 testes de
regressão passaram. A auditoria dos recursos pode ser repetida com
[audit-migration-assets.py](../../frontend/tests/helpers/audit-migration-assets.py),
que requer Python com Pillow.

No PowerShell, a partir da pasta frontend, com as dependências usuais do E2E disponíveis:

```powershell
$env:EBGEO_MIGRATION_DATA_DIR='C:\Users\diniz\OneDrive\Desktop\Desenvolvimento\_ebgeo_dados_teste'
$env:EBGEO_UI_E2E_APP_PORT='4359'
$env:EBGEO_UI_E2E_BACKEND_PORT='3959'
$env:EBGEO_UI_E2E_DB_NAME='ebgeo_external_migration_20260912'
$env:CI='1'
npx playwright test --config playwright.migration-data.config.js
python tests/helpers/audit-migration-assets.py $env:EBGEO_MIGRATION_DATA_DIR ../docs/reviews/dados-externos-assets-2026-09-12.json
```

Logs locais ignorados pelo Git: migration-external-data-final.log,
migration-external-helper-regression.log, migration-external-assets-final.log,
migration-external-lint.log e migration-external-docs.log.
Os JSON deste relatório preservam os resultados relevantes sem depender desses logs.

## Limites para a publicação

Ensaio posterior: foi executada a [troca de builds com perfil da main real](perfil-real-main-integracao-2026-09-12.md),
com alterações pela interface e várias reaberturas. Esse ensaio amplia a cobertura
além da semeadura descrita abaixo, mantendo os limites do ambiente interno.

Os arquivos .ebgeo são exportações, não cópias completas de perfis antigos do navegador.
A semeadura reproduz o conteúdo exportado no formato dos bancos legados, mas não
recupera metadados omitidos na exportação nem estados históricos de abas, transações
interrompidas ou caches. Ainda é necessário trocar o build na mesma origem em perfis
reais de usuários que ficaram meses sem acessar.

Os cerca de 2,3 GB de recursos auxiliares são arquivos para servir pelo backend;
eles não foram inseridos no IndexedDB. Sua auditoria não certifica a migração de um
acervo local desse tamanho, nem a integração dos visualizadores com o servidor.

Continuam pendentes a homologação na origem interna, a disponibilidade de Web Locks
no protocolo e nos navegadores usados, as condições reais de quota/disco, o acesso
aos recursos pelo proxy e o piloto descrito no relatório de execução. Este ensaio
amplia a evidência de preservação; não autoriza sozinho a publicação em produção.
