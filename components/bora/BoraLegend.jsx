export default function BoraLegend() {
  return (
    <div className="flex flex-wrap justify-center gap-6 text-sm font-semibold mt-3">
      <div className="text-slate-900">0 = keine Druckdifferenz</div>
      <div className="text-amber-600">−4 hPa – Bora möglich</div>
      <div className="text-red-600">−8 hPa – Starke Bora</div>
    </div>
  );
}
