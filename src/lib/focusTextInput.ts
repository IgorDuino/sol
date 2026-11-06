import { findNodeHandle, type TextInput, UIManager } from "react-native-macos";

// TextInput.focus() skips non-editable fields. AppKit can focus a selectable,
// read-only preview, so send the native focus command for both clipboard fields.
export function focusTextInput(input: TextInput | null) {
	const tag = findNodeHandle(input);
	if (tag !== null) UIManager.dispatchViewManagerCommand(tag, "focus", []);
}
