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
    static func dateKey(_ date: Date, zone: String) -> String {
        Formatters.date(date, zone: zone, locale: "en_US_POSIX", format: "yyyy-MM-dd")
    }
    static func parseDay(_ value: String, zone: String) -> Date? {
        let parts = value.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        guard let date = calendar(zone).date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])),
              dateKey(date, zone: zone) == value else { return nil }
        return date
    }
    static func monthLabel(_ value: String) -> String {
        guard let date = parseDay(value + "-01", zone: "UTC") else { return value }
        return Formatters.date(date, zone: "UTC", locale: "ru_RU", format: "LLLL yyyy").capitalized
    }
    static func display(_ date: Date, zone: String, time: Bool = false) -> String {
        Formatters.date(date, zone: zone, locale: "ru_RU", format: time ? "d MMM yyyy, HH:mm" : "d MMM yyyy")
    }
    static func time(_ date: Date, zone: String) -> String {
        Formatters.date(date, zone: zone, locale: "ru_RU", format: "HH:mm")
    }
    static func dayMonth(_ date: Date, zone: String) -> String {
        Formatters.date(date, zone: zone, locale: "en_US_POSIX", format: "ddMM")
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
        OfferFacts(offer).accepts(query: query, now: now, filters: filters)
    }
    static func options(_ facts: [OfferFacts], query: SearchQuery, now: Date, filters: ExtraFilters, sort: OfferSort = .price) -> [Offer] {
        let matches = facts.filter { $0.accepts(query: query, now: now, filters: filters) }.sorted { a, b in
            let av: Double, bv: Double
            switch sort {
            case .price: av = Double(a.offer.priceMinor); bv = Double(b.offer.priceMinor)
            case .priceDescending: av = -Double(a.offer.priceMinor); bv = -Double(b.offer.priceMinor)
            case .departure: av = a.offer.departureAt.timeIntervalSince1970; bv = b.offer.departureAt.timeIntervalSince1970
            case .duration: av = a.totalFlightMinutes; bv = b.totalFlightMinutes
            case .stay: av = a.offer.stayHours.map { -$0 } ?? .infinity; bv = b.offer.stayHours.map { -$0 } ?? .infinity
            case .value: av = a.offer.stayHours.map { Double(a.offer.priceMinor) / $0 } ?? .infinity; bv = b.offer.stayHours.map { Double(b.offer.priceMinor) / $0 } ?? .infinity
            }
            if av != bv { return av < bv }
            if a.offer.priceMinor != b.offer.priceMinor { return a.offer.priceMinor < b.offer.priceMinor }
            if a.offer.cityCode != b.offer.cityCode { return a.offer.cityCode < b.offer.cityCode }
            return a.offer.id < b.offer.id
        }
        var seen = Set<String>()
        return matches.compactMap { fact in
            if filters.uniqueDestinations && !seen.insert(fact.offer.cityCode).inserted { return nil }
            return fact.offer
        }
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

// Bounded cache; lock protects formatter use across UI and background work.
private enum Formatters {
    static let lock = NSLock()
    static var dates: [String: DateFormatter] = [:]
    static var money: [String: NumberFormatter] = [:]
    static func date(_ value: Date, zone: String, locale: String, format: String) -> String {
        lock.lock(); defer { lock.unlock() }
        let key = zone + "|" + locale + "|" + format
        let formatter: DateFormatter
        if let cached = dates[key] { formatter = cached }
        else {
            formatter = DateFormatter(); formatter.locale = Locale(identifier: locale)
            formatter.timeZone = TimeZone(identifier: zone); formatter.dateFormat = format
            if dates.count >= 256 { dates.removeAll(keepingCapacity: true) }
            dates[key] = formatter
        }
        return formatter.string(from: value)
    }
    static func currency(_ minor: Int, code: String) -> String {
        lock.lock(); defer { lock.unlock() }
        let key = code + (minor % 100 == 0 ? "0" : "2")
        let formatter: NumberFormatter
        if let cached = money[key] { formatter = cached }
        else {
            formatter = NumberFormatter(); formatter.locale = Locale(identifier: "ru_RU"); formatter.numberStyle = .currency
            formatter.currencyCode = code; formatter.minimumFractionDigits = minor % 100 == 0 ? 0 : 2; formatter.maximumFractionDigits = 2
            money[key] = formatter
        }
        return formatter.string(from: NSDecimalNumber(decimal: Decimal(minor) / 100)) ?? "\(minor) коп."
    }
}

enum Money {
    static func format(_ minor: Int, currency: String = "RUB") -> String { Formatters.currency(minor, code: currency) }
}

struct OfferFacts {
    let offer: Offer
    let month, departureDay, returnDay: String
    let days, outboundWeekday, inboundWeekday, outboundHour, inboundHour: Int
    let arrivalHour, homeHour, homeWeekday: Int?
    let destination: String
    var totalFlightMinutes: Double {
        guard let out = offer.durationTo, let back = offer.durationBack, out > 0, back > 0 else { return .infinity }
        return Double(out) + Double(back)
    }
    init(_ offer: Offer) {
        self.offer = offer
        let origin = TravelDates.calendar(offer.originTimezone), destinationCal = TravelDates.calendar(offer.destinationTimezone)
        month = TravelDates.month(offer.departureAt, zone: offer.originTimezone)
        departureDay = TravelDates.dateKey(offer.departureAt, zone: offer.originTimezone)
        returnDay = TravelDates.dateKey(offer.returnAt, zone: offer.destinationTimezone)
        days = TravelDates.days(offer)
        outboundWeekday = origin.component(.weekday, from: offer.departureAt)
        inboundWeekday = destinationCal.component(.weekday, from: offer.returnAt)
        outboundHour = origin.component(.hour, from: offer.departureAt)
        inboundHour = destinationCal.component(.hour, from: offer.returnAt)
        arrivalHour = offer.arrivalAt.map { destinationCal.component(.hour, from: $0) }
        homeHour = offer.returnArrivalAt.map { origin.component(.hour, from: $0) }
        homeWeekday = offer.returnArrivalAt.map { origin.component(.weekday, from: $0) }
        destination = [offer.city, offer.cityCode, offer.destinationAirport, offer.country ?? ""].joined(separator: " ").lowercased()
    }
    func accepts(query: SearchQuery, now: Date, filters: ExtraFilters) -> Bool {
        guard offer.canDisplay(at: now) else { return false }
        guard offer.currency == "RUB", offer.departureAt > now, offer.returnAt > offer.departureAt,
              offer.priceMinor <= query.maxBudgetMinor,
              query.originCityCode.map({ offer.originCityCode == $0 }) ?? (offer.originAirport == query.origin) else { return false }
        guard query.region.includes(offer.countryCode) else { return false }
        if let city = query.destinationCityCode { if offer.cityCode != city { return false } }
        else if let airport = query.destination, offer.destinationAirport != airport { return false }
        if query.usesExactDates {
            guard departureDay == query.departureDate, returnDay == query.returnDate else { return false }
        } else {
            guard month == query.month else { return false }
            let weekend = (outboundWeekday == 6 && inboundWeekday == 1 && days == 2) || (outboundWeekday == 6 && inboundWeekday == 2 && days == 3) || (outboundWeekday == 7 && inboundWeekday == 2 && days == 2)
            if query.weekendOnly && !weekend { return false }
        }
        if (query.directOnly || filters.direct) && !offer.isDirect { return false }
        if filters.cheap && offer.priceMinor > 2_000_000 { return false }
        if filters.russia && offer.countryCode != "RU" { return false }
        if offer.priceMinor < filters.minPriceMinor || offer.priceMinor > (filters.maxPriceMinor ?? Int.max) { return false }
        if let country = filters.countryCode, offer.countryCode != country { return false }
        if let airline = filters.airline, offer.airline != airline { return false }
        let text = filters.destinationText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if !text.isEmpty && !destination.contains(text) { return false }
        if let max = filters.maxTransfers {
            guard let out = offer.transfers, let back = offer.returnTransfers, out <= max, back <= max else { return false }
        }
        if let max = filters.maxFlightMinutes {
            guard let out = offer.durationTo, let back = offer.durationBack, out > 0, back > 0, out <= max, back <= max else { return false }
        }
        if days < filters.minDays || days > (filters.maxDays ?? Int.max) { return false }
        if filters.minStayHours > 0 && (offer.stayHours ?? 0) < Double(filters.minStayHours) { return false }
        if !filters.outboundTime.includes(outboundHour) || !filters.inboundTime.includes(inboundHour) { return false }
        if filters.arrivalTime != .any && !filters.arrivalTime.includes(arrivalHour ?? -1) { return false }
        if filters.returnArrivalTime != .any && !filters.returnArrivalTime.includes(homeHour ?? -1) { return false }
        if filters.noLeave {
            let departureOK = (outboundWeekday == 6 && outboundHour >= 18) || outboundWeekday == 7
            let returnOK = homeWeekday == 1 || (homeWeekday == 2 && (homeHour ?? 24) < 9)
            if !departureOK || !returnOK { return false }
        }
        return true
    }
}


enum OfferCount {
    static func label(_ count: Int) -> String {
        let remainder = count % 100
        let word: String
        if (11...14).contains(remainder) { word = "вариантов" }
        else if count % 10 == 1 { word = "вариант" }
        else if (2...4).contains(count % 10) { word = "варианта" }
        else { word = "вариантов" }
        return "\(count) \(word)"
    }
}
