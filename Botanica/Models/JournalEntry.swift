//
//  JournalEntry.swift
//  Botanica
//
//  A user-written progress note and/or photo for the Growth Journal.
//

import Foundation
import SwiftData

@Model
final class JournalEntry {
    @Attribute(.unique) var id: UUID
    var date: Date
    var text: String
    /// Relative filename inside Documents/PlantPhotos.
    var photoFilename: String?

    var plant: Plant?

    init(
        id: UUID = UUID(),
        date: Date = .now,
        text: String = "",
        photoFilename: String? = nil
    ) {
        self.id = id
        self.date = date
        self.text = text
        self.photoFilename = photoFilename
    }
}

extension JournalEntry {
    var hasPhoto: Bool { photoFilename != nil }
    var isEmpty: Bool {
        text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && photoFilename == nil
    }
}
