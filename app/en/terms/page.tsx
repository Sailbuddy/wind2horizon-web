import LegalPage from '@/components/legal/LegalPage';

export default function Page() {
  return (
    <LegalPage
      filePath="legal/terms-en.html"
      title="Terms of Use"
      note="This English version is provided for international users. In case of discrepancies, the German version is legally binding."
    />
  );
}