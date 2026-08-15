# Professional Redesign — Midnight Indigo Trading Desk

A full visual and structural rework of CryptoDesk into a disciplined institutional trading desk. No feature logic changes: every panel, scanner, signal and calculator keeps its current behavior.

## Locked design direction

- **Palette — Midnight Indigo**: `#0a0a1a` base, `#141432` surfaces, `#1e1e5a` elevated/borders, `#4f46e5` primary accent. Bull/bear stay semantic but retuned to emerald `#10b981` and rose `#f43f5e` so they read as data, not decoration.
- **Typography — Sora (headings/UI) + Manrope (body)**, JetBrains Mono kept strictly for numbers, prices and tickers.
- **Layout — Dashboard**: persistent left nav rail + top status bar + dense panel grid.

Neon-green glow, text-shadow, scanlines and pulsing effects are removed. Emphasis comes from hierarchy, spacing and one accent color.

## Structural changes

### App shell
- Replace the horizontal scrolling tab strip with a **left nav rail** (collapsible to icons, current section highlighted with an accent bar). Groups: Markets (Dashboard, Scanner, Spot, Futures), Intelligence (Signals, Smart Money, News, Square Posts), Risk (Pump/Dump, Unlocks), Personal (Journal).
- **Top bar** becomes a compact status strip: logo, global search entry, connection state, portfolio settings, alert bells. Ticker + favorites strip merge into one slim marquee line so vertical space goes to content.
- Content area gets its own scroll container so the shell never moves.

### Dashboard (`/`)
Move from one long stacked column to a real desk grid:

```text
┌──────────────────────────────────────────────────────────┐
│ market stats strip (cap, dominance, fear/greed, movers)  │
├───────────────────────────────┬──────────────────────────┤
│ chart + symbol header         │ RFD analysis             │
│ (dominant, 2/3 width)         │ signals summary          │
├───────────────────────────────┴──────────────────────────┤
│ Radar row: Reversal │ Crash Risk │ Suggested Trades      │
├──────────────────────────────────────────────────────────┤
│ Watchlist │ News Signals │ Top Movers │ AI Assistant     │
└──────────────────────────────────────────────────────────┘
```

- Section headers get a small label + rule instead of large H2s, so panels feel like desk modules.
- Panels get consistent internal rhythm: header row (title, meta, controls) / body / footer.
- Single-column stack on mobile, unchanged content.

### Panel and data language (applies to every tab)
- One `panel` treatment: 1px border, subtle inner top highlight, no heavy drop shadow.
- Tables: sticky headers, zebra-free rows with hover tint, right-aligned tabular numbers, consistent column widths.
- Badges/pills unified into a few variants (bull, bear, neutral, warn, accent) instead of the ad-hoc color combos currently written per component.
- Every number uses `tabular-nums`; percentages always signed.
- Consistent empty, loading (skeleton) and error states across scanners.

## Rollout across tabs

All tabs get the new shell, tokens, typography, panel/table/badge primitives, and tightened headers plus filter bars: Scanner, Spot, Futures, Signals, Smart Money, News, Square Posts, Pump/Dump, Unlocks, Journal. Existing search boxes, filters, expandable trade setups, position sizer and momentum labels keep working exactly as they do now.

## Technical notes

- Rewrite tokens in `src/index.css` (HSL only) and extend `tailwind.config.ts`: new indigo scale, retuned bull/bear/warning, new radius scale, `--shadow-panel`, removal of glow/neon utilities. Fonts swapped to Sora + Manrope in the Google Fonts import and `fontFamily`.
- New shared presentation components: `src/components/layout/SideNav.tsx`, `TopBar.tsx`, plus `src/components/ui/panel.tsx` (Panel/PanelHeader/PanelBody), `stat.tsx`, and a `Badge` variant set via `cva`.
- `AppLayout.tsx` restructured to shell + rail + scrollable outlet; `Index.tsx` restructured to the grid above.
- Per-tab edits are class/markup only — no changes to `src/lib/*`, hooks, or `supabase/functions/*`.
- Replace hardcoded EMA legend hexes in `CandleChart.tsx` with tokens; chart series colors read from the new palette. shadcn overlay `bg-black/80` values move to a token-based scrim.
- Verify with a typecheck and a Playwright pass over each route at desktop and mobile widths to catch overflow.
