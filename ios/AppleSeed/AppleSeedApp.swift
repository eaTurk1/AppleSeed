import SwiftUI
import WebKit

@main struct AppleSeedApp: App {
 @StateObject private var model = NativeModel()
 var body: some Scene {
  WindowGroup {
   Group {
    if let url = model.endpoint, !model.configuring {
     RemoteView(model: model, url: url).id(url.absoluteString)
    } else {
     VStack(spacing: 20) {
      Image("Seed").resizable().scaledToFit().frame(width: 130, height: 130)
      Text("AppleSeed").font(.largeTitle.bold())
      Text("Your Mac. Within reach.").foregroundStyle(.secondary)
      TextField("https://my-mac.my-tailnet.ts.net:9447", text: $model.address).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL).textFieldStyle(.roundedBorder).accessibilityLabel("Private Tailscale address")
      Button("Connect") { model.connect() }.buttonStyle(.borderedProminent).tint(Color(red: 0.95, green: 0.19, blue: 0.29))
      Text(model.message).font(.footnote).foregroundStyle(.secondary)
      Text("Free. Open source. Every feature included.").font(.footnote).foregroundStyle(.secondary)
     }.padding(28).frame(maxWidth: 540)
    }
   }.preferredColorScheme(model.appearance == "light" ? .light : model.appearance == "dark" ? .dark : nil).statusBarHidden(model.fullscreen)
  }
 }
}
final class NativeModel: ObservableObject {
 @Published var address: String
 @Published var endpoint: URL?
 init() { let saved = UserDefaults.standard.string(forKey: "endpoint") ?? ""; address = saved; endpoint = ConnectionPolicy.normalize(saved) }
 @Published var configuring = false
 @Published var fullscreen = false
 @Published var appearance = UserDefaults.standard.string(forKey: "appearance") ?? "auto"
 @Published var message = "Connect Tailscale, then paste the address copied from AppleSeed on your Mac."
 func connect() {
  guard let url = ConnectionPolicy.normalize(address) else { message = "Use the private HTTPS .ts.net address on port 9447."; return }
  endpoint = url; address = url.absoluteString; UserDefaults.standard.set(address, forKey: "endpoint"); configuring = false
 }
}
struct RemoteView: UIViewRepresentable {
 @ObservedObject var model: NativeModel
 let url: URL
 func makeCoordinator() -> Bridge { Bridge(model: model, endpoint: url) }
 func makeUIView(context: Context) -> WKWebView {
  let configuration = WKWebViewConfiguration(); configuration.websiteDataStore = .nonPersistent()
  configuration.preferences.javaScriptCanOpenWindowsAutomatically = false; configuration.applicationNameForUserAgent = "AppleSeed/2.0 iOS"
  let view = SeedWebView(frame: .zero, configuration: configuration)
  view.navigationDelegate = context.coordinator; view.uiDelegate = context.coordinator
  view.isOpaque = false; view.backgroundColor = .systemBackground; view.scrollView.bounces = false
  view.orientationChanged = { [weak bridge = context.coordinator] landscape in bridge?.orientation(landscape) }
  context.coordinator.attach(view); view.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)); return view
 }
 func updateUIView(_ uiView: WKWebView, context: Context) {}
}
final class SeedWebView: WKWebView {
 var orientationChanged: ((Bool) -> Void)?; private var last: Bool?
 override func layoutSubviews() { super.layoutSubviews(); let landscape = bounds.width > bounds.height; if bounds.width > 0 && last != landscape { last = landscape; orientationChanged?(landscape) } }
}
