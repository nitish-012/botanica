//
//  PlantProfile.swift
//  Botanica
//
//  Read-only reference data decoded from plants_database.json.
//  Not stored in SwiftData: it is replaced wholesale by verified Gateway
//  bundles, so user data and reference data can never be mixed up.
//
//  Units: water in ml, temperature in °C, sizes in cm (internal only).
//

import Foundation

nonisolated struct PlantDatabase: Codable, Sendable {
    /// Bumped only when the JSON shape changes (app refuses unknown versions).
    let schemaVersion: Int
    /// Content version, e.g. "2026.11.12-1". Compared during updates.
    let databaseVersion: String
    let generatedAt: Date
    let plants: [PlantProfile]

    static let supportedSchemaVersion = 1

    static func decode(from data: Data) throws -> PlantDatabase {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let database = try decoder.decode(PlantDatabase.self, from: data)
        guard database.schemaVersion == supportedSchemaVersion else {
            throw DecodingError.dataCorrupted(.init(
                codingPath: [],
                debugDescription: "Unsupported schemaVersion \(database.schemaVersion)"
            ))
        }
        return database
    }

    /// The copy shipped inside the app bundle (fallback before any update).
    static func loadBundled(bundle: Bundle = .main) throws -> PlantDatabase {
        guard let url = bundle.url(forResource: "plants_database", withExtension: "json") else {
            throw CocoaError(.fileNoSuchFile)
        }
        return try decode(from: Data(contentsOf: url))
    }

    func profile(id: String) -> PlantProfile? {
        plants.first { $0.id == id }
    }
}

nonisolated struct PlantProfile: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let commonName: String
    let scientificName: String
    let aliases: [String]
    let family: String
    let difficulty: Difficulty
    let summary: String

    let light: Light
    let water: Water
    let humidity: Humidity
    let temperature: Temperature
    let soil: Soil
    let fertilizer: Fertilizer
    let repotting: Repotting
    let pruning: Pruning
    let propagation: [String]
    let growthTips: [String]
    let problems: [Problem]
    let pests: [Pest]
    let toxicity: Toxicity
    let companions: Companions

    nonisolated enum Difficulty: String, Codable, Sendable { case easy, moderate, hard }

    nonisolated struct Light: Codable, Hashable, Sendable {
        let ideal: LightLevel
        let tolerates: [LightLevel]
        let notes: String
    }

    nonisolated struct Water: Codable, Hashable, Sendable {
        let intervalDaysGrowing: Int
        let intervalDaysDormant: Int
        /// Share of pot volume to give per watering (0.15 = 15 %). The app turns
        /// this into a per-plant ml figure from the pot size.
        let fractionOfPotVolume: Double
        let checkBeforeWatering: String
        let method: String
        let signsOfOverwatering: [String]
        let signsOfUnderwatering: [String]
    }

    nonisolated struct Humidity: Codable, Hashable, Sendable {
        let level: Level
        let idealMinPercent: Int
        let misting: Bool
        let notes: String
        nonisolated enum Level: String, Codable, Sendable { case low, medium, high }
    }

    nonisolated struct Temperature: Codable, Hashable, Sendable {
        let minC: Int
        let idealMinC: Int
        let idealMaxC: Int
        let notes: String
    }

    nonisolated struct Soil: Codable, Hashable, Sendable {
        let mix: String
        let drainage: String
    }

    nonisolated struct Fertilizer: Codable, Hashable, Sendable {
        let type: String
        let dilution: String
        let intervalDaysGrowing: Int
        /// Months (1–12) to skip feeding.
        let pauseMonths: [Int]
        let notes: String
    }

    nonisolated struct Repotting: Codable, Hashable, Sendable {
        let everyMonths: Int
        let bestMonths: [Int]
        let potSizeStepCM: Int
        let signs: [String]
        let notes: String
    }

    nonisolated struct Pruning: Codable, Hashable, Sendable {
        let needed: Bool
        let bestMonths: [Int]
        let how: String
    }

    nonisolated struct Problem: Codable, Hashable, Sendable, Identifiable {
        /// Stable ID used by the on-device symptom checklist (HealthCheck.symptomIDs).
        let id: String
        let symptom: String
        let likelyCauses: [String]
        let fix: String
        let severity: Severity
        nonisolated enum Severity: String, Codable, Sendable { case low, medium, high }
    }

    nonisolated struct Pest: Codable, Hashable, Sendable, Identifiable {
        let id: String
        let name: String
        let signs: String
        let treatment: String
        /// False for pests a phone photo can't reliably show (e.g. spider mites):
        /// the scan sends these straight to Gateway review.
        let detectableOnDevice: Bool
    }

    nonisolated struct Toxicity: Codable, Hashable, Sendable {
        let children: Level
        let pets: Level
        let compound: String
        let notes: String
        nonisolated enum Level: String, Codable, Sendable { case none, mild, moderate, severe }
    }

    nonisolated struct Companions: Codable, Hashable, Sendable {
        /// Plants sharing a tag have compatible light/water/humidity needs.
        let groupTags: [String]
        let goodWith: [String]
        let keepApartFrom: [String]
        let notes: String
    }
}
