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

enum TripRegion: String, Codable, CaseIterable, Identifiable {
    case any, europe, usa
    var id: String { rawValue }
    var title: String { switch self { case .any: "Куда угодно"; case .europe: "Поездка в Европу"; case .usa: "Поездка в США" } }
    func includes(_ country: String?) -> Bool {
        switch self {
        case .any: return true
        case .usa: return country == "US"
        case .europe: return Self.europeCountries.contains(country ?? "")
        }
    }
    static let europeCountries = Set("AL AD AT BE BA BG HR CY CZ DK EE FI FR DE GR HU IS IE IT LV LI LT LU MT MD MC ME NL MK NO PL PT RO SM RS SK SI ES SE CH TR UA GB VA XK".split(separator: " ").map(String.init))
}

struct SearchQuery: Codable, Equatable {
    var origin = "SVO"
    var originCityCode: String? = nil
    var month: String
    var maxBudgetMinor = 2_500_000
    var directOnly = false
    var region: TripRegion = .any
    var departureDate: String? = nil
    var returnDate: String? = nil
    var weekendOnly = true
    var destination: String? = nil
    var destinationCityCode: String? = nil
    var usesExactDates: Bool { departureDate != nil && returnDate != nil }
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
    var airline: String? = nil
    var airlineName: String? = nil
    var flightNumber: String? = nil
    var arrivalAt: Date? { durationTo.flatMap { $0 > 0 ? departureAt.addingTimeInterval(Double($0) * 60) : nil } }
    var returnArrivalAt: Date? { durationBack.flatMap { $0 > 0 ? returnAt.addingTimeInterval(Double($0) * 60) : nil } }
    var stayHours: Double? {
        guard let arrivalAt, returnAt > arrivalAt else { return nil }
        return returnAt.timeIntervalSince(arrivalAt) / 3600
    }
    var costPerStayHourMinor: Int? { stayHours.map { Int(ceil(Double(priceMinor) / $0)) } }
    var airlineLabel: String { airlineName.map { "\($0) (\(airline ?? ""))" } ?? airline ?? "Авиакомпания не указана" }
    var isDemo: Bool { source == "MOCK" }
    var isDirect: Bool { transfers == 0 && returnTransfers == 0 }
    var imageName: String { cityCode }
}

struct SearchResult {
    var offers: [Offer]
    var incomplete: Bool
    var warnings: [String]
}

enum OfferSort: String, CaseIterable, Identifiable {
    case price, priceDescending, departure, duration, stay, value
    var id: String { rawValue }
    var title: String {
        switch self {
        case .price: return "Сначала дешевле"
        case .priceDescending: return "Сначала дороже"
        case .departure: return "Ближайший вылет"
        case .duration: return "Меньше времени в пути"
        case .stay: return "Больше времени на месте"
        case .value: return "Выгоднее час поездки"
        }
    }
}

enum FlightTime: String, CaseIterable, Identifiable {
    case any, night, morning, afternoon, evening
    var id: String { rawValue }
    var title: String {
        switch self {
        case .any: return "Любое время"
        case .night: return "Ночь · 00–06"
        case .morning: return "Утро · 06–12"
        case .afternoon: return "День · 12–18"
        case .evening: return "Вечер · 18–24"
        }
    }
    func includes(_ hour: Int) -> Bool {
        switch self {
        case .any: return true
        case .night: return (0..<6).contains(hour)
        case .morning: return (6..<12).contains(hour)
        case .afternoon: return (12..<18).contains(hour)
        case .evening: return (18..<24).contains(hour)
        }
    }
}

struct ExtraFilters: Equatable {
    var cheap = false
    var direct = false
    var russia = false
    var minPriceMinor = 0
    var maxPriceMinor: Int? = nil
    var countryCode: String? = nil
    var airline: String? = nil
    var airlineName: String? = nil
    var destinationText = ""
    var maxTransfers: Int? = nil
    var maxFlightMinutes: Int? = nil
    var minDays = 0
    var maxDays: Int? = nil
    var minStayHours = 0
    var outboundTime: FlightTime = .any
    var inboundTime: FlightTime = .any
    var arrivalTime: FlightTime = .any
    var returnArrivalTime: FlightTime = .any
    var noLeave = false
    var uniqueDestinations = false
    var isEmpty: Bool { self == ExtraFilters() }
    var activeCount: Int {
        [cheap, direct, russia, minPriceMinor > 0, maxPriceMinor != nil, countryCode != nil,
         airline != nil, !destinationText.isEmpty, maxTransfers != nil, maxFlightMinutes != nil,
         minDays > 0, maxDays != nil, minStayHours > 0, outboundTime != .any, inboundTime != .any,
         arrivalTime != .any, returnArrivalTime != .any, noLeave, uniqueDestinations].filter { $0 }.count
    }
}

protocol AppClock { var now: Date { get } }
struct SystemClock: AppClock { var now: Date { Date() } }
struct FixedClock: AppClock { let now: Date }
