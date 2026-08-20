# Pendência: os bytes do tile privado não passam por gate

Apurado em 2026-08-20, durante a auditoria da constituição do produto. **Nada foi
implementado**: o dono decidiu parar aqui e resolver depois. Este arquivo existe para que
a próxima pessoa (ou o próximo agente) não precise refazer a investigação.

## O defeito, e o defeito gêmeo

O endereço do tile de uma camada privada (`config.source` de `data_layers` e
`analysis_layers`) aponta para um servidor de tiles servido pelo nginx, **sem passar por
predicado nenhum**. O catálogo esconde a URL de quem não pode ver a camada; os bytes ficam
abertos a quem a adivinhar ou já a tiver visto. É segurança por obscuridade, a mesma que o
censo de superfícies nomeia e recusa no caso do 3D.

Marcar um recurso como privado **não move byte nenhum**, e o desalinhamento é silencioso.

O gêmeo, de sinal oposto e igualmente aberto: **hoje o navegador pede o tile
anonimamente**. Não existe um único `transformRequest` no frontend (são nove construções
de `maplibregl.Map`), e o login não emite cookie de sessão (o único `res.cookie` do backend
é a renovação deslizante de `flexible-auth.js`, que só dispara perto da expiração).
Consequência: o MVT do 360 e os bytes de tileset privado, que **já** são gateados no
servidor, não desenham para quem tem direito, exceto na janela intermitente em que o cookie
acidental existe.

Ou seja, o acervo privado está simultaneamente **aberto para quem não deveria** e
**quebrado para quem deveria**. Qualquer solução baseada em cabeçalho de requisição herda o
segundo problema, e ele é trabalho separado.

## Escopo real: três tabelas, cinco campos de endereço

O enunciado original falava só de "camada de dados". O escopo medido é maior:

| tabela | campo de endereço | consumidor |
|---|---|---|
| `data_layers` | `config.source` (TileJSON `url` ou `tiles[]`) | `data-layers.manager.js` |
| `data_layers` | `config.labelSource` (segunda fonte, independente) | `data-layers.manager.js` |
| `analysis_layers` | `config.source` (`raster` / `raster-dem`) | `analysis-layers.manager.js` |
| `basemaps` | `config.style` (estilo MapLibre inteiro, com N fontes dentro) | `atlas-settings.service.js` |
| `tilesets` | `config.url` / `basePath` / `preview*` | já fechado por `assets3d-regime.js`; o buraco declarado é o prefixo `/3d/` do nginx |

O basemap privado não estava no enunciado e tem o mesmo defeito, com agravante: o estilo
viaja inteiro no payload. E `labelSource` é a armadilha que `assets3d-regime.js` já resolveu
com listas de campos nomeadas: quem escrever "reescreve `source.url`" fecha uma porta e
deixa a irmã aberta.

**Fora de escopo, deliberadamente:** `terrainUrl`, `hillshadeUrl`, `map3dImageryUrl`,
`glyphsUrl` e `imagensTileUrl` vêm de variável de ambiente, são globais e públicos por
construção. Não têm eixo de acesso e não devem ganhar um por simetria.

**As portas por onde a URL privada sai são duas**, e uma solução precisa cobrir as duas:

1. `listVisiblePrivateResources`
   (`backend/src/modules/resource-access/resource-access.service.js`), a reprojeção do
   payload aditivo;
2. `GET_VISIBLE_CATALOG_DEFINITIONS` (`backend/src/modules/sync/sync.queries.js`), a
   reidratação da definição de camada de catálogo no snapshot de sync.

## Onde os bytes passam hoje

O servidor de tiles **não existe neste repositório**: as ocorrências da palavra são
comentário, `.env.example` e placeholder de formulário. A URL é **texto livre digitado pelo
administrador** e gravado em `config` JSONB, que o Joi valida apenas como "objeto". O
caminho é MapLibre, nginx, servidor de tiles, sem passar por Node. O `location` que faz esse
proxy é config de host, **fora do versionamento**, a mesma classe do prefixo `/3d/`.

Isso importa para a escolha: qualquer opção que ponha o backend no caminho dos bytes cai
numa instância única, sem backplane, cujos caminhos quentes de BLOB já dividem event loop e
CPU com atlas, sync e WebSocket. A referência medida é o MVT do 360: 10,3 MB e cerca de
420 ms em z0 no acervo real.

## As quatro opções

| | (a) proxy no backend | (b) URL assinada | (c) `auth_request` do nginx | (d) só mover o acervo privado |
|---|---|---|---|---|
| **código** | rota nova + gate no molde de `gateDeAsset3d` + reescrita nas 2 portas + credencial nas 9 construções de mapa | assinador + mapa de campos de endereço + assinatura nas 2 portas + endpoint de TileJSON; **frontend zero** | igual a (a) em credencial, mais endpoint interno de authz | nenhum |
| **latência** | +1 hop e todo byte no event loop da instância única | **zero**: o nginx serve direto | +1 subrequest por tile (memoizável) | zero |
| **cache** | perde o cache de borda do privado (correto) | **preservado**: com janela arredondada, a URL é estável e compartilhada dentro dela | delicado de configurar | inalterado |
| **empréstimo por atlas** | funciona com `?atlasId=` | funciona: a URL é cunhada para quem pediu | funciona | não decide nada |
| **visitante de link público** | só se o token dele for anexado | funciona sem nada | idem (a) | não decide nada |
| **defeito próprio** | throughput; e some se alguém esquecer um dos nove mapas | segredo compartilhado com o nginx, fora do repositório; URL é portadora enquanto vale | infra e frontend e trabalho por tile | sozinha é obscuridade |

Duas observações que decidem a comparação:

- **(a) e (c) exigem, antes de qualquer coisa, resolver o transporte de credencial.** Não é
  detalhe de implementação: é a diferença entre "fecha o vazamento" e "fecha o vazamento e
  apaga a camada da tela de quem tem direito". (b) é a única que dispensa credencial no
  pedido do tile, porque a credencial **é** a URL, cunhada num pedido que já foi autenticado
  e já passou pelo predicado.
- **(b) contém (d).** O `secure_link` vale sobre um `location` inteiro, e as URLs públicas
  continuam saindo sem assinatura do `/api/config` memoizado, logo o acervo privado precisa
  de prefixo próprio. Isso converte o defeito fatal de (d) em guarda mecânico: o backend pode
  **recusar com 422** marcar privada uma linha cujos endereços não estejam sob o prefixo
  assinável.

## Recomendação: (b) + (d)

Assinar na cunhagem, verificar no nginx, acervo privado sob prefixo próprio.

Motivo: é a única que fecha os bytes sem primeiro reabrir o problema de autenticação, a
única que não põe tile no event loop, a única que preserva o regime de cache, e o ponto de
aplicação é exatamente onde o predicado já mora (as duas portas acima). É a mesma família do
caso 3D: o regime segue o recurso, o caminho público não toca o gate, e o que fica aberto é
nomeado.

A assinatura cobre um **prefixo de camada**, não um tile, então um token não vira
chave-mestra e o cache continua compartilhado dentro da janela:

```nginx
location ~ ^/cms/martin-privado/(?<camada>[^/]+)/ {
    secure_link      $arg_md5,$arg_expires;
    secure_link_md5  "$secure_link_expires$camada$ebgeo_tile_secret";
    if ($secure_link = "")  { return 403; }
    if ($secure_link = "0") { return 410; }
    proxy_pass http://martin/;
}
```

O MapLibre substitui as chaves de `z`, `x` e `y` por troca literal de string e preserva a
query, então o template assinado funciona sem mudança no cliente.

Para a forma TileJSON (fonte declarada por `url` em vez de `tiles`), assinar a URL do
documento não assina os tiles que ele declara. Solução: um endpoint pequeno, com o mesmo
gate das outras leituras, que busca o TileJSON e reescreve a lista de tiles já assinada.
Custo de uma requisição por camada por sessão, zero tile no Node. A alternativa (converter
para lista de templates na emissão) é mais barata e perde os limites e o zoom máximo
declarados no manifesto, mudando o comportamento de overzoom: não recomendada.

### Tamanho

- **Sem migration.** Nenhuma coluna nova; `access_level` já existe nas quatro tabelas.
- **Backend, novos:** utilitário de assinatura (digest compatível com o nginx e
  arredondamento de janela), mapa de campos de endereço (o análogo de `assets3d-regime.js`,
  com o mesmo cuidado de não deixar campo irmão de fora), e a rota de TileJSON.
- **Backend, tocados:** `resource-access.service.js`, a reidratação de
  `GET_VISIBLE_CATALOG_DEFINITIONS`, `setResourceVisibility` e a escrita do catálogo (guarda
  de prefixo), `backend/src/config.js` e `backend/.env.example`.
- **Frontend:** nada funcional. No máximo o placeholder do formulário e um aviso quando a
  URL não for assinável.
- **Censos que reprovam até serem atualizados:**
  `backend/tests/unit/superficies-de-recurso-censo.test.js` (rota nova, consultas novas,
  regime de cache da resposta) e possivelmente o irmão do frontend.
- **Fora do repositório, e é o custo real:** um `location` novo no nginx do host, o segredo
  em dois lugares, e o acervo privado republicado sob o prefixo. Confirmar com `nginx -V`
  que o módulo de link seguro está compilado. A imagem oficial costuma trazê-lo, mas isso se
  verifica, não se assume.

### O que a recomendação NÃO entrega, dito em voz alta

A URL assinada é portadora e repassável enquanto vale, que é o teto já registrado na wiki
para este desenho. E a revogação passa a ter atraso de uma janela (sugerido: 15 minutos, o
mesmo teto do JWT; a invalidação aqui não pode ser eager como no memo de 30 s do 3D).

## Como isso seria verificado

Sem controle negativo, nada disto é verificação.

1. **Cadeia completa, do gesto ao anônimo.** Três camadas com sufixo aleatório: privada,
   pública, e uma privada fora do prefixo. *Piso:* a URL crua não aparece no payload **e** o
   item privado aparece com assinatura (as duas asserções juntas, porque só a primeira
   passaria verde num payload vazio). *Discriminação:* a camada pública sai byte-idêntica e
   **sem** assinatura. *Segunda porta:* o snapshot de sync também reidrata assinado.
   *Empréstimo:* mesmo principal com e sem `?atlasId=`. *Visitante público:* idem com o token
   de visitante. *Revogação:* no mesmo principal, nunca comparando duas pessoas. *Controle
   negativo:* fazer o assinador devolver a URL intacta deixa o caso privado vermelho e o
   público verde; se o público também ficar vermelho, o teste mede outra coisa.
2. **Vetor dourado do digest** (unitário, sem banco): calculado como o nginx calcula; janela
   estável dentro do intervalo e diferente no seguinte; **camadas diferentes produzem tokens
   diferentes** (senão o token é chave-mestra); segredo diferente produz token diferente.
3. **Guarda de prefixo:** marcar privada uma linha cujo endereço aponte para o prefixo
   público é 422 nomeando o campo. *Controle:* URL absoluta de terceiro é aceita com motivo
   explícito, porque não há como gatear servidor alheio, e essa isenção entra no censo com a
   palavra RISCO.
4. **O que teste nenhum daqui alcança:** que o nginx de produção de fato recusa o tile sem
   assinatura. Isso vira sonda com data, rodada à mão no deploy e com o resultado anotado.
   Sem ela, "os bytes privados estão fechados" é afirmação sobre o repositório, não sobre o
   servidor, que é exatamente a distinção que `assets3d-regime.js` faz sobre o prefixo `/3d/`.

## Perguntas em aberto

1. **Podemos mexer no nginx de produção?** A recomendação inteira depende disso. Se não, a
   segunda melhor é (a), e ela vem com o trabalho de credencial mais o risco de throughput;
   nesse cenário ainda vale fazer (d), porque manter o tile público fora do proxy é o que
   torna (a) viável.
2. **Como o servidor de tiles está publicado?** Se o acervo privado e o público estão no
   mesmo banco, é só caminho novo, não republicação de dado.
3. **Quantas linhas privadas existem hoje nas três tabelas, e que URLs carregam?** A guarda
   de prefixo vai nomeá-las todas de uma vez; convém saber se são três ou trezentas antes de
   ligá-la.
4. **Existe CDN ou cache de proxy na frente do prefixo público?** Muda a escolha da janela:
   janela curta com cache compartilhado vira churn.
