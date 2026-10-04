#!/usr/bin/env python3
"""
Regenerates src/lib/billing/pdf-assets/{fonts,logo}.ts for the invoice PDF.

Needs: pip install fonttools pillow, plus the static TTFs for Inter (400/600/700) and
IBM Plex Mono (500) -- e.g. from the npm packages @expo-google-fonts/inter and
@expo-google-fonts/ibm-plex-mono -- passed via --fonts-dir (a folder containing
Inter_400Regular.ttf, Inter_600SemiBold.ttf, Inter_700Bold.ttf, IBMPlexMono_500Medium.ttf).

  python3 scripts/generate-invoice-pdf-assets.py --fonts-dir /path/to/ttfs
"""
import argparse, base64, io, pathlib
from fontTools import subset
from fontTools.ttLib import TTFont
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "src/lib/billing/pdf-assets"
UNICODES = list(range(0x20, 0x7F)) + list(range(0xA0, 0x100)) + [0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2026, 0x20AC]
FONTS = {"INTER_REGULAR": "Inter_400Regular", "INTER_SEMIBOLD": "Inter_600SemiBold",
         "INTER_BOLD": "Inter_700Bold", "PLEX_MONO_MEDIUM": "IBMPlexMono_500Medium"}
HEADER = ("// GENERATED FILE -- do not edit by hand. Regenerate with scripts/generate-invoice-pdf-assets.py\n"
          "// Fonts: Inter and IBM Plex Mono (SIL Open Font License 1.1), subset to Latin + common punctuation.\n")

def subset_b64(path):
    opts = subset.Options(); opts.layout_features = ["kern", "liga"]; opts.notdef_outline = True
    font = TTFont(path); s = subset.Subsetter(opts); s.populate(unicodes=UNICODES); s.subset(font)
    buf = io.BytesIO(); font.save(buf); return base64.b64encode(buf.getvalue()).decode()

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--fonts-dir", required=True); a = ap.parse_args()
    d = pathlib.Path(a.fonts_dir)
    (OUT / "fonts.ts").write_text(HEADER + "\n".join(
        f'export const {k}_TTF_BASE64 =\n  "{subset_b64(d / (v + ".ttf"))}";\n' for k, v in FONTS.items()))
    im = Image.open(ROOT / "public/educore-logo-lockup.png").convert("RGBA")
    w = 900; h = round(im.height * w / im.width); im = im.resize((w, h), Image.LANCZOS)
    buf = io.BytesIO(); im.save(buf, "PNG", optimize=True)
    (OUT / "logo.ts").write_text(HEADER + "// Official logo: public/educore-logo-lockup.png resized to 900px wide.\n"
        f'export const LOGO_PNG_BASE64 =\n  "{base64.b64encode(buf.getvalue()).decode()}";\n\nexport const LOGO_ASPECT = {w / h:.5f};\n')
    print("wrote fonts.ts and logo.ts")

if __name__ == "__main__":
    main()
