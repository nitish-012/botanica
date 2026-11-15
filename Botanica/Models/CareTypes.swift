//
//  CareTypes.swift
//  Botanica
//
//  Value types shared by the SwiftData models and the reference database.
//  SwiftData models store these as raw Strings (see each model's `*Raw`
//  properties) so that #Predicate queries stay simple and the store schema
//  never depends on Codable enum encoding.
//
//  `nonisolated` keeps these usable off the main actor even when the Xcode
//  project uses "Default Actor Isolation = MainActor" (Xcode 26 default).
//

import Foundation

// MARK: - Care kinds

nonisolated enum CareKind: String, Codable, CaseIterable, Identifiable, Sendable {
    case water
    case fertilize
    case mist
    case repot
    case prune
    case rotate

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .water:     "Water"
        case .fertilize: "Fertilize"
        case .mist:      "Mist / Humidity Check"
        case .repot:     "Repot"
        case .prune:     "Prune"
        case .rotate:    "Rotate"
        }
    }

    /// Past-tense label used in the journal ("Watered", "Fertilized", …).
    var pastTenseName: String {
        switch self {
        case .water:     "Watered"
        case .fertilize: "Fertilized"
        case .mist:      "Misted"
        case .repot:     "Repotted"
        case .prune:     "Pruned"
        case .rotate:    "Rotated"
        }
    }

    var symbolName: String {
        switch self {
        case .water:     "drop.fill"
        case .fertilize: "leaf.fill"
        case .mist:      "humidity.fill"
        case .repot:     "arrow.up.bin.fill"
        case .prune:     "scissors"
        case .rotate:    "arrow.triangle.2.circlepath"
        }
    }

    /// Fallback interval used only when a plant has no reference profile.
    var defaultIntervalDays: Int {
        switch self {
        case .water:     7
        case .fertilize: 30
        case .mist:      3
        case .repot:     540
        case .prune:     90
        case .rotate:    14
        }
    }
}

// MARK: - Light

nonisolated enum LightLevel: String, Codable, CaseIterable, Identifiable, Sendable {
    case low
    case indirect
    case direct

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .low:      "Low Light"
        case .indirect: "Bright Indirect"
        case .direct:   "Direct Sun"
        }
    }

    var symbolName: String {
        switch self {
        case .low:      "cloud.sun"
        case .indirect: "sun.haze"
        case .direct:   "sun.max.fill"
        }
    }
}

// MARK: - Pot material

nonisolated enum PotMaterial: String, Codable, CaseIterable, Identifiable, Sendable {
    case plastic
    case terracotta
    case glazedCeramic
    case selfWatering
    case other

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .plastic:       "Plastic"
        case .terracotta:    "Terracotta"
        case .glazedCeramic: "Glazed Ceramic"
        case .selfWatering:  "Self-Watering"
        case .other:         "Other"
        }
    }

    /// Multiplier applied to the computed water amount. Terracotta wicks
    /// moisture out of the soil, so it needs a little more per watering.
    var waterAmountFactor: Double {
        switch self {
        case .terracotta:   1.15
        case .selfWatering: 0.8
        default:            1.0
        }
    }
}

// MARK: - Derived plant status (never stored)

nonisolated enum PlantStatus: Int, Comparable, Sendable {
    // Raw value = urgency; higher sorts first on the dashboard.
    case healthy = 0
    case needsReview = 1
    case dueToday = 2
    case overdue = 3

    static func < (lhs: PlantStatus, rhs: PlantStatus) -> Bool { lhs.rawValue < rhs.rawValue }

    var displayName: String {
        switch self {
        case .healthy:     "Healthy"
        case .needsReview: "Needs Gateway Review"
        case .dueToday:    "Due Today"
        case .overdue:     "Overdue"
        }
    }

    var symbolName: String {
        switch self {
        case .healthy:     "checkmark.circle.fill"
        case .needsReview: "arrow.triangle.2.circlepath.circle.fill"
        case .dueToday:    "drop.circle.fill"
        case .overdue:     "exclamationmark.circle.fill"
        }
    }

    var needsAttention: Bool { self != .healthy }
}

// MARK: - Health checks

nonisolated enum HealthCheckKind: String, Codable, CaseIterable, Sendable {
    /// Leaf-color / symptom scan of a known plant.
    case health
    /// Species identification for a plant the app can't recognise.
    case identify
}

nonisolated enum HealthCheckStatus: String, Codable, CaseIterable, Sendable {
    /// The on-device scan reached a confident result.
    case resolvedOnDevice
    /// Waiting for the next Gateway session ("Needs Gateway review" badge).
    case pendingGateway
    /// Sent to the Gateway, awaiting the owner's Allow.
    case submitted
    /// A signed Gateway bundle delivered an answer.
    case answeredByGateway
    /// Dismissed by the user.
    case dismissed

    var isOpen: Bool { self == .pendingGateway || self == .submitted }
}

// MARK: - Date helpers

nonisolated enum CareCalendar {
    static var calendar: Calendar { .current }

    static func startOfDay(_ date: Date) -> Date {
        calendar.startOfDay(for: date)
    }

    /// Start of the day `days` after `date`.
    static func day(byAdding days: Int, to date: Date) -> Date {
        let start = startOfDay(date)
        return calendar.date(byAdding: .day, value: days, to: start) ?? start
    }
}
