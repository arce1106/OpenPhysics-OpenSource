import { Link, Navigate, useLocation } from 'react-router-dom';
export default function AccountSecurityPage({ mode = 'credentials' }: { mode?: 'reset' | 'credentials' }) {
  const location = useLocation();
  if (mode === 'reset') return <main className="container"><h1>找回密码</h1><p>请联系本部署的管理员核实身份并重置密码。</p><Link to="/login">返回登录</Link></main>;
  return <Navigate replace to="/profile" state={{ editor: location.state?.focusField === 'password' ? 'password' : 'username' }} />;
}
