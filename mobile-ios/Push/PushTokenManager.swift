import Foundation
import UIKit
import UserNotifications
import FirebaseMessaging

/// Obtains FCM token and registers it with Precision Rail API after login.
final class PushTokenManager: NSObject, MessagingDelegate {
    static let shared = PushTokenManager()

    private(set) var fcmToken: String?
    private var apiBase: String?
    private var authToken: String?

    private override init() {
        super.init()
    }

    /// Call after user signs in.
    func configureBackend(apiBase: String, authToken: String) {
        self.apiBase = apiBase.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        self.authToken = authToken
        if let token = fcmToken ?? Messaging.messaging().fcmToken {
            register(token: token)
        }
    }

    func clearBackend() {
        if let token = fcmToken, let base = apiBase, let auth = authToken {
            unregister(token: token, apiBase: base, authToken: auth)
        }
        apiBase = nil
        authToken = nil
    }

    func requestAuthorizationIfNeeded() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, error in
            if let error = error {
                print("[Push] permission error: \(error.localizedDescription)")
            }
            print("[Push] permission granted: \(granted)")
            DispatchQueue.main.async {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    // MARK: - MessagingDelegate

    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        guard let fcmToken = fcmToken else { return }
        self.fcmToken = fcmToken
        print("[Push] FCM token: \(fcmToken.prefix(20))…")
        register(token: fcmToken)
    }

    // MARK: - API

    private func register(token: String) {
        guard let base = apiBase, let auth = authToken else {
            print("[Push] Skipping register — not logged in yet")
            return
        }

        let url = URL(string: "\(base)/notifications/register-device")!
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("Bearer \(auth)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "token": token,
            "platform": "ios",
            "deviceLabel": UIDevice.current.name
        ]
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)

        URLSession.shared.dataTask(with: req) { data, response, error in
            if let error = error {
                print("[Push] register failed: \(error.localizedDescription)")
                return
            }
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            print("[Push] register status: \(code)")
        }.resume()
    }

    private func unregister(token: String, apiBase: String, authToken: String) {
        let url = URL(string: "\(apiBase)/notifications/unregister-device")!
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["token": token])
        URLSession.shared.dataTask(with: req).resume()
    }
}
