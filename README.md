# Nerapoli — caccia al Ghigno

Gioco di inseguimento a movimento nascosto per 2–6 giocatori: il PC fa da tabellone, ognuno gioca dal proprio telefono.

## Avvio

```
npm install
npm start
```

- Sul PC apri **http://localhost:3000/board**.
- I telefoni (stessa rete Wi-Fi) inquadrano il QR code sul tabellone o aprono l'indirizzo stampato in console (es. `http://192.168.1.18:3000/`).
- Se i telefoni non si collegano, consenti Node.js nel firewall di Windows per le reti private.

## Regole in breve

- Un giocatore è **il Ghigno**, gli altri sono **detective** (da 1 a 5 pedine; un giocatore può guidarne più d'una).
- Biglietti detective: Auto 10, Tram 8, Metro 4. Quelli usati passano al Ghigno.
- Il Ghigno: Auto 4, Tram 3, Metro 3, un **biglietto nero** per detective (vale per qualsiasi mezzo, anche il traghetto) e 2 **doppie mosse**.
- Il Ghigno si mostra ai turni 3, 8, 13, 18 e 24; negli altri turni si vede solo il mezzo usato.
- I detective vincono se uno di loro raggiunge il Ghigno o se il Ghigno non può più muoversi.
- Il Ghigno vince se resiste 24 turni o se tutti i detective restano bloccati.

## Sviluppo

- `npm test`: test della logica di gioco e della mappa.
- `src/map.js`: mappa originale generata in modo deterministico.
- `src/game.js`: regole (funzioni pure).
- `server.js`: Express + Socket.IO; la posizione del Ghigno viene inviata solo al suo telefono.
- `public/`: tabellone (`board.*`) e controller per telefono (`phone.*`).
