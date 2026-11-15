//
//  PlantLifecycle.swift
//  Botanica
//
//  The only supported way to delete user content. SwiftData's cascade rule
//  removes child RECORDS, but it can't remove photo FILES on disk, so we
//  collect filenames first, delete the records, then delete the files.
//  Step 2 adds notification cancellation here as well.
//

import Foundation
import SwiftData

@MainActor
enum PlantLifecycle {

    static func delete(_ plant: Plant, in context: ModelContext,
                       images: ImageStorageManager = .shared) async throws {
        let filenames = plant.allPhotoFilenames
        context.delete(plant)          // cascades schedules, logs, journal, health checks
        try context.save()
        await images.delete(filenames: filenames)
    }

    static func delete(_ entry: JournalEntry, in context: ModelContext,
                       images: ImageStorageManager = .shared) async throws {
        let filename = entry.photoFilename
        context.delete(entry)
        try context.save()
        if let filename { await images.delete(filename: filename) }
    }

    /// Replaces a plant's cover photo and removes the old file.
    static func replaceCoverPhoto(of plant: Plant, with newFilename: String,
                                  in context: ModelContext,
                                  images: ImageStorageManager = .shared) async throws {
        let old = plant.photoFilename
        plant.photoFilename = newFilename
        plant.updatedAt = .now
        try context.save()
        // Keep the file if it is still used as the health-scan baseline.
        if let old, old != newFilename, old != plant.baselinePhotoFilename {
            await images.delete(filename: old)
        }
    }

    /// Safety net: removes photo files no record points to (e.g. after a crash
    /// between saving a photo and saving its record). Run at launch or from Settings.
    @discardableResult
    static func sweepOrphanedPhotos(in context: ModelContext,
                                    images: ImageStorageManager = .shared) async throws -> Int {
        let plants = try context.fetch(FetchDescriptor<Plant>())
        let entries = try context.fetch(FetchDescriptor<JournalEntry>())
        let checks = try context.fetch(FetchDescriptor<HealthCheck>())

        var referenced = Set<String>()
        for plant in plants {
            if let name = plant.photoFilename { referenced.insert(name) }
            if let name = plant.baselinePhotoFilename { referenced.insert(name) }
        }
        entries.compactMap(\.photoFilename).forEach { referenced.insert($0) }
        checks.compactMap(\.photoFilename).forEach { referenced.insert($0) }

        return await images.deleteOrphans(keeping: referenced)
    }
}
