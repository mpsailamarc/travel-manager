# Publish the app on Cloudflare Pages (free), with sync on PythonAnywhere

The app gets its own address (for example `https://trips-marc.pages.dev`), so your phone shows it as a separate app
with its own icon, next to Streaming Picker. Sync keeps running on your PythonAnywhere site (`/travel-api/`).

## 1. Update the sync server on PythonAnywhere (once)

The sync file now accepts requests from the app's new address.

1. **Files** tab → `/home/YOUR-USERNAME/travel-manager-api/` → **Upload a file** → choose `server/travel_sync.py`
   from this project folder (it replaces the old one).
2. **Web** tab → green **Reload** button.

Nothing else changes there. The 4 lines in the WSGI file stay as they are.

## 2. Create the Cloudflare site (first time)

1. Sign up for free at **dash.cloudflare.com/sign-up** and verify your email.
2. In the dashboard: **Workers & Pages** → **Create** → choose **Pages** → **Upload assets** (also called *Direct Upload*).
3. Project name: e.g. `trips-marc`. This becomes `trips-marc.pages.dev`; pick another name if it's taken.
4. Drag **`travel-manager-upload.zip`** (from this project folder) onto the upload area → **Deploy site**.
5. Open `https://YOUR-PROJECT.pages.dev`. The app should load.

## 3. On your phone

1. Open `https://YOUR-PROJECT.pages.dev` in Chrome → menu ⋮ → **Install app**. A separate **Trips** icon appears.
2. In the app: ⚙️ **Settings** → **I have a code** → enter your sync code → **Turn on sync**.
   (No code yet? Do **Set up sync (first device)** on your computer first, using the Cloudflare address.)

On your computer, use the Cloudflare address from now on too. If you already turned on sync at the old
PythonAnywhere `/travel/` address, entering the same code on the new address brings everything across.

## Updating after changes

1. In this project folder: `npm run package` (or ask Claude). It rebuilds `travel-manager-upload.zip`.
2. Cloudflare dashboard → your project → **Create deployment** (or **Upload** a new version) → drag the zip.

Installed copies update themselves the next time they're opened online.

## Clean-up (optional, once the Cloudflare version works)

On PythonAnywhere you can remove the old copy of the app: delete the `/travel/` row under **Static files** on the
Web tab, and the `travel-manager` folder. Keep `travel-manager-api`: that's the sync server.
