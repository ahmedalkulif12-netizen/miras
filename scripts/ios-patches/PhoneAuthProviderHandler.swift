import Foundation
import Capacitor
import FirebaseCore
import FirebaseAuth
import UIKit

class PhoneAuthProviderHandler: NSObject {
    private var pluginImplementation: FirebaseAuthentication
    private var signInOnConfirm = true
    private var skipNativeAuthOnConfirm = false
    /// Retained so Firebase Auth does not fall back to Safari / reCAPTCHA webview.
    private var recaptchaUIDelegate: PhoneAuthSilentUIDelegate?

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
        recaptchaUIDelegate = PhoneAuthSilentUIDelegate()
        CAPLog.print("[PhoneAuth] Verification Request Sent \(phoneNumber) (APNs silent, no Safari)")
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

/// Blocks Safari / reCAPTCHA webview. SMS must go out via silent APNs.
final class PhoneAuthSilentUIDelegate: NSObject, AuthUIDelegate {
    func present(_ viewControllerToPresent: UIViewController, animated flag: Bool, completion: (() -> Void)? = nil) {
        CAPLog.print("[PhoneAuth] blocked Safari/reCAPTCHA presentation — silent APNs only")
        completion?()
        viewControllerToPresent.dismiss(animated: false, completion: nil)
    }

    func dismiss(animated flag: Bool, completion: (() -> Void)? = nil) {
        completion?()
    }
}
