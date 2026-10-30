using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

// Experimental official-site window. Never receives passwords or exports cookies.
// No comment-writing endpoint is implemented in this probe.
internal static class Probe
{
    internal static void WindowReady(WindowActivation.Proof proof) {
        try { using(var writer=new StreamWriter(Console.OpenStandardOutput(),new System.Text.UTF8Encoding(false))){writer.WriteLine(new JavaScriptSerializer().Serialize(new{windowReady=true,visible=proof.Visible,foreground=proof.Foreground}));} } catch { }
    }
    internal static readonly string[] Regions = { "os_asia", "os_euro", "os_usa", "os_cht" };
    internal static double FitZoom(int width) { return Math.Max(0.5, Math.Min(1.0, width / 1280.0)); }
    internal static string Home(string platform) {
        if (platform == "cn") return "https://www.miyoushe.com/ys/";
        if (platform == "os") return "https://www.hoyolab.com/home";
        throw new ArgumentException("Unknown platform");
    }
    internal static string RoleUrl(string region) {
        if (Array.IndexOf(Regions, region) < 0) throw new ArgumentException("Unknown region");
        return "https://passport-api-sg.hoyoverse.com/account/binding/api/getUserGameRolesByCookieToken?game_biz=hk4e_global&region=" + region;
    }
    internal static int RoleCount(Dictionary<string, object> result, string region) {
        if (Array.IndexOf(Regions, region) < 0) return -1;
        var data = result.ContainsKey("data") ? result["data"] as Dictionary<string, object> : null;
        var list = data != null && data.ContainsKey("list") ? data["list"] as System.Collections.IList : null;
        if (list == null) return -1;
        int count = 0;
        foreach (object item in list) {
            var row = item as Dictionary<string, object>;
            if (row != null && row.ContainsKey("region") && Convert.ToString(row["region"]) == region && row.ContainsKey("game_uid") && !String.IsNullOrWhiteSpace(Convert.ToString(row["game_uid"]))) count++;
        }
        return count;
    }
    internal static bool Allowed(string platform, string url) {
        if (platform != "cn" && platform != "os") return false;
        Uri uri;
        if (!Uri.TryCreate(url, UriKind.Absolute, out uri) || uri.Scheme != "https" || uri.Port != 443 || uri.UserInfo.Length != 0) return false;
        string host = uri.DnsSafeHost.ToLowerInvariant();
        string[] domains = platform == "cn" ? new[] { "miyoushe.com", "mihoyo.com" } : new[] { "hoyolab.com", "hoyoverse.com" };
        foreach (string domain in domains) if (host == domain || host.EndsWith("." + domain, StringComparison.Ordinal)) return true;
        if (platform != "os") return false;
        // Official login may open an OAuth popup. Keep it in the same isolated profile.
        return host == "accounts.google.com" || host == "appleid.apple.com" || host == "account.apple.com"
            || host == "www.facebook.com" || host == "facebook.com" || host == "m.facebook.com"
            || host == "x.com" || host == "api.x.com" || host == "twitter.com" || host == "api.twitter.com";
    }
    [STAThread]
    private static int Main(string[] args) {
        if(args.Length>0&&args[0]=="--activate"){
            int pid;if(args.Length!=2||!Int32.TryParse(args[1],out pid)||pid<=0)return 2;
            var proof=WindowActivation.OwnedProcess(pid);if(proof==null)return 2;WindowReady(proof);return proof.Visible?0:2;
        }
        if(args.Length==1&&args[0]=="--activation-smoke")return WindowActivation.Smoke();
        if (args.Length == 1 && args[0] == "--smoke") {
            Application.EnableVisualStyles();
            var form = new Form { Width = 800, Height = 600, Opacity = 0, ShowInTaskbar = false };
            var web = new WebView2 { Dock = DockStyle.Fill }; form.Controls.Add(web);
            int result = 10;
            var timer = new System.Windows.Forms.Timer { Interval = 20000 };
            timer.Tick += delegate { form.Close(); };
            form.Shown += async delegate {
                timer.Start();
                try {
                    var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Path.GetTempPath(), "MiliastraAccountSmoke", Guid.NewGuid().ToString("N")), null);
                    await web.EnsureCoreWebView2Async(env);
                    web.CoreWebView2.Settings.IsPasswordAutosaveEnabled = false;
                    web.CoreWebView2.Settings.IsGeneralAutofillEnabled = false;
                    var loaded=new TaskCompletionSource<bool>();
                    web.CoreWebView2.NavigationCompleted+=delegate(object sender,CoreWebView2NavigationCompletedEventArgs e){loaded.TrySetResult(e.IsSuccess);};
                    web.NavigateToString("<html><body style='margin:0;min-width:1280px'><button id='login' style='position:absolute;left:1210px;top:20px;width:60px'>Login</button></body></html>");
                    if(await Task.WhenAny(loaded.Task,Task.Delay(10000))!=loaded.Task||!await loaded.Task)throw new IOException("Layout fixture did not load");
                    foreach(int width in new[]{740,900,1140}){
                        form.ClientSize=new Size(width,600);web.ZoomFactor=FitZoom(web.ClientSize.Width);await Task.Delay(150);
                        string visible=await web.ExecuteScriptAsync("document.querySelector('#login').getBoundingClientRect().right <= window.innerWidth");
                        if(visible!="true")throw new IOException("Right-hand login clipped at "+width);
                    }
                    web.ZoomFactor=1.25;await Task.Delay(100);if(Math.Abs(web.ZoomFactor-1.25)>0.001)throw new IOException("Manual zoom failed");
                    web.ZoomFactor=FitZoom(web.ClientSize.Width);
                    result = 0;
                } catch { result = 11; }
                finally { timer.Stop(); form.Close(); }
            };
            Application.Run(form); web.Dispose(); form.Dispose(); timer.Dispose(); return result;
        }
        if (args.Length == 1 && args[0] == "--self-test") {
            try {
                if (FitZoom(640)!=0.5 || FitZoom(960)!=0.75 || FitZoom(1280)!=1 || FitZoom(1920)!=1) return 13;
                if (!Allowed("cn", Home("cn")) || !Allowed("os", Home("os")) || !Allowed("os", "https://accounts.google.com/")) return 2;
                foreach (string url in new[] { "http://www.miyoushe.com/", "file:///C:/Windows/", "javascript:alert(1)", "https://www.miyoushe.com.evil.test/", "https://evil.test@miyoushe.com/", "https://www.miyoushe.com:8443/", "https://www.hoyolab.com/" }) if (Allowed("cn", url)) return 3;
                foreach (string url in new[] { "https://miyoushe.com/", "https://accounts.google.com.evil.test/", "https://accounts.google.com:8443/" }) if (Allowed("os", url)) return 4;
                foreach (string region in Regions) if (!RoleUrl(region).EndsWith(region)) return 5;
                try { RoleUrl("os_usa&region=cn_gf01"); return 6; } catch (ArgumentException) { }
                var serializer = new JavaScriptSerializer();
                var roles = serializer.Deserialize<Dictionary<string, object>>("{\"retcode\":0,\"data\":{\"list\":[{\"region\":\"os_asia\",\"game_uid\":\"123\"},{\"region\":\"os_usa\",\"game_uid\":\"456\"},{\"region\":\"os_asia\",\"game_uid\":\"\"}]}}");
                if (RoleCount(roles, "os_asia") != 1 || RoleCount(roles, "os_euro") != 0 || RoleCount(roles, "cn_gf01") != -1) return 9;
                if (RoleCount(serializer.Deserialize<Dictionary<string, object>>("{\"data\":{\"list\":[]}}"), "os_asia") != 0 || RoleCount(serializer.Deserialize<Dictionary<string, object>>("{\"data\":{}}"), "os_asia") != -1) return 12;
                if (String.IsNullOrEmpty(CoreWebView2Environment.GetAvailableBrowserVersionString())) return 7;
                return 0;
            } catch { return 8; }
        }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        string platform = args.Length == 0 ? null : args[0];
        if(args.Length>1||args.Length==1&&platform!="cn"&&platform!="os")return 2;
        if (platform != "cn" && platform != "os") {
            DialogResult choice = MessageBox.Show("选择要验证的官方登录：\n是：米游社（国服）\n否：HoYoLAB（国际服）", "官方登录验证 · 实验", MessageBoxButtons.YesNoCancel, MessageBoxIcon.Question);
            if (choice == DialogResult.Cancel) return 0;
            platform = choice == DialogResult.Yes ? "cn" : "os";
        }
        try { Application.Run(new LoginWindow(platform)); return 0; }
        catch { MessageBox.Show("登录验证窗口启动失败。请确认 WebView2 Runtime 和验证器旁的依赖文件完整。", "官方登录验证"); return 1; }
    }
}

internal static class WindowActivation
{
    internal sealed class Proof { internal bool Visible; internal bool Foreground; }
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window,int command);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool BringWindowToTop(IntPtr window);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr window,IntPtr after,int x,int y,int width,int height,uint flags);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window,out uint process);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern IntPtr GetLastActivePopup(IntPtr window);
    [DllImport("user32.dll",EntryPoint="GetWindowLongW")] private static extern int GetWindowLong(IntPtr window,int index);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window,out NativeRect rect);
    [StructLayout(LayoutKind.Sequential)] private struct NativeRect { internal int Left,Top,Right,Bottom; }
    internal static Proof Present(IntPtr main) {
        if(main==IntPtr.Zero)return new Proof();
        ShowWindow(main,9); // Restore minimized/hidden startup state.
        NativeRect rect;
        if(GetWindowRect(main,out rect)){
            var bounds=Rectangle.FromLTRB(rect.Left,rect.Top,rect.Right,rect.Bottom);bool onScreen=false;
            foreach(var screen in Screen.AllScreens)if(screen.WorkingArea.IntersectsWith(bounds))onScreen=true;
            if(!onScreen){var area=Screen.FromPoint(Cursor.Position).WorkingArea;SetWindowPos(main,IntPtr.Zero,area.Left+Math.Max(0,(area.Width-bounds.Width)/2),area.Top+Math.Max(0,(area.Height-bounds.Height)/2),0,0,0x15);}
        }
        var window=GetLastActivePopup(main);uint owner,mainOwner;GetWindowThreadProcessId(main,out mainOwner);GetWindowThreadProcessId(window,out owner);
        if(window==IntPtr.Zero||!IsWindowVisible(window)||owner!=mainOwner)window=main;
        bool wasTopmost=(GetWindowLong(window,-20)&8)!=0;
        ShowWindow(window,9);SetWindowPos(window,new IntPtr(-1),0,0,0,0,0x43);
        BringWindowToTop(window);SetForegroundWindow(window);
        if(!wasTopmost)SetWindowPos(window,new IntPtr(-2),0,0,0,0,0x53);
        uint foregroundOwner;GetWindowThreadProcessId(GetForegroundWindow(),out foregroundOwner);
        return new Proof{Visible=IsWindowVisible(window)&&!IsIconic(window),Foreground=foregroundOwner==mainOwner};
    }
    internal static Proof OwnedProcess(int pid) {
        try{
            using(var target=Process.GetProcessById(pid))using(var current=Process.GetCurrentProcess()){
                if(target.SessionId!=current.SessionId||!String.Equals(Path.GetFullPath(target.MainModule.FileName),Path.GetFullPath(System.Reflection.Assembly.GetExecutingAssembly().Location),StringComparison.OrdinalIgnoreCase))return null;
                for(int attempt=0;attempt<100;attempt++){
                    target.Refresh();if(target.HasExited)return null;
                    IntPtr window=target.MainWindowHandle;uint owner;GetWindowThreadProcessId(window,out owner);
                    if(window!=IntPtr.Zero&&owner==(uint)pid)return Present(window);
                    System.Threading.Thread.Sleep(50);
                }
            }
        }catch{}
        return null;
    }
    internal static int Smoke(){
        Application.EnableVisualStyles();var before=GetForegroundWindow();int result=20;bool restoreForeground=false;
        var form=new Form{Text="Miliastra activation test",Width=500,Height=220,Opacity=0,ShowInTaskbar=false};
        var timer=new System.Windows.Forms.Timer{Interval=10000};timer.Tick+=delegate{form.Close();};
        form.Shown+=async delegate{
            timer.Start();try{
                form.ShowInTaskbar=true;form.WindowState=FormWindowState.Minimized;
                var start=new ProcessStartInfo(System.Reflection.Assembly.GetExecutingAssembly().Location,"--activate "+Process.GetCurrentProcess().Id){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true};
                var output=await Task.Run(delegate{using(var helper=Process.Start(start)){string text=helper.StandardOutput.ReadToEnd();helper.WaitForExit();if(helper.ExitCode!=0)throw new IOException();return text;}});
                var proof=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(output);
                if(!Equals(proof["windowReady"],true)||!Equals(proof["visible"],true)||form.WindowState==FormWindowState.Minimized)throw new IOException();
                if(OwnedProcess(0)!=null)throw new IOException();result=0;
            }catch{result=21;}finally{uint owner;GetWindowThreadProcessId(GetForegroundWindow(),out owner);restoreForeground=owner==(uint)Process.GetCurrentProcess().Id;timer.Stop();form.Close();}
        };
        Application.Run(form);timer.Dispose();form.Dispose();if(restoreForeground&&before!=IntPtr.Zero)SetForegroundWindow(before);return result;
    }
}

internal sealed class LoginWindow : Form
{
    private readonly string platform;
    private readonly WebView2 view = new WebView2();
    private readonly Label origin = new Label();
    private readonly Label status = new Label();
    private readonly Button check = new Button();
    private readonly ComboBox regions = new ComboBox();
    private readonly ComboBox zoom = new ComboBox();
    private readonly Label zoomPercent = new Label();
    private readonly System.Windows.Forms.Timer resizeTimer = new System.Windows.Forms.Timer { Interval = 120 };
    private CoreWebView2Environment environment;
    private bool checking;
    private WebView2 roleView;
    private readonly List<Form> popups = new List<Form>();
    internal LoginWindow(string selected) {
        platform = selected;
        Text = "评论收集器 · 官方登录 · " + (platform == "cn" ? "米游社" : "HoYoLAB");
        Width = 1150; Height = 820; MinimumSize = new Size(760, 600); StartPosition = FormStartPosition.CenterScreen;
        var top = new TableLayoutPanel { Dock = DockStyle.Top, Height = 88, ColumnCount = 1, RowCount = 2, Padding = new Padding(8,4,8,4) };
        top.RowStyles.Add(new RowStyle(SizeType.Percent,50));top.RowStyles.Add(new RowStyle(SizeType.Percent,50));
        var navigation = new FlowLayoutPanel { Dock = DockStyle.Fill, WrapContents = false, Margin = new Padding(0) };
        var display = new FlowLayoutPanel { Dock = DockStyle.Fill, WrapContents = false, Margin = new Padding(0) };
        var home = new Button { Text = "返回官网", AutoSize = true };
        home.Click += delegate { if (view.CoreWebView2 != null) view.CoreWebView2.Navigate(Probe.Home(platform)); };
        regions.DropDownStyle = ComboBoxStyle.DropDownList; regions.Width = 120; regions.Items.AddRange(Probe.Regions); regions.SelectedIndex = 0;
        check.Text = "检查原神角色"; check.AutoSize = true; check.Enabled = false;
        check.Click += async delegate { await CheckRole(); };
        origin.AutoEllipsis = true; origin.Width = 240; origin.Padding = new Padding(6, 7, 0, 0);
        navigation.Controls.Add(home); navigation.Controls.Add(regions); navigation.Controls.Add(check); navigation.Controls.Add(origin);
        zoom.DropDownStyle=ComboBoxStyle.DropDownList;zoom.Width=120;zoom.Items.AddRange(new object[]{"适应窗口","50%","67%","75%","90%","100%","125%","150%"});zoom.SelectedIndex=0;
        zoom.SelectedIndexChanged+=delegate{ApplyZoom();};
        var smaller=new Button{Text="−",Width=36};var larger=new Button{Text="+",Width=36};
        smaller.AccessibleName="缩小官网";larger.AccessibleName="放大官网";
        smaller.Click+=delegate{StepZoom(-1);};larger.Click+=delegate{StepZoom(1);};
        zoomPercent.AutoSize=true;zoomPercent.Padding=new Padding(4,7,0,0);
        display.Controls.Add(new Label{Text="页面缩放",AutoSize=true,Padding=new Padding(0,7,0,0)});display.Controls.Add(zoom);display.Controls.Add(smaller);display.Controls.Add(larger);display.Controls.Add(zoomPercent);
        display.Controls.Add(new Label{Text="窄窗口看不到右上角账号入口时，选“适应窗口”。",AutoSize=true,Padding=new Padding(6,7,0,0)});
        top.Controls.Add(navigation,0,0);top.Controls.Add(display,0,1);
        status.Dock = DockStyle.Bottom; status.Height = 72; status.Padding = new Padding(12); status.BackColor = Color.FromArgb(245, 247, 251);
        status.Text = "请在官方页面登录。登录状态按平台独立保存在本机。回复与本人子回复删除，请回到收集器的评论列表操作；点击回复会自动匹配区服角色。";
        view.Dock = DockStyle.Fill; Controls.Add(view); Controls.Add(top); Controls.Add(status);
        resizeTimer.Tick+=delegate{resizeTimer.Stop();ApplyZoom();};
        view.SizeChanged+=delegate{resizeTimer.Stop();resizeTimer.Start();};
        if (platform == "cn") { regions.Visible = false; check.Visible = false; }
        Shown += async delegate {
            // Run after the initial ShowWindow call so inherited startup state cannot leave it minimized.
            BeginInvoke(new Action(delegate{if(!IsDisposed)Probe.WindowReady(WindowActivation.Present(Handle));}));
            await Initialize();
        };
        FormClosed += delegate { resizeTimer.Dispose();foreach (var child in popups.ToArray()) child.Close(); if (roleView != null) roleView.Dispose(); view.Dispose(); };
    }
    private void ApplyZoom(){
        if(view.CoreWebView2==null||view.IsDisposed)return;
        double factor=Probe.FitZoom(view.ClientSize.Width);
        if(zoom.SelectedIndex>0)factor=Double.Parse(((string)zoom.SelectedItem).TrimEnd('%'),System.Globalization.CultureInfo.InvariantCulture)/100.0;
        view.ZoomFactor=factor;zoomPercent.Text=Math.Round(factor*100)+"%";
    }
    private void StepZoom(int direction){
        double next=Math.Max(0.5,Math.Min(1.5,view.ZoomFactor+direction*0.1));
        string item=Math.Round(next*100)+"%";
        if(!zoom.Items.Contains(item))zoom.Items.Add(item);
        zoom.SelectedItem=item;
    }
    private async Task Initialize() {
        try {
            string profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MiliastraCommentCollector", "LoginProbe", platform);
            environment = await CoreWebView2Environment.CreateAsync(null, profile, null);
            await view.EnsureCoreWebView2Async(environment); Configure(view);
            view.CoreWebView2.Settings.IsZoomControlEnabled=false;ApplyZoom();
            view.CoreWebView2.SourceChanged += delegate {
                Uri uri; origin.Text = Uri.TryCreate(view.Source.AbsoluteUri, UriKind.Absolute, out uri) ? uri.GetLeftPart(UriPartial.Authority) : "";
            };
            view.CoreWebView2.NavigationCompleted += delegate(object sender, CoreWebView2NavigationCompletedEventArgs e) {
                ApplyZoom();
                if (!e.IsSuccess) status.Text = "官网加载失败（" + e.WebErrorStatus + "）。请检查网络后点返回官网；这不代表账号或密码错误。";
            };
            view.CoreWebView2.Navigate(Probe.Home(platform)); check.Enabled = true;
        } catch { status.Text = "无法初始化 WebView2。请确认 Microsoft Edge WebView2 Runtime 已安装，且依赖文件完整。"; }
    }
    private void Configure(WebView2 web) {
        web.CoreWebView2.Settings.AreDevToolsEnabled = false;
        web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
        web.CoreWebView2.Settings.IsPasswordAutosaveEnabled = false;
        web.CoreWebView2.Settings.IsGeneralAutofillEnabled = false;
        web.CoreWebView2.DownloadStarting += delegate(object sender, CoreWebView2DownloadStartingEventArgs e) { e.Cancel = true; };
        web.CoreWebView2.PermissionRequested += delegate(object sender, CoreWebView2PermissionRequestedEventArgs e) { e.State = CoreWebView2PermissionState.Deny; };
        web.CoreWebView2.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs e) {
            if (!Probe.Allowed(platform, e.Uri)) { e.Cancel = true; status.Text = "已阻止跳转到登录验证范围以外的地址。"; }
        };
        web.CoreWebView2.NewWindowRequested += async delegate(object sender, CoreWebView2NewWindowRequestedEventArgs e) {
            var deferral = e.GetDeferral(); e.Handled = true;
            try {
                if (!Probe.Allowed(platform, e.Uri)) { status.Text = "已阻止登录范围以外的弹窗。"; return; }
                var popup = new Form { Text = "官方登录 · 授权窗口", Width = 620, Height = 760, StartPosition = FormStartPosition.CenterParent };
                var child = new WebView2 { Dock = DockStyle.Fill }; popup.Controls.Add(child); popups.Add(popup);
                popup.FormClosed += delegate { popups.Remove(popup); child.Dispose(); };
                popup.Show(this); await child.EnsureCoreWebView2Async(environment); Configure(child);
                child.CoreWebView2.SourceChanged += delegate { Uri uri; if (Uri.TryCreate(child.Source.AbsoluteUri, UriKind.Absolute, out uri)) popup.Text = "官方授权 · " + uri.GetLeftPart(UriPartial.Authority); };
                child.CoreWebView2.WindowCloseRequested += delegate { popup.Close(); };
                e.NewWindow = child.CoreWebView2;
            } catch { status.Text = "无法打开官方授权弹窗。该登录方式尚未通过本地验证。"; }
            finally { deferral.Complete(); }
        };
    }
    private async Task CheckRole() {
        if (checking || environment == null || platform != "os") return;
        checking = true; check.Enabled = false; regions.Enabled = false;
        try {
            status.Text = "正在检查所选区服的官方原神角色。该检查不会验证或开放奇域发言权限。";
            string url = Probe.RoleUrl((string)regions.SelectedItem);
            roleView = new WebView2 { Width = 1, Height = 1, Left = -20, Top = -20 }; Controls.Add(roleView);
            await roleView.EnsureCoreWebView2Async(environment); Configure(roleView);
            var finished = new TaskCompletionSource<bool>();
            roleView.CoreWebView2.NavigationCompleted += delegate(object sender, CoreWebView2NavigationCompletedEventArgs e) { finished.TrySetResult(e.IsSuccess); };
            roleView.CoreWebView2.Navigate(url);
            if (await Task.WhenAny(finished.Task, Task.Delay(15000)) != finished.Task) { status.Text = "角色查询超时，不能判定登录是否成功；请检查网络后重试。"; return; }
            if (!await finished.Task) { status.Text = "角色查询网络失败，不能判定登录是否成功。"; return; }
            if (roleView.Source.AbsoluteUri != url) { status.Text = "角色接口发生跳转，尚未验证；请先在官网完成登录。"; return; }
            var serializer = new JavaScriptSerializer { MaxJsonLength = 1024 * 1024 };
            string text = serializer.Deserialize<string>(await roleView.ExecuteScriptAsync("document.body.innerText"));
            var result = serializer.Deserialize<Dictionary<string, object>>(text);
            object rawCode;
            if (result == null || !result.TryGetValue("retcode", out rawCode)) { status.Text = "角色接口没有返回可识别的结果，未验证。"; return; }
            int code = Convert.ToInt32(rawCode);
            if (code != 0) { status.Text = "官方角色接口未验证成功（返回码 " + code + "）。可能尚未登录、登录凭据不适用于此接口或存在官方限制，不能据此断言账号错误。"; return; }
            string region = (string)regions.SelectedItem; int count = Probe.RoleCount(result, region);
            if (count < 0) { status.Text = "角色接口结构尚未识别，未验证。"; return; }
            status.Text = "官方查询成功：" + region + " 有 " + count + " 个原神角色。回到收集器点击评论旁的回复，即可继续自动匹配账号和区服；发言权限由官方在提交时检查。";
        } catch { status.Text = "角色查询或解析失败，尚未验证角色权限；此次查询没有导出账号或登录凭据。"; }
        finally { if (roleView != null) { Controls.Remove(roleView); roleView.Dispose(); roleView = null; } checking = false; check.Enabled = true; regions.Enabled = true; }
    }
}
