/**
 * @name Talkatone 广告静默拦截与防重试 Mock
 * @author Levi
 * @description 拦截 Talkatone 自有广告接口 (d.tktn.be) 并 Mock 返回合法 no-fill XML，消除死循环轮询重试；Mock 遥测接口 (a1.tktn.be) 清空本地事件积压队列。
 */

const url = $request.url;

function sendMockResponse(statusCode, headers, body) {
    if (typeof $task !== "undefined") {
        const statusLine = statusCode === 200 ? "HTTP/1.1 200 OK" : `HTTP/1.1 ${statusCode} No Content`;
        $done({ status: statusLine, headers: headers, body: body });
    } else {
        $done({ response: { status: statusCode, headers: headers, body: body } });
    }
}

if (url.includes("d.tktn.be")) {
    const mockXml = '<?xml version="1.0" encoding="UTF-8"?><iq type="result"><ad status="no-fill"/></iq>';
    sendMockResponse(200, {
        "Content-Type": "application/xml; charset=utf-8",
        "Connection": "close"
    }, mockXml);
} else if (url.includes("a1.tktn.be")) {
    sendMockResponse(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Connection": "close"
    }, JSON.stringify({ status: "ok", code: 200 }));
} else {
    sendMockResponse(204, { "Connection": "close" }, "");
}
