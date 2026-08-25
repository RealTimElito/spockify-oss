import re

# ANSI escape code pattern - matches all common ANSI sequences
# This includes color codes, cursor movement, and other terminal control sequences
ANSI_ESCAPE_PATTERN = re.compile(r'\x1b\[[0-9;]*[A-Za-z]|\x1b\([AB]|\x1b[PX^_].*?\x1b\\|\x1b\].*?(?:\x07|\x1b\\)')


def strip_ansi_codes(text: str) -> str:
    """
    Strip ANSI escape codes from text.

    ANSI escape codes can be introduced by LLMs that include terminal
    color codes in their output. These codes cause syntax errors when
    the code is sent to Jupyter for execution.

    Common ANSI codes include:
    - Color codes: \x1b[31m (red), \x1b[32m (green), etc.
    - Reset codes: \x1b[0m, \x1b[39m
    - Cursor movement: \x1b[1A, \x1b[2J, etc.
    """
    return ANSI_ESCAPE_PATTERN.sub('', text)


def strip_markdown_code_fences(code: str) -> str:
    """
    Strip markdown code fences if present.

    This is a defensive, non-breaking change — if the code doesn't
    contain fences, it passes through unchanged.

    Handles patterns like:
    - ```python
    - ```py
    - ```
    """
    code = code.strip()
    # Remove opening fence (```python, ```py, ``` etc.)
    code = re.sub(r'^```\w*\n?', '', code)
    # Remove closing fence
    code = re.sub(r'\n?```\s*$', '', code)
    return code.strip()


def sanitize_code(code: str) -> str:
    """
    Sanitize code for execution by applying all necessary cleanup steps.

    This is the recommended function to use before sending code to
    interpreters like Jupyter or Pyodide.

    Steps applied:
    1. Strip ANSI escape codes (from LLM output)
    2. Strip markdown code fences (if model included them)
    """
    code = strip_ansi_codes(code)
    code = strip_markdown_code_fences(code)
    return code


def sanitize_text_for_tts(text: str) -> str:
    """
    Strip markdown so TTS speaks readable prose, not punctuation names.

    Heuristic (not full CommonMark). Keeps link labels, drops image markup,
    softens code fences, and removes leftover *, _, #, backticks, etc.
    Mirrors frontend removeFormattings used by Read aloud / Call.
    """
    if not text:
        return text

    def _fence_repl(match: re.Match) -> str:
        code = (match.group(1) or '').strip()
        if not code:
            return ' '
        if len(code) > 160 or code.count('\n') > 3:
            return ' code block. '
        return f' {code} '

    text = re.sub(r'```[\w+-]*\r?\n?([\s\S]*?)```', _fence_repl, text)
    text = re.sub(r'```[\w+-]*\r?\n?', ' ', text)
    text = re.sub(r'^\|.*\|$', '', text, flags=re.M)
    text = re.sub(r'^\s*\|?[:\s|-]+\|?\s*$', '', text, flags=re.M)

    text = re.sub(r'!\[([^\]]*)\](?:\([^)]*\)|\[[^\]]*\])', ' ', text)
    text = re.sub(r'\[([^\]]+)\](?:\([^)]*\)|\[[^\]]*\])', r'\1', text)
    text = re.sub(r'^\[[^\]]+\]:\s*.*$', '', text, flags=re.M)

    text = re.sub(r'\*\*\*(.+?)\*\*\*', r'\1', text)
    text = re.sub(r'___(.+?)___', r'\1', text)
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
    text = re.sub(r'__(.+?)__', r'\1', text)
    text = re.sub(r'(?<!\w)\*(?!\s)(.+?)(?<!\s)\*(?!\w)', r'\1', text)
    text = re.sub(r'(?<!\w)_(?!\s)(.+?)(?<!\s)_(?!\w)', r'\1', text)
    text = re.sub(r'~~(.+?)~~', r'\1', text)
    text = re.sub(r'`([^`]+)`', r'\1', text)

    text = re.sub(r'^#{1,6}\s+', '', text, flags=re.M)
    text = re.sub(r'^\s*[-*+]\s+', '', text, flags=re.M)
    text = re.sub(r'^\s*\d+\.\s+', '', text, flags=re.M)
    text = re.sub(r'^\s*>[>\s]*', '', text, flags=re.M)
    text = re.sub(r'^\s*:\s+', '', text, flags=re.M)
    text = re.sub(r'^\s*(?:-{3,}|\*{3,}|_{3,})\s*$', '', text, flags=re.M)
    text = re.sub(r'\[\^[^\]]*\]', '', text)

    text = re.sub(r'(\d)\s*\*\s*(\d)', r'\1 times \2', text)
    text = re.sub(r'(^|[^A-Za-z0-9])#(?=[A-Za-z])', r'\1', text, flags=re.M)
    text = re.sub(r'(?<=\w)_(?=\w)', ' ', text)

    text = re.sub(r'`+', '', text)
    text = re.sub(r'[*_]{1,3}', '', text)
    text = re.sub(r'^#{1,6}\s*', '', text, flags=re.M)

    text = re.sub(r'[^\S\n]{2,}', ' ', text)
    text = re.sub(r'\n{2,}', '\n', text)
    return text.strip()
