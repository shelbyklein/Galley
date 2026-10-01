# Threading spike: findings

**Verdict: threading by DOM measurement holds, with caveats.** `npm test` passes 69/69 (re-run 2026-10-01), and the `printToPDF` output matches the screen exactly on every line compared.

```
npm install      # first time; postinstall fetches the Electron binary
npm test         # builds, runs 69 checks (~70–80 s), exits non-zero on failure
npm run demo     # visible window: type in the frames and watch them re-thread
```
The demo has:
- a readout of the last re-thread time, median and p95 over the last 60 keys, and the overset count
- Undo/Redo, B/I and style buttons
- +200 words, Hyphens and Wrap image toggles
- "Export PDF + check", which prints and verifies the PDF in the app

## Evidence

### Correctness
- An 802-word story fills a 4-frame page with nothing overset. The 2-column frame counts as two linked slots.
- **Frame geometries:** 72 of them gave 154 mid-paragraph joins and 23 hyphenated joins, with 0 violations of the greedy-fill, no-overflow and continuation-style checks. A continued paragraph has no first-line indent and no space-before.
- **Hyphenated joins work:** frame k ends `win-` and frame k+1 starts `dows through`. CSS draws the hyphen, and it never enters the story.
- **Random edits:** about 2,600 (insert, delete, split, join, restyle, paragraph insert/append/delete). Every one gives the same slots incrementally as a from-scratch re-thread. The fuzz is biased toward slot boundaries, which is where the real bugs were.
- **Fuzz quality:** it catches deliberately broken versions of the incremental logic. The subtlest mutant is caught rarely, so it also has deterministic regression tests.

### Print fidelity
On-screen lines vs `pdftotext -bbox-layout`:

| Scenario | Lines compared | Mismatches |
|---|---|---|
| Default page | 82 | 0 |
| After typing | 83 | 0 |
| After deleting a paragraph | 69 | 0 |
| Sweep of 34 frame geometries (11 hyphenated joins) | 2,205 | 0 |
| Text-wrap page | 86 | 0 |

- Positions agree within 0.054 pt.
- Static Inter embeds as CID TrueType (no Type 3).
- Overset text and editor chrome stay out of the PDF.

### Performance
Keydown to laid-out DOM, on this Mac:

| Scenario | Median | p95 | Max |
|---|---|---|---|
| 800 words, typing in frame 1 | 0.3 ms | 0.5 ms | 2.4 ms |
| 800 words, Enter at top (re-threads every slot) | 1.4 ms | 2.6 ms | 3.6 ms |
| 10k words / 20 frames, typing | 0.6–0.8 ms | 1.0–1.2 ms | 8–18 ms |
| 10k words / 20 frames, full-chain cascade every key | 15–18 ms | 23–27 ms | 25–36 ms |

- Brochure-sized stories meet the 16 ms target by a wide margin.
- In long chains, a wrap that ripples through all 20 frames (about 1 key in 60) is the slow case.
- About 90% of the cost is the browser laying out the hidden DOM. Paint was not measured.

## How it works
**Thread engine.** Each frame's slot is laid out in a hidden host at the frame's width, using the same CSS and DOM as the real frame.
- Because leading is fixed, line positions are known arithmetically. Only the paragraph straddling the frame bottom needs a character offset, found by binary search over single-character Range rects.
- When lines are irregular (displaced by a wrap float, or taller from a fallback font), the engine falls back to measured y positions.
- Output per slot: `{start, end, startMid, endMid, hy, frontier}`.

**Incremental re-threading.** The engine re-measures from the edited frame onward and stops once a frame reproduces its old boundaries. A per-slot "frontier" handles edits whose effect reaches backward; see caveat 2.

**Editing.** One ProseMirror EditorView sits over a derived view doc (`frame` nodes wrapping paragraph pieces). A separate story doc is the source of truth.
- One contenteditable root gives native cross-frame selection and arrow keys.
- View edits are diffed into story transactions, so undo history lives on the story.
- Enter, Backspace/Delete at boundaries, paste, cut, undo/redo and marks run directly on the story.
- Tested with real input: typing, push-forward and pull-back, arrows across joins, cross-frame shift-click selection, bold over a cross-frame selection, and dead-key and CJK composition (via CDP).

**Text wrap (stretch goal, done).** An invisible `shape-outside` float goes in each overlapped frame, and the PDF shows no printed word touching the image.

## Caveats
1. **ArrowDown stalls at a hyphenation break.** This is a native Chromium bug; it reproduces in plain contenteditable. The spike works around it by moving the caret itself.
2. **Chromium never hyphenates the last word of a paragraph.** Joining paragraphs can therefore pull a hyphenated prefix back up onto the previous frame. The frontier handles this.
3. **Hyphenation breaks return extra rects.** Single-character Range rects after a break come back as two rects (the generated hyphen, then the character); the engine takes the last one.
4. **IME composition.** Re-threading mid-composition destroys the session, so it is deferred until composition ends, and a frame can briefly overflow by a line. Not yet tested with a real macOS IME.
5. **Justified continued paragraphs.** The last line of a continued justified paragraph ended one space short. Fixed with a zero-width decoration on the trailing space.
6. **Caret in overset text** isn't drawn, because overset has no DOM. Typing there still works through the story model.
7. **Hidden measurement host.** It must sit under the same CSS cascade as the frames, or measurement silently diverges.
8. **Fixed leading must be a multiple of 0.75 pt** for exact arithmetic. Other values use the measured-y fallback, which is accurate to about 0.75 px. This echoes the press spike's 0.75 pt snapping.
9. **A single word wider than its frame** is outside the model.
10. **Wrap is one-sided only.** It wraps on the side reaching a slot edge; jump-object and wrap-both-sides are not done.
11. **Not tested:**
    - `text-wrap: pretty`/`balance`, which may break the greedy-fill assumption
    - Retina or zoom
    - multi-page documents
    - RTL text
    - variable fonts in the PDF
    - rich-text copy
    - Windows and Linux

## Next steps for `packages/render`
1. **Keep the shape:**
   - the story doc is the source of truth
   - the thread engine returns slot boundaries
   - the view doc is derived
   - export uses the same renderer and measurement host
2. **Port the tests, not just the code.** In order of value:
   - the boundary-biased fuzz (incremental == full)
   - the geometry invariants
   - the independent per-word line extraction
   - the pdftotext line-match harness
3. **Pin Electron** and store the engine version in each document. Hyphenation and line breaking are what change between Chromium versions.
4. **Long chains:** thread viewport-first and finish off-screen frames in idle time. Persistent per-slot measurement containers are the next performance lever.
5. **Columns and wrap as slots.** Model multi-column frames, and later wrap-both-sides and jump-object, as extra slots rather than CSS multicol.
6. **Real IME test.** Do a pass with the macOS Japanese input and dead keys, then decide whether a Story Editor panel is still needed for the overset and IME edge cases.
7. **Typography layer:**
   - widow/orphan and keep options need engine support
   - test `text-wrap: pretty` before allowing it
   - use static TTFs for body text so PDF font embedding stays clean
