//
//  CareSchedule.swift
//  Botanica
//
//  One recurring care task for one plant (e.g. "water every 9 days").
//  Dates are stored as start-of-day; the reminder clock time is applied
//  by the NotificationManager (Step 2) from the user's preferred time.
//

import Foundation
import SwiftData

@Model
final class CareSchedule {
    @Attribute(.unique) var id: UUID
    var kindRaw: String
    var isEnabled: Bool

    /// Interval used in the growing season (spring/summer), in days.
    var intervalDays: Int
    /// Optional longer interval for the dormant season (Nov–Feb by default).
    /// `nil` = same as `intervalDays`.
    var winterIntervalDays: Int?

    var lastPerformed: Date?
    /// Start of the day this task is next due.
    var nextDue: Date

    var plant: Plant?

    /// Logs created by this schedule. Deleting the schedule keeps the logs
    /// (nullify) so a plant's history is never lost by turning a toggle off.
    @Relationship(deleteRule: .nullify, inverse: \CareLog.schedule)
    var logs: [CareLog] = []

    init(
        id: UUID = UUID(),
        kind: CareKind,
        intervalDays: Int,
        winterIntervalDays: Int? = nil,
        isEnabled: Bool = true,
        lastPerformed: Date? = nil,
        nextDue: Date? = nil
    ) {
        self.id = id
        self.kindRaw = kind.rawValue
        self.isEnabled = isEnabled
        self.intervalDays = max(1, intervalDays)
        self.winterIntervalDays = winterIntervalDays.map { max(1, $0) }
        self.lastPerformed = lastPerformed
        let anchor = lastPerformed ?? .now
        self.nextDue = nextDue.map(CareCalendar.startOfDay)
            ?? (lastPerformed == nil
                ? CareCalendar.startOfDay(.now)          // never done → due today
                : CareCalendar.day(byAdding: max(1, intervalDays), to: anchor))
    }
}

// MARK: - Behaviour

extension CareSchedule {
    var kind: CareKind {
        get { CareKind(rawValue: kindRaw) ?? .water }
        set { kindRaw = newValue.rawValue }
    }

    /// Dormant months for a mild northern-hemisphere winter. Kept simple on purpose;
    /// a per-species override can come from the reference profile later.
    static let dormantMonths: Set<Int> = [11, 12, 1, 2]

    func effectiveInterval(on date: Date = .now) -> Int {
        let month = CareCalendar.calendar.component(.month, from: date)
        if Self.dormantMonths.contains(month), let winterIntervalDays {
            return winterIntervalDays
        }
        return intervalDays
    }

    /// Records that the task was done and moves `nextDue` forward.
    /// Caller is responsible for creating the matching `CareLog`
    /// and rescheduling notifications.
    func markPerformed(at date: Date = .now) {
        lastPerformed = date
        nextDue = CareCalendar.day(byAdding: effectiveInterval(on: date), to: date)
    }

    /// Re-derives `nextDue` after the interval is edited.
    func recalculateNextDue() {
        guard let lastPerformed else { return }
        nextDue = CareCalendar.day(byAdding: effectiveInterval(on: lastPerformed), to: lastPerformed)
    }

    func status(at date: Date = .now) -> PlantStatus {
        guard isEnabled else { return .healthy }
        let today = CareCalendar.startOfDay(date)
        if nextDue < today { return .overdue }
        if nextDue == today { return .dueToday }
        return .healthy
    }

    /// Whole days until due (negative = overdue).
    func daysUntilDue(from date: Date = .now) -> Int {
        CareCalendar.calendar.dateComponents(
            [.day],
            from: CareCalendar.startOfDay(date),
            to: nextDue
        ).day ?? 0
    }
}
