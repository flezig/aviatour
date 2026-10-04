import Foundation
@testable import Aviator

struct QuietAnalytics: AnalyticsService { func record(_ event: AnalyticsEvent) {} }
struct Stub: SearchService {
    let result: Result<SearchResult, Error>
    func search(_ query: SearchQuery) async throws -> SearchResult { try result.get() }
}
struct LateService: SearchService {
    let offers: [Offer]
    func search(_ query: SearchQuery) async throws -> SearchResult {
        if query.maxBudgetMinor == 2_500_000 { try? await Task.sleep(nanoseconds: 30_000_000); return SearchResult(offers: offers, incomplete: false, warnings: []) }
        return SearchResult(offers: [], incomplete: false, warnings: [])
    }
}
@MainActor final class MemoryFavorites: FavoritesStore {
    var saved: [String: Offer] = [:]
    func all() throws -> [Offer] { Array(saved.values) }
    func add(_ offer: Offer, at date: Date) throws { if saved[offer.id] == nil { saved[offer.id] = offer } }
    func remove(id: String) throws { saved.removeValue(forKey: id) }
}
final class FixtureURLProtocol: URLProtocol {
    static var status = 200
    static var body = Data()
    static var lastRequest: URLRequest?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lastRequest = request
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: Self.status, httpVersion: nil, headerFields: ["Content-Type":"application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
@main @MainActor struct BehaviorChecks {
    static var count = 0
    static func check(_ condition: Bool, _ label: String) { precondition(condition, label); count += 1 }
    static func modify(_ offer: Offer, _ values: [String: Any]) throws -> Offer {
        var row = try JSONSerialization.jsonObject(with: JSONEncoder().encode(offer)) as! [String: Any]
        values.forEach { row[$0] = $1 }
        return try JSONDecoder().decode(Offer.self, from: JSONSerialization.data(withJSONObject: row))
    }
    static func main() async throws {
        let now = ISO8601DateFormatter().date(from: "2026-10-01T09:00:00Z")!
        // Run from repository root. The app uses its bundle, not this filesystem path.
        let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
        let airports = try decoder.decode([Airport].self, from: Data(contentsOf: URL(fileURLWithPath: "Aviator/Resources/airports.json")))
        let indexStart = Date()
        let index = AirportIndex(airports: airports)
        let indexDuration = Date().timeIntervalSince(indexStart)
        check(index.cities.flatMap(\.airports).count == airports.count, "catalog preserves every airport")
        check(Set(index.cities.map(\.id)).count == index.cities.count, "stable unique city IDs")
        for term in ["Москва", "мОсКвА", "MOW", "svo", "Heathrow", "LED", "несуществующий-город"] {
            let expected = airports.filter {
                $0.city.localizedCaseInsensitiveContains(term) || $0.cityCode.localizedCaseInsensitiveContains(term)
                || $0.iata.localizedCaseInsensitiveContains(term) || $0.name.localizedCaseInsensitiveContains(term)
            }
            check(Set(index.matching(term).flatMap(\.airports).map(\.iata)) == Set(expected.map(\.iata)), "indexed search preserves matches: \(term)")
        }
        check(index.matching("  ").count == index.cities.count, "blank search returns all cities")
        let svoCity = index.matching("SVO").first!
        check(svoCity.airports.map(\.iata) == ["SVO"], "IATA search narrows airport rows")
        check(svoCity.codes == airports.filter { $0.cityCode == "MOW" }.map(\.iata).joined(separator: ", "), "city selection retains all codes")
        let oldStart = Date()
        let oldGroups = Dictionary(grouping: airports, by: \.cityCode).values.sorted {
            ($0.first?.city ?? "").localizedStandardCompare($1.first?.city ?? "") == .orderedAscending
        }
        let oldCodes = oldGroups.map { group in
            airports.filter { $0.cityCode == group[0].cityCode }.map(\.iata).joined(separator: ", ")
        }
        let oldDuration = Date().timeIntervalSince(oldStart)
        let newStart = Date()
        let newCodes = index.matching("").map(\.codes)
        let newDuration = Date().timeIntervalSince(newStart)
        check(Set(oldCodes) == Set(newCodes), "precomputed city codes preserve full catalog")
        let searchStart = Date()
        for _ in 0..<20 { _ = index.matching("москва") }
        print(String(format: "Catalog: %d airports / %d cities; index once %.1f ms; old preparation %.1f ms; indexed reopen %.3f ms; search average %.2f ms", airports.count, index.cities.count, indexDuration * 1000, oldDuration * 1000, newDuration * 1000, Date().timeIntervalSince(searchStart) * 1000 / 20))
        let service = MockSearchService(airports: airports, clock: FixedClock(now: now))
        let query = SearchQuery(month: "2026-10")
        let all = try await service.search(SearchQuery(month: "2026-10", maxBudgetMinor: 10_000_000)).offers
        let cityQuery = SearchQuery(origin: "DME", originCityCode: "MOW", month: "2026-10")
        check(try await service.search(cityQuery).offers.count == 21, "MOCK city includes SVO fixtures")
        let dmeOffer = try modify(all[0], ["originAirport": "DME", "originCityCode": "MOW"])
        check(SearchRules.accepts(dmeOffer, query: cityQuery, now: now), "city accepts another airport")
        check(!SearchRules.accepts(dmeOffer, query: query, now: now), "single airport remains exact")
        check(!SearchRules.accepts(try modify(dmeOffer, ["originCityCode":"LED"]), query: cityQuery, now: now), "city rejects another city")
        let emptyVM = SearchViewModel(service: Stub(result: .success(SearchResult(offers: [], incomplete: false, warnings: []))), clock: FixedClock(now: now), analytics: QuietAnalytics())
        emptyVM.query = cityQuery; emptyVM.query.directOnly = true; emptyVM.start()
        emptyVM.query.origin = "OVB"
        emptyVM.retryWithBudget()
        check(emptyVM.query.origin == "DME" && emptyVM.query.originCityCode == "MOW" && emptyVM.query.maxBudgetMinor == 3_500_000 && emptyVM.query.directOnly, "budget retry preserves performed query")
        emptyVM.retryWithTransfers()
        check(!emptyVM.query.directOnly && emptyVM.query.maxBudgetMinor == 3_500_000, "transfer retry preserves budget")
        emptyVM.filters.cheap = true
        check(emptyVM.emptyMessage.contains("Сбросьте"), "filtered empty explanation")
        check(query.origin == "SVO" && query.maxBudgetMinor == 2_500_000, "defaults")
        check(all.count == 30, "thirty trip fixtures")
        check(SearchRules.destinations(all, query: query, now: now, filters: ExtraFilters()).count == 7, "seven defaults")
        check(SearchRules.destinations(all, query: query, now: now, filters: ExtraFilters(cheap: true)).count == 5, "five cheap")
        let offer = all[0]
        check(offer.outboundSegments?.count == 1, "direct demo has one explicit segment")
        let transferOffer = all.first { $0.transfers == 1 }!
        let itinerary = transferOffer.outboundSegments!
        check(itinerary.count == 2 && itinerary[0].destinationAirport == "EVN", "demo transfer airport supplied explicitly")
        check(itinerary[0].connection(to: itinerary[1]).minutes == 45, "connection uses absolute instants")
        check(!itinerary[0].connection(to: itinerary[1]).changesAirport, "same airport connection")
        var nextRow = try JSONSerialization.jsonObject(with: JSONEncoder().encode(itinerary[1])) as! [String: Any]
        nextRow["originAirport"] = "MXP"
        nextRow["departureAt"] = itinerary[0].arrivalAt.addingTimeInterval(36 * 3600).timeIntervalSinceReferenceDate
        nextRow["arrivalAt"] = itinerary[0].arrivalAt.addingTimeInterval(37 * 3600).timeIntervalSinceReferenceDate
        let changed = try JSONDecoder().decode(FlightSegment.self, from: JSONSerialization.data(withJSONObject: nextRow))
        let longConnection = itinerary[0].connection(to: changed)
        check(longConnection.changesAirport, "airport change flagged")
        check(longConnection.crossesLocalDate, "overnight date change flagged")
        check(longConnection.minutes == 2160, "multi-day waiting duration")
        let unavailable = try modify(offer, ["availability": "unavailable"])
        check(!SearchRules.accepts(unavailable, query: query, now: now), "unavailable offer hidden")
        let expired = try modify(offer, ["expiresAt": now.timeIntervalSinceReferenceDate])
        check(!SearchRules.accepts(expired, query: query, now: now), "expired at boundary hidden")
        check(offer.canDisplay(at: now), "legacy unknown availability remains visible")
        var snapshot = try JSONSerialization.jsonObject(with: JSONEncoder().encode(offer)) as! [String: Any]
        snapshot.removeValue(forKey: "outboundSegments"); snapshot.removeValue(forKey: "inboundSegments")
        let oldSnapshot = try JSONDecoder().decode(Offer.self, from: JSONSerialization.data(withJSONObject: snapshot))
        check(oldSnapshot.outboundSegments == nil, "old favorite snapshots decode without itinerary")
        for (price, matches) in [(2_499_999,true),(2_500_000,true),(2_500_001,false)] {
            check(SearchRules.accepts(try modify(offer,["priceMinor":price]), query:query,now:now) == matches,"budget boundary")
        }
        check(SearchRules.accepts(try modify(offer,["priceMinor":2_000_000]),query:query,now:now,filters:ExtraFilters(cheap:true)),"quick boundary")
        check(!SearchRules.accepts(try modify(offer,["priceMinor":2_000_001]),query:query,now:now,filters:ExtraFilters(cheap:true)),"quick over")
        check(!SearchRules.accepts(try modify(offer,["priceMinor":2_000_000]),query:SearchQuery(month:"2026-10",maxBudgetMinor:1_500_000),now:now,filters:ExtraFilters(cheap:true)),"lower original budget")
        for value: Any in [NSNull(), 1] {
            check(!SearchRules.accepts(try modify(offer,["returnTransfers":value]),query:query,now:now,filters:ExtraFilters(direct:true)),"both legs direct")
        }
        check(!SearchRules.accepts(try modify(offer,["countryCode":NSNull()]),query:query,now:now,filters:ExtraFilters(russia:true)),"unknown country")
        check(!SearchRules.accepts(try modify(offer,["currency":"EUR"]),query:query,now:now),"currency mismatch")
        check(!SearchRules.accepts(offer,query:query,now:offer.departureAt),"past flight")
        let cheapStop=try modify(offer,["id":"stop","priceMinor":800000,"returnTransfers":1])
        let direct=try modify(offer,["id":"direct","priceMinor":900000])
        check(SearchRules.destinations([cheapStop,direct],query:query,now:now,filters:ExtraFilters(direct:true)).first?.id == "direct","filter before city minimum")
        let other=try modify(offer,["id":"z"])
        check(SearchRules.sorted([offer,other]).map(\.id) == SearchRules.sorted([other,offer]).map(\.id),"stable ties")
        let formatter=ISO8601DateFormatter()
        for (dep, ret, matches) in [("2026-10-02","2026-10-04",true),("2026-10-02","2026-10-05",true),("2026-10-03","2026-10-05",true),("2026-10-02","2026-10-11",false),("2026-10-01","2026-10-04",false),("2026-10-31","2026-11-02",true),("2027-12-31","2028-01-02",true)] {
            let a=formatter.date(from:dep+"T10:00:00+03:00")!,b=formatter.date(from:ret+"T18:00:00+03:00")!
            let changed=try modify(offer,["departureAt":a.timeIntervalSinceReferenceDate,"returnAt":b.timeIntervalSinceReferenceDate])
            check(SearchRules.accepts(changed,query:SearchQuery(month:String(dep.prefix(7))),now:now) == matches,"weekend pair")
        }
        check(Money.format(850001).contains(",01") && Money.format(850001).contains("₽"),"kopeck formatting")
        check(TravelDates.months(now: now, zone:"Europe/Moscow").count == 6,"six months")
        do { _=try await service.search(SearchQuery(origin:"DME",month:"2026-10"));check(false,"unsupported") } catch SearchFailure.unsupportedAirport { count += 1 }
        let late=formatter.date(from:"2026-10-31T22:00:00Z")!
        check(try await MockSearchService(airports:airports,clock:FixedClock(now:late)).search(query).offers.isEmpty,"no future weekends")
        check(try LinkBuilder.url(for:offer,now:now).absoluteString == "https://www.aviasales.com/search/SVO0210LED04101","ordinary route link")
        for url in ["http://aviasales.com/search/a","https://aviasales.com.evil/search/a","https://u:p@aviasales.com/search/a","https://aviasales.com:444/search/a"] { check(LinkBuilder.validated(url) == nil,"unsafe link") }
        check(LinkBuilder.validated("https://tp.media/generated",partner:true) != nil,"generated partner URL")
        check(LinkBuilder.validated("https://evil.test/generated",partner:true) == nil,"partner host")
        do { _=try LinkBuilder.url(for:offer,now:offer.returnAt);check(false,"past link") } catch { count += 1 }
        for (stub,state) in [(Stub(result:.success(SearchResult(offers:all,incomplete:false,warnings:[]))),SearchViewModel.State.success),(Stub(result:.success(SearchResult(offers:[],incomplete:false,warnings:[]))),.empty),(Stub(result:.failure(SearchFailure.offline)),.offline),(Stub(result:.failure(SearchFailure.source("Ошибка"))),.error("Ошибка"))] {
            let vm=SearchViewModel(service:stub,clock:FixedClock(now:now),analytics:QuietAnalytics());vm.start();check(vm.state == .loading,"loading")
            try await Task.sleep(nanoseconds:10_000_000);check(vm.state == state,"terminal state")
        }
        let vm=SearchViewModel(service:LateService(offers:all),clock:FixedClock(now:now),analytics:QuietAnalytics())
        vm.start();await Task.yield();vm.query.maxBudgetMinor=1_000_000;vm.start();try await Task.sleep(nanoseconds:80_000_000)
        check(vm.performedQuery?.maxBudgetMinor == 1_000_000 && vm.result.offers.isEmpty,"late previous response")
        let store=MemoryFavorites();let favorites=FavoritesViewModel(store:store,clock:FixedClock(now:now),analytics:QuietAnalytics());favorites.toggle(offer)
        check(favorites.contains(offer),"add favorite");try store.add(modify(offer,["priceMinor":850001]),at:now)
        check(try store.all().count == 1 && store.all()[0].priceMinor == 850000,"dedup snapshot")
        check(try store.all()[0].isDemo && store.all()[0].currency == "RUB","DEMO preserved")
        favorites.toggle(offer);check(favorites.offers.isEmpty,"remove favorite")
        let config=URLSessionConfiguration.ephemeral;config.protocolClasses=[FixtureURLProtocol.self]
        let session=URLSession(configuration:config);defer { session.invalidateAndCancel() }
        let live=LiveSearchService(baseURL:URL(string:"https://backend.example"),session:session)
        // Contract fixture is generated from exactly the Python response schema.
        FixtureURLProtocol.body=try Data(contentsOf:URL(fileURLWithPath:"backend/tests/contract-response.json"))
        let response=try await live.search(query)
        check(response.offers.count == 1 && response.offers[0].priceMinor == 850001,"LIVE DTO contract / kopecks")
        check(response.offers[0].source == "LIVE" && !response.offers[0].isDemo,"LIVE without MOCK")
        check(FixtureURLProtocol.lastRequest?.httpMethod == "POST" && FixtureURLProtocol.lastRequest?.url?.path == "/api/v1/search","request contract")
        check(response.offers[0].durationBack == nil && response.offers[0].returnTransfers == nil,"unknown optional transport values")
        FixtureURLProtocol.body=Data("{\"error\":{\"code\":\"configuration\",\"message\":\"LIVE не настроен\"}}".utf8);FixtureURLProtocol.status=503
        do { _=try await live.search(query);check(false,"LIVE configuration") } catch { check(error.localizedDescription == "LIVE не настроен","LIVE configuration message") }
        FixtureURLProtocol.body=Data("bad json".utf8);FixtureURLProtocol.status=200
        do { _=try await live.search(query);check(false,"invalid LIVE JSON") } catch SearchFailure.invalidData { count += 1 }
        let partnerOffer=try modify(offer,["partnerURL":"https://tp.media/generated"])
        check(try LinkBuilder.url(for:partnerOffer,now:now).host == "tp.media","partner chosen")
        let badPartner=try modify(offer,["partnerURL":"https://evil.test/generated"])
        check(try LinkBuilder.url(for:badPartner,now:now).host == "www.aviasales.com","invalid partner fallback")
        check(index.rows.count == index.cities.count * 2 + airports.count, "flat picker rows include every airport")
        check(Set(index.rows.map(\.id)).count == index.rows.count, "flat picker IDs are unique")
        check(AirportIndex.rows(for: index.matching("LED")).contains { $0.id == "airport.LED" }, "airport row survives filtering")
        check(TravelDates.parseDay("2026-10-32", zone: "UTC") == nil, "invalid calendar day rejected")
        check(OfferCount.label(21) == "21 вариант" && OfferCount.label(3) == "3 варианта" && OfferCount.label(12) == "12 вариантов", "Russian result counts")
        let facts = all.map(OfferFacts.init)
        let options = SearchRules.options(facts, query: query, now: now, filters: ExtraFilters())
        check(options.count == 21, "show all variants instead of one per city")
        check(SearchRules.options(facts, query: query, now: now, filters: ExtraFilters(uniqueDestinations: true)).count == 7, "optional unique destinations")
        check(options.map(\.priceMinor) == options.map(\.priceMinor).sorted(), "default price ascending")
        let descending = SearchRules.options(facts, query: query, now: now, filters: ExtraFilters(), sort: .priceDescending)
        check(descending.map(\.priceMinor) == descending.map(\.priceMinor).sorted(by: >), "price descending")
        check(SearchRules.options(facts, query: query, now: now, filters: ExtraFilters(airline: "S7")).count == 7, "airline filter")
        check(SearchRules.options(facts, query: query, now: now, filters: ExtraFilters(countryCode: "RU")).count == 15, "country filter")
        check(SearchRules.options(facts, query: query, now: now, filters: ExtraFilters(destinationText: "LED")).count == 3, "destination IATA filter")
        check(SearchRules.options(facts, query: query, now: now, filters: ExtraFilters(minPriceMinor: 900000, maxPriceMinor: 950000)).count == 2, "inclusive price range")
        let unknown = try modify(offer, ["durationTo": NSNull(), "durationBack": NSNull(), "transfers": NSNull()])
        check(unknown.arrivalAt == nil && unknown.stayHours == nil, "unknown arrival and stay stay unknown")
        check(!SearchRules.accepts(unknown, query: query, now: now, filters: ExtraFilters(maxTransfers: 1)), "unknown stops excluded only for restricted filter")
        check(!SearchRules.accepts(unknown, query: query, now: now, filters: ExtraFilters(maxFlightMinutes: 180)), "unknown duration excluded")
        check(!SearchRules.accepts(unknown, query: query, now: now, filters: ExtraFilters(arrivalTime: .morning)), "unknown arrival excluded")
        check(SearchRules.accepts(offer, query: query, now: now, filters: ExtraFilters(outboundTime: .morning)), "local departure hour")
        check(!SearchRules.accepts(offer, query: query, now: now, filters: ExtraFilters(outboundTime: .evening)), "local time bands")
        check(SearchRules.options(facts, query: query, now: now, filters: ExtraFilters(noLeave: true)).count == 14, "no leave itinerary")
        check(offer.arrivalAt == offer.departureAt.addingTimeInterval(90 * 60), "arrival from duration")
        check(abs((offer.stayHours ?? 0) - 54.5) < 0.01, "stay interval from arrival to return departure")
        let exactQuery = SearchQuery(month: "2026-10", departureDate: "2026-10-06", returnDate: "2026-10-08", destination: "LED")
        let exactResponse = try await service.search(exactQuery)
        check(exactResponse.offers.count == 3, "exact weekday dates and destination search")
        check(exactResponse.offers.allSatisfy { TravelDates.dateKey($0.departureAt, zone: $0.originTimezone) == "2026-10-06" && TravelDates.dateKey($0.returnAt, zone: $0.destinationTimezone) == "2026-10-08" }, "exact local dates preserved")
        let shifted = try modify(offer, ["departureAt": formatter.date(from: "2026-10-02T23:30:00+03:00")!.timeIntervalSinceReferenceDate, "durationTo": 120, "destinationTimezone": "Asia/Novosibirsk"])
        check(TravelDates.dateKey(shifted.arrivalAt!, zone: shifted.destinationTimezone) == "2026-10-03" && TravelDates.time(shifted.arrivalAt!, zone: shifted.destinationTimezone) == "05:30", "arrival crosses day/timezone")
        let zero = try modify(offer, ["durationTo": 0])
        check(zero.arrivalAt == nil && zero.stayHours == nil, "zero duration is not a confirmed arrival")
        let lowestValue = SearchRules.options(facts, query: query, now: now, filters: ExtraFilters(), sort: .value)
        check(lowestValue.first?.costPerStayHourMinor != nil, "value sort has usable metric")
        let filterVM = SearchViewModel(service: Stub(result: .success(SearchResult(offers: all, incomplete: false, warnings: []))), clock: FixedClock(now: now), analytics: QuietAnalytics())
        filterVM.start(); try await Task.sleep(nanoseconds: 30_000_000)
        filterVM.filters.airline = "SU"; filterVM.filters.airline = "S7"; filterVM.sort = .priceDescending
        try await Task.sleep(nanoseconds: 150_000_000)
        check(filterVM.offers.count == 7 && filterVM.offers.allSatisfy { $0.airline == "S7" }, "latest background filter wins")
        check(filterVM.offers.first!.priceMinor >= filterVM.offers.last!.priceMinor, "cached filter sort applied")
        var europeQuery = query; europeQuery.region = .europe; europeQuery.weekendOnly = false; europeQuery.maxBudgetMinor = 15_000_000
        let europe = try await MockSearchService(airports: airports, clock: FixedClock(now: now)).search(europeQuery)
        check(!europe.offers.isEmpty && europe.offers.allSatisfy { TripRegion.europe.includes($0.countryCode) }, "Europe returns only selected region")
        var usaQuery = europeQuery; usaQuery.region = .usa
        let usa = try await MockSearchService(airports: airports, clock: FixedClock(now: now)).search(usaQuery)
        check(usa.offers.count == 12 && usa.offers.allSatisfy { $0.countryCode == "US" }, "USA mock offers")
        check(!SearchRules.accepts(offer, query: usaQuery, now: now), "region excludes Russian offer")
        check(usa.offers.first { $0.destinationAirport == "JFK" }?.imageName == "NYC", "all New York airports use city photo")
        let usaFacts = usa.offers.map(OfferFacts.init)
        let expensiveFirst = SearchRules.options(usaFacts, query: usaQuery, now: now, filters: ExtraFilters(), sort: .priceDescending)
        check(expensiveFirst.first!.priceMinor > expensiveFirst.last!.priceMinor, "region price descending")
        let many = Array(repeating: facts, count: 300).flatMap { $0 }
        let performanceStart = Date()
        _ = SearchRules.options(many, query: query, now: now, filters: ExtraFilters(airline: "S7"), sort: .value)
        print(String(format: "Filter/sort %d indexed offers: %.2f ms off UI thread", many.count, Date().timeIntervalSince(performanceStart) * 1000))
        print("Aviator: \(count) Swift behavior assertions passed. SwiftData persistence and UI require full Xcode.")
    }
}
