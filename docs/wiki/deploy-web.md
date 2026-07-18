# Deploy do pacote web

Publicação do bundle Vite por troca de symlink, servido por NGINX dentro de um container que não enxerga o sistema de arquivos do host.

## `npm run build` não constrói: ele publica

A armadilha começa no nome. `package.json:10` aponta `build` para `deploy/deploy.sh`, que faz build **e** publica: copia o `dist/`, cria uma release datada e troca o symlink de produção. Quem quer só compilar precisa de `build_dev` (`package.json:31`), que é o `vite build` puro.

A inversão é o contrário do que todo hábito de JS espera, e o custo do engano não é simétrico: rodar `build` achando que compila publica sem querer; rodar `build_dev` achando que publica só não publica. Antes de renomear, note que `deploy.sh` é acionado por `npm run build` a partir de qualquer automação que assuma a convenção.

## Por que symlink em vez de sobrescrever `dist/`

O deploy anterior copiava por cima do `dist/` servido. Durante a cópia o NGINX servia um diretório **meio atualizado**: `index.html` novo pedindo chunk que ainda não existia, ou o contrário. Não é hipótese de corrida rara, é a janela inteira da cópia.

Cada build agora vira `releases/<timestamp>` e a publicação é um `ln -sfn` (`deploy/deploy.sh:96`), que o kernel resolve atomicamente. O NGINX resolve o symlink a cada request, então não há restart nem recarga de config. Rollback é o mesmo movimento apontando para a release anterior (`deploy/deploy.sh:48`), e é por isso que as 3 últimas ficam retidas (`deploy/deploy.sh:26,52-58`).

## A armadilha: o symlink precisa ser relativo

`ln -sfn "releases/$RELEASE_NAME"`, nunca `/mnt/dados/.../releases/$RELEASE_NAME`.

O container monta o diretório `deploy/` do host em `/var/www/deploy/`. Um symlink **absoluto** guardaria um caminho do host, que dentro do container não existe: o NGINX segue o link, não acha nada e devolve **404 em tudo**, com o deploy reportando sucesso e o diretório da release visivelmente correto no host. O sintoma não aponta para o symlink.

O `deploy.sh` acerta isso em dois pontos (`:48` e `:96`). Qualquer edição que troque para caminho absoluto (o instinto natural ao "consertar" um symlink quebrado visto do host) reintroduz a falha.

## O que vive fora deste repositório

Duas peças do caminho de deploy **não estão versionadas aqui** e por isso não têm código que sirva de evidência. Elas moram no host, junto do `docker-compose.yml` do EBGeo ASC:

- **Volume do NGINX**: monta `deploy/` inteiro (`./asc/ebgeo-asc/deploy:/var/www/deploy:ro`), não `dist/`. Montar `dist/` de volta desfaz o modelo de releases sem erro nenhum.
- **`location /cms/`**: aponta para `alias /var/www/deploy/current/`. Apontar para `site_asc_dist` era a forma antiga.

Mudança em qualquer um dos dois é invisível a este repositório e a todos os testes. Ver [[deploy-backend]] para o outro lado do mesmo host.

## `deploy/` é protegido

`.claude/hooks/block-protected.js` recusa Edit/Write sob `deploy/`: é script que roda contra a máquina de produção, e o custo de um erro assistido ali não se compara ao de um erro em `src/`. O `.gitignore` versiona o `deploy.sh` e ignora `deploy/releases/` e `deploy/current`, que são artefatos do host.

## Histórico

- 2026-02-18: modelo de releases + symlink swap substitui a sobrescrita direta de `dist/`. Origem desta página, um tutorial solto dentro de `deploy/`, absorvido e removido em 2026-07-18.
- 2026-07-18: removidos `prepare-deploy.js` e o workflow de GitHub Pages, um caminho de publicação paralelo e morto. O script escrevia um `src/js/config.js` estático, premissa que o boot fail-fast em `GET /api/config` invalidou ([[config-dinamico]]), e desde a adoção de `"type": "module"` ele nem executava.
