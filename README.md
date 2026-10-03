# [SC] [SOVEREIGN CODEX]

An offline-first Progressive Web App for writing and organizing a personal [SC] using the Iterative Formula and its two diagnostic sequences.

## Current scope

- Stores [SC] data in browser IndexedDB.
- Encrypts entry content and the Citizen signature with Web Crypto AES-GCM.
- Wraps the master key for password and recovery-phrase access using PBKDF2.
- Exports and imports portable `.sc` JSON backups.
- Structures entries as Catalyst, Friction, and Parameter, with Sequence A and Sequence B guidance.
- Provides a read-only reader for the bundled core archive, with a formatted Reader view, a Printed view of the original pages, System Term definition popups, and page identifiers.

The bundled `public/archive.md` reproduces *The [SYSTEM] Archive* by Ozma Calafia. The Archive is licensed under CC BY-NC-ND 4.0; its attribution and license notice are included in the reader. This license applies to the Archive text, not automatically to the application source code.

The recovery phrase uses the BIP-39 English word list and checksum, but the app uses the phrase directly as a vault secret. It is not a general-purpose wallet seed or an interoperable BIP-39 wallet backup.

## Data and privacy

Entry content is encrypted before storage. Entry titles and indexing metadata, including category, tags, and timestamps, are stored in readable form. Exported `.sc` files contain vault configuration, readable metadata, and encrypted entry payloads. Protect backups accordingly.

Data is stored in the browser and may be cleared or evicted. Keep a current `.sc` backup and the recovery phrase offline. There is no server-side account or sync service; moving a backup between devices is a manual export/import workflow.

## Development

Requirements: Node.js and npm.

```bash
npm install
npm run dev
```

Run the production build, lint checks, and tests:

```bash
npm run build
npm run lint
npm test
```

## Source link

The in-app source link uses this local `.env` setting:

```text
VITE_GITHUB_REPOSITORY_URL=https://github.com/OzmaCalafia/sovereign-codex
```

The link appears only for an HTTPS GitHub repository URL. `.env` is excluded from Git.

## Code map

- `src/App.tsx`: setup, access, backup actions, entry writing, and archive reading.
- `src/lib/crypto.ts`: recovery phrase generation, key wrapping (PBKDF2, 600,000 rounds), and content encryption.
- `src/lib/codex.ts`: Sequence A/B prompts and entry serialization/parsing.
- `src/lib/backup.ts`: validation of `.sc` backups before import.
- `src/ArchiveReader.tsx`, `src/archive/`, and `src/lib/archive.ts`: the Archive reader, System Term popups, and page-break handling.
- `public/archive.md` and `public/print/`: the unchanged Archive text, the printed page images, and `pages.json` (page identifiers and text anchors).
- `src/db/database.ts`: IndexedDB record types, schema, and local wipe operation.
- `src/main.tsx`: app startup, fonts, and browser storage persistence request.
