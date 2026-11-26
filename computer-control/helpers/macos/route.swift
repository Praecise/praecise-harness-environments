// What the app does when it carries its own runtime: it connects this computer to the
// public route with the person's account, and keeps what the person allows on it (which
// apps, which folders, the camera, the microphone) and each one's mode. Without the
// runtime inside it, none of this is offered and the app is the helper it always was.
//
// The runtime is Node and the same files a person would otherwise run by hand. This
// starts them, tells them what was chosen, and reads what they say.

import AppKit

final class Route: @unchecked Sendable {
  static let shared = Route()

  private let lock = NSLock()
  private let work = DispatchQueue(label: "route")
  private var child: Process?
  private var said = ""
  private var listed: [(alias: String, kind: String, mode: String)] = []

  private let node = Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers/node")
  private let control = Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/control")
  private let edition = Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/edition.json")
  private let folder = SUPPORT.appendingPathComponent("app")
  private let kept = SUPPORT.appendingPathComponent("settings.json")

  /// Whether the app carries its runtime.
  var available: Bool { FileManager.default.isExecutableFile(atPath: node.path) }

  // What the person chose.

  private func settings() -> [String: Any] {
    guard let data = try? Data(contentsOf: kept), let all = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
    return all
  }
  func chosen(_ key: String) -> [String] { settings()[key] as? [String] ?? [] }
  func on(_ key: String) -> Bool { settings()[key] as? Bool ?? false }

  private func keep(_ key: String, _ value: Any) {
    var all = settings()
    all[key] = value
    try? FileManager.default.createDirectory(at: SUPPORT, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    if let data = try? JSONSerialization.data(withJSONObject: all, options: [.prettyPrinted, .sortedKeys]) { try? data.write(to: kept, options: .atomic) }
  }

  /// Adds or removes one thing of a kind, and tells the runtime.
  func toggle(_ key: String, _ value: String) {
    var all = chosen(key)
    if let at = all.firstIndex(of: value) { all.remove(at: at) } else { all.append(value) }
    keep(key, all)
    apply()
  }
  func flip(_ key: String) {
    keep(key, !on(key))
    apply()
  }

  // What the edition says of itself.

  private func wording(_ key: String) -> String? {
    guard let data = try? Data(contentsOf: edition), let all = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
    return (all["wording"] as? [String: Any])?[key] as? String
  }

  // What is shown.

  var wanted: Bool { on("connect") }
  var status: String {
    let heard = lock.withLock { said }
    if !wanted { return wording("firstRun") ?? "This computer is not connected" }
    return heard.isEmpty ? "Connecting…" : heard
  }
  var accounts: [(alias: String, kind: String, mode: String)] { lock.withLock { listed } }

  // The runtime.

  private func quoted(_ text: String) -> String {
    // A string as JavaScript writes one.
    let data = (try? JSONSerialization.data(withJSONObject: [text])) ?? Data("[\"\"]".utf8)
    return String(String(decoding: data, as: UTF8.self).dropFirst().dropLast())
  }

  /// The app the runtime serves: a config that names what was chosen, written afresh each time it changes.
  private func write() {
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    var options: [String: Any] = ["apps": chosen("apps"), "helper": [Bundle.main.executablePath ?? "", "connect"]]
    if !chosen("folders").isEmpty { options["folders"] = chosen("folders") }
    if !chosen("coding").isEmpty { options["coding"] = ["folders": chosen("coding")] }
    if on("camera") { options["camera"] = true }
    if on("microphone") { options["microphone"] = true }
    let json = (try? JSONSerialization.data(withJSONObject: options, options: [.prettyPrinted, .sortedKeys])).map { String(decoding: $0, as: UTF8.self) } ?? "{ apps: [] }"
    let config = """
      // Written by \(NAME). What is allowed here is chosen in its menu.
      import { defineConfig } from \(quoted(control.appendingPathComponent("node_modules/@praecise/harness/dist/index.js").path));
      import { computerControl } from \(quoted(control.appendingPathComponent("index.ts").path));

      const options = \(json);

      export default defineConfig({ name: "control", plugins: [computerControl(options)] });

      """
    try? config.write(to: folder.appendingPathComponent("praecise.config.ts"), atomically: true, encoding: .utf8)
  }

  /// Runs one of the runtime's commands to its end, and returns what it printed.
  private func run(_ arguments: [String]) -> String {
    let process = Process()
    process.executableURL = node
    process.arguments = arguments
    process.currentDirectoryURL = folder
    var around = ProcessInfo.processInfo.environment
    around["PATH"] = "/opt/homebrew/bin:/usr/local/bin:" + (around["PATH"] ?? "/usr/bin:/bin")
    process.environment = around
    let out = Pipe()
    process.standardOutput = out
    process.standardError = out
    process.standardInput = FileHandle.nullDevice
    do { try process.run() } catch { return "" }
    let data = out.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    return String(decoding: data, as: UTF8.self)
  }

  private var command: String { control.appendingPathComponent("node_modules/@praecise/harness/dist/cli/bin.js").path }

  /// Finds this machine and lists what was chosen, each in the mode it has.
  private func refresh() {
    write()
    _ = run([command, "computer-control", "connect"])
    _ = run([command, "computer-control", "sync"])
    let printed = run([command, "computer-control", "accounts"])
    var found: [(alias: String, kind: String, mode: String)] = []
    for line in printed.split(separator: "\n") {
      let parts = line.split(separator: " ", omittingEmptySubsequences: true).map(String.init)
      if parts.count >= 3, ["read", "draft", "act"].contains(parts[2]) { found.append((parts[0], parts[1], parts[2])) }
    }
    lock.withLock { listed = found }
  }

  /// After a choice changes: the runtime is told, and started again if this computer is connected.
  func apply() {
    work.async {
      let running = self.lock.withLock { self.child }
      running?.terminate()
      running?.waitUntilExit()
      self.refresh()
      if self.wanted { self.start() }
    }
  }

  func mode(_ alias: String, _ mode: String) {
    work.async {
      _ = self.run([self.command, "computer-control", "mode", alias, mode])
      self.refresh()
    }
  }

  private func start() {
    if lock.withLock({ child?.isRunning == true }) { return }
    let process = Process()
    process.executableURL = node
    process.arguments = [control.appendingPathComponent("mcp.mjs").path, folder.path, "--cloud", "--first-run", "--edition", edition.path]
    process.currentDirectoryURL = folder
    var around = ProcessInfo.processInfo.environment
    around["PATH"] = "/opt/homebrew/bin:/usr/local/bin:" + (around["PATH"] ?? "/usr/bin:/bin")
    process.environment = around
    let heard = Pipe()
    process.standardError = heard
    process.standardOutput = FileHandle.nullDevice
    process.standardInput = FileHandle.nullDevice
    heard.fileHandleForReading.readabilityHandler = { [weak self] handle in
      let text = String(decoding: handle.availableData, as: UTF8.self)
      guard let self, !text.isEmpty else { return }
      self.log(text)
      // What it says, in the words a person reads in the menu.
      var now: String?
      if text.contains("sign in to") { now = "Waiting for you to sign in, in your browser" }
      if text.contains("is reachable") { now = self.wording("connected") ?? "This computer is connected" }
      if text.contains("refused this computer") { now = "The connection was refused" }
      if text.contains("could not connect") { now = "Could not connect; trying again" }
      if let now { self.lock.withLock { self.said = now } }
    }
    process.terminationHandler = { [weak self] _ in
      heard.fileHandleForReading.readabilityHandler = nil
      self?.lock.withLock { self?.said = "" }
    }
    lock.withLock { said = "" }
    do {
      try process.run()
      lock.withLock { child = process }
    } catch {
      lock.withLock { said = "The runtime could not be started" }
    }
  }

  /// What the runtime said, kept so that a fault can be read afterwards. The address a person signs in at is left out.
  private func log(_ text: String) {
    let file = SUPPORT.appendingPathComponent("runtime.log")
    let lines = text.split(separator: "\n").filter { !$0.contains("sign in to") }.joined(separator: "\n")
    guard !lines.isEmpty, let data = (lines + "\n").data(using: .utf8) else { return }
    if let size = (try? FileManager.default.attributesOfItem(atPath: file.path))?[.size] as? Int, size > 200_000 { try? FileManager.default.removeItem(at: file) }
    if let handle = try? FileHandle(forWritingTo: file) {
      handle.seekToEndOfFile()
      handle.write(data)
      try? handle.close()
    } else { try? data.write(to: file) }
  }

  /// Connects this computer, or disconnects it.
  func connect(_ yes: Bool) {
    keep("connect", yes)
    work.async {
      if yes {
        self.refresh()
        self.start()
      } else {
        let running = self.lock.withLock { self.child }
        running?.terminate()
      }
    }
  }

  /// When the app opens: what was connected is connected again.
  func resume() {
    guard available else { return }
    work.async {
      self.refresh()
      if self.wanted { self.start() }
    }
  }

  /// When the app quits, the runtime goes with it.
  func end() {
    lock.withLock { child }?.terminate()
  }
}
