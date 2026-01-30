# Tutorial EBGeo

## Página Principal

<img src="./images/pagina_inicial.png" alt="Página Principal" width="100%"/>

Na página principal, o tutorial será segmentado em módulos.

* Módulo 1: ferramentas gerais
* Módulo 2: painel lateral esquerdo
* Módulo 3: barra de busca
* Modulo 4: painel lateral superior direito de desenho
* Módulo 5: painel lateral inferior direito de ferramentas auxiliares
* Módulo 6: painel inferior de coordenadas
* Módulo 7: uso do Streetview
* Módulo 8: uso de ferramentas no mapeamento 3D.

### Módulo 1: Ferramentas Gerais

É possível navegar pelo mapa da seguintes formas no computador (nenhuma ferramenta selecionada):

- Botão esquerdo do mouse: ao pressionar e arrastar é possível mover o mapa.
- Ctrl+Botão esquerdo do mouse: ao pressionar e arrastar segurando Ctrl é possível rotacionar e inclinar o mapa.
- Botão direito do mouse: abre as opções de copiar coordenadas e orientar para o norte.
- Botão do meio do mouse: ao rolar o botão do meio do mouse, é possível mudar o zoom do mapa.
- Ctrl+C: Copiar os itens selecionados. É possível selecionar feições, textos e imagens.
- Ctrl+V: Colar as itens copiados.
- Ctrl+Z: Desfazer.
- Ctrl+Y: Refazer.

### Módulo 2: Painel Lateral Esquerdo

<table>
  <tr>
    <td style="vertical-align: top; width: 15%;">
      <img src="./images/painel_lateral_esquerdo.png" alt="Painel Lateral Esquerdo" width="100%"/>
    </td>
    <td style="vertical-align: top;">
      <ul>
        <li><strong>Mapas:</strong> ficam centralizadas as opções de importação.</li>
        <li><strong>Camadas:</strong> onde ficam armazenados as camadas.</li>
        <li><strong>Importar:</strong> onde é possível importar arquivos.</li>
        <li><strong>Exportar:</strong> onde é possível exportar uma screenshot.</li>
        <li>Uma aba de acesso rápido, que permite ciclar entre os mapas.</li>
      </ul>
    </td>
  </tr>
</table>

#### Mapas

<img src="./images/ple_mapas.png" alt="Painel Mapas" width="30%"/>

- Abrir: importar um arquivo .ebgeo, nesse caso, todos os mapas já desenhados são substituídos pelos novos mapas importados no .ebgeo.
- Importar: adicionar um arquivo .ebgeo aos mapas já existentes, nesse caso, são criados novos mapas em adição aos já existentes.
- Salvar: permite escolher quais mapas serão salvos no formato .ebgeo.
- Limpar Tudo: deleta todas as informações armazenadas no navegador, não é possível recuperar.

<img src="./images/notas.png" alt="Painel Notas" width="30%"/>

- É possível adicionar notas a um mapa, com título e informações relevantes que ficam armazenadas no .ebgeo.

<img src="./images/notas_edicao.png" alt="Painel Edição Notas" width="30%"/>

<img src="./images/todos_mapas.png" alt="Painel Todos os Mapas" width="30%"/>

- Salvar Posição: a posição atual do mapa é salva, quando o arquivo .ebgeo for aberto em outra máquina ou o mapa for selecionado no painel, a posição central do mapa vai para a posição salva.
- Duplicar: duplicar o mapa atual, para edição em outro mapa com as informações do mapa anterior.
- Renomear: alterar o nome do mapa atual.
- Puxar outros mapas: puxa as camadas de outro mapa para o mapa atual, permitindo a mescla de dois mapas distintos.
- Deletar: deleta o mapa atual.

#### Camadas

Na aba de Camadas, ficam localizadas as feições criadas: pontos, linhas, polígonos, imagens, círculo, etc. Na hierarquia, um mapa pode ter diversas camadas e cada camada pode ter diversas feições, sejam elas repetidas ou não.

<img src="./images/painel_camadas.png" alt="Painel Camadas" width="30%"/>

A camada que está selecionada é onde as feições criadas no mapa são criadas. Caso a feição seja criada na camada errada, basta clicar com o botão direito na feição dentro da tela do mapa e selecionar para mover de camada.

Dentro das opções de cada camada é possível marcar para que as feições daquela camada sejam vistas ou não, é possível travar aquele conjunto de camadas, não permitindo a seleção e a edição, é possível consultar a tabela de atributos daquela camada (é uma tabela de atributos compartilhada entre todas as feições daquela camada).

O bloqueio de edição/visualização pode ser feito tanto em todas as feições daquela camada, quanto indivudalmente por camada.

A opção de deletar, deleta todos as feições daquela camada, sem possibilidade de recuperação.

#### Importar

<img src="./images/importar.png" alt="Importar Geometrias" width="30%"/>

É possível importar dados geoespaciais de outras fontes para dentro do EBGeo: GeoJSON, Shapefile, KML/KMZ e GPX.

Existe um limitador da quantidade de feições que podem ser importadas de uma única vez. Caso a mensagem indique que foi excedido o limte de feições, sugere-se dividir o arquivo que se deseja carregar em mais partes.

#### Exportar

<img src="./images/painel_exportar.png" alt="Exportar PDF" width="30%"/>

Além da exportação no formato .ebgeo, que permite compartilhar os mapas com outros usuários, é possível também exportar produtos finais.

- Exportar imagem: tira uma captura de tela do EBGeo e salva no formato de imagem, é ideal para ser utilizado em apresentações de slides.
- Exportar PDF: é possível exportar um arquivo .pdf com todas as feições criadas, o tamanho da folha é padrão (A4) mas a escala é configurável. Além disso, o .pdf gerado já é georreferenciado, o que permite sua utiliação em aplicativos como o Avenza Maps.

### Módulo 3: Barra de Busca

<img src="./images/barra_busca.png" alt="Barra de Busca" width="40%"/>

A pesquisa é realizada nos seguintes dados: quaisquer nomes presentes no mapa (cidades, serras, morros, nomes locais, rios, massas d'água), modelos 3D existentes, modelos Streetview, feições já criadas no mapa e coordenadas.

#### Catálogo

<img src="./images/catalogo.png" alt="Catálogo" width="50%"/>

Na aba Catálogo, o operador pode verificar quais produtos especiais foram construídos, dentre eles: Modelos 3D, Imagens 360°, Streetview e Camadas de Análise (declividade, trafegabilidade).

#### Tutorial

Na aba Tutorial, o operador é redirecionado para esse link, onde é possível verificar quais funções estão disponíveis e acessar um breve guia sobre cada ferramenta.

#### Informações

<img src="./images/info_suporte.png" alt="Suporte" width="30%"/>

Lista de contatos úteis para retirada de dúvidas, sugestão de melhorias e comunicação de eventuais falhas no sistema.

#### Atalhos

<img src="./images/painel_atalhos.png" alt="Atalhos" width="30%"/>

A maioria das ferramentas de desenho do EBGeo possuem atalhos no teclado para melhorar a usabilidade da plataforma, tais atalhos estão listados no Painel de Atalhos e sinalizados na documentação.

### Modulo 4: Painel de Desenho

<img src="./images/desenho_simples.png" alt="Barra de Desenho" width="30%"/>

Antes de avançarmos nas ferramentas individuais de desenhos, devemos verificar o painel associado as camadas de desenho.

- Em "Ponto #1" é possível alterar o nome daquela feição
- Em + Adicionar Descrição é possível inserir um texto com informações daquela feição, esse texto não aparece no mapa e fica associado a cada feição criada, sem ser um atributo.
- É possível associar fotos e imagens a cada feição criada
- Cada feição e seus tipos tem suas próprias características de estilos, para ponto: alterar o tamanho e a opacidade, mas para linha, tem a possibilidade de alterar a espessura e o padrão da linha. Cada tipo de feição, nesse mesmo painel, recebe a sua possiilidade de estilização.
- Além do estilo, é possível criar atributos que ficam associados a feição e aquele conjunto de camadas.
- A ferramenta "Definir como padrão" faz com que os próximos desenhos daquele tipo de feição recebem as mesmas características da feição atualmente criada. Para linhas por exemplo: definida uma cor, um padrão de desenho e uma espessura, a próxima linha seguirá o mesmo aspecto.

#### Desenhos Básicos

Em geral, feições que são possíveis adquirir mais de um vértice, os vértices são adquiridos clicando com o botão esquerdo do _mouse_ e a edição finaliza com o botão direito. Enquanto feições que só tem um ponto inicial e um final, os pontos são adquiridos clicando com o botão esquerdo do _mouse_ e a edição finaliza com o botão esquerdo.

##### Ponto (Atalho "P"), Linha (Atalho "L") e Área (Atalho "A")

<img src="./images/pla.png" alt="Barra de Desenho" width="50%"/>

##### Retângulo (Atalho "R"), Círculo (Atalho "C") e Elipse (Atalho "E")

<img src="./images/rce.png" alt="Barra de Desenho" width="50%"/>

Caso existam feições sobrepostas e elas não estejam travadas no Painel de Camadas, ao selecionar, irá aparecer um painel perguntando qual feição deseja ser editada.

##### Texto (Atalho "T"), Imagem (Atalho "I") e Pincel (Atalho "B")

<img src="./images/tip.png" alt="Barra de Desenho" width="50%"/>

#### Calcos Militares

##### Simbologia Militar

<img src="./images/painel_simb_mil.png" alt="Barra de Desenho" width="50%"/>

##### Medida de Coordenação

<img src="./images/medidas_coordenacao.png" alt="Barra de Desenho" width="50%"/>

Medidas de coordenação podem representar pontos, linhas direções ou áreas, e são compostas por traçado e amplificadores.

##### Seta



##### Linha de Limite

##### Frente Ocupada

### Módulo 5: Painel Auxiliar Direito

<img src="./images/lateral_inf_direito.png" alt="Lateral Inferior Direito" width="50%"/>

- +: aumenta o zoom no mapa, também pode ser feito com o scroll do mouse.
- -: reduz o zoom no mapa, também pode ser feito com o scroll do mouse.
- Habilitar tela cheia
- Ir para minha localização: necessita de autorização para uso da localização do GPS da máquina
- Orientar para o norte: reseta a orientação do mapa para o norte, sem inclinação.
- Modelos 3D: habilita no mapa os marcadores 3D, que ao serem clicados abrem um preview e a possibilidade de visualizar o 3D.

<img src="./images/modelos_3d_preview.png" alt="Modelos 3D Preview" width="40%"/>

- Imagens 360°: habilita no mapa os marcadores de onde há imagens em 360°.
- Terreno: habilita o terreno, usado para ferramentas de análise de visibilidade, em um pequeno nível afeta a performance da aplicação.
