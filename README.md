# Anime Skip plugin for Seanime

This plugin connects Seanime to the Anime Skip GraphQL API and adds:

- Show search (`searchShows`)
- Auto-detection of the current anime from active playback
- Episode timeline loading (Intro/Credits/Preview/Recap)
- Live playback timeline with segment markers
- `Skip current segment` button

## Files

- `anime-skip.plugin.json` — plugin manifest
- `anime-skip.plugin.ts` — plugin source

## Setup

1. Copy both files into Seanime's `extensions` directory.
2. Ensure `payloadURI` in the manifest points to the absolute path of `anime-skip.plugin.ts`.
3. Load/reload the extension in Seanime.
4. Grant permissions requested by the plugin.

## Usage

1. Open the `Anime Skip` tray.
2. Keep endpoint as production (`https://api.anime-skip.com/graphql`) or switch to test.
3. Start playback of an episode in Seanime.
4. Click `Auto-detect and load current episode`.
5. If episode number cannot be detected automatically, enter only episode number and click auto-detect again.
6. Use `Skip current segment` when you are inside Intro/Credits/Preview/Recap.

## Manual fallback

- You can still provide `Show ID` and `Episode number` manually and click `Load episode timeline`.

## Notes

- The shared client ID is heavily rate-limited. Use your own client ID for long-term usage.
- The plugin renders a timeline bar with segment markers inside the tray (legend included).
- The plugin now resolves shows by title automatically, so normal usage is no longer dependent on manually copying IDs.
- Native player progress-bar marker injection is not exposed as a stable public plugin API yet, so this plugin provides a safe timeline view in tray and precise skip control.
