import AVFoundation
import CoreGraphics
import CoreVideo
import Foundation
import ImageIO

guard CommandLine.arguments.count == 8 else {
  fputs("usage: build-review-screencast output.mov audio.aiff image1 image2 image3 image4 duration\n", stderr)
  exit(2)
}

let outputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let audioURL = URL(fileURLWithPath: CommandLine.arguments[2])
let imagePaths = Array(CommandLine.arguments[3...6])
guard let totalDuration = Double(CommandLine.arguments[7]), totalDuration >= 180 else {
  fputs("duration must be at least 180 seconds\n", stderr)
  exit(2)
}

let width = 1280
let height = 720
let fps: Int32 = 2
let images: [CGImage] = try imagePaths.map { path in
  let url = URL(fileURLWithPath: path) as CFURL
  guard let source = CGImageSourceCreateWithURL(url, nil),
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    throw NSError(domain: "PagneticScreencast", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unable to read \(path)"])
  }
  return image
}

try? FileManager.default.removeItem(at: outputURL)
let silentURL = outputURL.deletingLastPathComponent().appendingPathComponent("pagnetic-review-silent.mov")
try? FileManager.default.removeItem(at: silentURL)

let writer = try AVAssetWriter(outputURL: silentURL, fileType: .mov)
let videoSettings: [String: Any] = [
  AVVideoCodecKey: AVVideoCodecType.h264,
  AVVideoWidthKey: width,
  AVVideoHeightKey: height,
  AVVideoCompressionPropertiesKey: [
    AVVideoAverageBitRateKey: 1_200_000,
    AVVideoExpectedSourceFrameRateKey: fps,
    AVVideoMaxKeyFrameIntervalKey: fps * 10,
  ],
]
let input = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(
  assetWriterInput: input,
  sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
    kCVPixelBufferWidthKey as String: width,
    kCVPixelBufferHeightKey as String: height,
  ]
)
guard writer.canAdd(input) else { throw NSError(domain: "PagneticScreencast", code: 2) }
writer.add(input)
guard writer.startWriting() else { throw writer.error ?? NSError(domain: "PagneticScreencast", code: 3) }
writer.startSession(atSourceTime: .zero)

func buffer(for image: CGImage, progress: Double) -> CVPixelBuffer? {
  var pixelBuffer: CVPixelBuffer?
  CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_32ARGB, [
    kCVPixelBufferCGImageCompatibilityKey: true,
    kCVPixelBufferCGBitmapContextCompatibilityKey: true,
  ] as CFDictionary, &pixelBuffer)
  guard let pixelBuffer else { return nil }
  CVPixelBufferLockBaseAddress(pixelBuffer, [])
  defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, []) }
  guard let context = CGContext(
    data: CVPixelBufferGetBaseAddress(pixelBuffer), width: width, height: height,
    bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(pixelBuffer),
    space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue
  ) else { return nil }
  context.setFillColor(CGColor(red: 0.95, green: 0.94, blue: 0.90, alpha: 1))
  context.fill(CGRect(x: 0, y: 0, width: width, height: height))
  context.interpolationQuality = .high
  let baseScale = max(Double(width) / Double(image.width), Double(height) / Double(image.height))
  let zoom = baseScale * (1.0 + 0.025 * progress)
  let drawWidth = Double(image.width) * zoom
  let drawHeight = Double(image.height) * zoom
  let pan = 10.0 * (progress - 0.5)
  let rect = CGRect(x: (Double(width) - drawWidth) / 2 + pan,
                    y: (Double(height) - drawHeight) / 2,
                    width: drawWidth, height: drawHeight)
  context.draw(image, in: rect)
  return pixelBuffer
}

let frames = Int(totalDuration * Double(fps))
let segmentWeights = [0.18, 0.25, 0.31, 0.26]
var segmentStarts: [Double] = [0]
for weight in segmentWeights.dropLast() { segmentStarts.append(segmentStarts.last! + weight) }

for frame in 0..<frames {
  while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.003) }
  let overall = Double(frame) / Double(frames)
  var index = segmentStarts.lastIndex(where: { $0 <= overall }) ?? 0
  index = min(index, images.count - 1)
  let start = segmentStarts[index]
  let end = index + 1 < segmentStarts.count ? segmentStarts[index + 1] : 1.0
  let local = min(1, max(0, (overall - start) / (end - start)))
  guard let pixelBuffer = buffer(for: images[index], progress: local) else {
    throw NSError(domain: "PagneticScreencast", code: 4)
  }
  let time = CMTime(value: CMTimeValue(frame), timescale: fps)
  guard adaptor.append(pixelBuffer, withPresentationTime: time) else {
    throw writer.error ?? NSError(domain: "PagneticScreencast", code: 5)
  }
}
input.markAsFinished()
let writeSemaphore = DispatchSemaphore(value: 0)
writer.finishWriting { writeSemaphore.signal() }
writeSemaphore.wait()
guard writer.status == .completed else { throw writer.error ?? NSError(domain: "PagneticScreencast", code: 6) }

let composition = AVMutableComposition()
let videoAsset = AVURLAsset(url: silentURL)
let audioAsset = AVURLAsset(url: audioURL)
guard let sourceVideo = videoAsset.tracks(withMediaType: .video).first,
      let sourceAudio = audioAsset.tracks(withMediaType: .audio).first,
      let videoTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
      let audioTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
  throw NSError(domain: "PagneticScreencast", code: 7)
}
let duration = CMTime(seconds: totalDuration, preferredTimescale: 600)
try videoTrack.insertTimeRange(CMTimeRange(start: .zero, duration: duration), of: sourceVideo, at: .zero)
let audioDuration = min(audioAsset.duration, duration)
try audioTrack.insertTimeRange(CMTimeRange(start: .zero, duration: audioDuration), of: sourceAudio, at: .zero)

guard let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPreset1280x720) else {
  throw NSError(domain: "PagneticScreencast", code: 8)
}
exporter.outputURL = outputURL
exporter.outputFileType = .mp4
exporter.shouldOptimizeForNetworkUse = true
let exportSemaphore = DispatchSemaphore(value: 0)
exporter.exportAsynchronously { exportSemaphore.signal() }
exportSemaphore.wait()
try? FileManager.default.removeItem(at: silentURL)
guard exporter.status == .completed else { throw exporter.error ?? NSError(domain: "PagneticScreencast", code: 9) }
print(outputURL.path)
