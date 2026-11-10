#!/usr/bin/env bash
# Hover the Nth element matching a CSS selector like a user, wait, then click
# whichever thumbnail-download button is on top at the button position.
# Usage: scripts/hover-click.sh "<selector>" [index] [shot.png]
set -euo pipefail
SEL="$1"; IDX="${2:-0}"; SHOT="${3:-}"
export AGENT_BROWSER_SESSION="${AGENT_BROWSER_SESSION:-ytthumb-test}"
read -r X Y < <(agent-browser eval "(() => { const el=document.querySelectorAll($(printf '%s' "$SEL" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))'))[$IDX]; el.scrollIntoView({block:'center'}); const r=el.getBoundingClientRect(); return Math.round(r.x+r.width/2)+' '+Math.round(r.y+r.height/2) })()" | tr -d '"')
agent-browser mouse move "$X" "$Y" >/dev/null
agent-browser wait 1800 >/dev/null
# Locate the top-most download button near the hovered element (preview overlay or thumbnail).
read -r BX BY < <(agent-browser eval "(() => { const el=document.querySelectorAll($(printf '%s' "$SEL" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))'))[$IDX]; const r=el.getBoundingClientRect(); const top=document.elementFromPoint(r.x+21, r.y+21); const b=top && top.closest('.ytthumb-btn'); if(!b) return 'none '+(top?top.tagName+'.'+top.className:'null'); const br=b.getBoundingClientRect(); return Math.round(br.x+br.width/2)+' '+Math.round(br.y+br.height/2) })()" | tr -d '"')
echo "hover=($X,$Y) button=($BX,$BY)"
[ -n "$SHOT" ] && agent-browser screenshot "$SHOT" >/dev/null
[ "$BX" = "none" ] && { echo "NO BUTTON ON TOP"; exit 1; }
agent-browser mouse move "$BX" "$BY" >/dev/null
agent-browser mouse down left >/dev/null; agent-browser mouse up left >/dev/null
agent-browser wait 2500 >/dev/null
agent-browser eval "location.href + ' | states: ' + [...document.querySelectorAll('.ytthumb-btn')].filter(b=>b.dataset.state!=='idle').map(b=>b.dataset.state+':'+(b.dataset.quality||'')).join(',')"
