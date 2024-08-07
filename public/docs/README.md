# Tutorial

Esta página tem como objetivo explicar as funcionalidades do EBGEO, bem como oferecer diretrizes para a sua utilização.

## SIG

Nessa aba é possível visualizar um mapa digital e realizar algumas análises com as ferramentas disponibilizadas. As imagens, terrenos e vetores foram gerados pela DSG. É possível ainda visualizar algumas vias com imagens 360º.

### Controles para Navegação

É possível navegar pelos mapa da seguinte forma (nenhuma ferramenta selecionada):

- Botão esquerdo do mouse: ao pressionar e arrastar é possível mover o mapa.
- Botão direito do mouse: ao pressionar e arrastar é possível mudar a perspectiva e rotacionar o mapa.
- Botão do meio do mouse: ao rolar o botão do meio do mouse, é possível mudar o zoom do mapa.

<!-- 
- Ctrl+C: Copiar os itens selecionados. É possível selecionar [Feições](#criar-feição), [Textos](#adicionar-texto) e [Imagens](#adicionar-imagem).
- Ctrl+V: Colar as itens copiados.  
-->
- Ctrl+Botão esquerdo do mouse: ao pressionar e arrastar segurando Ctrl é possível rotacionar o mapa.
- Ctrl+Z: Desfazer.
- Ctrl+Y: Refazer.

### Ferramentas

As ferramentas não estão disponíveis na versão para celular.

#### Alterar camada base

- Carta: visualização estilo carta topográfica
- Ortoimagem: visualização estilo carta ortoimagem

---

#### Exportar dados

<img src="../images/icon_save_black.svg" alt="Icone Salvar" width="70"/>

Salva os mapas carregados e feições em um arquivo.

---

#### Importar dados

<img src="../images/icon_load_black.svg" alt="Icone Carregar" width="70"/>

Carrega os mapas e feições salvas a partir de um arquivo gerado por "Exportar dados".

---

#### Gerenciador de mapas

<img src="../images/exemplo_gerenciador_mapas.png" alt="Gerenciador de Mapas" width="280"/>

Permite Criar, alterar, copiar ou excluir mapas.

Nesse contexto, os mapas são conjunto de feições criadas pelo usuário e o tipo (Carta ou Ortoimagem) associados àquele mapa.

---

##### Criar novo mapa

<img src="../images/icon_add.svg" alt="Icone Carregar" width="70"/>

Adiciona novo mapa ao gerenciador. Ao clicar será perguntado o nome do novo mapa.

---

##### Alternar mapa

Ao clicar no nome do mapa, será alterado o mapa, incluindo o tipo (Carta ou Ortoimagem) e feições carregadas.

---

##### Copiar mapa

Opção disponível ao clicar nos 3 pontos verticais ao lado do nome do mapa.

Copia o mapa selecionado.

---

##### Excluir mapa

Opção disponível ao clicar nos 3 pontos verticais ao lado do nome do mapa.

Exclui o mapa selecionado.

---

#### Inspecionar feição do mapa base

<img src="../images/icon_info_black.svg" alt="Icone Inspecionar" width="70"/>

Com a ferramenta ativada, é possível clicar numa feição do mapa base para ver os atributos da feição.

---

#### Manipular feições

##### Linha

<img src="../images/icon_line_black.svg" alt="Icone Linha" width="70"/>

Com a ferramenta selecionada é possível adquirir uma linha no mapa clicando com o botão esquerdo do _mouse_. É possível finalizar a edição ao clicando no último vértice adquirido. 

Ao finalizar a edição ou ao clicar novamente na feição, a feição é selecionada (indicado por uma linha vermelha pontilhada ao redor da linha). E é possível alterar as seguintes propriedades:

- Tamanho
- Cor
- Opacidade
- Medir: mostra o tamanho da linha como um texto flutuante na linha
- Perfil do terreno: mostra um gráfico com o perfil do terreno da linha selecionada
- Salvar: salva as alterações
- Descartar: descarta as alterações
- Definir padrão: define o estilo padrão para as próximas linhas adquiridas
- Deletar: exclui as feições selecionadas

---

##### Polígono

<img src="../images/icon_polygon_black.svg" alt="Icone Polígono" width="70"/>

Com a ferramenta selecionada é possível adquirir um polígono no mapa clicando com o botão esquerdo do _mouse_. É possível finalizar a edição ao clicando no último vértice adquirido. 

Ao finalizar a edição ou ao clicar novamente na feição, a feição é selecionada (indicado por uma linha vermelha pontilhada ao redor do polígono). E é possível alterar as seguintes propriedades:

- Cor
- Opacidade
- Cor da borda
- Largura da borda
- Medir: mostra a área do polígono como um texto flutuante no polígono
- Salvar: salva as alterações
- Descartar: descarta as alterações
- Definir padrão: define o estilo padrão para os próximos polígonos adquiridas
- Deletar: exclui as feições selecionadas

---

##### Ponto

<img src="../images/icon_point_black.svg" alt="Icone Ponto" width="70"/>

Com a ferramenta selecionada é possível adquirir um ponto no mapa clicando com o botão esquerdo do _mouse_.

Ao adquirir o ponto ou ao clicar novamente na feição, a feição é selecionada (indicado por uma linha vermelha pontilhada ao redor do ponto). E é possível alterar as seguintes propriedades:

- Tamanho
- Cor
- Opacidade
- Salvar: salva as alterações
- Descartar: descarta as alterações
- Definir padrão: define o estilo padrão para os próximos pontos adquiridas
- Deletar: exclui as feições selecionadas

---

``Para selecionar uma feição basta clicar nela``

> Obs.:  É possível selecionar e alterar mais de uma feição segurando o Shift.

``Para editar uma feição, inclusive adicionar vértices, clique numa feição já selecionada`` 

``Para mover uma feição, selecione a feição, clique nela e arraste-a`` 


#### Adicionar texto

<img src="../images/icon_text_black.svg" alt="Icone Texto" width="70"/>

- Adicionar textos personalizados no mapa.

Com a ferramenta ativada, clique num local do mapa para adicionar um texto.

Para editar o texto adicionado, clique no texto.

É possível alterar as seguintes propriedades:

- Texto
- Tamanho
- Cor
- Rotação
- Justificativa: justifica o texto com mais de uma linha conforme as opções (esquerda (L), centralizado (C), direita (R))
- Cor da borda
- Salvar: salva as alterações
- Descartar: descarta as alterações
- Definir padrão: define o estilo e texto padrão para os próximos textos adquiridas
- Deletar: exclui as feições selecionadas

---

#### Adicionar imagem

<img src="../images/icon_photo_black.svg" alt="Icone Imagem" width="70"/>

Clique na ferramenta para ativá-la e no mapa para adicionar uma imagem. Será aberto uma janela para escolher a imagem.

Ao selecionar a imagem será aberta a caixa de opções onde é possível alterar as seguintes propriedades:

- Tamanho
- Rotação
- Opacidade
- Salvar: salva as alterações
- Descartar: descarta as alterações
- Deletar: exclui as feições selecionadas

> Obs.: Para montar um símbolo militar acesse o [Portal de Simbologia Militar](https://simbologia.eb.mil.br/)

---

#### Adicionar linha de visada

<img src="../images/icon_los_black.svg" alt="Icone Linha de Visada" width="70"/>

Clique uma vez no mapa para selecionar o ponto do observador e outra vez no mapa para selecionar o ponto final da visada.

Será gerada uma linha <span style="color:red;">vermelha</span> onde não puder ser visto pelo observador e <span style="color:green;">verde</span> onde é possível ser visualizado pelo observador.

Ao selecionar a linha será aberta a caixa de opções onde é possível alterar as seguintes propriedades:

- Opacidade
- Largura
- Mostrar tamanho:  mostra o tamanho da linha como um texto flutuante na linha
- Mostrar perfil: mostra um gráfico com o perfil do terreno e a linha de visada da linha selecionada
- Salvar: salva as alterações
- Descartar: descarta as alterações
- Deletar: exclui as feições selecionadas

---

#### Adicionar análise de visibilidade

<img src="../images/icon_visibility_black.svg" alt="Icone Análise de Visibilidade" width="70"/>

Clique uma vez no mapa para selecionar o ponto do observador e outra vez no mapa para selecionar o ponto final da visada.

Será gerada um polígono (setor de um círculo) cos as cores: <span style="color:red;">vermelha</span> onde não puder ser visto pelo observador e <span style="color:green;">verde</span> onde é possível ser visualizado pelo observador.

Ao selecionar o setor será aberta a caixa de opções onde é possível alterar as seguintes propriedades:

- Opacidade
- Salvar: salva as alterações
- Descartar: descarta as alterações
- Deletar: exclui as feições selecionadas

---

#### Adicionar street view

<img src="../images/icon_street_view_black.svg" alt="Icone Street View" width="70"/>

Ao selecionar a ferramenta, será realçado no mapa onde é possível visualizar as imagens 360°. Ao clicar na via realçada, será possível visualizar as imagens 360° naquela via.

Para navegar nas imagens 360°:

- Clique com o botão esquerdo do mouse em qualquer lugar da imagem para arrasta-la.
- Clique nas setas de navegação para ir para a próxima imagem ou para a imagem anterior.

---

## 3D

Nessa aba é possível visualizar os modelos 3D disponibilizados. Além disso há uma imagem de fundo e um modelo digital de superfície. As ferramentas disponibilizadas funcionam apenas nos modelos 3D, não funcionam no terreno.

### Controles para Navegação

É possível navegar pelos modelos 3D da seguinte forma (nenhuma ferramenta selecionada):

- Botão esquerdo do mouse: ao pressionar e arrastar é possível mover o mapa.
- Botão do meio do mouse: 
    - Rolar: Zoom.
    - Pressionar e arrastar: mudar perspectiva e rotacionar o mapa.

### Modelos 3D

É possível enquadrar os modelos na tela clicando nos seus respectivos botões. São disponibilizados os seguintes modelos 3D:

- AMAN

- AMAN PCL 


### Ferramentas

São disponibilizadas as seguintes ferramentas:

> Obs.: As ferramentas não estão disponíveis na versão para celular.


#### Viewshed

<img src="../images/viewshed_icon.svg" alt="Icone Viewshed" width="100"/>

Clicar com o botão esquerdo uma vez no ponto inicial (ponto simulando o observador), clicar com o botão esquerdo outra vez no ponto final. Será gerado um setor esférico e o modelo 3D será colorido dentro do setor com <span style="color:red;">vermelho</span> onde não puder ser visto pelo observador e <span style="color:green;">verde</span> onde é possível ser visualizado pelo observador. Apertar Limpar para limpar o setor já criado, inicializar a ferramenta novamente para criar outro setor.


[Exemplo de Uso Viewshed](images/Viewshed_cliques.mp4 ':include :type=video controls width=100%')

---

#### Medição de Distância

<img src="../images/distance_icon.svg" alt="Icone Distancia" width="100"/>

Clicar com o botão esquerdo uma vez no ponto inicial, clicar com o botão esquerdo outras vezes para verificar a distancia em linha reta com relação ao ponto anterior. Clicar com o botão direito do mouse para finalizar a medição. Apertar Limpar para limpar as medições em tela, inicializar a ferramenta novamente para outras medições.

[Exemplo de Uso Medidor de Distancia](images/Distance_cliques.mp4 ':include :type=video controls width=100%')

---

#### Medição de Área

<img src="../images/area_icon.svg" alt="Icone Area" width="100"/>

Clicar com o botão esquerdo uma vez no ponto inicial, clicar com o botão esquerdo outras vezes para construir o polígono cuja áre será calculada, clicar com o botão direito para encerrar a construção do polígono e calcular a área. Apertar Limpar para limpar as medições em tela, inicializar a ferramenta novamente para medir novamente.

[Exemplo de Uso Medidor de Área](images/Area_cliques.mp4 ':include :type=video controls width=100%')

---

#### Limpar

<img src="../images/clear_icon.svg" alt="Icone Limpar" width="100"/>

Limpar as medições em tela das outras ferramentas.