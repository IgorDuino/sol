import assert from "node:assert/strict";
import { test } from "bun:test";
import { createItemSearch } from "./itemSearch";

const catalog = [
	{ id: "chrome", name: "Google Chrome", alias: "gc" },
	{ id: "code", name: "Visual Studio Code" },
	{ id: "calendar", name: "Calendar" },
	{ id: "notes", name: "Notes", localizedName: "Заметки" },
	{ id: "cafe", name: "Café Notes" },
	{ id: "theme", name: "Switch Appearance", alias: "dark" },
];
const search = createItemSearch(catalog);
const ids = (query) => search.search(query).map((item) => item.id);

for (const [query, id] of [
	["hrom", "chrome"],
	["rome", "chrome"],
	["chrm", "chrome"],
	["chorme", "chrome"],
	["calnder", "calendar"],
	["gc", "chrome"],
	["vs", "code"],
	["vsc", "code"],
	["vscode", "code"],
	["studio visual", "code"],
	["cafe", "cafe"],
	["cafe\u0301", "cafe"],
	[" ЗАМЕТ ", "notes"],
	["dark", "theme"],
]) {
	test(`${query} finds ${id}`, () => {
		assert.ok(ids(query).includes(id));
	});
}

test("every query word must match; unrelated items and short-query typos stay out", () => {
	assert.deepEqual(ids("studio calendar"), []);
	assert.deepEqual(ids("chrome zzzzzz"), []);
	assert.deepEqual(ids("zzzzzz"), []);
	assert.deepEqual(ids("cx"), []);
	assert.deepEqual(ids("chr"), ["chrome"]);
	assert.deepEqual(ids(""), []);
	assert.deepEqual(ids("  ---  "), []);
});

test("exact, prefix, word prefix, substring, subsequence, and typo matches have distinct priority", () => {
	const names = [
		"Chrome",
		"Chrome Beta",
		"Google Chrome",
		"MyChrome",
		"Chroma",
		"Chorme",
	];
	// Use lower case to distinguish an interior match from a camel-case boundary.
	const matches = createItemSearch(
		names.map((name, id) => ({ id: String(id), name: name.toLowerCase() })),
	).search("chrome");
	assert.deepEqual(
		matches.map(({ matchTier }) => matchTier),
		[0, 1, 2, 3, 5, 5],
	);
	assert.equal(search.search("chrm")[0].matchTier, 4);
});

test("bounded subsequences reject scattered letters in long titles", () => {
	const items = [
		{ id: "noise", name: "axxxxxbxxxxxc" },
		{ id: "code", name: "Visual Studio Code" },
	];
	const matches = createItemSearch(items).search("abc");
	assert.ok(!matches.some((item) => item.id === "noise"));
	assert.ok(
		createItemSearch(items)
			.search("vscode")
			.some((item) => item.id === "code"),
	);
});

test("names, punctuation, Unicode, and literal regex characters are normalized consistently", () => {
	const items = [
		{ id: "camel", name: "BetterTouchTool" },
		{ id: "punctuation", name: "My-App_v2.0" },
		{ id: "unicode", name: "東京 メモ" },
		{ id: "literal", name: "C++ Reference" },
	];
	for (const [query, id] of [
		["btt", "camel"],
		["tool", "camel"],
		["app v2", "punctuation"],
		["メモ", "unicode"],
		["c++", "literal"],
	]) {
		assert.ok(
			createItemSearch(items)
				.search(query)
				.some((item) => item.id === id),
		);
	}
});

test("results preserve action callbacks and item metadata", () => {
	const callback = () => "launched";
	const item = {
		id: "script",
		name: "Backup Photos",
		callback,
		type: "USER_SCRIPT",
		url: "/tmp/backup",
		isRunning: true,
	};
	const result = createItemSearch([item]).search("photos")[0];
	assert.equal(result.callback(), "launched");
	assert.equal(result.callback, callback);
	assert.equal(result.url, item.url);
	assert.equal(result.type, item.type);
	assert.equal(result.isRunning, true);
});

test("camel-case names remain case-insensitive exact matches", () => {
	const index = createItemSearch([{ id: "airdrop", name: "AirDrop" }]);
	for (const query of ["AirDrop", "airdrop", "AIRDROP"]) {
		assert.equal(index.search(query)[0].matchTier, 0);
	}
	assert.equal(index.search("drop")[0].matchTier, 2);
});

test("meaningful symbols distinguish C++ and C# from plain C", () => {
	const index = createItemSearch([
		{ id: "cpp", name: "C++ Reference" },
		{ id: "csharp", name: "C# Reference" },
		{ id: "c", name: "C Reference" },
	]);
	assert.deepEqual(
		index.search("c++").map(({ id }) => id),
		["cpp"],
	);
	assert.deepEqual(
		index.search("c#").map(({ id }) => id),
		["csharp"],
	);
});
