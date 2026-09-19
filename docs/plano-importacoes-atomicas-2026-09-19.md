# Plano de conclusão das importações atômicas

## Contrato

Uma operação publicada contém todos os mapas, seções e imagens aceitos. Antes da publicação, uma interrupção preserva o atlas local original ou não cria nenhum atlas visível no servidor. Uma confirmação repetida da mesma tentativa devolve o mesmo resultado.

## Implementação

1. Aditiva local: copiar os bancos do atlas sob a trava de transição, preparar novos nomes/identificadores e referências, gravar e reler todas as seções no destino isolado, publicar pelo registro global. Manter a recusa de adição diretamente a atlas remoto.
2. Servidor: preparação privada por conta, com prazo e limite de armazenamento; payload e imagens ficam em tabelas de preparação. Validar conteúdo e manifestos antes da confirmação. Publicar atlas, entidades, descritores de imagem e recibo numa transação; gravar os arquivos completos antes do commit e preservar preparações quando houver falha.
3. Cliente: usar o protocolo nas três portas de criação com imagens; recusar imagens ausentes/ilegíveis antes de enviar; repetir pedidos com a mesma identidade de tentativa e consultar o resultado em caso de resposta perdida.
4. Verificação: quota/erro de leitura e escrita, colisões de nomes/IDs, recarga, imagens ausentes ou diferentes, dono incorreto, expiração, confirmação concorrente/repetida, resposta perdida, arquivo grande e renderização. Executar suítes, lint, build e Chromium; atualizar auditorias e publicar commit/push.

## Limites deliberados

Não adicionar escrita incremental REST a atlas colaborativo. Preparações não são atlas, não aparecem em listagens nem podem ser compartilhadas. O original local e o arquivo de origem permanecem disponíveis. Remoção dos dados do navegador e falha física de disco continuam fora da garantia de durabilidade.

## Resultado implementado

### Importação aditiva local

O atlas montado é copiado para bancos isolados, com comparação dos dados e releitura do original para detectar edição concorrente. A soma ocorre apenas nesses bancos. A publicação muda uma entrada do registro global; quota, erro de escrita ou recarga anterior a esse ponto deixam o registro apontando para o original. A operação usa a serialização de transições e a recuperação de preparações abandonadas já empregadas na substituição não aditiva.

Mapas de mesmo nome recebem sufixos. Imagens, ícones, entidades e referências importadas recebem identificadores próprios; os dados existentes não são sobrescritos. A seleção e a ordem dos mapas anteriores, metadados do atlas e briefings existentes são preservados. Identificadores dentro de atributos autorais e referências de catálogo não são recunhados. O teto de 100 mapas considera a soma.

Definições incompletas de arquivos antigos continuam preservadas e sinalizadas. Uma foto já ausente no arquivo não é inventada nem substituída por um blob de mesmo ID no atlas de destino. O `01-completo.ebgeo` fornecido contém uma dessas referências e passou pelo ensaio de soma pela interface, mantendo os 12 mapas e 263 feições esperados.

### Criação no servidor com imagens

A migração SQL `015_importacoes_atomicas.sql` cria preparações privadas por conta e armazena temporariamente seus blobs no PostgreSQL. O protocolo é:

1. `POST /atlas/imports`: registra identidade persistente da tentativa, documento validado e manifesto de imagens.
2. `POST /atlas/imports/:attemptId/images`: valida MIME, assinatura, tamanho, pertencimento ao manifesto e hash. Retransmitir os mesmos bytes é idempotente; conteúdo diferente sob a mesma identidade é recusado.
3. `POST /atlas/imports/:attemptId/commit`: exige todas as imagens. Grava, sincroniza e relê os arquivos; publica atlas, entidades, descritores, recibo e evento de auditoria na mesma transação PostgreSQL. Só então o atlas aparece nas listagens.
4. `GET /atlas/imports/:attemptId`: recupera o recibo após resposta perdida. `DELETE` descarta exclusivamente uma preparação ainda não publicada.

As três entradas usam o protocolo: arquivo direto na lista de atlas, envio de um cartão local e salvamento do atlas local montado. Leituras com erro não viram seções vazias, e imagens originais ausentes ou não conversíveis impedem o envio. O endpoint antigo continua aceitando documentos sem imagens originais; com referências a originais, recusa e orienta atualizar a página, evitando que uma aba antiga continue publicando atlas parciais.

O cliente persiste somente a chave de recuperação, separada por conta, endereço do servidor e conteúdo. A identificação exclui metadados sintetizados pela migração. Repetições retomam o manifesto inicial, mesmo que a conversão local tenha gerado novos UUIDs. Cliques simultâneos são agrupados e a trava entre abas impede duas preparações simultâneas do mesmo conteúdo. Uma troca de conta interrompe o transporte antes de enviar dados pela nova conta. Depois de uma confirmação recebida, uma importação deliberada do mesmo arquivo continua criando outra cópia.

### Durabilidade e limites operacionais

- Até três preparações pendentes por conta; até 1.000 imagens e 256 MiB de bytes por preparação, respeitado também o limite individual configurado de imagem e o limite HTTP do documento. Falhas de limite recusam a operação, preservando a origem.
- Preparações não publicadas expiram após 24 horas. A próxima abertura de preparação nessa conta remove as expiradas; o descarte explícito também libera espaço. A recuperação de resultados publicados não expira com esse prazo: o recibo é mantido enquanto a conta existir.
- Os arquivos são gravados antes da transação publicar suas referências. Falhas capturadas removem arquivos comprovadamente sem referência; se o banco não permitir confirmar isso, os arquivos são preservados. Um encerramento abrupto do processo pode deixar arquivos órfãos, sem atlas parcial visível. Os bytes da preparação permanecem no banco para a repetição. Não há coleta automática desses arquivos órfãos introduzida neste trabalho.
- Não é uma transação distribuída entre PostgreSQL e sistema de arquivos. A garantia é de publicação completa, condicionada à durabilidade de ambos. No Windows não se executa `fsync` do diretório; os arquivos são sincronizados individualmente. Apagar arquivos do servidor fora da aplicação, perder fisicamente o disco ou limpar o perfil do navegador continua exigindo restauração de backup.
- Aditiva em atlas remoto continua recusada. Atlas parciais criados por versões antigas não são corrigidos retroativamente. A intranet não foi acessada.

## Validação

Os testes novos cobrem preparação invisível, falta de imagens, dono incorreto, principal anônimo/público, bytes conflitantes ou corrompidos, escrita parcial com `ENOSPC`, descarte, expiração, limite de preparações, auditoria única e confirmações concorrentes. No cliente, cobrem resposta perdida seguida de recarga, recuperação do recibo, reutilização dos IDs da primeira tentativa, mudança de conta, quota local e clique duplicado.

No Chromium, dez casos passaram com backend e PostgreSQL reais: interrupção antes da publicação, falha de quota, recarga após publicação, falha de imagem na soma e repetição, arquivos v1 mascarados, recusa prévia, desconexão no upload, perda da resposta final, explicação na lista de atlas e soma do acervo completo pela interface. Fotos e ícones foram comparados byte a byte e decodificados.

Controle negativo: desativar temporariamente a proteção dos atributos autorais fez a asserção de preservação reprovar (um vermelho e três verdes). A implementação foi restaurada e os testes focados passaram. Também foi ensaiada a troca de conta dentro da renovação de token do cliente HTTP real: nenhum pedido com o conteúdo foi enviado pela nova conta.

Validação final:

- Frontend: **723 arquivos, 13.361 testes aprovados**.
- Backend: **5.308 testes aprovados**, **98,3% de cobertura de linhas**. Em seguida, **11 testes de integração de importação aprovados**, incluindo o caso adicional de corpo HTTP acima de 10 MiB com comparação de todos os bytes no disco.
- Contratos HTTP/WebSocket: **67 arquivos, 249 testes aprovados**.
- Chromium: **10 testes aprovados**, sem retry, incluindo a soma de `01-completo.ebgeo` sobre `02-minimo.ebgeo` pela interface.
- Lint de frontend/backend e build de produção aprovados. O build conserva os avisos conhecidos de tamanho de chunks.

Para atualizar o servidor, aplicar a migração **015** antes de disponibilizar o frontend novo. A mudança foi preparada para o branch `integracao_backend`; estes ensaios usam serviços locais descartáveis, não o ambiente da intranet.
