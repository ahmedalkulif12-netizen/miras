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
        #endif
        UIApplication.shared.registerForRemoteNotifications()
    }

    public static func setAPNSToken(_ deviceToken: Data) {
        #if canImport(FirebaseAuth)
        Auth.auth().setAPNSToken(deviceToken, type: .unknown)
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
        return Auth.auth().canHandle(url)
        #else
        return false
        #endif
    }
}
