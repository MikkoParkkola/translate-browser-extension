#!/usr/bin/env bash
set -euo pipefail

scratch="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/changesets-publish-test.XXXXXX")"
trap 'find "${scratch}" -depth -delete' EXIT

mkdir -p "${scratch}/repo/.github/scripts" "${scratch}/bin" "${scratch}/home"
cp .github/scripts/changesets-publish.sh "${scratch}/repo/.github/scripts/"
cp package.json "${scratch}/repo/"

# The fake npm records its arguments and whether CHANGESETS_OUTPUT reached it:
# on the token path the release event comes from the CLI inheriting that variable.
cat > "${scratch}/bin/npm" <<'EOF'
#!/usr/bin/env bash
printf '%s output=%s\n' "$*" "${CHANGESETS_OUTPUT:-}" >> "${FAKE_NPM_LOG}"
exit "${FAKE_NPM_EXIT:-0}"
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
package_name="$(node -p "require('${scratch}/repo/package.json').name")"

# changesets/action v2 reads release events from the NDJSON file named by
# CHANGESETS_OUTPUT. Each case gets a fresh file, as the action does per run.
run_publish() {
  export CHANGESETS_OUTPUT="${scratch}/output-$1.ndjson"
  shift
  (cd "${scratch}/repo" && env "$@" bash .github/scripts/changesets-publish.sh)
}

# Prints how many lines of the output file are exactly the expected git-tag event.
tag_events() {
  node -e '
    const fs = require("fs");
    const [file, tag, name] = process.argv.slice(1);
    const lines = fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim());
    console.log(lines.filter((l) => {
      const e = JSON.parse(l);
      return e.type === "git-tag" && e.tag === tag && e.packageName === name;
    }).length);
  ' "$1" "${expected_tag}" "${package_name}"
}

run_publish token-new NPM_TOKEN=test-token
test "$(tr -d '\n' < "${FAKE_NPM_LOG}")" = "run release output=${CHANGESETS_OUTPUT}"
grep -q '_authToken=test-token' "${HOME}/.npmrc"

run_publish tokenless-new FAKE_RELEASE_STATUS=404 NPM_TOKEN=''
test "$(tag_events "${CHANGESETS_OUTPUT}")" -eq 1
git -C "${scratch}/repo" rev-parse --verify --quiet "refs/tags/${expected_tag}" >/dev/null

run_publish tokenless-repair FAKE_RELEASE_STATUS=404 NPM_TOKEN=''
test "$(tag_events "${CHANGESETS_OUTPUT}")" -eq 1

: > "${FAKE_NPM_LOG}"
run_publish token-repair FAKE_RELEASE_STATUS=404 NPM_TOKEN=test-token
test "$(tr -d '\n' < "${FAKE_NPM_LOG}")" = "run release -- --no-git-tag output=${CHANGESETS_OUTPUT}"
test "$(tag_events "${CHANGESETS_OUTPUT}")" -eq 1

run_publish complete FAKE_RELEASE_STATUS=200 NPM_TOKEN='' > "${scratch}/complete.log"
complete_output="$(cat "${scratch}/complete.log")"
# Present but empty: no release to create, and no missing-output warning from the action.
test -f "${CHANGESETS_OUTPUT}"
test ! -s "${CHANGESETS_OUTPUT}"
printf '%s\n' "${complete_output}" | grep -q 'already exist'

if run_publish http-500 FAKE_RELEASE_STATUS=500 NPM_TOKEN=''; then
  echo "release verification unexpectedly accepted HTTP 500" >&2
  exit 1
fi

if run_publish curl-fail FAKE_RELEASE_STATUS=200 FAKE_CURL_EXIT=7 NPM_TOKEN=''; then
  echo "release verification unexpectedly accepted a curl transport failure" >&2
  exit 1
fi

# A failed npm publish must fail the run and record nothing, on both token paths.
if run_publish token-repair-fail FAKE_RELEASE_STATUS=404 FAKE_NPM_EXIT=1 NPM_TOKEN=test-token; then
  echo "token repair unexpectedly succeeded after npm failed" >&2
  exit 1
fi
test ! -s "${CHANGESETS_OUTPUT}"
git -C "${scratch}/repo" tag -d "${expected_tag}" >/dev/null
if run_publish token-new-fail FAKE_NPM_EXIT=1 NPM_TOKEN=test-token; then
  echo "token publish unexpectedly succeeded after npm failed" >&2
  exit 1
fi
test ! -s "${CHANGESETS_OUTPUT}"

# Without CHANGESETS_OUTPUT the script must stop before publishing anything.
: > "${FAKE_NPM_LOG}"
if (cd "${scratch}/repo" && env -u CHANGESETS_OUTPUT NPM_TOKEN=test-token \
  bash .github/scripts/changesets-publish.sh); then
  echo "publish unexpectedly ran without CHANGESETS_OUTPUT" >&2
  exit 1
fi
test ! -s "${FAKE_NPM_LOG}"

echo "changesets publish wrapper: all tests passed"
