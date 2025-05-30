# 搭配sync-FILES-header.yml使用，旨在备份需要指定请求头才能访问成功的链接内容。
#!/usr/bin/env python3
import os
import json
import logging
import subprocess
from datetime import datetime, timedelta
import requests
import glob

# ========== 脚本配置 ==========
# 配置文件路径（请保证该文件受版本控制）
CONFIG_FILE = "script-h-gist.json"
# 备份目录
BACKUP_DIR = "SCRIPTS-h-BACKUP"
# 失败日志目录与前缀
FAILED_DIR = "FAILED-h-LOGS"
FAILED_LOG_PREFIX = "failed-log-"
# 清理失败日志的保留天数（天）
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
    ".log": "log"
}

# 日志格式配置
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)

def get_extension_from_url(url):
    """
    从 URL 中提取文件扩展名，如果无法解析则返回 '.bin'。
    """
    basename = os.path.basename(url.split('?', 1)[0])
    ext = os.path.splitext(basename)[1].lower()
    return ext or '.bin'

def get_subdir(ext):
    """
    映射扩展名到子目录，未映射项归为 'other'。
    """
    return EXTENSION_MAP.get(ext, 'other')

def record_failure(name, url, error_message):
    """
    记录下载或写入失败的信息到当天日志。
    """
    os.makedirs(FAILED_DIR, exist_ok=True)
    today = datetime.now().strftime('%Y-%m-%d')
    log_file = os.path.join(FAILED_DIR, f"{FAILED_LOG_PREFIX}{today}.log")
    with open(log_file, 'a', encoding='utf-8') as f:
        f.write(f"[{datetime.now().isoformat()}] {name} | {url} | {error_message}\n")

def clean_old_failed_logs():
    """
    删除超过保留天数的失败日志。
    """
    if not os.path.isdir(FAILED_DIR):
        return
    cutoff = datetime.now() - timedelta(days=FAILED_LOG_RETENTION_DAYS)
    for fpath in glob.glob(os.path.join(FAILED_DIR, f"{FAILED_LOG_PREFIX}*.log")):
        fname = os.path.basename(fpath)
        date_str = fname.replace(FAILED_LOG_PREFIX, '').replace('.log', '')
        try:
            log_date = datetime.strptime(date_str, '%Y-%m-%d')
            if log_date < cutoff:
                os.remove(fpath)
                logging.info(f"已删除过期失败日志: {fpath}")
        except ValueError:
            continue

def download_and_compare(item):
    """
    下载并对比文件：
      - 新增 (added)
      - 更新 (updated)
      - 相同跳过 (skipped)
      - 失败 (failed)
    国产配置支持 headers 字段。
    """
    name = item.get('name')
    url = item.get('url')
    headers = item.get('headers', {}) or {}

    ext = get_extension_from_url(url)
    subdir = get_subdir(ext)
    os.makedirs(os.path.join(BACKUP_DIR, subdir), exist_ok=True)
    target_file = os.path.join(BACKUP_DIR, subdir, name + ext)

    try:
        resp = requests.get(url, headers=headers, timeout=15)
        resp.raise_for_status()
        content = resp.content
    except Exception as e:
        logging.error(f"下载失败: {name} | {url} | {e}")
        record_failure(name, url, str(e))
        return 'failed'

    if os.path.exists(target_file):
        with open(target_file, 'rb') as f:
            old = f.read()
        if old != content:
            with open(target_file, 'wb') as f:
                f.write(content)
            logging.info(f"更新文件: {target_file}")
            return 'updated'
        else:
            logging.info(f"跳过无变化: {target_file}")
            return 'skipped'
    else:
        with open(target_file, 'wb') as f:
            f.write(content)
        logging.info(f"新增文件: {target_file}")
        return 'added'

def cleanup_files(valid_paths):
    """
    删除不在 valid_paths 中的旧备份。
    返回删除列表。
    """
    removed = []
    if not os.path.isdir(BACKUP_DIR):
        return removed
    for subdir in os.listdir(BACKUP_DIR):
        dirpath = os.path.join(BACKUP_DIR, subdir)
        if not os.path.isdir(dirpath):
            continue
        for fname in os.listdir(dirpath):
            fullpath = os.path.join(dirpath, fname)
            if fullpath not in valid_paths:
                os.remove(fullpath)
                logging.info(f"删除过期备份: {fullpath}")
                removed.append(fullpath)
    return removed

def send_notifications(summary):
    """
    按 NOTIFY_LANG 环境变量选择中英文，
    支持 Bark, Server酱, 企业微信, Telegram 推送。
    """
    lang = os.getenv('NOTIFY_LANG', 'en-us').lower()
    labels = {
        'added': '新增' if lang == 'zh-cn' else 'Added',
        'updated': '更新' if lang == 'zh-cn' else 'Updated',
        'skipped': '跳过' if lang == 'zh-cn' else 'Skipped',
        'removed': '删除' if lang == 'zh-cn' else 'Removed',
    }
    title = '同步结果' if lang == 'zh-cn' else 'Sync Summary'
    parts = [f"{labels[k]}: {summary.get(k, 0)}" for k in labels]
    message = title + "\n" + "\n".join(parts)

    # Bark 推送
    bark_url = os.getenv('BARK_PUSH_URL')
    if bark_url:
        try:
            from urllib.parse import quote_plus
            url = bark_url.rstrip('/') + '/' + quote_plus(message)
            requests.get(url, timeout=5)
        except Exception as e:
            logging.warning(f"Bark 推送失败: {e}")
    # Server酱 推送
    sckey = os.getenv('SERVERCHAN_SEND_KEY')
    if sckey:
        try:
            api = f"https://sctapi.ftqq.com/{sckey}.send"
            requests.post(api, json={'title': title, 'desp': message}, timeout=5)
        except Exception as e:
            logging.warning(f"Server酱 推送失败: {e}")
    # 企业微信 推送
    wechat_url = os.getenv('WECHAT_WEBHOOK_URL')
    if wechat_url:
        try:
            requests.post(wechat_url, json={'msgtype':'text','text':{'content':message}}, headers={'Content-Type':'application/json'}, timeout=5)
        except Exception as e:
            logging.warning(f"企业微信 推送失败: {e}")
    # Telegram 推送
    tg_token = os.getenv('TG_BOT_TOKEN')
    tg_user = os.getenv('TG_USER_ID')
    if tg_token and tg_user:
        try:
            requests.post(f"https://api.telegram.org/bot{tg_token}/sendMessage", params={'chat_id':tg_user,'text':message}, timeout=5)
        except Exception as e:
            logging.warning(f"Telegram 推送失败: {e}")

def main():
    # 读取并保存配置原始内容，用于变更检测
    if not os.path.exists(CONFIG_FILE):
        logging.error(f"未找到配置文件: {CONFIG_FILE}")
        return
    with open(CONFIG_FILE, 'rb') as f:
        original_cfg = f.read()

    # 清理过期失败日志
    clean_old_failed_logs()

    # 加载配置列表
    with open(CONFIG_FILE, 'r', encoding='utf-8') as cf:
        items = json.load(cf)

    # 执行下载、比对与统计
    stats = {'added':0,'updated':0,'skipped':0,'failed':0}
    valid_paths = set()
    for item in items:
        res = download_and_compare(item)
        if res in stats:
            stats[res] += 1
        ext = get_extension_from_url(item.get('url'))
        valid_paths.add(os.path.join(BACKUP_DIR, get_subdir(ext), item['name']+ext))

    # 清理过期备份
    removed = cleanup_files(valid_paths)
    stats['removed'] = len(removed)

    # 发送通知
    send_notifications(stats)

    # 配置变更则自动提交并推送到 Git 远程仓库
    with open(CONFIG_FILE, 'rb') as f:
        new_cfg = f.read()
    if new_cfg != original_cfg:
        try:
            subprocess.run(['git','add',CONFIG_FILE],check=True)
            subprocess.run(['git','commit','-m','config: update script-h-gist.json'],check=True)
            subprocess.run(['git','push'],check=True)
            logging.info("配置变更已提交并推送到远程仓库")
        except subprocess.CalledProcessError as e:
            logging.error(f"Git 操作失败: {e}")

if __name__ == '__main__':
    main()

