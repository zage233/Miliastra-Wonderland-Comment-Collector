using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("Miliastra Wonderland Comment Collector")]
[assembly: AssemblyDescription("Miliastra Wonderland Comment Collector windowless launcher")]
[assembly: AssemblyProduct("Miliastra Wonderland Comment Collector")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

internal static class Program
{
    private const string ProductName = "Miliastra Wonderland Comment Collector";

    [STAThread]
    private static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Process server = null;
        var output = new StringBuilder();
        var outputLock = new object();
        using (var ready = new ManualResetEvent(false))
        {
            try
            {
                string root = AppDomain.CurrentDomain.BaseDirectory;
                string app = Path.Combine(root, "app");
                string source = Path.Combine(app, "server.js");
                if (!File.Exists(source) || !File.Exists(Path.Combine(app, "app.html")) ||
                    !File.Exists(Path.Combine(app, "collect.js")) || !File.Exists(Path.Combine(app, "i18n.js")) ||
                    !File.Exists(Path.Combine(app, "onboarding.js")) || !File.Exists(Path.Combine(app, "batch-add.js")) ||
                    !File.Exists(Path.Combine(app, "import-batch.js")) || !File.Exists(Path.Combine(app, "note-store.js")) ||
                    !File.Exists(Path.Combine(app, "appearance.js")))
                    throw new InvalidOperationException("缺少 app 程序文件夹或文件不完整。请保留 EXE 旁的 app、config、data 文件夹，不要只复制 EXE。");

                string node = FindNode(root);
                if (node == null)
                    throw new InvalidOperationException("没有找到 Node.js。请安装 Node.js，或把 node.exe 放在本工具文件夹内，再重新启动。");

                bool noOpen = Array.IndexOf(args, "--no-open") >= 0;
                var command = new StringBuilder(Quote(source));
                command.Append(" --no-open");
                foreach (string argument in args) command.Append(" ").Append(Quote(argument));

                string url = null;
                var info = new ProcessStartInfo(node, command.ToString());
                info.WorkingDirectory = root;
                info.UseShellExecute = false;
                info.CreateNoWindow = true;
                info.WindowStyle = ProcessWindowStyle.Hidden;
                info.RedirectStandardOutput = true;
                info.RedirectStandardError = true;
                info.StandardOutputEncoding = Encoding.UTF8;
                info.StandardErrorEncoding = Encoding.UTF8;
                server = new Process();
                server.StartInfo = info;
                server.EnableRaisingEvents = true;
                server.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e)
                {
                    if (e.Data == null) return;
                    lock (outputLock)
                    {
                        AppendLog(output, e.Data);
                        Match match = Regex.Match(e.Data, @"http://127\.0\.0\.1:\d+/");
                        if (match.Success) { url = match.Value; ready.Set(); }
                    }
                };
                server.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e)
                {
                    if (e.Data != null) lock (outputLock) AppendLog(output, e.Data);
                };
                server.Exited += delegate { ready.Set(); };
                server.Start();
                server.BeginOutputReadLine();
                server.BeginErrorReadLine();
                if (!ready.WaitOne(TimeSpan.FromSeconds(20)))
                    throw new InvalidOperationException("本地服务未能在 20 秒内启动，请检查工具文件和 Node.js 是否正常。");

                string readyUrl;
                lock (outputLock) readyUrl = url;
                if (readyUrl == null || server.HasExited)
                    throw new InvalidOperationException("本地服务启动失败。\n" + ReadLog(output, outputLock));

                if (!noOpen)
                {
                    // 直接交给默认浏览器，不经过 CMD 或脚本宿主。
                    Process.Start(new ProcessStartInfo(readyUrl) { UseShellExecute = true });
                }

                // 页面关闭后由原服务的心跳逻辑退出；启动器随服务一起退出。
                server.WaitForExit();
                int exitCode = server.ExitCode;
                if (exitCode != 0)
                    throw new InvalidOperationException("本地服务异常退出。\n" + ReadLog(output, outputLock));
                return 0;
            }
            catch (Exception error)
            {
                if (server != null)
                {
                    try { if (!server.HasExited) { server.Kill(); server.WaitForExit(3000); } }
                    catch { /* The process may already have exited. */ }
                }
                MessageBox.Show(error.Message, ProductName + " · 启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
            finally
            {
                if (server != null) server.Dispose();
            }
        }
    }

    private static void AppendLog(StringBuilder log, string line)
    {
        log.AppendLine(line);
        if (log.Length > 12000) log.Remove(0, log.Length - 12000);
    }

    private static string ReadLog(StringBuilder log, object sync)
    {
        lock (sync) return log.ToString();
    }

    private static string FindNode(string root)
    {
        var candidates = new List<string>();
        candidates.Add(Path.Combine(root, "node.exe"));
        candidates.Add(Path.Combine(root, "runtime", "node.exe"));
        foreach (string folder in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'))
        {
            string expanded = Environment.ExpandEnvironmentVariables(folder.Trim().Trim('"'));
            if (expanded.Length == 0) continue;
            try { candidates.Add(Path.Combine(expanded, "node.exe")); } catch (ArgumentException) { }
        }
        foreach (string key in new[] { "ProgramW6432", "ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA" })
        {
            string folder = Environment.GetEnvironmentVariable(key);
            if (!String.IsNullOrEmpty(folder)) candidates.Add(Path.Combine(folder, "nodejs", "node.exe"));
        }
        candidates.Add(@"D:\NodeJs\node.exe");
        foreach (string candidate in candidates) if (File.Exists(candidate)) return candidate;
        return null;
    }

    // Windows argv quoting, including quoted paths and trailing backslashes.
    private static string Quote(string value)
    {
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char ch in value)
        {
            if (ch == '\\') { slashes++; continue; }
            result.Append('\\', ch == '"' ? slashes * 2 + 1 : slashes);
            result.Append(ch);
            slashes = 0;
        }
        result.Append('\\', slashes * 2);
        return result.Append('"').ToString();
    }
}
