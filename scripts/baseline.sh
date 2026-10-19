#!/usr/bin/env bash
for f in $(git ls-files 'src/extension/*.js' 'src/extension/**/*.js' | grep -v 'extension/db.js\|extension/supabase.js'); do node --check "$f" 2>&1 | head -3 | sed "s|^|PARSE-FAIL $f: |"; done
npx tsc --noEmit 2>&1 | grep -c 'error TS'
npx vitest run src/ui/src/app/__tests__ 2>&1 | tail -6
npx eslint . 2>&1 | head -3
