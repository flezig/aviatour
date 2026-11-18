import SwiftUI

private struct OpenCityRatingKey: EnvironmentKey {
    static let defaultValue: (Offer) -> Void = { _ in }
}
extension EnvironmentValues {
    var openCityRating: (Offer) -> Void {
        get { self[OpenCityRatingKey.self] }
        set { self[OpenCityRatingKey.self] = newValue }
    }
}
struct CompactRatingView: View {
    let offer: Offer
    @Environment(\.openCityRating) private var openRating
    var body: some View {
        Button { openRating(offer) } label: {
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(offer.tripRating?.score != nil ? "Рейтинг поездки" : "Оценка перелёта*").font(.caption)
                    Spacer()
                    Text((offer.tripRating?.score ?? offer.tripRating?.preliminaryScore).map { "\($0)/100" } ?? "—").font(.headline.bold()).foregroundStyle(Color.aviatorBlue)
                }
                if offer.tripRating?.suitability == "avoid" { Text("Поездка не рекомендована").font(.caption.bold()).foregroundStyle(.red) }
                Text("Подробнее во вкладке «Рейтинг» →").font(.caption2).foregroundStyle(Color.aviatorBlue)
            }.padding(10).background(Color.aviatorBlue.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
        }.buttonStyle(.plain).accessibilityIdentifier("rating.compact")
            .accessibilityHint("Открыть рейтинг города, безопасность и разбивку расходов")
    }
}
