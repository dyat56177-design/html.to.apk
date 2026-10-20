const express = require("express");
const multer = require("multer");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.API_KEY || "";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "";
const MAX_BYTES = 1024 * 1024;

if (API_KEY.length < 32) console.warn("WARNING: Set API_KEY to a random secret of at least 32 characters.");
if (!ALLOWED_ORIGIN) console.warn("WARNING: Set ALLOWED_ORIGIN to your exact Vercel origin.");

app.disable("x-powered-by");
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && origin === ALLOWED_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(origin === ALLOWED_ORIGIN ? 204 : 403);
  next();
});

const upload = multer({
  dest: path.join(os.tmpdir(), "html-apk-uploads"),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(html|htm)$/i.test(file.originalname);
    cb(ok ? null : new Error("Unggah file .html atau .htm saja."), ok);
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "html-to-apk-worker" }));

app.post("/api/convert", (req, res, next) => {
  if (!API_KEY || req.get("x-api-key") !== API_KEY) return res.status(401).json({ error: "Kunci API tidak valid." });
  if (req.get("origin") && req.get("origin") !== ALLOWED_ORIGIN) return res.status(403).json({ error: "Origin tidak diizinkan." });
  next();
}, upload.single("htmlFile"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Pilih file HTML terlebih dahulu." });

  const appName = String(req.body.appName || "HTML App").trim().slice(0, 40) || "HTML App";
  const packageId = String(req.body.packageId || "com.example.htmlapp").trim();
  if (!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*){1,5}$/.test(packageId)) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: "Package ID tidak valid. Contoh: com.amarku.aplikasi" });
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "htmlapk-build-"));
  let responseStarted = false;
  try {
    const project = path.join(work, "project");
    makeProject(project, fs.readFileSync(req.file.path, "utf8"), appName, packageId);
    const gradle = spawn("gradle", ["--no-daemon", "--stacktrace", "assembleDebug"], {
      cwd: project,
      env: { ...process.env, ANDROID_HOME: process.env.ANDROID_HOME || "/opt/android-sdk", ANDROID_SDK_ROOT: process.env.ANDROID_SDK_ROOT || "/opt/android-sdk" }
    });
    let log = "";
    const maxLog = 12000;
    const append = d => { log = (log + d.toString()).slice(-maxLog); };
    gradle.stdout.on("data", append);
    gradle.stderr.on("data", append);

    const timeout = setTimeout(() => {
      gradle.kill("SIGTERM");
      setTimeout(() => { try { gradle.kill("SIGKILL"); } catch {} }, 5000);
    }, 4 * 60 * 1000);

    const exitCode = await new Promise((resolve, reject) => {
      gradle.on("error", reject);
      gradle.on("close", code => resolve(code));
      res.on("close", () => {
        if (!res.writableEnded) {
          try { gradle.kill("SIGTERM"); } catch {}
        }
      });
    });
    clearTimeout(timeout);
    if (res.destroyed) return;
    if (exitCode !== 0) {
      console.error("Gradle build failed:\n" + log);
      return res.status(500).json({ error: "Build APK gagal. Coba lagi atau periksa log worker." });
    }
    const apk = path.join(project, "app", "build", "outputs", "apk", "debug", "app-debug.apk");
    if (!fs.existsSync(apk)) return res.status(500).json({ error: "APK tidak ditemukan setelah build." });
    responseStarted = true;
    res.setHeader("Content-Type", "application/vnd.android.package-archive");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName(appName)}.apk"`);
    res.setHeader("Cache-Control", "no-store");
    res.download(apk, `${safeName(appName)}.apk`);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: "Terjadi kesalahan saat membuat APK." });
  } finally {
    fs.unlink(req.file.path, () => {});
    setTimeout(() => fs.rm(work, { recursive: true, force: true }, () => {}), responseStarted ? 60000 : 1000);
  }
});

function safeName(s) {
  return s.replace(/[^a-z0-9-_]/gi, "-").replace(/-+/g, "-").slice(0, 40) || "html-app";
}
function xml(s) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function makeProject(dir, html, appName, packageId) {
  const mkdir = p => fs.mkdirSync(path.join(dir, p), { recursive: true });
  mkdir("app/src/main/assets");
  mkdir("app/src/main/java/" + packageId.split(".").join("/"));
  fs.writeFileSync(path.join(dir, "settings.gradle"),
    "pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }\n" +
    "dependencyResolutionManagement { repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS); repositories { google(); mavenCentral() } }\n" +
    "rootProject.name = 'HtmlWebApp'\ninclude ':app'\n");
  fs.writeFileSync(path.join(dir, "build.gradle"), "plugins { id 'com.android.application' version '8.7.3' apply false }\n");
  fs.writeFileSync(path.join(dir, "gradle.properties"), "org.gradle.jvmargs=-Xmx1536m -Dfile.encoding=UTF-8\nandroid.useAndroidX=true\n");
  fs.writeFileSync(path.join(dir, "app/build.gradle"),
    "plugins { id 'com.android.application' }\n\n" +
    `android { namespace '${packageId}'; compileSdk 35\n defaultConfig { applicationId '${packageId}'; minSdk 23; targetSdk 35; versionCode 1; versionName '1.0' }\n}\n`);
  fs.writeFileSync(path.join(dir, "app/src/main/AndroidManifest.xml"),
    `<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android"><uses-permission android:name="android.permission.INTERNET"/><application android:theme="@android:style/Theme.Material.Light.NoActionBar" android:label="${xml(appName)}" android:usesCleartextTraffic="true"><activity android:name=".MainActivity" android:exported="true"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity></application></manifest>\n`);
  fs.writeFileSync(path.join(dir, "app/src/main/java/" + packageId.split(".").join("/") + "/MainActivity.java"),
    `package ${packageId};\nimport android.app.Activity;\nimport android.os.Bundle;\nimport android.webkit.WebChromeClient;\nimport android.webkit.WebView;\nimport android.webkit.WebSettings;\n\npublic class MainActivity extends Activity {\n @Override public void onCreate(Bundle state) { super.onCreate(state); WebView web = new WebView(this); WebSettings settings = web.getSettings(); settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true); settings.setAllowFileAccess(true); web.setWebChromeClient(new WebChromeClient()); setContentView(web); web.loadUrl("file:///android_asset/index.html"); }\n}\n`);
  fs.writeFileSync(path.join(dir, "app/src/main/assets/index.html"), html);
}
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "File terlalu besar. Maksimal 1 MB." });
  res.status(400).json({ error: err.message || "Upload tidak valid." });
});
app.listen(PORT, "0.0.0.0", () => console.log(`HTML APK worker listening on ${PORT}`));
         
