# EBSIG

## Funcionalidades

- Adicionar textos personalizados no mapa.
- Adicionar imagens personalizadas no mapa com propriedades ajustáveis (tamanho, rotação).
- Arrastar e soltar textos e imagens para reposicioná-los.
- Editar propriedades dos textos e imagens através de painéis de atributos.
- Salvar feições do mapa em um arquivo JSON.
- Carregar feições do mapa a partir de um arquivo JSON.

## Como Usar

### Instalação

1. Clone o repositório para o seu ambiente local:
    ```bash
    git clone https://github.com/1cgeo/ebsig.git
    cd ebsig
    ```

2. Instale as dependências do projeto:
    ```bash
    npm install
    ```

### Executar o Projeto

Para iniciar o servidor de desenvolvimento, execute:
```bash
npm start
```

Abra seu navegador e acesse http://localhost:3000 para ver a aplicação em execução.

### Estrutura do Projeto
public/js/controls/: Contém os controles customizados para adicionar textos e imagens.

public/js/controls/add_text_control.js: Controle para adicionar e editar textos no mapa.

public/js/controls/add_image_control.js: Controle para adicionar e editar imagens no mapa.

public/js/controls/saveLoadControl.js: Controle para salvar e carregar feições do mapa.

public/js/controls/text_attributes_panel.js: Painel de atributos para editar propriedades dos textos.

public/js/controls/image_attributes_panel.js: Painel de atributos para editar propriedades das imagens.

public/js/controls/drawStyles.js: Estilos personalizados para as feições do Mapbox Draw.

public/js/utils.js: Funções utilitárias para salvar e carregar arquivos JSON.

### Controles Personalizados

#### Adicionar Texto
Clique no botão "T" para entrar no modo de adição de texto.
Clique no mapa para adicionar um texto na posição desejada.
Insira o texto desejado na janela de prompt.
Para editar o texto, clique nele para abrir o painel de atributos onde é possível alterar o conteúdo, tamanho, cor e cor de fundo do texto.

#### Adicionar Imagem
Clique no botão de imagem para entrar no modo de adição de imagem.
Clique no mapa para adicionar uma imagem na posição desejada.
Selecione uma imagem do seu computador.
Para editar a imagem, clique nela para abrir o painel de atributos onde é possível alterar a imagem, tamanho e rotação.

#### Salvar e Carregar Feições
Para salvar as feições do mapa, clique no botão de disquete (💾).
Para carregar feições para o mapa, clique no botão de pasta (📂) e selecione um arquivo JSON com as feições salvas.