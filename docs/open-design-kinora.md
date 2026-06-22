# Open Design source of truth — kInorA

Future UI iterations in this repository must use the Open Design project `kiNorA` as the visual and interaction reference before implementing web or mobile-facing screens.

The current design has been pulled into the repo at `docs/open-design/kinora/`. Use that local snapshot first so routine implementation tasks do not need live MCP access. Refresh from Open Design only when the source design changes or before a major visual redesign.

## Mandatory workflow

1. Read the local snapshot in `docs/open-design/kinora/` before changing UI.
2. Compare the target screen against the relevant local artifact listed below.
3. Implement with existing project/design-system primitives first.
4. Preserve the brand tokens and interaction structure unless an accepted SDD change explicitly revises the design.
5. Pull from Open Design MCP only when the local snapshot is missing, stale, or explicitly being refreshed.

## Local snapshot

| Path | Purpose |
|---|---|
| `docs/open-design/kinora/snapshot-manifest.json` | Snapshot metadata: pull time, source, included files |
| `docs/open-design/kinora/project.json` | Open Design project metadata |
| `docs/open-design/kinora/files.json` | Open Design file inventory at pull time |
| `docs/open-design/kinora/DESIGN.md` | Local copy of the design-system guide |
| `docs/open-design/kinora/assets/kinora.css` | Local copy of shared tokens and primitive CSS |
| `docs/open-design/kinora/index.html` | Local overview artifact linking screens |
| `docs/open-design/kinora/screens/*.html` | Local screen snapshots for implementation reference |

## Open Design MCP reference

| Field | Value |
|---|---|
| MCP server | `open-design` |
| Project name | `kiNorA` |
| Project id | `ceeff5f6-0930-4e48-a0b0-17a6a5c9b9ad` |
| Source project status | `failed` in Open Design, but files are available and usable |
| Design guide file | `DESIGN.md` |
| Shared CSS tokens | `assets/kinora.css` |
| Index artifact | `index.html` |

Use the project name or id when querying MCP tools. Prefer `get_artifact` for a complete screen bundle and `get_file` only when reading a specific file. For normal implementation, prefer the local snapshot paths above.

## Source artifacts

| Area | Open Design file | Implementation intent |
|---|---|---|
| Design system | `DESIGN.md` | Brand, color, typography, layout, app architecture, anti-patterns |
| Shared CSS | `assets/kinora.css` | Canonical CSS tokens and primitive styling behavior |
| Artifact index | `index.html` | Overview of all reconstructed screens |
| Web landing | `screens/web-landing.html` | Marketing hero, features, how-it-works, pricing, CTA, footer |
| Web dashboard | `screens/web-dashboard.html` | Daily summary, streak, progress, today workout, quick actions |
| Web weekly plan | `screens/web-plan.html` | Training agenda by day with expandable detail |
| Web statistics | `screens/web-stats.html` | Volume analytics, muscle groups, records, chart behavior |
| Web create plan | `screens/web-create-plan.html` | Card-based plan creation plus conversational assistant and extracted-data panel |
| Mobile dashboard | `screens/mobile-dashboard.html` | Main mobile daily view |
| Mobile create plan | `screens/mobile-create-plan.html` | Mobile plan-building flow |
| Mobile voice assistant | `screens/mobile-voice.html` | Voice interaction with the AI trainer |
| Mobile exercise detail | `screens/mobile-exercise.html` | Exercise instructions, sets, rest, status |
| Mobile session tracker | `screens/mobile-tracker.html` | Live workout tracking controls and progress |
| Brand proposals | `kinora-brand-proposals.html`, `brand-proposals.html` | Historical brand exploration only; do not override `DESIGN.md` without approval |

## Brand contract

| Token | Value | Usage |
|---|---|---|
| `--bg` | `#09090C` / `oklch(5% 0.006 270)` | App background; dark-only canvas |
| `--surface` | `#101014` / `oklch(11% 0.006 270)` | Cards and panels |
| `--surface-2` | `#17171C` / `oklch(15% 0.006 270)` | Elevated cards and hover states |
| `--border` | `#26262C` / `oklch(24% 0.006 270)` | Hairline borders and dividers |
| `--fg` | `#F4F4F5` / `oklch(96% 0.002 270)` | Primary text |
| `--muted` | `#9A9AA2` / `oklch(66% 0.006 270)` | Secondary text, captions, metadata |
| `--accent` | `#A8F060` / `oklch(89% 0.20 128)` | Primary brand accent: CTA, active state, one key metric |
| `--accent-fg` | `#09090C` | Text/icon color on lime accent |

Rules:

- kInorA is **dark-only**. Do not introduce a light theme unless a future accepted spec changes this.
- Use the lime accent sparingly: normally one primary CTA plus one active metric/state per screen.
- Text on lime must use near-black, never white.
- Avoid generic AI gradients, purple glows, emoji iconography, and decorative accent flooding.
- Use surface hierarchy (`bg → surface → surface-2`) before adding shadows; reserve shadows for overlays.

## Typography

| Role | Family | Usage |
|---|---|---|
| Display / headings / metrics | `Space Grotesk` | H1-H3, hero titles, large numbers, fitness metrics |
| Body / UI | `DM Sans` | Paragraphs, labels, buttons, table text |

Implementation notes:

- Headings use `letter-spacing: -0.02em`.
- Fitness numbers use tabular numerals.
- Use readable body sizing; mobile hit targets must remain at least 44px.

## Layout and component rules

- Radius: cards 16-20px, buttons/pills 12px, chips fully rounded.
- Spacing rhythm: 8, 12, 16, 24, 32, 48.
- Borders: 1px hairline with the border token; avoid table row striping.
- Desktop app shell: sidebar navigation wrapping dashboard, plan, stats, and plan creation surfaces.
- Mobile app shell: bottom navigation and phone-first flows for dashboard, plan creation, voice assistant, exercise detail, and live tracker.
- Product modules to preserve: conversational plan assistant, extracted-data panel, workout cards, streak/check-in module, statistics charts, and live workout tracker.

## Implementation guardrails

- Do not copy Open Design HTML directly into app code. Translate it into project components and existing design-system primitives.
- Keep UI copy in source files in English unless the product requirement explicitly requests Spanish or the existing screen context already uses Spanish.
- If a new UI requirement conflicts with this file, record the decision in SDD and update this reference after approval.
- Verify the computed app background resolves to `#09090c`; Open Design notes a prior gotcha where cached shadcn/Tailwind variables produced a white `:root` until the dev server restarted.

## Quick MCP examples

```text
get_project(project: "kiNorA")
list_files(project: "kiNorA")
get_file(project: "kiNorA", path: "DESIGN.md")
get_artifact(project: "kiNorA", entry: "screens/web-dashboard.html", include: "auto")
```

If the packaged Open Design app is running but the OpenCode HTTP bridge reports `127.0.0.1:7456` as unavailable, use the configured stdio MCP command from the OpenCode MCP config. The working command is based on:

```text
/Applications/Open Design.app/Contents/Resources/open-design/bin/node \
  /Applications/Open Design.app/Contents/Resources/app/prebundled/daemon/daemon-cli.mjs \
  mcp
```

with `OD_DATA_DIR` and `OD_SIDECAR_IPC_PATH` from the `open-design` MCP server config.
