// /lib/i18n/boraTexts.js
// Wind2Horizon – Bora (Triest ↔ Maribor)
// Keys used by BoraPanel.jsx via label('key', lang)

export const boraTexts = {
  de: {
    boraTitle: 'Bora – Fallwind an der Adria',
    boraP1:
      'Die Bora ist ein kalter, böiger Fallwind an der Adriaküste. Sie kann plötzlich auftreten und in exponierten Lagen Windgeschwindigkeiten von über 200 km/h erreichen.',
    boraP2:
      'Gut prognostizierbar ist die Bora anhand des Luftdruck-Unterschieds zwischen den Wetterstationen in Triest und Maribor.',
    boraP3:
      'Ist der Luftdruck in Triest um 4 hPa niedriger (−4 hPa, orange Linie) als in Maribor, entsteht Bora. Bei einer Differenz von 8 hPa (−8 hPa, rote Linie) kann sie stürmische Ausprägung erreichen. Die dünne weiße Linie (0 hPa) zeigt ausgeglichene Druckverhältnisse zwischen Triest und Maribor an.',
    boraNote:
      'Die dargestellten Live-Wetterdaten (Luftdruck, Windrichtung und Windgeschwindigkeit) stammen von Open-Meteo.com, einer frei zugänglichen Plattform, die numerische Wettermodelle wie ICON und GFS verarbeitet. Hinweis: Die Daten dienen der Visualisierung und sind nicht behördlich geprüft.',

    // ✅ Legend lines (für farbige Legende unter den Charts)
    boraLegend0: 'keine Druckdifferenz',
    boraLegend4: 'Bora möglich',
    boraLegend8: 'Starke Bora',

    // Optional (falls du es später wieder aktivieren willst)
    boraBonus:
      'Für Segler ist nicht nur die absolute Windgeschwindigkeit entscheidend, sondern auch die rasche Druckänderung und die lokale Topographie.',

    // Badge/Levels (falls du die Texte i18n willst)
    boraLevelStorm: 'Stark',
    boraLevelBora: 'Bora',
    boraLevelWatch: 'Achtung',
    boraLevelNone: 'Keine Bora',

    // Section titles (falls nicht schon vorhanden)
    boraWeek: 'Wochenprognose',
    bora48h: 'Detailansicht der nächsten 48 Stunden',
    boraLiveTitle: 'Aktuell vor Ort – Triest',
  },

  en: {
    boraTitle: 'Bora – Katabatic Wind in the Adriatic',
    boraP1:
      'The Bora is a cold, gusty katabatic wind along the Adriatic coast. It can develop suddenly and, in exposed areas, reach wind speeds exceeding 200 km/h.',
    boraP2:
      'The Bora can be forecast relatively reliably by analysing the air pressure difference between the weather stations in Trieste and Maribor.',
    boraP3:
      'If the air pressure in Trieste is 4 hPa lower (−4 hPa, orange line) than in Maribor, Bora conditions may develop. At a pressure difference of 8 hPa (−8 hPa, red line), strong Bora events are possible. The thin white line (0 hPa) indicates balanced pressure conditions between Trieste and Maribor.',
    boraNote:
      'The displayed live weather data (air pressure, wind direction and wind speed) are provided by Open-Meteo.com, an open platform processing numerical weather models such as ICON and GFS. Note: The data are for visualisation purposes only and are not officially certified.',

    // ✅ Legend lines
    boraLegend0: 'no pressure difference',
    boraLegend4: 'Bora possible',
    boraLegend8: 'Strong Bora',

    boraBonus:
      'For sailors, not only the absolute wind speed matters, but also the rate of pressure change and local topography.',

    boraLevelStorm: 'Severe',
    boraLevelBora: 'Bora',
    boraLevelWatch: 'Watch',
    boraLevelNone: 'No Bora',

    boraWeek: 'Weekly outlook',
    bora48h: 'Detailed view (next 48 hours)',
    boraLiveTitle: 'Live on site – Trieste',
  },

  it: {
    boraTitle: 'Bora – Vento di caduta nell’Adriatico',
    boraP1:
      'La Bora è un vento freddo e rafficato lungo la costa adriatica. Può svilupparsi improvvisamente e, nelle zone esposte, raggiungere velocità superiori a 200 km/h.',
    boraP2:
      'La Bora può essere prevista in modo affidabile analizzando la differenza di pressione tra le stazioni meteorologiche di Trieste e Maribor.',
    boraP3:
      'Se la pressione a Trieste è inferiore di 4 hPa (−4 hPa, linea arancione) rispetto a Maribor, possono formarsi condizioni di Bora. Con una differenza di 8 hPa (−8 hPa, linea rossa), la Bora può diventare tempestosa. La sottile linea bianca (0 hPa) indica un equilibrio tra Trieste e Maribor.',
    boraNote:
      'I dati meteorologici in tempo reale (pressione, direzione e velocità del vento) provengono da Open-Meteo.com, una piattaforma aperta che elabora modelli numerici come ICON e GFS. Nota: I dati hanno scopo illustrativo e non sono certificati ufficialmente.',

    // ✅ Legend lines
    boraLegend0: 'nessuna differenza di pressione',
    boraLegend4: 'Bora possibile',
    boraLegend8: 'Bora forte',

    boraBonus:
      'Per i navigatori non conta solo la velocità assoluta del vento, ma anche la rapidità della variazione di pressione e la topografia locale.',

    boraLevelStorm: 'Forte',
    boraLevelBora: 'Bora',
    boraLevelWatch: 'Attenzione',
    boraLevelNone: 'Nessuna Bora',

    boraWeek: 'Previsione settimanale',
    bora48h: 'Dettaglio (prossime 48 ore)',
    boraLiveTitle: 'In tempo reale – Trieste',
  },

  fr: {
    boraTitle: 'Bora – Vent catabatique en Adriatique',
    boraP1:
      'La Bora est un vent froid et violent le long de la côte adriatique. Elle peut se développer soudainement et atteindre, dans les zones exposées, des vitesses supérieures à 200 km/h.',
    boraP2:
      'La Bora peut être anticipée en analysant la différence de pression atmosphérique entre les stations météorologiques de Trieste et de Maribor.',
    boraP3:
      "Si la pression à Trieste est inférieure de 4 hPa (−4 hPa, ligne orange) à celle de Maribor, des conditions de Bora peuvent se développer. Avec une différence de 8 hPa (−8 hPa, ligne rouge), la Bora peut devenir tempétueuse. La fine ligne blanche (0 hPa) indique un équilibre de pression entre Trieste et Maribor.",
    boraNote:
      'Les données météorologiques en temps réel (pression, direction et vitesse du vent) proviennent de Open-Meteo.com, une plateforme ouverte traitant des modèles numériques tels que ICON et GFS. Remarque : ces données sont fournies à titre informatif et ne sont pas certifiées officiellement.',

    // ✅ Legend lines
    boraLegend0: 'aucune différence de pression',
    boraLegend4: 'Bora possible',
    boraLegend8: 'Bora forte',

    boraBonus:
      'Pour les navigateurs, ce n’est pas seulement la vitesse du vent qui compte, mais aussi la rapidité des variations de pression et la topographie locale.',

    boraLevelStorm: 'Fort',
    boraLevelBora: 'Bora',
    boraLevelWatch: 'Vigilance',
    boraLevelNone: 'Pas de Bora',

    boraWeek: 'Prévision hebdomadaire',
    bora48h: 'Détail (48 h)',
    boraLiveTitle: 'En direct – Trieste',
  },

  hr: {
    boraTitle: 'Bura – padinski vjetar na Jadranu',
    boraP1:
      'Bura je hladan i jak padinski vjetar duž jadranske obale. Može nastati iznenada i na izloženim područjima doseći brzine veće od 200 km/h.',
    boraP2:
      'Bura se može relativno pouzdano prognozirati analizom razlike tlaka zraka između meteoroloških postaja u Trstu i Mariboru.',
    boraP3:
      'Ako je tlak zraka u Trstu 4 hPa niži (−4 hPa, narančasta linija) nego u Mariboru, može doći do bure. Kod razlike od 8 hPa (−8 hPa, crvena linija), bura može biti olujna. Tanka bijela linija (0 hPa) pokazuje uravnotežene vrijednosti tlaka između Trsta i Maribora.',
    boraNote:
      'Prikazani meteorološki podaci u stvarnom vremenu (tlak zraka, smjer i brzina vjetra) dolaze s platforme Open-Meteo.com koja obrađuje numeričke modele poput ICON i GFS. Napomena: podaci služe isključivo za vizualizaciju i nisu službeno verificirani.',

    // ✅ Legend lines
    boraLegend0: 'nema razlike tlaka',
    boraLegend4: 'bura moguća',
    boraLegend8: 'jaka bura',

    boraBonus:
      'Za nautičare nije presudna samo brzina vjetra, već i brzina promjene tlaka te lokalna topografija.',

    boraLevelStorm: 'Jako',
    boraLevelBora: 'Bura',
    boraLevelWatch: 'Upozorenje',
    boraLevelNone: 'Nema bure',

    boraWeek: 'Tjedna prognoza',
    bora48h: 'Detaljno (sljedećih 48 h)',
    boraLiveTitle: 'U stvarnom vremenu – Trst',
  },
};
