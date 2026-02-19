# Deploy Atômico — EBGeo ASC

Data: 2026-02-18

## Problema

O deploy anterior sobrescrevia `dist/` diretamente. Durante a cópia dos arquivos, o nginx podia servir conteúdo incompleto ou inconsistente.

## Solução

Implementado deploy atômico com **releases + symlink swap**. Cada build gera um diretório novo e o symlink `current` é trocado instantaneamente, sem downtime.

```
deploy/
├── releases/
│   ├── 20260218_203503/
│   └── 20260218_204309/
├── current -> releases/20260218_204309
└── deploy.sh
```

## Arquivos alterados

### docker-compose.yml

Volume do nginx alterado para montar o diretório `deploy/` inteiro em vez de `dist/`:

```yaml
# Removido:
- ./asc/ebgeo-asc/dist:/var/www/site_asc_dist:ro

# Adicionado:
- ./asc/ebgeo-asc/deploy:/var/www/deploy:ro
```

### nginx/nginx.conf

Bloco `location /cms/` alterado para apontar para o symlink:

```nginx
# Antes:
location /cms/ {
    alias /var/www/site_asc_dist/;
    index index.html;
}

# Depois:
location /cms/ {
    alias /var/www/deploy/current/;
    index index.html;
}
```

### deploy/deploy.sh

Script criado em `/mnt/dados/ebgeo/asc/ebgeo-asc/deploy/deploy.sh`. Usa symlinks **relativos** (essencial para funcionar dentro do container Docker, que não enxerga caminhos absolutos do host). Mantém as 3 últimas releases.

### .gitignore

Adicionado `deploy/releases/` e `deploy/current`. O `deploy/deploy.sh` permanece versionado.

## Uso

```bash
cd /mnt/dados/ebgeo/asc/ebgeo-asc

# Deploy completo (build + swap)
./deploy/deploy.sh

# Deploy sem rebuild
./deploy/deploy.sh --skip-build

# Rollback para release anterior
./deploy/deploy.sh --rollback

# Fluxo com atualização do repositório
git pull
./deploy/deploy.sh
```

## Observação técnica

O symlink deve ser **relativo** (`releases/NOME`) e não absoluto (`/mnt/.../releases/NOME`). O Docker monta o diretório `deploy/` como `/var/www/deploy/` dentro do container. Um symlink absoluto apontaria para um caminho que não existe dentro do container, causando 404.