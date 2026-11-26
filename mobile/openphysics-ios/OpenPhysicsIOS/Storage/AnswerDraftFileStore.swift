import Foundation
import PencilKit
import UIKit

enum PracticeAnswerMode: String, CaseIterable, Identifiable {
    case text
    case handwriting
    case photo

    var id: String { rawValue }

    var title: String {
        switch self {
        case .text: return "文字"
        case .handwriting: return "手写"
        case .photo: return "照片"
        }
    }

    var symbol: String {
        switch self {
        case .text: return "text.cursor"
        case .handwriting: return "pencil.tip"
        case .photo: return "photo"
        }
    }
}

struct AnswerMediaDraft: Equatable {
    enum Kind: String {
        case handwriting
        case photo
    }

    let kind: Kind
    let fileURL: URL
    let mimeType: String
}

struct AnswerDraftFileStore {
    private let fileManager: FileManager
    private let rootURL: URL

    init(
        fileManager: FileManager = .default,
        rootURL: URL? = nil
    ) {
        self.fileManager = fileManager
        self.rootURL = rootURL ?? fileManager.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        )[0].appendingPathComponent("OpenPhysics/PracticeDrafts", isDirectory: true)
    }

    /// Same as the web and Android answer images (frontend/student/src/utils/imageCompression.ts):
    /// long side 1800, JPEG 0.86 stepping down to 0.68, aiming at 1.2 MB.
    static let answerImageMaxDimension: CGFloat = 1_800
    static let answerImageInitialQuality: CGFloat = 0.86
    static let answerImageMinimumQuality: CGFloat = 0.68
    static let answerImageQualityStep: CGFloat = 0.06
    static let answerImageTargetBytes = 1_200 * 1_024
    static let answerImageMaxResizePasses = 2

    /// The web's encodeCanvasAsJpeg: lower the quality step by step until the target size, then
    /// shrink the picture (at most twice) and try again; otherwise keep the smallest result.
    static func answerImageJPEG(_ source: UIImage) -> Data? {
        var working = source.resizedForAnswerUpload(maxDimension: answerImageMaxDimension)
        var smallest: Data?
        for pass in 0...answerImageMaxResizePasses {
            var quality = answerImageInitialQuality
            while quality >= answerImageMinimumQuality - 0.001 {
                guard let data = working.jpegData(compressionQuality: max(answerImageMinimumQuality, quality)) else { break }
                if smallest.map({ data.count < $0.count }) ?? true { smallest = data }
                if data.count <= answerImageTargetBytes { return data }
                quality -= answerImageQualityStep
            }
            guard let best = smallest, pass < answerImageMaxResizePasses else { break }
            let reduction = max(0.65, min(0.9, (Double(answerImageTargetBytes) / Double(best.count)).squareRoot() * 0.95))
            let pixels = working.pixelSize
            let next = max(pixels.width, pixels.height) * reduction
            guard next.rounded() < max(pixels.width, pixels.height) else { break }
            working = working.resizedForAnswerUpload(maxDimension: next.rounded())
        }
        return smallest
    }

    func savePhoto(
        data: Data,
        studentId: String,
        questionId: String
    ) throws -> AnswerMediaDraft {
        guard let source = UIImage(data: data) else {
            throw AnswerDraftError.invalidImage
        }
        guard let jpeg = Self.answerImageJPEG(source), !jpeg.isEmpty else {
            throw AnswerDraftError.invalidImage
        }
        guard jpeg.count <= 5 * 1_024 * 1_024 else {
            throw AnswerDraftError.imageTooLarge
        }

        let directory = try questionDirectory(studentId: studentId, questionId: questionId)
        let fileURL = directory.appendingPathComponent("photo.jpg")
        try jpeg.write(to: fileURL, options: .atomic)
        return AnswerMediaDraft(kind: .photo, fileURL: fileURL, mimeType: "image/jpeg")
    }

    func saveDrawing(
        _ drawing: PKDrawing,
        studentId: String,
        questionId: String
    ) throws {
        let directory = try questionDirectory(studentId: studentId, questionId: questionId)
        try drawing.dataRepresentation().write(
            to: directory.appendingPathComponent("handwriting.pkdrawing"),
            options: .atomic
        )
    }

    func exportDrawing(
        _ drawing: PKDrawing,
        backgroundImage: UIImage? = nil,
        canvasSize: CGSize? = nil,
        backgroundPlacement: QuestionDrawingBackgroundPlacement = QuestionDrawingBackgroundPlacement(),
        studentId: String,
        questionId: String
    ) throws -> AnswerMediaDraft {
        guard !drawing.strokes.isEmpty else {
            throw AnswerDraftError.blankDrawing
        }

        let flattened: UIImage
        if let backgroundImage {
            guard
                let canvasSize,
                canvasSize.width > 0,
                canvasSize.height > 0
            else {
                throw AnswerDraftError.invalidCanvas
            }
            let canvasBounds = CGRect(origin: .zero, size: canvasSize)
            let drawingImage = drawing.image(from: canvasBounds, scale: 2)
            let renderer = UIGraphicsImageRenderer(size: canvasSize)
            flattened = renderer.image { context in
                UIColor(red: 1, green: 0.992, blue: 0.973, alpha: 1).setFill()
                context.fill(canvasBounds)
                backgroundImage.draw(
                    in: QuestionDrawingBackgroundLayout.rect(
                        sourceSize: backgroundImage.size,
                        canvasSize: canvasSize,
                        placement: backgroundPlacement
                    )
                )
                drawingImage.draw(in: canvasBounds)
            }
        } else {
            let contentBounds = drawing.bounds.insetBy(dx: -28, dy: -28)
            let drawingImage = drawing.image(from: contentBounds, scale: 2)
            let renderer = UIGraphicsImageRenderer(size: contentBounds.size)
            flattened = renderer.image { context in
                UIColor.white.setFill()
                context.fill(CGRect(origin: .zero, size: contentBounds.size))
                drawingImage.draw(at: .zero)
            }
        }
        guard let jpeg = Self.answerImageJPEG(flattened), !jpeg.isEmpty else {
            throw AnswerDraftError.invalidImage
        }

        let directory = try questionDirectory(studentId: studentId, questionId: questionId)
        let fileURL = directory.appendingPathComponent("handwriting.jpg")
        try jpeg.write(to: fileURL, options: .atomic)
        return AnswerMediaDraft(
            kind: .handwriting,
            fileURL: fileURL,
            mimeType: "image/jpeg"
        )
    }

    func removeAllDrafts() {
        try? fileManager.removeItem(at: rootURL)
    }

    func removeDrafts(studentId: String, questionId: String) {
        let directory = draftDirectory(studentId: studentId, questionId: questionId)
        try? fileManager.removeItem(at: directory)
    }

    func removePhoto(studentId: String, questionId: String) {
        let fileURL = draftDirectory(studentId: studentId, questionId: questionId)
            .appendingPathComponent("photo.jpg")
        try? fileManager.removeItem(at: fileURL)
    }

    func removeDrawing(studentId: String, questionId: String) {
        let directory = draftDirectory(studentId: studentId, questionId: questionId)
        try? fileManager.removeItem(
            at: directory.appendingPathComponent("handwriting.pkdrawing")
        )
        try? fileManager.removeItem(
            at: directory.appendingPathComponent("handwriting.jpg")
        )
    }

    private func questionDirectory(studentId: String, questionId: String) throws -> URL {
        let directory = draftDirectory(studentId: studentId, questionId: questionId)
        try fileManager.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        var protectedDirectory = directory
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? protectedDirectory.setResourceValues(values)
        return directory
    }

    private func draftDirectory(studentId: String, questionId: String) -> URL {
        rootURL
            .appendingPathComponent(safeComponent(studentId), isDirectory: true)
            .appendingPathComponent(safeComponent(questionId), isDirectory: true)
    }

    private func safeComponent(_ value: String) -> String {
        let safe = value.map { character in
            character.isLetter || character.isNumber || character == "-" || character == "_"
                ? character
                : "_"
        }
        return String(safe).prefix(100).description
    }
}

enum AnswerDraftError: LocalizedError, Equatable {
    case invalidImage
    case imageTooLarge
    case blankDrawing
    case invalidCanvas
    case backgroundImageUnavailable

    var errorDescription: String? {
        switch self {
        case .invalidImage:
            return "无法读取这张图片，请重新选择。"
        case .imageTooLarge:
            return "图片处理后仍然过大，请换一张图片。"
        case .blankDrawing:
            return "手写画布还是空白的。"
        case .invalidCanvas:
            return "草稿纸尺寸异常，请重新进入本题。"
        case .backgroundImageUnavailable:
            return "题图加载失败，无法生成完整作答图片，请检查网络后重试。"
        }
    }
}

private extension UIImage {
    func resizedForAnswerUpload(maxDimension: CGFloat) -> UIImage {
        let largestSide = max(size.width, size.height)
        guard largestSide > maxDimension else {
            return normalizedOrientation()
        }
        let scale = maxDimension / largestSide
        let target = CGSize(width: size.width * scale, height: size.height * scale)
        // One point per pixel: the default renderer uses the screen scale (3x on iPhone),
        // which tripled the target to 3x the pixels and pushed photos over the upload limit.
        let renderer = UIGraphicsImageRenderer(size: target, format: Self.singlePixelFormat)
        return renderer.image { _ in
            draw(in: CGRect(origin: .zero, size: target))
        }
    }

    /// Size in pixels, whatever the image's scale.
    var pixelSize: CGSize { CGSize(width: size.width * scale, height: size.height * scale) }

    private static var singlePixelFormat: UIGraphicsImageRendererFormat {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return format
    }

    func normalizedOrientation() -> UIImage {
        guard imageOrientation != .up else { return self }
        let renderer = UIGraphicsImageRenderer(size: size, format: Self.singlePixelFormat)
        return renderer.image { _ in
            draw(in: CGRect(origin: .zero, size: size))
        }
    }
}
