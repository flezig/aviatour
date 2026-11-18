import SwiftUI

@MainActor struct NearbyDatesView: View {
    let offer: Offer
    @ObservedObject var favorites: FavoritesViewModel
    let clock: any AppClock
    let analytics: any AnalyticsService
    let budget: Int
    @StateObject private var model = NearbyDatesViewModel()
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("\(offer.originAirport) → \(offer.destinationAirport)").font(.title2.bold())
                Text("Сдвиг всей поездки на ±3 дня с сохранением длительности. Сравниваем самые дешёвые найденные варианты этого маршрута; рейсы и авиакомпании могут отличаться.").font(.subheadline).foregroundStyle(.secondary)
                Text("До \(Money.format(budget)) · только билеты туда-обратно на одного").font(.caption)
                if model.isLoading { ProgressView("Проверяем семь пар дат…").frame(maxWidth: .infinity).padding() }
                ForEach(model.options) { option in
                    VStack(alignment: .leading, spacing: 10) {
                        Text(option.offset == 0 ? "Исходные даты" : (option.offset > 0 ? "+\(option.offset) дн." : "\(option.offset) дн.")).font(.headline)
                        if let query = option.query { Text("\(query.departureDate ?? "") → \(query.returnDate ?? "")").font(.subheadline) }
                        if let found = option.best {
                            NavigationLink { DetailView(offer: found, favorites: favorites, clock: clock, analytics: analytics) } label: {
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(Money.format(found.priceMinor, currency: found.currency)).font(.title3.bold()).foregroundStyle(Color.aviatorBlue)
                                    let delta = found.priceMinor - offer.priceMinor
                                    Text(delta == 0 ? "Как в исходном снимке" : "\(delta < 0 ? "Дешевле" : "Дороже") на \(Money.format(abs(delta))) относительно исходного снимка").font(.caption)
                                    Text(found.airlineLabel).font(.subheadline)
                                    Text(found.receivedLabel).font(.caption).foregroundStyle(.secondary)
                                    Text(found.isDemo ? "DEMO · условная цена" : "LIVE · кешированные данные").font(.caption)
                                }.frame(maxWidth: .infinity, alignment: .leading)
                            }.buttonStyle(.plain).accessibilityIdentifier("nearby.offer.\(option.offset)")
                            HStack { FavoriteButton(offer: found, favorites: favorites); CompareButton(offer: found) }
                        } else if let error = option.error {
                            Text(error).font(.footnote).foregroundStyle(.secondary)
                        } else if model.completed {
                            Text("В кеше нет вариантов в пределах бюджета. Это не означает, что билеты распроданы.").font(.footnote).foregroundStyle(.secondary)
                        }
                        if option.incomplete { Text("Выдача для этих дат неполная").font(.caption).foregroundStyle(.secondary) }
                    }.padding(18).frame(maxWidth: .infinity, alignment: .leading)
                        .background(.white, in: RoundedRectangle(cornerRadius: 20))
                }
                if model.completed { Button("Обновить сравнение дат") { Task { await load() } }.inlineAction("arrow.clockwise", expanded: true).disabled(model.isLoading) }
                Text("Цена может измениться. Перед покупкой проверьте её на Aviasales.").font(.footnote).foregroundStyle(.secondary)
            }.padding(20)
        }.background(Color(.systemGroupedBackground)).navigationTitle("Соседние даты").navigationBarTitleDisplayMode(.inline)
            .task { if !model.completed { await load() } }
    }
    private func load() async {
        guard let service = favorites.service(for: offer) else { return }
        await model.load(offer: offer, budget: budget, service: service, clock: clock)
    }
}
