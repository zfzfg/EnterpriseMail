# SnappyMail UI/UX Design Improvement Plan
**Visual Precision, Tactile Engineering & Accessibility Architecture**

---

## 1. Executive Summary & Design Vision

This document outlines a comprehensive, production-ready design improvement plan for the SnappyMail webmail interface. Grounded in the **Mistral Design Language** (monochrome warm paper/steel surfaces, 1px hairlines, disciplined orange accents, Space Mono labels, and 9×9 pixel iconography) and **Emil Kowalski’s Design Engineering Philosophy** (tactile responsiveness, unseen details compounding, origin-aware popovers, and asymmetric motion), this plan addresses current visual inconsistencies, interaction friction, responsive edge cases, and accessibility gaps.

### Guiding Principles
1. **European Laboratory Precision:** A calm, monochrome workspace structured by crisp 1px hairlines instead of heavy box-shadows. Color is strictly reserved for high-signal feedback (unread indicators, focus rings, and verified security states).
2. **Tactile Feedback on Every Platform:** Every pressable surface must communicate that it heard the user, on both pointer and touch devices, without latency or visual jarring.
3. **Zero Delay on High-Frequency Actions:** Actions invoked dozens or hundreds of times per day (keyboard navigation, message selection, folder switching) must execute with zero artificial animation delay.
4. **Accessible by Default:** Meeting WCAG 2.1 AA across contrast ratios, keyboard focus flows, touch target sizes, and screen reader live regions.

---

## 2. Design Tokens, Palette & Typography

### 2.1 Token Refinement: Warm Paper & Deep Steel
Currently, `app-tokens.css` relies on pure `#fff` (light mode) and `#101010` (dark mode). While functional, pure `#fff` feels clinical and can strain eyes during prolonged inbox triage, while Mistral's signature surface uses an ultra-subtle warm tint (`#fbfbf8`) for light surfaces and deep zinc/steel (`#111113`) for dark surfaces.

#### Proposed Token Adjustments (`ui/src/styles/app-tokens.css`):
```css
:root {
  /* Surface warmth: warm paper tone for light mode */
  --background: #fbfbf8;
  --card: #ffffff;
  --sidebar: #f5f4ef;
  --muted: #ebe9e0;
  --accent: #f0eee6;
  --foreground: #141416;
  
  /* Brand Signal Orange - reserved strictly for indicators, selection, focus ring */
  --primary: #fa5111;
  --primary-soft: #ff8205;
  --primary-soft-foreground: #141416;
  
  /* Hairline borders */
  --border: #e4e3de;
  --sidebar-border: #e0ded7;
  
  /* Radius discipline */
  --radius: 4px;
}

.dark, [data-theme="dark"] {
  --background: #111113;
  --card: #17171a;
  --sidebar: #151518;
  --muted: #1e1e22;
  --accent: #242429;
  --foreground: #f4f4f6;
  
  --border: #27272b;
  --sidebar-border: #232326;
  --input: #ffffff1f;
}
```

### 2.2 Border Radius Discipline
Currently, the codebase mixes multiple radius expressions:
- `var(--radius)` (4px)
- `calc(var(--radius) - 2px)` (2px)
- `calc(var(--radius) - 4px)` (0px)
- Ad-hoc utility classes (`rounded-md`, `rounded-xl`, `border-radius: 0`)

**Standardization Rule:**
- **Zero Radius (`0px`):** All major structural boundaries, panels, cards, list rows, and table cells.
- **Micro Radius (`2px`):** Tags, recipient chips, badges, and code blocks (`calc(var(--radius) - 2px)`).
- **Control Radius (`4px`):** Buttons, search inputs, dialog windows, and popover menus (`var(--radius)`).

### 2.3 Typography Scale & Hierarchy
- **Display & H1:** `font-family: var(--font-sans); font-weight: 500; letter-spacing: -0.02em; line-height: 1.05;`
- **H2 & Section Titles:** `font-family: var(--font-sans); font-weight: 500; letter-spacing: -0.01em; line-height: 1.2;`
- **Technical/Meta Labels:** `font-family: var(--font-mono); font-size: 11px; font-weight: 400; text-transform: uppercase; letter-spacing: 0.02em;`
- **Body & Message View:** `font-family: var(--font-sans); font-size: 14px; line-height: 1.5;` (Desktop 13px/18px is crisp, but email preview snippets need careful contrast).

---

## 3. Emil Kowalski UI Engineering Review: Before vs. After

Below is the required component-level audit evaluating interactions, animations, and visual craft:

| Before | After | Why |
| :--- | :--- | :--- |
| `:active { transform: scale(.97); }` scoped only inside `@media (hover: hover) and (pointer: fine)` | Apply `:active { transform: scale(0.97); }` globally to all pressable buttons and rows with `-webkit-tap-highlight-color: transparent` | Touchscreens need tactile press feedback most; restricting scale feedback to fine mouse pointers leaves mobile/tablet taps feeling lifeless. |
| `.menu:not([hidden]) { transform-origin: top left; }` and `.menu-right { transform-origin: top right; }` | Dynamic or bottom-aware transform origin: `.menu[data-anchor="bottom"] { transform-origin: bottom left; }` or CSS variable `--transform-origin` | Bottom-docked menus (e.g. `#book-add .menu`) currently animate from `top left` downwards despite opening above the button, defying spatial physics. |
| Native HTML `title="..."` attributes for icon buttons | Custom instant micro-tooltips (`data-tooltip`) with 150ms delay on first hover and **0ms delay on subsequent sibling hovers** | Browser `title` tooltips delay 700ms–1s, look clunky, and cannot skip delay when scanning across toolbar icon buttons. |
| `.msg-row:hover { background: var(--surface-hover); }` changes background abruptly without hover duration limits | `transition: background-color 120ms var(--ease-standard);` | Gentle color transitions feel intentional rather than flash-rendering as the mouse moves over a dense list. |
| Keyboard navigation (`J`/`K`) toggles selection with DOM focus scroll jumps | Use `scrollIntoView({ block: "nearest", behavior: "smooth" })` and keep row state update instantaneous (0ms animation) | Rapid keyboard navigation must feel instant like Raycast/Superhuman, while keeping items cleanly within the viewport. |
| `transform: scale(0.98)` on dialog open | `transform: scale(0.96); opacity: 0` entering to `scale(1); opacity: 1` over 180ms `cubic-bezier(0.23, 1, 0.32, 1)` | Slightly deeper starting scale gives clear physical entry momentum without appearing to explode from nothing. |
| Symmetric dialog close / open animations | Asymmetric timing: Open at 180ms ease-out; Close at 120ms ease-out | The user has already made their decision when closing; dismissals must get out of the way faster than arrivals. |
| `.splitter` has invisible hit area on desktop except for a 1px border line | 12px hit zone with centered 1px line, visual highlight (`--primary`) on drag or `:hover`, and smooth grip dots | Makes the pane resize handle immediately discoverable and satisfying to drag. |
| Message snippet text (`.msg .peek`) is font-size 14px on mobile, competing with subject | Set `.msg .peek` to 13px with `color: var(--text-quiet); line-clamp: 2` | Creates distinct optical hierarchy between Who (Bold/Semi-bold), Subject (Regular 14px), and Peek (Faint 13px). |
| Hardcoded hex values in `ui/src/letter.ts` (`#1c1917`, `#27272a33`, `#fff`) | Use semantic CSS tokens `--foreground`, `--border`, `--background` | Prevents style drift in print preview, iframe sandboxing, and token linter warnings. |
| Dropdown menus (`.menu`) lack backdrop dismiss on touch devices | Add lightweight dismiss scrim or pointerdown outside listener | Prevents accidental clicks beneath an open popover on mobile/tablets. |

---

## 4. Layout & Structural Panes

```
┌─────────────────┬───────────────────────────┬─┬──────────────────────────────────────────┐
│ FOLDERS (256px) │ MESSAGE LIST (384px)      │S│ READER PANE (1fr)                        │
├─────────────────┼───────────────────────────┤P├──────────────────────────────────────────┤
│ account@dom.com │ [Search field          🔍]│L│ Reply  Forward  Archive  Delete   ••• [⚙]│
│                 │ [All] [Unread] [Flagged]  │I│──────────────────────────────────────────│
│ 📥 Inbox     42 │ ───────────────────────── │T│ Meeting Agenda & Mistral Review        ⭐│
│ 📤 Sent         │ • Alice Corp   10:45 AM   │T│ From: Alice <alice@corp.com>     10:45 AM│
│ 📝 Drafts     1 │   Q4 Design System Update │E│ To: Dev Team <dev@corp.com>              │
│ 🗑 Trash        │   Here are the revised to…│R│ Tags: [PROD] [DESIGN]                    │
│                 │ ───────────────────────── │ │──────────────────────────────────────────│
│ ────────────────│   Bob Smith    Yesterday  │ │ Sandboxed Letter Body (CSP Protected)    │
│ 👤 Contacts     │   Invoice #1042           │ │                                          │
│ ⚙ Settings      │   Attached please find th…│ │                                          │
└─────────────────┴───────────────────────────┴─┴──────────────────────────────────────────┘
```

### 4.1 The Splitter & 3-Pane Architecture
1. **Visual Grip Cue:**
   - The current `.splitter` is 12px wide with transparent background and an optional pseudo-line.
   - **Enhancement:** Add an intentional center hairline with a subtle vertical dot grip indicator on hover/drag:
     ```css
     .splitter {
       position: relative;
       width: 12px;
       cursor: col-resize;
       background: transparent;
       transition: background-color 150ms var(--ease);
     }
     .splitter::before {
       content: "";
       position: absolute;
       inset: 0 auto 0 5px;
       width: 1px;
       background: var(--border);
       transition: background-color 150ms var(--ease), width 150ms var(--ease);
     }
     .splitter:hover::before,
     .splitter.dragging::before {
       background: var(--primary);
       width: 2px;
     }
     ```
2. **Keyboard Sizing Support:**
   - Implement `keydown` on the splitter (`ArrowLeft`, `ArrowRight`, `Home`, `End`) updating `--list-w` with `aria-valuenow` announcements for screen readers.

### 4.2 Mobile & Tablet Layout Adaptations
1. **Breakpoint Polish (800px - 1280px):**
   - On viewports between 800px and 1279px, the sidebar is a slide-over drawer with a backdrop scrim. Ensure the drawer entrance uses an iOS-style spring drawer curve:
     `--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1); transition: transform 240ms var(--ease-drawer);`
2. **Coarse Pointer Hit Targets:**
   - On tablet devices (e.g. iPad Pro at 1024px width), `--hit` currently collapses to `28px` because `min-width: 800px` is active.
   - **Fix:** Separate pointer accuracy from viewport width:
     ```css
     @media (pointer: coarse) {
       :root {
         --hit: 44px;
         --row: 44px;
       }
     }
     ```
3. **Safe Area Inset Handling:**
   - Add `padding-top: env(safe-area-inset-top)` to the main shell and composer bar to prevent clipping under smartphone notches and dynamic islands.

---

## 5. Detailed Component Improvements

### 5.1 Message List & Message Rows (`.msg-row`)
The email list is the highest-volume viewport in the entire product.

1. **Unread Indicator:**
   - Replace the current raw square with a crisp 6px ink square (or signal orange for "reply required"):
     ```css
     .unread-mark {
       width: 6px;
       height: 6px;
       background: var(--foreground);
       border-radius: 1px;
     }
     .unread-mark[data-action-needed="true"] {
       background: var(--primary);
     }
     ```
2. **Row Hover & Active States:**
   - Active row selection: `box-shadow: inset 2px 0 0 var(--foreground); background: var(--surface-selected);`
   - Active row during drag or multiple check: maintain consistent visual hierarchy.
3. **Floating Quick Actions on Hover:**
   - Currently, `.msg-flag` appears on hover, but archive and delete require opening or selecting.
   - **Improvement:** Expose a compact 3-icon hover cluster on desktop (`Delete`, `Archive`, `Flag`) positioned at `right: 8px; top: 50%; transform: translateY(-50%)` to allow single-click triage directly from the list.

### 5.2 Email Reader Pane (`.reader`)
1. **Header Layout & Security Badges:**
   - The security bar (`.head-details`) should render cryptographic authentication status (DKIM / SPF / DMARC / PGP / S-MIME) with compact, crisp badges:
     ```html
     <span class="badge-sec badge-sec--ok" title="SPF & DKIM valid">
       <svg class="icon">...</svg> Verifiziert
     </span>
     ```
   - Color logic: Subtle muted border with green tint for verified, amber for partial, red for failed.
2. **External Images Banner:**
   - The "External images blocked" notice should be an integrated 1px hairline bar directly above the message content with two instant actions: `[Show Images]` and `[Always allow for sender]`.
3. **Iframe Scroll & Height Sync:**
   - Ensure the sandboxed iframe dynamically synchronizes height via `ResizeObserver` with smooth document loading so there is no content jump or nested secondary scrollbar.

### 5.3 Email Composer (`Composer.ts`)
1. **Recipient Chips:**
   - Recipient chips must support keyboard arrow navigation (`ArrowLeft`, `ArrowRight`, `Backspace` to edit/delete).
   - Invalid email addresses should display an immediate red dashed hairline underline and inline error tooltip rather than failing silently on send.
2. **Formatting Toolbar:**
   - Clean up toolbar button grouping with vertical 1px divider lines.
   - Make the active state of bold/italic/quote buttons reflect the current text cursor selection in `contenteditable`.
3. **Docked Draft Minimizer:**
   - The `.compose-dock` button in the bottom right needs a subtle spring entrance (`scale(0.95)` to `scale(1)`):
     ```css
     .compose-dock:not([hidden]) {
       animation: dock-enter 160ms var(--ease-out);
     }
     @keyframes dock-enter {
       from { transform: translateY(12px) scale(0.95); opacity: 0; }
       to { transform: none; opacity: 1; }
     }
     ```

### 5.4 Contacts & Address Book (`contacts.ts`)
1. **Two-Column Master-Detail Layout:**
   - Enhance the contact card header with an elegant monochromatic avatar circle containing the contact's initials in Space Mono (`font-family: var(--font-mono); font-size: 16px; background: var(--secondary); color: var(--secondary-foreground)`).
2. **Dynamic JCard Property Editors:**
   - Align inputs with clear monospace field labels (`TEL`, `EMAIL`, `ADR`, `NOTE`) honoring the technical aesthetic.

### 5.5 Settings & Admin Interface (`settings.ts`, `admin.ts`)
1. **Sticky Header & Section Navigation:**
   - Ensure `.settings-sticky` blends seamlessly into dialog background with a crisp bottom hairline.
2. **Form Input Grouping:**
   - Form fields should be structured as clean 2-column key-value rows (`.cfg th`, `.cfg td`) with inline input validation feedback.

---

## 6. Micro-Interactions, Motion & Animation System

### 6.1 Standardized Timing & Easings
```css
:root {
  /* Fast feedback (button active, toggle, chips) */
  --duration-press: 100ms;
  --duration-fast: 150ms;
  
  /* Popovers, menus, tooltips */
  --duration-menu: 160ms;
  
  /* Dialogs, sheets, drawers */
  --duration-dialog: 180ms;
  --duration-panel: 240ms;

  /* Custom punchy easings (Emil Kowalski / Mistral) */
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
}
```

### 6.2 Instant Tooltip System (Skip-Delay Choreography)
Standard browser tooltips feel disconnected and sluggish. A lightweight tooltip micro-component will be implemented:
1. **First Hover:** Delays 300ms before appearing (`scale(0.96) -> scale(1)`, `opacity: 0 -> 1` over 120ms).
2. **Subsequent Hover over Sibling Buttons:** While tooltip state is warm (within 400ms of leaving a button), adjacent tooltips appear **instantly (0ms delay)**.
3. **Esc Key:** Immediately hides active tooltip.

### 6.3 List Item Stagger Entrance
When switching folders or completing a search, the first 8 items in `#rows` animate in with a 25ms staggered delay:
```css
.msg-row {
  animation: row-in 160ms var(--ease-out) both;
}
.msg-row:nth-child(1) { animation-delay: 0ms; }
.msg-row:nth-child(2) { animation-delay: 25ms; }
.msg-row:nth-child(3) { animation-delay: 50ms; }
.msg-row:nth-child(4) { animation-delay: 75ms; }
.msg-row:nth-child(5) { animation-delay: 100ms; }
```
*(Automatically disabled when `prefers-reduced-motion: reduce` is detected).*

---

## 7. Accessibility (WCAG 2.1 AA) & Inclusive Design

### 7.1 Color Contrast Compliance
- **Text:** Ensure all primary text maintains ≥ 7:1 contrast on light and dark backgrounds.
- **Secondary Text (`--text-quiet`):** Must maintain ≥ 4.5:1 against both `--background` and `--sidebar` background.
- **Primary Signal Orange (`--primary`):** Only used for UI graphics/indicators (≥ 3:1 required for non-text UI components) and selection; never used as small body text on light backgrounds.

### 7.2 Focus Visibility & Keyboard Trap
- All interactive controls receive a prominent 2px focus ring:
  ```css
  :focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  ```
- Popover menus (`.menu`) and dropdowns must trap focus or properly handle `ArrowUp`/`ArrowDown`/`Escape` navigation, returning focus to the trigger button upon close.

### 7.3 Screen Reader Live Announcements
Ensure the following elements have explicit ARIA live regions:
- `#list-status`: `aria-live="polite"` for search counts and sync updates.
- `#notice`: `aria-live="polite"` for toast notices.
- `#send-error` / `.error`: `role="alert"` for form errors.

---

## 8. Implementation Roadmap

The execution is divided into five logical, testable phases:

### Phase 1: Token Cleanliness & Typography (Days 1–2)
- [ ] Replace raw hex values in `ui/src/letter.ts` with semantic tokens (`var(--foreground)`, `var(--border)`, etc.).
- [ ] Refine `--background` and `--sidebar` tokens in `app-tokens.css` with Mistral warm paper/steel tones.
- [ ] Normalize border radius rules to the 0px / 2px / 4px hierarchy.
- [ ] Run `python scripts/check_tokens.py ui/src --layer app` to achieve 0 warnings.

### Phase 2: Tactile Feedback & Motion Physics (Days 3–4)
- [ ] Move `:active { transform: scale(0.97); }` out of fine-pointer media query to enable universal touch response.
- [ ] Fix menu transform-origin bug for bottom-docked menus (`#book-add .menu`).
- [ ] Implement asymmetric dialog animation (180ms open, 120ms close).
- [ ] Verify `prefers-reduced-motion` suppresses all transitions and transforms.

### Phase 3: Component Polish & Empty States (Days 5–6)
- [ ] Redesign `#reader-empty` and `#list-empty` with clear typography, pixel art icons, and shortcut hints.
- [ ] Add 3-icon quick action cluster (`Delete`, `Archive`, `Flag`) on message row hover.
- [ ] Style email security badges (SPF, DKIM, DMARC, PGP, S/MIME) in reader header.
- [ ] Enhance Splitter handle with hover state and keyboard arrow resizing.

### Phase 4: Touch, Tablet & Mobile Edge-to-Edge (Days 7–8)
- [ ] Enforce `--hit: 44px` on coarse pointer devices regardless of screen width.
- [ ] Support `safe-area-inset-top` and `safe-area-inset-bottom`.
- [ ] Optimize drawer backdrop touch-dismiss.

### Phase 5: Verification & Testing (Days 9–10)
- [ ] Run `npm run typecheck` (`tsc --noEmit`).
- [ ] Run `npm run build` (esbuild + tailwindcss v4).
- [ ] Full screen-reader walkthrough (NVDA/VoiceOver) testing live regions and shortcuts.
- [ ] Visual verification in light and dark mode at 375px, 768px, 1024px, and 1440px widths.
