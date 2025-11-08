#!/usr/bin/env bash
# /opt/bettybot/listen.sh — VAD-triggered chunks for Whisper -> bingo_parse (JSON to stdout)
set -Eeuo pipefail

# ---------- Core Config ----------
DEV_IN="${ALSA_DEV:-}"
WHISPER_BIN="${WHISPER_BIN:-/opt/bettybot/whisper.cpp/build/bin/whisper-cli}"
MODEL_PATH="${WHISPER_MODEL:-/opt/bettybot/whisper.cpp/models/ggml-tiny.en.bin}"

LEN="${LEN:-3.0}"                 # seconds per chunk
THREADS="${WHISPER_THREADS:-6}"
FAST_DECODE="${FAST_DECODE:-1}"   # 1 = greedy decode flags
SPEEDUP="${WHISPER_SPEEDUP:-0}"   # 1 = add --speed-up if supported
DEBUG="${DEBUG:-1}"

PROMPT_TEXT=${PROMPT_TEXT:-$'You will hear bingo calls spoken twice, e.g., "B twelve, B one two". Output a single normalized call in the format "<LETTER> <NUMBER>" (e.g., "B 12"). Valid letters: B,I,N,G,O. Valid ranges: B 1–15, I 16–30, N 31–45, G 46–60, O 61–75. Output only the call.'}

# --- Mode-aware prompts (added) ---
PROMPT_PLAY=${PROMPT_PLAY:-"$PROMPT_TEXT"}
PROMPT_SETUP=${PROMPT_SETUP:-$'You will hear very short answers. Transcribe only “yes”, “no”, or a number 1–20 (digits preferred). Do not add extra words.'}
MODE_FILE="/tmp/betty_parse_mode.txt"
read_mode(){ [[ -f "$MODE_FILE" ]] && awk 'NR==1{print toupper($0)}' "$MODE_FILE" || echo "PLAY"; }

# ---------- Audio / VAD Config ----------
CAP_RATE="${CAP_RATE:-16000}"
CAP_BITS=16
CAP_IN_CH="${CAP_IN_CH:-2}"

USE_VAD="${USE_VAD:-1}"
VAD_THRESH_PCT="${VAD_THRESH_PCT:-2}"
VAD_LEAD="${VAD_LEAD:-0.15}"

# ---------- Paths ----------
TMPDIR="/tmp/betty_chunks"
mkdir -p "$TMPDIR"
GAIN_FILE="/tmp/betty_gain.txt"

# ---------- Helpers ----------
have(){ command -v "$1" >/dev/null 2>&1; }
dbg(){ [[ "$DEBUG" = "1" ]] && echo "[DEBUG] $*" >&2 || true; }
read_gain(){ [[ -f "$GAIN_FILE" ]] && awk 'BEGIN{v=3}{v=$1}END{if(v<0.5)v=0.5;if(v>12)v=12;printf("%.2f",v)}' "$GAIN_FILE" 2>/dev/null || echo "3.00"; }

# ---------- Sanity ----------
for dep in sox soxi sed awk; do have "$dep" || { echo "❌ Missing dependency: $dep" >&2; exit 1; }; done
[[ -x "$WHISPER_BIN" ]] || { echo "❌ whisper-cli not executable: $WHISPER_BIN" >&2; exit 1; }
[[ -f "$MODEL_PATH"   ]] || { echo "❌ model not found: $MODEL_PATH" >&2; exit 1; }
if have stdbuf; then STDBUF_CMD=(stdbuf -oL -eL); else STDBUF_CMD=(); fi

# ---------- Device probe ----------
pick_device() {
  local trylist=()
  [[ -n "$DEV_IN" ]] && trylist+=("$DEV_IN")
  trylist+=(
    "plughw:CARD=ArrayUAC10,DEV=0" "hw:CARD=ArrayUAC10,DEV=0"
    "sysdefault:CARD=ArrayUAC10" "front:CARD=ArrayUAC10,DEV=0" "dsnoop:CARD=ArrayUAC10,DEV=0"
    "plughw:2,0" "hw:2,0" "plughw:1,0" "hw:1,0" "default" "sysdefault"
  )
  for d in "${trylist[@]}"; do
    [[ -z "$d" ]] && continue
    if have arecord; then
      if arecord -q -D "$d" -f S16_LE -c "$CAP_IN_CH" -r "$CAP_RATE" -d 1 -t raw >/dev/null 2>&1; then
        dbg "arecord probe OK: $d"; echo "$d"; return 0
      else
        dbg "arecord probe failed: $d"
      fi
    fi
    if [[ "$DEBUG" = "1" ]]; then
      if sox -V3 -t alsa "$d" -r "$CAP_RATE" -c "$CAP_IN_CH" -b "$CAP_BITS" -e signed-integer "$TMPDIR/probe.wav" trim 0 0.2; then
        rm -f "$TMPDIR/probe.wav"; dbg "sox probe OK: $d"; echo "$d"; return 0
      else
        dbg "sox probe failed: $d"
      fi
    else
      if sox -V0 -t alsa "$d" -r "$CAP_RATE" -c "$CAP_IN_CH" -b "$CAP_BITS" -e signed-integer "$TMPDIR/probe.wav" trim 0 0.2 2>/dev/null; then
        rm -f "$TMPDIR/probe.wav"; echo "$d"; return 0
      else
        dbg "Probe failed: $d"
      fi
    fi
  done
  return 1
}

# Warn if Flask may also hold the mic (harmless if you pass ALSA_DEV)
if pgrep -f bingo_app.py >/dev/null 2>&1; then
  dbg "Note: bingo_app.py is running and may hold the mic unless ALSA_DEV is set."
fi

DEV="$(pick_device)" || { echo "❌ No working ALSA capture device." >&2; exit 1; }
echo "✅ Using device: $DEV | LEN=${LEN}s | RATE=${CAP_RATE} | CH=${CAP_IN_CH} | THREADS=$THREADS | GAIN=$(read_gain) | VAD=$USE_VAD" >&2

# ---------- Main loop ----------
i=0
while true; do
  i=$((i+1))
  RAW="$TMPDIR/raw_${i}.wav"
  MONO="$TMPDIR/mono_${i}.wav"
  PROC="$TMPDIR/proc_${i}.wav"

  # 1) Capture chunk (VAD or open-mic)
  if [[ "$USE_VAD" = "1" ]]; then
    echo "[REC] waiting for voice (>${VAD_THRESH_PCT}% for ${VAD_LEAD}s) …" >&2
    if [[ "$DEBUG" = "1" ]]; then
      sox -V3 -t alsa "$DEV" -r "$CAP_RATE" -c "$CAP_IN_CH" -b "$CAP_BITS" -e signed-integer "$RAW" \
        silence 1 "$VAD_LEAD" "${VAD_THRESH_PCT}%" trim 0 "$LEN" \
        || { echo "⚠️ VAD capture failed; retrying…" >&2; sleep 0.2; continue; }
    else
      sox -V0 -t alsa "$DEV" -r "$CAP_RATE" -c "$CAP_IN_CH" -b "$CAP_BITS" -e signed-integer "$RAW" \
        silence 1 "$VAD_LEAD" "${VAD_THRESH_PCT}%" trim 0 "$LEN" 2>/dev/null \
        || { echo "⚠️ VAD capture failed; retrying…" >&2; sleep 0.2; continue; }
    fi
  else
    echo "[REC] open-mic chunk $i…" >&2
    if ! sox -V0 -t alsa "$DEV" -r "$CAP_RATE" -c "$CAP_IN_CH" -b "$CAP_BITS" -e signed-integer "$RAW" trim 0 "$LEN" 2>/dev/null; then
      echo "⚠️ SoX capture failed; retrying…" >&2; sleep 0.2; continue
    fi
  fi

  # 2) Ensure mono
  if soxi -c "$RAW" 2>/dev/null | grep -q '^2$'; then
    if ! sox -V0 "$RAW" "$MONO" remix 1 2>/dev/null; then MONO="$RAW"; fi
  else
    MONO="$RAW"
  fi
  rm -f "$RAW" 2>/dev/null || true

  # 3) Apply software gain
  GAIN="$(read_gain)"
  if ! sox -V0 -v "$GAIN" "$MONO" "$PROC" 2>/dev/null; then
    PROC="$MONO"
  fi

  # 4) Whisper -> transcript text (trim engine noise)
  EXTRA_FLAGS=()
  [[ "$FAST_DECODE" = "1" ]] && EXTRA_FLAGS+=(-bo 1 -bs 1 -nf)
  if [[ "$SPEEDUP" = "1" ]]; then
    "$WHISPER_BIN" -h 2>&1 | grep -q -- "--speed-up" && EXTRA_FLAGS+=(--speed-up)
  fi

  MODE_NOW="$(read_mode)"
  if [[ "$MODE_NOW" == "SETUP" ]]; then
    ACTIVE_PROMPT="$PROMPT_SETUP"
  else
    ACTIVE_PROMPT="$PROMPT_PLAY"
  fi
  EXTRA_FLAGS+=(--suppress-nst --prompt "$ACTIVE_PROMPT")

  echo "[WH] transcribing chunk $i… (mode=$MODE_NOW)" >&2
  TRANSCRIPT="$(
    "${STDBUF_CMD[@]}" "$WHISPER_BIN" -m "$MODEL_PATH" -t "$THREADS" \
      --language en --no-timestamps -sow -f "$PROC" "${EXTRA_FLAGS[@]}" 2>&1 \
    | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//; /^[[:space:]]*$/d; /^whisper_/d; /^system_info/d'
  )"

  # 5) Feed transcript to parser -> emit JSON to stdout for Flask
  if [[ -n "$TRANSCRIPT" ]]; then
    echo "[DEBUG_RAW][$MODE_NOW] $TRANSCRIPT" >&2
    if have python3; then PYBIN=python3; else PYBIN=/opt/bettybot/venv/bin/python; fi
    printf '%s\n' "$TRANSCRIPT" | "$PYBIN" -u /opt/bettybot/bingo_parse.py
  else
    echo "[DEBUG] (no transcript text this chunk)" >&2
  fi

  # 6) Housekeeping (keep last ~5 chunks)
  rm -f "$TMPDIR"/mono_$((i-5)).wav "$TMPDIR"/proc_$((i-5)).wav 2>/dev/null || true
done
