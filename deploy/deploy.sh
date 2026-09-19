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
# O pacote web virou frontend/ em 2026-07-18, espelhando backend/. O build sai
# em frontend/dist, nao mais na raiz.
WEB_DIR="$PROJECT_DIR/frontend"
DEPLOY_DIR="$PROJECT_DIR/deploy"
RELEASES_DIR="$DEPLOY_DIR/releases"
CURRENT_LINK="$DEPLOY_DIR/current"
KEEP_RELEASES=3

# ---- Funções ----------------------------------------------------------------

log()  { echo "[deploy] $(date '+%H:%M:%S') $*"; }
fail() { log "ERRO: $*"; exit 1; }

activate_release() {
    local release="$1"
    [ -f "$RELEASES_DIR/$release/index.html" ] || fail "Release incompleta: $release"
    [ ! -e "$CURRENT_LINK" ] || [ -L "$CURRENT_LINK" ] || fail "current precisa ser um symlink"
    local next="$DEPLOY_DIR/.current-next-$$"
    ln -s "releases/$release" "$next"
    # ln -sfn removes the old link before creating the new one. rename(2) replaces
    # the link in one step, with no interval where nginx sees a missing current.
    mv -Tf "$next" "$CURRENT_LINK"
}

carry_release_assets() {
    local source="$1" destination="$2"
    [ -d "$source/assets" ] || return 0
    mkdir -p "$destination/assets"
    if [ -f "$source/.release-assets" ]; then
        while IFS= read -r asset; do
            case "$asset" in assets/*) ;; *) fail "Inventário de assets inválido" ;; esac
            case "$asset" in *../*) fail "Caminho de asset inválido" ;; esac
            mkdir -p "$destination/$(dirname "$asset")"
            [ -e "$destination/$asset" ] || cp "$source/$asset" "$destination/$asset"
        done < "$source/.release-assets"
    else
        cp -an "$source/assets/." "$destination/assets/"
    fi
}

rollback() {
    log "Rollback solicitado..."

    local current_release previous_release
    current_release=$(basename "$(readlink "$CURRENT_LINK")")
    previous_release=$(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' \
        | sort -r | awk -v current="$current_release" 'found { print; exit } $0 == current { found=1 }')

    if [ "$current_release" = "$previous_release" ] || [ -z "$previous_release" ]; then
        fail "Não há release anterior para rollback"
    fi

    log "Voltando de $current_release para $previous_release"
    # A second rollback must also keep chunks used by tabs from the latest release.
    local retained
    while IFS= read -r retained; do
        [ "$retained" = "$previous_release" ] && continue
        carry_release_assets "$RELEASES_DIR/$retained" "$RELEASES_DIR/$previous_release"
    done < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r | head -n "$KEEP_RELEASES")
    activate_release "$previous_release"
    log "Rollback concluído! Ativo: $(readlink "$CURRENT_LINK")"
}

cleanup_old_releases() {
    local count
    count=$(ls -1t "$RELEASES_DIR" 2>/dev/null | wc -l)

    if [ "$count" -gt "$KEEP_RELEASES" ]; then
        log "Limpando releases antigas (mantendo $KEEP_RELEASES)..."
        find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r | tail -n +"$((KEEP_RELEASES + 1))" | while read -r old; do
            log "  Removendo $old"
            rm -rf "${RELEASES_DIR:?}/$old"
        done
    fi
}

# ---- Main -------------------------------------------------------------------

# A second deploy/rollback cannot select or prune releases during this one.
exec 9>"$DEPLOY_DIR/.deploy.lock"
flock -n 9 || fail "Outra publicação está em andamento"

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
    # Via npm, nao `vite` direto: o binario esta em frontend/node_modules/.bin,
    # que so entra no PATH pelo npm do proprio pacote.
    npm run build --prefix frontend || fail "Build falhou"
fi

# Verificar dist/
DIST_DIR="$WEB_DIR/dist"
[ -f "$DIST_DIR/index.html" ] || fail "dist/index.html não encontrado"

# Criar release
RELEASE_NAME=$(date '+%Y%m%d_%H%M%S_%N')
RELEASE_DIR="$RELEASES_DIR/$RELEASE_NAME"

log "Copiando build para $RELEASE_DIR..."
cp -a "$DIST_DIR" "$RELEASE_DIR"

# Keep the original asset inventory before carrying older chunks. Open tabs still
# execute an older entry bundle and may request a lazy chunk after the cutover.
if [ -d "$RELEASE_DIR/assets" ]; then
    (cd "$RELEASE_DIR" && find assets -type f -print) > "$RELEASE_DIR/.release-assets"
fi
while IFS= read -r old; do
    [ "$old" = "$RELEASE_NAME" ] && continue
    carry_release_assets "$RELEASES_DIR/$old" "$RELEASE_DIR"
done < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r | head -n "$KEEP_RELEASES")

# Troca atômica do symlink (caminho RELATIVO - essencial para Docker)
log "Trocando symlink (atômico)..."
activate_release "$RELEASE_NAME"

log "Deploy concluído: $RELEASE_NAME"
log "Ativo: $(readlink "$CURRENT_LINK")"

# Limpar releases antigas
cleanup_old_releases

log "Pronto! Nginx continua servindo sem restart."
