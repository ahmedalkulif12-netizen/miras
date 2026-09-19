import Foundation
import Capacitor
import FirebaseCore
import FirebaseAuth
import UIKit

class PhoneAuthProviderHandler: NSObject {
    private var pluginImplementation: FirebaseAuthentication
    private var signInOnConfirm = true
    private var skipNativeAuthOnConfirm = false
    /// Retained so Firebase can call it; this delegate never presents Safari.
    private var silentUIDelegate: PhoneAuthNoSafariUIDelegate?

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

    private func verifyPhoneNumber(_ options: SignInWithPhoneNumberOptions) {
        let phoneNumber = options.getPhoneNumber().trimmingCharacters(in: .whitespacesAndNewlines)
        silentUIDelegate = PhoneAuthNoSafariUIDelegate()
        CAPLog.print("[PhoneAuth] Init native verifyPhoneNumber phone=\(phoneNumber)")
        guard isSaudiMobileE164(phoneNumber) else {
            CAPLog.print("[PhoneAuth] rejected phone — expected Saudi E.164 +9665XXXXXXXX got \(phoneNumber)")
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
                .verifyPhoneNumber(phoneNumber, uiDelegate: self.silentUIDelegate) { verificationID, error in
                    if let error = error {
                        self.logFirebaseAuthFailure(error)
                        self.pluginImplementation.handlePhoneVerificationFailed(error)
                        return
                    }
                    let id = verificationID ?? ""
                    if id.isEmpty {
                        CAPLog.print("[PhoneAuth] empty verificationId — SMS was not dispatched")
                        let empty = NSError(
                            domain: "PhoneAuth",
                            code: -1,
                            userInfo: [NSLocalizedDescriptionKey: "Empty verificationId"]
                        )
                        self.logFirebaseAuthFailure(empty)
                        self.pluginImplementation.handlePhoneVerificationFailed(empty)
                        return
                    }
                    CAPLog.print("[PhoneAuth] SMS dispatched verificationId=\(id.prefix(8))…")
                    self.pluginImplementation.handlePhoneCodeSent(id)
                }
        }
    }

    private func isSaudiMobileE164(_ phone: String) -> Bool {
        let pattern = #"^\+9665[0-9]{8}$"#
        return phone.range(of: pattern, options: .regularExpression) != nil
    }

    private func logFirebaseAuthFailure(_ error: Error) {
        let nsError = error as NSError
        let authCode = FirebaseAuthenticationHelper.createErrorCode(error: error) ?? "unknown"
        CAPLog.print("[PhoneAuth] verifyPhoneNumber FAILED auth=\(authCode)")
        CAPLog.print("[PhoneAuth] domain=\(nsError.domain) nativeCode=\(nsError.code)")
        CAPLog.print("[PhoneAuth] localized=\(nsError.localizedDescription)")
        if let reason = nsError.localizedFailureReason {
            CAPLog.print("[PhoneAuth] reason=\(reason)")
        }
        if authCode == "auth/too-many-requests" || authCode == "auth/quota-exceeded" {
            CAPLog.print("[PhoneAuth] RATE LIMITED / QUOTA — Firebase rejected SMS for this project")
        }
        if authCode == "auth/app-not-authorized" || authCode == "auth/invalid-api-key" {
            CAPLog.print("[PhoneAuth] APP NOT AUTHORIZED — check GoogleService-Info.plist GOOGLE_APP_ID / BUNDLE_ID")
        }
        if let underlying = nsError.userInfo[NSUnderlyingErrorKey] as? NSError {
            CAPLog.print("[PhoneAuth] underlying domain=\(underlying.domain) code=\(underlying.code) \(underlying.localizedDescription)")
        }
        for (key, value) in nsError.userInfo {
            if String(describing: key) == NSUnderlyingErrorKey { continue }
            CAPLog.print("[PhoneAuth] userInfo[\(key)]=\(value)")
        }
    }
}

/// Blocks SFSafariViewController / ASWebAuthenticationSession so login stays in-app.
final class PhoneAuthNoSafariUIDelegate: NSObject, AuthUIDelegate {
    func present(_ viewControllerToPresent: UIViewController, animated flag: Bool, completion: (() -> Void)? = nil) {
        CAPLog.print("[PhoneAuth] blocked Safari/reCAPTCHA redirect — staying in-app")
        completion?()
    }

    func dismiss(animated flag: Bool, completion: (() -> Void)? = nil) {
        completion?()
    }
}
