# 本版可备份任意类型文件
# 作者：Levi
# 需搭配sync_FILES.yml使用
#!/usr/bin/env python3
import os, requests
from urllib.parse import quote, urlparse
import re
from datetime import datetime, timedelta

CONFIG_FILE = "script-backup.txt"  # 每行一条："名称":"链接"
BACKUP_DIR = "backup"
FAILED_DIR = BACKUP_DIR
FAILED_LOG_PREFIX = "failed_"

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
    ".log": "log"
}

def get_extension_from_url(url):
    path = urlparse(url).path
    match = re.search(r"\.([a-zA-Z0-9]+)$", path)
    if match:
        return "." + match.group(1).lower()
    else:
        return ".bin"

def get_subdir(ext):
    return EXTENSION_MAP.get(ext, "other")

os.makedirs(BACKUP_DIR, exist_ok=True)

added, updated, deleted = 0, 0, 0
updated_files = []
deleted_files = []
failed_sync = []
added_by_type = {}
updated_by_type = {}
deleted_by_type = {}

def log(msg): print(f"[GIST-BACKUP] {msg}")

def parse_config_file(path):
    config = {}
    with open(path, "r", encoding="utf-8") as f:
        for lineno, raw in enumerate(f, start=1):
            line = raw.strip()
            if not line or line.startswith("#") or line.startswith("//"):
                continue
            if line.endswith(","):
                line = line[:-1].rstrip()

            name = None
            url = None

            if line[0] in ("'", '"'):
                quote = line[0]
                end = line.find(quote, 1)
                if end != -1:
                    name = line[1:end].strip()
                    rest = line[end + 1:].lstrip()
                    if rest.startswith(":"):
                        rest = rest[1:].lstrip()
                    if rest:
                        if rest[0] in ("'", '"'):
                            q = rest[0]
                            endu = rest.find(q, 1)
                            if endu != -1:
                                url = rest[1:endu].strip()
                            else:
                                url = rest[1:].strip()
                        else:
                            url = rest.strip()

            if name is None or url is None:
                if ":" in line:
                    name_part, _, rest = line.partition(":")
                    name = name_part.strip().strip('"').strip("'")
                    url = rest.strip().strip('"').strip("'")

            if not name or not url:
                log(f"⚠️ Invalid line {lineno}: {raw.strip()}")
                continue

            config[name] = url

    return config

def record_failure(name, url, error_message):
    today = datetime.now().strftime("%Y-%m-%d")
    failed_log_file = os.path.join(FAILED_DIR, f"{FAILED_LOG_PREFIX}{today}.log")
    with open(failed_log_file, "a", encoding="utf-8") as f:
        f.write(f"[{name}] 对应链接为 {url} ，同步失败 ，状态原因：{error_message}\n")

def clean_old_failed_logs():
    now = datetime.now()
    cutoff = now - timedelta(days=30)
    for fname in os.listdir(FAILED_DIR):
        if fname.startswith(FAILED_LOG_PREFIX) and fname.endswith(".log"):
            full_path = os.path.join(FAILED_DIR, fname)
            try:
                date_str = fname.replace(FAILED_LOG_PREFIX, "").replace(".log", "")
                file_date = datetime.strptime(date_str, "%Y-%m-%d")
                if file_date < cutoff:
                    os.remove(full_path)
                    log(f"🧹 Deleted old failed log: {fname}")
            except:
                continue

def download_and_compare(name, url):
    global added, updated
    ext = get_extension_from_url(url)
    subdir = get_subdir(ext)
    target_dir = os.path.join(BACKUP_DIR, subdir)
    os.makedirs(target_dir, exist_ok=True)
    filename = os.path.join(target_dir, f"{name}{ext}")

    try:
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        content = resp.text
        if os.path.exists(filename):
            with open(filename, "r", encoding="utf-8") as f:
                if f.read() != content:
                    with open(filename, "w", encoding="utf-8") as wf:
                        wf.write(content)
                    updated_files.append((filename, subdir))
                    updated_by_type.setdefault(subdir, []).append(name)
                    updated += 1
        else:
            with open(filename, "w", encoding="utf-8") as f:
                f.write(content)
            updated_files.append((filename, subdir))
            added_by_type.setdefault(subdir, []).append(name)
            added += 1
    except Exception as e:
        log(f"❌ Failed to fetch {name}: {e}")
        record_failure(name, url, str(e))

def cleanup_files(valid_files_set):
    global deleted, deleted_files
    for root, dirs, files in os.walk(BACKUP_DIR):
        for fname in files:
            if fname.startswith(FAILED_LOG_PREFIX):
                continue  # 不清理失败日志
            full_path = os.path.join(root, fname)
            if full_path not in valid_files_set:
                os.remove(full_path)
                subdir = os.path.relpath(root, BACKUP_DIR)
                deleted_files.append((full_path, subdir))
                deleted_by_type.setdefault(subdir, []).append(os.path.splitext(fname)[0])
                deleted += 1
# Bark app通知
def send_bark(title, content, url):
    icon = os.getenv("BARK_ICON_URL")  # 获取 BARK_ICON_URL 环境变量
    try:
        # 如果设置了图标，加入 ?icon 参数
        if icon:
            requests.get(f"{url}/{quote(title)}/{quote(content)}?icon={quote(icon)}", timeout=5)
        else:
            requests.get(f"{url}/{quote(title)}/{quote(content)}", timeout=5)
        log("📲 Bark sent.")
    except Exception as e:
        log(f"❌ Bark failed: {e}")
# Server酱通知
def send_serverchan(title, content, key):
    try:
        requests.post(f"https://sctapi.ftqq.com/{key}.send",
                      data={"title": title, "desp": content}, timeout=5)
        log("📲 Server酱 sent.")
    except Exception as e:
        log(f"❌ Server酱 failed: {e}")
# 企业微信机器人通知
def send_wechat(title, content, webhook_url):
    try:
        requests.post(webhook_url,
                      json={"msgtype": "text", "text": {"content": f"{title}\n{content}"}},
                      headers={"Content-Type": "application/json"}, timeout=5)
        log("📲 企业微信 sent.")
    except Exception as e:
        log(f"❌ 企业微信 failed: {e}")
# TG机器人通知
def send_telegram(title, content, token, user_id):
    try:
        requests.post(f"https://api.telegram.org/bot{token}/sendMessage",
                      data={"chat_id": user_id, "text": f"{title}\n{content}"}, timeout=5)
        log("📲 Telegram sent.")
    except Exception as e:
        log(f"❌ Telegram failed: {e}")

def main():
    if not os.path.exists(CONFIG_FILE):
        log(f"❌ No config file found: {CONFIG_FILE}")
        return

    clean_old_failed_logs()

    config = parse_config_file(CONFIG_FILE)

    valid_files_set = set()

    for name, url in config.items():
        ext = get_extension_from_url(url)
        subdir = get_subdir(ext)
        target_dir = os.path.join(BACKUP_DIR, subdir)
        os.makedirs(target_dir, exist_ok=True)
        filename = os.path.join(target_dir, f"{name}{ext}")
        valid_files_set.add(filename)
        download_and_compare(name, url)

    if os.getenv("CLEAN_MODE", "true") == "true":
        cleanup_files(valid_files_set)

    if updated_files or deleted_files or os.path.exists(CONFIG_FILE):
        os.system("git add -A")
        staged = os.popen("git diff --cached --name-only").read().splitlines()
        parts = []

        def compact_list(items, limit=6):
            seen = set()
            ordered = []
            for item in items:
                if item in seen:
                    continue
                seen.add(item)
                ordered.append(item)
            if len(ordered) <= limit:
                return ordered
            return ordered[:limit] + [f"...+{len(ordered) - limit}"]

        def add_parts(prefix, data):
            for subdir, names in data.items():
                compacted = compact_list(names)
                parts.append(f"{prefix}{subdir}({len(names)}:{','.join(compacted)})")

        if added_by_type:
            add_parts("+", added_by_type)
        if updated_by_type:
            add_parts("~", updated_by_type)
        if deleted_by_type:
            add_parts("-", deleted_by_type)

        if CONFIG_FILE in staged:
            parts.append(f"cfg({CONFIG_FILE})")

        summary = "sync: " + (" ".join(parts) if parts else "no changes")
        os.system(f'git diff --cached --quiet || git commit -m "{summary}"')
        os.system("git push")

    notify = os.getenv("FORCE_NOTIFY", "true").lower() == "true" or added or updated or deleted
    if notify:
        lang = os.getenv("NOTIFY_LANG", "en-us")
        if lang == "zh-cn":
            title = "📦 远程文件自动备份"
            content = f"✅远程脚本自动备份完成\n🆕 新增: {added} 个\n📝 修改: {updated} 个\n🗑️ 删除: {deleted} 个"
        else:
            title = "📦 Remote File Backup"
            content = f"✅Remote File Backup Completed\n🆕 Added: {added}\n📝 Updated: {updated}\n🗑️ Deleted: {deleted}"

        if url := os.getenv("BARK_PUSH_URL"):
            send_bark(title, content, url)
        if key := os.getenv("SERVERCHAN_SEND_KEY"):
            send_serverchan(title, content, key)
        if hook := os.getenv("WECHAT_WEBHOOK_URL"):
            send_wechat(title, content, hook)
        if os.getenv("TG_BOT_TOKEN") and os.getenv("TG_USER_ID"):
            send_telegram(title, content, os.getenv("TG_BOT_TOKEN"), os.getenv("TG_USER_ID"))

if __name__ == "__main__":
    main()
