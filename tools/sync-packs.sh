#!/usr/bin/env sh
# Vendor a snapshot of the official packs from the marketplace repository
# (frontal-cortex/marketplace) into crates/cortex-core/ for bundling into the
# app: packs/ (official tier only), featured.yaml, tiers.yaml, and VERSION
# with the commit they came from. See build.rs and docs/marketplace.md §4.
#
#   tools/sync-packs.sh [<git ref>]             default: main
#   MARKETPLACE_REPO=/path/to/checkout tools/sync-packs.sh   # a local clone instead of GitHub
set -eu
REF="${1:-main}"
REPO="${MARKETPLACE_REPO:-https://github.com/frontal-cortex/marketplace.git}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
CRATE="$HERE/crates/cortex-core"
DEST="$CRATE/packs"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
case "$REPO" in
  http*|git@*|ssh://*) DEPTH="--depth 1" ;;
  *) DEPTH="" ;;   # a local clone: --depth is ignored there and only warns
esac
git -c advice.detachedHead=false clone -q $DEPTH --branch "$REF" "$REPO" "$TMP/marketplace"
rm -rf "$DEST"
mkdir -p "$DEST"
# Official tier only: the app bundles what maintainers curate; the rest is fetched.
for id in $(grep -E ': *official *$' "$TMP/marketplace/tiers.yaml" | cut -d: -f1); do
  cp -R "$TMP/marketplace/packs/$id" "$DEST/$id"
  # Screenshots stay in the marketplace: the app fetches them from the index
  # (build.rs skips images anyway), so keep the vendored copy small.
  rm -rf "$DEST/$id/preview" "$DEST/$id/preview.png"
done
cp "$TMP/marketplace/featured.yaml" "$CRATE/featured.yaml"
cp "$TMP/marketplace/tiers.yaml" "$CRATE/tiers.yaml"
git -C "$TMP/marketplace" rev-parse HEAD > "$CRATE/VERSION"
echo "vendored $(ls "$DEST" | wc -l | tr -d ' ') official packs at $(cut -c1-12 "$CRATE/VERSION") ($REF)"
