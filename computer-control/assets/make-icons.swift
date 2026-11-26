// Draws the Praecise Control icons from the Praecise mark: a slate square whose left half is white.
//
//   swift make-icons.swift [folder]
//
// The app's icon is the mark on a light ground with a pointer in its dark half. The
// mark alone, in one colour, is what the menu bar and the taskbar show.

import AppKit

let slate = CGColor(red: 47 / 255, green: 58 / 255, blue: 64 / 255, alpha: 1)
let paper = CGColor(red: 253 / 255, green: 253 / 255, blue: 254 / 255, alpha: 1)
let ground = CGColor(red: 244 / 255, green: 244 / 255, blue: 242 / 255, alpha: 1)

/// The mark in a square, measured from the top left as the logo is: a border a fifteenth of its side.
func mark(in context: CGContext, _ box: CGRect, pointer: Bool, ink: CGColor, light: CGColor?) {
  let side = box.width
  let edge = side * 9 / 136
  func at(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: box.minX + x * side, y: box.maxY - y * side) }
  context.setFillColor(ink)
  context.fill(box)
  let left = CGRect(x: box.minX + edge, y: box.minY + edge, width: side / 2 - edge, height: side - 2 * edge)
  if let light { context.setFillColor(light); context.fill(left) } else { context.clear(left) }
  guard pointer else { return }
  let shape: [(CGFloat, CGFloat)] = [(0.615, 0.30), (0.615, 0.70), (0.705, 0.615), (0.765, 0.755), (0.825, 0.728), (0.765, 0.59), (0.885, 0.59)]
  context.beginPath()
  context.move(to: at(shape[0].0, shape[0].1))
  for point in shape.dropFirst() { context.addLine(to: at(point.0, point.1)) }
  context.closePath()
  context.setFillColor(light ?? paper)
  context.fillPath()
}

func picture(_ size: Int, _ draw: (CGContext, CGFloat) -> Void) -> Data {
  let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  context.setShouldAntialias(true)
  draw(context, CGFloat(size))
  return NSBitmapImageRep(cgImage: context.makeImage()!).representation(using: .png, properties: [:])!
}

let folder = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? ".")
for size in [16, 32, 48, 64, 128, 256, 512, 1024] {
  // The app: a rounded ground with the mark in the middle of it.
  let app = picture(size) { context, side in
    let inset = side * 0.09
    let tile = CGRect(x: inset, y: inset, width: side - 2 * inset, height: side - 2 * inset)
    context.addPath(CGPath(roundedRect: tile, cornerWidth: tile.width * 0.225, cornerHeight: tile.width * 0.225, transform: nil))
    context.setFillColor(ground)
    context.fillPath()
    let within = (tile.width * 0.56).rounded()
    let box = CGRect(x: ((side - within) / 2).rounded(), y: ((side - within) / 2).rounded(), width: within, height: within)
    mark(in: context, box, pointer: size >= 48, ink: slate, light: paper)
  }
  try! app.write(to: folder.appendingPathComponent("icon-\(size).png"))
}
for size in [16, 32, 48, 128] {
  // A browser's toolbar and the corner of a taskbar: the mark to the edges, with nothing around it.
  let plain = picture(size) { context, side in
    let inset = (side * 0.06).rounded()
    mark(in: context, CGRect(x: inset, y: inset, width: side - 2 * inset, height: side - 2 * inset), pointer: size >= 48, ink: slate, light: paper)
  }
  try! plain.write(to: folder.appendingPathComponent("mark-\(size).png"))
}
print("made icons in \(folder.path)")
