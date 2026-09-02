# Miras store listing assets

Generated from the 29 Aug 2026 phone captures. Safari chrome and the local IP bar are cropped. Arabic UI is used for both `ar` and `en-US` listing folders until English screenshots exist.

## Google Play (upload in Play Console → Store listing)

| File | Size | Limit |
|------|------|--------|
| `store/android/phone/*.png` | 1080×1920 | 8 phone screenshots (max 8) |
| `store/android/sevenInch/*.png` | 1200×1920 | 7-inch tablet |
| `store/android/tenInch/*.png` | 1600×2560 | 10-inch tablet |
| `store/android/featureGraphic.png` | 1024×500 | required |
| `store/android/hi-res-icon.png` | 512×512 | listing icon |

Fastlane copies: `fastlane/metadata/android/ar/images/` and `en-US/images/`.

## App Store Connect (upload per device size)

| Folder | Size | Count |
|--------|------|--------|
| `store/ios/iphone-6.7/` | 1290×2796 | 10 |
| `store/ios/iphone-6.5/` | 1284×2778 | 10 |
| `store/ios/iphone-5.5/` | 1242×2208 | 10 |

Fastlane copies: `fastlane/screenshots/ar-SA/` and `en-US/` (6.7" set).

Listing copy (name, subtitle, description, keywords, review notes) lives in `fastlane/metadata/ios/`. Privacy URL: https://ahmedalkulif12-netizen.github.io/miras-privacy/. Support email: support@miras.com.

## iOS App Store Connect checklist

Team ID `4TRJXRYK8A` is in AASA, Xcode, and ExportOptions.

```bash
npm run ios:prepare-store
# Copy .env.store.example → .env.production and fill secrets, then:
npm run cap:sync:ios:store
```

Then on a Mac:

1. Apple Developer: App ID `com.ahmed.miras` with Associated Domains (`applinks:hamula-cfc6c.web.app`, `applinks:hamula-cfc6c.firebaseapp.com`); create the App Store Connect record (iPhone only).
2. `npx cap open ios` → Signing & Capabilities → Team `4TRJXRYK8A` → Archive → TestFlight.
3. App Privacy (nutrition labels): location (trip tracking), contact info (phone), photos (driver docs), identifiers (Firebase Auth). Tracking = no.
4. Content rating questionnaire; primary category Navigation, secondary Business.
5. Review notes: Firebase **test phone + OTP** into `fastlane/metadata/ios/review_information/`.
6. Upload 6.7" screenshots from `store/ios/iphone-6.7/` after `npm run generate:store-screenshots`.

Privacy: https://ahmedalkulif12-netizen.github.io/miras-privacy/
Play Data safety answers: `store/play-console/data-safety.json`
Play listing copy: `fastlane/metadata/android/{en-US,ar}/`
App Links: set `VITE_ANDROID_SHA256_CERT_FINGERPRINTS` then `npm run deploy:hosting:store`
Terms (SPA): https://hamula-cfc6c.web.app/terms
Support: support@miras.com

Archive/upload cannot be done from Windows.

## Screenshot order (listing order)

1. Landing / hero
2. Logistics services
3. Customer vs driver signup
4. Customer booking dashboard
5. Instant quote
6. Order checkout
7. Driver on-shift
8. Wallet (Moyasar — no card numbers)
9. Driver ratings (iOS only)
10. Privacy policy (iOS only)

Regenerate after new captures: `npm run generate:store-screenshots`
