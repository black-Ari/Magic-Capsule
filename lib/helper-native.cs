// Windows calls shared by helper-service.cs and helper.ps1. PowerShell 5.1 compiles C# 5 only.
using System;
using System.Runtime.InteropServices;
using System.Text;

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorCom {}

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  [PreserveSig] int EnumAudioEndpoints(int flow, int mask, out IntPtr devices);
  [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  [PreserveSig] int Activate(ref Guid iid, int ctx, IntPtr args, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
}

[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
  [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
  [PreserveSig] int GetChannelCount(out int count);
  [PreserveSig] int SetMasterVolumeLevel(float db, ref Guid ctx);
  [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid ctx);
  [PreserveSig] int GetMasterVolumeLevel(out float db);
  [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
  [PreserveSig] int SetChannelVolumeLevel(uint channel, float db, ref Guid ctx);
  [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid ctx);
  [PreserveSig] int GetChannelVolumeLevel(uint channel, out float db);
  [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
  [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
  [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}

public class NookVolume {
  public int Percent;
  public bool Muted;
}

public class NookForeground {
  public uint Pid;
  public bool Fullscreen;
  public long Handle;
  public int CenterX;
  public int CenterY;
}

public static class NookNative {
  [StructLayout(LayoutKind.Sequential)]
  struct RECT { public int Left, Top, Right, Bottom; }

  [StructLayout(LayoutKind.Sequential)]
  struct MONITORINFO { public int Size; public RECT Monitor; public RECT Work; public uint Flags; }

  [StructLayout(LayoutKind.Sequential)]
  struct LASTINPUTINFO { public uint Size; public uint Time; }

  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int size);
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
  [StructLayout(LayoutKind.Sequential)]
  struct MOUSEINPUT { public int X; public int Y; public uint Data; public uint Flags; public uint Time; public IntPtr Extra; }

  [StructLayout(LayoutKind.Sequential)]
  struct KEYBDINPUT { public ushort Vk; public ushort Scan; public uint Flags; public uint Time; public IntPtr Extra; }

  [StructLayout(LayoutKind.Explicit)]
  struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT Mouse; [FieldOffset(0)] public KEYBDINPUT Key; }

  [StructLayout(LayoutKind.Sequential)]
  struct INPUT { public uint Type; public INPUTUNION U; }

  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern short GetKeyState(int key);
  [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern uint RegisterClipboardFormat(string name);
  [DllImport("user32.dll")] static extern bool IsClipboardFormatAvailable(uint format);
  [DllImport("user32.dll")] static extern bool OpenClipboard(IntPtr owner);
  [DllImport("user32.dll")] static extern bool CloseClipboard();
  [DllImport("user32.dll")] static extern IntPtr GetClipboardData(uint format);
  [DllImport("kernel32.dll")] static extern IntPtr GlobalLock(IntPtr handle);
  [DllImport("kernel32.dll")] static extern bool GlobalUnlock(IntPtr handle);

  static readonly uint ExcludeFormat = RegisterClipboardFormat("ExcludeClipboardContentFromMonitorProcessing");
  static readonly uint HistoryFormat = RegisterClipboardFormat("CanIncludeInClipboardHistory");

  // Password managers mark what they copy; such items are never recorded. CanIncludeInClipboardHistory
  // is a number, 0 meaning "keep out of history". If the value cannot be read, assume it is private.
  public static bool ClipboardIsSensitive() {
    if (IsClipboardFormatAvailable(ExcludeFormat)) return true;
    if (!IsClipboardFormatAvailable(HistoryFormat)) return false;
    if (!OpenClipboard(IntPtr.Zero)) return true;
    try {
      IntPtr handle = GetClipboardData(HistoryFormat);
      IntPtr data = handle == IntPtr.Zero ? IntPtr.Zero : GlobalLock(handle);
      if (data == IntPtr.Zero) return true;
      try { return Marshal.ReadInt32(data) == 0; } finally { GlobalUnlock(handle); }
    } finally {
      CloseClipboard();
    }
  }

  public static NookForeground Foreground() {
    NookForeground result = new NookForeground();
    IntPtr hwnd = GetForegroundWindow();
    if (hwnd == IntPtr.Zero) return result;
    GetWindowThreadProcessId(hwnd, out result.Pid);
    result.Handle = hwnd.ToInt64();

    StringBuilder name = new StringBuilder(64);
    GetClassName(hwnd, name, name.Capacity);
    string cls = name.ToString();
    if (cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd") return result;

    RECT rect;
    MONITORINFO info = new MONITORINFO();
    info.Size = Marshal.SizeOf(typeof(MONITORINFO));
    if (GetWindowRect(hwnd, out rect) && GetMonitorInfo(MonitorFromWindow(hwnd, 2), ref info)) {
      result.CenterX = (rect.Left + rect.Right) / 2;
      result.CenterY = (rect.Top + rect.Bottom) / 2;
      result.Fullscreen = rect.Left <= info.Monitor.Left && rect.Top <= info.Monitor.Top
        && rect.Right >= info.Monitor.Right && rect.Bottom >= info.Monitor.Bottom;
    }
    return result;
  }

  static void Send(params INPUT[] inputs) {
    if (SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT))) != inputs.Length) {
      throw new InvalidOperationException("Windows blocked the input. The app in front may be running as administrator.");
    }
  }

  static INPUT MouseEvent(uint flags, uint data) {
    INPUT input = new INPUT();
    input.U.Mouse.Flags = flags;
    input.U.Mouse.Data = data;
    return input;
  }

  static INPUT KeyEvent(ushort vk, ushort scan, uint flags) {
    INPUT input = new INPUT();
    input.Type = 1;
    input.U.Key.Vk = vk;
    input.U.Key.Scan = scan;
    input.U.Key.Flags = flags;
    return input;
  }

  public static void Click(int x, int y, string button, bool twice) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(60);
    uint down = button == "right" ? 8u : 2u;
    for (int i = 0; i < (twice ? 2 : 1); i++) {
      Send(MouseEvent(down, 0));
      Send(MouseEvent(down * 2, 0));
      System.Threading.Thread.Sleep(50);
    }
  }

  public static void Drag(int fromX, int fromY, int toX, int toY) {
    SetCursorPos(fromX, fromY);
    System.Threading.Thread.Sleep(80);
    Send(MouseEvent(2, 0));
    for (int step = 1; step <= 12; step++) {
      SetCursorPos(fromX + (toX - fromX) * step / 12, fromY + (toY - fromY) * step / 12);
      System.Threading.Thread.Sleep(16);
    }
    Send(MouseEvent(4, 0));
  }

  public static void Scroll(int x, int y, int notches) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(60);
    Send(MouseEvent(0x800, unchecked((uint)(notches * 120))));
  }

  public static void TypeText(string text) {
    foreach (char c in text) {
      if (c == '\n') { Send(KeyEvent(13, 0, 0), KeyEvent(13, 0, 2)); continue; }
      if (c == '\r') continue;
      Send(KeyEvent(0, c, 4), KeyEvent(0, c, 6));
      System.Threading.Thread.Sleep(4);
    }
  }

  public static void PressKeys(int[] keys) {
    try {
      foreach (int key in keys) Send(KeyEvent((ushort)key, 0, 0));
    } finally {
      for (int i = keys.Length - 1; i >= 0; i--) Send(KeyEvent((ushort)keys[i], 0, 2));
    }
  }

  // Only the on/off state of the three lock keys. No other key is ever read.
  public static string LockKeys() {
    return (GetKeyState(0x14) & 1) + "," + (GetKeyState(0x90) & 1) + "," + (GetKeyState(0x91) & 1);
  }

  public static uint IdleSeconds() {
    LASTINPUTINFO info = new LASTINPUTINFO();
    info.Size = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO));
    if (!GetLastInputInfo(ref info)) return 0;
    return (uint)(Environment.TickCount - (int)info.Time) / 1000;
  }

  static IAudioEndpointVolume Endpoint(int flow = 0) { // 0 speakers, 1 microphone
    IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
    IMMDevice device;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(flow, 1, out device));
    Guid iid = typeof(IAudioEndpointVolume).GUID;
    object iface;
    Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out iface));
    return (IAudioEndpointVolume)iface;
  }

  public static NookVolume GetVolume() {
    IAudioEndpointVolume endpoint = Endpoint();
    float level;
    bool muted;
    Marshal.ThrowExceptionForHR(endpoint.GetMasterVolumeLevelScalar(out level));
    Marshal.ThrowExceptionForHR(endpoint.GetMute(out muted));
    NookVolume result = new NookVolume();
    result.Percent = (int)Math.Round(level * 100);
    result.Muted = muted;
    return result;
  }

  public static void SetVolume(int percent) {
    Guid ctx = Guid.Empty;
    float level = Math.Max(0, Math.Min(100, percent)) / 100f;
    Marshal.ThrowExceptionForHR(Endpoint().SetMasterVolumeLevelScalar(level, ref ctx));
  }

  public static void SetMute(bool mute) {
    Guid ctx = Guid.Empty;
    Marshal.ThrowExceptionForHR(Endpoint().SetMute(mute, ref ctx));
  }

  public static bool MicMuted() {
    bool muted;
    Marshal.ThrowExceptionForHR(Endpoint(1).GetMute(out muted));
    return muted;
  }

  public static void SetMicMuted(bool mute) {
    Guid ctx = Guid.Empty;
    Marshal.ThrowExceptionForHR(Endpoint(1).SetMute(mute, ref ctx));
  }
}
