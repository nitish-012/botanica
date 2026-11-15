//
//  RootView.swift
//  Botanica
//
//  Step 1 placeholder so the project builds and runs.
//  Replaced by the tab bar (My Garden / Guide / Settings) in Step 2.
//

import SwiftUI
import SwiftData

struct RootView: View {
    @Query(sort: \Plant.createdAt) private var plants: [Plant]
    @State private var databaseSummary = "Loading care guide…"

    var body: some View {
        NavigationStack {
            ContentUnavailableView {
                Label("Botanica", systemImage: "leaf.fill")
            } description: {
                Text("\(plants.count) plants in your garden\n\(databaseSummary)")
            }
            .navigationTitle("My Garden")
        }
        .task {
            do {
                let database = try PlantDatabase.loadBundled()
                databaseSummary = "Care guide v\(database.databaseVersion): \(database.plants.count) species"
            } catch {
                databaseSummary = "Care guide failed to load: \(error.localizedDescription)"
            }
        }
    }
}

#Preview {
    RootView()
        .modelContainer(try! BotanicaSchema.makeContainer(inMemory: true))
}
