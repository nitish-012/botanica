# Botanica

**Live web app:** https://nitish-012.github.io/botanica/ (open in Safari → Share → Add to Home Screen)

## Privacy & security model
- **Your data never leaves your phone.** Plants, photos and journal entries are stored only in the phone's browser storage (IndexedDB). This repo and the website contain only the app's code and the generic care guide, never personal data.
- **One outside connection, only when you tap it.** A strict Content-Security-Policy lets the app talk only to its own files plus the U.S. National Weather Service (when you tap "Check weather", with your location rounded to ~1 km). There are no third-party scripts, fonts, analytics or other APIs.
- **Hardening:**
  - All user text is HTML-escaped.
  - Restored backups are validated as untrusted input.
  - The app refuses to run inside other sites' frames.
  - Search engines are told not to index it.
- **Supply chain:** CI actions are pinned to commit SHAs. Workflows can't be triggered by outsiders' pull requests. The site only publishes when every test passes.

## Tests (must pass before every publish)
```
node --test "tests/unit/*.test.js"   # logic, care-guide data, security & privacy scans (no dependencies)
node --test "tests/e2e/*.test.js"    # real browser at iPhone size, all outside network requests blocked
```
The end-to-end tests need Playwright (`npm i --no-save playwright@1.63.0 && npx playwright install chromium`). In CI they run automatically.

---

## Native iOS app (parked)

A personal, fully offline iOS plant care app (SwiftUI + SwiftData, iOS 17+).
No accounts, no cloud, no analytics. All data and photos stay on the phone.

## How it's built

There's no local Xcode. GitHub Actions builds the app on an Xcode 27 Mac, and Sideloadly installs it.

1. Push to `main`, or open **Actions → Build Botanica → Run workflow**.
2. When the run is green, download the **Botanica-ipa** artifact and unzip it to get `Botanica.ipa`.
3. Open Sideloadly on the Mac, then drag in `Botanica.ipa`. Use your Apple ID and keep the bundle ID `com.nitish.botanica`.
4. Re-sideload the same `.ipa` every 7 days (free Apple ID limit). App data is kept.

The workflow runs a **privacy guard** first. It fails the build if the app code contains AI-service references or API keys.

The `.xcodeproj` is generated from `project.yml` with [XcodeGen](https://github.com/yonaskolb/XcodeGen) and is not committed.

## Layout

```
project.yml                     XcodeGen spec (iOS 17, Swift 6)
.github/workflows/build.yml     CI: privacy guard → unsigned .ipa
Botanica/
├── App/                        @main + root view
├── Models/                     SwiftData: Plant, CareSchedule, CareLog, JournalEntry, HealthCheck
│   └── Reference/              Codable schema for plants_database.json
├── Services/                   ImageStorageManager (photos on disk), PlantLifecycle (safe deletes)
└── Resources/                  plants_database.json (bundled care guide)
```

Later steps add `Botanica/Features/` (screens), notifications, the on-device health scan,
and `Gateway/` (a local update server that runs on the Mac only when started).

## Data model

| Entity | Owns | Delete rule |
|---|---|---|
| Plant | CareSchedule, CareLog, JournalEntry, HealthCheck | cascade |
| CareSchedule | link to its CareLogs | nullify (history kept) |

Photo files are deleted through `PlantLifecycle`, never by deleting records directly.
