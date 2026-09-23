// Path: js/military_tools/engineering_symbol_tool/engineering_fields.js
// Field definitions for the engineering symbol editor.
const valueField = (key, label, value, kind = 'decimal', help = '') => ({ key, label, value, kind, help });
const choiceField = (key, label, value, options, help = '') => ({ key, label, value, kind: 'select', options, help });
const flagField = (key, label, value = false) => ({ key, label, value, kind: 'checkbox' });
const backgroundField = () => flagField('fillBackground', 'Preencher fundo');
const orderField = value => valueField('order', 'Número de ordem', value, 'integer', 'Referência no reconhecimento; não é o ID da feição no sistema.');
const accessField = value => choiceField('access', 'Acesso difícil', value, [['none', 'Sem indicação'], ['left', 'À esquerda do desenho'], ['right', 'À direita do desenho'], ['both', 'Nos dois lados']], 'O zigue-zague muda de lado. Esquerda/direita são relativas ao desenho antes da rotação.');
const foliageFields = () => [choiceField('foliage', 'Tipo de folhagem', 'temporary', [['temporary', 'Folhas temporárias · círculos'], ['permanent', 'Folhas permanentes · ângulos']], 'Cada inserção é um ponto de vegetação, posicionado junto à estrada real. Para representar os dois lados, inserir dois pontos independentes.')];

export const engineeringFields = {
  2: { fixed: 'Triângulo arredondado e haste. O 3 dentro do triângulo é variável.', fields: [valueField('order', 'Número do ponto crítico', '3', 'integer', 'Identifica a referência na legenda. Não é quantidade nem classe e não deve ser fixado em 3.'), backgroundField()], extra: 'A descrição da restrição pertence à legenda/atributos, fora do glifo.' },
  3: { fixed: 'Uma única marca de limite. a tabela não define texto ou número neste glifo.', fields: [], extra: 'Cada inserção é um limite independente. Inserir duas vezes para marcar o início e o fim do trecho; a âncora fica na ponta da marca junto à rodovia.' },
  5: { fixed: 'Seta e marcas determinadas pela inclinação.', fields: [valueField('inclination', 'Inclinação (%)', '6')], extra: 'Faixa automática: de 5 a 7%, uma marca; acima de 7 até 10%, duas; acima de 10 até 14%, três; acima de 14%, quatro. Abaixo de 5% ou sem valor conhecido, a seta fica sem marcas de faixa. A rotação orienta a seta para a subida.' },
  6: { fixed: 'Triângulo simples. 26 é o raio do exemplo.', fields: [valueField('radius', 'Raio da curva (m)', '26')] },
  7: { fixed: 'Triângulos concêntricos e barra entre os dois dados.', fields: [valueField('count', 'Quantidade de curvas', '1', 'integer'), valueField('radius', 'Raio da curva mais fechada (m)', '15')], extra: 'A expressão 1/15 significa quantidade / menor raio; não é escala.' },
  8: { fixed: 'Círculo dividido, chamada, roda, lagarta e setas de um/dois sentidos. Todos os oito números do exemplo são dados.', fields: [orderField('3'),
    valueField('wheelsTwo', 'Classe · rodas · dois sentidos', '80', 'integer'), valueField('wheelsOne', 'Classe · rodas · um sentido', '100', 'integer'),
    valueField('tracksTwo', 'Classe · lagartas · dois sentidos', '60', 'integer'), valueField('tracksOne', 'Classe · lagartas · um sentido', '80', 'integer'),
    valueField('clearance', 'Gabarito vertical (m)', '4'), valueField('length', 'Comprimento total (m)', '100'), valueField('width', 'Largura mínima entre rodapés (m)', '9'),
    flagField('railway', 'Ponte ferroviária · mostrar Fv'),
    flagField('underClearance', 'Sublinhar gabarito inferior ao padrão', true), flagField('underLength', 'Sublinhar comprimento inferior ao padrão'), flagField('underWidth', 'Sublinhar largura inferior ao padrão'), backgroundField()
  ], extra: 'Classe e dimensão são conceitos diferentes. Os sublinhados são marcações explícitas de valores inferiores ao padrão da classe; não são decoração nem calculados sem os padrões de referência. Fv é uma sigla fixa cuja presença é opcional.' },
  9: { fixed: 'Círculo dividido e chamada. 80 é classe; 40 é número de ordem.', fields: [valueField('class', 'Classe da ponte', '80', 'integer'), orderField('40'), backgroundField()] },
  10: { fixed: 'Retorno com duas setas. Sem números ou texto preenchível no glifo.', variant: 'Forma gráfica', fields: [], extra: 'As formas 1 e 2 são as duas figuras da célula; a tabela não lhes atribui significados diferentes.' },
  11: { fixed: 'Retorno com duas setas e interrupção. Não há dado numérico ou literal preenchível.', fields: [] },
  13: { fixed: 'Chamada, separadores e organização em duas linhas. Dados e lado do zigue-zague variam.', fields: [orderField('4'),
    choiceField('type', 'Tipo de vau', 'V', [['V','V · viaturas'],['P','P · tropa a pé']]), valueField('speed', 'Velocidade da correnteza (m/s)', '?'),
    choiceField('variation', 'Fator de variação anual', 'Y', [['X','X · nenhuma variação'],['Y','Y · variação de vulto']]),
    valueField('length', 'Comprimento do vau (m)', '15'), valueField('width', 'Largura do vau (m)', '3'),
    choiceField('material', 'Material do fundo', 'P', [['M','M · silte'],['C','C · argila'],['S','S · areia'],['G','G · pedregulho'],['R','R · rocha'],['P','P · pavimento construído']]),
    valueField('depth', 'Profundidade (m)', '0,75'), accessField('left')
  ], extra: 'Acima: ordem / tipo / correnteza / variação. Abaixo: comprimento / largura / material / profundidade. O “?” substitui o dado desconhecido; não equivale a zero.' },
  14: { fixed: 'Casco, divisor, chamada e posições dos dados. O zigue-zague indica acesso difícil.', fields: [orderField('4'), choiceField('type', 'Tipo de balsa', 'V', [['V','V · viaturas'],['P','P · pedestres']]), valueField('class', 'Classe da balsa', '60', 'integer'), valueField('weight', 'Peso próprio da balsa (t)', '?'), valueField('minutes', 'Tempo médio de deslocamento (min)', '20'), accessField('right')], extra: 'O dado da direita dentro do casco é peso próprio, conforme a tabela; não é capacidade de carga. O “?” do exemplo é um valor desconhecido desse campo.' },
  15: { fixed: 'Triângulos pontilhados. Os números dos dois lados são medidas.', fields: [valueField('width', 'Largura disponível da pista (m)', '4'), valueField('length', 'Extensão do trecho estreito (m)', '120')] },
  16: { fixed: 'Arco. A barra entre gabaritos só é necessária quando mínimo e máximo diferem.', fields: [valueField('width', 'Largura da passagem (m)', '4'), valueField('minimum', 'Gabarito mínimo (m)', '3,5'), valueField('maximum', 'Gabarito máximo (m)', '4,5')], extra: 'Gabaritos iguais aparecem uma única vez. O formulário avisa se o mínimo exceder o máximo.' },
  17: { fixed: 'Portal retangular e apoios. 4/6 representa duas larguras, não uma fração.', fields: [valueField('roadWidth', 'Largura da pista (m)', '4'), valueField('totalWidth', 'Largura total / vão (m)', '6'), valueField('clearance', 'Gabarito vertical (m)', '7')] },
  18: { fixed: 'Abóbada, apoios e chamada. Ordem dentro; dimensões ao redor.', fields: [orderField('1'), valueField('clearance', 'Gabarito vertical (m)', '4'), valueField('length', 'Comprimento do túnel (m)', '800'), valueField('roadWidth', 'Largura da pista (m)', '5'), valueField('totalWidth', 'Largura total, incluindo muretas (m)', '6')] },
  19: { fixed: 'Sinal de restrição por linha aérea. Estrada e ferrovia são contexto. O valor 4,2 é a altura do fio no exemplo.', fields: [valueField('height', 'Altura do fio sobre o solo (m)', '4,2')], extra: 'Esta ferramenta considera sempre uma passagem de nível com linha aérea. Informe a altura do fio ou use “?” quando desconhecida.' },
  20: { fixed: 'Uma fileira de círculos ou de ângulos. A estrada do exemplo é contexto e não entra no SVG.', fields: foliageFields(), extra: 'Usar apenas um tipo de folhagem por ponto. Inserir ao lado da estrada real; a repetição gráfica não indica uma quantidade medida de árvores.' },
  21: { fixed: 'Um grupo de círculos ou de ângulos formando bosque. A estrada do exemplo é contexto e não entra no SVG.', fields: foliageFields(), extra: 'Usar apenas um tipo de folhagem por ponto. A disposição em grupo distingue coberta da fileira de cobertura; não representa uma medição de densidade vegetal.' },
  22: { fixed: 'Saída e convenção de roda/lagarta/folhagem da modalidade escolhida.', variant: 'Condição de deslocamento', fields: [], extra: 'As marcações (1), (2) e (3) enumeram a legenda, não são dados do símbolo. A variante genérica não significa especificamente “a pé”.' },
  23: { fixed: 'Pares de traços, sem número preenchível. O estado altera tracejado, contínuo ou cruzamento.', variant: 'Estado do obstáculo', fields: [], extra: 'Planejado: tracejado. Preparado: contínuo. Realizado: pares cruzados. (a), (b) e (c) são referências da legenda e não aparecem no SVG.' },
  26: { fixed: 'O próprio ponto de interrogação é o símbolo. Não é um campo de texto livre.', fields: [], extra: 'Nos demais itens, um dado pode ser marcado com “?”; aqui o glifo autônomo permanece “?”.' },
  27: { fixed: 'Círculo com quadrantes opostos preenchidos. Sem número, letra ou tamanho de estacionamento na tabela.', fields: [backgroundField()], extra: 'Nome e descrição são metadados possíveis; não entram automaticamente dentro do círculo.' },
  28: { fixed: 'Círculo e letra T. O T faz parte da convenção de trânsito e não deve ser um input editável.', fields: [backgroundField()], extra: 'Nome e descrição são metadados possíveis; não substituem o T do glifo.' }
};

/** Graphic classes use continuous intervals, with 7% in the lower class. */
export function rampChevronCount(value) {
  const slope = value === '' || value === '?' || value == null ? NaN : Number(String(value).replace(',', '.'));
  if (!Number.isFinite(slope) || slope < 5) return 0;
  if (slope <= 7) return 1;
  if (slope <= 10) return 2;
  if (slope <= 14) return 3;
  return 4;
}
