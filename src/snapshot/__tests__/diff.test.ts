import { describe, expect, it } from "bun:test";
import { computeStyleDiff } from "../diff";

const inherited = new Set(["color", "font-size", "font-family", "line-height"]);

describe("computeStyleDiff", () => {
  it("returns changes for non-inherited props compared to UA defaults", () => {
    const diff = computeStyleDiff({
      current: { display: "flex", opacity: "1", color: "rgb(0, 0, 0)" },
      uaDefaults: { display: "block", opacity: "1", color: "rgb(0, 0, 0)" },
      inherited,
    });

    expect(diff).toEqual({ display: "flex" });
  });

  it("omits inherited values when they match the parent", () => {
    const diff = computeStyleDiff({
      current: { color: "rgb(12, 34, 56)", display: "flex" },
      parent: { color: "rgb(12, 34, 56)" },
      uaDefaults: { color: "rgb(0, 0, 0)", display: "block" },
      inherited,
    });

    expect(diff).toEqual({ display: "flex" });
  });

  it("includes inherited values when the parent differs", () => {
    const diff = computeStyleDiff({
      current: { color: "rgb(12, 34, 56)", "font-size": "16px" },
      parent: { color: "rgb(0, 0, 0)", "font-size": "16px" },
      uaDefaults: { color: "rgb(0, 0, 0)", "font-size": "16px" },
      inherited,
    });

    expect(diff).toEqual({ color: "rgb(12, 34, 56)" });
  });

  it("falls back to UA defaults when there is no parent", () => {
    const diff = computeStyleDiff({
      current: { color: "rgb(12, 34, 56)" },
      uaDefaults: { color: "rgb(0, 0, 0)" },
      inherited,
    });

    expect(diff).toEqual({ color: "rgb(12, 34, 56)" });
  });
});
