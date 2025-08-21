#!/usr/bin/env zsh
set -euo pipefail

red()  { print -P "%F{1}$*%f"; }
yel()  { print -P "%F{3}$*%f"; }
grn()  { print -P "%F{2}$*%f"; }
inf()  { print -P "%F{4}$*%f"; }

# ========== 0) 重要警語 ==========
yel "[警語] 請確認：這是正確的專案資料夾。"
yel "[警語] 不要將任何金鑰、密碼、Token、私鑰、.env 推上公開 GitHub。"
yel "[警語] 如發現祕密，立刻停止 push，改用環境變數或 GitHub Secrets。"

# ========== 1) Shell 歷史紀錄防漏 ==========
# 在當前 session 暫時強化歷史規則
setopt HIST_IGNORE_SPACE 2>/dev/null || true
setopt HIST_REDUCE_BLANKS 2>/dev/null || true
export HISTCONTROL=ignorespace

# ========== 2) Git 基本狀態與 remote 安全性 ==========
inf "[檢查] Git 狀態與 remote"
git rev-parse --is-inside-work-tree >/dev/null || { red "非 Git 目錄"; exit 1; }

git status -sb || true
inf "Remote 列表："
git remote -v || true

# 禁止使用明文 http
if git remote -v | grep -E 'http://'; then
  red "[阻擋] 發現 http:// remote，請改用 https 或 ssh。"
  exit 1
fi

# ========== 3) Git 設定硬化（僅影響此 repo） ==========
inf "[設定] 針對此 repo 硬化"
git config --local advice.addIgnoredFile false
git config --local core.autocrlf input
git config --local pull.rebase false
git config --local commit.gpgsign true 2>/dev/null || true     # 若無 GPG 會忽略
git config --local gpg.program gpg 2>/dev/null || true

# ========== 4) .gitignore 與敏感檔案快篩 ==========
inf "[檢查] .gitignore 與常見敏感檔案"
[[ -f .gitignore ]] || yel "[提醒] 缺少 .gitignore，建議新增。"

# 常見敏感檔名
SUSPECT_FILES=(
  ".env" ".env.*" ".npmrc" "id_rsa" "id_dsa" "*.pem" "*.key" "*.p12" "*.keystore"
  "credentials.json" "service_account.json" "aws_credentials" "docker-compose.override.yml"
)

FOUND_SUSPECT=0
for pat in $SUSPECT_FILES; do
  if git ls-files -co --exclude-standard | grep -E "^${pat//\./\\.}$" >/dev/null 2>&1; then
    red "[警告] 追蹤或未忽略的敏感檔案：$pat"
    FOUND_SUSPECT=1
  fi
done

# ========== 5) 秘密字串掃描（工作樹） ==========
inf "[掃描] 工作樹秘密字串（輕量）"
RG="rg"
command -v rg >/dev/null || RG="grep -R --line-number --binary-files=without-match"

PATTERNS=(
  "AKIA[0-9A-Z]{16}"                            # AWS Access Key
  "ASIA[0-9A-Z]{16}"
  "ghp_[0-9A-Za-z]{36}"                         # GitHub PAT
  "xox[baprs]-[0-9A-Za-z-]{10,48}"              # Slack
  "AIza[0-9A-Za-z-_]{35}"                       # Google API
  "-----BEGIN(.*)PRIVATE KEY-----"              # Private key
  "SECRET|TOKEN|PASSWORD|PASS|API_KEY|ADMIN_TOKEN|SHOPIFY_ADMIN_TOKEN|NOTION_TOKEN"
)

SEC_HIT=0
for p in $PATTERNS; do
  if $RG -n --hidden --glob '!.git/' -E "$p" . >/tmp/_sec_hits.$$ 2>/dev/null; then
    if [[ -s /tmp/_sec_hits.$$ ]]; then
      red "[發現疑似秘密] Pattern: $p"
      cat /tmp/_sec_hits.$$ | sed -e 's/\x1b\[[0-9;]*m//g' | head -n 20
      SEC_HIT=1
    fi
  fi
done
rm -f /tmp/_sec_hits.$$ || true

# ========== 6) 歷史紀錄掃描（已提交內容） ==========
inf "[掃描] Git 歷史（敏感字樣）"
# 僅示範快速檢索；如需更嚴格可改用 trufflehog 或 git-secrets
if git log -p -G "(SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE KEY)" -- . | head -n 1 >/dev/null 2>&1; then
  if git log -p -G "(SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE KEY)" -- . | head -n 1 | grep -q .; then
    red "[警告] 歷史提交可能含敏感字樣。建議：git rebase -i 或 git filter-repo 清除。"
    SEC_HIT=1
  fi
fi

# ========== 7) 大檔與產物檢查 ==========
inf "[檢查] 大檔與建置產物"
# 大於 20MB 的追蹤檔
git ls-files -s | awk '{print $4}' | while read -r f; do
  [[ -f "$f" ]] || continue
  sz=$(wc -c <"$f" 2>/dev/null || echo 0)
  if (( sz > 20*1024*1024 )); then
    yel "[注意] 大檔案 >20MB：$f"
  fi
done

# 常見 build 產物建議忽略
SUGGEST_IGNORE=(
  "node_modules/"
  "dist/"
  "build/"
  ".DS_Store"
  ".env*"
  "logs/"
  "*.log"
)
if [[ ! -f .gitignore ]]; then
  yel "[提醒] 建議建立 .gitignore 並加入常見規則。"
else
  for ig in $SUGGEST_IGNORE; do
    if ! grep -qx "$ig" .gitignore 2>/dev/null; then
      yel "[建議] 將 \"$ig\" 加入 .gitignore"
    fi
  done
fi

# ========== 8) 預推送自檢（Hook 可選） ==========
inf "[自檢] 未提交變更與訊息規範"
git add -N . >/dev/null 2>&1 || true
git status -sb

# 檢查使用者資訊
if [[ -z "$(git config user.name)" || -z "$(git config user.email)" ]]; then
  red "[阻擋] 尚未設定 git user.name 或 user.email（至少在此 repo 設定）。"
  exit 1
fi

# ========== 9) 綜合判定 ==========
if (( FOUND_SUSPECT == 1 || SEC_HIT == 1 )); then
  red "[結論] 偵測到風險或敏感內容。禁止 push。請先處理後重跑。"
  exit 1
fi

grn "[通過] 未發現明顯風險。可以推送。"

# ========== 10) 上傳流程（互動式） ==========
read -q "?是否要推送到 GitHub？(y/N) " || { yel "\n已取消推送。"; exit 0; }
print

# 保障：確認分支與遠端
BR=$(git rev-parse --abbrev-ref HEAD)
inf "目前分支：$BR"
if ! git remote get-url origin >/dev/null 2>&1; then
  yel "[提醒] 尚未設定 origin。執行：git remote add origin <ssh-or-https-url>"
  exit 1
fi

# 建議先壓縮歷史（可選）
read -q "?是否以 squash merge 的方式壓縮當前歷史後再推送？(y/N) " && DO_SQUASH=1 || DO_SQUASH=0
print
if (( DO_SQUASH == 1 )); then
  inf "[動作] 建立暫存分支並壓縮為單一提交"
  git checkout -b _squash_tmp
  git reset $(git commit-tree HEAD^{tree} -m "squash: $(date -u +'%Y-%m-%d') initial sanitized commit")
  git checkout -B "$BR" _squash_tmp
  git branch -D _squash_tmp
fi

# 實際推送
inf "[推送] git push -u origin $BR"
git push -u origin "$BR"
grn "[完成] 已推送。"
