import fs from 'fs';
import path from 'path';

type LegalPageProps = {
  filePath: string;
  title: string;
  note?: string;
};

export default function LegalPage({ filePath, title, note }: LegalPageProps) {
  const absolutePath = path.join(process.cwd(), 'public', filePath);
  const html = fs.readFileSync(absolutePath, 'utf8');

  return (
    <main className="legal-page">
      <div className="legal-wrap">
        <header className="legal-header">
          <div className="legal-brand">Wind2Horizon</div>
          <h1>{title}</h1>
          {note ? <p className="legal-note">{note}</p> : null}
        </header>

        <article
          className="legal-content"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </main>
  );
}