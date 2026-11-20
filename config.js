// Public settings for the page. Nothing here is secret: the API checks every request itself.
// Two environments, chosen by the page address (no build step):
//   https://biaxin-94.github.io/kawo-web/       -> prod (the family's app, opened from the prod LINE OA)
//   https://biaxin-94.github.io/kawo-web/dev/   -> dev  (the dev branch, opened from the dev LINE OA)
// LIFF_ID: LIFF app ID (LINE Login channel > LIFF tab). API_URL: that environment's Apps Script /exec URL,
// WITHOUT the ?k= webhook key.
(function () {
  var ENVS = {
    prod: {
      LIFF_ID: '2012605935-Ff8pkqrQ',
      API_URL: 'https://script.google.com/macros/s/AKfycbxWC0IDkCCdmTVcnJS0j_iBl9_Cu0kNstFWJ0IHe0S-_8ich4Cpi_xdJoxjp7XV7g1U/exec',
    },
    dev: {
      LIFF_ID: '',   // dev LIFF app ID: fill in after creating it (see CLAUDE.md checklist)
      API_URL: '',   // dev Apps Script /exec URL
    },
  };
  var env = /\/dev\//.test(location.pathname) ? 'dev' : 'prod';
  window.KAWO_CONFIG = Object.assign({ ENV: env }, ENVS[env]);
})();
