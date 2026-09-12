# Revisão de liberação: main → integracao_backend

Registro da revisão anterior às correções. Os três bloqueadores abaixo foram corrigidos
localmente; os resultados e os aceites ainda pendentes constam na
[execução do plano](execucao-correcao-migracao-2026-09-12.md).

Data: 12/09/2026. **Parecer: não liberar ainda. Há três bloqueadores de preservação reproduzidos.**

A adoção dos bancos das versões 2.x funciona nos cenários exercitados. Isso não garante a
travessia de uma instalação 1.x nem a convivência com uma aba da versão de produção. Esses
casos importam justamente para quem ficou meses sem acessar ou mantém o navegador aberto.

## Referências e alcance

| Referência | Commit |
|---|---|
| Produção informada pelo responsável: main atual, conferida com `git fetch origin main integracao_backend` | `8b611113aa73c3faedc967ccf77132604255ea8d` |
| main local, que estava atrasada e não foi usada como única referência | `e014b7016e5600bd71e5c6c5a549cfb36b22c7e0` |
| Integração revisada | `d2f956e827f3728206ca871b66431e1e29249c2d` |

O responsável confirmou que a publicação manterá domínio e protocolo. A URL é interna e
não é acessível deste ambiente. Portanto, esta revisão verificou código, histórico, build e
testes locais; não certifica os headers, rotas, volumes, certificados ou backups do servidor.
Não houve deploy nem alteração de código de produção nesta revisão.

O armazenamento é por origem: protocolo, host e porta. Mantendo também a porta, no mesmo
perfil do navegador, o pacote novo pode alcançar o IndexedDB anterior. Trocar o diretório do
build para `frontend/` não muda, por si só, a origem nem o nome dos bancos. Isso não recupera
dados que o navegador já tenha removido antes do retorno do usuário. Armazenamento não
persistente pode ser despejado; `navigator.storage.persist()` reduz esse risco quando concedido.
[Referência: MDN : quotas e remoção de armazenamento](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).

## Bloqueadores encontrados

R1 e R2 são fragilidades herdadas do degrau histórico, também presente na main. Não é
necessário que tenham sido introduzidas na integração para bloquear a atualização de um
usuário ausente. R3 surge da convivência entre os protocolos dos dois branches.

### R1 : P1: imagens ficam órfãs na migração verdadeira de 1.x

**Entrada:** instalação 1.7 sem registro de atlas 2.x, com uma feição de imagem e seu conteúdo
em `ebgeo_images`, indexado pelo identificador da feição. Esse formato existe no histórico
anterior à refatoração `8328404a`, de 31/01/2026; não é apenas um marcador hipotético.

**Causa:** `migrateFeature` chama `resolveId` e atribui um UUID novo. A migração não remapeia
as chaves do banco de imagens. `LocalRepository.getImage` continua buscando pelo identificador
recebido da feição. O guard para o par settings 1.7 / atlas 2.4 protege esse par, mas não a
instalação verdadeiramente 1.7 que precisa passar pelo degrau.

**Resultado reproduzido:** a cadeia termina em 3.0, a feição continua no mapa e a busca de sua
imagem retorna `null`. O conteúdo antigo fica no disco sob outro identificador: há perda de
associação e indisponibilidade para o usuário, embora os bytes não tenham sido apagados.

**Código:** [v1-to-v2.migration.js](../../frontend/src/js/store/migration/v1-to-v2.migration.js),
`resolveId`, `migrateFeature` e `migrateToV2`;
[local.repository.js](../../frontend/src/js/store/repositories/local.repository.js), `getImage`.

**Correção necessária:** preservar a identidade local quando possível ou migrar também todas
as referências e chaves de blobs, mantendo uma correspondência persistida e verificável.
Não remover o conteúdo original antes de provar a integridade do destino. Incluir imagens
comuns, símbolos, medidas e referências em grupos na verificação.

**Aceite:** a imagem é alcançável pelo ID final e tem os mesmos bytes; fechar e reabrir o app,
exportar e enviar ao servidor preservam a associação. O teste R1 deve passar sem `skip` ou
inversão da expectativa.

### R2 : P1: interromper e retomar o degrau 1.x pode romper camadas e grupos

**Entrada:** mapa 1.7 contendo camada e grupo; falha na gravação do mapa após as gravações
de camadas e grupos. Fechar uma aba nesse intervalo produz a mesma fronteira de persistência;
o teste injeta uma rejeição para tornar a fronteira determinística.

**Causa:** migrateMap (função antiga, substituída nesta correção) grava camadas, depois grupos, depois o mapa. São bancos diferentes.
O dicionário de IDs é somente uma `Map` em memória, refeito com novos UUIDs na próxima
execução. Camadas e grupos já gravados deixam de ter os IDs referenciados pelo mapa antigo.

**Resultado reproduzido:** após recarregar os módulos e executar a cadeia novamente, o mapa
aponta para `camada-antiga`, que não existe mais na lista de camadas. O grupo referenciado
também não é encontrado. A cadeia anuncia conclusão apesar dessas referências quebradas.
O teste confirma ambas as falhas separadamente.

**Código:** [v1-to-v2.migration.js](../../frontend/src/js/store/migration/v1-to-v2.migration.js),
especialmente migrateMap (função antiga, substituída nesta correção) e `createIdMappings`.

**Agravante:** [repository.js](../../frontend/src/js/store/repository.js),
`initializeRepository`, captura a falha e retorna `mapaDeEmergencia`; não estabelece um modo
de recuperação sem escrita. Escolher um mapa existente melhora a apresentação, mas não
transforma uma migração parcial em um estado consistente.

**Correção necessária:** tornar o degrau retomável, com IDs estáveis e progresso persistido,
ou preparar e validar a transformação antes de ativar o resultado. A continuidade do editor
precisa depender da integridade do estado, com recuperação/exportação disponíveis quando
ela não puder ser demonstrada. Um backup no próprio armazenamento também precisa considerar
a cota: não assumir que há espaço para duplicar todas as imagens.

**Aceite:** interromper após cada gravação relevante, iniciar uma nova sessão e obter os mesmos
IDs/referências válidos; nenhuma etapa pode marcar sucesso apenas por ter escrito a versão.

### R3 : P1: aba da main e aba da integração podem editar os mesmos bancos

**Entrada:** usuário deixa uma aba da main aberta e abre outra depois da publicação.

**Causa:** ambos usam `ebgeo-tab-lock`, mas o protocolo mudou. A main usa `PING`/`PONG` sem
versão; a integração descarta mensagens sem `v === PROTOCOL_VERSION`. A main também não
entende o `HELLO` da integração. A primeira instalação local da integração adota justamente
os mesmos bancos sem sufixo que a aba antiga continua usando.

**Resultado reproduzido:** o código real da main `8b611113`, executado com `BroadcastChannel`,
termina ativo; a integração concede a posse local sem entrar em modo degradado. Os dois lados
consideram permitida a edição. A reprodução prova a dupla permissão; a sobrescrita concreta
depende das edições e da ordem das gravações e não foi medida em duas UIs de versões diferentes.

**Código:** [tab-lock.js](../../frontend/src/js/utilities/tab-lock.js), `_onMessage`;
[fixture imutável do código publicado](../../frontend/tests/fixtures/migration-review/tab-lock-main-8b611113.txt).
As gravações locais são de registros inteiros de mapa (`LocalRepository.saveMap`), portanto
um escritor com estado antigo pode substituir alterações do outro.

Os três testes existentes de migração em Chromium incluem duas abas, mas ambas executam a
versão nova. Esse resultado não cobre a convivência de protocolos diferentes.

**Correção necessária:** detectar e tratar abas legadas antes da primeira escrita/migração.
Uma ponte de protocolo deve impedir edição concorrente e orientar a atualização da aba
antiga. Só anunciar `TAKEOVER` não prova que tarefas já iniciadas foram interrompidas. Se
for necessária uma versão intermediária da main, clientes que pularem essa versão ainda
precisam de um caminho seguro ao voltar meses depois.

**Aceite:** main real e integração na mesma origem/perfil, em ambas as ordens de abertura,
com migração e edição pendente: somente um escritor; as alterações do usuário sobrevivem.
Incluir aba em segundo plano e retorno de suspensão.

## O que já está protegido

| Área | Evidência e limite |
|---|---|
| Adoção dos bancos 2.x | O slot local inicial usa sufixo vazio. Não copia nem apaga os blobs na adoção local normal. |
| Colisão entre versões dos branches | Alvo 3.0 distingue a nova organização de atlas das versões 2.3/2.4 da main. |
| Marcador 1.7 com registro de atlas 2.4 | O registro impede executar novamente a renumeração de 1.x; fixture com 146 blobs alcançáveis cobre esse caso. |
| Falha de leitura / marcador ausente | `checkAndCleanLegacyData` mede os bancos e preserva o escopo com dados; uma falha de leitura não manda limpar tudo. |
| Retorno em outra sessão | Há testes de segundo boot, idempotência e migração do slot montado. |
| Mapas de versões 2.2/2.4 | Fixtures exercitam mapas, feições, camadas, grupos, briefings, ícones e imagens. |
| Linha de barreiras antiga | A leitura normaliza `barrier_lines` em `coordination_lines`. |
| Fila herdada da main | A adoção descarta operações antigas sem destino de servidor, preservando o estado local; não confundir a fila inerte com a única cópia dos dados. |
| Login, envio e troca de atlas | O envio lê o atlas local; a abertura remota ativa outro namespace antes da limpeza. A cadeia arquivo → local → F5 → servidor → cópia local passou em Chromium. |
| Persistência do navegador | O boot pede `navigator.storage.persist()` e registra o resultado; a concessão não é garantida nem recupera dados já removidos. |

Os dez bancos de dados do atlas continuam explicitamente inventariados na fábrica:
`ebgeo_atlas`, `ebgeo_maps`, `ebgeo_images`, `ebgeo_app_settings`, `ebgeo_groups`,
`ebgeo_layers`, `ebgeo_cesium3d`, `ebgeo_streetview360`, `ebgeo_briefings`, `ebgeo_comments`.
O registro novo fica em `ebgeo_global`; a fila usa `ebgeo` / `operation_queue` e depois o
namespace correspondente. Preferências globais e identidade em localStorage têm outro ciclo.

## Matriz de entrada e cobertura

| Instalação encontrada no retorno | Situação nesta revisão |
|---|---|
| 2.2 | Migração e segundo boot cobertos; três cenários Chromium aprovados. |
| 2.3 da main | Entrada do degrau 3.0 coberta em testes de integração. |
| 2.4 da main | Fixture de 14 mapas, 805 feições, 149 PNG, 21 camadas, 3 grupos, 2 briefings e 7 slides coberta. Não é dump de perfil. |
| Settings 1.7 + atlas 2.4 | Proteção aprovada na suíte existente; não equivale a testar 1.7 verdadeira. |
| 1.7 verdadeira, sem atlas | R1 e R2 reproduzidos: bloqueada. |
| 1.3–1.6 | Encadeiam etapas adicionais antes do mesmo degrau problemático. Sem certificação de ponta a ponta nesta revisão. |
| Anterior a 1.3 | Dados existentes são preservados pelo guard, mas o serviço declara a versão antiga demais para migrar. Preservação em disco não significa compatibilidade no editor. Exigir recuperação explícita. |
| Sem marcador / marcador ilegível | Há proteção contra limpeza. Controle adicional com registro 2.0 sem settings recebeu o backfill 2.1. Não cobre toda corrupção possível. |
| Duas abas da integração | Teste Chromium de migração simultânea aprovado. |
| Aba main + aba integração | R3 reproduzido: bloqueada. |
| Navegador já removeu o armazenamento | Recuperação depende de exportação/backup anterior. Uma migração não consegue recriar bytes ausentes. |

## Condições operacionais da publicação

1. **API antes do frontend.** `frontend/src/js/index.js` exige a configuração remota e retorna
   após três tentativas malsucedidas, mostrando indisponibilidade. Não chega a abrir o editor
   local. Validar a rota real de configuração, autenticação, upload de imagens e WebSocket
   através do proxy da rede interna. O sucesso local não valida esse proxy.
2. **Origem e armazenamento.** Manter protocolo, host e porta; não emitir `Clear-Site-Data`
   nem instruir limpeza de cache/dados como procedimento de atualização. Verificar os headers
   efetivamente servidos pelo NGINX. Esses headers não estão acessíveis aqui.
3. **HTML e chunks antigos.** Validar cache do HTML e carregamento tardio de assets por abas
   abertas antes do deploy. Guardar três diretórios de release não prova que os URLs de assets
   antigos continuam servíveis pelo `current`. Não havia Service Worker de aplicação registrado
   nos caminhos de código examinados; isso não certifica o estado histórico de cada perfil.
4. **Rollback de código não restaura dados.** `deploy/deploy.sh --rollback` troca o symlink do
   frontend. Não desfaz os marcadores 3.0 nem converte os novos namespaces para a main.
   Não prometer reversão segura de dados com esse comando. Ensaiar uma recuperação com build
   que entenda o esquema já migrado e preservar os bancos existentes.
5. **Ausentes não podem depender de anúncio.** Pedir exportação prévia aos usuários ativos é
   útil, mas não cobre quem só retornar depois da mudança. O próprio cliente novo precisa
   preservar/recuperar instalações antigas sem exigir uma visita à versão intermediária.
6. **Exportação não é cópia bruta.** As fixtures `.ebgeo` vêm do exportador e não são dumps de
   IndexedDB. O README delas documenta campos reconstruídos e ausentes. Para liberação, capturar
   também perfis/dumps sintéticos produzidos por builds históricos, incluindo estado de mapa,
   camadas ativas, anotações, 3D/360, comentários, anexos e preferências. Fazer isso em ambiente
   de homologação e perfil descartável, sem expor o único acervo de um usuário ao ensaio.

## Execuções e resultados

| Verificação | Resultado |
|---|---|
| Frontend completo, antes dos novos testes | 620 arquivos; 12.089 testes passaram, 1 timeout de 5 s no teste de regra ESLint `maplibre-construtores-regua`. |
| Arquivo do timeout, isolado | 17 testes passaram; o caso que expirou completou em 179 ms. Compatível com contenção na rodada paralela, sem alterar limite ou código. A rodada completa original continua registrada como falha. |
| Novos testes de auditoria | 5 testes: 2 controles passaram, 3 testes falharam reproduzindo R1, R2 e R3. |
| Chromium, `browser-migracao-2.2` | 3 aprovados, sem retry e sem skip, 29,1 s. |
| Chromium, importação, cadeia completa e lacunas da exportação | 6 aprovados, sem retry e sem skip, 59,9 s. |
| Build de produção | Aprovado, 1 min 29 s; avisos de tamanho de chunks/tempo de plugins. |
| ESLint do teste novo | Aprovado. |
| Backend completo em banco descartável próprio | 5.009 testes aprovados, 0 falhas e 0 skips; 590,3 s. Cobertura: 98,28% linhas/statements, 90,32% branches, 96,54% funções; pisos aprovados. Banco `ebgeo_migration_review_20260912` removido pelo runner ao concluir. |

Logs locais da revisão, ignorados pelo Git: `migration-review-vitest.log`,
`migration-review-repro.log`, `migration-review-browser.log`, `migration-review-roundtrip.log`,
`migration-review-build.log`, `migration-review-backend.log`, na raiz do workspace.

Reproduzir os bloqueadores:

```powershell
cd frontend
npx vitest run tests/integration/migracao-main-riscos-abertos.repro.test.js --reporter=verbose
```

**O comando deve falhar no commit revisado.** As expectativas descrevem preservação de dados;
não foram trocadas por expectativas do defeito para deixar a suíte verde. A fixture de protocolo
é o código da main publicada; as entradas 1.7 são sintéticas no formato histórico. Não se está
afirmando que um perfil real de usuário antigo foi recuperado neste ambiente.

## Critério de liberação

Liberar somente após R1, R2 e R3 corrigidos e seus testes aprovados, acrescidos de um ensaio
em navegador com a main real e builds históricos gerando o armazenamento de partida. Medir
contagens, IDs, associações e bytes/hash das imagens antes/depois; verificar segundo boot,
exportação/importação e cópia para o servidor. Repetir o ensaio com falha em cada fronteira de
gravação do degrau 1.x, API indisponível e aba antiga aberta.

Na rede interna, executar o checklist operacional acima e um piloto com cópias recuperáveis.
Acompanhar conclusão/erro da migração por versão de entrada, divergências de inventário,
imagens ausentes e falhas de quota. Não substituir os achados por uma garantia baseada apenas
na quantidade de testes existentes: os três novos cenários falham apesar dessa cobertura.
