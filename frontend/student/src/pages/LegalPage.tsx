import { Link } from 'react-router-dom';
import { legalContactEmail, legalDocuments, type LegalDocumentKind } from '../content/legalDocuments';

type LegalPageProps = {
  document: LegalDocumentKind;
};

const legalNavigation: Array<{ kind: LegalDocumentKind; href: string; label: string }> = [
  { kind: 'terms', href: '/legal/terms', label: '用户协议' },
  { kind: 'privacy', href: '/legal/privacy', label: '隐私政策' },
  { kind: 'minors', href: '/legal/minors', label: '未成年人保护规则' },
];

export default function LegalPage({ document: documentKind }: LegalPageProps) {
  const document = legalDocuments[documentKind];

  return (
    <main className="legal-page">
      <article className="legal-document">
        <header className="legal-document-header">
          <div className="legal-eyebrow">OpenPhysics · OpenPhysics</div>
          <h1>{document.title}</h1>
          <p className="legal-summary">{document.summary}</p>
          <dl className="legal-meta" aria-label="文件信息">
            <div><dt>版本</dt><dd>{document.version}</dd></div>
            <div><dt>公示日期</dt><dd>{document.publishedAt}</dd></div>
            <div><dt>生效日期</dt><dd>{document.effectiveAt}</dd></div>
          </dl>
          <div className="legal-contact">
            客服、投诉与个人信息权利申请：
            <a href={`mailto:${legalContactEmail}`}>{legalContactEmail}</a>
          </div>
          <div className="legal-notice" role="note">{document.notice}</div>
        </header>

        <div className="legal-document-body">
          {document.sections.map(section => (
            <section key={section.title} className="legal-section">
              <h2>{section.title}</h2>
              {section.paragraphs?.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
              {section.items ? (
                <ul>
                  {section.items.map(item => <li key={item}>{item}</li>)}
                </ul>
              ) : null}
            </section>
          ))}
        </div>

        <nav className="legal-document-actions" aria-label="法律文件导航">
          {legalNavigation
            .filter(item => item.kind !== documentKind)
            .map(item => <Link key={item.kind} to={item.href}>查看{item.label}</Link>)}
          <Link to="/login">返回登录</Link>
          <button type="button" onClick={() => window.print()}>打印或保存</button>
        </nav>
      </article>
    </main>
  );
}
