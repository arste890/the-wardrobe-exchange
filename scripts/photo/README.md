# Photo cleanup

Turns phone shots of a garment hanging on a plain wall into listing-ready **Actual item** photos (1136×1408, warm-gray studio backdrop, consistent brightness). The garment's pixels are never regenerated; AI only finds the outline.

## One-time setup

```bash
cd scripts/photo
uv sync          # installs into scripts/photo/.venv (first run downloads the ~1 GB BiRefNet model)
```

## Shoot

- Hang the piece on a slim hanger against a plain wall, window light to one side, a white board on the other side to fill.
- Phone at chest height, 2× lens, step back. Shoot: front, back, open/lining, label, any flaws.
- Steam first. Turn padded-hanger bows to the back.

## Run

```bash
uv run cleanup.py ~/Pictures/sku-123/shots ~/Pictures/sku-123/ready
uv run cleanup.py ~/Pictures/sku-123/labels ~/Pictures/sku-123/ready --no-matte   # label / interior close-ups
```

Drop any AI studio renderings into the shots folder named `studio_*.jpg`; they are copied through untouched and tagged "Studio rendering" on upload.

Then open the site's `/admin`, create the item, and drag the whole `ready` folder onto the photo box. Filenames decide the tag: `studio_*` → Studio rendering, `flaw_*` → flaw close-up, everything else → Actual item.
