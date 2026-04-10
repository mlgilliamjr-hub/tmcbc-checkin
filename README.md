# TMCBC Sunday Check-In App
### The Mount Carmel Baptist Church — 3200 East Broad Street, Richmond, VA

---

## DEPLOYMENT GUIDE — Read This First

This is a 3-step process. Estimated time: 15–20 minutes.

---

## STEP 1 — Get Your Planning Center Credentials (5 min)

1. Go to: https://api.planningcenteronline.com/oauth/applications
2. Log in with your Planning Center admin account
3. Click **"New Application"**
4. Name it: `TMCBC Sunday Check-In`
5. Copy your **App ID** and **Secret** — you'll need these in Step 3

---

## STEP 2 — Deploy to Vercel (5 min)

1. Create a free account at https://vercel.com (sign up with Google for fastest setup)
2. Once logged in, click **"Add New Project"**
3. Choose **"Upload"** (you do NOT need GitHub for this)
4. Drag and drop this entire `tmcbc-checkin` folder into the upload area
5. Click **Deploy**
6. Vercel will give you a live URL — something like `tmcbc-checkin.vercel.app`

---

## STEP 3 — Add Your Planning Center Keys (5 min)

After deploying, add your credentials as Environment Variables in Vercel:

1. In your Vercel project dashboard, go to **Settings → Environment Variables**
2. Add these two variables:

   | Name | Value |
   |------|-------|
   | `VITE_PC_APP_ID` | *(your App ID from Step 1)* |
   | `VITE_PC_SECRET` | *(your Secret from Step 1)* |

3. Click **Save** then go to **Deployments → Redeploy**

> ⚠️ Never share these keys publicly. They are stored securely in Vercel and never visible to app users.

---

## STEP 4 — Set Up the iPad (5 min)

1. Open **Safari** on the iPad
2. Navigate to your Vercel URL (e.g. `tmcbc-checkin.vercel.app`)
3. Tap the **Share icon** (box with arrow) → **"Add to Home Screen"**
4. Name it `TMCBC Check-In` → tap **Add**
5. It will appear as a full-screen app icon on the iPad home screen

### Lock the iPad to the App (Guided Access)
1. Go to iPad **Settings → Accessibility → Guided Access**
2. Turn **Guided Access ON**
3. Set a passcode (something only you know)
4. Open the TMCBC Check-In app
5. **Triple-click the home button** (or side button on newer iPads)
6. Tap **Start** — the iPad is now locked to this app only
7. To exit: triple-click again and enter your passcode

---

## ADDING YOUR GREETER'S EMAIL

Open `src/App.jsx` and find this section near the top:

```javascript
const NOTIFICATIONS = {
  recipients: [
    { name: "Pastor Gilliam", email: "tmcbcpastor@gmail.com", phone: "" },
    { name: "Greeter", email: "GREETER_EMAIL_HERE", phone: "" },
  ],
```

Replace `GREETER_EMAIL_HERE` with your greeter's actual email address.
Then redeploy to Vercel (drag and drop the folder again).

---

## ACTIVATING CLEARSTREAM + EMAIL LATER

When you're ready to connect Clearstream and Planning Center emails:

1. In Planning Center, go to **People → Lists** and find or create your guest list
2. Connect that list to Clearstream (Clearstream → Integrations → Planning Center)
3. Set up a Clearstream automation triggered by new list members
4. In `src/App.jsx`, find `PC_LABELS` and `PC_WORKFLOWS` and add your IDs

---

## RUNNING LOCALLY (for testing before deployment)

If you have Node.js installed:

```bash
cd tmcbc-checkin
npm install
npm run dev
```

Then open http://localhost:5173 in your browser.

---

## SUPPORT

For Planning Center API questions: https://developer.planning.center
For Vercel questions: https://vercel.com/docs
For Clearstream questions: https://clearstream.io/support

---

*Built for The Mount Carmel Baptist Church — "Better 2gether" 2026*
