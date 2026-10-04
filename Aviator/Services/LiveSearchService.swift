import Foundation

// Transport is independent of domain and SwiftData snapshots.
private struct OfferDTO: Decodable {
    let id, cityCode, city: String
    let countryCode, country: String?
    let originAirport, destinationAirport, originCity, originName, destinationName: String
    let departureAt, returnAt: Date
    let originTimezone, destinationTimezone: String
    let originCityCode: String?
    let transfers, returnTransfers, durationTo, durationBack: Int?
    let priceMinor: Int
    let currency, searchUrl: String
    let partnerUrl: String?
    let source: String
    let airline, airlineName, flightNumber: String?
    let outboundSegments, inboundSegments: [FlightSegment]?
    let availability: OfferAvailability?
    let expiresAt: Date?
    let receivedAt: Date
    func domain() throws -> Offer {
        guard currency == "RUB", priceMinor > 0, source == "LIVE", TimeZone(identifier: originTimezone) != nil, TimeZone(identifier: destinationTimezone) != nil else { throw SearchFailure.invalidData }
        func valid(_ segments: [FlightSegment]?, origin: String, destination: String, departure: Date) -> Bool {
            guard let segments, !segments.isEmpty else { return true }
            guard segments.first?.originAirport == origin, segments.last?.destinationAirport == destination,
                  segments.first?.departureAt == departure else { return false }
            for (index, segment) in segments.enumerated() {
                guard segment.arrivalAt > segment.departureAt,
                      TimeZone(identifier: segment.originTimezone) != nil,
                      TimeZone(identifier: segment.destinationTimezone) != nil else { return false }
                if index > 0 && segments[index - 1].arrivalAt > segment.departureAt { return false }
            }
            return true
        }
        guard valid(outboundSegments, origin: originAirport, destination: destinationAirport, departure: departureAt),
              valid(inboundSegments, origin: destinationAirport, destination: originAirport, departure: returnAt) else { throw SearchFailure.invalidData }
        return Offer(id: id, cityCode: cityCode, city: city, countryCode: countryCode, country: country, originAirport: originAirport, destinationAirport: destinationAirport,
                     originCity: originCity, originName: originName, destinationName: destinationName, departureAt: departureAt, returnAt: returnAt,
                     originTimezone: originTimezone, destinationTimezone: destinationTimezone, transfers: transfers, returnTransfers: returnTransfers,
                     durationTo: durationTo, durationBack: durationBack, priceMinor: priceMinor, currency: currency, searchURL: searchUrl, partnerURL: partnerUrl, source: source, receivedAt: receivedAt, originCityCode: originCityCode, airline: airline, airlineName: airlineName, flightNumber: flightNumber, outboundSegments: outboundSegments, inboundSegments: inboundSegments, availability: availability, expiresAt: expiresAt)
    }
}
private struct SearchResponseDTO: Decodable {
    let offers: [OfferDTO]
    let incomplete: Bool
    let warnings: [String]
}
private struct ErrorDTO: Decodable { struct Detail: Decodable { let code, message: String }; let error: Detail }

struct LiveSearchService: SearchService {
    let baseURL: URL?
    let session: URLSession
    init(baseURL: URL?, session: URLSession = .shared) { self.baseURL = baseURL; self.session = session }
    func search(_ query: SearchQuery) async throws -> SearchResult {
        guard let baseURL else { throw SearchFailure.configuration }
        #if !DEBUG
        guard baseURL.scheme == "https" else { throw SearchFailure.configuration }
        #endif
        var request = URLRequest(url: baseURL.appendingPathComponent("api/v1/search")); request.httpMethod = "POST"; request.timeoutInterval = 25
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let encoder = JSONEncoder(); encoder.keyEncodingStrategy = .convertToSnakeCase
        request.httpBody = try encoder.encode(query)
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw SearchFailure.invalidData }
            return try await Task.detached(priority: .userInitiated) {
                try Self.decode(data, status: http.statusCode)
            }.value
        } catch let error as URLError {
            if error.code == .cancelled { throw CancellationError() }
            throw SearchFailure.offline
        } catch let error as DecodingError {
            _ = error; throw SearchFailure.invalidData
        }
    }
    private static func decode(_ data: Data, status: Int) throws -> SearchResult {
        let fractional = ISO8601DateFormatter(); fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let standard = ISO8601DateFormatter(); standard.formatOptions = [.withInternetDateTime]
        let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .custom { container in
            let raw = try container.singleValueContainer().decode(String.self)
            guard let date = fractional.date(from: raw) ?? standard.date(from: raw) else { throw SearchFailure.invalidData }
            return date
        }
        guard (200..<300).contains(status) else {
            let error = try? decoder.decode(ErrorDTO.self, from: data)
            throw SearchFailure.source(error?.error.message ?? "Ошибка backend (\(status)).")
        }
        let dto = try decoder.decode(SearchResponseDTO.self, from: data)
        return SearchResult(offers: try dto.offers.map { try $0.domain() }, incomplete: dto.incomplete, warnings: dto.warnings)
    }

}
