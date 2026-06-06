#!/usr/bin/env bash
# changesets/action publish command for translate-by-mikko.
#
# Gates npm publish on the NPM_TOKEN secret:
#   - NPM_TOKEN set   -> configure ~/.npmrc auth + npm publish
#   - NPM_TOKEN unset -> skip with a ::notice:: (exit 0) so the release still
#                        versions and creates the GitHub release instead of
#                        failing with npm ENEEDAUTH.
#
# The previous `publish: npm publish` failed two ways: (1) ENEEDAUTH because no
# ~/.npmrc auth was wired even when a token existed, and (2) hard-failed the
# whole Release run when NPM_TOKEN was absent. This script fixes both.
set -euo pipefail

if [ -n "${NPM_TOKEN:-}" ]; then
  echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > "${HOME}/.npmrc"
  npm publish
else
  echo "::notice::NPM_TOKEN not set - skipping npm publish. The version bump and GitHub release are still created. Set the NPM_TOKEN repo secret to publish translate-by-mikko to the npm registry."
fi
