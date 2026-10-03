# Trying Galley

Run `npm run dev` from the repository, or use your existing `Documents/Galley Tryout/Launch Galley.command` launcher after a build. Relaunch an already-open app to load newly built code. The development build opens the sample poster; the tryout launcher opens your separate Getting Started document.

## Image content
Place a PNG or JPEG with **File > Place** (⌘D). Select its frame and open **Window > Image Content**. X and Y move the picture inside its frame; W and H resize the picture. The frame itself stays put. Turn off **Constrain content proportions** for independent width and height. The Fitting menu provides fit, fill and center. Each committed adjustment supports Undo/Redo.

## Links and resolution
Open **Window > Links**. Each image shows its packaged path, stored pixel dimensions and actual PPI, plus effective X/Y PPI for each placement. Click a placement to select its frame. Effective resolution changes with placed size; a smaller crop alone does not create more pixels.

Galley stores copies inside its `.galley` folder package. It does not watch the original external file. **Check Links** checks those packaged copies and refreshes the displayed image. **Relink…** imports a replacement without overwriting the old packaged bytes. Missing or unreadable images block PDF export until repaired. Replacing a valid image keeps its existing frame and content rectangle; use Fitting if the replacement has a different aspect ratio.

## Reusable colors
In the **Swatches** panel menu, choose **Save Swatch Library…** or **Load Swatch Library…**. Libraries are Galley JSON files, containing your process, spot and tint definitions. Import supports one-step Undo. Identical definitions are reused; conflicting spot names reject the import because those names identify ink plates. No proprietary color books are included.

The Swatch Options color preview now uses the same output-profile conversion as the canvas. An approximate preview may appear briefly while the profile conversion completes.

## PDF and review
Use **File > Export > PDF/X-4** (⌘E). Keep the earlier print limitations in mind: CFF fonts still have a Type 3 warning; independent PDF/X preflight and a real printer’s acceptance remain separate from automated checks.

Phase 2’s real InDesign flyer rebuild/review remains open, along with the consecutive-hyphenated-line-limit decision. CSS/Chromium remains the document layout and rendering engine.
