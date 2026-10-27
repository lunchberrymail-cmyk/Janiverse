# Tutorial screenshots and recordings

These screenshots show Lumiverse's native controls in a local test instance. Group-chat examples use fictional Mira and Rowan demo cards; the lorebook example uses a fictional Lantern Café entry. Import screenshots use an empty assistant or synthetic Mira/Avery files, never an account export. Selected-file and history review screenshots stop before saving an import. The summary screenshot shows only the built-in Add Prompt menu, without the user's preset contents.

The `card-import-*` screenshots and the `card-import.webm` / `history-import.webm` recordings show actual browser actions in the test instance, including successful saves. They use the fictional Mira card and three-message conversation in `samples/`. The card uses the regular importer; history is a separate optional JAR Bridge flow. Screen sharing has no audio. File-picker waits are trimmed, the Home recent-chat area is masked, and a blank footer leaves room for the accompanying English WebVTT captions. These are recordings, not animated screenshots. Matching chapter times live in `src/tutorial-recordings.ts`.

Keep screenshots free of API keys, private conversations, browser account details, and imported character definitions. When native controls change, update the relevant image and its matching steps, alt text, and caption in `src/feature-tutorials.ts` and `src/tutorial-screenshots.ts`.

`api-connection.webm` and `api-connection-*` screenshots show the real native OpenRouter setup: a masked temporary key, live model refresh, selection of Free Models Router, creation and activation, and the successful native credential test. No chat generation was requested. Idle waits are trimmed and some actions slowed for readability. Recent-chat previews and the provider usage panel are masked; the key remains in a password field throughout. Captions and chapters accompany the recording. Neither the key nor account exports are included in these assets.

The Hone guide uses the public repository install field, the built-in Default model profile, the built-in Input Single Pass selector, and a fictional unsent draft. It does not show provider credentials or custom prompt text. No enhancement was run, and the sample draft was cleared after capture. Its captions and highlights live in `src/hone-screenshots.ts`.

`bun run build` embeds PNGs and short WebM recordings in the frontend bundle. The video player loads media only after an explicit Watch video or chapter click. No image/video hosting or external media requests are required.
