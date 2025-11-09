import { describe, expect, it } from "bun:test";
import { resolvePropertyList } from "../property-resolver";

const defaults = ["display", "color", "opacity"];

describe("resolvePropertyList", () => {
	it("splits comma separated input and trims whitespace", async () => {
		const props = await resolvePropertyList({
			cliProps: "color, font-size ,display",
			defaults,
			readFile: async () => "",
		});

		expect(props).toEqual(["color", "font-size", "display"]);
	});

	it("reads overrides from a file when provided", async () => {
		const props = await resolvePropertyList({
			propsFile: "fake.txt",
			defaults,
			readFile: async () => "margin-top\npadding-top\ncolor",
		});

		expect(props).toEqual(["margin-top", "padding-top", "color"]);
	});

	it("falls back to defaults when neither option is provided", async () => {
		const props = await resolvePropertyList({
			defaults,
			readFile: async () => "should not run",
		});

		expect(props).toEqual(defaults);
	});
});
