# Tutorial screenshots

These screenshots show Lumiverse's native controls in a local test instance. Group-chat examples use fictional Mira and Rowan demo cards; the lorebook example uses a fictional Lantern Café entry. Import screenshots use an empty assistant or synthetic Mira/Avery files, never an account export. Selected-file and history review screenshots stop before saving an import. The summary screenshot shows only the built-in Add Prompt menu, without the user's preset contents.

Keep screenshots free of API keys, private conversations, browser account details, and imported character definitions. When native controls change, update the relevant image and its matching steps, alt text, and caption in `src/feature-tutorials.ts` and `src/tutorial-screenshots.ts`.

The Hone guide uses the public repository install field, the built-in Default model profile, the built-in Input Single Pass selector, and a fictional unsent draft. It does not show provider credentials or custom prompt text. No enhancement was run, and the sample draft was cleared after capture. Its captions and highlights live in `src/hone-screenshots.ts`.

`bun run build` embeds these PNGs in the frontend bundle. Tutorials load them locally when opened; no image hosting or external screenshot requests are required.
