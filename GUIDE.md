# Strength Log — your guide (version 6)

Strength Log is a workout app for your iPhone. It lives on your phone, works with no internet,
and tells you what your next gym session is, when it's due, and what weights to use.
It rotates between two training blocks: a **5×5 block** and a **3–5 block**.
Alongside the gym plan it logs **home sessions** (kettlebell, bodyweight, custom), runs
Pavel's **Fighter Pullup Program**, and keeps a **weekly bodyweight log**. None of those ever
changes the gym plan. An optional **game layer** (XP, levels, belts and achievements) lives on the
Profile tab. Your **records** and a **Then vs now** card show how far you've come.

---

## Getting version 6 onto your iPhone (if you already have an older version)

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
7. Check it worked: **Settings** → bottom of the page says **Strength Log 6.0.0**, and
   **Profile** has an **Achievements** card.

Your logged workouts stay exactly as they are. Achievements, records and their XP for everything
you've already logged are worked out straight away.

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
4. At the top: **Ate before training?** Yes / No (tap again to clear). It's saved with the session
   for later analytics.
   Optional: **Warm-up cardio**, **Pull-ups**, **Extra exercises**, **Notes**.
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

### Home sessions

Tap **New home session** on Home. You can log **as many home sessions a day as you like**, and one
session can combine several presets (e.g. pull-up ladder + press ladders, or S&S + a plank):

- **Simple & Sinister**: warm-up (goblet squat ×5, halo ×5 each way, hip bridge ×5 — tick it when done
  and pick 1–3 rounds), swings (total reps + bell), get-ups (total reps + bell).
- **Kettlebell press ladders** (Rite of Passage press): bell, number of ladders and the rungs per arm
  (e.g. 3 ladders of 1-2-3). The card shows your last ladders with that bell, Pavel's goal for a bell
  (5 ladders of 1-2-3-4-5 per arm, then a heavier bell) and the long-term goal (press the 32 kg bell).
  It doesn't pick your next step for you.
- **Bodyweight**: pistol squat (per leg) and one-arm push-up (per arm) with sets × reps and a
  "variation" box (e.g. "to box"); hardstyle plank in sets × seconds (Pavel: 3–5 sets, no more than
  10 seconds, maximum tension).
- **Pull-ups**: today's pull-up session from your program (see below).
- **Custom**: any movement name, sets × reps, and a weight if you want.

**Swings and get-ups** have an optional **Time** box (minutes : seconds). Fill it in only when you
test Pavel's Simple standard (100 one-arm swings in 5:00, 10 get-ups in 10:00); it's what the
Simple and Sinister achievements check. The time isn't copied to your next session.

Every movement remembers what you did last time and fills it in. Use the **Sets** and **Reps** buttons
to change the plan. Tap a set to change or delete it.

**Grease the Groove:** tap **+1 set** whenever you do a practice set during the day. It adds a set like
the last one, with the time. Save after each one. Home lists **Today's home sessions**: tap one and
choose **Continue** to add more sets to it, or start a new session.

Home sessions never change the gym sequence, weights, rest days, due dates or block counts.

### Pull-up program (Pavel's Fighter Pullup Program)

**Set it up once:** Settings → **Pull-up program** → enter your current max strict pull-ups (dead hang,
full range) and, if you want, added weight. The screen tells you which program it picked:

- **Max 5–12:** the 5RM program starting at your max, e.g. max 8 → 8, 7, 6, 5, 4.
- **Max 13+:** the 15RM program: 12, 10, 8, 6, 4 (steps of 2).
- **Max 3–4:** Pavel's 3RM program, days 1–12 as published (day 1: 3, 2, 1, 1 … day 11: 5, 4, 3, 2, 1;
  days 6 and 12 off), then the 5RM program from 5, 4, 3, 2, 1.
- **Max 1–2:** no program. Log your pull-ups freely and retest your max later.

**Where to log:** on gym days the workout card shows "Pull-ups — today's ladder: 5, 4, 3, 2, 2"
(still optional), or add the Pull-ups preset in a home session. Only the **first** pull-up session
each calendar day counts. A later one is saved but marked "didn't count".

**How it moves on:**
- Each "week" is 5 pull-up sessions. Session 1 is the week's ladder; each next session adds one rep
  (two in the 15RM version) to one more of the last sets, e.g. 5,4,3,2,1 → 5,4,3,2,2 → 5,4,3,3,2 →
  5,4,4,3,2 → 5,5,4,3,2. Then the next week starts one rep higher on every set: 6,5,4,3,2.
- The day after every 5th session shows **"Pull-ups: day off"**.
- **Missed reps** → the same ladder next time, until it's done. Missed sessions don't count toward
  the week or the 25.
- After **25 completed sessions**: "Take a few rest days, then test your max." The next pull-up session is
  a **max test**. Your new max starts a new program.
- Stopped for a while? It just carries on where you left off. After 14+ days it shows how long it's been.
- For strength you can add weight (Pavel: enough to bring your reps down to about three). The ladders work the same.

Pull-ups never change the gym plan.

### Coming up

The **Coming up** card on Home lists your next sessions with their earliest dates. **Tap one** to see
its lifts, sets and planned weights (read-only; "Planned — weights can change after your next
sessions"). **Show more** lists the rest of this 6-session cycle and the next one.

### Weekly bodyweight

Once a week, log your bodyweight (kg, one decimal). It's best compared week to week: after waking and
using the bathroom, before eating. When 7 or more days have passed (or you've never logged one), Home
shows **"Log your bodyweight."** It disappears once you log it. Change or delete entries in History,
and see the chart under Progress → Body. Bodyweight never changes the gym plan.

### Game layer: XP, levels and belts (Profile tab)

Everything here is worked out from your log, including workouts you logged before v5. Edit or delete
a workout and the XP, level, belt and streak recalculate. Earned XP is never taken away.

| What | XP |
|---|---|
| Gym session | 4,000 |
| Gym session with a 1RM test (3–5 block) | 6,000 |
| Pull-up max test | 6,000 |
| Home session: 1st of the day / 2nd / 3rd and later | 1,200 / 600 / 0 |
| First pull-up ladder of the day (even with missed reps) | 800 |
| Bodyweight entry (once per 7 days) | 400 |
| Every 6th gym session in a 5×5 block (a cycle) | +4,000 |
| A block that ends on its own (not "Switch block now") | +20,000 |
| Pull-up program finished (25 ladders) | +12,000 |

**On-time bonus:** a gym session is due 2 days after the previous one.
- On the due day: the streak goes up by 1, and the session gets +5% per streak, up to +50% at 10 in a row.
- 1 day late: half the bonus, streak kept.
- 2 or more days late: no bonus, streak back to 0.
- Training on a rest day (before the due day): no bonus, streak paused.
- The bonus is shown separately, e.g. "4,000 + 1,200 on-time bonus (streak 6)".

**Levels** follow the exact Old School RuneScape table up to level 99 (level 50 = 101,333 XP,
level 99 = 13,034,431 XP); XP keeps counting after 99.
**Belts:** white from level 1, blue 83, purple 91, brown 95, black 98. Each belt has 4 stripes, at
20/40/60/80% of the way to the next belt. After level 99 the black belt earns a degree every
4,000,000 XP, up to 6. At level 99 your **level 99 badge** (the Strength cape) appears next to your name.

**Profile** shows your belt, level, XP to the next level, stripe and belt, your on-time streak and
bonus, and your last 20 XP entries with their breakdown. After you finish a session, a small card
shows the XP you earned and your level progress (tap to close).

**Game mode** (Settings): off hides the Profile tab (with achievements) and the after-session card,
so the app is a plain training log. Records and "Then vs now" stay. Your name for the Profile is set
there too.

### Achievements (Profile tab)

91 achievements in 13 groups, each with a **badge** and **XP**: Bronze 1,000 · Silver 2,500 ·
Gold 5,000 · Platinum 10,000 · Legendary 20,000. Like XP, they're worked out from your log every
time (also for workouts logged before v6): edit or delete a workout and they update.

- **Profile** shows your latest badges, how many you have, and the **3 closest** ones with a progress
  bar (e.g. "Bench 2 plates (100 kg): 97.5 / 100 kg — 97%").
- **All achievements** lists every one, grouped by category. Sort: **Easiest first** (Bronze →
  Legendary), **Hardest first**, **Closest first**. Filter: **All · Achieved · Not yet**.
- **Hidden** achievements only appear once you earn them.

How they're counted:
- **Lifts** count with any number of clean reps at the exact logged weight: ticked sets (with 1+ reps)
  and clean 1RM attempts.
- **Bodyweight ratios** use your bodyweight entry closest to the day of the lift. With no entry yet
  they wait until you log one.
- **Plate clubs**: 20 kg plates per side on a 20 kg bar (2 plates = 100 kg). **Total clubs**: best
  squat + best bench + best deadlift.
- **Program milestones**: first full 6-session cycle; first 5×5 block finished; first 3–5 block
  finished (all four lifts tested); **New 1RM** per lift = a 1RM test that beats the 1RM you went in
  with; **Perfect cycle** = all 6 sessions of a 5×5 cycle on their due date.
- **Consistency**: gym sessions (10 → 500); best on-time streak (6 → 48); **No Winter Break** = 8+
  gym sessions in each of November, December, January and February of one winter; **Year of Iron** =
  150 gym sessions within any 12 months.
- **Pavel discipline**: **Clean Block** = a finished block where every set was ticked with all its reps;
  **Iron Patience** = missed reps at the same weight 3 sessions in a row (same lift, same kind of
  day, e.g. volume), then all reps at that weight or heavier; **Rest Is Training** = a finished block
  with no session on a rest day.
- **Pull-ups**: program finished (25 ladders, then a max test); **Double your max** = twice the max
  you first set the program up with, in one set; strict reps in one set; weighted singles.
- **Kettlebell**: press ladders 5 × 1-2-3-4-5 per arm with 20 kg (or heavier) and with 32 kg; first
  32 kg press; 32 kg × 5; **Simple** / **Sinister** with the time box (see Home sessions), all in
  one home session for "Pavel's Simple" (32 kg) and "Sinister" (48 kg); lifetime swings and get-ups.
- **Bodyweight skills**: only pistols and one-arm push-ups logged **without a variation** count as
  full ones ("to box" etc. don't).
- **Endurance**: lifetime distance of the warm-up runs logged with gym sessions.
- **Tonnage**: weight × reps of every ticked gym set, clean 1RM attempt and extra exercise.
- **Habits**: bodyweight logged in 12 Monday–Sunday weeks in a row; "Ate before training?" = Yes at
  10 gym sessions in a row.
- **Hidden**: two of them. You'll find out.

### After a session

The card after finishing a session shows the XP you earned, any **new achievements** (with their
badge), any **new records**, your level progress and the **3 closest achievements**. Tap to close.
A bodyweight entry shows its XP and any new achievements in the message at the top instead.

### Other screens

**History**: at the top, **Then vs now**: per lift, your first logged top set → your best set ever
(e.g. "100 kg × 5 → 120 kg × 3, +20 kg"), and your first → latest bodyweight. Below it every
workout, home session and bodyweight entry, newest first; gym workouts are tagged with their block
(e.g. "3–5 block 1"). Tap one to see, change or delete it. Everything recalculates.

**Progress** has five parts:
- **Gym**: per lift, your top set over time (all, or only volume / heavy / unload / 3–5 days),
  best sets, and your **1RMs** (entered and tested).
- **Records**: the **record wall**: per lift, your best weight for a set of at least 1, 3 and 5 clean
  reps, with the day you first lifted it.
- **Home**: per movement, charts over time (swings & get-ups: bell and reps; press ladders: reps per
  arm and bell; bodyweight: best set; plank: longest hold) and your bests.
- **Pull-ups**: your program, total reps per session, and your maxes.
- **Body**: your bodyweight chart and all entries.

**Settings**:
- **Training block**: where you are, 5×5 block length (18, 24, 30 or 36 workouts), 3–5 start %
  (65–70) and step % (2–3), **Switch to the … block now**, and **Go back to the previous block**
  (offered until you log a workout in the new block).
- **5×5 working weights**: Volume, Heavy and Step can be changed. Back-off and Unload are calculated.
- **Round weights to**: 2.5 kg by default (pick 1.25 if you have small plates). Halfway values round down.
- **Pull-up program**: set it up, or change your max (this restarts the program; logged pull-ups are kept).
- **Game mode**: on/off, and your name for the Profile.
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
2. Upload the files to GitHub exactly as in "Getting version 6 onto your iPhone" at the top (steps 2–5).
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
- **Home sessions** (`js/home.js`): `kind: 'home'` workouts with `items: [{ move, … }]` (movements in
  `MOVES`, presets in `PRESETS`). v3 sessions with `swings`/`getups` fields are read by `homeItems()`.
  Sets added with "+1 set" carry a `time`; pre-fill copies only the planned (untimed) sets.
- **Pull-ups** (`js/pullups.js`): a session record `{ mode: 'ladder'|'test'|'free', ladder, sets, kg }` lives
  in `workout.pullups` (gym) or a home item with `move: 'pullups'`. `pullupState()` replays counted
  sessions (first per calendar day, logged after `settings.pullups.at`). `PULLUP_3RM_TABLE` holds the
  published 3RM program (12 entries, `null` = day off), as provided by the user.
- **Bodyweight** (`js/body.js`): `{ kind: 'bw', date, kg }` entries in the same workouts list.
- **Achievements** (`js/achievements.js`): `ACHIEVEMENTS` lists every definition
  `{ id, cat, tier, name, desc, hidden?, eval(F) }`; `achievementList()` builds the facts from the log
  once and evaluates each (earned `{ date, refId }`, `pct`, `text`, `note`). `gymTimeline()` holds the
  on-time rules shared with XP. Records (`recordWall`, `newRecords`) and `thenVsNow` live there too.
  Swings/get-ups items may carry `durationSec` (Simple standard). `settings.pullups.first` keeps the
  first setup when the program is restarted ("Double your max").
- **Game layer** (`js/xp.js`): `xpLedger()` derives every XP entry from the log (no stored totals),
  including one `kind: 'ach'` entry per earned achievement;
  `LEVEL_XP` is the OSRS table; `beltInfo()` gives belt, stripes and degrees. `settings.gameMode`
  hides it; `BADGE_99_SRC` in app.js points to the level-99 badge image (`icons/badge99.webp`).
- Nothing in home.js, pullups.js, body.js or xp.js is read by the gym logic.
- Tests: `node --test` (`tests/logic.test.js` for the 5×5 rules, rest days and data; `tests/blocks.test.js`
  for blocks and the 3–5 method; `tests/v4.test.js` for home sessions and pull-ups; `tests/v5.test.js`
  for XP, levels, belts, bodyweight and the v4 → v5 upgrade; `tests/v6.test.js` for achievements,
  records, then vs now and the v5 → v6 upgrade).
- Offline check: `node tools/offline-check.mjs` (needs Edge or Chrome).
- Upgrade check: `node tools/upgrade-check.mjs` fills the app's storage with realistic older data, starts
  the current app on it and checks every record is kept unchanged. Run it before every release.
- Run locally: `node tools/serve.mjs` → <http://localhost:8080/>.
- Releasing: bump `CACHE_VERSION` in `sw.js` and `APP_VERSION` in `js/app.js`. If you add a file, add it to `ASSETS` in `sw.js`
  (and update the file count in `tools/offline-check.mjs`).
