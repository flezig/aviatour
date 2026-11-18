import Foundation

struct CityInsightResponse: Decodable {
    struct WeatherDay: Decodable, Identifiable { let date: String; let high, low, rain: Double; var id: String { date } }
    struct Weather: Decodable { let status, kind, note, sourceUrl: String; let days: [WeatherDay] }
    struct BasketItem: Decodable, Identifiable {
        let name, quantity, unit: String
        let observations, shops: Int
        let cost: String?
        var id: String { name }
    }
    struct Basket: Decodable {
        let status, currency, note, sourceUrl: String
        let items: [BasketItem]
        let total, knownSubtotal, periodStart, periodEnd: String?
        let sampleLimited: Bool
    }
    struct Safety: Decodable { let status, note, sourceUrl: String; let updatedAt: String?; let alerts: [String] }
    struct HDI: Decodable { let value: Double; let year: Int; let sourceUrl, publication, retrieved, note: String }
    struct Entry: Decodable { let status, note: String; let citizenship, residence, sourceUrl, checkUrl: String? }
    let cityCode, status, fetchedAt: String
    let guide: CityGuide?
    let weather: Weather?
    let basket: Basket?
    let safety: Safety?
    let hdi: HDI?
    let entry: Entry
    let interestScore: Int?
    let matchedInterests: [String]
}
struct CityInsightRequest: Encodable, Equatable {
    let cityCode: String
    let citizenship, residence: String?
    let startDate, endDate: String
    let interests: [String]
    init(offer: Offer, preferences: TravelerPreferences) {
        cityCode = offer.cityCode; citizenship = preferences.citizenship; residence = preferences.residence
        startDate = TravelDates.dateKey(offer.arrivalAt ?? offer.departureAt, zone: offer.destinationTimezone)
        endDate = TravelDates.dateKey(offer.returnAt, zone: offer.destinationTimezone)
        interests = preferences.interests.map(\.rawValue).sorted()
    }
}
struct CityInsightService {
    let baseURL: URL?
    var session: URLSession = .shared
    func load(_ parameters: CityInsightRequest) async throws -> CityInsightResponse {
        guard let baseURL else { throw SearchFailure.configuration }
        #if !DEBUG
        guard baseURL.scheme == "https" else { throw SearchFailure.configuration }
        #endif
        var request = URLRequest(url: baseURL.appendingPathComponent("api/v1/cities/insights"))
        request.httpMethod = "POST"; request.timeoutInterval = 25
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let encoder = JSONEncoder(); encoder.keyEncodingStrategy = .convertToSnakeCase
        request.httpBody = try encoder.encode(parameters)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw SearchFailure.invalidData }
        guard (200..<300).contains(http.statusCode) else { throw SearchFailure.source("Показатели города временно недоступны (\(http.statusCode)).") }
        let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
        let value = try decoder.decode(CityInsightResponse.self, from: data)
        guard value.cityCode == parameters.cityCode else { throw SearchFailure.invalidData }
        return value
    }
}
