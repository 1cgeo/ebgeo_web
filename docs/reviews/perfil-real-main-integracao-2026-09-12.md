# Troca de builds com perfil gravado pela main

Ensaio local de 2026-09-12, solicitado para reproduzir o uso acumulado da versão
em produção antes de abrir a integração. Complementa o
[teste dos arquivos externos](teste-dados-externos-2026-09-12.md).

**Resultado: aprovado.** A troca preservou 14 mapas, 806 feições e 149 imagens,
sem divergências inesperadas em três inicializações da integração. Os bancos
originais e suas 32 operações acumuladas ficaram intactos. Um ponto criado na
integração persistiu após outra reabertura, totalizando 807 feições, sem alterar
as feições e imagens anteriores. Lint do instrumento aprovado.

## Referências conferidas

As duas referências foram verificadas com fetch no remoto origin:

| Versão | Commit usado |
| --- | --- |
| main | 8b611113aa73c3faedc967ccf77132604255ea8d |
| integracao_backend | d2f956e827f3728206ca871b66431e1e29249c2d, com as correções locais de migração |

A referência local da main estava nove commits atrasada, em e014b701, e foi
atualizada por avanço direto para origin/main. A integração já estava alinhada
ao remoto. A cópia antiga recusava o arquivo 2.4 porque aceitava até 2.3;
essa observação não descreve a main atual. O ensaio conclusivo foi refeito
desde um perfil vazio usando 8b611113, que importou o arquivo 2.4 normalmente.

Os dois aplicativos foram compilados com Vite em modo de produção. A main veio
de um worktree destacado, sem alterações nos arquivos versionados. Sua instalação
exigiu a opção legacy-peer-deps do npm ci, pois a instalação padrão recusou o
lockfile por uma dependência transitiva ausente. Nenhum lockfile foi editado.

## Procedimento

1. Abrir a main em um perfil Chromium persistente novo, servido em
   http://localhost:4361. Importar o arquivo externo 03-completo-2.4.ebgeo
   pela interface: 14 mapas, 805 feições e 149 imagens.
2. Desenhar um ponto no mapa, editar seu nome e descrição e encerrar a seleção
   para concluir a gravação prevista pelo aplicativo. Conferir o dado no IndexedDB.
3. Fechar o navegador inteiro e reabrir o mesmo perfil na main. Renomear o mapa
   ativo para Mapa acumulado e salvar título e texto de notas pela interface.
4. Fechar e abrir uma terceira sessão da main. Conferir que as alterações continuam
   no disco. O perfil contém 806 feições e 32 operações acumuladas na fila antiga,
   além dos mapas, camadas, grupos, briefings, configurações, imagens e localStorage.
5. Fechar o navegador e guardar uma cópia integral do diretório de perfil. Encerrar
   o servidor HTTP da main e iniciar o servidor da integração na mesma porta,
   protocolo e hostname. Reabrir o mesmo diretório de perfil, sem limpar dados
   nem cache e sem importar um arquivo na integração.
6. Comparar todos os registros originais contra a origem preservada e contra o
   destino migrado. Repetir após fechar e abrir o navegador mais duas vezes.
7. Desenhar outro ponto na integração, fechar e reabrir. Conferir o novo total de
   807 feições, todas as feições anteriores e todos os bytes das imagens.

Todas as gravações do acervo foram feitas pelo aplicativo mediante ações de
interface. O instrumento não semeia bancos, não injeta funções do store e não
reescreve versões. A leitura usa transações nativas somente de leitura do IndexedDB,
com serialização independente para comparar registros e bytes de blobs.

## Critério de preservação

No destino, a comparação permite a atualização dos dois marcadores para versão 3.0.
Na abertura do mapa ativo, sua revisão de sincronização avança uma unidade por
inicialização e a data de atualização avança; isso foi verificado explicitamente.
O restante do registro, inclusive feições, IDs, geometria, atributos e metadados de
criação, precisa permanecer idêntico. Os outros mapas não recebem essa exceção.

Os bancos originais, inclusive a fila antiga com suas 32 operações, precisam ficar
intactos. As chaves pré-existentes do localStorage também são comparadas. Na edição
feita após a migração, a presença de um ponto novo não pode alterar as feições
anteriores nem os bytes das imagens. Os resultados, commits, hashes dos HTMLs e
o diretório de evidências ficam no [registro de execução](perfil-real-main-integracao-2026-09-12.json).

## Repetição e evidências

O instrumento é [main-profile-upgrade.mjs](../../frontend/tests/helpers/main-profile-upgrade.mjs).
É um ensaio explícito que requer os dois builds existentes, a pasta de dados de teste,
Chromium do Playwright e as dependências do backend descartável. A pasta de saída
deve ser nova a cada execução. Não usar diretório de perfil pessoal.

No PowerShell, a partir da pasta frontend:

```powershell
$env:EBGEO_MIGRATION_DATA_DIR='C:\Users\diniz\OneDrive\Desktop\Desenvolvimento\_ebgeo_dados_teste'
$env:EBGEO_MAIN_CHECKOUT=(Resolve-Path '../.claude/worktrees/migration-main-8b611113').Path
$env:EBGEO_UI_E2E_APP_PORT='4361'
$env:EBGEO_UI_E2E_BACKEND_PORT='3961'
$env:EBGEO_UI_E2E_DB_NAME='ebgeo_main_profile_20260912'
node tests/helpers/main-profile-upgrade.mjs
```

O resultado registra a pasta gerada sob frontend/test-results. Ela contém os dumps
antes e depois, diferenças, capturas de tela, perfil usado e cópia do perfil anterior
à atualização. Esses artefatos de navegador ficam fora do Git. O backend descartável
e o servidor HTTP são encerrados ao final. A cópia de trabalho da main permanece
disponível para repetir o build. Nada foi publicado e nenhum arquivo do acervo
externo foi alterado.

## Alcance

Este teste preenche a lacuna de criar um perfil pela main real e trocar o build
mantendo a origem, em vez de reconstruir registros de uma exportação diretamente
no IndexedDB. O acervo foi usado em sessões distintas, mas o ensaio não aguardou
meses nem reproduziu envelhecimento físico do perfil ou descarte de armazenamento
pelo navegador. Também não representa toda combinação de versões históricas.

O servidor interno continua fora do alcance. O localhost é uma origem confiável
para o navegador mesmo em HTTP; isso não comprova a disponibilidade de Web Locks
em uma URL HTTP da rede. Continuam necessários os testes de protocolo, navegador,
quota, proxy e recursos 3D/360 no ambiente de publicação. Os logs deste ensaio
incluem falhas de recursos de rede ausentes no servidor descartável, sem exceções
JavaScript de página; não equivalem a uma homologação desses serviços.
