# Strength Log — your guide (version 3)

Strength Log is a workout app for your iPhone. It lives on your phone, works with no internet,
and tells you what your next gym session is, when it's due, and what weights to use.
It rotates between two training blocks: a **5×5 block** and a **3–5 block**.

---

## Getting version 3 onto your iPhone (if you already have an older version)

1. On your iPhone, make a backup first: **Settings → Export backup file → Save to Files**.
2. On your computer, go to <https://github.com> and open your **strength-log** repository.
3. Click **Add file** → **Upload files**.
4. Open **Documents → strength-log** in File Explorer, select **everything inside it** (Ctrl + A)
   and drag it into the browser window. GitHub replaces the old files with the new ones.
5. Click the green **Commit changes** button. Wait **2 minutes**.
6. On your iPhone (with internet), open Strength Log from the Home Screen.
   A banner says **"A new version of the app is ready"** → tap **Update now**.
   - No banner? Swipe the app away completely (swipe up from the bottom and flick it off the top),
     open it again and wait a few seconds. Repeat once if needed.
7. Check it worked: **Settings** → bottom of the page says **Strength Log 3.0.0**, and Home shows
   a line like "5×5 block — workout 11 of 24" under the title.

Your logged workouts stay exactly as they are and count toward your first 5×5 block.

---

## Part 1 — Put the app online (first time only, about 15 minutes, on your computer)

The app has to be on a web address once so your iPhone can install it. GitHub Pages hosts it for free.

1. **Make a GitHub account.** Go to <https://github.com/signup> and follow the steps
   (email, password, a username). Pick your username carefully: it becomes part of the app's address.
2. **Make a "repository" (a folder on GitHub).** When you're signed in, click the **+** at the top right
   → **New repository**.
   - Repository name: `strength-log`
   - Choose **Public** (free GitHub Pages needs this; no one will find it unless you share the link)
   - Leave everything else as it is → click **Create repository**.
3. **Upload the app files.** On the new page, click the link **uploading an existing file**.
   Open **Documents → strength-log** in File Explorer, select **everything inside it**
   (Ctrl + A) and drag it into the browser window. Wait until all the files are listed,
   then click the green **Commit changes** button at the bottom.
   - The list should include `index.html`, `sw.js`, `manifest.webmanifest` and the folders `css`, `js`, `icons`.
4. **Switch on GitHub Pages.** In your repository click **Settings** (top row) → **Pages** (left menu).
   Under **Branch**, choose **main** and **/ (root)** → click **Save**.
5. **Wait 1–2 minutes**, then refresh that page. It shows "Your site is live at
   `https://YOUR-USERNAME.github.io/strength-log/`". That is your app's address.

## Part 2 — Install it on your iPhone

1. Open **Safari** (it must be Safari) and type the address from step 5.
2. Tap the **Share** button (square with an arrow pointing up).
3. Scroll down, tap **Add to Home Screen** → **Add**.
4. Open Strength Log **from the new Home Screen icon** once while you have internet.
   After that it works in airplane mode.

> Always open it from the Home Screen icon. The icon and Safari keep separate data, so a workout
> logged in a Safari tab will not show up in the app.

---

## Part 3 — How to use it

### Home

- Under the title: **where you are in the block**, e.g. "5×5 block — workout 18 of 24" or
  "3–5 block — squat: 3×5 #4, deadlift: triples #1, bench: tested ✓, OHP: 3×5 #3".
- **Training day:** "Today: A — Heavy" with every lift, its weight and a short reason. Tap **Start**.
- **Rest day:** "Rest day — next: …, due Thu 19.11." with an optional link to the home kettlebell log.
  You can still train: tap **Start anyway** → **Train anyway**.
- **Coming up:** the next 3 sessions and the earliest day each one can happen.
- After **14 or more days** without a gym session you'll see "… days since last session — adjust
  weights if needed". Nothing changes on its own.
- **Block finished:** Home says "Block complete — Next: 3–5 block" (or 5×5). Tap the button to open
  the **block start screen**: what the block does, the starting values (change any you like), and **Start block**.

### Logging a workout

1. Tap **Start**.
2. After each set, **tap its circle**. It turns green and the 5-minute rest timer starts.
   - Fewer reps? **Tap again**: each tap takes off one rep (yellow).
   - More? **Press and hold** the circle and pick the number.
3. Different weight? Use **−/+** or type it. On heavy days the back-off set follows the top set (−10%)
   unless you change the back-off yourself.
4. Optional: **Warm-up cardio**, **Pull-ups 3×5**, **Extra exercises**, **Notes**.
5. Tap **Finish**. In the 3–5 block the app asks **"Was this tough?"** after each 3×5.

You can close the app mid-workout. It's saved as you go: next time, tap **Continue workout**.

### The blocks

Blocks rotate **5×5 → 3–5 → 5×5 → 3–5 …**, counted by **gym workouts, never by dates**.
Home Simple & Sinister sessions don't count. Deleting or editing a workout updates the counts.
Rest days, gaps and weight changes work the same in every block: one rest day (or more) between
gym sessions, nothing is ever skipped, and what you actually lift counts.

#### 5×5 block (24 gym workouts by default = 4 cycles)

| # | Session | What you do |
|---|---------|-------------|
| 1 | A — Volume | Squat, bench: 5×5 at volume weight |
| 2 | B — Volume | Deadlift, overhead press: 5×5 at volume weight |
| 3 | A — Heavy | Squat, bench: 1×5 heavy top set, then 1×5 back-off (top set −10%) |
| 4 | B — Heavy | Deadlift, overhead press: same as #3 |
| 5 | A — Unload | Squat, bench: 5×4 at 80% of the 5×5 weight you lifted this cycle |
| 6 | B — Unload | Deadlift, overhead press: same as #5 |

- **Volume:** all 5×5 done → next cycle +1 step (5 kg squat/deadlift, 2.5 kg bench/press).
  Missed reps → same weight, add reps next time.
- **Unload:** 80% of the weight you did 5×5 with this cycle (5×5 at 100 → unload 80 → next volume day 105).
- **Heavy:** top set 5 reps → +1 step next cycle. Missed → same. Missed **two cycles in a row** → heavy
  drops 10% (even below the volume weight) and builds back up one step per cycle.
- When a 5×5 block comes back, it carries on from the weights where the last 5×5 block ended.

#### 3–5 block (Pavel's 3–5 method)

A and B days alternate (A = squat + bench, B = deadlift + overhead press).
**Each lift moves on its own:**

1. **3×5**, starting at **65% of the lift's 1RM**, adding **2.5% of the 1RM** every session.
2. If a 3×5 was **tough** (you answer yes) **or** you got fewer than 5 reps in any set → **3×3** next,
   still adding 2.5% of the 1RM each session.
   If you miss a rep in a 3×3, you repeat that weight until you get all 3×3.
3. After **two full 3×3 sessions** → **1RM test**: work up to a conservative 1RM, perfect technique only.
   Log each attempt (weight, reps, clean or not). Your best clean attempt becomes the new 1RM.
   No clean attempt → the old 1RM stays.
4. That lift then **starts over** at 3×5 at 65% of its new 1RM, while the others finish their tests.

The block ends when **all four lifts have done a 1RM test**. Rest a full 5 minutes between sets.
The first time, the block start screen asks for a conservative 1RM per lift (bench is filled in with 105).
Later, it offers the 1RMs from your last tests.

### Other screens

**History**: every workout, newest first, tagged with its block (e.g. "3–5 block 1"). Tap one to see,
change or delete it. Everything recalculates.

**Progress**: per lift, a chart of your top set (all, or only volume / heavy / unload / 3–5 days),
your best sets, and your **1RMs** over time (entered and tested).

**Settings**:
- **Training block**: where you are, 5×5 block length (18, 24, 30 or 36 workouts), 3–5 start %
  (65–70) and step % (2–3), **Switch to the … block now**, and **Go back to the previous block**
  (offered until you log a workout in the new block).
- **5×5 working weights**: Volume, Heavy and Step can be changed. Back-off and Unload are calculated.
- **Round weights to**: 2.5 kg by default (pick 1.25 if you have small plates). Halfway values round down.
- **Rest timer**: 5 minutes by default.
- **Sequence**: set which session is next, if you need to.
- **Backup**: see below.

## Backups (important)

Your workouts are stored **only on your iPhone**. If the phone is lost or reset, they're gone unless you have a backup.

- **Settings → Export backup file** → in the iPhone menu choose **Save to Files** → pick **iCloud Drive**.
- The app reminds you on Home when it's time to make a new backup.
- To restore (e.g. on a new phone): **Settings → Import backup file** → pick the file.
  This replaces what's in the app with the backup. Backups from older versions work too.

## Good to know

- The rest timer beeps only if the iPhone's **ring/silent switch is on ring**. The app keeps the screen
  awake during a workout. If you lock the phone, the timer keeps counting but can't beep.
- Deleting the Home Screen icon deletes the app's data too, so export a backup first.

---

## Part 4 — Updating the app later

1. Ask Claude for the change. Claude edits the files in **Documents → strength-log** and **raises the
   version number** (in `sw.js` and `js/app.js`). That number change tells your iPhone there's an update.
2. Upload the files to GitHub exactly as in "Getting version 3 onto your iPhone" at the top (steps 2–5).
3. Open the app on your iPhone (with internet) and tap **Update now** on the banner.

Your workouts are not touched by updates.

---

## For whoever changes the code

- No build step and no dependencies. Plain HTML/CSS/JS modules.
- `js/logic.js` holds the training rules (pure functions). `js/app.js` holds the screens.
  `js/db.js` handles storage (IndexedDB).
- **Blocks:** `settings.blocks` lists started blocks (the last is current). Each gym workout is tagged
  with `block` (untagged = first block). Block progress counts workouts, never dates.
  `BLOCK_ROTATION` sets the order; `PROGRAM_BY_KIND` maps a block kind to its program object
  (`PAVEL_5X5`, `PAVEL_3_5`). To add a Power to the People! block later: write a program object
  (sessions, days, `sessionName`, `setsText`), its plan/replay functions, add it to `PROGRAM_BY_KIND`,
  `PROGRAM_BY_ID` and `BLOCK_ROTATION`, and a branch in `planSession` / `blockStatus` / `proposeNextBlock`.
- 5×5 weights replay over all 5×5 workouts across blocks (plus dated weight edits; block-start edits
  are tied to their block). 3–5 state replays only the current 3–5 block, from its start 1RMs.
- Recommendations are never stored: they're recalculated by replaying the logged workouts.
- v1/v2 data: entry type `light` is read as `unload`; v1 `deload: true` entries are ignored by the rules.
- Tests: `node --test` (`tests/logic.test.js` for the 5×5 rules, rest days and data; `tests/blocks.test.js`
  for blocks and the 3–5 method).
- Offline check: `node tools/offline-check.mjs` (needs Edge or Chrome).
- Run locally: `node tools/serve.mjs` → <http://localhost:8080/>.
- Releasing: bump `CACHE_VERSION` in `sw.js` and `APP_VERSION` in `js/app.js`. If you add a file, add it to `ASSETS` in `sw.js`.
