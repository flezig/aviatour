import SwiftUI

@MainActor struct ResultsView: View {
    @ObservedObject var model: SearchViewModel
    @ObservedObject var favorites: FavoritesViewModel
    let analytics: any AnalyticsService
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var textSize
    var body: some View {
        let offers = model.offers
        return ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let query = model.performedQuery {
                    Text("\(query.originCityCode.map { "\($0) · все аэропорты" } ?? query.origin) · \(TravelDates.monthLabel(query.month)) · до \(Money.format(query.maxBudgetMinor))").font(.subheadline).foregroundStyle(.secondary)
                }
                switch model.state {
                case .loading:
                    ProgressView("Ищем идеи для выходных…").frame(maxWidth: .infinity).padding(48).accessibilityIdentifier("loadingState")
                case .error(let message):
                    StatusPanel(symbol: "exclamationmark.triangle", title: "Поиск не завершён", message: message)
                    PrimaryButton(title: "Попробовать ещё раз") { model.start() }
                case .offline:
                    StatusPanel(symbol: "wifi.slash", title: "Нет связи", message: "Не удалось связаться с backend. Проверьте сеть и адрес сервера.")
                    PrimaryButton(title: "Повторить поиск") { model.start() }
                case .idle: EmptyView()
                case .success, .empty:
                    filters
                    if model.result.incomplete {
                        Text("Показаны найденные варианты; список может быть неполным").font(.footnote).foregroundStyle(.secondary)
                        ForEach(model.result.warnings, id: \.self) { Text($0).font(.caption).foregroundStyle(.secondary) }
                    }
                    if offers.isEmpty {
                        StatusPanel(symbol: "paperplane", title: "Пока без вариантов", message: model.emptyMessage)
                        if !model.filters.isEmpty {
                            PrimaryButton(title: "Сбросить фильтры") { model.filters = ExtraFilters() }
                        } else {
                            if (model.performedQuery ?? model.query).maxBudgetMinor < 10_000_000 {
                                PrimaryButton(title: "Искать до \(Money.format(min(10_000_000, (model.performedQuery ?? model.query).maxBudgetMinor + 1_000_000)))") { model.retryWithBudget() }
                            }
                            if (model.performedQuery ?? model.query).directOnly {
                                PrimaryButton(title: "Разрешить пересадки") { model.retryWithTransfers() }
                            }
                            Button("Изменить месяц и условия поиска") { dismiss() }.frame(minHeight: 44)
                        }
                    } else {
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 16), count: textSize.isAccessibilitySize ? 1 : 2), spacing: 20) {
                            ForEach(offers) { offer in
                                NavigationLink { DetailView(offer: offer, favorites: favorites, clock: model.clock, analytics: analytics) } label: { OfferCard(offer: offer, favorites: favorites) }
                                    .buttonStyle(.plain).accessibilityIdentifier("offer.\(offer.destinationAirport)")
                            }
                        }.accessibilityIdentifier("resultsGrid")
                    }
                }
            }.padding(20)
        }.background(Color(.systemGroupedBackground)).navigationTitle("Варианты")
    }
    private var filters: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chip("Все", selected: model.filters.isEmpty) { model.filters = ExtraFilters() }
                chip("До 20 000 ₽", selected: model.filters.cheap) { model.filters.cheap.toggle() }
                chip("Прямые", selected: model.filters.direct) { model.filters.direct.toggle() }
                chip("Россия", selected: model.filters.russia) { model.filters.russia.toggle() }
            }
        }
    }
    private func chip(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) { Text(title).font(.subheadline.weight(.medium)).padding(.horizontal, 16).frame(minHeight: 44).background(selected ? Color.aviatorBlue : .white, in: Capsule()).foregroundStyle(selected ? .white : .primary) }.buttonStyle(.plain).accessibilityAddTraits(selected ? [.isSelected] : [])
    }
}
