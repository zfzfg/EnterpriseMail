# UI/UX Polish Plan — SnappyMail Mailbox

## Purpose and design thesis

**Polish the existing mailbox into a quiet, precise daily work tool: paper-like surfaces, hairline structure, editorial reading, ink actions, and motion that explains state without slowing repetitive email work.**

This is a refinement plan, not a redesign. Preserve the three-pane architecture, responsive pane model, PHP/JSON behavior, sandboxed letter iframe, assistant sheet, existing icon language, German sentence-case copy, and all current capabilities.

### Audit basis and limits

The plan is grounded in the current source: `ui/src/styles/app-tokens.css`, `ui/src/styles/shell.css`, `ui/src/view.ts`, `ui/src/reader.ts`, `ui/src/compose.ts`, `ui/src/search.ts`, and `ui/src/icons/icons.txt`. Contrast values below are calculated from token values, not estimated from screenshots. Visual browser verification remains an implementation gate.

Design references applied:

- **Mistral app layer:** `references/tokens-color.md`, `typography.md`, `layout-grid.md`, `motion.md`, and `components-app.md`.
- **Apple usability principles translated to the web:** `accessibility.md`, `layout.md`, `typography.md`, `color.md`, `designing-for-ios.md`, `cross-platform.md`, `buttons.md`, `menus.md`, `search-fields.md`, `motion.md`, `modality.md`, and `feedback.md`.
- **Design engineering:** Emil Kowalski’s frequency-based animation decisions, tactile press feedback, origin-aware popovers, interruptible transitions, and composited-property performance rules.

Apple’s native component conventions are used as usability principles, not as instructions to imitate iOS or macOS chrome.

### Non-negotiable boundaries

- Keep `ui/src/styles/app-tokens.css` as the only token file and keep its filename.
- Stay in the **Mistral app layer**; do not import marketing-layer radii, gradients, hero motion, or orange CTA fills.
- Orange remains the 6 px “Antwort nötig” square, focus ring, and selection—not general decoration.
- Primary actions remain ink: `background: var(--foreground); color: var(--background)`.
- Use `var(--text-quiet)` for secondary text; do not use `--muted-foreground` for secondary text in dark mode.
- Keep icons on the 9 × 9 source grid and render only at 20 px or 40 px via `icon(name)`.
- Preserve `focus({ preventScroll: true })`, `overflow: hidden` on the shell/reader, hover gating, mobile 44 px targets, and reduced-motion behavior.
- Do not add entrance choreography to inbox refreshes, J/K navigation, search input, or other high-frequency actions.

---

# 1. Refinement Strategy

## 1.1 What already works and must survive

1. **The shell has a clear spatial model.** Folder → message → letter remains stable from mobile panes to desktop columns.
2. **Hairlines carry the structure.** The interface does not depend on decorative cards or heavy elevation.
3. **The typographic voice is restrained.** Weight 500 titles, uppercase mono labels, and Inter body copy already fit the product.
4. **The action hierarchy is mostly correct.** Ink is reserved for compose/send/confirmation; reader actions are quiet.
5. **The icon system is distinctive and coherent.** The current pixel icons are a signature, not a placeholder to replace.
6. **Keyboard and focus behavior are unusually complete.** Preserve existing shortcuts, focus return, folder-tree navigation, and menu semantics.
7. **The assistant has the right containment model.** It remains a sheet over the letter, not a fourth column.

## 1.2 Final-20% problems to solve

| Current source pattern | Refined target | Why |
| --- | --- | --- |
| Several adjacent control strips: `.pane-head`, `.search-wrap`, `.quick`, optional `.filters` | One clear list-toolbar stack with consistent 12 px side gutters, 8 px internal rhythm, and fewer competing horizontal rules | The content should dominate; controls should read as one instrument panel |
| Selected and hovered messages both use `var(--accent)` | Separate hover, selected, checked, unread, and keyboard-focus states | Frequent scanning needs unambiguous state hierarchy |
| Unread is mainly weight 500 on sender/subject | Add a small ink unread marker and weight 600 only for unread primary text; keep read rows at 400 | Weight 500 is too close to normal at 13 px; the marker gives a non-color cue |
| Reader body uses generic 16 px pane padding at every width | Establish a centered reading measure with responsive outer padding while keeping the toolbar full width | Editorial polish comes from measure and rhythm, not a new layout |
| Reader title is `.title-md` at 16 px | Use a true message-title role: 20 px / 1.25, weight 500, `letter-spacing: -.01em` | Subject is the primary content in the reading pane |
| Reader actions all share similar visual weight | Reply is the single locally prominent action; forward/archive remain ghost; destructive delete stays separated | One likely action per view reduces scanning effort (`buttons.md › Style`) |
| Menus appear instantly and carry a broad shadow | Use origin-aware 150 ms opacity + 4 px translation + scale(.98), with a smaller functional-layer shadow | Popovers should feel connected to their trigger without delaying work |
| `.sheet` and `.composer` use one 200 ms curve for enter and exit | Enter 240 ms drawer curve; exit 160 ms strong ease-out; no animation for keyboard-repeated pane changes | Spatial continuity on open, fast release on close |
| Buttons have hover but no common pressed state | Add `transform: scale(.97)` for pointer press only, 120 ms strong ease-out; omit it on rows, chips, toggles, and text fields | Immediate tactile confirmation without bouncy UI |
| Search is a bare input with adjacent filter button | Add leading search icon, integrated clear action, visible result state, and a consistent active-filter summary | Search scope and state should be legible at a glance (`search-fields.md › Best practices`) |
| Empty/loading states are mostly plain text | Use stable-height inline status, existing pixel loading icon, and action-oriented empty copy | Feedback belongs beside the affected content (`feedback.md › Best practices`) |

## 1.3 Hierarchy model

Use four levels consistently:

1. **Content:** subject, sender, message body—highest contrast and strongest type.
2. **Current context:** folder title, current message, active filter—ink text plus a structural marker or selected surface.
3. **Available action:** normal foreground icons and labels; only the primary action gets ink fill.
4. **Metadata:** dates, counts, hints—`--text-quiet`, smaller size, never lower than accessible contrast.

Do not introduce extra accent colors to solve hierarchy. Prefer alignment, spacing, weight, marker shape, and surface step.

## 1.4 Spacing and alignment strategy

- Standardize on a **4 px base grid**, with 4 / 8 / 12 / 16 / 24 px as the working set.
- Desktop pane gutter: **12 px** for toolbars and lists; reading content: **16 px at narrow reader widths, 24 px when the reader container is at least 900 px**.
- Sidebar outer padding remains **12 px**; align folder text and section labels to the same 8 px inset.
- Message rows: **12 px horizontal, 10 px vertical**, minimum 68 px after the unread marker is added; preserve compact density.
- Group labels: 11 px mono, 16 px line height, weight 400 rather than the current 700; use 12 px above and 4 px below.
- Keep touch targets at 44 px even when visual glyphs remain 20 px.
- At 200% browser zoom or enlarged default fonts, allow bars to wrap by logical group and message metadata to stack; never clip primary actions behind an inaccessible overflow.

## 1.5 State hierarchy

Define the order explicitly so selectors cannot accidentally collapse states:

1. **Keyboard focus:** 2 px orange ring, highest priority.
2. **Checked for bulk action:** stronger selected surface plus checkbox; not color alone.
3. **Current open message:** subtle selected surface plus a 2 px leading ink indicator.
4. **Unread:** 6 px ink square plus weight 600 primary text.
5. **Hover:** weakest surface change; never erase current/checked/unread markers.
6. **Deleted:** strikethrough and quiet text remain subordinate but readable.

The current orange 6 px square remains exclusive to “Antwort nötig”; the generic unread square uses `var(--foreground)`.

---

# 2. Token & Surface Fine-Tuning

## 2.1 Token approach

Do not replace the app token palette. Add a small mailbox-specific semantic layer in `ui/src/styles/shell.css`, derived from the existing app tokens. Raw values belong only in `app-tokens.css`; component rules consume semantic variables.

Proposed local tokens:

```css
:root {
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;

  --text-quiet: color-mix(in srgb, var(--foreground) 68%, transparent);
  --text-faint: color-mix(in srgb, var(--foreground) 56%, transparent);
  --surface-hover: var(--accent);
  --surface-selected: color-mix(in srgb, var(--foreground) 8%, var(--background));
  --surface-checked: color-mix(in srgb, var(--foreground) 12%, var(--background));
  --line-strong: color-mix(in srgb, var(--foreground) 24%, transparent);
  --shadow-functional: 0 6px 16px color-mix(in srgb, var(--foreground) 10%, transparent);

  --duration-press: 120ms;
  --duration-fast: 150ms;
  --duration-panel: 240ms;
  --ease-standard: cubic-bezier(.4, 0, .2, 1);
  --ease-out: cubic-bezier(.23, 1, .32, 1);
  --ease-drawer: cubic-bezier(.32, .72, 0, 1);
}
```

`--text-faint` is for nonessential metadata at 12 px or larger only. Test the computed dark-mode contrast before adopting it; if it falls below 4.5:1 on any actual surface, retain `--text-quiet` instead.

## 2.2 Contrast measurements and decisions

Measured against the current base surfaces:

| Foreground treatment | Light ratio | Dark ratio | Decision |
| --- | ---: | ---: | --- |
| `--foreground` on `--background` | 17.49:1 | 18.23:1 | Excellent for primary content |
| Current `--text-quiet` composite on base background | 5.98:1 | 8.67:1 | Keep for secondary text |
| Current mobile unselected flag at 40% foreground | 2.52:1 | 3.73:1 | Too weak for a meaningful icon; use `--text-quiet` and expose the 44 px target |
| `--primary` `#fa5111` on white | 3.36:1 | — | Focus/icon/indicator only, never small orange text |
| `--destructive` on base background | 4.87:1 | 6.63:1 | Suitable for text; retain icon + label for destructive actions |
| Selection foreground on `--primary-soft` light | 7.03:1 | Verify dark computed pair | Keep selection behavior, verify both themes |

Acceptance rule: normal text and meaningful icons reach **4.5:1**; large text reaches at least 3:1; focus and control boundaries remain clearly visible. Apple’s accessibility guidance explicitly calls for 4.5:1 for text up to 17 pt and non-color alternatives (`accessibility.md › Vision`).

## 2.3 Surfaces and hairlines

- Keep `--background` for list and reader; `--sidebar` for navigation; `--card`/`--popover` only for functional layers.
- Use `--border` for ordinary separators and `--line-strong` only for input hover, active resize separator, and drop targets.
- Do not add zebra striping to messages. Row boundaries and state markers carry enough structure.
- Remove the visual need for the broad `0 8px 24px` menu shadow; use `--shadow-functional`. Keep a 1 px border so dark-mode popovers remain distinct.
- Do not add shadows to message rows, the letter iframe, attachment rows, or navigation items.
- Keep the letter iframe boundary at 1 px and `calc(var(--radius) - 2px)`; this is existing app-layer language.
- Ensure adjacent bars do not produce double hairlines. Where two bordered strips touch, use a single bottom border or a `-1px` compensation, not two visible lines.

## 2.4 Typography refinement

| Role | Proposed specification | Application |
| --- | --- | --- |
| Pane title | 16 px / 20 px, 500, `-.01em` | Folder and composer titles |
| Message subject in reader | 20 px / 25 px, 500, `-.01em`; `overflow-wrap:anywhere` | `.letter-head > .title` only |
| List primary | 13 px / 18 px desktop; 16 px / 22 px mobile | Sender and subject |
| List preview | 12 px / 17 px desktop; 14 px / 20 px mobile | `.peek`; one line by default |
| Metadata | 12 px / 16 px, 400, tabular numbers where numeric | Dates, file sizes, quota |
| Mono section label | 11 px / 16 px, 400, uppercase, tracking 0 | Folder groups, search/result labels |
| Button label | 13 px / 18 px desktop, 500 | Ink and labeled ghost buttons |
| Composer body | 16 px / 25 px minimum | Plain and HTML editor; do not shrink to 13 px with shell body |
| Reader iframe content | Preserve `letter.ts` content typography; target 16 px body and 65–75ch measure | Do not restyle remote mail chrome globally |

Avoid weight 700 for ordinary unread rows and mono labels. Reserve 600 for unread primary text and 500 for titles/actions. This preserves hierarchy without loud typography (`typography.md › Conveying hierarchy`).

## 2.5 Controls and focus

- Default desktop hit area remains 28 px, but high-frequency reader actions move to **32 px** for calmer spacing and fewer mis-clicks; mobile remains 44 px.
- Use `border-radius: calc(var(--radius) - 2px)` for buttons, fields, chips, and recipient tokens; no pill-shaped primary buttons.
- On pointer press, scale only discrete buttons to `.97`; never scale a whole message row, folder row, or input.
- `:focus-visible` remains 2 px `var(--primary)` with 2 px offset. Where offset would clip inside scroll containers, use an inset ring without reducing visibility.
- Add `@media (prefers-contrast: more)` to strengthen borders and quiet text while preserving semantic roles.
- Placeholder text uses `--text-quiet`; do not use it as the sole field label.

---

# 3. Component-by-Component Polish

## 3.1 Sidebar and account navigation

**Target:** stable, scannable navigation with clear current location and no decorative noise.

1. **Account row**
   - Keep the email left aligned and weight 500.
   - Add the existing `chevron-down` icon at the **trailing right edge** of `.account-btn`, 20 px, quiet by default and foreground when expanded.
   - Rotate it to `chevron-up` only if state swapping stays instant; otherwise rotate the same SVG 180° over 150 ms. No bounce.
   - Preserve `aria-expanded` and menu focus behavior.

2. **Folder groups and tree**
   - Standardize label baseline and folder-row text alignment; disclosure toggle, folder icon, label, and count each get a fixed alignment role.
   - Keep 12 px desktop indentation per depth; preserve 16 px mobile indentation.
   - Current folder uses the sidebar accent plus a **2 px leading ink bar** on `.frow`, not an orange bar.
   - Hover only changes the surface; current folder retains its leading bar and weight.
   - On folder expansion, update immediately. Do not animate tree height during keyboard navigation.

3. **Folder actions**
   - Keep `.fmore` hidden until hover/focus on desktop, but reserve its 28 px space so labels do not shift when it appears.
   - On touch it remains visible with a 44 px target.
   - Drop target: retain inset foreground outline; add `background: var(--surface-selected)` and remove it immediately on drop/drag end.

4. **Counts and quota**
   - Counts use 12 px tabular numbers and `--text-quiet`; unread count may use foreground + 500 weight.
   - Quota remains a hairline, not a branded progress bar. Full state adds text/icon, not color alone.

5. **Responsive sidebar**
   - Desktop overlay sidebar may slide 8 px + fade over 180 ms; docked sidebar toggling should not animate grid-column widths.
   - Mobile folder pane remains instant when invoked by repeated navigation.

## 3.2 Inbox and thread list

**Target:** unread, current, selected, and actionable messages are distinguishable in under a second.

1. **Toolbar stack**
   - `.pane-head`: retain 48 px height; folder title gets ellipsis and a full-title `title` attribute.
   - Keep view/select/refresh at the trailing edge, with 2–4 px separation rather than equal wide gaps.
   - `.search-wrap` and `.quick` share the same 12 px horizontal gutter.
   - Use one bottom hairline after the complete search/filter stack, not separate competing lines for every strip.

2. **Message row anatomy**
   - Add `.unread-mark`: **6 × 6 px ink square** in a reserved 8 px leading slot, vertically aligned to the sender line.
   - Sender and subject: weight 600 when unread, 400 when read. Current row does not become bold merely because it is open.
   - Date remains trailing, top aligned, tabular, 12 px. Keep thread count in its existing top-right reservation.
   - Preview remains one line by default. At 200% text scaling, allow two lines and grow the row instead of clipping.
   - Existing attachment/answered/forwarded/flag marks stay unchanged and in their current order.

3. **State styling**

   ```css
   .msg[aria-current="true"] { background: var(--surface-selected); }
   .msg-row.checked { background: var(--surface-checked); }
   .msg-row:focus-within { /* preserve orange focus ring and all state markers */ }
   ```

   Add the current-message leading indicator on `.msg-row`, not inside the text, so long senders do not move it.

4. **Flag and selection actions**
   - Reserve flag space continuously; reveal opacity on hover/focus without layout shift.
   - Replace mobile 40% flag color with `--text-quiet`; unflagged remains recognizable at 4.5:1.
   - Checked state keeps the flag visible and never removes the unread marker.
   - Selecting a row gives an immediate surface/checkbox update; server confirmation may follow without delaying the visual state.

5. **Date groups and threads**
   - `.list-group` becomes 11 px mono/uppercase, weight 400, with 12 px top and 6 px bottom spacing.
   - Thread count remains a bordered compact control. Use the existing `thread` icon only if the count alone tests as ambiguous; if added, place it **before the numeric count**, with no change to row width.
   - Opening a thread updates the thread bar immediately; no sliding list transition.

6. **Loading, empty, and pagination**
   - Reserve a stable 20 px inline status line below the toolbar for refresh/search feedback to avoid row jumps.
   - Use existing `loading` pixel icon plus concise text for initial loading; for background refresh keep current rows interactive.
   - Empty search: “Keine Treffer. Suche anpassen oder Filter entfernen.” Place the existing clear-search action directly below.
   - “Weitere” becomes a full-width quiet row with existing `chevron-down` at the **leading left of the label**; show determinate progress only if the server exposes it.

## 3.3 Reading pane

**Target:** an editorial letter canvas inside a quiet, predictable action frame.

1. **Reader toolbar**
   - Keep actions in their existing responsive order.
   - Make **Reply** the only locally prominent reader action: ink fill only when labeled at wide container sizes; at narrow sizes keep the current ghost icon treatment to avoid a row of heavy buttons.
   - Keep Reply all and Forward as ghost actions. Archive follows them; place a 1 px vertical separator before Delete.
   - Delete uses foreground by default and destructive color only in its confirmation context; do not make the everyday toolbar permanently red.
   - Keep overflow and previous/next at the far trailing edge. Preserve container-query behavior.

2. **Message header**
   - Increase subject to the message-title role defined above.
   - Sender line remains primary; time remains quiet and details toggle stays at trailing right.
   - Use 8 px between subject and sender, 4 px between compact recipient lines, and 16 px before notices/attachments.
   - Expanded details appear instantly for keyboard activation; pointer activation may use a 120 ms opacity fade, not height motion.

3. **Reading measure**
   - Keep toolbar full width.
   - Wrap `.letter-head`, notices, calendar, attachments, and `.letter` in a shared reading container with `width: min(100%, 76rem)` and centered margins; inside the iframe preserve a 65–75ch prose measure where `letter.ts` controls it.
   - Reader container under 600 px: 16 px padding. At 900 px and above: 24 px padding.
   - Do not narrow the actual HTML letter so aggressively that tables or remote layouts break; the outer cap is a readability aid, not a fixed text column.

4. **Notices and security**
   - Standardize `.note-bar` icon at leading left, message next, actions trailing; wrap actions below text at narrow widths.
   - Keep destructive/spam states icon + text, never red alone.
   - Only the most urgent notice gets strong foreground; informational notices remain neutral.
   - No animated entrance for every blocked-image/security notice.

5. **Attachments and calendar**
   - Preserve the existing attachment icons and thumbnails.
   - Align file rows to a 40 px visual/media slot, flexible metadata, trailing download target.
   - File download hover changes background; press scales only the download button.
   - Calendar card keeps existing `calendar` icon leading left and aligns title/date/location to one text column.

6. **Empty state**
   - Replace bare “Wählen Sie eine Mail.” with a quiet, centered state using the existing `inbox` icon at 40 px, the same text, and no CTA that invents a new workflow.
   - No looping animation.

## 3.4 Composer

**Target:** the editor feels like a focused writing surface while preserving autosave, security, attachments, and keyboard flows.

1. **Composer bar**
   - Preserve Close, Save, Minimize, Send order.
   - Send remains the single ink action. While sending, keep its width stable, show the existing `loading` icon, and change the label to “Wird gesendet …”.
   - Save and minimize keep 32 px desktop/44 px mobile targets and existing accessible names.

2. **Address and identity fields**
   - Align labels on a consistent 7 rem desktop/5 rem small-screen grid as today.
   - Focus the whole recipient box with `border-color: var(--primary)` plus the standard ring; do not ring every chip.
   - Invalid recipients use destructive border + existing `error` icon at the **leading edge of the invalid chip**, plus text in the send error when submission is attempted.
   - Suggestions use the shared popover motion and originate at the recipient field. Selection highlight is instant during arrow-key navigation.

3. **Editor and formatting**
   - Keep body text at 16 px / 1.55 minimum even on desktop.
   - Formatting toolbar gets 32 px desktop targets and clear pressed states using `aria-pressed` where formatting state is detectable.
   - Add **one new icon** `format-clear` for “Format entfernen”: a 9 × 9 pixel eraser with a short baseline. Place it in the existing remove-format slot, retaining the current `close` icon everywhere else. This removes the semantic ambiguity of an X meaning both close and clear formatting.
   - HTML/Text toggle stays trailing right; mode changes are instant to protect writing flow.

4. **Attachments and options**
   - Attachment upload rows keep stable heights; progress changes do not reflow filename or remove button.
   - Drag-over outline uses primary color and an inline drop hint, but no pulsing or scaling.
   - Sendeoptionen gets existing `settings` icon at the **leading left of the summary label** only if testing shows the disclosure triangle is not enough; otherwise leave it text-only and avoid adding noise.
   - Expanded options use immediate disclosure for keyboard activation; pointer may fade content over 120 ms without animating height.

5. **Minimize/restore and close**
   - Composer desktop entry: 240 ms `--ease-drawer`, translateX(100%) → 0; exit 160 ms `--ease-out`, 0 → translateX(100%).
   - Mobile composer remains a static full pane with no slide.
   - Minimize uses 160 ms fade + translateY(8px) on the composer and a 150 ms fade on the dock. Restore is the spatial reverse, 200 ms.
   - If opened by `C`, `R`, `A`, `F`, Ctrl/Cmd+Enter, or other keyboard flows, skip entrance animation entirely; focus and typing must be immediate.
   - Retain the unsaved-changes dialog and explicit save/discard choices (`modality.md › Best practices`).

## 3.5 Command and search bar

**Target:** improve the existing inline search rather than adding a new command-palette paradigm to a mature shortcut system.

1. **Search field composition**
   - Add existing `search` icon at the **leading inside edge** of `#search`, 20 px, with 12 px field padding and 8 px icon-to-text gap.
   - Keep advanced search as the adjacent trailing filter button.
   - Add a clear button using existing `close` at the **inside trailing edge** only when the query is nonempty; minimum 28 px desktop/44 px mobile target, accessible label “Suche löschen”.
   - Do not let the native search cancel control and custom clear control render together; normalize `::-webkit-search-cancel-button`.

2. **Query state**
   - Active quick filters keep `aria-pressed`; add existing icons **before labels**: `mark-unread` for Ungelesen, `flag` for Markiert, `attachment` for Mit Anhang. Icons remain 20 px and inherit currentColor.
   - Show a compact mono result label above rows: “ERGEBNISSE · 24” or “KEINE TREFFER”, only during an active search.
   - When structured criteria are active, display a removable summary token row below the field. Use existing `filter` leading and `close` trailing; do not expose raw `parse_str` syntax as the primary explanation.

3. **Keyboard and responsiveness**
   - `/` focuses search only if this shortcut is deliberately added to the shortcut dialog and does not conflict with typing; otherwise retain current behavior and use the existing mobile Search tab.
   - Enter executes immediately; no animated dropdown or delayed typeahead is required for this polish pass.
   - Escape first closes menus/dialogs as today; when search itself is focused, Escape clears only if that behavior is announced consistently and does not discard composed text elsewhere.
   - On mobile, focusing search from the bottom tab remains immediate and brings up the keyboard (`search-fields.md › Phone (iOS)`).

4. **Optional later command menu—not in this polish pass**
   - If a future global command menu is requested, open it instantly for Ctrl/Cmd+K, use no open/close animation, and reuse existing commands. Do not build it as part of visual refinement.

## 3.6 Menus, dialogs, assistant sheet, and notices

- All menus share the same origin-aware enter/exit pattern and functional shadow.
- Keep menu groups short; add separators between message editing, organization, display, export, and destructive groups in the long reader menu.
- Menu icons remain consistent within each group; do not add decorative icons to fill gaps.
- Dialogs scale from `.98` with opacity, centered; popovers use their trigger origin.
- Only one modal task at a time. Confirmation remains reserved for irreversible/data-loss actions, not ordinary archive/read/flag operations.
- Assistant sheet retains its 28 rem cap and enters from the right; chat turns appear without stagger or typewriter motion.
- `#notice`, compose status, and settings live regions use inline feedback. Avoid toast piles and success alerts for routine actions.

## 3.7 Icon additions and usage map

Keep every existing icon asset and meaning. The only required new source icon is:

| New icon | 9 × 9 concept | Exact placement | Reason |
| --- | --- | --- | --- |
| `format-clear` | Pixel eraser angled down-right with a two-block baseline | Existing remove-format button in `.editor-tools` | Distinguishes clearing format from closing/deleting |

Reuse these existing icons in new positions: `search` leading in search; `close` as search clear; `chevron-down` trailing in account; `mark-unread`, `flag`, `attachment` in quick filters. No other new icons are justified in this pass.

After adding `format-clear`, update `ui/src/icons/icons.txt`, run `node scripts/icons.mjs` through the normal build, and verify crisp edges at 20 px and 40 px.

---

# 4. Unified Motion & Interaction System

## 4.1 Decision order

For every proposed animation, answer:

1. **Frequency:** Is this seen dozens or hundreds of times per day? If yes, remove motion.
2. **Purpose:** Does it explain spatial origin, confirm a press, or prevent a jarring state change? If not, remove it.
3. **Input:** Keyboard-initiated repeated actions are immediate. Pointer-initiated sheets/dialogs may animate.
4. **Direction:** Entering uses ease-out; exiting is faster; on-screen movement uses ease-in-out; hover color uses standard ease.
5. **Accessibility:** Reduced motion removes transforms and retains only a short opacity change where useful.

This synthesizes Mistral’s short precision, Apple’s purposeful/cancellable feedback, and Emil’s frequency and easing rules. It deliberately avoids spring/bounce on mailbox controls.

## 4.2 Motion tokens

| Token | Value | Use |
| --- | --- | --- |
| `--duration-press` | 120 ms | Discrete button press/release |
| `--duration-fast` | 150 ms | Hover color, border, opacity, icon state |
| `--duration-menu` | 160 ms | Menus, recipient suggestions, small popovers |
| `--duration-dialog` | 180 ms | Centered dialogs |
| `--duration-panel` | 240 ms | Pointer-opened assistant sheet and desktop composer |
| `--ease-standard` | `cubic-bezier(.4, 0, .2, 1)` | Hover/color and simple state changes |
| `--ease-out` | `cubic-bezier(.23, 1, .32, 1)` | Entering and quick exits |
| `--ease-drawer` | `cubic-bezier(.32, .72, 0, 1)` | Spatially anchored sheets/composer only |

No UI transition exceeds 240 ms. No `transition: all`. No scale from 0. No hover scaling. No marketing reveals in the mailbox.

## 4.3 Interaction recipes

### Buttons

```css
.icon-btn, .text-btn, .ink-btn, .danger {
  transition: background-color 150ms var(--ease-standard),
              color 150ms var(--ease-standard),
              transform 120ms var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  /* existing surface hover rules remain */
}
@media (pointer: fine) {
  .icon-btn:active, .text-btn:active, .ink-btn:active, .danger:active {
    transform: scale(.97);
  }
}
```

Do not scale disabled buttons, rows, chips, fields, splitters, or formatting toggles with persistent pressed state. Focus rings must not scale with content if that causes clipping; apply the transform to an inner wrapper if needed.

### Menus and recipient suggestions

- **Enter:** opacity 0 → 1; translateY(-4px) → 0; scale(.98) → 1; 160 ms `--ease-out`.
- **Exit:** opacity → 0; translateY(-2px); 100 ms `--ease-out`.
- `transform-origin`: top-left for account, top-right for `.menu-right`, computed anchor point for address/folder context menus, top center for recipient suggestions.
- Arrow-key navigation and selected-option highlighting are instant.
- Implement with CSS transitions and state attributes so rapid open/close retargets rather than restarting keyframes.

### Dialogs

- Center origin; opacity 0 → 1 and scale(.98) → 1 over 180 ms `--ease-out`.
- Backdrop fades 150 ms; no blur/glass.
- Exit 120 ms. Focus return remains synchronous with the close lifecycle and must not wait unnecessarily on a missing `transitionend`.

### Assistant sheet and composer

- Enter from the spatial edge with `--ease-drawer`; exit faster along the same axis.
- Animate only `transform` and `opacity`; never animate grid columns, width, height, padding, or margins.
- Replace the single `transitionend` listener with a robust helper that handles `event.target === layer`, `propertyName === "transform"`, cancellation, reduced motion, and a timeout fallback. This prevents hidden layers from getting stuck when a transition is interrupted.

### Lists and navigation

- J/K, Enter, folder switching, search execution, thread navigation, sorting, grouping, and refresh: **instant**.
- Selection/hover surfaces may transition color over 100–150 ms; do not animate row position on each refresh.
- New mail insertion does not slide the whole list. Update rows and announce through the existing status region.
- Scrolling remains native. Do not add smooth scrolling to keyboard navigation.

### Loading and status

- Keep the current three-block loading icon, 900 ms stepped loop; it is the only repeating UI animation.
- Under reduced motion, freeze the three blocks and retain text such as “Wird geladen …”.
- Send/save buttons retain dimensions during busy states.
- Inline status fades 120 ms only when text appears/disappears; no vertical layout animation.

## 4.4 Before/after motion corrections required during implementation

| Before | After | Why |
| --- | --- | --- |
| `transition: transform 200ms var(--ease)` for both directions | Enter 240 ms drawer curve; exit 160 ms strong ease-out | Spatial entry can be smooth; exit should feel immediate |
| Instant menu insertion | Origin-aware opacity + 4 px translation + scale(.98), 160 ms | Connects menu to trigger without sluggishness |
| No common press state | `scale(.97)` on discrete buttons for 120 ms | Confirms the interface received the press |
| `transitionend` alone hides a closing layer | Filtered transition end + interruption handling + fallback | Prevents stuck layers and lost focus return |
| Any proposed J/K or folder-switch transition | No positional animation | These actions repeat hundreds of times daily |
| Reduced motion only disables selected existing transitions | Global mailbox motion override plus explicit instant state application | Guarantees every new pattern respects the setting |

## 4.5 Reduced motion, touch, and performance

```css
@media (prefers-reduced-motion: reduce) {
  .sheet, .composer, .menu, .recipient-suggestions, dialog, dialog::backdrop,
  .icon-btn, .text-btn, .ink-btn, .danger, .compose-dock {
    animation: none !important;
    transition-duration: .01ms !important;
    transition-delay: 0ms !important;
  }
}
```

- Reduced motion means no spatial movement, scaling, or parallax; state and text feedback remain.
- Gate hover behind `(hover: hover) and (pointer: fine)`.
- Do not apply `will-change` permanently. Use it only during an active panel transition if profiling proves it necessary.
- Do not animate inherited CSS variables on containers with many descendants.
- Use WAAPI only if the existing state-attribute CSS approach cannot support an interruptible gesture; no animation library is needed.

---

# 5. Implementation Checklist

## Phase 0 — Baseline and safeguards

Erledigt 2026-11-07. Aufnahmen und Tastaturfälle liegen in `docs/ui-ux-baseline/`. Die Oberfläche ist in diesem Stand unverändert.

- [x] Capture current mailbox screenshots at 375 px, 799 px, 800 px, 1279 px, 1280 px, and a wide desktop reader; capture light and dark.
- [x] Include states: empty list, unread/read, current, checked, flagged, thread count, long German labels, long subject/email, attachments, security notices, composer, menus, assistant sheet.
- [x] Record current keyboard flows and focus return as regression cases.
- [x] Confirm no layout/feature change is bundled into the polish work.

**Exit:** reproducible visual and interaction baseline.

## Phase 1 — Semantic tokens and typography (P0)

Erledigt 2026-11-07. `--text-faint` bleibt `--text-quiet`: 56 % Vordergrund liegt auf Hell bei 4.04:1, auf der Seitenleiste bei 3.98:1 und auf `--muted` bei 3.95:1. 68 % bleibt bei 5.98:1 hell und 8.67:1 dunkel.

- [x] Add spacing, state-surface, functional-shadow, type, and motion tokens in `shell.css`; keep `app-tokens.css` canonical.
- [x] Implement message-title, list-primary, metadata, and mono-label roles.
- [x] Verify composer body remains at least 16 px.
- [x] Measure all new quiet-text combinations in light/dark; retain `--text-quiet` wherever a faint token misses 4.5:1.
- [x] Add increased-contrast overrides.

**Exit:** token linter passes; normal text meets 4.5:1; no hard-coded component hex values.

## Phase 2 — State clarity and list rhythm (P0)

- [ ] Separate hover/current/checked surfaces.
- [ ] Add the 6 px ink unread marker and unread weight 600.
- [ ] Fix mobile unflagged icon contrast and preserve 44 px targets.
- [ ] Normalize toolbar gutters and message row spacing.
- [ ] Verify long subjects, previews, thread counts, marks, and 200% zoom.

**Exit:** all five message states remain distinguishable without relying on color alone; no layout shift on flag reveal.

## Phase 3 — Core component polish (P1)

- [ ] Sidebar: account chevron, aligned group/folder rows, current indicator, reserved folder-action space.
- [ ] Reader: title scale, reading container, notice alignment, attachment rhythm, single prominent Reply treatment.
- [ ] Composer: field focus, stable busy/upload rows, formatting target sizing, new `format-clear` icon.
- [ ] Search: leading icon, clear action, quick-filter icons, result status, active criteria summary.
- [ ] Menus/dialogs: consistent separators, elevation, and state styling.

**Exit:** all existing actions remain in the same responsive locations except explicitly listed icon additions and visual separators.

## Phase 4 — Unified motion lifecycle (P1)

- [ ] Introduce motion tokens and pressed states.
- [ ] Add interruptible menu/popover/dialog transitions.
- [ ] Split sheet/composer enter and exit curves and durations.
- [ ] Harden `openLayer`/`closeLayer` and composer transitions against cancellation and missing transition events.
- [ ] Skip animation for keyboard-initiated composer open and all high-frequency navigation.
- [ ] Apply comprehensive reduced-motion and touch-hover rules.

**Exit:** rapid open/close never strands a layer, focus always returns, keyboard workflows remain immediate, and no layout property is animated.

## Phase 5 — Feedback and accessibility (P0 before release)

- [ ] Keep refresh/search/save/send feedback inline and stable.
- [ ] Verify accessible names for every new icon-only control.
- [ ] Test keyboard-only menus, search clear, composer formatting, dialogs, and assistant sheet.
- [ ] Test screen-reader announcement of loading, result counts, errors, and save/send state without duplicate announcements.
- [ ] Test 200% text/zoom with no clipped primary action or unreachable overflow.
- [ ] Verify reduced motion, increased contrast, light, dark, and 375 px layouts.

**Exit:** no critical accessibility regression; errors explain the next action; routine operations do not trigger alerts.

## Phase 6 — Verification and delivery gates

- [ ] Run `npx tsc --noEmit` in `ui/`.
- [ ] Run `npm run build` in `ui/`.
- [ ] Run the Mistral token check on `ui/src` with layer `app` whenever styles change.
- [ ] Inspect the result in the Docker preview at `http://localhost:8888` using `test@example.com` / `test1234`; if no live mail server is available, label any visual check as a mock.
- [ ] Test pointer, touch emulation, keyboard-only, reduced motion, and both themes in the browser.
- [ ] Review motion at 4× slowdown for origin, interruption, and property synchronization.
- [ ] Commit only relevant sources and changed generated `static/` CSS/JS/fonts; keep unrelated files out.

**Exit:** source checks, build, token check, and browser review all pass.

## Release acceptance criteria

The polish is complete only when:

1. The interface is recognizably the same product and layout, but state hierarchy is clearer in a side-by-side comparison.
2. The reader subject and message measure feel editorial without compromising remote HTML mail.
3. Orange remains rare and meaningful; primary actions remain ink.
4. No meaningful text/icon falls below its contrast target.
5. Repeated keyboard workflows have no added delay or animation.
6. Menus and panels feel spatially connected, interruptible, and fast.
7. Every existing icon remains intact; only `format-clear` is added, with the other new placements reusing existing icons.
8. Mobile retains 44 px targets and safe-area behavior; desktop remains dense but not cramped.
9. Light, dark, reduced-motion, increased-contrast, 200% zoom, and 375 px checks pass.
10. Typecheck, build, token lint, and visible browser verification pass.

## Explicitly out of scope

- Reorganizing the three-pane shell or adding a fourth assistant column.
- A global command palette, new gesture system, or changed mail actions.
- New brand marks, Mistral logos, model icons, decorative pixel art, or marketing hero motion.
- Glassmorphism, gradient headlines, large-radius cards, pill CTAs, springs, bounce, or scroll reveals.
- Replacing the icon set or introducing an icon font/library.
- Changing the server API, assistant consent behavior, mail sanitization, or iframe sandbox.
