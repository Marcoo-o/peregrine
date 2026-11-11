#!/bin/bash
# Checks the formatting of the files that this branch changes against main, and only those:
#
#     bash scripts/format-changed.sh           # says which changed files Prettier would format differently
#     bash scripts/format-changed.sh --write   # formats them
#
# The code that was there before Prettier was added is not formatted with it (a width of 160 would change about half of the files and hide what each line's
# history says), so the whole repository is not checked, and a file you did not touch is left as it is. A file that you did touch is formatted as a whole when
# you use --write: look at the diff before committing it, and leave a file alone when the formatting would bury your change.
set -e
cd "$(dirname "$(readlink -f "$0")")/.."
BASE="$(git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main)"
FILES="$(git diff --name-only --diff-filter=ACMR "$BASE" -- '*.ts' '*.tsx' '*.js' '*.mjs' '*.cjs' '*.json' ':!package-lock.json')"
if [ -z "$FILES" ]; then echo "no changed files to look at"; exit 0; fi
if [ "$1" = "--write" ]; then
  echo "$FILES" | xargs node_modules/.bin/prettier --write
else
  echo "$FILES" | xargs node_modules/.bin/prettier --check
fi
