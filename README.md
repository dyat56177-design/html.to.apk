# HTML to APK Studio — Vercel + GitHub + Build Worker

This project separates the public website from the Android APK build process:

- `frontend/`: static website deployed on Vercel and stored in GitHub.
- `worker/`: Node.js API + Android SDK/Gradle inside Docker. Deploy it to a Docker-capable host (for example, a VPS or a container platform).
- The browser uploads a single `.html`/`.htm` file to the worker. The worker builds a debug APK and returns it as a download.

## Important limitation

A normal Vercel static deployment cannot compile Android APKs by itself. The worker is a separate service because Android SDK/Gradle are large and build jobs need suitable CPU, memory, disk, and execution time. Vercel's platform features and limits can change; this architecture avoids depending on a long-running Android build inside a standard function.

## 1. Put the project on GitHub

1. Create a new repository on GitHub.
2. Upload the contents of this folder (keep `frontend/` and `worker/` as folders).
3. Do not commit secrets or API keys.

## 2. Deploy the frontend to Vercel

1. Import the GitHub repository into Vercel.
2. Set **Root Directory** to `frontend`.
3. Framework preset: **Other**.
4. No build command is required; output is the static folder itself.
5. In Vercel Project Settings → Environment Variables, add:
   - `WORKER_URL` is NOT read by static HTML at runtime; instead set `WORKER_URL` in `frontend/config.js` before deployment, or replace the placeholder in `frontend/index.html`.
6. Redeploy after changing the worker URL.

For simplicity, open `frontend/config.js` and set `window.HTML_APK_WORKER_URL` to the public HTTPS URL of your worker, without a trailing slash.

## 3. Deploy the worker

Deploy the `worker/` folder to a host that supports Docker. Set these environment variables:

- `API_KEY`: a long random secret (at least 32 characters).
- `ALLOWED_ORIGIN`: your exact Vercel domain, e.g. `https://your-project.vercel.app`.
- `PORT`: usually supplied by the host.

Then set the same `API_KEY` in `frontend/config.js` as `window.HTML_APK_API_KEY`.

### Security note

A secret embedded in browser JavaScript is visible to visitors. Therefore the API key in this demo is only a basic gate, **not suitable for a public production converter**. For a public service, replace it with user authentication and a short-lived signed upload/job token issued by a server-side API, add rate limits/quotas, and store build jobs in a queue. Never expose a private GitHub token or cloud credentials in frontend code.

## 4. Test locally

Worker:
```bash
cd worker
cp .env.example .env
# Edit .env and set API_KEY and ALLOWED_ORIGIN
docker build -t html-apk-worker .
docker run --rm -p 3000:3000 --env-file .env html-apk-worker
```

Frontend:
- Edit `frontend/config.js`: worker URL `http://localhost:3000`, API key to match `.env`.
- Open `frontend/index.html` in a browser, or serve `frontend/` with any static server.
- CORS permits only `ALLOWED_ORIGIN`; for local testing, set it to the frontend origin you're using.

## What this version supports

- One HTML file up to 1 MB.
- App label and Android package ID.
- APK debug build and direct download.
- JavaScript enabled in the Android WebView.

## Current limitations / next steps

- CSS, JS, fonts, and images in separate files are not included; embed them in the HTML.
- Result is a debug APK for testing, not a release-signed APK for Play Store distribution.
- No user accounts, queue, persistent history, virus scanning, or usage quotas yet.
- Only accept HTML you own or have permission to package. Do not upload secrets.
- 
