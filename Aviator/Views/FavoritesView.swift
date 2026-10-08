import SwiftUI

@MainActor struct FavoritesView: View {
    @EnvironmentObject private var profile: TravelerProfile
    @Environment(\.openSavedCity) private var openSavedCity
    @ObservedObject var favorites: FavoritesViewModel
    var airports: [Airport] = []
    let clock: any AppClock
    let analytics: any AnalyticsService
    var body: some View {
        NavigationStack {
            Group {
                if favorites.offers.isEmpty {
                    VStack { savedCities; StatusPanel(symbol: "heart", title: "Сохраните мечту", message: "Нажмите на сердечко понравившейся поездки. Маршрут, даты и снимок цены останутся здесь без сети.") }.padding(.horizontal)
                } else {
                    List {
                        savedCities
                        Section {
                            Text("Обновление повторно запрашивает найденные цены. Наличие билетов и багаж проверяются на Aviasales.").font(.footnote).foregroundStyle(.secondary)
                            Toggle("Сообщать о снижении цены", isOn: $favorites.priceDropAlertsEnabled)
                                .accessibilityIdentifier("favorites.priceDropAlerts")
                            Text("Уведомления появляются здесь после ручного обновления. Фоновых проверок нет. Повторяется только новое снижение ниже уже сообщённой цены.")
                                .font(.caption).foregroundStyle(.secondary)
                            if !favorites.priceDropAlerts.isEmpty {
                                ForEach(Array(favorites.priceDropAlerts.enumerated()), id: \.offset) { _, message in
                                    Label(message, systemImage: "bell.badge").font(.subheadline)
                                }
                                Button("Очистить уведомления") { favorites.clearPriceDropAlerts() }
                            }
                            if favorites.isRefreshing { ProgressView("Обновляем избранное…") }
                            if let summary = favorites.refreshSummary { Text(summary).font(.footnote).accessibilityIdentifier("favorites.refreshSummary") }
                        }
                        ForEach(favorites.offers) { offer in
                            VStack(alignment: .leading, spacing: 10) {
                                NavigationLink { DetailView(offer: offer, favorites: favorites, clock: clock, analytics: analytics) } label: {
                                    HStack(spacing: 16) {
                                        DestinationPhoto(name: offer.imageName).frame(width: 72, height: 88).clipShape(RoundedRectangle(cornerRadius: 12))
                                        VStack(alignment: .leading, spacing: 8) {
                                            Text(offer.city).font(.headline)
                                            Text(Money.format(offer.priceMinor, currency: offer.currency)).foregroundStyle(Color.aviatorBlue)
                                            Text(TravelDates.display(offer.departureAt, zone: offer.originTimezone) + " → " + TravelDates.display(offer.returnAt, zone: offer.destinationTimezone)).font(.caption)
                                            Text(offer.isDemo ? "DEMO · снимок цены" : "LIVE · снимок цены").font(.caption)
                                            Text(offer.receivedLabel).font(.caption2).foregroundStyle(.secondary)
                                            if offer.departureAt <= clock.now { Text("Даты прошли").font(.caption).foregroundStyle(.secondary) }
                                        }
                                    }
                                }.accessibilityIdentifier("saved.\(offer.destinationAirport)")
                                if let change = offer.priceChangeMinor {
                                    Text(change == 0 ? "Цена как при сохранении" : "\(change < 0 ? "Снижение" : "Рост") на \(Money.format(abs(change))) с момента сохранения")
                                        .font(.subheadline).foregroundStyle(change < 0 ? Color.green : Color.secondary)
                                }
                                if let checked = offer.lastCheckedAt { Text("Проверка: " + TravelDates.display(checked, zone: TimeZone.current.identifier, time: true)).font(.caption).foregroundStyle(.secondary) }
                                if let message = offer.refreshMessage { Text(message).font(.caption).foregroundStyle(.secondary) }
                                CompareButton(offer: offer)
                            }.padding(.vertical, 4)
                                .swipeActions { Button("Удалить", role: .destructive) { favorites.toggle(offer) } }
                        }
                    }.refreshable { await favorites.refresh() }
                }
            }.navigationTitle("Избранное").onAppear { favorites.reload() }
                .toolbar {
                    Button { Task { await favorites.refresh() } } label: { Label("Обновить", systemImage: "arrow.clockwise") }
                        .disabled(favorites.isRefreshing || favorites.offers.isEmpty).accessibilityIdentifier("favorites.refresh")
                }
        }
    }
    private var savedCities: some View {
        Group {
            if !profile.savedCities.isEmpty {
                Section("Сохранённые города") {
                    ForEach(profile.savedCities.sorted(), id: \.self) { code in
                        HStack {
                            Button { openSavedCity(code) } label: {
                                Label(airports.first { $0.cityCode == code }?.city ?? code, systemImage: "building.2")
                            }.frame(minHeight: 44)
                            Spacer()
                            Button { profile.toggleCity(code) } label: { Image(systemName: "bookmark.slash") }
                                .accessibilityLabel("Убрать город из сохранённых").frame(minWidth: 44, minHeight: 44)
                        }
                    }
                    Text("Города сохранены без конкретного рейса. При открытии используются текущие условия поиска.").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

}
