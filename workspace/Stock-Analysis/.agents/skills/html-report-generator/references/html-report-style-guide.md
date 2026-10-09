# HTML Report Style Guide

When generating self-contained HTML reports, design for mobile first. Desktop only needs a centered single-column reading experience.

## 0. Adaptive Theme

Reports must adapt to the user's system light/dark preference. Do not hard-code a dark-only theme.

Use CSS variables for all page, card, border, and text colors. Define the light theme in `:root`, then override only the variables inside `@media (prefers-color-scheme: dark)`.

```css
:root {
  color-scheme: light dark;

  --page-bg: #f8fafc;
  --surface: #ffffff;
  --surface-muted: #f1f5f9;
  --border: #d8e0ea;
  --text: #0f172a;
  --text-muted: #475569;
  --text-soft: #64748b;
  --text-bright: #020617;
  --shadow: 0 10px 28px rgba(15, 23, 42, 0.08);

  --accent-blue: #2563eb;
  --accent-blue-bg: rgba(37, 99, 235, 0.10);
  --accent-tech: #7c3aed;
  --accent-tech-bg: rgba(124, 58, 237, 0.10);
  --accent-ai: #0891b2;
  --accent-ai-bg: rgba(8, 145, 178, 0.10);
  --accent-econ: #ea580c;
  --accent-econ-bg: rgba(234, 88, 12, 0.10);

  --tag-en-bg: rgba(37, 99, 235, 0.12);
  --tag-en-text: #2563eb;
  --tag-cn-bg: rgba(234, 88, 12, 0.12);
  --tag-cn-text: #c2410c;
}

@media (prefers-color-scheme: dark) {
  :root {
    --page-bg: #0d1117;
    --surface: #161b22;
    --surface-muted: rgba(255, 255, 255, 0.03);
    --border: #30363d;
    --text: #e6edf3;
    --text-muted: #8b949e;
    --text-soft: #6e7681;
    --text-bright: #ffffff;
    --shadow: none;

    --accent-blue: #58a6ff;
    --accent-blue-bg: rgba(88, 166, 255, 0.12);
    --accent-tech: #a78bfa;
    --accent-tech-bg: rgba(167, 139, 250, 0.12);
    --accent-ai: #22d3ee;
    --accent-ai-bg: rgba(34, 211, 238, 0.12);
    --accent-econ: #fb923c;
    --accent-econ-bg: rgba(251, 146, 60, 0.12);

    --tag-en-bg: rgba(88, 166, 255, 0.15);
    --tag-en-text: #58a6ff;
    --tag-cn-bg: rgba(251, 146, 60, 0.15);
    --tag-cn-text: #fb923c;
  }
}

body {
  background: var(--page-bg);
  color: var(--text);
}

.card,
.section {
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
}

h1,
h2,
h3,
.bright {
  color: var(--text-bright);
}

.muted,
.meta,
.footer {
  color: var(--text-muted);
}
```

Apply these tokens consistently. Avoid one-off colors like `background: #0d1117` or `color: #e6edf3` in component rules unless the value is part of a semantic token. Task files must reference this guide instead of redefining the shared theme variables.

## 1. Layout

- Phone width is the primary target
- Desktop only needs a centered content column
- Do not build full-width desktop dashboards
- Keep only one horizontal gutter layer

```css
html {
  overflow-x: hidden;
}

body {
  margin: 0;
  padding: 12px;
  min-height: 100vh;
  overflow-x: hidden;
}

.container {
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
  padding: 0;
}

@media (min-width: 769px) {
  body {
    padding: 24px;
  }
}

@media (max-width: 420px) {
  body {
    padding: 10px;
  }
}
```

Avoid double gutters on mobile (`body` padding plus `.container` padding).

## 2. Financial Colors

For Chinese financial reports:

- Rise / positive change = red
- Fall / negative change = green

```css
:root {
  --rise: #ff5252;
  --rise-bg: rgba(255,82,82,0.12);
  --fall: #00c853;
  --fall-bg: rgba(0,200,83,0.12);
}

.up,
.price-up {
  color: var(--rise);
}

.down,
.price-down {
  color: var(--fall);
}

.change.up {
  color: var(--rise);
  background: var(--rise-bg);
}

.change.down {
  color: var(--fall);
  background: var(--fall-bg);
}
```

If a color means alert or risk rather than price movement, use separate names such as `--danger` or `--warning`.

## 3. Tables

Any table that may exceed phone width must be wrapped in a scroll container.

```css
.table-scroll {
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  margin: 16px 0;
  border-radius: 6px;
  overscroll-behavior-x: contain;
  min-width: 0;
}

.table-scroll table {
  min-width: 600px;
  width: 100%;
  border-collapse: collapse;
  white-space: nowrap;
}

.table-scroll th,
.table-scroll td {
  white-space: nowrap;
}
```

```html
<div class="table-scroll">
  <table>
    <!-- ... -->
  </table>
</div>
```

For compact three-column target tables, allow wrapping on mobile:

```css
@media (max-width: 768px) {
  .target-table {
    table-layout: fixed;
  }

  .target-table th,
  .target-table td {
    white-space: normal;
    overflow-wrap: anywhere;
  }
}
```

## 4. Single-Column Cards

Keep cards in one column across all screen sizes so the reading order stays stable.

```css
.card-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
  width: 100%;
}

.card,
.section,
.table-scroll {
  min-width: 0;
}
```

## 5. Mobile Components

Use compact, wrap-safe components.

```css
.header {
  text-align: left;
  padding: 28px 0 22px;
  margin-bottom: 22px;
}

.header h1 {
  font-size: 1.55rem;
  line-height: 1.25;
}

.header .sub,
.analysis-block,
.news-list li,
.card-header h3,
.card-header .code,
.indicator-grid .label,
.indicator-grid .value {
  overflow-wrap: anywhere;
}

.summary-bar {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
}

.summary-chip {
  justify-content: center;
  min-width: 112px;
  padding: 8px 14px;
}

.card {
  padding: 16px;
  border-radius: 10px;
}

.card-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
}

.card-header > div,
.card,
.indicator-grid .label,
.indicator-grid .value,
.score-bars {
  min-width: 0;
}

.signal-badge {
  white-space: nowrap;
}

.score-row {
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
}

.indicator-grid {
  grid-template-columns: minmax(86px, 0.85fr) minmax(0, 1.15fr);
  gap: 6px 10px;
  align-items: start;
}

.indicator-grid .value {
  text-align: right;
}

@media (min-width: 769px) {
  .card {
    padding: 18px;
  }
}

@media (max-width: 420px) {
  .card-header {
    grid-template-columns: 1fr;
  }

  .signal-badge {
    justify-self: start;
  }

  .score-row {
    grid-template-columns: 1fr;
  }

  .score-ring {
    margin: 0 auto;
  }

  .indicator-grid {
    grid-template-columns: minmax(78px, 0.8fr) minmax(0, 1.2fr);
  }
}
```

## 6. Summary

| Rule | Do | Don't |
|------|-----|------|
| Layout target | Design for phones first | Start from a wide desktop dashboard |
| Desktop | Center a single-column container | Fill the whole screen with multi-column panels |
| Colors | `.up` red, `.down` green | `.up` green, `.down` red |
| Tables | Wrap wide tables in `.table-scroll` | Use raw wide tables |
| Gutters | Keep one gutter layer | Stack body and container side padding |
| Cards | Keep one-column card flow | Build desktop card walls |
