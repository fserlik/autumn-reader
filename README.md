# Autumn Reader

A simple place to read and organize your books on desktop and Android. Sign in or register to enter, then read downloaded books offline. Local imports have no book-count limit, subject to your device's storage.

## Download

[Visit the download page](https://autumnreader.lat/#descargas) to install Autumn Reader. A Windows installer is currently available. macOS and Linux versions will appear there when they are ready.

## What you can do

- Keep your books in one library and quickly return to recent reads or favorites.
- Adjust the reading view and pick up where you left off.
- Select text to add colored notes that open from the page margin.
- Choose English, Spanish, Italian, or French in Settings.
- Choose which books to sync across devices within your cloud quota; share reviews and book lists.

Importing a book saves it locally. Use **Sincronizar** on a book to upload it to the private Cloudflare R2 bucket; its notes, progress and favorites then sync through Supabase. The server enforces cloud limits (initially 1,000 books and 1 GiB per account, configurable in SQL). EPUB/PDF files are never stored in Supabase Storage. Existing local books are preserved.

Developers: see the [cloud architecture and setup guide](docs/cloud-architecture.md) and [implementation report](AUTONOMOUS_RUN_REPORT.md). Configure Supabase's public environment variables before building: new sessions require an account. Email registration requests a unique username, persisted atomically in `profiles`. The local privacy page describes this version; publishing that page remains a manual step.

Private folders, global page spacing, offline EPUB/PDF search and temporary navigation history are available in the reader. Touch swipes reveal the adjacent page without saving preview progress. Selected text can be translated through a provider-independent service: apply migrations 008/009 and configure/deploy the optional `translate-text` Edge Function as described in the [translation setup and privacy guide](docs/translation-provider.md). No new frontend secrets are required.

Open source under the [MIT license](LICENSE).
