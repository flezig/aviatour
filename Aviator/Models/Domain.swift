import Foundation

struct Airport: Codable, Identifiable, Hashable {
    let iata: String
    let cityCode: String
    let city: String
    let name: String
    let countryCode: String?
    let country: String?
    let timezone: String?
    var id: String { iata }
    var label: String { "\(city) · \(iata)" }
}

struct SearchQuery: Codable, Equatable {
    var origin = "SVO"
    var originCityCode: String? = nil
    var month: String
    var maxBudgetMinor = 2_500_000
    var directOnly = false
}

struct Offer: Codable, Identifiable, Hashable {
    let id: String
    let cityCode: String
    let city: String
    let countryCode: String?
    let country: String?
    let originAirport: String
    let destinationAirport: String
    let originCity: String
    let originName: String
    let destinationName: String
    let departureAt: Date
    let returnAt: Date
    let originTimezone: String
    let destinationTimezone: String
    let transfers: Int?
    let returnTransfers: Int?
    let durationTo: Int?
    let durationBack: Int?
    let priceMinor: Int
    let currency: String
    let searchURL: String
    let partnerURL: String?
    let source: String
    let receivedAt: Date
    var originCityCode: String? = nil
    var isDemo: Bool { source == "MOCK" }
    var isDirect: Bool { transfers == 0 && returnTransfers == 0 }
    var imageName: String { destinationAirport }
}

struct SearchResult {
    var offers: [Offer]
    var incomplete: Bool
    var warnings: [String]
}

struct ExtraFilters {
    var cheap = false
    var direct = false
    var russia = false
    var isEmpty: Bool { !cheap && !direct && !russia }
}

protocol AppClock { var now: Date { get } }
struct SystemClock: AppClock { var now: Date { Date() } }
struct FixedClock: AppClock { let now: Date }
