import Foundation
import Capacitor
import FirebaseCore
import FirebaseAuth
import UIKit

class PhoneAuthProviderHandler: NSObject {
    private var pluginImplementation: FirebaseAuthentication
    private var signInOnConfirm = true
    private var skipNativeAuthOnConfirm = false
    /// Must be retained for the lifetime of verifyPhoneNumber — Firebase does not keep a strong ref.
    private var recaptchaUIDelegate: PhoneAuthCaptchaUIDelegate?

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
        let host = pluginImplementation.getPlugin().bridge?.viewController
        recaptchaUIDelegate = PhoneAuthCaptchaUIDelegate(host: host)
        let clientId = FirebaseApp.app()?.options.clientID ?? "nil"
        CAPLog.print("[PhoneAuth] Init native verifyPhoneNumber \(phoneNumber)")
        CAPLog.print("[PhoneAuth] clientID=\(clientId) hostVC=\(host != nil)")
        DispatchQueue.main.async {
            PhoneAuthProvider.provider()
                .verifyPhoneNumber(phoneNumber, uiDelegate: self.recaptchaUIDelegate) { verificationID, error in
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
                        CAPLog.print("[PhoneAuth] verifyPhoneNumber returned empty verificationId — SMS was not dispatched")
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

/// Presents Firebase's Safari/reCAPTCHA sheet from the Capacitor WebView controller.
/// `uiDelegate: nil` silently fails on iOS 13+ / WKWebView when APNs is unavailable.
final class PhoneAuthCaptchaUIDelegate: NSObject, AuthUIDelegate {
    weak var host: UIViewController?

    init(host: UIViewController?) {
        self.host = host
        super.init()
    }

    func present(_ viewControllerToPresent: UIViewController, animated flag: Bool, completion: (() -> Void)? = nil) {
        DispatchQueue.main.async {
            let presenter = PhoneAuthCaptchaUIDelegate.topViewController(from: self.host)
            CAPLog.print("[PhoneAuth] presenting Safari/reCAPTCHA fallback presenter=\(presenter != nil)")
            guard let presenter = presenter else {
                CAPLog.print("[PhoneAuth] ERROR: no UIViewController to present reCAPTCHA — SMS will not send")
                completion?()
                return
            }
            presenter.present(viewControllerToPresent, animated: flag, completion: completion)
        }
    }

    func dismiss(animated flag: Bool, completion: (() -> Void)? = nil) {
        DispatchQueue.main.async {
            let presenter = PhoneAuthCaptchaUIDelegate.topViewController(from: self.host)
            presenter?.dismiss(animated: flag, completion: completion)
        }
    }

    private static func topViewController(from start: UIViewController?) -> UIViewController? {
        if var top = start {
            while let presented = top.presentedViewController {
                top = presented
            }
            return top
        }
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let window = scenes.flatMap { $0.windows }.first(where: { $0.isKeyWindow }) ?? scenes.first?.windows.first
        var top = window?.rootViewController
        while let presented = top?.presentedViewController {
            top = presented
        }
        return top
    }
}
