# Presentation

Source for the defence deck. The deck itself is a build artifact and is **not** committed: `.pptx` and `.pdf` are binaries that nobody can review in a diff, and they would grow the repository on every edit. What lives here is what produces them.

| File | What it is |
|---|---|
| `build.js` | Generator. Emits all 16 slides, the palette, the layout and the speaker notes. |
| `script_ES.md` | The timed narration, extracted from the generator. Spanish, because the defence is delivered in Spanish. |

## Building it

```bash
node presentation/build.js          # writes kinora-defensa.pptx
soffice --headless --convert-to pdf kinora-defensa.pptx
```

`pptxgenjs` is the only dependency.

## Conventions

The palette is the project's own: background `#09090C`, surfaces `#16161B` and `#1F1F25`, accent `#A8F060` from the Orbit brand direction under `docs/open-design/kinora/`.

Fonts are Arial and Calibri on purpose. The brand faces (Space Grotesk, DM Sans) are not guaranteed to be installed on the machine that plays the deck, and PowerPoint substituting a face it cannot find produces unpredictable line breaks. Reliability wins over fidelity here.

The narration is the source of truth for timing. Editing a slide without editing its note desynchronises the video.

> 🇪🇸 [Versión en español](./README_ES.md)
