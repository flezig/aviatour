import Foundation
@testable import Aviator

@MainActor enum PersonalRatingChecks {
    static func run(airports: [Airport], now: Date) async throws -> Int {
        var count = 0
        func check(_ condition: Bool, _ label: String) { precondition(condition, label); count += 1 }
        let suite = "personal-checks-" + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let profile = TravelerProfile(defaults: defaults)
        check(profile.preferences.citizenship == nil && profile.preferences.interests.isEmpty, "no nationality inferred")
        profile.preferences.citizenship = "RU"; profile.preferences.residence = "GE"
        profile.preferences.interests = [.culture, .sea]; profile.preferences.style = .lessRoad
        profile.toggleCity("PAR")
        let reopened = TravelerProfile(defaults: defaults)
        check(reopened.preferences == profile.preferences && reopened.savedCities == ["PAR"], "profile and independent saved city persist")
        reopened.toggleCity("PAR"); check(reopened.savedCities.isEmpty, "city unsaves independently")
        check(CityGuide.all.count >= 25, "offline editorial catalog loaded")
        let paris = CityGuide.all["PAR"]!
        check(paris.match([]) == nil && paris.match([.culture, .sea]) == 50, "unknown interests not zero; matches use selected denominator")
        check(paris.hdiYear == 2023 && paris.hdiValue != nil, "HDI year explicit")
        check(TravelStyle.allCases.allSatisfy { $0.weights.price + $0.weights.road + $0.weights.interests == 100 }, "preference weights sum to 100")
        let mock = MockSearchService(airports: airports, clock: FixedClock(now: now))
        let saved = try await mock.search(SearchQuery(month: "2026-10", maxBudgetMinor: 50_000_000)).offers[0]
        check(PersonalRanking.score(saved, preferences: profile.preferences) == nil, "demo never presents computed live score")
        let rating: [String: Any] = ["version":"trip-v1.0", "currency":"RUB", "travelers":1, "housing":"standard", "food":"mixed", "completeness":"low", "suitability":"unknown", "entryStatus":"Unknown", "updatedAt":now.timeIntervalSinceReferenceDate, "reasons":[], "missing":[], "lines":[], "evidence":[], "roadScore":80]
        let live = try BehaviorChecks.modify(saved, ["source":"LIVE", "cityCode":"PAR", "priceMinor":2_000_000, "tripRating":rating])
        var balanced = profile.preferences; balanced.style = .balanced
        check(PersonalRanking.score(live, preferences: balanced) == 67, "explicit balanced price-road-interest weighting")
        balanced.style = .lessRoad
        check(PersonalRanking.score(live, preferences: balanced) == 71, "road preference changes reproducible score")
        balanced.interests = []
        check(PersonalRanking.score(live, preferences: balanced) == nil, "missing interests cannot inflate weights")
        var avoidedRating = rating; avoidedRating["suitability"] = "avoid"
        let avoided = try BehaviorChecks.modify(live, ["tripRating":avoidedRating])
        check(PersonalRanking.score(avoided, preferences: profile.preferences) == nil, "serious reviewed warning blocks preference score")
        let request = CityInsightRequest(offer: saved, preferences: profile.preferences)
        check(request.citizenship == "RU" && request.residence == "GE" && request.interests == ["culture", "sea"], "passport and residence remain separate in transport")
        let cities = CityRanking.build([saved, try BehaviorChecks.modify(saved, ["id":"another", "priceMinor": saved.priceMinor + 10000])], now: now)
        check(cities.count == 1 && cities[0].medianPriceMinor == saved.priceMinor + 5000, "even median interpolates center")
        check(cities[0].personalScore(profile.preferences) == nil, "unknown personal score remains unknown")
        let service = RecordingSearch(.success(SearchResult(offers: [saved], incomplete: false, warnings: [])))
        let vm = SearchViewModel(service: service, clock: FixedClock(now: now), analytics: QuietAnalytics(), preferences: defaults)
        vm.query.origin = "LED"; vm.query.maxBudgetMinor = 4_000_000
        let restored = SearchViewModel(service: service, clock: FixedClock(now: now), analytics: QuietAnalytics(), preferences: defaults)
        check(restored.query.origin == "LED" && restored.query.maxBudgetMinor == 4_000_000, "search conditions restored")
        vm.query = saved.exactQuery()
        vm.start(); try await Task.sleep(nanoseconds: 100_000_000)
        let previous = vm.offers
        check(!previous.isEmpty, "fixture successful search")
        service.result = .failure(SearchFailure.offline)
        vm.query.maxBudgetMinor += 10000; vm.start(); try await Task.sleep(nanoseconds: 100_000_000)
        check(vm.state == .offline && vm.previousOffers == previous && vm.previousQuery?.maxBudgetMinor != vm.query.maxBudgetMinor, "failed new search preserves results with old conditions")
        vm.query.month = "2020-01"; vm.query.departureDate = "2020-01-01"; vm.query.returnDate = "2020-01-03"
        let current = SearchViewModel(service: service, clock: FixedClock(now: now), analytics: QuietAnalytics(), preferences: defaults)
        check(current.query.month == "2026-10" && !current.query.usesExactDates && current.query.origin == vm.query.origin, "expired dates reset without dropping origin")
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [FixtureURLProtocol.self]
        let session = URLSession(configuration: configuration); defer { session.invalidateAndCancel() }
        FixtureURLProtocol.status = 200
        FixtureURLProtocol.body = try JSONSerialization.data(withJSONObject: [
            "city_code": saved.cityCode, "status": "no_guide", "fetched_at": "2026-10-08T10:00:00Z",
            "guide": NSNull(), "weather": NSNull(), "basket": NSNull(), "safety": NSNull(),
            "hdi": ["value": 0.832, "year": 2023, "source_url": "https://hdr.undp.org/", "publication": "HDR 2025", "retrieved": "2026-10-08", "note": "Country context"],
            "entry": ["status": "unknown", "note": "Not verified", "citizenship": "RU", "residence": "GE", "source_url": NSNull(), "check_url": "https://apply.joinsherpa.com/travel-restrictions"],
            "interest_score": NSNull(), "matched_interests": []
        ])
        let decoded = try await CityInsightService(baseURL: URL(string: "https://backend.example"), session: session).load(request)
        check(decoded.cityCode == saved.cityCode && decoded.hdi?.year == 2023 && decoded.entry.status == "unknown", "context contract decodes year and unknown visa")
        check(FixtureURLProtocol.lastRequest?.url?.path == "/api/v1/cities/insights", "context uses separate endpoint")
        let posted = try JSONSerialization.jsonObject(with: FixtureURLProtocol.lastBody) as! [String: Any]
        check(posted["citizenship"] as? String == "RU" && posted["residence"] as? String == "GE", "transport preserves separate passport and residence")
        return count
    }
}
