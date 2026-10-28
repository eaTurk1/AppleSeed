import Foundation
import Security
import CryptoKit

enum ConnectionPolicy {
 static func normalize(_ text: String) -> URL? {
  guard var c = URLComponents(string: text.trimmingCharacters(in: .whitespacesAndNewlines)), c.scheme == "https", c.port == 9447,
    c.user == nil, c.password == nil, c.query == nil, c.fragment == nil, c.path == "" || c.path == "/", let host = c.host?.lowercased(),
    host.range(of: "^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.ts\\.net$", options: .regularExpression) != nil else { return nil }
  c.host = host; c.path = "/"; return c.url
 }
 static func trusted(_ url: URL?, endpoint: URL) -> Bool {
  guard let url = url else { return false }
  return url.scheme == "https" && url.host?.lowercased() == endpoint.host?.lowercased() && url.port == 9447 && url.user == nil && url.password == nil
 }
}
enum Vault {
 static func query(_ endpoint: URL) -> [String: Any] {
  let account = SHA256.hash(data: Data(endpoint.absoluteString.utf8)).map { String(format: "%02x", $0) }.joined()
  return [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "org.appleseed.remote.credentials", kSecAttrAccount as String: account]
 }
 static func load(_ endpoint: URL) -> Any? {
  var q = query(endpoint); q[kSecReturnData as String] = true; var result: CFTypeRef?
  guard SecItemCopyMatching(q as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
  return try? JSONSerialization.jsonObject(with: data)
 }
 static func has(_ endpoint: URL) -> Bool { load(endpoint) != nil }
 static func forget(_ endpoint: URL) { SecItemDelete(query(endpoint) as CFDictionary) }
 static func save(_ value: [String: Any], endpoint: URL) -> Bool {
  guard let user = value["username"] as? String, user.count <= 256, let pass = value["password"] as? String, !pass.isEmpty, pass.count <= 4096, let account = value["macAccount"] as? Bool,
    let data = try? JSONSerialization.data(withJSONObject: ["username": user, "password": pass, "macAccount": account]) else { return false }
  let q = query(endpoint)
  let updated = SecItemUpdate(q as CFDictionary, [kSecValueData as String: data] as CFDictionary)
  if updated == errSecSuccess { return true }
  if updated != errSecItemNotFound { return false }
  var add = q; add[kSecValueData as String] = data; add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
  return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
 }
}
final class EndpointVerifier: NSObject, URLSessionTaskDelegate {
 func verify(_ endpoint: URL, completion: @escaping (Bool) -> Void) {
  let config = URLSessionConfiguration.ephemeral; config.timeoutIntervalForRequest = 5
  let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
  var request = URLRequest(url: endpoint.appendingPathComponent("api/status")); request.cachePolicy = .reloadIgnoringLocalCacheData
  session.dataTask(with: request) { _, response, error in
   let ok = error == nil && (response as? HTTPURLResponse)?.statusCode == 200
   session.finishTasksAndInvalidate(); DispatchQueue.main.async { completion(ok) }
  }.resume()
 }
 func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
