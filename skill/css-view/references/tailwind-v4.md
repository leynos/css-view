# Debugging Tailwind CSS v4 with `css-view` and `jq`

## How Tailwind v4 Changes the Debugging Landscape

Tailwind v4 moved configuration from `tailwind.config.js` into CSS
itself. Design tokens are now CSS custom properties defined via `@theme`,
utilities live in well-defined `@layer` blocks, and the cascade follows
native CSS layer ordering. This is architecturally cleaner, but it means
the computed output depends on custom property resolution and layer
precedence — both of which are invisible in source code and visible only
in computed styles.

`css-view`'s walker mode is particularly well suited here. The
`styleDiff` output captures custom properties (`--*`) when they differ
from the parent, which directly corresponds to how Tailwind v4's token
system propagates values through the DOM.

## Tailwind v4's CSS Custom Property Namespace

Tailwind v4 exposes design tokens as custom properties under predictable
prefixes. These appear in walker `styleDiff` when the element introduces
or overrides them.

- Colours: `--color-*`, for example `--color-blue-500`
- Spacing: `--spacing-*`, for example `--spacing-4`
- Font family: `--font-*`, for example `--font-sans`
- Font size: `--font-size-*`, for example `--font-size-lg`
- Border radius: `--radius-*`, for example `--radius-lg`
- Shadows: `--shadow-*`, for example `--shadow-md`
- Breakpoints: `--breakpoint-*`, for example `--breakpoint-md`

The `@theme` directive defines these on `:root`. Overrides in nested
scopes (media queries, container queries, custom variants) redefine them
lower in the tree, and walker mode will flag each redefinition in
`styleDiff`.

## Investigation: Utility Class Not Producing Expected Value

**Scenario:** You applied `text-blue-500` to a heading, but it renders
in the wrong shade. The source says `text-blue-500`; the question is
what the browser actually computed.

### Step 1: Capture the Snapshot

```bash
css-view http://localhost:5173 -o snapshot.json
```

### Step 2: Locate the Element

```bash
# Find the heading by its class
jq '.payload.tree | recurse(.children[]) |
    select(.classes | index("text-blue-500"))' snapshot.json
```

### Step 3: Inspect the Computed Colour

The output's `styleDiff` tells you what the element's computed `color`
resolved to:

```json
{
  "tag": "h1",
  "classes": ["text-blue-500", "font-bold"],
  "styleDiff": {
    "color": "rgb(59, 130, 246)",
    "font-weight": "700"
  }
}
```

If `color` is absent from `styleDiff`, the element inherited its colour
from an ancestor. Walk up the tree to find where it was set.

### Step 4: Check the Custom Property

Tailwind v4's `text-blue-500` resolves `color` via a custom property.
To verify the token value at this point in the tree:

```bash
# Find where --color-blue-500 is defined in the ancestor chain
jq '[.payload.tree | recurse(.children[]) |
     select(.styleDiff["--color-blue-500"] // empty) |
     {tag, id, classes, val: .styleDiff["--color-blue-500"]}]' snapshot.json
```

If a parent element redefines `--color-blue-500` (perhaps via a scoped
`@theme` override or a dark mode variant), this query reveals the
redefinition point.

## Investigation: `@layer` Ordering and Specificity Conflicts

Tailwind v4 places generated utilities in `@layer utilities`. If you
have custom CSS in an unlayered context or in a higher-precedence layer,
it will win the cascade regardless of selector specificity.

**Scenario:** You wrote a custom `.hero-title` class with
`font-size: 3rem` and also applied the Tailwind utility `text-lg`. The
element renders at `3rem` despite `text-lg` appearing later in the class
list.

This is expected: unlayered styles beat `@layer utilities` in the
cascade. But confirming this from source inspection alone requires
understanding every layer boundary in your build output. `css-view`
shows you the winner directly.

### Confirm the Computed Value

```bash
jq '.payload.tree | recurse(.children[]) |
    select(.classes | index("hero-title")) |
    {classes, fontSize: .styleDiff["font-size"]}' snapshot.json
```

If the output shows `"fontSize": "48px"` (the computed equivalent of
`3rem`) rather than the `text-lg` value, the custom class won the
cascade. The fix is to move `.hero-title` into a `@layer` or to use
`@layer utilities` for the override.

### Audit All Font Size Overrides Across the Page

```bash
jq '[.payload.tree | recurse(.children[]) |
     select(.styleDiff["font-size"]) |
     {tag, classes, fontSize: .styleDiff["font-size"]}]' snapshot.json
```

This reveals every element where `font-size` was explicitly set (not
inherited), giving you a map of all the cascade winners.

## Investigation: Dark Mode Custom Properties Not Applying

Tailwind v4 implements dark mode through `@custom-variant dark` which
can use a `prefers-color-scheme` media query or a `.dark` class selector.
Either way, the mechanism redefines CSS custom properties at a scope
boundary.

**Scenario:** Dark mode works in the browser but `css-view` captures
light-mode values.

By default, `css-view` launches a vanilla browser context with no
colour-scheme preference. To capture dark mode:

```bash
# Capture with Chromium to use CDP's emulation
# (set prefers-color-scheme via Playwright's context — requires
# a wrapper script or use --headful and toggle manually)
```

A pragmatic workaround for class-based dark mode: if your app uses a
`.dark` class on `<html>`, inject it via the page before capture. For
the `prefers-color-scheme` strategy, use Playwright's built-in colour
scheme emulation by writing a thin capture script, or compare the `:root`
custom property values between a light and dark snapshot.

### Verify Dark Mode Token Propagation

After capturing a dark-mode snapshot, verify that theme tokens changed:

```bash
# Show all --color-* redefinitions in the dark-mode snapshot
jq '[.payload.tree | recurse(.children[]) |
     select(.styleDiff | to_entries[] | .key | startswith("--color-")) |
     {tag, id, vars: [.styleDiff | to_entries[] |
                       select(.key | startswith("--color-"))]}]' dark.json
```

Compare with the light-mode snapshot:

```bash
diff <(jq '[.payload.tree | recurse(.children[]) |
            .styleDiff | to_entries[] |
            select(.key | startswith("--color-"))]' light.json) \
     <(jq '[.payload.tree | recurse(.children[]) |
            .styleDiff | to_entries[] |
            select(.key | startswith("--color-"))]' dark.json)
```

## Investigation: Responsive Breakpoint Not Activating

Tailwind v4 defines breakpoints as custom properties (`--breakpoint-sm`,
`--breakpoint-md`, etc.) and uses them in `@media` rules. `css-view`
can now capture at an explicit viewport size and DPR via
`-W`/`--viewport-width`, `-H`/`--viewport-height`, and
`-R`/`--display-pixel-resolution`.

**Scenario:** A `md:flex` utility does not appear to take effect.

### Step 1: Capture at the Breakpoint

Capture both sides of the breakpoint boundary:

```bash
css-view http://localhost:5173 -W 767 -H 900 -R 2 -o below-md.json
css-view http://localhost:5173 -W 768 -H 900 -R 2 -o at-md.json

jq '.payload.tree | recurse(.children[]) |
    select(.classes | index("md:flex")) |
    {classes, display: .styleDiff.display}' below-md.json

jq '.payload.tree | recurse(.children[]) |
    select(.classes | index("md:flex")) |
    {classes, display: .styleDiff.display}' at-md.json
```

If `display` is absent from `styleDiff` below `768px` and present at or
above `768px`, the media query boundary is behaving correctly. If the
value is wrong on both sides, the problem is not the breakpoint gate —
it is the rule or token the breakpoint is enabling.

### Step 2: Confirm the Breakpoint Token

```bash
# Check what --breakpoint-md resolved to at :root
jq '.payload.tree.styleDiff["--breakpoint-md"]' snapshot.json
```

If this returns `null`, the breakpoint token is either inheriting its
default or was not captured. The default property set for walker mode
does not whitelist breakpoint variables by default; they appear only if
they diverge from the parent (which at `:root` means they must be
explicitly defined by `@theme`).

## Investigation: Spacing Scale Mismatch

**Scenario:** `p-4` should produce `1rem` of padding (assuming the
default spacing scale) but the element has `16px` instead.

This is usually a non-issue — `16px` and `1rem` are equivalent at
default root font size. But if the root font size has been changed, the
rem value diverges from the pixel expectation.

```bash
# Check what p-4 computed to
jq '.payload.tree | recurse(.children[]) |
    select(.classes | index("p-4")) |
    {classes,
     pt: .styleDiff["padding-top"],
     pr: .styleDiff["padding-right"],
     pb: .styleDiff["padding-bottom"],
     pl: .styleDiff["padding-left"]}' snapshot.json
```

If padding values are absent from `styleDiff`, they match the UA
default for that element. For a `<div>`, the default is `0`, so their
absence means the utility did not apply — likely a build/purge issue.

### Cross-Reference the Spacing Token

```bash
jq '[.payload.tree | recurse(.children[]) |
     select(.styleDiff["--spacing-4"] // empty) |
     {tag, id, val: .styleDiff["--spacing-4"]}]' snapshot.json
```

## Composing CI Assertions

`css-view` + `jq -e` enables CI-level checks on computed styles:

```bash
# Assert that .btn-primary resolves to the expected background colour
css-view http://localhost:5173 | \
  jq -e '.payload.tree | recurse(.children[]) |
         select(.classes | index("btn-primary")) |
         .styleDiff["background-color"] == "rgb(59, 130, 246)"'
```

Exit code 0 means the assertion passed; non-zero means it failed. Chain
multiple assertions in a shell script or Makefile target for a computed-
style regression suite.

```bash
#!/usr/bin/env bash
set -euo pipefail

SNAPSHOT=$(css-view http://localhost:5173)

echo "$SNAPSHOT" | jq -e '
  .payload.tree | recurse(.children[]) |
  select(.classes | index("btn-primary")) |
  .styleDiff["background-color"] == "rgb(59, 130, 246)"
' > /dev/null && \
  echo "PASS: btn-primary background" || \
  echo "FAIL: btn-primary background"

echo "$SNAPSHOT" | jq -e '
  .payload.tree | recurse(.children[]) |
  select(.classes | index("text-balance")) |
  .styleDiff["text-wrap"] == "balance"
' > /dev/null && echo "PASS: text-balance" || echo "FAIL: text-balance"
```
