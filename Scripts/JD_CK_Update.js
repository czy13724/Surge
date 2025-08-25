/**
 * 京东Cookie自动获取同步青龙
 * 支持qx,surge,loon
 * 作者: Levi
 * 配置说明:
 * 1. 在对应客户端中配置持久化存储:
 *    - qinglongHost: 青龙面板地址 (如: http://192.168.1.1:5700)
 *    - clientId: 青龙应用ID
 *    - clientSecret: 青龙应用密钥
 * 
 * 2. 添加规则:
 * Surge
 * [script]
 * 京东获取token = type=http-request,pattern=^https?:\/\/api\.m\.jd\.com\/client\.action\?functionId=(wareBusiness|serverConfig|basicConfig|logConfig),requires-body=1,max-size=0,script-path=https://raw.githubusercontent.com/czy13724/Surge/main/quote/JD_CK_Update.js
 * Loon
 * [Script]
 * http-request ^https?:\/\/api\.m\.jd\.com\/client\.action\?functionId=(wareBusiness|serverConfig|basicConfig|logConfig) script-path=https://raw.githubusercontent.com/czy13724/Surge/main/quote/JD_CK_Update.js,requires-body=true,timeout=60,tag=京东获取token
 * QuantumultX
 * [rewrite_local]
 * ^https?:\/\/api\.m\.jd\.com\/client\.action\?functionId=(wareBusiness|serverConfig|basicConfig|logConfig) url script-request-header https://raw.githubusercontent.com/czy13724/Surge/main/quote/JD_CK_Update.js
 * 
 * 3. 添加MITM:
 * hostname = api.m.jd.com
 */

const $ = new Env('京东Cookie同步青龙');

!(async () => {
    // 获取配置参数
    const qinglongHost  = $.getval('qinglongHost')  || '';
    const clientId      = $.getval('clientId')      || '';
    const clientSecret  = $.getval('clientSecret')  || '';
    
    // 参数验证
    if (!qinglongHost || !clientId || !clientSecret) {
        $.msg('京东Cookie更新', '配置错误', '请先配置青龙面板相关参数\n设置: qinglongHost、clientId、clientSecret');
        $.log('❌ 缺少必要配置参数');
        $.done();
        return;
    }
    
    // 从请求头获取 Cookie
    let cookies = '';
    if ($request && $request.headers) {
        cookies = $request.headers['Cookie'] || $request.headers['cookie'] || '';
    }
    if (!cookies && typeof $request !== 'undefined') {
        for (const key of Object.keys($request.headers || {})) {
            if (key.toLowerCase() === 'cookie') {
                cookies = $request.headers[key];
                break;
            }
        }
    }
    
    $.log(`🔍 获取到的Cookie字符串: ${cookies ? cookies.substring(0,100) + '...' : '空'}`);
    if (!cookies) {
        $.msg('京东Cookie更新', '获取失败', '无法从请求头中获取Cookie');
        $.done();
        return;
    }
    
    // 提取 pt_pin 和 pt_key
    const ptPinMatch = cookies.match(/pt_pin=([^;]+)/);
    const ptKeyMatch = cookies.match(/pt_key=([^;]+)/);
    if (!ptPinMatch || !ptKeyMatch) {
        $.log('❌ Cookie 中缺少 pt_pin 或 pt_key');
        $.msg('京东Cookie更新', '解析失败', 'Cookie 中缺少 pt_pin 或 pt_key');
        $.done();
        return;
    }
    
    // 处理 pt_pin 解码
    let ptPin = ptPinMatch[1];
    try { ptPin = decodeURIComponent(ptPin); } catch {}
    const ptKey   = ptKeyMatch[1];
    const jdCookie = `pt_key=${ptKey};pt_pin=${encodeURIComponent(ptPin)};`;
    
    $.log(`📱 用户: ${ptPin}`);
    $.log(`🔑 Cookie长度: ${jdCookie.length}`);
    
    // 更新间隔（10 分钟）
    const lastUpdateKey  = `jd_cookie_update_${ptPin}`;
    const lastUpdateTime = parseInt($.getval(lastUpdateKey) || '0', 10);
    const now            = Date.now();
    const updateInterval = 10 * 60 * 1000; // 10 分钟
    
    if (now - lastUpdateTime < updateInterval) {
        $.log('⏰ 距离上次更新不足 10 分钟，跳过');
        $.done();
        return;
    }
    
    try {
        // 1. 获取青龙 Token
        const token = await getQinglongToken(qinglongHost, clientId, clientSecret);
        if (!token) throw new Error('获取青龙Token失败');
        $.log('✅ 获取青龙Token成功');
        
        // 2. 查找或创建 JD_COOKIE 环境变量
        let envId = await getQinglongEnvId(qinglongHost, token, ptPin);
        if (!envId) {
            $.log('📝 未找到 JD_COOKIE 环境变量，开始创建');
            envId = await createQinglongEnv(qinglongHost, token, ptPin, jdCookie);
            if (!envId) throw new Error('创建环境变量失败');
            $.log(`✅ 创建环境变量 ID: ${envId}`);
        } else {
            $.log(`✅ 找到环境变量 ID: ${envId}`);
        }
        
        // 3. 更新值并启用
        await Promise.all([
            updateQinglongEnvValue( qinglongHost, token, envId, ptPin, jdCookie ),
            updateQinglongEnvStatus(qinglongHost, token, envId)
        ]);
        
        // 4. 记录更新时间
        $.setval(now.toString(), lastUpdateKey);
        
        $.msg('京东Cookie更新', '更新成功', `用户: ${ptPin}\n时间: ${new Date(now).toLocaleString()}`);
        $.log('🎉 Cookie 更新成功');
        
    } catch (e) {
        $.msg('京东Cookie更新', '更新失败', `用户: ${ptPin}\n错误: ${e.message}`);
        $.log(`❌ 错误: ${e.message}`);
    }
    
    $.done();
})();

// 获取青龙 Token
function getQinglongToken(host, id, secret) {
    return new Promise(resolve => {
        const url = `${host}/open/auth/token?client_id=${id}&client_secret=${secret}`;
        $.get(url, (err, resp, body) => {
            try {
                if (err) throw err;
                const res = typeof body === 'string' ? JSON.parse(body) : body;
                if (res.code === 200 && res.data?.token) return resolve(res.data.token);
                throw new Error(res.message || '未知错误');
            } catch {
                resolve(null);
            }
        });
    });
}

// 获取环境变量 ID
function getQinglongEnvId(host, token, ptPin) {
    return new Promise(resolve => {
        $.get({
            url:     `${host}/open/envs`,
            headers: { 'Authorization': `Bearer ${token}` }
        }, (err, resp, body) => {
            try {
                if (err) throw err;
                const res = typeof body === 'string' ? JSON.parse(body) : body;
                if (res.code !== 200 || !Array.isArray(res.data)) throw new Error();
                const env = res.data.find(e =>
                    e.name === 'JD_COOKIE' &&
                    e.value?.includes(`pt_pin=${ptPin}`)
                );
                resolve(env ? env.id : null);
            } catch {
                resolve(null);
            }
        });
    });
}

// 创建新的 JD_COOKIE 环境变量（带备注）
function createQinglongEnv(host, token, ptPin, cookie) {
    return new Promise(resolve => {
        const body = [{
            name:    'JD_COOKIE',
            value:   cookie.trim(),
            remarks: ptPin
        }];
        $.post({
            url:     `${host}/open/envs`,
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type':  'application/json'
            },
            body: JSON.stringify(body)
        }, (err, resp, txt) => {
            try {
                if (err) throw err;
                const res = typeof txt === 'string' ? JSON.parse(txt) : txt;
                if (res.code === 200 && (res.data?.id || (Array.isArray(res.data) && res.data[0]?.id))) {
                    const id = res.data.id || res.data[0].id;
                    return resolve(id);
                }
                throw new Error(res.message || '创建失败');
            } catch {
                resolve(null);
            }
        });
    });
}

// 更新环境变量值并写入 remarks
function updateQinglongEnvValue(host, token, envId, ptPin, cookie) {
    return new Promise(resolve => {
        const body = [{
            name:    'JD_COOKIE',
            value:   cookie.trim(),
            remarks: ptPin
        }];
        const opt = {
            url:     `${host}/open/envs/${envId}`,
            method:  'PUT',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type':  'application/json'
            },
            body: JSON.stringify(body)
        };
        if (typeof $task !== 'undefined') {
            $task.fetch(opt).then(r => resolve(), () => resolve());
        } else if (typeof $httpClient !== 'undefined') {
            $httpClient.put(opt, () => resolve());
        } else {
            // 降级
            $.post(opt, () => resolve());
        }
    });
}

// 启用环境变量
function updateQinglongEnvStatus(host, token, envId) {
    return new Promise(resolve => {
        $.post({
            url:     `${host}/open/envs/enable`,
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type':  'application/json'
            },
            body: JSON.stringify([parseInt(envId,10)])
        }, () => resolve());
    });
}

// Env.js
function Env(t, e) { class s { constructor(t) { this.env = t } send(t, e = "GET") { t = "string" == typeof t ? { url: t } : t; let s = this.get; return "POST" === e && (s = this.post), new Promise(((e, i) => { s.call(this, t, ((t, s, o) => { t ? i(t) : e(s) })) })) } get(t) { return this.send.call(this.env, t) } post(t) { return this.send.call(this.env, t, "POST") } } return new class { constructor(t, e) { this.logLevels = { debug: 0, info: 1, warn: 2, error: 3 }, this.logLevelPrefixs = { debug: "[DEBUG] ", info: "[INFO] ", warn: "[WARN] ", error: "[ERROR] " }, this.logLevel = "info", this.name = t, this.http = new s(this), this.data = null, this.dataFile = "box.dat", this.logs = [], this.isMute = !1, this.isNeedRewrite = !1, this.logSeparator = "\n", this.encoding = "utf-8", this.startTime = (new Date).getTime(), Object.assign(this, e), this.log("", `🔔${this.name}, 开始!`) } getEnv() { return "undefined" != typeof $environment && $environment["surge-version"] ? "Surge" : "undefined" != typeof $environment && $environment["stash-version"] ? "Stash" : "undefined" != typeof module && module.exports ? "Node.js" : "undefined" != typeof $task ? "Quantumult X" : "undefined" != typeof $loon ? "Loon" : "undefined" != typeof $rocket ? "Shadowrocket" : void 0 } isNode() { return "Node.js" === this.getEnv() } isQuanX() { return "Quantumult X" === this.getEnv() } isSurge() { return "Surge" === this.getEnv() } isLoon() { return "Loon" === this.getEnv() } isShadowrocket() { return "Shadowrocket" === this.getEnv() } isStash() { return "Stash" === this.getEnv() } toObj(t, e = null) { try { return JSON.parse(t) } catch { return e } } toStr(t, e = null, ...s) { try { return JSON.stringify(t, ...s) } catch { return e } } getjson(t, e) { let s = e; if (this.getdata(t)) try { s = JSON.parse(this.getdata(t)) } catch { } return s } setjson(t, e) { try { return this.setdata(JSON.stringify(t), e) } catch { return !1 } } getScript(t) { return new Promise((e => { this.get({ url: t }, ((t, s, i) => e(i))) })) } runScript(t, e) { return new Promise((s => { let i = this.getdata("@chavy_boxjs_userCfgs.httpapi"); i = i ? i.replace(/\n/g, "").trim() : i; let o = this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout"); o = o ? 1 * o : 20, o = e && e.timeout ? e.timeout : o; const [r, a] = i.split("@"), n = { url: `http://${a}/v1/scripting/evaluate`, body: { script_text: t, mock_type: "cron", timeout: o }, headers: { "X-Key": r, Accept: "*/*" }, timeout: o }; this.post(n, ((t, e, i) => s(i))) })).catch((t => this.logErr(t))) } loaddata() { if (!this.isNode()) return {}; { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), i = !s && this.fs.existsSync(e); if (!s && !i) return {}; { const i = s ? t : e; try { return JSON.parse(this.fs.readFileSync(i)) } catch (t) { return {} } } } } writedata() { if (this.isNode()) { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), i = !s && this.fs.existsSync(e), o = JSON.stringify(this.data); s ? this.fs.writeFileSync(t, o) : i ? this.fs.writeFileSync(e, o) : this.fs.writeFileSync(t, o) } } lodash_get(t, e, s) { const i = e.replace(/\[(\d+)\]/g, ".$1").split("."); let o = t; for (const t of i) if (o = Object(o)[t], void 0 === o) return s; return o } lodash_set(t, e, s) { return Object(t) !== t || (Array.isArray(e) || (e = e.toString().match(/[^.[\]]+/g) || []), e.slice(0, -1).reduce(((t, s, i) => Object(t[s]) === t[s] ? t[s] : t[s] = Math.abs(e[i + 1]) >> 0 == +e[i + 1] ? [] : {}), t)[e[e.length - 1]] = s), t } getdata(t) { let e = this.getval(t); if (/^@/.test(t)) { const [, s, i] = /^@(.*?)\.(.*?)$/.exec(t), o = s ? this.getval(s) : ""; if (o) try { const t = JSON.parse(o); e = t ? this.lodash_get(t, i, "") : e } catch (t) { e = "" } } return e } setdata(t, e) { let s = !1; if (/^@/.test(e)) { const [, i, o] = /^@(.*?)\.(.*?)$/.exec(e), r = this.getval(i), a = i ? "null" === r ? null : r || "{}" : "{}"; try { const e = JSON.parse(a); this.lodash_set(e, o, t), s = this.setval(JSON.stringify(e), i) } catch (e) { const r = {}; this.lodash_set(r, o, t), s = this.setval(JSON.stringify(r), i) } } else s = this.setval(t, e); return s } getval(t) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.read(t); case "Quantumult X": return $prefs.valueForKey(t); case "Node.js": return this.data = this.loaddata(), this.data[t]; default: return this.data && this.data[t] || null } } setval(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.write(t, e); case "Quantumult X": return $prefs.setValueForKey(t, e); case "Node.js": return this.data = this.loaddata(), this.data[e] = t, this.writedata(), !0; default: return this.data && this.data[e] || null } } initGotEnv(t) { this.got = this.got ? this.got : require("got"), this.cktough = this.cktough ? this.cktough : require("tough-cookie"), this.ckjar = this.ckjar ? this.ckjar : new this.cktough.CookieJar, t && (t.headers = t.headers ? t.headers : {}, t && (t.headers = t.headers ? t.headers : {}, void 0 === t.headers.cookie && void 0 === t.headers.Cookie && void 0 === t.cookieJar && (t.cookieJar = this.ckjar))) } get(t, e = (() => { })) { switch (t.headers && (delete t.headers["Content-Type"], delete t.headers["Content-Length"], delete t.headers["content-type"], delete t.headers["content-length"]), t.params && (t.url += "?" + this.queryStr(t.params)), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient.get(t, ((t, s, i) => { !t && s && (s.body = i, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, i) })); break; case "Quantumult X": this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: i, headers: o, body: r, bodyBytes: a } = t; e(null, { status: s, statusCode: i, headers: o, body: r, bodyBytes: a }, r, a) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let s = require("iconv-lite"); this.initGotEnv(t), this.got(t).on("redirect", ((t, e) => { try { if (t.headers["set-cookie"]) { const s = t.headers["set-cookie"].map(this.cktough.Cookie.parse).toString(); s && this.ckjar.setCookieSync(s, null), e.cookieJar = this.ckjar } } catch (t) { this.logErr(t) } })).then((t => { const { statusCode: i, statusCode: o, headers: r, rawBody: a } = t, n = s.decode(a, this.encoding); e(null, { status: i, statusCode: o, headers: r, rawBody: a, body: n }, n) }), (t => { const { message: i, response: o } = t; e(i, o, o && s.decode(o.rawBody, this.encoding)) })); break } } post(t, e = (() => { })) { const s = t.method ? t.method.toLocaleLowerCase() : "post"; switch (t.body && t.headers && !t.headers["Content-Type"] && !t.headers["content-type"] && (t.headers["content-type"] = "application/x-www-form-urlencoded"), t.headers && (delete t.headers["Content-Length"], delete t.headers["content-length"]), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient[s](t, ((t, s, i) => { !t && s && (s.body = i, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, i) })); break; case "Quantumult X": t.method = s, this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: i, headers: o, body: r, bodyBytes: a } = t; e(null, { status: s, statusCode: i, headers: o, body: r, bodyBytes: a }, r, a) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let i = require("iconv-lite"); this.initGotEnv(t); const { url: o, ...r } = t; this.got[s](o, r).then((t => { const { statusCode: s, statusCode: o, headers: r, rawBody: a } = t, n = i.decode(a, this.encoding); e(null, { status: s, statusCode: o, headers: r, rawBody: a, body: n }, n) }), (t => { const { message: s, response: o } = t; e(s, o, o && i.decode(o.rawBody, this.encoding)) })); break } } time(t, e = null) { const s = e ? new Date(e) : new Date; let i = { "M+": s.getMonth() + 1, "d+": s.getDate(), "H+": s.getHours(), "m+": s.getMinutes(), "s+": s.getSeconds(), "q+": Math.floor((s.getMonth() + 3) / 3), S: s.getMilliseconds() }; /(y+)/.test(t) && (t = t.replace(RegExp.$1, (s.getFullYear() + "").substr(4 - RegExp.$1.length))); for (let e in i) new RegExp("(" + e + ")").test(t) && (t = t.replace(RegExp.$1, 1 == RegExp.$1.length ? i[e] : ("00" + i[e]).substr(("" + i[e]).length))); return t } queryStr(t) { let e = ""; for (const s in t) { let i = t[s]; null != i && "" !== i && ("object" == typeof i && (i = JSON.stringify(i)), e += `${s}=${i}&`) } return e = e.substring(0, e.length - 1), e } msg(e = t, s = "", i = "", o = {}) { const r = t => { const { $open: e, $copy: s, $media: i, $mediaMime: o } = t; switch (typeof t) { case void 0: return t; case "string": switch (this.getEnv()) { case "Surge": case "Stash": default: return { url: t }; case "Loon": case "Shadowrocket": return t; case "Quantumult X": return { "open-url": t }; case "Node.js": return }case "object": switch (this.getEnv()) { case "Surge": case "Stash": case "Shadowrocket": default: { const r = {}; let a = t.openUrl || t.url || t["open-url"] || e; a && Object.assign(r, { action: "open-url", url: a }); let n = t["update-pasteboard"] || t.updatePasteboard || s; if (n && Object.assign(r, { action: "clipboard", text: n }), i) { let t, e, s; if (i.startsWith("http")) t = i; else if (i.startsWith("data:")) { const [t] = i.split(";"), [, o] = i.split(","); e = o, s = t.replace("data:", "") } else { e = i, s = (t => { const e = { JVBERi0: "application/pdf", R0lGODdh: "image/gif", R0lGODlh: "image/gif", iVBORw0KGgo: "image/png", "/9j/": "image/jpg" }; for (var s in e) if (0 === t.indexOf(s)) return e[s]; return null })(i) } Object.assign(r, { "media-url": t, "media-base64": e, "media-base64-mime": o ?? s }) } return Object.assign(r, { "auto-dismiss": t["auto-dismiss"], sound: t.sound }), r } case "Loon": { const s = {}; let o = t.openUrl || t.url || t["open-url"] || e; o && Object.assign(s, { openUrl: o }); let r = t.mediaUrl || t["media-url"]; return i?.startsWith("http") && (r = i), r && Object.assign(s, { mediaUrl: r }), console.log(JSON.stringify(s)), s } case "Quantumult X": { const o = {}; let r = t["open-url"] || t.url || t.openUrl || e; r && Object.assign(o, { "open-url": r }); let a = t["media-url"] || t.mediaUrl; i?.startsWith("http") && (a = i), a && Object.assign(o, { "media-url": a }); let n = t["update-pasteboard"] || t.updatePasteboard || s; return n && Object.assign(o, { "update-pasteboard": n }), console.log(JSON.stringify(o)), o } case "Node.js": return }default: return } }; if (!this.isMute) switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: $notification.post(e, s, i, r(o)); break; case "Quantumult X": $notify(e, s, i, r(o)); break; case "Node.js": break }if (!this.isMuteLog) { let t = ["", "==============📣系统通知📣=============="]; t.push(e), s && t.push(s), i && t.push(i), console.log(t.join("\n")), this.logs = this.logs.concat(t) } } debug(...t) { this.logLevels[this.logLevel] <= this.logLevels.debug && (t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(`${this.logLevelPrefixs.debug}${t.map((t => t ?? String(t))).join(this.logSeparator)}`)) } info(...t) { this.logLevels[this.logLevel] <= this.logLevels.info && (t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(`${this.logLevelPrefixs.info}${t.map((t => t ?? String(t))).join(this.logSeparator)}`)) } warn(...t) { this.logLevels[this.logLevel] <= this.logLevels.warn && (t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(`${this.logLevelPrefixs.warn}${t.map((t => t ?? String(t))).join(this.logSeparator)}`)) } error(...t) { this.logLevels[this.logLevel] <= this.logLevels.error && (t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(`${this.logLevelPrefixs.error}${t.map((t => t ?? String(t))).join(this.logSeparator)}`)) } log(...t) { t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(t.map((t => t ?? String(t))).join(this.logSeparator)) } logErr(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: this.log("", `❗️${this.name}, 错误!`, e, t); break; case "Node.js": this.log("", `❗️${this.name}, 错误!`, e, void 0 !== t.message ? t.message : t, t.stack); break } } wait(t) { return new Promise((e => setTimeout(e, t))) } done(t = {}) { const e = ((new Date).getTime() - this.startTime) / 1e3; switch (this.log("", `🔔${this.name}, 结束! 🕛 ${e} 秒`), this.log(), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: $done(t); break; case "Node.js": process.exit(1) } } }(t, e) }