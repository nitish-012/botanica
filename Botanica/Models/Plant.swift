//
//  Plant.swift
//  Botanica
//
//  The root user-data entity. Everything else hangs off a Plant and is
//  removed with it (cascade). Photo FILES are not removed by SwiftData —
//  always delete through `PlantLifecycle.delete(_:in:)`.
//

import Foundation
import SwiftData

@Model
final class Plant {
    @Attribute(.unique) var id: UUID

    // MARK: Identity
    var nickname: String
    /// Key into the reference database (`PlantProfile.id`), e.g. "epipremnum-aureum".
    /// `nil` until the species is known (a pending `identify` HealthCheck exists).
    var speciesID: String?
    /// Display name shown on cards. Copied from the profile at creation so the
    /// card still reads correctly if a later database update renames a species.
    var speciesName: String

    // MARK: Placement
    var room: String
    var lightRaw: String
    var acquisitionDate: Date?
    var notes: String

    // MARK: Pot (drives the ml water amount)
    /// Internal only — estimated from setup photos. The UI shows ml, never this.
    var potDiameterCM: Double?
    var potMaterialRaw: String
    var hasDrainage: Bool
    /// Per-plant override in ml. `nil` = use the computed amount.
    var waterAmountOverrideML: Int?

    // MARK: Photos (relative filenames inside Documents/PlantPhotos)
    /// Cover photo used for the card and detail header.
    var photoFilename: String?
    /// Reference "healthy" photo the on-device health scan compares against.
    var baselinePhotoFilename: String?

    // MARK: Bookkeeping
    var createdAt: Date
    var updatedAt: Date

    // MARK: Relationships (inverses declared here, once per pair)
    @Relationship(deleteRule: .cascade, inverse: \CareSchedule.plant)
    var schedules: [CareSchedule] = []

    @Relationship(deleteRule: .cascade, inverse: \CareLog.plant)
    var careLogs: [CareLog] = []

    @Relationship(deleteRule: .cascade, inverse: \JournalEntry.plant)
    var journalEntries: [JournalEntry] = []

    @Relationship(deleteRule: .cascade, inverse: \HealthCheck.plant)
    var healthChecks: [HealthCheck] = []

    init(
        id: UUID = UUID(),
        nickname: String,
        speciesID: String? = nil,
        speciesName: String = "",
        room: String = "",
        light: LightLevel = .indirect,
        acquisitionDate: Date? = nil,
        notes: String = "",
        potDiameterCM: Double? = nil,
        potMaterial: PotMaterial = .plastic,
        hasDrainage: Bool = true,
        waterAmountOverrideML: Int? = nil,
        photoFilename: String? = nil,
        baselinePhotoFilename: String? = nil,
        createdAt: Date = .now
    ) {
        self.id = id
        self.nickname = nickname
        self.speciesID = speciesID
        self.speciesName = speciesName
        self.room = room
        self.lightRaw = light.rawValue
        self.acquisitionDate = acquisitionDate
        self.notes = notes
        self.potDiameterCM = potDiameterCM
        self.potMaterialRaw = potMaterial.rawValue
        self.hasDrainage = hasDrainage
        self.waterAmountOverrideML = waterAmountOverrideML
        self.photoFilename = photoFilename
        self.baselinePhotoFilename = baselinePhotoFilename
        self.createdAt = createdAt
        self.updatedAt = createdAt
    }
}

// MARK: - Typed accessors

extension Plant {
    var light: LightLevel {
        get { LightLevel(rawValue: lightRaw) ?? .indirect }
        set { lightRaw = newValue.rawValue }
    }

    var potMaterial: PotMaterial {
        get { PotMaterial(rawValue: potMaterialRaw) ?? .other }
        set { potMaterialRaw = newValue.rawValue }
    }

    var displayName: String {
        let trimmed = nickname.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? (speciesName.isEmpty ? "Unnamed Plant" : speciesName) : trimmed
    }
}

// MARK: - Schedules & status

extension Plant {
    var activeSchedules: [CareSchedule] {
        schedules.filter(\.isEnabled).sorted { $0.nextDue < $1.nextDue }
    }

    func schedule(for kind: CareKind) -> CareSchedule? {
        schedules.first { $0.kind == kind }
    }

    /// The soonest enabled care task, if any.
    var nextCareDue: CareSchedule? { activeSchedules.first }

    var hasOpenHealthCheck: Bool {
        healthChecks.contains { $0.status.isOpen }
    }

    /// Dashboard status at a given moment. Overdue > due today > needs review > healthy.
    func status(at date: Date = .now) -> PlantStatus {
        let worstCare = activeSchedules
            .map { $0.status(at: date) }
            .max() ?? .healthy
        if worstCare >= .dueToday { return worstCare }
        return hasOpenHealthCheck ? .needsReview : .healthy
    }

    /// Care logs and journal entries merged newest-first are built in the
    /// view layer (Step 2); this just exposes the raw sorted logs.
    var careLogsNewestFirst: [CareLog] {
        careLogs.sorted { $0.date > $1.date }
    }
}

// MARK: - Photo bookkeeping

extension Plant {
    /// Every photo filename owned by this plant and its children.
    /// Used to remove files from disk when the plant is deleted.
    var allPhotoFilenames: [String] {
        var names: [String] = []
        if let photoFilename { names.append(photoFilename) }
        if let baselinePhotoFilename { names.append(baselinePhotoFilename) }
        names += journalEntries.compactMap(\.photoFilename)
        names += healthChecks.compactMap(\.photoFilename)
        return Array(Set(names))
    }
}
