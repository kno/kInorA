# Presentation

Source for the defence decks. The decks themselves are build artifacts and are **not** committed: `.pptx` and `.pdf` are binaries that nobody can review in a diff, and they would grow the repository on every edit. What lives here is what produces them.

There are two, split so each gets the time it needs instead of both competing for the same eight minutes:

| Deck | Folder | What it covers |
|---|---|---|
| Product | `product/` | The problem, the competitive gap, the four capabilities, and a walkthrough of the actual screens — onboarding, the adapted plan, the daily panel, the weekly plan, in-gym tracking, the voice assistant. |
| Technical | `technical/` | Why the build method matters, the architecture, the AI layer, the SDD cycle, agents/guards/adversarial review, the results, the initial roadmap, and an honest account of what deviated from plan and what would be done differently. |

| File | What it is |
|---|---|
| `product/build.js` | Generator for the product deck. Emits 13 slides, including real screenshots. |
| `product/screens/*.png` | Screenshots of the actual designed screens under `docs/open-design/kinora/screens/`, captured headlessly at a fixed viewport so the deck doesn't depend on a running app or a browser at build time. They are **design references**, not live-app captures — the slides label them as such. |
| `product/script_ES.md` | Timed narration for the product deck, extracted from the generator's speaker notes. |
| `technical/build.js` | Generator for the technical deck. Emits 12 slides. |
| `technical/script_ES.md` | Timed narration for the technical deck. |
| `package.json` | Declares `pptxgenjs`, the only dependency either generator needs. |

## Building it

```bash
pnpm install                                                          # once, to fetch pptxgenjs
node presentation/product/build.js                                   # writes presentation/product/kinora-producto.pptx
node presentation/technical/build.js                                 # writes presentation/technical/kinora-tecnica.pptx
soffice --headless --convert-to pdf --outdir presentation/product presentation/product/kinora-producto.pptx
soffice --headless --convert-to pdf --outdir presentation/technical presentation/technical/kinora-tecnica.pptx
```

All commands run from the repository root. Each generator always writes next to its own `build.js`, regardless of the current directory.

## Refreshing the product screenshots

The screenshots in `product/screens/` are a point-in-time capture of the Open Design mockups. To regenerate them after a design change, render each `docs/open-design/kinora/screens/*.html` file with a headless Chromium at the viewport documented in the capture script's history (1440×960 for web, 390×844 full-page for mobile) and overwrite the matching PNG. There is deliberately no build-time dependency on a browser or a running app: a static, committed image is more reliable than a render step that can fail on a machine that lacks Chromium.

## Conventions

The palette is the project's own: background `#09090C`, surfaces `#16161B` and `#1F1F25`, accent `#A8F060` from the Orbit brand direction under `docs/open-design/kinora/`.

Fonts are Arial and Calibri on purpose. The brand faces (Space Grotesk, DM Sans) are not guaranteed to be installed on the machine that plays the deck, and PowerPoint substituting a face it cannot find produces unpredictable line breaks. Reliability wins over fidelity here.

Each narration file is the source of truth for its deck's timing. Editing a slide without editing its note desynchronises the recording.

> 🇪🇸 [Versión en español](./README_ES.md)
