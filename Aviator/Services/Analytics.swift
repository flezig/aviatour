import Foundation
import OSLog

enum AnalyticsEvent: String { case appOpen = "app_open", searchStarted = "search_started", searchCompleted = "search_completed", destinationOpened = "destination_opened", destinationFavorited = "destination_favorited", aviasalesClicked = "aviasales_clicked" }
protocol AnalyticsService { func record(_ event: AnalyticsEvent) }
struct LocalAnalytics: AnalyticsService {
    private let logger = Logger(subsystem: "com.aviator.app", category: "analytics")
    func record(_ event: AnalyticsEvent) { logger.info("\(event.rawValue, privacy: .public)") }
}
