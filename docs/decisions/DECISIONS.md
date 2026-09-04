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

As duas linhas de 2026-08-16 acima entraram em 2026-08-18: as entradas integrais existiam no arquivo
do ano e ninguém acrescentara a linha aqui, que é a metade do procedimento que falha calada (o índice
não erra, ele só encolhe). Quem escrever a próxima entrada confere a contagem dos dois lados.

E a conferência de 2026-08-23 achou QUATRO, não uma: duas de 2026-08-21 (revogação em cascata e o
eixo de OM na trilha) e as duas de 2026-08-22. O modo de falha se repete porque a linha do índice é
o passo separado, e o trabalho termina no arquivo do ano. As duas contagens batem, e a propriedade é essa, não o número: conferi-las é
`grep -c "^| 2026-"` contra `grep -c "^### 2026-"`. (Esta linha guardou um absoluto, "34 de cada lado",
que envelheceu na decisão seguinte.)
