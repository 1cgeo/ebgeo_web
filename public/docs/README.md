# Tutorial

Esta página tem como objetivo explicar as funcionalidades do EBSIG, bem como oferecer diretrizes para a sua utilização.

<!-- ## SIG

Nessa aba é possível visualizar um mapa digital e realizar algumas análises com as ferramentas disponibilizadas. As imagens, terrenos e vetores foram gerados pela DSG. É possível ainda visualizar algumas vias com imagens 360º.

### Controles para Navegação

É possível navegar pelos mapa da seguinte forma (nenhuma ferramenta selecionada):

- Botão esquerdo do mouse: ao pressionar e arrastar é possível mover o mapa.
- Botão direito do mouse: ao pressionar e arrastar é possível mudar a perspectiva e rotacionar o mapa.
- Botão do meio do mouse: ao rolar o botão do meio do mouse, é possível mudar o zoom do mapa.
- Ctrl+C: Copiar os itens selecionados. É possível selecionar [Feições](#criar-feição), [Textos](#adicionar-texto) e [Imagens](#adicionar-imagem).
- Ctrl+V: Colar as itens copiados. 
- Ctrl+Z: Desfazer.
- Ctrl+Y: Refazer.

### Ferramentas

#### Alterar camada base

- Carta
- Ortoimagem

#### Exportar dados

#### Importar dados

#### Gerenciador de mapas

##### Criar novo mapa

##### Alternar mapa

##### Duplicar mapa

##### Excluir mapa

#### Criar feição

- Linha
- Polígono
- Ponto

#### Adicionar texto

- Adicionar textos personalizados no mapa.

#### Adicionar imagem

- Para montar um símbolo militar: [Portal de Simbologia Militar](https://simbologia.eb.mil.br/)

#### Linha de visada 1

#### Linha de visada 2

#### Manipular elementos

- Rotacionar
- Alterar o tamanho
- Alterar fonte
- Duplicar elemento

#### Visualização em 360º

Ao selecionar a ferramenta, será realçado no mapa onde é possível visualizar as imagens 360°. Ao clicar na via realçada, será possível visualizar as imagens 360° naquela via.

Para navegar nas imagens 360°:

- Clique com o botão esquerdo do mouse em qualquer lugar da imagem para arrasta-la.
- Clique nas setas de navegação para ir para a próxima imagem ou para a imagem anterior. -->

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