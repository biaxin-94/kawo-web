# kawo-web: web app for กะวอ (public repo)

The LIFF web app for the กะวอ household LINE bot. Plain HTML/CSS/JS on GitHub Pages, no build step.
The back end (Google Apps Script, private repo `kawo-backend`) has the full project notes in its CLAUDE.md.

- `index.html`, `style.css`: page shell. `core.js`: login (LIFF), API calls, state, tabs, shared UI.
  `views-fridge.js` (ตู้เย็น, เช็คของ), `views-shop.js` (ซื้อของ), `views-home.js` (งานบ้าน, ทำกิน),
  `views-settings.js` (ตั้งค่า). `config.js`: public LIFF ID + `/exec` URL per environment.
- v11.0 households: every request carries `hh` (the household ID from the app link `?h=`, else the last one on
  the phone); phone storage is per household (`K.hkey`), and the admin-only ⚙️ ตั้งค่าบ้าน lives in
  `views-settings.js`. Household IDs are data too: never commit real ones here.
- v14.0: `K.write` shows the เลิกทำ bar (`K.undoBar`) when the server returns `data.undo`; pages with a draft set
  `unsaved()` / `discard()` on their tab so `K.go` asks before leaving. เช็กของ = `views-fridge.js` (draft `check.v1`).
- **This repo is public. Never put secrets here**: no tokens, keys, LINE user IDs, `?k=` webhook key.
  The server checks the LINE login and the role on every request; the page only hides buttons.

## Environments

| branch | URL | back end |
|---|---|---|
| `dev` | https://biaxin-94.github.io/kawo-web/dev/ (red "DEV" banner) | dev Apps Script project |
| `main` | https://biaxin-94.github.io/kawo-web/ (the family's app) | prod Apps Script project |

`config.js` picks the environment from the path (`/dev/`). `.github/workflows/pages.yml` publishes both
branches into one Pages site on every push.

## Rules

- Always work on `dev`. Never push to `main` directly: dev → `main` by pull request, after testing the
  dev page from the dev LINE OA (`แอป`).
- Deploy order per environment: back end first, then this repo. `APP_VERSION` in `core.js` must equal
  the back end's `VERSION`; bump the `?v=` numbers in `index.html` with it (phones cache old files).
- Local test without LINE: from the back end repo, `node tests/serve_e2e.js <this folder> . 5174`, then
  open `http://localhost:5174/?as=U1` (editor) or `?as=U3` (viewer).
