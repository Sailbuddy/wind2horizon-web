import LegalPage from '@/components/legal/LegalPage';

export default function Page() {
  return (
    <LegalPage
      filePath="legal/datenschutz-de.html"
      title="Datenschutzerklärung"
      note="Diese deutsche Version ist rechtlich maßgeblich."
    />
  );
}