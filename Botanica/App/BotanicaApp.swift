//
//  BotanicaApp.swift
//  Botanica
//

import SwiftUI
import SwiftData

@main
struct BotanicaApp: App {
    private let modelContainer: ModelContainer

    init() {
        do {
            modelContainer = try BotanicaSchema.makeContainer()
        } catch {
            // A failure here means the on-device store is unreadable.
            // Step 2 replaces this with a recovery screen instead of a crash.
            fatalError("Botanica could not open its local database: \(error)")
        }
    }

    var body: some Scene {
        WindowGroup {
            RootView()
        }
        .modelContainer(modelContainer)
    }
}
