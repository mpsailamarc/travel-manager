# Publish on PythonAnywhere (free account, next to your existing app)

> If you have another installable app at the root of your PythonAnywhere site (like Streaming Picker), Android
> treats the whole site as that app, so this copy can't get its own icon. Host the app on Cloudflare Pages instead
> (see `DEPLOY-cloudflare.md`) and keep only the sync server here (the "Turn on sync" section below).

The app goes into a `/travel/` folder of your existing site, for example
`https://YOUR-USERNAME.pythonanywhere.com/travel/index.html`.
Your other app is not changed. Replace `YOUR-USERNAME` below with your PythonAnywhere username.

## First time (about 5 minutes)

1. **Upload the package.** Log in to pythonanywhere.com → **Files** tab. In your home folder (`/home/YOUR-USERNAME/`),
   click **Upload a file** and choose `travel-manager-upload.zip` from this project folder.

2. **Unzip it.** Go to the **Consoles** tab → **Bash**, then paste:

   ```bash
   rm -rf ~/travel-manager && unzip -q ~/travel-manager-upload.zip -d ~/travel-manager && ls ~/travel-manager
   ```

   You should see `index.html`, `sw.js`, `assets` and so on.

3. **Serve the folder.** Go to the **Web** tab (your existing app) → scroll to **Static files** → *Enter URL* / *Enter path*:

   | URL | Directory |
   |---|---|
   | `/travel/` | `/home/YOUR-USERNAME/travel-manager` |

4. Click the green **Reload** button at the top of the Web tab.

5. Open **`https://YOUR-USERNAME.pythonanywhere.com/travel/index.html`**. Keep the `index.html` part:
   PythonAnywhere does not open a folder's index page by itself.

## Turn on sync between devices (once)

Sync uses a small Python file added to your existing web app. It answers only at `/travel-api/` and passes
every other request to your app unchanged.

1. **Upload the sync file.** On the **Files** tab, in `/home/YOUR-USERNAME/`, type `travel-manager-api` under
   *Directories* → **New directory**. Inside it, click **Upload a file** and choose `server/travel_sync.py`
   from this project folder.

2. **Hook it into your web app.** On the **Web** tab, click the link next to *WSGI configuration file*
   (`/var/www/…_wsgi.py`). Go to the **very end** of that file and add these 4 lines (with your username):

   ```python
   import sys
   sys.path.insert(0, '/home/YOUR-USERNAME/travel-manager-api')
   from travel_sync import wrap
   application = wrap(application)
   ```

   Click **Save**, go back to the **Web** tab and click **Reload**.

3. **Check it.** Open `https://YOUR-USERNAME.pythonanywhere.com/travel-api/ping`. You should see
   `{"ok": true, "app": "travel-manager-sync"}`. Check that your other app still works too.
   If something broke, remove the 4 lines, Save and Reload. The **Error log** link on the Web tab shows why.

4. **First device (your computer):** open the app → ⚙️ **Settings** → **Set up sync (first device)**. Save the code
   it shows (notes app or password manager), then click **I saved it — turn on sync**.

5. **Every other device (your phone, family):** open the app → ⚙️ **Settings** → **I have a code** → enter the code
   → **Turn on sync**. Trips already on that device are merged with the synced ones.

From then on it syncs by itself: when the app opens, a few seconds after each change, when the device comes back
online, and every minute while the app is open. The ☁️ ✓ in the top bar shows the status.

About sync:
- Everything is encrypted on the device with your code before it's sent. The server stores only scrambled data,
  so keep the code safe: without it the synced copy can't be read (each device still has its own copy).
- Synced: trips, plans, checklists, expenses, favourites and Settings. **Not synced:** documents (passport scans etc.).
- If the same thing is edited on two devices between syncs, the device that syncs last wins.
- The server allows at most 3 different sync codes, so strangers can't use your site as free storage.
  The data lives in `/home/YOUR-USERNAME/travel-manager-api/travel_sync.sqlite3`, outside the public `/travel/` folder.

## Install it on your phone

- **Android (Chrome):** open the address above → menu ⋮ → **Install app**.
- **iPhone (Safari):** open it → Share → **Add to Home Screen**.

Open each trip day (and the walk maps) once while online, so maps and weather are cached for offline use.

## Updating after changes

1. In this project folder, run `npm run package` (or ask Claude). It rebuilds `travel-manager-upload.zip`.
2. Upload the new zip on the **Files** tab (it replaces the old one).
3. Run the same unzip command in a Bash console.

No Reload needed. Installed copies update themselves the next time they are opened online.
If `server/travel_sync.py` changed, upload it again to `travel-manager-api` and click **Reload** on the Web tab.

## Good to know

- Free web apps must be renewed every month: on the **Web** tab, click **Run until 1 month from today**.
  PythonAnywhere emails you a week before. Your trips are not affected if it lapses: they live in each device's browser,
  not on the server, and installed copies keep working offline.
- Nothing personal is uploaded. The zip only contains the app itself.
- The Travel Manager stores its data under its own names (`travel-manager` database, `tm-` keys), so it does not mix with your other app's data.
