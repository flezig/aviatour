import Foundation

protocol SearchService { func search(_ query: SearchQuery) async throws -> SearchResult }
enum SearchFailure: Error, LocalizedError {
    case unsupportedAirport, offline, configuration, source(String), invalidData
    var errorDescription: String? {
        switch self {
        case .unsupportedAirport: return "Для этого аэропорта нет демонстрационных данных. Выберите Москва · SVO."
        case .offline: return "Нет доступа к backend. Проверьте сеть и адрес сервера."
        case .configuration: return "LIVE не настроен. Проверьте адрес backend и его конфигурацию."
        case .source(let message): return message
        case .invalidData: return "Получены некорректные данные. Попробуйте ещё раз."
        }
    }
}

enum Catalog {
    static func load(bundle: Bundle = .main) throws -> [Airport] {
        guard let url = bundle.url(forResource: "airports", withExtension: "json") else { throw SearchFailure.invalidData }
        let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode([Airport].self, from: Data(contentsOf: url))
    }
}

// Built once at app startup, shared across picker presentations.
struct AirportIndex {
    struct City: Identifiable {
        let id: String
        let name: String
        let representative: Airport
        let codes: String
        let airports: [Airport]
    }
    struct Row: Identifiable {
        enum Kind { case header(City), city(City), airport(Airport) }
        let id: String
        let kind: Kind
    }
    let cities: [City]
    let rows: [Row]
    let byIATA: [String: Airport]
    private let searchable: [String: [String]]
    private let locale: Locale

    init(airports: [Airport], locale: Locale = .current) {
        self.locale = locale
        byIATA = Dictionary(uniqueKeysWithValues: airports.map { ($0.iata, $0) })
        searchable = Dictionary(uniqueKeysWithValues: airports.map { airport in
            (airport.iata, [airport.city, airport.cityCode, airport.iata, airport.name].map {
                $0.folding(options: [.caseInsensitive], locale: locale)
            })
        })
        cities = Dictionary(grouping: airports, by: \.cityCode).map { code, members in
            let first = members[0]
            return City(id: code, name: first.city, representative: first,
                        codes: members.map(\.iata).joined(separator: ", "), airports: members)
        }.sorted {
            let order = $0.name.localizedStandardCompare($1.name)
            return order == .orderedSame ? $0.id < $1.id : order == .orderedAscending
        }
        rows = Self.rows(for: cities)
    }

    static func rows(for cities: [City]) -> [Row] {
        cities.flatMap { city in
            [Row(id: "header." + city.id, kind: .header(city)), Row(id: "city." + city.id, kind: .city(city))]
                + city.airports.map { Row(id: "airport." + $0.iata, kind: .airport($0)) }
        }
    }

    func matching(_ text: String) -> [City] {
        let term = text.trimmingCharacters(in: .whitespacesAndNewlines)
            .folding(options: [.caseInsensitive], locale: locale)
        guard !term.isEmpty else { return cities }
        return cities.compactMap { city in
            let matches = city.airports.filter { airport in
                searchable[airport.iata]?.contains(where: { $0.contains(term) }) == true
            }
            guard !matches.isEmpty else { return nil }
            // A city selection still includes ALL its airports, even for an IATA search.
            return City(id: city.id, name: city.name, representative: city.representative,
                        codes: city.codes, airports: matches)
        }
    }
}

struct MockSearchService: SearchService {
    let airports: [Airport]
    let clock: any AppClock
    func search(_ query: SearchQuery) async throws -> SearchResult {
        guard query.originCityCode.map({ $0 == "MOW" }) ?? (query.origin == "SVO") else { throw SearchFailure.unsupportedAirport }
        try Task.checkCancellation()
        let cal = TravelDates.calendar("Europe/Moscow")
        let lookup = Dictionary(uniqueKeysWithValues: airports.map { ($0.iata, $0) })
        guard let origin = lookup["SVO"] else { throw SearchFailure.invalidData }
        let initial: Date
        if let day = query.departureDate, let parsed = TravelDates.parseDay(day, zone: "Europe/Moscow") {
            initial = cal.date(bySettingHour: 10, minute: 0, second: 0, of: parsed)!
        } else {
            guard let start = TravelDates.parseDay(query.month + "-01", zone: "Europe/Moscow"),
                  let range = cal.range(of: .day, in: .month, for: start) else { throw SearchFailure.invalidData }
            let candidates = range.compactMap { cal.date(byAdding: .day, value: $0 - 1, to: start) }
                .compactMap { cal.date(bySettingHour: 10, minute: 0, second: 0, of: $0) }
            guard let date = candidates.first(where: { [6, 7].contains(cal.component(.weekday, from: $0)) && $0 > clock.now }) else {
                return SearchResult(offers: [], incomplete: false, warnings: [])
            }
            initial = date
        }
        let baseFixtures: [(String, Int, Int?, Int?)] = [("LED",850000,0,0),("KZN",1050000,0,0),("KGD",1400000,0,0),("AER",1800000,0,0),("MRV",1550000,0,0),("EVN",2400000,0,0),("TBS",2850000,1,1),("IST",3100000,0,0),("GYD",2600000,0,1),("MSQ",2300000,0,0)]
        let fixtures = query.region == .any ? baseFixtures : (query.region == .europe
            ? [("CDG",4200000,1,1),("LHR",5100000,1,1),("FCO",4600000,1,1),("BCN",4800000,1,1),("BER",4400000,1,1),("IST",3100000,0,0)]
            : [("JFK",8500000,1,1),("LAX",11000000,1,1),("SFO",10500000,1,1),("MIA",9800000,1,1)])
        var offers: [Offer] = []
        for (position, fixture) in fixtures.enumerated() {
            let (code, price, out, back) = fixture
            guard let airport = lookup[code], let zone = airport.timezone else { throw SearchFailure.invalidData }
            for variant in 0..<3 {
                let day = query.usesExactDates ? initial : cal.date(byAdding: .day, value: variant * 7, to: initial)!
                let dep = cal.date(bySettingHour: variant == 0 ? 10 : 19, minute: variant * 15, second: 0, of: day)!
                let returning = query.returnDate.flatMap { TravelDates.parseDay($0, zone: zone) }
                    ?? TravelDates.parseDay(TravelDates.dateKey(cal.date(byAdding: .day, value: 2, to: dep)!, zone: "Europe/Moscow"), zone: zone)!
                let ret = TravelDates.calendar(zone).date(bySettingHour: variant == 2 ? 20 : 18, minute: variant * 10, second: 0, of: returning)!
                let id = "MOCK-SVO-\(code)-\(Int(dep.timeIntervalSince1970))-\(Int(ret.timeIntervalSince1970))"
                let url = LinkBuilder.ordinary(origin: "SVO", destination: code, departure: dep, returnDate: ret, originZone: "Europe/Moscow", destinationZone: zone)
                let minutes = 90 + position * 20 + variant * 15
                let offer = Offer(id: id, cityCode: airport.cityCode, city: airport.city, countryCode: airport.countryCode, country: airport.country,
                    originAirport: "SVO", destinationAirport: code, originCity: origin.city, originName: origin.name, destinationName: airport.name,
                    departureAt: dep, returnAt: ret, originTimezone: "Europe/Moscow", destinationTimezone: zone,
                    transfers: out, returnTransfers: back, durationTo: minutes, durationBack: minutes + 10,
                    priceMinor: price + variant * 50000, currency: "RUB", searchURL: url.absoluteString,
                    partnerURL: nil, source: "MOCK", receivedAt: clock.now, originCityCode: "MOW",
                    airline: ["SU", "S7", "DP"][variant], airlineName: ["Aeroflot", "S7 Airlines", "Pobeda"][variant], flightNumber: "\(700 + position)")
                if SearchRules.accepts(offer, query: query, now: clock.now) { offers.append(offer) }
            }
        }
        return SearchResult(offers: SearchRules.sorted(offers), incomplete: false, warnings: [])
    }
}
