import SwiftUI

struct RatingDashboard: View {
    let offer: Offer
    let kind: CityScoreKind
    let score: Int?
    @Environment(\.dynamicTypeSize) private var textSize
    private var categories: [RatingCategoryInfo] { RatingCategoryInfo.categories(offer, kind: kind) }
    private var coverage: Int { categories.filter { $0.score != nil }.reduce(0) { $0 + $1.weight } }
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 18) {
                Text(kind == .full ? "ПОЛНАЯ ПОЕЗДКА" : "ПРЕДВАРИТЕЛЬНО · ПЕРЕЛЁТ").font(.caption.weight(.semibold)).tracking(1).foregroundStyle(Color.aviatorBlue)
                HStack(spacing: 20) {
                    ZStack {
                        Circle().stroke(Color.aviatorBlue.opacity(0.1), lineWidth: 9)
                        if let score {
                            Circle().trim(from: 0, to: CGFloat(score) / 100)
                                .stroke(Color.aviatorBlue.gradient, style: StrokeStyle(lineWidth: 9, lineCap: .round)).rotationEffect(.degrees(-90))
                        }
                        VStack(spacing: 0) {
                            Text(score.map(String.init) ?? "—").font(.system(size: 42, weight: .bold, design: .rounded)).foregroundStyle(Color.aviatorBlue).monospacedDigit().accessibilityIdentifier("ratings.score")
                            Text("из 100").font(.caption).foregroundStyle(.secondary)
                        }
                    }.frame(width: 116, height: 116).accessibilityElement(children: .contain)
                    VStack(alignment: .leading, spacing: 7) {
                        Text(score.map { "Уровень " + grade($0) } ?? "Балл пока\nне рассчитан").font(.system(.title3, design: .rounded, weight: .bold))
                        Text(score == nil ? "Ждём проверенные данные" : "Лучшая найденная поездка").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                }
                scale
                Text(score == nil ? "Недостаточно данных для этой модели" : "Балл лучшей найденной поездки").font(.subheadline.bold())
                Text(kind == .full ? "Доступны компоненты с суммарным весом \(coverage)%. Пропуски не считаются нулём и не повышают вес других категорий." : "65% — цена билетов, 35% — удобство дороги. Безопасность и стоимость отдыха в этот балл не входят.").font(.caption).foregroundStyle(.secondary)
                if offer.tripRating?.suitability == "avoid" { Label("Действует серьёзное предупреждение", systemImage: "exclamationmark.triangle.fill").font(.subheadline.bold()).foregroundStyle(.red) }
                Divider()
                HStack { Text("Категория"); Spacer(); Text("Балл").frame(width: 42); Text("Вес").frame(width: 36); Text("Вклад").frame(width: 44) }.font(.caption).foregroundStyle(.secondary)
                ForEach(categories) { category in
                    if textSize.isAccessibilitySize {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(category.title).font(.subheadline.bold())
                            Text("Балл: \(category.score.map(String.init) ?? "нет данных") · вес \(weight(category)) · вклад \(contribution(category))").font(.caption)
                        }
                    } else {
                        HStack(spacing: 4) {
                            Circle().fill(category.score == nil ? Color.gray.opacity(0.3) : Color.aviatorBlue).frame(width: 6, height: 6)
                            Text(category.title).font(.caption).frame(maxWidth: .infinity, alignment: .leading)
                            Text(category.score.map(String.init) ?? "—").foregroundStyle(category.score == nil ? Color.secondary : Color.aviatorBlue).frame(width: 42)
                            Text(weight(category)).frame(width: 36)
                            Text(contribution(category)).frame(width: 44)
                        }.font(.caption).monospacedDigit()
                    }
                    if category.id != categories.last?.id { Divider() }
                }
                Text("Вклад — балл × фиксированный вес. Известные вклады не суммируются в полный рейтинг при пропусках.").font(.caption2).foregroundStyle(.secondary)
            }.padding(20).frame(maxWidth: .infinity, alignment: .leading).background(.white, in: RoundedRectangle(cornerRadius: 24)).accessibilityIdentifier("ratings.dashboard")
            Text("Разбор по категориям").font(.title3.bold())
            ForEach(categories) { category in
                DisclosureGroup {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(category.explanation).font(.subheadline).foregroundStyle(.secondary)
                        if category.weight == 0 { Text("Не входит в предварительную модель перелёта. В полной модели вес \(category.id == "safety" ? 20 : 10)%.").font(.caption).foregroundStyle(Color.aviatorBlue) }
                        if category.score == nil { Text("Нет достаточных проверенных данных. Это не означает нулевую стоимость или отсутствие рисков.").font(.caption).foregroundStyle(.secondary) }
                    }.padding(.top, 12)
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: category.symbol).foregroundStyle(Color.aviatorBlue).frame(width: 38, height: 38).background(Color.aviatorBlue.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
                        VStack(alignment: .leading, spacing: 4) {
                            Text(category.title).font(.subheadline.bold()).foregroundStyle(Color.primary)
                            Text(category.score.map { "\($0) из 100 · вес \(weight(category))" } ?? "Нет данных · вес \(weight(category))").font(.caption).foregroundStyle(.secondary)
                            if let value = category.score {
                                ProgressView(value: Double(value), total: 100).tint(Color.aviatorBlue).padding(.top, 3)
                            }
                        }
                        Spacer(minLength: 0)
                        if !textSize.isAccessibilitySize { Text(category.score == nil ? "Нет данных" : "Есть данные").font(.caption2).padding(6).foregroundStyle(category.score == nil ? Color.secondary : Color.aviatorBlue).background(Color.gray.opacity(0.07), in: Capsule()) }
                    }
                }.tint(.primary).padding(16).background(.white, in: RoundedRectangle(cornerRadius: 20)).accessibilityIdentifier("ratings.category.\(category.id)")
            }
        }
    }
    private var scale: some View {
        VStack(spacing: 8) {
            GeometryReader { geometry in
                HStack(spacing: 4) {
                    ForEach(Array([0.30, 0.20, 0.20, 0.15, 0.15].enumerated()), id: \.offset) { index, fraction in
                        RoundedRectangle(cornerRadius: 4).fill([Color.red.opacity(0.3), Color.orange.opacity(0.4), Color.yellow.opacity(0.5), Color.aviatorBlue.opacity(0.5), Color.aviatorBlue][index]).frame(width: max(0, (geometry.size.width - 16) * fraction))
                    }
                }.overlay(alignment: .leading) {
                    if let score { Capsule().fill(Color.primary).frame(width: 3, height: 22).offset(x: max(0, min(geometry.size.width - 3, geometry.size.width * Double(score) / 100))) }
                }
            }.frame(height: 12)
            HStack { ForEach(["E", "D", "C", "B", "A"], id: \.self) { Text($0).font(.caption.weight(.medium)).frame(maxWidth: .infinity) } }.foregroundStyle(.secondary)
        }.accessibilityElement(children: .ignore).accessibilityLabel("Шкала от 0 до 100. \(score.map { "Балл \($0), категория \(grade($0))" } ?? "Балл неизвестен")")
    }
    private func grade(_ value: Int) -> String { value >= 85 ? "A" : value >= 70 ? "B" : value >= 50 ? "C" : value >= 30 ? "D" : "E" }
    private func weight(_ category: RatingCategoryInfo) -> String { category.weight == 0 ? "—" : "\(category.weight)%" }
    private func contribution(_ category: RatingCategoryInfo) -> String {
        guard category.weight > 0, let value = category.contribution else { return "—" }
        return value.formatted(.number.precision(.fractionLength(1)).locale(Locale(identifier: "ru_RU")))
    }
}
