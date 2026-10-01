import XCTest
import SwiftData
@testable import Aviator

private struct SilentAnalytics: AnalyticsService { func record(_ event: AnalyticsEvent) {} }

final class AviatorTests: XCTestCase {
    let now = ISO8601DateFormatter().date(from: "2026-10-01T09:00:00Z")!
    func airports() throws -> [Airport] {
        #if SWIFT_PACKAGE
        return try Catalog.load(bundle: .module)
        #else
        return try Catalog.load()
        #endif
    }
    func offers() async throws -> [Offer] {
        try await MockSearchService(airports: airports(), clock: FixedClock(now: now)).search(SearchQuery(month: "2026-10", maxBudgetMinor: 10_000_000)).offers
    }
    func changed(_ original: Offer, price: Int? = nil, currency: String? = nil, country: String? = nil, directBack: Int? = 0, id: String? = nil) throws -> Offer {
        let encoder = JSONEncoder(); var json = try JSONSerialization.jsonObject(with: encoder.encode(original)) as! [String: Any]
        if let price { json["priceMinor"] = price }
        if let currency { json["currency"] = currency }
        if let country { json["countryCode"] = country }
        json["returnTransfers"] = directBack.map { $0 as Any } ?? NSNull()
        if let id { json["id"] = id }
        return try JSONDecoder().decode(Offer.self, from: JSONSerialization.data(withJSONObject: json))
    }
    func testBudgetBoundariesDefaultsAndQuickFilter() async throws {
        let query = SearchQuery(month: "2026-10")
        XCTAssertEqual(query.origin, "SVO"); XCTAssertEqual(query.maxBudgetMinor, 2_500_000)
        let all = try await offers(); XCTAssertEqual(all.count, 10)
        let defaults = SearchRules.destinations(all, query: query, now: now, filters: ExtraFilters())
        XCTAssertEqual(defaults.count, 7)
        XCTAssertEqual(SearchRules.destinations(all, query: query, now: now, filters: ExtraFilters(cheap: true)).count, 5)
        let original = all[0]
        for (price, accepts) in [(2_499_999,true),(2_500_000,true),(2_500_001,false)] {
            XCTAssertEqual(SearchRules.accepts(try changed(original, price: price), query: query, now: now), accepts)
        }
        let limitOffer = try changed(original, price: 2_000_000)
        XCTAssertTrue(SearchRules.accepts(limitOffer, query: query, now: now, filters: ExtraFilters(cheap: true)))
        XCTAssertFalse(SearchRules.accepts(limitOffer, query: SearchQuery(month: "2026-10", maxBudgetMinor: 1_500_000), now: now, filters: ExtraFilters(cheap: true)))
    }
    func testFilterBeforeCityMinimumStableSortAndUnknowns() async throws {
        let original = try await offers()[0]; let query = SearchQuery(month: "2026-10")
        let cheapStop = try changed(original, price: 800000, directBack: 1, id: "a")
        let direct = try changed(original, price: 900000, id: "b")
        XCTAssertEqual(SearchRules.destinations([cheapStop,direct], query: query, now: now, filters: ExtraFilters(direct: true)).first?.id, "b")
        XCTAssertFalse(SearchRules.accepts(try changed(original, directBack: nil), query: query, now: now, filters: ExtraFilters(direct: true)))
        XCTAssertFalse(SearchRules.accepts(try changed(original, currency: "EUR"), query: query, now: now))
        XCTAssertFalse(SearchRules.accepts(try changed(original, country: "ZZ"), query: query, now: now, filters: ExtraFilters(russia: true)))
        let second = try changed(original, id: "second")
        XCTAssertEqual(SearchRules.sorted([second,original]).map(\.id), SearchRules.sorted([original,second]).map(\.id))
    }
    func testMockFutureMonthYearAndUnsupportedAirport() async throws {
        let service = MockSearchService(airports: try airports(), clock: FixedClock(now: now))
        let december = try await service.search(SearchQuery(month: "2027-12"))
        XCTAssertTrue(december.offers.allSatisfy { $0.departureAt > now })
        XCTAssertTrue(december.offers.allSatisfy { SearchRules.accepts($0, query: SearchQuery(month: "2027-12"), now: now) })
        do { _ = try await service.search(SearchQuery(origin: "DME",month: "2026-10")); XCTFail() } catch { XCTAssertTrue(error is SearchFailure) }
        let late = ISO8601DateFormatter().date(from: "2026-10-31T22:00:00Z")!
        let empty = try await MockSearchService(airports: airports(),clock: FixedClock(now: late)).search(SearchQuery(month: "2026-10"))
        XCTAssertTrue(empty.offers.isEmpty)
    }
    func testRubleFormattingAndLinks() async throws {
        XCTAssertTrue(Money.format(2_500_000).contains("25")); XCTAssertTrue(Money.format(850001).contains(",01")); XCTAssertTrue(Money.format(850001).contains("₽"))
        let offer = try await offers()[0]
        XCTAssertEqual(try LinkBuilder.url(for: offer, now: now).absoluteString,"https://www.aviasales.com/search/SVO0210LED04101")
        XCTAssertThrowsError(try LinkBuilder.url(for: offer, now: offer.returnAt))
        for raw in ["http://aviasales.com/search/a","https://aviasales.com.evil/search/a","https://evil.test/search/a"] { XCTAssertNil(LinkBuilder.validated(raw)) }
        XCTAssertNotNil(LinkBuilder.validated("https://tp.media/fixture", partner: true))
        XCTAssertNil(LinkBuilder.validated("https://evil.test/fixture", partner: true))
    }
    #if !SWIFT_PACKAGE
    @MainActor func testFavoritesPersistNoDuplicatesRemoveDemo() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".store")
        defer { for suffix in ["", "-wal", "-shm"] { try? FileManager.default.removeItem(atPath: url.path + suffix) } }
        let offer = try await offers()[0]
        do {
            let container = try ModelContainer(for: FavoriteSnapshot.self, configurations: ModelConfiguration(url: url))
            let store = SwiftDataFavoritesStore(container: container)
            try store.add(offer, at: now); try store.add(changed(offer,price:850001), at: now)
            XCTAssertEqual(try store.all().count,1)
        }
        let reopened = try ModelContainer(for: FavoriteSnapshot.self, configurations: ModelConfiguration(url: url))
        let store = SwiftDataFavoritesStore(container: reopened)
        let saved = try XCTUnwrap(store.all().first)
        XCTAssertEqual(saved.priceMinor,850000); XCTAssertEqual(saved.currency,"RUB"); XCTAssertTrue(saved.isDemo)
        XCTAssertEqual(saved.searchURL,offer.searchURL)
        try store.remove(id:offer.id); XCTAssertTrue(try store.all().isEmpty)
    }
    #endif
    @MainActor func testViewModelSuccessEmptyErrorOffline() async throws {
        let all = try await offers()
        for (service,expected) in [(StubService(result: .success(SearchResult(offers: all,incomplete:false,warnings:[]))),SearchViewModel.State.success),
            (StubService(result:.success(SearchResult(offers:[],incomplete:false,warnings:[]))),.empty),
            (StubService(result:.failure(SearchFailure.offline)),.offline),
            (StubService(result:.failure(SearchFailure.source("Ошибка"))),.error("Ошибка"))] {
            let vm=SearchViewModel(service:service,clock:FixedClock(now:now),analytics:SilentAnalytics())
            vm.start();XCTAssertEqual(vm.state,.loading)
            for _ in 0..<20 { await Task.yield() }
            XCTAssertEqual(vm.state,expected)
        }
    }
    @MainActor func testLatePreviousSearchDoesNotReplaceNewResult() async throws {
        let all = try await offers()
        let service = DelayedService(offers: all)
        let vm = SearchViewModel(service: service, clock: FixedClock(now: now), analytics: SilentAnalytics())
        vm.start();for _ in 0..<10 { await Task.yield() }
        vm.query.maxBudgetMinor=1_000_000;vm.start()
        try await Task.sleep(nanoseconds:100_000_000)
        XCTAssertEqual(vm.performedQuery?.maxBudgetMinor,1_000_000)
        XCTAssertEqual(vm.result.offers.count,0)
    }
}
private struct StubService: SearchService {
    let result: Result<SearchResult,Error>
    func search(_ query: SearchQuery) async throws -> SearchResult { try result.get() }
}
private struct DelayedService: SearchService {
    let offers:[Offer]
    func search(_ query: SearchQuery) async throws -> SearchResult {
        // Intentionally ignore cancellation to emulate a late transport completion.
        if query.maxBudgetMinor==2_500_000 { try? await Task.sleep(nanoseconds:50_000_000);return SearchResult(offers:offers,incomplete:false,warnings:[]) }
        return SearchResult(offers:[],incomplete:false,warnings:[])
    }
}
