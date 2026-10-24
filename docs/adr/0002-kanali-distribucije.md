# ADR 0002 — Kanali distribucije i redosled

- Status: Predloženo (2026-10-24) — čeka potvrdu vlasnika
- Kontekst: Cilj su web/PWA, Google Play i App Store, globalno. Tržište RSVP aplikacija na iOS-u je gusto (`docs/phase-1/01-validacija-potrebe.md`). Apple guideline 4.2 nosi rizik odbijanja tankog web omotača.
- Odluka (predlog): Jedan statički kod kao izvor istine. Redosled lansiranja je (1) PWA, (2) Google Play preko TWA omotača, (3) iOS omotač samo posle potvrde H4/H5 i procene 4.2. Ako iOS omotač bude odbijen ili neisplativ, iOS ostaje na PWA-u.
- Razlog: Najjeftiniji kanali prvi; validacija pre najskuplje i najrizičnije investicije.
- Posledice: DST-01 i DST-02 se zatvaraju po kanalu. QA-04 matrica uključuje Android Chrome, desktop Chrome/Edge i iOS Safari od početka, jer je PWA na iOS-u podržan kanal.
