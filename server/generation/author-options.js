// Public selection contract. Internal variants are not extra user-selected attacks.
export const AUTHOR_ATTACK_CHOICES = Object.freeze([
  { id: 'phishing', label: 'フィッシング' },
  { id: 'stored_xss', label: 'Stored XSS' },
  { id: 'unauthorized_login', label: '不正ログイン' },
  { id: 'clickfix', label: 'ClickFix' },
  { id: 'sql_injection', label: 'SQLインジェクション' },
  { id: 'password_spray', label: 'パスワードスプレー' },
  { id: 'ransomware', label: 'ランサムウェア' },
  { id: 'unrestricted_file_upload', label: '不正ファイルアップロード' },
]);

export const SCENARIO_SETTINGS = Object.freeze([
  { id: 'company', label: '企業', organizationName: '青葉ソリューションズ',
    victimSystem: '業務ポータルと職員端末', accusedRole: '業務システムを利用する社員', networkLabel: '社内ネットワーク' },
  { id: 'government', label: '行政機関', organizationName: '水杜市役所',
    victimSystem: '庁内ポータルと職員端末', accusedRole: '行政機関の職員', networkLabel: '庁内ネットワーク' },
  { id: 'school', label: '学校', organizationName: '私立青葉学園',
    victimSystem: '校務ポータルと教職員端末', accusedRole: '校務システムを利用する教職員', networkLabel: '校内ネットワーク' },
  { id: 'university', label: '大学・研究機関', organizationName: '水杜研究大学',
    victimSystem: '研究支援ポータルと研究室端末', accusedRole: '研究支援システムを利用する研究員', networkLabel: '学内ネットワーク' },
  { id: 'hospital', label: '医療機関', organizationName: '青葉総合病院',
    victimSystem: '事務ポータルと事務職員端末', accusedRole: '事務システムを利用する職員', networkLabel: '事務用ネットワーク' },
]);
