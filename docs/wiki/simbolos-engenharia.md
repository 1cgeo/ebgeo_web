# Símbolos de Engenharia

A ferramenta **Militar > Símbolos de Engenharia** insere feições Point baseadas nos 23 itens aprovados da tabela 6-4 do C 5-36. O ponto inicial usa **Ponte: símbolo abreviado**. Selecione a feição e abra **Configurar Símbolo** para escolher outro desenho, preencher seus dados e escolher a cor. O modal usa os mesmos componentes de Medidas de Coordenação, incluindo miniaturas, busca, campos, cor e botões Cancelar/Aplicar.

O painel oferece tamanho, opacidade, rotação, correção de zoom, zoom de referência e definição de padrão. Seleção, arraste, cópia, colagem, exclusão e histórico usam o fluxo das medidas de coordenação. A imagem é gerada localmente a partir dos atributos; outros navegadores a reconstroem ao receber o atlas.

## Escopo dos desenhos

- Não existem estradas ou ferrovias de contexto no desenho do mapa. Os elementos vermelhos pertencem exclusivamente à galeria de revisão.
- Itens 01, 04, 12, 24 e 25 estão excluídos.
- Limite de trecho contém uma marca por ponto. Inserir dois pontos para delimitar início e fim.
- Ponte completa, ponte abreviada e túnel não possuem contorno associado.
- Passagem de nível considera sempre linha aérea e permite informar sua altura.
- Cobertura e Coberta possuem apenas o campo Tipo de folhagem. Cada ponto representa vegetação para posicionar ao lado da estrada real.
- Rampas deriva as marcas da inclinação, sem escolha manual de faixa. A implementação resolve os limites impressos em intervalos contínuos: 5 a 7%, uma marca; acima de 7 até 10%, duas; acima de 10 até 14%, três; acima de 14%, quatro. Abaixo de 5% ou com valor desconhecido, nenhuma marca de faixa. A seta e o valor permanecem.
- Ponto crítico, as duas pontes, Área de estacionamento e Posto de controle de trânsito têm Preencher fundo, desativado inicialmente. O preenchimento branco fica dentro do contorno; traços, textos e quadrantes preservam a cor do símbolo.
- Números de ordem, classes e dimensões são dados editáveis. `?` significa desconhecido e vazio não vira zero. Largura total menor que a pista e gabarito máximo menor que o mínimo impedem Aplicar.

## Persistência e implementação

O tipo é `engineering_symbol` e a coleção é `engineering_symbols`. `pointCode` identifica o item da tabela; `engineering` contém `{ variant, values }`. Os demais atributos de aparência seguem Medidas de Coordenação. Dados de feição são enviados pelo sync existente, sem uma nova rota de escrita.

O controle compartilha o ciclo de vida de [Medidas de Coordenação](../../frontend/src/js/military_tools/coordination_measure_tool/add_coordination_measure_control.js) por meio de identificação de tipo, coleção, camada e despachante por instância. O [gerador](../../frontend/src/js/military_tools/engineering_symbol_tool/engineering_generator.js) mede e recorta o SVG, produz PNG com razão de pixels 4 e mantém a âncora do desenho por `iconOffset`. Tamanho e rotação são aplicados pela camada do mapa.

A migração [simbolos_engenharia](../../backend/src/database/migrations/013_simbolos_engenharia.sql) amplia o CHECK `valid_feature_type`, mantendo os tipos e dados existentes. Mapas antigos ganham a coleção vazia na leitura. Importação de atlas, snapshots, exportação KMZ, legenda PDF, seleção e lista de feições reconhecem o novo tipo.

A [galeria original de revisão](../propostas/engenharia-tab6-4/index.html) mantém os recortes do manual e o contexto em vermelho para comparação. Ela é um artefato de revisão separado da ferramenta.

## Recorte e cor da declinação magnética

O diagrama de declinação usa o mesmo contrato de bitmap recortado. O recorte mede os pixels com tinta, incluindo textos e pontas das setas, com margem de dois pixels lógicos. O deslocamento preserva a posição anterior do desenho; caixa de seleção e área clicável usam as dimensões recortadas. Diagramas existentes são reconstruídos na abertura; os que não têm dados suficientes preservam a imagem antiga.

A cor escolhida no painel é salva junto aos dados e reconstruída nos demais clientes. Sem cor definida, permanece o azul original. Uma prévia de cor pendente também vale para regenerações automáticas, para que um retorno do servidor não a substitua pela cor salva antes de Salvar ou Descartar.
