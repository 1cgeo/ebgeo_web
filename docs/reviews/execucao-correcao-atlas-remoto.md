# Execução da correção do atlas remoto

Início: 12/09/2026, branch `integracao_backend`, base `fa0f021891b785b61c45fd8aedc51f20a99a0950`.
Autorização: “PODE EXECUTAR”. Referência: [plano aprovado](plano-correcao-atlas-remoto.md).

## Estado intermediário: não liberado

Checkpoint solicitado pelo usuario em 12/09/2026, para commit e push no branch de desenvolvimento. O plano permanece incompleto e este estado NAO esta liberado para producao. A verificacao completa da raiz terminou com codigo 1: frontend e backend passaram, mas ha 24 falhas na camada de contratos. Nenhuma implantacao foi realizada.

| Área | Implementação em andamento | Validação / trabalho restante |
| --- | --- | --- |
| Fila | Sem expiração ou compactação destrutiva; sequência IndexedDB atômica; envelopes imutáveis; handles vinculados ao escopo | Regressões novas passaram; adaptar os testes do contrato antigo; migração e deduplicação de filas antigas |
| Recibos | Tabela independente do histórico, principal e hash; resultados de sucesso, recusa e conflito persistidos | Quatro regressões de recibos passaram; bloqueio de clientes incompatíveis e revisão final da autorização |
| Materialização | Intenção antes de feições/comentários; estágio preparado bloqueia envio até materialização | Quatro testes novos passaram; demais produtores, recovery completo e isolamento de geração |
| Recepção | Cursor após aplicação; primeiro handshake pede replay; fechamento antigo não derruba socket novo; tombstone de feição | Correção do teste de cursor; coordenação completa e cursor durável |
| Snapshot | Transação consistente no servidor; substituição de mapas/briefings; projeção de pendências; preparação em geração separada e ativação conjunta de ponteiro/cursor | Sete regressões nativas passaram; falta homologação com clientes reais, concorrência entre abas, limpeza de gerações antigas e cobertura dos demais produtores |
| Recusas | Registro durável junto da operação original; excluído de envio automático | Painel de resolução, dependências e aplicação canônica |
| Rede | Trava do auto-flush antes do primeiro await; backoff; limites de requisição incluindo corpo; cancelamento por sessão | Testes de rede degradada, progresso e saída |
| Conflitos/anexos | Primeira implementação de patches e revisões por campo para feições | Cinco testes PostgreSQL passaram; demais tipos, UI, compatibilidade e uploads ainda pendentes |

## Evidências intermediárias

- `queue-journal-atomic.test.js`: sequência entre handles, rollback integral de lote inválido, recuperação sem duplicar e imutabilidade.
- `write-ahead-intent.test.js`: intenção antes da entidade, falha entre as escritas, falha de diário impede persistência/UI, edição sem logging não cria fila remota.
- `sync-delivery-receipts.test.js`: conteúdo diferente sob o mesmo ID é recusado; retry após limpeza mantém a versão nova; criação sem mapa é recusada.
- A bateria `sync*.test.js` do backend passou com 462 testes antes da expansão de conflitos por campo. A suíte completa precisa ser repetida depois das mudanças finais.
- `sync-feature-conflicts.test.js`: nome/geometria independentes, disputa do mesmo campo após limpeza, tombstone, dependência de recibo anterior e versão externa sem fronteira comprovada.
- `feature-patch-intent.test.js`: patch mínimo, ausência de base não inventada e dependência durável entre edições offline.
- `repository-captured-scope.test.js`: troca de atlas durante resolução assíncrona mantém o destino original da gravação.
- `snapshot-generation.test.js`: corte após gravação parcial, falha de quota na ativação, snapshot incompleto, troca de atlas durante preparação, reabertura com intenção preparada, estabilização de escritor iniciado e isolamento de versões/guardas entre montagens. Sete testes passaram com IndexedDB simulado pela implementação nativa do `fake-indexeddb`; ainda não substituem Playwright.
- A recepção mantém operações adiadas até aplicação bem-sucedida e aceita múltiplos aguardadores do mesmo reenvio. Limite de buffer causa erro para recuperação, em vez de descartar a operação mais antiga silenciosamente.
- A bateria de handler, namespaces/repositório e engine passou com 201 testes antes da última ampliação dos guardas. A bateria posterior do handler/engine/snapshot também passou; a verificação final completa continua pendente.
- `queue-issue-dependencies.test.js`: recusa bloqueia descendentes, permite trabalho independente e mantém IDs opacos com prefixo numérico.
- O handler também passou a rejeitar snapshot malformado antes de escrever, aplicar o resultado canônico do próprio autor e aguardar uma edição remota adiada sem bloquear o ACK que a libera.
- A primeira suíte completa do frontend após as alterações mostrou 90 falhas e 12.065 acertos. Inclui doubles de transação desatualizados, expectativas de poda/compactação, leitura de metadados como se fossem operações e problemas ainda em investigação. Esse resultado NÃO é aprovação.
- Após corrigir os casos identificados e atualizar os doubles para a gravação de intenção, a suíte completa do frontend passou: **635 arquivos, 12.193 testes, zero falhas**, em 12/09/2026 às 14:59 do ambiente. Isso verifica o estado intermediário, não as partes do plano ainda ausentes.
- O cursor de retomada do WebSocket agora avança em respostas completas de replay, não por mensagens ao vivo isoladas: a versão maior de um broadcast não comprova a entrega de commits menores de outros controladores. A regressão simula essa ordem inversa e exige replay do commit ausente.
- Novos testes do auto-flush cobrem a trava antes da leitura assíncrona da fila, reinício durante envio anterior pendurado e Retry-After sem atalho por evento de edição. Os testes de aviso passaram a usar o relógio da espera exponencial, com jitter determinístico.
- A bateria posterior `sync*.test.js` do backend passou com **468 testes, zero falhas e zero skips**, incluindo os recibos de recusa e os conflitos de feições. O runner encerrou com código zero e removeu apenas o banco descartável `ebgeo_test`.
- O lint completo da raiz passou novamente após as últimas mudanças de lógica. Ainda não foi executado o `npm test` completo da raiz neste estado, nem a homologação de UI/build/migração prevista no plano.

## Correção do instrumento de diagnóstico

A sonda original de exclusão na revisão usava GeoJSON com `id` apenas na raiz; o handler real identifica feições por `properties.id`. O teste permanente foi corrigido e agora confirma que a exclusão realmente ocorreu antes de tentar a recriação antiga. O teste de cursor também passou a conferir o cursor e o fechamento após falha, evitando usar acidentalmente o pedido de replay do handshake como evidência da recuperação. Os controles negativos retirando temporariamente a proteção de tombstone e antecipando o cursor falharam como esperado; o código correto foi restaurado e os testes passaram novamente. A validação final dos fluxos completos continua pendente.

## Para concluir

Concluir todas as entregas do plano; resolver as falhas sem skips; executar lint e teste completos da raiz após a última mudança, build, contratos, Playwright real e inspeção de imagens. Usar somente cópias dos dados de teste. Preparar transição explícita dos bancos de desenvolvimento e roteiro/rollback da rede interna. A validação no servidor interno continua fora do alcance desta sessão.


## Verificacao do checkpoint de 12/09/2026

- Ultima execucao completa de `npm test` na raiz: **codigo 1**. Frontend: **12.193 testes aprovados**; backend: **5.027 aprovados, zero falhas/skips**; contratos: **177 aprovados e 24 falhas, 201 no total**.
- A primeira rodada completa havia encontrado nove falhas de backend. Foram corrigidos o inventario dos novos JSONB e as expectativas do envelope canonico e da ausencia de rebroadcast em retries. A bateria WebSocket posterior passou com 219 testes e a repeticao completa aprovou todos os 5.027 testes do backend.
- As falhas de contrato incluem operacoes v2 construidas sem base confirmada/patch, a expectativa antiga de ignorar o retorno canonico ao proprio autor e incompatibilidades ainda REAIS de conversao, movimentacao entre mapas e desfazer/refazer com o novo bloqueio de recriacao. Nao foram ocultadas com skips nem tratadas como aprovacao.
- `npm run build` terminou com codigo zero. Os testes posteriores de tamanho da pagina e integridade documental passaram: 56 testes.
- O lint completo passou (codigo zero) depois das adaptacoes dos testes WebSocket. A assercao de colecao nao vazia exigida pelo lint tambem foi verificada pela repeticao do teste de broadcast 3D/360, com codigo zero.
- Proximo trabalho: resolver os contratos e completar comandos explicitos de conversao/movimentacao/restauracao; impedir gravacoes atrasadas de uma sessao remota descartada, inclusive apos novo login. Os prototipos de protecao de escrita ainda estao fora do codigo do produto neste checkpoint.
