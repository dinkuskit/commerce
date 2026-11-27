#!/bin/sh
set -eu

cd "$(dirname "$0")/../.."
symbols=tools/ci/retired-symbols.txt
if git grep -nIF -f "$symbols" -- . ":(exclude)$symbols" \
  ':(exclude).grilltrack/**' ':(exclude)proof/**' ':(exclude).changeset/**' ':(exclude)CHANGELOG.md'; then
  echo 'References to retired Commerce symbols found (see file:line above).' >&2
  exit 1
else
  status=$?
  [ "$status" -eq 1 ] || exit "$status"
fi
