# Janiverse

A JanitorAI-inspired interface extension for **Lumiverse 1.2.5 or later**. Browse character cards, find your chats, and use familiar API, prompt, memory, and appearance controls while saving through Lumiverse's normal system.

Janiverse uses extension slots and styles. Your characters, chats, connections, presets, and wallpapers stay in Lumiverse; the extension does not replace its source or chat engine.

## Install

1. In Lumiverse, open **Extensions**.
2. Install an extension from a GitHub repository using `https://github.com/lunchberrymail-cmyk/Janiverse`.
3. Enable **Janiverse** and review its permissions in Lumiverse.

On a fresh installation, **Welcome to Janiverse → Open Janiverse Home** takes you to the familiar layout, even if Lumiverse was showing its native Characters page. Close the Extensions panel with its × if it is covering the page. You can reopen the guide through **More → Start here**. Zero permissions enabled is normal at first; grant access when you choose a feature that needs it.

Compiled bundles are included in `dist/`; you do not need to build them yourself. Use Lumiverse's extension update control for later versions.

Preview updates are published on **staging**. In the installed extension's controls, choose **Branch → staging**, then update/reload as Lumiverse prompts. Branch selection is a normal Lumiverse feature for GitHub-installed extensions. A manually copied folder without its own Git metadata cannot pull updates or switch branches; install from the repository to use those controls.

Upgrading from **Janitor Bridge**? Janiverse keeps the `janitor_bridge` identifier so existing installation settings and saved styles remain compatible.

## Features

- **Home:** the header displays **Janiverse** with a purple J-and-sparkle icon. Click the brand to return Home; disabling Janiverse restores the native header identity. Browse all your saved character cards, including cards you have never chatted with. Click a portrait or title to open a wide JanitorAI-style profile: a large portrait and open **Creator’s Note** on the left, with a prominent **Start new chat** action and separate purple **Character definition** panels on the right. Scenario, personality, all initial/alternate messages, and example dialogs each expand independently. On narrow windows, chat controls appear between the portrait and introduction. The heart on each card saves to Lumiverse's normal favorites; **All characters** and **Favorites** filter the gallery. Search, card sorting, and pagination help find saved cards. Opening a profile does not start a chat or change a card. Creator credits link to JanitorAI when a public profile is recorded; missing credits say **Creator not recorded**. Public notes and images remain separate from definition fields.
- **Card lorebooks:** green linked cards show the selected card's native attached lorebooks, including legacy single-book attachments. Click one to read its entries, search, and page through results. This reader makes no edits and needs no additional extension grant. Missing or inaccessible attachments show an empty state or retry instead of guessing a JanitorAI link. These are local saved books, so importing or attaching a missing source book remains a separate action.
- **Continue old chat:** opens a searchable, sortable picker of existing chats for this exact saved card. Reading the list does not create a chat; picking a row opens that existing conversation. Saved copies keep their own history. Empty lists and failed reads stay explicit and can be retried.
- **Greetings:** **Initial messages** shows one opening at a time. Use **‹ / ›** to cycle through the first message and every nonempty alternate greeting. The counter wraps at either end; one greeting leaves the arrows inactive. Previewing never edits the card, changes a chat's greeting, or starts a conversation.

  Repeated imports of the same card appear as one tile with a **saved copies** button. Open it and use **Saved copy** to choose an original record; each keeps its own chats, favorites, portrait and lorebook links. Cards with edited definitions, notes or prompts stay separate. Grouping never deletes or combines your saved data. Pagination counts grouped characters, so importing the same card on another page does not add another tile. Janiverse caches the lightweight card index and only compares full definitions for possible matches.
- **Create a Character:** General and Definition sections, with a live card preview, portrait upload, title, chat name, public bio/Creator's Note, personality, initial and alternate messages, scenario, example dialogs, tags, and creator credit. It saves a normal Lumiverse character and portrait; opening the form does not create a card or start a chat.
- **My Chats:** recent conversations, portraits, search, sorting, and expandable character groups. Creator's Notes have a compact rich preview and an explicit full-note toggle, keeping conversations within reach. Continue opens the selected native chat; Start new chat creates a normal Lumiverse conversation.
- **Settings:** chat settings contains the optional Global prompt and generation controls, with a persistent **Save prompt & generation** footer. The preset banner stays above them and links to Illarin and the Discord presets channel, with a separate server invite. Connections are managed in Lumiverse's native Connections drawer: open **API Settings** from the chat header or Home's More menu, or **1. Add API connection** from the Basics banner.
- **Chat Memory:** edit the current conversation's native Author's Note. Its memory banner opens native Summary or Memory Cortex setup without running generation.
- **Appearance:** a shared charcoal, pink, and violet palette follows the default JanitorAI visual style. Fraunces headings, Jura card titles, gradient card borders, and consistent buttons and form fields connect Home, My Chats, and Settings. The licensed fonts are bundled locally.
- **Customize:** text preview, fonts, colors, background upload, opacity, blur, and text streaming. Uploaded backgrounds use Lumiverse's wallpaper library and the active chat's wallpaper setting.
- **Composer:** Lumiverse's native chat toolbar is visible by default. **? / Help → Choose your chat layout → JanitorAI-style** switches to a simpler message box with a persona picker and extension discovery. The layout preference is saved for your account; switching keeps the native message input and unsent draft intact.
- **Home banner:** the first idea is **Let’s do the basics.**, with four direct setup shortcuts: **1. Add API connection**, **2. Add a card**, **3. Create a persona**, and **4. Preset or prompt (optional)**. Connect your AI, add a character, and create the persona you will chat as; the preset/prompt step can wait. Persona setup opens a guided form explaining who you play, with a name, optional description, and an editable example. Create saves a normal Lumiverse persona; the success screen offers Reload and open Personas so you can select it, add a portrait, or make it your default. The reload refreshes the host's persona list, including when personas already exist. Opening a shortcut alone never saves anything. **API connection guide** opens the recorded OpenRouter setup and credential test. **Card import guide** opens the import walkthrough. The first banner grows to fit its controls on phones. Later ideas introduce Summary and Memory Cortex, Lorebooks, group chats, voice and dictation, extension management, and **Shameless ads by Lunch**. Their **Full tutorial** opens an optional visual walkthrough showing one screen at a time, with a short click instruction, expected result, and highlights on actual Lumiverse controls. Use **Back / Next**, or choose **Play demo** to advance the screenshots automatically. Playback starts only when requested, respects reduced motion, and stops when hidden or closed. Prerequisites and troubleshooting stay collapsed. The group demo follows **New Group Chat**, cast selection, greeting, settings, persona, and turn controls using fictional demo cards. Close it to return to the same banner idea. The demo only displays instructions and images; named setup shortcuts open native controls when chosen.
- **Lunch’s picks:** **See Lunch’s picks** opens Lunch’s curated recommendations in their own window. The source-maintained list in `src/lunch-picks.ts` features [Choir](https://github.com/patatasbravasch-arch/Choir), [LumiBooks](https://github.com/AMousePad/LumiBooks), [Cue — Living Novel](https://github.com/japolino/cue-living-novel), [Pocket](https://github.com/kittyafterdark/Pocket), and [Prism](https://github.com/kittyafterdark/Prism), with short descriptions and public repository links. **Open Extensions** takes you to Lumiverse’s extension manager; viewing recommendations does not install anything.
- **SoundCloud:** cards with supported track attachments show a tiny music row with **Play / Pause**, **Stop**, and a **SoundCloud ↗** link. The first explicit Play click loads SoundCloud’s official Widget API and playback engine. The controls stay in the row without opening a popup. **Pause** keeps the track ready; **Stop**, leaving the chat, switching cards, or disabling Janiverse unloads playback. If browser playback requires another click, the row prompts you to press Play. The SoundCloud link stays available for external listening. Janiverse’s small controls use the standard official engine; SoundCloud’s own Mini embed has the [Artist Pro and individual-track limits documented here](https://help.soundcloud.com/hc/en-us/articles/115003449027-The-Mini-embedded-player).
- **Chat tools & help:** find explanations of useful native controls, open prompt/generation settings, Summary, Memory Cortex setup, Chat Memory, personas, or Lorebooks. **Find extensions** asks what you want to add and recommends Hone, LumiBooks, Choir, or Prism with repository links and installation steps. The compact **?** button opens this guide; layout choices stay under **Choose your chat layout**. **Chat Memory** stays in the menu and Memory tab without a duplicate shortcut beside the API status.
- **Chat menu:** Settings, Chat Memory, Customize, New Chat, and All Chats keep the familiar order and icons. Extra shortcuts live in Help. Lumiverse's public controls do not provide JanitorAI's Publish Chat action.

## Cards and old chats

**Add a card** and **More → Import characters** always open the regular file/link importer, including when JAR Bridge is installed. PNG, JSON, CHARX, and public links supported by Lumiverse's importer work without JAR or JAR Bridge. A portrait alone is not a character card, and a card does not include old messages.

**More → Import old chats (JAR Bridge)** is a separate, optional shortcut. It opens [JAR Bridge](https://github.com/lunchberrymail-cmyk/JAR-Bridge) when available, or explains the setup when it is absent. History files need the extension, but not the separate [JAR app](https://github.com/alpha-omicron/JAR). Live JanitorAI links through the bridge need JAR running and signed in on the computer hosting Lumiverse. Janiverse does not start JAR or sign into JanitorAI.

**API connection guide** on the Basics banner includes a real OpenRouter recording with a masked key, model refresh/selection, Create, activation, and More actions → Test connection. The native test validates credentials; model access still depends on the account and provider route.

**Card import guide** includes a real browser recording of the regular importer, English captions, chapter buttons, a transcript, and written steps with screenshots. **Need your old messages too?** opens the separate recorded history-file walkthrough. Recordings never autoplay; chapter buttons seek without operating the app, and playback pauses when hidden or closed. These short videos are bundled for offline use. Other feature guides still use their existing screenshot walkthroughs. The fictional practice files are in `assets/tutorials/samples`; they contain no credentials or account exports.

## Native settings and persistence

Chat settings share a compact side panel with **Settings**, **Memory**, and **Customize** tabs. Settings contains the optional Global prompt and generation sliders on one page; **Save prompt & generation** saves those preferences. Collapse keeps the current draft and scroll position; Close discards unsaved edits. Switching sections opens that section's saved settings. Navigation waits while a save is running.

**Connections:** profiles, URLs, keys, and models are managed through Lumiverse's native Connections drawer. Janiverse's API Settings shortcuts open that drawer directly. Removing the API section from chat settings does not change saved connections, keys, active models, or chat bindings.

**Named prompts:** enter **Prompt name** for a custom prompt or customized copy. **Save prompt & generation** saves that name with the instructions and generation settings. **Save as new prompt** keeps the previous version, creates a separate named preset, and applies it here. Find it under **Prompt source → Saved preset** to reuse it in another chat, or in Lumiverse's preset library. Later ordinary saves update the current Janiverse copy; importing or selecting an unchanged saved preset keeps the original intact.

**Prompts and generation:** choosing **Saved preset** applies the original native preset. Saving an unchanged selection makes no write; selecting a different preset updates its scoped binding without copying or changing the preset. Its linked regex, blocks, choices, variables, and generation values keep their native identity. These fields are read-only until you choose **Customize a copy**. That explicit action creates an editable scoped copy when saved; preset-linked regex remains attached to the original. Existing Janiverse copies can still be edited with revision checks. Native bindings and custom request bodies can override effective generation values.

The optional **Global prompt** section offers **Custom prompt · Default base** for pasted instructions or **Saved preset** for a complete saved/imported Loom preset. Choose Custom prompt, paste your instructions into **Your prompt**, then click **Save settings** (or **Save prompt & generation** in the Settings panel). Long prompts are supported. Custom mode prefers Lumiverse's installed built-in Default preset. If it is missing, ambiguous, or unavailable, an editable standard base keeps the character, persona, scenario, examples, memory, and chat history in the prompt; the editor explains when this fallback is used. Selecting Custom only prepares a draft. Saving creates or updates a normal scoped Lumiverse preset; it never edits the installed Default. Normal saved-preset selections use the original. Existing native presets remain selected until you choose another source. If an older Janiverse version created an unwanted copy, choose the original under Saved preset and save to restore its native binding; no presets are deleted automatically.

**How prompts and presets work** and **Prompt examples · Optional** expand only when requested. Examples append text only when clicked. **Manage / import presets** opens Lumiverse's Loom manager. Preset JSON files use its Import Loom JSON or Import Legacy JSON options. **Connect Illarin** opens Lumiverse's Illarin connection settings; after connecting this instance, send the preset from Illarin. These actions close the Janiverse panel so the native setup stays accessible. The preset banner uses ordinary links to [Illarin](https://illarin.com/browse?type=preset), the [Discord presets channel](https://discord.com/channels/1484149939167821915/1484156801447497792), and a separate [Discord invite](https://discord.gg/28rBWVFfCu); it does not prefetch pages, join the server, or import a preset automatically.

**Memory:** only `authors_note` changes; the native insertion depth and role remain intact. Raw or no-block prompts can omit the note, so the editor explains when conversion is needed.

**Appearance:** uploads accept static PNG/JPEG/WebP images, save to the wallpaper library, and update the active chat's wallpaper reference. On phones, Customize edits the mobile override and preserves the regular chat wallpaper. Existing video wallpapers also appear in the preview. Removing an override restores normal fallback. Opacity and blur use native global wallpaper preferences. Text styling saves a native component-style override across chats. Safe Theme Mode and the emergency style-disable shortcut remain effective. No external fonts are downloaded.

**Streaming:** follows the selected native preset. Normal saved presets are read-only here; edit them in Advanced Presets or explicitly customize a copy in Settings. Janiverse's existing chat-scoped copies can save streaming changes in place. Changing streaming never silently creates a preset. Custom request bodies or raw chats that prevent the toggle from working show an explanation. Autoscroll follows Lumiverse's native behavior: scrolling upward pauses following new text.

Customize edits remain drafts until **Save**. Closing discards drafts; collapsing preserves them. While saving, Close waits so the panel can report any partial failure. Saved connections, presets, memory, wallpapers, and text styles remain available when Janiverse is disabled. The compatible native text-style override is named `JanitorBridgeChatAppearance`; manage or disable it in Lumiverse's component-style editor.

## Mobile

The interface adapts to phone widths and landscape layouts. Menus and persona lists scroll, primary phone controls have larger touch targets, and settings follow Lumiverse's visible viewport and keyboard sizing. Persona search opens on demand on touch devices. Background and card uploads support tapping the file chooser. JAR itself still runs on a computer; importing exported files through Lumiverse is separate from running JAR.

Responsive checks in a desktop browser do not replace testing on physical iOS and Android devices, especially the on-screen keyboard and device file picker.

## Permissions and network activity

| Permission | Used for |
| --- | --- |
| Chats | Start conversations and save memory, wallpaper references, and chat-specific settings. |
| Generation | Save/select API profiles and run provider operations you choose. |
| Presets | Read/save native presets and bindings. |
| Personas | Use the composer persona picker. |
| Characters | Create cards and portraits, or import selected files or public links through Lumiverse's native parser. |

Opening settings does not start generation, fetch models, test connections, or silently approve permissions. Card files stay local until **Import**; link sources are contacted during import. Source availability and native import settings still apply. The card queue does not sign into sites or retrieve private cards.

In-chat SoundCloud playback needs the Lumiverse host to allow the official player frame and Widget API script from `https://w.soundcloud.com`. If loading is blocked or fails, Janiverse shows a message and keeps the **SoundCloud ↗** link available. Janiverse never edits the host policy automatically. The first Play click contacts SoundCloud to load its official API and playback engine; browsing cards does not load them. Playback state follows Widget API events without background polling.

**Help → Find extensions → Polish my writing** recommends [Hone](https://github.com/AMousePad/Hone), with its repository link and installation steps. Hone provides its own draft refinement and reply editing controls after installation and setup. It is optional; Janiverse’s discovery guide does not run Hone or request generation.

In the optional JanitorAI-style layout, the sparkle button opens **What are you looking for?** to discover useful extensions. Selecting a goal only shows a recommendation. **Copy link** and **Open Extensions** help you install it yourself; discovery never runs generation or edits your message draft.

## Development

Use [Bun](https://bun.sh/) 1.4.4 or later:

```sh
bun install
bun run build
bun test tests
```

`bun run test` builds and tests together. Development dependencies are only for tests; published bundles have no runtime package dependencies. Synthetic fixtures cover native-setting preservation, character creation, import permissions and failures, optional tutorials and modal cleanup, navigation, composer behavior, Hone handoff, and SoundCloud URL validation. Tutorial screenshots are bundled local assets. No account exports or API keys are included.

## Remove

Disable **Janiverse** in **Extensions** to remove its interface, or use normal extension removal to uninstall it. Saved native data stays editable. Remove saved presets, wallpapers, or the text-style override separately if you want to discard those changes.

Unofficial community customization; not affiliated with JanitorAI or Lumiverse.
