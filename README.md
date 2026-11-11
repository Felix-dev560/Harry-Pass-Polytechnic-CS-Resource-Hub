# Harry Pass Polytechnic CS Resource Hub

Past questions and semester handouts for ND 1, ND 2, HND 1 and HND 2, from 2021 to date.
Stack: static HTML/CSS/JS, Node 20+ with Express, Supabase (PostgreSQL), Cloudinary, hosted on Vercel.

## 1. Accounts to create (all free tiers)
1. Supabase project. Copy the project URL and the `service_role` key (Project Settings > API).
2. Cloudinary account. Copy cloud name, API key and API secret.
3. Vercel account and a GitHub repository for this folder.

## 2. Database
Supabase > SQL Editor > paste `db/schema.sql` > Run. This creates all tables, seeds the four levels,
and enforces the single-admin rule in the database.

The script is safe to run again. If your database was created before student photos had a semester,
running it again adds the `semester` column to `student_submissions`. Photos sent earlier keep an empty
semester and the dashboard shows them as "Semester not given".

**Run it again after this update, before you deploy.** It adds `admins.session_version`, which the server now reads
on every admin request. If the column is missing, the admin dashboard answers "Session expired" until you run it.

## 3. Environment variables
Copy `.env.example` to `.env` and fill every value. On Vercel, add the same names under
Project Settings > Environment Variables, and set `NODE_ENV=production`.
The server will not start if a required variable is missing, or if `JWT_SECRET` is shorter than 32 characters.
Keep `SUPABASE_SERVICE_ROLE_KEY` and `CLOUDINARY_API_SECRET` private.

`ADMIN_SETUP_KEY` (at least 16 characters) is the secret behind two things: creating the first admin account and
resetting a forgotten password. It is optional. Without it nobody can register or reset, but the existing admin can
still sign in. Add it on Vercel too, or "Forgot password?" will say recovery is not set up.

## 4. Run locally
```
npm install
npm run dev        # http://localhost:3000   admin at /admin/
```

## 5. Deploy
Push to GitHub, import the repo in Vercel, add the environment variables, deploy.
`npm run build` copies `public/` and `admin/` to `dist/`; `/api/*` runs `api/index.js` (the Express app).

## 6. First use
1. Open `/admin/` and choose the **Register** tab (it only appears while no admin exists and `ADMIN_SETUP_KEY` is set).
   Enter the setup key, your first name, last name, email and a password of at least 8 characters. You are signed in
   straight away. The setup key means that after a database reset nobody else can take the account by opening
   `/admin/` first.
   Only one admin account can ever exist. Once it is created, the Register tab is hidden and the server
   refuses any other registration, so everyone after that uses Sign in.
   **Forgot password?** On the sign-in page, open "Forgot password?", enter your email, the `ADMIN_SETUP_KEY`
   and a new password. All other devices are signed out. Changing the password from the dashboard also signs out every
   other device.
   Tick "Keep me signed in" on the sign-in form to stay signed in for 30 days. Without it, you are signed in
   for up to 8 hours and the session ends when the browser closes.
2. Dashboard > Courses and uploads: enter level, semester, code, title and year, and attach the past question and
   handout (PDF, Word or PowerPoint, up to 10 MB each). Anything missing is saved as pending.
3. Dashboard > Posts: open a course to add a post, edit the course, or edit, replace or delete a year.
   While you edit, a banner at the top of the form says whether you are editing a year or the course.
   The file chooser shows the file already uploaded. Pick another file from your device to replace it.
4. Dashboard > Student photos: photos are grouped by course code, semester and year. Download them, then delete them
   permanently. Any conversion to a document is done outside the site, with another tool.

## 7. Notifications (Web Push)
Needs one extra setup step.
1. Run `npm install` (adds `web-push`).
2. Generate keys once: `npx web-push generate-vapid-keys`. Put them in `.env` (and in Vercel's Environment Variables) as
   `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (for example `mailto:you@example.com`).
3. Supabase > SQL Editor > run `db/schema.sql` again. It adds the `push_subscriptions` table and `student_submissions.notified`.
4. Redeploy. Notifications need HTTPS, which Vercel provides (`localhost` also works for testing).

How it behaves:
- On every visit, each page checks whether the device is already set up. If not, a small bar with a toggle appears.
  Switching it on asks the browser for permission and saves the device. After that the bar no longer shows on that device,
  for as long as the site's data stays in the browser. The cross hides the bar for the current visit only.
- Admin: open the dashboard and switch the toggle on. Students sending photos trigger one alert per batch (all photos sent
  together for the same course, semester and year give a single alert). Tapping it opens Student photos.
- Students: when you post a handout and/or past question that was not there before, every subscribed student device gets an alert
  with the course code, title, level, semester, year and whether it is a handout, a past question, or both. Tapping it opens that
  course with the year scrolled into view and outlined. Replacing a file or editing a note does not send an alert.
- iPhone and iPad only deliver web notifications after the site is added to the Home Screen (Share > Add to Home Screen).

## Notes
- Students send photos from the Contribute page. The course code, semester and year are required. The course title is optional.
- Replace `public/assets/student-splash.jpg` with real campus photos. The 2-second splash shows when someone
  arrives at the home page. It does not show again in the same browser tab, so going Back to the home page
  does not flash it. Opening the site in a new tab or window shows it again.
- Student photos are compressed in the browser and capped at 4 MB, because Vercel rejects larger request bodies.
- Rate limits are in memory per serverless instance. They slow abuse but are not a hard global cap.
- `student_submissions.public_id` is an addition to the blueprint schema, needed to delete the exact Cloudinary image.
- Text uses the device system font. Only the developer name uses Dancing Script from Google Fonts. It is requested after the
  page has finished loading (see `loadSignatureFont` in `public/js/ui.js`), so it never delays the first paint.
- The level pages open the courses page directly. It has a First / Second semester toggle and loads both semesters at once.
  `semester.html` only redirects, so links students already shared keep working.
- Years: the hub starts at 2021 everywhere (course pages, the Contribute form and the server checks).
- Files on Cloudinary: when a year is deleted, a course is deleted, or a file is replaced or removed, the old file is deleted
  from Cloudinary too. Files left behind before that change can be cleaned up once with
  `node scripts/cleanup-orphans.js` (lists them only) and `node scripts/cleanup-orphans.js --delete` (removes them).