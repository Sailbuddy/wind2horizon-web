// app/page.js
import { redirect } from 'next/navigation';

export default function Home() {
  // Root "/" soll direkt auf die deutsche Karte zeigen
  redirect('/de');
  return null;
}