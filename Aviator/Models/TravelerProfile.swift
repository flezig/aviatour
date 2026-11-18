import Foundation
import Combine

enum TravelInterest: String, Codable, CaseIterable, Identifiable {
    case sea, culture, food, architecture, nature, nightlife
    var id: String { rawValue }
    var title: String {
        switch self { case .sea: return "Море"; case .culture: return "Музеи и культура"; case .food: return "Гастрономия"; case .architecture: return "Архитектура"; case .nature: return "Природа"; case .nightlife: return "Вечерняя жизнь" }
    }
}
enum TravelStyle: String, Codable, CaseIterable, Identifiable {
    case balanced, cheaper, lessRoad, family
    var id: String { rawValue }
    var title: String {
        switch self { case .balanced: return "Баланс"; case .cheaper: return "Дешевле"; case .lessRoad: return "Меньше дороги"; case .family: return "С семьёй" }
    }
    var weights: (price: Int, road: Int, interests: Int) {
        switch self { case .balanced: return (40, 35, 25); case .cheaper: return (60, 20, 20); case .lessRoad: return (20, 60, 20); case .family: return (30, 50, 20) }
    }
}
struct TravelerPreferences: Codable, Equatable, Hashable {
    var citizenship: String? = nil
    var residence: String? = nil
    var interests: Set<TravelInterest> = []
    var style: TravelStyle = .balanced
}
@MainActor final class TravelerProfile: ObservableObject {
    @Published var preferences: TravelerPreferences { didSet { save() } }
    @Published private(set) var savedCities: Set<String> { didSet { save() } }
    private let defaults: UserDefaults
    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        preferences = defaults.data(forKey: "traveler.preferences").flatMap { try? JSONDecoder().decode(TravelerPreferences.self, from: $0) } ?? TravelerPreferences()
        savedCities = Set(defaults.stringArray(forKey: "traveler.savedCities") ?? [])
    }
    func toggleCity(_ code: String) {
        if savedCities.contains(code) { savedCities.remove(code) } else { savedCities.insert(code) }
    }
    private func save() {
        if let data = try? JSONEncoder().encode(preferences) { defaults.set(data, forKey: "traveler.preferences") }
        defaults.set(savedCities.sorted(), forKey: "traveler.savedCities")
    }
}
struct CityGuide: Codable, Hashable {
    let country, currency, summary, days: String
    let tags, places, areas: [String]
    let tourismUrl, editorialUpdated: String
    let hdiValue: Double?
    let hdiYear: Int?
    static let all: [String: CityGuide] = {
        #if SWIFT_PACKAGE
        let bundle = Bundle.module
        #else
        let bundle = Bundle.main
        #endif
        guard let url = bundle.url(forResource: "city-guides", withExtension: "json"), let data = try? Data(contentsOf: url) else { return [:] }
        let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
        return (try? decoder.decode([String: CityGuide].self, from: data)) ?? [:]
    }()
    func match(_ interests: Set<TravelInterest>) -> Int? {
        guard !interests.isEmpty else { return nil }
        return Int((Double(interests.filter { tags.contains($0.rawValue) }.count) / Double(interests.count) * 100).rounded())
    }
}
enum PersonalRanking {
    // Preference fit is deliberately separate from a complete trip/safety assessment.
    static func score(_ offer: Offer, preferences: TravelerPreferences) -> Int? {
        guard !offer.isDemo, offer.tripRating?.suitability != "avoid", let road = offer.tripRating?.roadScore,
              let interests = CityGuide.all[offer.cityCode]?.match(preferences.interests) else { return nil }
        let price = Int(max(0, min(100, (2 - Double(offer.priceMinor) / 2_000_000) / 1.5 * 100)).rounded())
        let w = preferences.style.weights
        return Int((Double(price*w.price + road*w.road + interests*w.interests)/100).rounded())
    }
}
