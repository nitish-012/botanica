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

