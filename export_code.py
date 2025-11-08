#!/usr/bin/env python3
import argparse
import datetime as dt
import os
import sys

# ---------- Config ----------
IGNORE_DIRS = {
    ".git", "node_modules", "venv", ".venv", "__pycache__", ".pytest_cache",
    "dist", "build", ".idea", ".vscode", ".mypy_cache", ".ruff_cache", "lidar_txt", "cache", "whisper.cpp", "venv", ".venv",
}

# Always ignore these exact filenames (anywhere in tree)
IGNORE_FILENAMES = {
    ".env", ".json", # main ask
}

# Ignore any filename matching these prefixes
IGNORE_PREFIXES = {
    ".env", ".json",  # .env, .env.local, .env.production, etc.
}

# Hidden files are ignored by default except these
ALLOWLIST_HIDDEN_FILES = {".gitignore"}

# Common binary / large file extensions we’ll skip fast
BINARY_EXTS = {
    ".png",".jpg",".jpeg",".gif",".webp",".bmp",".ico",
    ".pdf",".zip",".gz",".tar",".tgz",".rar",".7z",
    ".mp3",".wav",".flac",".mp4",".mov",".avi",".mkv",
    ".ttf",".otf",".woff",".woff2",
    ".so",".dll",".dylib",
    ".pyc",".pyo",".json",
}

# Language hint by extension for nicer code fences
LANG_BY_EXT = {
    ".py":"python", ".js":"javascript", ".ts":"typescript", ".tsx":"tsx", ".jsx":"jsx",
    ".json":"json", ".yml":"yaml", ".yaml":"yaml", ".toml":"toml", ".ini":"ini",
    ".sh":"bash", ".bash":"bash", ".zsh":"zsh",
    ".html":"html", ".css":"css", ".scss":"scss",
    ".sql":"sql", ".md":"markdown", ".jinja":"jinja", ".jinja2":"jinja",
    ".env":"bash", ".txt":"", ".cfg":"ini",
}

DEFAULT_MAX_BYTES_PER_FILE = 1_000_000  # 1 MB cap per file (paste-friendly)


def is_hidden(name: str) -> bool:
    return name.startswith(".")

def should_ignore_file(fname: str) -> bool:
    base = os.path.basename(fname)
    # Exact filename ignore (e.g., ".env")
    if base in IGNORE_FILENAMES:
        return True
    # Prefix ignores (e.g., ".env.local")
    for p in IGNORE_PREFIXES:
        if base.startswith(p):
            return True
    # Ignore hidden files unless allowlisted
    if is_hidden(base) and base not in ALLOWLIST_HIDDEN_FILES:
        return True
    # Skip obvious binaries by extension
    _, ext = os.path.splitext(base.lower())
    if ext in BINARY_EXTS:
        return True
    return False

def is_text_file(path: str, max_bytes: int) -> bool:
    try:
        with open(path, "rb") as f:
            chunk = f.read(min(65536, max_bytes))
        # quick utf-8 check
        chunk.decode("utf-8")
        return True
    except Exception:
        return False

def read_text(path: str, max_bytes: int) -> str:
    size = os.path.getsize(path)
    if size > max_bytes:
        # Read the head only, but mark it truncated
        with open(path, "rb") as f:
            data = f.read(max_bytes)
        text = data.decode("utf-8", errors="replace")
        text += f"\n\n/* --- TRUNCATED: file size {size} bytes exceeds cap {max_bytes} --- */\n"
        return text
    with open(path, "r", encoding="utf-8", errors="strict") as f:
        return f.read()

def lang_for_file(path: str) -> str:
    _, ext = os.path.splitext(path.lower())
    return LANG_BY_EXT.get(ext, "")

def should_ignore_dir(dirname: str) -> bool:
    base = os.path.basename(dirname)
    if base in IGNORE_DIRS:
        return True
    # Ignore hidden dirs generally
    if is_hidden(base) and base not in ALLOWLIST_HIDDEN_FILES:
        return True
    return False

def export_tree(root: str, max_bytes_per_file: int) -> str:
    lines = []
    ts = dt.datetime.now().isoformat(timespec="seconds")
    lines.append(f"# Code Snapshot\n# Root: {os.path.abspath(root)}\n# Generated: {ts}\n")

    for dirpath, dirnames, filenames in os.walk(root):
        # Prune ignored dirs in-place for os.walk efficiency
        dirnames[:] = [d for d in dirnames if not should_ignore_dir(os.path.join(dirpath, d))]

        for fn in sorted(filenames):
            path = os.path.join(dirpath, fn)

            if should_ignore_file(path):
                continue

            # Only include text files
            try:
                if not is_text_file(path, max_bytes_per_file):
                    continue
            except Exception:
                continue

            rel = os.path.relpath(path, root)
            lang = lang_for_file(path)
            try:
                content = read_text(path, max_bytes_per_file)
            except Exception as e:
                # If we can’t read, skip with a note
                content = f"/* ERROR READING FILE: {e} */\n"

            # Separator + fenced block
            lines.append(f"\n=== FILE: {rel} ===")
            lines.append(f"```{lang}".rstrip())  # no trailing space if lang is ""
            lines.append(content.rstrip("\n"))
            lines.append("```")

    return "\n".join(lines) + "\n"

def main():
    ap = argparse.ArgumentParser(description="Export project code to a single paste-friendly snapshot.")
    ap.add_argument("--root", default=".", help="Project root to walk (default: .)")
    ap.add_argument("--output", default="export_code_snapshot.txt", help="Output file path (default: export_code_snapshot.txt)")
    ap.add_argument("--max-bytes-per-file", type=int, default=DEFAULT_MAX_BYTES_PER_FILE,
                    help=f"Cap per file in bytes (default: {DEFAULT_MAX_BYTES_PER_FILE})")
    args = ap.parse_args()

    root = os.path.abspath(args.root)
    if not os.path.isdir(root):
        print(f"error: root is not a directory: {root}", file=sys.stderr)
        sys.exit(1)

    snapshot = export_tree(root, args.max_bytes_per_file)

    try:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(snapshot)
        print(f"Wrote snapshot → {args.output}")
    except Exception as e:
        print(f"error writing output: {e}", file=sys.stderr)
        sys.exit(2)

if __name__ == "__main__":
    main()
