# Guia de Integração de Dados 360

Este documento descreve como preparar e integrar novos dados de fotos panorâmicas 360 no EBGeo.

## Visão Geral

O sistema de visualização 360 do EBGeo requer três tipos de dados:

1. **Imagens panorâmicas** (arquivos JPG)
2. **Metadados** (arquivos JSON)
3. **Camadas vetoriais** (PMTiles ou similar)

---

## 1. Estrutura de Diretórios

Os dados devem ser organizados na seguinte estrutura dentro de `public/street_view/`:

```
public/street_view/
├── IMG/                          # Imagens panorâmicas 360
│   ├── MULTICAPTURA_5820_000021.jpg
│   ├── MULTICAPTURA_5820_000022.jpg
│   └── ...
├── METADATA/                     # Arquivos de metadados JSON
│   ├── MULTICAPTURA_5820_000021.json
│   ├── MULTICAPTURA_5820_000022.json
│   └── ...
├── point.png                     # Ícone do ponto no mapa (fornecido)
├── point-selected-v2.png         # Ícone do ponto selecionado (fornecido)
└── street-view-mini-map-style.json  # Estilo do minimapa (fornecido)
```

---

## 2. Formato das Imagens Panorâmicas

### Especificações

| Propriedade | Valor |
|-------------|-------|
| Formato | JPEG (.jpg) |
| Projeção | Equiretangular |
| Proporção | 2:1 (ex: 4096x2048, 8192x4096) |
| Nomeação | Deve corresponder ao campo `img` no metadata |

### Exemplo

```
MULTICAPTURA_5820_000021.jpg
```

---

## 3. Formato dos Metadados JSON

Cada imagem panorâmica precisa de um arquivo JSON correspondente com o mesmo nome.

### Estrutura do Arquivo

```json
{
    "camera": {
        "id": "MULTICAPTURA_5820_000021",
        "img": "MULTICAPTURA_5820_000021",
        "lon": -50.20645833333334,
        "lat": -29.982316666666666,
        "ele": 18.3,
        "heading": 229.22997421299897,
        "height": 2.5,
        "north_correction": 0,
        "ground_offset": 0,
        "distance_scale": 1.0,
        "mesh_rotation_y": 270
    },
    "targets": [
        {
            "id": "MULTICAPTURA_5820_000022",
            "img": "MULTICAPTURA_5820_000022",
            "lon": -50.20654722222223,
            "lat": -29.982383055555555,
            "ele": 18.0,
            "elevation": 18.0,
            "ground_offset": 0,
            "icon": "next",
            "next": true
        }
    ]
}
```

### Campos do Objeto `camera`

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `id` | string | Sim | Identificador único da foto |
| `img` | string | Sim | Nome do arquivo de imagem (sem extensão) |
| `lon` | number | Sim | Longitude em graus decimais (WGS84) |
| `lat` | number | Sim | Latitude em graus decimais (WGS84) |
| `ele` | number | Sim | Elevação em metros |
| `heading` | number | Sim | Direção da câmera em graus (0-360, Norte = 0) |
| `height` | number | Não | Altura da câmera acima do solo (padrão: 2.5m) |
| `north_correction` | number | Não | Correção do Norte em graus (padrão: 0) |
| `ground_offset` | number | Não | Offset adicional de altura (padrão: 0) |
| `distance_scale` | number | Não | Fator de escala para distâncias (padrão: 1.0) |
| `mesh_rotation_y` | number | Não | Rotação Y da esfera em graus (padrão: 270) |

### Campos do Objeto `targets` (array)

Os targets definem os pontos de navegação visíveis a partir da foto atual.

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `id` | string | Sim | Identificador único do target |
| `img` | string | Sim | Nome do arquivo de imagem do target |
| `lon` | number | Sim | Longitude do target |
| `lat` | number | Sim | Latitude do target |
| `ele` | number | Sim | Elevação do target |
| `elevation` | number | Não | Elevação explícita (usa `ele` se omitido) |
| `ground_offset` | number | Não | Offset de altura (padrão: 0) |
| `icon` | string | Não | Tipo de ícone (`"next"`) |
| `next` | boolean | Não | Se true, é o próximo ponto na sequência |

---

## 4. Configuração das Camadas Vetoriais (PMTiles)

As camadas vetoriais são usadas para exibir os pontos clicáveis no mapa 2D.

### Configuração no `config.js`

```javascript
map2d: {
    // ... outras configurações ...

    // ----- Street View Sources -----
    streetViewPointsSource: {
        type: 'vector',
        url: 'pmtiles://https://seu-servidor.com/fotos.pmtiles'
    },
    streetViewPointsSourceLayer: 'fotos',

    streetViewLinesSource: {
        type: 'vector',
        url: 'pmtiles://https://seu-servidor.com/fotos_linha.pmtiles'
    },
    streetViewLinesSourceLayer: 'fotos_linha',
}
```

### Camada de Pontos (`fotos`)

Cada feature deve conter as seguintes propriedades:

| Propriedade | Tipo | Descrição |
|-------------|------|-----------|
| `nome_img` | string | Nome da imagem (usado para carregar o metadata) |
| `ele_img` | number | Elevação do ponto |
| `lat_img` | number | Latitude |
| `long_img` | number | Longitude |

**Geometria:** Point

### Camada de Linhas (`fotos_linha`)

Conecta os pontos de fotos para facilitar a visualização do percurso.

**Geometria:** LineString

---

## 5. Marcadores de Destaque (Opcional)

Para adicionar marcadores especiais que aparecem no mapa quando o 360 está ativo, edite a seção `streetViewMarkers` no `config.js`:

```javascript
streetViewMarkers: [
    {
        id: "ponto-exemplo-01",
        name: "Nome do Ponto",
        description: "Descrição do ponto de observação",
        data_captura: "15/03/2024",
        local: "Cidade, Estado",
        locate: {
            lon: -50.2064,
            lat: -29.9823
        },
        previewThumbnail: "./street_view/IMG/MULTICAPTURA_5820_000021.jpg",
        photoName: "MULTICAPTURA_5820_000021"
    }
]
```

---

## 6. Checklist de Integração

- [ ] Imagens JPG em formato equiretangular (2:1)
- [ ] Arquivos JSON de metadados para cada imagem
- [ ] Nomes de arquivo correspondem entre IMG e METADATA
- [ ] Campos obrigatórios preenchidos (id, img, lon, lat, ele, heading)
- [ ] PMTiles configurado no servidor
- [ ] URLs configuradas no config.js
- [ ] Camadas vetoriais contêm propriedade `nome_img`

---

## 7. Solução de Problemas

### Imagem não carrega

1. Verifique se o arquivo existe em `public/street_view/IMG/`
2. Confirme que o nome no metadata corresponde ao arquivo
3. Verifique o console do navegador para erros de rede

### Navegação não funciona

1. Verifique se os targets existem no metadata
2. Confirme que cada target tem seu próprio arquivo de imagem e metadata
3. Verifique se as coordenadas dos targets estão corretas

### Pontos não aparecem no mapa

1. Verifique a configuração do PMTiles no config.js
2. Confirme que o servidor está servindo os arquivos corretamente
3. Verifique se `streetViewPointsSourceLayer` corresponde ao nome da camada no PMTiles

### Orientação da câmera incorreta

1. Ajuste o campo `heading` no metadata
2. Se necessário, ajuste `north_correction`
3. O campo `mesh_rotation_y` pode precisar de ajuste (padrão: 270)

---

## 8. Ferramentas Úteis

### Conversão de Coordenadas

Para converter coordenadas DMS para graus decimais:
```
Graus Decimais = Graus + (Minutos / 60) + (Segundos / 3600)
```

### Cálculo de Heading

O heading deve apontar para a direção que a câmera estava "olhando" quando a foto foi tirada:
- Norte = 0°
- Leste = 90°
- Sul = 180°
- Oeste = 270°