import Foundation

enum LinkBuilder {
    static func ordinary(origin: String, destination: String, departure: Date, returnDate: Date, originZone: String, destinationZone: String) -> URL {
        let params = origin + TravelDates.dayMonth(departure, zone: originZone) + destination + TravelDates.dayMonth(returnDate, zone: destinationZone) + "1"
        return URL(string: "https://www.aviasales.com/search/\(params)")!
    }
    static func validated(_ raw: String, partner: Bool = false) -> URL? {
        guard let url = URL(string: raw), url.scheme == "https", let host = url.host?.lowercased(), url.user == nil, url.password == nil, url.port == nil || url.port == 443 else { return nil }
        let hosts: Set<String> = partner ? ["tp.media", "avs.io"] : ["aviasales.com", "www.aviasales.com", "aviasales.ru", "www.aviasales.ru"]
        guard hosts.contains(host), partner || url.path.hasPrefix("/search/") else { return nil }
        return url
    }
    static func url(for offer: Offer, now: Date) throws -> URL {
        guard offer.departureAt > now else { throw SearchFailure.source("Даты прошли. Выполните новый поиск.") }
        if let raw = offer.partnerURL, let url = validated(raw, partner: true) { return url }
        guard let url = validated(offer.searchURL) else { throw SearchFailure.source("Не удалось сформировать безопасную ссылку.") }
        return url
    }
}
