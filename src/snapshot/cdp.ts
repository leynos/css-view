import type { Page } from "playwright";
import type { Protocol } from "playwright-core/types/protocol";

export interface BoundingBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface CdpSnapshotNode {
	index: number;
	nodeType: number | null;
	tagName: string | null;
	attributes: Record<string, string>;
	parentIndex: number | null;
	children: number[];
	textContent: string | null;
	layoutText: string | null;
	boundingBox?: BoundingBox;
	computedStyles: Record<string, string>;
}

export interface CdpSnapshotResult {
	mode: "cdp";
	nodes: CdpSnapshotNode[];
	computedProperties: string[];
}

export interface CdpCaptureOptions {
	properties: string[];
}

export async function captureWithCdp(
	page: Page,
	{ properties }: CdpCaptureOptions,
): Promise<CdpSnapshotResult> {
	const session = await page.context().newCDPSession(page);
	const response = (await session.send("DOMSnapshot.captureSnapshot", {
		computedStyles: properties,
		includePaintOrder: true,
		includeDOMRects: true,
		includeBlendedBackgroundColors: true,
		includeTextColor: true,
	})) as Protocol.DOMSnapshot.CaptureSnapshotReturnValue;

	const strings = response.strings ?? [];
	const doc = response.documents[0];
	const nodes = doc.nodes;
	const layout = doc.layout;

	const layoutInfoByNode = new Map<
		number,
		{
			computed: Record<string, string>;
			boundingBox?: BoundingBox;
			text?: string | null;
		}
	>();

	const layoutNodeIndexes = layout.nodeIndex ?? [];
	for (let i = 0; i < layoutNodeIndexes.length; i += 1) {
		const nodeIndex = layoutNodeIndexes[i];
		const styleIndexes = layout.styles?.[i] ?? [];
		const computed: Record<string, string> = {};
		for (let propIdx = 0; propIdx < properties.length; propIdx += 1) {
			const stringIndex = styleIndexes[propIdx];
			if (typeof stringIndex === "number" && stringIndex >= 0) {
				computed[properties[propIdx]] = strings[stringIndex];
			}
		}

		const bounds = layout.bounds?.[i];
		const boundingBox =
			bounds && bounds.length >= 4
				? { x: bounds[0], y: bounds[1], width: bounds[2], height: bounds[3] }
				: undefined;

		const textIndex = layout.text?.[i];
		const text =
			typeof textIndex === "number" ? (strings[textIndex] ?? null) : null;

		layoutInfoByNode.set(nodeIndex, { computed, boundingBox, text });
	}

	const parentIndex = nodes.parentIndex ?? [];
	const childMap = new Map<number, number[]>();
	for (let i = 0; i < parentIndex.length; i += 1) {
		const parent = parentIndex[i];
		if (parent == null || parent === -1) continue;
		if (!childMap.has(parent)) childMap.set(parent, []);
		const bucket = childMap.get(parent);
		if (bucket) bucket.push(i);
	}

	const nodeCount = nodes.nodeName?.length ?? 0;
	const records: CdpSnapshotNode[] = [];

	for (let i = 0; i < nodeCount; i += 1) {
		const nodeType = nodes.nodeType?.[i] ?? null;
		const nodeNameIndex = nodes.nodeName?.[i];
		const tagName =
			typeof nodeNameIndex === "number"
				? (strings[nodeNameIndex]?.toLowerCase() ?? null)
				: null;

		const attributeIndexes = nodes.attributes?.[i] ?? [];
		const attributes: Record<string, string> = {};
		for (let j = 0; j < attributeIndexes.length; j += 2) {
			const name = strings[attributeIndexes[j]];
			const value = strings[attributeIndexes[j + 1]] ?? "";
			if (name) {
				attributes[name] = value;
			}
		}

		const nodeValueIndex = nodes.nodeValue?.[i];
		const textContent =
			typeof nodeValueIndex === "number" && strings[nodeValueIndex]?.trim()
				? strings[nodeValueIndex]
				: null;

		const layoutInfo = layoutInfoByNode.get(i);

		records.push({
			index: i,
			nodeType,
			tagName,
			attributes,
			parentIndex: parentIndex[i] ?? null,
			children: childMap.get(i) ?? [],
			textContent,
			layoutText: layoutInfo?.text ?? null,
			boundingBox: layoutInfo?.boundingBox,
			computedStyles: layoutInfo?.computed ?? {},
		});
	}

	return { mode: "cdp", nodes: records, computedProperties: properties };
}
