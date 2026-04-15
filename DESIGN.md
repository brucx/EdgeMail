# EdgeMail Design System — Architectural Trust

## Creative Direction

The interface follows an **editorial precision** philosophy — depth through tonal layering, not borders. The aesthetic draws from high-end physical environments: clean surfaces, breathing room, and intentional typography hierarchy.

## Color Palette

### Primary: Deep Navy

| Token              | Value       | Usage                          |
|--------------------|-------------|--------------------------------|
| `--primary`        | `#003354`   | CTAs, brand, active nav        |
| `--primary-container` | `#004a77` | Gradient endpoints             |
| `--surface-tint`   | `#296290`   | Subtle icon accents            |
| `--ring`           | `#296290`   | Focus indicators               |

### Surface Hierarchy (Tonal Layering)

| Token                         | Value       | Usage                          |
|-------------------------------|-------------|--------------------------------|
| `--background`                | `#f7f9fb`   | Base layer (root)              |
| `--accent` / Surface Low      | `#f2f4f6`   | Sidebar, content canvas        |
| `--muted` / Surface Container | `#eceef0`   | Hover states, grouping         |
| `--input` / Surface High      | `#e6e8ea`   | Input backgrounds, search      |
| `--card` / Surface Lowest     | `#ffffff`   | Elevated content cards         |

**Rule**: Define areas by shifting background tone, not by drawing borders. White cards sit on `#f2f4f6` canvas — the delta creates a natural "soft lift."

### Text & Outline

| Token                | Value       | Usage                          |
|----------------------|-------------|--------------------------------|
| `--foreground`       | `#191c1e`   | Primary text (never `#000`)    |
| `--muted-foreground` | `#586675`   | Secondary text, labels         |
| `--outline`          | `#727880`   | Placeholder, timestamps        |
| `--outline-variant`  | `#c1c7d0`   | Ghost borders (15% opacity)    |

### Status

| Token           | Value       | Usage                          |
|-----------------|-------------|--------------------------------|
| `--destructive` | `#ba1a1a`   | Errors — balanced, not panic   |
| Emerald 600     | `#059669`   | Active, verified, success      |
| Amber 600       | `#d97706`   | Pending, warning               |

## Typography

| Role      | Font     | Weight     | Usage                          |
|-----------|----------|------------|--------------------------------|
| Headline  | Manrope  | 700–800    | Page titles, brand, modal headers |
| Body      | Inter    | 400–600    | All body text, labels, metadata |

**Hierarchy rule**: Skip a size between levels for editorial contrast. Pair `text-2xl font-extrabold` headlines with `text-sm` body text.

## Component Patterns

### Inputs — Bottom-Stroke Style
```
bg-[--input] border-b-2 border-[--outline-variant] rounded-t-lg
Focus: border-[--primary] bg-[--card]
```
Never use 4-sided bordered inputs. The bottom-stroke focuses attention without creating a "boxed-in" feel.

### Buttons

- **Primary**: `gradient-primary` (135deg from `--primary` to `--primary-container`), white text, `rounded-xl`, ambient shadow on hover
- **Secondary/Ghost**: No background, `text-[--muted-foreground]`, hover `bg-[--accent]`
- **Destructive actions**: Icon-only, hover `bg-destructive/10`

### Cards & List Items

- Cards: `bg-[--card] rounded-2xl` on `bg-[--accent]` canvas. **No borders.**
- List items: No dividers between rows. Use hover `bg-[--accent]` to indicate interactivity.
- Empty states: Centered icon + headline in card container.

### Modals — Glass Panel
```
bg: rgba(255,255,255,0.75)
backdrop-filter: blur(24px)
rounded-2xl
shadow: 0 32px 64px -12px rgba(25,28,30,0.06)
```
Overlay: `bg-black/40 backdrop-blur-sm`.

### Sidebar Navigation

- **Primary Nav** Background: `--accent` (`#f2f4f6`), no right border. Active item uses `bg-[--card]` (white) + `shadow-sm` + `text-[--primary]`.
- **Sub-nav / Internal Panels**: Use flush layouts with subtle highlights (`bg-[--primary]/[0.08] text-[--primary]`) for the active item. Avoid making the active sub-nav item a white card if it's placed next to a white main area, preventing a visually disjointed layout.
- Inactive: `text-[--muted-foreground]`, micro-interaction via `hover:translate-x-0.5` or `hover:bg-[--accent]`.

### Top Headers & Search

- **Flowing Backgrounds**: Top headers should inherit the page's base canvas background (`bg-[--accent]`), rather than drawing a stark white strip across the top.
- **Floating Controls**: Elevate search inputs within the header as floating pills (`bg-[--card] shadow-sm rounded-xl`) so they pop cleanly against the grey canvas.

## Layout Rules

1. **Tonal canvas**: Page content areas use `bg-[--accent]`. Content cards use `bg-[--card]`.
2. **Unified Cards (Multi-column)**: When creating side-by-side structures (e.g., mailboxes list + message list), wrap both within a *single* `bg-[--card] rounded-2xl shadow-sm border border-[--border]/60` container. Separate internal sections with a soft `border-r border-[--border]/60`. Avoid placing adjacent white cards with empty gaps.
3. **Breathing room**: Generous `px-8 py-6` page padding. `space-y-3` between standalone cards.
4. **Minimal borders**: Only use borders (`border-[--border]/60`) for essential subtle compartmentalization. Rely on tonal contrast instead of sharp outlines.
5. **Shadows**: Use sparingly. `shadow-sm` for unified cards/search pills; `shadow-ambient` only for modals/dropdowns.

## Do / Don't

- **Do** use `--foreground` (`#191c1e`) for text — never `#000000`
- **Do** use `--outline-variant` at 15% opacity if a border is unavoidable
- **Do** use `gradient-primary` for the main CTA per page
- **Don't** use `border border-[...]` on content cards — rely on background contrast
- **Don't** use standard drop shadows on cards — use tonal layering
- **Don't** use high-saturation colors for errors — use the balanced `--destructive` token
