import { LegendList, type LegendListRef } from "@legendapp/list/react-native";
import { Assets } from "assets";
import clsx from "clsx";
import { FileIcon } from "components/FileIcon";
import { FocusableTextInput } from "components/FocusableTextInput";
import { Key } from "components/Key";
import { LoadingBar } from "components/LoadingBar";
import { MainInput } from "components/MainInput";
import { focusTextInput } from "lib/focusTextInput";
import { observer } from "mobx-react-lite";
import { type FC, useEffect, useRef } from "react";
import {
	Image,
	ScrollView,
	StyleSheet,
	Text,
	TouchableOpacity,
	type ViewStyle,
} from "react-native";
import { type TextInput, View } from "react-native-macos";
import { useStore } from "store";
import type { PasteItem } from "stores/clipboard.store";

interface Props {
	style?: ViewStyle;
	className?: string;
}

function isImageUrl(url: string | null | undefined) {
	if (!url) {
		return false;
	}
	return /\.(png|jpe?g|tiff?)$/i.test(url);
}

function toFileUri(path: string) {
	return encodeURI(`file://${path}`);
}

const RenderItem = observer(
	({ item, index }: { item: PasteItem; index: number }) => {
		const store = useStore();
		const selectedIndex = store.clipboard.selectedIndex;
		const isActive = index === selectedIndex;
		return (
			<View
				onDoubleClick={() => {
					store.clipboard.selectItem(item.id);
					store.clipboard.pasteCurrent();
				}}
			>
				<TouchableOpacity
					accessibilityRole="button"
					accessibilityLabel={item.text}
					accessibilityState={{ selected: isActive }}
					onPress={() => {
						store.clipboard.selectItem(item.id);
						store.clipboard.focusSearch();
					}}
					className={clsx("items-center flex-row rounded gap-2 p-2", {
						"bg-accent": isActive,
						"opacity-80": !isActive,
					})}
				>
					{item.source === "sol" ? (
						<Image
							source={
								store.ui.isDarkMode
									? Assets.logoMinimal
									: Assets.logoMinimalWhite
							}
							className="h-6 w-6"
							resizeMode="contain"
						/>
					) : isImageUrl(item.url) ? (
						<Image
							source={{ uri: toFileUri(item.url as string) }}
							className="h-6 w-6 rounded"
							resizeMode="cover"
						/>
					) : (
						<FileIcon
							url={decodeURIComponent(
								item.bundle?.replace("file://", "") ??
									item.url?.replace("file://", "") ??
									"",
							)}
							className="h-6 w-6"
						/>
					)}

					<Text
						className={clsx("text-xs text flex-1", {
							"text-white": isActive,
						})}
						numberOfLines={1}
					>
						{item.text.trim()}
					</Text>
					{store.clipboard.drafts.has(item.id) && (
						<Text
							className={clsx(
								"text-[11px]",
								isActive ? "text-white/70" : "darker-text",
							)}
						>
							Draft
						</Text>
					)}
				</TouchableOpacity>
			</View>
		);
	},
);

const TextPreview = observer(({ item }: { item: PasteItem }) => {
	const { clipboard } = useStore();
	const inputRef = useRef<TextInput>(null);
	const request = clipboard.focusRequest;
	useEffect(() => {
		if (request > 0 && clipboard.focusTarget === "preview")
			focusTextInput(inputRef.current);
	}, [request, clipboard]);

	return (
		<View
			className={clsx(
				"flex-1 rounded-lg overflow-hidden bg-white dark:bg-black/20 border",
				{
					"border-accent/50": clipboard.previewFocused,
					"border-transparent": !clipboard.previewFocused,
				},
			)}
		>
			<FocusableTextInput
				ref={inputRef}
				accessibilityLabel={
					clipboard.isEditing
						? "Temporary clipboard copy"
						: "Clipboard text, read only"
				}
				value={clipboard.previewText}
				editable={clipboard.isEditing}
				multiline
				scrollEnabled
				submitBehavior="newline"
				autoCorrect={false}
				spellCheck={false}
				autoCapitalize="none"
				enableFocusRing={false}
				mouseDownCanMoveWindow={false}
				className="flex-1 p-3 text-sm text"
				onFocus={() => clipboard.setPreviewFocused(true)}
				onBlur={() => clipboard.setPreviewFocused(false)}
				onChangeText={(text) => clipboard.updateDraft(item.id, text)}
				onSelectionChange={({ nativeEvent }) =>
					clipboard.setSelection(item.id, nativeEvent.selection)
				}
				keyDownEvents={[
					{ key: "Enter", metaKey: true },
					{ key: "c", metaKey: true },
				]}
				onKeyDown={({ nativeEvent }) => {
					if (!nativeEvent.metaKey) return;
					if (nativeEvent.key === "Enter") clipboard.pasteCurrent();
					if (nativeEvent.key.toLowerCase() === "c" && clipboard.hasSelection)
						clipboard.copyText();
				}}
			/>
		</View>
	);
});

export const ClipboardWidget: FC<Props> = observer(() => {
	const store = useStore();
	const { clipboard } = store;
	const data = clipboard.clipboardItems;
	const selectedIndex = clipboard.selectedIndex;
	const item = clipboard.currentItem;
	const listRef = useRef<LegendListRef | null>(null);

	useEffect(() => () => clipboard.endSession(), [clipboard]);
	useEffect(() => {
		if (data.length > 0)
			listRef.current?.scrollToIndex({ index: selectedIndex, viewOffset: 80 });
	}, [selectedIndex, data.length]);

	const suffix = clipboard.hasSelection ? " Selection" : "";
	const canCopy = (clipboard.actionText?.length ?? 0) > 0;

	return (
		<View className="flex-1">
			<View className="flex-row px-3">
				<MainInput placeholder="Search Pasteboard..." showBackButton />
			</View>
			<LoadingBar />
			<View className="flex-1 flex-row">
				<View className="w-64 h-full">
					<LegendList
						data={data}
						keyExtractor={(entry) => String(entry.id)}
						style={{ flex: 1 }}
						contentContainerStyle={STYLES.contentContainer}
						ref={listRef}
						recycleItems
						ListEmptyComponent={
							<View className="flex-1 justify-center items-center">
								<Text className="darker-text">[ ]</Text>
							</View>
						}
						renderItem={RenderItem}
					/>
				</View>
				<View className="flex-1 px-3 py-2">
					{item &&
						(!item.url ? (
							<TextPreview key={item.id} item={item} />
						) : (
							<ScrollView
								className="dark:bg-black/20 bg-white rounded-lg flex-1"
								contentContainerStyle={{ padding: 12 }}
							>
								{isImageUrl(item.url) ? (
									<View className="flex-1 items-center justify-center">
										<Image
											source={{ uri: toFileUri(item.url) }}
											style={{ width: "100%", height: 360 }}
											resizeMode="contain"
										/>
									</View>
								) : (
									<View className="flex-1 w-full items-center justify-center">
										<FileIcon
											url={`file://${item.url}`}
											className="h-20 w-20"
										/>
										<Text className="font-mono">{item.text}</Text>
									</View>
								)}
							</ScrollView>
						))}
				</View>
			</View>
			<View className="py-2 px-4 flex-row items-center justify-end gap-3 subBg border-t border-color">
				{clipboard.isEditing ? (
					<Text
						className="text-xs darker-text"
						accessibilityLabel="Temporary copy. Original history unchanged."
					>
						Temporary copy
					</Text>
				) : !clipboard.previewFocused && item ? (
					<TouchableOpacity
						accessibilityRole="button"
						onPress={clipboard.deleteCurrent}
						className="flex-row items-center gap-1"
					>
						<Text className="text-xs darker-text mr-1">Delete Item</Text>
						<Key symbol="⇧" />
						<Key symbol="⌫" />
					</TouchableOpacity>
				) : null}
				<View className="flex-1" />
				{item && !item.url && (
					<TouchableOpacity
						accessibilityRole="button"
						accessibilityLabel={
							clipboard.isEditing
								? "Discard temporary edits"
								: "Edit a temporary copy"
						}
						onPress={() =>
							clipboard.isEditing
								? clipboard.resetDraft()
								: clipboard.beginEditing()
						}
						className="flex-row items-center gap-1 px-2 py-1 rounded"
					>
						<Text className="text-xs darker-text mr-1">
							{clipboard.isEditing ? "Reset" : "Edit Copy"}
						</Text>
						{!clipboard.isEditing && (
							<>
								<Key symbol="⌘" />
								<Key symbol="E" />
							</>
						)}
					</TouchableOpacity>
				)}
				{item && !item.url && (
					<TouchableOpacity
						accessibilityRole="button"
						accessibilityLabel={`Copy${suffix || " whole text"}`}
						disabled={!canCopy}
						onPress={() => clipboard.copyText()}
						className={clsx("px-2 py-1 rounded", { "opacity-40": !canCopy })}
					>
						<Text className="text-xs text">Copy{suffix}</Text>
					</TouchableOpacity>
				)}
				<TouchableOpacity
					accessibilityRole="button"
					accessibilityLabel={`Paste${suffix || " whole item"}`}
					disabled={!item || (!item.url && !canCopy)}
					onPress={() => clipboard.pasteCurrent()}
					className={clsx("flex-row items-center gap-1 px-2 py-1 rounded", {
						"opacity-40": !item || (!item.url && !canCopy),
					})}
				>
					<Text className="text-xs text mr-1">Paste{suffix}</Text>
					{clipboard.previewFocused && <Key symbol="⌘" />}
					<Key symbol="⏎" primary />
				</TouchableOpacity>
			</View>
		</View>
	);
});

const STYLES = StyleSheet.create({
	contentContainer: { flexGrow: 1, paddingVertical: 6, paddingLeft: 8 },
});
