# Phases 1–2: orchestration handoff

These are instructions for the coordinator and for every lane agent. Read [phases-1-2.md](phases-1-2.md) first; the tasks, acceptance checks and exclusions live there.

## Roles
- **Coordinator:** GPT-6.1 Sol (`gpt-6.1-sol`), xhigh effort, in the current resumed session.
  - The only integration owner: merges lane branches into `main` and runs the suites after each merge.
  - The only one who writes to GitHub: pushes, edits the issue checklist, posts comments.
  - Resolves conflicts in shared files.
- **Current lanes T/S/N:** GPT-6.1 Sol (`gpt-6.1-sol`) via Codex collaboration, xhigh effort for T and high effort for S/N. Resume one agent per existing lane worktree at `dac614c`; do not create duplicate Claude or Codex agents. The earlier completed Sonnet lanes remain historical evidence.

| Lane | Tasks | Starts after |
|---|---|---|
| F, foundation | P1-01, P1-02, P1-03 | Plan committed |
| A, render + export | P1-04 → P1-07 | F merged |
| B, canvas + tools | P1-08 → P1-11 | F merged |
| C, shell, files + panels | P1-12 → P1-14 | F merged |
| T, text | P2-01, then P2-02, P2-03, P2-08, P2-09 | P1-15 done (T runs P2-01 alone, then continues) |
| S, styles + type controls | P2-04, P2-05 | P2-01 merged |
| N, fonts | P2-06, P2-07 | P2-01 merged |

**Merge order:** F → A → C → B → (P1-15) → T's P2-01 → N → S → T. Run the full suite on `main` after every merge.

## File ownership
Lanes edit only the paths they own. To extend a shared file, prefer adding a new file that the shared one imports. If a shared file has to change, keep the change minimal and list it in the completion report.

| Lane | Owns |
|---|---|
| F | Everything, until it merges |
| A | `packages/render/**` (except `src/text/**` and `src/styles/**`), `packages/prepress/**`, `apps/desktop/src/main/export/**`, `apps/desktop/src/export-page/**`, `fixtures/golden/**`, `scripts/golden/**`, `scripts/geometry/**` |
| B | `apps/desktop/src/renderer/canvas/**`, `apps/desktop/src/renderer/tools/**`, `apps/desktop/e2e/canvas/**` |
| C | `apps/desktop/src/renderer/shell/**`, `apps/desktop/src/renderer/panels/**`, `apps/desktop/src/renderer/dialogs/**`, `apps/desktop/src/main/**` (except `export/` and `fonts/`), `apps/desktop/src/preload/**`, `apps/desktop/e2e/shell/**` |
| T | `packages/model/src/text/**`, `packages/render/src/text/**`, `apps/desktop/src/renderer/canvas/text/**`, `apps/desktop/src/renderer/panels/text-wrap/**`, `apps/desktop/e2e/text/**`, `scripts/text/**`. During P2-01 only, T may also change `packages/model/**` broadly. |
| S | `packages/render/src/styles/**`, `apps/desktop/src/renderer/panels/{paragraph-styles,character-styles,character,paragraph}/**`, `apps/desktop/src/renderer/shell/control-strip/type/**`, `apps/desktop/e2e/styles/**` |
| N | `packages/fonts/**`, `apps/desktop/src/main/fonts/**`, `packages/prepress/src/fonts/**`, `apps/desktop/src/renderer/dialogs/export/**`, `apps/desktop/e2e/fonts/**` |

**Shared files.** Change these only minimally; the coordinator reconciles them at merge:
- `packages/model/src/index.ts` and the command list
- `apps/desktop/src/renderer/store/**`
- `apps/desktop/src/renderer/commands/registry.ts`
- the root and workspace `package.json` scripts and dependencies
- `apps/desktop/e2e/helpers/**`
- the lockfile

## Environment facts (verified 2026-10-01)
- **Tools:** macOS (arm64), Node 26.5, npm 11.17.
- **Command-line tools:** Ghostscript `gs`, poppler (`pdftotext`, `pdffonts`, `pdfimages`, `pdftoppm`), `qpdf` and `rsvg-convert` are in `/opt/homebrew/bin`.
- **npm and Electron:** npm 11 blocks Electron's postinstall. Add `"allowScripts": {"electron@44.5.1": true, "esbuild@<version>": true}` to the root `package.json`, as both spikes do; see `spikes/*/package.json`. Pin `"electron": "44.5.1"` exactly.
- **Output profile:** `/Library/Application Support/Adobe/Color/Profiles/Recommended/CoatedGRACoL2006.icc`. Never copy it into the repo; the repository is **public**.
- **sRGB profile:** `/System/Library/ColorSync/Profiles/sRGB Profile.icc`.
- **Fonts:**
  - Use Inter (OFL) for fixtures. Get it from `@fontsource/inter` / `@fontsource-variable/inter`, or copy it from `spikes/threading/fonts/` along with its OFL text.
  - Never commit fonts from `~/Library/Fonts` or `/System/Library/Fonts`. Tests that need a CFF `.otf` or a system font must look it up at runtime and skip with a clear message if it's absent.
- **Reference code to copy (never move or edit):**
  - `spikes/press/src/prepress/**` (tokenizer, rewrite, shading, masks, images, marks, pdfx), `spikes/press/src/verify.ts` and `plates.ts` (separation measurement)
  - `spikes/threading/src/**` (thread engine, editing view) and `spikes/threading/test/**` (fuzz, perf, print harness)
  - Read each spike's `FINDINGS.md` before porting from it. The caveats there are real constraints.

## Rules for every lane
1. **Stay in scope.** Work only on your lane's tasks and paths. Read the exclusions in the plan; don't build excluded features.
2. **Commit on your worktree branch** in small commits with clear messages. Don't push, don't touch `main`, don't open PRs, don't write to GitHub. Use accurate authorship for this session; do not attribute new Sol work to Claude.
3. **Run your own task's acceptance check** before you call it done, plus `npm test` and the e2e suites for your area. Report the exact commands and results. Never claim a check passed without having run it.
4. **UI tasks:** capture e2e screenshots, look at them (open the PNG with your Read tool), and make sure they show what the task describes. Store the baselines under `apps/desktop/e2e/__screenshots__/`.
5. **Don't edit `spikes/**`, `PLAN.md`, or `docs/plans/**`.** Put design notes the plan asks for (e.g. `packages/render/GEOMETRY.md`) in your owned paths.
6. **Shared-file changes** stay minimal and get listed in your report.
7. **If you're blocked or a decision would change scope, behavior or the file format beyond the plan:** stop that task, commit what's solid, and report the question with options and your recommendation. Don't silently pick a direction.
8. **Don't write report files.** Your final reply is the completion report.

## Completion report (each lane's final reply)
- The branch name and the HEAD SHA of your worktree, plus the worktree path.
- For each task ID, either PASS with the exact acceptance command(s) and their key output, or NOT DONE with the reason.
- The paths of the screenshots you inspected, and what they show.
- Shared files you touched, and why.
- Deviations from the plan, open questions, and anything the coordinator must decide.
- Known rough edges.

## Coordinator procedure
1. **Launch** each lane with a message naming its tasks, its baseline `main` SHA, and this handoff.
2. **On a lane's report:**
   - Inspect its branch: the diff stat and any shared-file changes.
   - Run its acceptance commands in its worktree.
   - Merge into `main` with `--no-ff` in the merge order above.
   - Re-run `npm ci && npm test && npm run test:e2e`, plus the suites that exist so far (`test:golden`, `test:text`, `test:geometry`).
   - Push `main`.
   - Record the pre-merge SHA, then check the issue boxes for tasks whose checks passed on `main`.
3. **On a conflict or failed check:** don't force it. Resume the lane (SendMessage) with the failure, or fix small integration glue yourself and note it in the issue.
4. **At P1-15 and P2-10:** run the milestone suite, capture app screenshots, inspect them, commit them under `docs/plans/assets/phases-1-2/screens/`, and post an issue comment with the results.
5. **Stop for Shelby** only at the plan's gates, or at a fork as defined in the dev-work skill (scope, user-visible behavior, architecture or file format, cost). The P2-08 leading result is a named fork if it fails.

## Resumed progress reporting
Tracker Trapper is required again by Shelby's 2026-10-02 instruction. Use the default shared CLI store if MCP is unavailable. Each lane starts its own Codex run, verifies and links its own JSONL when available, starts its stable P2 todo IDs before work, reports milestones at least every five minutes, completes acceptance with evidence, and finishes its run before ending. The coordinator alone changes GitHub boxes after acceptance passes on main.
