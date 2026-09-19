# Auditoria de compartilhamento e privacidade: 19/09/2026

## Escopo e método

Branch `integracao_backend`, com testes locais em PostgreSQL/PostGIS descartável, HTTP real e WebSocket real. A intranet não foi acessada, conforme combinado. O exame cobre compartilhamento nominal e por grupo, publicação, recursos privados, repasse de concessões, prazos, concorrência, credenciais e informação exibida ao publicar.

Foram acrescentadas regressões comportamentais, incluindo bloqueios controlados no PostgreSQL para forçar operações concorrentes. A primeira rodada de sete casos de privacidade falhou integralmente antes das correções; os sete passaram depois. Dois casos iniciais de concorrência também falharam antes e passaram depois. Não se usou apenas inspeção do código como prova de correção.

## Achados e correções

| Achado | Efeito demonstrado | Correção |
| --- | --- | --- |
| Cookie prevalecia sobre Bearer explícito | Uma requisição identificada como outra conta herdava o acesso do cookie; até um Bearer inválido autorizava publicação pelo cookie. | Bearer explícito precede cookie, sem fallback para outra conta quando inválido. A precedência de chave de API válida foi preservada. |
| Claims antigas nas rotas só-flexíveis | Administrador rebaixado continuava entrando em atlas privado; sessão cortada continuava usando empréstimo de atlas. | Consulta do estado vivo mesmo longe da renovação do token; `auth` estrito reaproveita a leitura da mesma requisição. |
| Revogação aguardava o heartbeat | Depois do sucesso HTTP, um socket revogado ainda recebia mensagens; gestor rebaixado ainda integrava a audiência de gestão. | Reconciliação dos sockets do processo antes da resposta HTTP, com encerramento quando não é possível confirmar a autorização. |
| Mudança de grupo não atualizava a conexão | Retirada, inclusão e exclusão de grupo deixavam permissão em memória desatualizada. | Reconciliação dos atlas afetados e notificação ao próprio usuário da permissão efetiva; preserva acesso direto inferior que continue válido. |
| Corte em massa não encerrava sockets existentes | Uma sessão explicitamente cortada podia continuar recebendo dados numa conexão já aberta. | O heartbeat também verifica `sessions_valid_from`. Logout individual e expiração natural continuam seguindo seus contratos distintos. |
| Respostas de composição sem proteção explícita de cache | Listas de compartilhamento, concessões, grupos e membros não declaravam o caráter privado para acesso por cookie. | `Cache-Control: private, no-cache` e `Vary` por credencial, usando o marcador já adotado no projeto. |
| Repasse concorrente com revogação | Um filho podia nascer depois da poda do pai e continuar concedendo acesso. | Criação e poda usam o mesmo bloqueio por recurso; autoridade e duplicidade são relidas dentro da transação. |
| Concessões simultâneas idênticas | Duas requisições recebiam 201 e criavam caminhos duplicados. | Serialização: uma cria e a outra recebe 409. |
| Prorrogações simultâneas | Uma prorrogação menor podia sobrescrever outra maior já aceita. | Bloqueio por recurso antes da releitura do prazo atual; a tentativa de encurtamento recebe 409. |
| Repasse concorrente com saída de grupo | A saída podia terminar antes do INSERT de um repasse já autorizado, deixando o beneficiário com acesso órfão. | A criação segura a conta concedente durante a transação; a retirada aguarda antes de descobrir as raízes da poda. A ordem de bloqueios é conta, depois recurso. |
| Falha ao carregar os recursos emprestados ocultava o aviso | Lista indisponível era apresentada como se não houvesse itens privados expostos. | Estado desconhecido mostra aviso explícito, sem inventar nomes; resposta vazia confirmada continua sem alerta. |

### Assets 3D e desempenho

Fora da janela de renovação do token, a reconciliação de identidade não faz uma consulta por fragmento 3D. Para esses bytes, a sessão viva é conferida dentro do memo de autorização privada, com teto existente de 30 segundos. A chave distingue o instante de emissão da sessão, impedindo que uma sessão nova autorize, pelo cache, um token cortado da mesma conta. Fragmentos públicos continuam públicos; a renovação deslizante perto da expiração foi preservada. Há regressões para sessão cortada, administrador rebaixado e custo após aquecimento.

### Comportamentos preservados e limites

- Publicar um atlas também pode expor recursos privados que ele empresta. Esse é o comportamento deliberado do produto; o aviso informa a consequência. A publicação não deve ser tratada como compartilhamento nominal.
- Revogar acesso impede leituras futuras autorizadas pelo servidor; não recolhe arquivos exportados, cópias locais, imagens já recebidas ou capturas de tela.
- A reconciliação imediata alcança as conexões no processo que atende a mutação. Outros processos, alterações administrativas e cortes de sessão dependem da reconciliação periódica. Esta auditoria não implementa distribuição de invalidações entre processos.
- Os aproximadamente 30 segundos do heartbeat pressupõem banco disponível e processamento normal. A tolerância preexistente a falhas de consulta pode manter sockets até três varreduras; mutações de compartilhamento usam fechamento na primeira falha de reconciliação.
- A decisão memoizada de assets privados pode conservar autorização por até 30 segundos. Os cabeçalhos de cache dos bytes têm regras próprias, diferentes das listas JSON.
- A garantia testada para compartilhamento é após a confirmação HTTP. Requisições e dados já em trânsito durante a mudança não são recolhidos retroativamente.
- Os testes não equivalem a ensaio do proxy HTTPS, configuração de cache ou topologia da intranet. Esses componentes não estavam acessíveis nesta máquina.

## Validação

Resultados finais:

- Frontend: 720 arquivos, 13.326 testes aprovados.
- Backend completo: 5.285 testes aprovados, sem falhas, cancelamentos ou skips. Cobertura: 98,31% de linhas/declarações, 90,08% de ramos e 96,66% de funções; pisos exigidos aprovados.
- Contratos frontend/backend: 67 arquivos, 249 testes aprovados.
- Bateria ampliada de privacidade, concessões concorrentes, assets e controles: 72 testes aprovados em banco novo.
- Chromium: oito cenários aprovados, incluindo a falha de rede no aviso de publicação. Esse caso foi repetido aguardando o HTTP 503 e gerando captura, inspecionada visualmente; a recuperação com lista vazia confirmada também passou.
- Lint da raiz aprovado; build do frontend aprovado, com os avisos de tamanho dos chunks.
- Inventários de consultas e saídas WS atualizados com as novas superfícies; 37 verificações aprovadas, sem reduzir os controles negativos.

Na primeira campanha ampla, além das regressões em correção e dos inventários a atualizar, apareceu um teste de catálogo com a lista antiga de superfícies (faltava o modelo 3D em comentário). A expectativa foi atualizada conforme o registro de referências já existente. Uma espera por lock de teste de sync também falhou naquela campanha e passou na repetição em banco novo; não foi inferido um defeito de produto a partir dessa espera.

A espera por lock mencionada acima também passou nos dois casos da suíte completa final. Não houve redução de cobertura exigida nem exclusão de teste para obter a aprovação.

Reprodução das camadas principais: `npm run lint`, `npm test --prefix frontend`, `npm test --prefix backend -- --keep-db`, `npm run test:e2e` e `npm run test:e2e:ui --prefix frontend -- browser-sharing-public.spec.js browser-sharing-lifecycle.spec.js browser-sharing-presence.spec.js resource-share-criar-grupo.spec.js sharing-privacy-warning.spec.js --retries=0`. Foram usados bancos descartáveis com nomes próprios e diretórios de dados de teste separados.

O PostgreSQL local no Windows voltou a reter o DROP de bancos descartáveis em `ProcSignalBarrier` durante o teardown de E2E. Foram canceladas somente essas consultas, identificadas pelo nome exato do banco, após o fim das asserções. Os processos de teste terminaram com código zero; não houve reinício do serviço nem operação sobre o banco da aplicação. Os bancos de auditoria preservados não integram o commit.
