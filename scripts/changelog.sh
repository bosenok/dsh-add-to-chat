#!/bin/sh
# Generate CHANGELOG.md sections from Conventional Commits with git-cliff.
#
#   ./scripts/changelog.sh              # print the unreleased notes
#   ./scripts/changelog.sh v0.1.2       # prepend the next release section
#
# Full regeneration (rewrites the whole file from tags):
#   git cliff -o CHANGELOG.md
set -eu
cd "$(dirname "$0")/.."

if [ "$#" -eq 0 ]; then
  exec git cliff
fi

version=$1
case "$version" in
  v*) tag=$version ;;
  *) tag="v$version" ;;
esac
git cliff --unreleased --tag "$tag" --prepend CHANGELOG.md
echo "CHANGELOG.md updated with $tag"
