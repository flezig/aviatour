import SwiftUI

struct TripRatingView: View {
    let offer: Offer
    var detailed = false
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Для поездки из \(offer.originCity)").font(.caption.bold())
            if let r = offer.tripRating {
                Text(r.title).font(detailed ? .headline : .caption.bold())
                    .foregroundStyle(r.suitability == "avoid" ? Color.red : Color.aviatorBlue)
                if r.score == nil, let score = r.preliminaryScore {
                    Text("Предварительная оценка перелёта: \(score)/100").font(.caption.bold())
                    Text("Только цена билетов и дорога. Без жилья, питания, безопасности и условий отдыха.").font(.caption2).foregroundStyle(.secondary)
                }
                if let low = r.totalLowMinor, let high = r.totalHighMinor {
                    Text("Полный бюджет ≈ " + TripRating.money(low, high) + " / человек").font(.caption)
                } else {
                    Text("Полный бюджет пока неизвестен").font(.caption)
                }
                Text("\(r.travelers) чел. · " + (r.nights.map { "\($0) ночей" } ?? "Ночи неизвестны")).font(.caption)
                ForEach(Array(r.reasons.prefix(3).enumerated()), id: \.offset) { _, reason in Text(reason).font(.caption) }
                Text("Полнота: \(r.completenessLabel). " + (r.missing.isEmpty ? "Компоненты доступны; цены ориентировочные." : "Не хватает: " + r.missing.joined(separator: ", "))).font(.caption2).foregroundStyle(.secondary)
                if Date().timeIntervalSince(r.updatedAt) > 86400 {
                    Text("Оценка сохранена более суток назад. Повторите поиск для обновления.").font(.caption).foregroundStyle(.orange)
                }
                Text("Оценка обновлена " + TravelDates.display(r.updatedAt, zone: TimeZone.current.identifier, time: true)).font(.caption2).foregroundStyle(.secondary)
                if detailed {
                    Divider()
                    Text("Ориентировочные расходы на человека").font(.headline)
                    ForEach(r.lines) { line in
                        Text(line.title + ": ≈ " + TripRating.money(line.lowMinor, line.highMinor)).font(.subheadline)
                    }
                    if let low = r.stayLowMinor, let high = r.stayHighMinor {
                        Text("Стоимость отдыха в городе без перелёта: ≈ " + TripRating.money(low, high)).font(.subheadline.bold())
                        Text("Доступность отдыха: \(r.stayScore.map(String.init) ?? "—")/100; те же даты, жильё, питание и группа").font(.caption)
                    } else { Text("Стоимость отдыха в городе: недостаточно данных").font(.subheadline) }
                    Text("Бюджет 45%: \(r.budgetScore.map(String.init) ?? "—") · Дорога 25%: \(r.roadScore.map(String.init) ?? "—")\nБезопасность 20%: \(r.safetyScore.map(String.init) ?? "—") · Условия 10%: \(r.conditionsScore.map(String.init) ?? "—")").font(.caption)
                    if let score = r.preliminaryScore {
                        Text("Предварительная модель \(r.preliminaryVersion ?? "flight-v1.0"): \(score)/100. Цена билетов 65%, удобство дороги 35%; эталон цены 20 000 ₽ на взрослого.").font(.caption)
                    }
                    Text("Методика \(r.version). Пригодность выбранной поездки, а не качество города. Пропуски не повышают балл.").font(.caption)
                    Text(r.entryStatus + ". Гражданство и документы не проверялись.").font(.footnote)
                    Text("Цены билетов кешированные. Умножение на число взрослых не подтверждает наличие мест для группы. Обязательные сборы учитываются только при наличии в источнике.").font(.caption).foregroundStyle(.secondary)
                    ForEach(Array(r.evidence.enumerated()), id: \.offset) { _, e in
                        VStack(alignment: .leading, spacing: 4) {
                            Link(e.source, destination: URL(string: e.sourceUrl) ?? URL(string: "https://travelpayouts.github.io/slate/")!).inlineAction("arrow.up.right", expanded: true)
                            Text("Уровень: " + geography(e.geography) + "; период \(e.periodStart ?? "неизвестен") — \(e.periodEnd ?? "неизвестен")").font(.caption)
                            Text(e.method + (e.estimated ? ". Расчётные данные." : "")).font(.caption)
                            Text("Получено " + TravelDates.display(e.fetchedAt, zone: TimeZone.current.identifier, time: true)).font(.caption2)
                        }
                    }
                }
            } else {
                Text(offer.isDemo ? "DEMO: полный рейтинг не рассчитан" : "Недостаточно данных для полного рейтинга").font(.caption)
                Text("Нет сопоставимых данных о жилье, питании, безопасности и условиях отдыха.").font(.caption2).foregroundStyle(.secondary)
            }
        }.accessibilityIdentifier(detailed ? "rating.details" : "rating.card")
    }
    private func geography(_ value: String) -> String {
        switch value { case "city": return "город"; case "region": return "регион"; case "country": return "страна (не измерение города)"; default: return "маршрут" }
    }
}
