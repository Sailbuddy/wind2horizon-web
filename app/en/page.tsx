import LegalPage from '@/components/legal/LegalPage';

export default function Page() {
  return (
    <LegalPage
      filePath="legal/privacy-en.html"
      title="Privacy Policy"
      note="This English version is provided for international users. In case of discrepancies, the German version is legally binding."
    />
  );
}