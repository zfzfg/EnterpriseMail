**Thanks for contributing to SnappyMail Webmail!**

1. Fork the repo, do work in a feature branch.
2. Issue a pull request.

---

**Getting started**

1. Install PHP
2. Install node.js - `https://nodejs.org/download/`
3. Install yarn - `https://yarnpkg.com/en/docs/install`
4. Install gulp - `npm install gulp -g`
5. Fork snappymail from https://github.com/the-djmaze/snappymail
6. Clone snappymail - `git clone git@github.com:USERNAME/snappymail.git snappymail`
7. `cd snappymail`
8. Install all dependencies - `yarn install`
9. Run gulp - `gulp`

---

**Debugging JavaScript**

1. Edit data/\_data_/\_default_/configs/application.ini
2. Set 'use_app_debug_js' (and optionally 'use_app_debug_css') to 'On'

---

**Editing HTML Template Files**

1. Edit data/\_data_/\_default_/configs/application.ini
2. Set `[cache] system_data` to Off

**Release and verification**

1. Use the Node version from `.node-version` and install with `npm ci --prefix ui`.
2. Run `node --test ui/test/*.test.mjs`, `npm run typecheck --prefix ui`, `npm run build --prefix ui`, and `npm run bundle:check --prefix ui`.
3. Run `bash scripts/ci/php.sh` and `bash scripts/ci/package.sh` with the supported PHP runtimes.
4. Package reviewed frontend artifacts deliberately with `php cli/release.php --frontend-dist`.
5. Before tagging, follow `docs/release.md`: the tag must be exactly `v` plus `package.json.version`, every published image architecture must pass its runtime test, and fresh-install/upgrade/rollback evidence must be recorded. Images belong only in this fork's GHCR namespace.

---

If you have any questions, open an issue or email support@snappymail.eu.
