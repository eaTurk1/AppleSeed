import Foundation
import CoreGraphics

var count: UInt32 = 0
// Online includes sleeping displays: the picker must still work on a locked Mac.
let result = CGGetOnlineDisplayList(0, nil, &count)
guard result == .success, count <= 32 else { print("[]"); exit(0) }
var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
guard CGGetOnlineDisplayList(count, &ids, &count) == .success else { print("[]"); exit(0) }
let displays: [[String: Any]] = ids.prefix(Int(count)).filter { CGDisplayMirrorsDisplay($0) == kCGNullDirectDisplay }.map { id in
    let bounds = CGDisplayBounds(id)
    return ["id": String(id), "x": bounds.origin.x, "y": bounds.origin.y, "width": bounds.width, "height": bounds.height,
            "pixelWidth": CGDisplayPixelsWide(id), "pixelHeight": CGDisplayPixelsHigh(id), "primary": CGDisplayIsMain(id) != 0]
}
if let data = try? JSONSerialization.data(withJSONObject: displays), let json = String(data: data, encoding: .utf8) { print(json) }
else { print("[]") }
