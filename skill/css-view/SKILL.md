---
name: css-view-jq-debugging
description: >
  Debugging computed CSS using the css-view CLI and jq. Use this skill when
  investigating why a page's rendered styles diverge from source-level
  expectations—especially in utility-first frameworks like Tailwind v4 and
  DaisyUI v5. Trigger whenever the task involves inspecting computed styles
  from a terminal, diffing CSS snapshots between builds, verifying that
  utility classes resolve to the intended property values, diagnosing
  specificity or inheritance conflicts in Tailwind/DaisyUI, auditing CSS
  custom property propagation, or any scenario where browser DevTools are
  unavailable or impractical (CI, SSH, headless agents, Claude Code).
---

# Debugging Computed CSS with `css-view` and `jq`

## What Problem Does This Solve?

Browser DevTools answer style questions interactively. `css-view` answers
them programmatically. It launches a real browser via Playwright, captures
every element's computed styles as structured JSON, and writes the result
to stdout. That JSON is `jq`'s native habitat.

This combination is the right tool when:

- **You have no GUI.** SSH sessions, CI pipelines, headless agents, Claude
  Code — anywhere a browser window cannot open.
- **You need reproducibility.** A `jq` filter is a query you can version,
  share, and re-run against future snapshots. "Open DevTools and look" is
  not a reproducible investigation.
- **You need to search across the whole page.** DevTools inspects one
  element at a time. `jq` can filter every node on the page in a single
  pass — find all elements with `display: none`, every node where
  `font-size` deviates from its parent, every custom property that changed.
- **You want to diff between states.** Capture a snapshot before and after
  a change, then compare with `jq` or `diff`. This is invaluable for
  verifying that a Tailwind config migration or DaisyUI theme change only
  affected what you intended.
- **Utility-class frameworks obscure the computed result.** A class like
  `btn-primary` or `text-balance` tells you the author's intent but not
  the computed outcome. `css-view` shows the resolved values after the
  cascade, specificity, and inheritance have all had their say.

## Capture Modes at a Glance

`css-view` offers two backends. The choice affects the JSON shape and
therefore the `jq` idioms you reach for.

### Walker Mode (default, all browsers)

Produces a **recursive tree** rooted at `<html>`. Each node carries a
`styleDiff` object containing only properties that diverge from the
parent (for inherited properties) or from the user-agent default (for
non-inherited properties). Custom properties (`--*`) appear when they
differ from the parent.

```text
.payload.tree                         # root node
  .tag                                # "div", "button", etc.
  .id                                 # element id or null
  .classes[]                          # class list
  .text                               # trimmed text content (clipped)
  .bbox                               # {x, y, width, height}
  .styleDiff                          # only non-default/non-inherited diffs
  .children[]                         # recursive child nodes
```

Walker mode is the workhorse for investigating *why something looks
wrong*. Because `styleDiff` suppresses inherited/default noise, it
highlights exactly where the cascade introduced a meaningful change.

**Best for:** Tracing inheritance chains, finding where a property was
introduced, auditing custom property propagation through the tree.

### CDP Mode (Chromium only)

Produces a **flat array** of nodes with full computed style values for
whitelisted properties.

```text
.payload.nodes[]                      # flat node list
  .tagName                            # "div", "button", etc.
  .attributes                         # {class: "...", id: "...", ...}
  .computedStyles                     # full computed values (whitelisted)
  .boundingBox                        # {x, y, width, height}
  .children[]                         # child node indexes (integers)
  .textContent                        # raw text or null
  .layoutText                         # laid-out text or null
```

CDP mode captures exactly the properties you request via `--props` or
`--props-file`. No diffing against defaults — you get the raw computed
values, which makes cross-element comparison straightforward.

**Best for:** Page-wide audits ("which elements have this background
colour?"), layout debugging across sibling elements, comparing computed
values against known-good references.

## Essential `jq` Patterns for `css-view`

### Recursive Tree Descent (Walker)

Walker output is a tree. The `recurse(.children[])` idiom flattens it
for filtering:

```bash
# All elements where styleDiff sets display to flex
css-view http://localhost:5173 | \
  jq '[.payload.tree | recurse(.children[]) |
       select(.styleDiff.display == "flex") |
       {tag, id, classes}]'
```

### Finding Nodes by Class (Walker)

```bash
# Find all nodes carrying a specific class
css-view http://localhost:5173 | \
  jq '.payload.tree | recurse(.children[]) |
      select(.classes | index("btn-primary"))'
```

### Extracting a Subtree by ID (Walker)

```bash
# Pull out a component's subtree for focused inspection
css-view http://localhost:5173 | \
  jq '.payload.tree | recurse(.children[]) |
      select(.id == "hero-section")'
```

### Custom Property Audit (Walker)

Because the walker emits custom properties in `styleDiff` only when they
diverge from the parent, you can find every point where a CSS variable
was (re)defined:

```bash
# All nodes that define or override any --color-* variable
css-view http://localhost:5173 | \
  jq '[.payload.tree | recurse(.children[]) |
       select(.styleDiff | to_entries[] |
              .key | startswith("--color-")) |
       {tag, id, classes, vars: [.styleDiff | to_entries[] |
              select(.key | startswith("--color-"))]}]'
```

### Page-Wide Property Search (CDP)

```bash
# Every element with a non-transparent background colour
css-view http://localhost:5173 --mode cdp | \
  jq '[.payload.nodes[] |
       select(.computedStyles["background-color"] != "rgba(0, 0, 0, 0)") |
       {tag: .tagName, class: .attributes.class,
        bg: .computedStyles["background-color"]}]'
```

### Layout Geometry Queries (Either Mode)

Both modes expose bounding boxes, making spatial queries possible:

```bash
# Walker: all zero-height elements (collapsed/hidden)
css-view http://localhost:5173 | \
  jq '[.payload.tree | recurse(.children[]) |
       select(.bbox.height == 0) |
       {tag, id, classes}]'
```

### Snapshot Diffing Between Builds

```bash
# Capture before and after
css-view http://localhost:5173 -o before.json
# ... make changes ...
css-view http://localhost:5173 -o after.json

# Compare styleDiffs of all nodes with a given class
diff <(jq '[.payload.tree | recurse(.children[]) |
            select(.classes | index("card")) | .styleDiff]' before.json) \
     <(jq '[.payload.tree | recurse(.children[]) |
            select(.classes | index("card")) | .styleDiff]' after.json)
```

## Narrowing the Property Set

Both modes accept `--props` (comma-separated) or `--props-file` to
restrict which properties appear. For targeted investigations, narrow the
set to cut noise:

```bash
# Only capture spacing properties
css-view http://localhost:5173 --mode cdp \
  --props "margin-top,margin-right,margin-bottom,margin-left,padding-top,padding-right,padding-bottom,padding-left"
```

The walker's `--inherited` / `--inherited-file` flags control which
properties use parent-comparison rather than UA-default-comparison for
diffing. Override these when investigating inheritance of non-standard
inherited properties.

## Debugging Mobile Presentation

`css-view` can now capture at mobile-sized viewport settings directly
from the CLI:

- `-W`, `--viewport-width <px>` sets the browser viewport width in CSS
  pixels.
- `-H`, `--viewport-height <px>` sets the browser viewport height in CSS
  pixels.
- `-R`, `--display-pixel-resolution <dpr>` sets Playwright's
  `deviceScaleFactor` using a whole-number device pixel ratio.

This is the default move when the bug only reproduces on narrow screens:
stacked layouts, missing mobile nav, truncated cards, breakpoint-specific
spacing, or theme tokens that change under mobile-specific containers.

### Practical capture patterns

```bash
# iPhone 12/13/14-style CSS viewport
css-view http://localhost:5173 -W 390 -H 844 -R 3 -o mobile.json

# Compare against a desktop baseline
css-view http://localhost:5173 -W 1440 -H 900 -R 1 -o desktop.json
```

Use walker mode first when the question is "where in the tree did the
mobile-specific change start?" Use CDP mode when the question is "which
elements ended up with the wrong computed value at this viewport?"

### Breakpoint boundary checks

Responsive bugs often live exactly on a breakpoint edge. Capture both
sides of the boundary:

```bash
# Below Tailwind's md breakpoint
css-view http://localhost:5173 -W 767 -H 900 -R 2 -o below-md.json

# At or above md
css-view http://localhost:5173 -W 768 -H 900 -R 2 -o at-md.json
```

Then diff only the affected nodes:

```bash
diff <(jq '[.payload.tree | recurse(.children[]) |
            select(.classes | index("md:flex")) |
            {classes, styleDiff}]' below-md.json) \
     <(jq '[.payload.tree | recurse(.children[]) |
            select(.classes | index("md:flex")) |
            {classes, styleDiff}]' at-md.json)
```

### What DPR helps with

`-R` is useful when presentation depends on device scale factor:

- raster asset selection (`srcset`, density-specific images),
- subpixel rounding differences in tight layouts,
- canvas- or screenshot-adjacent investigations where CSS pixels and
  device pixels diverge.

It does **not** fully emulate a phone. `css-view` is changing viewport
size and DPR, not touch support, user agent, or device posture. Treat it
as a fast computed-style probe for responsive CSS, not a complete mobile
browser simulator.

## Framework-Specific Debugging Guides

The reference files contain detailed walkthroughs for debugging computed
styles in specific framework contexts. Read the appropriate file when the
investigation involves that framework.

### Tailwind CSS v4

**Read:** `references/tailwind-v4.md`

Covers: CSS-first configuration and `@theme` directives, tracing how
utility classes resolve through the `@layer` cascade, custom property
propagation for design tokens (`--color-*`, `--spacing-*`, `--font-*`),
dark mode via `@custom-variant`, and diagnosing specificity conflicts
between utilities and custom CSS.

### DaisyUI v5 + Tailwind CSS v4

**Read:** `references/daisyui-v5.md`

Covers: How DaisyUI component classes expand into computed styles, theme
variable propagation (`--color-base-*`, `--color-primary`, etc.), the
`data-theme` attribute and its effect on custom property values,
diagnosing conflicts between DaisyUI component styles and Tailwind
overrides, and verifying theme switching produces the expected computed
values.

## Common Investigation Workflows

### "This element has the wrong colour"

1. Capture with walker mode.
2. Find the element by class or id.
3. Check whether `color` or `background-color` appears in its `styleDiff`.
4. If absent, the value is inherited — walk up the tree until you find
   the ancestor whose `styleDiff` sets it.
5. If a custom property is involved, search for the `--` variable in
   `styleDiff` entries to find where it was last (re)defined.

### "My layout is broken"

1. Capture with CDP mode, restricting to layout properties:
   `--props "display,position,width,height,flex-direction,flex-wrap,gap,align-items,justify-content"`
2. Filter for the container and its children.
3. Compare computed `display`, `flex-direction`, `width` against your
   expectations.
4. Check bounding boxes — zero-width or zero-height children indicate
   collapsed elements.

### "Styles work in dev but not in production"

1. Capture snapshots from both environments.
2. Diff the styleDiff (walker) or computedStyles (CDP) of the affected
   components.
3. Divergences point to CSS purging, layer ordering, or custom property
   resolution differences between build configurations.

### "I changed the Tailwind config but nothing happened"

1. Capture a snapshot.
2. Search for the relevant CSS custom property in `styleDiff`.
3. If the old value persists, the config change did not propagate — check
   the build output or the `@theme` layer.
4. If the variable is absent from `styleDiff` entirely, it may be
   inheriting the correct value from a parent — verify by extracting the
   ancestor chain.

## Tips

- **Use `--pretty` for human inspection, omit it for piping to `jq`.**
  Pretty-printed JSON parses identically but `--pretty` adds overhead to
  large snapshots.
- **`--max-nodes` guards against runaway captures.** Default is 2000. For
  large SPAs, raise it or target a specific route.
- **`--wait-until networkidle` is the default** and handles most SPAs.
  For pages with persistent WebSocket connections, switch to `load` or
  `domcontentloaded` to avoid timeout.
- **Walker mode with Firefox is the default** for a reason — it avoids
  Chromium's CDP quirks and works across all three engines for
  cross-browser comparison.
- **Pipe to `jq -e` when scripting.** The `-e` flag sets a non-zero exit
  code when the filter produces `false` or `null`, which is useful for
  CI assertions.
