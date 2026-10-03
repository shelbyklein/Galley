# Phase 3: Color and images

## Summary
Finish the planned color and image workflow while preserving Galley’s CSS/Chromium document renderer. Add image-content adjustment, link inspection and repair, effective resolution, and reusable user-owned swatch libraries. Existing process/spot/tint editing and soft proofing are reused.

## Problem and evidence
At main `2daef9a`, `renderer/tools/place.ts` provides fit/fill/center, but no arbitrary crop offsets. `main/place-image/link.ts` copies PNG/JPEG into packages and the model supports relinking; there is no Links panel. `renderer/panels/SwatchesPanel.tsx` already supports process/spot/tints, but no library interchange. SwatchDialog still uses an approximate color preview even though canvas/panel chips are proofed.

## Visual aids
Current app: [Phase 2 screenshot](assets/phases-1-2/screens/milestone2/03-type-mode-wrap.png).
Target: [Image content, Links and library actions](assets/phase-3/image-controls.svg). Follow the existing collapsible dock/fields; exact spacing may adapt to existing controls.

## Scope and settled decisions
Shelby’s “let’s continue working through phases” authorizes proceeding through the existing roadmap. This bounded next delivery is Phase 3. CSS controls layout and screen/export rendering. Preserve existing model format, save/undo, fonts, threading, SVG geometry and prepress. Links describe package-contained copies: checking/updating a packaged file does not imply watching its original external source. Relinking imports a replacement into the package without overwriting previous bytes so undo can restore the old asset. Swatch libraries are versioned JSON of user-owned CMYK/spot/tint definitions; import is atomic and collision-safe. No proprietary color books are bundled. Spot names identify physical ink plates: identical spot definitions are reused; conflicting same-name spot definitions reject the whole import instead of silently creating a renamed plate.

Phase 2’s human flyer acceptance and consecutive-hyphen-limit decision remain open in issue #1; they do not block these independent features, and are not silently waived.

## Success criteria
1. In the real Electron app, adjusting image offsets/size leaves frame geometry unchanged, matches saved/reopened and exported crop, and undoes as a single action.
2. Links list references and missing/changed status, relink safely, show actual/effective X/Y PPI derived from pixel size and placed content dimensions, and recover export after a missing link is repaired.
3. Library round trips preserve process/spot/tint values and relationships; malformed imports leave the document unchanged, collisions never overwrite existing colors, and import undoes atomically. The swatch editing preview uses the existing output-profile proof path.
4. Build, units, app E2E, golden print and geometry pass on integrated main; new UI screenshots are captured and inspected.

## Tasks
| ID | Task | Acceptance |
|---|---|---|
| P3-01 | Image content controls | Real UI edits X/Y/W/H with optional proportional size, validates values, preserves frame geometry and rotation, supports fit/fill/center, undo/redo, save/reopen; independent PDF crop verification. |
| P3-02 | Links panel and effective PPI | Real UI lists placed images/usages, selects frame, checks packaged file status, repairs missing/changed file through relink; cancellation and failures are safe. Effective PPI tests include nonuniform scaling and rotated frame; save/reopen/export use replacement and undo restores prior bytes. |
| P3-03 | Swatch libraries and proofed dialog preview | Native load/save actions, versioned schema, process/spot/tint dependency remapping, collision-safe atomic import/undo; malformed files reject without mutation. Real UI roundtrip and proofed preview check; existing spot/tint golden checks pass. |
| P3-04 | Integration and Phase 3 review | All acceptance suites pass on main, current app screenshots inspected, focused commits pushed; evidence posted to issue, issue stays open for Shelby review. |

## Deliverables
Code, tests, plan and inspected screenshots committed and pushed to main. Locally runnable app and preserved tryout launcher; no signed/installed release. Generated PDFs and private/system profiles remain local. Phase 3 issue and Tracker checklist updated on each accepted task; closure awaits Shelby.

## Execution and handoff
Mode: `linear`, with one GPT-6.1 Sol implementation executor working the tasks in order and coordinator review; no parallel implementation lanes or overlapping editors. Coordinator: current verified GPT-6 Astra (`gpt-6-astra`), medium. Implementation: GPT-6.1 Sol (`gpt-6.1-sol`), high. No Claude agents. The implementation lane works P3-01 → P3-02 → P3-03 on an isolated branch; owns product code and focused tests. Coordinator owns this plan, GitHub, final integration, screenshots and P3-04. Existing finished T/S/N agents/worktrees are preserved, not restarted. Coordinator alone pushes and updates GitHub. Every agent uses its own Tracker run/session and stable task IDs. No implementation dispatch until readiness passes. This section is the self-contained handoff together with task acceptance above.

## Exclusions
No Rust/custom composition engine, HTML publishing, new image formats, gradient UI, proprietary spot libraries, profile bundling, original-source file watching, format migrations, icon installation, packaged app, Phase 4 preflight or Type 3 rewrite. Keep `spikes/**` and existing icon concepts untouched.

## Test plan
`npm run build`, `npm test`; focused real-Electron E2E for images/links/colors, then full `npm run test:e2e`, `npm run test:golden`, `npm run test:geometry`, `npm run test:milestone2`. Capture and inspect actual UI, including missing-link and corrected states. Compare independently rendered PDF crop geometry against the same image-content rectangle. Never claim a mockup establishes implementation fidelity. Serialize Electron UI runs across agents.

## Rollback
No schema migration. New feature commits are individually revertible. Work only on copies of fixture/tryout packages in tests. Relink preserves prior packaged files; Save As preserves originals. Library imports mutate only via undoable commands and validate completely first.

## Work preparation
Scope authorized by continuing the roadmap; now, per Shelby. Issue: https://github.com/shelbyklein/Galley/issues/2. Tracker plan: `20E5F984-5E7F-41F1-BAF5-7B5824BC9AEC`; stable IDs P3-01 through P3-04 match. Readiness: R1–R13 pass, 2026-10-02. Current-model metadata verified in this session JSONL. Human review remains required for closure; no blocking Phase 3 product decisions.

## Implementation and review, 2026-10-03
P3-01 is integrated as `634e0ce`, P3-02 as `e5d6d41`, and P3-03 as `30edf97`. The GPT-6.1 Sol implementation lane is finished; its isolated worktree is preserved. A separate test-only commit `b4cfb0a` gives the existing 600-sequence property test 30 seconds instead of the runner default 5 seconds; no cases, assertions or interactive performance budgets changed.

Verified on product revision `30edf97`: build/typechecks; 530 unit tests in 59 files; all eight new Electron feature tests; 503 golden print checks; 11 geometry checks; and the flyer milestone with 31 PDF/font/ink checks, 61 lines and zero screen/PDF line mismatches. The first full app run passed 226/227 cases, with an unexpected window closure during an empty-frame drawing gesture before image placement. No matching crash report identified a cause. The exact case then passed five logged repeats, and the full drawing group passed 17/17, without a product change. The subsequent clean full-app confirmation run passed 227/227 with zero skips or retries (7.0 minutes, exit 0), including the previously affected case. Browser-process diagnostics are retained locally; no cause was asserted and no speculative product change was made.

The coordinator captured and inspected these actual editor views on the integrated product:
- [Image Content and Links](assets/phase-3/screens/editor-images-links.png)
- [Swatch library menu](assets/phase-3/screens/editor-library-menu.png)

[Tryout guide](../TRYOUT.md). Existing tryout launcher and editable documents are preserved; relaunch the built app to use the updated code. Phase 2’s human flyer and hyphen-limit decisions remain open. Phase 3 issue closure awaits Shelby’s review.
