#!/usr/bin/env bash
# =============================================================================
# EBGeo Web - Deploy atomico com symlink swap
# Zero downtime: nginx nunca serve arquivos incompletos
#
# Estrutura em /opt/ebgeo/:
#   releases/
#     20260216_143022/    <- build anterior
#     20260216_150510/    <- build atual
#   current -> releases/20260216_150510   (symlink)
#
# Uso:
#   ./deploy.sh                 # build local + deploy
#   ./deploy.sh --skip-build    # deploy de dist/ existente
#   ./deploy.sh --rollback      # volta para release anterior
# =============================================================================

set -euo pipefail

# ---- Configuracao -----------------------------------------------------------

DEPLOY_DIR="/opt/ebgeo"
RELEASES_DIR="$DEPLOY_DIR/releases"
CURRENT_LINK="$DEPLOY_DIR/current"
KEEP_RELEASES=3
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ---- Funcoes ----------------------------------------------------------------

log()  { echo "[deploy] $(date '+%H:%M:%S') $*"; }
fail() { log "ERRO: $*"; exit 1; }

rollback() {
    log "Rollback solicitado..."

    # Encontra as 2 releases mais recentes
    local releases
    releases=$(ls -1t "$RELEASES_DIR" 2>/dev/null | head -2)
    local current_release previous_release

    current_release=$(echo "$releases" | head -1)
    previous_release=$(echo "$releases" | tail -1)

    if [ "$current_release" = "$previous_release" ] || [ -z "$previous_release" ]; then
        fail "Nao ha release anterior para rollback"
    fi

    log "Voltando de $current_release para $previous_release"
    ln -sfn "$RELEASES_DIR/$previous_release" "$CURRENT_LINK"
    log "Rollback concluido!"
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

# Garantir diretorios
mkdir -p "$RELEASES_DIR"

# Build (a menos que --skip-build)
if [ "${1:-}" != "--skip-build" ]; then
    log "Executando build..."
    cd "$PROJECT_DIR"
    npm run build || fail "Build falhou"
fi

# Verificar dist/
DIST_DIR="$PROJECT_DIR/dist"
[ -f "$DIST_DIR/index.html" ] || fail "dist/index.html nao encontrado"

# Criar release
RELEASE_NAME=$(date '+%Y%m%d_%H%M%S')
RELEASE_DIR="$RELEASES_DIR/$RELEASE_NAME"

log "Copiando build para $RELEASE_DIR..."
cp -a "$DIST_DIR" "$RELEASE_DIR"

# Troca atomica do symlink
log "Trocando symlink (atomico)..."
ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"

log "Deploy concluido: $RELEASE_NAME"
log "Ativo: $(readlink -f "$CURRENT_LINK")"

# Limpar releases antigas
cleanup_old_releases

log "Pronto! Nginx continua servindo sem restart."
