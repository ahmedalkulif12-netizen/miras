import Foundation
import Capacitor
import FirebaseCore
import FirebaseAuth
import UIKit

class PhoneAuthProviderHandler: NSObject {
    private var pluginImplementation: FirebaseAuthentication
    private var signInOnConfirm = true
    private var skipNativeAuthOnConfirm = false
    /// Retained for verifyPhoneNumber. Firebase tries silent APNs when entitled;
    /// otherwise presents in-app (Capacitor VC), not Safari.app.
    private var recaptchaUIDelegate: PhoneAuthInAppUIDelegate?

    init(_ pluginImplementation: FirebaseAuthentication) {
        self.pluginImplementation = pluginImplementation
        super.init()
    }

    func signIn(_ options: SignInWithPhoneNumberOptions) {
        signInOnConfirm = true
        skipNativeAuthOnConfirm = options.getSkipNativeAuth()
        verifyPhoneNumber(options)
    }

    func link(_ options: LinkWithPhoneNumberOptions) {
        signInOnConfirm = false
        skipNativeAuthOnConfirm = options.getSkipNativeAuth()
        verifyPhoneNumber(options)
    }

    func confirmVerificationCode(_ options: ConfirmVerificationCodeOptions, completion: @escaping (Result?, Error?) -> Void) {
        let credential = PhoneAuthProvider.provider().credential(
            withVerificationID: options.getVerificationId(),
            verificationCode: options.getVerificationCode()
        )
        if self.signInOnConfirm {
            pluginImplementation.signInWithCredential(SignInOptions(skipNativeAuth: skipNativeAuthOnConfirm), credential: credential, completion: completion)
        } else {
            pluginImplementation.linkWithCredential(credential: credential, completion: completion)
        }
    }

    private func ensureFirebaseConfigured() {
        if FirebaseApp.app() != nil {
            logConfiguredFirebaseOptions()
            return
        }
        if let path = Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist"),
           let options = FirebaseOptions(contentsOfFile: path) {
            stripUnusedOAuthClient(options)
            FirebaseApp.configure(options: options)
            CAPLog.print("[PhoneAuth] FirebaseApp.configure() from GoogleService-Info.plist")
            logConfiguredFirebaseOptions()
        } else {
            CAPLog.print("[PhoneAuth] Error: GoogleService-Info.plist missing — calling FirebaseApp.configure()")
            FirebaseApp.configure()
        }
        Auth.auth().languageCode = "ar"
    }

    private func stripUnusedOAuthClient(_ options: FirebaseOptions) {
        guard let clientID = options.clientID, !clientID.isEmpty else { return }
        let hash = options.googleAppID.split(separator: ":").last.map(String.init) ?? ""
        let isPlaceholder = clientID == "DISABLED_USE_BUNDLED_PLIST" || clientID.hasPrefix("DISABLED_")
        let isInvented = !hash.isEmpty && clientID.contains(hash)
        guard isPlaceholder || isInvented else { return }
        CAPLog.print("[PhoneAuth] ignoring env/placeholder CLIENT_ID — Auth uses GoogleService-Info.plist only")
        options.clientID = nil
    }

    private func logConfiguredFirebaseOptions() {
        guard let options = FirebaseApp.app()?.options else { return }
        CAPLog.print("[PhoneAuth] googleAppID=\(options.googleAppID)")
        CAPLog.print("[PhoneAuth] apiKeyPrefix=\(String((options.apiKey ?? "").prefix(8)))")
        CAPLog.print("[PhoneAuth] clientID=\(options.clientID ?? "nil")")
    }

    private func verifyPhoneNumber(_ options: SignInWithPhoneNumberOptions) {
        ensureFirebaseConfigured()
        let phoneNumber = sanitizeSaudiE164(options.getPhoneNumber())
        recaptchaUIDelegate = PhoneAuthInAppUIDelegate(host: pluginImplementation.getPlugin().bridge?.viewController)
        CAPLog.print("[PhoneAuth] Verification Request Sent \(phoneNumber)")
        guard isSaudiMobileE164(phoneNumber) else {
            let error = NSError(
                domain: "FIRAuthErrorDomain",
                code: AuthErrorCode.invalidPhoneNumber.rawValue,
                userInfo: [NSLocalizedDescriptionKey: "auth/invalid-phone-number: \(phoneNumber) is not +9665XXXXXXXX"]
            )
            logFirebaseAuthFailure(error)
            pluginImplementation.handlePhoneVerificationFailed(error)
            return
        }
        DispatchQueue.main.async {
            PhoneAuthProvider.provider()
                .verifyPhoneNumber(phoneNumber, uiDelegate: self.recaptchaUIDelegate) { verificationID, error in
                    if let error = error {
                        self.logFirebaseAuthFailure(error)
                        self.pluginImplementation.handlePhoneVerificationFailed(error)
                        return
                    }
                    let id = verificationID ?? ""
                    if id.isEmpty {
                        let empty = NSError(
                            domain: "PhoneAuth",
                            code: -1,
                            userInfo: [NSLocalizedDescriptionKey: "Empty verificationId — SMS was not dispatched"]
                        )
                        self.logFirebaseAuthFailure(empty)
                        self.pluginImplementation.handlePhoneVerificationFailed(empty)
                        return
                    }
                    CAPLog.print("[PhoneAuth] Verification ID Received")
                    self.pluginImplementation.handlePhoneCodeSent(id)
                }
        }
    }

    private func sanitizeSaudiE164(_ raw: String) -> String {
        let compact = raw.replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: "-", with: "")
            .replacingOccurrences(of: "(", with: "")
            .replacingOccurrences(of: ")", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if compact.hasPrefix("+9660") {
            return "+966" + compact.dropFirst(5)
        }
        return compact
    }

    private func isSaudiMobileE164(_ phone: String) -> Bool {
        let pattern = #"^\+9665[0-9]{8}$"#
        return phone.range(of: pattern, options: .regularExpression) != nil
    }

    private func logFirebaseAuthFailure(_ error: Error) {
        let nsError = error as NSError
        let authCode = FirebaseAuthenticationHelper.createErrorCode(error: error) ?? "auth/internal-error"
        CAPLog.print("[PhoneAuth] Error: \(authCode) \(nsError.localizedDescription)")
        CAPLog.print("[PhoneAuth] domain=\(nsError.domain) nativeCode=\(nsError.code)")
        if authCode == "auth/too-many-requests" || authCode == "auth/quota-exceeded" {
            CAPLog.print("[PhoneAuth] Error: RATE LIMITED / QUOTA — Firebase rejected SMS")
        }
        if let underlying = nsError.userInfo[NSUnderlyingErrorKey] as? NSError {
            CAPLog.print("[PhoneAuth] Error: underlying \(underlying.domain) \(underlying.code) \(underlying.localizedDescription)")
        }
        for (key, value) in nsError.userInfo {
            CAPLog.print("[PhoneAuth] Error: userInfo[\(key)]=\(value)")
        }
    }
}

/// Presents Firebase Phone Auth verification in-app from the Capacitor controller.
/// Used when the App Store profile has no Push / aps-environment entitlement.
final class PhoneAuthInAppUIDelegate: NSObject, AuthUIDelegate {
    weak var host: UIViewController?

    init(host: UIViewController?) {
        self.host = host
        super.init()
    }

    func present(_ viewControllerToPresent: UIViewController, animated flag: Bool, completion: (() -> Void)? = nil) {
        DispatchQueue.main.async {
            var presenter = self.host
            while let shown = presenter?.presentedViewController {
                presenter = shown
            }
            if presenter == nil {
                let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
                let window = scenes.flatMap { $0.windows }.first(where: { $0.isKeyWindow }) ?? scenes.first?.windows.first
                presenter = window?.rootViewController
                while let shown = presenter?.presentedViewController {
                    presenter = shown
                }
            }
            CAPLog.print("[PhoneAuth] presenting in-app verification sheet presenter=\(presenter != nil)")
            guard let presenter = presenter else {
                CAPLog.print("[PhoneAuth] Error: no UIViewController to present Firebase verification")
                completion?()
                return
            }
            presenter.present(viewControllerToPresent, animated: flag, completion: completion)
        }
    }

    func dismiss(animated flag: Bool, completion: (() -> Void)? = nil) {
        DispatchQueue.main.async {
            var presenter = self.host
            while let shown = presenter?.presentedViewController {
                presenter = shown
            }
            presenter?.dismiss(animated: flag, completion: completion)
        }
    }
}
