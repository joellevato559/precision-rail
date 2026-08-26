import Foundation

/**
 * Example: call after a successful API login.
 *
 *   let jwt = loginResponse.accessToken
 *   let api = "https://api.yourdomain.com/api/v1"
 *   PushTokenManager.shared.configureBackend(apiBase: api, authToken: jwt)
 *
 * On logout:
 *
 *   PushTokenManager.shared.clearBackend()
 */
enum LoginPushHook {
    static func onLogin(apiBase: String, accessToken: String) {
        PushTokenManager.shared.configureBackend(apiBase: apiBase, authToken: accessToken)
    }

    static func onLogout() {
        PushTokenManager.shared.clearBackend()
    }
}
