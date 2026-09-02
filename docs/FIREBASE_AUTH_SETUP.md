# Firebase Phone Auth Setup (Miras P0)

Phone OTP is used for **customer**, **driver**, and **admin** login (`/login`, `/admin/login`). All paths share `src/lib/phoneAuth.ts`.

## Architecture (local vs production)

```
Browser → invisible reCAPTCHA (Phone Auth) → Firebase Auth sendVerificationCode
       → App Check token (if enforced on Auth) → Firebase backend
       → SMS (or test number bypass)
```

| Layer | Local dev | Production |
|-------|-----------|------------|
| Origin hostname | **`127.0.0.1` only** — Firebase **blocks** Phone Auth on `localhost` | Your live domain |
| Phone Auth reCAPTCHA | DEV uses `appVerificationDisabledForTesting` + **test numbers** | Real invisible reCAPTCHA |
| App Check on Auth | **Debug token** in `.env` OR enforcement **off** in Console | reCAPTCHA v3 + Play Integrity **enforced** |
| SMS | **Test phone numbers** in Console (no SMS cost) | Real SMS |
| Authorized domains | **`127.0.0.1`** (required) | Production domain |

> **Important:** Firebase documentation states *“localhost is not allowed as a hosted domain for the purposes of phone auth.”*  
> Always open: `http://127.0.0.1:3000` (not `http://localhost:3000`).

---

## Production Hosting domains (required for live OTP)

Phone Auth on Firebase Hosting fails with **`auth/captcha-check-failed` / Hostname match not found** when the browser hostname is missing from **either**:

1. Firebase Console → **Authentication → Settings → Authorized domains**
2. Google Cloud → **reCAPTCHA** → App Check site key → **Domains**

### Required hostnames for project `hamula-cfc6c`

| Hostname | Purpose |
|----------|---------|
| `hamula-cfc6c.web.app` | Default Hosting URL |
| `hamula-cfc6c.firebaseapp.com` | Alternate Hosting / authDomain host |
| `127.0.0.1` | Local Phone Auth (not `localhost`) |
| `localhost` | App Check key only (Phone Auth still prefers `127.0.0.1`) |

Add any custom domain the same way (hostname only — no `https://`, no path).

### Verify

```bash
npx tsx scripts/verify-auth-authorized-domains.ts
gcloud recaptcha keys describe 6Lf0czctAAAAAF7EECTuyfcTMJpA7HCTBlLp7Syb --project=hamula-cfc6c
```

### Client config note

Keep `VITE_FIREBASE_AUTH_DOMAIN=hamula-cfc6c.firebaseapp.com` even when users open `*.web.app`. Do **not** set authDomain to `web.app`.

---

## Firebase Console setup (required)

### 1. Enable Phone provider

Authentication → Sign-in method → **Phone** → **Enable**.

Also set an **SMS region policy** that allows Saudi Arabia (`SA`) if you will send real SMS later.

### 2. Authorized domains — add `127.0.0.1` (exact steps)

Firebase Phone Auth fails with `auth/invalid-app-credential` / “Failed to initialize reCAPTCHA Enterprise config” when the browser hostname is not allowed for Phone Auth. **`localhost` is never valid for Phone Auth.**

1. Open [Firebase Console](https://console.firebase.google.com/) → project **`hamula-cfc6c`**.
2. Left sidebar → **Build** → **Authentication**.
3. Open the **Settings** tab (top of the Authentication page).
4. Scroll to **Authorized domains**.
5. Click **Add domain**.
6. Type exactly: `127.0.0.1`
   - Do **not** include `http://`
   - Do **not** include a port (`:3000`)
   - Entry must be exactly: `127.0.0.1`
7. Click **Add**.
8. Confirm the list includes at least:
   - `127.0.0.1` ← **required for local Phone Auth**
   - `hamula-cfc6c.firebaseapp.com` (default)
   - `hamula-cfc6c.web.app` ← **required for Hosting OTP**
   - your custom production domain (when ready)
9. You may still see `localhost` in the list — **do not use it for OTP**; Phone Auth rejects that hostname.
10. Also update the **App Check reCAPTCHA v3** key Domains in Google Cloud Console (or `gcloud recaptcha keys update … --web --domains=…`) to include the same Hosting hostnames.

### 3. Test phone numbers (required for local OTP without real SMS)

Authentication → Sign-in method → Phone → **Phone numbers for testing**:

| Phone | OTP code |
|-------|----------|
| `+966501234567` | `123456` |
| `+966500000001` | `123456` (test customer) |
| `+966500000002` | `123456` (test driver) |

In the app enter `0501234567` — it normalizes to `+966501234567`.

**No SMS is sent** for test numbers; Firebase returns success immediately.

Guest / simulated login on loopback (`npm run dev`): enable **Anonymous** under Authentication → Sign-in method. The Developer bypass panel then creates a real `auth.currentUser` so Firestore order writes work without OTP.

### 4. App Check + Phone Auth

If **App Check enforcement is enabled for Authentication**, OTP also needs a valid App Check token.

**Option A (recommended):**

1. Open **`http://127.0.0.1:3000`** → DevTools Console.
2. Confirm `[App Check] Using registered debug token …`.
3. Firebase Console → App Check → **Manage debug tokens** → add the exact UUID from `VITE_APP_CHECK_DEBUG_TOKEN`.
4. Restart `npm run dev`.

**Option B (temporary):**

1. App Check → Authentication → **Unenforced**.
2. `.env`: `VITE_APP_CHECK_DISABLED=true`
3. Restart `npm run dev`.

**About “Failed to initialize reCAPTCHA Enterprise config”:**  
This is almost always an **origin / Authorized domain** problem (especially `localhost`), not a wrong App Check v3 site key. App Check’s reCAPTCHA **v3** key and Phone Auth’s verifier are separate systems.

### 5. Admin access after OTP

1. Firestore `admins/{firebaseUid}` with `{ active: true, name, phone }`.
2. Successful `POST /api/admin/session`.

---

## Environment variables

```bash
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=hamula-cfc6c.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=hamula-cfc6c
VITE_FIREBASE_APP_ID=...
VITE_APP_CHECK_DEBUG_TOKEN=your-debug-token-uuid
VITE_APP_CHECK_RECAPTCHA_SITE_KEY=your_recaptcha_v3_site_key
```

---

## How to test OTP locally

1. Add **`127.0.0.1`** to Authorized domains (step 2 above).
2. Add a Console **test phone** (step 3).
3. `npm run dev`
4. Open **`http://127.0.0.1:3000/login`** (not `localhost`).
5. Enter `0501234567` → Send OTP → enter `123456`.

If you open `http://localhost:3000`, the login page shows an amber banner and Send OTP is blocked with `PHONE_AUTH_LOCALHOST_BLOCKED`.

---

## Production cutover (real SMS)

1. Remove all Console test phone numbers.
2. Enforce App Check on Authentication + Firestore.
3. Build with `VITE_APP_CHECK_DISABLED=false` and **no** debug token.
4. Deploy API + Hosting; seed `admins/{uid}` for operators.

---

## Common error codes

| Firebase code | Fix |
|---------------|-----|
| `auth/captcha-check-failed` / Hostname match not found | Add exact browser hostname to **Authorized domains** and App Check reCAPTCHA **Domains** (`hamula-cfc6c.web.app`, `hamula-cfc6c.firebaseapp.com`) |
| `auth/invalid-app-credential` | Use `http://127.0.0.1:3000` + add `127.0.0.1` to Authorized domains + test phone |
| `PHONE_AUTH_LOCALHOST_BLOCKED` | Stop using hostname `localhost` for OTP |
| `auth/operation-not-allowed` | Enable Phone provider |
| `auth/app-check-token-is-missing` | Register debug token or unenforce Auth App Check (dev) |
| `auth/quota-exceeded` | Use test phone numbers |
| `auth/too-many-requests` | Wait 15–60 minutes |

---

## Client files

| File | Role |
|------|------|
| `src/lib/phoneAuth.ts` | reCAPTCHA + `signInWithPhoneNumber` |
| `src/lib/phoneAuthErrors.ts` | User-facing error mapping |
| `src/components/PhoneAuthRecaptcha.tsx` | DOM container for invisible reCAPTCHA |
| `src/lib/firebase.ts` | Auth init + DEV `appVerificationDisabledForTesting` |
| `src/lib/appCheck/*` | App Check (debug token / reCAPTCHA v3) |

See also: [FIREBASE_APP_CHECK.md](./FIREBASE_APP_CHECK.md), [ENVIRONMENT.md](./ENVIRONMENT.md).
