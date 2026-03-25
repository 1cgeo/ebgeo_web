# Plano de Implementacao de IA no EBGeo Web

## Inspiracao: COA-GPT 1.0 e 2.0

Baseado nos artigos COA-GPT 1.0 (Goecks & Waytowich, 2024) e COA-GPT 2.0 (Goecks et al., 2025) do DEVCOM Army Research Laboratory. COA-GPT demonstrou o uso de LLMs com arquitetura multi-agente para suportar todas as etapas do MDMP (Military Decision Making Process), incluindo agente geoespacial para analise de terreno, RAG com doutrina militar, e geracao automatica de produtos doutrinarios (Warning Orders, Matrizes de Sincronizacao, calcos de operacoes).

---

## Arquitetura: Frontend Leve + Backend Python

O EBGeo hoje e 100% frontend (MapLibre + Cesium + IndexedDB, Vanilla JS). A proposta adiciona um **backend Python** que concentra toda computacao pesada e orquestracao de IA. O frontend envia contexto do mapa e renderiza os resultados.

```
┌─────────────────────────────┐         ┌──────────────────────────────────┐
│  FRONTEND (EBGeo Web)       │         │  BACKEND (Python / FastAPI)      │
│                             │         │                                  │
│  ┌─ Chat Panel ──────────┐  │   SSE   │  ┌─ Orquestrador ────────────┐  │
│  │ Envia: mensagem +     │──┼────────>│  │ Recebe pergunta + contexto│  │
│  │   contexto do mapa    │  │         │  │ Decide quais ferramentas  │  │
│  │ Recebe: texto +       │<─┼─────────│  │ chamar (LLM function call)│  │
│  │   features GeoJSON    │  │         │  └─────────┬────────────────┘  │
│  └───────────────────────┘  │         │            │                    │
│                             │         │     ┌──────┴──────┐             │
│  ┌─ Context Builder ─────┐  │         │     │             │             │
│  │ Serializa features,   │  │         │  ┌──▼──┐   ┌──────▼──────────┐  │
│  │ extent, layers como   │  │         │  │ LLM │   │ Geo Engine      │  │
│  │ GeoJSON               │  │         │  │     │   │ (rasterio/GDAL/ │  │
│  └───────────────────────┘  │         │  │     │   │  numpy/scipy)   │  │
│                             │         │  └─────┘   └────────────────┘  │
│  ┌─ Feature Renderer ────┐  │         │               │                │
│  │ Recebe GeoJSON do     │  │         │  ┌────────────▼──────────┐     │
│  │ backend, cria features│  │         │  │ Dados                 │     │
│  │ via addFeature()      │  │         │  │ - DEM GeoTIFF (30m)   │     │
│  └───────────────────────┘  │         │  │ - Doutrina (RAG)      │     │
│                             │         │  │ - Tabelas militares   │     │
│  ┌─ Screenshot Capture ──┐  │         │  │ - Modelos vetoriais   │     │
│  │ Canvas MapLibre →     │  │  POST   │  └───────────────────────┘     │
│  │ imagem para analise   │──┼────────>│                                │
│  │ multimodal            │  │         │                                │
│  └───────────────────────┘  │         │                                │
└─────────────────────────────┘         └──────────────────────────────────┘
```

### Por que backend Python?

1. **Terreno**: `rasterio` le um GeoTIFF de DEM inteiro e computa slope/aspect de uma bbox em milissegundos. No frontend, cada ponto e uma query async ao MapLibre — 10.000 pontos e inviavel.
2. **Viewshed em massa**: `numpy` + algoritmos de visibilidade sobre raster sao ordens de grandeza mais rapidos que o ray-marching JS ponto a ponto.
3. **Pathfinding**: `scipy.sparse.csgraph` ou `networkx` com custo baseado em slope grid — pronto e otimizado.
4. **IA**: API keys ficam no servidor, sem expor no frontend. RAG com ChromaDB/pgvector. Streaming via SSE.
5. **Documentos**: `PyPDF2`, `python-docx`, `pdfplumber` para parsear OrdOp e manuais.

---

## Contrato de API: Frontend ↔ Backend

### O que o frontend envia

```jsonc
// POST /api/chat
{
  "message": "Onde posicionar artilharia 155mm para cobrir OBJ ALFA e OBJ BRAVO?",
  "conversation_id": "uuid",
  "context": {
    "map_name": "Operacao Tigre",
    "extent": [-45.6, -23.2, -45.4, -23.0],  // bbox visivel
    "zoom": 12,
    "features": {
      // GeoJSON FeatureCollection — tudo que esta no mapa
      "type": "FeatureCollection",
      "features": [
        {
          "type": "Feature",
          "geometry": { "type": "Point", "coordinates": [-45.5, -23.1] },
          "properties": {
            "ebgeo_type": "military_symbol",
            "ebgeo_id": "uuid",
            "nome": "1o GAC",
            "sidc": "10031000161211000000",
            "standardIdentity": "3",  // amigo
            "echelon": "16",          // batalhao
            "layer_id": "uuid",
            "layer_name": "Manobra"
          }
        },
        {
          "type": "Feature",
          "geometry": { "type": "Point", "coordinates": [-45.45, -23.15] },
          "properties": {
            "ebgeo_type": "coordination_measure",
            "nome": "OBJ ALFA",
            "pointCode": "130100"
          }
        }
        // ... demais features
      ]
    },
    "screenshot": "base64..."  // opcional, para analise multimodal
  }
}
```

### O que o backend responde

```jsonc
// Resposta SSE (Server-Sent Events) — streaming
// Cada evento e uma linha "data: {...}\n\n"

// 1. Texto da resposta (streaming token por token)
{ "type": "text", "content": "Analisei o terreno entre as posições..." }

// 2. Features sugeridas (usuario deve aprovar antes de criar)
{
  "type": "suggested_features",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [-45.48, -23.12] },
      "properties": {
        "ebgeo_type": "military_symbol",
        "nome": "Pos Art Sugerida 1",
        "sidc": "10031000161211000000",
        "rationale": "Declividade 4%, desenfilado do PO inimigo, alcanca ambos objetivos"
      }
    }
  ],
  "analysis": {
    "slope_at_position": 4.2,
    "distance_to_obj_alfa": 14200,
    "distance_to_obj_bravo": 16800,
    "visible_from_enemy": false
  }
}

// 3. Dados de analise (graficos, perfis, mapas de calor)
{
  "type": "analysis_layer",
  "layer_type": "slope_grid",
  "data": {
    "type": "FeatureCollection",
    "features": [/* poligonos coloridos por slope */]
  }
}

// 4. Fim da resposta
{ "type": "done" }
```

---

## Backend Python: Estrutura

```
ebgeo-ia-backend/
  pyproject.toml

  app/
    main.py                         # FastAPI app, rotas, SSE
    config.py                       # Configuracao (API keys, caminhos DEM)

    api/
      chat.py                       # POST /api/chat — endpoint principal
      analyze.py                    # POST /api/analyze/* — analises diretas
      documents.py                  # POST /api/documents/parse
      health.py                     # GET /api/health

    orchestrator/
      orchestrator.py               # Recebe pergunta, decide ferramentas, chama LLM
      context_parser.py             # Interpreta o contexto GeoJSON do frontend
      response_builder.py           # Monta resposta (texto + features + analise)

    llm/
      llm_service.py                # Facade para chamadas LLM (Anthropic/OpenAI/local)
      prompts.py                    # System prompts e templates
      tools.py                      # Definicao das tools para function calling

    geo/
      dem.py                        # Leitura de DEM (rasterio), cache em memoria
      slope.py                      # Grade de declividade e aspecto (numpy)
      viewshed.py                   # Viewshed sobre raster (numpy)
      los.py                        # Linha de visada sobre DEM
      pathfinding.py                # A* com custo de slope (scipy)
      route.py                      # Analise de vias de acesso
      geometry.py                   # Operacoes geometricas (shapely)

    military/
      weapon_systems.py             # Tabela de alcances e parametros
      vehicle_mobility.py           # Capacidade de viaturas por tipo de terreno
      unit_data.py                  # Poder de combate, composicao de unidades
      doctrine_rules.py             # Regras doutrinarias codificadas
      sidc.py                       # Parser/builder de SIDC (MIL-STD-2525D)

    doctrine/
      rag.py                        # RAG: indexacao, busca, retrieval
      embeddings.py                 # Geracao de embeddings (API ou local)
      chunker.py                    # Divisao de documentos em chunks
      store.py                      # ChromaDB ou pgvector

    parser/
      opord_parser.py               # Parser de Ordens de Operacoes (PDF/DOCX)
      coord_extractor.py            # Extrai coordenadas UTM/geográficas de texto
      feature_mapper.py             # Converte dados extraidos em GeoJSON EBGeo

    data/
      dem/                          # GeoTIFF do DEM (30m SRTM ou ALOS PALSAR)
      doctrine/                     # PDFs dos manuais doutrinarios
      weapon_systems.json           # Tabela de armamentos
      vehicle_mobility.json         # Tabela de viaturas
```

---

## Ferramentas do LLM (Function Calling)

O orquestrador expoe ao LLM estas ferramentas. O LLM decide quais chamar com base na pergunta do usuario:

### Ferramentas de terreno

```python
# tools.py — definicao para function calling

TOOLS = [
    {
        "name": "analisar_declividade",
        "description": "Calcula grade de declividade (slope) em uma area. "
                       "Retorna estatisticas e poligonos classificados.",
        "parameters": {
            "bbox": "Bounding box [west, south, east, north]",
            "classificacao": "Opcional: 'militar' para PITOCO (plano/ondulado/montanhoso)"
        }
    },
    {
        "name": "calcular_viewshed",
        "description": "Calcula area visivel a partir de um ou mais pontos de observacao. "
                       "Retorna poligonos de area visivel e terreno morto.",
        "parameters": {
            "observadores": [{"lng": -45.5, "lat": -23.1, "altura": 1.8}],
            "raio_metros": 5000,
            "area_interesse": "GeoJSON polygon opcional"
        }
    },
    {
        "name": "calcular_perfil_elevacao",
        "description": "Retorna perfil de elevacao ao longo de uma linha. "
                       "Inclui distancia, elevacao, declividade em cada ponto.",
        "parameters": {
            "coordenadas": [[-45.5, -23.1], [-45.4, -23.0]]
        }
    },
    {
        "name": "verificar_linha_visada",
        "description": "Verifica se ha linha de visada entre dois pontos. "
                       "Retorna se e visivel, ponto de obstrucao, e perfil.",
        "parameters": {
            "observador": {"lng": -45.5, "lat": -23.1, "altura": 1.8},
            "alvo": {"lng": -45.4, "lat": -23.0, "altura": 0}
        }
    },
    {
        "name": "encontrar_rota",
        "description": "Encontra rota viavel entre dois pontos para um tipo de viatura. "
                       "Considera declividade, obstaculos conhecidos, e tipo de terreno.",
        "parameters": {
            "inicio": [-45.5, -23.1],
            "fim": [-45.4, -23.0],
            "tipo_viatura": "blindado_lagarta",  # ou rodas_8x8, rodas_4x4, a_pe
            "obstaculos": "GeoJSON FeatureCollection opcional"
        }
    },
]
```

### Ferramentas militares

```python
    {
        "name": "encontrar_posicoes_artilharia",
        "description": "Encontra posicoes adequadas para artilharia que cubram "
                       "os objetivos indicados. Filtra por alcance, declividade, "
                       "e desenfiamento de observacao inimiga.",
        "parameters": {
            "objetivos": [{"lng": -45.45, "lat": -23.15}],
            "tipo_armamento": "155mm",     # 105mm, 155mm, mortar_120mm, ASTROS
            "inimigos": [{"lng": -45.4, "lat": -23.1}],  # POs inimigos
            "max_resultados": 5
        }
    },
    {
        "name": "calcular_correlacao_forcas",
        "description": "Calcula poder de combate relativo entre forcas amigas e "
                       "inimigas em um setor, considerando terreno e postura.",
        "parameters": {
            "setor": "GeoJSON polygon",
            "amigos": ["lista de SIDCs ou features no setor"],
            "inimigos": ["lista de SIDCs ou features no setor"],
            "postura_amiga": "ataque",  # ataque, defesa, retardo
        }
    },
    {
        "name": "criticar_calco",
        "description": "Analisa features no mapa e identifica falhas doutrinarias. "
                       "Verifica medidas de coordenacao, cobertura de fogos, "
                       "organizacao para o combate.",
        "parameters": {
            "features": "GeoJSON FeatureCollection (todo o mapa)",
            "tipo_operacao": "ataque"  # ataque, defesa, mov_retrogrado
        }
    },
    {
        "name": "buscar_doutrina",
        "description": "Busca trechos relevantes nos manuais doutrinarios do EB "
                       "usando busca semantica (RAG).",
        "parameters": {
            "consulta": "formas de manobra ofensiva",
            "manuais": ["EB20-MC-10.211", "C 100-5"],  # opcional: filtrar manuais
            "max_resultados": 5
        }
    },
]
```

---

## Como cada pergunta e respondida na pratica

### "Onde posicionar artilharia 155mm para cobrir OBJ ALFA e OBJ BRAVO?"

```
1. Frontend envia: mensagem + features do mapa (GeoJSON)
2. Orquestrador envia ao LLM com lista de tools disponiveis
3. LLM decide chamar: encontrar_posicoes_artilharia(
     objetivos=[coords de OBJ ALFA, OBJ BRAVO],
     tipo_armamento="155mm",
     inimigos=[coords de unidades hostis no mapa]
   )
4. Backend executa:
   a. weapon_systems.py → alcance 155mm: min 3km, max 18km
   b. geometry.py → anel de alcance (buffer 18km - buffer 3km) intersectado para ambos obj
   c. slope.py → le DEM GeoTIFF com rasterio, computa slope no anel candidato
   d. Filtra celulas com slope < 8% (requisito do 155mm)
   e. viewshed.py → para cada candidata, verifica se e visivel dos POs inimigos
   f. Filtra candidatas que NAO sao visiveis (desenfiladas)
   g. Ranqueia por: cobertura de ambos objetivos, acesso, dispersao
5. LLM recebe resultado, formula resposta em texto
6. Backend retorna via SSE:
   - Texto: "Identifiquei 3 posicoes adequadas para 155mm..."
   - Features: 3 pontos GeoJSON com propriedades (slope, distancias, justificativa)
7. Frontend mostra texto no chat + features como "sugestoes" no mapa
8. Usuario clica "Aceitar" → addFeature() cria no mapa
```

**O que roda no backend (Python):**
```python
# geo/slope.py
import rasterio
import numpy as np

def compute_slope_grid(dem_path, bbox):
    """Le DEM GeoTIFF, recorta pela bbox, retorna grade de slope em graus."""
    with rasterio.open(dem_path) as dem:
        window = dem.window(*bbox)
        elevation = dem.read(1, window=window)
        transform = dem.window_transform(window)

        # Gradiente em X e Y
        dy, dx = np.gradient(elevation, dem.res[1], dem.res[0])
        slope_rad = np.arctan(np.sqrt(dx**2 + dy**2))
        slope_deg = np.degrees(slope_rad)

        return slope_deg, transform

# geo/viewshed.py
def compute_viewshed(dem_path, observer, radius_m, observer_height=1.8):
    """Viewshed sobre raster DEM. Retorna mascara booleana (visivel/nao)."""
    with rasterio.open(dem_path) as dem:
        # ... ler janela ao redor do observador
        # Algoritmo R3 (reference plane) ou Wang (2000) sobre numpy array
        # Retorna: np.ndarray(bool) — True = visivel
    pass

# military/weapon_systems.py
WEAPON_SYSTEMS = {
    "105mm":       {"min_range": 2500,  "max_range": 11400, "max_slope_pct": 12},
    "155mm":       {"min_range": 3000,  "max_range": 18000, "max_slope_pct": 8},
    "155mm_L52":   {"min_range": 3000,  "max_range": 30000, "max_slope_pct": 8},
    "mortar_81mm": {"min_range": 100,   "max_range": 4500,  "max_slope_pct": 15},
    "mortar_120mm":{"min_range": 200,   "max_range": 6500,  "max_slope_pct": 12},
    "ASTROS_SS30": {"min_range": 9000,  "max_range": 30000, "max_slope_pct": 5},
    "ASTROS_SS40": {"min_range": 15000, "max_range": 40000, "max_slope_pct": 5},
    "ASTROS_SS60": {"min_range": 20000, "max_range": 60000, "max_slope_pct": 5},
    "ASTROS_SS80": {"min_range": 40000, "max_range": 90000, "max_slope_pct": 5},
}
```

### "Essa via de acesso serve para blindados sobre lagartas?"

```
1. Frontend envia: mensagem + feature da linha desenhada no mapa
2. LLM chama: encontrar_rota(
     inicio=ponto_inicial_da_linha,
     fim=ponto_final_da_linha,
     tipo_viatura="blindado_lagarta"
   )
3. Backend executa:
   a. slope.py → grade de declividade na bbox da rota
   b. vehicle_mobility.py → slope maximo para lagarta: 30 graus
   c. pathfinding.py → A* de inicio a fim, custo = f(slope)
      - Celulas com slope > 30° = intransitavel
      - Custo cresce exponencialmente com slope
      - Obstaculos do mapa (minas, destruicoes) = intransitavel
   d. Retorna: rota GeoJSON + perfil + trechos criticos
4. LLM formula: "A via e viavel ate o km 8,3. A partir dai,
   a declividade atinge 35° por 400m, impedindo passagem de
   blindados. Alternativa: desvio de 1,2km pelo vale a leste."
5. Frontend: mostra rota no mapa (verde=ok, vermelho=inviavel)
```

**O que roda no backend:**
```python
# geo/pathfinding.py
from scipy.sparse.csgraph import shortest_path
from scipy.sparse import csr_matrix
import numpy as np

def find_route(slope_grid, start_cell, end_cell, max_slope_deg, obstacles=None):
    """A* sobre grade de slope. Retorna caminho e custo."""
    rows, cols = slope_grid.shape
    n = rows * cols

    # Construir grafo: cada celula conecta a 8 vizinhos
    # Custo = slope da celula destino (exponencial para penalizar)
    # slope > max_slope = infinito (intransitavel)

    costs = np.where(slope_grid <= max_slope_deg,
                     np.exp(slope_grid / 10),  # custo exponencial
                     np.inf)                    # intransitavel

    if obstacles is not None:
        costs[obstacles] = np.inf  # celulas com obstaculos

    # ... montar matriz esparsa e rodar Dijkstra/A*
    # Retorna: lista de celulas no caminho, custo total
```

### "Identifique terreno morto entre os POs da Cia"

```
1. Frontend envia: features com POs (pontos ou simbolos militares)
2. LLM chama: calcular_viewshed(
     observadores=[PO1, PO2, PO3],
     raio_metros=3000,
     area_interesse=poligono_da_area_de_responsabilidade
   )
3. Backend executa:
   a. viewshed.py → viewshed para cada PO sobre o DEM (numpy, rapido)
   b. Uniao de todas as areas visiveis
   c. Subtracao da area de interesse = terreno morto
   d. Vetoriza mascaras raster em poligonos GeoJSON
4. Retorna:
   - Poligonos de terreno morto como features sugeridas
   - Estatistica: "23% da area nao e coberta pelos POs atuais"
   - Sugestao: "Um PO adicional em [-45.47, -23.12] reduziria
     terreno morto para 8%"
```

**O que roda no backend:**
```python
# geo/viewshed.py
def combined_viewshed(dem_path, observers, radius_m):
    """Viewshed combinado de multiplos observadores."""
    combined = None
    for obs in observers:
        vs = compute_viewshed(dem_path, obs, radius_m)
        combined = vs if combined is None else np.logical_or(combined, vs)

    dead_ground = ~combined  # inversao: onde NINGUEM ve
    return dead_ground

def find_optimal_observer(dem_path, dead_ground_mask, candidates_grid):
    """Encontra ponto que maximiza reducao de terreno morto."""
    best_pos, best_reduction = None, 0
    for candidate in candidates_grid:
        vs = compute_viewshed(dem_path, candidate, radius_m)
        reduction = np.sum(dead_ground_mask & vs)
        if reduction > best_reduction:
            best_pos, best_reduction = candidate, reduction
    return best_pos, best_reduction
```

### "Critique esse calco — o que está faltando?"

```
1. Frontend envia: todas as features do mapa como GeoJSON
2. LLM chama: criticar_calco(features=..., tipo_operacao="ataque")
3. Backend executa doctrine_rules.py:
   a. Regras estruturadas verificam presenca/ausencia de elementos:
      - Tem setas de manobra mas nao tem LP/LD? → falta
      - Tem objetivos mas nao tem LCAF? → falta
      - Artilharia posicionada fora do alcance dos objetivos? → erro
      - Unidades sem limites de setor entre elas? → falta
      - Eixos de progressao sem cobertura de fogos? → vulnerabilidade
   b. Regras espaciais verificam coerencia:
      - turf: distancia artilharia-objetivos vs alcance
      - turf: gap entre limites de setor
      - turf: sobreposicao de setores
4. LLM recebe resultado das regras + busca_doutrina() para fundamentar
5. Retorna: lista de problemas com severidade, referencia doutrinaria,
   e sugestoes de correcao
```

**O que roda no backend:**
```python
# military/doctrine_rules.py
from shapely.geometry import shape
from shapely.ops import nearest_points

def critique_attack_overlay(features_geojson):
    """Aplica regras doutrinarias a um calco de ataque."""
    issues = []

    arrows = [f for f in features_geojson if f["properties"].get("ebgeo_type") == "arrow"]
    coord_measures = [f for f in features_geojson if f["properties"].get("ebgeo_type") == "coordination_measure"]
    symbols = [f for f in features_geojson if f["properties"].get("ebgeo_type") == "military_symbol"]
    boundaries = [f for f in features_geojson if f["properties"].get("ebgeo_type") == "boundary"]

    # Regra: ataque precisa de LP/LD
    has_ld = any(
        "lp" in (cm["properties"].get("nome", "") + cm["properties"].get("tipo", "")).lower()
        or "ld" in (cm["properties"].get("nome", "") + cm["properties"].get("tipo", "")).lower()
        for cm in coord_measures
    )
    if arrows and not has_ld:
        issues.append({
            "severity": "high",
            "rule": "ATK_NEEDS_LD",
            "message": "Eixos de progressao definidos mas nao ha Linha de Partida (LP/LD).",
            "doctrine_ref": "EB20-MC-10.211, Cap 5, Sec 5.3",
        })

    # Regra: objetivos precisam de LCAF entre forca amiga e objetivos
    objectives = [cm for cm in coord_measures
                  if "obj" in (cm["properties"].get("nome", "")).lower()]
    has_fscl = any(
        "lcaf" in (cm["properties"].get("nome", "") + cm["properties"].get("tipo", "")).lower()
        or "fscl" in (cm["properties"].get("nome", "") + cm["properties"].get("tipo", "")).lower()
        for cm in coord_measures
    )
    if objectives and not has_fscl:
        issues.append({
            "severity": "high",
            "rule": "NEEDS_FSCL",
            "message": "Objetivos definidos mas nao ha LCAF (Limite de Coordenacao de Apoio de Fogo).",
            "doctrine_ref": "EB20-MC-10.211, Cap 5, Sec 5.4 — Apoio de Fogo",
        })

    # Regra: artilharia dentro do alcance
    friendly_arty = [s for s in symbols
                     if s["properties"].get("standardIdentity") == "3"
                     and is_artillery_sidc(s["properties"].get("sidc", ""))]
    for arty in friendly_arty:
        arty_point = shape(arty["geometry"])
        for obj in objectives:
            obj_point = shape(obj["geometry"])
            dist_m = arty_point.distance(obj_point) * 111320  # graus para metros (aprox)
            weapon = identify_weapon_from_sidc(arty["properties"].get("sidc", ""))
            if weapon and dist_m > weapon["max_range"]:
                issues.append({
                    "severity": "critical",
                    "rule": "ARTY_OUT_OF_RANGE",
                    "message": f"Artilharia '{arty['properties'].get('nome')}' esta a "
                               f"{dist_m/1000:.1f}km do {obj['properties'].get('nome')}, "
                               f"mas alcance maximo e {weapon['max_range']/1000:.0f}km.",
                    "doctrine_ref": "Manual do armamento correspondente",
                })

    # Regra: unidades adjacentes precisam de limites
    friendly_units = [s for s in symbols
                      if s["properties"].get("standardIdentity") == "3"
                      and int(s["properties"].get("echelon", "0")) >= 14]  # Pel+
    if len(friendly_units) > 1 and not boundaries:
        issues.append({
            "severity": "medium",
            "rule": "NEEDS_BOUNDARIES",
            "message": f"{len(friendly_units)} unidades amigas sem limites de setor definidos.",
            "doctrine_ref": "EB20-MC-10.211, Cap 5 — Medidas de coordenacao",
        })

    return issues
```

---

## Frontend: O que precisa ser adicionado ao EBGeo

Pouco codigo. O frontend e fino — so UI de chat e serializacao/desserializacao.

### Estrutura no EBGeo

```
src/js/ai/
  index.js                    # Barrel exports
  ai-chat-panel.js            # UI: painel de chat no sidebar
  ai-chat-panel.css           # Estilos BEM
  ai-service.js               # Fetch + SSE para o backend
  ai-context-builder.js       # Serializa features/layers → GeoJSON para envio
  ai-feature-renderer.js      # Recebe GeoJSON sugerido → addFeature() com confirmacao
  ai-screenshot.js            # Captura canvas MapLibre → base64
```

### ai-service.js — comunicacao com backend

```javascript
export async function sendMessage(message, context, onChunk) {
  const response = await fetch(`${AI_BACKEND_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, context, conversation_id: currentConversationId }),
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const lines = decoder.decode(value).split('\n');
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const event = JSON.parse(line.slice(6));
      onChunk(event); // { type: 'text'|'suggested_features'|'analysis_layer'|'done', ... }
    }
  }
}
```

### ai-context-builder.js — serializa o mapa

```javascript
import { getCurrentMapFeatures, getLayers, getCurrentMapNameSync } from '@store';

export function buildContext(map) {
  const bounds = map.getBounds();
  const features = getCurrentMapFeatures();
  const layers = getLayers();

  // Converte features do formato EBGeo para GeoJSON padrao
  const geojson = toGeoJSON(features, layers);

  return {
    map_name: getCurrentMapNameSync(),
    extent: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
    zoom: map.getZoom(),
    features: geojson,
  };
}
```

### ai-feature-renderer.js — renderiza sugestoes

```javascript
import { addFeature } from '@store';
import { showToast } from '@utils';

export function renderSuggestedFeatures(suggestedFeatures, layerId) {
  // Mostra features como "preview" temporario no mapa (cor diferente, tracejado)
  // Usuario ve botoes "Aceitar" / "Rejeitar"
  // Se aceitar → addFeature() cria permanentemente
  // Se rejeitar → remove preview
}
```

---

## Dados que o backend precisa ter

### 1. DEM (Digital Elevation Model)

- **SRTM 30m** (global, gratuito) ou **ALOS PALSAR** (12.5m, gratuito)
- Formato: GeoTIFF
- Cobertura: territorio brasileiro (ou regiao de interesse)
- Tamanho: SRTM Brasil inteiro ≈ 15GB; por estado ≈ 500MB-2GB

### 2. Tabelas militares (JSON estatico)

```json
// weapon_systems.json
{
  "105mm_M101":   {"min_range_m": 2500,  "max_range_m": 11400, "max_slope_pct": 12, "crew": 8,  "deploy_time_min": 5},
  "155mm_M109A5": {"min_range_m": 3000,  "max_range_m": 18000, "max_slope_pct": 8,  "crew": 6,  "deploy_time_min": 3},
  "ASTROS_SS40":  {"min_range_m": 15000, "max_range_m": 40000, "max_slope_pct": 5,  "crew": 3,  "deploy_time_min": 10}
}

// vehicle_mobility.json
{
  "leopard_1a5":  {"max_slope_deg": 30, "max_side_slope_deg": 15, "fording_m": 1.2, "width_m": 3.4, "weight_t": 42},
  "guarani_6x6":  {"max_slope_deg": 20, "max_side_slope_deg": 12, "fording_m": 1.5, "width_m": 2.7, "weight_t": 18},
  "guaicurus":    {"max_slope_deg": 25, "max_side_slope_deg": 15, "fording_m": 0.7, "width_m": 2.5, "weight_t": 12}
}

// unit_combat_power.json — poder de combate relativo (indice)
{
  "infantry_company":   {"attack": 4,  "defense": 6},
  "armor_company":      {"attack": 8,  "defense": 5},
  "mech_infantry_co":   {"attack": 6,  "defense": 7},
  "artillery_battery":  {"attack": 0,  "defense": 1, "fire_support": 10}
}
```

### 3. Doutrina para RAG

PDFs dos manuais doutrinarios do EB, indexados em chunks com embeddings:
- EB20-MF-10.102 — Doutrina Militar Terrestre
- EB20-MC-10.211 — Processo de Planejamento de Comando
- C 100-5 — Operacoes
- Manuais por funcao de combate

---

## Plano de Implementacao

### Fase 1 — Fundacao (2-3 meses)
Backend basico + chat funcional

**Backend:**
- [ ] Projeto FastAPI com estrutura de pastas
- [ ] Endpoint `/api/chat` com SSE
- [ ] Integracao com Anthropic/OpenAI (llm_service.py)
- [ ] Context parser (GeoJSON → dados estruturados)
- [ ] DEM loading com rasterio (dem.py)
- [ ] Slope grid basico (slope.py)

**Frontend:**
- [ ] Chat panel no sidebar (ai-chat-panel.js)
- [ ] Context builder (ai-context-builder.js)
- [ ] SSE client (ai-service.js)
- [ ] Renderizacao de markdown nas respostas

**Resultado:** chat funciona, LLM ve as features do mapa, pode responder perguntas e chamar slope/elevacao.

### Fase 2 — Analise de Terreno (2-3 meses)
Ferramentas geoespaciais completas

**Backend:**
- [ ] Viewshed sobre raster (viewshed.py)
- [ ] LOS sobre DEM (los.py)
- [ ] Pathfinding A* com slope (pathfinding.py)
- [ ] Tabelas de armamento e viaturas
- [ ] Encontrar posicoes de artilharia
- [ ] Encontrar rotas viaveis
- [ ] Terreno morto (combined viewshed)

**Frontend:**
- [ ] Feature renderer: mostra sugestoes do backend no mapa
- [ ] Botoes aceitar/rejeitar features sugeridas
- [ ] Visualizacao de analysis layers (slope grid colorido, viewshed)

**Resultado:** perguntas como artilharia, rotas, terreno morto funcionam de fato.

### Fase 3 — Critica Doutrinaria + RAG (2-3 meses)
Regras codificadas + doutrina brasileira

**Backend:**
- [ ] Regras doutrinarias (doctrine_rules.py) — ~20 regras iniciais
- [ ] RAG: chunking e indexacao de manuais (ChromaDB)
- [ ] RAG: busca semantica com embeddings
- [ ] Endpoint de critica de calco
- [ ] Parser de OrdOp (PDF/DOCX)

**Frontend:**
- [ ] Importacao de documentos via painel IA
- [ ] Exibicao de criticas com severidade e referencia doutrinaria

**Resultado:** critica de calco funciona, LLM cita doutrina brasileira.

### Fase 4 — Geracao de Calco e Planejamento (3-4 meses)
IA gera features no mapa

**Backend:**
- [ ] Gerador de LA (coa_generator.py)
- [ ] Agente revisor (reviewer)
- [ ] Conversao de conceito textual → features GeoJSON
- [ ] Matriz de sincronizacao
- [ ] Correlacao de forcas por setor

**Frontend:**
- [ ] Visualizacao de multiplas LAs (layers temporarios)
- [ ] Comparacao lado a lado
- [ ] Integracao com briefing (LA → slides)

**Resultado:** EBGeo gera calcos de operacoes a partir de descricao textual.

---

## Stack Tecnica do Backend

```
Python 3.12+
├── FastAPI              # API HTTP + SSE
├── rasterio + GDAL      # Leitura de DEM GeoTIFF
├── numpy + scipy        # Slope, viewshed, pathfinding
├── shapely              # Operacoes geometricas
├── pyproj               # Projecoes (WGS84 ↔ UTM)
├── anthropic / openai   # SDKs de LLM
├── chromadb             # Vector store para RAG
├── sentence-transformers# Embeddings (local)
├── pdfplumber           # Parser de PDF
├── python-docx          # Parser de DOCX
├── uvicorn              # Server ASGI
└── pydantic             # Validacao de request/response
```

### Requisitos de hardware

**Desenvolvimento:** qualquer maquina com Python 3.12
**Producao minima:** 4GB RAM, 2 cores, 20GB disco (para DEM regional)
**Com modelo local (Ollama):** 16GB RAM, GPU recomendada

---

## Seguranca

1. **API keys ficam no backend** — frontend nao ve
2. **Backend em rede local** — nao exposto a internet (mesmo modelo do streetview-api em localhost:8081)
3. **Modo DDIL:** backend roda com Ollama local, sem internet
4. **Sem persistencia de dados no backend** — so processa e retorna, nao armazena features
5. **CORS restrito** — so aceita requests do frontend EBGeo

---

## Comparacao: COA-GPT vs EBGeo-IA

| Aspecto | COA-GPT 2.0 | EBGeo-IA (Proposto) |
|---------|-------------|---------------------|
| Doutrina | US Army (MDMP) | Exercito Brasileiro (PPC/Exame de Situacao) |
| Terreno | Analise de imagem via LLM multimodal | DEM real (rasterio + numpy) — dados quantitativos |
| Viewshed | Nao mencionado | Raster-based sobre DEM, combinacao de multiplos POs |
| Pathfinding | Nao mencionado | A* com custo de declividade + obstaculos |
| Simbologia | COP separado | Integrado nativamente (milsymbol, setas, limites) |
| Calco | Gerado como imagem | Gerado como features editaveis no mapa |
| Simulacao | Simulador externo | Modelo simplificado (correlacao de forcas, Lanchester) |
| Operacao DDIL | Cloud + local (planejado) | Backend local com Ollama (pratico desde a fase 1) |
