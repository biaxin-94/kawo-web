# kawo-web

Web app for กะวอ, the household LINE bot. Static files served by GitHub Pages; all data comes from
the bot's Apps Script API, which checks the LINE login (LIFF ID token) and the person's role on every
request, and refuses edits from anyone who isn't an editor.

- `index.html`, `style.css`: page shell (Thai, mobile-first, light/dark)
- `core.js`: login, API calls, app state, tabs, shared UI
- `views-fridge.js` (ตู้เย็น, เช็คของ), `views-shop.js` (ซื้อของ), `views-home.js` (งานบ้าน, ทำกิน),
  `views-settings.js` (ตั้งค่า)
- `config.js`: LIFF ID and API URL (public values, nothing secret)

Deploy together with the back end: back end first, then push this repo. `APP_VERSION` in `core.js`
must match the bot's `VERSION`.

This repo is public on purpose (GitHub Pages). Never put tokens, keys or user IDs here.
