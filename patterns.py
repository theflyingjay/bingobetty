# /opt/bettybot/patterns.py
from __future__ import annotations
import json
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
PATTERN_FILE = APP_DIR / "patterns.json"
PATTERN_SCHEMA_VERSION = 2  # bump: now includes "programs"

# ---------- tiny helpers ----------
def row(r): return [[r, c] for c in range(5)]
def col(c): return [[r, c] for r in range(5)]

# ---------- shape presets (pure [r,c] cells) ----------
# These are generic shapes the UI can draw/animate and (later) win-check against.
PRESET_PATTERNS = {
    "Giant X": {
        "description": "Both diagonals.",
        "cells": [[i, i] for i in range(5)] + [[i, 4 - i] for i in range(5)]
    },
    "Barbell": {
        "description": "Two 3×3 blocks at the top corners connected by the middle row.",
        "cells": (
            [[r, c] for r in range(0, 3) for c in range(0, 3)] +     # TL 3x3
            [[r, c] for r in range(0, 3) for c in range(2, 5)] +     # TR 3x3
            [[2, c] for c in range(5)]                               # bridge row
        )
    },
    "Five Around Corner (TL)": {
        "description": "Five around the top-left corner.",
        "cells": [[0,0],[0,1],[0,2],[1,0],[2,0]]
    },
    "Lucky 4": {
        "description": "Number four: middle row and right column.",
        "cells": row(2) + col(4)
    },
    "Six Pack (Center 2x3)": {
        "description": "Six-pack 2 by 3, centered.",
        "cells": [[1,2],[2,2],[3,2],[1,3],[2,3],[3,3]]
    },
    "Nine Pack (Center 3x3)": {
        "description": "Nine-pack 3 by 3, center.",
        "cells": [[r,c] for r in range(1,4) for c in range(1,4)]
    },
    "Lucky 7": {
        "description": "Top row plus diagonal down-left from top-right.",
        "cells": row(0) + [[1,3],[2,2],[3,1],[4,0]]
    },
}

# ---------- programs (game “types”) ----------
# Programs describe how the game runs. Some are fixed-shape, some need pre-mark logic.
# kind:
#   - classic        -> line bingo; params.free_enabled True/False
#   - fixed_shape    -> just draw this shape (uses preview_cells)
#   - special_number -> needs first ball; premark numbers containing its digits; then coverall
#   - odd_even       -> needs first ball parity; premark odd/even; then coverall on opposite
PROGRAMS = {
    "CLASSIC": {
        "name": "Classic Bingo",
        "desc": "Standard line bingo. Free space is on.",
        "kind": "classic",
        "params": {"free_enabled": True},
        "preview_cells": []  # UI may animate sample lines; shape left empty
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
        "desc": "Top row plus a diagonal down-left from top-right.",
        "kind": "fixed_shape",
        "params": {},
        "preview_cells": PRESET_PATTERNS["Lucky 7"]["cells"],
    },
    "SPECIAL_NUMBER": {
        "name": "Special Number",
        "desc": "After first ball, pre-mark all numbers containing any of its digits; then coverall.",
        "kind": "special_number",
        "params": {"digits": []},  # set at runtime
        "preview_cells": []        # varies by first ball
    },
    "ODD_EVEN": {
        "name": "Odds/Evens",
        "desc": "If first ball is odd, pre-mark all odd numbers (or even if even). Then coverall with the opposite.",
        "kind": "odd_even",
        "params": {"first": None},  # "odd" | "even"
        "preview_cells": []
    },
    "GIANT_X": {
        "name": "Giant X",
        "desc": "Both diagonals.",
        "kind": "fixed_shape",
        "params": {},
        "preview_cells": PRESET_PATTERNS["Giant X"]["cells"],
    },
    "BARBELL": {
        "name": "Barbell",
        "desc": "Two 3×3 blocks at the top corners with a bar across the middle.",
        "kind": "fixed_shape",
        "params": {},
        "preview_cells": PRESET_PATTERNS["Barbell"]["cells"],
    },
    "FIVE_AROUND_CORNER": {
        "name": "Five Around the Corner",
        "desc": "Five around a selected corner (default top-left).",
        "kind": "fixed_shape",
        "params": {"corner": "TL"},  # TL/TR/BL/BR — preview uses TL by default
        "preview_cells": PRESET_PATTERNS["Five Around Corner (TL)"]["cells"],
    },
    "LUCKY_4": {
        "name": "Lucky 4",
        "desc": "A number 4 shape: middle row and right column.",
        "kind": "fixed_shape",
        "params": {},
        "preview_cells": PRESET_PATTERNS["Lucky 4"]["cells"],
    },
    "SIX_PACK": {
        "name": "Six Pack",
        "desc": "A 2×3 block in the center.",
        "kind": "fixed_shape",
        "params": {"orientation": "2x3_center"},
        "preview_cells": PRESET_PATTERNS["Six Pack (Center 2x3)"]["cells"],
    },
    "NINE_PACK": {
        "name": "Nine Pack",
        "desc": "A 3×3 block in the center.",
        "kind": "fixed_shape",
        "params": {"where": "center"},
        "preview_cells": PRESET_PATTERNS["Nine Pack (Center 3x3)"]["cells"],
    },
}

# ---------- file I/O ----------
def _ensure_file():
    """Create or refresh patterns.json; keep customs; refresh presets/programs from code."""
    if PATTERN_FILE.exists():
        try:
            data = json.loads(PATTERN_FILE.read_text())
            if isinstance(data, dict):
                data.setdefault("schema", PATTERN_SCHEMA_VERSION)
                data.setdefault("presets", {})
                data.setdefault("custom", {})
                data.setdefault("programs", {})
                # refresh from code
                data["presets"] = PRESET_PATTERNS
                data["programs"] = PROGRAMS
                PATTERN_FILE.write_text(json.dumps(data, indent=2))
                return
        except Exception:
            pass
    PATTERN_FILE.write_text(json.dumps({
        "schema": PATTERN_SCHEMA_VERSION,
        "presets": PRESET_PATTERNS,
        "custom": {},
        "programs": PROGRAMS,
    }, indent=2))

def _sanitize_cells(cells):
    clean=[]
    for pair in cells or []:
        try:
            r, c = int(pair[0]), int(pair[1])
            if 0 <= r <= 4 and 0 <= c <= 4:
                clean.append([r, c])
        except Exception:
            pass
    return clean

# ---------- public API (back-compat) ----------
def load_all():
    """
    Returns presets + custom (shapes). Programs are available via load_programs().
    """
    _ensure_file()
    try:
        data = json.loads(PATTERN_FILE.read_text())
    except Exception:
        data = {"schema": PATTERN_SCHEMA_VERSION, "presets": PRESET_PATTERNS, "custom": {}, "programs": PROGRAMS}
    # sanitize custom
    custom = {}
    for name, spec in (data.get("custom") or {}).items():
        custom[name] = {
            "description": (spec.get("description") or "").strip(),
            "cells": _sanitize_cells(spec.get("cells"))
        }
    return {"schema": data.get("schema", PATTERN_SCHEMA_VERSION),
            "presets": PRESET_PATTERNS,
            "custom": custom}

def load_programs():
    """Return dict of program specs keyed by program key (e.g., 'CLASSIC')."""
    _ensure_file()
    try:
        data = json.loads(PATTERN_FILE.read_text())
        progs = data.get("programs") or PROGRAMS
    except Exception:
        progs = PROGRAMS
    return progs

def save_custom(name: str, cells, description: str = ""):
    _ensure_file()
    try:
        data = json.loads(PATTERN_FILE.read_text())
    except Exception:
        data = {"schema": PATTERN_SCHEMA_VERSION, "presets": PRESET_PATTERNS, "custom": {}, "programs": PROGRAMS}
    custom = data.get("custom") or {}
    custom[name] = {"description": (description or "").strip(),
                    "cells": _sanitize_cells(cells)}
    data["custom"] = custom
    # preserve presets + programs from code
    data["presets"] = PRESET_PATTERNS
    data["programs"] = PROGRAMS
    PATTERN_FILE.write_text(json.dumps(data, indent=2))

def delete_custom(name: str) -> bool:
    _ensure_file()
    try:
        data = json.loads(PATTERN_FILE.read_text())
    except Exception:
        return False
    custom = data.get("custom") or {}
    if name in custom:
        del custom[name]
        data["custom"] = custom
        data["presets"] = PRESET_PATTERNS
        data["programs"] = PROGRAMS
        PATTERN_FILE.write_text(json.dumps(data, indent=2))
        return True
    return False

def get_spec(name: str):
    """
    Look up a SHAPE by user-facing name (presets/custom). Programs are separate.
    """
    data = load_all()
    return data["presets"].get(name) or data["custom"].get(name)

def get_program(key: str):
    """
    Look up a PROGRAM by key, e.g., 'CLASSIC', 'HARD_WAYS', 'LUCKY_7', 'SPECIAL_NUMBER', 'ODD_EVEN', etc.
    """
    progs = load_programs()
    return progs.get(str(key).upper())
