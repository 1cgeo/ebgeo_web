# Módulo Temporal — Controle Temporal de Feições

## 1. Visão Geral

O Módulo Temporal adiciona a dimensão **tempo** ao EBGeo, permitindo que feições apareçam, desapareçam e **se movam** conforme o momento configurado na linha do tempo. O objetivo é transformar o mapa estático em uma **representação dinâmica no tempo e no espaço**.

### 1.1 Conceito Central

O controle temporal é **habilitado por mapa**. Quando ativo, o usuário define o **início**, **fim** e a **unidade de divisão** da linha do tempo. Feições podem receber uma janela de validade temporal (início/fim) e, opcionalmente, posições diferentes ao longo do tempo. Um controle de linha do tempo na parte superior do mapa permite navegar — ao arrastar o cursor, feições surgem, desaparecem e se deslocam conforme a evolução temporal.

Toda feição sem dados temporais é tratada como **permanente** — visível em qualquer momento da linha do tempo.

### 1.2 Referências de Implementação

- **MapLibre GL JS**: `map.setFilter()` para filtragem temporal de layers, `setData()` para atualização de posições dinâmicas
- **Turf.js**: `along()` para interpolação ao longo de polylines, `bearing()` para cálculo de direção, `distance()` para velocidade
- **ArcGIS TimeSlider**: modos de exibição (instante, janela, cumulativo)
- **ORBAT Mapper**: pontos-chave de posição com interpolação

---

## 2. Modelo de Dados Temporal

### 2.1 Configuração Temporal do Mapa

Cada mapa pode ter **zero ou uma** configuração temporal. Quando habilitada, a configuração define:

| Campo | Tipo | Descrição | Exemplo |
|-------|------|-----------|---------|
| `temporalAtivo` | boolean | Se o controle temporal está habilitado | `true` |
| `temporalInicio` | ISO 8601 datetime | Início da linha do tempo | `2026-03-14T06:00:00Z` |
| `temporalFim` | ISO 8601 datetime | Fim da linha do tempo | `2026-03-16T00:00:00Z` |
| `temporalUnidade` | enum | Unidade de divisão do slider | `horas` |
| `temporalAtual` | ISO 8601 datetime | Posição atual do cursor no slider | `2026-03-15T08:30:00Z` |
| `dDay` | ISO 8601 date ou `null` | Data do D-Dia (opcional) | `2026-03-15` |
| `hHour` | string HH:MM ou `null` | Horário da H-Hora (opcional) | `06:00` |
| `temporalModo` | enum | Modo de exibição do timeline | `instante` |
| `temporalJanelaLargura` | number (minutos) | Largura da janela (modo janela) | `30` |
| `temporalAnimacaoSuave` | boolean | Fade in/out ao entrar/sair do tempo | `true` |
| `temporalMostrarPermanentes` | boolean | Feições sem tempo sempre visíveis | `true` |
| `temporalExibirPosAnterior` | boolean | Mostrar posição do ponto-chave anterior | `true` |
| `temporalExibirPontosFuturos` | boolean | Mostrar pontos-chave futuros | `false` |
| `temporalExibirVelocidade` | boolean | Indicador de velocidade em símbolos militares | `true` |
| `temporalLoop` | boolean | Animação volta ao início ao atingir o fim | `false` |
| `temporalVelocidadeReproducao` | number | Velocidade de reprodução | `1` |

**Modos de exibição (`temporalModo`):**

| Modo | Comportamento |
|------|--------------|
| `instante` | Mostra feições ativas no momento exato do slider |
| `janela` | Mostra feições ativas dentro de uma faixa ±`temporalJanelaLargura` minutos |
| `cumulativo` | Mostra todas as feições desde o início até o tempo atual |

**Velocidades de reprodução (`temporalVelocidadeReproducao`):** `0.5`, `1`, `2`, `5`, `10`

**Unidades de divisão disponíveis:**

| Unidade | Ticks no slider | Step dos botões ◀/▶ |
|---------|----------------|---------------------|
| `minutos` | 1 tick por minuto | avança/retrocede 1 minuto |
| `horas` | 1 tick por hora | avança/retrocede 1 hora |
| `dias` | 1 tick por dia | avança/retrocede 1 dia |
| `semanas` | 1 tick por semana | avança/retrocede 1 semana |
| `meses` | 1 tick por mês | avança/retrocede 1 mês |

**Sistema D/H (tempo relativo):**

Quando `dDay` e `hHour` estão preenchidos, o sistema habilita o formato de tempo relativo D/H:

- **D-Dia** = data âncora da operação. **H-Hora** = horário âncora dentro do D-Dia
- O ponto `D+0/H+0` corresponde a `dDay` + `hHour` (ex: `2026-03-15T06:00Z`)
- Tempos anteriores usam notação negativa: `D-1` = um dia antes, `H-30min` = 30 minutos antes
- Tempos posteriores usam notação positiva: `D+1` = um dia depois, `H+2` = 2 horas depois
- Formato combinado: `D+0/H+2` = mesmo dia, 2 horas após H-Hora

A conversão é automática: o sistema armazena sempre datetime absoluto (ISO 8601) internamente. O D/H é apenas um **formato de exibição** alternativo, calculado como offset a partir de `dDay`+`hHour`.

Quando `dDay`/`hHour` são `null`, o formato D/H fica indisponível — apenas data/hora absoluta e GDH são exibidos.

**Regras:**

- `temporalInicio` deve ser anterior a `temporalFim`
- `temporalAtual` deve estar entre `temporalInicio` e `temporalFim`
- `dDay`/`hHour` são opcionais — o timeline funciona normalmente sem eles
- A configuração é persistida no IndexedDB como parte dos dados do mapa

### 2.2 Propriedades Temporais na Feição

Cada feição recebe propriedades temporais **opcionais**, armazenadas diretamente na feição:

| Propriedade | Tipo | Descrição |
|-------------|------|-----------|
| `temporalInicio` | ISO 8601 datetime ou `null` | Quando a feição se torna ativa |
| `temporalFim` | ISO 8601 datetime ou `null` | Quando a feição deixa de ser ativa |

**Regras de visibilidade temporal:**

1. Feição **sem** `temporalInicio` e sem `temporalFim` → **sempre visível** (permanente, não afetada pelo timeline)
2. Feição com `temporalInicio` e `temporalFim` → visível somente quando `inicio <= tempoAtual <= fim`
3. Feição com `temporalInicio` e `temporalFim = null` → visível de `inicio` em diante
4. Feição com `temporalInicio = null` e `temporalFim` → visível até `fim`

**Localização na UI:** As propriedades `temporalInicio` e `temporalFim` são exibidas na **área do nome e descrição** do painel de atributos da feição (junto aos campos `nome` e `descricao`), não em seção separada.

### 2.3 Posição Dinâmica no Tempo (Trajetória)

Feições que suportam movimento podem ter uma **trajetória** — uma rota desenhada no mapa com pontos-chave (timestamps) ao longo dela. A posição é interpolada via `turf.along()` sobre a geometria da rota.

#### Tipos de Feição com Suporte a Trajetória

| Tipo de Feição | Tipo de Movimento | Descrição |
|----------------|-------------------|-----------|
| `military_symbol` | Trajetória completa | Unidades, equipamentos e instalações se deslocam. Direção, velocidade e GDH calculados automaticamente. Simbologia re-renderizada dinamicamente |
| `coordination_measure` | Trajetória completa | Pontos de coordenação podem mudar de posição |
| `point` | Trajetória completa | Pontos genéricos podem representar entidades móveis |

**Feições que NÃO suportam trajetória** (apenas visibilidade temporal via início/fim):

`arrow`, `boundary`, `occupied_front`, `polygon`, `rectangle`, `circle`, `ellipse`, `sector`, `line`, `text`, `image`, `brush`, `los`, `visibility`

#### Modelo de Dados

```
trajetoria = {
  rota: [[lng,lat], [lng,lat], ...],       // polyline completa (todos os vértices)
  pontosChave: [                           // vértices com timestamp (subconjunto da rota)
    { posicao: 0.0,  tempo: "2026-03-14T06:00Z" },   // fração 0.0-1.0 ao longo da rota
    { posicao: 0.35, tempo: "2026-03-15T05:00Z" },
    { posicao: 0.5,  tempo: "2026-03-15T06:00Z" },
    { posicao: 1.0,  tempo: "2026-03-15T10:00Z" },
  ]
}
```

| Campo | Descrição |
|-------|-----------|
| `rota` | Polyline completa — define a forma do caminho (estradas, curvas, contornos) |
| `pontosChave` | Lista ordenada de `{ posicao, tempo }`. `posicao` é fração 0.0–1.0 ao longo da rota |

#### Exemplo

```
Rota desenhada no mapa (segue estrada):

    ● ZRn (0%)                   ponto-chave: 14/03 06:00
    │
    ◇ curva na estrada
    │
    ◇ contorno do rio
    │
    ● PtLib (35%)                ponto-chave: 15/03 05:00
    │
    ◇ cruzamento
    │
    ● LP (50%)                   ponto-chave: 15/03 06:00
    │
    ◇ terreno aberto
    │
    ● Obj ALFA (100%)            ponto-chave: 15/03 10:00

Legenda:
  ● = Ponto-chave (vértice com timestamp — laranja)
  ◇ = Vértice de forma (sem timestamp — verde, define o caminho)
```

#### Interpolação

A posição no tempo T é calculada com `turf.along()`:

1. Encontrar os dois pontos-chave adjacentes (anterior e próximo) ao tempo T
2. Calcular a fração de tempo decorrido entre eles: `f = (T - anterior.tempo) / (proximo.tempo - anterior.tempo)`
3. Calcular a distância ao longo da rota: `d = anterior.posicao + f × (proximo.posicao - anterior.posicao)`
4. Posição = `turf.along(rota, d × comprimentoTotal)`

O símbolo percorre a geometria real da rota (estradas, curvas), não em linha reta entre pontos-chave.

#### Regras

- Mínimo 2 pontos-chave para ativar movimento
- Feição é visível desde o primeiro ponto-chave até `temporalFim` (ou até o último ponto-chave se `temporalFim` não estiver definido)
- Antes do primeiro ponto-chave, a feição não existe (a menos que `temporalInicio` esteja definido antes)
- Entre dois pontos-chave, a velocidade é uniforme ao longo do trecho da rota

#### Rastro e Indicadores

- **Rastro:** Subconjunto da rota já percorrido — da posição do primeiro ponto-chave até a posição atual. Linha tracejada cinza (1px). **Visível apenas quando a feição está selecionada**
- **Rota completa:** Linha fina semi-transparente mostrando o caminho inteiro. **Visível apenas quando a feição está selecionada**
- **Posição anterior:** Símbolo semi-transparente (20%) na posição do ponto-chave anterior

### 2.4 Integração com Simbologia Militar

Símbolos militares (MILSTD-2525C) possuem campos que se integram com o módulo temporal:

| Campo Simbologia | Amplificador | Integração Temporal |
|-----------------|-------------|---------------------|
| **GDH (W)** | Date-Time Group | **Dinâmico**: datetime do momento atual do slider, formatado como GDH (DDHHMMZmmmAA) |
| **Direção de Movimento (Q)** | Seta de direção | **Dinâmico**: bearing calculado da trajetória no momento atual |
| **Velocidade (Z)** | Valor em km/h | **Dinâmico**: calculado da trajetória no momento atual |
| **Status Operacional** | Planejado/Presente | Vínculo temporal automático (ver abaixo) |

#### Propriedades Dinâmicas Calculadas da Trajetória

Quando um símbolo militar tem **trajetória** definida, os seguintes campos são **calculados automaticamente** a partir da rota e do momento atual do slider:

- **Direção (Q):** bearing da tangente à rota na posição interpolada atual (direção para onde o símbolo está se movendo)
- **Velocidade (Z):** distância do trecho entre pontos-chave adjacentes ÷ tempo entre eles
- **GDH (W):** datetime do momento atual do slider, formatado como GDH militar

#### Re-renderização do Símbolo (milsymbol)

Ao mover o slider, o sistema:

1. Calcula a nova posição via `turf.along()` sobre a rota
2. Calcula a nova direção (bearing da tangente) e velocidade (distância/tempo do trecho)
3. Chama `new ms.Symbol(sidc, { direction: novaDirecao, speed: novaVelocidade, dtg: novoGDH, ... })` com os novos valores
4. Substitui a imagem do símbolo no mapa (`map.updateImage()` ou atualiza source do marker)
5. A re-renderização acontece a cada mudança de posição do slider (com debounce de 50ms para performance)

**Indicador de velocidade:** Linha partindo do símbolo na direção de movimento (tangente à rota), com comprimento proporcional à velocidade. Sem ponta de seta. Visível quando a feição tem trajetória e velocidade > 0.

#### Status Operacional (Planejado/Presente) com Vínculo Temporal

O campo **status operacional** do símbolo militar (MILSTD-2525C) indica se uma unidade está **planejada** (tracejado) ou **presente** (linha contínua). O módulo temporal pode vincular essa transição ao tempo:

| Configuração | Comportamento |
|-------------|--------------|
| **Sem vínculo temporal** (padrão) | Status permanece como definido manualmente pelo usuário (planejado ou presente). O tempo não altera o status |
| **Com vínculo temporal** | O usuário define um datetime de transição. Antes desse momento, o símbolo é renderizado como **planejado** (tracejado). A partir desse momento, é renderizado como **presente** (contínuo) |

**Campo adicional na feição:**

| Propriedade | Tipo | Descrição |
|-------------|------|-----------|
| `statusTransicaoTempo` | ISO 8601 datetime ou `null` | Momento em que o status muda de planejado para presente. `null` = sem vínculo temporal |

**Na UI:** Checkbox "Vincular status ao tempo" no painel de atributos do símbolo militar. Quando marcado, exibe campo de datetime para a transição. Exemplo: unidade planejada que se torna presente em `D+0/H+0` (início da operação).

**Re-renderização:** Ao cruzar o `statusTransicaoTempo`, o SIDC do símbolo é atualizado (bit de status operacional muda de planejado para presente) e o milsymbol é re-renderizado com o novo SIDC.

### 2.5 Tipos de Feição e Comportamento Temporal

| Tipo de Feição | Trajetória | Visibilidade Temporal | Notas |
|----------------|-----------|----------------------|-------|
| `military_symbol` | Sim | Sim | Direção, velocidade e GDH dinâmicos. Status planejado/presente vinculável ao tempo |
| `coordination_measure` | Sim | Sim | Pontos de coordenação móveis |
| `point` | Sim | Sim | Pontos genéricos como entidades móveis |
| `occupied_front` | Não | Sim | Frente fixa — aparece/desaparece por tempo |
| `arrow` | Não | Sim | Setas de movimento — aparecem/desaparecem por tempo |
| `boundary` | Não | Sim | Limites fixos — aparecem/desaparecem por tempo |
| `polygon`, `rectangle`, `circle`, `ellipse`, `sector` | Não | Sim | Áreas fixas — aparecem/desaparecem por tempo |
| `line` | Não | Sim | Linhas fixas — aparecem/desaparecem por tempo |
| `text`, `image`, `brush` | Não | Sim | Anotações — aparecem/desaparecem por tempo |
| `los`, `visibility` | Não | Sim | Análises — aparecem/desaparecem por tempo |

### 2.6 Dados Temporais no Slide do Briefing

Cada slide de briefing pode capturar um estado temporal quando o mapa referenciado tem linha do tempo ativa:

| Propriedade | Tipo | Descrição |
|-------------|------|-----------|
| `temporalMode` | enum | Modo temporal do slide: `instantaneo`, `intervalo`, `sem_tempo` |
| `temporalInstante` | ISO 8601 datetime ou `null` | Momento capturado (modo `instantaneo`) |
| `temporalIntervaloInicio` | ISO 8601 datetime ou `null` | Início do intervalo (modo `intervalo`) |
| `temporalIntervaloFim` | ISO 8601 datetime ou `null` | Fim do intervalo (modo `intervalo`) |
| `temporalAutoReproducao` | boolean | Reprodução automática dentro do intervalo |

**Regras:**

- `temporalMode = 'sem_tempo'` → slide não altera o estado temporal (mantém o do slide anterior). Demais campos `null`
- `temporalMode = 'instantaneo'` → slide exibe o mapa no momento exato de `temporalInstante`
- `temporalMode = 'intervalo'` → tempo pode avançar automaticamente de `temporalIntervaloInicio` até `temporalIntervaloFim`
- Default para slides novos: `temporalMode = 'sem_tempo'`
- Se o mapa referenciado não tem linha do tempo ativa, os campos temporais são ignorados

---

## 3. Interface do Usuário

### 3.1 Controle de Linha do Tempo

Barra horizontal na **parte superior do mapa**, abaixo da barra de ferramentas:

```
+============================================================================+
| [Ferramentas]  [Busca]                                                     |
+============================================================================+
| [◀] [▶/⏸] [▶▶]  ═══════════●══════════════════════  15/03 08:30  [⚙️]   |
|              14/03 06:00                    16/03 00:00         [data|D/H]  |
+============================================================================+
|                                                                            |
|                              MAPA 2D                                       |
|                                                                            |
+============================================================================+
| [Terreno] [3D] [360]                             [Zoom+] [Zoom-] [🧭]     |
+============================================================================+
```

Se D-Dia/H-Hora estiverem definidos, o toggle de formato exibe `D+0/H+2:30` em vez de `15/03 08:30`.

**Componentes:**

| Elemento | Função |
|----------|--------|
| **Slider** | Barra arrastável horizontal. O cursor (círculo) indica o tempo atual |
| **Marcações** | Marcações na barra conforme a unidade de divisão escolhida |
| **Indicador de tempo** | Exibe o tempo atual no formato selecionado |
| **Botão Reproduzir/Pausar** | Inicia/pausa a animação automática |
| **Botões ◀/▶** | Avança ou retrocede uma unidade de divisão |
| **Botão Velocidade (▶▶)** | Cicla entre velocidades: 0.5x, 1x, 2x, 5x, 10x |
| **Alternador de formato** | Cicla entre: data/hora, D/H (se configurado), GDH (se configurado) |
| **Botão ⚙️** | Abre painel de configuração da linha do tempo |

**Comportamento de arrasto do slider:**

1. Ao arrastar, feições são filtradas em tempo real (debounce de 50ms para performance)
2. Feições que entram exibem transição suave de opacidade (fade in 200ms)
3. Feições que saem fazem fade out (200ms)
4. O mapa não faz pan/zoom durante arrasto do slider — apenas a visibilidade e posições mudam

**Modos de exibição (selecionável via configurações):**

| Modo | Comportamento | Uso |
|------|--------------|-----|
| **Instante** | Mostra feições ativas no momento exato | Visualizar situação em um ponto específico |
| **Janela** | Mostra feições ativas dentro de uma faixa de tempo (ex: ±30min) | Visualização com contexto temporal |
| **Cumulativo** | Mostra todas as feições desde o início até o tempo atual | Acompanhar evolução |

### 3.2 Ativação e Desativação

O controle temporal **não está visível por default**. O usuário o ativa por:

1. **Painel de mapas no sidebar** → botão/toggle "Linha do Tempo" na linha do mapa ativo
2. **Ao configurar a linha do tempo** via painel de configuração
3. **Automaticamente** ao abrir um projeto `.ebgeo` que contenha dados temporais

**Ao desativar:**

- Todas as feições voltam a ser visíveis (filtro temporal removido)
- **Feições com trajetória voltam à posição do primeiro ponto-chave** (início da rota)
- Dados temporais e trajetórias são preservados (não são perdidos)
- Barra de linha do tempo recolhe com animação

### 3.3 Painel de Configuração da Linha do Tempo

Acessado pelo botão ⚙️ na linha do tempo ou pelo painel de mapas no sidebar. Abre como modal:

```
+--------------------------------------------------+
|  Configurar Linha do Tempo                    [X] |
+--------------------------------------------------+
|                                                    |
|  Início: [14/03/2026 06:00         ]              |
|  Fim:    [16/03/2026 00:00         ]              |
|                                                    |
|  Unidade de divisão:                               |
|  ○ Minutos                                         |
|  ● Horas                                           |
|  ○ Dias                                            |
|  ○ Semanas                                         |
|  ○ Meses                                           |
|                                                    |
|  ─── D-Dia / H-Hora (opcional) ───                 |
|  D-Dia:  [15/03/2026    ] (vazio = sem D/H)        |
|  H-Hora: [06:00         ]                          |
|                                                    |
|  Modo de exibição:                                 |
|  ● Instante                                        |
|  ○ Janela (largura: [30] min)                      |
|  ○ Cumulativo                                      |
|                                                    |
|  [✓] Animação suave (fade in/out)                  |
|  [✓] Feições sem tempo sempre visíveis             |
|                                                    |
|  Movimento:                                         |
|  [✓] Exibir posição anterior                       |
|  [ ] Exibir pontos-chave futuros                   |
|  [✓] Exibir indicador de velocidade em símbolos    |
|                                                    |
+--------------------------------------------------+
```

Quando D-Dia e H-Hora são preenchidos, o alternador de formato no slider habilita a opção D/H. Todos os indicadores de tempo passam a poder exibir no formato relativo (ex: `D+0/H+2:30` em vez de `15/03/2026 08:30`).

### 3.4 Propriedades Temporais no Painel de Atributos

As propriedades temporais ficam **na área do nome e descrição** da feição:

```
+------------------------------------------+
|  Nome:  [1º BIMec                    ]   |
|  Descrição: [Batalhão de Infantaria  ]   |
|                                          |
|  Início: [14/03/2026 06:00  ] [limpar]   |
|  Fim:    [15/03/2026 10:00  ] [limpar]   |
|  (vazio = existe em toda a linha do tempo)|
+------------------------------------------+
|  ... demais atributos da feição ...      |
+------------------------------------------+
```

**Interação:**

- Campos de data com datepicker ou digitação livre
- Botão "limpar" remove a data (feição passa a ser permanente)
- Se ambos vazios, feição é permanente (não afetada pela linha do tempo)
- Validação: início deve ser anterior ao fim

**Para feições com suporte a movimento** (`military_symbol`, `coordination_measure`, `point`), um botão "Definir Trajetória" aparece quando a feição ainda não tem trajetória. Quando já tem, a seção "Trajetória" aparece (ver seção 3.7.3).

**Para símbolos militares**, checkbox "Vincular status ao tempo" aparece com campo de data de transição (ver seção 2.4).

### 3.5 Atribuição de Tempo a Feições

O usuário atribui tempo de **três maneiras**:

#### 3.5.1 Via Painel de Atributos (individual)

Seleciona feição → preenche Início/Fim na área de nome e descrição.

#### 3.5.2 Via Seleção Múltipla (batch)

Seleciona múltiplas feições (retângulo de seleção ou Ctrl+click) → painel de atributos exibe campos temporais compartilhados:

- **Início / Fim**: campos de data aplicados a todas as feições selecionadas
- **"Limpar tempo"**: remove propriedades temporais de todas as selecionadas (voltam a ser permanentes)

#### 3.5.3 Via Camada (operação batch)

No painel de camadas, opção de definir tempo para toda a camada. Essa é uma **operação batch** — aplica `temporalInicio`/`temporalFim` a todas as feições da camada que ainda não possuem valores temporais individuais. A camada em si **não armazena propriedades temporais** — o tempo é sempre por feição.

### 3.6 Indicadores Visuais no Mapa

Quando a linha do tempo está ativa, feições ganham indicadores visuais de estado temporal:

**Visibilidade:**

| Estado | Visual | Descrição |
|--------|--------|-----------|
| **Ativa** | Opacidade 100%, cor normal | Feição está dentro da janela temporal |
| **Futura** | Opacidade 30%, contorno tracejado | Feição ainda não atingiu seu `temporalInicio`. Visível apenas no modo Janela |
| **Passada** | Opacidade 20%, dessaturada | Feição já ultrapassou seu `temporalFim`. Visível apenas no modo Janela |
| **Permanente** | Opacidade 100%, pequeno ícone de relógio no canto | Feição sem dados temporais (sempre visível) |

**Movimento (visíveis ao selecionar uma feição com trajetória):**

| Indicador | Visual | Descrição |
|-----------|--------|-----------|
| **Posição interpolada** | Símbolo na posição calculada para o tempo atual | Feição com trajetória — posição via `turf.along()` sobre a rota. Sempre visível |
| **Rastro** | Subconjunto da rota já percorrido, como linha tracejada cinza (1px) | Do primeiro ponto-chave até a posição atual ao longo da rota. **Visível ao selecionar a feição** |
| **Rota completa** | Linha fina semi-transparente mostrando o caminho inteiro | **Visível ao selecionar a feição** |
| **Posição anterior** | Símbolo semi-transparente (20%) na posição do ponto-chave anterior | Mostra de onde a feição veio. Configurável on/off |
| **Pontos-chave futuros** | Pontos pequenos semi-transparentes (15%) nas posições futuras | Mostra onde a feição estará nos próximos pontos-chave. Configurável on/off |
| **Indicador de velocidade** | Linha sem ponta, proporcional à velocidade, tangente à rota | Símbolo militar com trajetória e velocidade > 0. Sempre visível |

**Exemplo visual de movimento (feição selecionada):**

```
Símbolo com 3 pontos-chave: ZRn → LP → Obj ALFA
Linha do tempo no momento 15/03 08:00 (metade entre LP e Obj)

    (pos. anterior 20%)     (rastro tracejado)        (símbolo 100%)     (ponto futuro 15%)
        ZRn ─ ─ ─ ─ ─ ─ ─ ─ ─ LP ─ ─ ─ ─ ─ ─ ─ ● 1ºBIMec ─ ─ ─ ─ ○ Obj ALFA
     (14/03 06:00)          (15/03 06:00)         (15/03 08:00)       (15/03 10:00)
```

Os indicadores de posição anterior e pontos-chave futuros são **configuráveis** nas opções da linha do tempo. Rastro e rota completa aparecem automaticamente ao selecionar a feição.

### 3.7 Definição de Trajetória (UI)

O usuário define a trajetória de uma feição móvel em **três etapas**: desenhar a rota, marcar pontos-chave, e opcionalmente editar.

#### 3.7.1 Desenhar Trajetória

1. Selecionar a feição móvel no mapa
2. Clicar **"Definir Trajetória"** (botão no painel de atributos)
3. Mapa entra em modo de desenho (igual a desenhar uma linha):
   - Clicar para adicionar vértices da rota
   - Vértices definem o caminho real (estradas, contornos, curvas)
   - Double-click para finalizar
4. Sistema pede timestamps para o primeiro e último vértice (início e fim do movimento)
5. Pronto — feição tem trajetória com 2 pontos-chave (início e fim)

#### 3.7.2 Adicionar Pontos-chave Intermediários

Após a rota desenhada, o usuário marca pontos ao longo dela com timestamps:

**Via slider (método rápido):**

1. Arrastar slider para o tempo desejado
2. Clicar na rota no ponto onde a feição deve estar naquele momento
3. Ponto-chave criado automaticamente na posição clicada com o tempo do slider
4. Toast: "Posição marcada em 50% da rota — 15/03 06:00"

**Via painel:**

Clicar "Adicionar posição" no painel de atributos → definir posição (% ao longo da rota ou clicar na rota no mapa) e tempo.

#### 3.7.3 Painel de Trajetória

Quando uma feição com trajetória está selecionada, o painel de atributos exibe:

```
+------------------------------------------+
|  Nome:  [1º BIMec                    ]   |
|  Descrição: [                        ]   |
|  Início: [14/03/2026 06:00  ]            |
|  Fim:    [15/03/2026 10:00  ]            |
|                                          |
|  ▼ Trajetória                            |
|  ┌────────────────────────────────────┐  |
|  │ ● 0%   14/03 06:00  ZRn       [🗑]│  |
|  │ ● 35%  15/03 05:00  PtLib     [🗑]│  |
|  │ ● 50%  15/03 06:00  LP        [🗑]│  |
|  │ ● 100% 15/03 10:00  Obj       [🗑]│  |
|  └────────────────────────────────────┘  |
|  Rota: 12 vértices, 23.4 km             |
|                                          |
|  [+ Posição no tempo atual do slider]    |
|  [Editar rota]  [Remover trajetória]     |
+------------------------------------------+
```

#### 3.7.4 Editar Trajetória

Clicar **"Editar rota"** ativa modo de edição visual no mapa:

```
    ● Ponto-chave (laranja, com timestamp)
    │
    ◆ Vértice de forma (verde, arrastável)
    │
    ◆ Vértice de forma (verde, arrastável)
    │
    ● Ponto-chave (laranja, com timestamp)

Interações:
  - Arrastar ◆ ou ● = reposicionar vértice
  - Clicar no segmento entre dois pontos = inserir novo vértice
  - Clicar ◆ = promover a ponto-chave (pede timestamp)
  - Delete em ◆ = remover vértice de forma
  - Delete em ● = rebaixar a vértice (remove timestamp, mantém vértice)
  - Clicar no timestamp de ● = editar tempo
```

#### 3.7.5 Gravar Posição via Linha do Tempo (atalho)

Quando uma feição com trajetória está selecionada e a linha do tempo ativa:

```
+============================================================================+
| [◀] [▶/⏸] [▶▶]  ═══════════●══════════════════════  15/03 08:30          |
|                                        [ Marcar posição atual (Enter) ]    |
+============================================================================+
```

O botão "Marcar posição atual" aparece quando o slider está em um ponto da rota que ainda não tem ponto-chave. Pressionar `Enter` marca a posição atual na rota com o tempo do slider.

### 3.8 Indicador de Tempo no Mapa

Badge compacto no canto superior esquerdo do mapa quando a linha do tempo está ativa:

```
+---------------------------+       +---------------------------+
| 📅 15/03/2026 08:30       |  ou   | 📅 D+0/H+2:30            |
+---------------------------+       +---------------------------+
```

Formato acompanha o alternador selecionado (data/hora ou D/H). Atualiza em tempo real conforme o slider se move. Útil para screenshots e PDF — identifica o momento representado.

### 3.9 Atalhos de Teclado

Atalhos disponíveis quando a linha do tempo está ativa e o foco não está em um campo de texto:

| Tecla | Ação | Condição |
|-------|------|----------|
| `Space` | Reproduzir / Pausar animação | Linha do tempo ativa |
| `→` | Avançar 1 unidade de divisão | Linha do tempo ativa |
| `←` | Retroceder 1 unidade de divisão | Linha do tempo ativa |
| `Shift+→` | Avançar 5 unidades de divisão | Linha do tempo ativa |
| `Shift+←` | Retroceder 5 unidades de divisão | Linha do tempo ativa |
| `Enter` | Marcar posição atual na trajetória | Feição com trajetória selecionada + slider em ponto sem ponto-chave |

**Conflitos:** Esses atalhos só são ativos quando a linha do tempo está visível e o foco do teclado não está em um campo de input/textarea. Caso contrário, o comportamento padrão dos atalhos prevalece.

---

## 4. Integrações

### 4.1 Integração com Briefing

Quando um mapa tem controle temporal ativo, cada slide do briefing pode definir um **subconjunto temporal**:

**Modos de tempo por slide:**

| Modo | Descrição |
|------|-----------|
| **Instantâneo** | Um único ponto no tempo (1 unidade). O slide mostra exatamente aquele momento |
| **Intervalo** | Define `tempoInicio` e `tempoFim` do subconjunto. O tempo pode avançar automaticamente dentro do intervalo |
| **Sem tempo** | Slide não altera o estado temporal (mantém o do slide anterior) |

**Modelo de dados:** Ver §2.6 para os campos armazenados em cada slide.

**Captura de estado temporal por slide:**

- Botão "Capturar Tempo" salva o estado atual da linha do tempo no slide
- O usuário pode configurar modo Instantâneo (1 momento) ou Intervalo (faixa de tempo)
- Modo e parâmetros editáveis após a captura

**Transição entre slides:**

Ao transicionar de um slide para outro durante a apresentação, o sistema anima:

1. Câmera/posição do mapa (já existente)
2. **Tempo do slider**: interpolação suave entre o tempo do slide A e do slide B
3. Feições aparecem/desaparecem gradualmente durante a transição

**Reprodução automática temporal:** Opção por slide — ao chegar no slide, o tempo avança automaticamente de `tempoInicio` até `tempoFim` antes de passar ao próximo slide. O apresentador pode pausar e controlar o ritmo.

### 4.2 Integração com Exportação PDF e Imagem

O PDF/imagem exportado respeita o estado temporal:

**Comportamento:**

- Se a linha do tempo está ativa, o PDF/imagem exporta apenas as feições visíveis no momento atual do slider
- Feições móveis aparecem na posição calculada para o tempo atual
- O indicador de tempo (seção 3.8) aparece como elemento cartográfico
- Rastro incluído se a feição está selecionada

**Opções no diálogo de exportação:**

- "Exportar momento atual" (padrão) — instantâneo do tempo atual
- "Exportar sem filtro temporal" — ignora a linha do tempo, exporta tudo

**Metadados:**

- Rodapé inclui datetime do momento exportado
- Se formato GDH ativo, usa GDH no rodapé

### 4.3 Integração com Importação

#### GPX (prioridade)

- Trackpoints (`<trkpt>`) com elemento `<time>` são mapeados automaticamente para pontos-chave de posição
- GPX tracks geram feições do tipo `point` com pontos-chave pré-populados a partir dos timestamps de cada trackpoint
- Ao importar GPX com timestamps, o sistema sugere ativar a linha do tempo automaticamente e configura `temporalInicio`/`temporalFim` baseado no range dos timestamps do arquivo
- Unidade de divisão sugerida automaticamente baseada no range (horas para tracks de um dia, dias para tracks longos, minutos para tracks curtos)
- O resultado é uma feição animada — ao reproduzir a linha do tempo, o ponto percorre o track no mapa

#### GeoJSON

- Na UI de importação, o usuário pode mapear campos do GeoJSON para `temporalInicio`/`temporalFim`
- Se campos `temporal_inicio` e `temporal_fim` existirem nas properties, são mapeados automaticamente

#### KML

- `<TimeSpan>` mapeia para `temporalInicio`/`temporalFim`
- `<TimeStamp>` mapeia para `temporalInicio` com `temporalFim = null`

#### CSV

- Na UI de importação, o usuário seleciona quais colunas correspondem a data início e fim
- Formatos de data reconhecidos: ISO 8601, DD/MM/YYYY HH:MM, timestamps Unix

#### .ebgeo

- Configuração temporal do mapa e propriedades temporais das feições salvos integralmente
- Compatibilidade retroativa: projetos sem dados temporais abrem normalmente

### 4.4 Integração com Análise

Ferramentas de análise (LOS, visibilidade, buffer, Voronoi etc.) ganham opções temporais quando a linha do tempo está ativa:

| Opção | Descrição | Default |
|-------|-----------|---------|
| **Usar feições do momento atual** | Análise considera apenas feições visíveis no tempo atual do slider | Sim (quando timeline ativo) |
| **Usar todas as feições** | Análise ignora filtro temporal e usa todas as feições | Não |
| **Herdar propriedades temporais** | Resultado da análise herda `temporalInicio`/`temporalFim` das feições de entrada | Não |

**Exemplo:** Buffer de uma posição que existe de 06:00 a 10:00 → se "Herdar" ativo, o polígono de buffer também existe de 06:00 a 10:00 e desaparece fora desse intervalo.

### 4.5 Integração com Camadas

| Cenário | Comportamento |
|---------|--------------|
| Camada visível, feição dentro do tempo | Feição **visível** |
| Camada visível, feição fora do tempo | Feição **oculta** |
| Camada oculta, feição dentro do tempo | Feição **oculta** (camada prevalece) |

A visibilidade de camada prevalece sobre o filtro temporal — se a camada está desligada, nenhum filtro temporal a ativa.

### 4.6 Integração com Mapas

Cada mapa pode ter sua própria configuração temporal independente. Ao trocar de mapa:

- A linha do tempo muda para a configuração do novo mapa (ou desaparece se o mapa não tem linha do tempo)
- O estado temporal do mapa anterior é preservado

### 4.7 Integração com Seleção e Edição

- Feições **ocultas pelo filtro temporal** não podem ser selecionadas por click ou retângulo de seleção
- **Snapping** ignora feições ocultas pelo filtro temporal — snap opera apenas sobre feições visíveis no momento atual
- A **busca** (search) encontra feições independentemente do filtro temporal, mas indica o intervalo no resultado
- O **Ctrl+Z** (undo) desfaz atribuições temporais como qualquer outra edição de propriedade
- **Copiar/Colar** preserva propriedades temporais da feição original

### 4.8 Integração com Tabela de Atributos

A tabela de atributos ganha duas novas colunas opcionais:

| Coluna | Conteúdo |
|--------|----------|
| **Início** | Data/hora de início formatada (ou "—" se permanente) |
| **Fim** | Data/hora de fim formatada (ou "—" se permanente) |

Filtro na tabela: "Mostrar apenas feições do momento atual" (toggle).

**Trajetória:** Dados de trajetória (rota, pontos-chave) não aparecem como colunas na tabela de atributos. A trajetória é visualizada e editada apenas pelo painel de atributos da feição e pelo mapa.

### 4.9 Integração com 3D (Cesium) e 360°

O módulo temporal **não se aplica** aos modos 3D (Cesium) e 360° (Street View):

- **Cesium 3D:** Sem filtragem temporal. Marcadores, viewsheds e medições 3D não possuem propriedades temporais
- **Street View 360°:** Sem filtragem temporal. Marcadores e orientações 360° não possuem propriedades temporais
- O controle temporal é exclusivo do **mapa 2D (MapLibre)**
- Ao trocar para modo 3D ou 360, a barra de linha do tempo fica oculta e o filtro temporal suspenso

---

## 5. Fluxos de Uso

### 5.1 Fluxo: Configurar Linha do Tempo e Atribuir Tempo

1. Abre mapa
2. Ativa linha do tempo via painel de mapas no sidebar
3. Configura: Início `14/03/2026 06:00`, Fim `16/03/2026 00:00`, Unidade: Horas
4. Seleciona feição → preenche Início e Fim na área de nome/descrição
5. Arrasta slider → feição aparece/desaparece conforme o tempo

### 5.2 Fluxo: Definir Trajetória de Unidade

1. Seleciona símbolo militar no mapa
2. Clica "Definir Trajetória" no painel de atributos
3. Desenha a rota no mapa: ZRn → estrada → cruzamento → PtLib → LP → terreno aberto → Obj ALFA
4. Double-click para finalizar. Sistema pede: início `14/03 06:00`, fim `15/03 10:00`
5. Trajetória criada com 2 pontos-chave (início e fim)
6. Para marcar pontos intermediários: arrasta slider para `15/03 05:00`, clica na rota no PtLib → ponto-chave intermediário
7. Repete para LP (`15/03 06:00`)
8. **Reproduz** → vê o símbolo percorrendo a rota desenhada (estrada, curvas)
9. Seleciona a feição → rastro tracejado aparece mostrando o caminho já percorrido
10. Direção e velocidade do símbolo atualizam dinamicamente — direção segue a tangente à rota. Símbolo re-renderizado com novo bearing e velocidade

### 5.3 Fluxo: Editar Trajetória Existente

1. Seleciona feição com trajetória
2. Clica "Editar rota" no painel
3. Mapa mostra vértices: pontos-chave (laranja) e vértices de forma (verde)
4. Arrasta vértice verde para ajustar o caminho (contornar obstáculo)
5. Clica no segmento da rota para inserir novo vértice
6. Clica em vértice verde para promover a ponto-chave (atribuir timestamp)
7. Clica fora ou pressiona `Esc` para sair do modo de edição

### 5.4 Fluxo: Importar GPX Animado

1. Importa arquivo GPX com trackpoints timestamped
2. Sistema detecta timestamps e sugere ativar linha do tempo
3. Linha do tempo configurada automaticamente (início = primeiro timestamp, fim = último)
4. Unidade de divisão sugerida baseada no range (horas para tracks de um dia)
5. **Reproduz** → ponto percorre o track animado no mapa

### 5.5 Fluxo: Briefing com Controle Temporal

1. Mapa com linha do tempo ativa
2. Cria briefing
3. Slide 1: posiciona slider em `14/03 06:00`, captura como **Instantâneo** → slide mostra situação estática naquele momento
4. Slide 2: define **Intervalo** `15/03 06:00` a `15/03 10:00` com reprodução automática
5. Inicia apresentação:
   - Slide 1: mapa mostra situação estática em 14/03 06:00 — todas as feições daquele momento
   - Slide 2: tempo avança automaticamente de 06:00 a 10:00 — unidades se movem ao longo dos eixos no mapa em tempo real
6. Apresentador pode pausar no meio do Slide 2 para discutir

### 5.6 Fluxo: Exportar PDF do Momento Atual

1. Posiciona slider no momento desejado (ex: `15/03 08:00`)
2. Exporta PDF
3. PDF contém apenas feições visíveis naquele momento
4. Indicador de tempo no canto identifica o momento
5. Feições móveis na posição calculada para aquele momento

### 5.7 Fluxo: Análise com Feições Temporais

1. Linha do tempo ativa, slider em `15/03 08:00`
2. Executa análise de buffer
3. Opção "Usar feições do momento atual": sim → buffer calcula sobre feições visíveis
4. Opção "Herdar propriedades temporais": sim → buffer herda início/fim das feições
5. Resultado: polígono de buffer aparece apenas no mesmo intervalo temporal das feições de entrada

### 5.8 Fluxo: Desativar Linha do Tempo

1. Usuário desativa linha do tempo via painel de mapas no sidebar
2. Todas as feições ficam visíveis
3. Feições com trajetória voltam à posição do primeiro ponto-chave (início da rota)
4. Barra de linha do tempo recolhe com animação
5. Dados temporais e trajetórias preservados para reativação futura

### 5.9 Fluxo: Atribuição em Massa

1. Ativa a linha do tempo e configura início/fim
2. Seleciona todas as feições de uma camada (Ctrl+A com camada ativa)
3. Painel de atributos exibe campos temporais compartilhados → preenche início/fim
4. Todas as feições selecionadas recebem o intervalo temporal
5. Para refinamento individual, clica em feição específica e ajusta no painel

### 5.10 Fluxo: Status Planejado→Presente com Vínculo Temporal

1. Cria símbolo militar com status "Planejado" (tracejado)
2. No painel de atributos, marca "Vincular status ao tempo"
3. Define data de transição: `15/03/2026 06:00` (H-Hora)
4. Arrasta slider antes de `15/03 06:00` → símbolo renderizado como **planejado** (tracejado)
5. Arrasta slider após `15/03 06:00` → símbolo muda automaticamente para **presente** (contínuo)
6. Transição é visual — o SIDC é atualizado e o milsymbol é re-renderizado

---

## 6. Requisitos Funcionais

### RF-01: Configuração Temporal do Mapa

| ID | Requisito | Critério de Aceitação |
|----|-----------|----------------------|
| RF-01.1 | Habilitar/desabilitar controle temporal por mapa | Toggle no painel de mapas do sidebar. Estado persistido no IndexedDB |
| RF-01.2 | Definir início e fim da linha do tempo | Campos datetime no painel de configuração. Início < Fim |
| RF-01.3 | Definir unidade de divisão | Opções: minutos, horas, dias, semanas, meses. Persiste por mapa |
| RF-01.4 | Cada mapa tem configuração temporal independente | Trocar de mapa troca ou remove a linha do tempo |
| RF-01.5 | Configuração persistida no IndexedDB | Recarregar página restaura estado completo |
| RF-01.6 | Definir D-Dia e H-Hora (opcional) | Quando preenchidos, habilita formato D/H no alternador de exibição |
| RF-01.7 | Conversão automática D/H ↔ absoluto | D/H é formato de exibição; dados internos sempre ISO 8601 |

### RF-02: Propriedades Temporais em Feições

| ID | Requisito | Critério de Aceitação |
|----|-----------|----------------------|
| RF-02.1 | Definir temporalInicio/temporalFim na feição | Campos na área de nome/descrição do painel de atributos. Armazenados na feição |
| RF-02.2 | Feição sem tempo = permanente | Visível em qualquer momento da linha do tempo |
| RF-02.3 | Atribuir tempo a múltiplas feições | Seleção múltipla → painel de atributos exibe campos temporais compartilhados (início/fim) |
| RF-02.4 | Atribuir tempo via camada (batch) | Operação batch aplica início/fim a feições da camada sem tempo individual. Camada não armazena propriedades temporais |
| RF-02.5 | Remover propriedades temporais | Feição volta a ser permanente |
| RF-02.6 | Undo/redo de atribuições temporais | Ctrl+Z desfaz. Ctrl+Y refaz |

### RF-03: Controle de Linha do Tempo

| ID | Requisito | Critério de Aceitação |
|----|-----------|----------------------|
| RF-03.1 | Slider arrastável com marcações por unidade de divisão | Slider cobre início a fim. Marcações visíveis conforme unidade |
| RF-03.2 | Indicador de tempo atual | Alternador entre: data/hora, D/H (se configurado), GDH |
| RF-03.3 | Reproduzir/Pausar com velocidade variável | Velocidades: 0.5x, 1x, 2x, 5x, 10x. Indicador mostra velocidade atual |
| RF-03.4 | Botões avança/retrocede uma unidade | Step = unidade de divisão configurada |
| RF-03.5 | Três modos de exibição | Instante, Janela, Cumulativo. Alternar atualiza visibilidade imediatamente |
| RF-03.6 | Ativação via painel de mapas no sidebar | Botão/toggle na linha do mapa ativo no sidebar |
| RF-03.7 | Loop de animação (opcional) | Ao atingir fim, volta ao início e continua |
| RF-03.8 | Velocidade de reprodução persistida | Velocidade (0.5x–10x) salva na configuração temporal do mapa e restaurada ao reabrir |
| RF-03.9 | Atalhos de teclado | Space=play/pause, ←/→=step 1 unidade, Shift+←/→=step 5 unidades |

### RF-04: Filtragem Visual

| ID | Requisito | Critério de Aceitação |
|----|-----------|----------------------|
| RF-04.1 | Feições fora do tempo ficam ocultas | Não selecionáveis, não exportáveis (exceto se configurado) |
| RF-04.2 | Feições sem tempo permanecem visíveis | Configurável: checkbox "Feições sem tempo sempre visíveis" |
| RF-04.3 | Transição suave (fade) ao entrar/sair do tempo | Duração: 200ms. Desativável para performance |
| RF-04.4 | Visibilidade de camada prevalece sobre filtro temporal | Camada oculta = feição oculta independente de tempo |
| RF-04.5 | Snapping ignora feições ocultas pelo filtro temporal | Snap opera apenas sobre feições visíveis no momento atual |
| RF-04.6 | Módulo temporal exclusivo do mapa 2D | Ao entrar em modo 3D (Cesium) ou 360°, barra de linha do tempo fica oculta e filtro temporal suspenso. Ao retornar ao 2D, estado restaurado |

### RF-05: Trajetória (Posição Dinâmica no Tempo)

| ID | Requisito | Critério de Aceitação |
|----|-----------|----------------------|
| RF-05.1 | Desenhar trajetória para feição móvel | Modo de desenho de rota (polyline). Ao finalizar, pede timestamps de início e fim. Disponível para: `military_symbol`, `coordination_measure`, `point` |
| RF-05.2 | Interpolação ao longo da rota via `turf.along()` | Posição calculada sobre a geometria real da rota, não em linha reta |
| RF-05.3 | Adicionar pontos-chave intermediários na rota | Clicar na rota com slider posicionado = ponto-chave naquele ponto e tempo |
| RF-05.4 | Editar rota visualmente | Arrastar vértices, inserir novos, remover. Pontos-chave (laranja) e vértices de forma (verde) |
| RF-05.5 | Promover/rebaixar vértices | Clicar vértice de forma → promover a ponto-chave (pede timestamp). Delete em ponto-chave → rebaixa a vértice |
| RF-05.6 | Rastro do caminho percorrido | Subconjunto da rota já percorrido como linha tracejada. **Visível ao selecionar a feição** |
| RF-05.7 | Posição anterior | Símbolo semi-transparente na posição do ponto-chave anterior. Configurável on/off |
| RF-05.8 | Editar e remover pontos-chave | Cada ponto-chave pode ter tempo editado ou ser rebaixado a vértice |
| RF-05.9 | Undo/redo de operações de trajetória | Desenhar, editar rota e pontos-chave são desfazíveis via Ctrl+Z |
| RF-05.10 | Ao desativar linha do tempo, feição volta ao primeiro ponto-chave | Posição de repouso = início da rota |
| RF-05.11 | Remover trajetória | Botão remove rota e pontos-chave. Feição volta a ser estática |
| RF-05.12 | Rota completa visível quando selecionado | Linha fina semi-transparente mostra caminho inteiro da feição selecionada |

### RF-06: Simbologia Militar Temporal

| ID | Requisito | Critério de Aceitação |
|----|-----------|----------------------|
| RF-06.1 | Direção calculada dinamicamente da trajetória | Bearing da tangente à rota na posição atual. Atualiza conforme slider |
| RF-06.2 | Velocidade calculada dinamicamente da trajetória | km/h entre pontos-chave adjacentes. Atualiza conforme slider |
| RF-06.3 | GDH calculado do momento atual do slider | Formato DDHHMMZmmmAA do tempo atual |
| RF-06.4 | Indicador de velocidade renderizado | Linha sem ponta, proporcional à velocidade, na direção de movimento |
| RF-06.5 | Símbolo re-renderizado com propriedades dinâmicas | milsymbol chamado com `direction`, `speed`, `dtg` atualizados ao mover slider |
| RF-06.6 | Status operacional com vínculo temporal | Checkbox "Vincular status ao tempo" + datetime de transição. Antes: planejado (tracejado). Depois: presente (contínuo). SIDC atualizado automaticamente |

### RF-07: Integração com Briefing

| ID | Requisito | Critério de Aceitação |
|----|-----------|----------------------|
| RF-07.1 | Slide define subconjunto temporal | Modo Instantâneo (1 momento), Intervalo (faixa de tempo) ou Sem Tempo. Campos conforme §2.6 |
| RF-07.2 | Transição entre slides anima tempo do slider | Interpolação suave entre tempo do slide A e slide B |
| RF-07.3 | Reprodução automática temporal dentro de slide | Opção por slide: tempo avança automaticamente no intervalo |

### RF-08: Integração com Exportação/Importação

| ID | Requisito | Critério de Aceitação |
|----|-----------|----------------------|
| RF-08.1 | PDF/imagem exporta momento atual | Apenas feições visíveis no tempo do slider. Indicador de tempo como elemento cartográfico |
| RF-08.2 | Importação GPX gera pontos-chave automáticos | Trackpoints com timestamp → pontos-chave. Linha do tempo auto-configurada com range dos timestamps |
| RF-08.3 | Importação permite mapear campos de data | UI de mapeamento para GeoJSON e CSV: selecionar campos de início/fim |
| RF-08.4 | GeoJSON exporta temporalInicio/temporalFim | Campos `temporal_inicio`, `temporal_fim` nas properties |
| RF-08.5 | KML usa TimeSpan/TimeStamp | Compatibilidade com Google Earth temporal |
| RF-08.6 | .ebgeo preserva configuração temporal completa | Carregar projeto restaura estado temporal integralmente |

### RF-09: Integração com Análise

| ID | Requisito | Critério de Aceitação |
|----|-----------|----------------------|
| RF-09.1 | Opção: usar feições do momento atual | Toggle no painel de análise. Default = sim quando linha do tempo ativa |
| RF-09.2 | Opção: usar todas as feições | Toggle alternativo no painel de análise |
| RF-09.3 | Opção: herdar propriedades temporais | Resultado herda temporalInicio/temporalFim das feições de entrada |

---

## 7. Requisitos Não Funcionais

| ID | Requisito | Critério |
|----|-----------|----------|
| RNF-01 | Performance de filtragem | Filtragem de 1000 feições em < 50ms (sem perda de fluidez no arrasto do slider) |
| RNF-02 | Animação suave | Mínimo 30fps durante reprodução com 500 feições visíveis |
| RNF-03 | Persistência | Dados temporais salvos no IndexedDB. Nenhuma perda ao recarregar página |
| RNF-04 | Compatibilidade retroativa | Projetos .ebgeo sem dados temporais abrem sem erro. Linha do tempo fica desativada |
| RNF-05 | Responsividade | Linha do tempo adapta-se à largura da janela. Em telas < 768px, labels reduzidos |
| RNF-06 | Acessibilidade | Controles da linha do tempo navegáveis por teclado. Setas movem slider quando focado |
| RNF-07 | Memória | Módulo temporal não consome mais que 5MB adicionais de RAM para 5000 feições |
| RNF-08 | Schema migration | Migração v2.0 → v2.1 automática no startup. Arquivos sem dados temporais recebem defaults |

---

## 8. Cenários de Borda

| Cenário | Comportamento Esperado |
|---------|----------------------|
| Mapa sem configuração temporal | Linha do tempo não aparece. Feições sem filtro temporal |
| Feição com início > fim | Rejeitada na validação. Mensagem: "Início deve ser anterior ao fim" |
| Linha do tempo ativa + feição criada sem tempo | Feição é permanente (sempre visível). Toast sugere "Definir tempo?" |
| Copiar feição com tempo para mapa sem linha do tempo | Propriedades temporais copiadas mas sem efeito (linha do tempo inativa) |
| Undo após atribuir tempo a 50 feições | Operação atômica — Ctrl+Z desfaz todas as 50 atribuições de uma vez |
| Importar GPX com timestamps | Linha do tempo sugere ativação. Início/fim auto-configurados pelo range dos timestamps |
| Importar KML com TimeSpan | Propriedades mapeadas. Se não existe linha do tempo, sugere ativação |
| Abrir projeto com configuração temporal | Linha do tempo ativa automaticamente ao abrir o mapa |
| Feição com 1 único ponto-chave | Sem interpolação — feição permanece nessa posição. Necessário mínimo 2 para movimento |
| Trajetória com 0 vértices de forma | Rota é linha reta entre pontos-chave (sem curvas). Válido mas movimento retilíneo |
| Ponto-chave com tempo fora do range da linha do tempo | Aceito — linha do tempo pode expandir para acomodar |
| Arrastar feição com trajetória e linha do tempo ativa | Não move a feição livremente — usa "Editar rota" para modificar a trajetória |
| Copiar feição com trajetória | Trajetória completa (rota + pontos-chave) copiada. Feição colada aparece nos mesmos tempos |
| PDF exporta feição com trajetória | Feição aparece na posição calculada via turf.along() para o tempo do instantâneo. Rastro incluído se feição selecionada |
| Desativar linha do tempo com feições com trajetória | Todas visíveis, feições na posição do primeiro ponto-chave (início da rota) |
| Trocar de mapa com linha do tempo ativa | Linha do tempo muda para configuração do novo mapa ou desaparece |
| Slider em tempo onde nenhuma feição temporal existe | Mapa mostra apenas feições permanentes |
| Editar rota invalida posição de ponto-chave | Ponto-chave mantém sua fração (%) — posição geográfica recalculada automaticamente |
| Símbolo com vínculo temporal de status e sem trajetória | Status muda de planejado para presente no datetime de transição. Posição não muda |
| Símbolo com vínculo temporal de status e com trajetória | Status e posição mudam independentemente conforme slider avança |
| Entrar em modo 3D (Cesium) com linha do tempo ativa | Barra de linha do tempo fica oculta. Filtro temporal suspenso. Ao voltar ao 2D, restaura estado |
| Entrar em modo 360° com linha do tempo ativa | Mesmo comportamento: barra oculta, filtro suspenso, restaura ao voltar |
| Snap em feição oculta pelo filtro temporal | Snap ignora — opera apenas sobre feições visíveis no momento atual |

---

## 9. Glossário

| Termo | Definição |
|-------|-----------|
| **D-Dia** | Data âncora da operação. Quando definido, habilita o formato de tempo relativo D/H |
| **H-Hora** | Horário âncora dentro do D-Dia. `D+0/H+0` = D-Dia + H-Hora |
| **D/H** | Formato de tempo relativo. `D-1` = um dia antes do D-Dia. `H+2` = duas horas após H-Hora. `D+0/H+2` = mesmo dia, 2h depois |
| **GDH** | Grupo Data-Hora. Formato militar: DDHHMMZmmmAA. DD=dia, HHMM=hora/minuto UTC, Z=fuso (Zulu), mmm=mês (JAN/FEV/MAR/ABR/MAI/JUN/JUL/AGO/SET/OUT/NOV/DEZ), AA=ano. Ex: `150600ZMAR26` = 15 de março de 2026, 06:00 UTC |
| **Trajetória** | Rota desenhada no mapa (polyline) com pontos-chave ao longo dela. Define o caminho e a posição ao longo do tempo para uma feição móvel |
| **Ponto-chave** | Vértice da trajetória que possui timestamp. Define "onde a feição está em qual momento". Dois ou mais habilitam interpolação |
| **Vértice de forma** | Vértice da trajetória sem timestamp. Define a forma do caminho (curvas, contornos) mas não afeta o tempo |
| **Interpolação** | Cálculo da posição ao longo da rota via `turf.along()`, proporcional ao tempo decorrido entre pontos-chave adjacentes |
| **Rastro** | Subconjunto da rota já percorrido, exibido como linha tracejada desde o primeiro ponto-chave até a posição atual. Visível ao selecionar a feição |
| **Posição anterior** | Representação semi-transparente de uma feição na posição de um ponto-chave anterior, mostrando de onde ela veio |
| **Indicador de velocidade** | Linha sem ponta de seta partindo de um símbolo, tangente à rota, com comprimento proporcional à velocidade calculada |
| **Instantâneo** | Um único ponto no tempo capturado para um slide de briefing |
| **Linha do tempo** | Controle temporal — barra horizontal com slider que permite navegar pelo tempo |
| **Status operacional** | Estado do símbolo militar: planejado (tracejado) ou presente (contínuo). Pode ser vinculado ao tempo para transição automática |

---

## 10. Especificação Técnica de Implementação

### 10.1 Estrutura de Arquivos

```
src/js/temporal/
├── index.js                        # Barrel exports
├── temporal.engine.js              # Core: state management, filtering decisions
├── temporal.config.js              # Config validation, defaults, helpers
├── temporal-filter.js              # MapLibre filter expressions per feature type
├── temporal-format.js              # Formatação: GDH, D/H, data/hora
├── trajectory-interpolation.js     # turf.along() interpolation, bearing, velocity
├── temporal-milsymbol.js           # Dynamic symbol re-rendering (GDH, direction, speed, status)
├── timeline-control.js             # UI: barra horizontal, slider, botões (IControl do MapLibre)
├── timeline-config-modal.js        # UI: modal de configuração da linha do tempo
└── trajectory-editor.js            # UI: modo de desenho/edição de trajetória no mapa

src/css/
├── timeline.css                    # Estilos da barra de linha do tempo
└── trajectory.css                  # Estilos do editor de trajetória
```

### 10.2 EventTypes

Novos eventos a adicionar em `events/event_types.js`:

| Evento | Payload | Descrição |
|--------|---------|-----------|
| `TEMPORAL_CONFIG_CHANGED` | `{ mapId }` | Configuração temporal do mapa criada, atualizada ou removida |
| `TEMPORAL_POSITION_CHANGED` | `{ mapId, temporalAtual }` | Posição do slider alterada (emitido com debounce de 50ms durante arrasto) |
| `TEMPORAL_PLAYBACK_CHANGED` | `{ mapId, playing, speed }` | Estado de reprodução alterado (play/pause/velocidade) |
| `TRAJECTORY_CREATED` | `{ featureType, featureId }` | Trajetória adicionada a uma feição |
| `TRAJECTORY_UPDATED` | `{ featureType, featureId }` | Rota ou pontos-chave de trajetória modificados |
| `TRAJECTORY_REMOVED` | `{ featureType, featureId }` | Trajetória removida de uma feição |

### 10.3 Store Operations

Novas operações a adicionar via `store/temporal.operations.js` (exportadas pelo barrel `store/index.js`):

```javascript
// --- Configuração temporal do mapa ---
getTemporalConfig(mapId) → config | null
updateTemporalConfig(mapId, configPartial) → void
removeTemporalConfig(mapId) → void
isTemporalActive(mapId) → boolean

// --- Propriedades temporais de feições ---
setFeatureTemporalRange(featureType, featureId, inicio, fim) → void
clearFeatureTemporalRange(featureType, featureId) → void
batchSetTemporalRange(entries[], inicio, fim) → void  // entries = [{ featureType, featureId }]

// --- Trajetória ---
addTrajectory(featureType, featureId, rota, pontosChave) → void
updateTrajectoryRoute(featureType, featureId, rota) → void
addTrajectoryKeypoint(featureType, featureId, posicao, tempo) → void
updateTrajectoryKeypoint(featureType, featureId, index, { posicao?, tempo? }) → void
removeTrajectoryKeypoint(featureType, featureId, index) → void
removeTrajectory(featureType, featureId) → void

// --- Consultas ---
getVisibleFeaturesAtTime(mapId, timestamp) → Feature[]
interpolateFeaturePosition(feature, timestamp) → { lng, lat } | null
```

Todas as operações de escrita seguem o padrão `runTransaction` (persistence-first).

### 10.4 Schema `.ebgeo` — Alterações no `data.json`

#### Configuração temporal no objeto do mapa

A configuração temporal fica **diretamente no objeto do mapa**, no mesmo nível de `baseLayer`, `zoom`, etc:

```json
{
  "version": "2.1",
  "maps": {
    "mapName": {
      "baseLayer": "carta-topografica",
      "zoom": 10,
      "center_lat": -15.5,
      "center_long": -48.0,
      "features": { "...": "..." },

      "temporalAtivo": true,
      "temporalInicio": "2026-03-14T06:00:00Z",
      "temporalFim": "2026-03-16T00:00:00Z",
      "temporalAtual": "2026-03-15T08:30:00Z",
      "temporalUnidade": "horas",
      "dDay": "2026-03-15",
      "hHour": "06:00",
      "temporalModo": "instante",
      "temporalJanelaLargura": 30,
      "temporalAnimacaoSuave": true,
      "temporalMostrarPermanentes": true,
      "temporalExibirPosAnterior": true,
      "temporalExibirPontosFuturos": false,
      "temporalExibirVelocidade": true,
      "temporalLoop": false,
      "temporalVelocidadeReproducao": 1
    }
  }
}
```

#### Propriedades temporais na feição

Armazenadas em `feature.properties`, junto com `nome`, `descricao`, etc:

```json
{
  "type": "Feature",
  "properties": {
    "id": "uuid",
    "nome": "1º BIMec",
    "layerId": "default",
    "temporalInicio": "2026-03-14T06:00:00Z",
    "temporalFim": "2026-03-15T10:00:00Z",
    "statusTransicaoTempo": "2026-03-15T06:00:00Z",
    "trajetoria": {
      "rota": [[-47.5, -15.8], [-47.4, -15.7], [-47.3, -15.6]],
      "pontosChave": [
        { "posicao": 0.0, "tempo": "2026-03-14T06:00:00Z" },
        { "posicao": 0.5, "tempo": "2026-03-15T06:00:00Z" },
        { "posicao": 1.0, "tempo": "2026-03-15T10:00:00Z" }
      ]
    }
  },
  "geometry": { "type": "Point", "coordinates": [-47.5, -15.8] }
}
```

Coordenadas da `trajetoria.rota` seguem a mesma regra de arredondamento: **6 casas decimais**.

#### Dados temporais no slide do briefing

```json
{
  "briefings": [
    {
      "id": "uuid",
      "slides": [
        {
          "id": "uuid",
          "title": "Situação Inicial",
          "mode": "2d",
          "mapId": "uuid",
          "temporalMode": "instantaneo",
          "temporalInstante": "2026-03-14T06:00:00Z",
          "temporalIntervaloInicio": null,
          "temporalIntervaloFim": null,
          "temporalAutoReproducao": false
        }
      ]
    }
  ]
}
```

### 10.5 Schema Version e Migração

| Item | Valor |
|------|-------|
| **Versão atual** | `2.0` |
| **Nova versão** | `2.1` |
| **Arquivo de migração** | `src/js/store/migration/v2-to-v2.1.migration.js` |
| **Registro** | `migration.service.js` |
| **Execução** | Automática no startup |

**Defaults da migração (v2.0 → v2.1):**

- Mapas sem dados temporais: `temporalAtivo = false`, demais campos `null`
- Feições sem dados temporais: `temporalInicio = null`, `temporalFim = null`, `trajetoria = null`
- Slides sem dados temporais: `temporalMode = 'sem_tempo'`, demais campos `null`

**Compatibilidade retroativa:**

- Arquivos `.ebgeo` v2.0 sem dados temporais abrem normalmente — migração adiciona defaults
- Arquivos `.ebgeo` v2.1 com dados temporais abrem em versões futuras sem perda
- Feições sem `temporalInicio`/`temporalFim` são tratadas como permanentes (sempre visíveis)

### 10.6 Vite Chunk

O módulo temporal faz parte do chunk **`core`** — está sempre disponível quando a aplicação carrega. Não requer lazy loading porque:

- A decisão de exibir/ocultar a linha do tempo acontece no carregamento do mapa
- A filtragem temporal precisa estar disponível imediatamente ao abrir um projeto com dados temporais
- O editor de trajetória pode ser lazy-loaded se necessário (otimização futura)

### 10.7 GDH — Formato Detalhado

Formato: `DDHHMMZmmmAA`

| Componente | Descrição | Exemplo |
|------------|-----------|---------|
| `DD` | Dia do mês (01-31) | `15` |
| `HHMM` | Hora e minuto em UTC | `0600` |
| `Z` | Indicador de fuso horário Zulu (UTC) | `Z` |
| `mmm` | Abreviação do mês em português | `MAR` |
| `AA` | Últimos 2 dígitos do ano | `26` |

**Abreviações dos meses (português):**

`JAN`, `FEV`, `MAR`, `ABR`, `MAI`, `JUN`, `JUL`, `AGO`, `SET`, `OUT`, `NOV`, `DEZ`

**Exemplo:** `150600ZMAR26` = 15 de março de 2026, 06:00 UTC

**Conversão:** O sistema sempre armazena datetime em ISO 8601 (`2026-03-15T06:00:00Z`). O formato GDH é apenas para **exibição** — calculado em runtime pelo `temporal-format.js`.

### 10.8 Fases de Implementação

A implementação segue ordem de dependência — cada fase constrói sobre a anterior:

| Fase | Escopo | Dependências |
|------|--------|-------------|
| **1. Modelo de dados + persistência** | Campos temporais no mapa, feição e slide. Store operations. Migração v2.0→v2.1. Export/import `.ebgeo` | Nenhuma |
| **2. Filtragem temporal** | `temporal-filter.js`: expressões MapLibre para ocultar/exibir feições por tempo. Integração com layer manager. Modos instante/janela/cumulativo | Fase 1 |
| **3. UI da linha do tempo** | `timeline-control.js`: slider, botões, indicadores. `timeline-config-modal.js`: modal de configuração. Atalhos de teclado. CSS | Fase 2 |
| **4. Trajetória** | `trajectory-interpolation.js`: interpolação via `turf.along()`. `trajectory-editor.js`: modo de desenho/edição. Painel de trajetória no painel de atributos | Fase 2 |
| **5. Simbologia militar** | `temporal-milsymbol.js`: GDH, direção, velocidade dinâmicos. Status planejado/presente com vínculo temporal. Re-renderização com debounce | Fase 4 |
| **6. Integração briefing** | Dados temporais no slide. Transição animada entre tempos. Reprodução automática temporal | Fase 3 |
| **7. Import/export** | GPX com timestamps → pontos-chave. GeoJSON/KML/CSV mapeamento de campos temporais. PDF com estado temporal | Fase 1 |

Fases 4 e 3 podem ser desenvolvidas em paralelo (ambas dependem apenas da fase 2). Fase 7 pode iniciar junto com fase 3.
