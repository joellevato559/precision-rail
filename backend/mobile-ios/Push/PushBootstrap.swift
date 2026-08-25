import UIKit
import UserNotifications
import FirebaseCore
import FirebaseMessaging

/**
 * Wire from AppDelegate.didFinishLaunching:
 *
 *   FirebaseApp.configure()
 *   PushBootstrap.configure(application: application)
 *
 * Forward APNs token:
 *
 *   func application(_ application: UIApplication,
 *                    didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
 *       PushBootstrap.didRegisterForRemoteNotifications(deviceToken: deviceToken)
 *   }
 */
enum PushBootstrap {
    static func configure(application: UIApplication) {
        UNUserNotificationCenter.current().delegate = PushNotificationCenter.shared
        Messaging.messaging().delegate = PushTokenManager.shared
        application.registerForRemoteNotifications()
        PushTokenManager.shared.requestAuthorizationIfNeeded()
    }

    static func didRegisterForRemoteNotifications(deviceToken: Data) {
        Messaging.messaging().apnsToken = deviceToken
    }

    static func didFailToRegisterForRemoteNotifications(error: Error) {
        print("[Push] APNs registration failed: \(error.localizedDescription)")
    }
}
