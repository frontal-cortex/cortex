#!/usr/bin/env sh
# Vendor a snapshot of the official packs from the marketplace repository
# into crates/cortex-core/packs/ for bundling into the app (see build.rs and
# docs/marketplace.md §4). While the packs still live in this repo under
# marketplace/, build.rs reads them from there and this script is not needed.
#
#   tools/sync-packs.sh [<git ref>]      default: main
set -eu
REF="${1:-main}"
REPO="https://github.com/frontal-cortex/marketplace.git"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HERE/crates/cortex-core/packs"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git clone -q --depth 1 --branch "$REF" "$REPO" "$TMP/marketplace"
rm -rf "$DEST"
mkdir -p "$DEST"
# Official tier only: the app bundles what maintainers curate; the rest is fetched.
for id in $(grep -E ': *official$' "$TMP/marketplace/tiers.yaml" | cut -d: -f1); do
  cp -R "$TMP/marketplace/packs/$id" "$DEST/$id"
done
cp "$TMP/marketplace/featured.yaml" "$DEST/../featured.yaml" 2>/dev/null || true
git -C "$TMP/marketplace" rev-parse HEAD > "$DEST/VERSION"
echo "vendored $(ls "$DEST" | grep -vc VERSION) official packs at $(cat "$DEST/VERSION")"
