// The Windows helper that runs all the time. A PowerShell process costs about 50 MB just to sit idle, so
// the watching happens here, and helper.ps1 starts only for the commands this program does not know.
// It speaks the same JSON lines: commands on stdin, replies and events on stdout. It exits when stdin
// closes, so it can never outlive the app. scripts\build-helper.js compiles it. C# 5 only.
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net.NetworkInformation;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using Windows.Foundation;
using Windows.Media.Control;
using Windows.Storage.Streams;

static class HelperService {
  const int FastMs = 300;
  const int SlowMs = 1000;
  const int MediaTimeoutMs = 3000;
  const int MaxArtBytes = 3 * 1024 * 1024;
  const int MaxAppNames = 200;
  static readonly string[] LockNames = { "Caps Lock", "Num Lock", "Scroll Lock" };

  static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
  static readonly Dictionary<uint, string> AppNames = new Dictionary<uint, string>();
  static StreamWriter output;
  static GlobalSystemMediaTransportControlsSessionManager manager;
  static string mediaKey = "";
  static string artKey = "";
  static string volumeKey = "";
  static string lockState;
  static uint clipSeq;
  static bool pageListening;

  static Dictionary<string, object> Data(params object[] pairs) {
    Dictionary<string, object> data = new Dictionary<string, object>();
    for (int i = 0; i < pairs.Length; i += 2) data[(string)pairs[i]] = pairs[i + 1];
    return data;
  }

  static void Event(string name, object data) {
    output.WriteLine(Json.Serialize(Data("event", name, "data", data)));
  }

  // WinRT calls are waited on by status, because AsTask needs the Windows SDK to compile.
  static T Wait<T>(IAsyncOperation<T> operation) {
    Stopwatch clock = Stopwatch.StartNew();
    while (operation.Status == AsyncStatus.Started) {
      if (clock.ElapsedMilliseconds > MediaTimeoutMs) throw new TimeoutException("media call timed out");
      Thread.Sleep(2);
    }
    return operation.GetResults();
  }

  static string ReadArt(GlobalSystemMediaTransportControlsSessionMediaProperties props) {
    if (props.Thumbnail == null) return null;
    using (IRandomAccessStreamWithContentType stream = Wait(props.Thumbnail.OpenReadAsync())) {
      if (stream.Size == 0 || stream.Size > MaxArtBytes) return null;
      using (DataReader reader = new DataReader(stream.GetInputStreamAt(0))) {
        Wait(reader.LoadAsync((uint)stream.Size));
        byte[] bytes = new byte[stream.Size];
        reader.ReadBytes(bytes);
        string type = bytes[0] == 0xFF ? "image/jpeg" : "image/png";
        return "data:" + type + ";base64," + Convert.ToBase64String(bytes);
      }
    }
  }

  // Players report a position plus the moment they reported it, then expect us to count forward.
  static double Position(GlobalSystemMediaTransportControlsSessionTimelineProperties timeline, bool playing) {
    double seconds = timeline.Position.TotalSeconds;
    if (playing && timeline.LastUpdatedTime.Year > 2000) seconds += (DateTimeOffset.Now - timeline.LastUpdatedTime).TotalSeconds;
    double end = timeline.EndTime.TotalSeconds;
    if (end > 0) seconds = Math.Min(seconds, end);
    return Math.Round(seconds);
  }

  static void UpdateMedia() {
    GlobalSystemMediaTransportControlsSession session = manager.GetCurrentSession();
    if (session == null) {
      if (mediaKey != "none") {
        mediaKey = "none";
        artKey = "";
        Event("media", null);
      }
      return;
    }
    GlobalSystemMediaTransportControlsSessionMediaProperties props = Wait(session.TryGetMediaPropertiesAsync());
    GlobalSystemMediaTransportControlsSessionPlaybackInfo info = session.GetPlaybackInfo();
    GlobalSystemMediaTransportControlsSessionTimelineProperties timeline = session.GetTimelineProperties();
    bool playing = info.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
    string track = session.SourceAppUserModelId + "|" + props.Title + "|" + props.Artist;
    string key = track + "|" + playing + "|" + timeline.Position.Ticks + "|" + timeline.LastUpdatedTime.Ticks;
    if (key == mediaKey) return;
    mediaKey = key;
    Event("media", Data(
      "app", session.SourceAppUserModelId,
      "title", props.Title,
      "artist", props.Artist,
      "album", props.AlbumTitle,
      "playing", playing,
      "position", Position(timeline, playing),
      "duration", Math.Round(timeline.EndTime.TotalSeconds),
      "canSeek", info.Controls.IsPlaybackPositionEnabled));
    if (track == artKey) return;
    artKey = track;
    string art = null;
    try { art = ReadArt(props); } catch (Exception) { }
    Event("art", art);
  }

  static bool InvokeMedia(string action, double seconds) {
    GlobalSystemMediaTransportControlsSession session = manager.GetCurrentSession();
    if (session == null) return false;
    switch (action) {
      case "toggle": return Wait(session.TryTogglePlayPauseAsync());
      case "next": return Wait(session.TrySkipNextAsync());
      case "prev": return Wait(session.TrySkipPreviousAsync());
      case "seek": return Wait(session.TryChangePlaybackPositionAsync((long)Math.Round(seconds * 10000000)));
      default: throw new InvalidOperationException("unknown media action " + action);
    }
  }

  // The page takes its first report as the starting level, and this program starts before the page does.
  static void UpdateVolume() {
    if (!pageListening) return;
    NookVolume volume = NookNative.GetVolume();
    string key = volume.Percent + "|" + volume.Muted;
    if (key == volumeKey) return;
    volumeKey = key;
    Event("volume", VolumeData(volume));
  }

  static Dictionary<string, object> VolumeData(NookVolume volume) {
    return Data("percent", volume.Percent, "muted", volume.Muted);
  }

  static void UpdateLockKeys() {
    string state = NookNative.LockKeys();
    if (state == lockState) return;
    string[] before = lockState.Split(',');
    string[] after = state.Split(',');
    lockState = state;
    for (int i = 0; i < LockNames.Length; i++) {
      if (before[i] != after[i]) Event("lockkey", Data("key", LockNames[i], "on", after[i] == "1"));
    }
  }

  static void UpdateClipboard() {
    uint seq = NookNative.GetClipboardSequenceNumber();
    if (seq == clipSeq) return;
    clipSeq = seq;
    Event("clip", Data("sensitive", NookNative.ClipboardIsSensitive()));
  }

  static string AppName(uint processId) {
    if (processId == 0) return "";
    string name;
    if (AppNames.TryGetValue(processId, out name)) return name;
    name = "";
    try {
      using (Process process = Process.GetProcessById((int)processId)) {
        name = process.ProcessName;
        try {
          string description = process.MainModule.FileVersionInfo.FileDescription;
          if (!string.IsNullOrEmpty(description)) name = description;
        } catch (Exception) { }
      }
    } catch (Exception) { }
    if (AppNames.Count > MaxAppNames) AppNames.Clear();
    AppNames[processId] = name;
    return name;
  }

  static void UpdateForeground() {
    NookForeground foreground = NookNative.Foreground();
    Event("foreground", Data(
      "app", AppName(foreground.Pid),
      "pid", foreground.Pid,
      "handle", foreground.Handle,
      "x", foreground.CenterX,
      "y", foreground.CenterY,
      "fullscreen", foreground.Fullscreen,
      "idle", NookNative.IdleSeconds()));
  }

  static Dictionary<string, object> NetTotals() {
    long received = 0;
    long sent = 0;
    foreach (NetworkInterface adapter in NetworkInterface.GetAllNetworkInterfaces()) {
      if (adapter.OperationalStatus != OperationalStatus.Up || adapter.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
      IPInterfaceStatistics stats = adapter.GetIPStatistics();
      received += stats.BytesReceived;
      sent += stats.BytesSent;
    }
    return Data("rx", received, "tx", sent);
  }

  static string Text(Dictionary<string, object> request, string name) {
    object value;
    return request.TryGetValue(name, out value) && value != null ? value.ToString() : "";
  }

  static double Number(Dictionary<string, object> request, string name) {
    object value;
    return request.TryGetValue(name, out value) && value != null ? Convert.ToDouble(value, CultureInfo.InvariantCulture) : 0;
  }

  static bool Flag(Dictionary<string, object> request, string name) {
    object value;
    return request.TryGetValue(name, out value) && value is bool && (bool)value;
  }

  static object Command(Dictionary<string, object> request) {
    string command = Text(request, "cmd");
    switch (command) {
      case "media": {
        bool done = InvokeMedia(Text(request, "action"), Number(request, "seconds"));
        mediaKey = "";
        return done;
      }
      case "media.refresh":
        pageListening = true;
        mediaKey = "";
        artKey = "";
        return null;
      case "locks.get": return lockState;
      case "volume.get": return VolumeData(NookNative.GetVolume());
      case "volume.set":
        NookNative.SetVolume((int)Math.Round(Number(request, "percent")));
        return null;
      case "volume.step":
        NookNative.SetVolume(NookNative.GetVolume().Percent + (int)Math.Round(Number(request, "delta")));
        NookNative.SetMute(false);
        return null;
      case "volume.mute":
        NookNative.SetMute(!NookNative.GetVolume().Muted);
        return null;
      case "mic.get": return NookNative.MicMuted();
      case "mic.set":
        NookNative.SetMicMuted(Flag(request, "muted"));
        return null;
      case "net.totals": return NetTotals();
      default: throw new InvalidOperationException("unknown command " + command);
    }
  }

  static void Run(string line) {
    Dictionary<string, object> reply = Data("id", null, "ok", true, "data", null);
    try {
      Dictionary<string, object> request = (Dictionary<string, object>)Json.DeserializeObject(line);
      reply["id"] = request["id"];
      reply["data"] = Command(request);
    } catch (Exception err) {
      reply["ok"] = false;
      reply["error"] = err.Message;
    }
    output.WriteLine(Json.Serialize(reply));
  }

  static BlockingCollection<string> ReadCommands(Encoding encoding) {
    BlockingCollection<string> commands = new BlockingCollection<string>();
    Thread reader = new Thread(() => {
      try {
        using (StreamReader input = new StreamReader(Console.OpenStandardInput(), encoding)) {
          string line;
          while ((line = input.ReadLine()) != null) commands.Add(line);
        }
      } catch (IOException) {
      } finally {
        commands.CompleteAdding();
      }
    });
    reader.IsBackground = true;
    reader.Start();
    return commands;
  }

  static void Watch(BlockingCollection<string> commands) {
    DateTime nextFast = DateTime.UtcNow;
    DateTime nextSlow = nextFast;
    while (true) {
      string line;
      int wait = Math.Max(0, (int)(nextFast - DateTime.UtcNow).TotalMilliseconds);
      if (commands.TryTake(out line, wait)) Run(line);
      else if (commands.IsCompleted) return;
      DateTime now = DateTime.UtcNow;
      try {
        if (now >= nextFast) {
          nextFast = now.AddMilliseconds(FastMs);
          UpdateClipboard();
          UpdateVolume();
          UpdateLockKeys();
        }
        if (now >= nextSlow) {
          nextSlow = now.AddMilliseconds(SlowMs);
          UpdateMedia();
          UpdateForeground();
        }
      } catch (Exception err) {
        Console.Error.WriteLine("tick failed: " + err.Message);
      }
    }
  }

  static int Main() {
    try {
      Encoding utf8 = new UTF8Encoding(false);
      output = new StreamWriter(Console.OpenStandardOutput(), utf8);
      output.AutoFlush = true;
      // Without this, display scaling skews window sizes and full-screen apps are not recognised.
      NookNative.SetProcessDPIAware();
      lockState = NookNative.LockKeys();
      clipSeq = NookNative.GetClipboardSequenceNumber();
      manager = Wait(GlobalSystemMediaTransportControlsSessionManager.RequestAsync());
      BlockingCollection<string> commands = ReadCommands(utf8);
      Event("ready", true);
      Watch(commands);
      return 0;
    } catch (Exception err) {
      Console.Error.WriteLine(err.Message);
      return 1;
    }
  }
}
