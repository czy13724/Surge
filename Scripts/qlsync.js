// 本脚本可以搭配boxjs使用，用于将短期ck同步至青龙
// author:Levi

// env.js (用于手机端读取指定变量并直接上传到青龙)
const $ = new Env("LeviQinglongSync");
//青龙配置
let QL = {};

async function main() {
    try {
        // 从 BoxJS 获取青龙配置信息
        const qlHost = $.getdata("QL_HOST");
        const qlClientId = $.getdata("QL_CLIENT_ID");
        const qlClientSecret = $.getdata("QL_CLIENT_SECRET");

        // 从 BoxJS 获取需要同步的变量名列表 (假设你存储在一个名为 SYNC_VARS 的变量中，用逗号分隔)
        const syncVarNamesStr = $.getdata("SYNC_VARS");

        if (!syncVarNamesStr || !qlHost || !qlClientId || !qlClientSecret) {
            throw new Error("⛔️ 请在 BoxJS 中配置青龙信息和需要同步的变量名 (SYNC_VARS)!");
        }

        QL = {
            host: qlHost,
            clientId: qlClientId,
            secret: qlClientSecret,
        };

        const syncVarNames = syncVarNamesStr.split(',').map(name => name.trim());

        const ql = new QingLong(QL.host, QL.clientId, QL.secret);
        await ql.checkLogin(); // 获取或刷新青龙 Token

        let uploadedCount = 0;
        let failedCount = 0;

        for (const varName of syncVarNames) {
            const boxJsValue = $.getdata(varName);
            if (boxJsValue !== null && boxJsValue !== undefined) {
                const addResult = await ql.addOrUpdateEnv({ name: varName, value: boxJsValue });
                if (addResult) {
                    $.log(`✅ 成功上传环境变量: ${varName}`);
                    uploadedCount++;
                } else {
                    $.log(`⚠️ 上传环境变量 ${varName} 失败，请查看日志。`);
                    failedCount++;
                }
            } else {
                $.log(`⚠️ BoxJS 中未找到变量: ${varName}`);
                failedCount++;
            }
        }

        $.msg("青龙环境变量同步", "同步完成!", `成功上传 ${uploadedCount} 个，失败 ${failedCount} 个`);

    } catch (e) {
        $.msg("青龙环境变量同步", "⛔️ 同步失败!", e.message || e);
    } finally {
        $.done();
    }
}
//调试
function debug(t, l = 'debug') {
    if ($.is_debug === 'true') {
        $.log(`\n-----------${l}------------\n`);
        $.log(typeof t == "string" ? t : $.toStr(t) || `debug error => t=${t}`);
        $.log(`\n-----------${l}------------\n`)
    }
};
// 双平台log输出
function DoubleLog(data) {
    console.log(`${data}`);
    $.notifyMsg.push(`${data}`);
}
//账号通知
async function SendMsg(n) {
    $.msg($.name, $.title || "", n, {
        "media-url": $.avatar || ""
    })
};
//将请求头转换为小写
function ObjectKeys2LowerCase(e) {
    e = Object.fromEntries(Object.entries(e).map(([e, t]) => [e.toLowerCase(), t]));
    return new Proxy(e, {
        get: function (e, t, r) {
            return Reflect.get(e, t.toLowerCase(), r)
        },
        set: function (e, t, r, n) {
            return Reflect.set(e, t.toLowerCase(), r, n)
        }
    })
};
function QingLong(HOST, Client_ID, Client_Secret) {
    const Request = (t, m = "GET") => {
        return new Promise((resolve, reject) => {
            $.http[m.toLowerCase()](t)
                .then((response) => {
                    var resp = response.body;
                    try {
                        resp = $.toObj(resp) || resp;
                    } catch (e) { }
                    resolve(resp);
                })
                .catch((err) => reject(err));
        });
    };
    return new (class {
        /**
         * 对接青龙API
         * @param {*} HOST http://127.0.0.1:5700
         * @param {*} Client_ID xxx
         * @param {*} Client_Secret xxx
         */
        constructor(HOST, Client_ID, Client_Secret) {
            this.host = HOST;
            this.clientId = Client_ID;
            this.clientSecret = Client_Secret;
            this.token = "";
            this.envs = [];
        }
        //用户登录
        async checkLogin() {
            let tokenObj;
            try {
                tokenObj = $.getjson("yuheng_ql_token") || {};
            } catch (e) {
                console.log(`⛔️ Token无效，开始重新获取`);
                await this.getAuthToken();
                return false;
            }
            if (Object.keys(tokenObj).length > 0) {
                const { token, expiration } = tokenObj;
                const currentTime = new Date().getTime();
                if (currentTime > expiration) {
                    $.log("⛔️ Token已过期");
                    await this.getAuthToken();
                } else {
                    this.token = token;
                    $.log(
                        `✅ 已成功获取Token (${this.token
                        })，有效期至 ${$.time(
                            "yyyy-MM-dd HH:mm:ss",
                            expiration
                        )}`
                    );
                }
            } else {
                await this.getAuthToken();
            }
        }
        // 获取用户密钥
        async getAuthToken() {
            const options = {
                url: `${this.host}/open/auth/token`,
                params: {
                    client_id: this.clientId,
                    client_secret: this.clientSecret,
                },
            };
            try {
                $.log(`传入参数: ${JSON.stringify(options)}`);
                const { code, data, message } = await Request(options);
                if (code === 200) {
                    const { token, token_type, expiration } = data;
                    $.log(
                        `✅ 已成功获取Token: ${token}, 有效期至 ${$.time(
                            "yyyy-MM-dd HH:mm:ss",
                            expiration * 1e3
                        )}`
                    );
                    this.token = `${token_type} ${token}`;
                    $.setjson({
                        token: this.token,
                        expiration: expiration * 1e3,
                    },
                        "yuheng_ql_token"
                    );
                } else {
                    throw message || "无法获取Token.";
                }
            } catch (e) {
                throw e
                    ? typeof e === "object"
                        ? JSON.stringify(e)
                        : e
                    : "Network Error.";
            }
        }
        /**
         * 获取所有环境变量详情
         */
        async getEnvs() {
            const options = {
                url: `${this.host}/open/envs`,
                headers: {
                    'Authorization': this.token,
                },
            };
            try {
                const { code, data, message } = await Request(options);
                if (code === 200) {
                    this.envs = data;
                    $.log(`✅ 获取环境变量成功.`);
                } else {
                    throw message || `无法获取环境变量.`;
                }
            } catch (e) {
                throw e
                    ? typeof e === "object"
                        ? JSON.stringify(e)
                        : e
                    : "Network Error.";
            }
        }
        /**
         * 获取所有环境变量详情
         */
        async getTask(taskName) {
            const options = {
                url: `${this.host}/open/crons`,
                headers: {
                    'Authorization': this.token,
                },
            };
            try {
                const { code, data, message } = await Request(options);
                if (code === 200) {
                    const tasks = data?.data;
                    const task = tasks.find((item) => item.name == taskName);
                    $.log(`✅ 获取taskId成功.`);
                    return {
                        id: task.id,
                        status: task.status
                    };
                } else {
                    throw message || `无法获取taskId.`;
                }
            } catch (e) {
                throw e
                    ? typeof e === "object"
                        ? JSON.stringify(e)
                        : e
                    : "Network Error.";
            }
        }
        checkEnvByName(name) {
            return this.envs.findIndex((item) => item.name === name);
        }
        checkEnvByRemarks(remarks) {
            return this.envs.findIndex((item) => item.remarks === remarks);
        }
        checkEnvByValue(value, regex) {
            const match = value.match(regex);
            if (match) {
                const index = this.envs.findIndex((item) =>
                    item.value.includes(match[0])
                );
                if (index > -1) {
                    $.log(`🆗${value} Matched: ${match[0]}`);
                    return index;
                } else {
                    $.log(`⭕${value} No Matched`);
                    return -1;
                }
            } else {
                $.log(`⭕${value} No Matched`);
                return -1;
            }
        }
        selectEnvByName(name) {
            return this.envs.filter((item) => item.name === name);
        }
        selectEnvByRemarks(remarks) {
            return this.envs.filter((item) => item.remarks === remarks);
        }
        /**
         * 添加或更新环境变量
         * @param {*} obj {value:'变量值',name:'变量名',remarks:'备注'}
         */
        async addOrUpdateEnv(obj) {
            await this.getEnvs(); // 确保 envs 列表是最新的
            const envIndex = this.envs.findIndex(env => env.name === obj.name);
            if (envIndex > -1) {
                const existingEnv = this.envs[envIndex];
                const updateObj = { value: obj.value, name: obj.name, id: existingEnv.id };
                try {
                    await this.updateEnv(updateObj);
                    return true;
                } catch (e) {
                    $.log(`⚠️ 更新环境变量 ${obj.name} 失败: ${e}`);
                    return false;
                }
            } else {
                const addArray = [{ value: obj.value, name: obj.name }];
                try {
                    await this.addEnv(addArray);
                    return true;
                } catch (e) {
                    $.log(`⚠️ 添加环境变量 ${obj.name} 失败: ${e}`);
                    return false;
                }
            }
        }
        /**
         * 添加环境变量
         * @param {*} array [{value:'变量值',name:'变量名',remarks:'备注'}]
         */
        async addEnv(array) {
            const options = {
                url: `${this.host}/open/envs`,
                headers: {
                    Authorization: this.token,
                    "Content-Type": "application/json;charset=UTF-8",
                },
                body: JSON.stringify(array),
            };
            try {
                const { code, message } = await Request(options, "post");
                if (code === 200) {
                    $.log(`✅ 已成功添加环境变量.`);
                } else {
                    throw message || "未能添加环境变量.";
                }
            } catch (e) {
                throw e
                    ? typeof e === "object"
                        ? JSON.stringify(e)
                        : e
                    : "Network Error.";
            }
        }
        /**
         * 修改环境变量
         * @param {*} obj {value:'变量值',name:'变量名',remarks:'备注',id:0}
         */
        async updateEnv(obj) {
            const options = {
                url: `${this.host}/open/envs`,
                method: "put",
                headers: {
                    Authorization: this.token,
                    "Content-Type": "application/json;charset=UTF-8",
                },
                body: JSON.stringify(obj),
            };
            try {
                const { code, message } = await Request(options, "post");
                if (code === 200) {
                    $.log(`✅ 已成功更新环境变量.`);
                } else {
                    throw message || "无法更新环境变量.";
                }
            } catch (e) {
                throw e
                    ? typeof e === "object"
                        ? JSON.stringify(e)
                        : e
                    : "Network Error.";
            }
        }


        /**
         * 运行任务
         * @param {*}  array [taskId]
         */
        async runTask(taskIds) {
            const options = {
                url: `${this.host}/open/crons/run`,
                method: "put",
                headers: {
                    Authorization: this.token,
                    "Content-Type": "application/json;charset=UTF-8",
                },
                body: JSON.stringify(taskIds),
            };
            try {
                const { code, message } = await Request(options, "post");
                if (code === 200) {
                    $.log(`✅ 任务已成功运行.`);
                } else {
                    throw message || "无法运行任务.";
                }
            } catch (e) {
                throw e
                    ? typeof e === "object"
                        ? JSON.stringify(e)
                        : e
                    : "Network Error.";
            }
        }
    })(HOST, Client_ID, Client_Secret);
}
main();

//---------------------- 固定不动区域 -----------------------------------
//From chavyleung's Env.js
function Env(t, e) { class s { constructor(t) { this.env = t } send(t, e = "GET") { t = "string" == typeof t ? { url: t } : t; let s = this.get; return "POST" === e && (s = this.post), new Promise((e, a) => { s.call(this, t, (t, s, r) => { t ? a(t) : e(s) }) }) } get(t) { return this.send.call(this.env, t) } post(t) { return this.send.call(this.env, t, "POST") } } return new class { constructor(t, e) { this.name = t, this.http = new s(this), this.data = null, this.dataFile = "box.dat", this.logs = [], this.isMute = !1, this.isNeedRewrite = !1, this.logSeparator = "\n", this.encoding = "utf-8", this.startTime = (new Date).getTime(), Object.assign(this, e), this.log("", `🔔${this.name}, 开始!`) } getEnv() { return "undefined" != typeof $environment && $environment["surge-version"] ? "Surge" : "undefined" != typeof $environment && $environment["stash-version"] ? "Stash" : "undefined" != typeof module && module.exports ? "Node.js" : "undefined" != typeof $task ? "Quantumult X" : "undefined" != typeof $loon ? "Loon" : "undefined" != typeof $rocket ? "Shadowrocket" : void 0 } isNode() { return "Node.js" === this.getEnv() } isQuanX() { return "Quantumult X" === this.getEnv() } isSurge() { return "Surge" === this.getEnv() } isLoon() { return "Loon" === this.getEnv() } isShadowrocket() { return "Shadowrocket" === this.getEnv() } isStash() { return "Stash" === this.getEnv() } toObj(t, e = null) { try { return JSON.parse(t) } catch { return e } } toStr(t, e = null) { try { return JSON.stringify(t) } catch { return e } } getjson(t, e) { let s = e; const a = this.getdata(t); if (a) try { s = JSON.parse(this.getdata(t)) } catch { } return s } setjson(t, e) { try { return this.setdata(JSON.stringify(t), e) } catch { return !1 } } getScript(t) { return new Promise(e => { this.get({ url: t }, (t, s, a) => e(a)) }) } runScript(t, e) { return new Promise(s => { let a = this.getdata("@chavy_boxjs_userCfgs.httpapi"); a = a ? a.replace(/\n/g, "").trim() : a; let r = this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout"); r = r ? 1 * r : 20, r = e && e.timeout ? e.timeout : r; const [i, o] = a.split("@"), n = { url: `http://${o}/v1/scripting/evaluate`, body: { script_text: t, mock_type: "cron", timeout: r }, headers: { "X-Key": i, Accept: "*/*" }, timeout: r }; this.post(n, (t, e, a) => s(a)) }).catch(t => this.logErr(t)) } loaddata() { if (!this.isNode()) return {}; { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), a = !s && this.fs.existsSync(e); if (!s && !a) return {}; { const a = s ? t : e; try { return JSON.parse(this.fs.readFileSync(a)) } catch (t) { return {} } } } } writedata() { if (this.isNode()) { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), a = !s && this.fs.existsSync(e), r = JSON.stringify(this.data); s ? this.fs.writeFileSync(t, r) : a ? this.fs.writeFileSync(e, r) : this.fs.writeFileSync(t, r) } } lodash_get(t, e, s) { const a = e.replace(/\[(\d+)\]/g, ".$1").split("."); let r = t; for (const t of a) if (r = Object(r)[t], void 0 === r) return s; return r } lodash_set(t, e, s) { return Object(t) !== t ? t : (Array.isArray(e) || (e = e.toString().match(/[^.[\]]+/g) || []), e.slice(0, -1).reduce((t, s, a) => Object(t[s]) === t[s] ? t[s] : t[s] = Math.abs(e[a + 1]) >> 0 == +e[a + 1] ? [] : {}, t)[e[e.length - 1]] = s, t) } getdata(t) { let e = this.getval(t); if (/^@/.test(t)) { const [, s, a] = /^@(.*?)\.(.*?)$/.exec(t), r = s ? this.getval(s) : ""; if (r) try { const t = JSON.parse(r); e = t ? this.lodash_get(t, a, "") : e } catch (t) { e = "" } } return e } setdata(t, e) { let s = !1; if (/^@/.test(e)) { const [, a, r] = /^@(.*?)\.(.*?)$/.exec(e), i = this.getval(a), o = a ? "null" === i ? null : i || "{}" : "{}"; try { const e = JSON.parse(o); this.lodash_set(e, r, t), s = this.setval(JSON.stringify(e), a) } catch (e) { const i = {}; this.lodash_set(i, r, t), s = this.setval(JSON.stringify(i), a) } } else s = this.setval(t, e); return s } getval(t) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.read(t); case "Quantumult X": return $prefs.valueForKey(t); case "Node.js": return this.data = this.loaddata(), this.data[t]; default: return this.data && this.data[t] || null } } setval(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.write(t, e); case "Quantumult X": return $prefs.setValueForKey(t, e); case "Node.js": return this.data = this.loaddata(), this.data[e] = t, this.writedata(), !0; default: return this.data && this.data[e] || null } } initGotEnv(t) { this.got = this.got ? this.got : require("got"), this.cktough = this.cktough ? this.cktough : require("tough-cookie"), this.ckjar = this.ckjar ? this.ckjar : new this.cktough.CookieJar, t && (t.headers = t.headers ? t.headers : {}, void 0 === t.headers.Cookie && void 0 === t.cookieJar && (t.cookieJar = this.ckjar)) } get(t, e = (() => { })) { switch (t.headers && (delete t.headers["Content-Type"], delete t.headers["Content-Length"], delete t.headers["content-type"], delete t.headers["content-length"]), t.params && (t.url += "?" + this.queryStr(t.params)), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient.get(t, (t, s, a) => { !t && s && (s.body = a, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, a) }); break; case "Quantumult X": this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then(t => { const { statusCode: s, statusCode: a, headers: r, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: a, headers: r, body: i, bodyBytes: o }, i, o) }, t => e(t && t.error || "UndefinedError")); break; case "Node.js": let s = require("iconv-lite"); this.initGotEnv(t), this.got(t).on("redirect", (t, e) => { try { if (t.headers["set-cookie"]) { const s = t.headers["set-cookie"].map(this.cktough.Cookie.parse).toString(); s && this.ckjar.setCookieSync(s, null), e.cookieJar = this.ckjar } } catch (t) { this.logErr(t) } }).then(t => { const { statusCode: a, statusCode: r, headers: i, rawBody: o } = t, n = s.decode(o, this.encoding); e(null, { status: a, statusCode: r, headers: i, rawBody: o, body: n }, n) }, t => { const { message: a, response: r } = t; e(a, r, r && s.decode(r.rawBody, this.encoding)) }) } } post(t, e = (() => { })) { const s = t.method ? t.method.toLocaleLowerCase() : "post"; switch (t.body && t.headers && !t.headers["Content-Type"] && !t.headers["content-type"] && (t.headers["content-type"] = "application/x-www-form-urlencoded"), t.headers && (delete t.headers["Content-Length"], delete t.headers["content-length"]), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient[s](t, (t, s, a) => { !t && s && (s.body = a, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, a) }); break; case "Quantumult X": t.method = s, this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then(t => { const { statusCode: s, statusCode: a, headers: r, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: a, headers: r, body: i, bodyBytes: o }, i, o) }, t => e(t && t.error || "UndefinedError")); break; case "Node.js": let a = require("iconv-lite"); this.initGotEnv(t); const { url: r, ...i } = t; this.got[s](r, i).then(t => { const { statusCode: s, statusCode: r, headers: i, rawBody: o } = t, n = a.decode(o, this.encoding); e(null, { status: s, statusCode: r, headers: i, rawBody: o, body: n }, n) }, t => { const { message: s, response: r } = t; e(s, r, r && a.decode(r.rawBody, this.encoding)) }) } } time(t, e = null) { const s = e ? new Date(e) : new Date; let a = { "M+": s.getMonth() + 1, "d+": s.getDate(), "H+": s.getHours(), "m+": s.getMinutes(), "s+": s.getSeconds(), "q+": Math.floor((s.getMonth() + 3) / 3), S: s.getMilliseconds() }; /(y+)/.test(t) && (t = t.replace(RegExp.$1, (s.getFullYear() + "").substr(4 - RegExp.$1.length))); for (let e in a) new RegExp("(" + e + ")").test(t) && (t = t.replace(RegExp.$1, 1 == RegExp.$1.length ? a[e] : ("00" + a[e]).substr(("" + a[e]).length))); return t } queryStr(t) { let e = ""; for (const s in t) { let a = t[s]; null != a && "" !== a && ("object" == typeof a && (a = JSON.stringify(a)), e += `${s}=${a}&`) } return e = e.substring(0, e.length - 1), e } msg(e = t, s = "", a = "", r) { const i = t => { switch (typeof t) { case void 0: return t; case "string": switch (this.getEnv()) { case "Surge": case "Stash": default: return { url: t }; case "Loon": case "Shadowrocket": return t; case "Quantumult X": return { "open-url": t }; case "Node.js": return }case "object": switch (this.getEnv()) { case "Surge": case "Stash": case "Shadowrocket": default: { let e = t.url || t.openUrl || t["open-url"]; return { url: e } } case "Loon": { let e = t.openUrl || t.url || t["open-url"], s = t.mediaUrl || t["media-url"]; return { openUrl: e, mediaUrl: s } } case "Quantumult X": { let e = t["open-url"] || t.url || t.openUrl, s = t["media-url"] || t.mediaUrl, a = t["update-pasteboard"] || t.updatePasteboard; return { "open-url": e, "media-url": s, "update-pasteboard": a } } case "Node.js": return }default: return } }; if (!this.isMute) switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: $notification.post(e, s, a, i(r)); break; case "Quantumult X": $notify(e, s, a, i(r)); break; case "Node.js": }if (!this.isMuteLog) { let t = ["", "==============📣系统通知📣=============="]; t.push(e), s && t.push(s), a && t.push(a), console.log(t.join("\n")), this.logs = this.logs.concat(t) } } log(...t) { t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(t.join(this.logSeparator)) } logErr(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: this.log("", `❗️${this.name}, 错误!`, t); break; case "Node.js": this.log("", `❗️${this.name}, 错误!`, t.stack) } } wait(t) { return new Promise(e => setTimeout(e, t)) } done(t = {}) { const e = (new Date).getTime(), s = (e - this.startTime) / 1e3; switch (this.log("", `🔔${this.name}, 结束! 🕛 ${s} 秒`), this.log(), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: $done(t); break; case "Node.js": process.exit(1) } } }(t, e) }