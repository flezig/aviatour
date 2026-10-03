import Foundation

enum TravelDates {
    static func calendar(_ zone: String) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: zone) ?? TimeZone(secondsFromGMT: 0)!
        return calendar
    }
    static func month(_ date: Date, zone: String = "Europe/Moscow") -> String {
        let c = calendar(zone).dateComponents([.year, .month], from: date)
        return String(format: "%04d-%02d", c.year!, c.month!)
    }
    static func months(now: Date, zone: String) -> [String] {
        let cal = calendar(zone)
        return (0..<6).compactMap { cal.date(byAdding: .month, value: $0, to: cal.date(from: cal.dateComponents([.year, .month], from: now))!) }.map { month($0, zone: zone) }
    }
    static func monthLabel(_ value: String) -> String {
        let parts = value.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 2, let date = calendar("UTC").date(from: DateComponents(year: parts[0], month: parts[1], day: 1)) else { return value }
        let f = DateFormatter(); f.locale = Locale(identifier: "ru_RU"); f.timeZone = TimeZone(secondsFromGMT: 0); f.dateFormat = "LLLL yyyy"
        return f.string(from: date).capitalized
    }
    static func display(_ date: Date, zone: String, time: Bool = false) -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "ru_RU"); f.timeZone = TimeZone(identifier: zone)
        f.dateFormat = time ? "d MMM yyyy, HH:mm" : "d MMM yyyy"
        return f.string(from: date)
    }
    static func dayMonth(_ date: Date, zone: String) -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(identifier: zone); f.dateFormat = "ddMM"
        return f.string(from: date)
    }
    static func days(_ offer: Offer) -> Int {
        let a = calendar(offer.originTimezone).dateComponents([.year, .month, .day], from: offer.departureAt)
        let b = calendar(offer.destinationTimezone).dateComponents([.year, .month, .day], from: offer.returnAt)
        let utc = calendar("UTC")
        return utc.dateComponents([.day], from: utc.date(from: a)!, to: utc.date(from: b)!).day ?? 0
    }
}

enum SearchRules {
    static func accepts(_ offer: Offer, query: SearchQuery, now: Date, filters: ExtraFilters = ExtraFilters()) -> Bool {
        guard offer.currency == "RUB", (query.originCityCode.map { offer.originCityCode == $0 } ?? (offer.originAirport == query.origin)), offer.departureAt > now,
              offer.returnAt > offer.departureAt, offer.priceMinor <= query.maxBudgetMinor,
              TravelDates.month(offer.departureAt, zone: offer.originTimezone) == query.month else { return false }
        let outbound = TravelDates.calendar(offer.originTimezone).component(.weekday, from: offer.departureAt)
        let inbound = TravelDates.calendar(offer.destinationTimezone).component(.weekday, from: offer.returnAt)
        let days = TravelDates.days(offer)
        let weekend = (outbound == 6 && inbound == 1 && days == 2) || (outbound == 6 && inbound == 2 && days == 3) || (outbound == 7 && inbound == 2 && days == 2)
        return weekend && (!(query.directOnly || filters.direct) || offer.isDirect) && (!filters.cheap || offer.priceMinor <= 2_000_000) && (!filters.russia || offer.countryCode == "RU")
    }
    static func sorted(_ offers: [Offer]) -> [Offer] {
        offers.sorted { a, b in
            if a.priceMinor != b.priceMinor { return a.priceMinor < b.priceMinor }
            if a.cityCode != b.cityCode { return a.cityCode < b.cityCode }
            return a.id < b.id
        }
    }
    static func destinations(_ offers: [Offer], query: SearchQuery, now: Date, filters: ExtraFilters) -> [Offer] {
        let sorted = sorted(offers.filter { accepts($0, query: query, now: now, filters: filters) })
        var seen = Set<String>()
        return sorted.filter { seen.insert($0.cityCode).inserted }
    }
}

enum Money {
    static func format(_ minor: Int, currency: String = "RUB") -> String {
        let f = NumberFormatter(); f.locale = Locale(identifier: "ru_RU"); f.numberStyle = .currency
        f.currencyCode = currency; f.minimumFractionDigits = minor % 100 == 0 ? 0 : 2; f.maximumFractionDigits = 2
        return f.string(from: NSDecimalNumber(decimal: Decimal(minor) / 100)) ?? "\(minor) коп."
    }
}
