# Proposta : Símbolos de Engenharia no EBGeo

**Estado:** ferramenta implementada no EBGeo. Esta galeria documenta a revisão visual original; estradas e demais elementos vermelhos são apenas contexto e não entram nos símbolos do mapa. O comportamento atual está em [Símbolos de Engenharia](../../wiki/simbolos-engenharia.md).

22/09/2026 · Escopo definido pelo usuário: somente a tabela 6-4 do C 5-36, com **todos os símbolos como pontos**.

## Decisão de produto

Criar a ferramenta **Símbolos de Engenharia** na barra militar, com o mesmo fluxo de Medidas de Coordenação: escolher um símbolo, preencher seus campos, visualizar, aplicar e posicionar no mapa. A tabela contém 28 itens; o escopo selecionado agora contém **23 itens**, após a retirada de 01, 04, 12, 24 e 25. A numeração original é preservada. São as páginas impressas 6-13 a 6-19, páginas 47 a 53 do PDF fornecido, edição de 1997.

Cada objeto tem uma única coordenada geográfica. Vegetação, setas, limites e fórmulas compõem o desenho SVG do marcador; estradas de contexto ficam fora. O comprimento visual desses componentes não representa extensão medida no terreno. No item 5, isso adapta expressamente a observação da tabela sobre representar a extensão da rampa à escala: a ferramenta usa tamanho gráfico, conforme a decisão de trabalhar só com pontos.

Esta proposta substitui a divisão entre pontos, linhas e áreas sugerida na análise inicial. Não inclui simbologia de solos, outros capítulos ou outros manuais.

**Artefato de revisão:** proposta e galeria de estudos SVG, com valores ilustrativos copiados/adaptados dos exemplos da tabela. A ferramenta instalada no mapa usa o catálogo aprovado sem contexto. Contorno impossível (12) foi retirado do catálogo.

**Revisão de atributos:** a galeria agora distingue parte fixa, valores preenchíveis e variantes em cada um dos 23 itens selecionados. Os formulários atualizam a prévia e permitem baixar o SVG preenchido. A análise completa está em [Informações fixas e variáveis por símbolo](campos-variaveis.md). O número do ponto crítico é uma referência editável; a letra T do posto de controle é fixa. Esses formulários continuam sendo um protótipo separado do EBGeo, sem persistência no backend.

O contorno associado foi retirado das pontes completa e abreviada e do túnel. O item 03 representa um único limite: o usuário o insere duas vezes para delimitar um trecho.

## Experiência de uso

1. Abrir **Símbolos de Engenharia**. O seletor apresenta miniatura, número da tabela e nome; busca por nome/número e filtros por família.
2. Escolher o item e sua variante, quando houver. O painel mostra somente os campos daquele símbolo, com unidades explícitas.
3. Conferir uma prévia com textos e sinalização de dado desconhecido. Aplicar e clicar no mapa. Em desenhos com chamada, a ponta da seta coincide com o clique.
4. Selecionar o marcador para editar dados, mover, girar, redimensionar, alterar opacidade, duplicar ou excluir, seguindo o comportamento de Medidas de Coordenação.
5. Alterações de formulário só passam ao objeto ao aplicar. Cancelar preserva o estado anterior; aplicar corresponde a uma ação de desfazer/refazer.

Organização sugerida, sem criar novos símbolos: **Itinerários** (2–3, 5–7, 15–17, 19), **Travessias e contornos** (8–11, 13–14, 18), **Vegetação e deslocamento** (20–22), **Obstáculos e apoio** (23, 26–28). Ponte completa e abreviada continuam dois itens distintos; cobertura e coberta também.

Controles comuns: nome, descrição, tamanho, rotação, opacidade, visibilidade e bloqueio. Cor preta por padrão; uma eventual cor alternativa é uma preferência gráfica do EBGeo, sem significado doutrinário novo. Reutilizar a correção de tamanho por zoom das Medidas de Coordenação. Não reutilizar seus estados de linha: no item 23, **planejado é tracejado e preparado é contínuo**.

## Construção SVG dos 23 itens selecionados

Os valores abaixo exemplificam o preenchimento; não são dados reais. “Âncora” significa o ponto do desenho que coincide com a coordenada do objeto. A galeria permite visualizar variantes, girar o desenho e exibir a âncora proposta.

| Nº | Item e página PDF | Como construir o SVG | Campos e variantes | Âncora proposta |
|---|---|---|---|---|
| 2 | Ponto crítico · 47 | Triângulo de cantos suavizados, número central e pequena haste inferior. | Número de referência e descrição da restrição. | Extremidade inferior da haste. |
| 3 | Limite de trecho · 47 | Duas curvas de contexto em vermelho e uma única marca preta. | Sem campos internos; inserir um ponto em cada extremidade do trecho. | Ponta da marca junto à rodovia. |
| 5 | Rampas · 48 | Haste com seta no sentido de subida; repetir as marcas conforme a inclinação; valor à direita. | Inclinação em %, com faixa calculada automaticamente na ferramenta. | Base da seta. |
| 6 | Curva fechada · 48 | Triângulo equilátero vazio apontando para a curva, com duas curvas de contexto e texto numérico. | Raio em metros ou ?. | Vértice que aponta para a curva. |
| 7 | Sequência de curvas fechadas · 48 | Dois triângulos equiláteros concêntricos, com a mesma orientação, e vinheta de curva. | Número de curvas / menor raio, em metros. | Vértice externo voltado à curva. |
| 8 | Símbolo completo de pontes · 48 | Círculo dividido; roda, lagarta e setas de fluxo no setor superior; número no inferior; textos externos e chamada. | Quatro classes: rodas/lagartas × um/dois sentidos; ordem, gabarito, comprimento e largura mínima; Fv opcional; sublinhado explícito de valores inferiores ao padrão. | Ponta da seta de chamada. |
| 9 | Símbolo abreviado para ponte · 48 | Círculo dividido horizontalmente, classe acima, ordem abaixo e chamada. | Classe e número de ordem. | Ponta da chamada. |
| 10 | Contorno de fácil utilização · 49 | Duas setas paralelas ligadas por retorno; segunda figura com quebra no retorno. | Duas formas gráficas reproduzidas na tabela. A legenda não dá um significado distinto para cada uma. | Centro do conjunto. |
| 11 | Contorno de difícil utilização · 49 | Retorno com setas e interrupção/marcas transversais na ligação. | Descrição complementar. | Centro do conjunto. |
| 13 | Vau · 49–50 | Chamada horizontal tracejada, fórmula acima/abaixo e quebra no lado de acesso difícil, quando indicada. | Ordem; V/P; correnteza em m/s; X/Y para variação; comprimento/largura/profundidade em m; material M/C/S/G/R/P; acesso difícil por margem. | Ponta da chamada. |
| 14 | Balsa · 50 | Casco trapezoidal, divisor vertical, eixo com chamada e textos internos/externos; quebra para acesso difícil. | Ordem, V/P, classe, peso próprio da balsa em toneladas, tempo médio em minutos e lado do acesso difícil. | Ponta da chamada. |
| 15 | Redução de largura · 50 | Duas linhas de estrada com triângulos convergentes preenchidos com pontilhado vetorial. | Largura disponível à esquerda e extensão à direita, em metros. | Centro do estreitamento. |
| 16 | Passagem sob arco com restrição · 50 | Arco semicircular sobre duas linhas paralelas; textos à esquerda/direita. | Largura e gabaritos mínimo/máximo, em metros. | Centro da passagem. |
| 17 | Passagem sob estrutura retangular com restrição · 51 | Portal retangular com segmentos de apoio/muretas e estrada de contexto. | Largura de pista / largura total à esquerda, gabarito à direita, em metros. | Centro da passagem. |
| 18 | Túnel · 51 | Abóbada com base, pequenos apoios internos, número, chamada e textos externos. | Ordem, gabarito, comprimento, largura de pista/total; aceitar ? nos campos; sem contorno associado. | Ponta da chamada. |
| 19 | Passagem de nível · 51 | Estrada e ferrovia em vermelho; sinal de restrição e altura do fio em preto. Sempre com linha aérea neste catálogo. | Altura do fio sobre o solo (m); sem checkbox de existência. | Cruzamento dos eixos. |
| 20 | Cobertura · 51 | Fileira única de círculos ou ângulos, sem rodovia. | Um tipo de folhagem por ponto: temporária ou permanente. Inserir pontos independentes junto à estrada real. | Centro da fileira. |
| 21 | Coberta · 52 | Grupo de círculos ou ângulos formando bosque, sem rodovia. | Um tipo de folhagem por ponto: temporária ou permanente. Inserir pontos independentes junto à estrada real. | Centro do grupo. |
| 22 | Possibilidade de deslocamento fora da estrada · 52 | Saída da estrada com seta; ou ramo com roda/círculo e ângulos; ou ramo com lagarta/retângulo e círculos. | Três variantes da tabela: possível; rodas sob folhas permanentes; lagartas sob folhas temporárias. O primeiro desenho não significa especificamente “a pé”. | Junção do ramo com a estrada. |
| 23 | Obstáculos · 52 | Duas diagonais tracejadas; duas contínuas; ou dois pares cruzados. | Planejado, preparado, realizado. Estado controla o traço, sem acrescentar novos significados. | Centro do símbolo, conforme a tabela. |
| 26 | Dado desconhecido ou duvidoso · 53 | Texto “?” centralizado, com métricas de fonte controladas. | Símbolo autônomo; também convenção aceita nos campos pertinentes dos demais itens. | Centro visual. |
| 27 | Área de estacionamento · 53 | Círculo dividido em quatro setores, com setores opostos preenchidos. | Nome/descrição; desenho fixo. | Centro do círculo. |
| 28 | Posto de controle de trânsito · 53 | Círculo com T central. | Nome/descrição; desenho fixo. | Centro do círculo. |

## Separação entre contexto e símbolo

Retirados a pedido do usuário: **01 : designação da estrada; 04 : fórmula de classificação; 12 : contorno impossível; 24 : estrada transversal/rocada; 25 : estrada penetrante**. A ferramenta proposta e a galeria passam a usar os 23 registros restantes.

A cor é uma anotação para revisar a composição do SVG, não uma convenção doutrinária. Os recortes originais do manual ficam intactos. O SVG exibido e baixado usa preto para o símbolo e seus dados e vermelho para o contexto. A âncora opcional fica azul e não integra o download.

| Itens | Contexto vermelho | Símbolo preto |
|---|---|---|
| 03 | Duas linhas da rodovia | Uma marca de limite por ponto |
| 06–07 | Rodovia em curva | Triângulo(s), quantidade e raio |
| 15 | Rodovia | Triângulos de estreitamento, largura e extensão |
| 16–17 | Rodovia | Arco/portal, apoios e dimensões |
| 19 | Estrada e ferrovia, incluindo dormentes | Sinal de restrição e altura da rede aérea, sempre considerada nesta ferramenta |
| 20–21 | Rodovia identificada como contexto no original e retirada do SVG | Uma fileira (cobertura) ou um grupo (coberta), com um tipo de folhagem por ponto |
| 22 | Rodovia de origem | Saída, seta, roda/lagarta e folhagem da modalidade escolhida |
| 02, 05, 08–11, 13–14, 18, 23, 26–28 | Nenhum contexto identificado no desenho | Glifo completo, chamadas e dados |

Nos itens 20–21, a composição inicial com vegetação à esquerda e à direita foi substituída por um único conjunto de vegetação por ponto. Não há controle de lado no formulário. Para representar os dois lados de uma estrada, inserir dois pontos junto à rodovia real, com posição e tipo de folhagem independentes.

O item 19 considera sempre linha aérea; o checkbox de existência foi removido e somente a altura do fio é editável. Chamadas de ponte, vau, balsa e túnel continuam pretas: fazem parte da indicação do símbolo, não são rodovias de apoio.

## Questões que a própria tabela deixa abertas

- **Continuação do item 13:** na página 50 aparece uma figura com aspecto de balsa. Usar, para o vau, a fórmula e as observações explícitas da página 49. Não transformar a imagem ambígua em variante nova.
- **Item 5:** as faixas impressas se encontram em 7% e deixam outras fronteiras pouco claras. Preservar a seleção explícita dos quatro desenhos; não inferir uma classificação operacional a partir de um limiar inventado.
- **Item 10:** as duas formas gráficas não recebem legendas separadas. Identificá-las como formas 1 e 2 na revisão, sem inventar classes novas de contorno.

## Como produzir os SVGs definitivos

Construir um catálogo declarativo com número da tabela, título, campos, variantes, página de origem e estado de revisão. Cada entrada aponta para uma função geradora de SVG. Compartilhar primitivas para textos, setas, estrada de contexto, vegetação, círculo dividido, chamada, retorno, pontilhado e sublinhado.

O SVG deve ser **vetorial e independente de imagens externas**: paths, círculos, linhas, polígonos e textos. Escapar todos os valores textuais; não aceitar SVG arbitrário digitado pelo usuário. Prefixar identificadores de patterns/markers por instância para evitar colisões em miniaturas. Para exportação independente, controlar a fonte e, quando necessário, converter o texto em contornos no artefato exportado.

Medir os textos efetivamente renderizados antes de definir o viewBox final. Aplicar margem para traço, sublinhado e seta; nunca cortar uma classe de três dígitos, uma fórmula longa ou “?”. O viewBox pode variar por família: forçar todas as fórmulas e pontes em um quadrado produz letras pequenas demais.

Cada gerador retorna o SVG, dimensões e âncora em coordenadas do próprio desenho. Na visualização do mapa, converter em bitmap na densidade adotada por Medidas de Coordenação e aplicar o deslocamento de âncora já suportado pelo renderizador. **Rotação, deslocamento da imagem, hit-test e caixa de seleção precisam concordar sobre a mesma âncora**, especialmente em pontes, vau, balsa e túnel. A prévia da galeria gira em torno da âncora para tornar essa decisão verificável.

Nesta revisão, manter o símbolo em preto, o contexto em vermelho e as áreas vazadas transparentes, exceto regiões brancas que sejam necessárias para legibilidade. Um halo de contraste opcional deve ser tratado como recurso gráfico, não parte do símbolo do manual. A galeria usa fundo branco e um fundo de contraste; a homologação deve incluir mapa claro e imagem de satélite.

Dados desconhecidos exigem estados distintos: valor conhecido, desconhecido, duvidoso e não informado. Não converter campo vazio ou “?” em zero. Guardar números canônicos e aplicar vírgula decimal na apresentação; fórmulas transcritas literalmente devem conservar a string original.

## Integração proposta com o EBGeo

Nome técnico proposto para o tipo: engineering_symbol. Coleção proposta: engineering_symbols. Identificadores estáveis de catálogo seguem o número original: C536_6_4_02, por exemplo. Os números 01, 04, 12, 24 e 25 estão excluídos, sem renumerar os demais. São nomes de projeto, ainda não implementados.

Objeto persistido: geometria GeoJSON Point; identidade do item; versão do catálogo e dos atributos; variante; dados específicos; nome/descrição; tamanho, rotação, opacidade e controles comuns. A imagem é derivada desses dados. Não gravar campos de fórmula apenas como pixels nem depender de uma imagem gerada em uma única máquina.

Usar Medidas de Coordenação como referência de comportamento, com controlador baseado em BaseControl, geometria de ponto, gerador, catálogo, modal de configuração e painel de atributos próprios. Aproveitar o ciclo de geração/cancelamento de imagens, cache, versionamento, correção por zoom e transações do store existentes. Uma geração antiga não pode sobrescrever uma edição mais recente; exclusão durante geração deve ser segura.

Pontos conferidos no código que precisam entrar na implementação:

| Camada | Trabalho necessário |
|---|---|
| Ferramenta e UI | Registrar ferramenta na barra militar, carregamento do controlador, seletor com miniaturas e formulário contextual. Sem reutilizar o atalho K já ocupado. |
| Tipo de feição | Incluir o tipo no registro central, coleção/repositório, rótulos e capacidades de seleção, cópia e recurso de imagem. |
| Mapa | Criar fonte/camada de símbolos com identificação da imagem, tamanho, rotação e deslocamento de âncora; incluir seleção e hit-test. |
| Imagens | Incluir o tipo na geração e regeneração de bitmaps versionados, inclusive após carregamento e atualizações remotas. |
| Persistência local | Respeitar as transações e o diário de operações existentes; preservar os atributos ao salvar, reabrir, desfazer e duplicar. |
| API e sincronização | O backend valida uma lista fechada de tipos; adicionar o tipo em atlas.schemas.js e nos agrupamentos de snapshot em sync.service.js. Reutilizar as operações genéricas, sem criar uma API paralela só para símbolos. |
| Banco | A tabela features tem um CHECK para tipos válidos. Ampliá-lo em nova migração incremental, mantendo os tipos atuais. Baselines estão congeladas: não editar 003_atlas.sql. Seguir a exceção específica de higiene para troca de constraint descrita em backend/CLAUDE.md; não resetar o banco. |
| Entrada e saída | Revisar normalização de importação, migração de atlas local para servidor, exportação/importação nativa e tratamento de símbolos em KMZ e PDF/legenda. Não presumir suporte automático só porque o tipo é Point. |

Referências de implementação existentes: [ferramenta de coordenação](../../../frontend/src/js/military_tools/coordination_measure_tool/), [schema do atlas](../../../backend/src/modules/atlas/atlas.schemas.js), [sincronização](../../../backend/src/modules/sync/sync.service.js), [regras do backend](../../../backend/CLAUDE.md). Os caminhos são referências ao que existe, não arquivos novos prometidos.

## Sequência recomendada e critérios de aceite

1. **Revisar os vetores:** comparar os 23 registros selecionados com as sete páginas, incluindo todas as variantes; fixar âncoras, espessuras e fonte. A galeria entregue é o material dessa revisão.
2. **Implementar o caminho completo:** ferramenta, catálogo, imagem e integração local/servidor. Começar com um símbolo simples, uma ponte e um obstáculo para verificar as três dificuldades principais: ponto simples, chamada com campos e variante de traço. Depois completar o catálogo já aprovado.
3. **Homologar comportamento:** inserir, editar/cancelar, mover, girar, redimensionar, desfazer/refazer, duplicar e excluir; salvar e reabrir em atlas local e de servidor; receber a mesma feição em segundo navegador; importar/exportar sem perda de identidade e atributos.
4. **Homologar renderização:** Playwright com app e backend reais, captura e inspeção visual. Conferir âncora com rotação 0/90/180°, zoom, campos longos, acentos, ?, sublinhados, mapas claros e satélite; variantes de 5, 10, 20–23. A passagem do ponto do mapa pela ponta da chamada é um critério objetivo.

Não considerar pronto apenas porque o ícone aparece no mapa: criação seguida de snapshot, reabertura e edição por outro cliente precisa preservar o mesmo desenho.

## Revisão visual de túnel, vau e balsa

O túnel foi comparado com uma ampliação do original e recebeu abóbada mais baixa, muretas ligadas às paredes laterais e chamada contínua sob o desenho. No vau, o zigue-zague passou a ter três picos e quatro vales, incluindo as transições nas pontas; na balsa, três picos e três vales compactos. Os dois padrões representam acesso difícil, não um valor numérico; o campo continua sendo o lado do acesso. Contorno impossível foi excluído, sem aviso ou cartão pendente no catálogo.

## Ambiente local para a revisão

Revisão visual posterior: limite de trecho recebeu uma única marca curta encostada na rodovia, com inserções independentes para início e fim; a passagem sob estrutura retangular recebeu bases e muretas voltadas para o vão; a ponte completa recebeu espaçamento entre classes, pictogramas e setas de fluxo. As figuras foram comparadas com ampliações dos recortes originais. Os triângulos dos itens 06 e 07 foram construídos como equiláteros, com centro e orientação comuns no item 07. Verificações no navegador confirmaram a igualdade dos lados, a concentricidade e ausência de sobreposição entre classes e setas na ponte, além da preservação dos campos editáveis.

Frontend: http://localhost:3000. Backend: http://localhost:8080, com acesso pelo proxy /api do frontend. Banco local já configurado: ebgeo_zero, PostgreSQL na porta 5432. O backend foi iniciado usando a configuração existente, sem seed, reset ou alteração do banco para esta proposta.

A galeria index.html desta pasta é um estudo separado da aplicação. Os arquivos em svg/ são editáveis e podem ser usados como ponto de partida para o gerador definitivo; contêm valores de exemplo, não o formulário dinâmico da ferramenta.

Os formulários da galeria são definidos em campos.js e renderizados por editor.js. Nome e descrição são metadados, sem substituição automática de letras ou números do glifo. As entradas numéricas admitem dado desconhecido e distinguem vazio de zero. O rascunho permanece durante buscas e é descartado ao recarregar a página; o download gera um SVG com os valores atuais. Verificações adicionais cobriram mudança do número do ponto crítico, independência dos campos da ponte, fórmula de vau, estados de obstáculos, gabaritos, entrada de texto literal e funcionamento em tela estreita.

Galeria local: http://127.0.0.1:3080. Entrega: 34 SVGs de exemplo para os 23 itens selecionados. O catálogo totaliza 23 registros selecionados. Cobertura e coberta têm duas variantes de folhagem cada, sem rodovia; cada ponto é posicionado independentemente junto à estrada real.

Verificação realizada: endpoint de saúde pelo proxy respondeu OK; login de desenvolvimento, listagem de atlas e abertura do Atlas de Exemplo do servidor funcionaram no navegador, com mapa visível. Na galeria, foram conferidos os 23 cartões ativos, os 34 arquivos SVG, ausência de corte dos textos nos exemplos, busca, seleção de variante, rotação e indicação de âncora. Capturas Playwright foram inspecionadas visualmente. Isso valida a entrega de revisão e o ambiente; a integração da nova ferramenta continua proposta, e os traços definitivos ainda precisam da revisão indicada acima.
