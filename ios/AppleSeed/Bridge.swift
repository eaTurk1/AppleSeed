import UIKit
import WebKit

final class Bridge: NSObject, WKNavigationDelegate, WKUIDelegate {
 let model: NativeModel; let endpoint: URL
 weak var web: WKWebView?; var ready = false, active = false
 let prefs = UserDefaults.standard
 init(model: NativeModel, endpoint: URL) { self.model = model; self.endpoint = endpoint; super.init() }
 func attach(_ view: WKWebView) {
  web = view
  NotificationCenter.default.addObserver(self, selector: #selector(background), name: UIApplication.willResignActiveNotification, object: nil)
  NotificationCenter.default.addObserver(self, selector: #selector(foreground), name: UIApplication.didBecomeActiveNotification, object: nil)
 }
 deinit { NotificationCenter.default.removeObserver(self) }
 func dispatch(_ name: String, _ detail: [String: Any]) {
  guard ready, let data = try? JSONSerialization.data(withJSONObject: detail), let json = String(data: data, encoding: .utf8) else { return }
  web?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('\(name)',{detail:\(json)}))", completionHandler: nil)
 }
 func orientation(_ landscape: Bool) { dispatch("appleseed-orientation", ["landscape": landscape]) }
 @objc func background() { dispatch("appleseed-visibility", ["visible": false]); web?.endEditing(true); UIApplication.shared.isIdleTimerDisabled = false }
 @objc func foreground() { dispatch("appleseed-visibility", ["visible": true]); awake(); appearance() }
 func awake() { UIApplication.shared.isIdleTimerDisabled = active && prefs.bool(forKey: "phoneAwake") && UIApplication.shared.applicationState == .active }
 func appearance() { dispatch("appleseed-appearance", ["appearance": model.appearance, "appearanceLight": web?.traitCollection.userInterfaceStyle != .dark]) }
 func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
  decisionHandler(ConnectionPolicy.trusted(navigationAction.request.url, endpoint: endpoint) ? .allow : .cancel)
 }
 func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { ready = true; foreground(); orientation(webView.bounds.width > webView.bounds.height) }
 func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { active = false; awake(); ready = false; webView.reload() }
 func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { model.message = "Cannot reach your Mac. Check Tailscale and the private address."; model.configuring = true }
 func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
  guard prompt == "AppleSeedNative", frame.isMainFrame, ConnectionPolicy.trusted(frame.request.url, endpoint: endpoint),
    let text = defaultText, text.utf8.count <= 16384, let data = text.data(using: .utf8), let value = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let op = value["op"] as? String else { completionHandler(nil); return }
  let reply: (Any?) -> Void = { result in
   guard let result = result, JSONSerialization.isValidJSONObject([result]), let data = try? JSONSerialization.data(withJSONObject: result, options: .fragmentsAllowed), let json = String(data: data, encoding: .utf8) else { completionHandler("null"); return }
   completionHandler(json)
  }
  switch op {
  case "capabilities": reply(["native": true, "tools": true, "storageLabel": "device-bound Keychain", "backgroundSession": false, "landscape": webView.bounds.width > webView.bounds.height, "phoneAwakeSupported": true])
  case "settings": reply(["saved": Vault.has(endpoint), "seconds": prefs.object(forKey: "seconds") as? Int ?? 600, "streamMode": prefs.string(forKey: "streamMode") ?? "auto", "phoneAwake": prefs.bool(forKey: "phoneAwake"), "appearance": model.appearance, "appearanceLight": webView.traitCollection.userInterfaceStyle != .dark])
  case "load", "save":
   EndpointVerifier().verify(endpoint) { [weak self] ok in
    guard let self = self, ok, ConnectionPolicy.trusted(webView.url, endpoint: self.endpoint), self.model.endpoint == self.endpoint else { reply(nil); return }
    if op == "load" { reply(Vault.load(self.endpoint)) }
    else if let credentials = value["credentials"] as? [String: Any] { reply(Vault.save(credentials, endpoint: self.endpoint)) } else { reply(false) }
   }
  case "forget": Vault.forget(endpoint); reply(true)
  case "configure": reply(true); DispatchQueue.main.async { self.model.configuring = true }
  case "session-start": guard let seconds = value["seconds"] as? Int, (0...86400).contains(seconds) else { reply(false); return }; active = true; awake(); reply(true)
  case "session-end": active = false; awake(); reply(true)
  case "timer-preference": if let seconds = value["seconds"] as? Int, (0...86400).contains(seconds) { prefs.set(seconds, forKey: "seconds"); reply(true) } else { reply(false) }
  case "stream-preference": if let mode = value["mode"] as? String, ["auto", "speed", "quality"].contains(mode) { prefs.set(mode, forKey: "streamMode"); reply(true) } else { reply(false) }
  case "appearance-preference": if let mode = value["mode"] as? String, ["auto", "light", "dark"].contains(mode) { model.appearance = mode; prefs.set(mode, forKey: "appearance"); appearance(); reply(true) } else { reply(false) }
  case "phone-awake": prefs.set(value["enabled"] as? Bool ?? false, forKey: "phoneAwake"); awake(); reply(true)
  case "keyboard": if value["enabled"] as? Bool == false { webView.endEditing(true) }; reply(true)
  case "fullscreen": model.fullscreen = value["enabled"] as? Bool ?? false; reply(true)
  case "copy-portal-code":
   guard UIApplication.shared.applicationState == .active, let code = value["code"] as? String, code.range(of: "^[2-9A-HJ-NP-Z]{8}$", options: .regularExpression) != nil else { reply(false); return }
   UIPasteboard.general.setItems([["public.utf8-plain-text": code]], options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(60)]); reply(true)
  case "support": UIApplication.shared.open(URL(string: "https://erhan.ai/appleseed/#support")!); reply(true)
  default: reply(nil)
  }
 }
}
