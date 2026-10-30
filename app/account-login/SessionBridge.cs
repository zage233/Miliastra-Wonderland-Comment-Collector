using System;
using System.Collections.Generic;
using System.Collections;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

// Requests are restricted to official endpoints. Cookies stay inside this native helper.
internal static class SessionBridge
{
    internal static readonly string[] Regions = { "cn_gf01", "cn_qd01", "os_asia", "os_euro", "os_usa", "os_cht" };
    internal static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 1048576 };
    internal static string Value(Dictionary<string, object> row, string key) { return row != null && row.ContainsKey(key) ? Convert.ToString(row[key]) : ""; }
    internal static Dictionary<string, object> ObjectAt(Dictionary<string, object> row, string key) { return row != null && row.ContainsKey(key) ? row[key] as Dictionary<string, object> : null; }
    internal static object Error(string code) { return new { ok = false, code = code }; }
    private static void Output(object result) { using (var writer = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false))) { writer.WriteLine(Json.Serialize(result)); } }
    internal static string Platform(string region) { if (Array.IndexOf(Regions, region) < 0) throw new ArgumentException(); return region.StartsWith("os_") ? "os" : "cn"; }
    internal sealed class ReadResult { internal Dictionary<string, object> Data; internal bool Proxy; internal string Failure; }
    private static async Task<ReadResult> TryRead(Func<bool,CancellationToken,Task<Dictionary<string,object>>> request, bool proxy, CancellationToken token) {
        try { return new ReadResult { Data = await request(proxy,token), Proxy = proxy }; }
        catch(Exception error) { var network=error as WebException;if(network!=null && network.Response!=null)network.Response.Close();return new ReadResult { Failure=error.GetType().Name+(network==null?"":":"+network.Status) }; }
    }
    // Hedge only read-only GETs. The losing request is aborted, and writes never use this helper.
    internal static async Task<ReadResult> ReadFast(Func<bool,CancellationToken,Task<Dictionary<string,object>>> request, bool preferredProxy, int delay = 400) {
        using(var stop=new CancellationTokenSource()) {
            var first=TryRead(request,preferredProxy,stop.Token);
            if(await Task.WhenAny(first,Task.Delay(delay))==first && first.Result.Data!=null) return first.Result;
            var pending=new List<Task<ReadResult>> { first,TryRead(request,!preferredProxy,stop.Token) };
            ReadResult last=null;
            try {
                while(pending.Count!=0) { var done=await Task.WhenAny(pending);pending.Remove(done);last=await done;if(last.Data!=null)return last; }
                throw new IOException(last==null?"Network":last.Failure);
            } finally { stop.Cancel(); }
        }
    }
    private static async Task<bool> TestReadRoutes() {
        int calls=0;bool cancelled=false;
        var slow=await ReadFast(async delegate(bool proxy,CancellationToken token) {
            Interlocked.Increment(ref calls);
            if(!proxy){try{await Task.Delay(5000,token);}catch(OperationCanceledException){cancelled=true;throw;}}
            return new Dictionary<string,object>{{"retcode",0}};
        },false,10);
        await Task.Delay(20);
        if(!slow.Proxy || calls!=2 || !cancelled)return false;
        calls=0;
        var healthy=await ReadFast(delegate(bool proxy,CancellationToken token){calls++;return Task.FromResult(new Dictionary<string,object>{{"retcode",-100}});},false,10);
        if(healthy.Proxy || calls!=1 || Value(healthy.Data,"retcode")!="-100")return false;
        bool failed=false;try{await ReadFast(delegate(bool proxy,CancellationToken token){throw new IOException("fixture");},false,1);}catch(IOException){failed=true;}
        return failed;
    }
    internal sealed class ThreadProof { internal bool Found; internal bool Complete; internal string OwnerUid; }
    internal static async Task<object> VerifyDeletion(Func<Task<ThreadProof>> read, Func<Task<Dictionary<string,object>>> remove, string uid, int delay = 350) {
        ThreadProof before;
        try{before=await read();}catch{return Error("network");}
        if(!before.Found) return before.Complete?(object)new {ok=true,deleted=true,verified=true,alreadyAbsent=true}:new{ok=false,code="unknown",verification="incomplete"};
        if(before.OwnerUid!=uid)return Error("notOwner");
        var response=await remove(); // The only destructive request. Never retried.
        string code=Value(response,"retcode");
        if(code.Length==0)return Error("unknown");
        if(code!="0")return new {ok=false,code="rejected",retcode=code};
        string verification="readFailed";
        for(int attempt=0;attempt<3;attempt++){
            try{var after=await read();if(after.Complete&&!after.Found)return new {ok=true,deleted=true,verified=true,alreadyAbsent=false};verification=after.Found?"present":"incomplete";}catch{verification="readFailed";}
            if(attempt<2)await Task.Delay(delay);
        }
        return new {ok=false,code="unknown",acknowledged=true,verification=verification};
    }
    private static Dictionary<string,object> Result(object value){return Json.Deserialize<Dictionary<string,object>>(Json.Serialize(value));}
    private static async Task<bool> TestDeletion() {
        int reads=0,posts=0;
        var success=Result(await VerifyDeletion(()=>Task.FromResult(new ThreadProof{Found=++reads==1,Complete=true,OwnerUid="123"}),()=>{posts++;return Task.FromResult(new Dictionary<string,object>{{"retcode",0}});},"123",1));
        if(!Equals(success["ok"],true)||!Equals(success["verified"],true)||posts!=1||reads!=2)return false;
        reads=0;posts=0;
        var retained=Result(await VerifyDeletion(()=>{reads++;return Task.FromResult(new ThreadProof{Found=true,Complete=true,OwnerUid="123"});},()=>{posts++;return Task.FromResult(new Dictionary<string,object>{{"retcode",0}});},"123",1));
        if(Value(retained,"code")!="unknown"||posts!=1||reads!=4)return false;
        posts=0;
        var absent=Result(await VerifyDeletion(()=>Task.FromResult(new ThreadProof{Complete=true}),()=>{posts++;throw new Exception();},"123",1));
        if(!Equals(absent["alreadyAbsent"],true)||posts!=0)return false;
        var incomplete=Result(await VerifyDeletion(()=>Task.FromResult(new ThreadProof{Complete=false}),()=>{posts++;throw new Exception();},"123",1));
        if(Value(incomplete,"code")!="unknown"||posts!=0)return false;
        var foreign=Result(await VerifyDeletion(()=>Task.FromResult(new ThreadProof{Found=true,Complete=true,OwnerUid="999"}),()=>{posts++;throw new Exception();},"123",1));
        if(Value(foreign,"code")!="notOwner"||posts!=0)return false;
        reads=0;posts=0;
        var failedRead=Result(await VerifyDeletion(delegate {if(++reads==1)return Task.FromResult(new ThreadProof{Found=true,OwnerUid="123"});throw new IOException();},()=>{posts++;return Task.FromResult(new Dictionary<string,object>{{"retcode",0}});},"123",1));
        if(Value(failedRead,"code")!="unknown"||posts!=1||reads!=4)return false;
        reads=0;posts=0;
        var rejected=Result(await VerifyDeletion(()=>{reads++;return Task.FromResult(new ThreadProof{Found=true,OwnerUid="123"});},()=>{posts++;return Task.FromResult(new Dictionary<string,object>{{"retcode",-1}});},"123",1));
        if(Value(rejected,"code")!="rejected"||posts!=1||reads!=1)return false;
        return true;
    }
    [STAThread]
    private static int Main(string[] args) {
        if (args.Length == 1 && args[0] == "--self-test") {
            var sample = Json.Deserialize<Dictionary<string, object>>("{\"region\":\"cn_gf01\",\"content\":\"中文😀\\nreply\",\"levelId\":\"111111111\",\"aid\":\"10001\",\"uid\":\"700000001\",\"parentReplyId\":\"p-1\",\"subReplyId\":\"c-1\"}");
            if (!ValidCommand(sample,"cn_gf01") || ValidCommand(sample,"os_usa")) return 2;
            sample["content"] = new String('x',201); if(ValidCommand(sample,"cn_gf01")) return 3;
            sample["content"] = "test"; sample["levelId"] = "1&region=os_usa"; if(ValidCommand(sample,"cn_gf01")) return 4;
            sample["levelId"] = "111111111"; sample["ownerUid"] = "700000001";
            if(!ValidCommand(sample,"cn_gf01","delete")) return 5;
            sample["ownerUid"] = "999"; if(ValidCommand(sample,"cn_gf01","delete")) return 6;
            sample["ownerUid"] = "700000001"; sample["subReplyId"] = "p-1"; if(ValidCommand(sample,"cn_gf01","delete")) return 7;
            sample["subReplyId"] = ""; if(ValidCommand(sample,"cn_gf01","delete")) return 8;
            sample["subReplyId"]="c-1";sample.Remove("aid");
            if(!ValidCommand(sample,"cn_gf01","verify")||ValidCommand(sample,"cn_gf01","delete"))return 11;
            if(!TestReadRoutes().GetAwaiter().GetResult())return 9;
            if(!TestDeletion().GetAwaiter().GetResult())return 10;
            Output(new { ok = true }); return 0;
        }
        if (args.Length != 2 || (args[0] != "--prepare" && args[0] != "--send" && args[0] != "--delete" && args[0] != "--verify-delete") || Array.IndexOf(Regions, args[1]) < 0) { Output(Error("invalid")); return 1; }
        Dictionary<string, object> command = null;
        if (args[0] != "--prepare") {
            try {
                using (var input = new StreamReader(Console.OpenStandardInput(), Encoding.UTF8)) {
                    char[] buffer = new char[8193]; int length = 0, read;
                    while (length < buffer.Length && (read = input.Read(buffer, length, buffer.Length - length)) > 0) length += read;
                    if (length > 8192) throw new ArgumentException();
                    command = Json.Deserialize<Dictionary<string, object>>(new String(buffer, 0, length));
                }
                if (!ValidCommand(command, args[1], args[0] == "--delete" ? "delete" : args[0] == "--verify-delete" ? "verify" : "send")) throw new ArgumentException();
            } catch { Output(Error("invalid")); return 1; }
        }
        string region = args[1]; object result = Error("network");
        var watch=System.Diagnostics.Stopwatch.StartNew();long initializationMs=0,verificationMs=0;
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        var form = new Form { Width = 800, Height = 600, Opacity = 0, ShowInTaskbar = false };
        var web = new WebView2 { Dock = DockStyle.Fill }; form.Controls.Add(web);
        var timer = new System.Windows.Forms.Timer { Interval = args[0] == "--send" || args[0] == "--delete" ? 65000 : 45000 };
        timer.Tick += delegate { if (command != null) result = Error(args[0]=="--verify-delete"?"network":"unknown"); form.Close(); };
        form.Shown += async delegate {
            timer.Start();
            OfficialSession reader = null;
            try {
                reader = new OfficialSession(web, region);
                await reader.Initialize();
                initializationMs=watch.ElapsedMilliseconds;
                result = command == null ? await reader.Prepare() : args[0] == "--delete" ? await reader.Delete(command) : args[0] == "--verify-delete" ? await reader.VerifyOnly(command) : await reader.Send(command);
                verificationMs=watch.ElapsedMilliseconds-initializationMs;
            } catch { result = new { ok = false, code = reader != null && (reader.Stage == "send" || reader.Stage == "delete") ? "unknown" : "network", stage = reader == null ? "initialize" : reader.Stage, diagnostic = reader == null ? "" : reader.LastFailure }; }
            finally { timer.Stop(); if (!form.IsDisposed) form.Close(); }
        };
        Application.Run(form); timer.Dispose(); web.Dispose(); form.Dispose();
        var output=Json.Deserialize<Dictionary<string,object>>(Json.Serialize(result));
        output["timing"]=new { initializationMs=initializationMs,verificationMs=verificationMs,totalMs=watch.ElapsedMilliseconds };
        Output(output); return 0;
    }
    internal static bool ValidCommand(Dictionary<string, object> command, string region, string mode = "send") {
        string content = Value(command, "content");
        if (Value(command, "region") != region) return false;
        if (mode == "send" && (content.Trim().Length == 0 || content.Length > 200 || Regex.IsMatch(content, "[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f]"))) return false;
        foreach (string key in mode=="verify"?new[]{"levelId","uid"}:new[] { "levelId", "uid", "aid" }) if (!Regex.IsMatch(Value(command, key), "^[0-9]{1,32}$")) return false;
        if (!Regex.IsMatch(Value(command, "parentReplyId"), "^[A-Za-z0-9_-]{1,128}$")) return false;
        string sub = Value(command, "subReplyId");
        if (mode != "send" && (sub.Length == 0 || sub == Value(command,"parentReplyId") || Value(command,"ownerUid") != Value(command,"uid"))) return false;
        return sub.Length == 0 || Regex.IsMatch(sub, "^[A-Za-z0-9_-]{1,128}$");
    }
}

internal sealed class OfficialSession
{
    private readonly WebView2 web;
    private readonly string region, platform;
    internal string Stage = "initialize";
    internal string LastFailure = "";
    private readonly Dictionary<string, bool> routes = new Dictionary<string, bool>();
    internal OfficialSession(WebView2 browser, string selected) { web = browser; region = selected; platform = SessionBridge.Platform(region); }
    internal async Task Initialize() {
        string profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MiliastraCommentCollector", "LoginProbe", platform);
        var env = await CoreWebView2Environment.CreateAsync(null, profile, null);
        await web.EnsureCoreWebView2Async(env);
        web.CoreWebView2.Settings.IsPasswordAutosaveEnabled = false;
        web.CoreWebView2.Settings.AreDevToolsEnabled = false;
        web.CoreWebView2.PermissionRequested += delegate(object sender, CoreWebView2PermissionRequestedEventArgs e) { e.State = CoreWebView2PermissionState.Deny; };
        web.CoreWebView2.DownloadStarting += delegate(object sender, CoreWebView2DownloadStartingEventArgs e) { e.Cancel = true; };
        web.CoreWebView2.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs e) { e.Cancel = true; };
    }
    private async Task<Dictionary<string, object>> Read(string url) {
        try{var result=await SessionBridge.ReadFast((proxy,token)=>Request(url,null,proxy,token),platform!="cn");
        routes[new Uri(url).Host]=result.Proxy;return result.Data;}
        catch(Exception error){LastFailure=new Uri(url).Host+":"+error.Message;throw;}
    }
    private async Task<Dictionary<string, object>> Request(string url, string body, bool proxy, CancellationToken stop = default(CancellationToken)) {
        stop.ThrowIfCancellationRequested();
        var uri = new Uri(url);
        string[] hosts = platform == "cn" ? new[] { "bbs-api.miyoushe.com", "api-takumi.miyoushe.com", "passport-api.mihoyo.com" }
            : new[] { "bbs-api-os.hoyolab.com", "api-os-takumi.hoyolab.com", "passport-api-sg.hoyoverse.com" };
        if (uri.Scheme != "https" || uri.Port != 443 || uri.UserInfo.Length != 0 || Array.IndexOf(hosts, uri.Host) < 0) throw new ArgumentException();
        var cookies = await web.CoreWebView2.CookieManager.GetCookiesAsync(url);
        stop.ThrowIfCancellationRequested();
        var cookieParts = new List<string>();
        foreach (var cookie in cookies) if (!cookie.Name.Contains("\r") && !cookie.Name.Contains("\n") && !cookie.Value.Contains("\r") && !cookie.Value.Contains("\n")) cookieParts.Add(cookie.Name + "=" + cookie.Value);
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
        var request = (HttpWebRequest)WebRequest.Create(uri);
        request.Method = body == null ? "GET" : "POST"; request.AllowAutoRedirect = false;
        request.Proxy = proxy ? WebRequest.DefaultWebProxy : null;
        request.UserAgent = web.CoreWebView2.Settings.UserAgent;
        request.Accept = "application/json";
        string origin = body == null ? (platform == "cn" ? "https://www.miyoushe.com" : "https://www.hoyolab.com") : (platform == "cn" ? "https://act.miyoushe.com" : "https://act.hoyolab.com");
        request.Referer = origin + "/"; request.Headers["Origin"] = origin;
        request.Headers["x-rpc-client_type"] = "4";
        request.Headers["x-rpc-language"] = "zh-cn";
        if (body != null) {
            string deviceFile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MiliastraCommentCollector", "LoginProbe", platform, "collector-device-id.txt");
            Guid device; string existing = File.Exists(deviceFile) ? File.ReadAllText(deviceFile).Trim() : "";
            if (!Guid.TryParse(existing, out device)) { device = Guid.NewGuid(); File.WriteAllText(deviceFile, device.ToString()); }
            request.Headers["x-rpc-device_id"] = device.ToString();
        }
        request.Headers[HttpRequestHeader.Cookie] = String.Join("; ", cookieParts.ToArray());
        using (var cancel = CancellationTokenSource.CreateLinkedTokenSource(stop))
        using (cancel.Token.Register(delegate { try{request.Abort();}catch{} })) {
            cancel.CancelAfter(12000);
            if (body != null) {
                byte[] bytes = Encoding.UTF8.GetBytes(body); request.ContentType = "application/json;charset=UTF-8"; request.ContentLength = bytes.Length;
                using (var stream = await request.GetRequestStreamAsync()) await stream.WriteAsync(bytes, 0, bytes.Length);
            }
            using (var response = (HttpWebResponse)await request.GetResponseAsync())
            using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8)) {
                var text = new StringBuilder(); char[] buffer = new char[4096]; int count;
                while ((count = await reader.ReadAsync(buffer, 0, buffer.Length)) > 0) { text.Append(buffer, 0, count); if (text.Length > 1048576) throw new IOException("Response too large"); }
                return SessionBridge.Json.Deserialize<Dictionary<string, object>>(text.ToString());
            }
        }
    }
    private async Task<string> Aid(string url) {
        var cookies = await web.CoreWebView2.CookieManager.GetCookiesAsync(url);
        foreach (string name in new[] { "account_id_v2", "account_id", "ltuid_v2", "ltuid" })
            foreach (var cookie in cookies) if (cookie.Name == name && !String.IsNullOrWhiteSpace(cookie.Value)) return cookie.Value;
        return "";
    }
    internal async Task<object> Prepare() {
        string bbs = platform == "cn" ? "https://bbs-api.miyoushe.com" : "https://bbs-api-os.hoyolab.com";
        string passport = platform == "cn" ? "https://passport-api.mihoyo.com" : "https://passport-api-sg.hoyoverse.com";
        string communityAid = await Aid(bbs + "/"), passportAid = await Aid(passport + "/");
        if (communityAid.Length == 0) {
            string siteAid = await Aid(platform == "cn" ? "https://www.miyoushe.com/" : "https://www.hoyolab.com/");
            return new { ok = false, code = "loginRequired", diagnostic = new { communityIdentity = communityAid.Length != 0, passportIdentity = passportAid.Length != 0, siteIdentity = siteAid.Length != 0 } };
        }
        if (passportAid.Length != 0 && communityAid != passportAid) return SessionBridge.Error("accountMismatch");
        string profileUrl = bbs + (platform == "cn" ? "/user/wapi/getUserFullInfo?gids=2" : "/community/painter/wapi/user/full");
        string game = platform == "cn" ? "hk4e_cn" : "hk4e_global";
        string roleUrl = passportAid.Length != 0 ? passport + "/account/binding/api/getUserGameRolesByCookieToken?game_biz=" + game + "&region=" + region
            : (platform == "cn" ? "https://api-takumi.miyoushe.com/binding/api/getUserGameRolesByCookie?game_biz=" : "https://api-os-takumi.hoyolab.com/binding/api/getUserGameRolesByCookie?game_biz=") + game + "&region=" + region;
        Stage = "identity-and-roles";
        var identityTask=Read(profileUrl);var rolesTask=Read(roleUrl);
        await Task.WhenAll(identityTask,rolesTask);
        var accountResponse=identityTask.Result;
        if (SessionBridge.Value(accountResponse, "retcode") != "0") return SessionBridge.Error("loginRequired");
        var user = SessionBridge.ObjectAt(SessionBridge.ObjectAt(accountResponse, "data"), "user_info");
        string name = SessionBridge.Value(user, "nickname");
        var response=rolesTask.Result;
        if (SessionBridge.Value(response, "retcode") != "0") return new { ok = false, code = "roleUnavailable", retcode = SessionBridge.Value(response, "retcode") };
        var data = SessionBridge.ObjectAt(response, "data");
        var list = data != null && data.ContainsKey("list") ? data["list"] as IList : null;
        if (list == null) return SessionBridge.Error("roleUnavailable");
        var roles = new List<object>(); var seen = new HashSet<string>();
        foreach (object item in list) {
            var row = item as Dictionary<string, object>;
            string uid = SessionBridge.Value(row, "game_uid");
            if (SessionBridge.Value(row, "region") == region && uid.Length != 0 && seen.Add(uid)) roles.Add(new { uid = uid, name = SessionBridge.Value(row, "nickname"), region = region });
        }
        if (roles.Count == 0) return SessionBridge.Error("noRole");
        return new { ok = true, platform = platform, region = region, account = new { aid = communityAid, name = name }, roles = roles, roleSource = game };
    }
    internal async Task<object> Send(Dictionary<string, object> command) {
        // Recheck ownership and target region immediately before the one permitted POST.
        var prepared = SessionBridge.Json.Deserialize<Dictionary<string, object>>(SessionBridge.Json.Serialize(await Prepare()));
        if (!prepared.ContainsKey("ok") || !Equals(prepared["ok"], true)) return prepared;
        var account = SessionBridge.ObjectAt(prepared, "account");
        if (SessionBridge.Value(account, "aid") != SessionBridge.Value(command, "aid")) return SessionBridge.Error("accountMismatch");
        bool found = false;
        foreach (object item in (IList)prepared["roles"]) {
            var role = item as Dictionary<string, object>;
            if (SessionBridge.Value(role, "uid") == SessionBridge.Value(command, "uid") && SessionBridge.Value(role, "region") == region) found = true;
        }
        if (!found) return SessionBridge.Error("noRole");
        var body = new { uid = SessionBridge.Value(command, "uid"), region = region, level_id = SessionBridge.Value(command, "levelId"),
            parent_reply_id = SessionBridge.Value(command, "parentReplyId"), sub_reply_id = SessionBridge.Value(command, "subReplyId"), content = SessionBridge.Value(command, "content") };
        string bbs = platform == "cn" ? "https://bbs-api.miyoushe.com" : "https://bbs-api-os.hoyolab.com";
        bool proxy;
        if (!routes.TryGetValue(new Uri(bbs).Host, out proxy)) return SessionBridge.Error("network");
        Stage = "send";
        try {
            // No retry or route fallback after a POST: a lost response may already have been applied.
            var response = await Request(bbs + "/community/ugc_community/web/api/subreply/post?lang=zh-cn", SessionBridge.Json.Serialize(body), proxy);
            string code = SessionBridge.Value(response, "retcode");
            if (code != "0") return new { ok = false, code = "rejected", retcode = code };
            var reply = SessionBridge.ObjectAt(SessionBridge.ObjectAt(response, "data"), "reply_info");
            if (reply != null) {
                foreach (string key in new[] { "level_id", "parent_reply_id", "region" }) {
                    string value = SessionBridge.Value(reply, key), wanted = key == "level_id" ? body.level_id : key == "parent_reply_id" ? body.parent_reply_id : region;
                    if (value.Length != 0 && value != wanted) reply = null;
                    if (reply == null) break;
                }
            }
            return new { ok = true, reply = reply };
        } catch (WebException error) {
            var response = error.Response as HttpWebResponse;
            if (response != null) { int status = (int)response.StatusCode; response.Dispose(); if (status >= 400 && status < 500) return new { ok = false, code = "rejected", retcode = "HTTP " + status }; }
            return SessionBridge.Error("unknown");
        } catch { return SessionBridge.Error("unknown"); }
    }
    private async Task<SessionBridge.ThreadProof> ReadThread(Dictionary<string,object> command, string bbs, bool proxy) {
        string next="",sort="SORT_TYPE_FLOOR_DESC";var cursors=new HashSet<string>();int total=0;
        for(int page=0;page<50 && total<1000;page++){
            if(!cursors.Add(next+":"+sort))return new SessionBridge.ThreadProof();
            var body=new {parent_reply_id=SessionBridge.Value(command,"parentReplyId"),uid=SessionBridge.Value(command,"uid"),region=region,level_id=SessionBridge.Value(command,"levelId"),cursor=new {next=next,size=15,sort_type=sort}};
            var response=await Request(bbs+"/community/ugc_community/web/api/level/reply/sub_replies?lang=zh-cn",SessionBridge.Json.Serialize(body),proxy);
            if(SessionBridge.Value(response,"retcode")!="0")throw new IOException("Thread lookup failed");
            var data=SessionBridge.ObjectAt(response,"data");var rows=data!=null&&data.ContainsKey("reply_list")?data["reply_list"] as IList:null;
            var cursor=SessionBridge.ObjectAt(data,"cursor");
            if(rows==null||cursor==null||!cursor.ContainsKey("has_more")||!(cursor["has_more"] is bool))throw new IOException("Invalid thread response");
            var stack=new Stack<object>();foreach(object row in rows)stack.Push(row);
            while(stack.Count!=0){
                if(++total>1000)return new SessionBridge.ThreadProof();
                var row=stack.Pop() as Dictionary<string,object>;if(row==null)throw new IOException("Invalid reply");
                foreach(string key in new[]{"level_id","parent_reply_id","region"}){
                    string wanted=key=="level_id"?body.level_id:key=="parent_reply_id"?body.parent_reply_id:region;
                    if(row.ContainsKey(key)&&SessionBridge.Value(row,key)!=wanted)throw new IOException("Reply context changed");
                }
                if(SessionBridge.Value(row,"reply_id")==SessionBridge.Value(command,"subReplyId"))return new SessionBridge.ThreadProof{Found=true,OwnerUid=SessionBridge.Value(SessionBridge.ObjectAt(row,"user_info"),"uid")};
                var children=row.ContainsKey("sub_replies")?row["sub_replies"] as IList:null;
                if(children!=null)foreach(object child in children)stack.Push(child);
            }
            if(!(bool)cursor["has_more"])return new SessionBridge.ThreadProof{Complete=true};
            next=SessionBridge.Value(cursor,"next");if(rows.Count==0||next.Length==0||next.Length>512)return new SessionBridge.ThreadProof();
            string order=SessionBridge.Value(cursor,"sort_type");if(order.Length!=0)sort=order;
        }
        return new SessionBridge.ThreadProof();
    }
    internal async Task<object> VerifyOnly(Dictionary<string,object> command) {
        var prepared=SessionBridge.Json.Deserialize<Dictionary<string,object>>(SessionBridge.Json.Serialize(await Prepare()));
        if(!prepared.ContainsKey("ok")||!Equals(prepared["ok"],true))return prepared;
        string uid=SessionBridge.Value(command,"uid");bool owned=false;
        foreach(object item in (IList)prepared["roles"]){var role=item as Dictionary<string,object>;if(SessionBridge.Value(role,"uid")==uid&&SessionBridge.Value(role,"region")==region)owned=true;}
        if(!owned||uid!=SessionBridge.Value(command,"ownerUid"))return SessionBridge.Error("notOwner");
        string bbs=platform=="cn"?"https://bbs-api.miyoushe.com":"https://bbs-api-os.hoyolab.com";bool proxy;
        if(!routes.TryGetValue(new Uri(bbs).Host,out proxy))return SessionBridge.Error("network");
        Stage="verify-delete";
        var proof=await ReadThread(command,bbs,proxy);
        if(proof.Found&&proof.OwnerUid!=uid)return SessionBridge.Error("notOwner");
        return proof.Found?(object)new{ok=true,deleted=false,present=true,verified=true}:proof.Complete?(object)new{ok=true,deleted=true,verified=true}:new{ok=false,code="unknown",verification="incomplete"};
    }
    internal async Task<object> Delete(Dictionary<string, object> command) {
        var prepared = SessionBridge.Json.Deserialize<Dictionary<string, object>>(SessionBridge.Json.Serialize(await Prepare()));
        if (!prepared.ContainsKey("ok") || !Equals(prepared["ok"], true)) return prepared;
        if (SessionBridge.Value(SessionBridge.ObjectAt(prepared,"account"),"aid") != SessionBridge.Value(command,"aid")) return SessionBridge.Error("accountMismatch");
        string uid = SessionBridge.Value(command,"uid"); bool owned = false;
        foreach(object item in (IList)prepared["roles"]) {
            var role = item as Dictionary<string,object>;
            if(SessionBridge.Value(role,"uid") == uid && SessionBridge.Value(role,"region") == region) owned = true;
        }
        if(!owned || uid != SessionBridge.Value(command,"ownerUid")) return SessionBridge.Error("notOwner");
        string bbs = platform == "cn" ? "https://bbs-api.miyoushe.com" : "https://bbs-api-os.hoyolab.com";
        bool proxy; if(!routes.TryGetValue(new Uri(bbs).Host,out proxy)) return SessionBridge.Error("network");
        var body = new { uid = uid, region = region, level_id = SessionBridge.Value(command,"levelId"), sub_reply_id = SessionBridge.Value(command,"subReplyId") };
        Stage = "delete-preflight";
        try {
            return await SessionBridge.VerifyDeletion(()=>ReadThread(command,bbs,proxy),async delegate {
                Stage="delete";
                return await Request(bbs + "/community/ugc_community/web/api/subreply/delete?lang=zh-cn",SessionBridge.Json.Serialize(body),proxy);
            },uid);
        } catch(WebException error) {
            var response = error.Response as HttpWebResponse;
            if(response != null) { int status = (int)response.StatusCode;response.Dispose();if(status >= 400 && status < 500)return new { ok = false, code = "rejected", retcode = "HTTP " + status }; }
            return SessionBridge.Error("unknown");
        } catch { return SessionBridge.Error("unknown"); }
    }
}
