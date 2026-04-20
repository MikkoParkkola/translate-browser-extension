#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  echo "Usage: $0 <output-base> <key-file> [dist-dir]" >&2
  exit 1
fi

output_base=$1
key_file=$2
dist_dir=${3:-dist}

if [ ! -d "$dist_dir" ]; then
  echo "Extension bundle directory not found: $dist_dir" >&2
  exit 1
fi

if [ ! -s "$key_file" ]; then
  echo "Signing key is missing or empty: $key_file" >&2
  exit 1
fi

npx -y crx pack "$dist_dir" -o "${output_base}.crx" --zip-output "${output_base}.zip" -p "$key_file"

if [ ! -f "${output_base}.crx" ] || [ ! -f "${output_base}.zip" ]; then
  echo "Expected signed artifacts were not created for ${output_base}" >&2
  exit 1
fi
