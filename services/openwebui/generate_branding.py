#!/usr/bin/env python3
"""Generate OpenWebUI static branding (favicon/logo) for the Docker image.

Used at image build time so compose/CI builds do not need k8s/ assets. If
``--prebuilt`` already contains favicon.png (homelab ``make build-openwebui``),
those files win.
"""

from __future__ import annotations

import argparse
import base64
import io
import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

NAVY = (10, 22, 40, 255)
CYAN = (0, 212, 170, 255)
INK = (6, 14, 28, 255)

PNG_SIZES = {
    "favicon.png": 256,
    "favicon-dark.png": 256,
    "favicon-96x96.png": 96,
    "apple-touch-icon.png": 180,
    "web-app-manifest-192x192.png": 192,
    "web-app-manifest-512x512.png": 512,
    "logo.png": 96,
    "splash.png": 256,
    "splash-dark.png": 256,
}

ICO_SIZES = (16, 32, 48)

MANIFEST = """{
  "name": "Spockify",
  "short_name": "Spockify",
  "icons": [
    {
      "src": "/static/web-app-manifest-192x192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "maskable"
    },
    {
      "src": "/static/web-app-manifest-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ],
  "theme_color": "#0a1628",
  "background_color": "#0a1628",
  "display": "standalone"
}
"""


def _font(size: int) -> ImageFont.ImageFont:
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ):
        if Path(path).is_file():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def draw_mark(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), NAVY)
    draw = ImageDraw.Draw(img)
    margin = max(1, size // 10)
    draw.ellipse(
        [margin, margin, size - margin - 1, size - margin - 1],
        fill=CYAN,
    )
    font = _font(max(10, int(size * 0.52)))
    glyph = "S"
    bbox = draw.textbbox((0, 0), glyph, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (size - tw) / 2 - bbox[0]
    y = (size - th) / 2 - bbox[1] - size * 0.02
    draw.text((x, y), glyph, font=font, fill=INK)
    return img


def write_svg(dest: Path, png32: Image.Image) -> None:
    buf = io.BytesIO()
    png32.save(buf, format="PNG", optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    dest.write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
        f'<image href="data:image/png;base64,{b64}" width="32" height="32"/></svg>\n',
        encoding="utf-8",
    )


def generate(out: Path, source: Path | None) -> None:
    out.mkdir(parents=True, exist_ok=True)
    if source and source.is_file():
        with Image.open(source) as raw:
            src = raw.convert("RGBA")

        def mark(size: int) -> Image.Image:
            return src.resize((size, size), Image.Resampling.LANCZOS)
    else:

        def mark(size: int) -> Image.Image:
            return draw_mark(size)

    for name, size in PNG_SIZES.items():
        mark(size).save(out / name, format="PNG", optimize=True)

    ico = [mark(s) for s in ICO_SIZES]
    ico[0].save(
        out / "favicon.ico",
        format="ICO",
        sizes=[(s, s) for s in ICO_SIZES],
        append_images=ico[1:],
    )
    write_svg(out / "favicon.svg", mark(32))
    (out / "site.webmanifest").write_text(MANIFEST, encoding="utf-8")


def copy_prebuilt(prebuilt: Path, out: Path) -> bool:
    favicon = prebuilt / "favicon.png"
    if not favicon.is_file():
        return False
    out.mkdir(parents=True, exist_ok=True)
    for src in prebuilt.iterdir():
        if src.name.startswith("."):
            continue
        dest = out / src.name
        if src.is_file():
            shutil.copy2(src, dest)
    return (out / "favicon.png").is_file()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--prebuilt", type=Path, default=None)
    parser.add_argument("--src", type=Path, default=None)
    args = parser.parse_args()

    if args.prebuilt and copy_prebuilt(args.prebuilt, args.out):
        print(f"using prebuilt branding from {args.prebuilt}")
        return 0

    src = args.src
    if src is None:
        for candidate in (
            Path("icon.png"),
            Path("/work/icon.png"),
        ):
            if candidate.is_file():
                src = candidate
                break
    generate(args.out, src if src and src.is_file() else None)
    print(f"generated branding in {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
