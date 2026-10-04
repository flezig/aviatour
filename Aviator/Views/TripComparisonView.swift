import SwiftUI

struct CompareButton: View {
    let offer: Offer
    @EnvironmentObject private var comparison: ComparisonModel
    var body: some View {
        Button { comparison.toggle(offer) } label: {
            Label(comparison.contains(offer) ? "В сравнении" : "Сравнить", systemImage: comparison.contains(offer) ? "checkmark.circle.fill" : "rectangle.split.2x1")
                .font(.subheadline).frame(minHeight: 44)
        }.buttonStyle(.plain).foregroundStyle(Color.aviatorBlue)
            .accessibilityIdentifier("compare.\(offer.id)")
    }
}

@MainActor struct TripComparisonView: View {
    @EnvironmentObject private var comparison: ComparisonModel
    @ObservedObject var favorites: FavoritesViewModel
    let clock: any AppClock
    let analytics: any AnalyticsService
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("Выберите 2–4 поездки в результатах поиска, подборках или избранном.").font(.subheadline).foregroundStyle(.secondary)
                    if comparison.offers.count < 2 {
                        StatusPanel(symbol: "rectangle.split.2x1", title: "\(comparison.offers.count) из 4 поездок", message: "Нажмите «Сравнить» у понравившихся вариантов. Выбранные поездки останутся здесь при смене поиска.")
                    }
                    if !comparison.offers.isEmpty {
                        ScrollView(.horizontal) {
                            HStack(alignment: .top, spacing: 14) {
                                ForEach(comparison.offers) { saved in
                                    let offer = favorites.current(saved)
                                    VStack(alignment: .leading, spacing: 12) {
                                        Text(offer.city).font(.title2.bold()).frame(minHeight: 60, alignment: .topLeading)
                                        Text("\(offer.originAirport) → \(offer.destinationAirport)").font(.subheadline)
                                        Text(Money.format(offer.priceMinor, currency: offer.currency)).font(.title2.bold()).foregroundStyle(Color.aviatorBlue)
                                        Text(offer.isDemo ? "DEMO · условная цена" : "LIVE · кешированная цена").font(.caption)
                                        Text(offer.receivedLabel).font(.caption).foregroundStyle(.secondary).frame(minHeight: 48, alignment: .topLeading)
                                        metric("Даты", TravelDates.display(offer.departureAt, zone: offer.originTimezone) + " → " + TravelDates.display(offer.returnAt, zone: offer.destinationTimezone), height: 85)
                                        metric("На месте", offer.stayHours.map { "≈ \(Int($0)) ч" } ?? "Неизвестно")
                                        metric("Дорога туда и обратно", offer.roadMinutes.map { "\($0 / 60) ч \($0 % 60) мин" } ?? "Неизвестно")
                                        metric("Пересадки туда / обратно", "\(offer.transfers.map(String.init) ?? "?") / \(offer.returnTransfers.map(String.init) ?? "?")")
                                        metric("Стоимость часа поездки", offer.costPerStayHourMinor.map { Money.format($0, currency: offer.currency) } ?? "Неизвестно")
                                        NavigationLink("Подробнее") { DetailView(offer: offer, favorites: favorites, clock: clock, analytics: analytics) }.frame(minHeight: 44)
                                        Button("Убрать") { comparison.toggle(saved) }.frame(minHeight: 44).foregroundStyle(.secondary)
                                    }.padding(18).frame(width: 245, alignment: .leading)
                                        .background(.white, in: RoundedRectangle(cornerRadius: 22)).accessibilityIdentifier("comparison.\(offer.id)")
                                }
                            }
                        }
                    }
                    Text("Бюджет — только билеты туда-обратно на одного взрослого. Время на месте и прилёт рассчитаны; проживание и дорога из аэропорта не включены. Багаж уточните у продавца. Наличие и окончательную цену проверяет Aviasales.").font(.footnote).foregroundStyle(.secondary)
                }.padding(20)
            }.background(Color(.systemGroupedBackground)).navigationTitle("Сравнение")
                .toolbar { if !comparison.offers.isEmpty { Button("Очистить") { comparison.clear() } } }
        }
    }
    private func metric(_ title: String, _ value: String, height: CGFloat = 72) -> some View {
        VStack(alignment: .leading, spacing: 6) { Text(title).font(.caption).foregroundStyle(.secondary); Text(value).font(.headline) }
            .frame(maxWidth: .infinity, minHeight: height, alignment: .topLeading)
    }
}

private struct TripBudgetKey: EnvironmentKey { static let defaultValue = 2_500_000 }
extension EnvironmentValues {
    var tripBudget: Int {
        get { self[TripBudgetKey.self] }
        set { self[TripBudgetKey.self] = newValue }
    }
}
