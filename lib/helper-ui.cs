// Windows and app controls for the AI agent. helper.ps1 compiles this the first time the agent needs
// it, so Magic Capsule uses no extra memory for it otherwise. PowerShell 5.1 compiles C# 5 only.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows;
using System.Windows.Automation;

public class NookWindow {
  public long handle { get; set; }
  public string title { get; set; }
  public string app { get; set; }
  public bool active { get; set; }
  public bool minimized { get; set; }
}

public class NookElement {
  public int id { get; set; }
  public string type { get; set; }
  public string name { get; set; }
  public string value { get; set; }
  public bool enabled { get; set; }
}

public static class NookUi {
  const int MAX_DEPTH = 30;
  const int MAX_TEXT = 160;
  const int GW_OWNER = 4;
  const int GWL_EXSTYLE = -20;
  const long WS_EX_TOOLWINDOW = 0x80;
  const int DWMWA_CLOAKED = 14;
  const uint WM_CLOSE = 0x10;
  const int SW_RESTORE = 9;

  delegate bool EnumProc(IntPtr handle, IntPtr extra);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc, IntPtr extra);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder text, int size);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint processId);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, int command);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr h, int index);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attribute, out int value, int size);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int command);
  [DllImport("user32.dll")] static extern void SwitchToThisWindow(IntPtr h, bool altTab);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint message, IntPtr a, IntPtr b);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("user32.dll")] static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();

  static readonly Dictionary<int, AutomationElement> elements = new Dictionary<int, AutomationElement>();
  static long lastWindow;

  static readonly HashSet<ControlType> useful = new HashSet<ControlType> {
    ControlType.Button, ControlType.SplitButton, ControlType.Edit, ControlType.Document, ControlType.Hyperlink,
    ControlType.MenuItem, ControlType.CheckBox, ControlType.RadioButton, ControlType.ComboBox, ControlType.ListItem,
    ControlType.TreeItem, ControlType.TabItem, ControlType.DataItem, ControlType.Slider, ControlType.Spinner, ControlType.Text,
  };

  static bool Cloaked(IntPtr h) {
    int value;
    return DwmGetWindowAttribute(h, DWMWA_CLOAKED, out value, sizeof(int)) == 0 && value != 0;
  }

  static string AppOf(IntPtr h) {
    uint id;
    GetWindowThreadProcessId(h, out id);
    try { using (Process process = Process.GetProcessById((int)id)) return process.ProcessName; }
    catch (ArgumentException) { return ""; }
  }

  // Top-most first, so the first one is what the person sees in front.
  public static List<NookWindow> ListWindows() {
    List<NookWindow> found = new List<NookWindow>();
    IntPtr front = GetForegroundWindow();
    EnumWindows(delegate (IntPtr h, IntPtr extra) {
      if (!IsWindowVisible(h) || GetWindow(h, GW_OWNER) != IntPtr.Zero || Cloaked(h)) return true;
      if ((GetWindowLongPtr(h, GWL_EXSTYLE).ToInt64() & WS_EX_TOOLWINDOW) != 0) return true;
      StringBuilder title = new StringBuilder(256);
      if (GetWindowText(h, title, title.Capacity) == 0) return true;
      NookWindow window = new NookWindow();
      window.handle = h.ToInt64();
      window.title = title.ToString();
      window.app = AppOf(h);
      window.active = front != IntPtr.Zero ? h == front : found.Count == 0;
      window.minimized = IsIconic(h);
      found.Add(window);
      return true;
    }, IntPtr.Zero);
    return found;
  }

  public static bool Focus(long handle) {
    IntPtr h = new IntPtr(handle);
    if (!IsWindow(h)) throw new InvalidOperationException("That window is gone");
    if (IsIconic(h)) ShowWindow(h, SW_RESTORE);
    // Windows refuses a background app, unless it simulates user input (Alt key) and joins thread input.
    uint ignored;
    uint front = GetWindowThreadProcessId(GetForegroundWindow(), out ignored);
    uint target = GetWindowThreadProcessId(h, out ignored);
    uint self = GetCurrentThreadId();
    bool joinedFront = front != 0 && front != self && AttachThreadInput(self, front, true);
    bool joinedTarget = target != 0 && target != self && AttachThreadInput(self, target, true);
    keybd_event(0x12, 0, 0, UIntPtr.Zero);
    keybd_event(0x12, 0, 2, UIntPtr.Zero);
    SetForegroundWindow(h);
    BringWindowToTop(h);
    if (joinedFront) AttachThreadInput(self, front, false);
    if (joinedTarget) AttachThreadInput(self, target, false);
    if (GetForegroundWindow() != h) {
      SwitchToThisWindow(h, true);
      Thread.Sleep(200);
    }
    IntPtr current = GetForegroundWindow();
    if (current == h) return true;
    if (current == IntPtr.Zero) {
      var list = ListWindows();
      return list.Count > 0 && list[0].handle == handle;
    }
    return false;
  }

  public static void Close(long handle) {
    IntPtr h = new IntPtr(handle);
    if (!IsWindow(h)) throw new InvalidOperationException("That window is gone");
    PostMessage(h, WM_CLOSE, IntPtr.Zero, IntPtr.Zero); // the same as pressing X, so it can still ask to save
  }

  static string Short(string text) {
    if (string.IsNullOrEmpty(text)) return "";
    string line = text.Replace("\r", " ").Replace("\n", " ").Trim();
    return line.Length > MAX_TEXT ? line.Substring(0, MAX_TEXT) : line;
  }

  static string ValueOf(AutomationElement element, AutomationElement.AutomationElementInformation info) {
    if (info.IsPassword) return "";
    object pattern;
    if (!element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) return "";
    return Short(((ValuePattern)pattern).Current.Value);
  }

  static void Consider(AutomationElement element, List<NookElement> found) {
    AutomationElement.AutomationElementInformation info = element.Current;
    if (info.IsOffscreen || !useful.Contains(info.ControlType) || info.BoundingRectangle.IsEmpty) return;
    // Some apps put a password box's text in its name too, so neither is ever read.
    string name = info.IsPassword ? "password box" : Short(info.Name);
    string value = ValueOf(element, info);
    if (name.Length == 0 && value.Length == 0 && info.ControlType == ControlType.Text) return;
    NookElement item = new NookElement();
    item.id = found.Count + 1;
    item.type = info.ControlType.ProgrammaticName.Replace("ControlType.", "");
    item.name = name;
    item.value = value;
    item.enabled = info.IsEnabled;
    found.Add(item);
    elements[item.id] = element;
  }

  public static List<NookElement> Read(long handle, int limit, int budgetMs) {
    elements.Clear();
    lastWindow = handle;
    List<NookElement> found = new List<NookElement>();
    Stopwatch clock = Stopwatch.StartNew();
    TreeWalker walker = TreeWalker.ControlViewWalker;
    Stack<KeyValuePair<AutomationElement, int>> pending = new Stack<KeyValuePair<AutomationElement, int>>();
    pending.Push(new KeyValuePair<AutomationElement, int>(AutomationElement.FromHandle(new IntPtr(handle)), 0));
    while (pending.Count > 0 && found.Count < limit && clock.ElapsedMilliseconds < budgetMs) {
      KeyValuePair<AutomationElement, int> next = pending.Pop();
      try {
        if (next.Value > 0) Consider(next.Key, found);
        if (next.Value >= MAX_DEPTH) continue;
        List<AutomationElement> children = new List<AutomationElement>();
        for (AutomationElement child = walker.GetFirstChild(next.Key); child != null; child = walker.GetNextSibling(child)) children.Add(child);
        children.Reverse(); // so the stack gives them back in reading order
        foreach (AutomationElement child in children) pending.Push(new KeyValuePair<AutomationElement, int>(child, next.Value + 1));
      } catch (ElementNotAvailableException) {
        // It closed while being read. The rest of the window is still good.
      }
    }
    return found;
  }

  // A real click at the middle of the element. Invoking it through UI Automation can hang when the
  // button opens a dialog, and this works the same for every app.
  public static int[] Target(int id) {
    AutomationElement element;
    if (!elements.TryGetValue(id, out element)) throw new InvalidOperationException("Unknown element. Use read_ui again.");
    Rect box;
    try { box = element.Current.BoundingRectangle; }
    catch (ElementNotAvailableException) { throw new InvalidOperationException("That element is gone. Use read_ui again."); }
    if (box.IsEmpty || box.Width < 1 || box.Height < 1) throw new InvalidOperationException("That element is not on the screen. Use read_ui again.");
    Focus(lastWindow);
    return new int[] { (int)(box.X + box.Width / 2), (int)(box.Y + box.Height / 2) };
  }
}
