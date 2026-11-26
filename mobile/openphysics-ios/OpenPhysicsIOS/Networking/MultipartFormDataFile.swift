import Foundation

struct MultipartFormDataFile {
    let fileURL: URL
    let boundary: String

    var contentType: String {
        "multipart/form-data; boundary=\(boundary)"
    }

    static func build(
        fields: [String: String],
        fileFieldName: String,
        sourceFileURL: URL,
        fileName: String,
        mimeType: String,
        fileManager: FileManager = .default
    ) throws -> MultipartFormDataFile {
        guard
            fileManager.fileExists(atPath: sourceFileURL.path),
            let attributes = try? fileManager.attributesOfItem(atPath: sourceFileURL.path),
            (attributes[.size] as? NSNumber)?.intValue ?? 0 > 0
        else {
            throw MultipartError.missingSourceFile
        }

        let boundary = "OpenPhysicsBoundary\(UUID().uuidString.replacingOccurrences(of: "-", with: ""))"
        let destination = fileManager.temporaryDirectory
            .appendingPathComponent("\(UUID().uuidString).multipart")
        guard fileManager.createFile(atPath: destination.path, contents: nil) else {
            throw MultipartError.cannotCreateBody
        }

        do {
            let output = try FileHandle(forWritingTo: destination)
            defer { try? output.close() }

            for (name, value) in fields.sorted(by: { $0.key < $1.key }) {
                try output.write(
                    contentsOf: Data((
                        "--\(boundary)\r\n" +
                        "Content-Disposition: form-data; name=\"\(quoted(name))\"\r\n\r\n" +
                        "\(value)\r\n"
                    ).utf8)
                )
            }

            try output.write(
                contentsOf: Data((
                    "--\(boundary)\r\n" +
                    "Content-Disposition: form-data; name=\"\(quoted(fileFieldName))\"; filename=\"\(quoted(fileName))\"\r\n" +
                    "Content-Type: \(mimeType)\r\n\r\n"
                ).utf8)
            )

            let input = try FileHandle(forReadingFrom: sourceFileURL)
            defer { try? input.close() }
            while let chunk = try input.read(upToCount: 64 * 1_024), !chunk.isEmpty {
                try output.write(contentsOf: chunk)
            }
            try output.write(contentsOf: Data("\r\n--\(boundary)--\r\n".utf8))
            return MultipartFormDataFile(fileURL: destination, boundary: boundary)
        } catch {
            try? fileManager.removeItem(at: destination)
            throw error
        }
    }

    func remove(fileManager: FileManager = .default) {
        try? fileManager.removeItem(at: fileURL)
    }

    private static func quoted(_ value: String) -> String {
        value.replacingOccurrences(of: "\\", with: "_")
            .replacingOccurrences(of: "\"", with: "_")
    }
}

enum MultipartError: LocalizedError {
    case missingSourceFile
    case cannotCreateBody

    var errorDescription: String? {
        switch self {
        case .missingSourceFile:
            return "作答图片已经不存在，请重新选择或书写。"
        case .cannotCreateBody:
            return "无法准备上传文件，请稍后重试。"
        }
    }
}
