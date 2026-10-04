import SwiftUI

@MainActor struct DetailView: View {
    let offer: Offer
    @ObservedObject var favorites: FavoritesViewModel
    let clock: any AppClock
    let analytics: any AnalyticsService
    @Environment(\.openURL) private var openURL
    @State private var linkError: String?
    @State private var recordedOpen = false
    private var past: Bool { offer.departureAt <= clock.now }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                DestinationPhoto(name: offer.imageName).frame(height: 180).clipShape(RoundedRectangle(cornerRadius: 24))
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 8) { Text(offer.city).font(.largeTitle.bold()); Text(offer.country ?? "Страна не указана").foregroundStyle(.secondary) }
                    Spacer(); FavoriteButton(offer: offer, favorites: favorites)
                }
                Text(offer.isDemo ? "DEMO · демонстрационное предложение" : "LIVE · кешированные данные").font(.caption.bold()).foregroundStyle(Color.aviatorBlue)
                if !offer.canDisplay(at: clock.now) && !past { Text("Предложение недоступно или срок цены истёк. Повторите поиск.").foregroundStyle(.orange) }
                if past { Label("Даты прошли", systemImage: "calendar.badge.exclamationmark").foregroundStyle(.secondary) }
                VStack(alignment: .leading, spacing: 8) {
                    Text(Money.format(offer.priceMinor, currency: offer.currency)).font(.largeTitle.bold()).foregroundStyle(Color.aviatorBlue)
                    Text(offer.isDemo ? "Ориентировочно · туда-обратно · один взрослый · эконом" : "Ориентировочно · туда-обратно · один взрослый").font(.footnote).foregroundStyle(.secondary)
                    if !offer.isDemo { Text("Класс тарифа не подтверждён Data API. Поиск на Aviasales откроется для эконом-класса.").font(.footnote).foregroundStyle(.secondary) }
                    Text(offer.receivedLabel).font(.caption).foregroundStyle(.secondary)
                }
                RouteCard(offer: offer, outbound: true)
                RouteCard(offer: offer, outbound: false)
                if let hours = offer.stayHours, let cost = offer.costPerStayHourMinor {
                    VStack(alignment: .leading, spacing: 10) {
                        Label("Время для вашей поездки", systemImage: "sun.max.fill").font(.headline)
                        Text("≈ \(Int(hours)) часов в пункте назначения").font(.title2.bold())
                        Text("\(Money.format(cost)) за час поездки").foregroundStyle(Color.aviatorBlue)
                        Text("От расчётного прилёта до обратного вылета, включая ночи. Дорога из аэропорта, ожидание, проживание и питание не учтены.").font(.caption).foregroundStyle(.secondary)
                    }.padding(20).background(Color.aviatorBlue.opacity(0.08), in: RoundedRectangle(cornerRadius: 20))
                }
                PrimaryButton(title: "Посмотреть на Aviasales →") {
                    do {
                        let url = try LinkBuilder.url(for: offer, now: clock.now)
                        openURL(url) { accepted in
                            if accepted { analytics.record(.aviasalesClicked) } else { linkError = "Не удалось открыть ссылку." }
                        }
                    } catch { linkError = error.localizedDescription }
                }.disabled(past || !offer.canDisplay(at: clock.now)).accessibilityIdentifier("aviasalesButton")
                Text("Цена ориентировочная и может измениться. Актуальная стоимость проверяется на стороне партнёра. Оплата происходит не в Aviator").font(.footnote).foregroundStyle(.secondary)
                if offer.isDemo { Text("Демонстрационная цена не является реальным предложением. Ссылка откроет реальный поиск маршрута, где цена может отличаться.").font(.footnote).foregroundStyle(.secondary) }
                Text("Проживание, питание и трансферы не включены. Условия багажа проверяйте на стороне партнёра.").font(.footnote).foregroundStyle(.secondary)
            }.padding(20)
        }.background(Color(.systemGroupedBackground)).navigationTitle("Поездка").navigationBarTitleDisplayMode(.inline)
            .onAppear { if !recordedOpen { analytics.record(.destinationOpened); recordedOpen = true } }
            .alert("Переход не выполнен", isPresented: Binding(get: { linkError != nil }, set: { if !$0 { linkError = nil } })) { Button("Понятно", role: .cancel) {} } message: { Text(linkError ?? "") }
    }
    private func stops(_ value: Int?) -> String { value.map(String.init) ?? "неизвестно" }
}
