import SwiftUI

@MainActor struct ProfileView: View {
    @EnvironmentObject var profile: TravelerProfile
    @Environment(\.dismiss) private var dismiss
    let airports: [Airport]
    private var countries: [String] {
        Set(airports.compactMap(\.countryCode)).sorted {
            (Locale(identifier: "ru_RU").localizedString(forRegionCode: $0) ?? $0) < (Locale(identifier: "ru_RU").localizedString(forRegionCode: $1) ?? $1)
        }
    }
    var body: some View {
        NavigationStack {
            Form {
                Section("Документы и проживание") {
                    countryPicker("Гражданство / паспорт", selection: $profile.preferences.citizenship).accessibilityIdentifier("profile.citizenship")
                    countryPicker("Страна проживания", selection: $profile.preferences.residence).accessibilityIdentifier("profile.residence")
                    Text("Для виз важен паспорт. Проживание, транзит и имеющиеся визы могут менять правила. Приложение не подтверждает право на въезд.").font(.caption).foregroundStyle(.secondary)
                }
                Section("Что вам интересно") {
                    ForEach(TravelInterest.allCases) { interest in
                        Toggle(interest.title, isOn: Binding(get: { profile.preferences.interests.contains(interest) }, set: {
                            if $0 { profile.preferences.interests.insert(interest) } else { profile.preferences.interests.remove(interest) }
                        })).accessibilityIdentifier("profile.interest.\(interest.id)")
                    }
                }
                Section("Что важнее при выборе") {
                    Picker("Профиль поездки", selection: $profile.preferences.style) {
                        ForEach(TravelStyle.allCases) { Text($0.title).tag($0) }
                    }
                    let w = profile.preferences.style.weights
                    Text("Цена билетов \(w.price)% · дорога \(w.road)% · интересы \(w.interests)%. Это подбор по предпочтениям, а не полный рейтинг безопасности и расходов.").font(.caption).foregroundStyle(.secondary)
                    Text("«С семьёй» повышает вес дороги. Возраст детей, детские тарифы и пригодность жилья пока не оцениваются.").font(.caption).foregroundStyle(.secondary)
                }
                Section {
                    Text("Профиль хранится на этом устройстве. При открытии показателей города на сервер передаются выбранные страны, интересы, город и даты. Регистрация не требуется.").font(.footnote).foregroundStyle(.secondary)
                }
            }.navigationTitle("Мой профиль").toolbar { Button("Готово") { dismiss() } }
                .accessibilityIdentifier("profile.screen")
        }
    }
    private func countryPicker(_ title: String, selection: Binding<String?>) -> some View {
        Picker(title, selection: selection) {
            Text("Не указано").tag(Optional<String>.none)
            ForEach(countries, id: \.self) { code in
                Text(Locale(identifier: "ru_RU").localizedString(forRegionCode: code) ?? code).tag(Optional(code))
            }
        }
    }
}

private struct OpenSavedCityKey: EnvironmentKey {
    static let defaultValue: (String) -> Void = { _ in }
}
extension EnvironmentValues {
    var openSavedCity: (String) -> Void {
        get { self[OpenSavedCityKey.self] }
        set { self[OpenSavedCityKey.self] = newValue }
    }
}
