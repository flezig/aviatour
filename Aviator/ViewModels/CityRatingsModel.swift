import Foundation
import Combine

@MainActor final class CityRatingsModel: ObservableObject {
    @Published private(set) var cities: [CityRating] = []
    @Published private(set) var query: SearchQuery?
    @Published private(set) var loading = false
    @Published private(set) var error: String?
    @Published private(set) var incomplete = false
    @Published private(set) var warnings: [String] = []
    let service: any SearchService
    let clock: any AppClock
    private var generation = UUID()
    private var loadedQuery: SearchQuery?
    init(service: any SearchService, clock: any AppClock) { self.service = service; self.clock = clock }
    static func parameters(_ base: SearchQuery) -> SearchQuery {
        var value = base
        value.destination = nil; value.destinationCityCode = nil
        value.weekendOnly = false
        value.maxBudgetMinor = 50_000_000
        value.tripPreferences.fullBudgetMinor = nil
        value.forceRefresh = false
        return value
    }
    func load(_ parameters: SearchQuery, force: Bool = false) async {
        if !force && loadedQuery == parameters { return }
        let ticket = UUID(); generation = ticket
        loading = true; error = nil; cities = []; query = parameters
        loadedQuery = nil; incomplete = false; warnings = []
        do {
            var request = parameters; request.forceRefresh = force
            let response = try await service.search(request)
            try Task.checkCancellation()
            let now = clock.now
            let prepared = await Task.detached(priority: .userInitiated) { CityRanking.build(response.offers.filter { SearchRules.accepts($0, query: parameters, now: now) }, now: now) }.value
            guard generation == ticket, !Task.isCancelled else { return }
            cities = prepared; incomplete = response.incomplete; warnings = response.warnings
            loadedQuery = parameters; loading = false
        } catch {
            guard generation == ticket else { return }
            loading = false
            if !(error is CancellationError) { self.error = error.localizedDescription }
        }
    }
}
