import UIKit
#if canImport(FirebaseCore)
import FirebaseCore
#endif
#if canImport(FirebaseAuth)
import FirebaseAuth
#endif
#if canImport(FirebaseAppCheck)
import FirebaseAppCheck
#endif

public let isCapacitorApp = true

#if canImport(FirebaseAppCheck)
final class PhoneAuthAppCheckFactory: NSObject, AppCheckProviderFactory {
    func createProvider(with app: FirebaseApp) -> AppCheckProvider? {
        if #available(iOS 14.0, *) {
            return AppAttestProvider(app: app)
        }
        return DeviceCheckProvider(app: app)
    }
}
#endif

/// Native Phone Auth: silent APNs + App Attest. Never open Safari/reCAPTCHA.
public enum PhoneAuthNativeBootstrap {
    private static var apnsTokenData: Data?
    private static var requestObserver: NSObjectProtocol?

    public static func configureIfNeeded() {
        #if canImport(FirebaseAppCheck)
        AppCheck.setAppCheckProviderFactory(PhoneAuthAppCheckFactory())
        print("[PhoneAuth] App Attest / DeviceCheck factory registered")
        #endif
        #if canImport(FirebaseCore)
        if FirebaseApp.app() == nil {
            FirebaseApp.configure()
        }
        print("[PhoneAuth] Firebase configured")
        #endif
        if requestObserver == nil {
            requestObserver = NotificationCenter.default.addObserver(
                forName: Notification.Name("MirasPhoneAuthAPNSRequest"),
                object: nil,
                queue: .main
            ) { _ in
                if apnsTokenData != nil {
                    NotificationCenter.default.post(
                        name: Notification.Name("MirasPhoneAuthAPNSReady"),
                        object: nil
                    )
                }
            }
        }
        DispatchQueue.main.async {
            UIApplication.shared.registerForRemoteNotifications()
            print("[PhoneAuth] registerForRemoteNotifications requested (silent APNs for Phone Auth)")
        }
    }

    public static func setAPNSToken(_ deviceToken: Data) {
        apnsTokenData = deviceToken
        #if canImport(FirebaseAuth)
        Auth.auth().setAPNSToken(deviceToken, type: .unknown)
        print("[PhoneAuth] APNs token forwarded to Firebase Auth (\(deviceToken.count) bytes)")
        NotificationCenter.default.post(name: Notification.Name("MirasPhoneAuthAPNSReady"), object: nil)
        #endif
    }

    public static func handleNotification(_ userInfo: [AnyHashable: Any]) -> Bool {
        #if canImport(FirebaseAuth)
        if Auth.auth().canHandleNotification(userInfo) {
            print("[PhoneAuth] Firebase Auth handled silent APNs challenge in-process")
            return true
        }
        #endif
        return false
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
