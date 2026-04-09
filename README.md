# Czech Map Game

Malá statická webová hra ve stylu Seterra pro správní jednotky České republiky.

## Co to je

Tento projekt je jednoduchá kvízová aplikace, která používá lokální GeoJSON data a hierarchii správních jednotek. Uživatel vybírá úroveň (kraje, okresy, ORP) a rozsah (celá ČR, jeden kraj, jeden okres) a na mapě kliká na správný polygon.

## Struktura

- `index.html` - hlavní statická stránka
- `styles.css` - vzhled aplikace
- `app.js` - logika načítání dat, mapy a hry
- `README.md` - dokumentace
- `data/` - zdrojová data
  - `Kraje_NUTS_3_multi_20260101.geojson`
  - `Okresy_LAU_1_multi_20260101.geojson`
  - `CZ_ORP_Enriched.geojson`
  - `CZ_AdministrativeHierarchy.json`

## Jak spustit

1. Umístěte repozitář na GitHub Pages nebo spusťte jednoduchý lokální server.
2. Otevřete `index.html` ve webovém prohlížeči.

Pro lokální testování můžete použít například Python v adresáři projektu:

```bash
python -m http.server 8000
```

Pak navštivte:

```
http://127.0.0.1:8000/
```

## Požadavky na data

Aplikace vyžaduje následující soubory v adresáři `data/`:

- `Kraje_NUTS_3_multi_20260101.geojson`
- `Okresy_LAU_1_multi_20260101.geojson`
- `CZ_ORP_Enriched.geojson`
- `CZ_AdministrativeHierarchy.json`

## Poznámky

- Aplikace je čistě frontendová a nevyžaduje žádný build krok.
- Používá pouze lokální data a Leaflet z CDN.
- Je připravena pro statické hostování na GitHub Pages.
