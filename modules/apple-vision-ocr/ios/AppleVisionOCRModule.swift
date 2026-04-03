import ExpoModulesCore
import Foundation
import Vision

public class AppleVisionOCRModule: Module {
  private struct OCRLineObservation {
    let text: String
    let confidence: Double
    let boundingBox: CGRect
  }

  private static let receiptCustomWords = [
    "subtotal",
    "tax",
    "tip",
    "gratuity",
    "service charge",
    "amount due",
    "balance due",
    "total",
    "receipt",
    "order",
    "server",
    "table",
    "guest",
    "visa",
    "mastercard",
    "amex"
  ]

  public func definition() -> ModuleDefinition {
    Name("AppleVisionOCR")

    Function("isAvailable") {
      true
    }

    AsyncFunction("recognizeText") { (imageUri: String) throws -> [String: Any] in
      let lines = try Self.extractLines(from: imageUri)
      let averageConfidence =
        lines.isEmpty
        ? 0
        : lines.reduce(0) { $0 + $1.confidence } / Double(lines.count)

      return [
        "text": lines.map(\.text).joined(separator: "\n"),
        "lines": lines.map { line in
          [
            "text": line.text,
            "confidence": line.confidence,
            "boundingBox": [
              "x": line.boundingBox.origin.x,
              "y": line.boundingBox.origin.y,
              "width": line.boundingBox.size.width,
              "height": line.boundingBox.size.height
            ]
          ]
        },
        "averageConfidence": averageConfidence
      ]
    }
  }

  private static func extractLines(from imageUri: String) throws -> [OCRLineObservation] {
    let trimmedUri = imageUri.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let fileURL = resolveFileURL(from: trimmedUri) else {
      throw ocrError("ERR_INVALID_URI", "Expected a local file URI for OCR input.")
    }
    guard FileManager.default.fileExists(atPath: fileURL.path) else {
      throw ocrError("ERR_FILE_NOT_FOUND", "OCR input file does not exist at the provided URI.")
    }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    request.recognitionLanguages = ["en-US"]
    request.customWords = receiptCustomWords
    if #available(iOS 16.0, *) {
      request.automaticallyDetectsLanguage = true
    }

    let handler = VNImageRequestHandler(url: fileURL, options: [:])
    do {
      try handler.perform([request])
    } catch {
      throw ocrError("ERR_VISION_REQUEST_FAILED", "Apple Vision text recognition failed: \(error.localizedDescription)")
    }

    let observations = request.results ?? []
    let lines = observations
      .compactMap { observation -> OCRLineObservation? in
        guard let candidate = observation.topCandidates(1).first else {
          return nil
        }

        let text = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty {
          return nil
        }

        return OCRLineObservation(
          text: text,
          confidence: Double(candidate.confidence),
          boundingBox: topLeftBoundingBox(from: observation.boundingBox)
        )
      }
      .sorted(by: compareOCRLines)

    guard !lines.isEmpty else {
      throw ocrError("ERR_NO_TEXT_DETECTED", "Apple Vision did not detect any readable text.")
    }
    return lines
  }

  private static func topLeftBoundingBox(from visionBoundingBox: CGRect) -> CGRect {
    CGRect(
      x: visionBoundingBox.origin.x,
      y: 1 - visionBoundingBox.origin.y - visionBoundingBox.size.height,
      width: visionBoundingBox.size.width,
      height: visionBoundingBox.size.height
    )
  }

  private static func compareOCRLines(_ lhs: OCRLineObservation, _ rhs: OCRLineObservation) -> Bool {
    let tallestLine = Swift.max(lhs.boundingBox.height, rhs.boundingBox.height)
    let rowTolerance = Swift.max(tallestLine, 0.012) * 0.5
    let verticalDelta = lhs.boundingBox.minY - rhs.boundingBox.minY
    if abs(verticalDelta) <= rowTolerance {
      return lhs.boundingBox.minX < rhs.boundingBox.minX
    }
    return lhs.boundingBox.minY < rhs.boundingBox.minY
  }

  private static func resolveFileURL(from raw: String) -> URL? {
    if raw.isEmpty {
      return nil
    }

    if let url = URL(string: raw), url.isFileURL {
      return url
    }

    if raw.hasPrefix("/") {
      return URL(fileURLWithPath: raw)
    }

    return nil
  }

  private static func ocrError(_ code: String, _ message: String) -> NSError {
    NSError(
      domain: "AppleVisionOCR",
      code: 1,
      userInfo: [
        NSLocalizedDescriptionKey: message,
        "code": code
      ]
    )
  }
}
