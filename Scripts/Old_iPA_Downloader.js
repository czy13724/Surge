/*
Old_iPA_Downloader by @Lãng Khách
Requires: Computers need to trust root Surge certificate and set proxy rule domain-keyword: -buy.itunes.apple.com. (iOS. Open AppleStore search app. Share app into shortcut Old_iPA_Downloader, choose version app. PC: Open iTunes search and click Get). Done (Check \Music\iTunes\iTunes Media\Mobile Applications)
旧版本ipa下载
要求：电脑要添加surge证书信任并设置代理规则，规则如下：domain-keyword: -buy.itunes.apple.com。(iOS: 打开AppStore搜索应用分享到快捷指令Old_iPA_Downloader选择应用版本https://www.icloud.com/shortcuts/bdbba3de9c8d42fe858bf210d20e5603；MAC:打开iTunes搜索并点击get/安装)

[rewrite_local]
(https:\/\/(.+\-|)buy\.itunes\.apple\.com\/WebObjects\/MZBuy.woa\/wa\/buyProduct)|(https:\/\/api\.unlimapps\.com\/.+\/apple_apps\/.+\/versions\?=) url script-request-body https://raw.githubusercontent.com/czy13724/Surge/main/quote/Old_iPA_Downloader.js

[mitm]
hostname = *-buy.itunes.apple.com, api.unlimapps.com
*/
var url = $request.url;
var obj = $request.body;

const api= "unlimapps";
const buy= "buyProduct";

if(url.indexOf(api) != -1){
var appidget = url.match(/\d{6,}$/);
console.log("🟢\n appid: " + appidget);
$persistentStore.write(appidget.toString(),"appid");
$notification.post('Old_iPA_Dowloader', 'iTunes PC search app and click Get', 'By @Lãng Khách');
$done({body});
}
if(url.indexOf(buy) != -1){ 
var appid= $persistentStore.read("appid");
var body= obj.replace(/\d{6,}/, appid);
console.log('🟢 Old_iPA_Downloader \nappid: ' + appid);
$notification.post("Old_iPA_Downloader rewrite stustus: OK","","");
$done({body});
}
