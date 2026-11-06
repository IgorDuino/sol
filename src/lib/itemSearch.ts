import MiniSearch from "minisearch";

type SearchableItem = {
	id: string;
	name: string;
	localizedName?: string;
	alias?: string;
};

export type ItemSearchMatch<T> = T & { matchTier: number; score: number };

function normalize(value = "") {
	return value
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}+#]+/gu, " ")
		.trim();
}

function wordBoundaries(value = "") {
	return normalize(value.replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2"));
}

function initials(value: string) {
	return value
		.split(" ")
		.map((word) => word[0] ?? "")
		.join("");
}

// Lower tiers are better. All query words must match, in any order.
function directTier(
	value: string,
	query: string,
	terms: string[],
): number | undefined {
	if (!value) return undefined;
	if (value === query) return 0;
	if (value.startsWith(query)) return 1;
	const words = value.split(" ");
	if (terms.every((term) => words.some((word) => word.startsWith(term))))
		return 2;
	if (terms.every((term) => value.includes(term))) return 3;
	return undefined;
}

// Require at least three letters and a compact span, so scattered characters in
// long bookmark titles do not flood the results. Return the best gap penalty.
function subsequencePenalty(value: string, query: string) {
	if (query.length < 3 || query.includes(" ")) return undefined;
	let best: number | undefined;
	for (
		let start = value.indexOf(query[0]);
		start !== -1;
		start = value.indexOf(query[0], start + 1)
	) {
		let end = start;
		let onlyWordBoundaryGaps = true;
		for (let i = 1; i < query.length && end !== -1; i++) {
			const next = value.indexOf(query[i], end + 1);
			if (next > end + 1 && value[next - 1] !== " ")
				onlyWordBoundaryGaps = false;
			end = next;
		}
		if (end === -1) continue;
		const span = end - start + 1;
		if (span <= query.length * 2 || onlyWordBoundaryGaps) {
			const penalty = (span - query.length) / span;
			best = Math.min(best ?? 1, penalty);
		}
	}
	return best;
}

// Build once per item collection, never once per keystroke. Keep the original
// items so callbacks and metadata are always those of the current collection.
export function createItemSearch<T extends SearchableItem>(
	items: readonly T[],
) {
	const documents = items.map((item) => {
		const nameWords = wordBoundaries(item.name);
		const localizedNameWords = wordBoundaries(item.localizedName);
		return {
			id: item.id,
			item,
			name: normalize(item.name),
			localizedName: normalize(item.localizedName),
			nameWords,
			localizedNameWords,
			alias: normalize(item.alias),
			initials: [initials(nameWords), initials(localizedNameWords)],
		};
	});
	const fields = [
		"name",
		"localizedName",
		"nameWords",
		"localizedNameWords",
		"alias",
	] as const;
	const index = new MiniSearch({
		fields: [...fields],
		tokenize: (value) => value.split(" "),
	});
	index.addAll(documents);

	return {
		search(rawQuery: string): ItemSearchMatch<T>[] {
			const query = normalize(rawQuery);
			if (!query) return [];
			const terms = query.split(" ");
			const fuzzyScores = new Map(
				index
					.search(query, {
						combineWith: "AND",
						prefix: true,
						// No typo expansion for short queries; at most two edits otherwise.
						fuzzy: (term) => (term.length < 4 ? false : 0.3),
						maxFuzzy: 2,
						boost: { name: 2, localizedName: 2 },
					})
					.map(({ id, score }) => [id, score]),
			);

			const results: ItemSearchMatch<T>[] = [];
			for (const document of documents) {
				const values = fields.map((field) => document[field]);
				const tiers = values
					.map((value) => directTier(value, query, terms))
					.filter((tier): tier is number => tier !== undefined);
				let matchTier = tiers.length ? Math.min(...tiers) : undefined;
				let score = 0;
				if (
					matchTier === undefined &&
					query.length >= 2 &&
					document.initials.some((value) => value.startsWith(query))
				) {
					matchTier = 2;
				}
				if (matchTier === undefined) {
					const penalties = values
						.map((value) => subsequencePenalty(value, query))
						.filter((penalty): penalty is number => penalty !== undefined);
					if (penalties.length) {
						matchTier = 4;
						score = -Math.min(...penalties);
					}
				}
				if (matchTier === undefined && fuzzyScores.has(document.id)) {
					matchTier = 5;
					score = fuzzyScores.get(document.id) ?? 0;
				}
				if (matchTier !== undefined) {
					results.push({ ...document.item, matchTier, score });
				}
			}
			return results;
		},
	};
}
