import assert from "node:assert/strict";
import { afterEach, mock, test } from "bun:test";
import { autorun, makeAutoObservable, runInAction } from "mobx";

const copyEvents = [];
let clipboardError = null;

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
	Clipboard: {
		setString(value) {
			if (clipboardError) throw clipboardError;
			copyEvents.push(["copy", value]);
		},
	},
}));
mock.module("react-native-restart-newarch", () => ({ default: {} }));
mock.module("lib/SolNative", () => ({
	solNative: {
		userName: () => "fixture",
		exists: () => true,
		addListener: () => ({ remove() {} }),
		getApplications: async () => [],
		showToast: (message) => copyEvents.push(["toast", message]),
		hideWindow: () => copyEvents.push(["hide"]),
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
mock.module("widgets/settings/general", () => ({
	isValidCustomSearchEngineUrl: () => true,
}));
mock.module("./emoji.store", () => ({ EMOJI_ROW_SIZE: 7 }));

const { createUIStore } = await import("./ui.store");
const { createKeystrokeStore } = await import("./keystroke.store");
const cleanups = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup();
	copyEvents.length = 0;
	clipboardError = null;
});

function fixture(items = []) {
	const root = { scripts: makeAutoObservable({ scripts: [] }) };
	const ui = createUIStore(root);
	root.ui = ui;
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

test("calculator results update while typing and clear when the expression becomes incomplete", () => {
	const { ui } = fixture();
	ui.setQuery("(3.5 * 10 * 3000) - 6%");
	assert.equal(ui.temporaryResult.value, "98700");
	assert.equal(ui.searchItems[0].type, "TEMPORARY_RESULT");
	ui.setQuery("(3.5 * 10 * 3000) -");
	assert.equal(ui.temporaryResult, null);
	assert.ok(!ui.searchItems.some(({ type }) => type === "TEMPORARY_RESULT"));
	ui.setQuery("0,1 + 0,2");
	assert.equal(ui.temporaryResult.value, "0,3");
	ui.setQuery("1/0");
	assert.equal(ui.temporaryResult, null);
});

test("Enter copies the calculation, clears the input, and reopening starts empty", async () => {
	const { ui, root } = fixture();
	const keys = createKeystrokeStore(root);
	cleanups.push(() => keys.cleanUp());
	runInAction(() => {
		ui.isAccessibilityTrusted = true;
		ui.hasFullDiskAccess = true;
	});
	ui.setQuery("(3.5 * 10 * 3000) - 6%");
	await keys.keyDown({ keyCode: 36, meta: false, shift: false });
	assert.deepEqual(copyEvents, [
		["copy", "98700"],
		["toast", "Copied to clipboard"],
		["hide"],
	]);
	assert.equal(ui.query, "");
	assert.equal(ui.temporaryResult, null);
	ui.onHide();
	ui.onShow({});
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(ui.isVisible, true);
	assert.equal(ui.query, "");
	assert.equal(ui.temporaryResult, null);
});

test("closing without copying preserves a calculation for continuing later", () => {
	const { ui } = fixture();
	ui.setQuery("200 - 10%");
	ui.onHide();
	assert.equal(ui.query, "200 - 10%");
	assert.equal(ui.temporaryResult.value, "180");
});

test("failed copying keeps the calculation available for retry", async () => {
	const { ui, root } = fixture();
	const keys = createKeystrokeStore(root);
	cleanups.push(() => keys.cleanUp());
	ui.setQuery("200 - 10%");
	clipboardError = new Error("Clipboard unavailable");
	await assert.rejects(
		keys.keyDown({ keyCode: 36, meta: false, shift: false }),
		/Clipboard unavailable/,
	);
	assert.equal(ui.query, "200 - 10%");
	assert.equal(ui.temporaryResult.value, "180");
	assert.deepEqual(copyEvents, []);
});

test("copying a unit conversion also clears its previous query", async () => {
	const { ui, root } = fixture();
	const keys = createKeystrokeStore(root);
	cleanups.push(() => keys.cleanUp());
	ui.setQuery("10 km to m");
	assert.ok(ui.temporaryResult);
	await keys.keyDown({ keyCode: 36, meta: false, shift: false });
	assert.equal(copyEvents[0][0], "copy");
	assert.ok(copyEvents[0][1].includes("10000"));
	assert.equal(ui.query, "");
	assert.equal(ui.temporaryResult, null);
});
