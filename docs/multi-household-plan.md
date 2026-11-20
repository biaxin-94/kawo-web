# Multi-household support: plan (step 1)

Status: **plan only, nothing built yet.** Written from this repo (kawo-web). The back end
(`kawo-backend`, private) was not available in the planning session, so the back-end part below is
based on what the page sends and receives. Check it against `Code.js` before step 2.

## Goal

One กะวอ deployment (one LINE OA, one Apps Script project per environment, one web app) serves
several households. Each household's data stays separate. One person can be in more than one
household and switch between them. The current family keeps working with no change on their side.

Words used here: **household** = one LINE group plus its data. **hid** = the household's ID, a random
opaque string such as `h_7f3k9q`. It is not a secret: the server checks membership on every request.

## How it works today (what the page shows)

- Every request is `POST {api, idToken, args, reqId}` to one `/exec` URL. The server checks the LIFF
  ID token and returns `me` (`name`, `role`, `roleTh`), `version`, and parts of `state`.
- State is global, for one household: `items, list, chores, recipes, dict, members, freezeHints` and
  `meta` (`today, alertDays, locs, cats, types, household` = chore-owner names).
- Roles: `editor` / `viewer`, one owner (`members[].owner`) whose role can't be changed.
- The phone keeps data in localStorage that belongs to one household without saying which:
  `kawo.shop.v1` (ticks and a **pending** confirm), `kawo.cook.v1` (selection and a **pending**
  `useItems`), `kawo.freezeDismissed`. `kawo.tab` is not household data.
- Pending batches are re-sent with the same `reqId` when the page opens or the phone comes back
  online. The server applies each `reqId` once.

## Decisions to make first

| # | Question | Recommendation |
|---|---|---|
| D1 | Where does each household's data live? | **One spreadsheet per household**, plus one registry spreadsheet. Today's handlers keep working on "the spreadsheet" and just get a different one. Data can't leak between households through a missed filter. Easy to back up, export or delete one household. The other option (a `hid` column on every sheet) touches every read and write, and one missed filter shows another family's fridge. |
| D2 | Who can create a household? | **Invite only at first.** When the bot is added to a new group it records the group as `pending`, and the super admin (the current owner) approves it from the dev/prod settings or a chat command. That protects the Apps Script and LINE quotas (see Risks). Open sign-up can come later. |
| D3 | Dictionary and recipes: shared or per household? | **Per household, copied from a template** when the household is created. Households can then edit freely. A shared base list can come later if wanted. |
| D4 | How does the page know which household to open? | `?h=<hid>` in the link the bot sends in that group (the `แอป` reply). If there is no `h`: the household last used on this phone, else the person's only household, else a picker. |
| D5 | 1:1 chat with the bot (not in a group): which household? | The person's last-used household; if they have several, the reply says which one and offers quick-reply buttons to switch. |

## Changes in this repo (kawo-web)

1. **`core.js`: current household.** Add `K.hid`. At start, read `h` from the URL (after
   `liff.init`, since LIFF passes the query through `liff.state`), else `kawo.hh` from localStorage.
   Send it in every request body: `{api, idToken, hh: K.hid, args, reqId}`. The server answers with
   the hid it actually used (`res.hh`) and the person's households
   (`res.households = [{id, name, role}]`); `K.absorb` stores both and saves `kawo.hh`.
2. **Switcher.** In the header (`#who`), when there is more than one household: show the household
   name, tap to pick another in a `K.sheet`. Switching clears `K.S`, sets `K.hid`, calls `K.reload()`.
   With one household it looks like today, plus the household name next to 🏠 กะวอ.
3. **Phone storage per household.** Rename the keys to include the hid:
   `kawo.<hid>.shop.v1`, `kawo.<hid>.cook.v1`, `kawo.<hid>.freezeDismissed`. On first run with the new
   version, move the old un-prefixed keys to the first hid the server returns (that is the family),
   then delete them.
4. **Pending batches keep their household.** `shop.pending` and `cook.pending` store the `hh` they
   were made for, and the retry sends that `hh`, not `K.hid`. Otherwise switching household while a
   confirm is waiting would put one family's shopping into another family's fridge. Retries on start
   / `online` must check every household's pending keys, not only the open one. This is the most
   important correctness point on the page.
5. **New errors** in `ERRORS`: `no_household` (unknown hid or not a member: show the picker, or "ask
   the group to add you"), `household_pending` (waiting for approval).
6. **Roles stay per request.** `me.role` already comes from the server on each answer, so
   `K.canEdit()` needs no change; the server just works it out for the current household.
7. **Version** 10.x → 11.0 in `core.js` and every `?v=` in `index.html`, together with the back end.
8. **Local test.** The back end's `tests/serve_e2e.js` fixtures need two households, with one user in
   both: `http://localhost:5174/?as=U1&h=H2`.

Nothing in `views-*.js` changes except the storage keys and pending `hh` (3, 4) and the chore-owner
list, which already comes from `meta.household` per request.

## Changes in the back end (kawo-backend), outline

1. **Refactor without changing behaviour (do this first, ship it alone).** Every handler gets a
   `ctx = {hid, ss, userId, role, owner}` instead of reading the active spreadsheet, the owner and the
   group ID from globals or Script Properties. Cache keys (CacheService) and stored `reqId`s get the
   hid as a prefix. With one household this is a pure refactor; the e2e tests should pass unchanged.
2. **Registry spreadsheet.** `Households` (hid, name, groupId, spreadsheetId, ownerUserId, status
   `pending`/`active`/`closed`, created) and `Memberships` (hid, userId, name, role, lastSeen). The
   per-household `Members` sheet can move here, or stay in the household file with the registry as an
   index of userId → hids; pick one while doing step 1.
3. **Web API routing.** Check the ID token → userId. Pick the hid from `hh` (or D4's fallbacks) →
   check the membership → open that household's spreadsheet → run the existing handler. Unknown or
   not-member → `no_household`. Always answer with `hh` and `households`.
4. **Webhook routing.** `event.source.groupId` → hid. `join` event in an unknown group → create a
   `pending` household. On approval: copy the template spreadsheet, set the owner, reply in the group.
   1:1 chats follow D5. The `แอป` reply links with `?h=<hid>`.
5. **Scheduled jobs** (daily fridge alerts, chore reminders): loop over active households, push to
   each group, save progress so a run that hits the 6-minute limit continues next time.
6. **Migration.** The current family becomes the first household: its current spreadsheet is its
   `spreadsheetId`, the current group ID and owner move into the registry. Old links without `h` keep
   working because the family members have only that one household.

## Order of work

| Step | What | Where it runs first |
|---|---|---|
| 1 | This plan. Decide D1–D5. | — |
| 2 | Back-end refactor to `ctx` (no behaviour change), v10.1 on both sides. | dev, then prod |
| 3 | Registry, hid routing, membership checks, migration of the family. Page: `hh` in requests, per-household storage, pending keeps its `hh`, new errors. v11.0. | dev with 2 test households |
| 4 | Creating households: `join` event, approval, template copy. Page: switcher. | dev, with a second test LINE group |
| 5 | Scheduled jobs across households, quota checks. | dev, then prod |
| 6 | Prod: back end first, then dev → `main` pull request here, after testing from the dev LINE OA. | prod |

Each step is its own release. The family should see nothing change until step 6, and even then only
the household name in the header.

## Tests to add

- Server: a member of H1 asking for H2 gets `no_household` for every API, reads and writes.
- Server: a viewer in H1 who is an editor in H2 can write in H2 only.
- Server: the same `reqId` sent to H1 and H2 is applied once in each (or refused in one; decide).
- Page: a shopping confirm made in H1, page switched to H2, signal back → the batch lands in H1.
- Page: old un-prefixed localStorage is moved to the family's hid once and not again.
- Webhook: a message in group A never reads or writes group B's spreadsheet.

## Risks

- **LINE message quota.** The free OA plan has a monthly push limit, and a push to a group counts
  every member. More households multiply the daily alerts. Check the current plan and count before
  step 5; replies (to a message) are free, pushes are not.
- **Apps Script quotas** (consumer account): trigger runtime per day, `UrlFetch` calls per day, 6-min
  run limit, and `LockService` is shared by every household. Fine for a handful of households, not
  for many. D2 (invite only) keeps this under control.
- **Privacy.** The repo is public and stays free of hids of real households, group IDs and user IDs.
  Test fixtures use made-up IDs.
- **LIFF query.** Confirm on a real phone that `?h=` survives `liff.login()` redirects and opening
  from the LINE chat (`liff.state`) before relying on it; the localStorage fallback covers a miss.
