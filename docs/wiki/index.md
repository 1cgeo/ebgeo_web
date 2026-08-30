# Índice da Wiki

Esta wiki é a memória semântica do EBGeo: o que cada peça do sistema faz, por que foi decidida assim e quais são os limites que valem hoje. Ela cobre o frontend web, o backend único (REST + WebSocket + PostgreSQL/PostGIS) e os subsistemas geográficos (gazetteer, 3D e 360). Use o índice para achar a página de entrada de um assunto e siga os wikilinks internos a partir dela; as páginas do tipo síntese servem como quadro de decisão quando a dúvida é "qual caminho usar". A wiki cresce junto com o trabalho: cada investigação, correção de bug ou decisão nova vira página ou atualiza uma existente, em vez de morrer no histórico de conversas. Regras de manutenção em [wiki-schema.md](wiki-schema.md).

## Por onde começar

- [[atlas-modelo-de-dados]] - o contêiner de topo do projeto e o modelo de dados inteiro em uma página.
- [[modelo-de-dados]] - a revisão transversal dos quatro schemas: duplicidade de conceito, coluna sem escritor, tabela sem leitor e relação sem FK, com o método de medição.
- [[modelo-conflito-lww]] - como a colaboração funciona: mutações viram operações, o servidor ordena tudo, e por que isso não é um CRDT (o mal-entendido mais caro do projeto).
- [[dominio-local-vs-remoto]] - a separação entre workspace local e cópia de atlas do servidor, base para entender quase todo comportamento do cliente.
- [[sintese-decisoes-arquiteturais]] - as escolhas estruturais e os não-objetivos declarados.

## Sincronização: modelo e fluxos

- [[envelope-operacao]] - a unidade atômica de sincronização e os campos que toda operação carrega.
- [[tipos-entidade-sync]] - quais entidades viajam como operação e como o backend traduz os aliases.
- [[modelo-conflito-lww]] - o vencedor de edições concorrentes é a maior serverVersion, nunca o relógio de parede.
- [[idempotencia-e-convergence-guard]] - reenvio seguro por op_id e adiamento de ops remotas sobre edição local pendente.
- [[snapshot-e-pull-incremental]] - quando o servidor devolve snapshot completo e quando devolve operações incrementais.
- [[fila-operacoes-outbound]] - da mutação local ao push HTTP (transação, fila IndexedDB, compaction e flush) e o destino do que se acumulou offline na reconexão.
- [[aplicacao-operacoes-remotas]] - o caminho inbound até persistir no store e redesenhar o mapa.
- [[ack-idempotencia]] - o ack por operação e por que idempotent:true conta como sucesso.
- [[tabela-operations]] - o log append-only no PostgreSQL e a sequência global que define a ordem.
- [[sync-admin-operacoes]] - estatísticas e cleanup do log de operações, com efeito de forçar snapshot.
- [[syncledger]] - a camada de tracing test/dev que torna o pipeline multiusuário verificável ponta a ponta.
- [[dominio-local-vs-remoto]] - o marcador de origem e o anti-leak do mapa local Principal.

## Tempo real: canal e presença

- [[canal-collab-websocket]] - o canal de colaboração: tipos de mensagem, ciclo de conexão, autorização no handshake, broadcast de mutações e ack pelo socket.
- [[client-id-estavel]] - o identificador de cliente persistido que sustenta idempotência e presença.
- [[presenca-colaborativa]] - a camada efêmera em memória que propaga roster, cursores e seleção nas três superfícies (2D, 3D e 360), com a janela de graça que separa queda de conexão de saída real.
- [[qualidade-conexao-adaptativa]] - RTT reportado pelo cliente e ajustes de transporte recomendados pelo servidor.
- [[capacidade-de-uma-instancia]] - quantas pessoas cabem num processo, medido em bancada: o teto de sala, o de sockets e o de escrita por atlas.

## Atlas, permissões e compartilhamento

- [[atlas-modelo-de-dados]] - o atlas como entidade do backend, unidade de isolamento do sync e da sala WebSocket.
- [[api-rest-atlas]] - a família de endpoints REST de atlas e a permissão mínima por rota.
- [[atlas-settings]] - o bloco de configuração por atlas que habilita features e restringe camadas e navegação.
- [[permissoes-atlas]] - os cinco tiers de acesso, os dois vocabulários ortogonais de autorização (tier de atlas e papel de UI), como um deriva do outro e onde cada checagem acontece.
- [[compartilhamento-atlas]] - concessão de acesso a um atlas gravada em atlas_shares, para uma pessoa ou um grupo.
- [[link-publico]] - acesso anônimo por link opaco trocado em token de visitante read-only.
- [[clone-atlas]] - o que a duplicação de atlas leva junto e o que deliberadamente fica de fora.
- [[atlas-import-offline]] - subir um atlas inteiro criado offline preservando os UUIDs locais.
- [[imagens-atlas]] - imagens fora do fluxo de operações, referenciadas por imageId nas feições.
- [[comentario-espacial]] - a entidade de comentário ancorado em coordenada e o papel Comentarista.

## Identidade, autenticação e segurança

- [[autenticacao-jwt]] - o par access token curto e refresh token opaco de longa duração.
- [[jwt-emissor-unico]] - um único segredo e um único payload servindo os três consumidores.
- [[refresh-token-rotacao]] - uso único, rotação, detecção de reuso e revogações em massa.
- [[auth-flexivel]] - o middleware não-bloqueante que popula o usuário e deixa a requisição seguir anônima.
- [[api-keys]] - chaves de API para integração máquina-a-máquina: duas moradas (a legada, uma por conta, e a tabela nomeada, várias por conta com rótulo e prazo), revogáveis e auditadas.
- [[hardening-borda-api]] - rate limiting, login timing-safe, cabeçalhos, readiness e boot fail-fast.
- [[upload-imagens-seguranca]] - validação dupla de tipo, limites de tamanho e entrega sempre como anexo.
- [[erros-api]] - o envelope de erro visto do lado do cliente: o que ele descarta e o que já resolveu antes do seu catch.

## Administração, usuários e catálogo

- [[organizacoes-om]] - a Organização Militar como tenant de primeira classe.
- [[gestao-usuarios]] - ciclo de vida administrativo das contas, incluindo desativação com transferência de atlas.
- [[resources-catalogo]] - o catálogo global versionado de camadas e assets, escrito por administrador ou pela OM produtora.
- [[acesso-a-recurso-privado]] - a marca público/privado nos cinco tipos de recurso, a concessão em árvore com prazo e o empréstimo que um atlas faz do que anexou.
- [[tile-privado]] - a única superfície de recurso privado que o Node não serve: o gate por `auth_request` no nginx, os três transportes de credencial e o custo medido.
- [[grupo-de-acesso]] - o beneficiário coletivo de uma concessão, quem tem autoridade para compô-lo, e por que listar grupo e administrar grupo têm gates diferentes.
- [[auditoria]] - a trilha de eventos de negócio, o eixo de OM gravado na escrita, e a leitura em dois ramos (administrador e produtor).
- [[config-dinamico]] - o endpoint público que substitui o config.js estático e monta o payload em runtime.

## Dados geográficos: gazetteer, 3D e 360

- [[gazetteer-nomes-geograficos]] - o subsistema read-only de busca de topônimos sobre o schema isolado.
- [[ranking-busca-toponimos]] - as três chaves lexicográficas que ordenam a busca de nomes, e por que não é uma soma.
- [[calibracao-busca-toponimos]] - o conjunto dourado e a ablação que decidem essa ordenação com evidência.
- [[resources-catalogo]] - nota histórica: houve um SEGUNDO catálogo de modelo 3D, e por que ele saiu.
- [[assets3d-distribuicao]] - a rota pública que serve os binários 3D com dual-mode de armazenamento.
- [[acervo-3d-convertido]] - o acervo fotogramétrico convertido: um `.3dtiles` por modelo, o token de geração que autoriza o cache de um ano, e as armadilhas que já puseram modelo deitado e a 3,6 km do lugar.
- [[primeira-pessoa-3d]] - a cena caminhável em Gaussian Splatting: por que ela é uma linha de tilesets, as opções de motor medidas (e os instrumentos que mentiram), e as armadilhas cujo sintoma é sucesso plausível.
- [[streetview-360]] - o módulo de panoramas: projetos, metadado da foto, imagem, tiles e thumbnails.
- [[calibracao-e-grafo-360]] - ajuste da câmera plana e dos links dirigidos entre fotos.
- [[ingestao-projetos-360]] - upload de bundles que substitui o estado completo de um projeto.
- [[config-runtime-urls-relativas]] - caminhos relativos resolvidos em runtime, tornando os dados portáveis entre ambientes.

## Cliente, produto e operação

- [[modos-operacao]] - os três modos do frontend: anônimo, autenticado e público.
- [[sessao-boot-e-ciclo-de-vida]] - a ordem de boot, a URL como fonte de verdade e a expiração por inatividade.
- [[coordenacao-entre-abas]] - quando duas abas do mesmo navegador colidem, por que a arbitragem é por ordem total, e o que bloquear significa (parar o sync, nunca apagar).
- [[namespace-por-atlas]] - um conjunto de bancos IndexedDB por atlas, o expurgo derivado de registro e o resgate do trabalho não sincronizado.
- [[formato-ebgeo-roundtrip]] - o contêiner portável do trabalho local e as invariantes de round-trip.
- [[sair-do-servidor]] - as DUAS regras de poda de recurso restrito na cópia, e por que sair do servidor e mudar de dono dentro dele exigem regras diferentes.
- [[modulo-temporal]] - a dimensão de tempo por mapa e a fronteira entre estado compartilhado e estado local.
- [[deploy-backend]] - um processo Node atrás de NGINX, três schemas e stores binários fora do banco.
- [[deploy-web]] - publicação do bundle por troca de symlink, e por que ele precisa ser relativo.
- [[observabilidade]] - como se olha para o EBGeo rodando: o log que sobrevive à sessão, o `req.id` que costura as duas linhas de uma falha, e o comando que consulta.
- [[peso-do-pacote-web]] - o que prende uma biblioteca no payload inicial do mapa, com o ganho já medido de tirá-la.

## Sínteses e quadros de decisão

- [[sintese-rest-vs-websocket]] - quando usar cada um dos dois canais complementares do sync.
- [[sintese-rest-vs-sync]] - o que muda por REST e o que só muda por operações de sync.
- [[sintese-modulos-fora-do-sync]] - os módulos REST que ficam fora do sync e o que isso exige do frontend.
- [[sintese-limites-collab]] - os limites conhecidos da colaboração hoje.
- [[sintese-eixos-de-permissao]] - os eixos ortogonais de permissão e quem decide o quê, incluindo o que deixou de decidir.
- [[sintese-capacidades-por-papel]] - onde cada papel realmente muda de comportamento.
- [[sintese-contrato-erros-http]] - o mapa consolidado dos status HTTP e a reação esperada do cliente.
- [[sintese-contratos-congelados]] - os envelopes divergentes e os shapes que não podem mudar.
- [[sintese-cache-http-imutavel]] - o protocolo de cache compartilhado pelos binários imutáveis.
- [[sintese-decisoes-arquiteturais]] - as decisões estruturais e os não-objetivos assumidos.

## Meta

- [[wiki-schema]] - o que entra e o que não entra numa página, a forma do slug e da citação, e o protocolo de `[!CONTRADICAO]`. Leia antes de criar ou podar página.
