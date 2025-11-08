#!/usr/bin/env python3
# /opt/bettybot/bingo_app.py
import os
import re
import json
import random
import threading
import time
import queue
import subprocess
import atexit
from pathlib import Path
from shutil import which as shutil_which

from flask import Flask, jsonify, request, render_template
from flask_sock import Sock

# ------------------ Paths & Config ------------------
PORT          = int(os.environ.get("PORT", "5000"))

# Mic input hint for listen.sh (ALSA capture device)
DEVICE_HINT   = os.environ.get("ALSA_DEV", "plughw:2,0")

# whisper.cpp binaries / model (used by listen.sh)
WHISPER_BIN   = os.environ.get("WHISPER_BIN", "/opt/bettybot/whisper.cpp/build/bin/whisper-cli")
MODEL_PATH    = os.environ.get("WHISPER_MODEL", "/opt/bettybot/whisper.cpp/models/ggml-tiny.en.bin")

APP_DIR       = Path(__file__).resolve().parent
LISTEN_SH     = str(APP_DIR / "listen.sh")

# Parse-mode coordination with listener/parser
MODE_FILE     = Path("/tmp/betty_parse_mode.txt")  # "SETUP" or "PLAY"

# USB speakers device for playback (card 3, device 0 based on your setup)
AUDIO_DEV     = os.environ.get("AUDIO_DEV", "plughw:3,0")

# ALSA mixer card for speaker volume control (your USB speakers are card 3)
SPEAKER_CARD  = int(os.environ.get("SPEAKER_CARD", "3"))

# Sounds
JINGLE_PATH   = os.environ.get("JINGLE_PATH", "/opt/bettybot/snd/jingle.wav")
VICTORY_PATH  = os.environ.get("VICTORY_PATH", "/opt/bettybot/snd/victory.wav")
WINNER_LOOP_PATH = os.environ.get("WINNER_LOOP_PATH", "/opt/bettybot/snd/winner.wav")

# Gain persistence for mic pipeline (applied in listen.sh)
GAIN_FILE     = Path("/tmp/betty_gain.txt")
DEFAULT_GAIN  = float(os.environ.get("GAIN", "3.0"))
try:
    if not GAIN_FILE.exists():
        GAIN_FILE.write_text(f"{DEFAULT_GAIN:.2f}")
except Exception:
    pass

def read_gain():
    try:
        return max(0.5, min(6.0, float(GAIN_FILE.read_text().strip())))
    except Exception:
        return DEFAULT_GAIN

# ------------------ Output Audio Helpers (speaker) ------------------
def play_wav(path: str):
    """Play a WAV file via the USB speakers, quietly and non-blocking."""
    try:
        if os.path.isfile(path):
            subprocess.Popen(
                ["aplay", "-q", "-D", AUDIO_DEV, path],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )
    except Exception:
        pass

def say(text: str):
    """Prefer pico2wave → aplay, fall back to espeak (slower, clearer for seniors)."""
    text = str(text or "").strip()
    if not text:
        return
    try:
        if shutil_which("pico2wave") and shutil_which("aplay"):
            wav = "/tmp/betty_say.wav"
            subprocess.run(["pico2wave", "-w", wav, "-l", "en-US", text],
                           check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            subprocess.Popen(["aplay", "-q", "-D", AUDIO_DEV, wav],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return
        if shutil_which("espeak") and shutil_which("aplay"):
            wav = "/tmp/betty_say.wav"
            subprocess.run(["espeak", "-s", "150", "-v", "en-us+f3", "-w", wav, text],
                           check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            subprocess.Popen(["aplay", "-q", "-D", AUDIO_DEV, wav],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return
        if shutil_which("espeak"):
            subprocess.Popen(["espeak", "-s", "150", "-v", "en-us+f3", text],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass

# ------------------ Speaker Volume Helpers ------------------
def _amixer_get_percent(card: int, ctl_candidates=("PCM","Speaker","Master")) -> int:
    """Return current volume % for first working control on given card, else -1."""
    for ctl in ctl_candidates:
        try:
            out = subprocess.check_output(
                ["amixer", "-c", str(card), "get", ctl],
                text=True, stderr=subprocess.STDOUT
            )
            m = re.search(r"\[(\d+)%\]", out)
            if m:
                return int(m.group(1))
        except Exception:
            continue
    return -1

def _amixer_set_percent(card: int, pct: int, ctl_candidates=("PCM","Speaker","Master")) -> bool:
    """Set volume % for first control that works."""
    pct = max(0, min(100, int(pct)))
    for ctl in ctl_candidates:
        try:
            subprocess.run(
                ["amixer", "-c", str(card), "sset", ctl, f"{pct}%"],
                check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )
            return True
        except Exception:
            continue
    return False

def get_speaker_volume() -> int:
    return _amixer_get_percent(SPEAKER_CARD)

def set_speaker_volume(pct: int) -> int:
    ok = _amixer_set_percent(SPEAKER_CARD, pct)
    return get_speaker_volume() if ok else -1

# ------------------ Cards / Game State ------------------
LETTER_RANGES = {
    "B": range(1, 16),
    "I": range(16, 31),
    "N": range(31, 46),
    "G": range(46, 61),
    "O": range(61, 76),
}

def new_card(free_enabled=True):
    cols = {}
    for L in "BINGO":
        nums = random.sample(list(LETTER_RANGES[L]), 5)
        cols[L] = nums
    cols["N"][2] = 0  # FREE center sentinel
    marks = {f"{L}{n}": False for L in "BINGO" for n in cols[L] if n != 0}
    marks["FREE"] = bool(free_enabled)
    return {"cols": cols, "marks": marks, "calls": []}

def make_cards(n: int, free_enabled=True):
    n = max(1, min(6, int(n)))
    return [new_card(free_enabled=free_enabled) for _ in range(n)]

def mark_call_on_card(card: dict, letter: str, number: int):
    key = f"{letter}{number}"
    card["calls"].append(key)
    if number in card["cols"][letter]:
        if number == 0:
            card["marks"]["FREE"] = True
        else:
            card["marks"][key] = True

# ------------------ Winner loop (loop winner.wav until confirm) ------------------
class WinnerLooper:
    def __init__(self, wav_path: str):
        self.wav = wav_path
        self._stop = threading.Event()
        self._thr = None

    def start(self):
        self.stop()
        if not os.path.isfile(self.wav):
            return
        self._stop.clear()
        self._thr = threading.Thread(target=self._run, daemon=True)
        self._thr.start()

    def _run(self):
        while not self._stop.is_set():
            try:
                p = subprocess.Popen(["aplay", "-q", "-D", AUDIO_DEV, self.wav],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                while p.poll() is None and not self._stop.is_set():
                    time.sleep(0.1)
                if self._stop.is_set():
                    try:
                        p.terminate()
                    except Exception:
                        pass
                    break
            except Exception:
                break

    def stop(self):
        self._stop.set()

WINNER = WinnerLooper(WINNER_LOOP_PATH)

# ------------------ Game programs (simple set for now) ------------------
PROGRAMS = {
    "CLASSIC": {
        "name": "Classic Bingo",
        "desc": "Standard line bingo. Free space is on.",
        "kind": "classic",
        "params": {"free_enabled": True},
        "preview_cells": []
    },
    "HARD_WAYS": {
        "name": "Hard Ways Bingo",
        "desc": "Line bingo with no free space.",
        "kind": "classic",
        "params": {"free_enabled": False},
        "preview_cells": []
    },
    "LUCKY_7": {
        "name": "Lucky 7",
        "desc": "Top row plus diagonal down-left from top-right.",
        "kind": "fixed_shape",
        "params": {},
        "preview_cells": [[0,0],[0,1],[0,2],[0,3],[0,4],[1,3],[2,2],[3,1],[4,0]]
    },
    "SPECIAL_NUMBER": {
        "name": "Special Number",
        "desc": "After first ball, pre-mark numbers containing its digits; then coverall.",
        "kind": "special_number",
        "params": {"digits": []},
        "preview_cells": []
    },
    "ODD_EVEN": {
        "name": "Odds/Evens",
        "desc": "If first ball is odd, pre-mark odds (or evens if even). Then coverall with the opposite.",
        "kind": "odd_even",
        "params": {"first": None},
        "preview_cells": []
    },
    "GIANT_X": {
        "name": "Giant X",
        "desc": "Both diagonals.",
        "kind": "fixed_shape",
        "params": {},
        "preview_cells": [[i,i] for i in range(5)] + [[i,4-i] for i in range(5)]
    },
    "BARBELL": {
        "name": "Barbell",
        "desc": "Two 3×3 blocks at the top corners with a bar across the middle.",
        "kind": "fixed_shape",
        "params": {},
        "preview_cells": (
            [[r,c] for r in range(0,3) for c in range(0,3)] +
            [[r,c] for r in range(0,3) for c in range(2,5)] +
            [[2,c] for c in range(5)]
        )
    },
    "FIVE_AROUND_CORNER": {
        "name": "Five Around the Corner",
        "desc": "Five around a chosen corner (default top-left).",
        "kind": "fixed_shape",
        "params": {"corner": "TL"},
        "preview_cells": [[0,0],[0,1],[0,2],[1,0],[2,0]]
    },
    "LUCKY_4": {
        "name": "Lucky 4",
        "desc": "Number four: middle row and right column.",
        "kind": "fixed_shape",
        "params": {},
        "preview_cells": [[2,c] for c in range(5)] + [[r,4] for r in range(5)]
    },
    "SIX_PACK": {
        "name": "Six Pack",
        "desc": "A 2×3 block in the center.",
        "kind": "fixed_shape",
        "params": {"orientation": "2x3_center"},
        "preview_cells": [[1,2],[2,2],[3,2],[1,3],[2,3],[3,3]]
    },
    "NINE_PACK": {
        "name": "Nine Pack",
        "desc": "A 3×3 block in the center.",
        "kind": "fixed_shape",
        "params": {"where": "center"},
        "preview_cells": [[r,c] for r in range(1,4) for c in range(1,4)]
    },
}

# ------------------ Global Game State ------------------
GAME = {
    # Views: WELCOME -> SETUP_GAMES -> PROGRAM_PICK -> OVERVIEW/FOCUS
    "view": "WELCOME",
    "session_total_games": None,                 # 1..20
    "session_lineup": [],                        # list of program keys (length = total)
    "current_game_idx": 0,                       # 0-based index into lineup
    "sheet_n": int(os.environ.get("SHEET_CARDS", "3")),  # 1..6
    "cards": [],
    "focus_idx": None,
    "mode": "PLAY",
    "status": "LISTENING",
    "last_heard": "",
    # Active program
    "program_key": "CLASSIC",
    "program": PROGRAMS["CLASSIC"],
    "free_enabled": True,
}
GAME["cards"] = make_cards(GAME["sheet_n"], free_enabled=GAME["free_enabled"])

WS_CLIENTS = set()
EVENT_QUEUE = queue.Queue(maxsize=256)

# ------------------ Helpers: program & session ------------------
def set_program_by_key(key: str, params: dict | None = None):
    key = str(key).upper()
    if key not in PROGRAMS:
        return False
    spec = json.loads(json.dumps(PROGRAMS[key]))  # deep-ish copy
    if params:
        spec["params"].update(params)
    GAME["program_key"] = key
    GAME["program"] = spec
    GAME["free_enabled"] = bool(spec.get("params", {}).get("free_enabled", True))
    # apply FREE on current cards
    for c in GAME["cards"]:
        c["marks"]["FREE"] = bool(GAME["free_enabled"])
    broadcast({"type": "CONFIG", "key": "program", "value": public_state()["program"]})
    broadcast({"type": "STATE", "state": public_state()})
    return True

def program_preview_cells():
    p = GAME["program"]
    cells = p.get("preview_cells", []) or []
    if GAME["program_key"] == "FIVE_AROUND_CORNER":
        corner = (p.get("params", {}) or {}).get("corner", "TL")
        if corner == "TL": return [[0,0],[0,1],[0,2],[1,0],[2,0]]
        if corner == "TR": return [[0,4],[0,3],[0,2],[1,4],[2,4]]
        if corner == "BL": return [[4,0],[3,0],[2,0],[4,1],[4,2]]
        if corner == "BR": return [[4,4],[3,4],[2,4],[4,3],[4,2]]
    return cells

def public_state():
    export_cards = []
    for c in GAME["cards"]:
        export_cards.append({
            "cols": c["cols"],
            "marks": c["marks"],
            "calls": c["calls"][-12:]
        })
    return {
        "view": GAME["view"],
        "session_total_games": GAME["session_total_games"],
        "session_lineup": GAME["session_lineup"],
        "current_game_idx": GAME["current_game_idx"],
        "sheet_n": GAME["sheet_n"],
        "cards": export_cards,
        "focus_idx": GAME["focus_idx"],
        "gain": read_gain(),
        "speaker": get_speaker_volume(),
        "mode": GAME["mode"],
        "status": GAME["status"],
        "last_heard": GAME["last_heard"],
        "program": {
            "key": GAME["program_key"],
            "name": GAME["program"]["name"],
            "desc": GAME["program"]["desc"],
            "kind": GAME["program"]["kind"],
            "params": GAME["program"].get("params", {}),
            "preview_cells": program_preview_cells(),
        },
        "free_enabled": GAME["free_enabled"],
    }

def broadcast(msg: dict):
    dead = []
    for ws in list(WS_CLIENTS):
        try:
            ws.send(json.dumps(msg))
        except Exception:
            dead.append(ws)
    for d in dead:
        WS_CLIENTS.discard(d)

def set_mode(mode: str):
    GAME["mode"] = "DEBUG" if str(mode).upper() == "DEBUG" else "PLAY"
    broadcast({"type": "MODE", "mode": GAME["mode"]})
    broadcast({"type": "STATE", "state": public_state()})

def set_view(v: str):
    GAME["view"] = v
    broadcast({"type": "STATE", "state": public_state()})

def reset_sheet(n: int = None):
    if n is None:
        n = GAME["sheet_n"]
    GAME["sheet_n"] = max(1, min(6, int(n)))
    GAME["cards"] = make_cards(GAME["sheet_n"], free_enabled=GAME["free_enabled"])
    GAME["focus_idx"] = None
    GAME["status"] = "LISTENING"
    broadcast({"type": "STATE", "state": public_state()})

def mark_call(letter: str, number: int):
    for c in GAME["cards"]:
        mark_call_on_card(c, letter, number)
    broadcast({"type": "CALL", "call": f"{letter}{number}", "state": public_state()})

def set_parse_mode(mode: str):
    mode = "SETUP" if str(mode).upper().startswith("SETUP") else "PLAY"
    try:
        MODE_FILE.write_text(mode)
    except Exception:
        pass
    broadcast({"type": "CONFIG", "key": "parse_mode", "value": mode})

# ------------------ Premark helpers ------------------
def _for_all_numbers(fn):  # fn(letter, number) -> bool mark?
    for card in GAME["cards"]:
        for L in "BINGO":
            for n in card["cols"][L]:
                if n == 0:
                    continue
                if fn(L, n):
                    card["marks"][f"{L}{n}"] = True
    broadcast({"type": "STATE", "state": public_state()})

def premark_special_number(ball: int):
    digits = set(str(ball))
    def should_mark(_L, n):
        return any(d in str(n) for d in digits)
    _for_all_numbers(should_mark)
    GAME["program"]["params"]["digits"] = sorted(list(digits))

def premark_odd_even(first_kind: str):
    first_kind = "odd" if str(first_kind).lower().startswith("o") else "even"
    def mark_predicate(_L, n):
        return (n % 2 == 1) if first_kind == "odd" else (n % 2 == 0)
    _for_all_numbers(mark_predicate)
    GAME["program"]["params"]["first"] = first_kind

# ------------------ Listener Thread (mic via listen.sh) ------------------
class Listener(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True)
        self.proc = None
        self._stop = threading.Event()

    def run(self):
        env = os.environ.copy()
        env["ALSA_DEV"]      = DEVICE_HINT
        env["WHISPER_BIN"]   = WHISPER_BIN
        env["WHISPER_MODEL"] = MODEL_PATH
        try:
            self.proc = subprocess.Popen(
                ["bash", LISTEN_SH],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                cwd=str(APP_DIR), env=env, text=True, bufsize=1
            )
        except FileNotFoundError:
            print("listen.sh not found; running without mic.")
            return

        for line in self.proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                evt = json.loads(line)
            except Exception:
                print(f"[listen.sh] {line}")
                continue

            raw = evt.get("raw")
            if raw:
                GAME["last_heard"] = str(raw)
                try:
                    broadcast({"type":"HEARD", "raw": raw})
                except Exception:
                    pass

            EVENT_QUEUE.put(evt)
            if evt.get("type") == "CALL":
                try:
                    mark_call(evt["letter"], int(evt["number"]))
                except Exception:
                    pass
            elif evt.get("type") == "PHRASE":
                if evt.get("event") == "GOOD_BINGO":
                    GAME["status"] = "GOOD_BINGO"
                    if os.path.isfile(VICTORY_PATH):
                        play_wav(VICTORY_PATH)
                    WINNER.start()
                    broadcast({"type": "STATUS", "status": "GOOD_BINGO"})
                elif evt.get("event") == "GAME_CLOSED":
                    GAME["status"] = "GAME_CLOSED"
                    broadcast({"type": "STATUS", "status": "GAME_CLOSED"})

    def stop(self):
        self._stop.set()
        try:
            if self.proc and self.proc.poll() is None:
                self.proc.terminate()
        except Exception:
            pass

listener = Listener()
listener.start()
atexit.register(listener.stop)

# ------------------ Flask App ------------------
app = Flask(
    __name__,
    template_folder=str(APP_DIR / "templates"),
    static_folder=str(APP_DIR / "static"),
)
sock = Sock(app)

# ----------- Page -----------
@app.get("/")
def index():
    return render_template("index.html")

# ----------- State APIs -----------
@app.get("/api/state")
def api_state():
    return jsonify(public_state())

@app.post("/api/start")
def api_start():
    if os.path.isfile(JINGLE_PATH):
        play_wav(JINGLE_PATH)
    set_parse_mode("SETUP")
    set_view("SETUP_GAMES")
    try:
        say("Welcome to Betty Bot. How many games will you be playing tonight?")
    except Exception:
        pass
    return jsonify({"ok": True})

@app.post("/api/set_session_games")
def api_set_session_games():
    d = request.get_json(force=True, silent=True) or {}
    n = int(d.get("count", 1))
    n = max(1, min(20, n))
    GAME["session_total_games"] = n
    GAME["session_lineup"] = []     # we will collect these next
    GAME["current_game_idx"] = 0
    set_view("PROGRAM_PICK")
    set_parse_mode("SETUP")         # keep in setup while picking games
    try:
        say("Great. Let's pick the games. What is game one?")
    except Exception:
        pass
    return jsonify({"ok": True, "count": n})

# ----------- Programs / Session lineup -----------
@app.get("/api/programs")
def api_programs():
    items = []
    for key, spec in PROGRAMS.items():
        items.append({
            "key": key,
            "name": spec["name"],
            "desc": spec["desc"],
            "kind": spec["kind"],
            "params": spec.get("params", {}),
            "preview_cells": spec.get("preview_cells", []),
        })
    return jsonify({
        "programs": items,
        "active": {
            "key": GAME["program_key"],
            "name": GAME["program"]["name"],
            "desc": GAME["program"]["desc"],
            "kind": GAME["program"]["kind"],
            "params": GAME["program"].get("params", {}),
            "preview_cells": program_preview_cells(),
        },
        "session": {
            "total": GAME["session_total_games"],
            "lineup": GAME["session_lineup"],
            "index": GAME["current_game_idx"],
        },
        "free_enabled": GAME["free_enabled"],
    })

@app.post("/api/session/lineup")
def api_session_lineup():
    """
    Body: { lineup: ["CLASSIC","HARD_WAYS",...], replace?:true }
    If lineup shorter than total, we keep collecting via UI.
    """
    d = request.get_json(force=True, silent=True) or {}
    lineup = d.get("lineup") or []
    if not isinstance(lineup, list):
        return jsonify({"ok": False, "error": "lineup must be a list"}), 400
    clean = []
    for k in lineup:
        k2 = str(k).upper()
        if k2 in PROGRAMS:
            clean.append(k2)
    GAME["session_lineup"] = clean[: max(0, int(GAME["session_total_games"] or 0))]
    return jsonify({"ok": True, "session_lineup": GAME["session_lineup"], "total": GAME["session_total_games"]})

@app.post("/api/session/start")
def api_session_start():
    """
    Locks lineup and starts Game 1.
    """
    if not GAME["session_total_games"]:
        return jsonify({"ok": False, "error": "set session games first"}), 400
    if not GAME["session_lineup"]:
        # default to CLASSIC repeated if nothing chosen
        GAME["session_lineup"] = ["CLASSIC"] * GAME["session_total_games"]
    GAME["current_game_idx"] = 0
    key = GAME["session_lineup"][0]
    set_program_by_key(key)
    reset_sheet(GAME["sheet_n"])
    set_parse_mode("PLAY")
    set_view("OVERVIEW")
    say(f"Starting game one: {GAME['program']['name']}.")
    return jsonify({"ok": True, "state": public_state()})

@app.post("/api/game/next")
def api_game_next():
    """
    Advance to the next game in the lineup. Resets sheet and status.
    """
    total = int(GAME["session_total_games"] or 0)
    idx = int(GAME["current_game_idx"] or 0) + 1
    if total == 0:
        return jsonify({"ok": False, "error": "no active session"}), 400
    if idx >= total:
        # end of session
        GAME["current_game_idx"] = total
        GAME["status"] = "SESSION_DONE"
        broadcast({"type": "STATUS", "status": "SESSION_DONE"})
        say("Session complete.")
        return jsonify({"ok": True, "done": True, "state": public_state()})
    GAME["current_game_idx"] = idx
    key = GAME["session_lineup"][idx] if idx < len(GAME["session_lineup"]) else "CLASSIC"
    set_program_by_key(key)
    reset_sheet(GAME["sheet_n"])
    set_parse_mode("PLAY")
    say(f"Starting game {idx+1}: {GAME['program']['name']}.")
    return jsonify({"ok": True, "state": public_state()})

# Special flows
@app.post("/api/program/special-number/premark")
def api_program_special_number_premark():
    if GAME["program_key"] != "SPECIAL_NUMBER":
        return jsonify({"ok": False, "error": "Active program is not Special Number"}), 400
    d = request.get_json(force=True, silent=True) or {}
    ball = int(d.get("ball", -1))
    if ball < 1 or ball > 75:
        return jsonify({"ok": False, "error": "ball must be 1..75"}), 400
    premark_special_number(ball)
    say(f"Special number is {ball}. Matching digits are premarked.")
    return jsonify({"ok": True, "program": public_state()["program"]})

@app.post("/api/program/odd-even/premark")
def api_program_odd_even_premark():
    if GAME["program_key"] != "ODD_EVEN":
        return jsonify({"ok": False, "error": "Active program is not Odd or Even"}), 400
    d = request.get_json(force=True, silent=True) or {}
    first = str(d.get("first","")).strip().lower()
    if first not in ("odd","even"):
        return jsonify({"ok": False, "error": "first must be 'odd' or 'even'"}), 400
    premark_odd_even(first)
    say(f"{first.capitalize()} numbers premarked.")
    return jsonify({"ok": True, "program": public_state()["program"]})

# ----------- Sheet / Focus -----------
@app.post("/api/new_sheet")
def api_new_sheet():
    reset_sheet(GAME["sheet_n"])
    return jsonify({"ok": True})

@app.post("/api/set_sheet_n")
def api_set_sheet_n():
    d = request.get_json(force=True, silent=True) or {}
    n = int(d.get("n", GAME["sheet_n"]))
    reset_sheet(n)
    set_view("OVERVIEW")
    return jsonify({"ok": True, "sheet_n": GAME["sheet_n"]})

@app.post("/api/focus")
def api_focus():
    d = request.get_json(force=True, silent=True) or {}
    idx = int(d.get("index", -1))
    if idx < 0:
        GAME["focus_idx"] = None
        set_view("OVERVIEW")
    else:
        idx = max(0, min(len(GAME["cards"]) - 1, idx))
        GAME["focus_idx"] = idx
        set_view("FOCUS")
    return jsonify({"ok": True, "focus_idx": GAME["focus_idx"], "view": GAME["view"]})

# ----------- Calls -----------
@app.post("/api/sim_call")
def api_sim_call():
    d = request.get_json(force=True, silent=True) or {}
    L = (d.get("letter") or "G").upper()
    n = int(d.get("number") or 46)
    mark_call(L, n)
    return jsonify({"ok": True})

@app.post("/api/repeat")
def api_repeat():
    last = None
    for c in GAME["cards"]:
        if c["calls"]:
            last = c["calls"][-1]
    if last:
        L, n = last[0], int(last[1:])
        mark_call(L, n)
    return jsonify({"ok": True})

# ----------- Winner control -----------
@app.post("/api/winner/stop")
def api_winner_stop():
    WINNER.stop()
    GAME["status"] = "LISTENING"
    broadcast({"type": "STATUS", "status": GAME["status"]})
    # After winner is checked/confirmed, move to next game
    return api_game_next()

# ----------- Mode / Gain / TTS / Audio test -----------
@app.post("/api/mode")
def api_mode_set():
    d = request.get_json(force=True, silent=True) or {}
    set_mode(d.get("mode", "PLAY"))
    return jsonify({"ok": True, "mode": GAME["mode"]})

@app.get("/api/gain")
def api_gain_get():
    return jsonify({"gain": read_gain()})

@app.post("/api/gain")
def api_gain_set():
    d = request.get_json(force=True, silent=True) or {}
    try:
        val = float(d.get("gain", read_gain()))
        val = max(0.5, min(6.0, val))
        GAIN_FILE.write_text(f"{val:.2f}")
        broadcast({"type": "CONFIG", "key": "gain", "value": val})
        return jsonify({"ok": True, "gain": val})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400

@app.post("/api/say")
def api_say():
    d = request.get_json(force=True, silent=True) or {}
    text = str(d.get("text", "")).strip()
    if not text:
        return jsonify({"ok": False, "error": "no text"}), 400
    try:
        say(text)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.post("/api/audio/jingle")
def api_audio_jingle():
    if os.path.isfile(JINGLE_PATH):
        play_wav(JINGLE_PATH)
        return jsonify({"ok": True})
    return jsonify({"ok": False, "error": "jingle not found"}), 404

# ----------- Speaker Volume APIs -----------
@app.get("/api/volume/speaker")
def api_speaker_get():
    vol = get_speaker_volume()
    return jsonify({"speaker": vol})

@app.post("/api/volume/speaker")
def api_speaker_set():
    d = request.get_json(force=True, silent=True) or {}
    pct = int(d.get("speaker", -1))
    newv = set_speaker_volume(pct)
    if newv < 0:
        return jsonify({"ok": False, "error": "Unable to set speaker volume"}), 400
    broadcast({"type": "CONFIG", "key": "speaker", "value": newv})
    return jsonify({"ok": True, "speaker": newv})

# ----------- WebSocket (push state + heard overlays) -----------
@sock.route("/ws")
def ws(ws):
    WS_CLIENTS.add(ws)
    try:
        ws.send(json.dumps({"type": "STATE", "state": public_state()}))
        while True:
            time.sleep(1.0)
            try:
                ws.send(json.dumps({"type": "PING", "t": time.time()}))
            except Exception:
                break
    finally:
        WS_CLIENTS.discard(ws)

# ------------------ Boot defaults ------------------
try:
    MODE_FILE.write_text("PLAY")
except Exception:
    pass

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT)
