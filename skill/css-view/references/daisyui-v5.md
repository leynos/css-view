# Debugging DaisyUI v5 + Tailwind v4 with `css-view` and `jq`

## How DaisyUI v5 Complicates the Computed Style Picture

DaisyUI v5 is a component library built on Tailwind CSS v4. It provides
semantic class names (`btn`, `card`, `modal`) that expand into multiple
CSS declarations under the hood. The key debugging challenge: the
relationship between the class you wrote and the computed style you see
is mediated by three abstraction layers.

1. **DaisyUI component classes** → resolve to CSS rulesets that reference
   DaisyUI theme variables.
2. **DaisyUI theme variables** → CSS custom properties scoped to
   `[data-theme]` selectors or `:root`.
3. **Tailwind v4 design tokens** → lower-level `--color-*`, `--spacing-*`
   custom properties defined by `@theme`.

When a `btn-primary` button renders in the wrong colour, the fault could
lie in any of these three layers. `css-view` collapses all three into
the single truth of computed values, and `jq` lets you trace backward
through the custom property chain.

## DaisyUI v5's Custom Property Namespace

DaisyUI v5 defines theme colours as CSS custom properties. The naming
convention changed from v4; here are the key property families:

| Purpose            | Custom property pattern          | Example value              |
|--------------------|----------------------------------|----------------------------|
| Base backgrounds   | `--color-base-100/200/300`       | `oklch(1 0 0)`             |
| Base content       | `--color-base-content`           | `oklch(0.2 0.02 240)`      |
| Primary            | `--color-primary`                | `oklch(0.55 0.2 260)`      |
| Primary content    | `--color-primary-content`        | `oklch(0.98 0 0)`          |
| Secondary          | `--color-secondary`              | `oklch(0.65 0.15 310)`     |
| Accent             | `--color-accent`                 | `oklch(0.75 0.15 180)`     |
| Neutral            | `--color-neutral`                | `oklch(0.25 0.02 260)`     |
| Info/Success/etc.  | `--color-info`, `--color-success`| `oklch(0.7 0.15 220)`      |
| Border radius      | `--radius-btn`, `--radius-box`   | `0.5rem`                   |
| Animations         | `--animation-btn`                | `0.25s`                    |

These are set on `[data-theme="<name>"]` selectors. The active theme
depends on the `data-theme` attribute on `<html>` or a container
element. `css-view`'s walker mode captures these in `styleDiff` at the
element where they are defined — typically the `<html>` node.

## Investigation: `btn-primary` Renders in the Wrong Colour

**Scenario:** You applied `btn btn-primary` to a `<button>`. It should
be a vivid blue, but it appears as a muted grey-blue.

### Step 1: Find the Button and Inspect Its Computed Background

```bash
css-view http://localhost:5173 -o snapshot.json

jq '.payload.tree | recurse(.children[]) |
    select(.classes | index("btn-primary")) |
    {tag, classes, bg: .styleDiff["background-color"],
     color: .styleDiff.color}' snapshot.json
```

Example output:

```json
{
  "tag": "button",
  "classes": ["btn", "btn-primary"],
  "bg": "oklch(0.45 0.12 260)",
  "color": "oklch(0.98 0 0)"
}
```

The `background-color` value is the computed result after the cascade.
If it does not match your theme's intended primary colour, the issue is
upstream — in the theme variable definition.

### Step 2: Check the Theme Variable at the Root

```bash
jq '.payload.tree.styleDiff["--color-primary"] // "not set at root"' snapshot.json
```

If this returns the expected colour, the variable is correct and the
issue lies in how `btn-primary` consumes it. If it returns an unexpected
value (or `"not set at root"`), the theme is not applying correctly.

### Step 3: Verify the Active Theme

DaisyUI scopes themes via `data-theme`. Check what the `<html>` element
declares:

```bash
# Walker mode does not directly expose data attributes, but the html
# node's classes and id are available. For data-theme, use CDP mode:
css-view http://localhost:5173 --mode cdp | \
  jq '.payload.nodes[] |
      select(.tagName == "html") |
      .attributes["data-theme"]'
```

If the output is `null` or an unexpected theme name, DaisyUI falls back
to its default theme — which may define `--color-primary` differently
from your intended theme.

### Step 4: Compare Theme Variables Across Themes

Capture two snapshots with different `data-theme` values (this requires
either manipulating the DOM before capture or having two versions of the
page):

```bash
diff <(jq '.payload.tree.styleDiff | to_entries[] |
        select(.key | startswith("--color-"))' light.json) \
     <(jq '.payload.tree.styleDiff | to_entries[] |
        select(.key | startswith("--color-"))' dark.json)
```

This produces a complete diff of every colour token between the two
themes, revealing any that failed to update.

## Investigation: Tailwind Utility Overriding DaisyUI Component Style

**Scenario:** You applied `bg-red-500` alongside `btn btn-primary`,
expecting the red background to win. Instead, the primary colour
persists.

This is a specificity and layer question. DaisyUI v5 places its
component styles in `@layer components` (which Tailwind v4 orders below
`@layer utilities`). In theory, `bg-red-500` in the utilities layer
should win. If it does not, something else is at play.

### Diagnose

```bash
jq '.payload.tree | recurse(.children[]) |
    select((.classes | index("btn-primary")) and
           (.classes | index("bg-red-500"))) |
    {classes, bg: .styleDiff["background-color"]}' snapshot.json
```

If `background-color` is the primary colour and not red, check whether
DaisyUI's rule uses `!important` or is defined outside of `@layer`.

### Check for `!important` (CDP Mode)

Walker mode does not distinguish `!important` — it only shows the
computed winner. If you need to know whether `!important` was involved,
inspect the stylesheet source separately. `css-view` tells you *what*
won; the source tells you *why*.

This is an important principle: `css-view` + `jq` diagnoses *what the
browser computed*, which narrows the search space. The final "why" often
requires cross-referencing with the CSS source — but now you know exactly
which property on which element to investigate, rather than guessing.

## Investigation: Theme Switching Leaves Stale Variables

**Scenario:** Your app uses a theme switcher that sets `data-theme` on
`<html>`. After switching from "corporate" to "night", some components
still show corporate colours.

### Step 1: Capture After Theme Switch

Use `--headful` and manually trigger the theme switch before the capture
completes, or use a URL parameter / cookie that your app respects:

```bash
css-view "http://localhost:5173?theme=night" -o night.json
css-view "http://localhost:5173?theme=corporate" -o corporate.json
```

### Step 2: Diff All Theme Variables

```bash
diff <(jq '[.payload.tree | recurse(.children[]) |
            .styleDiff | to_entries[] |
            select(.key | startswith("--color-")) |
            select(.key | startswith("--color-base") or
                   .key == "--color-primary" or
                   .key == "--color-secondary" or
                   .key == "--color-accent")]' corporate.json | sort) \
     <(jq '[.payload.tree | recurse(.children[]) |
            .styleDiff | to_entries[] |
            select(.key | startswith("--color-")) |
            select(.key | startswith("--color-base") or
                   .key == "--color-primary" or
                   .key == "--color-secondary" or
                   .key == "--color-accent")]' night.json | sort)
```

### Step 3: Find Components Still Using the Wrong Value

If a component's computed `background-color` matches the corporate
theme's `--color-primary` rather than the night theme's, the component
may be hardcoding a colour value rather than consuming the variable, or
a scoped `data-theme` attribute on an ancestor overrides the root theme.

```bash
# Find all elements with scoped data-theme (CDP mode)
css-view "http://localhost:5173?theme=night" --mode cdp | \
  jq '[.payload.nodes[] |
       select(.attributes["data-theme"]) |
       {tag: .tagName, theme: .attributes["data-theme"],
        class: .attributes.class}]'
```

Scoped `data-theme` attributes override the root theme for their
subtree. This is DaisyUI's intended mechanism for mixed-theme UIs, but
it can cause surprises if applied unintentionally.

## Investigation: DaisyUI `card` Component Has Wrong Border Radius

**Scenario:** Cards should have rounded corners matching `--radius-box`
but they appear square.

```bash
jq '.payload.tree | recurse(.children[]) |
    select(.classes | index("card")) |
    {classes,
     radius: .styleDiff["border-top-left-radius"] // "inherited/default"}' snapshot.json
```

If `border-top-left-radius` is absent from `styleDiff`, the computed
value matched the UA default for that element — which is `0` for a
`<div>`. This means DaisyUI's `card` ruleset did not apply. Check
whether the component classes are loaded: DaisyUI v5 requires explicit
import or plugin configuration in the CSS entry point.

Verify the `--radius-box` token exists:

```bash
jq '[.payload.tree | recurse(.children[]) |
     select(.styleDiff["--radius-box"] // empty) |
     {tag, id, val: .styleDiff["--radius-box"]}]' snapshot.json
```

If this returns an empty array, the DaisyUI theme layer is not loaded.

## Investigation: Colour Contrast Between DaisyUI Content and Background

DaisyUI pairs each colour with a `-content` variant (e.g.
`--color-primary` / `--color-primary-content`). Accessibility audits
need to verify the contrast ratio between these pairs.

```bash
# Extract all base and content colour pairs from the root
jq '.payload.tree.styleDiff | to_entries |
    map(select(.key | test("^--color-(primary|secondary|accent|neutral|base)"))) |
    group_by(.key | sub("-content$"; "")) |
    map({
      pair: .[0].key | sub("-content$"; ""),
      values: map({(.key): .value}) | add
    })' snapshot.json
```

This groups the colour tokens so you can inspect each base/content pair
side by side. Feed the oklch values into a contrast ratio calculator to
verify WCAG compliance.

## Pattern: Full DaisyUI Theme Variable Audit

A single command to dump every DaisyUI theme variable and its computed
value at the root:

```bash
css-view http://localhost:5173 | \
  jq '.payload.tree.styleDiff | to_entries |
      map(select(.key | startswith("--"))) |
      sort_by(.key) |
      map({key, value})' 
```

This is useful as a baseline reference: capture it once per theme and
commit the output. Future captures can be diffed against this baseline
to detect unintended theme drift.
