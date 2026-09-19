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
        let phoneNumber = options.getPhoneNumber()
        silentUIDelegate = PhoneAuthNoSafariUIDelegate()
        CAPLog.print("[PhoneAuth] Init native verifyPhoneNumber \(phoneNumber) (in-app, no Safari, no Push entitlement)")
        DispatchQueue.main.async {
            PhoneAuthProvider.provider()
                .verifyPhoneNumber(phoneNumber, uiDelegate: self.silentUIDelegate) { verificationID, error in
                    if let error = error {
                        let nsError = error as NSError
                        CAPLog.print(
                            "[PhoneAuth] verifyPhoneNumber failed domain=\(nsError.domain) code=\(nsError.code) \(error.localizedDescription)"
                        )
                        self.pluginImplementation.handlePhoneVerificationFailed(error)
                        return
                    }
                    let id = verificationID ?? ""
                    if id.isEmpty {
                        CAPLog.print("[PhoneAuth] empty verificationId — SMS was not dispatched")
                        self.pluginImplementation.handlePhoneVerificationFailed(
                            NSError(
                                domain: "PhoneAuth",
                                code: -1,
                                userInfo: [NSLocalizedDescriptionKey: "Empty verificationId"]
                            )
                        )
                        return
                    }
                    CAPLog.print("[PhoneAuth] SMS dispatched verificationId=\(id.prefix(8))…")
                    self.pluginImplementation.handlePhoneCodeSent(id)
                }
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
