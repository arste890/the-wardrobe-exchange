#!/usr/bin/env python3
"""The Wardrobe Exchange photo cleanup — turns phone shots of a garment on a plain wall into
listing-ready "Actual item" photos.

Non-generative: the garment's pixels are never redrawn. AI (BiRefNet via rembg)
is used only to find the garment's outline; pymatting recovers clean edge colours.
Edits applied are classic: exposure, gentle contrast, warm-gray backdrop, 4:5 crop.

Usage:
    uv run cleanup.py IN_DIR OUT_DIR [--no-matte] [--target 182]

    IN_DIR   folder of HEIC/JPG/PNG/DNG phone shots (hanging on a plain wall)
    OUT_DIR  receives actual_01.jpg, actual_02.jpg … (1136×1408, 4:5)
             Files in IN_DIR whose names start with "studio" are copied through
             as studio_NN.jpg so they get tagged correctly when uploaded.

    --no-matte   skip background replacement (for label / interior close-ups):
                 tone correction + 4:5 crop only.
"""
import argparse
import os
import sys

import cv2
import numpy as np
from PIL import Image, ImageOps

W_OUT, H_OUT = 1136, 1408
BG = np.array([233, 236, 239], np.float32)  # BGR of #EFECE9 (matches studio renderings)
TARGET_V = 182

_session = None


def session():
    global _session
    if _session is None:
        from rembg import new_session

        _session = new_session("birefnet-general")
    return _session


def load(path: str) -> np.ndarray:
    """Read any phone format (HEIC via pillow-heif, DNG via embedded preview) upright, 8-bit BGR."""
    ext = os.path.splitext(path)[1].lower()
    if ext in (".heic", ".heif"):
        from pillow_heif import register_heif_opener

        register_heif_opener()
    if ext == ".dng":
        import rawpy

        with rawpy.imread(path) as raw:
            rgb = raw.postprocess(use_camera_wb=True, output_bps=8, no_auto_bright=True)
        return rgb[..., ::-1].copy()
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    return np.array(im)[..., ::-1].copy()


def ai_alpha(img: np.ndarray) -> np.ndarray:
    from rembg import remove
    from scipy import ndimage as ndi

    pil = Image.fromarray(img[..., ::-1])
    a = np.array(remove(pil, session=session(), only_mask=True)).astype(np.float32) / 255
    lab, k = ndi.label(a > 0.5)
    if k > 1:
        big = 1 + int(np.argmax(ndi.sum(a > 0.5, lab, range(1, k + 1))))
        a *= ndi.binary_dilation(lab == big, iterations=8)
    a[a < 0.02] = 0
    a[a > 0.98] = 1
    return strip_hook(a)


def strip_hook(a: np.ndarray) -> np.ndarray:
    """Remove the thin hanger wire above the collar."""
    from scipy import ndimage as ndi

    m = a > 0.5
    H, W = m.shape
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (41, 41))
    body = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_OPEN, k).astype(bool)
    rows = np.where(body.sum(1) > W * 0.15)[0]
    if not len(rows):
        return a
    top = rows[0] + 60
    keep = ndi.binary_dilation(body, iterations=6)
    a = a.copy()
    a[:top] *= keep[:top]
    lab, n = ndi.label(a > 0.5)
    if n > 1:
        big = 1 + int(np.argmax(ndi.sum(a > 0.5, lab, range(1, n + 1))))
        a *= ndi.binary_dilation(lab == big, iterations=8)
    return a


def tone(img: np.ndarray, m: np.ndarray, target_v: float, contrast: float = 3.0) -> np.ndarray:
    """Exposure to target + soft S-curve as one brightness ratio (hue preserved)."""
    f = img.astype(np.float32)
    f *= target_v / max(f[m].max(1).mean(), 1)
    Y = f.mean(2)
    mid = np.median(Y[m])
    t = np.clip(Y / 255, 1e-4, 1)
    p = np.log(0.5) / np.log(np.clip(mid / 255, 0.05, 0.95))
    s = 1 / (1 + np.exp(-contrast * (t**p - 0.5)))
    s0, s1 = 1 / (1 + np.exp(contrast * 0.5)), 1 / (1 + np.exp(-contrast * 0.5))
    tc = ((s - s0) / (s1 - s0)) ** (1 / p)
    f *= ((tc / t) * 0.5 + 0.5)[..., None]
    f = np.where(f > 235, 235 + 20 * np.tanh((f - 235) / 20), f)
    f *= target_v / max(f[m].max(1).mean(), 1)
    return np.clip(f, 0, 255)


def clean_fg(f: np.ndarray, a: np.ndarray) -> np.ndarray:
    from pymatting import estimate_foreground_ml

    F = estimate_foreground_ml(f[..., ::-1] / 255.0, a.astype(np.float64))[..., ::-1]
    return np.clip(F * 255, 0, 255).astype(np.float32)


def downscale(f, a, long_edge=2400):
    s = long_edge / max(a.shape)
    if s >= 1:
        return f, a
    return (
        cv2.resize(f, None, fx=s, fy=s, interpolation=cv2.INTER_AREA),
        cv2.resize(a, None, fx=s, fy=s, interpolation=cv2.INTER_AREA),
    )


def place45(F, a, box, fill_h=0.80, fill_w=0.82, shadow=0.10):
    y0, y1, x0, x1 = box
    s = min(H_OUT * fill_h / max(y1 - y0, 1), W_OUT * fill_w / max(x1 - x0, 1))
    Fs = cv2.resize(F, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    As = cv2.resize(a, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    y0, y1, x0, x1 = [int(v * s) for v in box]
    oy = (H_OUT - (y1 - y0)) // 2 - y0
    ox = (W_OUT - (x1 - x0)) // 2 - x0
    P = np.zeros((H_OUT, W_OUT, 3), np.float32)
    A = np.zeros((H_OUT, W_OUT), np.float32)
    h, w = As.shape
    ty0, tx0 = max(oy, 0), max(ox, 0)
    ty1, tx1 = min(oy + h, H_OUT), min(ox + w, W_OUT)
    P[ty0:ty1, tx0:tx1] = Fs[ty0 - oy : ty1 - oy, tx0 - ox : tx1 - ox]
    A[ty0:ty1, tx0:tx1] = As[ty0 - oy : ty1 - oy, tx0 - ox : tx1 - ox]
    sh = cv2.GaussianBlur(A, (0, 0), 22, borderType=cv2.BORDER_CONSTANT)
    sh = np.roll(np.roll(sh, 14, 0), 6, 1)[..., None] * shadow
    A3 = A[..., None]
    return P * A3 + BG * (1 - sh) * (1 - A3)


def crop45_center(f: np.ndarray) -> np.ndarray:
    H, W = f.shape[:2]
    ch = int(W * H_OUT / W_OUT)
    if ch <= H:
        y0 = (H - ch) // 2
        crop = f[y0 : y0 + ch]
    else:
        cw = int(H * W_OUT / H_OUT)
        x0 = (W - cw) // 2
        crop = f[:, x0 : x0 + cw]
    return cv2.resize(crop, (W_OUT, H_OUT), interpolation=cv2.INTER_AREA)


def save(path: str, f: np.ndarray) -> None:
    Image.fromarray(np.clip(f, 0, 255).astype(np.uint8)[..., ::-1]).save(path, quality=95, subsampling=0)
    print("saved", os.path.basename(path))


def process_full(img: np.ndarray, target_v: float) -> np.ndarray:
    a = ai_alpha(img)
    f = tone(img, a > 0.5, target_v)
    f, a = downscale(f, a)
    F = clean_fg(f, a)
    ys, xs = np.where(a > 0.5)
    return place45(F, a, (ys.min(), ys.max(), xs.min(), xs.max()))


def process_closeup(img: np.ndarray, target_v: float) -> np.ndarray:
    m = np.ones(img.shape[:2], bool)
    return crop45_center(tone(img, m, target_v - 6))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("in_dir")
    ap.add_argument("out_dir")
    ap.add_argument("--no-matte", action="store_true", help="tone + crop only (close-ups)")
    ap.add_argument("--target", type=float, default=TARGET_V, help="garment brightness target (0-255)")
    args = ap.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    exts = (".jpg", ".jpeg", ".png", ".heic", ".heif", ".dng", ".webp")
    files = sorted(f for f in os.listdir(args.in_dir) if f.lower().endswith(exts) and not f.startswith("."))
    if not files:
        print("no images found in", args.in_dir, file=sys.stderr)
        return 1

    n_actual = n_studio = 0
    for fn in files:
        src = os.path.join(args.in_dir, fn)
        if fn.lower().startswith("studio"):
            n_studio += 1
            im = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
            im.save(os.path.join(args.out_dir, f"studio_{n_studio:02d}.jpg"), quality=95, subsampling=0)
            print("copied", fn, "→", f"studio_{n_studio:02d}.jpg")
            continue
        n_actual += 1
        img = load(src)
        out = process_closeup(img, args.target) if args.no_matte else process_full(img, args.target)
        save(os.path.join(args.out_dir, f"actual_{n_actual:02d}.jpg"), out)
    print(f"done: {n_actual} actual, {n_studio} studio → {args.out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
