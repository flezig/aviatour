import Foundation
@testable import Aviator

@MainActor final class RecordingSearch: SearchService {
    var result: Result<SearchResult, Error>
    var queries: [SearchQuery] = []
    var delay: UInt64 = 0
    init(_ result: Result<SearchResult, Error>) { self.result = result }
    func search(_ query: SearchQuery) async throws -> SearchResult {
        queries.append(query)
        if delay > 0 { try await Task.sleep(nanoseconds: delay) }
        return try result.get()
    }
}

@MainActor enum TripPlanningChecks {
    static func run(airports: [Airport], now: Date) async throws -> Int {
        var count = 0
        func check(_ condition: Bool, _ label: String) { precondition(condition, label); count += 1 }
        let clock = FixedClock(now: now)
        let mock = MockSearchService(airports: airports, clock: clock)
        let all = try await mock.search(SearchQuery(month: "2026-10", maxBudgetMinor: 50_000_000)).offers
        let saved = all[0]
        let lookup = Dictionary(uniqueKeysWithValues: airports.map { ($0.iata, $0) })
        var query = SearchQuery(origin: "SVO", originCityCode: "MOW", month: "2026-10", maxBudgetMinor: 1_500_000,
                                departureDate: "2026-10-06", returnDate: "2026-10-08", destination: "LED")
        for collection in [TripCollection.budget20, .budget30, .budget50] {
            let params = collection.parameters(query, airports: lookup)
            check(params.0.maxBudgetMinor == 1_500_000, "collection never raises user's budget")
            check(params.0.originCityCode == "MOW" && params.0.departureDate == "2026-10-06" && params.0.destination == "LED", "collection retains airport scope/dates/destination")
        }
        query.maxBudgetMinor = 10_000_000
        check(TripCollection.budget20.parameters(query, airports: lookup).0.maxBudgetMinor == 2_000_000, "20k cap")
        check(TripCollection.budget30.parameters(query, airports: lookup).0.maxBudgetMinor == 3_000_000, "30k cap")
        check(TripCollection.budget50.parameters(query, airports: lookup).0.maxBudgetMinor == 5_000_000, "50k cap")
        check(TripCollection.europe.parameters(query, airports: lookup).0.destination == nil, "regional collection drops incompatible explicit destination")
        query.destination = "IST"
        check(TripCollection.europe.parameters(query, airports: lookup).0.destination == "IST", "regional collection preserves compatible destination")
        check(TripCollection.moreStay.parameters(query, airports: lookup).2 == .stay, "time-based collection sorting")
        check(TripCollection.lessRoad.parameters(query, airports: lookup).0.directOnly, "short road requires known direct flights")
        let noLeave = TripCollection.noLeave.parameters(query, airports: lookup)
        check(noLeave.1.noLeave && noLeave.1.maxDays == 3, "no leave is a short trip")
        let nearby = NearbyDates.options(for: saved, budget: 2_500_000, now: now)
        check(nearby.count == 7 && nearby[0].query == nil, "past nearby dates not queried")
        check(nearby.first { $0.offset == 0 }?.query?.departureDate == TravelDates.dateKey(saved.departureAt, zone: saved.originTimezone), "nearby zero is original local departure")
        check(nearby.allSatisfy { $0.query.map { !$0.weekendOnly && $0.originCityCode == nil && $0.destination == saved.destinationAirport && $0.maxBudgetMinor == 2_500_000 } ?? true }, "nearby preserves exact airports and budget")
        let boundary = try BehaviorChecks.modify(saved, ["departureAt": ISO8601DateFormatter().date(from: "2026-12-31T10:00:00Z")!.timeIntervalSinceReferenceDate, "returnAt": ISO8601DateFormatter().date(from: "2027-01-02T10:00:00Z")!.timeIntervalSinceReferenceDate])
        let year = NearbyDates.options(for: boundary, budget: 2_500_000, now: now)
        check(year.last?.query?.month == "2027-01" && year.last?.query?.returnDate == "2027-01-05", "nearby year boundary retains duration")
        let end = try BehaviorChecks.modify(saved, ["departureAt": ISO8601DateFormatter().date(from: "2027-03-31T10:00:00Z")!.timeIntervalSinceReferenceDate, "returnAt": ISO8601DateFormatter().date(from: "2027-04-02T10:00:00Z")!.timeIntervalSinceReferenceDate])
        check(NearbyDates.options(for: end, budget: 2_500_000, now: now).last?.query == nil, "nearby six-month horizon")
        let comparison = ComparisonModel()
        for offer in all.prefix(4) { comparison.toggle(offer) }
        comparison.toggle(all[4])
        check(comparison.offers.count == 4 && comparison.message != nil, "four-trip limit")
        comparison.toggle(saved)
        check(!comparison.contains(saved) && comparison.offers.count == 3, "comparison removal")
        comparison.clear(); check(comparison.offers.isEmpty, "comparison clears")
        let cheaper = try BehaviorChecks.modify(saved, ["priceMinor": saved.priceMinor - 10000])
        let recorder = RecordingSearch(.success(SearchResult(offers: [cheaper], incomplete: false, warnings: [])))
        let store = MemoryFavorites()
        let favorites = FavoritesViewModel(store: store, clock: clock, analytics: QuietAnalytics(), services: ["MOCK": recorder])
        favorites.toggle(saved)
        await favorites.refresh()
        let refreshed = favorites.offers[0]
        check(refreshed.priceMinor == cheaper.priceMinor && refreshed.originalPriceMinor == saved.priceMinor && refreshed.priceChangeMinor == -10000, "favorite price change and baseline persisted")
        check(refreshed.refreshStatus == .updated && refreshed.lastCheckedAt == now, "favorite refresh status/time")
        check(recorder.queries[0].forceRefresh && recorder.queries[0].originCityCode == nil && recorder.queries[0].destination == saved.destinationAirport, "favorite refresh bypasses local cache for exact airports")
        favorites.reload(); check(favorites.offers[0].priceMinor == cheaper.priceMinor, "refresh survives reload")
        recorder.result = .success(SearchResult(offers: [try BehaviorChecks.modify(cheaper, ["source": "LIVE"])], incomplete: true, warnings: []))
        await favorites.refresh()
        check(favorites.offers[0].refreshStatus == .notFound && favorites.offers[0].priceMinor == cheaper.priceMinor, "source mismatch keeps snapshot")
        check(favorites.offers[0].receivedAt == refreshed.receivedAt, "missing quote does not relabel old price as new")
        recorder.result = .failure(SearchFailure.offline)
        await favorites.refresh()
        check(favorites.offers[0].refreshStatus == .failed && favorites.offers[0].priceMinor == cheaper.priceMinor, "network error retains price")
        recorder.result = .success(SearchResult(offers: [try BehaviorChecks.modify(cheaper, ["departureAt": saved.departureAt.addingTimeInterval(60).timeIntervalSinceReferenceDate])], incomplete: false, warnings: []))
        await favorites.refresh()
        check(favorites.offers[0].refreshStatus == .notFound, "same ID cannot replace different departure")
        let past = try BehaviorChecks.modify(saved, ["id": "past", "departureAt": now.addingTimeInterval(-3600).timeIntervalSinceReferenceDate])
        favorites.toggle(past)
        let requestsBefore = recorder.queries.count
        await favorites.refresh([past])
        check(recorder.queries.count == requestsBefore && favorites.current(past).refreshStatus == .past, "expired trips skip source")
        recorder.result = .success(SearchResult(offers: [cheaper], incomplete: false, warnings: [])); recorder.delay = 50_000_000
        let pending = Task { await favorites.refresh([saved]) }
        for _ in 0..<10 { await Task.yield() }
        favorites.toggle(favorites.current(saved))
        await pending.value
        check(!favorites.contains(saved), "deleted favorite cannot be resurrected by late response")
        let neighborVM = NearbyDatesViewModel()
        await neighborVM.load(offer: saved, budget: 2_500_000, service: mock, clock: clock)
        check(neighborVM.completed && !neighborVM.isLoading && neighborVM.options.first { $0.offset == 0 }?.best != nil, "neighbor batch finds matching date pair")
        check(neighborVM.options.allSatisfy { option in option.best.map { $0.source == saved.source && $0.originAirport == saved.originAirport && $0.destinationAirport == saved.destinationAirport } ?? true }, "neighbor keeps route and source")
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [FixtureURLProtocol.self]
        let session = URLSession(configuration: configuration); defer { session.invalidateAndCancel() }
        let live = LiveSearchService(baseURL: URL(string: "https://backend.example"), session: session)
        let contract = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: "backend/tests/contract-response.json")))
        FixtureURLProtocol.status = 200
        FixtureURLProtocol.body = try JSONSerialization.data(withJSONObject: ["results": [["result": contract, "error": NSNull()], ["result": NSNull(), "error": "Источник временно недоступен"]]])
        let batch = try await live.searchBatch([saved.exactQuery(refresh: true), saved.exactQuery()])
        check(batch.count == 2 && batch[0].result?.offers.first?.source == "LIVE" && batch[1].result == nil && batch[1].error != nil, "live batch preserves order and per-query errors")
        check(FixtureURLProtocol.lastRequest?.url?.path == "/api/v1/search/batch", "live batch endpoint")
        let sent = try JSONSerialization.jsonObject(with: FixtureURLProtocol.lastBody) as! [String: Any]
        check((sent["queries"] as! [[String: Any]])[0]["force_refresh"] as? Bool == true, "live batch sends refresh flag")
        do { _ = try await live.searchBatch([saved.exactQuery()]); check(false, "batch count mismatch") } catch { count += 1 }
        return count
    }
}
