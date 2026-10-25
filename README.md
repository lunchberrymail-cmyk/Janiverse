# Janiverse

A JanitorAI-inspired interface extension for **Lumiverse 1.2.5 or later**. Browse character cards, find your chats, and use familiar API, prompt, memory, and appearance controls while saving through Lumiverse's normal system.

Janiverse uses extension slots and styles. Your characters, chats, connections, presets, and wallpapers stay in Lumiverse; the extension does not replace its source or chat engine.

## Install

1. In Lumiverse, open **Extensions**.
2. Install an extension from a GitHub repository using `https://github.com/lunchberrymail-cmyk/Janiverse`.
3. Enable **Janiverse** and review its permissions in Lumiverse.

Compiled bundles are included in `dist/`; you do not need to build them yourself. Use Lumiverse's extension update control for later versions.

Upgrading from **Janitor Bridge**? Janiverse keeps the `janitor_bridge` identifier so existing installation settings and saved styles remain compatible.

## Features

- **Home:** portraits, Creator's Notes, search, favorites, sorting, and pagination. Profiles show full notes and images, with definition fields under Character details.
- **My Chats:** recent conversations, portraits, search, sorting, and expandable character groups. Continue opens the selected native chat; Start new chat creates a normal Lumiverse conversation.
- **API Settings:** Connection, Instructions, and Generation tabs. Configure OpenAI, OpenRouter, or an OpenAI-compatible proxy, or select an existing native provider.
- **Chat Memory:** edit the current conversation's native Author's Note.
- **Customize:** text preview, fonts, colors, background upload, opacity, blur, and text streaming. Uploaded backgrounds use Lumiverse's wallpaper library and the active chat's wallpaper setting.
- **Composer:** native message input, a persona picker, and optional draft enhancement, writing, and summary assistance.
- **Discovery banner:** optional introductions to embeddings and extensions. Import actions open the separate JAR Bridge extension when enabled.
- **SoundCloud:** cards with supported track attachments show a soundtrack bar. Clicking opens the official player in another tab, so no player scripts or audio run inside Lumiverse. Nothing autoplays.
- **Lumiverse tools:** reveal the native controls for advanced work.

## Cards and old chats

**[JAR Bridge](https://github.com/lunchberrymail-cmyk/JAR-Bridge) is a separate extension.** Install it to use the guided JanitorAI card and conversation importer from the banner or More menu. [JAR](https://github.com/alpha-omicron/JAR) itself is a separate application; Janiverse does not start it or sign into JanitorAI.

The general **Import card file or link** queue supports PNG, JSON, CHARX, and public links supported by Lumiverse's native importer. Without JAR Bridge, Import characters opens this queue. A plain portrait is not a character card, and a card alone does not include old conversation messages.

## Native settings and persistence

**Connections:** profiles, URLs, keys, and models use Lumiverse's normal connection data. Blank key fields keep a saved key; keys are never read back into this interface. Model lookup and connection tests contact the provider only when clicked. Applying to **This chat** sets its native binding; changing the default preserves chats with overrides. Editing a shared profile affects other chats using it.

**Prompts and generation:** the first save creates a native preset copy, preserving the source and advanced options. Later saves edit that copy with revision checks. Simple prompts can be edited directly; complex prompts keep their blocks and receive an additional instructions block. Character, persona, lorebook, variable, and advanced block behavior stay in the normal pipeline. Native bindings and custom request bodies can override effective generation values.

**Memory:** only `authors_note` changes; the native insertion depth and role remain intact. Raw or no-block prompts can omit the note, so the editor explains when conversion is needed.

**Appearance:** uploads accept static PNG/JPEG/WebP images, save to the wallpaper library, and update the active chat's wallpaper reference. Removing it restores normal fallback. Opacity and blur use native global wallpaper preferences. Text styling saves a native component-style override across chats. Safe Theme Mode and the emergency style-disable shortcut remain effective. No external fonts are downloaded.

**Streaming:** saves to a chat-bound native preset copy while preserving other options. Custom request bodies or raw chats that prevent the toggle from working show an explanation. Autoscroll follows Lumiverse's native behavior: scrolling upward pauses following new text.

Customize edits remain drafts until **Save**. Closing discards drafts; collapsing preserves them. Saved connections, presets, memory, wallpapers, and text styles remain available when Janiverse is disabled. The compatible native text-style override is named `JanitorBridgeChatAppearance`; manage or disable it in Lumiverse's component-style editor.

## Permissions and network activity

| Permission | Used for |
| --- | --- |
| Chats | Start conversations and save memory, wallpaper references, and chat-specific settings. |
| Generation | Save/select API profiles and run provider operations you choose. |
| Presets | Read/save native presets and bindings. |
| Personas | Use the composer persona picker. |
| Characters | Import selected files or public links through Lumiverse's native parser. |

Opening settings does not start generation, fetch models, test connections, or silently approve permissions. Card files stay local until **Import**; link sources are contacted during import. Source availability and native import settings still apply. The card queue does not sign into sites or retrieve private cards.

Writing assistance uses the selected native API and assembled chat context when requested. Suggestions need review before replacing an unsent draft. Summaries open as Chat Memory drafts and require **Save**. Cancelling or changing chats cancels pending work; an in-flight provider request may already have reached that provider.

## Development

Use [Bun](https://bun.sh/) 1.4.4 or later:

```sh
bun install
bun run build
bun test tests
```

`bun run test` builds and tests together. Development dependencies are only for tests; published bundles have no runtime package dependencies. Synthetic fixtures cover native-setting preservation, import permissions and failures, navigation, cleanup, composer behavior, and SoundCloud URL validation. No account exports or API keys are included.

## Remove

Disable **Janiverse** in **Extensions** to remove its interface, or use normal extension removal to uninstall it. Saved native data stays editable. Remove saved presets, wallpapers, or the text-style override separately if you want to discard those changes.

Unofficial community customization; not affiliated with JanitorAI or Lumiverse.
