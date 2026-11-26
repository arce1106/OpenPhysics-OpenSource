import { Link } from 'react-router-dom';

interface AccountAccessPanelProps {
  title?: string;
  description?: string;
  features?: string[];
}

export default function AccountAccessPanel({
  title = '登录后使用学习功能',
  description = '请使用部署管理员提供的有效账号登录。',
  features = ['知识卡片', 'AI 批改', '错因分析', '变式巩固'],
}: AccountAccessPanelProps) {
  return <section className="account-access-panel" aria-label="账号提示">
    <div><span className="account-access-eyebrow">账号访问</span><h2>{title}</h2><p>{description}</p>
      <div className="account-access-tags">{features.map(feature => <span key={feature}>{feature}</span>)}</div>
    </div><Link to="/login" className="account-access-action">前往登录</Link>
  </section>;
}
