import Foundation

struct RatingEvidence: Codable, Hashable {
    let source: String
    let sourceUrl: String
    let geography: String
    let periodStart: String?
    let periodEnd: String?
    let fetchedAt: Date
    let estimated: Bool
    let method: String
}
struct RatingBudgetLine: Codable, Hashable, Identifiable {
    let title: String
    let lowMinor: Int
    let highMinor: Int
    let evidence: RatingEvidence
    var id: String { title }
}
struct TripRating: Codable, Hashable {
    let preliminaryScore: Int?
    let preliminaryVersion: String?
    let version: String
    let score, budgetScore, roadScore, safetyScore, conditionsScore, stayScore: Int?
    let totalLowMinor, totalHighMinor, stayLowMinor, stayHighMinor: Int?
    let currency: String
    let days, nights: Int?
    let fullBudgetMinor: Int?
    let travelers: Int
    let housing, food, completeness, suitability, entryStatus: String
    let updatedAt: Date
    let reasons, missing: [String]
    let lines: [RatingBudgetLine]
    let evidence: [RatingEvidence]
    var title: String {
        if suitability == "avoid" { return "Поездка не рекомендована" }
        return score.map { "\($0)/100 · Для поездки" } ?? "Недостаточно данных для полного рейтинга"
    }
    var completenessLabel: String {
        switch completeness { case "high": return "Высокая"; case "medium": return "Средняя"; default: return "Низкая" }
    }
    static func money(_ low: Int, _ high: Int) -> String {
        low == high ? Money.format(low) : Money.format(low) + " – " + Money.format(high)
    }
}
struct TripPreferences: Codable, Equatable, Hashable {
    var travelers = 1
    var housing = "standard"
    var food = "mixed"
    var fullBudgetMinor: Int? = nil
}
