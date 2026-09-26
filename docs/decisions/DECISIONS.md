# Log de Decisões

Registro append-only de decisões de arquitetura e processo (ADRs leves). Este arquivo é o **índice**:
uma linha por decisão. As entradas integrais vivem em `decisions-<ano>.md`.

Toda decisão nova acrescenta a entrada completa no arquivo do ano **e** uma linha aqui. **Não
reescreva entrada antiga**: adicione uma nova marcando que supera a anterior. É o mecanismo
antipodridão, e o histórico do porquê sobrevive à mudança de rumo.

## Onde escrever o quê

Quatro registros vizinhos, e ninguém consegue adivinhar a fronteira sem esta seção.

| Destino | O que entra | Como envelhece |
|---------|-------------|----------------|
| **`docs/decisions/`** (aqui) | decisão sobre o **repositório e o processo**: como o código, a documentação e a verificação se organizam. Carrega a alternativa rejeitada e o status. | **Não envelhece**: é datado. Uma decisão superada ganha entrada nova, a antiga fica. |
| [`docs/wiki/`](../wiki/index.md) | decisão sobre o **sistema**: por que o produto funciona assim, qual é a armadilha, qual é o contrato congelado. Quadro consolidado em [`sintese-decisoes-arquiteturais.md`](../wiki/sintese-decisoes-arquiteturais.md). | **Envelhece com o código**: mudou o código, muda a página. É verificada por teste. |
| [`docs/livro-razao.md`](../livro-razao.md) | não é decisão nenhuma: é **desvio de condução** (o que se afirmou sem verificar, o teste que não prendia). | Append-only, podado por síntese. |
| [`docs/MEMORY.md`](../MEMORY.md) | o **fato durável** que sobra depois, não o porquê dele. | Corrigido contra o código quando conflita. |

A pergunta que decide entre os dois primeiros: **se o código mudar, esta frase muda?** Se sim, é
página de wiki. Se não, porque ela registra o que se sabia e o que se escolheu naquele dia, é entrada
aqui. Decisão de sistema que já vive na wiki **não** vira ADR: vira duas cópias que divergem.

## Quando escrever uma decisão

O gatilho é estreito de propósito: registro que dispara para tudo vira ruído e morre. Escreva quando
a decisão

1. **cria ou muda um padrão obrigatório** (ex.: "transação do store é persistence-first"),
2. **rejeita uma alternativa óbvia por motivo não-óbvio** (ex.: "múltiplos atlas locais nomeados é
   non-goal", que é exemplo de FORMA e não de conteúdo vigente: aquela decisão foi superada em
   2026-08-15, e o exemplo fica aqui de propósito, porque uma decisão superada é o caso que este
   registro existe para saber contar), ou
3. **é cara de reverter** (schema, contrato congelado, formato de dado persistido).

Nada mais. Escolha de biblioteca trivial, refatoração local e correção de bug não viram decisão:
viram commit, teste e, se ensinaram algo, linha no [`docs/livro-razao.md`](../livro-razao.md).

## Formato

```
### AAAA-MM-DD: título curto
- **Contexto:** por que a decisão foi necessária.
- **Decisão:** o que foi decidido.
- **Alternativas rejeitadas:** o que se considerou e por que não.
- **Consequências:** o que passa a ser verdade, incluindo o que se perde.
- **Status:** aceita | superada por <data/título>
```

## Índice

| Data | Decisão | Arquivo |
|------|---------|---------|
| 2026-07-18 | Monorepo, backend integrado por subtree em `backend/` | [decisions-2026.md](decisions-2026.md) |
| 2026-07-18 | O pacote web vai para `frontend/` (supera o layout da entrada acima) | [decisions-2026.md](decisions-2026.md) |
| 2026-07-18 | Documentação concentrada em `docs/` com camada de memória | [decisions-2026.md](decisions-2026.md) |
| 2026-07-25 | Cartão de atlas sem miniatura do mapa (descopado) | [decisions-2026.md](decisions-2026.md) |
| 2026-08-15 | Namespace de IndexedDB por atlas, com expurgo derivado de registro (supera P12) | [decisions-2026.md](decisions-2026.md) |
| 2026-08-15 | A fila de saída vira um banco por atlas (reverte a alternativa rejeitada da entrada acima) | [decisions-2026.md](decisions-2026.md) |
| 2026-08-16 | Um registro único de tipo de feição, e a recusa do modelo de source por camada | [decisions-2026.md](decisions-2026.md) |
| 2026-08-16 | Capa de atlas enviada pelo usuário (supera a recusa de 2026-07-25) | [decisions-2026.md](decisions-2026.md) |
| 2026-08-16 | Recursos privados do catálogo, concessão em árvore e empréstimo por atlas (D1 a D6) | [decisions-2026.md](decisions-2026.md) |
| 2026-08-17 | O escopo de produção é uma coluna em `users`, não uma tabela de vínculos (supera D6) | [decisions-2026.md](decisions-2026.md) |
| 2026-08-17 | O prazo da concessão morre no predicado, nunca em varredura | [decisions-2026.md](decisions-2026.md) |
| 2026-08-17 | A trilha de auditoria é completa e vive fora do atlas | [decisions-2026.md](decisions-2026.md) |
| 2026-08-18 | `streetview_markers` sai do sistema, sem depreciação | [decisions-2026.md](decisions-2026.md) |
| 2026-08-18 | O empréstimo por atlas alcança o 360, e o UUID do atlas não é senha | [decisions-2026.md](decisions-2026.md) |
| 2026-08-18 | Concessão expira, escopo de produção não (assimetria deliberada) | [decisions-2026.md](decisions-2026.md) |
| 2026-08-18 | Os bytes do 3D seguem o recurso, e a rota continua sem consultar o banco | [decisions-2026.md](decisions-2026.md) |
| 2026-08-18 | O cookie de sessão NÃO é emitido no login | [decisions-2026.md](decisions-2026.md) |
| 2026-08-18 | A coluna legada `maps.catalog_layers` sai, e a definição é podada na saída do log | [decisions-2026.md](decisions-2026.md) |
| 2026-08-19 | As 22 migrações viram 8 baselines por domínio, e o histórico passa a viver só no git | [decisions-2026.md](decisions-2026.md) |
| 2026-08-19 | O acesso geográfico por zonas sai inteiro, a busca de topônimo perde o eixo de acesso, e conceder a um coletivo renasce no schema da aplicação | [decisions-2026.md](decisions-2026.md) |
| 2026-08-19 | Administrar grupo de acesso é papel global de dado (administrador ou credenciado), e listar grupo não é administrar | [decisions-2026.md](decisions-2026.md) |
| 2026-08-20 | O grupo de acesso vira entidade de usuário, com dono, e o produtor ganha visibilidade e concessão de raiz (supera a linha acima) | [decisions-2026.md](decisions-2026.md) |
| 2026-08-20 | O eixo de papel dentro da organização (`org_role`) sai do código inteiro: coluna, claim, consultas, formulário e a semente do papel por atlas no cliente | [decisions-2026.md](decisions-2026.md) |
| 2026-08-20 | A panorâmica 360 passa a ser servida em pirâmide de tiles, e o manifesto de ingestão deixa de exigir tamanho de blob | [decisions-2026.md](decisions-2026.md) |
| 2026-08-21 | Produzir exige a OM produtora viva; o rebaixamento de quem concedeu continua não propagando, agora medido | [decisions-2026.md](decisions-2026.md) |
| 2026-08-21 | O compartilhamento de atlas ganha o eixo de grupo, e ele chega a `manage`, com as duas mitigações no mesmo commit | [decisions-2026.md](decisions-2026.md) |
| 2026-08-21 | O `details` da trilha carrega um de-para seletivo (valor, impressão HMAC, nome-só), e o vídeo de prévia vale para quatro tipos, sem o basemap | [decisions-2026.md](decisions-2026.md) |
| 2026-08-21 | As pendências da integração main/360 são pagas, e o inventário que as listava é apagado | [decisions-2026.md](decisions-2026.md) |
| 2026-08-21 | As pendências da constituição são pagas, o inventário é apagado, e o estado das cláusulas ganha guarda por citação de teste | [decisions-2026.md](decisions-2026.md) |
| 2026-08-21 | Revogar deixa de derrubar quem ainda tem outro caminho, e a autoridade passa a morrer com quem a exercia | [decisions-2026.md](decisions-2026.md) |
| 2026-08-21 | A trilha ganha o eixo de OM, gravado na escrita, e a leitura deixa de ser só-admin | [decisions-2026.md](decisions-2026.md) |
| 2026-08-22 | As três migrações posteriores ao esmagamento voltam para dentro das baselines, e o comentário encolhe um sexto | [decisions-2026.md](decisions-2026.md) |
| 2026-08-22 | O registro da fase multi-aba sai de `docs/decisions/`, porque o durável dele já vive na wiki | [decisions-2026.md](decisions-2026.md) |
| 2026-08-23 | `active_sessions` não é recriada: a presença fica em memória por decisão, e o guarda passa a medir escrita no pool | [decisions-2026.md](decisions-2026.md) |
| 2026-08-23 | `POST /sv360/photos/batch-calibration` fica, como API de roteiro, com prazo de cobrança em 2026-11-23 | [decisions-2026.md](decisions-2026.md) |
| 2026-08-23 | O NÍVEL de cada participante fica visível para todo membro do atlas | [decisions-2026.md](decisions-2026.md) |
| 2026-08-23 | Sair de um atlas e sair de um grupo, por conta própria | [decisions-2026.md](decisions-2026.md) |
| 2026-08-23 | O autor que VENCE a disputa repara o próprio valor no ack, porque nenhuma marca chega a tempo | [decisions-2026.md](decisions-2026.md) |
| 2026-08-24 | Afordância negada SOME por posto e RECUSA por estado, e o relatório de UX do usuário comum é dissolvido | [decisions-2026.md](decisions-2026.md) |
| 2026-08-24 | As oito decisões do perfil PRODUTOR, e o relatório de UX dele é dissolvido | [decisions-2026.md](decisions-2026.md) |
| 2026-08-24 | As oito decisões do perfil ADMINISTRADOR, e o relatório de UX dele é dissolvido | [decisions-2026.md](decisions-2026.md) |
| 2026-08-24 | As quatro decisões do perfil CREDENCIADO, e o relatório de UX dele é dissolvido | [decisions-2026.md](decisions-2026.md) |
| 2026-08-24 | As quatro decisões do perfil DESLOGADO, e o último relatório de UX é dissolvido | [decisions-2026.md](decisions-2026.md) |
| 2026-08-24 | O backlog de testes vira 98 defeitos reais, e três formas atravessam o repositório | [decisions-2026.md](decisions-2026.md) |
| 2026-08-25 | O antimeridiano do snapping é NÃO-OBJETIVO, e as duas peças do mil-symbol saem para módulos folha | [decisions-2026.md](decisions-2026.md) |
| 2026-08-25 | O id do atlas local sobe preservado quando está livre, e recunhado quando está ocupado | [decisions-2026.md](decisions-2026.md) |
| 2026-08-27 | O link de compartilhamento ganha a quarta superfície, e a PENDENCIA da raiz é dissolvida | [decisions-2026.md](decisions-2026.md) |
| 2026-08-28 | O cursor sai em lote por sala, e o limite de sala vai de cinquenta para duzentos | [decisions-2026.md](decisions-2026.md) |
| 2026-08-28 | O import não-aditivo descarta os mapas do escopo antes da primeira escrita | [decisions-2026.md](decisions-2026.md) |
| 2026-08-28 | A vivacidade do socket deixa de depender do temporizador da página | [decisions-2026.md](decisions-2026.md) |
| 2026-08-28 | O lote de saída do cliente cai de cem para vinte e cinco, porque cem perdia nos dois eixos | [decisions-2026.md](decisions-2026.md) |
| 2026-08-29 | O administrador transfere a OM dona de um recurso, e a aba Sistema perde dois controles | [decisions-2026.md](decisions-2026.md) |
| 2026-08-29 | Auto-cadastro vira toggle de runtime; a "Ordem" do catálogo sai; a config de recurso vira campos | [decisions-2026.md](decisions-2026.md) |
| 2026-08-29 | O projeto 360 ganha paridade de edição com o 3D (renomear pela UI) | [decisions-2026.md](decisions-2026.md) |
| 2026-08-29 | O projeto 360 vira paralelo exato do 3D, com a calibração a mais | [decisions-2026.md](decisions-2026.md) |
| 2026-08-29 | O vídeo de prévia vira ENVIO de arquivo hospedado, e o rótulo do tile server fica claro | [decisions-2026.md](decisions-2026.md) |
| 2026-08-29 | O botão "Limpar overrides" sai, e o 360 ganha os campos de cartão do catálogo | [decisions-2026.md](decisions-2026.md) |
| 2026-08-29 | O 360 do web converge com o ebgeo_360: arquivo por SLUG e colunas inertes podadas | [decisions-2026.md](decisions-2026.md) |
| 2026-08-29 | O tile privado ganha gate POR RECURSO, e o empréstimo ao visitante de link público é mantido com consentimento | [decisions-2026.md](decisions-2026.md) |
| 2026-08-29 | O botão "Prévia" sai do cartão do catálogo geral (envio no admin e dado ficam) | [decisions-2026.md](decisions-2026.md) |
| 2026-08-30 | A troca de atlas volta a NAVEGAR para atlas.html; o modal de troca ao vivo sai (a capacidade fica) | [decisions-2026.md](decisions-2026.md) |
| 2026-08-31 | O visualizador 3D deixa de vazar listener e de refazer o tileset a cada abertura; o laço de render para quando ele fecha | [decisions-2026.md](decisions-2026.md) |
| 2026-08-31 | O zoom mínimo e máximo passa a ser do mapa base; o da aplicação vira fixo em [2, 21] e o do atlas é removido | [decisions-2026.md](decisions-2026.md) |
| 2026-09-01 | o índice de regime vencido ganha teto de idade, e passado ele o 3D fecha inteiro | [decisions-2026.md](decisions-2026.md) |
| 2026-09-01 | Ctrl inclina, Shift rotaciona, e a pinça no tablet volta a ser só zoom | [decisions-2026.md](decisions-2026.md) |
| 2026-09-01 | "Colar Aqui" ancora no centro da caixa envolvente, e o Ctrl+V perde o gate de trava | [decisions-2026.md](decisions-2026.md) |
| 2026-09-01 | O modelo de zoom da divisa mora em `tool_manager/helpers/`, e a vista salva passa na frente do desenho | [decisions-2026.md](decisions-2026.md) |
| 2026-09-01 | Converter feicao linear e um CREATE novo mais um DELETE antigo, e o menu esconde por POSTO e recusa por ESTADO | [decisions-2026.md](decisions-2026.md) |
| 2026-09-02 | A lista de buckets que carregam imagem por feição é DERIVADA, e vale para colar e para o F5 | [decisions-2026.md](decisions-2026.md) |
| 2026-09-02 | A importação de formato externo perde o teto de 1000 geometrias, e a preparação passa a mostrar progresso | [decisions-2026.md](decisions-2026.md) |
| 2026-09-02 | A área da medição 3D sai em metros e quilômetros quadrados, sem hectares, e a exibição deriva do VALOR | [decisions-2026.md](decisions-2026.md) |
| 2026-09-02 | Continuar uma feição linear é um UPDATE da MESMA feição, e a alça anda presa à alça de vértice | [decisions-2026.md](decisions-2026.md) |
| 2026-09-02 | mover ou copiar uma camada inteira para outro mapa, e a transferência é COMPOSTA | [decisions-2026.md](decisions-2026.md) |
| 2026-09-02 | o blob COLADO sobe pela porta bulk, e quem NÃO sobe é quem o par regenera | [decisions-2026.md](decisions-2026.md) |
| 2026-09-02 | a saída de uma feição do grupo é uma op de `group_feature`, e a lista dentro de um `group` update é descartada em silêncio | [decisions-2026.md](decisions-2026.md) |
| 2026-09-02 | a importação para de calcular perfil de elevação, e a chave da fila ganha sequência e marca d'água | [decisions-2026.md](decisions-2026.md) |
| 2026-09-02 | feição sem referência de zoom vale fator 1, e nenhum NaN sai da correção de zoom | [decisions-2026.md](decisions-2026.md) |
| 2026-09-03 | o aviso de servidor secundário nasce LIGADO e vem do servidor, e o tipo de feição novo entra editando a baseline | [decisions-2026.md](decisions-2026.md) |
| 2026-09-03 | a versão de esquema FICA em 2.3, e o balde novo se garante na LEITURA | [decisions-2026.md](decisions-2026.md) |
| 2026-09-03 | a Linha de Coordenação entra pela mesa de ferramentas TARDIAS, e o modelo de zoom mora nos helpers | [decisions-2026.md](decisions-2026.md) |
| 2026-09-03 | dois cliques rápidos são dois vértices, e o Núcleo no KMZ desenha pelo código do escalão | [decisions-2026.md](decisions-2026.md) |
| 2026-09-04 | o aviso de servidor secundário nasce DESLIGADO, e o administrador liga pela aba Sistema | [decisions-2026.md](decisions-2026.md) |
| 2026-09-04 | o porte de desempenho da `main` entra por lotes, e o despachante de diff manda no desenho | [decisions-2026.md](decisions-2026.md) |
| 2026-09-04 | o LOD de tiles servido passa a `null`, e o painel de administração valida o par | [decisions-2026.md](decisions-2026.md) |
| 2026-09-04 | o MapLibre 6.7.0 entra pelo npm num ponto único, e o vendorizado 5.18 sai | [decisions-2026.md](decisions-2026.md) |
| 2026-09-05 | o MapLibre se lê pelo ponto único, e a régua que prende isso é de escopo | [decisions-2026.md](decisions-2026.md) |
| 2026-09-05 | a caixa de seleção acompanha o quadro de zoom de verdade, com cache; o `zoomend` fica para o chefe | [decisions-2026.md](decisions-2026.md) |
| 2026-09-05 | o teste do índice de auditoria afirma o caminho por `target_id`, porque o Postgres 18 escolhe o composto por skip scan | [decisions-2026.md](decisions-2026.md) |
| 2026-09-05 | o menu da engrenagem acompanha a rolagem do próprio painel em vez de fechar | [decisions-2026.md](decisions-2026.md) |
| 2026-09-06 | o bitmap vencido se regenera na CARGA, e o carimbo dele é escrita local sem op | [decisions-2026.md](decisions-2026.md) |
| 2026-09-06 | a medida de coordenação deixa de guardar o próprio PNG em base64, e o marcador de ponto entra no hit-test exato | [decisions-2026.md](decisions-2026.md) |
| 2026-09-07 | os três diálogos de perda nomeiam o que apagam, e o import julga o arquivo antes de gastar uma vaga | [decisions-2026.md](decisions-2026.md) |
| 2026-09-07 | o esquema desta linha vai para 3.0, e o degrau decide o ramo pelo REGISTRO GLOBAL, nunca pelo número | [decisions-2026.md](decisions-2026.md) |
| 2026-09-07 | o marcador REMOTE órfão não expurga bancos sem sufixo que um slot local já reivindica | [decisions-2026.md](decisions-2026.md) |

As duas linhas de 2026-08-16 acima entraram em 2026-08-18: as entradas integrais existiam no arquivo
do ano e ninguém acrescentara a linha aqui, que é a metade do procedimento que falha calada (o índice
não erra, ele só encolhe). Quem escrever a próxima entrada confere a contagem dos dois lados.

E a conferência de 2026-08-23 achou QUATRO, não uma: duas de 2026-08-21 (revogação em cascata e o
eixo de OM na trilha) e as duas de 2026-08-22. O modo de falha se repete porque a linha do índice é
o passo separado, e o trabalho termina no arquivo do ano. As duas contagens batem, e a propriedade é essa, não o número: conferi-las é
`grep -c "^| 2026-"` contra `grep -c "^### 2026-"`. (Esta linha guardou um absoluto, "34 de cada lado",
que envelheceu na decisão seguinte.)
| 2026-09-07 | o tipo da imagem vem da EXTENSÃO no `.ebgeo`, e o alvo do slide 3D/360 é ID DE RECURSO, nunca UUID | [decisions-2026.md](decisions-2026.md) |
| 2026-09-07 | o BALDE decide o tipo da feição no envio, e um lote de imagens que cai não leva os seguintes | [decisions-2026.md](decisions-2026.md) |
| 2026-09-07 | o boot não apaga acervo sob erro, a adoção concorrente desempata pelo menor id, e o registro ganha espelho e persistência | [decisions-2026.md](decisions-2026.md) |
| 2026-09-07 | a Linha de Barreiras da 2.2 é ADOTADA pela Linha de Coordenação na leitura, e o balde velho é apagado | [decisions-2026.md](decisions-2026.md) |
| 2026-09-07 | o nome do mapa de um atlas local vem da CHAVE, e dois mapas no mesmo nome recusam o envio | [decisions-2026.md](decisions-2026.md) |
| 2026-09-07 | a frase do envio conta o atlas inteiro, e só o envio sem perda navega | [decisions-2026.md](decisions-2026.md) |
| 2026-09-07 | a falha do envio nomeia a ETAPA, e o slot herdado se identifica no diálogo | [decisions-2026.md](decisions-2026.md) |
| 2026-09-07 | o envio de um atlas local normaliza a coleção de feições na leitura | [decisions-2026.md](decisions-2026.md) |
| 2026-09-07 | o degrau 3.0 repara `data.name` a partir da chave nos mapas que vieram da outra linha | [decisions-2026.md](decisions-2026.md) |

- 2026-09-12: presença administrativa e correção da coleta de uso, [registro](decisions-2026.md).
- 2026-09-12: consolidação das migrações antes da primeira implantação, com recusa de histórico incompatível, [registro](decisions-2026.md).
- 2026-09-12: orcamento medido de arquivos com presenca e telemetria antecipada, [registro](decisions-2026.md).
- 2026-09-12: saída voluntária confirma e descarta pendências remotas, [registro](decisions-2026.md).
- 2026-09-12: diário remoto, recibos duráveis e conflitos explícitos, [registro](decisions-2026.md).
- 2026-09-12: descarte invalida escritores da sessão remota, [registro](decisions-2026.md).
- 2026-09-12: movimentação e restauração são intenções explícitas, [registro](decisions-2026.md).
- 2026-09-12: a camada padrão remota nasce no servidor, [registro](decisions-2026.md).
- 2026-09-12: protocolo obrigatório e conciliação de filas antigas por recibos, [registro](decisions-2026.md).
- 2026-09-12: intenção durável de briefing inclui os slides, [registro](decisions-2026.md).
- 2026-09-12: catálogo preserva mapa de destino e identidade textual no replay, [registro](decisions-2026.md).
- 2026-09-13: a baseline consolidada é editável até a implantação e congelada depois, [registro](decisions-2026.md).
- 2026-09-13: as quatro decisões de condução do lançamento (D2 a D5) e a pendente do reuso de imagem por conteúdo (D7), [registro](decisions-2026.md).
- 2026-09-13: create sobre túmulo continua ressuscitando, e a recusa de create é só de 3D e 360, [registro](decisions-2026.md).
- 2026-09-13: catálogo, 3D e 360 disputam o documento inteiro, e entidade de uma unidade não guarda fronteira, [registro](decisions-2026.md).
- 2026-09-13: o servidor publica os quatro marcadores estruturais como um só, até o cliente novo estar em campo, [registro](decisions-2026.md).
- 2026-09-13: sem Web Locks a barreira de logout degrada para o regime por aba, [registro](decisions-2026.md).
- 2026-09-13: a poda de gerações usa trava própria, e a lista de conhecidas é reescrita depois dela, [registro](decisions-2026.md).
- 2026-09-13: a rota única de imagem deduplica só por chave de tentativa, e conteúdo igual deixa de ser identidade, [registro](decisions-2026.md).
- 2026-09-13: as cópias abandonadas da atualização são podadas com uma reserva, e a origem legada só sai por decisão explícita, [registro](decisions-2026.md).
- 2026-09-14: o fecho de segurança dos vendors segue as oito recomendações da proposta, [registro](decisions-2026.md).
- 2026-09-14: recibos de sync são retidos pela versão mínima do atlas, e a expiração do JWT não derruba socket, [registro](decisions-2026.md).
- 2026-09-14: cem atlas vivos por conta, e um teto de mapas por importação, [registro](decisions-2026.md).
- 2026-09-14: a busca de usuários deixa de enumerar o efetivo, e o vídeo de prévia ganha gate, [registro](decisions-2026.md).
- 2026-09-14: o Cesium sai da pasta de vendors e entra pelo npm, e o viewshed continua pelo global, [registro](decisions-2026.md).
- 2026-09-15: o tutorial vira a QUINTA página do bundler, e o docsify entra pelo npm, [registro](decisions-2026.md).
- 2026-09-15: o viewshed 3D é reescrito como código da casa, e o desenho é congelado em pixel antes, [registro](decisions-2026.md).
- 2026-09-15: o empréstimo por atlas alcança o TILE, e a cláusula 6.7 fecha, [registro](decisions-2026.md).
- 2026-09-16: o cursor de presença ganha SUPERFÍCIE, e o apply remoto de documento lateral passa a tomar a trava, [registro](decisions-2026.md).
- 2026-09-17: o botão do meio gira e inclina o mapa, sem tecla nenhuma, [registro](decisions-2026.md).
- 2026-09-21: o que a versão anterior grava depois da transição entra sozinho, e a tela fica para o conflito, [registro](decisions-2026.md).
- 2026-09-22: o snap some para quem não desenha, e some também no mapa travado, [registro](decisions-2026.md).
- 2026-09-22: o menu do clique direito deixa de oferecer "Exportar QAN", para geometria nenhuma, [registro](decisions-2026.md).
- 2026-09-22: a caixa "Projeção globo" sai da Administração, e a chave de deploy é podada de ponta a ponta, [registro](decisions-2026.md).
- 2026-09-22: a vista da pessoa passa a ser LEMBRADA neste computador, por mapa, e continua sem viajar, [registro](decisions-2026.md).
- 2026-09-22: a presença sai quando a pessoa sai (lista do mapa e painel do administrador), e a lista diz em qual visualizador cada colega está, com o nome decidido por destinatário; o escopo 3D/360 do cursor e da seleção passa pelo mesmo recorte, [registro](decisions-2026.md).
- 2026-09-22: os endereços IP distintos entram no monitoramento, lidos do log que já os gravava, só para o administrador e com a retenção do log, [registro](decisions-2026.md).
- 2026-09-22: a porta "Acessos" abre em Concessões, concede-se pela aba Concessões com o mesmo modal do mapa (partido em núcleo sem store), e cada um vê só as concessões que fez; supera o item 6 da decisão do perfil produtor de 2026-08-24, [registro](decisions-2026.md).
- 2026-09-22: o boot recusa subir com diretório de dados sem escrita (sonda de escrita antes do listen, junto dos erros de ambiente), o log desligado em runtime deixa rastro no diagnóstico e vira defeito, e o `/health` não reprova por ele, [registro](decisions-2026.md).
- 2026-09-23: o navegador, o sistema e a máquina entram no Diagnóstico (por ocorrência, com o conjunto de navegadores de cada defeito) e no Uso (família, versão principal e sistema por sessão, com a taxa de erro por navegador), com um parser só e o vocabulário espelhado, [registro](decisions-2026.md).
- 2026-09-23: o boot dispara o pedido de armazenamento persistente e não o espera, porque no Firefox o prazo custava 2 s em toda carga e a concessão vale para a origem inteira, [registro](decisions-2026.md).
- 2026-09-23: a abertura de atlas de servidor que falha no boot não apaga fila, bytes nem slot local; a queda entra no slot local pela troca viva e o seletor só navega com o motivo, [registro](decisions-2026.md).
- 2026-09-23: o lote de uso de outra conta espera o dono em vez de ser apagado, e só o gesto Sair apaga os lotes de uma conta, [registro](decisions-2026.md).
- 2026-09-23: sessão num spec de navegador só por duas portas (credencial em memória, ou login em atlas.html), com censo que reprova a forma crua, [registro](decisions-2026.md).
- 2026-09-23: a base com que o mapa nasce e com que nasce todo mapa novo é escolha do administrador na aba Sistema (`map2d.defaultBasemap`, padrão `carta-topografica`), com borda de existência no servidor; mapa que já existe abre na base dele, [registro](decisions-2026.md).
- 2026-09-23: o Recuperado das alterações tardias abre direto, e o anterior sai só se ninguém trabalhou nele e nenhuma aba o tem aberto, [registro](decisions-2026.md).
- 2026-09-23: os dados solares e lunares do PITCIC entram num painel do menu de contexto (hora de Brasília, D a D+2, CSV), conferidos contra o USNO; a faixa na barra temporal, a caixa no PDF e o Dia D do mapa ficaram de fora por decisão do dono, [registro](decisions-2026.md).
- 2026-09-23: a previsão da matriz do PITCIC entra num painel próprio, separado da luminosidade, consultado pelo navegador direto na Open-Meteo (sem credencial nem Referer, ponto arredondado a 0,1°, modelo GFS fixo), com a bandeira ligada por padrão por decisão do dono, [registro](decisions-2026.md).
- 2026-09-23: a saída da Linha de Visada e do Viewshed é derivada por cada cliente e nunca viaja (o servidor recusava o id dela e o par nunca via a análise), [registro](decisions-2026.md).
- 2026-09-23: o fim involuntário da sessão resgata a fila de todo atlas de servidor com pendência, não só a do montado, [registro](decisions-2026.md).
- 2026-09-23: a janela da versão antiga aberta durante a virada é espera sem comando, não a tela que oferecia apagar os dados, [registro](decisions-2026.md).
- 2026-09-24: abrir a versão antiga depois de um rollback não cria um Recuperado falso, [registro](decisions-2026.md).
- 2026-09-23: cauda de pull acima de 500 ops ou 2 MiB vira retrato no HTTP e pedido de ressincronização no socket, [registro](decisions-2026.md).
- 2026-09-24: "Duplicar" mapa num atlas de servidor usa a rota de duplicação do servidor, [registro](decisions-2026.md).
- 2026-09-23: a importação de arquivo preserva o nome e as colunas reservadas e não inventa atributos de estilo, [registro](decisions-2026.md).
- 2026-09-23: polyfill local de `toReversed` para Chrome e Edge 105 a 109, e o navegador mínimo passa a ser Chrome/Edge 109 e Firefox ESR 115 (decisão do dono), [registro](decisions-2026.md).
- 2026-09-24: nenhum gesto deixa de chegar ao servidor por ter mais de 200 operações: todo lote acima do teto sobe em blocos de até 200 encadeados por `dependsOn`, e um bloco recusado segura os seguintes (decisão do dono, B6.1), [registro](decisions-2026.md).
- 2026-09-24: o UPDATE e o DELETE de feições distintas de excluir e estilizar em massa (e do desfazer e refazer deles) saem como operações independentes, sem lote, e um conflito custa só aquela feição; o lote encadeado fica para compostos e criação (decisão do dono, refina o B6.1), [registro](decisions-2026.md).
- 2026-09-24: as regras de agente ganham escopo por caminho (`paths:`) e o núcleo que carrega sempre tem teto de 60k caracteres; a história da correção vai para o livro-razão, [registro](decisions-2026.md).
- 2026-09-24: a camada ativa travada não recebe feição nova: a ferramenta recusa nomeando o estado e a store recusa no commit (decisão do dono), [registro](decisions-2026.md).
- 2026-09-24: o cabeçalho de modal é a faixa verde compacta (52px, título de 18px), também nos dois modais feitos à mão (decisão do dono), [registro](decisions-2026.md).
- 2026-09-24: tipografia e cor só dos tokens: controles herdam a fonte, três pesos (sem 500), escala sem 13px, uma monoespaçada, escalas de vermelho, âmbar e azul (decisão do dono), [registro](decisions-2026.md).
- 2026-09-24: os atributos personalizados de uma feição convergem por CHAVE (a mesma chave continua conflito), e a bolsa inteira do formato antigo continua aceita (decisão do dono), [registro](decisions-2026.md).
- 2026-09-24: cada commit roda `npm run test:tocados` (só o que o git diff pede); o `npm test` inteiro da raiz fica para contrato entre os pacotes, deploy e main (decisão do dono), [registro](decisions-2026.md).
- 2026-09-24: a presença tem controle de fluxo por destinatário, lido do pong do ping de protocolo e não do `bufferedAmount` (que fica em zero atrás de link lento): no máximo um quadro em voo, o resto coalescido, op de sync nunca retida (decisão do dono), [registro](decisions-2026.md).
- 2026-09-25: a foto anexa viaja como blob com referência, e a edição que a cita espera os bytes; a recusa de foto convertida prende a edição, a de foto anexada não, [registro](decisions-2026.md).
- 2026-09-25: os painéis laterais escondem a edição também pela trava; desenhar e recusar fica para o menu por mapa (decisão do dono), [registro](decisions-2026.md).
- 2026-09-24: a alça da partida da rota é um ANEL, e o miolo dele é do corpo da feição (decisão do dono), [registro](decisions-2026.md).
- 2026-09-25: a coleta de imagem órfã do servidor entra no lançamento: simulação por padrão, 30 dias contínuos sem citação, só o administrador do sistema marca ou apaga, e nada roda sozinho (decisão do dono de 2026-09-24 e 2026-09-25), [registro](decisions-2026.md).
- 2026-09-25: o atlas de servidor abre e sincroniza sem tempo real quando o WebSocket não passa: estado `HTTP_ONLY`, envio pelo mesmo HTTP, pull periódico por cursor, papel por `user_permission` no `GET /atlas/:atlasId`, e a volta ao tempo real sem recarregar (decisão do dono; os números esperam confirmação), [registro](decisions-2026.md).
- 2026-09-26: as vinte perguntas das pendências do lançamento: quinze viram trabalho antes do lançamento, o resto fica como está, e apagar imagem órfã vira cláusula 9.4 (decisão do dono), [registro](decisions-2026.md).
- 2026-09-26: as quatro decisões que a resolução da seção 4 abriu: o Descartar da foto recusada tira a foto da feição, o botão da cópia antiga volta no atlas.html, o clone segura o lock da origem e o deploy pode ser alterado para os sourcemaps (decisão do dono), [registro](decisions-2026.md).
