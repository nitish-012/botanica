//
//  HealthCheck.swift
//  Botanica
//
//  Result of an on-device health scan, or a question the app couldn't answer
//  offline. Open checks show the "Needs Gateway review" badge and are sent to
//  the Gateway on the next user-approved update session; answers come back in
//  the signed bundle and are written here (user data is never replaced, only
//  these answer fields are filled in).
//

import Foundation
import SwiftData

@Model
final class HealthCheck {
    @Attribute(.unique) var id: UUID
    var kindRaw: String
    var statusRaw: String
    var createdAt: Date

    /// Photo the scan was run on (relative filename).
    var photoFilename: String?
    /// Symptom IDs the user ticked in the checklist (e.g. "yellow-lower-leaves").
    var symptomIDs: [String]
    /// Plain-language summary of what the on-device scan found.
    var onDeviceSummary: String?
    /// 0…1 confidence of the on-device result. Below threshold → pendingGateway.
    var onDeviceConfidence: Double?

    /// Filled from a verified Gateway bundle.
    var gatewayAnswer: String?
    /// For `.identify`: the species the Gateway matched (reference DB id).
    var gatewaySpeciesID: String?
    var answeredAt: Date?

    var plant: Plant?

    init(
        id: UUID = UUID(),
        kind: HealthCheckKind = .health,
        status: HealthCheckStatus = .pendingGateway,
        createdAt: Date = .now,
        photoFilename: String? = nil,
        symptomIDs: [String] = [],
        onDeviceSummary: String? = nil,
        onDeviceConfidence: Double? = nil
    ) {
        self.id = id
        self.kindRaw = kind.rawValue
        self.statusRaw = status.rawValue
        self.createdAt = createdAt
        self.photoFilename = photoFilename
        self.symptomIDs = symptomIDs
        self.onDeviceSummary = onDeviceSummary
        self.onDeviceConfidence = onDeviceConfidence
    }
}

extension HealthCheck {
    var kind: HealthCheckKind {
        get { HealthCheckKind(rawValue: kindRaw) ?? .health }
        set { kindRaw = newValue.rawValue }
    }

    var status: HealthCheckStatus {
        get { HealthCheckStatus(rawValue: statusRaw) ?? .pendingGateway }
        set { statusRaw = newValue.rawValue }
    }

    /// Applies an answer delivered by a verified Gateway bundle.
    func applyGatewayAnswer(_ answer: String, speciesID: String? = nil, at date: Date = .now) {
        gatewayAnswer = answer
        gatewaySpeciesID = speciesID
        answeredAt = date
        status = .answeredByGateway
    }
}
