# 搭配sync-FILES-header.yml使用，旨在备份需要指定请求头才能访问成功的链接内容。
#!/usr/bin/env python3
# 本版可备份任意类型文件，支持为部分链接自定义请求头
# 作者：Levi（改进版）

import os
import json
import requests
import subprocess
from urllib.parse import quote, quote_plus
from datetime import datetime, timedelta
import glob

# ========== 脚本配置 ==========
# 配置文件路径（请保证受版本控制）
CONFIG_FILE = "script-h-gist.json"
# 备份目录
BACKUP_DIR = "SCRIPTS-h-BACKUP"
# 失败日志目录与前缀
FAILED_DIR = "FAILED-h-LOGS"
FAILED_LOG_PREFIX = "failed-log-"
# 清理失败日志保留天数
FAILED_LOG_RETENTION_DAYS = 30

# 文件后缀到子目录映射
EXTENSION_MAP = {
    ".js": "js",
    ".sgmodule": "sgmodule",
    ".plugin": "plugin",
    ".json": "json",
    ".sh": "shell",
    ".py": "python",
    ".ts": "typescript",
    ".html": "html",
    ".css": "css",
    ".txt": "txt",
    ".md": "markdown",
    ".list": "list",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".xml": "xml",
    ".png": "image",
    ".jpg": "image",
    ".jpeg": "image",
    ".bat": "bat",
    ".plist": "plist",
    ".conf": "conf",
    ".ini": "ini",
    ".log": "log",
}

# 确保备份根目录存在
os.makedirs(BACKUP_DIR, exist_ok=True)

# 全局统计与状态
added = updated = deleted = 0
updated_files = []    # (filepath, subdir)
deleted_files = []    # (filepath, subdir)

def log(msg):
    print(f"[GIST-BACKUP] {msg}")

def get_extension_from_url(url):
    """从 URL 中提取文件扩展名，默认 .bin"""
    path = url.split('?',1)[0]
    ext = os.path.splitext(path)[1].lower()
    return ext or ".bin"

def get_subdir(ext):
    """映射扩展名到子目录，未映射归到 other"""
    return EXTENSION_MAP.get(ext, "other")

def record_failure(name, url, error_message):
    """将下载失败信息追加到当日日志"""
    os.makedirs(FAILED_DIR, exist_ok=True)
    today = datetime.now().strftime("%Y-%m-%d")
    logfile = os.path.join(FAILED_DIR, f"{FAILED_LOG_PREFIX}{today}.log")
    with open(logfile, "a", encoding="utf-8") as f:
        f.write(f"[{name}] URL: {url} 同步失败，原因：{error_message}\n")

def clean_old_failed_logs():
    """删除超过保留天数的失败日志"""
    if not os.path.isdir(FAILED_DIR):
        return
    cutoff = datetime.now() - timedelta(days=FAILED_LOG_RETENTION_DAYS)
    for fn in glob.glob(os.path.join(FAILED_DIR, f"{FAILED_LOG_PREFIX}*.log")):
        date_str = os.path.basename(fn).replace(FAILED_LOG_PREFIX,"").replace(".log","")
        try:
            if datetime.strptime(date_str, "%Y-%m-%d") < cutoff:
                os.remove(fn)
                log(f"🧹 删除旧失败日志: {fn}")
        except:
            continue

def download_and_compare(name, url, headers=None):
    """
    下载并比较文件内容：
      - 不存在：写入 -> added
      - 存在且不同：覆盖 -> updated
      - 相同：跳过
    headers: 可选 dict，自定义请求头
    """
    global added, updated
    headers = headers or {}
    ext = get_extension_from_url(url)
    subdir = get_subdir(ext)
    target_dir = os.path.join(BACKUP_DIR, subdir)
    os.makedirs(target_dir, exist_ok=True)
    filepath = os.path.join(target_dir, f"{name}{ext}")

    try:
        r = requests.get(url, headers=headers, timeout=15)
        r.raise_for_status()
        content = r.content
    except Exception as e:
        log(f"❌ 下载失败: {name} | {url} | {e}")
        record_failure(name, url, str(e))
        return

    if os.path.exists(filepath):
        with open(filepath, "rb") as f:
            old = f.read()
        if old != content:
            with open(filepath, "wb") as f:
                f.write(content)
            updated += 1
            updated_files.append((filepath, subdir))
            log(f"🔄 更新: {filepath}")
    else:
        with open(filepath, "wb") as f:
            f.write(content)
        added += 1
        updated_files.append((filepath, subdir))
        log(f"➕ 新增: {filepath}")

def cleanup_files(valid_set):
    """删除不在 valid_set 中的历史备份"""
    global deleted
    for root, _, files in os.walk(BACKUP_DIR):
        for fn in files:
            full = os.path.join(root, fn)
            if full not in valid_set:
                os.remove(full)
                sub = os.path.relpath(root, BACKUP_DIR)
                deleted_files.append((full, sub))
                deleted += 1
                log(f"🗑️ 删除过期: {full}")

def send_bark(title, content, url):
    icon = os.getenv("BARK_ICON_URL")
    try:
        if icon:
            requests.get(f"{url}/{quote(title)}/{quote(content)}?icon={quote(icon)}", timeout=5)
        else:
            requests.get(f"{url}/{quote(title)}/{quote(content)}", timeout=5)
        log("📲 Bark 推送完成")
    except Exception as e:
        log(f"❌ Bark 推送失败: {e}")

def send_serverchan(title, content, key):
    try:
        api = f"https://sctapi.ftqq.com/{key}.send"
        requests.post(api, data={"title": title, "desp": content}, timeout=5)
        log("📲 Server酱 推送完成")
    except Exception as e:
        log(f"❌ Server酱 推送失败: {e}")

def send_wechat(title, content, webhook):
    try:
        requests.post(webhook,
                      json={"msgtype": "text", "text": {"content": f"{title}\n{content}"}},
                      headers={"Content-Type": "application/json"}, timeout=5)
        log("📲 企业微信 推送完成")
    except Exception as e:
        log(f"❌ 企业微信 推送失败: {e}")

def send_telegram(title, content, token, user_id):
    try:
        requests.post(f"https://api.telegram.org/bot{token}/sendMessage",
                      data={"chat_id": user_id, "text": f"{title}\n{content}"}, timeout=5)
        log("📲 Telegram 推送完成")
    except Exception as e:
        log(f"❌ Telegram 推送失败: {e}")

def main():
    # 备份前清理并记录配置
    if not os.path.exists(CONFIG_FILE):
        log(f"❌ 未找到配置文件: {CONFIG_FILE}")
        return
    with open(CONFIG_FILE, "rb") as f:
        orig = f.read()

    clean_old_failed_logs()

    # 载入配置：列表格式 [{"name":..., "url":..., "headers":{...}}, ...]
    items = json.load(open(CONFIG_FILE, "r", encoding="utf-8"))

    valid = set()
    # 下载 & 比对
    for it in items:
        name, url = it["name"], it["url"]
        hdr = it.get("headers", {})
        download_and_compare(name, url, hdr)
        ext = get_extension_from_url(url)
        sub = get_subdir(ext)
        valid.add(os.path.join(BACKUP_DIR, sub, f"{name}{ext}"))

    # 可选清理
    if os.getenv("CLEAN_MODE", "false").lower() == "true":
        cleanup_files(valid)

    # 按文件逐一提交
    for fp, sub in updated_files:
        fn = os.path.basename(fp)
        subprocess.run(['git', 'add', fp], check=True)
        subprocess.run(['git', 'commit', '-m', f"sync({sub}): {fn}"], check=True)
    for fp, sub in deleted_files:
        fn = os.path.basename(fp)
        subprocess.run(['git', 'rm', fp], check=True)
        subprocess.run(['git', 'commit', '-m', f"remove({sub}): {fn}"], check=True)

    # 推送变更
    if updated_files or deleted_files:
        subprocess.run(['git', 'push'], check=True)

    # 配置变更也要提交
    with open(CONFIG_FILE, "rb") as f:
        new = f.read()
    if new != orig:
        subprocess.run(['git', 'add', CONFIG_FILE], check=True)
        # 只有内容变动才提交
        if subprocess.run(['git','diff','--cached','--quiet']).returncode != 0:
            subprocess.run(['git','commit','-m','config: update script-h-gist.json'], check=True)
            subprocess.run(['git','push'], check=True)

    # 通知
    notify = (os.getenv("FORCE_NOTIFY","false").lower()=="true") or added or updated or deleted
    if notify:
        lang = os.getenv("NOTIFY_LANG","en-us")
        if lang=="zh-cn":
            title = "📦 远程文件自动备份"
            content = f"✅ 完成：新增 {added}，更新 {updated}，删除 {deleted}"
        else:
            title = "📦 Remote File Backup"
            content = f"✅ Done: Added {added}, Updated {updated}, Deleted {deleted}"

        if url := os.getenv("BARK_PUSH_URL"):
            send_bark(title, content, url)
        if key := os.getenv("SERVERCHAN_SEND_KEY"):
            send_serverchan(title, content, key)
        if hook := os.getenv("WECHAT_WEBHOOK_URL"):
            send_wechat(title, content, hook)
        if tok:=os.getenv("TG_BOT_TOKEN") and uid:=os.getenv("TG_USER_ID"):
            send_telegram(title, content, os.getenv("TG_BOT_TOKEN"), os.getenv("TG_USER_ID"))

if __name__ == "__main__":
    main()
