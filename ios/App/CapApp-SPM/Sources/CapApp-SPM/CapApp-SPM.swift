import UIKit
#if canImport(FirebaseCore)
import FirebaseCore
#endif
#if canImport(FirebaseAuth)
import FirebaseAuth
#endif

public let isCapacitorApp = true

/// Native Phone Auth without Push / App Attest entitlements.
/// Configures Firebase from the bundled GoogleService-Info.plist.
public enum PhoneAuthNativeBootstrap {
    public static func configureIfNeeded() {
        #if canImport(FirebaseCore)
        let plistName = "GoogleService-Info"
        guard let path = Bundle.main.path(forResource: plistName, ofType: "plist") else {
            print("[PhoneAuth] ERROR: \(plistName).plist missing from app bundle — Auth cannot send SMS")
            if FirebaseApp.app() == nil {
                FirebaseApp.configure()
            }
            configureAuthLanguage()
            return
        }
        guard let options = FirebaseOptions(contentsOfFile: path) else {
            print("[PhoneAuth] ERROR: failed to parse \(plistName).plist at \(path)")
            if FirebaseApp.app() == nil {
                FirebaseApp.configure()
            }
            configureAuthLanguage()
            return
        }
        stripUnusedOAuthClient(options)
        if FirebaseApp.app() == nil {
            FirebaseApp.configure(options: options)
        }
        let app = FirebaseApp.app()
        let resolved = app?.options ?? options
        print("[PhoneAuth] Firebase Auth from GoogleService-Info.plist")
        print("[PhoneAuth] projectID=\(resolved.projectID ?? "nil")")
        print("[PhoneAuth] googleAppID=\(resolved.googleAppID)")
        print("[PhoneAuth] bundleID=\(resolved.bundleID ?? "nil")")
        print("[PhoneAuth] gcmSenderID=\(resolved.gcmSenderID)")
        print("[PhoneAuth] apiKeyPrefix=\(String((resolved.apiKey ?? "").prefix(8)))")
        print("[PhoneAuth] clientID=\(resolved.clientID ?? "nil")")
        print("[PhoneAuth] Saudi E.164 format required: +9665XXXXXXXX")
        #endif
        configureAuthLanguage()
    }

    #if canImport(FirebaseCore)
    /// Ignore Codemagic YAML placeholders and invented `{projectNumber}-{GOOGLE_APP_ID hash}` client IDs.
    private static func stripUnusedOAuthClient(_ options: FirebaseOptions) {
        guard let clientID = options.clientID, !clientID.isEmpty else { return }
        let hash = options.googleAppID.split(separator: ":").last.map(String.init) ?? ""
        let isPlaceholder = clientID == "DISABLED_USE_BUNDLED_PLIST" || clientID.hasPrefix("DISABLED_")
        let isInvented = !hash.isEmpty && clientID.contains(hash)
        guard isPlaceholder || isInvented else { return }
        print("[PhoneAuth] ignoring env/placeholder CLIENT_ID — Auth uses GoogleService-Info.plist only")
        options.clientID = nil
    }
    #endif

    private static func configureAuthLanguage() {
        #if canImport(FirebaseAuth)
        Auth.auth().languageCode = "ar"
        print("[PhoneAuth] Auth.languageCode=ar (Saudi +966 SMS)")
        #endif
    }

    public static func setAPNSToken(_ deviceToken: Data) {
        #if canImport(FirebaseAuth)
        Auth.auth().setAPNSToken(deviceToken, type: .unknown)
        print("[PhoneAuth] APNs token forwarded to Firebase Auth (\(deviceToken.count) bytes)")
        #endif
    }

    public static func handleNotification(_ userInfo: [AnyHashable: Any]) -> Bool {
        #if canImport(FirebaseAuth)
        return Auth.auth().canHandleNotification(userInfo)
        #else
        return false
        #endif
    }

    public static func handleURL(_ url: URL) -> Bool {
        #if canImport(FirebaseAuth)
        if Auth.auth().canHandle(url) {
            print("[PhoneAuth] Firebase Auth consumed URL in-process (no Safari handoff)")
            return true
        }
        #endif
        return false
    }
}
