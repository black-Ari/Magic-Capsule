// Windows quick settings that have no PowerShell command. helper-control.ps1 compiles this on first
// use. PowerShell 5.1 compiles C# 5 only.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace NookCtl {
  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int flow, int mask, out IMMDeviceCollection devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device);
  }

  [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceCollection {
    [PreserveSig] int GetCount(out int count);
    [PreserveSig] int Item(int index, out IMMDevice device);
  }

  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int context, IntPtr args, [MarshalAs(UnmanagedType.IUnknown)] out object result);
    [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore store);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
  }

  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore {
    [PreserveSig] int GetCount(out int count);
    [PreserveSig] int GetAt(int index, out PropertyKey key);
    [PreserveSig] int GetValue(ref PropertyKey key, out PropertyValue value);
  }

  [StructLayout(LayoutKind.Sequential)]
  struct PropertyKey {
    public Guid format;
    public int id;
  }

  [StructLayout(LayoutKind.Explicit, Size = 24)]
  struct PropertyValue {
    [FieldOffset(0)] public short type;
    [FieldOffset(8)] public IntPtr text;
  }

  [ComImport, Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")]
  class PolicyConfigClient {}

  // Not a published interface, but the one every sound switcher uses. The first ten slots are unused.
  [ComImport, Guid("F8679F50-850A-41CF-9C72-430F290290C8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPolicyConfig {
    [PreserveSig] int Unused1(); [PreserveSig] int Unused2(); [PreserveSig] int Unused3(); [PreserveSig] int Unused4(); [PreserveSig] int Unused5();
    [PreserveSig] int Unused6(); [PreserveSig] int Unused7(); [PreserveSig] int Unused8(); [PreserveSig] int Unused9(); [PreserveSig] int Unused10();
    [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
  }

  [StructLayout(LayoutKind.Sequential)]
  struct CursorPoint {
    public int X;
    public int Y;
  }

  public class AudioOutput {
    public string id { get; set; }
    public string name { get; set; }
    public bool current { get; set; }
  }

  public static class Control {
    const uint WM_SETTINGCHANGE = 0x1A;
    const uint WM_SYSCOMMAND = 0x112;
    const uint SMTO_ABORTIFHUNG = 2;
    static readonly IntPtr HWND_BROADCAST = new IntPtr(0xFFFF);
    static readonly IntPtr SC_MONITORPOWER = new IntPtr(0xF170);
    static readonly IntPtr MONITOR_OFF = new IntPtr(2);
    const int RENDER = 0;
    const int ACTIVE = 1;
    const int VT_LPWSTR = 31;
    const int ROLE_COUNT = 3; // console, multimedia, communications
    const ulong QUIET_HOURS_STATE = 0x0D83063EA3BF1C75UL; // WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr SendMessageTimeout(IntPtr h, uint message, IntPtr a, string b, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint message, IntPtr a, IntPtr b);
    [DllImport("ntdll.dll")] static extern int NtQueryWnfStateData(ref ulong name, IntPtr type, IntPtr scope, out uint stamp, byte[] buffer, ref uint size);
    [DllImport("ntdll.dll")] static extern int NtUpdateWnfStateData(ref ulong name, byte[] buffer, int size, IntPtr type, IntPtr scope, int matching, int check);
    [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropertyValue value);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out CursorPoint point);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern void mouse_event(uint flags, int dx, int dy, int data, UIntPtr extra);

    const uint LEFT_DOWN = 0x2, LEFT_UP = 0x4, RIGHT_DOWN = 0x8, RIGHT_UP = 0x10, WHEEL = 0x800;
    const int WHEEL_NOTCH = 120;

    // For the phone remote, which moves the mouse from wherever it already is.
    public static void MoveBy(int dx, int dy) {
      CursorPoint point;
      GetCursorPos(out point);
      SetCursorPos(point.X + dx, point.Y + dy);
    }

    public static void ClickHere(bool right, bool twice) {
      uint down = right ? RIGHT_DOWN : LEFT_DOWN;
      uint up = right ? RIGHT_UP : LEFT_UP;
      for (int press = 0; press < (twice ? 2 : 1); press += 1) {
        mouse_event(down, 0, 0, 0, UIntPtr.Zero);
        mouse_event(up, 0, 0, 0, UIntPtr.Zero);
      }
    }

    public static void ScrollHere(int notches) {
      mouse_event(WHEEL, 0, 0, notches * WHEEL_NOTCH, UIntPtr.Zero);
    }

    // Open apps redraw in the new colours when they hear this.
    public static void ThemeChanged() {
      IntPtr ignored;
      SendMessageTimeout(HWND_BROADCAST, WM_SETTINGCHANGE, IntPtr.Zero, "ImmersiveColorSet", SMTO_ABORTIFHUNG, 1000, out ignored);
    }

    public static void ScreenOff() {
      PostMessage(HWND_BROADCAST, WM_SYSCOMMAND, SC_MONITORPOWER, MONITOR_OFF);
    }

    // 0 is off, 1 is priority only and 2 is alarms only.
    public static int GetQuiet() {
      ulong state = QUIET_HOURS_STATE;
      uint stamp;
      byte[] data = new byte[8];
      uint size = (uint)data.Length;
      int status = NtQueryWnfStateData(ref state, IntPtr.Zero, IntPtr.Zero, out stamp, data, ref size);
      if (status != 0) throw new InvalidOperationException("Windows would not say if Do not disturb is on");
      return BitConverter.ToInt32(data, 0);
    }

    public static void SetQuiet(int profile) {
      ulong state = QUIET_HOURS_STATE;
      byte[] data = BitConverter.GetBytes(profile);
      int status = NtUpdateWnfStateData(ref state, data, data.Length, IntPtr.Zero, IntPtr.Zero, 0, 0);
      if (status != 0) throw new InvalidOperationException("Windows refused to change Do not disturb");
    }

    // helper.ps1 already has a class for this COM object, and .NET allows only one per object, so
    // this one asks by id and goes straight to the interface.
    static IMMDeviceEnumerator Enumerator() {
      return (IMMDeviceEnumerator)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")));
    }

    static string NameOf(IMMDevice device) {
      IPropertyStore store;
      Marshal.ThrowExceptionForHR(device.OpenPropertyStore(0, out store));
      PropertyKey key = new PropertyKey();
      key.format = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0");
      key.id = 14; // the friendly name
      PropertyValue value;
      Marshal.ThrowExceptionForHR(store.GetValue(ref key, out value));
      string name = value.type == VT_LPWSTR ? Marshal.PtrToStringUni(value.text) : "Sound device";
      PropVariantClear(ref value);
      return name;
    }

    public static List<AudioOutput> Outputs() {
      IMMDeviceEnumerator enumerator = Enumerator();
      IMMDevice main;
      string current = "";
      if (enumerator.GetDefaultAudioEndpoint(RENDER, 1, out main) == 0) main.GetId(out current);
      IMMDeviceCollection devices;
      Marshal.ThrowExceptionForHR(enumerator.EnumAudioEndpoints(RENDER, ACTIVE, out devices));
      int count;
      Marshal.ThrowExceptionForHR(devices.GetCount(out count));
      List<AudioOutput> found = new List<AudioOutput>();
      for (int index = 0; index < count; index += 1) {
        IMMDevice device;
        Marshal.ThrowExceptionForHR(devices.Item(index, out device));
        AudioOutput output = new AudioOutput();
        string id;
        Marshal.ThrowExceptionForHR(device.GetId(out id));
        output.id = id;
        output.name = NameOf(device);
        output.current = id == current;
        found.Add(output);
      }
      return found;
    }

    public static void SetOutput(string id) {
      IPolicyConfig policy = (IPolicyConfig)new PolicyConfigClient();
      for (int role = 0; role < ROLE_COUNT; role += 1) Marshal.ThrowExceptionForHR(policy.SetDefaultEndpoint(id, role));
    }
  }
}
