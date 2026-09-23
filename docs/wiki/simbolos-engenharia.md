# Símbolos de Engenharia

A ferramenta **Militar > Símbolos de Engenharia** insere feições Point baseadas nos 23 itens aprovados da tabela 6-4 do C 5-36. O ponto inicial usa **Ponte: símbolo abreviado**. Selecione a feição e abra **Configurar Símbolo** para escolher outro desenho, preencher seus dados e escolher a cor. O modal usa os mesmos componentes de Medidas de Coordenação, incluindo miniaturas, busca, campos, cor e botões Cancelar/Aplicar.

O painel oferece tamanho, opacidade, rotação, correção de zoom, zoom de referência e definição de padrão. Seleção, arraste, cópia, colagem, exclusão e histórico usam o fluxo das medidas de coordenação. A imagem é gerada localmente a partir dos atributos; outros navegadores a reconstroem ao receber o atlas.

## Escopo dos desenhos

- Não existem estradas ou ferrovias de contexto no desenho do mapa. A estrada e a ferrovia que aparecem nos recortes do manual são contexto da ilustração e ficaram fora de todo desenho.
- Itens 01 (designação da estrada), 04 (fórmula de classificação), 12 (contorno impossível), 24 (estrada transversal ou de rocada) e 25 (estrada penetrante) saíram a pedido do dono em 2026-09-22, dentro da decisão de que todo item é ponto. A análise do manual classificava 01, 24 e 25 como linha e 04 como anotação montada de campos; no 12, a célula da tabela traz um desenho com a estrutura de dados do vau, o que sugere troca de desenhos na própria tabela. Não os reintroduza para "completar" os 28.
- Limite de trecho contém uma marca por ponto. Inserir dois pontos para delimitar início e fim.
- Ponte completa, ponte abreviada e túnel não possuem contorno associado.
- Passagem de nível considera sempre linha aérea e permite informar sua altura.
- Cobertura e Coberta possuem apenas o campo Tipo de folhagem. Cada ponto representa vegetação para posicionar ao lado da estrada real.
- Rampas deriva as marcas da inclinação, sem escolha manual de faixa. A implementação resolve os limites impressos em intervalos contínuos: 5 a 7%, uma marca; acima de 7 até 10%, duas; acima de 10 até 14%, três; acima de 14%, quatro. Abaixo de 5% ou com valor desconhecido, nenhuma marca de faixa. A seta e o valor permanecem.
- Ponto crítico, as duas pontes, Área de estacionamento e Posto de controle de trânsito têm Preencher fundo, desativado inicialmente. O preenchimento branco fica dentro do contorno; traços, textos e quadrantes preservam a cor do símbolo.
- Números de ordem, classes e dimensões são dados editáveis. `?` significa desconhecido e vazio não vira zero. Largura total menor que a pista e gabarito máximo menor que o mínimo impedem Aplicar.

## Fonte e leitura do manual

A fonte é o C 5-36, O Reconhecimento de Engenharia, 2ª edição (1997), tabela 6-4, nas páginas impressas 6-13 a 6-19, que são as páginas 47 a 53 do PDF digitalizado. O catálogo do código não guarda a página de cada item, então conferir um desenho contra o original volta a essa faixa.

A continuação do item 13 (vau), na página 50 do PDF, traz um desenho com forma de balsa. O vau segue a fórmula e as observações da página 49, e aquele desenho não virou variante: quem reler o manual não deve "corrigir" o vau por ele.

## Persistência e implementação

O tipo é `engineering_symbol` e a coleção é `engineering_symbols`. `pointCode` identifica o item da tabela; `engineering` contém `{ variant, values }`. Os demais atributos de aparência seguem Medidas de Coordenação. Dados de feição são enviados pelo sync existente, sem uma nova rota de escrita.

O controle compartilha o ciclo de vida de [Medidas de Coordenação](../../frontend/src/js/military_tools/coordination_measure_tool/add_coordination_measure_control.js) por meio de identificação de tipo, coleção, camada e despachante por instância. O [gerador](../../frontend/src/js/military_tools/engineering_symbol_tool/engineering_generator.js) mede e recorta o SVG, produz PNG com razão de pixels 4 e mantém a âncora do desenho por `iconOffset`. Tamanho e rotação são aplicados pela camada do mapa.

A migração [simbolos_engenharia](../../backend/src/database/migrations/013_simbolos_engenharia.sql) amplia o CHECK `valid_feature_type`, mantendo os tipos e dados existentes. Mapas antigos ganham a coleção vazia na leitura. Importação de atlas, snapshots, exportação KMZ, legenda PDF, seleção e lista de feições reconhecem o novo tipo.

## Recorte e cor da declinação magnética

O diagrama de declinação usa o mesmo contrato de bitmap recortado. O recorte mede os pixels com tinta, incluindo textos e pontas das setas, com margem de dois pixels lógicos. O deslocamento preserva a posição anterior do desenho; caixa de seleção e área clicável usam as dimensões recortadas. Diagramas existentes são reconstruídos na abertura; os que não têm dados suficientes preservam a imagem antiga.

A cor escolhida no painel é salva junto aos dados e reconstruída nos demais clientes. Sem cor definida, permanece o azul original. Uma prévia de cor pendente também vale para regenerações automáticas, para que um retorno do servidor não a substitua pela cor salva antes de Salvar ou Descartar.

## Histórico

- 2026-09-23: com a ferramenta homologada pelo dono, saíram do repositório a análise do manual inteiro (os 18 capítulos e a simbologia fora da tabela 6-4, como os solos da tabela 6-6, as classes CT I a IV e as convenções das figuras 7-40 e 10-7A), a proposta, o inventário de campos e a galeria de revisão com os 28 recortes originais e os 34 SVG de estudo. Já contradiziam o código em três pontos (faixa de rampa escolhida à mão, identificador com prefixo do manual, integração "ainda proposta"), e continuam recuperáveis no commit e753a0ae, na pasta docs/propostas/engenharia-tab6-4 e no arquivo docs/analise-c5-36-simbolos-engenharia.md.
