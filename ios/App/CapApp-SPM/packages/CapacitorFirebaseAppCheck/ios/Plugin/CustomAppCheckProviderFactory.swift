import Foundation
import FirebaseCore
import FirebaseAppCheck

public class CustomAppCheckProviderFactory: NSObject, AppCheckProviderFactory {
    /// The App Store profile cannot include the App Attest entitlement.
    /// AppAttestProvider never returns a token on TestFlight, so API calls
    /// leave without X-Firebase-AppCheck. DeviceCheck works on a real device
    /// without that entitlement.
    public func createProvider(with app: FirebaseApp) -> AppCheckProvider? {
        return DeviceCheckProvider(app: app)
    }
}
