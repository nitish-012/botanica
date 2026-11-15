//
//  BotanicaSchema.swift
//  Botanica
//
//  Single place that builds the SwiftData container.
//  `cloudKitDatabase: .none` is explicit so the store can never sync to
//  iCloud, even if an iCloud capability is added to the target by accident.
//

import Foundation
import SwiftData

enum BotanicaSchema {
    static var models: [any PersistentModel.Type] {
        [
            Plant.self,
            CareSchedule.self,
            CareLog.self,
            JournalEntry.self,
            HealthCheck.self
        ]
    }

    static func makeContainer(inMemory: Bool = false) throws -> ModelContainer {
        let schema = Schema(models)
        let configuration = ModelConfiguration(
            "Botanica",
            schema: schema,
            isStoredInMemoryOnly: inMemory,
            allowsSave: true,
            groupContainer: .none,
            cloudKitDatabase: .none
        )
        return try ModelContainer(for: schema, configurations: [configuration])
    }
}
