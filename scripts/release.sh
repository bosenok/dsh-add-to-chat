#!/bin/sh
# Cut a release through Git Flow, with guards against duplicate and backwards
# versions:
#
#   ./scripts/release.sh patch|minor|major|<x.y.z> [--dry-run]
#
# Before touching anything it verifies: a clean tree on develop, a target that is
# strictly newer than every existing tag (local and origin), no tag or GitHub
# release with that name, and (when package.json exists) the current version.
# Then it bumps package.json, prepends the CHANGELOG with git-cliff, runs
# `git flow release start/finish`, pushes, and creates the GitHub release from the
# new CHANGELOG section. The .githooks hooks enforce the same rules on manual
# release commits and on tag pushes.
set -eu
cd "$(dirname "$0")/.."

usage() {
  echo "usage: $0 patch|minor|major|<x.y.z> [--dry-run]" >&2
  exit 2
}

[ "$#" -ge 1 ] || usage
target=$1
shift
dry_run=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=1 ;;
    *) echo "release: unknown argument: $arg" >&2; usage ;;
  esac
done

fail() { echo "release: $*" >&2; exit 1; }
say() { printf '%s\n' "$*"; }

version_of() {
  python3 - "$1" <<'PY'
import sys
print(sys.argv[1])
PY
}

semver_key() {
  python3 - "$@" <<'PY'
import sys
version = sys.argv[1]
parts = (version.split('.') + ['0', '0', '0'])[:3]
print('.'.join(str(int(part)) for part in parts))
PY
}

# ── preflight ────────────────────────────────────────────────────────────────
command -v git-cliff >/dev/null 2>&1 || fail "git-cliff is required (brew install git-cliff)"
git rev-parse --git-dir >/dev/null 2>&1 || fail "not a git repository"
[ -z "$(git status --porcelain)" ] || fail "working tree is not clean — commit or stash first"
branch=$(git branch --show-current)
[ "$branch" = develop ] || fail "releases are cut from develop (current: ${branch:-detached})"

if ! git flow config >/dev/null 2>&1; then
  git flow config sync >/dev/null 2>&1 || fail "git-flow is not initialized (run ./scripts/gitflow-setup.sh)"
fi
git fetch --tags --prune origin >/dev/null 2>&1 || say "release: warning: could not fetch from origin (offline?)"

current=
if [ -f package.json ]; then
  current=$(python3 -c "import json;print(json.load(open('package.json'))['version'])" 2>/dev/null || true)
fi
highest=$(git tag --list 'v[0-9]*' | sed 's/^v//' | sort -V | tail -1)
base=${current:-$highest}
[ -n "$base" ] || fail "no version source (no package.json and no v-tag yet)"
[ -n "$highest" ] || highest=0.0.0

case "$target" in
  patch|minor|major)
    next=$(python3 - "$base" "$target" <<'PY'
import sys
base, kind = sys.argv[1], sys.argv[2]
major, minor, patch = [int(part) for part in (base.split('.') + ['0', '0'])[:3]]
if kind == 'major':
    major, minor, patch = major + 1, 0, 0
elif kind == 'minor':
    minor, patch = minor + 1, 0
else:
    patch += 1
print(f'{major}.{minor}.{patch}')
PY
    ) ;;
  *)
    printf '%s' "$target" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || fail "version must be x.y.z, patch, minor or major (got: $target)"
    next=$target ;;
esac
tag="v$next"

if [ "$(semver_key "$next")" != "$(printf '%s\n%s\n' "$(semver_key "$next")" "$(semver_key "$highest")" | sort -V | tail -1)" ]; then
  fail "version $next is not newer than the highest existing tag v$highest"
fi
git rev-parse -q --verify "refs/tags/$tag" >/dev/null && fail "tag $tag already exists locally"
git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null 2>&1 && fail "tag $tag already exists on origin"
on_github=0
if command -v gh >/dev/null 2>&1 && git remote get-url origin 2>/dev/null | grep -q 'github\.com'; then
  on_github=1
  gh release view "$tag" >/dev/null 2>&1 && fail "GitHub release $tag already exists"
fi

say "release plan: develop -> release/$next -> master, tag $tag"
say "  current version: ${current:-none} (highest tag v$highest)"
[ "$dry_run" = 1 ] && { say "dry run: nothing changed"; exit 0; }

# ── cut the release ─────────────────────────────────────────────────────────
git flow release start "$next"

python3 - "$next" <<'PY'
import json, os, sys
version = sys.argv[1]
if not os.path.exists('package.json'):
    print('no package.json: version is tag-only')
    raise SystemExit(0)
data = json.load(open('package.json'))
data['version'] = version
json.dump(data, open('package.json', 'w'), indent=2)
open('package.json', 'a').write('\n')
print(f'package.json -> {version}')
PY
git-cliff --unreleased --tag "$tag" --prepend CHANGELOG.md
git add -A
git commit -m "chore(release): v$next"
git flow release finish "$next" -m "v$next"
git push origin master develop --tags

if [ "$on_github" = 1 ]; then
  notes=$(mktemp)
  awk -v tag="$next" 'BEGIN{f=0} $0 ~ "^## \\[" tag "\\]" {f=1; next} f && /^## \[/ {exit} f {print}' CHANGELOG.md > "$notes"
  if [ -s "$notes" ]; then
    gh release create "$tag" --title "$tag" --notes-file "$notes" >/dev/null && say "GitHub release $tag created"
  else
    say "warning: no CHANGELOG section found for $tag; create the GitHub release manually"
  fi
  rm -f "$notes"
fi
say "released $tag"
