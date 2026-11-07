#!/bin/sh
# Activate the committable .gitflow configuration in a fresh clone and make
# sure the two base branches (master, develop) exist locally.
set -eu
cd "$(dirname "$0")/.."

git flow config sync
git fetch origin --prune
for branch in master develop; do
  if ! git show-ref --verify --quiet "refs/heads/$branch"; then
    git branch --track "$branch" "origin/$branch"
    echo "created local branch $branch"
  fi
done
# Enable the committable Git hooks (release guards).
if [ -d .githooks ]; then
  git config core.hooksPath .githooks
  echo "git hooks enabled: core.hooksPath=.githooks"
fi

echo "git-flow ready: master + develop, tag prefix v. Current branch: $(git branch --show-current)"
