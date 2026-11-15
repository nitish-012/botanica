//
//  ImageStorageManager.swift
//  Botanica
//
//  Saves, loads, compresses and deletes plant photos in
//  Documents/PlantPhotos. SwiftData stores only the returned filename.
//
//  Design notes
//  • Actor: all disk I/O and image decoding happen off the main thread.
//  • Input is `Data` (from PhotosPicker or the camera's JPEG/HEIC data).
//  • ImageIO downsampling: memory-efficient, honours EXIF orientation, and
//    writes a fresh JPEG with NO metadata, so GPS/location is stripped.
//  • Each photo produces two files: "<uuid>.jpg" (≤2048 px) and
//    "<uuid>_thumb.jpg" (≤400 px). Callers only ever see "<uuid>.jpg".
//  • Files are written with complete-until-first-unlock data protection so
//    notification actions can still read them while the phone is locked.
//

import Foundation
import ImageIO
import UniformTypeIdentifiers
import UIKit

nonisolated enum ImageStorageError: LocalizedError, Sendable {
    case unreadableImageData
    case encodingFailed
    case fileNotFound(String)
    case invalidFilename(String)

    var errorDescription: String? {
        switch self {
        case .unreadableImageData:     "The photo couldn't be read."
        case .encodingFailed:          "The photo couldn't be compressed."
        case .fileNotFound(let name):  "Photo \(name) is missing."
        case .invalidFilename(let name): "\(name) isn't a valid photo name."
        }
    }
}

nonisolated enum ImageVariant: Sendable {
    case full
    case thumbnail
}

actor ImageStorageManager {

    static let shared = ImageStorageManager()

    // MARK: Configuration
    private let fullMaxPixelSize: Int
    private let thumbnailMaxPixelSize: Int
    private let fullQuality: Double
    private let thumbnailQuality: Double
    private let directoryURL: URL
    private let fileManager = FileManager.default
    private let thumbnailCache = NSCache<NSString, UIImage>()

    nonisolated private static let thumbnailSuffix = "_thumb"
    nonisolated private static let fileExtension = "jpg"

    init(
        directoryName: String = "PlantPhotos",
        baseDirectory: URL? = nil,
        fullMaxPixelSize: Int = 2048,
        thumbnailMaxPixelSize: Int = 400,
        fullQuality: Double = 0.8,
        thumbnailQuality: Double = 0.7
    ) {
        let base = baseDirectory ?? URL.documentsDirectory
        self.directoryURL = base.appending(path: directoryName, directoryHint: .isDirectory)
        self.fullMaxPixelSize = fullMaxPixelSize
        self.thumbnailMaxPixelSize = thumbnailMaxPixelSize
        self.fullQuality = fullQuality
        self.thumbnailQuality = thumbnailQuality
        self.thumbnailCache.countLimit = 300
    }

    // MARK: - Save

    /// Compresses and stores a photo. Returns the relative filename to keep in SwiftData.
    @discardableResult
    func save(imageData data: Data) throws -> String {
        try ensureDirectoryExists()

        let fullData = try Self.downsampledJPEG(from: data,
                                                maxPixelSize: fullMaxPixelSize,
                                                quality: fullQuality)
        let thumbData = try Self.downsampledJPEG(from: data,
                                                 maxPixelSize: thumbnailMaxPixelSize,
                                                 quality: thumbnailQuality)

        let filename = "\(UUID().uuidString).\(Self.fileExtension)"
        let fullURL = fileURL(for: filename, variant: .full)
        let thumbURL = fileURL(for: filename, variant: .thumbnail)
        let options: Data.WritingOptions = [.atomic, .completeFileProtectionUntilFirstUserAuthentication]

        try fullData.write(to: fullURL, options: options)
        do {
            try thumbData.write(to: thumbURL, options: options)
        } catch {
            try? fileManager.removeItem(at: fullURL)   // never leave half a photo behind
            throw error
        }
        return filename
    }

    /// Convenience for images that only exist as UIImage (e.g. camera UIImagePickerController).
    @discardableResult
    func save(image: UIImage) throws -> String {
        guard let data = image.jpegData(compressionQuality: 1.0) else {
            throw ImageStorageError.encodingFailed
        }
        return try save(imageData: data)
    }

    // MARK: - Load

    func loadImage(filename: String, variant: ImageVariant = .full) throws -> UIImage {
        try validate(filename)
        let key = filename as NSString
        if variant == .thumbnail, let cached = thumbnailCache.object(forKey: key) {
            return cached
        }

        var url = fileURL(for: filename, variant: variant)
        if variant == .thumbnail, !fileManager.fileExists(atPath: url.path(percentEncoded: false)) {
            // Older or partially written photo: fall back to the full image.
            url = fileURL(for: filename, variant: .full)
        }
        guard let image = UIImage(contentsOfFile: url.path(percentEncoded: false)) else {
            throw ImageStorageError.fileNotFound(filename)
        }
        // Decode now, off the main thread, so scrolling stays smooth.
        let decoded = image.preparingForDisplay() ?? image
        if variant == .thumbnail {
            thumbnailCache.setObject(decoded, forKey: key)
        }
        return decoded
    }

    /// Non-throwing variant for views: returns nil if the file is missing.
    func image(filename: String?, variant: ImageVariant = .thumbnail) -> UIImage? {
        guard let filename else { return nil }
        return try? loadImage(filename: filename, variant: variant)
    }

    /// Raw JPEG bytes, e.g. for sending a health-check photo to the Gateway.
    func data(filename: String, variant: ImageVariant = .full) throws -> Data {
        try validate(filename)
        let url = fileURL(for: filename, variant: variant)
        guard let data = try? Data(contentsOf: url) else {
            throw ImageStorageError.fileNotFound(filename)
        }
        return data
    }

    func exists(filename: String) -> Bool {
        guard (try? validate(filename)) != nil else { return false }
        return fileManager.fileExists(atPath: fileURL(for: filename, variant: .full).path(percentEncoded: false))
    }

    // MARK: - Delete

    func delete(filename: String) {
        guard (try? validate(filename)) != nil else { return }
        thumbnailCache.removeObject(forKey: filename as NSString)
        for variant in [ImageVariant.full, .thumbnail] {
            try? fileManager.removeItem(at: fileURL(for: filename, variant: variant))
        }
    }

    func delete(filenames: [String]) {
        filenames.forEach { delete(filename: $0) }
    }

    /// Deletes every stored photo whose base filename isn't in `referenced`.
    /// Returns the number of photos removed.
    @discardableResult
    func deleteOrphans(keeping referenced: Set<String>) -> Int {
        guard let contents = try? fileManager.contentsOfDirectory(
            at: directoryURL, includingPropertiesForKeys: nil
        ) else { return 0 }

        var removed = Set<String>()
        for url in contents where url.pathExtension == Self.fileExtension {
            let base = Self.baseFilename(fromStoredName: url.lastPathComponent)
            if !referenced.contains(base) {
                try? fileManager.removeItem(at: url)
                thumbnailCache.removeObject(forKey: base as NSString)
                removed.insert(base)
            }
        }
        return removed.count
    }

    // MARK: - Diagnostics

    /// Total bytes used by all stored photos (shown in Settings).
    func totalStorageBytes() -> Int64 {
        guard let contents = try? fileManager.contentsOfDirectory(
            at: directoryURL, includingPropertiesForKeys: [.fileSizeKey]
        ) else { return 0 }
        return contents.reduce(into: Int64(0)) { total, url in
            let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            total += Int64(size)
        }
    }

    func clearMemoryCache() {
        thumbnailCache.removeAllObjects()
    }

    // MARK: - Paths

    private func ensureDirectoryExists() throws {
        if !fileManager.fileExists(atPath: directoryURL.path(percentEncoded: false)) {
            try fileManager.createDirectory(at: directoryURL, withIntermediateDirectories: true)
        }
    }

    private func fileURL(for filename: String, variant: ImageVariant) -> URL {
        switch variant {
        case .full:
            return directoryURL.appending(path: filename, directoryHint: .notDirectory)
        case .thumbnail:
            let stem = (filename as NSString).deletingPathExtension
            return directoryURL.appending(
                path: "\(stem)\(Self.thumbnailSuffix).\(Self.fileExtension)",
                directoryHint: .notDirectory
            )
        }
    }

    /// Only accept "<UUID>.jpg" so a bad value can never escape the photo folder.
    private func validate(_ filename: String) throws {
        let stem = (filename as NSString).deletingPathExtension
        guard (filename as NSString).pathExtension == Self.fileExtension,
              UUID(uuidString: stem) != nil else {
            throw ImageStorageError.invalidFilename(filename)
        }
    }

    nonisolated private static func baseFilename(fromStoredName name: String) -> String {
        let stem = (name as NSString).deletingPathExtension
        let base = stem.hasSuffix(thumbnailSuffix) ? String(stem.dropLast(thumbnailSuffix.count)) : stem
        return "\(base).\(fileExtension)"
    }

    // MARK: - Compression (pure, nonisolated)

    nonisolated private static func downsampledJPEG(from data: Data,
                                                    maxPixelSize: Int,
                                                    quality: Double) throws -> Data {
        let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let source = CGImageSourceCreateWithData(data as CFData, sourceOptions) else {
            throw ImageStorageError.unreadableImageData
        }

        let thumbnailOptions: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,   // apply EXIF orientation
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixelSize
        ]
        guard let cgImage = CGImageSourceCreateThumbnailAtIndex(
            source, 0, thumbnailOptions as CFDictionary
        ) else {
            throw ImageStorageError.unreadableImageData
        }

        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(
            output as CFMutableData, UTType.jpeg.identifier as CFString, 1, nil
        ) else {
            throw ImageStorageError.encodingFailed
        }
        // No metadata dictionary is copied → EXIF/GPS is stripped.
        let destinationOptions = [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary
        CGImageDestinationAddImage(destination, cgImage, destinationOptions)
        guard CGImageDestinationFinalize(destination) else {
            throw ImageStorageError.encodingFailed
        }
        return output as Data
    }
}
