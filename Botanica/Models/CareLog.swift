//
//  CareLog.swift
//  Botanica
//
//  One completed care action ("Watered 350 ml on Nov 12").
//  Owned by the Plant (cascade). The link to the schedule is optional and
//  nullified if that schedule is removed, so history survives.
//

import Foundation
import SwiftData

@Model
final class CareLog {
    @Attribute(.unique) var id: UUID
    var kindRaw: String
    var date: Date
    /// Water actually given, in ml (only for `.water`).
    var amountML: Int?
    var note: String?
    /// True when logged from a lock-screen notification action.
    var loggedFromNotification: Bool

    var plant: Plant?
    var schedule: CareSchedule?

    init(
        id: UUID = UUID(),
        kind: CareKind,
        date: Date = .now,
        amountML: Int? = nil,
        note: String? = nil,
        loggedFromNotification: Bool = false
    ) {
        self.id = id
        self.kindRaw = kind.rawValue
        self.date = date
        self.amountML = amountML
        self.note = note
        self.loggedFromNotification = loggedFromNotification
    }
}

extension CareLog {
    var kind: CareKind {
        get { CareKind(rawValue: kindRaw) ?? .water }
        set { kindRaw = newValue.rawValue }
    }
}
