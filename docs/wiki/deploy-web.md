# Deploy do pacote web

Publicação do bundle Vite por troca de symlink, servido por NGINX dentro de um container que não enxerga o sistema de arquivos do host.

## Dois modos, e o nome de cada um diz o que ele faz

- `npm run dev` sobe o **stack inteiro** (backend `:8080` e Vite `:3000` via `concurrently`). Vite sozinho é `dev:web`, e serve para o Playwright, não para trabalhar: sem backend o boot é fail-fast e a app só mostra "EBGeo indisponível".
- `npm run build` compila (`vite build`, saída em `dist/`). O que entra nesse `dist/`, e o que pesa nele sem precisar, está em [[peso-do-pacote-web]].
- `npm run deploy` publica (`deploy/deploy.sh`), que é o que esta página descreve.

Até 2026-07-18 isto era invertido de um jeito que custava caro: `build` apontava para o `deploy.sh`, ou seja, **publicava em produção**, e quem quisesse só compilar precisava de um `build_dev`. O engano não era simétrico, rodar `build` achando que compilava publicava sem querer. Havia ainda um `npm run preview` que servia o `dist/` sem proxy de `/api`, então nunca conseguiu mostrar a app funcionando. Ambos foram removidos.

## Por que symlink em vez de sobrescrever `dist/`

O deploy anterior copiava por cima do `dist/` servido. Durante a cópia o NGINX servia um diretório **meio atualizado**: `index.html` novo pedindo chunk que ainda não existia, ou o contrário. Não é hipótese de corrida rara, é a janela inteira da cópia.

Cada build vira `releases/<timestamp>`. A publicação prepara um symlink temporário e o move sobre `current` com `mv -Tf` (`deploy/deploy.sh`), que substitui atomicamente. O `ln -sfn` anterior REMOVIA o link antes de criar o novo, e essa é a janela de indisponibilidade que a troca fecha: entre o unlink e o symlink, `current` não existia e o NGINX respondia erro. O NGINX resolve o symlink a cada request, então não há restart nem recarga de config. Publicação e rollback compartilham uma trava `flock`, e o rollback escolhe a versão anterior à que está REALMENTE ativa, não à mais recente em disco.

**A retenção de assets não é higiene, é o preço da aba aberta.** Os chunks em `assets/` das releases retidas (`KEEP_RELEASES`) são mantidos acessíveis dentro da release nova, porque uma aba que ainda executa o bundle anterior pode pedir um módulo tardio DEPOIS da publicação, e aí o nome do chunk carrega o hash do build velho. O manifesto `.release-assets` registra só os arquivos próprios de cada build, que é o que impede a retenção de crescer sem teto; o rollback carrega os assets próprios das releases retidas, inclusive quando executado duas vezes seguidas. **Dois limites declarados:** ela não cobre aba de versão anterior à janela de retenção, e não converte dado novo para o esquema antigo.

## A armadilha: o symlink precisa ser relativo

O destino do symlink deve ser `releases/$RELEASE_NAME`, nunca `/mnt/dados/.../releases/$RELEASE_NAME`.

O container monta o diretório `deploy/` do host em `/var/www/deploy/`. Um symlink **absoluto** guardaria um caminho do host, que dentro do container não existe: o NGINX segue o link, não acha nada e devolve **404 em tudo**, com o deploy reportando sucesso e o diretório da release visivelmente correto no host. O sintoma não aponta para o symlink.

O `deploy.sh` acerta isso em dois pontos. Qualquer edição que troque para caminho absoluto (o instinto natural ao "consertar" um symlink quebrado visto do host) reintroduz a falha.

## O que vive fora deste repositório

Duas peças do caminho de deploy **não estão versionadas aqui** e por isso não têm código que sirva de evidência. Elas moram no host, junto do `docker-compose.yml` do EBGeo ASC:

- **Volume do NGINX**: monta `deploy/` inteiro (`./asc/ebgeo-asc/deploy:/var/www/deploy:ro`), não `dist/`. Montar `dist/` de volta desfaz o modelo de releases sem erro nenhum.
- **`location /cms/`**: aponta para `alias /var/www/deploy/current/`. Apontar para `site_asc_dist` era a forma antiga.

Mudança em qualquer um dos dois é invisível a este repositório e a todos os testes. Ver [[deploy-backend]] para o outro lado do mesmo host.

## `deploy/` roda contra produção

Não há mais bloqueio automático (o hook `PreToolUse` foi removido em 2026-07-18), então a cautela aqui é humana: este script troca o symlink que o NGINX serve, e o custo de um erro não se compara ao de um erro em `frontend/src/`. O `.gitignore` da raiz versiona o `deploy.sh` e ignora `deploy/releases/` e `deploy/current`, que são artefatos do host.

## O segundo navegador é um comando próprio, e "verde" no primeiro não diz nada sobre ele

A camada de navegador (`frontend/tests/e2e-ui/`) roda em Chromium e **só** em Chromium: o projeto `firefox` do `frontend/playwright.config.js` nem entra no array de projetos a menos que a linha de comando o nomeie, o que é deliberado (um segundo projeto no array dobraria a suíte inteira em silêncio). O comando é `npm run test:e2e:firefox`, na raiz e no frontend, que roda a camada INTEIRA no segundo navegador, mais `npm run test:e2e:atlas -- --project=firefox` para o cenário de config dedicada; a matriz mínima da homologação é um recorte desses casos, e o recorte está escrito no README da camada. O binário se busca uma vez com `npx playwright install firefox`, que baixa para o cache global do Playwright e não toca o repositório. A matriz medida, caso a caso, vive em `frontend/tests/e2e-ui/README.md`.

O que a primeira passada dessa matriz ensinou, e que vale além do Firefox:

- **Um pedido opcional pode segurar o boot inteiro, e `try/catch` não protege disso.** `navigator.storage.persist()` é concedido por heurística no Chromium e por DIÁLOGO no Firefox, onde a promessa fica pendente até alguém responder. Com o boot aguardando esse pedido, o mapa não montava e nada aparecia: sem erro, sem console, sem tela de indisponível. `try/catch` cobre a promessa que rejeita e não cobre a que nunca se resolve. Ver [[sessao-boot-e-ciclo-de-vida]].
- **O aparelho de medir tem um limite que se parece com defeito do produto.** O driver de Firefox do Playwright 1.61.1 quebra ao ver um WebSocket cujo aperto de mão ele não registrou, e o `/@vite/client` que o Vite injeta dentro do worker do MapLibre abre exatamente um desses: o processo do Playwright morre com `Error: Assertion error` e leva a rodada junto, sem teste vermelho. O `vite.e2e.config.js` troca o soquete do cliente por um dublê inerte, o que de quebra entrega a ausência de canal que o controle A0z daquela camada queria e não conseguia.
- **Um vermelho de relógio acusa o passo errado.** O Firefox custa cerca de 3x contra o dev server, e um caso que estoura o orçamento reprova apontando para o que estava em voo naquele instante. Daí o `timeout` triplo do projeto e o teto de elo por projeto em `frontend/tests/e2e-ui/helpers/full-chain.js`: relógio, nunca asserção.

## Histórico

- 2026-02-18: modelo de releases + symlink swap substitui a sobrescrita direta de `dist/`. Origem desta página, um tutorial solto dentro de `deploy/`, absorvido e removido em 2026-07-18.
- 2026-07-18: removidos `prepare-deploy.js` e o workflow de GitHub Pages, um caminho de publicação paralelo e morto. O script escrevia um `frontend/src/js/config.js` estático, premissa que o boot fail-fast em `GET /api/config` invalidou ([[config-dinamico]]), e desde a adoção de `"type": "module"` ele nem executava.
