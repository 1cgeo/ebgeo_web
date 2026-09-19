# Auditoria de casos extremos de migração de versões do .ebgeo

Escopo: importação local, importação direta para o servidor e atualização de dados já armazenados no IndexedDB. Branch `integracao_backend`. Ensaios locais; a intranet não foi acessada, conforme solicitado. Os arquivos de `_ebgeo_dados_teste` são somente lidos.

## Defeitos corrigidos

| Caso | Risco anterior | Proteção implementada |
| --- | --- | --- |
| Arquivo v1 abaixo do mínimo, versão malformada ou marcador interno de versão futura | A exceção para v1 podia aceitar versões anteriores a 1.3; a normalização escondia o marcador original. | Validação de todos os marcadores declarados antes da migração. Intervalo suportado de 1.3 até 3.0, incluindo patch numérico dentro desses limites. |
| Mapas, coleções, camadas, grupos ou briefings estruturalmente inválidos | A falha podia aparecer depois de limpar o atlas local substituído. | Validação estrutural compartilhada antes de preparar o destino. Definições incompletas de símbolos continuam preserváveis; não se inventa conteúdo ausente. |
| ZIP com conteúdo de imagem corrompido ou duas extensões para o mesmo ID | Erro de descompressão tardio ou uma imagem sobrescrevendo outra. | Verificação CRC de todas as entradas e recusa de IDs de imagem ambíguos antes das gravações. CRC verifica integridade do ZIP, não garante que os bytes sejam uma imagem decodificável. |
| Arquivo normal do EBGeo, com prefixo EBGXOR, enviado diretamente ao servidor | Esse caminho só lia ZIP sem máscara e não aplicava a mesma validação de versão do importador local. | Leitor e validação compartilhados, seguidos da migração v1 quando aplicável. |
| Foto antiga com ID não UUID e nova importação do mesmo arquivo | ID da feição podia divergir do ID enviado; UUIDs reaproveitados colidiam com imagens de outro atlas no servidor. | UUID novo para cada imagem de cada importação, com o mesmo mapeamento para fotos, ícones personalizados, cadastro de ícones e referências 3D/360. |
| Foto original ausente, conversão ilegível ou tipo de imagem não aceito | Atlas criado antes de terminar a leitura das imagens; ausência não contabilizada como falha. | Leitura e preparação de todos os recursos exigidos antes do POST do atlas. Falta de bytes ou recurso recusado interrompe a importação sem criar atlas. Bitmaps geráveis a partir de definições não são tratados como fotos obrigatórias. |
| Feição desconhecida ou sem geometria convertível | A transformação descartava a feição e o fluxo podia anunciar sucesso. | A importação direta recusa conversões que descartariam feições antes de criar o atlas. |
| Queda de conexão no upload ou resposta sem confirmação dos IDs | Sucesso aparente apesar de imagens não confirmadas; toast desaparecia ao navegar. | Conferência do mapeamento retornado, contagem de falhas e diálogo que permanece até a escolha de abrir o atlas incompleto ou voltar à lista. O arquivo original deve ser preservado para nova tentativa. |
| Linhas antigas em barrier_lines | Importação direta podia descartar essas linhas. | Mesma normalização de coleções usada na leitura local, convertendo para linhas de coordenação. |
| Slide apontando ao UUID antigo de um mapa | Mapas recebiam UUIDs novos, mas o slide podia manter referência inexistente. | Mapeamento do UUID de origem para o UUID do mapa criado, além do mapeamento por nome. |
| Settings e registro do atlas com versões diferentes após interrupção | Um único marcador atual podia fazer a cadeia ser considerada concluída e pular etapas. | Retomada pelo menor checkpoint. Mantida a exceção histórica de settings v1 com registro de atlas v2+, necessária para não remapear novamente os IDs de acervos main. |
| Marcador 1.3.0, 1.7.0, 2.4.0 ou 3.0.0 no navegador | Classificação e preparação usavam listas/formas diferentes; backfills de patch podiam ser pulados. | Comparação numérica consistente, validação dos dois marcadores e seleção dos backfills pelo par major/minor. |

Implementação principal: `frontend/src/js/import_export/ebgeo-file-gate.js`, `frontend/src/js/projects/import-ebgeo.service.js`, `frontend/src/js/import_export/local-atlas-to-server.js` e módulos em `frontend/src/js/store/migration/`.

## Evidências e testes

- `frontend/tests/unit/ebgeo-version-edge-cases.test.js`: matriz de versões, ZIP com CRC inválido, colisão de IDs, recursos ausentes, conversão com descarte, máscaras, referências de imagens e slides.
- `frontend/tests/integration/migration-version-checkpoints.test.js`: marcadores divergentes, interrupção entre duas gravações de versão, retomada sem remapear imagens, isolamento de outro atlas e preservação do inventário original.
- `frontend/tests/integration/import-ebgeo-atlas-local.test.js`: importador real recusando arquivos malformados antes do wipe, sem consumir slot, trocar namespace ou apagar sentinelas dos bancos existentes.
- `frontend/tests/e2e-ui/browser-import-ebgeo-versions.spec.js`: quatro cenários Chromium com HTTP e PostgreSQL reais. Três chamam o serviço real no navegador: importação v1 mascarada duas vezes, comparação byte a byte e decodificação das imagens, preservação dos ângulos e referências, zero POST para arquivos recusados, queda no upload e nova importação bem-sucedida. O quarto dirige o seletor da página de atlas, provoca falha no upload e verifica que a explicação permanece visível antes da navegação.

Resultados:

- Suíte geral: **720 arquivos e 13.316 testes aprovados**. Executada após as correções de migração; o ajuste posterior do diálogo foi revalidado pelo cenário Chromium da interface, lint e build.
- Matriz de acervos: **13 cenários aprovados**, na mesma rodada e sem retries automáticos. Inclui importação pela interface, três boots, recuperação bruta, caso settings 1.7/atlas 2.4 e dois cenários v1 sintéticos com IDs antigos. [Medições desta rodada](auditoria-migracao-versoes-2026-09-19.json).
- Importação direta para servidor e aviso na interface: **4 cenários aprovados**, na mesma rodada e sem retries automáticos.
- Lint JavaScript/CSS e build de produção aprovados, inclusive após o ajuste final da interface. O build mantém os avisos conhecidos sobre tamanho de chunks.
- Conferência final de migração, importação local e integridade da documentação: **4 arquivos, 77 testes aprovados**.

Nas medições de importação local, diferenças de bytes em bitmaps gerados são esperadas porque os símbolos são regenerados. Os testes distinguem esses casos de fotos e ícones originais, cujos bytes precisam ser preservados; verificam também propriedades autorais e renderização. Os hashes dos arquivos externos são conferidos sem alterá-los.

## Limites e riscos que permanecem

1. **Substituição local ainda não é atômica.** O importador valida o arquivo antes de limpar o destino, mas um erro de quota/armazenamento ou encerramento do navegador durante as gravações posteriores pode deixar o destino parcialmente importado. Na substituição, o atlas anterior já foi limpo. O arquivo importado permite repetir a importação, mas não recupera o conteúdo anterior que só existia no navegador. Eliminar esse risco exige preparar o resultado em namespace separado e ativá-lo somente após verificação, com recuperação de operações interrompidas. A validação desta auditoria não equivale a essa garantia.
2. **Criação no servidor e upload de imagens são operações separadas.** A queda após criar o atlas deixa uma importação parcial, agora sinalizada. Uma nova importação cria outro atlas; não completa automaticamente o anterior. Não há rollback distribuído nem fila persistente de retomada adicionados a esse fluxo nesta auditoria.
3. **Dados ausentes na origem não são reconstruídos.** O `01-completo.ebgeo` continua tendo oito definições irrecuperáveis automaticamente, detalhadas na [auditoria de imagens](auditoria-imagens-2026-09-19.md). A declinação com aliases é recuperada. A importação direta desse arquivo para o servidor é recusada por faltar uma foto original, preservando o arquivo para recuperação; a importação local preserva os registros incompletos e os sinaliza.
4. **Cobertura delimitada.** Chromium local e backend descartável não certificam a intranet nem todos os navegadores, versões históricas, volumes de arquivo ou formas de corrupção. A atualização do IndexedDB legado preserva sua origem por cópia verificada; essa propriedade não deve ser confundida com a substituição local por arquivo.

Portanto, esta auditoria reduz falhas de migração e perdas silenciosas, mas não estabelece garantia de ausência de perda sob interrupção da substituição local. Essa atomicidade permanece uma pendência relevante para um lançamento que exija tal garantia.

## Reprodução

```powershell
npm run lint --prefix frontend
npm run build --prefix frontend
npm test --prefix frontend -- --maxWorkers=2
npm run test:e2e:ui --prefix frontend -- browser-import-ebgeo-versions.spec.js --retries=0
$env:EBGEO_MIGRATION_DATA_DIR='C:\Users\diniz\OneDrive\Desktop\Desenvolvimento\_ebgeo_dados_teste'
npm run test:e2e:ui --prefix frontend -- --config=playwright.migration-data.config.js
```

Executar build, suíte geral e campanhas Chromium sequencialmente. Os testes do grafo leem `dist`, e a concorrência com Chromium pode introduzir atrasos nos testes temporizados.

Na bancada desta auditoria, o PostgreSQL travou na exclusão de bancos descartáveis após encerrar os cenários, aguardando ProcSignalBarrier. Apenas as consultas de DROP desses bancos de teste foram canceladas; as asserções não foram dispensadas. A rodada final do teste de importação direta e interface aprovou os quatro cenários sem retries. Uma tentativa anterior também expôs um PNG sintético inválido no próprio teste, substituído por PNG RGBA com chunks e CRC válidos antes da aprovação.
