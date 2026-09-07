import AppKit
import Foundation

guard CommandLine.arguments.count == 3 else {
  fputs("usage: remove-feature-media-pricing input.png output.png\n", stderr)
  exit(2)
}

let input = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2])
guard let source = NSImage(contentsOf: input) else {
  fputs("unable to read input image\n", stderr)
  exit(1)
}

let image = NSImage(size: source.size)
image.lockFocus()
source.draw(in: NSRect(origin: .zero, size: source.size))

let button = NSRect(x: 649, y: 285, width: 224, height: 51)
NSColor(calibratedRed: 0.055, green: 0.263, blue: 0.130, alpha: 1).setFill()
NSBezierPath(roundedRect: button, xRadius: 10, yRadius: 10).fill()

let text = "Create my preview" as NSString
let paragraph = NSMutableParagraphStyle()
paragraph.alignment = .center
let attributes: [NSAttributedString.Key: Any] = [
  .font: NSFont.systemFont(ofSize: 18, weight: .bold),
  .foregroundColor: NSColor.white,
  .paragraphStyle: paragraph,
]
let textHeight = text.size(withAttributes: attributes).height
text.draw(in: NSRect(x: button.minX, y: button.midY - textHeight / 2, width: button.width, height: textHeight + 2), withAttributes: attributes)
image.unlockFocus()

guard let tiff = image.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff),
      let png = rep.representation(using: .png, properties: [:]) else {
  fputs("unable to encode output image\n", stderr)
  exit(1)
}
try png.write(to: output, options: .atomic)
print(output.path)
