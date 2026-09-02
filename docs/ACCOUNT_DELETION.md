# Account Deletion (P0-10)

## Endpoint

`POST /api/account/delete`

- **Auth:** Firebase ID token (`Authorization: Bearer …`)
- **Body:** `{ "confirm": true }` — required explicit confirmation

## Lifecycle

1. User opens **Delete Account** in dashboard sidebar → confirmation modal.
2. Client calls `POST /api/account/delete` with Bearer token.
3. Server validates:
   - User profile exists in `users/{uid}`
   - Not an admin (`role !== 'admin'` and no `admins/{uid}`)
   - No active trip (`assigned`, `driver_arrived`, `in_transit`, …)
   - Driver wallet balance is zero (if applicable)
4. Firestore batch (Admin SDK):
   - Cancel open orders → `cancelled` + address redaction
   - Anonymize completed orders (addresses/names; **keep financials**)
   - Tombstone `users/{uid}` with `accountStatus: 'deleted'`
   - Tombstone `drivers/{uid}` if driver
   - Write `account_deletions/{uid}` audit record
   - Remove `subscriptions/{uid}` if present
5. `revokeRefreshTokens(uid)` then `deleteUser(uid)` on Firebase Auth.
6. Client signs out and clears `hamoula_profile` local cache.

## Deleted vs preserved

| Data | Action |
|------|--------|
| Firebase Auth user | **Deleted** |
| Refresh / ID tokens | **Revoked** |
| `users/{uid}` PII (name, phone, vehicle) | **Anonymized / removed** |
| `drivers/{uid}` PII | **Anonymized** |
| Open orders | **Cancelled** + addresses redacted |
| Completed orders | **Preserved** — financials, IDs, dates; PII redacted |
| `payments/*` | **Preserved** (accounting) |
| `wallets/*` ledger | **Preserved** (accounting) |
| `account_deletions/{uid}` | **Created** (server-only audit) |
| `subscriptions/{uid}` | **Deleted** |

## Firestore rules

- `account_deletions/*` — client read/write denied (Admin SDK only)
- `users/{uid}` update blocked when `accountStatus == 'deleted'`
- Client `syncUserProfileToFirestore` skips tombstoned profiles

## Re-registration

Phone Auth creates a **new** Firebase UID. Historical orders remain linked to the original (anonymized) UID for audit.
