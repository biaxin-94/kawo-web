# kawo-web

Web page for กะวอ, the household LINE bot. Static files served by GitHub Pages; data comes from the
bot's Apps Script API, which checks the LINE login (LIFF ID token) and the person's role on every request.

- `index.html`, `style.css`, `app.js`: the page (Thai, mobile-first, light/dark)
- `config.js`: LIFF ID and API URL (public values, nothing secret)
- `?demo` shows sample data without logging in, for checking the layout

This repo is public on purpose (GitHub Pages). Never put tokens, keys or user IDs here.
