export interface ComputeStyleDiffArgs {
	current: Record<string, string | undefined>;
	uaDefaults: Record<string, string | undefined>;
	parent?: Record<string, string | undefined>;
	inherited: Set<string>;
}

/**
 * Returns the minimal set of properties whose computed values matter.
 * Inherited props compare against the parent first, while everything else
 * compares against the UA default for the element/tag.
 */
export function computeStyleDiff({
	current,
	uaDefaults,
	parent,
	inherited,
}: ComputeStyleDiffArgs): Record<string, string> {
	const diff: Record<string, string> = {};

	for (const [property, value] of Object.entries(current)) {
		if (value == null) continue;
		const isInherited = inherited.has(property);
		const baseline = isInherited
			? (parent?.[property] ?? uaDefaults[property])
			: uaDefaults[property];

		if (baseline === undefined || value !== baseline) {
			diff[property] = value;
		}
	}

	return diff;
}
