# Tabela 6-4 : o que é fixo e o que é preenchível

Análise das páginas PDF 47–53 do C 5-36 fornecido. [Abrir galeria com campos](http://127.0.0.1:3080).

O número 3 do ponto crítico é um **input de referência**: o usuário pode informar 17, por exemplo, mantendo o triângulo e a haste. A mesma separação entre glifo e dado deve orientar todo o catálogo. Os números de exemplo não são constantes do SVG.

## Regras comuns

- **Dados do símbolo:** valores medidos, identificadores e códigos que aparecem no desenho. Cada valor é um campo independente; não editar a fórmula inteira como se fosse uma imagem.
- **Variantes:** seleções que alteram o próprio traço, como estado do obstáculo ou tipo de folhagem.
- **Metadados:** nome, descrição, origem e observações não entram automaticamente no glifo. No ponto crítico, a descrição pertence à legenda.
- **Apresentação:** coordenada, orientação, tamanho e opacidade são controles do marcador, separados dos dados técnicos. Todos os objetos continuam sendo pontos.
- **Identificadores:** número de ordem não é o ID interno da feição; não renumerar automaticamente ao duplicar ou sincronizar sem uma regra explícita.
- **Desconhecido:** aceitar “?” sem converter em zero. Vazio significa não informado. O protótipo permite ambos nos campos numéricos; na implementação persistida, guardar estado e valor separadamente. A tabela 6-4 não define uma convenção adicional para distinguir desconhecido de duvidoso no desenho.
- **Unidades:** informadas nos rótulos do formulário, conservando a notação do glifo. Classe de ponte não é peso em toneladas. Aceitar vírgula/ponto decimal e apresentar vírgula.
- **Códigos fixos com presença variável:** Fv só aparece quando a ponte ferroviária é indicada; T no posto de controle e ? no item 26 não são texto livre.
- **Legenda da tabela:** (1)/(2)/(3), (a)/(b)/(c) e os números das linhas da tabela não viram inputs dos símbolos.

## Escopo e cores de revisão

Foram retirados os itens 01, 04, 12, 24 e 25. Restam 23 itens, conservando a numeração do manual. Nos SVGs, preto indica o símbolo e seus dados; vermelho indica o contexto da ilustração. A âncora opcional é azul e não entra no download. Os recortes originais permanecem sem alterações.

Rodovias são contexto nos itens 03, 06, 07, 15, 16, 17, 19 e 22. Nos itens 20 e 21, a rodovia é contexto e foi retirada do SVG, deixando apenas a vegetação. No item 19, a ferrovia também é contexto; o sinal de restrição e a altura são a informação de engenharia. A ferramenta considera sempre uma linha aérea nesse item. Árvores dos itens 20–22, chamadas, setas de fluxo, marcações de rampa, números, letras e fórmulas de travessia pertencem ao símbolo. A separação de cores é uma anotação de revisão, não uma convenção do manual.

## Inventário por item

### 02 : Ponto crítico

**Parte fixa:** Triângulo arredondado e haste. O 3 dentro do triângulo é variável.

| Campo | Tipo de entrada | Exemplo / opções | Observação |
|---|---|---|---|
| Número do ponto crítico | inteiro | 3 | Identifica a referência na legenda. Não é quantidade nem classe e não deve ser fixado em 3. |

A descrição da restrição pertence à legenda/atributos, fora do glifo.

### 03 : Limite de trecho

**Parte fixa:** Uma única marca de limite, em preto. A rodovia do exemplo é contexto, em vermelho.

Sem valores numéricos ou texto preenchível no glifo. Cada inserção é um ponto independente; o usuário insere duas vezes para marcar o início e o fim do trecho. A âncora coincide com a ponta da marca junto à rodovia. A figura original mostra dois limites apenas como exemplo de delimitação.

### 05 : Rampas

**Parte fixa:** Seta e marcas da faixa escolhida. 6, 9, 11 e 17 são exemplos de inclinação, não rótulos fixos.

**Seleção:** Faixa gráfica da rampa: 5 a 7%; 7 a 10%; 11 a 14%; Acima de 14%.

| Campo | Tipo de entrada | Exemplo / opções | Observação |
|---|---|---|---|
| Inclinação (%) | medida decimal | 6 |  |

A faixa é escolhida separadamente: as fronteiras impressas não permitem uma regra automática inequívoca. O giro orienta a seta para a subida. Com geometria Point, o comprimento da seta é apenas gráfico.

### 06 : Curva fechada

**Parte fixa:** Triângulo simples e estrada de contexto. 26 é o raio do exemplo.

| Campo | Tipo de entrada | Exemplo / opções | Observação |
|---|---|---|---|
| Raio da curva (m) | medida decimal | 26 |  |

### 07 : Sequência de curvas fechadas

**Parte fixa:** Triângulos concêntricos, estrada e barra entre os dois dados.

| Campo | Tipo de entrada | Exemplo / opções | Observação |
|---|---|---|---|
| Quantidade de curvas | inteiro | 1 |  |
| Raio da curva mais fechada (m) | medida decimal | 15 |  |

A expressão 1/15 significa quantidade / menor raio; não é escala.

### 08 : Ponte : símbolo completo

**Parte fixa:** Círculo dividido, chamada, roda, lagarta e setas de um/dois sentidos. Todos os oito números do exemplo são dados.

| Campo | Tipo de entrada | Exemplo / opções | Observação |
|---|---|---|---|
| Número de ordem | inteiro | 3 | Referência no reconhecimento; não é o ID da feição no sistema. |
| Classe · rodas · dois sentidos | inteiro | 80 |  |
| Classe · rodas · um sentido | inteiro | 100 |  |
| Classe · lagartas · dois sentidos | inteiro | 60 |  |
| Classe · lagartas · um sentido | inteiro | 80 |  |
| Gabarito vertical (m) | medida decimal | 4 |  |
| Comprimento total (m) | medida decimal | 100 |  |
| Largura mínima entre rodapés (m) | medida decimal | 9 |  |
| Ponte ferroviária · mostrar Fv | sim/não | Não |  |
| Sublinhar gabarito inferior ao padrão | sim/não | Sim |  |
| Sublinhar comprimento inferior ao padrão | sim/não | Não |  |
| Sublinhar largura inferior ao padrão | sim/não | Não |  |

Classe e dimensão são conceitos diferentes. Os sublinhados são marcações explícitas de valores inferiores ao padrão da classe; não são decoração nem calculados sem os padrões de referência. Fv é uma sigla fixa cuja presença é opcional.

Não há contorno associado nesta versão de ponte.

### 09 : Ponte : símbolo abreviado

**Parte fixa:** Círculo dividido e chamada. 80 é classe; 40 é número de ordem.

| Campo | Tipo de entrada | Exemplo / opções | Observação |
|---|---|---|---|
| Classe da ponte | inteiro | 80 |  |
| Número de ordem | inteiro | 40 | Referência no reconhecimento; não é o ID da feição no sistema. |

Não há contorno associado nesta versão de ponte.

### 10 : Contorno de fácil utilização

**Parte fixa:** Retorno com duas setas. Sem números ou texto preenchível no glifo.

**Seleção:** Forma gráfica: Forma 1; Forma 2.

Sem valores numéricos ou textos preenchíveis dentro do glifo.

As formas 1 e 2 são as duas figuras da célula; a tabela não lhes atribui significados diferentes.

### 11 : Contorno de difícil utilização

**Parte fixa:** Retorno com duas setas e interrupção. Não há dado numérico ou literal preenchível.

Sem informação variável interna definida pela tabela.

### 13 : Vau

**Parte fixa:** Chamada, separadores e organização em duas linhas. Dados e lado do zigue-zague variam.

| Campo | Tipo de entrada | Exemplo / opções | Observação |
|---|---|---|---|
| Número de ordem | inteiro | 4 | Referência no reconhecimento; não é o ID da feição no sistema. |
| Tipo de vau | seleção | V · viaturas; P · tropa a pé |  |
| Velocidade da correnteza (m/s) | medida decimal | ? |  |
| Fator de variação anual | seleção | X · nenhuma variação; Y · variação de vulto |  |
| Comprimento do vau (m) | medida decimal | 15 |  |
| Largura do vau (m) | medida decimal | 3 |  |
| Material do fundo | seleção | M · silte; C · argila; S · areia; G · pedregulho; R · rocha; P · pavimento construído |  |
| Profundidade (m) | medida decimal | 0,75 |  |
| Acesso difícil | seleção | Sem indicação; À esquerda do desenho; À direita do desenho; Nos dois lados | O zigue-zague muda de lado. Esquerda/direita são relativas ao desenho antes da rotação. |

Acima: ordem / tipo / correnteza / variação. Abaixo: comprimento / largura / material / profundidade. O “?” substitui o dado desconhecido; não equivale a zero.

### 14 : Balsa

**Parte fixa:** Casco, divisor, chamada e posições dos dados. O zigue-zague indica acesso difícil.

| Campo | Tipo de entrada | Exemplo / opções | Observação |
|---|---|---|---|
| Número de ordem | inteiro | 4 | Referência no reconhecimento; não é o ID da feição no sistema. |
| Tipo de balsa | seleção | V · viaturas; P · pedestres |  |
| Classe da balsa | inteiro | 60 |  |
| Peso próprio da balsa (t) | medida decimal | ? |  |
| Tempo médio de deslocamento (min) | medida decimal | 20 |  |
| Acesso difícil | seleção | Sem indicação; À esquerda do desenho; À direita do desenho; Nos dois lados | O zigue-zague muda de lado. Esquerda/direita são relativas ao desenho antes da rotação. |

O dado da direita dentro do casco é peso próprio, conforme a tabela; não é capacidade de carga. O “?” do exemplo é um valor desconhecido desse campo.

### 15 : Redução de largura

**Parte fixa:** Estrada e triângulos pontilhados. Os números dos dois lados são medidas.

| Campo | Tipo de entrada | Exemplo / opções | Observação |
|---|---|---|---|
| Largura disponível da pista (m) | medida decimal | 4 |  |
| Extensão do trecho estreito (m) | medida decimal | 120 |  |

### 16 : Passagem sob arco

**Parte fixa:** Arco e estrada. A barra entre gabaritos só é necessária quando mínimo e máximo diferem.

| Campo | Tipo de entrada | Exemplo / opções | Observação |
|---|---|---|---|
| Largura da passagem (m) | medida decimal | 4 |  |
| Gabarito mínimo (m) | medida decimal | 3,5 |  |
| Gabarito máximo (m) | medida decimal | 4,5 |  |

Gabaritos iguais aparecem uma única vez. O formulário avisa se o mínimo exceder o máximo.

### 17 : Passagem sob estrutura retangular

**Parte fixa:** Portal retangular, apoios e estrada. 4/6 representa duas larguras, não uma fração.

| Campo | Tipo de entrada | Exemplo / opções | Observação |
|---|---|---|---|
| Largura da pista (m) | medida decimal | 4 |  |
| Largura total / vão (m) | medida decimal | 6 |  |
| Gabarito vertical (m) | medida decimal | 7 |  |

### 18 : Túnel

**Parte fixa:** Abóbada, apoios e chamada. Ordem dentro; dimensões ao redor.

| Campo | Tipo de entrada | Exemplo / opções | Observação |
|---|---|---|---|
| Número de ordem | inteiro | 1 | Referência no reconhecimento; não é o ID da feição no sistema. |
| Gabarito vertical (m) | medida decimal | 4 |  |
| Comprimento do túnel (m) | medida decimal | 800 |  |
| Largura da pista (m) | medida decimal | 5 |  |
| Largura total, incluindo muretas (m) | medida decimal | 6 |  |

O túnel não possui contorno associado.

### 19 : Passagem de nível

**Parte fixa:** Sinal de restrição por linha aérea; a estrada e a ferrovia são contexto, em vermelho. A existência de linha aérea é uma premissa do símbolo nesta ferramenta.

| Campo | Tipo de entrada | Exemplo | Observação |
|---|---|---|---|
| Altura do fio sobre o solo (m) | Medida decimal | 4,2 | Informar a altura ou “?” para dado desconhecido. |

O checkbox “Existe linha aérea” foi removido. O sinal de restrição permanece no desenho independentemente do valor preenchido.

### 20 : Cobertura

**Parte fixa:** Uma fileira de círculos ou de ângulos. A estrada é contexto no recorte original e não entra no SVG.

| Campo | Tipo de entrada | Opções | Observação |
|---|---|---|---|
| Tipo de folhagem | Seleção | Folhas temporárias : círculos; folhas permanentes : ângulos | Um único tipo por ponto. |

Cada inserção é um ponto independente, para posicionar junto à estrada real no mapa. Para os dois lados da estrada, inserir dois pontos; não há campo esquerda/direita nem composição mista de folhagens no mesmo símbolo. A repetição gráfica não representa uma contagem ou densidade medida de árvores.

### 21 : Coberta

**Parte fixa:** Um grupo formando bosque de círculos ou de ângulos. A estrada é contexto no recorte original e não entra no SVG.

| Campo | Tipo de entrada | Opções | Observação |
|---|---|---|---|
| Tipo de folhagem | Seleção | Folhas temporárias : círculos; folhas permanentes : ângulos | Um único tipo por ponto. |

Cada inserção é um ponto independente, para posicionar junto à estrada real no mapa. Para os dois lados da estrada, inserir dois pontos; não há campo esquerda/direita nem composição mista de folhagens no mesmo símbolo. A repetição gráfica não representa uma contagem ou densidade medida de árvores.

### 22 : Deslocamento fora da estrada

**Parte fixa:** Estrada, saída e convenção de roda/lagarta/folhagem da modalidade escolhida.

**Seleção:** Condição de deslocamento: Possível; Rodas / folhas permanentes; Lagartas / folhas temporárias.

Sem valores numéricos ou textos preenchíveis dentro do glifo.

As marcações (1), (2) e (3) enumeram a legenda, não são dados do símbolo. A variante genérica não significa especificamente “a pé”.

### 23 : Obstáculos

**Parte fixa:** Pares de traços, sem número preenchível. O estado altera tracejado, contínuo ou cruzamento.

**Seleção:** Estado do obstáculo: Planejado; Preparado; Realizado.

Sem valores numéricos ou textos preenchíveis dentro do glifo.

Planejado: tracejado. Preparado: contínuo. Realizado: pares cruzados. (a), (b) e (c) são referências da legenda e não aparecem no SVG.

### 26 : Dado desconhecido ou duvidoso

**Parte fixa:** O próprio ponto de interrogação é o símbolo. Não é um campo de texto livre.

Sem informação variável interna definida pela tabela.

Nos demais itens, um dado pode ser marcado com “?”; aqui o glifo autônomo permanece “?”.

### 27 : Área de estacionamento

**Parte fixa:** Círculo com quadrantes opostos preenchidos. Sem número, letra ou tamanho de estacionamento na tabela.

Sem informação variável interna definida pela tabela.

Nome e descrição são metadados possíveis; não entram automaticamente dentro do círculo.

### 28 : Posto de controle de trânsito

**Parte fixa:** Círculo e letra T. O T faz parte da convenção de trânsito e não deve ser um input editável.

Sem informação variável interna definida pela tabela.

Nome e descrição são metadados possíveis; não substituem o T do glifo.

## O que a galeria já permite verificar

Alterar dados e ver o SVG resultante ao lado do recorte original; baixar o SVG preenchido; escolher variantes; conferir validações de números e relações entre dimensões. O exemplo original fica intacto. O rascunho é preservado durante buscas e se perde ao recarregar. Estes formulários são um protótipo da proposta e não gravam no EBGeo.

Contorno impossível foi excluído do catálogo. Pontes e túnel não possuem contorno associado. A vegetação é inserida como ponto independente junto à estrada real, conforme indicado no formulário.
