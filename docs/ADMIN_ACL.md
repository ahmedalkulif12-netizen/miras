# Admin ACL — sole authorized phone

Miras Admin portal access is **restricted to one phone number only**:

| Local form | E.164 (Auth / rules) |
|------------|----------------------|
| `0541330720` | `+966541330720` |

This number is an **unconditional super-admin**:

- Client grants an admin profile immediately after OTP (no Firestore `admins/{uid}` read required)
- `/api/admin/session` and `/api/admin/me` are **best-effort** (Hosting without `VITE_API_ORIGIN` must not block login)
- Firestore `admins/{uid}` upsert is best-effort on the server
- Firestore rules still treat `phone_number == '+966541330720'` as `isAdmin()`

No other phone can enter `/admin`.

## Login flow

```
/admin/login → 0541330720 → OTP
  → confirmPhoneOtp (Firebase Auth)
  → if Auth phone == +966541330720 → set admin profile locally
  → optional POST /api/admin/session (claims) when API is reachable
  → navigate to /admin
```

## Deploy notes

Firebase Hosting rewrites `/api/**` and `/health` to Cloud Run (`hamula-api`). Keep those rewrites in `firebase.json` and deploy a healthy API (see [HOSTING_API.md](./HOSTING_API.md)). Admin UI login for `0541330720` works without that API. Admin dashboard API actions still need the Express backend.
