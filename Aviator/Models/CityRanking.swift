import Foundation

struct CityRatingRequest: Identifiable, Equatable {
    let id = UUID()
    let offer: Offer?
    let cityCode: String?
    init(offer: Offer) { self.offer = offer; cityCode = offer.cityCode }
    init(cityCode: String) { offer = nil; self.cityCode = cityCode }
}
enum CityScoreKind: String, CaseIterable, Identifiable {
    case flight, full
    var id: String { rawValue }
    var title: String { self == .flight ? "Перелёт" : "Полная поездка" }
}
enum CityRankingSort: String, CaseIterable, Identifiable {
    case score, price, road, name, interests, hdi, personal
    var id: String { rawValue }
    var title: String {
        switch self { case .personal: return "Под мои предпочтения"; case .interests: return "По совпадению интересов"; case .hdi: return "По HDI страны"; case .score: return "По баллу"; case .price: return "По средней цене перелёта"; case .road: return "По удобству дороги"; case .name: return "По названию" }
    }
}
struct CityRankingFilters: Equatable {
    var text = ""
    var countryCode: String? = nil
    var hasDirect = false
    var knownSafety = false
    var maxAverageMinor: Int? = nil
    var minScore: Int? = nil
}
struct CityRating: Identifiable, Hashable {
    let id: String
    let city: String
    let country: String?
    let countryCode: String?
    let offers: [Offer]
    let averagePriceMinor: Int
    let minPriceMinor: Int
    let maxPriceMinor: Int
    let updatedAt: Date
    let bestFlightOffer: Offer
    let bestFullOffer: Offer
    let roadScore: Int?
    let searchKey: String
    var medianPriceMinor: Int {
        let prices = offers.map(\.priceMinor).sorted()
        let middle = prices.count / 2
        return prices.count % 2 == 1 ? prices[middle] : Int((Double(prices[middle-1]) + Double(prices[middle])) / 2)
    }
    func personalScore(_ preferences: TravelerPreferences) -> Int? {
        guard !avoid else { return nil }
        return offers.compactMap { PersonalRanking.score($0, preferences: preferences) }.max()
    }
    var averagePriceLabel: String { Money.format(Int((Double(averagePriceMinor) / 100).rounded()) * 100) }
    var isDemo: Bool { offers.allSatisfy(\.isDemo) }
    var hasDirect: Bool { offers.contains(where: \.isDirect) }
    var hasWarning: Bool { offers.contains { $0.tripRating?.suitability == "avoid" || $0.tripRating?.suitability == "warning" } }
    var avoid: Bool { offers.contains { $0.tripRating?.suitability == "avoid" } }
    var hasKnownSafety: Bool { offers.contains { $0.tripRating?.safetyScore != nil } }
    func best(_ kind: CityScoreKind) -> Offer { kind == .flight ? bestFlightOffer : bestFullOffer }
    func score(_ kind: CityScoreKind) -> Int? { avoid ? nil : score(best(kind), kind) }
    private func score(_ offer: Offer, _ kind: CityScoreKind) -> Int? {
        kind == .full ? offer.tripRating?.score : offer.tripRating?.preliminaryScore
    }

}
enum CityRanking {
    static func key(_ value: String) -> String {
        let folded = value.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "ru_RU"))
        return (folded.applyingTransform(.toLatin, reverse: false) ?? folded).folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US"))
    }
    static func build(_ offers: [Offer], now: Date) -> [CityRating] {
        var unique: [String: Offer] = [:]
        for offer in offers where offer.currency == "RUB" && offer.canDisplay(at: now) {
            let identity = offer.source + "|" + offer.id
            if let old = unique[identity], old.receivedAt > offer.receivedAt || (old.receivedAt == offer.receivedAt && old.priceMinor <= offer.priceMinor) { continue }
            unique[identity] = offer
        }
        return Dictionary(grouping: unique.values, by: \.cityCode).map { code, rows in
            let ordered = rows.sorted { $0.id < $1.id }
            let first = ordered[0]
            func best(_ kind: CityScoreKind) -> Offer {
                ordered.min { a, b in
                    let av = kind == .full ? a.tripRating?.score : a.tripRating?.preliminaryScore
                    let bv = kind == .full ? b.tripRating?.score : b.tripRating?.preliminaryScore
                    if av != bv { return (av ?? -1) > (bv ?? -1) }
                    if a.priceMinor != b.priceMinor { return a.priceMinor < b.priceMinor }
                    return a.id < b.id
                }!
            }
            return CityRating(id: code, city: first.city, country: first.country, countryCode: first.countryCode, offers: ordered,
                averagePriceMinor: Int((rows.reduce(0.0) { $0 + Double($1.priceMinor) } / Double(rows.count)).rounded()),
                minPriceMinor: rows.map(\.priceMinor).min()!, maxPriceMinor: rows.map(\.priceMinor).max()!,
                updatedAt: rows.map(\.receivedAt).max()!, bestFlightOffer: best(.flight), bestFullOffer: best(.full),
                roadScore: rows.compactMap { $0.tripRating?.roadScore }.max(),
                searchKey: key(first.city + " " + (first.country ?? "") + " " + code + " " + Set(rows.map(\.destinationAirport)).sorted().joined(separator: " ")))
        }.sorted { $0.id < $1.id }
    }
    static func visible(_ cities: [CityRating], kind: CityScoreKind, filters: CityRankingFilters, sort: CityRankingSort, preferences: TravelerPreferences = TravelerPreferences()) -> [CityRating] {
        let text = key(filters.text.trimmingCharacters(in: .whitespacesAndNewlines))
        return cities.filter { city in
            (text.isEmpty || city.searchKey.contains(text)) && (filters.countryCode == nil || city.countryCode == filters.countryCode)
                && (!filters.hasDirect || city.hasDirect) && (!filters.knownSafety || city.best(kind).tripRating?.safetyScore != nil)
                && (filters.maxAverageMinor.map { city.averagePriceMinor <= $0 } ?? true)
                && (filters.minScore.map { minimum in (sort == .personal ? city.personalScore(preferences) : city.score(kind)).map { $0 >= minimum } ?? false } ?? true)
        }.sorted { a, b in
            switch sort {
            case .personal:
                if a.personalScore(preferences) != b.personalScore(preferences) { return (a.personalScore(preferences) ?? -1) > (b.personalScore(preferences) ?? -1) }
            case .interests:
                let av = CityGuide.all[a.id]?.match(preferences.interests), bv = CityGuide.all[b.id]?.match(preferences.interests)
                if av != bv { return (av ?? -1) > (bv ?? -1) }
            case .hdi:
                let av = CityGuide.all[a.id]?.hdiValue, bv = CityGuide.all[b.id]?.hdiValue
                if av != bv { return (av ?? -1) > (bv ?? -1) }

            case .score: if a.score(kind) != b.score(kind) { return (a.score(kind) ?? -1) > (b.score(kind) ?? -1) }
            case .price: if a.averagePriceMinor != b.averagePriceMinor { return a.averagePriceMinor < b.averagePriceMinor }
            case .road: if a.roadScore != b.roadScore { return (a.roadScore ?? -1) > (b.roadScore ?? -1) }
            case .name: if a.city != b.city { return a.city.localizedStandardCompare(b.city) == .orderedAscending }
            }
            if a.averagePriceMinor != b.averagePriceMinor { return a.averagePriceMinor < b.averagePriceMinor }
            return a.id < b.id
        }
    }
}

struct RatingCategoryInfo: Identifiable {
    let id: String
    let title: String
    let symbol: String
    let score: Int?
    let weight: Int
    let explanation: String
    var contribution: Double? { score.map { Double($0 * weight) / 100 } }
    static func categories(_ offer: Offer, kind: CityScoreKind) -> [RatingCategoryInfo] {
        let r = offer.tripRating
        let price = r?.preliminaryScore == nil ? nil : Int(max(0, min(100, (2 - Double(offer.priceMinor) / 2_000_000) / 1.5 * 100)).rounded())
        return [
            RatingCategoryInfo(id: "budget", title: kind == .full ? "Полный бюджет" : "Цена перелёта", symbol: "rublesign.circle", score: kind == .full ? r?.budgetScore : price, weight: kind == .full ? 45 : 65,
                explanation: kind == .full ? "Билеты, жильё за все ночи, питание и местный транспорт. Расходы на человека с учётом общего жилья. Неизвестные суммы не считаются нулём." : "Билеты туда-обратно на одного взрослого. Фиксированный эталон 20 000 ₽: от 100 баллов при цене до 10 000 ₽ до 0 при цене от 40 000 ₽. Кешированная цена не подтверждает наличие мест."),
            RatingCategoryInfo(id: "road", title: "Удобство дороги", symbol: "airplane", score: r?.roadScore, weight: kind == .full ? 25 : 35,
                explanation: "Длительность обоих плеч, пересадки, расписание и доля времени на месте. Прилёт расчётный, трансфер из аэропорта не учтён. Неизвестные пересадки не считаются прямым рейсом."),
            RatingCategoryInfo(id: "safety", title: "Безопасность", symbol: "shield.lefthalf.filled", score: r?.safetyScore, weight: kind == .full ? 20 : 0,
                explanation: "Кражи и мошенничество, насильственные преступления и действующие предупреждения рассматриваются отдельно. При отсутствии сопоставимых данных безопасность неизвестна. Показатель страны не считается измерением города."),
            RatingCategoryInfo(id: "conditions", title: "Условия отдыха", symbol: "sun.max", score: r?.conditionsScore, weight: kind == .full ? 10 : 0,
                explanation: "Сезон, погода на выбранные даты и удобство передвижения. Текущий прогноз не применяется к далёким датам. Нет данных — нет численного компонента.")
        ]
    }
}
