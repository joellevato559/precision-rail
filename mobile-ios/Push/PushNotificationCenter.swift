import Foundation
import UserNotifications
import UIKit

/// Handles foreground presentation and tap actions for push notifications.
final class PushNotificationCenter: NSObject, UNUserNotificationCenterDelegate {
    static let shared = PushNotificationCenter()

    private override init() {
        super.init()
    }

    // Show banner while app is in foreground
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .badge, .sound])
    }

    // User tapped notification
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        let type = userInfo["type"] as? String
        print("[Push] opened type=\(type ?? "nil") payload=\(userInfo)")

        // Optional deep links:
        // switch type {
        // case "hos_limit": ...
        // case "maintenance": ...
        // case "integrity": ...
        // default: break
        // }

        completionHandler()
    }
}
