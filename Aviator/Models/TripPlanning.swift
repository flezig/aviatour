import Foundation

enum FavoriteRefreshStatus: String, Codable { case updated, notFound, failed, past }

extension Offer {
    var priceChangeMinor: Int? { originalPriceMinor.map { priceMinor - $0 } }
    var roadMinutes: Int? {
        guard let durationTo, let durationBack, durationTo > 0, durationBack > 0 else { return nil }
        return durationTo + durationBack
    }
    func exactQuery(refresh: Bool = false) -> SearchQuery {
        var query = SearchQuery(origin: originAirport, month: TravelDates.month(departureAt, zone: originTimezone),
                    maxBudgetMinor: 50_000_000, departureDate: TravelDates.dateKey(departureAt, zone: originTimezone),
                    returnDate: TravelDates.dateKey(returnAt, zone: destinationTimezone), weekendOnly: false,
                    destination: destinationAirport, forceRefresh: refresh)
        if let r = tripRating {
            query.tripPreferences = TripPreferences(travelers: r.travelers, housing: r.housing, food: r.food, fullBudgetMinor: r.fullBudgetMinor)
        }
        return query
    }
    func matchesSavedVariant(_ saved: Offer) -> Bool {
        id == saved.id && source == saved.source && currency == saved.currency &&
        originAirport == saved.originAirport && destinationAirport == saved.destinationAirport &&
        departureAt == saved.departureAt && returnAt == saved.returnAt &&
        airline == saved.airline && flightNumber == saved.flightNumber
    }
}

enum TripCollection: String, CaseIterable, Identifiable {
    case noLeave, budget20, budget30, budget50, moreStay, lessRoad, europe, usa
    var id: String { rawValue }
    var title: String {
        switch self {
        case .noLeave: "Без отпуска"
        case .budget20: "Билеты до 20 000 ₽"
        case .budget30: "Билеты до 30 000 ₽"
        case .budget50: "Билеты до 50 000 ₽"
        case .moreStay: "Больше времени на месте"
        case .lessRoad: "Меньше дороги"
        case .europe: "В Европу"
        case .usa: "В США"
        }
    }
    var subtitle: String {
        switch self {
        case .noLeave: "Пятница вечером или суббота — домой к понедельнику утром"
        case .budget20, .budget30, .budget50: "Туда-обратно на одного · в пределах вашего бюджета"
        case .moreStay: "Сначала поездки с большим временем для отдыха"
        case .lessRoad: "Прямые в обе стороны · сначала короткие перелёты"
        case .europe: "Основные города Европы, включая Турцию и Кипр"
        case .usa: "Основные города США"
        }
    }
    var symbol: String {
        switch self {
        case .noLeave: "calendar.badge.clock"
        case .budget20, .budget30, .budget50: "rublesign.circle"
        case .moreStay: "sun.max"
        case .lessRoad: "airplane"
        case .europe, .usa: "globe.europe.africa"
        }
    }
    func parameters(_ base: SearchQuery, airports: [String: Airport]) -> (SearchQuery, ExtraFilters, OfferSort) {
        var query = base
        query.forceRefresh = false
        var filters = ExtraFilters(uniqueDestinations: true)
        var sort: OfferSort = .price
        switch self {
        case .budget20: query.maxBudgetMinor = min(base.maxBudgetMinor, 2_000_000)
        case .budget30: query.maxBudgetMinor = min(base.maxBudgetMinor, 3_000_000)
        case .budget50: query.maxBudgetMinor = min(base.maxBudgetMinor, 5_000_000)
        case .noLeave: filters.noLeave = true; filters.maxDays = 3
        case .moreStay: filters.minStayHours = 1; sort = .stay
        case .lessRoad: query.directOnly = true; sort = .duration
        case .europe, .usa:
            query.region = self == .europe ? .europe : .usa
            if let destination = query.destination, !query.region.includes(airports[destination]?.countryCode) {
                query.destination = nil; query.destinationCityCode = nil
            }
        }
        return (query, filters, sort)
    }
    func reason(for offer: Offer) -> String {
        switch self {
        case .noLeave:
            return "Вылет " + TravelDates.weekdayTime(offer.departureAt, zone: offer.originTimezone) + (offer.stayHours.map { " · ≈ \(Int($0)) ч на месте" } ?? "")
        case .budget20, .budget30, .budget50: return "Билеты туда-обратно · без проживания"
        case .moreStay: return offer.stayHours.map { "≈ \(Int($0)) часов на месте" } ?? "Время на месте неизвестно"
        case .lessRoad: return "Без пересадок туда и обратно" + (offer.roadMinutes.map { " · \($0 / 60) ч \($0 % 60) мин дороги" } ?? " · длительность неизвестна")
        case .europe, .usa: return offer.country ?? "Под выбранный регион"
        }
    }
}

struct NearbyDateOption: Identifiable {
    let offset: Int
    let query: SearchQuery?
    var id: Int { offset }
    var best: Offer? = nil
    var error: String? = nil
    var incomplete = false
}

enum NearbyDates {
    // Shift calendar days, independently in each airport's local zone; keep trip length.
    static func options(for offer: Offer, budget: Int, now: Date) -> [NearbyDateOption] {
        let outbound = TravelDates.calendar(offer.originTimezone)
        let inbound = TravelDates.calendar(offer.destinationTimezone)
        let departureDay = outbound.startOfDay(for: offer.departureAt)
        let returnDay = inbound.startOfDay(for: offer.returnAt)
        let today = outbound.startOfDay(for: now)
        let months = TravelDates.months(now: now, zone: offer.originTimezone)
        return (-3...3).map { offset in
            let departure = outbound.date(byAdding: .day, value: offset, to: departureDay)!
            let returning = inbound.date(byAdding: .day, value: offset, to: returnDay)!
            guard departure >= today, months.contains(TravelDates.month(departure, zone: offer.originTimezone)) else {
                return NearbyDateOption(offset: offset, query: nil, error: "За пределами доступных дат поиска")
            }
            var query = offer.exactQuery()
            query.departureDate = TravelDates.dateKey(departure, zone: offer.originTimezone)
            query.returnDate = TravelDates.dateKey(returning, zone: offer.destinationTimezone)
            query.month = String(query.departureDate!.prefix(7))
            query.maxBudgetMinor = min(50_000_000, max(500_000, budget))
            return NearbyDateOption(offset: offset, query: query)
        }
    }
}
