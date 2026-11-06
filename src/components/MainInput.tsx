import { Assets } from "assets";
import clsx from "clsx";
import { focusTextInput } from "lib/focusTextInput";
import { observer } from "mobx-react-lite";
import { useEffect, useRef } from "react";
import { DevSettings, Image, Text, TouchableOpacity, View } from "react-native";
import type { TextInput } from "react-native-macos";
import { useStore } from "store";
import { Widget } from "stores/ui.store";
import { BackButton } from "./BackButton";
import { FocusableTextInput } from "./FocusableTextInput";

type Props = {
	placeholder?: string;
	showBackButton?: boolean;
	style?: any;
	className?: string;
	hideIcon?: boolean;
};

export const MainInput = observer<Props>(
	({ placeholder = "Search your mac...", showBackButton, hideIcon }) => {
		const store = useStore();
		const isDarkMode = store.ui.isDarkMode;
		const inputRef = useRef<TextInput>(null);
		const clipboardFocusRequest =
			store.ui.focusedWidget === Widget.CLIPBOARD
				? store.clipboard.focusRequest
				: -1;
		useEffect(() => {
			if (
				clipboardFocusRequest >= 0 &&
				store.clipboard.focusTarget === "search"
			)
				focusTextInput(inputRef.current);
		}, [clipboardFocusRequest, store]);
		const reloadApp = async () => {
			DevSettings.reload();
		};

		let leftButton = null;
		if (showBackButton) {
			leftButton = (
				<BackButton
					onPress={() => {
						store.ui.setQuery("");
						store.ui.focusWidget(Widget.SEARCH);
					}}
				/>
			);
		}

		if (!showBackButton) {
			leftButton = (
				<TouchableOpacity onPress={reloadApp}>
					<Image
						source={isDarkMode ? Assets.logoMinimal : Assets.logoMinimalWhite}
						style={{ width: 20, height: 20 }}
					/>
				</TouchableOpacity>
			);
		}

		if (hideIcon) {
			leftButton = null;
		}

		return (
			<View className="min-h-[42px] flex-row items-center gap-2 my-1 flex-1 px-2">
				{leftButton}
				<FocusableTextInput
					ref={inputRef}
					onFocus={() => {
						if (store.ui.focusedWidget === Widget.CLIPBOARD) {
							store.clipboard.setPreviewFocused(false);
							store.clipboard.clearSelection();
						}
					}}
					autoFocus
					enableFocusRing={false}
					value={store.ui.query}
					onChangeText={store.ui.setQuery}
					className={clsx("text-lg flex-1", {
						"text-white": isDarkMode,
						"text-black": !isDarkMode,
					})}
					placeholder={placeholder}
				/>
				{__DEV__ && (
					<TouchableOpacity onPress={reloadApp}>
						<Text>Debug</Text>
					</TouchableOpacity>
				)}
			</View>
		);
	},
);
