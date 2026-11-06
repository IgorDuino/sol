import { cssInterop } from "nativewind";
import { createElement, forwardRef } from "react";
import { TextInput, type TextInputProps } from "react-native-macos";

// NativeWind 4 drops refs on React 19 function components. Keep a forwardRef
// boundary, then render the native input without a second JSX interop wrapper.
export const FocusableTextInput = forwardRef<TextInput, TextInputProps>(
	function FocusableTextInput(props, ref) {
		const nativeProps = { ...props, ref, cssInterop: false };
		return createElement(TextInput, nativeProps);
	},
);

cssInterop(FocusableTextInput, {
	className: { target: "style", nativeStyleToProp: { textAlign: true } },
});
