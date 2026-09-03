#!/usr/bin/env bash
set -uo pipefail

cd "$(dirname "$0")/.." || exit 2

GATES="${GATES:-test,typecheck,build,pack}"
PASS=0
FAIL=0
FAILED_GATES=()

run_gate() {
  local name="$1"
  shift
  local output
  local code
  output="$("$@" 2>&1)"
  code=$?
  if [ "$code" -eq 0 ]; then
    echo "GATE $name PASS"
    PASS=$((PASS + 1))
  else
    echo "GATE $name FAIL (exit $code)"
    echo "$output" | tail -30
    FAIL=$((FAIL + 1))
    FAILED_GATES+=("$name")
  fi
}

gate_enabled() {
  case ",$GATES," in
    *",$1,"*) return 0 ;;
    *) return 1 ;;
  esac
}

echo "== gates: dsh-skill-manager =="
gate_enabled test      && run_gate test      pnpm test
gate_enabled typecheck && run_gate typecheck pnpm run typecheck
gate_enabled build     && run_gate build     pnpm run build
gate_enabled pack      && run_gate pack      node scripts/pack-smoke.mjs

echo "GATES RESULT: PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo "FAILED_GATES: ${FAILED_GATES[*]:-}"
  exit 1
fi
exit 0
