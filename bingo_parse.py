#!/usr/bin/env python3
# /opt/bettybot/bingo_parse.py
import sys, re, json, time, difflib
from typing import List, Tuple, Optional

# ------------ Config ------------
FUZZ_STRICT = 0.90
FUZZ_LENIENT = 0.82

# How long we keep a lonely letter waiting for digits (e.g., "B ... one ... two")
ASSEMBLY_WINDOW_SEC = 5.0

# After we emit a call, ignore identical repeats for this long
DEBOUNCE_CALL_SEC = 3.0

# Phrase debounce
DEBOUNCE_PHRASE_SEC = 3.0

# ------------ Phrase detection (kept; may expand later) ------------
PHRASES = {
    "GOOD_BINGO": [
        "that's a good bingo", "thats a good bingo",
        "good bingo", "confirmed bingo", "verified bingo"
    ],
    "GAME_CLOSED": [
        "this game is closed", "game is closed", "the game is closed",
        "close the game", "game closed"
    ],
}
last_phrase_hits = {k: [] for k in PHRASES.keys()}

# ------------ Setup intents (new) ------------
YES_WORDS = {
    "yes","yeah","yep","yup","correct","that is correct","thats correct",
    "right","that is right","thats right","affirmative","sure","okay","ok","okey"
}
NO_WORDS = {
    "no","nope","nah","negative","incorrect","that is not right","not right",
    "that is wrong","wrong","cancel","change","try again"
}
GAMES_KEYWORDS = {"game","games","round","rounds","card","cards"}

def normalize_text(s: str) -> str:
    s = s.lower().strip()
    return re.sub(r"[^a-z0-9\s,-]", "", s)

def best_phrase_match(text: str):
    text = normalize_text(text)
    best = (None, 0.0)
    for key, variants in PHRASES.items():
        for v in variants:
            score = difflib.SequenceMatcher(None, text, v).ratio()
            if v in text:
                score = max(score, 0.95)
            if score > best[1]:
                best = (key, score)
    return best

def emit(obj: dict):
    print(json.dumps(obj, ensure_ascii=False), flush=True)

# ------------ Bingo call parsing ------------
# Accept direct form like "B12" too; enforce 1..75 later
DIRECT_RE = re.compile(r"\b([bingoBINGO])[ ]?-?\s*(\d{1,2})\b")

# Letter token synonyms (robust to mishears)
LETTER_MAP = {
    # --- B (most fragile) ---
    "b": "B", "bee": "B", "be": "B", "b.": "B",
    "p": "B", "pea": "B", "pee": "B",          # P misheard for B
    "d": "B", "dee": "B",                       # D -> B
    "v": "B", "vee": "B",                       # V -> B

    # --- I ---
    "i": "I", "eye": "I", "aye": "I", "hi": "I",

    # --- N ---
    "n": "N", "en": "N", "and": "N", "end": "N", "in": "N", "ann": "N",

    # --- G ---
    "g": "G", "gee": "G", "gi": "G",

    # --- O ---
    "o": "O", "oh": "O", "owe": "O", "zero": "O",  # careful: 'zero' only as letter if clearly not a number
}

# Number words
NUM_WORDS_0_19 = {
    "zero": 0, "oh": 0,  # only used when we KNOW we're parsing a number
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9,
    "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
    "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19
}
TENS_WORDS = {
    "twenty": 20, "thirty": 30, "forty": 40, "fourty": 40,  # common mis-say
    "fifty": 50, "sixty": 60, "seventy": 70,
}

# Game constraints
LETTER_RANGES = {
    "B": range(1, 16),
    "I": range(16, 31),
    "N": range(31, 46),
    "G": range(46, 61),
    "O": range(61, 76),
}

# Rolling state across lines to assemble split calls like "B ... one ... two"
pending_letter: Optional[str] = None
pending_letter_time: float = 0.0
last_emitted: Optional[str] = None  # e.g., "B12"
last_emitted_time: float = 0.0

def now() -> float:
    return time.time()

def reset_pending():
    global pending_letter, pending_letter_time
    pending_letter = None
    pending_letter_time = 0.0

def in_range(letter: str, num: int) -> bool:
    return (letter in LETTER_RANGES) and (num in LETTER_RANGES[letter])

def safe_emit_call(letter: str, num: int, raw: str):
    global last_emitted, last_emitted_time
    # Never emit 0 in bingo
    if num == 0:
        return
    # Enforce valid range
    if not in_range(letter, num):
        return
    call = f"{letter}{num}"
    t = now()
    if last_emitted == call and (t - last_emitted_time) < DEBOUNCE_CALL_SEC:
        return
    last_emitted, last_emitted_time = call, t
    emit({"type": "CALL", "letter": letter, "number": num, "raw": raw})

def token_is_letter(tok: str) -> Optional[str]:
    tok = tok.lower()
    return LETTER_MAP.get(tok)

def word_to_number(tok: str) -> Optional[int]:
    """Parse a single token that may be a number word or digits."""
    tok = tok.lower().replace("-", " ")
    # digits?
    if tok.isdigit():
        return int(tok)
    # single word 0-19
    if tok in NUM_WORDS_0_19:
        return NUM_WORDS_0_19[tok]
    # tens-only word
    if tok in TENS_WORDS:
        return TENS_WORDS[tok]
    return None

def parse_number_from_tokens(tokens: List[str], start_idx: int) -> Tuple[Optional[int], int]:
    """
    Try to parse a bingo number (1..75) from tokens[start_idx:].
    Supports:
      - "12"
      - "twelve"
      - "twenty five"/"twenty-five"
      - split digits after letter: "one two" -> 12
    Returns (number, next_index_after_consumed)
    """
    i = start_idx
    if i >= len(tokens):
        return None, i

    t0 = tokens[i].lower().replace("-", " ")

    # A: plain digits
    if t0.isdigit():
        return int(t0), i + 1

    # B: single word 0-19
    if t0 in NUM_WORDS_0_19:
        return NUM_WORDS_0_19[t0], i + 1

    # C: tens + optional unit (e.g., "seventy five")
    if t0 in TENS_WORDS:
        tens = TENS_WORDS[t0]
        n = tens
        if i + 1 < len(tokens):
            u = tokens[i + 1].lower()
            if u in NUM_WORDS_0_19 and 0 < NUM_WORDS_0_19[u] < 10:
                n = tens + NUM_WORDS_0_19[u]
                return n, i + 2
        return n, i + 1

    # D: hyphenated parts already split earlier
    parts = t0.split()
    if len(parts) == 2 and parts[0] in TENS_WORDS and parts[1] in NUM_WORDS_0_19 and 0 < NUM_WORDS_0_19[parts[1]] < 10:
        n = TENS_WORDS[parts[0]] + NUM_WORDS_0_19[parts[1]]
        return n, i + 1

    # E: two consecutive unit digits like "one two" -> 12
    if NUM_WORDS_0_19.get(t0) in range(0,10):
        if i + 1 < len(tokens):
            t1 = tokens[i + 1].lower()
            if NUM_WORDS_0_19.get(t1) in range(0,10):
                n = NUM_WORDS_0_19[t0] * 10 + NUM_WORDS_0_19[t1]
                return n, i + 2

    return None, i

def try_parse_bingo_call_from_line(line: str) -> Optional[Tuple[str,int]]:
    """
    First: try direct 'B12' style (with sanity range).
    Then: look for 'B ... twelve/1 2' patterns.
    """
    raw = line
    line = normalize_text(line)

    # Direct B12 form
    m = DIRECT_RE.search(line)
    if m:
        letter = m.group(1).upper()
        num = int(m.group(2))
        if 1 <= num <= 75 and in_range(letter, num):
            return letter, num

    # Token walk: assemble letter, then number
    tokens = [t for t in re.split(r"[,\s]+", line) if t]
    i = 0
    while i < len(tokens):
        # find a letter token
        L = token_is_letter(tokens[i])
        if not L:
            i += 1
            continue
        j = i + 1
        # Skip filler like "as in", "as", "letter"
        while j < len(tokens) and tokens[j] in {"as","in","letter"}:
            j += 1
        # parse a number from j
        num, j2 = parse_number_from_tokens(tokens, j)
        if num is not None and 1 <= num <= 75 and in_range(L, num):
            return L, num

        # If we saw a letter but no immediate number, stash in pending and continue
        remember_pending_letter(L)
        i = j
    return None

def remember_pending_letter(L: str):
    global pending_letter, pending_letter_time
    pending_letter = L
    pending_letter_time = now()

def maybe_complete_with_pending(line: str) -> Optional[Tuple[str,int]]:
    """
    If we have a recent pending letter and this line has digits/number words,
    combine them into a call.
    """
    global pending_letter, pending_letter_time
    if not pending_letter:
        return None
    if (now() - pending_letter_time) > ASSEMBLY_WINDOW_SEC:
        reset_pending()
        return None

    text = normalize_text(line)
    tokens = [t for t in re.split(r"[,\s]+", text) if t]
    # Try number
    num, _ = parse_number_from_tokens(tokens, 0)
    # Special: two 1-digit words like "one two"
    if num is None and len(tokens) >= 2:
        a = NUM_WORDS_0_19.get(tokens[0], None)
        b = NUM_WORDS_0_19.get(tokens[1], None)
        if a in range(0,10) and b in range(0,10):
            num = a*10 + b
    if num is not None and 1 <= num <= 75 and in_range(pending_letter, num):
        L = pending_letter
        reset_pending()
        return L, num
    return None

def handle_phrase_line(line: str):
    event, score = best_phrase_match(line)
    if not event:
        return
    t = now()
    hits = last_phrase_hits[event]
    hits[:] = [ts for ts in hits if t - ts <= DEBOUNCE_PHRASE_SEC]
    accept = score >= FUZZ_STRICT or (score >= FUZZ_LENIENT and len(hits) >= 1)
    hits.append(t)
    if accept:
        last_phrase_hits[event].clear()
        emit({"type": "PHRASE", "event": event, "confidence": round(score,3), "raw": line})

# ------------ Setup-intent helpers (new) ------------
def maybe_emit_yes_no(line_norm: str, raw: str) -> bool:
    """Emit CONFIRM YES/NO intents (debounced by textual content)."""
    txt = line_norm.strip()
    # Use simple token containment; 'ok' and 'okay' map to YES here for seniors' convenience
    # Prefer explicit "no" if both present (rare, but e.g., "no, yes" -> treat as NO)
    tokens = set(re.split(r"[,\s]+", txt))
    # Heuristic: if sentence has "no" variants anywhere, prefer NO
    if any(w in tokens for w in NO_WORDS):
        emit({"type": "INTENT", "intent": "CONFIRM", "value": "NO", "raw": raw})
        return True
    if any(w in tokens for w in YES_WORDS):
        emit({"type": "INTENT", "intent": "CONFIRM", "value": "YES", "raw": raw})
        return True
    return False

def maybe_emit_games_count(line_norm: str, raw: str) -> bool:
    """
    If user says a number 1..20 and mentions 'game/games/round/card', emit SETUP_GAMES count.
    """
    tokens = [t for t in re.split(r"[,\s]+", line_norm) if t]
    if not tokens:
        return False
    has_keyword = any(k in tokens for k in GAMES_KEYWORDS) or ("how" in tokens and "many" in tokens)
    if not has_keyword:
        return False

    # Find first reasonable number in 1..20
    i = 0
    while i < len(tokens):
        n, j = parse_number_from_tokens(tokens, i)
        if n is not None:
            if 1 <= n <= 20:
                emit({"type": "INTENT", "intent": "SETUP_GAMES", "count": int(n), "raw": raw})
                return True
            # Skip obviously out-of-range numbers; continue scanning
            i = j
            continue
        i += 1
    return False

# ------------ Main dispatcher ------------
def process_line(s: str):
    raw = s
    # 1) Try immediate full call
    res = try_parse_bingo_call_from_line(raw)
    if res:
        L, num = res
        safe_emit_call(L, num, raw)
        return

    # 2) If not, see if it completes a pending letter
    res2 = maybe_complete_with_pending(raw)
    if res2:
        L, num = res2
        safe_emit_call(L, num, raw)
        return

    # 3) Still nothing? Maybe we only heard the letter here—stash it.
    text = normalize_text(raw)
    for tok in re.split(r"[,\s]+", text):
        L = token_is_letter(tok)
        if L:
            remember_pending_letter(L)
            break

    # 4) Phrases (good bingo / game closed)
    handle_phrase_line(raw)

    # 5) Setup intents (yes/no; number-of-games 1..20)
    if maybe_emit_yes_no(text, raw):
        return
    if maybe_emit_games_count(text, raw):
        return

# ------------ Main loop ------------
for line in sys.stdin:
    t = line.strip()
    if not t:
        continue
    process_line(t)
