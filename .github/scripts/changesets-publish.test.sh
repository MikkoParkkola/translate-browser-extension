#!/usr/bin/env bash
set -euo pipefail

scratch="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/changesets-publish-test.XXXXXX")"
trap 'find "${scratch}" -depth -delete' EXIT

mkdir -p "${scratch}/repo/.github/scripts" "${scratch}/bin" "${scratch}/home"
cp .github/scripts/changesets-publish.sh "${scratch}/repo/.github/scripts/"
cp package.json "${scratch}/repo/"

cat > "${scratch}/bin/npm" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${FAKE_NPM_LOG}"
EOF
cat > "${scratch}/bin/curl" <<'EOF'
#!/usr/bin/env bash
if [ -n "${FAKE_CURL_EXIT:-}" ]; then
  exit "${FAKE_CURL_EXIT}"
fi
printf '%s' "${FAKE_RELEASE_STATUS}"
EOF
chmod +x "${scratch}/bin/npm" "${scratch}/bin/curl"

git -C "${scratch}/repo" init --quiet
git -C "${scratch}/repo" config user.name test
git -C "${scratch}/repo" config user.email test@example.invalid
git -C "${scratch}/repo" add package.json .github/scripts/changesets-publish.sh
git -C "${scratch}/repo" commit --quiet -m fixture

export PATH="${scratch}/bin:${PATH}"
export HOME="${scratch}/home"
export FAKE_NPM_LOG="${scratch}/npm.log"
export GITHUB_TOKEN=test-token
export GITHUB_REPOSITORY=MikkoParkkola/translate-browser-extension
export GITHUB_API_URL=https://api.example.invalid
expected_tag="v$(node -p "require('${scratch}/repo/package.json').version")"

(
  cd "${scratch}/repo"
  NPM_TOKEN=test-token bash .github/scripts/changesets-publish.sh
)
test "$(tr -d '\n' < "${FAKE_NPM_LOG}")" = "run release"
grep -q '_authToken=test-token' "${HOME}/.npmrc"

new_output="$(
  cd "${scratch}/repo"
  FAKE_RELEASE_STATUS=404 NPM_TOKEN='' bash .github/scripts/changesets-publish.sh
)"
test "$(printf '%s\n' "${new_output}" | grep -Fxc "New tag: ${expected_tag}")" -eq 1
git -C "${scratch}/repo" rev-parse --verify --quiet "refs/tags/${expected_tag}" >/dev/null

repair_output="$(
  cd "${scratch}/repo"
  FAKE_RELEASE_STATUS=404 NPM_TOKEN='' bash .github/scripts/changesets-publish.sh
)"
test "$(printf '%s\n' "${repair_output}" | grep -Fxc "New tag: ${expected_tag}")" -eq 1

: > "${FAKE_NPM_LOG}"
token_repair_output="$(
  cd "${scratch}/repo"
  FAKE_RELEASE_STATUS=404 NPM_TOKEN=test-token bash .github/scripts/changesets-publish.sh
)"
test "$(tr -d '\n' < "${FAKE_NPM_LOG}")" = "run release -- --no-git-tag"
test "$(printf '%s\n' "${token_repair_output}" | grep -Fxc "New tag: ${expected_tag}")" -eq 1

complete_output="$(
  cd "${scratch}/repo"
  FAKE_RELEASE_STATUS=200 NPM_TOKEN='' bash .github/scripts/changesets-publish.sh
)"
if printf '%s\n' "${complete_output}" | grep -q '^New tag:'; then
  echo "completed release unexpectedly emitted a tag signal" >&2
  exit 1
fi
printf '%s\n' "${complete_output}" | grep -q 'already exist'

if (
  cd "${scratch}/repo"
  FAKE_RELEASE_STATUS=500 NPM_TOKEN='' bash .github/scripts/changesets-publish.sh
); then
  echo "release verification unexpectedly accepted HTTP 500" >&2
  exit 1
fi

if (
  cd "${scratch}/repo"
  FAKE_RELEASE_STATUS=200 FAKE_CURL_EXIT=7 NPM_TOKEN='' \
    bash .github/scripts/changesets-publish.sh
); then
  echo "release verification unexpectedly accepted a curl transport failure" >&2
  exit 1
fi

echo "changesets publish wrapper: all tests passed"
