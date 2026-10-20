import assert from "node:assert/strict";
import { afterEach, mock, test } from "bun:test";
import { autorun, makeAutoObservable, runInAction } from "mobx";

// Exercise the real UI store and MobX computeds without native permissions,
// reading user configuration, opening applications, or running startup work.
mock.module("@sentry/react-native", () => ({ captureException() {} }));
mock.module("assets", () => ({ Assets: {} }));
mock.module("react-native", () => ({
	Appearance: {
		getColorScheme: () => "dark",
		addChangeListener: () => ({ remove() {} }),
	},
	Linking: { openURL() {} },
}));
mock.module("react-native-restart-newarch", () => ({ default: {} }));
mock.module("lib/SolNative", () => ({
	solNative: {
		userName: () => "fixture",
		exists: () => true,
		addListener: () => ({ remove() {} }),
	},
}));
mock.module("lib/shortcuts", () => ({
	defaultShortcuts: {},
	normalizeShortcut: (value) => value,
	normalizeShortcutMap: (value) => value,
}));
mock.module("./items", () => ({ createBaseItems: () => [] }));
mock.module("./persisted-config", () => ({
	readPersistedUIState: () => new Promise(() => {}),
	writePersistedUIState() {},
}));

const { createUIStore } = await import("./ui.store");
const cleanups = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function fixture(items = []) {
	const root = { scripts: makeAutoObservable({ scripts: [] }) };
	const ui = createUIStore(root);
	runInAction(() => {
		ui.customItems = items;
	});
	cleanups.push(() => ui.cleanUp());
	cleanups.push(autorun(() => ui.searchItems));
	return { ui, root };
}
const item = (id, name, extra = {}) => ({ id, name, type: "CUSTOM", ...extra });
const ids = (ui) => ui.searchItems.map((result) => result.id);

test("relevance outranks usage; history resolves comparable direct matches", () => {
	const { ui } = fixture([
		item("exact", "Chrome"),
		item("prefix", "Chrome Beta"),
		item("word", "Google Chrome"),
		item("inside", "mychrome"),
		item("typo", "Chroma"),
	]);
	runInAction(() => {
		ui.frequencies.typo = 999;
		ui.selectionTimestamps.typo = Date.now();
	});
	ui.setQuery("chrome");
	assert.deepEqual(ids(ui), ["exact", "prefix", "word", "inside", "typo"]);

	ui.createCustomItem(item("beta", "Google Chrome Beta"));
	ui.recordItemSelection(ui.customItems.find(({ id }) => id === "beta"));
	assert.deepEqual(ids(ui), [
		"exact",
		"prefix",
		"beta",
		"word",
		"inside",
		"typo",
	]);
});

test("better subsequence quality outranks a frequently selected loose match", () => {
	const { ui } = fixture([
		item("compact", "Chrome"),
		item("loose", "chxxrxxm"),
	]);
	runInAction(() => {
		ui.frequencies.loose = 999;
	});
	ui.setQuery("chrm");
	assert.deepEqual(ids(ui), ["compact", "loose"]);
});

test("observed search reuses its index across keystrokes and refreshes edits and deletions", () => {
	const { ui } = fixture([
		item("custom", "Google Chrome", { callback: () => "old" }),
	]);
	ui.setQuery("chrome");
	const index = ui.itemSearch;
	ui.setSelectedIndex(4);
	ui.setQuery("hrom");
	assert.equal(ui.itemSearch, index);
	assert.equal(ui.selectedIndex, 0);
	assert.equal(ui.currentItem.id, "custom");

	ui.updateCustomItem(
		item("custom", "Backup Photos", { callback: () => "new" }),
	);
	assert.notEqual(ui.itemSearch, index);
	assert.deepEqual(ids(ui), []);
	ui.setQuery("photos");
	assert.equal(ui.currentItem.callback(), "new");
	ui.deleteCustomItem("custom");
	assert.deepEqual(ids(ui), []);
});

test("bookmark visibility, script refresh, disabled items, and app refresh use the current corpus", () => {
	const { ui, root } = fixture();
	runInAction(() => {
		ui.bookmarks = [item("bookmark", "Backup Docs", { type: "BOOKMARK" })];
		root.scripts.scripts = [
			item("script", "Backup Photos", { type: "USER_SCRIPT" }),
		];
	});
	ui.setQuery("backup");
	assert.deepEqual(new Set(ids(ui)), new Set(["bookmark", "script"]));
	runInAction(() => {
		ui.showInAppBrowserBookMarks = false;
	});
	assert.deepEqual(ids(ui), ["script"]);
	ui.disableItem("script");
	assert.deepEqual(ids(ui), []);
	assert.equal(ui.items[0].id, "script"); // Still editable in Settings.
	ui.enableItem("script");
	runInAction(() => {
		root.scripts.scripts = [];
	});
	assert.deepEqual(ids(ui), []);
	ui.updateApps([
		{
			name: "Backup App",
			localizedName: "",
			url: "file:///fixture.app",
			isRunning: false,
		},
	]);
	assert.equal(ui.currentItem.name, "Backup App");
	ui.updateApps([]);
	assert.deepEqual(ids(ui), []);
});

test("empty queries retain usage ordering; calculator and URL actions keep priority", () => {
	const { ui } = fixture([item("a", "Alpha"), item("b", "Beta")]);
	ui.recordItemSelection(ui.customItems[1]);
	ui.setQuery("   ");
	assert.deepEqual(ids(ui), ["b", "a"]);
	ui.setQuery("2 + 2");
	assert.equal(ui.searchItems[0].type, "TEMPORARY_RESULT");
	assert.equal(ui.temporaryResult.value, "4");
	ui.setQuery("example.com");
	assert.equal(ui.searchItems[0].id, "open_url");
});
