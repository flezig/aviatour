// swift-tools-version: 5.9
import PackageDescription
// Portable macOS behavior checks. The iPhone product remains Aviator.xcodeproj.
let package = Package(name: "Aviator", platforms: [.macOS(.v14)], products: [.library(name:"Aviator",targets:["Aviator"])], targets: [
    .target(name:"Aviator",path:"Aviator",exclude:["App","Views","Components","Config","Resources/Assets.xcassets","Resources/credits.md","Persistence/FavoritesStore.swift"],resources:[.copy("Resources/airports.json")]),
    .executableTarget(name:"AviatorChecks",dependencies:["Aviator"],path:"scripts/SwiftChecks"),
    .testTarget(name:"AviatorTests",dependencies:["Aviator"],path:"AviatorTests")
])
