#!/usr/bin/env bash
# Launch a fresh agent-browser session with the unpacked extension loaded.
# Usage: scripts/launch-test-browser.sh [url]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export AGENT_BROWSER_SESSION="${AGENT_BROWSER_SESSION:-ytthumb-test}"
URL="${1:-https://www.youtube.com/}"
agent-browser close >/dev/null 2>&1 || true
agent-browser --extension "$ROOT" open "$URL"
agent-browser wait 2500
# Dismiss the EU consent dialog if shown (reject non-essential cookies).
agent-browser find role button click --name "Reject the use of cookies and other data for the purposes described" >/dev/null 2>&1 || true
agent-browser wait 2000
