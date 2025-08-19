#!/usr/bin/env bash
set -euo pipefail

# Consolidate all unmerged remote branches into a single PR.
# - Attempts a clean merge of each branch into a new consolidation branch
# - Runs tests after each merge; reverts merge if tests fail
# - Archives conflicted/failing branches as patches under .consolidation-archive/
# - Opens a PR with automerge and closes superseded PRs
#
# Requirements: gh, git, npm (tests), network access

DATE="$(date +%Y%m%d-%H%M)"
CONS="codex/consolidate-relevant-${DATE}"
MERGED_LIST=".consolidation-merged.txt"
SKIPPED_LIST=".consolidation-skipped.txt"
ARCHIVE_DIR=".consolidation-archive"

echo "[Consolidate] Preparing consolidation branch: ${CONS}"
git fetch --all --prune
git checkout main
git pull --ff-only
git checkout -b "${CONS}"

: > "${MERGED_LIST}"
: > "${SKIPPED_LIST}"
mkdir -p "${ARCHIVE_DIR}"

echo "[Consolidate] Collecting unmerged remote branches…"
mapfile -t CANDIDATES < <(
  git for-each-ref refs/remotes/origin --sort=-committerdate --format='%(refname:short)' \
    | grep -v -E 'origin/(HEAD|main)$' \
    | while read -r ref; do
        if ! git merge-base --is-ancestor "$ref" origin/main; then
          printf '%s\n' "${ref#origin/}"
        fi
      done
)

# Exclude branches that already have their own PRs open and are current
EXCLUDES=(
  "codex/diagnostics-latency-histogram"
  "codex/provider-tests-mocks"
)
is_excluded() {
  local b="$1"
  for e in "${EXCLUDES[@]}"; do
    [[ "$b" == "$e" ]] && return 0
  done
  return 1
}

echo "[Consolidate] Found ${#CANDIDATES[@]} candidate branches"

for b in "${CANDIDATES[@]}"; do
  [[ -z "$b" ]] && continue
  if is_excluded "$b"; then
    echo "[Consolidate] Skipping excluded: $b"
    continue
  fi

echo "[Consolidate] === Merging origin/${b} ==="
  if ! git merge --no-ff --no-edit "origin/$b"; then
    echo "[Consolidate] Conflict on $b — aborting merge and archiving patches"
    git merge --abort || true
    mkdir -p "${ARCHIVE_DIR}/$b"
    git format-patch --quiet -o "${ARCHIVE_DIR}/$b" "origin/main..origin/$b" || true
    echo "$b" | tee -a "${SKIPPED_LIST}"
    continue
  fi

echo "[Consolidate] Running tests after merging ${b}..."
  if npm test --silent; then
    echo "$b" | tee -a "${MERGED_LIST}"
  else
    echo "[Consolidate] Tests failed for ${b} -- reverting merge and archiving patches"
    git reset --hard HEAD~1
    mkdir -p "${ARCHIVE_DIR}/$b"
    git format-patch --quiet -o "${ARCHIVE_DIR}/$b" "origin/main..origin/$b" || true
    echo "$b" | tee -a "${SKIPPED_LIST}"
  fi
done

echo "[Consolidate] Merged branches:"
cat "${MERGED_LIST}" || true
echo
echo "[Consolidate] Skipped (conflicts/failing tests):"
cat "${SKIPPED_LIST}" || true
echo

echo "[Consolidate] Pushing consolidation branch and opening PR…"
git push -u origin "${CONS}"

PR_URL=$(gh pr create \
  --base main \
  --head "${CONS}" \
  --title "chore: consolidate unmerged improvements (${DATE})" \
  --body "$(printf 'Merged branches:\n\n%s\n\nSkipped (conflicts/failing tests):\n\n%s\n\nArchived patches: %s\n' "$(sed 's/^/- /' "${MERGED_LIST}")" "$(sed 's/^/- /' "${SKIPPED_LIST}")" "${ARCHIVE_DIR}")")

echo "[Consolidate] PR: ${PR_URL}"
gh pr merge --auto --squash "${PR_URL}" || true

echo "[Consolidate] Closing superseded PRs for merged branches…"
while read -r b; do
  [[ -z "$b" ]] && continue
  PRN=$(gh pr list --search "head:$b is:open" --json number -q '.[0].number' || true)
  if [[ -n "${PRN:-}" ]]; then
    gh pr close "$PRN" --comment "Superseded by ${PR_URL} (consolidation)."
  fi
done < "${MERGED_LIST}"

echo "[Consolidate] Optionally closing PRs for skipped branches as outdated (patches archived)..."
while read -r b; do
  [[ -z "$b" ]] && continue
  PRN=$(gh pr list --search "head:$b is:open" --json number -q '.[0].number' || true)
  if [[ -n "${PRN:-}" ]]; then
    gh pr close "$PRN" --comment "Closing as outdated; not merged into consolidation. Patches archived under ${ARCHIVE_DIR}/$b."
  fi
done < "${SKIPPED_LIST}"

echo
echo "[Consolidate] Done. Consolidation PR created: ${PR_URL}"
echo "[Consolidate] CI will auto-merge when green."
echo
echo "[Consolidate] After the PR merges, to delete all remote branches except main, run:"
echo "  git fetch --prune && \\
  git for-each-ref refs/remotes/origin --format='%(refname:short)' | \\
    grep -v -E 'origin/(HEAD|main)$' | \\
    while read ref; do b=\"\${ref#origin/}\"; echo Deleting \"$b\"; gh api -X DELETE \"repos/:owner/:repo/git/refs/heads/$b\" || true; done"
