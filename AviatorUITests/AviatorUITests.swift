import XCTest
final class AviatorUITests: XCTestCase {
    func testUnknownFullBudgetCanBeRemovedWithoutLosingFlightSearch() {
        let app = XCUIApplication(); app.launchArguments = ["--ui-smoke"]; app.launch()
        let preferences = app.buttons["Условия полного бюджета"]
        for _ in 0..<5 where !preferences.isHittable { app.swipeUp() }
        XCTAssertTrue(preferences.waitForExistence(timeout: 5)); preferences.tap()
        let toggle = app.switches["fullBudgetToggle"]
        for _ in 0..<4 where !toggle.isHittable { app.swipeUp() }
        XCTAssertTrue(toggle.exists); toggle.tap()
        let search = app.buttons["searchButton"]
        for _ in 0..<4 where !search.isHittable { app.swipeUp() }
        search.tap()
        let remove = app.buttons["Убрать предел полного бюджета"]
        for _ in 0..<4 where !remove.isHittable { app.swipeUp() }
        XCTAssertTrue(remove.waitForExistence(timeout: 5)); remove.tap()
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "offer.LED.")).firstMatch.waitForExistence(timeout: 5))
    }
    func testProfileInterestsAndSavedCity() {
        let app = XCUIApplication(); app.launchArguments = ["--ui-smoke"]; app.launch()
        app.tabBars.buttons["Куда поехать"].tap()
        app.buttons["profile.open"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["profile.screen"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["profile.citizenship"].exists)
        let interest = app.switches["profile.interest.culture"]
        XCTAssertTrue(interest.exists); interest.switches.firstMatch.exists ? interest.switches.firstMatch.tap() : interest.tap()
        XCTAssertEqual(interest.value as? String, "1")
        app.buttons["Готово"].tap()
        XCTAssertTrue(app.staticTexts["Для вас: Баланс · интересов выбрано: 1"].waitForExistence(timeout: 5))
        let field = app.textFields["ratings.search"]
        XCTAssertTrue(field.waitForExistence(timeout: 5)); field.tap(); field.typeText("LED\n")
        app.buttons["ratings.city.LED"].tap()
        let save = app.buttons["city.save"]
        for _ in 0..<10 where !save.isHittable { app.swipeUp() }
        XCTAssertTrue(save.waitForExistence(timeout: 5)); save.tap()
        for identifier in ["city.weather", "city.basket", "city.safety", "city.visa", "city.hdi"] {
            XCTAssertTrue(app.descendants(matching: .any)[identifier].exists)
        }
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Контекст города и профиль"; shot.lifetime = .keepAlways; add(shot)
        app.tabBars.buttons["Избранное"].tap()
        XCTAssertTrue(app.buttons["Санкт-Петербург"].waitForExistence(timeout: 5))
    }

    func testCityRatingsSearchAndCategoryDashboard() {
        let app = XCUIApplication(); app.launchArguments = ["--ui-smoke"]; app.launch()
        app.tabBars.buttons["Куда поехать"].tap()
        XCTAssertTrue(app.buttons["ratings.city.LED"].waitForExistence(timeout: 10))
        let field = app.textFields["ratings.search"]
        field.tap(); field.typeText("LED\n")
        XCTAssertTrue(app.staticTexts["Направлений: 1"].waitForExistence(timeout: 5))
        let list = XCTAttachment(screenshot: app.screenshot()); list.name = "Рейтинг городов — список"; list.lifetime = .keepAlways; add(list)
        app.buttons["ratings.city.LED"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["ratings.dashboard"].waitForExistence(timeout: 5))
        let score = XCTAttachment(screenshot: app.screenshot()); score.name = "Рейтинг города — балл и шкала"; score.lifetime = .keepAlways; add(score)
        for _ in 0..<4 where !app.descendants(matching: .any)["ratings.category.safety"].isHittable { app.swipeUp() }
        XCTAssertTrue(app.descendants(matching: .any)["ratings.category.safety"].exists)
        let categories = XCTAttachment(screenshot: app.screenshot()); categories.name = "Рейтинг города — категории"; categories.lifetime = .keepAlways; add(categories)
    }
    func testCompactRatingOpensSeparateTab() {
        let app = XCUIApplication(); app.launchArguments = ["--ui-smoke"]; app.launch()
        let search = app.buttons["searchButton"]
        for _ in 0..<4 where !search.isHittable { app.swipeUp() }
        search.tap()
        let rating = app.buttons["rating.compact"].firstMatch
        XCTAssertTrue(rating.waitForExistence(timeout: 10))
        for _ in 0..<4 where !rating.isHittable { app.swipeUp() }
        rating.tap()
        XCTAssertTrue(app.tabBars.buttons["Куда поехать"].isSelected)
        XCTAssertTrue(app.descendants(matching: .any)["ratings.dashboard"].waitForExistence(timeout: 10))
    }
    func testMockJourney() {
        let app = XCUIApplication();app.launchArguments=["--ui-smoke"];app.launch()
        XCTAssertTrue(app.buttons["originPicker"].waitForExistence(timeout:5))
        for _ in 0..<4 where !app.buttons["searchButton"].isHittable { app.swipeUp() }
        app.buttons["searchButton"].tap()
        let card=app.buttons["offer.LED"]
        // SwiftUI NavigationLink can expose either link or button depending on SDK.
        let destination=app.descendants(matching:.any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "offer.LED.")).firstMatch
        XCTAssertTrue(destination.waitForExistence(timeout:5));destination.tap()
        XCTAssertTrue(app.descendants(matching: .any)["rating.compact"].waitForExistence(timeout:5))
        for _ in 0..<6 where !app.buttons["aviasalesButton"].isHittable { app.swipeUp() }
        XCTAssertTrue(app.buttons["aviasalesButton"].waitForExistence(timeout:5))
        app.buttons["favorite.LED"].tap()
        app.tabBars.buttons["Избранное"].tap()
        XCTAssertTrue(app.descendants(matching:.any)["saved.LED"].waitForExistence(timeout:5))
        _ = card
    }
    func testAccessibilityTextJourney() {
        let app=XCUIApplication();app.launchArguments=["--ui-smoke","-UIPreferredContentSizeCategoryName","UICTContentSizeCategoryAccessibilityXXXL"];app.launch()
        let search=app.buttons["searchButton"]
        for _ in 0..<4 where !search.isHittable { app.swipeUp() }
        XCTAssertTrue(search.isHittable);search.tap()
        XCTAssertTrue(app.descendants(matching:.any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "offer.LED.")).firstMatch.waitForExistence(timeout:5))
    }
    func testExactDatesFiltersAndFlightDetails() {
        let app = XCUIApplication(); app.launchArguments = ["--ui-smoke"]; app.launch()
        XCTAssertTrue(app.buttons["originPicker"].waitForExistence(timeout: 10))
        for _ in 0..<4 where !app.buttons["Конкретные даты"].isHittable { app.swipeUp() }
        app.buttons["Конкретные даты"].tap()
        XCTAssertTrue(app.datePickers["departureDatePicker"].exists)
        XCTAssertTrue(app.datePickers["returnDatePicker"].exists)
        let search = app.buttons["searchButton"]
        for _ in 0..<4 where !search.isHittable { app.swipeUp() }
        search.tap()
        XCTAssertTrue(app.buttons["allFiltersButton"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["21 вариант"].exists)
        app.buttons["allFiltersButton"].tap()
        XCTAssertTrue(app.textFields["minPriceFilter"].waitForExistence(timeout: 5))
        app.textFields["minPriceFilter"].tap(); app.textFields["minPriceFilter"].typeText("9000")
        app.buttons["Готово"].tap()
        let count = app.staticTexts["20 вариантов"]
        XCTAssertTrue(count.waitForExistence(timeout: 5))
        let card = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "offer.LED.")).firstMatch
        XCTAssertTrue(card.exists); card.tap()
        XCTAssertTrue(app.descendants(matching: .any)["route.outbound"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Выполняет: Aeroflot · DEMO"].firstMatch.exists)
    }

    func testTransferItinerary() {
        let app = XCUIApplication(); app.launchArguments = ["--ui-smoke"]; app.launch()
        XCTAssertTrue(app.buttons["originPicker"].waitForExistence(timeout: 10))
        let budget = app.sliders["Бюджет в рублях"]
        for _ in 0..<4 where !budget.isHittable { app.swipeUp() }
        budget.adjust(toNormalizedSliderPosition: 0.1)
        let search = app.buttons["searchButton"]
        for _ in 0..<4 where !search.isHittable { app.swipeUp() }
        search.tap()
        let card = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "offer.TBS.")).firstMatch
        XCTAssertTrue(app.buttons["allFiltersButton"].waitForExistence(timeout: 5))
        for _ in 0..<12 where !card.exists || !card.isHittable { app.swipeUp() }
        XCTAssertTrue(card.exists)
        card.tap()
        let connection = app.staticTexts["Пересадка: Ереван"]
        for _ in 0..<6 where !connection.firstMatch.isHittable { app.swipeUp() }
        XCTAssertTrue(connection.firstMatch.exists)
        XCTAssertTrue(app.staticTexts["Ожидание 45 мин"].firstMatch.exists)
        XCTAssertTrue(app.staticTexts["Выполняет: S7 Airlines · DEMO"].firstMatch.exists)
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = "Подробная пересадка"; image.lifetime = .keepAlways; add(image)
    }

    func testCollectionsRespectBudget() {
        let app = XCUIApplication(); app.launchArguments = ["--ui-smoke"]; app.launch()
        XCTAssertTrue(app.buttons["originPicker"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Куда поехать"].tap(); app.buttons["Подборки"].tap()
        let collection = app.buttons["collection.budget20"]
        XCTAssertTrue(collection.waitForExistence(timeout: 5))
        for _ in 0..<4 where !collection.isHittable { app.swipeUp() }
        collection.tap()
        let offer = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "collection.offer.LED.")).firstMatch
        XCTAssertTrue(offer.waitForExistence(timeout: 5))
        for _ in 0..<8 where !offer.isHittable { app.swipeUp() }
        XCTAssertTrue(app.staticTexts["Билеты туда-обратно · без проживания"].firstMatch.exists)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Подборка до 20 тысяч"; shot.lifetime = .keepAlways; add(shot)
        offer.tap()
        XCTAssertTrue(app.buttons["nearbyDatesButton"].waitForExistence(timeout: 5))
    }

    func testCompareTwoTrips() {
        let app = XCUIApplication(); app.launchArguments = ["--ui-smoke"]; app.launch()
        XCTAssertTrue(app.buttons["searchButton"].waitForExistence(timeout: 10))
        app.buttons["searchButton"].tap()
        let first = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "compare.MOCK-SVO-LED-")).firstMatch
        XCTAssertTrue(first.waitForExistence(timeout: 5))
        for _ in 0..<6 where !first.isHittable { app.swipeUp() }
        first.tap()
        let second = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "compare.MOCK-SVO-KZN-")).firstMatch
        for _ in 0..<8 where !second.exists || !second.isHittable { app.swipeUp() }
        XCTAssertTrue(second.exists); second.tap()
        app.tabBars.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Сравнение")).firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Санкт-Петербург"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Дорога туда и обратно"].firstMatch.exists)
        XCTAssertTrue(app.staticTexts["Пересадки туда / обратно"].firstMatch.exists)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Сравнение поездок"; shot.lifetime = .keepAlways; add(shot)
    }

    func testFavoriteRefreshAndNearbyDates() {
        let app = XCUIApplication(); app.launchArguments = ["--ui-smoke"]; app.launch()
        XCTAssertTrue(app.buttons["searchButton"].waitForExistence(timeout: 10))
        app.buttons["searchButton"].tap()
        let card = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "offer.LED.")).firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 5)); card.tap()
        app.buttons["favorite.LED"].tap()
        app.tabBars.buttons["Избранное"].tap()
        XCTAssertTrue(app.buttons["favorites.refresh"].waitForExistence(timeout: 5)); app.buttons["favorites.refresh"].tap()
        XCTAssertTrue(app.staticTexts["favorites.refreshSummary"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Цена как при сохранении"].exists)
        app.descendants(matching: .any)["saved.LED"].tap()
        let nearby = app.buttons["nearbyDatesButton"]
        for _ in 0..<6 where !nearby.isHittable { app.swipeUp() }
        nearby.tap()
        let original = app.descendants(matching: .any)["nearby.offer.0"]
        XCTAssertTrue(original.waitForExistence(timeout: 5))
        for _ in 0..<8 where !original.isHittable { app.swipeUp() }
        XCTAssertTrue(app.staticTexts["Как в исходном снимке"].firstMatch.exists)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Соседние даты"; shot.lifetime = .keepAlways; add(shot)
    }

    func testRegionalSearchAndPriceSort() {
        let app = XCUIApplication(); app.launchArguments = ["--ui-smoke"]; app.launch()
        let region = app.buttons["regionPicker"]
        XCTAssertTrue(region.waitForExistence(timeout: 10)); region.tap()
        app.buttons["Поездка в США"].tap()
        app.buttons["destinationPicker"].tap()
        let field = app.searchFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5)); field.tap(); field.typeText("JFK")
        XCTAssertTrue(app.buttons["airport.JFK"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["airport.CDG"].exists)
        app.buttons["airport.JFK"].tap()
        let budget = app.sliders["Бюджет в рублях"]
        for _ in 0..<4 where !budget.isHittable { app.swipeUp() }
        budget.adjust(toNormalizedSliderPosition: 0.3)
        let search = app.buttons["searchButton"]
        for _ in 0..<4 where !search.isHittable { app.swipeUp() }
        search.tap()
        XCTAssertTrue(app.staticTexts["3 варианта"].waitForExistence(timeout: 10))
        let price = app.segmentedControls["priceSort"]
        XCTAssertTrue(price.exists); price.buttons["Сначала дороже"].tap()
        XCTAssertTrue(price.buttons["Сначала дороже"].isSelected)
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = "США и сортировка по цене"; screenshot.lifetime = .keepAlways; add(screenshot)
    }

    func testCityAndDestinationCatalogSearch() {
        let app = XCUIApplication(); app.launchArguments = ["--ui-smoke"]; app.launch()
        XCTAssertTrue(app.buttons["originPicker"].waitForExistence(timeout: 10))
        app.buttons["originPicker"].tap()
        let field = app.searchFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5)); field.tap(); field.typeText("MOW")
        let city = app.buttons["originCity.MOW"]
        XCTAssertTrue(city.waitForExistence(timeout: 5)); city.tap()
        XCTAssertTrue(app.staticTexts["Москва · все аэропорты"].waitForExistence(timeout: 5))
        app.buttons["destinationPicker"].tap()
        XCTAssertTrue(field.waitForExistence(timeout: 5)); field.tap(); field.typeText("LED")
        let airport = app.buttons["airport.LED"]
        XCTAssertTrue(airport.waitForExistence(timeout: 5))
        let pickerImage = XCTAttachment(screenshot: app.screenshot()); pickerImage.name = "Выбор направления"; pickerImage.lifetime = .keepAlways; add(pickerImage)
        airport.tap()
        let search = app.buttons["searchButton"]
        for _ in 0..<4 where !search.isHittable { app.swipeUp() }
        search.tap()
        XCTAssertTrue(app.staticTexts["3 варианта"].waitForExistence(timeout: 5))
        let resultsImage = XCTAttachment(screenshot: app.screenshot()); resultsImage.name = "Варианты поездок"; resultsImage.lifetime = .keepAlways; add(resultsImage)
    }

}
