import { captureException } from "@sentry/react-native";
import { solNative } from "lib/SolNative";
import MiniSearch from "minisearch";
import { autorun, makeAutoObservable, runInAction } from "mobx";
import { Clipboard, type EmitterSubscription } from "react-native";
import type { IRootStore } from "store";
import { readPersistedStore, writePersistedStore } from "./persisted-config";
import { Widget } from "./ui.store";

const MAX_ITEMS = 1000;
const MANAGED_PASTEBOARD_IMAGES_PATH = `/Users/${solNative.userName()}/.config/sol/images_pasteboard`;

export type ClipboardStore = ReturnType<typeof createClipboardStore>;

export type PasteItem = {
	id: number;
	text: string;
	url?: string | null;
	bundle?: string | null;
	source?: "sol";
	datetime: number; // Unix timestamp when copied
};

type RankedPasteItem = PasteItem & {
	score?: number;
};

// Coarse relevance tier so the recency boost can only reorder items of
// comparable match quality, not let a fuzzy hit outrank a direct match.
const getMatchTier = (item: Pick<PasteItem, "text">, query: string) => {
	const q = query.trim().toLowerCase();
	if (!q) {
		return 0;
	}

	const text = item.text.toLowerCase();
	if (text.startsWith(q)) {
		return 0;
	}

	if (text.split(/\s+/).some((word) => word.startsWith(q))) {
		return 1;
	}

	return text.includes(q) ? 2 : 3;
};

function isManagedPasteboardImagePath(path: string | null | undefined) {
	return !!path && path.startsWith(`${MANAGED_PASTEBOARD_IMAGES_PATH}/`);
}

function removeManagedImageFile(item: PasteItem | undefined) {
	if (!item?.url || !isManagedPasteboardImagePath(item.url)) {
		return;
	}

	try {
		if (solNative.exists(item.url)) {
			solNative.del(item.url);
		}
	} catch (e) {
		captureException(e);
	}
}

function cleanupOrphanedManagedImageFiles(items: PasteItem[]) {
	try {
		if (!solNative.exists(MANAGED_PASTEBOARD_IMAGES_PATH)) {
			return;
		}

		const referencedPaths = new Set(
			items
				.map((item) => item.url)
				.filter((path): path is string => isManagedPasteboardImagePath(path)),
		);

		const files = solNative.ls(MANAGED_PASTEBOARD_IMAGES_PATH);
		for (const fileName of files) {
			const fullPath = `${MANAGED_PASTEBOARD_IMAGES_PATH}/${fileName}`;
			if (!referencedPaths.has(fullPath) && solNative.exists(fullPath)) {
				solNative.del(fullPath);
			}
		}
	} catch (e) {
		captureException(e);
	}
}

export const createClipboardStore = (root: IRootStore) => {
	let onTextCopiedListener: EmitterSubscription | undefined;
	let onFileCopiedListener: EmitterSubscription | undefined;
	let stopPersisting: (() => void) | undefined;
	let disposed = false;
	const minisearch = new MiniSearch({
		fields: ["text"],
		storeFields: ["id", "text", "url", "bundle", "datetime", "source"],
	});
	let lastId = 0;
	const nextId = () => {
		lastId = Math.max(Date.now(), lastId + 1);
		while (minisearch.has(lastId)) lastId++;
		return lastId;
	};
	const store = makeAutoObservable({
		deleteItem: (index: number) => {
			if (index >= 0 && index < store.items.length) {
				store.drafts.delete(store.items[index].id);
				removeManagedImageFile(store.items[index]);
				minisearch.remove(store.items[index]);
				store.items.splice(index, 1);
			}
		},
		deleteAllItems: () => {
			store.endSession();
			store.items.forEach(removeManagedImageFile);
			store.items = [];
			minisearch.removeAll();
		},
		// Session-only state. Original items are never edited or used as drafts.
		selectedId: null as number | null,
		drafts: new Map<number, string>(),
		selection: { start: 0, end: 0 },
		selectionItemId: null as number | null,
		previewFocused: false,
		focusTarget: "search" as "search" | "preview",
		focusRequest: 0,
		get selectedIndex(): number {
			const index = store.clipboardItems.findIndex(
				(item: PasteItem) => item.id === store.selectedId,
			);
			return Math.max(0, index);
		},
		get currentItem(): PasteItem | undefined {
			return store.clipboardItems[store.selectedIndex];
		},
		get previewText(): string {
			const item = store.currentItem;
			return item ? (store.drafts.get(item.id) ?? item.text) : "";
		},
		get isEditing(): boolean {
			return !!store.currentItem && store.drafts.has(store.currentItem.id);
		},
		get hasSelection(): boolean {
			return (
				store.selectionItemId === store.currentItem?.id &&
				store.selection.end > store.selection.start
			);
		},
		get actionText(): string | undefined {
			if (!store.currentItem || store.currentItem.url) return undefined;
			return store.hasSelection
				? store.previewText.slice(store.selection.start, store.selection.end)
				: store.previewText;
		},
		selectItem: (id: number | null) => {
			store.selectedId = id;
			store.clearSelection();
		},
		moveSelection: (delta: number) => {
			const items = store.clipboardItems;
			const index = Math.max(
				0,
				Math.min(items.length - 1, store.selectedIndex + delta),
			);
			store.selectItem(items[index]?.id ?? null);
		},
		clearSelection: () => {
			store.selection = { start: 0, end: 0 };
			store.selectionItemId = null;
		},
		setSelection: (id: number, selection: { start: number; end: number }) => {
			if (id !== store.currentItem?.id || !store.previewFocused) return;
			const { start, end } = selection;
			if (
				!Number.isInteger(start) ||
				!Number.isInteger(end) ||
				start < 0 ||
				end < start ||
				end > store.previewText.length
			)
				return;
			store.selection = { start, end };
			store.selectionItemId = id;
		},
		setPreviewFocused: (focused: boolean) => {
			if (store.previewFocused === focused) return;
			store.previewFocused = focused;
			if (focused) {
				// Pin the displayed item before a copy can prepend a new entry.
				store.selectedId = store.currentItem?.id ?? null;
				solNative.turnOffVerticalArrowsListeners();
				solNative.turnOffEnterListener();
			} else {
				solNative.turnOnVerticalArrowsListeners();
				solNative.turnOnEnterListener();
			}
		},
		focusSearch: () => {
			store.setPreviewFocused(false);
			store.clearSelection();
			store.focusTarget = "search";
			store.focusRequest++;
		},
		focusPreview: () => {
			if (!store.currentItem || store.currentItem.url) return;
			store.focusTarget = "preview";
			store.focusRequest++;
		},
		beginEditing: () => {
			const item = store.currentItem;
			if (!item || item.url) return;
			store.selectedId = item.id;
			if (!store.drafts.has(item.id)) store.drafts.set(item.id, item.text);
			store.focusPreview();
		},
		updateDraft: (id: number, text: string) => {
			if (id !== store.currentItem?.id || !store.drafts.has(id)) return;
			store.drafts.set(id, text);
			if (store.selection.end > text.length) store.clearSelection();
		},
		resetDraft: () => {
			if (store.currentItem) store.drafts.delete(store.currentItem.id);
			store.clearSelection();
			store.focusPreview();
		},
		copyText: (text?: string): void => {
			text ??= store.actionText;
			if (!text?.length) return;
			const selectedId = store.currentItem?.id ?? null;
			Clipboard.setString(text);
			store.selectedId = selectedId;
			store.onTextCopied({ text, bundle: null, source: "sol" });
			solNative.showToast("Copied to clipboard", "success");
		},
		pasteCurrent: (text?: string): void => {
			text ??= store.actionText;
			const item = store.currentItem;
			if (!item) return;
			if (item.url) {
				const index = store.items.findIndex(
					(entry: PasteItem) => entry.id === item.id,
				);
				if (index > 0) store.popToTop(index);
				if (/\.(png|jpe?g|tiff?)$/i.test(item.url))
					solNative.pasteImageToFrontmostApp(item.url);
				else solNative.pasteToFrontmostApp(item.text);
				return;
			}
			if (!text?.length) return;
			Clipboard.setString(text);
			store.onTextCopied({ text, bundle: null, source: "sol" });
			solNative.pasteToFrontmostApp(text);
		},
		deleteCurrent: () => {
			const index = store.items.findIndex(
				(item: PasteItem) => item.id === store.currentItem?.id,
			);
			store.deleteItem(index);
			store.selectItem(null);
		},
		endSession: () => {
			store.setPreviewFocused(false);
			store.drafts.clear();
			store.selectItem(null);
			store.focusTarget = "search";
		},
		items: [] as PasteItem[],
		saveHistory: false,
		onFileCopied: (obj: {
			text: string;
			url: string;
			bundle: string | null;
		}) => {
			const newItem: PasteItem = {
				id: nextId(),
				datetime: Date.now(),
				...obj,
			};

			// If save history move file to more permanent storage
			if (store.saveHistory) {
				// TODO!
			}

			// const index = store.items.findIndex(t => t.text === newItem.text)
			// // Item already exists, move to top
			// if (index !== -1) {
			//   // Re-add to minisearch to update the order
			//   minisearch.remove(store.items[index])
			//   minisearch.add(newItem)

			//   store.popToTop(index)
			//   return
			// }

			// Item does not already exist, put to queue and add to minisearch
			store.items.unshift(newItem);
			minisearch.add(newItem);

			// Remove last item from minisearch
			store.removeLastItemIfNeeded();
		},
		onTextCopied: (obj: {
			text: string;
			bundle: string | null;
			source?: "sol";
		}) => {
			if (!obj.text) {
				return;
			}

			const newItem: PasteItem = {
				id: nextId(),
				datetime: Date.now(),
				...obj,
			};

			const index = store.items.findIndex(
				(t: PasteItem) => t.text === newItem.text,
			);
			// Item already exists, move to top
			if (index !== -1) {
				// Re-add to minisearch to update the order
				minisearch.remove(store.items[index]);
				minisearch.add(store.items[index]);

				store.popToTop(index);
				return;
			}

			// Item does not already exist, put to queue and add to minisearch
			store.items.unshift(newItem);
			minisearch.add(newItem);

			// Remove last item from minisearch
			store.removeLastItemIfNeeded();
		},
		get clipboardItems(): PasteItem[] {
			const items = store.items;

			if (!root.ui.query || root.ui.focusedWidget !== Widget.CLIPBOARD) {
				// LegendList needs a new data reference when history changes.
				return items.slice();
			}

			// Boost recent items in search results
			const now = Date.now();
			const query = root.ui.query;
			const results = minisearch.search(query, {
				boostDocument: (_, __, storedFields) => {
					const dt =
						typeof storedFields?.datetime === "number"
							? storedFields.datetime
							: Number(storedFields?.datetime);
					if (!dt || Number.isNaN(dt)) return 1;
					// Boost items copied in the last 24h, scale down for older
					const hoursAgo = (now - dt) / (1000 * 60 * 60);
					if (hoursAgo < 1) return 1.2; // very recent
					if (hoursAgo < 24) return 1.1; // recent
					return 1;
				},
				prefix: true,
				fuzzy: true,
			}) as unknown as RankedPasteItem[];

			results.sort((left, right) => {
				const tierDiff = getMatchTier(left, query) - getMatchTier(right, query);
				if (tierDiff !== 0) {
					return tierDiff;
				}

				return (right.score ?? 0) - (left.score ?? 0);
			});

			return results;
		},
		removeLastItemIfNeeded: () => {
			if (store.items.length > MAX_ITEMS) {
				const removedItem = store.items[store.items.length - 1];
				store.drafts.delete(removedItem.id);
				removeManagedImageFile(removedItem);

				try {
					minisearch.remove(store.items[store.items.length - 1]);
				} catch (e) {
					captureException(e);
				}

				store.items = store.items.slice(0, MAX_ITEMS);
			}
		},
		popToTop: (index: number) => {
			const newItems = [...store.items];
			const item = newItems.splice(index, 1);
			newItems.unshift(item[0]);
			store.items = newItems;
		},
		setSaveHistory: (v: boolean) => {
			store.saveHistory = v;
			if (!v) {
				solNative.securelyStore("@sol.clipboard_history_v2", "[]");
			}
		},
		cleanUp: () => {
			disposed = true;
			stopPersisting?.();
			store.endSession();
			onTextCopiedListener?.remove();
			onTextCopiedListener = undefined;
			onFileCopiedListener?.remove();
			onFileCopiedListener = undefined;
		},
	});

	onTextCopiedListener = solNative.addListener(
		"onTextCopied",
		store.onTextCopied,
	);
	onFileCopiedListener = solNative.addListener(
		"onFileCopied",
		store.onFileCopied,
	);

	const hydrate = async () => {
		const persistedState = await readPersistedStore<{
			saveHistory?: boolean;
		}>("clipboard");

		if (persistedState) {
			store.saveHistory = persistedState.saveHistory ?? false;
		}

		if (store.saveHistory) {
			const entry = await solNative.securelyRetrieve(
				"@sol.clipboard_history_v2",
			);

			if (entry) {
				let items = JSON.parse(entry);
				// Ensure all items have datetime
				items = items.map((item: any) => ({
					...item,
					datetime:
						typeof item.datetime === "number" && !Number.isNaN(item.datetime)
							? item.datetime
							: item.id || Date.now(), // fallback: use id or now
				}));
				runInAction(() => {
					store.items = items;
					minisearch.addAll(store.items);
				});

				cleanupOrphanedManagedImageFiles(items);
			} else {
				cleanupOrphanedManagedImageFiles([]);
			}
		} else {
			cleanupOrphanedManagedImageFiles([]);
		}
	};

	const persist = async () => {
		if (store.saveHistory) {
			// Ensure all items have datetime before persisting
			const itemsToPersist = store.items.map((item: PasteItem) => ({
				...item,
				datetime:
					typeof item.datetime === "number" && !Number.isNaN(item.datetime)
						? item.datetime
						: item.id || Date.now(),
			}));
			try {
				await solNative.securelyStore(
					"@sol.clipboard_history_v2",
					JSON.stringify(itemsToPersist),
				);
			} catch (e) {
				console.warn("Could not persist data", e);
			}
		}

		try {
			writePersistedStore("clipboard", {
				saveHistory: store.saveHistory,
			});
		} catch {
			console.warn("Could not persist clipboard store config");
		}
	};

	hydrate().then(() => {
		if (!disposed) stopPersisting = autorun(persist);
	});

	return store;
};
