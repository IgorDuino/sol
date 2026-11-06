# Sol

![Header](Header.jpg)

<br/>
<div align="center">
  <a align="center" href="https://twitter.com/ospfranco">
    <img src="https://img.shields.io/twitter/follow/ospfranco?label=Follow%20%40ospfranco&style=social" />
  </a>
</div>

Sol is an open source app launcher, focused on ease of use and speed. It has minimal configuration and runs natively.

[Visit official site](https://sol.ospfranco.com)

## Download

Install via brew

```
brew install --cask sol
```

Or manually download the latest [release](https://github.com/ospfranco/sol/tree/main/releases).

## Discord

Join the Discord

https://discord.gg/W9XmqCQCKP

## Features

- App search
- Custom shortcuts
- Google translate
- Calendar
- Show upcoming appointement in Menu Bar
- Custom AppleScript commands
- Custom links
- Imports browser bookmarks
- Window Manager
- Emoji picker with emoji through [Emoji 17.0](https://unicode.org/Public/17.0.0/emoji/emoji-test.txt), macOS compatibility filtering, and a preferred skin tone
- Clipboard manager
- Notes Scratchpad
- Retrieve Wi-Fi password
- Show IP address
- Start a google meet
- Switch OS theme
- Process killer
- Generate NanoID
- Generate UUID
- Generate lorem ipsum
- Format and paste JSON
- Forward media keys to Spotify/Apple Music
- Blacken Menu Bar
- Quickly evaluate math operations
- Script Runner
- Symbolic Link Support

## Launcher search

Search matches any part of an item's name, its localized name, or its alias.
For example, `hrom`, `chrm`, and `chorme` find Google Chrome; `vsc` and `vscode`
find Visual Studio Code. Multiple words can appear in any order, and every word
must match. Search ignores case and accents.

Results prioritize exact names and aliases, then prefixes, word prefixes and
initials, substrings, compact letter sequences, and finally typos. Usage history
breaks ties between equally relevant matches. Short queries do not expand typos,
and longer queries allow at most two edits. No configuration is needed.

The existing MiniSearch index is cached until the item collection changes.
Run `bun test ./src` for calculator, search, clipboard, store integration, and emoji compatibility checks.

## Calculator

Type an expression into the launcher, then press Enter to copy its numeric result.
After copying, the search input is cleared for the next launch. Closing without
copying keeps a calculation available to continue.

Percentages work as discounts or increases with `+` and `-`: `(3.5 * 10 * 3000) - 6%`
returns `98700`, and `200 + 10%` returns `220`. With multiplication and division,
percentages are fractions: `200 * 10%` returns `20`. Normal operator precedence
applies; use parentheses to group percentage changes.

The calculator also supports decimal commas, spaced thousands, `× ÷ −`, powers
(`^`, `**`, `²`, `³`), implicit multiplication (`2(3+4)`, `2pi`), and existing math
functions such as `sqrt`, `min`, and `max`. Commas separate arguments in
multi-argument functions (`max(2,3)`); use decimal points in those arguments.
Incomplete expressions and non-finite results such as division by zero show no
calculator result.

## Clipboard preview

Click a history item to preview it; double-click or press Enter from search to paste.
Text previews support native selection and ⌘C. Copy and Paste use the selection,
or the whole text when nothing is selected. Copy keeps the window open.

Choose **Edit Copy** (⌘E) to make temporary changes. **Reset** restores the original.
Drafts survive switching items while the clipboard screen is open and disappear
when it closes. Original history entries stay unchanged; copying or pasting a
modified fragment records it as a separate entry, subject to normal deduplication.

Inside the preview, Enter inserts a newline while editing, ⌘Enter pastes, and
Escape returns to search. Tab switches between search and the preview.

## Emoji compatibility

Sol keeps its macOS 14.0 minimum and shows only emoji supported by the installed macOS version.
Newer entries carry a minimum macOS version in the bundled catalog:

| Emoji additions | Minimum macOS |
| --- | --- |
| Through Emoji 15.0 | 14.0 (Sol's minimum) |
| Emoji 15.1 | [14.4](https://support.apple.com/en-us/109035) |
| Emoji 16.0 | [15.4](https://support.apple.com/en-us/120283) |
| Emoji 17.0 | [26.4](https://support.apple.com/en-us/122868) |

Version checks compare numeric components and accept later releases automatically; no annual compatibility update is required for existing entries.
Unsupported emoji are excluded from browsing, search, and the seven-entry favorites row, but their saved usage counts are retained.
When those emoji become supported after an OS upgrade, they participate in the normal top-seven favorites ranking.

### Preferred skin tone

Set the preferred skin tone under Settings → General → Emoji Skin Tone.
Choose default yellow or one of five skin tones; the preference is saved as `emojiSkinTone` in `~/.config/sol/config.json`.

Browsing, search, favorites, and insertion use the selected tone wherever Unicode defines a matching variant.
Emoji without tone variants remain unchanged.
Changing the preference preserves favorites and usage counts, which remain associated with the original default emoji.
For multi-person emoji, the global preference applies the same tone to everyone where Unicode defines that variant; mixed tones and one-off overrides are not included.

Tone variants follow their own minimum macOS version, which can be newer than the default emoji.
For example, bunny-ear and wrestling emoji gained tones in Emoji 17.0 and require macOS 26.4 for those variants.
When the preferred variant is unsupported, Sol keeps the supported default emoji available.

## Contributing

You need to set up your machine for macOS development with React Native. Basically you need to install:

- Mise (https://mise.jdx.dev/)
- Xcode
- Cocoapods

Follow any of the online tutorials to set up your machine for iOS/MacOS React Native development.

Once you have everything installed run the following commands

```sh
mise plugin add cocoapods
# To enable hooks
mise settings experimental=true
# Will install all bun, ruby and run the installation of dependencies
mise install

# You can then run the app with
bun macos
```

## License

MIT License
