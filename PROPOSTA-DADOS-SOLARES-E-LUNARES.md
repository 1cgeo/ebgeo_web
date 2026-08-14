# Proposta: dados solares e lunares

**Status: proposta, não implementação.** Escrita em 2026-08-14, contra o commit `ac4ba36f`. Decisão de escopo já tomada pelo Chefe da DGEO: a Lua entra na primeira entrega, e o horário é o de Brasília.

Origem: análise de sete sistemas externos pedida pelo Chefe. Das quinze lições levantadas, esta é a única autorizada por ora. A ideia veio do plugin QGIS ClimaPlots, que calcula astronomia solar localmente. O ClimaPlots é GPL-2.0, então serve como método, e o código se escreve do zero.

> **Divergência declarada.** O commit `55e98fbd` deixou a raiz com dois arquivos de propósito. Este é um terceiro, colocado aqui a pedido do Chefe. Ao ser aceito, o conteúdo perene migra para `docs/wiki/` e este arquivo sai.

## 1. O que se propõe

Um módulo que responde, para um ponto e uma data, quando há luz. Ele calcula no navegador, sem rede e sem servidor, e apresenta o resultado nos rótulos que o Exército já usa.

## 2. A fonte doutrinária

**EB70-MC-10.336, Processo de Integração Terreno, Condições Meteorológicas, Inimigo e Considerações Civis (PITCIC), 2023.** Lido na fonte, não em resumo. Os itens que governam esta proposta:

- **3.2.7** lista os nove elementos meteorológicos a analisar. Os dois primeiros são `a) crepúsculos` e `b) fases da lua`.
- **4.3.3.3.2** repete a prioridade: "Os elementos meteorológicos que mais influenciam as operações militares são o crepúsculo, as fases da lua, as condições atmosféricas e outros."
- **4.3.3.3.3** define os três crepúsculos e o valor militar de cada um. O náutico traz um número operacional direto: "a visibilidade fica limitada a um máximo de 400 metros, permitindo o emprego do armamento até esse alcance e a progressão com relativa coberta da observação inimiga".
- **4.3.3.3.3 b** fixa a dependência que o módulo resolve: "os horários de início e fim dos crepúsculos dependem da localização geográfica (latitude e longitude) e variam ao longo do ano".
- **4.3.3.3.4 b** define o conjunto mínimo: "a luminosidade deve ser analisada em função do nascer e do pôr do sol e das fases da lua".
- **Fig 4-10** desenha as faixas: horizonte a 0 grau, civil até 6, náutico até 12, astronômico até 18. Nomeia os extremos de PRIMEIRA CLARIDADE e ÚLTIMA CLARIDADE.
- **Quadro 4-5** mostra o produto pronto, e é dele que saem os rótulos abaixo.

## 3. Os campos, copiados do Quadro 4-5

O manual não descreve o quadro em prosa, ele o exibe. Copiamos os rótulos como estão, sem inventar nomenclatura.

| Linha | Campo | O que é | Como se calcula |
|---|---|---|---|
| Dados solares | `ICMN` | Início do Crepúsculo Matutino Náutico | Sol a 12 graus abaixo do horizonte, subindo |
| Dados solares | `FCVN` | Fim do Crepúsculo Vespertino Náutico | Sol a 12 graus abaixo do horizonte, descendo |
| Dados lunares | `Fase lunar` | nova, crescente, cheia ou minguante | ângulo de fase, em quatro faixas de sete dias |
| Dados lunares | `Ini Luar` | nascer da Lua | centro do disco no horizonte, com refração |
| Dados lunares | `Fim do luar` | pôr da Lua | idem, descendo |

Formato do valor, como no manual: `06:09h`. Colunas por dia relativo: `D`, `D+1`, `D+2`.

**A coluna D já existe no código.** O módulo temporal tem modo relativo com âncora, em `frontend/src/js/temporal/temporal.constants.js` (`TEMPORAL_MODES.RELATIVO` e o campo `origem`). O quadro herda essa âncora em vez de criar outra.

### Campos que a doutrina cita mas não põe no quadro

Entram como linha secundária, porque **4.3.3.3.4 b** os exige na análise: nascer e pôr do Sol, crepúsculo civil e astronômico, primeira e última claridade.

### Campo que a doutrina NÃO tem

O percentual de iluminação lunar. O manual trata a Lua por fase nomeada, em períodos de sete dias, e não por percentual. Se o exibirmos, ele vai rotulado como cálculo auxiliar nosso, nunca como campo do PITCIC. Regra geral: campo doutrinário e campo calculado não se misturam na mesma tabela sem marcação.

## 4. Fuso horário

**Horário de Brasília, não Zulu.** Decisão do Chefe, e é como o Exército escreve.

- Brasília é UTC menos 3, fixo. Não há horário de verão desde o Decreto 9.772/2019, e não há previsão para 2026.
- O deslocamento vira **constante nomeada**, nunca número solto no meio da conta. A política de horário de verão é reavaliada periodicamente, e o dia em que voltar o código tem um só lugar para mudar.
- O rótulo aparece na tela ao lado do valor. Horário sem etiqueta de fuso é a tela que mente: parece certo e manda a tropa fora de hora.
- **Brasília é a REFERÊNCIA, não a hora legal do ponto.** Em Manaus ou Rio Branco a hora legal difere. O quadro diz Brasília, como a doutrina faz, e não tenta adivinhar o fuso da área de operações.
- Internamente tudo se calcula e se guarda em UTC. A conversão acontece só na formatação.

## 5. Onde o código mora

Existe molde pronto no repositório, e não vamos inventar arquitetura.

`frontend/src/js/utilities/geomagnetic/` roda o WMM inteiro no navegador, expõe pouca coisa pelo `index.js` e serve três consumidores (`azimuth_distance_tool`, `military_tools/declination_tool` e o painel de feição). O módulo novo espelha isso:

```
frontend/src/js/utilities/solar/
  index.js              # barrel, só o que é público
  solar_calculator.js   # Sol: nascer, pôr, os três crepúsculos, azimute
  lunar_calculator.js   # Lua: nascer, pôr, fase
  pitcic_quadro.js      # monta o quadro nos rótulos da doutrina
```

Convenções da casa que valem aqui: comentário de caminho na linha 1, JSDoc em inglês, string de UI em pt-BR com acento, import por alias.

**Importação dinâmica é obrigatória.** `docs/wiki/peso-do-pacote-web.md` mostra que o que decide o payload é o import estático, e não o grupo de chunk. O módulo não pode ser alcançável de forma estática a partir de `frontend/src/js/map_sig.js`.

## 6. A biblioteca: decide a medida, não a preferência

Duas candidatas sérias. Licença de ambas conferida na fonte.

| Biblioteca | Licença | Peso | Cobertura |
|---|---|---|---|
| `suncalc` (`mourner/suncalc`) | BSD-2-Clause | mínimo, sem dependências | Sol e Lua, fórmulas de baixa precisão |
| `astronomy-engine` (`cosinekitty/astronomy`) | MIT | maior | Sol, Lua e planetas, com limites de erro documentados |

As duas são permissivas e servem juridicamente. A aposta é a segunda, pela precisão da Lua e pelos limites de erro declarados. Mas a escolha não sai de aposta: **as duas entram na mesma tabela de referência, e o erro medido decide.** Custa um script.

Terceira opção, se as duas reprovarem no peso: escrever as fórmulas. O `geomagnetic` já prova que dá.

## 7. Onde aparece na tela, em três fases

1. **Painel derivado.** O quadro num painel, calculado na hora, sem persistir nada. Zero migração, zero rota nova, zero tipo de sync. É a fase que prova o cálculo em produção pelo menor custo.
2. **Coluna D, D+1, D+2.** Amarrada à âncora do modo relativo do módulo temporal.
3. **Produto.** Faixa de dia e noite na barra temporal, e o quadro como elemento marginal do PDF cartográfico, ao lado de `_drawTitle`, `_drawNorthArrow`, `_drawScaleBar` e `_drawLegend` em `frontend/src/js/import_export/pdf-cartographic-elements.js`.

## 8. O que NÃO fazer

**A doutrina proíbe a solução óbvia.** Item **4.3.3.2.3**: as restrições meteorológicas "podem ser lançadas diretamente no calco de restrição ao movimento, ou em outro calco do terreno, evitando-se a confecção de calcos específicos, já que, em um período relativamente curto, um elemento meteorológico pode sofrer variações".

Logo, nada de camada de calco só para luminosidade. Painel e elemento marginal, que se recalculam, e não feição gravada que envelhece.

Isso casa com a regra da casa: nenhuma rota REST de escrita e nenhum alvo novo de sync na fase 1.

## 9. As armadilhas

1. **Sinal da longitude.** Oeste é negativo. Trocar o sinal desloca o horário em horas, e o resultado continua parecendo plausível. Só a tabela de referência pega.
2. **O dia local não é o dia UTC.** Perto da meia-noite, "hoje" muda de significado. O cálculo ancora no dia solar do ponto, não no calendário do navegador.
3. **O fenômeno pode não ocorrer.** Em latitude alta não há nascer nem pôr. A Lua não nasce em todo dia do calendário. A função devolve nulo e a tela escreve que não ocorre. Nunca `00:00`, que é um horário válido e errado.
4. **O horizonte é teórico, não é o terreno.** O padrão usa horizonte ao nível do mar com refração. Sol atrás da crista não está modelado, e o rótulo tem de dizer isso. O nascer mascarado pelo relevo é outro problema, e usaria o motor de visibilidade que já existe.
5. **A convenção do ICMN é leitura nossa da Fig 4-10.** A figura põe o náutico entre 6 e 12 graus, e daí se lê que o ICMN é o Sol a 12 graus abaixo. A tabela de referência confirma ou desmente isso, e por isso ela vem antes do código de tela.
6. **UTC menos 3 pode deixar de ser fixo.** Por isso é constante nomeada.

## 10. Como isso se prova

Sem tabela de referência não há entrega.

- **A referência é nacional:** o Anuário Interativo do Observatório Nacional publica nascer, ocaso e os três crepúsculos para coordenada arbitrária. É fonte federal, e é a que a tropa consultaria.
- **Doze casos no mínimo.** Porto Alegre, Manaus e um ponto ao norte do equador. Um solstício, um equinócio e uma data comum. Um caso em latitude alta, para provar que a ausência devolve nulo.
- **Tolerância declarada no teste**, não em comentário.
- **Controle negativo obrigatório.** Antes de aceitar, inverto o sinal da longitude e confirmo que o teste fica vermelho. Verde que continua verde com o código quebrado não prova nada.
- **Verificação de lógica:** `npm run lint` e depois `npm test`, na raiz, em dois comandos separados.
- **UI por Playwright**, dirigindo app e backend reais, lendo a imagem produzida, com o spec temporário apagado depois.
- **Aciono a ferramenta uma vez** antes de dizer que está pronta.

## 11. O que fica em aberto

- A confirmação da convenção do ICMN e do FCVN contra o Anuário do ON. Ela sai da própria tabela de referência, então não bloqueia o início.
- Se o quadro completo do PITCIC entra algum dia. As outras sete linhas (temperatura, umidade, nebulosidade, precipitação, cobertura de nuvens, vento e pressão) exigem fonte de previsão do tempo, que o sistema não tem. Esta proposta cobre só as duas linhas que se calculam sem rede.
- A matriz de efeitos do Quadro 4-5, com as faixas de impacto por tipo de tropa e de sensor, é julgamento de estado-maior e não cálculo. Fica fora.
