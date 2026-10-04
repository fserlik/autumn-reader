# Reader layout and dictionary

The Reader uses the existing EPUB.js and PDF.js engines. The current import model accepts EPUB and PDF only (`BookFormat` in `src/storage.ts`). FB2, MOBI, AZW3, TXT and CBZ have no importer or renderer in this branch; their controls must be added alongside their future format capabilities.

## Layout and progress

Global Font and Layout values live in the existing `autumn-page-spacing` local preference. They inherit the old global font preference once and default to the application values. A book stores only the fields it overrides under `autumn-book-page:<owner>:<book>`. The effective setting is `book override → global → application default`. These preferences are local; reading progress and notes retain their existing storage and sync behavior. No database migration is required.

EPUB layout changes and viewport rotations capture the current CFI before EPUB.js resizes, then redisplay that CFI after repagination. The saved percentage is held stable during this operation. PDF original pages retain their real page number and zoom; PDF text mode retains its page and text offset. EPUB shows a percentage rather than invented page counts. The two-column setting uses EPUB.js spreads; Auto considers available width and height, while an explicit two-column choice still needs enough width for readable pages.

Mobile Reader bars occupy compact rows and hide after six seconds without interaction. A neutral tap reveals them. Selection, links, scrolling, page swipes and dialogs keep their own gesture behavior. During an EPUB horizontal swipe, the adjacent page is prepared as soon as the gesture locks; committing the turn still requires the normal distance or flick threshold on release.

## Fonts

Integrated font choices remain available. On Windows, a Tauri command reads the current-user and machine font registration names and returns validated family names. It does not read arbitrary font files. The browser build can use `queryLocalFonts` when the browser supports and permits it. Android WebView does not provide an equivalent complete inventory of installed font families. The Android selector therefore offers the platform generic families; it does not claim to enumerate downloaded fonts. Only the currently chosen font is used for the preview.

## Dictionary

`DictionaryService.lookup(word, options)` separates the Reader from its sources. The primary lookup uses the MediaWiki parse API of the Wiktionary edition that matches the saved Autumn Reader interface language, so definitions and grammatical categories are shown in English, Spanish, Italian or French as configured. EPUB language metadata is used only to choose the correct word-language section; it does not change the definition language. Automatic mode falls back to the corresponding localized Wikipedia summary, and the panel also links to WordReference plus a language-specific reference dictionary. Users can explicitly choose Wiktionary or Wikipedia, and that source preference is stored on the device.

A lookup sends only the selected word and language code to the chosen Wikimedia project and requires Internet access; it uses no paid service, API key or new app dependency. Definitions are displayed as plain text. The UI reports offline, missing and provider-error states and keeps alternative dictionary links available.

Wiktionary content is licensed under CC BY-SA 4.0 and GFDL; the Reader attributes it and links to the entry. Wikimedia API access policy and rate limits apply. Sources: [Wiktionary copyrights](https://en.wiktionary.org/wiki/Wiktionary:Copyrights), [MediaWiki parse API](https://www.mediawiki.org/wiki/API:Parsing_wikitext), [Wikimedia REST API](https://www.mediawiki.org/wiki/Wikimedia_REST_API/en), [API access policy](https://www.mediawiki.org/wiki/Wikimedia_APIs/Access_policy), [rate limits](https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits).

## Text to speech

Desktop and browser builds use the Web Speech API inventory. Android uses a Tauri mobile bridge to `android.speech.tts.TextToSpeech`, because Android WebView does not expose Web Speech synthesis. Both paths prefer voices marked as local by the platform and fall back to the available inventory when the platform does not expose that distinction. “Find device voices” rescans the operating-system inventory; the application does not load arbitrary voice files. New voices must first be installed through the device settings.

The selected voice URI and reading speed are local device preferences stored under `autumn-tts-preferences`. The Reader speaks only the text visible on the current EPUB or PDF page, splits long passages into sentence-sized utterances and advances to the following page when the passage finishes. Its compact player exposes previous page, play/pause/resume, next page and speed controls. Android resumes by replaying the current short utterance because the native API exposes stop but no exact mid-utterance pause. Labels, live status text and voice previews follow the saved Autumn Reader interface language.
