# Análise OCOAV com IA — Plano de Implementação

## 1. Visão Geral

Automatizar a análise de terreno OCOAV integrada ao PITCIC, com arquitetura **frontend thin-client + backend inteligente**:

1. **Frontend (EBGeo Web)** — Coleta parâmetros do usuário (bbox, escalão, tipo de força, feições existentes no mapa), envia ao backend, e renderiza os resultados recebidos (relatório + camadas GeoJSON).
2. **Backend (Python/FastAPI)** — Recebe a requisição, consulta dados geoespaciais (pré-computados + on-demand), orquestra **agentes LLM especializados** via OLLAMA para cada fator OCOAV, consolida a análise, e retorna JSON estruturado com relatório + camadas GeoJSON prontas para abrir no EBGeo.
3. **OLLAMA** — Servidor de inferência local hospedado no mesmo servidor do backend. O frontend nunca se comunica diretamente com o OLLAMA.

**Princípio central:** O frontend não sabe que existe IA. Ele envia dados e recebe um relatório estruturado com camadas geográficas — como qualquer outro serviço de geoprocessamento. Toda a engenharia de prompt, orquestração de agentes, validação de JSON e comunicação com OLLAMA é responsabilidade exclusiva do backend.

### 1.1. O que é OCOAV

A sigla **OCOAV** é a adotada pela doutrina brasileira (EB70-MC-10.307, par. 2.2.16.5.2) para designar os cinco aspectos militares do terreno. É o equivalente brasileiro do OCOKA/OAKOC da doutrina americana (FM 5-33, FM 34-130):

| # | Sigla | Fator | O que se avalia | Equivalente OCOKA (EUA) |
|---|-------|-------|-----------------|------------------------|
| O | Observação e Campos de Tiro | Onde se pode ver o inimigo e empregar armas de tiro direto/indireto | Visibilidade, alcance de armas, ângulos mortos, posições de tiro | Observation & Fields of Fire |
| C | Cobertas e Abrigos | Proteção contra observação (coberta) e contra fogos (abrigo) | Vegetação, relevo, edificações que protegem tropas | Cover & Concealment |
| O | Obstáculos | Impedimentos naturais e artificiais ao movimento | Declividade, rios, áreas alagadas, vegetação densa, áreas urbanas | Obstacles |
| A | Acidentes Capitais | Posições cuja posse confere vantagem tática decisiva | Elevações dominantes, cruzamentos, pontes, passagens obrigatórias | Key Terrain |
| V | Vias de Acesso | Rotas de progressão para forças de qualquer tipo | Corredores de mobilidade, estradas, vales transitáveis | Avenues of Approach |

### 1.2. Inserção no PITCIC

O **PITCIC** (Processo de Integração Terreno, Condições Meteorológicas, Inimigo e Considerações Civis) é o processo sistemático pelo qual o Oficial de Inteligência (S2/G2) analisa os fatores ambientais para subsidiar a decisão do comandante. Possui 4 fases:

| Fase | Nome | Descrição |
|------|------|-----------|
| 1ª | Definição do Ambiente Operacional | Delimitar a área de interesse e área de influência |
| **2ª** | **Identificação dos Efeitos Ambientais** | **Análise OCOAV — escopo deste sistema** |
| 3ª | Avaliação da Ameaça | Doutrinas, capacidades e COAs do inimigo |
| 4ª | Integração | Cruzar terreno × ameaça → COAs inimigas mais prováveis |

A **2ª Fase** se subdivide em 5 etapas (Cap. VII, EB70-MC-10.307):

| Etapa | Descrição | Automatizável | Papel do sistema |
|-------|-----------|:------------:|------------------|
| 1 | Estudo das Considerações Civis (AECOPE) | Parcial | Dados de edificações e infraestrutura apoiam, mas a análise é sociopolítica |
| **2** | **Estudo dos Aspectos Gerais do Terreno (OCOAV)** | **Sim** | Dados geoespaciais + agentes LLM especializados |
| **3** | **Identificação de Corredores de Mobilidade, Acidentes Capitais e Vias de Acesso** | **Sim** | Backend computa corredores; agente LLM sintetiza |
| **4** | **Análise do Terreno (Calco de Restrição ao Movimento)** | **Sim** | Backend gera calco por cruzamento multicamada |
| 5 | Consolidação dos Efeitos Ambientais | Parcial | Agente consolidador pode redigir rascunho, mas o analista valida |

O sistema automatizado cobre integralmente as **Etapas 2, 3 e 4**, e fornece apoio parcial às Etapas 1 e 5.

### 1.3. Fundamentação Teórica Detalhada

#### Doutrina brasileira

- **EB70-MC-10.307** — Planejamento e Emprego da Inteligência Militar (2016). Manual de referência principal. Define OCOAV (par. 2.2.16.5.2), detalha as 5 etapas da 2ª Fase do PITCIC (Cap. VII), estabelece o Calco de Restrição ao Movimento como produto cartográfico obrigatório.
- **EB70-MC-10.336** — PITCIC. Detalha o processo completo em 4 fases.
- **EB70-MC-10.211** — PPCOT (2020). Contextualiza o OCOAV dentro do Processo de Planejamento e Condução de Operações Terrestres.
- **EB70-MC-10.202** — Operações Ofensivas e Defensivas (2017). Define como o terreno influencia a escolha de posições defensivas e eixos de progressão ofensiva.

#### Doutrina americana (referência comparativa)

- **FM 5-33** — Terrain Analysis. Detalha a metodologia OCOKA com exemplos de aplicação SIG.
- **FM 34-130** — Intelligence Preparation of the Battlefield (IPB). Equivalente americano do PITCIC.
- **ATP 2-01.3** — Intelligence Preparation of the Battlefield (2019). Atualização do FM 34-130.

#### Trabalhos acadêmicos

- **Veloza (2020)** — Dissertação de Mestrado (NOVA IMS/UNL). Demonstra viabilidade de automatização do Calco de Restrição ao Movimento com SIG, usando pesos multicritério para cruzamento de declividade, hidrografia, cobertura vegetal e malha viária. Valida a abordagem de classificação ternária (ADEQUADO/RESTRITIVO/IMPEDÍVEL).

#### Fundamentação da abordagem híbrida (computacional + LLM)

A análise OCOAV possui dois componentes distintos:

1. **Componente quantitativo** — Cálculos geoespaciais determinísticos: declividade, aspecto, proeminência, buffer de rios, classificação de obstáculos, identificação de corredores. Estes são computados pelo backend com algoritmos SIG tradicionais (GDAL, PostGIS) e produzem resultados reproduzíveis. **Devem ser pré-computados ao máximo.**

2. **Componente interpretativo** — Síntese tática: correlacionar os dados quantitativos com doutrina militar para produzir uma narrativa coerente. Exemplo: "A Cota 1180 domina o vale do Rio Paraíba, permitindo observação sobre a VA Principal por 5.2 km. A cobertura florestal na encosta sul (35%) oferece coberta para aproximação." Esta síntese é o papel dos **agentes LLM especializados**.

**O LLM NÃO faz cálculos geoespaciais.** Ele recebe dados pré-computados e produz interpretação tática. Os números vêm de algoritmos determinísticos; a IA contribui com narrativa, correlação e sugestão de feições.

#### Por que múltiplos agentes em vez de um prompt único?

Um prompt único para toda a análise OCOAV tem problemas com modelos locais:

| Problema | Prompt Único | Agentes Especializados |
|----------|-------------|----------------------|
| Tamanho do prompt | ~8.000 tokens (doutrina + dados + schema completo) → pode exceder context window eficaz | Cada agente recebe ~2.000-3.000 tokens focados no seu fator |
| Qualidade | Modelo tenta cobrir 5 fatores + calco + conclusão em uma resposta → superficial | Cada agente foca em 1 fator com profundidade |
| Confiabilidade JSON | Schema grande → mais erros de formato | Schemas menores e mais simples por agente |
| Paralelismo | Sequencial (1 chamada) | Agentes O, C, O, A, V podem rodar em paralelo |
| Fallback | Se falhar, perde tudo | Se 1 agente falhar, os outros 4 ainda funcionam |
| Tempo total | 1 chamada longa (~60-120s) | 5 em paralelo + 1 consolidação (~30-60s total) |

### 1.4. Papel do LLM local (OLLAMA)

O sistema utiliza um modelo de linguagem executado localmente via **OLLAMA**, hospedado no **mesmo servidor do backend**. O frontend nunca interage diretamente com o OLLAMA.

| Aspecto | OLLAMA Local | API Cloud |
|---------|-------------|-----------|
| Privacidade | Dados nunca saem da rede | Dados trafegam para servidores externos |
| Custo | Zero custo por consulta | ~$0.02-0.10 por análise |
| Latência | Depende do hardware local (10-60s) | ~5-15s com boa conexão |
| Disponibilidade | Funciona offline | Requer internet |
| Qualidade | Inferior a modelos frontier | Superior (GPT-5, Claude Sonnet) |
| Classificação | Adequado para dados sensíveis/militares | Pode violar políticas de segurança da informação |

A escolha por OLLAMA é estratégica: dados geoespaciais militares podem ter classificação que impede envio para servidores externos.

#### Modelos recomendados (referência para o backend)

A escolha do modelo é configuração do backend. O frontend não tem conhecimento nem controle sobre qual modelo é usado.

| Modelo | Parâmetros (ativos) | VRAM Mín. | Context Window | Qualidade JSON | Recomendação |
|--------|-----------|-----------|----------------|----------------|-------------|
| `qwen3.5:9b` | 9B (dense) | 6-8 GB | 256K | Muito boa | Melhor custo-benefício — benchmarks acima de modelos 10× maiores |
| `qwen3.5:27b` | 27B (dense) | 18-22 GB | 256K | Excelente | Recomendado para produção — melhor raciocínio |
| `qwen3:14b` | 14B (dense) | 10 GB | 128K | Muito boa | Alternativa estável, native tool calling |
| `qwen3:32b` | 32B (dense) | 22 GB | 128K | Excelente | Alto desempenho |
| `deepseek-r1:32b` | 32B (dense, distilled) | 22 GB | 128K | Muito boa | Melhor raciocínio chain-of-thought |
| `gemma3:27b` | 27B (dense) | 22 GB | 128K | Muito boa | Alternativa Google, bom em instruções |
| `qwen3.5:35b` | 35B total / 3B ativos (MoE) | 24 GB | 256K | Boa | MoE eficiente se tiver VRAM |
| `mistral-small3.1` | 24B (dense) | 16-18 GB | 128K | Boa | Alternativa europeia |

**Requisito mínimo:** Modelo com >= 8B parâmetros ativos e context window >= 8K tokens.

**Nota sobre qualidade:** Modelos locais não possuem conhecimento profundo de doutrina militar brasileira. A estratégia para compensar:
1. Doutrina embutida no prompt de cada agente (extraída do EB70-MC-10.307)
2. Schema JSON rígido com validação no backend
3. Agentes especializados (prompt focado) em vez de prompt genérico

### 1.5. Decisões de Design

| Aspecto | Decisão | Justificativa |
|---------|---------|---------------|
| Responsabilidade do frontend | Thin-client: envia parâmetros, renderiza resultado | Desacopla IA do GIS; frontend não sabe que existe LLM |
| Responsabilidade do backend | Coleta, prompt, agentes, validação, montagem JSON | Toda complexidade IA fica no backend Python |
| Comunicação frontend↔backend | HTTP async (long-running task) | Análise leva 30-120s; não pode bloquear |
| Modelo LLM | Configuração do backend | Frontend não escolhe nem sabe qual modelo é usado |
| Orquestração LLM | Multi-agentes (1 por fator OCOAV + consolidador) | Paralelismo, fallback parcial, prompts focados |
| Dados geoespaciais | Pré-computados ao máximo; on-demand apenas o contextual | Reduz latência — cálculos pesados feitos offline/em cache |
| Formato de resultado | Relatório JSON + camadas GeoJSON completas | Frontend cria camadas no mapa, não apenas texto |
| Terminologia | OCOAV (doutrina brasileira) | EB70-MC-10.307 |

---

## 2. Arquitetura

### 2.1. Visão geral da arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│                    SERVIDOR (Python/FastAPI)                     │
│                                                                  │
│  ┌──────────────┐   ┌──────────────────────────────────────┐    │
│  │ Dados Pré-   │   │ Orquestrador OCOAV                   │    │
│  │ Computados   │   │                                       │    │
│  │              │   │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐    │    │
│  │ • DEM/Slope  │──▶│  │Ag.O │ │Ag.C │ │Ag.O │ │Ag.A │    │    │
│  │ • Aspecto    │   │  │Obs. │ │Cob. │ │Obst.│ │Acid.│    │    │
│  │ • Hidrografia│   │  └──┬──┘ └──┬──┘ └──┬──┘ └──┬──┘    │    │
│  │ • Vias       │   │     │       │       │       │         │    │
│  │ • Land Cover │   │  ┌──┴──┐    │    ┌──┴──┐    │         │    │
│  │ • Edificações│   │  │Ag.V │    │    │     │    │         │    │
│  │              │   │  │Vias │    │    │     │    │         │    │
│  └──────────────┘   │  └──┬──┘    │    │     │    │         │    │
│                     │     └───────┴────┴─────┴────┘         │    │
│  ┌──────────────┐   │              ▼                         │    │
│  │ Cálculo      │   │     ┌──────────────┐                  │    │
│  │ On-Demand    │   │     │  Ag. Consol.  │                  │    │
│  │              │   │     │  (consolida)  │                  │    │
│  │ • Corredores │   │     └──────┬───────┘                  │    │
│  │ • Chokepoints│   │            ▼                           │    │
│  │ • Calco      │   │  ┌─────────────────┐                  │    │
│  └──────────────┘   │  │ Montador JSON + │                  │    │
│                     │  │ GeoJSON Layers   │                  │    │
│  ┌──────────────┐   │  └────────┬────────┘                  │    │
│  │   OLLAMA     │◀──│──────────/                            │    │
│  │ (inferência) │   └──────────────────────────────────────┘    │
│  └──────────────┘                     │                          │
└───────────────────────────────────────┼──────────────────────────┘
                                        │ HTTP (async)
                                        ▼
┌───────────────────────────────────────────────────────────────────┐
│                     FRONTEND (EBGeo Web)                          │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ ocoav-panel.js                                               │  │
│  │  • Configuração: escalão, tipo de força, bbox                │  │
│  │  • Envia: POST /api/ocoav/analyze (parâmetros + feições)    │  │
│  │  • Polling: GET /api/ocoav/status/{taskId}                   │  │
│  │  • Recebe: relatório JSON + camadas GeoJSON                  │  │
│  ├─────────────────────────────────────────────────────────────┤  │
│  │ ocoav-results.js → renderiza relatório com seções           │  │
│  │ ocoav-layers.js  → cria camadas MapLibre com GeoJSON        │  │
│  │ ocoav-features.js → materializa feições sugeridas no store  │  │
│  └─────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
```

### 2.2. Módulos do frontend (EBGeo Web)

```
src/js/ocoav/
├── index.js                # Barrel + registerAlgorithm() side-effect
├── ocoav.algorithm.js      # Definição do algoritmo para o registry
├── ocoav-panel.js          # Painel: parâmetros + bbox + botão ANALISAR
├── ocoav-client.js         # Cliente HTTP: POST analyze + polling status
├── ocoav-results.js        # Renderiza relatório com seções colapsáveis
├── ocoav-layers.js         # Cria camadas MapLibre a partir do GeoJSON recebido
└── ocoav-features.js       # Materializa feições sugeridas no store

src/css/ocoav.css           # Estilos BEM do painel e relatório
```

**Removidos vs. versão anterior:** Não existem mais `ai.service.js`, `ai.config.js`, `ai-json-repair.js`, `ocoav-prompt.js`, `ocoav-context.js`, `ocoav-validator.js` no frontend. Toda essa lógica migrou para o backend.

**Novo módulo `ocoav-layers.js`:** Recebe GeoJSON do backend e cria camadas MapLibre no mapa (calco de restrição, pontos dominantes, vias de acesso, obstáculos, etc.).

### 2.3. Arquivos modificados no frontend

| Arquivo | Mudança |
|---------|---------|
| `src/js/processing/algorithms/index.js` | `import '../../ocoav/index.js'` |
| `src/js/config.js` | `services.ocoavApiUrl` (default `''`) |
| `vite.config.js` | Alias `@ocoav`; chunk `ocoav` em `ui-components` |
| CSS imports | `@import './ocoav.css'` |

### 2.4. Fluxo de dados

```
[1. Usuário configura escalão e tipo de força no painel]
[2. Usuário desenha bbox no mapa]
[3. Frontend coleta feições militares existentes dentro da bbox (store)]
        │
        ▼
[4. ocoav-client.js → POST /api/ocoav/analyze]
        │  Request: { bbox, echelon, forceType, userFeatures[], userAnalyses[] }
        │  Response: { taskId, estimatedTime }
        │
[5. Frontend inicia polling: GET /api/ocoav/status/{taskId}]
        │  Respostas intermediárias com progresso:
        │    { status: "processing", step: "collecting_data", progress: 0.15 }
        │    { status: "processing", step: "agent_observacao", progress: 0.30 }
        │    { status: "processing", step: "agent_cobertas", progress: 0.45 }
        │    { status: "processing", step: "agent_obstaculos", progress: 0.55 }
        │    { status: "processing", step: "agent_acidentes", progress: 0.65 }
        │    { status: "processing", step: "agent_vias", progress: 0.75 }
        │    { status: "processing", step: "consolidating", progress: 0.90 }
        │    { status: "completed", result: { ... } }
        │
[6. Frontend recebe resultado completo]
        │
        ├──▶ ocoav-results.js → renderiza relatório no sidebar
        │      5 seções OCOAV + Calco + conclusão + recomendações
        │
        ├──▶ ocoav-layers.js → cria camadas MapLibre
        │      Calco de restrição (polígonos coloridos)
        │      Pontos dominantes, cumeadas, vales
        │      Corredores de mobilidade, chokepoints
        │      Obstáculos hidrográficos
        │
        └──▶ ocoav-features.js → lista feições sugeridas
               Checkboxes → "Criar Feições" → addFeatures()
               Nova camada "OCOAV - {data}" com feições aprovadas
```

---

## 3. Backend Python (FastAPI)

### 3.1. Stack

| Componente | Tecnologia | Papel |
|------------|-----------|-------|
| Framework web | FastAPI | API REST async, WebSocket futuro |
| Tarefas async | Celery + Redis ou asyncio TaskGroup | Long-running analysis |
| Processamento geoespacial | GDAL/OGR, Rasterio, Fiona, Shapely, GeoPandas | Cálculos de terreno |
| Banco espacial | PostGIS | Consultas espaciais pré-computadas |
| Dados de elevação | SRTM 30m / ASTER GDEM | DEM, slope, aspect |
| Dados vetoriais | OpenStreetMap (via Overpass ou dump local) | Vias, edificações, hidrografia |
| Uso do solo | MapBiomas (Brasil) / ESA WorldCover | Cobertura vegetal |
| LLM | OLLAMA (HTTP local) | Inferência para agentes |
| Cache | Redis | Cache de dados pré-computados por tile/bbox |

### 3.2. Estratégia de pré-computação

O princípio é **pré-computar tudo que não depende do contexto da requisição** e calcular on-demand apenas o que é parametrizado.

#### Dados pré-computados (offline, em cache/PostGIS)

Estes dados são processados em batch e armazenados. A requisição apenas consulta:

| Dado | Fonte | Processamento offline | Armazenamento |
|------|-------|----------------------|---------------|
| Elevação (DEM) | SRTM 30m | Download + mosaico de tiles | Raster tiles / COG |
| Declividade | SRTM 30m | `gdaldem slope` em todas as tiles | Raster tiles |
| Aspecto | SRTM 30m | `gdaldem aspect` + binning 8 octantes | Raster tiles |
| Pontos dominantes | DEM | Topographic prominence >= 30m | PostGIS (pontos) |
| Linhas de cumeada | DEM | Flow direction + ridge extraction | PostGIS (linhas) |
| Vales | DEM | Inverted DEM + flow accumulation | PostGIS (linhas) |
| Saddle points | DEM | Local minima em cumeadas | PostGIS (pontos) |
| Rios e lagos | OSM | Dump OSM → filtro waterway/water | PostGIS (linhas/polígonos) |
| Largura de rios | OSM + DEM | Strahler order → width estimation | PostGIS (atributo) |
| Áreas alagadas | OSM + MapBiomas | Cross-reference | PostGIS (polígonos) |
| Rodovias | OSM | Dump OSM → filtro highway | PostGIS (linhas) |
| Cruzamentos viários | OSM | Graph analysis (degree >= 3) | PostGIS (pontos) |
| Pontes | OSM | Spatial join roads × rivers | PostGIS (pontos) |
| Uso do solo | MapBiomas / WorldCover | Reclassificação em 5 classes | Raster tiles |
| Obstrução visual | Land cover + canopy height | Cálculo de % obstrução | Raster tiles |
| Edificações | OSM | Dump OSM → filtro building | PostGIS (polígonos) |
| Clusters de edificações | OSM | DBSCAN clustering | PostGIS (pontos com atributos) |

#### Dados calculados on-demand (dependem de parâmetros)

Estes dependem do `echelon`, `forceType` e/ou `bbox` específicos e são calculados a cada requisição:

| Dado | Depende de | Cálculo |
|------|-----------|---------|
| Classificação de declividade | `forceType` | Reclassificação com limiares variáveis por tipo de força |
| Calco de restrição ao movimento | `forceType` | Weighted overlay (slope + hydro + veg + landuse) com limiares por forceType |
| Corredores de mobilidade | `echelon` + `forceType` | Cost-distance + least-cost corridors com largura mínima por escalão |
| Chokepoints | `echelon` | Estrangulamentos com largura < limiar do escalão |
| Classificação de rios | `forceType` | Limiares de obstáculo variam por tipo de força |

**Cache inteligente:** Resultados on-demand são cacheados por `(bbox_hash, echelon, forceType)` no Redis. Requisições repetidas para a mesma área/parâmetros retornam imediatamente.

### 3.3. Endpoints da API

#### `POST /api/ocoav/analyze` — Iniciar análise

Inicia uma tarefa async de análise OCOAV.

**Request:**
```json
{
    "bbox": [-46.7, -23.6, -46.5, -23.4],
    "echelon": "btl",
    "forceType": "mecanizado",
    "userFeatures": [
        {
            "type": "Feature",
            "geometry": { "type": "Point", "coordinates": [-46.55, -23.45] },
            "properties": { "nome": "PO Alpha", "tipo": "military_symbol" }
        }
    ],
    "userAnalyses": [
        {
            "type": "los",
            "origin": [-46.55, -23.45],
            "results": { "visiblePercent": 0.72, "maxDistanceM": 5200 }
        }
    ]
}
```

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|:-----------:|-----------|
| `bbox` | `[w, s, e, n]` | Sim | Área de análise (EPSG:4326). Máximo ~50×50 km |
| `echelon` | `string` | Sim | `"cia"` / `"btl"` / `"bda"` |
| `forceType` | `string` | Sim | `"blindado"` / `"mecanizado"` / `"motorizado"` / `"a_pe"` |
| `userFeatures` | `GeoJSON Feature[]` | Não | Feições militares existentes no mapa do usuário |
| `userAnalyses` | `Object[]` | Não | Análises LOS/viewshed já realizadas na área |

**Response:**
```json
{
    "taskId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "estimatedTimeSeconds": 45
}
```

#### `GET /api/ocoav/status/{taskId}` — Consultar progresso

Polling para acompanhar o progresso da análise.

**Response (em andamento):**
```json
{
    "taskId": "a1b2c3d4...",
    "status": "processing",
    "step": "agent_obstaculos",
    "stepLabel": "Analisando obstáculos...",
    "progress": 0.55,
    "elapsedSeconds": 22
}
```

**Steps possíveis (em ordem):**

| Step | Label | Progress |
|------|-------|----------|
| `collecting_data` | Coletando dados geoespaciais... | 0.05-0.15 |
| `computing_movement` | Calculando restrição ao movimento... | 0.15-0.25 |
| `agent_observacao` | Analisando observação e campos de tiro... | 0.25-0.35 |
| `agent_cobertas` | Analisando cobertas e abrigos... | 0.35-0.45 |
| `agent_obstaculos` | Analisando obstáculos... | 0.45-0.55 |
| `agent_acidentes` | Identificando acidentes capitais... | 0.55-0.65 |
| `agent_vias` | Analisando vias de acesso... | 0.65-0.75 |
| `consolidating` | Consolidando análise OCOAV... | 0.75-0.90 |
| `building_layers` | Montando camadas GeoJSON... | 0.90-0.95 |
| `completed` | Análise concluída | 1.0 |

**Nota:** Os agentes O, C, O, A, V executam em paralelo no backend (asyncio.gather ou Celery group). Os steps são reportados à medida que cada agente termina, mas a ordem exata pode variar.

**Response (concluída):**
```json
{
    "taskId": "a1b2c3d4...",
    "status": "completed",
    "progress": 1.0,
    "elapsedSeconds": 38,
    "result": { "...ver seção 4..." }
}
```

**Response (erro):**
```json
{
    "taskId": "a1b2c3d4...",
    "status": "error",
    "error": "Falha na conexão com OLLAMA: Connection refused",
    "step": "agent_observacao",
    "partialResult": null
}
```

#### `GET /api/ocoav/health` — Health check

Verifica se o backend e o OLLAMA estão operacionais.

```json
{
    "status": "ok",
    "ollama": { "connected": true, "model": "qwen3.5:27b", "loaded": true },
    "postgis": { "connected": true },
    "cache": { "connected": true }
}
```

O frontend usa este endpoint para habilitar/desabilitar o botão "ANALISAR" e mostrar o estado do serviço.

### 3.4. Arquitetura de agentes LLM

O backend orquestra **6 agentes LLM especializados** + **1 agente consolidador**:

```
                    ┌─────────────────┐
                    │  Dados Coletados │
                    │  (geoespaciais)  │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
         ┌────▼────┐   ┌────▼────┐   ┌────▼────┐
         │ Ag. O   │   │ Ag. C   │   │ Ag. O   │
         │ Observ. │   │ Cobert. │   │ Obstác. │
         └────┬────┘   └────┬────┘   └────┬────┘
              │              │              │
         ┌────▼────┐   ┌────▼────┐         │
         │ Ag. A   │   │ Ag. V   │         │
         │ Acid.C. │   │ Vias Ac.│         │
         └────┬────┘   └────┬────┘         │
              │              │              │
              └──────────────┼──────────────┘
                             │
                    ┌────────▼────────┐
                    │ Ag. Consolidador│
                    │ (síntese final) │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │ Montador JSON + │
                    │ GeoJSON Builder │
                    └─────────────────┘
```

#### Agentes especializados (executam em paralelo)

Cada agente recebe **apenas os dados relevantes** para seu fator OCOAV:

| Agente | Dados de entrada | Saída |
|--------|-----------------|-------|
| **Ag. Observação** | Pontos dominantes, cumeadas, aspecto, obstrução visual, LOS/viewshed do usuário | Texto análise + classificação + feições sugeridas (POs, campos de tiro) |
| **Ag. Cobertas/Abrigos** | Cobertura vegetal, edificações, vales (profundidade), aspecto (encostas inversas) | Texto análise + classificação + feições (zonas de coberta/abrigo) |
| **Ag. Obstáculos** | Declividade classificada, rios (com obstacleClass), áreas alagadas, áreas urbanas | Texto análise + classificação geral + feições (linhas de obstáculo) |
| **Ag. Acidentes Capitais** | Pontos dominantes, saddle points, cruzamentos viários, pontes, chokepoints | Texto análise + lista de pontos-chave com coordenadas e justificativa |
| **Ag. Vias de Acesso** | Corredores de mobilidade, estradas, calco de restrição, chokepoints | Texto análise + lista de vias com classificação e gargalos |

#### Agente consolidador (executa após os 5 anteriores)

Recebe as 5 saídas dos agentes especializados + dados do calco de restrição e produz:
- Texto de conclusão geral
- Lista de recomendações para o analista
- Revisão de consistência (ex: se Ag. Observação menciona posição que Ag. Acidentes não identificou como acidente capital)

#### Prompt de cada agente

Cada agente recebe um prompt menor e focado (~600-800 tokens de system prompt):

```
Você é um analista militar do Exército Brasileiro especializado em {FATOR}.
Sua tarefa é analisar {FATOR_DESCRICAO} de uma área, conforme o EB70-MC-10.307.

## DEFINIÇÃO DOUTRINÁRIA
{DEFINICAO_DO_FATOR}

## REGRAS
1. Use APENAS os dados fornecidos. NUNCA invente dados ou coordenadas.
2. Se dados insuficientes: "Dados insuficientes para avaliar este aspecto."
3. Terminologia: IMPEDÍVEL/RESTRITIVO/ADEQUADO.
4. Coordenadas em graus decimais [longitude, latitude].
5. Idioma: pt-BR com terminologia militar brasileira.
6. Responda EXCLUSIVAMENTE com JSON válido no schema abaixo.

## SCHEMA DE RESPOSTA
{SCHEMA_DO_FATOR}
```

Cada agente tem ~2.000-3.000 tokens de entrada (dados) + ~600-800 tokens de system prompt = **~3.000 tokens totais**, bem dentro da capacidade de qualquer modelo >= 8B.

### 3.5. Estratégia de fallback e resiliência

| Cenário | Ação do backend |
|---------|----------------|
| 1 agente falha (JSON inválido) | Retenta 1× com prompt corrigido; se falhar de novo, marca seção como "Análise indisponível" |
| 1 agente timeout | Marca seção como "Análise indisponível — timeout"; demais seções continuam |
| Consolidador falha | Monta conclusão simples concatenando textos dos agentes; sem recomendações |
| OLLAMA offline | Retorna erro 503 com mensagem clara |
| Todos agentes falham | Retorna apenas dados geoespaciais + camadas GeoJSON (sem interpretação) |
| Dados geoespaciais indisponíveis | Retorna erro 422 com detalhe de quais camadas faltam |

**Degradação graciosa:** Mesmo que todos os agentes LLM falhem, o frontend ainda recebe as camadas GeoJSON (calco de restrição, pontos dominantes, corredores) que são puramente computacionais. O relatório textual fica vazio mas o mapa é populado.

---

## 4. Resposta do Backend — Contrato JSON

A resposta do backend inclui **duas partes**: relatório textual (gerado pelos agentes LLM) e **camadas GeoJSON** (geradas por cálculos determinísticos + feições dos agentes).

### 4.1. Estrutura completa da resposta

```json
{
    "metadata": {
        "timestamp": "2026-03-03T14:30:00Z",
        "bbox": [-46.7, -23.6, -46.5, -23.4],
        "areaKm2": 12.5,
        "echelon": "btl",
        "echelonLabel": "Batalhão",
        "forceType": "mecanizado",
        "forceTypeLabel": "Mecanizado",
        "elapsedSeconds": 38,
        "disclaimer": "Gerado por IA — requer validação do analista. EB70-MC-10.307, 2ª Fase PITCIC (Etapas 2-4)."
    },

    "report": {
        "observacao": {
            "texto": "A área apresenta boas condições de observação...",
            "classificacao": "favoravel",
            "detalhes": {
                "campos_tiro_direto": "A Cota 1180 oferece visada dominante...",
                "campos_tiro_indireto": "O vale do Rio Paraíba permite...",
                "angulos_mortos": "A encosta sul da Cota 1180, coberta por floresta densa..."
            }
        },
        "cobertas_abrigos": {
            "texto": "Cobertas moderadas disponíveis...",
            "classificacao": "parcialmente_favoravel",
            "detalhes": {
                "cobertas": "Floresta densa (35% da área) ao sul...",
                "abrigos": "Vales com profundidade de 45m oferecem...",
                "encostas_inversas": "Encosta norte da Cota 1180..."
            }
        },
        "obstaculos": {
            "texto": "Obstáculos significativos na área...",
            "classificacao_geral": "RESTRITIVO",
            "detalhes": {
                "naturais": "Rio Paraíba (largura 15m — RESTRITIVO)...",
                "artificiais": "Vila X (225 edif./km²)..."
            }
        },
        "acidentes_capitais": {
            "texto": "Identificados 3 acidentes capitais do terreno...",
            "pontos_chave": [
                {
                    "nome": "Cota 1180",
                    "coordenadas": [-46.55, -23.45],
                    "tipo": "elevacao_dominante",
                    "importancia": "Posição dominante com visada 360° sobre o vale principal"
                },
                {
                    "nome": "Ponte BR-101 / Rio Paraíba",
                    "coordenadas": [-46.60, -23.50],
                    "tipo": "ponte",
                    "importancia": "Único ponto de travessia do Rio Paraíba na área"
                }
            ]
        },
        "vias_acesso": {
            "texto": "Identificadas 2 vias de acesso...",
            "vias": [
                {
                    "nome": "VA Principal — Vale do Rio Paraíba",
                    "classificacao": "motorizado",
                    "larguraM": 1800,
                    "gargalos": ["Passagem estreita em -46.58, -23.50 (350m)"],
                    "descricao": "Via com BR-101, terreno ondulado, corredor de mobilidade contínuo"
                }
            ]
        },
        "calco_restricao": {
            "texto": "O calco de restrição ao movimento indica...",
            "distribuicao": {
                "adequado_percent": 45,
                "restritivo_percent": 35,
                "impedivel_percent": 20
            }
        },
        "conclusao": "O terreno é moderadamente favorável à defesa...",
        "recomendacoes": [
            "Realizar LOS da Cota 1180 para o vale principal",
            "Verificar transitabilidade da BR-101 em período chuvoso",
            "Avaliar possibilidade de transposição do Rio Paraíba na ponte em -46.60, -23.50"
        ]
    },

    "layers": {
        "calco_restricao": {
            "type": "FeatureCollection",
            "metadata": {
                "name": "Calco de Restrição ao Movimento",
                "layerType": "polygon",
                "style": {
                    "fillColors": {
                        "ADEQUADO": "#22c55e40",
                        "RESTRITIVO": "#f9731660",
                        "IMPEDIVEL": "#dc262680"
                    },
                    "strokeColor": "#00000030",
                    "strokeWidth": 0.5
                }
            },
            "features": [
                {
                    "type": "Feature",
                    "geometry": { "type": "Polygon", "coordinates": ["..."] },
                    "properties": {
                        "classe": "IMPEDIVEL",
                        "causa": "declividade + hidrografia",
                        "cor": "#dc262680"
                    }
                }
            ]
        },
        "pontos_dominantes": {
            "type": "FeatureCollection",
            "metadata": {
                "name": "Pontos Dominantes",
                "layerType": "point",
                "style": { "color": "#dc2626", "radius": 8, "symbol": "triangle" }
            },
            "features": [
                {
                    "type": "Feature",
                    "geometry": { "type": "Point", "coordinates": [-46.55, -23.45] },
                    "properties": {
                        "nome": "Cota 1180",
                        "elevacao": 1180,
                        "proeminencia": 120,
                        "tipo": "ponto_dominante"
                    }
                }
            ]
        },
        "cumeadas": {
            "type": "FeatureCollection",
            "metadata": {
                "name": "Linhas de Cumeada",
                "layerType": "line",
                "style": { "color": "#92400e", "width": 2, "dasharray": [8, 4] }
            },
            "features": ["..."]
        },
        "hidrografia": {
            "type": "FeatureCollection",
            "metadata": {
                "name": "Hidrografia (obstáculos)",
                "layerType": "line",
                "style": { "color": "#2563eb", "width": 2 }
            },
            "features": ["..."]
        },
        "corredores_mobilidade": {
            "type": "FeatureCollection",
            "metadata": {
                "name": "Corredores de Mobilidade",
                "layerType": "polygon",
                "style": { "fillColor": "#16a34a20", "strokeColor": "#16a34a", "strokeWidth": 2 }
            },
            "features": ["..."]
        },
        "chokepoints": {
            "type": "FeatureCollection",
            "metadata": {
                "name": "Passagens Obrigatórias",
                "layerType": "point",
                "style": { "color": "#d97706", "radius": 10, "symbol": "diamond" }
            },
            "features": ["..."]
        },
        "vias_acesso": {
            "type": "FeatureCollection",
            "metadata": {
                "name": "Vias de Acesso",
                "layerType": "line",
                "style": { "color": "#16a34a", "width": 3 }
            },
            "features": ["..."]
        },
        "acidentes_capitais": {
            "type": "FeatureCollection",
            "metadata": {
                "name": "Acidentes Capitais",
                "layerType": "point",
                "style": { "color": "#d97706", "radius": 10, "symbol": "star" }
            },
            "features": ["..."]
        }
    },

    "suggestedFeatures": [
        {
            "tipo": "point",
            "coordenadas": [-46.55, -23.45],
            "nome": "PO Cota 1180",
            "descricao": "Posto de observação — visada dominante",
            "categoria": "observacao"
        },
        {
            "tipo": "line",
            "coordenadas": [[-46.60, -23.55], [-46.58, -23.50], [-46.55, -23.45]],
            "nome": "VA Principal — Vale",
            "descricao": "Via de acesso motorizado com BR-101",
            "categoria": "via_acesso"
        },
        {
            "tipo": "point",
            "coordenadas": [-46.60, -23.50],
            "nome": "Ponte BR-101 / Rio Paraíba",
            "descricao": "Ponto de passagem obrigatória — acidente capital",
            "categoria": "acidente_capital"
        }
    ]
}
```

### 4.2. Diferença entre `layers` e `suggestedFeatures`

| Aspecto | `layers` | `suggestedFeatures` |
|---------|---------|---------------------|
| Origem | Cálculos geoespaciais determinísticos | Sugestões dos agentes LLM |
| Precisão | Alta (dados reais) | Aproximada (interpretação IA) |
| Ação no frontend | Abre como camadas MapLibre (visualização imediata) | Listado com checkboxes para o usuário aprovar e criar no store |
| Persistência | Camadas temporárias (sobreposição visual) | Feições reais no store se o usuário aprovar |
| Pode existir sem LLM? | Sim (puramente computacional) | Não (vem dos agentes) |

### 4.3. Como o frontend trata as camadas

O módulo `ocoav-layers.js` cria fontes e camadas MapLibre temporárias para cada entry de `layers`:

1. Para cada `layers[key]` (FeatureCollection):
   - Cria uma source MapLibre com o GeoJSON
   - Cria uma layer com o estilo definido em `metadata.style`
   - Adiciona ao mapa como camadas de sobreposição (overlay)
   - Camadas são agrupadas em um grupo "OCOAV — {data}" no painel de camadas
2. Camadas são removíveis pelo usuário (botão "Remover camadas OCOAV")
3. Camadas não são persistidas no store — são visuais

Para `suggestedFeatures`, o módulo `ocoav-features.js` apresenta checkboxes e materializa as selecionadas como feições reais no store (persistidas no IndexedDB).

---

## 5. Módulo OCOAV do Frontend (`src/js/ocoav/`)

### 5.1. `ocoav-client.js`

Cliente HTTP simples que se comunica com o backend:

```javascript
/**
 * Cliente para a API OCOAV do backend.
 * Não conhece nada sobre IA, prompts ou modelos.
 */
export class OcoavClient {
    constructor(baseUrl) {
        this._baseUrl = baseUrl;
    }

    /** Verifica se o serviço está disponível */
    async checkHealth() {
        const response = await fetch(`${this._baseUrl}/health`, {
            signal: AbortSignal.timeout(5000),
        });
        return response.json();
    }

    /** Inicia uma análise OCOAV (retorna taskId) */
    async startAnalysis(params) {
        const response = await fetch(`${this._baseUrl}/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        });
        if (!response.ok) throw new OcoavApiError(response.status, await response.text());
        return response.json(); // { taskId, estimatedTimeSeconds }
    }

    /** Consulta progresso de uma análise */
    async getStatus(taskId) {
        const response = await fetch(`${this._baseUrl}/status/${taskId}`);
        if (!response.ok) throw new OcoavApiError(response.status, await response.text());
        return response.json();
    }

    /**
     * Inicia análise e faz polling até completar.
     * @param {Object} params — parâmetros da análise
     * @param {Function} onProgress — callback (step, progress, label)
     * @returns {Promise<Object>} — resultado completo
     */
    async analyzeWithPolling(params, onProgress) {
        const { taskId, estimatedTimeSeconds } = await this.startAnalysis(params);
        const pollInterval = Math.min(2000, estimatedTimeSeconds * 50); // 2s máx

        return new Promise((resolve, reject) => {
            const poll = async () => {
                try {
                    const status = await this.getStatus(taskId);
                    onProgress?.(status.step, status.progress, status.stepLabel);

                    if (status.status === 'completed') {
                        resolve(status.result);
                    } else if (status.status === 'error') {
                        reject(new OcoavApiError(500, status.error));
                    } else {
                        setTimeout(poll, pollInterval);
                    }
                } catch (error) {
                    reject(error);
                }
            };
            poll();
        });
    }
}
```

### 5.2. `ocoav-panel.js`

Painel no sidebar seguindo padrão visual do `voronoi.algorithm.js`:

**Seções:**

1. **Ilustração** — SVG conceitual OCOAV
2. **Status do Serviço** — Indicador verde/vermelho baseado em `GET /health`. Mostra "Serviço OCOAV disponível" ou "Serviço indisponível"
3. **Servidor** — Input URL do endpoint (default: `config.services.ocoavApiUrl`). Salvo em localStorage
4. **Parâmetros Táticos**:
   - Select **Escalão**: Companhia / Batalhão / Brigada
   - Select **Tipo de Força**: Blindado / Mecanizado / Motorizado / A pé
5. **Área de Análise** — "Desenhar Retângulo" (2 cliques, preview via RAF) + mostrar área estimada em km²
6. **Opções** — Toggles: incluir feições militares existentes, incluir análises LOS/viewshed
7. **Botão "ANALISAR"** — disabled até bbox configurada e serviço disponível
8. **Progress multi-step** — barra de progresso + label de step (atualizado via polling)
9. **Resultados** — Renderizado por `ocoav-results.js`

O painel NÃO retorna `ui.executeBtn` — gerencia a execução internamente.

### 5.3. `ocoav-results.js`

Renderiza relatório no sidebar com seções colapsáveis:

```
┌──────────────────────────────────────────────────────┐
│ ANÁLISE OCOAV — 03/03/2026 14:30                     │
│ Área: 12.5 km² | Escalão: Btl | Força: Mecanizado   │
│ Ref: EB70-MC-10.307, 2ª Fase PITCIC (Etapas 2-4)   │
├──────────────────────────────────────────────────────┤
│ ⚠ Gerado por IA — requer validação do analista      │
├──────────────────────────────────────────────────────┤
│ ▼ 1. OBSERVAÇÃO E CAMPOS DE TIRO   [FAVORÁVEL]      │
│   Campos de tiro direto: ...                         │
│   Campos de tiro indireto: ...                       │
│   Ângulos mortos: ...                                │
├──────────────────────────────────────────────────────┤
│ ▶ 2. COBERTAS E ABRIGOS   [PARCIAL]                 │
├──────────────────────────────────────────────────────┤
│ ▶ 3. OBSTÁCULOS   [RESTRITIVO]                       │
├──────────────────────────────────────────────────────┤
│ ▶ 4. ACIDENTES CAPITAIS DO TERRENO                   │
│   3 pontos-chave identificados                       │
├──────────────────────────────────────────────────────┤
│ ▶ 5. VIAS DE ACESSO                                  │
│   2 vias identificadas (motorizado)                  │
├──────────────────────────────────────────────────────┤
│ ▼ CALCO DE RESTRIÇÃO AO MOVIMENTO                    │
│   ADEQUADO: 45% | RESTRITIVO: 35% | IMPEDÍVEL: 20%  │
│   ■■■■■■■■■ ■■■■■■■ ■■■■                            │
│   (verde)   (laranja)(verm)                          │
├──────────────────────────────────────────────────────┤
│ CONCLUSÃO                                             │
│   O terreno é favorável à defesa...                  │
├──────────────────────────────────────────────────────┤
│ RECOMENDAÇÕES                                         │
│ • Realizar LOS da Cota 1180 para o vale              │
│ • Verificar transitabilidade da BR-101               │
│ • Avaliar transposição do Rio Paraíba                │
├──────────────────────────────────────────────────────┤
│ CAMADAS GERADAS (8)                                   │
│ ☑ Calco de Restrição ao Movimento                    │
│ ☑ Pontos Dominantes                                   │
│ ☑ Linhas de Cumeada                                   │
│ ☑ Hidrografia (obstáculos)                            │
│ ☑ Corredores de Mobilidade                            │
│ ☑ Passagens Obrigatórias                              │
│ ☑ Vias de Acesso                                      │
│ ☑ Acidentes Capitais                                  │
│                                                       │
│ [ ABRIR CAMADAS NO MAPA ] [ REMOVER CAMADAS ]        │
├──────────────────────────────────────────────────────┤
│ FEIÇÕES SUGERIDAS (3)                                 │
│ ☑ PO Cota 1180 (ponto — observação)                  │
│ ☑ VA Principal — Vale (linha — via de acesso)        │
│ ☑ Ponte BR-101/Rio Paraíba (ponto — acidente cap.)  │
│                                                       │
│ [ CRIAR 3 FEIÇÕES SELECIONADAS ]                     │
├──────────────────────────────────────────────────────┤
│ ▶ DETALHES                                            │
│   Tempo: 38s | Disclaimer IA                         │
│   [ EXPORTAR JSON ] [ REFAZER ANÁLISE ]              │
└──────────────────────────────────────────────────────┘
```

**Disclaimer obrigatório:** O banner "Gerado por IA — requer validação do analista" é obrigatório e não pode ser removido. Toda análise gerada por LLM é um rascunho para apoio à decisão.

### 5.4. `ocoav-layers.js`

Recebe as `layers` da resposta e cria camadas MapLibre:

```javascript
/**
 * Cria camadas MapLibre a partir do GeoJSON retornado pelo backend.
 * Cada entry de layers vira uma source + layer no mapa.
 *
 * @param {Object} layers — objeto layers da resposta do backend
 * @param {Object} map — instância MapLibre
 * @returns {{ layerIds: string[], sourceIds: string[], remove: () => void }}
 */
export function createOcoavLayers(layers, map) {
    // Para cada layer:
    // 1. map.addSource(`ocoav-${key}`, { type: 'geojson', data: featureCollection })
    // 2. map.addLayer({ id, source, type: 'fill'|'line'|'circle', paint: { ...metadata.style } })
    // 3. Retorna função remove() que limpa tudo
}
```

### 5.5. `ocoav-features.js`

Cores por categoria (para feições sugeridas criadas no store):
- `observacao` → #2563eb (azul)
- `via_acesso` → #16a34a (verde)
- `obstaculo` → #dc2626 (vermelho)
- `cobertura` → #7c3aed (roxo)
- `acidente_capital` → #d97706 (laranja)
- `restricao` → #991b1b (vermelho escuro)

### 5.6. `ocoav.algorithm.js`

```javascript
registerAlgorithm({
    id: 'ocoav',
    name: 'Análise OCOAV',
    description: 'Análise de terreno assistida por IA — OCOAV (EB70-MC-10.307) integrada ao PITCIC',
    icon: OCOAV_ICON,
    category: 'analysis',
    supportedGeometryTypes: [],
    createPanel: createOcoavPanel,
    execute: () => [],
});
```

---

## 6. Dados Geoespaciais (contrato de dados internos do backend)

### 6.1. Dados coletados pelo backend para alimentar os agentes

Os agentes LLM recebem dados estruturados. Abaixo o formato interno usado pelo backend (NÃO é enviado ao frontend):

*(mesma estrutura de terrain, hydrology, roads, landCover, buildings, movementRestriction definida na versão anterior — mantida como referência interna do backend)*

### 6.2. Requisitos de cálculo (rastreabilidade)

| REQ | Cálculo | Algoritmo/Fonte | Pré-computado? |
|-----|---------|-----------------|:--------------:|
| **REQ-O1** | Pontos dominantes (proeminência >= 30m) | Topographic prominence (GDAL DEM) | Sim |
| **REQ-O2** | Linhas de cumeada | Flow direction + ridge extraction | Sim |
| **REQ-O3** | Distribuição de declividade em 4 faixas | `gdaldem slope` + reclassificação | Parcial (limiares dependem de forceType) |
| **REQ-O4** | Percentual de obstrução visual | Land cover + canopy height model | Sim |
| **REQ-C1** | Mapa de aspecto (orientação de vertentes) | `gdaldem aspect` + binning 8 octantes | Sim |
| **REQ-C2** | Vales e ravinas com profundidade | Inverted DEM + flow accumulation | Sim |
| **REQ-C3** | Classificação de coberta por vegetação | Land cover raster (MapBiomas/WorldCover) | Sim |
| **REQ-C4** | Capacidade de abrigo em área edificada | OSM building density + clustering (DBSCAN) | Sim |
| **REQ-OB1** | Classificação de declividade por forceType | Reclassificação com limiares variáveis | Não (depende de forceType) |
| **REQ-OB2** | Cursos d'água como obstáculos | OSM waterways + width estimation (Strahler) | Parcial (classe depende de forceType) |
| **REQ-OB3** | Áreas alagadas (permanente/intermitente) | OSM wetlands + land cover cross-ref | Sim |
| **REQ-OB4** | Índice integrado de restrição ao movimento | Weighted overlay (Veloza, 2020) | Não (depende de forceType) |
| **REQ-AC1** | Saddle points (colos) | Local minima on ridgeline elevation profile | Sim |
| **REQ-AC2** | Cruzamentos viários significativos (3+ vias) | OSM road network graph + degree filtering | Sim |
| **REQ-AC3** | Pontes (cruzamento via/rio) | Spatial join roads × rivers | Sim |
| **REQ-AC4** | Passagens obrigatórias (gargantas) | Corridor width < threshold entre áreas IMPEDÍVEL | Não (depende de echelon) |
| **REQ-VA1** | Corredores de mobilidade | Cost-distance + least-cost path corridors | Não (depende de echelon + forceType) |
| **REQ-VA2** | Classificação de vias por tipo de força | Largura + declividade máxima do corredor | Não (depende de forceType) |
| **REQ-VA3** | Avaliação de continuidade | Comprimento total do corredor sem interrupção | Não (calculado junto com VA1) |

**Resumo:** 12 dos 17 requisitos são pré-computáveis. Os 5 restantes dependem de `echelon` e/ou `forceType` e são calculados on-demand (com cache por parâmetros).

### 6.3. Metodologia do Calco de Restrição ao Movimento

#### Fatores e pesos (baseado em Veloza, 2020)

| Fator | Peso | Fonte | ADEQUADO | RESTRITIVO | IMPEDÍVEL |
|-------|------|-------|----------|------------|-----------|
| Declividade | 0.40 | SRTM 30m | < 7% | 7-30% (esteiras) / 7-15% (rodas) | > 30% / > 15% |
| Hidrografia | 0.25 | OSM + buffer | > 100m de margem | 20-100m | < 20m ou sobre curso d'água |
| Cobertura vegetal | 0.20 | MapBiomas | Gramínea/solo exposto | Cerrado/capoeira | Floresta densa |
| Uso do solo | 0.15 | OSM + land cover | Rural aberto | Periurbano | Urbano denso / edificado |

#### Cálculo

```
restricao_cell = Σ (peso_i × valor_i)    para i em {declividade, hidrografia, vegetação, uso_solo}
```

Onde `valor_i ∈ {0 (ADEQUADO), 1 (RESTRITIVO), 2 (IMPEDÍVEL)}`.

Classificação final: `restricao_cell < 0.7 → ADEQUADO | 0.7-1.3 → RESTRITIVO | > 1.3 → IMPEDÍVEL`

**Regra de veto:** Qualquer fator IMPEDÍVEL isolado torna a célula IMPEDÍVEL, independente dos demais.

#### Tabela padronizada de declividade

| Classe | Declividade | Classificação | Efeito | Cor no Calco |
|--------|------------|---------------|--------|-------------|
| Plano | < 7% | ADEQUADO | Sem restrições a qualquer tipo de viatura | Sem preenchimento |
| Ondulado | 7% - 20% | ADEQUADO a RESTRITIVO | Retarda veículos sobre rodas; esteiras transitam | Amarelo claro |
| Forte Ondulado | 20% - 45% | RESTRITIVO | Limita severamente rodas; esteiras com dificuldade | Laranja |
| Escarpado | > 45% | IMPEDÍVEL | Intransponível para viaturas; infiltração a pé apenas | Vermelho |

#### Classificação de cursos d'água como obstáculos

| Largura | Classificação | Efeito |
|---------|--------------|--------|
| < 5m | Obstáculo menor | Vadeável por viaturas |
| 5-20m | RESTRITIVO | Requer equipamentos leves de transposição |
| > 20m | IMPEDÍVEL | Requer meios de engenharia (ponte Bailey, flutuantes) |

---

## 7. Segurança

### 7.1. XSS via resposta do backend

O backend retorna textos gerados por LLM. Todas as strings da resposta DEVEM ser renderizadas no frontend com `textContent` ou `escapeHtml()`, NUNCA com `innerHTML`.

### 7.2. Dados sensíveis

- Dados geoespaciais militares nunca trafegam para a internet (OLLAMA local, backend local/intranet)
- O frontend armazena apenas a URL do backend em `localStorage` (não é credencial)
- Não há autenticação na v1 (backend e frontend na mesma rede)
- Em produção, o backend deve ter autenticação (JWT ou mTLS)

### 7.3. Prompt injection via feições do usuário

Feições do usuário (`userFeatures`) são incluídas como dados JSON no prompt dos agentes. Um usuário malicioso poderia inserir instruções no campo `nome` ou `descricao` de uma feição. Mitigação no backend:
- Truncar campos de texto a 200 caracteres
- Sanitizar (remover caracteres de controle, markdown extremo)
- Incluir feições como dados (não como instruções) no prompt
- Validação de schema na resposta do LLM

---

## 8. Padrões do Codebase a Seguir (Frontend)

| Padrão | Referência |
|--------|-----------|
| Algorithm registry | `processing/processing.constants.js` → `registerAlgorithm()` |
| Painel com bbox drawing | `processing/algorithms/voronoi.algorithm.js` → `_startDrawing()` |
| Event cleanup | `utilities/event-cleanup.js` → `setupCleanup/subscribe/cleanup` |
| Store operations | `store/feature.operations.js` → `addFeature()`, `getCurrentMapFeatures()` |
| Layer creation | `store/layer.operations.js` → `createLayerForImport()` |
| UI helpers | `tool_manager/helpers/` → `createModernSelect`, `createModernToggle`, `createSectionDivider` |
| ID generation | `IDUtils.generateFeatureIds()` |
| Toast | `showToast(msg, type)` |
| XSS | `textContent` para dados do backend, `escapeHtml()` de `utilities/html-escape.js` |
| CSS | BEM naming, design tokens de `design-tokens.css` |
| Imports | Path aliases: `@store`, `@utils`, `@events`, `@tools` |

---

## 9. Ordem de Implementação

### 9.1. Backend (Python)

| Fase | Módulo | Descrição |
|------|--------|-----------|
| B1 | Setup FastAPI + health endpoint | Scaffold, OLLAMA connection check |
| B2 | Dados pré-computados | Ingestão SRTM, OSM, MapBiomas → PostGIS |
| B3 | Endpoint `/collect` (dados geoespaciais) | Query PostGIS + cálculos on-demand |
| B4 | Agentes LLM individuais | 5 agentes com prompts especializados |
| B5 | Agente consolidador | Síntese + recomendações |
| B6 | Montador GeoJSON layers | Converter dados computados em GeoJSON com estilos |
| B7 | Endpoint `/analyze` + `/status` (async) | Celery/asyncio task, polling |
| B8 | Cache Redis | Cache por (bbox_hash, echelon, forceType) |

### 9.2. Frontend (EBGeo Web)

| Fase | Módulo | Dependência |
|------|--------|-------------|
| F1 | `ocoav-client.js` | Nenhuma (backend pode ser mockado) |
| F2 | `ocoav-layers.js` | MapLibre (criação de sources/layers) |
| F3 | `ocoav-results.js` | Nenhuma (puro DOM) |
| F4 | `ocoav-features.js` | Store (`addFeatures`, `createLayerForImport`) |
| F5 | `ocoav-panel.js` | Tudo acima + UI helpers |
| F6 | `ocoav.algorithm.js` + `index.js` | Processing registry |
| F7 | `ocoav.css` | Design tokens |
| F8 | Integrações (`algorithms/index.js`, `config.js`, `vite.config.js`) | Tudo acima |

---

## 10. Verificação

### Frontend
- `npm run lint` — zero warnings
- `npm test` — testes existentes passam
- Testes unitários novos:
  - `ocoav-client.js` — mock de fetch, polling, erros HTTP, timeout
  - `ocoav-layers.js` — criação de sources/layers MapLibre com GeoJSON válido
  - `ocoav-features.js` — criação de feições point/line/polygon com propriedades corretas
- UI testada manualmente pelo usuário

### Backend
- `pytest` — testes unitários dos agentes (mock OLLAMA), validação JSON, cálculos geoespaciais
- Testes de integração com OLLAMA real (opcional, lento)
- Load test do polling endpoint

---

## 11. Evolução Futura

| Fase | Feature | Descrição |
|------|---------|-----------|
| v2 | WebSocket em vez de polling | Progresso em tempo real sem polling |
| v2 | Streaming de resposta | Mostrar texto parcial enquanto agentes terminam |
| v2 | Comparação de COAs | Gerar 2+ cursos de ação e comparar em tabela |
| v2 | Export PDF | Relatório OCOAV como PDF com mapa + calco |
| v2 | AECOPE parcial | Etapa 1 do PITCIC com dados de infraestrutura disponíveis |
| v3 | Análise incremental | Re-analisar com feições atualizadas sem recoletar |
| v3 | Multi-região | OCOAV em múltiplas áreas com comparação cruzada |
| v3 | Integração com simbologia | Sugerir símbolos militares SIDC para feições |
| v3 | Consolidação (Etapa 5) | Assistir na síntese final dos efeitos ambientais |
| v3 | Backend alternativo | Suportar vLLM, LM Studio além de OLLAMA |
| v3 | GPU compartilhada | Queue de inferência com prioridades para múltiplos usuários |

---

## Apêndice A: Glossário de Termos Militares

| Termo | Definição |
|-------|-----------|
| **Acidente capital** | Posição geográfica cuja posse confere vantagem tática decisiva. |
| **ADEQUADO** | Terreno sem restrições significativas ao movimento para o tipo de força considerado. |
| **Calco** | Produto cartográfico temático sobreposto à carta topográfica. |
| **Campo de tiro** | Área onde armas podem ser empregadas com eficácia. Direto: visada; indireto: sem visada. |
| **Coberta** | Proteção contra observação (visual, térmica, radar). |
| **Abrigo** | Proteção contra efeitos de fogos (projéteis, estilhaços, explosão). |
| **Corredor de mobilidade** | Faixa de terreno adequada ao movimento de uma força de determinado tipo e escalão. |
| **Encosta inversa** | Vertente do terreno não visível da posição do inimigo. Oferece abrigo. |
| **Escalão** | Nível organizacional: Companhia (~150), Batalhão (~600), Brigada (~3.000). |
| **IMPEDÍVEL** | Terreno intransponível para o tipo de força considerado sem meios de engenharia. |
| **OCOAV** | Observação, Cobertas/Abrigos, Obstáculos, Acidentes capitais, Vias de acesso. |
| **PITCIC** | Processo de Integração Terreno, Condições Meteorológicas, Inimigo e Considerações Civis. |
| **Proeminência** | Diferença de altitude entre um pico e o colo mais alto que o conecta a um pico vizinho mais alto. |
| **RESTRITIVO** | Terreno que retarda ou canaliza o movimento sem impedi-lo completamente. |
| **Via de acesso** | Rota pela qual uma força pode progredir em direção a um objetivo. |

## Apêndice B: Modelos OLLAMA — Referência Detalhada

Referência para configuração do backend. Dados de março/2026.

### Família Qwen 3.5 (fevereiro 2026) — Recomendada

Arquitetura híbrida Gated DeltaNet + MoE, 256K context nativo, multimodal.

| Tag OLLAMA | Parâmetros (ativos) | Arquitetura | VRAM (Q4_K_M) | Context Window |
|-----------|-------------------|-------------|---------------|----------------|
| `qwen3.5:9b` | 9B (9B) | Dense + GDN | 6-8 GB | 256K |
| `qwen3.5:27b` | 27B (27B) | Dense + GDN | 18-22 GB | 256K |
| `qwen3.5:35b` | 35B (3B) | MoE 256 experts | 24 GB | 256K |
| `qwen3.5:122b` | 122B (10B) | MoE + GDN | 81 GB | 256K |

### Família Qwen 3 (mid-2025)

| Tag OLLAMA | Parâmetros (ativos) | VRAM (Q4_K_M) | Context Window |
|-----------|-------------------|---------------|----------------|
| `qwen3:8b` | 8B (dense) | 6 GB | 128K |
| `qwen3:14b` | 14B (dense) | 10 GB | 128K |
| `qwen3:32b` | 32B (dense) | 22 GB | 128K |

### DeepSeek R1 (jan 2025, distilled)

| Tag OLLAMA | Parâmetros (ativos) | VRAM (Q4_K_M) | Context Window |
|-----------|-------------------|---------------|----------------|
| `deepseek-r1:14b` | 14B (dense) | 10 GB | 128K |
| `deepseek-r1:32b` | 32B (dense) | 22 GB | 128K |

### Outros

| Tag OLLAMA | Parâmetros (ativos) | VRAM (Q4_K_M) | Context Window |
|-----------|-------------------|---------------|----------------|
| `gemma3:27b` | 27B (dense) | 22 GB | 128K |
| `mistral-small3.1` | 24B (dense) | 16-18 GB | 128K |
