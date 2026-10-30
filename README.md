# ⚡ Deep Hours — NEET Study Logger & Coaching PWA

**Deep Hours** is an offline-first React 19 + TypeScript + Vite + Tailwind v4 Progressive Web App designed for NEET preparation. It works 100% offline using IndexedDB + localStorage with rolling safety backups, and optionally syncs across devices using a free **Firebase Spark-plan** project.

---

## Features

- **Precision Timestamp Study Timer & Android 16:9 PiP**: Pomodoro, Countdown, Stopwatch, and **Full Mock** (`200m` default with timestamped `"Next section"` splits) + Flow State Overtime.
- **NEET Coaching Suite**:
  - **Session-to-Chapter Link**: Link study sessions to syllabus chapters and track hours per chapter.
  - **Syllabus Pace Calculator**: Automatically computes required vs. actual weekly chapter completion pace against your primary exam countdown minus your revision buffer (`30` days default).
  - **Study-Next Engine**: Ranks your top 3 chapters to study next based on confidence (`1–5`), open mistakes, days since last touched, and completion status.
  - **Mistake Log, Doubt Queue & PYQ Tracker**: Track mock/practice mistakes by reason (`concept`, `silly`, `time`, `guess`, `forgot`), schedule 1-tap revisions, manage doubts, and log chapter-wise PYQ attempts & accuracy.
  - **Targets, Minimum-Day Streak & Consistency Score (0–100)**: Track daily/weekly subject hour targets, protect your minimum-day streak with monthly Rest Day passes, and monitor your 4-factor Consistency Score.
  - **Sleep, Energy & Gentle Burnout Check**: Log daily sleep hours (`0–14h`) and energy (`1–5`), with a dismissible burnout reminder when rest is needed.
  - **Weekly Review**: Full weekly coaching report with target comparisons, mock trends, sleep vs. focus insights, and 1-click clipboard summary.

---

## Setting Up Free-Tier Firebase (Spark Plan)

Deep Hours works completely offline without an account. To enable optional Google Sign-In and multi-device Cloud Sync on the **free Firebase Spark tier** ($0/month, no billing card required):

### 1. Create a Free Spark-Plan Firebase Project
1. Open the [Firebase Console](https://console.firebase.google.com/) and click **Create a project**.
2. Enter a project name (e.g., `deep-hours-sync`), disable Google Analytics if you don't need it, and confirm the project is on the **Spark (Free) Plan**.
3. In **Project Overview**, click the **Web (`</>`)** icon to register a web app and copy your `firebaseConfig` values.

### 2. Enable Google Sign-In
1. In the Firebase Console sidebar, go to **Build > Authentication** and click **Get started**.
2. Open the **Sign-in method** tab, select **Google**, toggle **Enable**, choose a support email, and click **Save**.

### 3. Add Your Vercel / Production Domain to Authorized Domains
1. Still in **Authentication > Settings > Authorized domains**, click **Add domain**.
2. Add your production domain (for example, `your-app-name.vercel.app`) alongside `localhost`.
   - *Note*: Deep Hours uses `signInWithPopup` on desktop and automatically falls back to `signInWithRedirect` on mobile/installed PWAs if popups are blocked. Both require your deployed domain to be listed in **Authorized domains**.

### 4. Create the Cloud Firestore Database
1. In the Firebase Console sidebar, go to **Build > Firestore Database** and click **Create database**.
2. Select a region close to you (e.g., `asia-south1` or `asia-east1`) and start in **Production mode**.

### 5. Deploy `firestore.rules`
1. Copy the contents of [`firestore.rules`](./firestore.rules) into **Firestore Database > Rules** in the Firebase Console and click **Publish** (or deploy via the Firebase CLI with `firebase deploy --only firestore:rules`):
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{userId}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == userId;
       }
     }
   }
   ```
2. This rule guarantees that each authenticated user can only read and write documents under `/users/{uid}/**`.

### 6. Configure Environment Variables (Optional Override)
By default, the app reads `/firebase-applet-config.json` when running in AI Studio, or `VITE_FIREBASE_*` environment variables on Vercel/local builds:
```env
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
VITE_FIREBASE_FIRESTORE_DATABASE_ID=(default)
```

---

## Development & Testing

```bash
# Start development server on port 3000
npm run dev

# Run unit tests (Node built-in test runner via tsx)
npx tsx --test src/utils/studyLogic.test.ts

# Type-check and build for production
npm run lint
npm run build
```
