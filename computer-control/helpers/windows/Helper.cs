// The computer control helper for Windows. PROTOCOL.md says what it answers.
//
// Elements are read through UI Automation. An element is pressed through its own
// pattern (invoke, toggle, select, expand) and a field is filled through its value
// pattern, which moves no pointer and brings nothing to the front. A window is pictured
// with PrintWindow, which works while it is behind another.
//
// A pointer and keys by position are posted as messages to the window under the
// position and to nothing else. An app that does not take its input from messages is
// not reached another way, and a chord is refused: keys held down belong to the one
// keyboard the session has.
//
// It is built with the compiler that is part of Windows and needs nothing installed.
//
// It is built twice from this one file. As Praecise Control, an app in the taskbar's
// corner: it runs in the session of whoever is signed in, answers on a pipe only that
// person's programs can open, says what an agent is using, and can be paused. As the
// helper, a program with no window: with `connect` it passes its input to that app and
// the app's answers back, which is how a harness reaches it from a service or over SSH;
// with nothing, it answers on its own input and output where it stands.

using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;

class Failure : Exception {
  public Failure(string message) : base(message) { }
}

class Known {
  public AutomationElement Element;
  public string App;
  public string Role;
  public string Name;
}

class Target {
  public string Id;
  public IntPtr Window;
  public AutomationElement Element;
  public Native.RECT Rect;
  public double Scale;
  public int Width { get { return (int)Math.Round((Rect.Right - Rect.Left) * Scale); } }
  public int Height { get { return (int)Math.Round((Rect.Bottom - Rect.Top) * Scale); } }
}

static class Native {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct GUITHREADINFO {
    public int cbSize; public int flags; public IntPtr hwndActive, hwndFocus, hwndCapture, hwndMenuOwner, hwndMoveSize, hwndCaret; public RECT rcCaret;
  }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out RECT rect);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int how);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr window, ref POINT point);
  [DllImport("user32.dll")] public static extern IntPtr ChildWindowFromPointEx(IntPtr parent, POINT point, uint flags);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll")] public static extern bool GetGUIThreadInfo(uint thread, ref GUITHREADINFO info);
}

/// This program's own input or output.
///
/// What starts a program decides what kind of handle these are, and an SSH server hands
/// over a kind that an ordinary read waits on for ever. Read and written this way, either
/// kind works.
sealed class Std : Stream {
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr GetStdHandle(int which);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool ReadFile(IntPtr handle, IntPtr buffer, int count, out int done, ref NativeOverlapped pending);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool WriteFile(IntPtr handle, IntPtr buffer, int count, out int done, ref NativeOverlapped pending);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetOverlappedResult(IntPtr handle, ref NativeOverlapped pending, out int done, bool wait);

  readonly IntPtr handle;
  readonly bool input;

  public Std(bool input) {
    this.input = input;
    handle = GetStdHandle(input ? -10 : -11);
  }

  delegate bool Transfer(IntPtr handle, IntPtr buffer, int count, out int done, ref NativeOverlapped pending);

  /// One read or write, waited for whether or not the handle answers at once. Nothing done is the end.
  int Once(Transfer transfer, byte[] buffer, int offset, int count) {
    var held = GCHandle.Alloc(buffer, GCHandleType.Pinned);
    try {
      using (var finished = new ManualResetEvent(false)) {
        var pending = new NativeOverlapped { EventHandle = finished.SafeWaitHandle.DangerousGetHandle() };
        int done;
        if (transfer(handle, IntPtr.Add(held.AddrOfPinnedObject(), offset), count, out done, ref pending)) return done;
        if (Marshal.GetLastWin32Error() != 997) return 0;
        return GetOverlappedResult(handle, ref pending, out done, true) ? done : 0;
      }
    } finally {
      held.Free();
    }
  }

  public override int Read(byte[] buffer, int offset, int count) { return Once(ReadFile, buffer, offset, count); }
  public override void Write(byte[] buffer, int offset, int count) {
    while (count > 0) {
      var wrote = Once(WriteFile, buffer, offset, count);
      if (wrote <= 0) throw new IOException("the other end has gone");
      offset += wrote;
      count -= wrote;
    }
  }
  public override bool CanRead { get { return input; } }
  public override bool CanWrite { get { return !input; } }
  public override bool CanSeek { get { return false; } }
  public override void Flush() { }
  public override long Length { get { throw new NotSupportedException(); } }
  public override long Position { get { throw new NotSupportedException(); } set { throw new NotSupportedException(); } }
  public override long Seek(long offset, SeekOrigin origin) { throw new NotSupportedException(); }
  public override void SetLength(long value) { throw new NotSupportedException(); }
}

static class Helper {
  static readonly Dictionary<string, Known> Refs = new Dictionary<string, Known>();
  static readonly Dictionary<string, string> Named = new Dictionary<string, string>();
  static readonly Dictionary<string, Native.POINT> Pointer = new Dictionary<string, Native.POINT>();
  static readonly Dictionary<string, IntPtr> Pointed = new Dictionary<string, IntPtr>();
  static int counted = 0;

  /// The longest side a window is shown at. A larger one is scaled, and positions with it.
  const double LONGEST = 1568;
  /// The most elements one reading visits, so a window with an endless table is still answered.
  const int VISITS = 6000;

  static readonly Dictionary<string, string> Roles = new Dictionary<string, string> {
    {"Button", "button"}, {"SplitButton", "button"}, {"Hyperlink", "link"}, {"Edit", "textbox"}, {"ComboBox", "combobox"},
    {"CheckBox", "checkbox"}, {"RadioButton", "radio"}, {"Slider", "slider"}, {"Spinner", "spinbutton"}, {"MenuItem", "menuitem"},
    {"TabItem", "tab"}, {"Tab", "tablist"}, {"Text", "text"}, {"Image", "image"}, {"DataItem", "row"}, {"ListItem", "listitem"},
    {"TreeItem", "treeitem"}, {"Window", "window"}, {"Menu", "menu"}, {"MenuBar", "menubar"}, {"ToolBar", "toolbar"},
    {"List", "list"}, {"Tree", "tree"}, {"Table", "table"}, {"DataGrid", "table"}, {"Header", "rowgroup"},
    {"HeaderItem", "columnheader"}, {"Document", "document"}, {"StatusBar", "status"}, {"ProgressBar", "progressbar"},
    {"Calendar", "grid"}, {"ToolTip", "tooltip"},
  };
  /// Kinds that say only how a window is laid out. Unnamed, they are left out and what is in them is kept.
  static readonly HashSet<string> Layout = new HashSet<string> { "Pane", "Group", "Custom", "TitleBar" };
  /// Kinds that are furniture, and are never listed.
  static readonly HashSet<string> Furniture = new HashSet<string> { "ScrollBar", "Thumb", "Separator", "ToolTip" };
  static readonly HashSet<string> Worked = new HashSet<string> { "button", "link", "textbox", "combobox", "checkbox", "radio", "tab", "slider", "spinbutton", "menuitem" };
  static readonly HashSet<string> Typed = new HashSet<string> { "textbox", "combobox", "spinbutton" };
  static readonly HashSet<string> Stated = new HashSet<string> { "button", "link", "textbox", "combobox", "checkbox", "radio", "tab", "slider", "spinbutton", "menuitem", "row", "treeitem", "listitem" };

  // Reading the arguments

  static string Text(Dictionary<string, object> from, string name) {
    object value;
    return from != null && from.TryGetValue(name, out value) && value != null ? Convert.ToString(value) : null;
  }
  static double? Number(Dictionary<string, object> from, string name) {
    object value;
    if (from == null || !from.TryGetValue(name, out value) || value == null) return null;
    try { return Convert.ToDouble(value); } catch (Exception) { return null; }
  }
  static Dictionary<string, object> Part(Dictionary<string, object> from, string name) {
    object value;
    return from != null && from.TryGetValue(name, out value) ? value as Dictionary<string, object> : null;
  }

  // Apps and windows

  static List<Process> Running(string id) {
    var own = Process.GetCurrentProcess().SessionId;
    var found = new List<Process>();
    foreach (var each in Process.GetProcesses()) {
      try {
        if (each.SessionId != own || each.MainWindowHandle == IntPtr.Zero) continue;
        if (id == null || each.ProcessName.ToLowerInvariant() == id) found.Add(each);
      } catch (Exception) { }
    }
    return found;
  }

  static object Apps() {
    var seen = new SortedDictionary<string, string>();
    foreach (var each in Running(null)) {
      try {
        if (string.IsNullOrEmpty(each.MainWindowTitle)) continue;
        var id = each.ProcessName.ToLowerInvariant();
        var name = each.ProcessName;
        try {
          var said = each.MainModule.FileVersionInfo.FileDescription;
          if (!string.IsNullOrWhiteSpace(said)) name = said.Trim();
        } catch (Exception) { }
        if (!seen.ContainsKey(id)) seen[id] = name;
      } catch (Exception) { }
    }
    var list = new List<object>();
    foreach (var each in seen) list.Add(new Dictionary<string, object> { {"id", each.Key}, {"name", each.Value} });
    return list;
  }

  static void InSession() {
    if (Process.GetCurrentProcess().SessionId == 0) {
      throw new Failure("this helper is not in a signed-in session and cannot see any window; start it in the session of whoever is signed in");
    }
  }

  static Target Find(Dictionary<string, object> asked) {
    InSession();
    var id = (Text(asked, "app") ?? "").ToLowerInvariant();
    if (id == "") throw new Failure("`app` is the app's id, from `apps`");
    var running = Running(id);
    if (running.Count == 0) throw new Failure(id + " is not running, or has no window; open it first");
    var window = running[0].MainWindowHandle;
    if (Native.IsIconic(window)) throw new Failure(id + " is minimised; open it first");
    Native.RECT rect;
    if (!Native.GetWindowRect(window, out rect) || rect.Right - rect.Left < 1 || rect.Bottom - rect.Top < 1) throw new Failure(id + " has no window with a size; open one first");
    var longest = Math.Max(rect.Right - rect.Left, rect.Bottom - rect.Top);
    return new Target { Id = id, Window = window, Element = AutomationElement.FromHandle(window), Rect = rect, Scale = Math.Min(1.0, LONGEST / longest) };
  }

  static object Open(Dictionary<string, object> asked) {
    InSession();
    var id = (Text(asked, "app") ?? "").ToLowerInvariant();
    if (id == "") throw new Failure("`app` is the app's id");
    var running = Running(id);
    if (running.Count > 0) {
      // Shown again without being given the keyboard.
      if (Native.IsIconic(running[0].MainWindowHandle)) Native.ShowWindow(running[0].MainWindowHandle, 4);
      return null;
    }
    try {
      var started = Process.Start(new ProcessStartInfo(id) { UseShellExecute = true });
      if (started != null) started.WaitForInputIdle(15000);
    } catch (Exception err) {
      throw new Failure("the app could not be started: " + err.Message);
    }
    return null;
  }

  static object Window(Dictionary<string, object> asked) {
    var target = Find(asked);
    return new Dictionary<string, object> { {"width", target.Width}, {"height", target.Height}, {"title", target.Element.Current.Name ?? ""} };
  }

  // Elements

  static string Kind(AutomationElement element) {
    var name = element.Current.ControlType.ProgrammaticName ?? "ControlType.Custom";
    return name.StartsWith("ControlType.") ? name.Substring(12) : name;
  }

  static string RoleOf(AutomationElement element, string kind) {
    string said;
    if (kind == "Document") {
      object pattern;
      return element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern) && !((ValuePattern)pattern).Current.IsReadOnly ? "textbox" : "document";
    }
    return Roles.TryGetValue(kind, out said) ? said : kind.ToLowerInvariant();
  }

  static string NameOf(AutomationElement element) {
    return (element.Current.Name ?? "").Trim();
  }

  static string ValueOf(AutomationElement element, string said) {
    object pattern;
    if (Typed.Contains(said) && element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) return ((ValuePattern)pattern).Current.Value;
    if ((said == "slider" || said == "spinbutton" || said == "progressbar") && element.TryGetCurrentPattern(RangeValuePattern.Pattern, out pattern)) {
      return ((RangeValuePattern)pattern).Current.Value.ToString(System.Globalization.CultureInfo.InvariantCulture);
    }
    return null;
  }

  static List<object> StatesOf(AutomationElement element, string said) {
    var states = new List<object>();
    if (!Stated.Contains(said)) return states;
    object pattern;
    if (!element.Current.IsEnabled) states.Add("disabled");
    if (element.Current.HasKeyboardFocus) states.Add("focused");
    if (element.TryGetCurrentPattern(TogglePattern.Pattern, out pattern)) {
      var toggled = ((TogglePattern)pattern).Current.ToggleState;
      if (toggled == ToggleState.On) states.Add(said == "button" ? "pressed" : "checked");
      else if (toggled == ToggleState.Indeterminate) states.Add("partly checked");
    }
    if (element.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out pattern)) {
      var expanded = ((ExpandCollapsePattern)pattern).Current.ExpandCollapseState;
      if (expanded == ExpandCollapseState.Expanded) states.Add("expanded");
      else if (expanded == ExpandCollapseState.Collapsed) states.Add("collapsed");
    }
    if (element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pattern) && ((SelectionItemPattern)pattern).Current.IsSelected) {
      states.Add(said == "radio" ? "checked" : "selected");
    }
    return states;
  }

  static string RefFor(AutomationElement element, string app, string said, string called) {
    // A long session does not keep every element it ever saw: past this, everything is read afresh.
    if (Named.Count > 50000) { Named.Clear(); Refs.Clear(); }
    var runtime = element.GetRuntimeId();
    var key = runtime == null ? Guid.NewGuid().ToString() : string.Join(".", Array.ConvertAll(runtime, part => part.ToString()));
    string reference;
    if (!Named.TryGetValue(key, out reference)) {
      counted++;
      reference = "e" + counted;
      Named[key] = reference;
    }
    Refs[reference] = new Known { Element = element, App = app, Role = said, Name = called };
    return reference;
  }

  static Dictionary<string, object> BoxOf(AutomationElement element, Target target) {
    var box = element.Current.BoundingRectangle;
    if (box.IsEmpty || box.Width < 1 || box.Height < 1) return null;
    return new Dictionary<string, object> {
      {"x", (int)Math.Round((box.X - target.Rect.Left) * target.Scale)}, {"y", (int)Math.Round((box.Y - target.Rect.Top) * target.Scale)},
      {"width", (int)Math.Round(box.Width * target.Scale)}, {"height", (int)Math.Round(box.Height * target.Scale)},
    };
  }

  static Dictionary<string, object> Describe(AutomationElement element, Target target) {
    var said = RoleOf(element, Kind(element));
    var called = NameOf(element);
    var described = new Dictionary<string, object> { {"ref", RefFor(element, target.Id, said, called)}, {"role", said} };
    if (called != "") described["name"] = called;
    var value = ValueOf(element, said);
    if (!string.IsNullOrEmpty(value) && value != called) described["value"] = value.Length > 2000 ? value.Substring(0, 2000) : value;
    var states = StatesOf(element, said);
    if (states.Count > 0) described["states"] = states;
    var box = BoxOf(element, target);
    if (box != null) described["box"] = box;
    return described;
  }

  static AutomationElement Live(string reference, Target target) {
    Known known;
    if (reference == null || !Refs.TryGetValue(reference, out known) || known.App != target.Id) {
      throw new Failure(reference + " is not a reference this window has given; read it again");
    }
    string said, called;
    try {
      said = RoleOf(known.Element, Kind(known.Element));
      called = NameOf(known.Element);
      if (known.Element.Current.IsOffscreen && known.Element.Current.BoundingRectangle.IsEmpty) throw new ElementNotAvailableException();
    } catch (ElementNotAvailableException) {
      throw new Failure(reference + " is no longer in the window; read it again");
    }
    if (said != known.Role || called != known.Name) {
      throw new Failure(reference + " is no longer in the window (it is now " + said + (called == "" ? "" : " \"" + called + "\"") + "); read it again");
    }
    return known.Element;
  }

  static int visits;

  static List<object> Walk(AutomationElement element, int level, string within, Target target, bool interactive, int? depth, List<object> flat) {
    var none = new List<object>();
    visits++;
    if (visits > VISITS) return none;
    string kind, said, called;
    try {
      kind = Kind(element);
      if (Furniture.Contains(kind)) return none;
      if (element.Current.IsOffscreen && level > 1) return none;
      said = RoleOf(element, kind);
      called = NameOf(element);
    } catch (ElementNotAvailableException) {
      return none;
    }
    // A button named for its label holds that label again inside it; once is enough.
    if (said == "text" && within != "" && within.Contains(called)) return none;
    var kept = !(Layout.Contains(kind) && (called == "" || kind == "TitleBar")) && !(said == "text" && called == "");
    if (!kept) return Below(element, level, within, target, interactive, depth, flat);
    var described = Describe(element, target);
    if (interactive) {
      if (Worked.Contains(said)) flat.Add(described);
      Below(element, level + 1, called, target, interactive, depth, flat);
      return none;
    }
    if (depth == null || level < depth.Value) {
      var inside = Below(element, level + 1, said == "window" ? "" : called, target, interactive, depth, flat);
      if (inside.Count > 0) described["children"] = inside;
    }
    return new List<object> { described };
  }

  static List<object> Below(AutomationElement element, int level, string within, Target target, bool interactive, int? depth, List<object> flat) {
    var found = new List<object>();
    AutomationElement child;
    try { child = TreeWalker.ControlViewWalker.GetFirstChild(element); } catch (ElementNotAvailableException) { return found; }
    while (child != null) {
      found.AddRange(Walk(child, level, within, target, interactive, depth, flat));
      try { child = TreeWalker.ControlViewWalker.GetNextSibling(child); } catch (ElementNotAvailableException) { break; }
    }
    return found;
  }

  static object Read(Dictionary<string, object> asked) {
    var target = Find(asked);
    var interactive = Text(asked, "filter") == "interactive";
    var depth = Number(asked, "depth");
    var root = target.Element;
    var from = Text(asked, "ref");
    if (!string.IsNullOrEmpty(from)) root = Live(from, target);
    visits = 0;
    var flat = new List<object>();
    var tree = Walk(root, 1, "", target, interactive, depth == null ? (int?)null : (int)depth.Value, flat);
    return interactive ? flat : tree;
  }

  static object Locate(Dictionary<string, object> asked) {
    var target = Find(asked);
    var reference = Text(asked, "ref");
    var element = Live(reference, target);
    object pattern;
    if (element.TryGetCurrentPattern(ScrollItemPattern.Pattern, out pattern)) {
      try { ((ScrollItemPattern)pattern).ScrollIntoView(); } catch (InvalidOperationException) { }
    }
    var described = Describe(element, target);
    if (!described.ContainsKey("box")) throw new Failure(reference + " takes up no room in the window; read it again");
    return described;
  }

  static object Activate(Dictionary<string, object> asked) {
    var target = Find(asked);
    var reference = Text(asked, "ref");
    var element = Live(reference, target);
    if (!element.Current.IsEnabled) throw new Failure(reference + " is disabled");
    object pattern;
    try {
      if (element.TryGetCurrentPattern(InvokePattern.Pattern, out pattern)) { ((InvokePattern)pattern).Invoke(); return null; }
      if (element.TryGetCurrentPattern(TogglePattern.Pattern, out pattern)) { ((TogglePattern)pattern).Toggle(); return null; }
      if (element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pattern)) { ((SelectionItemPattern)pattern).Select(); return null; }
      if (element.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out pattern)) {
        var folding = (ExpandCollapsePattern)pattern;
        if (folding.Current.ExpandCollapseState == ExpandCollapseState.Expanded) folding.Collapse(); else folding.Expand();
        return null;
      }
    } catch (InvalidOperationException err) {
      throw new Failure(reference + " could not be pressed: " + err.Message);
    }
    throw new Failure(reference + " cannot be pressed without the pointer; click where it is");
  }

  static object Fill(Dictionary<string, object> asked) {
    var target = Find(asked);
    var reference = Text(asked, "ref");
    object given;
    if (!asked.TryGetValue("value", out given) || !(given is string)) throw new Failure("`value` is what the field should hold");
    var element = Live(reference, target);
    var said = RoleOf(element, Kind(element));
    if (!Typed.Contains(said)) throw new Failure(reference + " is a " + said + ", which is not typed into; press it and choose");
    if (!element.Current.IsEnabled) throw new Failure(reference + " is disabled");
    object pattern;
    if (!element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern) || ((ValuePattern)pattern).Current.IsReadOnly) {
      throw new Failure(reference + " does not take a value directly; click it and type");
    }
    try { ((ValuePattern)pattern).SetValue((string)given); } catch (Exception err) { throw new Failure(reference + " refused the value: " + err.Message); }
    return null;
  }

  // Pictures

  static object Screenshot(Dictionary<string, object> asked) {
    var target = Find(asked);
    var width = target.Rect.Right - target.Rect.Left;
    var height = target.Rect.Bottom - target.Rect.Top;
    using (var whole = new Bitmap(width, height, PixelFormat.Format32bppArgb)) {
      using (var graphics = Graphics.FromImage(whole)) {
        var dc = graphics.GetHdc();
        // The whole window as it draws itself, which it does behind another window too.
        var drawn = Native.PrintWindow(target.Window, dc, 2);
        graphics.ReleaseHdc(dc);
        if (!drawn) throw new Failure("the window could not be pictured");
      }
      var region = Part(asked, "region");
      var source = new Rectangle(0, 0, width, height);
      var outWidth = target.Width;
      var outHeight = target.Height;
      if (region != null) {
        var x = Number(region, "x") ?? 0; var y = Number(region, "y") ?? 0;
        var w = Number(region, "width") ?? 0; var h = Number(region, "height") ?? 0;
        if (w < 1 || h < 1 || x < 0 || y < 0 || x >= target.Width || y >= target.Height) throw new Failure("that region has no area in the window");
        w = Math.Min(w, target.Width - x); h = Math.Min(h, target.Height - y);
        source = new Rectangle((int)(x / target.Scale), (int)(y / target.Scale), Math.Max(1, (int)(w / target.Scale)), Math.Max(1, (int)(h / target.Scale)));
        // Enlarged to fill the window's own size, and no further than is still a picture of something.
        var zoom = Math.Max(1.0, Math.Min(4.0, Math.Min(target.Width / w, target.Height / h)));
        outWidth = (int)(w * zoom); outHeight = (int)(h * zoom);
      }
      using (var shown = new Bitmap(outWidth, outHeight, PixelFormat.Format24bppRgb))
      using (var graphics = Graphics.FromImage(shown))
      using (var written = new MemoryStream()) {
        graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
        graphics.DrawImage(whole, new Rectangle(0, 0, outWidth, outHeight), source, GraphicsUnit.Pixel);
        shown.Save(written, ImageFormat.Png);
        return new Dictionary<string, object> { {"mime", "image/png"}, {"data", Convert.ToBase64String(written.ToArray())}, {"name", region == null ? "screenshot.png" : "zoom.png"} };
      }
    }
  }

  // Pointer and keys, as messages to the window under the position

  const uint WM_MOUSEMOVE = 0x200, WM_KEYDOWN = 0x100, WM_KEYUP = 0x101, WM_CHAR = 0x102, WM_MOUSEWHEEL = 0x20A, WM_MOUSEHWHEEL = 0x20E;

  static IntPtr Pack(int low, int high) { return new IntPtr((int)(((uint)(high & 0xFFFF) << 16) | (uint)(low & 0xFFFF))); }

  /// The innermost window under a position of the app's window, and the position in that window's own terms.
  static IntPtr Under(Target target, Dictionary<string, object> place, out Native.POINT inside, out Native.POINT onScreen) {
    var x = Number(place, "x"); var y = Number(place, "y");
    if (place == null || x == null || y == null) throw new Failure("a position is { x, y } in pixels of the window");
    if (x < 0 || y < 0 || x >= target.Width || y >= target.Height) throw new Failure("[" + (int)x + ", " + (int)y + "] is outside the window");
    Pointer[target.Id] = new Native.POINT { X = (int)x.Value, Y = (int)y.Value };
    onScreen = new Native.POINT { X = target.Rect.Left + (int)(x.Value / target.Scale), Y = target.Rect.Top + (int)(y.Value / target.Scale) };
    var window = target.Window;
    while (true) {
      inside = onScreen;
      Native.ScreenToClient(window, ref inside);
      // Not the hidden, the disabled or the see-through ones.
      var child = Native.ChildWindowFromPointEx(window, inside, 0x0001 | 0x0002 | 0x0004);
      if (child == IntPtr.Zero || child == window) break;
      window = child;
    }
    inside = onScreen;
    Native.ScreenToClient(window, ref inside);
    Pointed[target.Id] = window;
    return window;
  }

  static int Held(Dictionary<string, object> asked) {
    var bits = 0;
    object given;
    if (!asked.TryGetValue("modifiers", out given) || !(given is IEnumerable) || given is string) return 0;
    foreach (var each in (IEnumerable)given) {
      var name = Convert.ToString(each).ToLowerInvariant();
      if (name == "shift") bits |= 0x0004;
      else if (name == "ctrl" || name == "control") bits |= 0x0008;
      else throw new Failure("\"" + name + "\" cannot be held for one window without the keyboard of whoever is at this machine; only shift and ctrl can");
    }
    return bits;
  }

  static object Click(Dictionary<string, object> asked) {
    var target = Find(asked);
    Native.POINT inside, onScreen;
    var window = Under(target, Part(asked, "at"), out inside, out onScreen);
    var held = Held(asked);
    var which = Text(asked, "button") ?? "left";
    var count = Math.Max(1, Math.Min(3, (int)(Number(asked, "count") ?? 1)));
    uint down = which == "right" ? 0x204u : which == "middle" ? 0x207u : 0x201u;
    var bit = which == "right" ? 0x0002 : which == "middle" ? 0x0010 : 0x0001;
    var at = Pack(inside.X, inside.Y);
    Native.PostMessage(window, WM_MOUSEMOVE, new IntPtr(held), at);
    for (var nth = 1; nth <= count; nth++) {
      // The second press of a pair is the message for a double click.
      Native.PostMessage(window, nth % 2 == 0 ? down + 2 : down, new IntPtr(held | bit), at);
      Native.PostMessage(window, down + 1, new IntPtr(held), at);
    }
    return null;
  }

  static object Move(Dictionary<string, object> asked) {
    var target = Find(asked);
    Native.POINT inside, onScreen;
    var window = Under(target, Part(asked, "to"), out inside, out onScreen);
    Native.PostMessage(window, WM_MOUSEMOVE, IntPtr.Zero, Pack(inside.X, inside.Y));
    return null;
  }

  static object Drag(Dictionary<string, object> asked) {
    var target = Find(asked);
    Native.POINT from, to, onScreen;
    var held = Held(asked);
    var window = Under(target, Part(asked, "from"), out from, out onScreen);
    Native.PostMessage(window, 0x201, new IntPtr(held | 1), Pack(from.X, from.Y));
    Under(target, Part(asked, "to"), out to, out onScreen);
    to = onScreen;
    Native.ScreenToClient(window, ref to);
    // By way of the middle: an app that starts a drag on movement needs to see some.
    Native.PostMessage(window, WM_MOUSEMOVE, new IntPtr(held | 1), Pack((from.X + to.X) / 2, (from.Y + to.Y) / 2));
    Native.PostMessage(window, WM_MOUSEMOVE, new IntPtr(held | 1), Pack(to.X, to.Y));
    Native.PostMessage(window, 0x202, new IntPtr(held), Pack(to.X, to.Y));
    return null;
  }

  static object Scroll(Dictionary<string, object> asked) {
    var target = Find(asked);
    Native.POINT inside, onScreen;
    var window = Under(target, Part(asked, "at"), out inside, out onScreen);
    var held = Held(asked);
    var by = Part(asked, "by");
    var dx = (int)(Number(by, "dx") ?? 0); var dy = (int)(Number(by, "dy") ?? 0);
    var at = Pack(onScreen.X, onScreen.Y);
    if (dy != 0) Native.PostMessage(window, WM_MOUSEWHEEL, Pack(held, -dy * 120), at);
    if (dx != 0) Native.PostMessage(window, WM_MOUSEHWHEEL, Pack(held, dx * 120), at);
    return null;
  }

  /// Where typing goes: what has the focus in the app's window, or what was last pointed at.
  static IntPtr Focused(Target target) {
    uint process;
    var thread = Native.GetWindowThreadProcessId(target.Window, out process);
    var info = new Native.GUITHREADINFO();
    info.cbSize = Marshal.SizeOf(typeof(Native.GUITHREADINFO));
    if (Native.GetGUIThreadInfo(thread, ref info) && info.hwndFocus != IntPtr.Zero) return info.hwndFocus;
    IntPtr pointed;
    return Pointed.TryGetValue(target.Id, out pointed) ? pointed : target.Window;
  }

  static readonly Dictionary<string, int> Keys = new Dictionary<string, int> {
    {"return", 0x0D}, {"enter", 0x0D}, {"kp_enter", 0x0D}, {"tab", 0x09}, {"escape", 0x1B}, {"esc", 0x1B}, {"backspace", 0x08},
    {"delete", 0x2E}, {"insert", 0x2D}, {"space", 0x20}, {"home", 0x24}, {"end", 0x23}, {"pageup", 0x21}, {"page_up", 0x21},
    {"prior", 0x21}, {"pagedown", 0x22}, {"page_down", 0x22}, {"next", 0x22}, {"left", 0x25}, {"arrowleft", 0x25},
    {"up", 0x26}, {"arrowup", 0x26}, {"right", 0x27}, {"arrowright", 0x27}, {"down", 0x28}, {"arrowdown", 0x28},
  };

  static void Characters(IntPtr window, string text) {
    foreach (var unit in text) Native.PostMessage(window, WM_CHAR, new IntPtr(unit), new IntPtr(1));
  }

  static void Stroke(IntPtr window, int code) {
    Native.PostMessage(window, WM_KEYDOWN, new IntPtr(code), new IntPtr(1));
    Native.PostMessage(window, WM_KEYUP, new IntPtr(code), new IntPtr(unchecked((int)0xC0000001)));
  }

  static object Type(Dictionary<string, object> asked) {
    var target = Find(asked);
    var text = Text(asked, "text");
    if (text == null) throw new Failure("`text` is what to type");
    var window = Focused(target);
    var lines = text.Replace("\r\n", "\n").Replace("\r", "\n").Split('\n');
    for (var nth = 0; nth < lines.Length; nth++) {
      if (nth > 0) Stroke(window, 0x0D);
      if (lines[nth] != "") Characters(window, lines[nth]);
    }
    return null;
  }

  static object Key(Dictionary<string, object> asked) {
    var target = Find(asked);
    var combo = (Text(asked, "combo") ?? "").Trim();
    if (combo == "") throw new Failure("`combo` is the key to press");
    var parts = new List<string>(combo.Split(new[] { '+' }, StringSplitOptions.RemoveEmptyEntries));
    if (combo.EndsWith("+")) parts.Add("+");
    var last = parts[parts.Count - 1].Trim();
    parts.RemoveAt(parts.Count - 1);
    var shifted = false;
    foreach (var each in parts) {
      if (each.Trim().ToLowerInvariant() == "shift") shifted = true;
      else throw new Failure("\"" + combo + "\" holds a key down, which cannot be done for one window without the keyboard of whoever is at this machine");
    }
    var window = Focused(target);
    int code;
    var lower = last.ToLowerInvariant();
    int function;
    if (Keys.TryGetValue(lower, out code)) {
      if (shifted) throw new Failure("\"" + combo + "\" holds shift down, which cannot be done for one window without the keyboard of whoever is at this machine");
      Stroke(window, code);
    }
    else if (lower.Length > 1 && lower[0] == 'f' && int.TryParse(lower.Substring(1), out function) && function >= 1 && function <= 24) Stroke(window, 0x6F + function);
    else if (last.Length == 1) Characters(window, shifted ? last.ToUpperInvariant() : last);
    else throw new Failure("\"" + last + "\" in \"" + combo + "\" is not a key this helper knows");
    return null;
  }

  static object Cursor(Dictionary<string, object> asked) {
    Native.POINT at;
    if (!Pointer.TryGetValue((Text(asked, "app") ?? "").ToLowerInvariant(), out at)) at = new Native.POINT();
    return new Dictionary<string, object> { {"x", at.X}, {"y", at.Y} };
  }

  static object Hello() {
    var signedIn = Process.GetCurrentProcess().SessionId != 0;
    return new Dictionary<string, object> {
      {"system", "windows"}, {"user", Environment.UserName}, {"host", Environment.MachineName},
      {"can", new List<object> { "activate", "fill" }},
      {"needs", new List<object> { new Dictionary<string, object> {
        {"name", "Signed-in session"}, {"ok", signedIn}, {"fix", "Start the helper in the session of whoever is signed in. One started by a service or over SSH can see no window."},
      } }},
    };
  }

  static object Answer(string method, Dictionary<string, object> asked) {
    switch (method) {
      case "hello": return Hello();
      case "apps": return Apps();
      case "open": return Open(asked);
      case "window": return Window(asked);
      case "screenshot": return Screenshot(asked);
      case "read": return Read(asked);
      case "locate": return Locate(asked);
      case "activate": return Activate(asked);
      case "fill": return Fill(asked);
      case "click": return Click(asked);
      case "move": return Move(asked);
      case "drag": return Drag(asked);
      case "scroll": return Scroll(asked);
      case "type": return Type(asked);
      case "key": return Key(asked);
      case "cursor": return Cursor(asked);
      default: throw new Failure("this helper cannot " + method);
    }
  }

  // Answering

  /// Set from the menu. While it is, nothing but `hello` is answered.
  public static volatile bool Paused = false;
  /// The app an agent last asked about, and when, for the menu.
  public static string LastApp = "";
  public static DateTime LastAsked = DateTime.MinValue;
  static readonly object Turn = new object();
  static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue, RecursionLimit = 256 };

  /// One line in, one line out, one at a time: a helper's references and pointer are one set, whoever is asking.
  public static string Handle(string line) {
    lock (Turn) {
      Dictionary<string, object> asked;
      object id;
      try {
        asked = Json.Deserialize<Dictionary<string, object>>(line);
        if (asked == null || !asked.TryGetValue("id", out id)) return null;
      } catch (Exception) {
        return null;
      }
      var answer = new Dictionary<string, object> { {"id", id} };
      try {
        var method = Text(asked, "method") ?? "";
        var given = Part(asked, "params") ?? new Dictionary<string, object>();
        if (Paused && method != "hello") throw new Failure("Praecise Control is paused by the person at this machine");
        var app = Text(given, "app");
        if (!string.IsNullOrEmpty(app)) { LastApp = app; LastAsked = DateTime.Now; }
        answer["result"] = Answer(method, given);
      } catch (Failure failure) {
        answer["error"] = failure.Message;
      } catch (ElementNotAvailableException) {
        answer["error"] = "what was asked about is no longer in the window; read it again";
      } catch (Exception err) {
        answer["error"] = err.GetType().Name + ": " + err.Message;
      }
      return Json.Serialize(answer);
    }
  }

  static void Lines(Stream from, Stream to) {
    var input = new StreamReader(from, new UTF8Encoding(false));
    var output = new StreamWriter(to, new UTF8Encoding(false)) { AutoFlush = true, NewLine = "\n" };
    string line;
    while ((line = input.ReadLine()) != null) {
      var answered = Handle(line);
      if (answered != null) output.WriteLine(answered);
    }
  }

  /// The pipe is this person's: its name carries theirs, and only their programs can open it.
  public static string Pipe { get { return "praecise-control-" + Environment.UserName.ToLowerInvariant(); } }

  public static void Serve() {
    var listening = new Thread(() => {
      while (true) {
        var pipe = new NamedPipeServerStream(Pipe, PipeDirection.InOut, NamedPipeServerStream.MaxAllowedServerInstances, PipeTransmissionMode.Byte, PipeOptions.None);
        pipe.WaitForConnection();
        var joined = pipe;
        var each = new Thread(() => {
          try { Lines(joined, joined); } catch (IOException) { } finally { joined.Dispose(); }
        });
        each.IsBackground = true;
        each.Start();
      }
    });
    listening.IsBackground = true;
    listening.Start();
  }

  /// Pass this program's input to the app and the app's answers back.
  static int Relay() {
    var pipe = new NamedPipeClientStream(".", Pipe, PipeDirection.InOut);
    try {
      pipe.Connect(3000);
    } catch (Exception) {
      Console.Error.WriteLine("Praecise Control is not running in the signed-in session; start it there");
      return 69;
    }
    var back = new Thread(() => {
      try { pipe.CopyTo(new Std(false)); } catch (IOException) { }
      Environment.Exit(0);
    });
    back.IsBackground = true;
    back.Start();
    var input = new Std(true);
    var buffer = new byte[65536];
    int count;
    try {
      while ((count = input.Read(buffer, 0, buffer.Length)) > 0) { pipe.Write(buffer, 0, count); pipe.Flush(); }
      // Nothing more will be asked. What was asked is still answered before this ends.
      pipe.WaitForPipeDrain();
    } catch (IOException) { }
    back.Join(5000);
    return 0;
  }

  [STAThread]
  static int Main(string[] arguments) {
    // Positions are in the pixels the window is really drawn in, whatever the display is scaled by.
    Native.SetProcessDPIAware();
    if (arguments.Length > 0 && arguments[0] == "connect") return Relay();
#if TRAY
    return Tray.Run();
#else
    Lines(new Std(true), new Std(false));
    return 0;
#endif
  }
}

#if TRAY
/// Praecise Control in the corner of the taskbar: what an agent is using, a way to pause it, and nothing else.
static class Tray {
  const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";

  public static int Run() {
    bool first;
    using (var only = new Mutex(true, "praecise-control-" + Environment.UserName.ToLowerInvariant(), out first)) {
      if (!first) return 0;
      Helper.Serve();
      System.Windows.Forms.Application.EnableVisualStyles();
      var icon = new System.Windows.Forms.NotifyIcon { Icon = System.Drawing.SystemIcons.Application, Text = "Praecise Control", Visible = true };
      var menu = new System.Windows.Forms.ContextMenuStrip();
      // Built as it is opened, so it says what is true now.
      menu.Opening += delegate {
        menu.Items.Clear();
        var recent = (DateTime.Now - Helper.LastAsked).TotalSeconds < 60;
        var state = menu.Items.Add(Helper.Paused ? "Paused: agents are refused" : recent ? "An agent is using " + Helper.LastApp : "No agent is using this computer");
        state.Enabled = false;
        menu.Items.Add(Helper.Paused ? "Resume" : "Pause", null, delegate { Helper.Paused = !Helper.Paused; icon.Text = Helper.Paused ? "Praecise Control, paused" : "Praecise Control"; });
        menu.Items.Add(new System.Windows.Forms.ToolStripSeparator());
        var starts = new System.Windows.Forms.ToolStripMenuItem("Start when I sign in") { Checked = Starts() };
        starts.Click += delegate { Start(!Starts()); };
        menu.Items.Add(starts);
        menu.Items.Add(new System.Windows.Forms.ToolStripSeparator());
        menu.Items.Add("Quit Praecise Control", null, delegate { icon.Visible = false; System.Windows.Forms.Application.Exit(); });
      };
      icon.ContextMenuStrip = menu;
      System.Windows.Forms.Application.Run();
      icon.Dispose();
      return 0;
    }
  }

  /// For this person only, and theirs to turn on.
  static bool Starts() {
    using (var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(RunKey)) return key != null && key.GetValue("Praecise Control") != null;
  }
  static void Start(bool on) {
    using (var key = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(RunKey)) {
      if (on) key.SetValue("Praecise Control", "\"" + System.Reflection.Assembly.GetExecutingAssembly().Location + "\"");
      else key.DeleteValue("Praecise Control", false);
    }
  }
}
#endif
