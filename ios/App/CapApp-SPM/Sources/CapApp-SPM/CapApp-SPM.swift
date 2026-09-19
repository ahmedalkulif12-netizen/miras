import UIKit
#if canImport(FirebaseCore)
import FirebaseCore
#endif
#if canImport(FirebaseAuth)
import FirebaseAuth
#endif

public let isCapacitorApp = true

/// Native Phone Auth helpers for AppDelegate (APNs + reCAPTCHA URL fallback).
public enum PhoneAuthNativeBootstrap {
    public static func configureIfNeeded() {
        #if canImport(FirebaseCore)
        if FirebaseApp.app() == nil {
            FirebaseApp.configure()
        }
        let clientId = FirebaseApp.app()?.options.clientID ?? "MISSING"
        print("[PhoneAuth] Firebase configured clientID=\(clientId)")
        #endif
        DispatchQueue.main.async {
            UIApplication.shared.registerForRemoteNotifications()
            print("[PhoneAuth] registerForRemoteNotifications requested (APNs optional; reCAPTCHA is fallback)")
        }
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
            print("[PhoneAuth] Firebase Auth handled reCAPTCHA callback \(url.scheme ?? "")")
            return true
        }
        #endif
        return false
    }
}
