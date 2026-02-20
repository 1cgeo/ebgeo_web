#!/usr/bin/env bash
# =============================================================================
# EBGeo Web - Deploy atômico com symlink swap
# Zero downtime: nginx resolve o symlink a cada request, sem restart
#
# Estrutura em /mnt/dados/ebgeo/asc/ebgeo-asc/deploy/:
#   releases/
#     20260218_143022/    <- build anterior
#     20260218_150510/    <- build atual
#   current -> releases/20260218_150510   (symlink relativo)
#
# Uso:
#   ./deploy.sh                 # build + deploy
#   ./deploy.sh --skip-build    # deploy de dist/ existente
#   ./deploy.sh --rollback      # volta para release anterior
# =============================================================================

set -euo pipefail

# ---- Configuração -----------------------------------------------------------

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_DIR="$PROJECT_DIR/deploy"
RELEASES_DIR="$DEPLOY_DIR/releases"
CURRENT_LINK="$DEPLOY_DIR/current"
KEEP_RELEASES=3

# ---- Funções ----------------------------------------------------------------

log()  { echo "[deploy] $(date '+%H:%M:%S') $*"; }
fail() { log "ERRO: $*"; exit 1; }

rollback() {
    log "Rollback solicitado..."

    local releases
    releases=$(ls -1t "$RELEASES_DIR" 2>/dev/null | head -2)
    local current_release previous_release

    current_release=$(echo "$releases" | head -1)
    previous_release=$(echo "$releases" | tail -1)

    if [ "$current_release" = "$previous_release" ] || [ -z "$previous_release" ]; then
        fail "Não há release anterior para rollback"
    fi

    log "Voltando de $current_release para $previous_release"
    ln -sfn "releases/$previous_release" "$CURRENT_LINK"
    log "Rollback concluído! Ativo: $(readlink "$CURRENT_LINK")"
}

cleanup_old_releases() {
    local count
    count=$(ls -1t "$RELEASES_DIR" 2>/dev/null | wc -l)

    if [ "$count" -gt "$KEEP_RELEASES" ]; then
        log "Limpando releases antigas (mantendo $KEEP_RELEASES)..."
        ls -1t "$RELEASES_DIR" | tail -n +"$((KEEP_RELEASES + 1))" | while read -r old; do
            log "  Removendo $old"
            rm -rf "${RELEASES_DIR:?}/$old"
        done
    fi
}

# ---- Main -------------------------------------------------------------------

# Rollback mode
if [ "${1:-}" = "--rollback" ]; then
    rollback
    exit 0
fi

# Garantir diretórios
mkdir -p "$RELEASES_DIR"

# Build (a menos que --skip-build)
if [ "${1:-}" != "--skip-build" ]; then
    log "Executando build..."
    cd "$PROJECT_DIR"
    vite build || fail "Build falhou"
fi

# Verificar dist/
DIST_DIR="$PROJECT_DIR/dist"
[ -f "$DIST_DIR/index.html" ] || fail "dist/index.html não encontrado"

# Criar release
RELEASE_NAME=$(date '+%Y%m%d_%H%M%S')
RELEASE_DIR="$RELEASES_DIR/$RELEASE_NAME"

log "Copiando build para $RELEASE_DIR..."
cp -a "$DIST_DIR" "$RELEASE_DIR"

# Troca atômica do symlink (caminho RELATIVO - essencial para Docker)
log "Trocando symlink (atômico)..."
ln -sfn "releases/$RELEASE_NAME" "$CURRENT_LINK"

log "Deploy concluído: $RELEASE_NAME"
log "Ativo: $(readlink "$CURRENT_LINK")"

# Limpar releases antigas
cleanup_old_releases

log "Pronto! Nginx continua servindo sem restart."
