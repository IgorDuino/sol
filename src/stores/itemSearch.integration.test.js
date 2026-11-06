import { afterEach, mock, test } from "bun:test";
import assert from "node:assert/strict";
import { autorun, makeAutoObservable, runInAction } from "mobx";

const copyEvents = [];
const focusEvents = [];
const persistedClipboard = [];
const pendingClipboardReads = [];
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
		exists: (path) => !path.endsWith("/images_pasteboard"),
		ls: () => [],
		securelyRetrieve: async () => null,
		securelyStore: async (key, value) => persistedClipboard.push([key, value]),
		turnOffVerticalArrowsListeners: () => focusEvents.push("arrows off"),
		turnOffEnterListener: () => focusEvents.push("enter off"),
		turnOnVerticalArrowsListeners: () => focusEvents.push("arrows on"),
		turnOnEnterListener: () => focusEvents.push("enter on"),
		pasteToFrontmostApp: (text) => copyEvents.push(["paste", text]),
		pasteImageToFrontmostApp: (path) => copyEvents.push(["paste image", path]),
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
	readPersistedStore: () =>
		new Promise((resolve) => pendingClipboardReads.push(resolve)),
	writePersistedStore() {},
}));
mock.module("widgets/settings/general", () => ({
	isValidCustomSearchEngineUrl: () => true,
}));
mock.module("./emoji.store", () => ({ EMOJI_ROW_SIZE: 7 }));

const { createClipboardStore } = await import("./clipboard.store");
const { createUIStore, Widget } = await import("./ui.store");
const { createKeystrokeStore } = await import("./keystroke.store");
const cleanups = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup();
	copyEvents.length = 0;
	clipboardError = null;
	focusEvents.length = 0;
	persistedClipboard.length = 0;
	pendingClipboardReads.length = 0;
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

function clipboardFixture(texts = ["Original text", "Second item"]) {
	const { root, ui } = fixture();
	const clipboard = createClipboardStore(root);
	root.clipboard = clipboard;
	const keys = createKeystrokeStore(root);
	cleanups.push(
		() => clipboard.cleanUp(),
		() => keys.cleanUp(),
	);
	ui.focusWidget(Widget.CLIPBOARD);
	for (const text of [...texts].reverse())
		clipboard.onTextCopied({ text, bundle: "/fixture.app" });
	return { root, ui, clipboard, keys };
}
const key = (keyCode, extra = {}) => ({
	keyCode,
	meta: false,
	shift: false,
	...extra,
});
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("clipboard preview selects complete text, including the end of a long entry", () => {
	const text = `${"x".repeat(6000)}\n Привет 😀 end`;
	const { clipboard } = clipboardFixture([text]);
	const original = clipboard.currentItem;
	assert.equal(clipboard.previewText, text);
	clipboard.setPreviewFocused(true);
	clipboard.setSelection(original.id, { start: 6002, end: text.length });
	assert.equal(clipboard.actionText, "Привет 😀 end");
	clipboard.copyText();
	assert.deepEqual(copyEvents, [
		["copy", "Привет 😀 end"],
		["toast", "Copied to clipboard"],
	]);
	assert.equal(clipboard.currentItem.id, original.id);
	assert.equal(clipboard.previewText, text);
	assert.equal(clipboard.items[0].source, "sol");
	assert.equal(clipboard.items[0].text, "Привет 😀 end");
	// The native clipboard poller's echo must not create another record.
	clipboard.onTextCopied({ text: "Привет 😀 end", bundle: null });
	assert.equal(clipboard.items.length, 2);
	assert.equal(clipboard.items[0].source, "sol");
});

test("drafts are per item, allow empty text, and never change the original", () => {
	const { clipboard } = clipboardFixture();
	const original = clipboard.currentItem;
	clipboard.beginEditing();
	clipboard.updateDraft(original.id, "Temporary edit");
	clipboard.moveSelection(1);
	const second = clipboard.currentItem;
	clipboard.beginEditing();
	clipboard.updateDraft(second.id, "");
	assert.equal(clipboard.previewText, "");
	clipboard.copyText();
	clipboard.pasteCurrent();
	assert.deepEqual(copyEvents, []);
	clipboard.moveSelection(-1);
	assert.equal(clipboard.previewText, "Temporary edit");
	assert.equal(original.text, "Original text");
	clipboard.resetDraft();
	assert.equal(clipboard.previewText, "Original text");
	assert.equal(clipboard.isEditing, false);
	assert.equal(clipboard.drafts.has(second.id), true);
});

test("new entries and duplicate reordering do not replace a focused preview or its selection", () => {
	const { clipboard } = clipboardFixture();
	clipboard.setPreviewFocused(true);
	const original = clipboard.currentItem;
	clipboard.setSelection(original.id, { start: 0, end: 8 });
	clipboard.onTextCopied({ text: "Incoming text", bundle: null });
	clipboard.onTextCopied({ text: "Second item", bundle: null });
	assert.equal(clipboard.currentItem.id, original.id);
	assert.equal(clipboard.actionText, "Original");
	clipboard.setSelection(original.id, {
		start: 18446744073709552000,
		end: 18446744073709552000,
	});
	assert.equal(clipboard.actionText, "Original");
	clipboard.setSelection(clipboard.items[0].id, { start: 0, end: 1 });
	assert.equal(clipboard.actionText, "Original");
});

test("copy and paste use edited selection; failed copying preserves the draft for retry", () => {
	const { clipboard } = clipboardFixture();
	const original = clipboard.currentItem;
	clipboard.beginEditing();
	clipboard.updateDraft(original.id, "Edited payload");
	clipboard.setPreviewFocused(true);
	clipboard.setSelection(original.id, { start: 7, end: 14 });
	clipboardError = new Error("Clipboard unavailable");
	assert.throws(() => clipboard.copyText(), /Clipboard unavailable/);
	assert.equal(clipboard.items.length, 2);
	assert.equal(clipboard.previewText, "Edited payload");
	assert.equal(original.text, "Original text");
	clipboardError = null;
	clipboard.pasteCurrent();
	assert.deepEqual(copyEvents, [
		["copy", "payload"],
		["paste", "payload"],
	]);
	assert.equal(clipboard.items[0].text, "payload");
	assert.equal(original.text, "Original text");
});

test("filtered keyboard navigation and deletion use the visible item IDs", async () => {
	const { clipboard, ui, keys } = clipboardFixture([
		"Other text",
		"Alpha red",
		"Alpha blue",
	]);
	ui.setQuery("alpha");
	assert.equal(clipboard.clipboardItems.length, 2);
	const first = clipboard.currentItem;
	await keys.keyDown(key(125));
	const second = clipboard.currentItem;
	assert.notEqual(second.id, first.id);
	await keys.keyDown(key(125));
	assert.equal(clipboard.currentItem.id, second.id);
	await keys.keyDown(key(51, { shift: true }));
	assert.equal(
		clipboard.items.some(({ id }) => id === second.id),
		false,
	);
	assert.equal(
		clipboard.items.some(({ text }) => text === "Other text"),
		true,
	);
	assert.equal(clipboard.currentItem.id, first.id);
	ui.setQuery("Other");
	assert.equal(clipboard.currentItem.text, "Other text");
});

test("preview owns editing keys; Escape returns to search and keeps temporary edits", async () => {
	const { clipboard, keys, ui } = clipboardFixture();
	await keys.keyDown(key(14, { meta: true }));
	assert.equal(clipboard.isEditing, true);
	assert.equal(clipboard.focusTarget, "preview");
	clipboard.setPreviewFocused(true);
	const original = clipboard.currentItem;
	clipboard.updateDraft(original.id, "Draft");
	await keys.keyDown(key(59)); // control down
	for (const code of [36, 125, 126, 51, 38, 40, 45, 35]) {
		await keys.keyDown(key(code, { shift: true }));
	}
	assert.equal(clipboard.currentItem.id, original.id);
	assert.equal(clipboard.items.length, 2);
	assert.deepEqual(copyEvents, []);
	assert.deepEqual(focusEvents, ["arrows off", "enter off"]);
	await keys.keyDown(key(53));
	assert.equal(clipboard.previewFocused, false);
	assert.equal(clipboard.focusTarget, "search");
	assert.equal(clipboard.previewText, "Draft");
	assert.equal(ui.focusedWidget, Widget.CLIPBOARD);
	assert.deepEqual(focusEvents.slice(-2), ["arrows on", "enter on"]);
	await keys.keyDown(key(48));
	assert.equal(clipboard.focusTarget, "preview");
	clipboard.setPreviewFocused(true);
	await keys.keyDown(key(48));
	assert.equal(clipboard.focusTarget, "search");
});

test("leaving or hiding clipboard discards drafts, selection and native key overrides", () => {
	const { clipboard, ui } = clipboardFixture();
	const original = clipboard.currentItem;
	for (const leave of [
		() => ui.focusWidget(Widget.SEARCH),
		() => ui.onHide(),
	]) {
		ui.focusWidget(Widget.CLIPBOARD);
		clipboard.beginEditing();
		clipboard.updateDraft(original.id, "Draft");
		clipboard.setPreviewFocused(true);
		clipboard.setSelection(original.id, { start: 0, end: 5 });
		leave();
		assert.equal(clipboard.drafts.size, 0);
		assert.equal(clipboard.hasSelection, false);
		assert.equal(clipboard.previewFocused, false);
		assert.equal(clipboard.focusTarget, "search");
		assert.equal(
			clipboard.items.find(({ id }) => id === original.id).text,
			"Original text",
		);
	}
});

test("only original history is persisted; editing drafts performs no history writes", async () => {
	const { clipboard } = clipboardFixture();
	pendingClipboardReads.at(-1)({ saveHistory: true });
	await flush();
	assert.ok(persistedClipboard.length > 0);
	const initialWrites = persistedClipboard.length;
	const original = clipboard.currentItem;
	clipboard.beginEditing();
	clipboard.updateDraft(original.id, "secret temporary edit");
	clipboard.setPreviewFocused(true);
	clipboard.setSelection(original.id, { start: 0, end: 6 });
	await flush();
	assert.equal(persistedClipboard.length, initialWrites);
	const saved = JSON.parse(persistedClipboard.at(-1)[1]);
	assert.equal(
		saved.find(({ id }) => id === original.id).text,
		"Original text",
	);
	assert.equal(JSON.stringify(saved).includes("secret temporary edit"), false);
	clipboard.cleanUp();
	clipboard.onTextCopied({ text: "After cleanup", bundle: null });
	await flush();
	assert.equal(persistedClipboard.length, initialWrites);
});

test("clipboard file actions keep their native image and file behavior", () => {
	const { clipboard } = clipboardFixture([]);
	clipboard.onFileCopied({
		text: "photo.PNG",
		url: "/fixture/photo.PNG",
		bundle: null,
	});
	const imageId = clipboard.currentItem.id;
	clipboard.beginEditing();
	assert.equal(clipboard.isEditing, false);
	assert.equal(clipboard.actionText, undefined);
	clipboard.pasteCurrent();
	clipboard.onFileCopied({
		text: "/fixture/report.pdf",
		url: "/fixture/report.pdf",
		bundle: null,
	});
	clipboard.pasteCurrent();
	clipboard.selectItem(imageId);
	clipboard.pasteCurrent();
	assert.equal(clipboard.items[0].id, imageId);
	assert.deepEqual(copyEvents, [
		["paste image", "/fixture/photo.PNG"],
		["paste", "/fixture/report.pdf"],
		["paste image", "/fixture/photo.PNG"],
	]);
});

test("observed clipboard data changes reference when entries arrive without resetting the selected preview", () => {
	const { clipboard } = clipboardFixture();
	let data;
	cleanups.push(
		autorun(() => {
			data = clipboard.clipboardItems;
		}),
	);
	clipboard.setPreviewFocused(true);
	const selectedId = clipboard.currentItem.id;
	const previous = data;
	clipboard.copyText("new fragment");
	assert.notEqual(data, previous);
	assert.equal(data[0].text, "new fragment");
	assert.equal(previous.length, 2);
	assert.equal(clipboard.currentItem.id, selectedId);
});
