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
 * http-request ^https?:\/\/api\.m\.jd\.com\/client\.action\?functionId=(wareBusiness|serverConfig|basicConfig|logConfig) script-path=https://raw.githubusercontent.com/czy13724/Surge/main/quote/JD_CK_Update.js,requires-body=true, timeout=60, tag=京东获取token
 * QuantumultX
 * [rewrite_local]
 * ^https?:\/\/api\.m\.jd\.com\/client\.action\?functionId=(wareBusiness|serverConfig|basicConfig|logConfig) url script-request-header https://raw.githubusercontent.com/czy13724/Surge/main/quote/JD_CK_Update.js
 * 
 * 3. 添加MITM:
 * hostname = api.m.jd.com
 */

const $ = new Env('京东Cookie更新');

!(async () => {
    // 获取配置参数
    const qinglongHost = $.getval('qinglongHost') || '';
    const clientId = $.getval('clientId') || '';
    const clientSecret = $.getval('clientSecret') || '';
    
    // 参数验证
    if (!qinglongHost || !clientId || !clientSecret) {
        $.msg('京东Cookie更新', '配置错误', '请先配置青龙面板相关参数\n在BoxJS或对应客户端中设置:\nqinglongHost、clientId、clientSecret');
        $.log('❌ 缺少必要配置参数');
        $.done();
        return;
    }
    
    // Cookie获取
    let cookies = '';
    if ($request && $request.headers) {
        cookies = $request.headers['Cookie'] || $request.headers['cookie'] || '';
    }
    
    // 如果还是没有获取到，尝试从其他可能的位置获取
    if (!cookies && typeof $request !== 'undefined') {
        const headerKeys = Object.keys($request.headers || {});
        for (const key of headerKeys) {
            if (key.toLowerCase() === 'cookie') {
                cookies = $request.headers[key];
                break;
            }
        }
    }
    
    $.log(`🔍 获取到的Cookie字符串: ${cookies ? cookies.substring(0, 100) + '...' : '空'}`);
    
    if (!cookies) {
        $.log('❌ 无法获取Cookie');
        $.msg('京东Cookie更新', '获取失败', '无法从请求头中获取Cookie');
        $.done();
        return;
    }
    
    // 精确提取pt_pin和pt_key
    const ptPinMatch = cookies.match(/pt_pin=([^;]+)/);
    const ptKeyMatch = cookies.match(/pt_key=([^;]+)/);
    
    $.log(`🔍 pt_pin匹配结果: ${ptPinMatch ? '找到' : '未找到'}`);
    $.log(`🔍 pt_key匹配结果: ${ptKeyMatch ? '找到' : '未找到'}`);
    
    if (!ptPinMatch || !ptKeyMatch) {
        $.log('❌ Cookie中缺少pt_pin或pt_key');
        $.log(`Cookie内容: ${cookies}`);
        $.msg('京东Cookie更新', '解析失败', 'Cookie中缺少pt_pin或pt_key');
        $.done();
        return;
    }
    
    // 处理URL编码的pt_pin
    let ptPin = ptPinMatch[1];
    try {
        ptPin = decodeURIComponent(ptPin);
    } catch (e) {
        $.log(`⚠️ pt_pin解码失败，使用原始值: ${e.message}`);
    }
    
    const ptKey = ptKeyMatch[1];
    const jdCookie = `pt_key=${ptKey};pt_pin=${encodeURIComponent(ptPin)};`;
    
    $.log(`📱 获取到用户: ${ptPin}`);
    $.log(`🔑 Cookie长度: ${jdCookie.length}`);
    
    // 检查是否需要更新（避免频繁更新）
    const lastUpdateKey = `jd_cookie_update_${ptPin}`;
    const lastUpdateTime = $.getval(lastUpdateKey) || '0';
    const currentTime = Date.now();
    const updateInterval = 0 * 60 * 1000; // 10分钟更新间隔
    
    if (currentTime - parseInt(lastUpdateTime) < updateInterval) {
        $.log(`⏰ 距离上次更新不足10分钟，跳过更新`);
        $.done();
        return;
    }
    
    try {
        // 获取青龙Token
        const token = await getQinglongToken(qinglongHost, clientId, clientSecret);
        if (!token) {
            throw new Error('获取青龙Token失败');
        }
        $.log('✅ 获取青龙Token成功');
        
        // 查找或创建环境变量
        let envId = await getQinglongEnvId(qinglongHost, token, ptPin);
        if (!envId) {
            $.log(`📝 未找到对应的JD_COOKIE环境变量，开始创建...`);
            envId = await createQinglongEnv(qinglongHost, token, ptPin, jdCookie);
            if (!envId) {
                throw new Error('创建JD_COOKIE环境变量失败');
            }
            $.log(`✅ 成功创建环境变量 ID: ${envId}`);
        } else {
            $.log(`✅ 找到现有环境变量 ID: ${envId}`);
        }
        
        // 更新Cookie值和状态
        await Promise.all([
            updateQinglongEnvValue(qinglongHost, token, envId, jdCookie),
            updateQinglongEnvStatus(qinglongHost, token, envId)
        ]);
        
        // 记录更新时间
        $.setval(currentTime.toString(), lastUpdateKey);
        
        $.msg('京东Cookie更新', '更新成功', `用户: ${ptPin}\n时间: ${new Date().toLocaleString()}`);
        $.log('🎉 Cookie更新成功');
        
    } catch (error) {
        $.msg('京东Cookie更新', '更新失败', `用户: ${ptPin}\n错误: ${error.message}`);
        $.log(`❌ 错误: ${error.message}`);
    }
    
    $.done();
})();

// 获取青龙Token
function getQinglongToken(qinglongHost, clientId, clientSecret) {
    return new Promise((resolve) => {
        const url = `${qinglongHost}/open/auth/token?client_id=${clientId}&client_secret=${clientSecret}`;
        
        $.get(url, (error, response, body) => {
            try {
                if (error) {
                    throw new Error(`请求失败: ${error}`);
                }
                
                const result = typeof body === 'string' ? JSON.parse(body) : body;
                if (result.code === 200 && result.data?.token) {
                    resolve(result.data.token);
                } else {
                    throw new Error(`获取Token失败: ${result.message || '未知错误'}`);
                }
            } catch (e) {
                $.log(`❌ 获取Token错误: ${e.message}`);
                resolve(null);
            }
        });
    });
}

// 获取环境变量ID
function getQinglongEnvId(qinglongHost, token, ptPin) {
    return new Promise((resolve) => {
        const options = {
            url: `${qinglongHost}/open/envs`,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        };
        
        $.get(options, (error, response, body) => {
            try {
                if (error) {
                    throw new Error(`请求失败: ${error}`);
                }
                
                const result = typeof body === 'string' ? JSON.parse(body) : body;
                if (result.code === 200 && Array.isArray(result.data)) {
                    $.log(`🔍 当前查找的pt_pin: ${ptPin}`);
                    
                    // 查找包含对应pt_pin的JD_COOKIE环境变量
                    const jdCookieEnv = result.data.find(env => 
                        env.name === 'JD_COOKIE' && 
                        env.value && 
                        (env.value.includes(`pt_pin=${ptPin}`) || 
                         env.value.includes(`pt_pin=${encodeURIComponent(ptPin)}`) ||
                         env.value.includes(`pt_pin=${decodeURIComponent(ptPin)}`))
                    );
                    
                    if (jdCookieEnv) {
                        $.log(`✅ 找到匹配的环境变量 ID: ${jdCookieEnv.id}`);
                        resolve(jdCookieEnv.id);
                    } else {
                        $.log(`ℹ️ 未找到用户${ptPin}对应的JD_COOKIE环境变量，需要创建`);
                        resolve(null);
                    }
                } else {
                    throw new Error(`获取环境变量列表失败: ${result.message || '未知错误'}`);
                }
            } catch (e) {
                $.log(`❌ 获取环境变量ID错误: ${e.message}`);
                resolve(null);
            }
        });
    });
}

// 创建新的JD_COOKIE环境变量
function createQinglongEnv(qinglongHost, token, ptPin, cookieValue) {
    return new Promise((resolve) => {
        const cookieValue = cookieValue.trim();
        const cleanPtPin = ptPin.replace(/[^\w\u4e00-\u9fa5]/g, '');
        
        // 修复：根据青龙API的实际要求调整格式
        // 先尝试字符串格式
        const requestBody = [
            {
                name: 'JD_COOKIE',
                value: cookieValue, // 数组格式，元素为字符串
            }
        ];
        
        $.log(`🔧 创建环境变量参数: ${JSON.stringify(requestBody)}`);
        
        const options = {
            url: `${qinglongHost}/open/envs`,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        };
        
        $.post(options, (error, response, body) => {
            try {
                if (error) {
                    $.log(`❌ 网络请求错误: ${error}`);
                    throw new Error(`请求失败: ${error}`);
                }
                
                $.log(`📥 创建API响应状态: ${response.statusCode}`);
                $.log(`📥 创建API响应内容: ${body}`);
                
                const result = typeof body === 'string' ? JSON.parse(body) : body;
                
                // 如果第一次尝试失败，且错误提示需要数组格式，则重试
                if (result.statusCode === 400 && result.message && result.message.includes('array')) {
                    $.log(`🔄 检测到需要数组格式，重新尝试创建...`);
                    
                    // 使用数组格式重试
                    const retryRequestBody = {
                        name: 'JD_COOKIE',
                        value: [cookieValue], // 数组格式
                    };
                    
                    const retryOptions = {
                        url: `${qinglongHost}/open/envs`,
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(retryRequestBody)
                    };
                    
                    $.post(retryOptions, (retryError, retryResponse, retryBody) => {
                        try {
                            if (retryError) {
                                throw new Error(`重试请求失败: ${retryError}`);
                            }
                            
                            $.log(`📥 重试API响应状态: ${retryResponse.statusCode}`);
                            $.log(`📥 重试API响应内容: ${retryBody}`);
                            
                            const retryResult = typeof retryBody === 'string' ? JSON.parse(retryBody) : retryBody;
                            if (retryResult.code === 200 && (retryResult.data?.id || (Array.isArray(retryResult.data) && retryResult.data[0]?.id))) {
                                const newId = retryResult.data?.id || (Array.isArray(retryResult.data) && retryResult.data[0].id);
                                $.log(`✅ 环境变量创建成功，ID: ${newId}`);
                                resolve(newId);
                            } else {
                                const errorMsg = retryResult.message || retryResult.error || '未知错误';
                                $.log(`❌ 重试创建失败详情: code=${retryResult.code}, message=${errorMsg}`);
                                throw new Error(`创建环境变量失败: ${errorMsg}`);
                            }
                        } catch (e) {
                            $.log(`❌ 重试创建环境变量错误: ${e.message}`);
                            resolve(null);
                        }
                    });
                    
                } else if (result.code === 200 && result.data?.id) {
                    $.log(`✅ 环境变量创建成功，ID: ${result.data.id}`);
                    resolve(result.data.id);
                } else {
                    const errorMsg = result.message || result.error || '未知错误';
                    $.log(`❌ 创建失败详情: code=${result.code}, message=${errorMsg}`);
                    throw new Error(`创建环境变量失败: ${errorMsg}`);
                }
            } catch (e) {
                $.log(`❌ 创建环境变量错误: ${e.message}`);
                resolve(null);
            }
        });
    });
}

// 使用PUT方法更新环境变量
function updateQinglongEnvValue(qinglongHost, token, envId, cookieValue) {
    return new Promise((resolve) => {
        // 先尝试字符串格式
        const requestBody = [
            {
                name: 'JD_COOKIE',
                value: cookieValue, // 数组格式，元素为字符串
            }
        ];
        
        $.log(`🔧 更新环境变量参数:`);
        $.log(`   - ID: ${envId}`);
        $.log(`   - Value长度: ${cookieValue.length}`);
        $.log(`   - 完整请求体: ${JSON.stringify(requestBody)}`);
        
        // 使用PUT方法更新指定ID的环境变量
        const options = {
            url: `${qinglongHost}/open/envs/${envId}`,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        };
        
        // 手动实现PUT请求
        const putRequest = {
            url: options.url,
            method: 'PUT',
            headers: options.headers,
            body: options.body
        };
        
        // 根据环境选择合适的请求方法
        const makeRequest = () => {
            if (typeof $task !== 'undefined') {
                // QuantumultX
                $task.fetch(putRequest).then(response => {
                    handleResponse(null, response, response.body);
                }, error => {
                    handleResponse(error, null, null);
                });
            } else if (typeof $httpClient !== 'undefined') {
                // Surge/Loon/Shadowrocket
                $httpClient.put(putRequest, handleResponse);
            } else {
                // 降级到POST方法
                $.post(options, handleResponse);
            }
        };
        
        const handleResponse = (error, response, body) => {
            $.log(`📥 更新API响应状态: ${response?.statusCode || response?.status}`);
            $.log(`📥 更新API响应内容: ${body}`);
            
            if (error) {
                $.log(`❌ 更新环境变量值网络错误: ${error}`);
            } else {
                try {
                    const result = typeof body === 'string' ? JSON.parse(body) : body;
                    $.log(`📊 解析后的响应: code=${result.code}, message=${result.message}`);
                    
                    // 如果格式不对，尝试数组格式
                    if (result.statusCode === 400 && result.message && result.message.includes('array')) {
                        $.log(`🔄 检测到需要数组格式，重新尝试更新...`);
                        
                        const retryRequestBody = {
                            name: 'JD_COOKIE',
                            value: [cookieValue], // 数组格式
                        };
                        
                        const retryPutRequest = {
                            url: options.url,
                            method: 'PUT',
                            headers: options.headers,
                            body: JSON.stringify(retryRequestBody)
                        };
                        
                        if (typeof $task !== 'undefined') {
                            $task.fetch(retryPutRequest).then(response => {
                                $.log(`📥 重试更新API响应状态: ${response.status}`);
                                $.log(`📥 重试更新API响应内容: ${response.body}`);
                                const retryResult = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
                                if (retryResult.code === 200) {
                                    $.log('✅ 环境变量值更新成功（数组格式）');
                                } else {
                                    $.log(`❌ 重试更新环境变量值失败: ${retryResult.message || '未知错误'}`);
                                }
                            });
                        } else if (typeof $httpClient !== 'undefined') {
                            $httpClient.put(retryPutRequest, (retryError, retryResponse, retryBody) => {
                                $.log(`📥 重试更新API响应状态: ${retryResponse?.statusCode}`);
                                $.log(`📥 重试更新API响应内容: ${retryBody}`);
                                const retryResult = typeof retryBody === 'string' ? JSON.parse(retryBody) : retryBody;
                                if (retryResult.code === 200) {
                                    $.log('✅ 环境变量值更新成功（数组格式）');
                                } else {
                                    $.log(`❌ 重试更新环境变量值失败: ${retryResult.message || '未知错误'}`);
                                }
                            });
                        }
                    } else if (result.code === 200) {
                        $.log('✅ 环境变量值更新成功');
                    } else {
                        $.log(`❌ 更新环境变量值失败: ${result.message || '未知错误'}`);
                    }
                } catch (parseError) {
                    $.log(`❌ 解析响应失败: ${parseError.message}`);
                }
            }
            resolve();
        };
        
        makeRequest();
    });
}

// 启用环境变量
function updateQinglongEnvStatus(qinglongHost, token, envId) {
    return new Promise((resolve) => {
        $.log(`🔧 启用环境变量 ID: ${envId}`);
        
        const options = {
            url: `${qinglongHost}/open/envs/enable`,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify([parseInt(envId)])
        };
        
        $.log(`🔧 启用请求体: ${JSON.stringify([parseInt(envId)])}`);
        
        $.post(options, (error, response, body) => {
            $.log(`📥 启用API响应状态: ${response?.statusCode}`);
            $.log(`📥 启用API响应内容: ${body}`);
            
            if (error) {
                $.log(`❌ 启用环境变量网络错误: ${error}`);
            } else {
                try {
                    const result = typeof body === 'string' ? JSON.parse(body) : body;
                    if (result.code === 200) {
                        $.log('✅ 环境变量启用成功');
                    } else {
                        $.log(`❌ 启用环境变量失败: ${result.message || '未知错误'}`);
                    }
                } catch (parseError) {
                    $.log(`❌ 解析启用响应失败: ${parseError.message}`);
                }
            }
            resolve();
        });
    });
}
// Env.js
function Env(t, e) { class s { constructor(t) { this.env = t } send(t, e = "GET") { t = "string" == typeof t ? { url: t } : t; let s = this.get; return "POST" === e && (s = this.post), new Promise(((e, i) => { s.call(this, t, ((t, s, o) => { t ? i(t) : e(s) })) })) } get(t) { return this.send.call(this.env, t) } post(t) { return this.send.call(this.env, t, "POST") } } return new class { constructor(t, e) { this.logLevels = { debug: 0, info: 1, warn: 2, error: 3 }, this.logLevelPrefixs = { debug: "[DEBUG] ", info: "[INFO] ", warn: "[WARN] ", error: "[ERROR] " }, this.logLevel = "info", this.name = t, this.http = new s(this), this.data = null, this.dataFile = "box.dat", this.logs = [], this.isMute = !1, this.isNeedRewrite = !1, this.logSeparator = "\n", this.encoding = "utf-8", this.startTime = (new Date).getTime(), Object.assign(this, e), this.log("", `🔔${this.name}, 开始!`) } getEnv() { return "undefined" != typeof $environment && $environment["surge-version"] ? "Surge" : "undefined" != typeof $environment && $environment["stash-version"] ? "Stash" : "undefined" != typeof module && module.exports ? "Node.js" : "undefined" != typeof $task ? "Quantumult X" : "undefined" != typeof $loon ? "Loon" : "undefined" != typeof $rocket ? "Shadowrocket" : void 0 } isNode() { return "Node.js" === this.getEnv() } isQuanX() { return "Quantumult X" === this.getEnv() } isSurge() { return "Surge" === this.getEnv() } isLoon() { return "Loon" === this.getEnv() } isShadowrocket() { return "Shadowrocket" === this.getEnv() } isStash() { return "Stash" === this.getEnv() } toObj(t, e = null) { try { return JSON.parse(t) } catch { return e } } toStr(t, e = null, ...s) { try { return JSON.stringify(t, ...s) } catch { return e } } getjson(t, e) { let s = e; if (this.getdata(t)) try { s = JSON.parse(this.getdata(t)) } catch { } return s } setjson(t, e) { try { return this.setdata(JSON.stringify(t), e) } catch { return !1 } } getScript(t) { return new Promise((e => { this.get({ url: t }, ((t, s, i) => e(i))) })) } runScript(t, e) { return new Promise((s => { let i = this.getdata("@chavy_boxjs_userCfgs.httpapi"); i = i ? i.replace(/\n/g, "").trim() : i; let o = this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout"); o = o ? 1 * o : 20, o = e && e.timeout ? e.timeout : o; const [r, a] = i.split("@"), n = { url: `http://${a}/v1/scripting/evaluate`, body: { script_text: t, mock_type: "cron", timeout: o }, headers: { "X-Key": r, Accept: "*/*" }, timeout: o }; this.post(n, ((t, e, i) => s(i))) })).catch((t => this.logErr(t))) } loaddata() { if (!this.isNode()) return {}; { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), i = !s && this.fs.existsSync(e); if (!s && !i) return {}; { const i = s ? t : e; try { return JSON.parse(this.fs.readFileSync(i)) } catch (t) { return {} } } } } writedata() { if (this.isNode()) { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), i = !s && this.fs.existsSync(e), o = JSON.stringify(this.data); s ? this.fs.writeFileSync(t, o) : i ? this.fs.writeFileSync(e, o) : this.fs.writeFileSync(t, o) } } lodash_get(t, e, s) { const i = e.replace(/\[(\d+)\]/g, ".$1").split("."); let o = t; for (const t of i) if (o = Object(o)[t], void 0 === o) return s; return o } lodash_set(t, e, s) { return Object(t) !== t || (Array.isArray(e) || (e = e.toString().match(/[^.[\]]+/g) || []), e.slice(0, -1).reduce(((t, s, i) => Object(t[s]) === t[s] ? t[s] : t[s] = Math.abs(e[i + 1]) >> 0 == +e[i + 1] ? [] : {}), t)[e[e.length - 1]] = s), t } getdata(t) { let e = this.getval(t); if (/^@/.test(t)) { const [, s, i] = /^@(.*?)\.(.*?)$/.exec(t), o = s ? this.getval(s) : ""; if (o) try { const t = JSON.parse(o); e = t ? this.lodash_get(t, i, "") : e } catch (t) { e = "" } } return e } setdata(t, e) { let s = !1; if (/^@/.test(e)) { const [, i, o] = /^@(.*?)\.(.*?)$/.exec(e), r = this.getval(i), a = i ? "null" === r ? null : r || "{}" : "{}"; try { const e = JSON.parse(a); this.lodash_set(e, o, t), s = this.setval(JSON.stringify(e), i) } catch (e) { const r = {}; this.lodash_set(r, o, t), s = this.setval(JSON.stringify(r), i) } } else s = this.setval(t, e); return s } getval(t) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.read(t); case "Quantumult X": return $prefs.valueForKey(t); case "Node.js": return this.data = this.loaddata(), this.data[t]; default: return this.data && this.data[t] || null } } setval(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.write(t, e); case "Quantumult X": return $prefs.setValueForKey(t, e); case "Node.js": return this.data = this.loaddata(), this.data[e] = t, this.writedata(), !0; default: return this.data && this.data[e] || null } } initGotEnv(t) { this.got = this.got ? this.got : require("got"), this.cktough = this.cktough ? this.cktough : require("tough-cookie"), this.ckjar = this.ckjar ? this.ckjar : new this.cktough.CookieJar, t && (t.headers = t.headers ? t.headers : {}, t && (t.headers = t.headers ? t.headers : {}, void 0 === t.headers.cookie && void 0 === t.headers.Cookie && void 0 === t.cookieJar && (t.cookieJar = this.ckjar))) } get(t, e = (() => { })) { switch (t.headers && (delete t.headers["Content-Type"], delete t.headers["Content-Length"], delete t.headers["content-type"], delete t.headers["content-length"]), t.params && (t.url += "?" + this.queryStr(t.params)), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient.get(t, ((t, s, i) => { !t && s && (s.body = i, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, i) })); break; case "Quantumult X": this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: i, headers: o, body: r, bodyBytes: a } = t; e(null, { status: s, statusCode: i, headers: o, body: r, bodyBytes: a }, r, a) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let s = require("iconv-lite"); this.initGotEnv(t), this.got(t).on("redirect", ((t, e) => { try { if (t.headers["set-cookie"]) { const s = t.headers["set-cookie"].map(this.cktough.Cookie.parse).toString(); s && this.ckjar.setCookieSync(s, null), e.cookieJar = this.ckjar } } catch (t) { this.logErr(t) } })).then((t => { const { statusCode: i, statusCode: o, headers: r, rawBody: a } = t, n = s.decode(a, this.encoding); e(null, { status: i, statusCode: o, headers: r, rawBody: a, body: n }, n) }), (t => { const { message: i, response: o } = t; e(i, o, o && s.decode(o.rawBody, this.encoding)) })); break } } post(t, e = (() => { })) { const s = t.method ? t.method.toLocaleLowerCase() : "post"; switch (t.body && t.headers && !t.headers["Content-Type"] && !t.headers["content-type"] && (t.headers["content-type"] = "application/x-www-form-urlencoded"), t.headers && (delete t.headers["Content-Length"], delete t.headers["content-length"]), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient[s](t, ((t, s, i) => { !t && s && (s.body = i, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, i) })); break; case "Quantumult X": t.method = s, this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: i, headers: o, body: r, bodyBytes: a } = t; e(null, { status: s, statusCode: i, headers: o, body: r, bodyBytes: a }, r, a) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let i = require("iconv-lite"); this.initGotEnv(t); const { url: o, ...r } = t; this.got[s](o, r).then((t => { const { statusCode: s, statusCode: o, headers: r, rawBody: a } = t, n = i.decode(a, this.encoding); e(null, { status: s, statusCode: o, headers: r, rawBody: a, body: n }, n) }), (t => { const { message: s, response: o } = t; e(s, o, o && i.decode(o.rawBody, this.encoding)) })); break } } time(t, e = null) { const s = e ? new Date(e) : new Date; let i = { "M+": s.getMonth() + 1, "d+": s.getDate(), "H+": s.getHours(), "m+": s.getMinutes(), "s+": s.getSeconds(), "q+": Math.floor((s.getMonth() + 3) / 3), S: s.getMilliseconds() }; /(y+)/.test(t) && (t = t.replace(RegExp.$1, (s.getFullYear() + "").substr(4 - RegExp.$1.length))); for (let e in i) new RegExp("(" + e + ")").test(t) && (t = t.replace(RegExp.$1, 1 == RegExp.$1.length ? i[e] : ("00" + i[e]).substr(("" + i[e]).length))); return t } queryStr(t) { let e = ""; for (const s in t) { let i = t[s]; null != i && "" !== i && ("object" == typeof i && (i = JSON.stringify(i)), e += `${s}=${i}&`) } return e = e.substring(0, e.length - 1), e } msg(e = t, s = "", i = "", o = {}) { const r = t => { const { $open: e, $copy: s, $media: i, $mediaMime: o } = t; switch (typeof t) { case void 0: return t; case "string": switch (this.getEnv()) { case "Surge": case "Stash": default: return { url: t }; case "Loon": case "Shadowrocket": return t; case "Quantumult X": return { "open-url": t }; case "Node.js": return }case "object": switch (this.getEnv()) { case "Surge": case "Stash": case "Shadowrocket": default: { const r = {}; let a = t.openUrl || t.url || t["open-url"] || e; a && Object.assign(r, { action: "open-url", url: a }); let n = t["update-pasteboard"] || t.updatePasteboard || s; if (n && Object.assign(r, { action: "clipboard", text: n }), i) { let t, e, s; if (i.startsWith("http")) t = i; else if (i.startsWith("data:")) { const [t] = i.split(";"), [, o] = i.split(","); e = o, s = t.replace("data:", "") } else { e = i, s = (t => { const e = { JVBERi0: "application/pdf", R0lGODdh: "image/gif", R0lGODlh: "image/gif", iVBORw0KGgo: "image/png", "/9j/": "image/jpg" }; for (var s in e) if (0 === t.indexOf(s)) return e[s]; return null })(i) } Object.assign(r, { "media-url": t, "media-base64": e, "media-base64-mime": o ?? s }) } return Object.assign(r, { "auto-dismiss": t["auto-dismiss"], sound: t.sound }), r } case "Loon": { const s = {}; let o = t.openUrl || t.url || t["open-url"] || e; o && Object.assign(s, { openUrl: o }); let r = t.mediaUrl || t["media-url"]; return i?.startsWith("http") && (r = i), r && Object.assign(s, { mediaUrl: r }), console.log(JSON.stringify(s)), s } case "Quantumult X": { const o = {}; let r = t["open-url"] || t.url || t.openUrl || e; r && Object.assign(o, { "open-url": r }); let a = t["media-url"] || t.mediaUrl; i?.startsWith("http") && (a = i), a && Object.assign(o, { "media-url": a }); let n = t["update-pasteboard"] || t.updatePasteboard || s; return n && Object.assign(o, { "update-pasteboard": n }), console.log(JSON.stringify(o)), o } case "Node.js": return }default: return } }; if (!this.isMute) switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: $notification.post(e, s, i, r(o)); break; case "Quantumult X": $notify(e, s, i, r(o)); break; case "Node.js": break }if (!this.isMuteLog) { let t = ["", "==============📣系统通知📣=============="]; t.push(e), s && t.push(s), i && t.push(i), console.log(t.join("\n")), this.logs = this.logs.concat(t) } } debug(...t) { this.logLevels[this.logLevel] <= this.logLevels.debug && (t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(`${this.logLevelPrefixs.debug}${t.map((t => t ?? String(t))).join(this.logSeparator)}`)) } info(...t) { this.logLevels[this.logLevel] <= this.logLevels.info && (t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(`${this.logLevelPrefixs.info}${t.map((t => t ?? String(t))).join(this.logSeparator)}`)) } warn(...t) { this.logLevels[this.logLevel] <= this.logLevels.warn && (t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(`${this.logLevelPrefixs.warn}${t.map((t => t ?? String(t))).join(this.logSeparator)}`)) } error(...t) { this.logLevels[this.logLevel] <= this.logLevels.error && (t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(`${this.logLevelPrefixs.error}${t.map((t => t ?? String(t))).join(this.logSeparator)}`)) } log(...t) { t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(t.map((t => t ?? String(t))).join(this.logSeparator)) } logErr(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: this.log("", `❗️${this.name}, 错误!`, e, t); break; case "Node.js": this.log("", `❗️${this.name}, 错误!`, e, void 0 !== t.message ? t.message : t, t.stack); break } } wait(t) { return new Promise((e => setTimeout(e, t))) } done(t = {}) { const e = ((new Date).getTime() - this.startTime) / 1e3; switch (this.log("", `🔔${this.name}, 结束! 🕛 ${e} 秒`), this.log(), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: $done(t); break; case "Node.js": process.exit(1) } } }(t, e) }