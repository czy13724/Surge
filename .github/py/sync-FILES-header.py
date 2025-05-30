# 搭配sync-FILES-header.yml使用，旨在备份需要指定请求头才能访问成功的链接内容。
#!/usr/bin/env python3
import os
import json
import shutil
import logging
from datetime import datetime, timedelta
import requests
import glob

# ========== 脚本配置 ==========
# 配置文件路径
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
    从 URL 中提取文件扩展名，用于后续分类存储。
    如果无法解析，则返回 '.bin' 作为默认后缀。
    """
    basename = os.path.basename(url.split('?', 1)[0])
    ext = os.path.splitext(basename)[1].lower()
    return ext or '.bin'


def get_subdir(ext):
    """
    根据文件扩展名映射到对应的子目录名称，
    未在映射表中的扩展名统一放到 'other' 目录。
    """
    return EXTENSION_MAP.get(ext, 'other')


def record_failure(name, url, error_message):
    """
    将下载或写入失败的记录追加到当日的日志文件中，
    日志文件保存在 FAILED_DIR 目录下。
    """
    if not os.path.isdir(FAILED_DIR):
        os.makedirs(FAILED_DIR, exist_ok=True)
    today = datetime.now().strftime('%Y-%m-%d')
    log_file = os.path.join(FAILED_DIR, f"{FAILED_LOG_PREFIX}{today}.log")
    with open(log_file, 'a', encoding='utf-8') as f:
        f.write(f"[{datetime.now().isoformat()}] {name} | {url} | {error_message}\n")


def clean_old_failed_logs():
    """
    清理超过保留天数的失败日志，按文件日期判断并删除。
    """
    if not os.path.isdir(FAILED_DIR):
        return
    cutoff = datetime.now() - timedelta(days=FAILED_LOG_RETENTION_DAYS)
    pattern = os.path.join(FAILED_DIR, f"{FAILED_LOG_PREFIX}*.log")
    for fpath in glob.glob(pattern):
        fname = os.path.basename(fpath)
        date_str = fname.replace(FAILED_LOG_PREFIX, '').replace('.log', '')
        try:
            log_date = datetime.strptime(date_str, '%Y-%m-%d')
            if log_date < cutoff:
                os.remove(fpath)
                logging.info(f"已删除过期失败日志: {fpath}")
        except ValueError:
            # 文件名格式不符合预期则跳过
            continue


def download_and_compare(item):
    """
    下载并对比单个文件：
    - 若文件不存在则保存并统计为 'added'
    - 若内容不同则覆盖并统计为 'updated'
    - 若内容相同则跳过并统计为 'skipped'
    - 若下载或写入出错则统计为 'failed' 并记录日志

    参数 item 为字典，包含:
      - name: 目标文件名（不含后缀）
      - url: 下载链接
      - headers: 可选，字典形式的 HTTP 请求头

    返回值: 操作类型字符串 'added'/'updated'/'skipped'/'failed'
    """
    name = item.get('name')
    url = item.get('url')
    headers = item.get('headers', {}) or {}

    ext = get_extension_from_url(url)
    subdir = get_subdir(ext)
    target_dir = os.path.join(BACKUP_DIR, subdir)
    os.makedirs(target_dir, exist_ok=True)
    target_file = os.path.join(target_dir, name + ext)

    try:
        resp = requests.get(url, headers=headers, timeout=15)
        resp.raise_for_status()
        content = resp.content
    except Exception as e:
        logging.error(f"下载失败: {name} 从 {url} 出错: {e}")
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
            logging.info(f"跳过，无变化: {target_file}")
            return 'skipped'
    else:
        with open(target_file, 'wb') as f:
            f.write(content)
        logging.info(f"新增文件: {target_file}")
        return 'added'


def cleanup_files(valid_paths):
    """
    清理不在本次配置列表中的备份文件，
    删除后在日志中打印并统计。

    参数 valid_paths: 本次应保留文件的完整路径集合
    返回: 删除的文件路径列表
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
    根据环境变量自动选择通知方式，支持 Bark、Server酱、企业微信、Telegram。
    根据 NOTIFY_LANG 参数切换中英语言。
    参数 summary: 字典，包含 'added','updated','skipped','removed' 计数
    """
    lang = os.getenv('NOTIFY_LANG', 'en-us').lower()
    labels = {
        'added': '新增' if lang == 'zh-cn' else 'Added',
        'updated': '更新' if lang == 'zh-cn' else 'Updated',
        'skipped': '跳过' if lang == 'zh-cn' else 'Skipped',
        'removed': '删除' if lang == 'zh-cn' else 'Removed',
    }
    title = '同步结果' if lang == 'zh-cn' else 'Sync Summary'
    parts = [f"{labels[key]}: {summary.get(key,0)}" for key in labels]
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

    # Server 酱
    sckey = os.getenv('SERVERCHAN_SEND_KEY')
    if sckey:
        try:
            api = f"https://sctapi.ftqq.com/{sckey}.send"
            data = {'title': title, 'desp': message}
            requests.post(api, json=data, timeout=5)
        except Exception as e:
            logging.warning(f"Server酱 推送失败: {e}")

    # 企业微信机器人
    wechat_url = os.getenv('WECHAT_WEBHOOK_URL')
    if wechat_url:
        try:
            payload = {'msgtype': 'text', 'text': {'content': message}}
            headers = {'Content-Type': 'application/json'}
            requests.post(wechat_url, json=payload, headers=headers, timeout=5)
        except Exception as e:
            logging.warning(f"企业微信 推送失败: {e}")

    # Telegram 机器人
    tg_token = os.getenv('TG_BOT_TOKEN')
    tg_user = os.getenv('TG_USER_ID')
    if tg_token and tg_user:
        try:
            api = f"https://api.telegram.org/bot{tg_token}/sendMessage"
            params = {'chat_id': tg_user, 'text': message}
            requests.post(api, params=params, timeout=5)
        except Exception as e:
            logging.warning(f"Telegram 推送失败: {e}")


def main():
    # 检查配置文件是否存在
    if not os.path.exists(CONFIG_FILE):
        logging.error(f"未找到配置文件: {CONFIG_FILE}")
        return

    # 清理旧失败日志
    clean_old_failed_logs()

    # 读取配置
    with open(CONFIG_FILE, 'r', encoding='utf-8') as cf:
        items = json.load(cf)

    # 初始化统计
    stats = {'added': 0, 'updated': 0, 'skipped': 0, 'failed': 0}
    valid_paths = set()

    # 执行下载与比对
    for item in items:
        result = download_and_compare(item)
        if result in stats:
            stats[result] += 1
        # 记录应保留的文件路径
        url = item.get('url')
        ext = get_extension_from_url(url)
        subdir = get_subdir(ext)
        valid_paths.add(os.path.join(BACKUP_DIR, subdir, item['name'] + ext))

    # 清理过期备份文件
    removed = cleanup_files(valid_paths)
    stats['removed'] = len(removed)

    # 发送通知
    send_notifications(stats)

if __name__ == '__main__':
    main()
