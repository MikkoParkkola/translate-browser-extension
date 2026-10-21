#!/usr/bin/env bash
# changesets/action publish command for translate-by-mikko.
#
# Gates npm publish on the NPM_TOKEN secret:
#   - NPM_TOKEN set   -> configure ~/.npmrc auth + changeset publish
#   - NPM_TOKEN unset -> skip npm, but record the release in the Changesets
#                        output file so the action still creates the git tag
#                        and GitHub release instead of failing with npm ENEEDAUTH.
#
# changesets/action v2 reads release events from the NDJSON file named by
# CHANGESETS_OUTPUT (the Changesets CLI writes there itself); it no longer parses
# `New tag:` lines from stdout.
#
# The previous `publish: npm publish` failed two ways: (1) ENEEDAUTH because no
# ~/.npmrc auth was wired even when a token existed, and (2) hard-failed the
# whole Release run when NPM_TOKEN was absent. This script fixes both.
set -euo pipefail

# Checked before any publish: an event lost after `npm publish` cannot be replayed.
if [ -z "${CHANGESETS_OUTPUT:-}" ]; then
  echo "::error::CHANGESETS_OUTPUT is not set; changesets/action v2 provides it to the publish script." >&2
  exit 1
fi
# An empty file means "nothing released"; a missing one makes the action warn.
touch "${CHANGESETS_OUTPUT}"

package_version="$(node -p "require('./package.json').version")"
package_name="$(node -p "require('./package.json').name")"
tag="v${package_version}"

record_release() {
  node -e 'console.log(JSON.stringify({ type: "git-tag", tag: process.argv[1], packageName: process.argv[2] }))' \
    "${tag}" "${package_name}" >> "${CHANGESETS_OUTPUT}"
  echo "Recorded ${tag} for the GitHub release."
}

github_release_status() {
  : "${GITHUB_TOKEN:?GITHUB_TOKEN is required to verify the GitHub release}"
  : "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required to verify the GitHub release}"
  curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --connect-timeout 10 \
    --max-time 30 \
    --header "Authorization: Bearer ${GITHUB_TOKEN}" \
    --header "Accept: application/vnd.github+json" \
    --header "X-GitHub-Api-Version: 2022-11-28" \
    "${GITHUB_API_URL:-https://api.github.com}/repos/${GITHUB_REPOSITORY}/releases/tags/${tag}"
}

if [ -n "${NPM_TOKEN:-}" ]; then
  echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > "${HOME}/.npmrc"
  if git rev-parse --verify --quiet "refs/tags/${tag}" >/dev/null; then
    # A previous tokenless run can already have created the Git tag and GitHub
    # release. Publish the still-unpublished npm package without asking
    # Changesets to recreate the existing tag, then repair a missing release.
    npm run release -- --no-git-tag
    release_status="$(github_release_status)"
    case "${release_status}" in
      200)
        echo "::notice::npm publication checked with existing ${tag}; its GitHub release already exists."
        ;;
      404)
        record_release
        ;;
      *)
        echo "::error::Could not verify the GitHub release for ${tag} (HTTP ${release_status})." >&2
        exit 1
        ;;
    esac
  else
    npm run release
  fi
else
  if git rev-parse --verify --quiet "refs/tags/${tag}" >/dev/null; then
    release_status="$(github_release_status)"

    case "${release_status}" in
      200)
        echo "::notice::NPM_TOKEN not set and ${tag} plus its GitHub release already exist - nothing to publish."
        ;;
      404)
        # The prior run pushed the tag but failed before creating its release.
        # Record it again so the action repairs that partial state.
        record_release
        ;;
      *)
        echo "::error::Could not verify the GitHub release for ${tag} (HTTP ${release_status})." >&2
        exit 1
        ;;
    esac
  else
    echo "::notice::NPM_TOKEN not set - skipping npm publish and creating ${tag} plus its GitHub release. Set the NPM_TOKEN repo secret to publish translate-by-mikko to the npm registry."
    # The action discovers the release from the output file, then pushes the
    # tag and creates the GitHub release.
    git tag "${tag}"
    record_release
  fi
fi
